import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { listGatewayLlmModels, parseIncludedStatuses, searchGatewayLlmModels } from '../gatewayLlmProxy';
import { setModelStatus } from '../modelLifecycle';
import { modelRegistry } from '../modelRegistry';
import { allCatalogModels, findCanonicalModel, getModelLifecycleStatus, listCanonicalModels, UNIFIED_MODEL_CATALOG } from '../unifiedModelCatalog';
import {
  createOpenRouterAdapter,
  getConfiguredAdapters,
  ModelSyncBusyError,
  parseAcceptedPriceChanges,
  parseOpenRouterListing,
  runConfiguredModelSync,
  runModelSync,
  type SyncOptions,
} from './index';

const NOW = new Date('2026-11-24T00:00:00Z');
const daysAgo = (days: number) => Math.floor((NOW.getTime() - days * 86_400_000) / 1000);

interface FakeModel {
  id: string;
  name?: string;
  created?: number;
  context?: number;
  prompt?: number; // USD per million tokens
  completion?: number;
  tools?: boolean;
  output?: string[];
  expires?: string;
}

/** Builds an entry shaped like OpenRouter's `GET /api/v1/models`. */
function entry(m: FakeModel) {
  return {
    id: m.id,
    name: m.name ?? m.id,
    created: m.created ?? daysAgo(10),
    context_length: m.context ?? 128_000,
    architecture: { output_modalities: m.output ?? ['text'] },
    pricing: { prompt: String((m.prompt ?? 1) / 1e6), completion: String((m.completion ?? 2) / 1e6) },
    supported_parameters: m.tools === false ? ['temperature'] : ['tools', 'temperature'],
    expiration_date: m.expires ?? null,
  };
}

function adapterFor(models: FakeModel[] | (() => FakeModel[])) {
  return createOpenRouterAdapter({
    url: 'https://openrouter.test/api/v1/models',
    fetchImpl: (async () => {
      const list = typeof models === 'function' ? models() : models;
      return new Response(JSON.stringify({ data: list.map(entry) }), { status: 200 });
    }) as unknown as typeof fetch,
  });
}

const base: Partial<SyncOptions> = { now: NOW, minListingSize: 1, apply: true, actor: 'test' };

/** Lists every OpenRouter route Lyra already knows, at its current catalog price, so only the change under test shows up. */
function currentOpenRouterListing(): FakeModel[] {
  return allCatalogModels().flatMap((m) =>
    m.routes
      .filter((r) => r.provider === 'openrouter')
      .map((r) => ({ id: r.upstreamModelId, prompt: r.pricing.inputPerMillion, completion: r.pricing.outputPerMillion }))
  );
}

const without = (list: FakeModel[], ...ids: string[]) => list.filter((m) => !ids.includes(m.id));
const withPrice = (list: FakeModel[], id: string, prompt: number, completion: number) =>
  list.map((m) => (m.id === id ? { ...m, prompt, completion } : m));

