/**
 * Provider-neutral model sync.
 *
 * Given listings from one or more providers, the engine works out what changed in the catalog and
 * (optionally) applies it through the lifecycle registry:
 *
 *  - new models                -> registered as unscored `candidate`s (capped per run)
 *  - changed route prices      -> stored as price overrides; large changes are held for approval
 *  - models no longer listed   -> `retired` after N consecutive syncs (only if every provider that
 *                                 serves the model was synced successfully)
 *  - models with an expiration -> `legacy` once the provider's removal date is near
 *
 * A listing that fails to download, or that is implausibly small, never changes anything.
 */

import { registerCandidateModel, setModelStatus } from '../modelLifecycle';
import { modelRegistry } from '../modelRegistry';
import {
  allCatalogModels,
  MODEL_ID_ALIASES,
  UNIFIED_MODEL_CATALOG,
  type BackendProvider,
  type CanonicalModelProfile,
} from '../unifiedModelCatalog';
import {
  DEFAULT_SYNC_OPTIONS,
  type ExpiringModelReport,
  type MissingModelReport,
  type ModelSourceAdapter,
  type NewCandidateReport,
  type PriceChangeReport,
  type ProviderListing,
  type ProviderSyncReport,
  type SyncOptions,
  type SyncReport,
} from './types';

type Price = { inputPerMillion: number; outputPerMillion: number };

/** Smallest relative price difference treated as a change (provider listings round differently). */
const PRICE_NOISE = 0.01;

function relativeChange(from: number, to: number): number {
  if (from === to) return 0;
  if (from === 0) return 1;
  return Math.abs(to - from) / from;
}

function priceChange(from: Price, to: Price): number {
  return Math.max(relativeChange(from.inputPerMillion, to.inputPerMillion), relativeChange(from.outputPerMillion, to.outputPerMillion));
}

/** The price a route has before any provider-synced override: the registered profile, else the seed catalog. */
function baselinePrice(modelId: string, provider: BackendProvider): Price | undefined {
  const profile = modelRegistry.getRecord(modelId)?.profile ?? UNIFIED_MODEL_CATALOG.find((m) => m.id === modelId);
  return profile?.routes.find((r) => r.provider === provider)?.pricing;
}

function isAccepted(accept: SyncOptions['acceptPriceChanges'], modelId: string, provider: BackendProvider): boolean {
  if (accept === 'all') return true;
  const key = `${modelId}:${provider}`.toLowerCase();
  return accept.some((entry) => entry.toLowerCase() === key);
}

interface FetchedProvider {
  adapter: ModelSourceAdapter;
  listing?: ProviderListing[];
  error?: string;
  aborted?: string;
}

