import type { BackendProvider, CanonicalModelProfile } from '../unifiedModelCatalog';

/** One model as reported by a provider's own model list. Provider-neutral. */
export interface ProviderListing {
  provider: BackendProvider;
  /** The id Lyra sends to this provider (matches `ProviderRoute.upstreamModelId`). */
  upstreamModelId: string;
  name: string;
  contextWindow?: number;
  /** USD per million tokens. Absent when the provider does not publish prices in its listing. */
  pricing?: { inputPerMillion: number; outputPerMillion: number };
  supportsTools?: boolean;
  textOnly?: boolean;
  supportsPromptCaching?: boolean;
  /** ISO timestamp the provider says the model was published. */
  createdAt?: string;
  /** ISO timestamp after which the provider says the model is removed. */
  expiresAt?: string;
}

export interface DiscoveryContext {
  now: Date;
  /** Only models published within this many days become candidates. */
  windowDays: number;
  /** True if a canonical id is already used (by a catalog model, an alias, or a candidate in this run). */
  isIdTaken: (id: string) => boolean;
  /**
   * True if the id is the same model as one already in the catalog, ignoring case and "." vs "-"
   * (`claude-haiku-5.5` is `claude-haiku-5-5`). Such listings are new routes, not new models.
   */
  matchesExistingModel: (id: string) => boolean;
}

/**
 * A provider integration. The sync engine is provider-neutral: adding Bedrock or Foundry means
 * writing one of these, not changing the engine.
 */
export interface ModelSourceAdapter {
  readonly provider: BackendProvider;
  /**
   * True for adapters that only know prices (Bedrock, Foundry). Their listing covers the routes Lyra
   * already has, so the engine uses it for price changes only: no new models, no "missing" counters,
   * no removals, no expiry.
   */
  readonly pricesOnly?: boolean;
  fetchListing(options?: { signal?: AbortSignal }): Promise<ProviderListing[]>;
  /** Builds a candidate profile for a listing Lyra does not know yet, or says why it is skipped. */
  toCandidate(listing: ProviderListing, context: DiscoveryContext): CanonicalModelProfile | { skip: string };
}

export interface SyncOptions {
  /** Write changes. When false the run only reports what it would do. */
  apply: boolean;
  actor: string;
  /** Maximum new candidates registered per provider per run. */
  maxNewModels: number;
  discoveryWindowDays: number;
  /** A listing smaller than this is treated as a broken response and ignored. */
  minListingSize: number;
  /** Consecutive syncs a model must be missing from its provider(s) before it is retired. */
  missesBeforeRetire: number;
  maxRetirementsPerRun: number;
  /** Price changes larger than this percentage are held for explicit approval. */
  maxPriceChangePct: number;
  /** `all`, or specific `"<modelId>:<provider>"` entries whose held price change should be applied. */
  acceptPriceChanges: 'all' | string[];
  /** Models the provider says will be removed within this many days become `legacy`. */
  expiryWarningDays: number;
  /** Move models to `legacy` when a newer version in the same line replaces them. */
  supersede: boolean;
  maxLegacyPerRun: number;
  now?: Date;
}

export const DEFAULT_SYNC_OPTIONS: SyncOptions = {
  apply: false,
  actor: 'model-sync',
  maxNewModels: 25,
  discoveryWindowDays: 60,
  minListingSize: 20,
  missesBeforeRetire: 2,
  maxRetirementsPerRun: 5,
  maxPriceChangePct: 50,
  acceptPriceChanges: [],
  expiryWarningDays: 14,
  supersede: true,
  maxLegacyPerRun: 10,
};

export type PriceChangeStatus = 'applied' | 'would-apply' | 'held' | 'cleared' | 'would-clear';

export interface PriceChangeReport {
  modelId: string;
  provider: BackendProvider;
  from: { inputPerMillion: number; outputPerMillion: number };
  to: { inputPerMillion: number; outputPerMillion: number };
  changePct: number;
  status: PriceChangeStatus;
}

export interface MissingModelReport {
  modelId: string;
  missedSyncs: number;
  /** `retired` / `would-retire`, or `none` while the miss count is below the threshold or retirement is not allowed. */
  action: 'none' | 'retired' | 'would-retire' | 'blocked';
  reason?: string;
}

export interface ExpiringModelReport {
  modelId: string;
  expiresAt: string;
  action: 'legacy' | 'would-legacy';
}

export interface NewCandidateReport {
  id: string;
  name: string;
  upstreamModelId: string;
  pricing?: { inputPerMillion: number; outputPerMillion: number };
  createdAt?: string;
  registered: boolean;
  error?: string;
  /** Existing models this looks like a newer version of (same family and series, lower version). */
  likelySuccessorOf?: string[];
}

export interface SupersessionReport {
  modelId: string;
  supersededBy: string;
  action: 'legacy' | 'would-legacy' | 'blocked';
  reason?: string;
}

export interface ProviderSyncReport {
  provider: BackendProvider;
  ok: boolean;
  error?: string;
  /** Set when the listing was rejected as unusable; nothing was changed for this provider. */
  aborted?: string;
  listingCount: number;
  newCandidates: NewCandidateReport[];
  /** Why listings were not turned into candidates, with counts. */
  skipped: Record<string, number>;
  priceChanges: PriceChangeReport[];
  missing: MissingModelReport[];
  expiring: ExpiringModelReport[];
  /** Retired models that are listed again; never reinstated automatically. */
  reappeared: string[];
}

export interface SyncReport {
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  providers: ProviderSyncReport[];
  /** Active models that a newer, at-least-as-good and not pricier version replaces. */
  supersessions: SupersessionReport[];
  errors: string[];
}