describe('OpenRouter model sync', () => {
  beforeEach(async () => {
    await modelRegistry.reset();
  });
  afterEach(async () => {
    await modelRegistry.reset();
  });

  describe('listing parser', () => {
    test('converts per-token prices to per-million and reads capabilities and dates', () => {
      const [m] = parseOpenRouterListing({
        data: [{ ...entry({ id: 'qwen/x', prompt: 0.15, completion: 0.6, expires: '2026-12-01' }), pricing: { prompt: '0.00000015', completion: '0.0000006', input_cache_read: '0.00000001' } }],
      });
      expect(m).toMatchObject({
        provider: 'openrouter',
        upstreamModelId: 'qwen/x',
        pricing: { inputPerMillion: 0.15, outputPerMillion: 0.6 },
        supportsTools: true,
        textOnly: true,
        supportsPromptCaching: true,
        expiresAt: '2026-12-01T23:59:59.000Z',
      });
    });

    test('skips malformed entries and rejects a response without a data array', () => {
      const listing = parseOpenRouterListing({ data: [null, 5, { name: 'no id' }, entry({ id: 'ok/model' }), { id: 'bad/price', pricing: { prompt: 'abc', completion: '-1' } }] });
      expect(listing.map((l) => l.upstreamModelId)).toEqual(['ok/model', 'bad/price']);
      expect(listing[1]!.pricing).toBeUndefined();
      expect(() => parseOpenRouterListing({ nope: true })).toThrow('data');
    });

    test('adapter surfaces HTTP errors and oversized or invalid bodies', async () => {
      const failing = createOpenRouterAdapter({ fetchImpl: (async () => new Response('x', { status: 503 })) as unknown as typeof fetch });
      await expect(failing.fetchListing()).rejects.toThrow('HTTP 503');
      const garbage = createOpenRouterAdapter({ fetchImpl: (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch });
      await expect(garbage.fetchListing()).rejects.toThrow();
    });
  });

  describe('discovering new models', () => {
    test('a tracked vendor becomes a candidate with placeholder metrics and a ZDR warning', async () => {
      const listing = [...currentOpenRouterListing(), { id: 'qwen/qwen9-coder', name: 'Qwen: Qwen9 Coder', prompt: 0.3, completion: 1.2, context: 256_000 }];
      const report = await runModelSync([adapterFor(listing)], base);

      expect(report.providers[0]!.newCandidates[0]).toMatchObject({ id: 'qwen9-coder', registered: true });
      expect(getModelLifecycleStatus('qwen9-coder')).toBe('candidate');
      const profile = findCanonicalModel('qwen9-coder')!;
      expect(profile).toMatchObject({ family: 'qwen', unscored: true, tier: 2 });
      expect(profile.routes[0]).toMatchObject({ provider: 'openrouter', upstreamModelId: 'qwen/qwen9-coder', apiStyle: 'openai-chat' });
      expect(profile.routes[0]!.contributorWarning).toContain('not verified');

      // Hidden from the default list and `auto`; searchable, with no scores shown.
      expect(listCanonicalModels().map((m) => m.id)).not.toContain('qwen9-coder');
      expect(listGatewayLlmModels('standard').models.map((m) => m.id)).not.toContain('qwen9-coder');
      const [hit] = searchGatewayLlmModels({ query: 'qwen9' }).models;
      expect(hit).toMatchObject({ id: 'qwen9-coder', status: 'candidate', scored: false, scores: null });
      // Not zero-data-retention until verified.
      expect(searchGatewayLlmModels({ query: 'qwen9', privacyMode: 'zdr' }).models).toEqual([]);

      const events = await modelRegistry.listEvents({ modelId: 'qwen9-coder' });
      expect(events[0]).toMatchObject({ action: 'add', actor: 'test', toStatus: 'candidate' });
    });

    test('is idempotent: a second run adds nothing', async () => {
      const listing = [...currentOpenRouterListing(), { id: 'qwen/qwen9-coder', prompt: 0.3, completion: 1.2 }];
      await runModelSync([adapterFor(listing)], base);
      const second = await runModelSync([adapterFor(listing)], base);
      expect(second.providers[0]!.newCandidates).toEqual([]);
      expect(modelRegistry.dynamicProfiles().map((p) => p.id)).toEqual(['qwen9-coder']);
    });

    test('skips variants, old, untooled, free, tiny-context, non-text and unknown-vendor listings, and says why', async () => {
      const listing: FakeModel[] = [
        ...currentOpenRouterListing(),
        { id: 'qwen/fresh:thinking' },
        { id: 'qwen/~latest' },
        { id: 'qwen/old-one', created: daysAgo(400) },
        { id: 'qwen/no-tools', tools: false },
        { id: 'qwen/free-one', prompt: 0, completion: 0 },
        { id: 'qwen/tiny', context: 8_000 },
        { id: 'qwen/image-gen', output: ['text', 'image'] },
        { id: 'nobody/model-x' },
        { id: 'qwen/good-one' },
      ];
      const report = await runModelSync([adapterFor(listing)], base);
      const p = report.providers[0]!;
      expect(p.newCandidates.map((c) => c.id)).toEqual(['good-one']);
      expect(p.skipped).toMatchObject({
        variant_or_unusual_id: 2,
        outside_discovery_window: 1,
        no_tool_support: 1,
        free_or_unpriced: 1,
        context_too_small: 1,
        not_text_output: 1,
        vendor_not_tracked: 1,
      });
    });

    test('treats dotted and hyphenated spellings of an existing model as the same model', async () => {
      const listing = [...currentOpenRouterListing(), { id: 'x-ai/grok-4-20' }, { id: 'anthropic/claude-sonnet-4.6' }];
      const report = await runModelSync([adapterFor(listing)], base);
      expect(report.providers[0]!.newCandidates).toEqual([]);
      expect(report.providers[0]!.skipped.matches_existing_model).toBe(1);
    });

    test('keeps only the newest models when over the per-run cap', async () => {
      const listing = [
        ...currentOpenRouterListing(),
        { id: 'qwen/older', created: daysAgo(30) },
        { id: 'qwen/newest', created: daysAgo(1) },
        { id: 'qwen/middle', created: daysAgo(10) },
      ];
      const report = await runModelSync([adapterFor(listing)], { ...base, maxNewModels: 2 });
      expect(report.providers[0]!.newCandidates.map((c) => c.id)).toEqual(['newest', 'middle']);
      expect(report.providers[0]!.skipped.over_per_run_cap).toBe(1);
    });

    test('disambiguates two new models with the same name from different vendors', async () => {
      const listing = [...currentOpenRouterListing(), { id: 'qwen/shared-name' }, { id: 'deepseek/shared-name' }];
      const report = await runModelSync([adapterFor(listing)], base);
      expect(report.providers[0]!.newCandidates.map((c) => c.id).sort()).toEqual(['deepseek-shared-name', 'shared-name']);
    });
  });

  describe('dry run', () => {
    test('reports everything but writes nothing', async () => {
      const listing = [...withPrice(currentOpenRouterListing(), 'x-ai/grok-4.20', 1.3, 2.6), { id: 'qwen/qwen9-coder' }];
      const report = await runModelSync([adapterFor(listing)], { ...base, apply: false });

      expect(report.dryRun).toBe(true);
      expect(report.providers[0]!.newCandidates).toHaveLength(1);
      expect(report.providers[0]!.newCandidates[0]!.registered).toBe(false);
      expect(report.providers[0]!.priceChanges[0]!.status).toBe('would-apply');
      expect(modelRegistry.listRecords()).toEqual([]);
      expect(await modelRegistry.listEvents()).toEqual([]);
    });
  });

  describe('price sync', () => {
    test('applies a moderate change as an override on that route only, leaving the seed untouched', async () => {
      const seedBefore = JSON.stringify(UNIFIED_MODEL_CATALOG.find((m) => m.id === 'grok-4.20'));
      const listing = withPrice(currentOpenRouterListing(), 'x-ai/grok-4.20', 1.5, 3);
      const report = await runModelSync([adapterFor(listing)], base);

      expect(report.providers[0]!.priceChanges).toMatchObject([{ modelId: 'grok-4.20', provider: 'openrouter', status: 'applied', changePct: 20 }]);
      expect(findCanonicalModel('grok-4.20')!.routes[0]!.pricing).toEqual({ inputPerMillion: 1.5, outputPerMillion: 3 });
      expect(listGatewayLlmModels('standard').models.find((m) => m.id === 'grok-4.20')!.pricing).toEqual({ inputPerMillion: 1.5, outputPerMillion: 3 });
      expect(JSON.stringify(UNIFIED_MODEL_CATALOG.find((m) => m.id === 'grok-4.20'))).toBe(seedBefore);

      const [event] = await modelRegistry.listEvents({ modelId: 'grok-4.20' });
      expect(event).toMatchObject({ action: 'price', actor: 'test' });
    });

    test('a multi-route model only changes the route that was synced', async () => {
      const listing = withPrice(currentOpenRouterListing(), 'anthropic/claude-sonnet-4.6', 3.3, 16.5);
      await runModelSync([adapterFor(listing)], base);
      const routes = findCanonicalModel('claude-sonnet-4-6')!.routes;
      expect(routes.find((r) => r.provider === 'openrouter')!.pricing.inputPerMillion).toBe(3.3);
      expect(routes.find((r) => r.provider === 'bedrock')!.pricing.inputPerMillion).toBe(3);
    });

    test('holds changes above the threshold until they are accepted', async () => {
      const listing = withPrice(currentOpenRouterListing(), 'x-ai/grok-4.20', 5, 10);
      const held = await runModelSync([adapterFor(listing)], base);
      expect(held.providers[0]!.priceChanges[0]).toMatchObject({ status: 'held', changePct: 300 });
      expect(findCanonicalModel('grok-4.20')!.routes[0]!.pricing.inputPerMillion).toBe(1.25);

      const accepted = await runModelSync([adapterFor(listing)], { ...base, acceptPriceChanges: ['GROK-4.20:openrouter'] });
      expect(accepted.providers[0]!.priceChanges[0]!.status).toBe('applied');
      expect(findCanonicalModel('grok-4.20')!.routes[0]!.pricing.inputPerMillion).toBe(5);
    });

    test('"all" accepts every held change', async () => {
      const listing = withPrice(withPrice(currentOpenRouterListing(), 'x-ai/grok-4.20', 5, 10), 'meta/muse-spark-1.3', 9, 20);
      const report = await runModelSync([adapterFor(listing)], { ...base, acceptPriceChanges: 'all' });
      expect(report.providers[0]!.priceChanges.map((c) => c.status)).toEqual(['applied', 'applied']);
    });

    test('ignores differences under 1% (providers round differently)', async () => {
      const listing = withPrice(currentOpenRouterListing(), 'x-ai/grok-4.20', 1.2501, 2.5001);
      const report = await runModelSync([adapterFor(listing)], base);
      expect(report.providers[0]!.priceChanges).toEqual([]);
      expect(modelRegistry.listRecords()).toEqual([]);
    });

    test('clears the override when the provider returns to the catalog price', async () => {
      await runModelSync([adapterFor(withPrice(currentOpenRouterListing(), 'x-ai/grok-4.20', 1.5, 3))], base);
      expect(modelRegistry.getRecord('grok-4.20')?.priceOverrides?.openrouter).toBeDefined();

      const back = await runModelSync([adapterFor(withPrice(currentOpenRouterListing(), 'x-ai/grok-4.20', 1.25, 2.5))], base);
      expect(back.providers[0]!.priceChanges[0]!.status).toBe('cleared');
      expect(modelRegistry.getRecord('grok-4.20')?.priceOverrides).toBeUndefined();
      expect(findCanonicalModel('grok-4.20')!.routes[0]!.pricing.inputPerMillion).toBe(1.25);
    });

    test('prices a candidate from its listing and changes follow the same rules', async () => {
      const first = [...currentOpenRouterListing(), { id: 'qwen/qwen9-coder', prompt: 0.3, completion: 1.2 }];
      await runModelSync([adapterFor(first)], base);
      const second = [...currentOpenRouterListing(), { id: 'qwen/qwen9-coder', prompt: 0.33, completion: 1.32 }];
      await runModelSync([adapterFor(second)], base);
      expect(findCanonicalModel('qwen9-coder')!.routes[0]!.pricing.inputPerMillion).toBe(0.33);
    });
  });

  describe('removals', () => {
    const only = (ids: string[]) => currentOpenRouterListing().filter((m) => !ids.includes(m.id));

    test('retires an OpenRouter-only model after two consecutive misses, not one', async () => {
      const listing = only(['meta/muse-spark-1.3']);
      const first = await runModelSync([adapterFor(listing)], base);
      expect(first.providers[0]!.missing).toMatchObject([{ modelId: 'muse-spark-1.3', missedSyncs: 1, action: 'none' }]);
      expect(getModelLifecycleStatus('muse-spark-1.3')).toBe('active');

      const second = await runModelSync([adapterFor(listing)], base);
      expect(second.providers[0]!.missing[0]).toMatchObject({ missedSyncs: 2, action: 'retired' });
      expect(getModelLifecycleStatus('muse-spark-1.3')).toBe('retired');
      expect(findCanonicalModel('muse-spark-1.3')).toBeUndefined();
      expect(searchGatewayLlmModels({ query: 'muse-spark', statuses: parseIncludedStatuses('all', true) }).models).toEqual([]);

      const [event] = await modelRegistry.listEvents({ modelId: 'muse-spark-1.3' });
      expect(event).toMatchObject({ action: 'status', toStatus: 'retired', actor: 'test' });
      expect(event!.reason).toContain('2 consecutive');
    });

    test('a model that comes back resets its counter', async () => {
      await runModelSync([adapterFor(only(['meta/muse-spark-1.3']))], base);
      expect(modelRegistry.getRecord('muse-spark-1.3')?.missedSyncs?.openrouter).toBe(1);
      await runModelSync([adapterFor(currentOpenRouterListing())], base);
      expect(modelRegistry.getRecord('muse-spark-1.3')?.missedSyncs?.openrouter).toBeUndefined();
      await runModelSync([adapterFor(only(['meta/muse-spark-1.3']))], base);
      expect(getModelLifecycleStatus('muse-spark-1.3')).toBe('active');
    });

    test('never retires a model that another, unsynced provider also serves', async () => {
      const listing = only(['anthropic/claude-sonnet-4.6']);
      for (let i = 0; i < 4; i++) await runModelSync([adapterFor(listing)], base);
      expect(getModelLifecycleStatus('claude-sonnet-4-6')).toBe('active');
      const last = await runModelSync([adapterFor(listing)], base);
      expect(last.providers[0]!.missing.find((m) => m.modelId === 'claude-sonnet-4-6')).toMatchObject({ action: 'blocked' });
    });

    test('a failed download changes nothing and does not count as a miss', async () => {
      const failing = createOpenRouterAdapter({ fetchImpl: (async () => new Response('', { status: 500 })) as unknown as typeof fetch });
      const report = await runModelSync([failing], base);
      expect(report.providers[0]).toMatchObject({ ok: false });
      expect(report.errors[0]).toContain('HTTP 500');
      expect(modelRegistry.listRecords()).toEqual([]);
    });

    test('an implausibly small listing is ignored entirely', async () => {
      const report = await runModelSync([adapterFor([{ id: 'qwen/only-one' }])], { ...base, minListingSize: 20 });
      expect(report.providers[0]).toMatchObject({ ok: false });
      expect(report.providers[0]!.aborted).toContain('minimum 20');
      expect(report.providers[0]!.newCandidates).toEqual([]);
      expect(modelRegistry.listRecords()).toEqual([]);
    });

    test('caps how many models one run can retire', async () => {
      const ids = ['x-ai/grok-4.20', 'meta/muse-spark-1.3', 'qwen/qwen3-coder-flash'];
      const listing = only(ids);
      await runModelSync([adapterFor(listing)], base);
      const report = await runModelSync([adapterFor(listing)], { ...base, maxRetirementsPerRun: 1 });
      const canonical = ['grok-4.20', 'muse-spark-1.3', 'qwen3-coder-flash'];
      const actions = report.providers[0]!.missing.filter((m) => canonical.includes(m.modelId)).map((m) => m.action).sort();
      expect(actions).toEqual(['blocked', 'blocked', 'retired']);
      expect(report.providers[0]!.missing.find((m) => m.action === 'blocked')!.reason).toContain('cap of 1');
    });

    test('a retired model that is listed again is reported, never reinstated', async () => {
      const listing = only(['meta/muse-spark-1.3']);
      await runModelSync([adapterFor(listing)], base);
      await runModelSync([adapterFor(listing)], base);
      const report = await runModelSync([adapterFor(currentOpenRouterListing())], base);
      expect(report.providers[0]!.reappeared).toContain('muse-spark-1.3');
      expect(getModelLifecycleStatus('muse-spark-1.3')).toBe('retired');
    });

    test('a dry run reports a retirement without performing it', async () => {
      const listing = only(['meta/muse-spark-1.3']);
      await runModelSync([adapterFor(listing)], base);
      const dry = await runModelSync([adapterFor(listing)], { ...base, apply: false });
      expect(dry.providers[0]!.missing[0]).toMatchObject({ action: 'would-retire' });
      expect(getModelLifecycleStatus('muse-spark-1.3')).toBe('active');
    });
  });

  describe('provider-announced removal', () => {
    test('moves a model to legacy when its removal date is close, not when it is far away', async () => {
      const soon = currentOpenRouterListing().map((m) => (m.id === 'x-ai/grok-4.20' ? { ...m, expires: '2026-11-30' } : m));
      const report = await runModelSync([adapterFor(soon)], base);
      expect(report.providers[0]!.expiring).toMatchObject([{ modelId: 'grok-4.20', action: 'legacy' }]);
      expect(getModelLifecycleStatus('grok-4.20')).toBe('legacy');
      expect(findCanonicalModel('grok-4.20')).toBeDefined(); // still usable
      expect(listCanonicalModels().map((m) => m.id)).not.toContain('grok-4.20');

      await modelRegistry.reset();
      const far = currentOpenRouterListing().map((m) => (m.id === 'x-ai/grok-4.20' ? { ...m, expires: '2027-06-01' } : m));
      const none = await runModelSync([adapterFor(far)], base);
      expect(none.providers[0]!.expiring).toEqual([]);
      expect(getModelLifecycleStatus('grok-4.20')).toBe('active');
    });
  });

  describe('promoting discovered models', () => {
    async function discover() {
      await runModelSync([adapterFor([...currentOpenRouterListing(), { id: 'qwen/qwen9-coder', prompt: 0.3, completion: 1.2 }])], base);
    }

    test('an unscored model cannot be activated without scores', async () => {
      await discover();
      await expect(setModelStatus('qwen9-coder', 'active', { actor: 'reviewer' })).rejects.toMatchObject({ code: 'invalid_input' });
      expect(getModelLifecycleStatus('qwen9-coder')).toBe('candidate');
    });

    test('scores are validated', async () => {
      await discover();
      await expect(
        setModelStatus('qwen9-coder', 'active', { actor: 'reviewer', scores: { coding: 150, reasoning: 80, toolProficiency: 80 } })
      ).rejects.toMatchObject({ code: 'invalid_input' });
      expect(getModelLifecycleStatus('qwen9-coder')).toBe('candidate');
    });

    test('scoring and activating puts the model in the default list with real scores', async () => {
      await discover();
      await setModelStatus('qwen9-coder', 'active', {
        actor: 'reviewer',
        reason: 'Benchmarked',
        scores: { coding: 88, reasoning: 84, toolProficiency: 86, tokensPerSecond: 120 },
      });

      expect(listCanonicalModels().map((m) => m.id)).toContain('qwen9-coder');
      const served = listGatewayLlmModels('standard').models.find((m) => m.id === 'qwen9-coder')!;
      expect(served).toMatchObject({ status: 'active', scored: true, scores: { coding: 88, reasoning: 84, toolProficiency: 86 } });
      expect(served.scores!.speed).toBeGreaterThan(0);
      // Still not zero-data-retention until someone says so.
      expect(served.zdrCompliant).toBe(false);
    });

    test('zdrVerified clears the warning so the model is allowed in ZDR mode', async () => {
      await discover();
      await setModelStatus('qwen9-coder', 'active', {
        actor: 'reviewer',
        zdrVerified: true,
        scores: { coding: 80, reasoning: 80, toolProficiency: 80 },
      });
      expect(listGatewayLlmModels('zdr').models.map((m) => m.id)).toContain('qwen9-coder');
    });

    test('scores can be recorded without activating', async () => {
      await discover();
      await setModelStatus('qwen9-coder', 'candidate', { actor: 'reviewer', scores: { coding: 70, reasoning: 70, toolProficiency: 70 } });
      expect(getModelLifecycleStatus('qwen9-coder')).toBe('candidate');
      expect(findCanonicalModel('qwen9-coder')!.unscored).toBeUndefined();
      expect(searchGatewayLlmModels({ query: 'qwen9' }).models[0]).toMatchObject({ scored: true });
    });
  });

  describe('configuration', () => {
    test('selects adapters from LYRA_MODEL_SYNC_PROVIDERS and reports unsupported ones', () => {
      expect(getConfiguredAdapters({} as NodeJS.ProcessEnv).adapters.map((a) => a.provider)).toEqual(['openrouter']);
      const mixed = getConfiguredAdapters({ LYRA_MODEL_SYNC_PROVIDERS: 'openrouter, Bedrock,foundry,openrouter' } as unknown as NodeJS.ProcessEnv);
      expect(mixed.adapters.map((a) => a.provider)).toEqual(['openrouter']);
      expect(mixed.unsupported).toEqual(['bedrock', 'foundry']);
    });

    test('parses the accepted price changes setting', () => {
      expect(parseAcceptedPriceChanges('all')).toBe('all');
      expect(parseAcceptedPriceChanges(true)).toBe('all');
      expect(parseAcceptedPriceChanges('a:openrouter, b:openrouter')).toEqual(['a:openrouter', 'b:openrouter']);
      expect(parseAcceptedPriceChanges(['x:openrouter'])).toEqual(['x:openrouter']);
      expect(parseAcceptedPriceChanges(undefined)).toEqual([]);
    });

    test('refuses to start a second sync while one is running', async () => {
      const originalFetch = globalThis.fetch;
      const originalUrl = process.env.LYRA_OPENROUTER_MODELS_URL;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      globalThis.fetch = (async () => {
        await gate;
        return new Response(JSON.stringify({ data: currentOpenRouterListing().map(entry) }), { status: 200 });
      }) as unknown as typeof fetch;
      process.env.LYRA_OPENROUTER_MODELS_URL = 'https://openrouter.test/api/v1/models';
      try {
        const first = runConfiguredModelSync({ ...base, apply: false });
        await expect(runConfiguredModelSync({ ...base, apply: false })).rejects.toBeInstanceOf(ModelSyncBusyError);
        release();
        expect((await first).providers[0]!.ok).toBe(true);
        // The lock is released afterwards.
        release();
        expect((await runConfiguredModelSync({ ...base, apply: false })).providers[0]!.ok).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
        if (originalUrl === undefined) delete process.env.LYRA_OPENROUTER_MODELS_URL;
        else process.env.LYRA_OPENROUTER_MODELS_URL = originalUrl;
      }
    });
  });
});