export async function runModelSync(adapters: ModelSourceAdapter[], overrides: Partial<SyncOptions> = {}): Promise<SyncReport> {
  const options: SyncOptions = { ...DEFAULT_SYNC_OPTIONS, ...overrides };
  const now = options.now ?? new Date();
  const startedAt = new Date().toISOString();
  const errors: string[] = [];

  // 1. Download every listing first; nothing is changed until all of them are known.
  const fetched: FetchedProvider[] = await Promise.all(
    adapters.map(async (adapter): Promise<FetchedProvider> => {
      try {
        const listing = await adapter.fetchListing();
        if (listing.length < options.minListingSize) {
          return { adapter, listing, aborted: `listing has only ${listing.length} models (minimum ${options.minListingSize}); ignored as unreliable` };
        }
        return { adapter, listing };
      } catch (err) {
        return { adapter, error: err instanceof Error ? err.message : String(err) };
      }
    })
  );

  const syncedProviders = new Set<BackendProvider>(fetched.filter((f) => f.listing && !f.aborted).map((f) => f.adapter.provider));
  const catalog = allCatalogModels();
  const providerReports = new Map<BackendProvider, ProviderSyncReport>();
  const listingIndex = new Map<BackendProvider, Map<string, ProviderListing>>();

  for (const f of fetched) {
    providerReports.set(f.adapter.provider, {
      provider: f.adapter.provider,
      ok: !f.error && !f.aborted,
      error: f.error,
      aborted: f.aborted,
      listingCount: f.listing?.length ?? 0,
      newCandidates: [],
      skipped: {},
      priceChanges: [],
      missing: [],
      expiring: [],
      reappeared: [],
    });
    if (f.listing && !f.aborted) listingIndex.set(f.adapter.provider, new Map(f.listing.map((l) => [l.upstreamModelId, l])));
  }

  // 2. Work out new candidates per provider.
  const normalizeId = (id: string) => id.toLowerCase().replace(/[._]/g, '-');
  const existingIds = new Set<string>(catalog.map((m) => normalizeId(m.id)));
  for (const alias of Object.keys(MODEL_ID_ALIASES)) existingIds.add(normalizeId(alias));
  const takenIds = new Set<string>();
  const plannedCandidates: Array<{ provider: BackendProvider; profile: CanonicalModelProfile; listing: ProviderListing }> = [];

  for (const f of fetched) {
    const report = providerReports.get(f.adapter.provider)!;
    if (!f.listing || f.aborted) continue;

    const knownUpstream = new Set(catalog.flatMap((m) => m.routes.filter((r) => r.provider === f.adapter.provider).map((r) => r.upstreamModelId)));
    const skip = (reason: string) => (report.skipped[reason] = (report.skipped[reason] ?? 0) + 1);
    const eligible: Array<{ profile: CanonicalModelProfile; listing: ProviderListing }> = [];

    for (const listing of f.listing) {
      if (knownUpstream.has(listing.upstreamModelId)) continue;
      const result = f.adapter.toCandidate(listing, {
        now,
        windowDays: options.discoveryWindowDays,
        isIdTaken: (id) => takenIds.has(id) || existingIds.has(normalizeId(id)),
        matchesExistingModel: (id) => existingIds.has(normalizeId(id)),
      });
      if ('skip' in result) {
        skip(result.skip);
        continue;
      }
      takenIds.add(result.id);
      eligible.push({ profile: result, listing });
    }

    eligible.sort((a, b) => Date.parse(b.listing.createdAt ?? '') - Date.parse(a.listing.createdAt ?? ''));
    for (const [index, item] of eligible.entries()) {
      if (index >= options.maxNewModels) {
        skip('over_per_run_cap');
        continue;
      }
      plannedCandidates.push({ provider: f.adapter.provider, ...item });
    }
  }

  // 3. Price changes, miss counters, expiry and removals for models Lyra already knows.
  const priceUpdates: Array<{ report: PriceChangeReport; clear: boolean }> = [];
  const sightingUpdates: Array<{ modelId: string; missedSyncs: Partial<Record<BackendProvider, number>>; seen: boolean }> = [];
  const retirements: Array<{ model: CanonicalModelProfile; report: MissingModelReport }> = [];
  const expirations: Array<{ model: CanonicalModelProfile; report: ExpiringModelReport }> = [];

  for (const model of catalog) {
    const status = modelRegistry.getStatus(model.id);
    const record = modelRegistry.getRecord(model.id);
    const previousMisses = record?.missedSyncs ?? {};
    const nextMisses: Partial<Record<BackendProvider, number>> = { ...previousMisses };
    let seenAnywhere = false;
    let touched = false;

    for (const route of model.routes) {
      const index = listingIndex.get(route.provider);
      if (!index) continue; // provider not synced this run: leave its counter alone
      touched = true;
      const report = providerReports.get(route.provider)!;
      const listed = index.get(route.upstreamModelId);

      if (!listed) {
        nextMisses[route.provider] = (previousMisses[route.provider] ?? 0) + 1;
        continue;
      }
      seenAnywhere = true;
      delete nextMisses[route.provider];
      if (status === 'retired') {
        report.reappeared.push(model.id);
        continue;
      }

      if (listed.pricing && listed.pricing.inputPerMillion > 0 && listed.pricing.outputPerMillion > 0) {
        const current = route.pricing;
        const change = priceChange(current, listed.pricing);
        if (change > PRICE_NOISE) {
          const baseline = baselinePrice(model.id, route.provider);
          const clear = Boolean(baseline && priceChange(baseline, listed.pricing) <= PRICE_NOISE && record?.priceOverrides?.[route.provider]);
          const held = !clear && change * 100 > options.maxPriceChangePct && !isAccepted(options.acceptPriceChanges, model.id, route.provider);
          const entry: PriceChangeReport = {
            modelId: model.id,
            provider: route.provider,
            from: { inputPerMillion: current.inputPerMillion, outputPerMillion: current.outputPerMillion },
            to: { inputPerMillion: listed.pricing.inputPerMillion, outputPerMillion: listed.pricing.outputPerMillion },
            changePct: Math.round(change * 1000) / 10,
            status: held ? 'held' : clear ? (options.apply ? 'cleared' : 'would-clear') : options.apply ? 'applied' : 'would-apply',
          };
          report.priceChanges.push(entry);
          if (!held) priceUpdates.push({ report: entry, clear });
        }
      }
    }

    if (touched && status !== 'retired') {
      const changed = JSON.stringify(nextMisses) !== JSON.stringify(previousMisses);
      if (changed || (seenAnywhere && record)) sightingUpdates.push({ modelId: model.id, missedSyncs: nextMisses, seen: seenAnywhere });
    }
    if (status === 'retired') continue;

    const everyRouteSynced = model.routes.every((r) => syncedProviders.has(r.provider));
    const misses = model.routes.map((r) => nextMisses[r.provider] ?? 0);
    const anyMiss = misses.some((n) => n > 0);

    if (anyMiss && model.routes.some((r) => syncedProviders.has(r.provider))) {
      const missedSyncs = Math.max(...misses);
      // Only providers synced this run can vouch that the model is gone.
      const syncedMisses = model.routes.filter((r) => syncedProviders.has(r.provider)).map((r) => nextMisses[r.provider] ?? 0);
      const reachedThreshold = syncedMisses.every((n) => n >= options.missesBeforeRetire);
      const entry: MissingModelReport = { modelId: model.id, missedSyncs, action: 'none' };
      const reportProvider = providerReports.get(model.routes.find((r) => syncedProviders.has(r.provider))!.provider)!;
      reportProvider.missing.push(entry);
      if (reachedThreshold && everyRouteSynced) retirements.push({ model, report: entry });
      else if (reachedThreshold) {
        entry.action = 'blocked';
        entry.reason = 'another provider serving this model was not synced';
      }
    }

    // Provider-announced removal date, only when every route is listed with a date.
    if (status === 'active' && everyRouteSynced) {
      const dates = model.routes.map((r) => listingIndex.get(r.provider)?.get(r.upstreamModelId)?.expiresAt);
      if (dates.every((d): d is string => Boolean(d))) {
        const earliest = Math.min(...dates.map((d) => Date.parse(d)));
        if (earliest - now.getTime() <= options.expiryWarningDays * 86_400_000) {
          const entry: ExpiringModelReport = {
            modelId: model.id,
            expiresAt: new Date(earliest).toISOString(),
            action: options.apply ? 'legacy' : 'would-legacy',
          };
          providerReports.get(model.routes[0]!.provider)!.expiring.push(entry);
          expirations.push({ model, report: entry });
        }
      }
    }
  }

  // Cap removals per run so a bad listing cannot empty the catalog.
  retirements.sort((a, b) => a.model.id.localeCompare(b.model.id));
  const allowed = retirements.slice(0, options.maxRetirementsPerRun);
  for (const { report } of retirements) {
    if (allowed.some((a) => a.report === report)) report.action = options.apply ? 'retired' : 'would-retire';
    else {
      report.action = 'blocked';
      report.reason = `retirement cap of ${options.maxRetirementsPerRun} per run reached`;
    }
  }

  for (const planned of plannedCandidates) {
    const entry: NewCandidateReport = {
      id: planned.profile.id,
      name: planned.profile.name,
      upstreamModelId: planned.listing.upstreamModelId,
      pricing: planned.listing.pricing,
      createdAt: planned.listing.createdAt,
      registered: false,
    };
    providerReports.get(planned.provider)!.newCandidates.push(entry);
  }

  // 4. Apply. Each write is independent; one failure is reported and the rest continue.
  if (options.apply) {
    const attempt = async (label: string, fn: () => Promise<unknown>): Promise<string | undefined> => {
      try {
        await fn();
        return undefined;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${label}: ${message}`);
        return message;
      }
    };

    for (const planned of plannedCandidates) {
      const entry = providerReports.get(planned.provider)!.newCandidates.find((c) => c.id === planned.profile.id)!;
      const error = await attempt(`register ${planned.profile.id}`, () =>
        registerCandidateModel(planned.profile, { actor: options.actor, source: 'discovered', reason: `Discovered via ${planned.provider} sync` })
      );
      entry.registered = !error;
      entry.error = error;
    }

    for (const { report, clear } of priceUpdates) {
      const error = await attempt(`price ${report.modelId}:${report.provider}`, () =>
        modelRegistry.setPriceOverride(report.modelId, report.provider, clear ? null : report.to, {
          actor: options.actor,
          source: `${report.provider}-sync`,
          reason: `${clear ? 'Back to catalog price' : 'Provider price'} ${report.to.inputPerMillion}/${report.to.outputPerMillion} (was ${report.from.inputPerMillion}/${report.from.outputPerMillion})`,
        })
      );
      if (error) report.status = 'held';
    }

    for (const update of sightingUpdates) {
      await attempt(`sightings ${update.modelId}`, () =>
        modelRegistry.recordSightings(update.modelId, {
          missedSyncs: update.missedSyncs,
          lastSeenAt: update.seen ? now.toISOString() : undefined,
        })
      );
    }

    for (const { model, report } of expirations) {
      const error = await attempt(`legacy ${model.id}`, () =>
        setModelStatus(model.id, 'legacy', { actor: options.actor, reason: `Provider removes this model on ${report.expiresAt.slice(0, 10)}` })
      );
      if (error) report.action = 'would-legacy';
    }

    for (const { model, report } of retirements.filter((r) => allowed.some((a) => a.report === r.report))) {
      const error = await attempt(`retire ${model.id}`, () =>
        setModelStatus(model.id, 'retired', {
          actor: options.actor,
          reason: `Missing from provider listings for ${report.missedSyncs} consecutive syncs`,
        })
      );
      if (error) {
        report.action = 'blocked';
        report.reason = error;
      }
    }
  }

  return {
    dryRun: !options.apply,
    startedAt,
    finishedAt: new Date().toISOString(),
    providers: Array.from(providerReports.values()),
    errors: [...errors, ...fetched.filter((f) => f.error).map((f) => `${f.adapter.provider}: ${f.error}`)],
  };
}
