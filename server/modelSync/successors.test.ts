import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { listGatewayLlmModels, searchGatewayLlmModels } from '../gatewayLlmProxy';
import { activateModel, registerCandidateModel, setModelStatus } from '../modelLifecycle';
import { modelRegistry } from '../modelRegistry';
import { findCanonicalModel, getModelLifecycleStatus, listCanonicalModels, type CanonicalModelProfile } from '../unifiedModelCatalog';
import { createOpenRouterAdapter, runModelSync, type SyncOptions } from './index';
import { compareVersions, findSupersessions, olderVersionsOf, parseModelVersion, priceOf, qualityOf, replaces } from './successors';

function profile(id: string, opts: { family?: CanonicalModelProfile['family']; input?: number; output?: number; quality?: number; unscored?: boolean } = {}): CanonicalModelProfile {
  const q = opts.quality ?? 90;
  return {
    id,
    name: id,
    family: opts.family ?? 'openai',
    tier: 2,
    metrics: { reasoningScore: q, codingScore: q, toolProficiency: q, contextWindowTokens: 128_000, avgTtftMs: 300, tokensPerSecond: 100 },
    strengths: [],
    routes: [
      {
        provider: 'openrouter',
        upstreamModelId: `vendor/${id}`,
        priority: 1,
        apiStyle: 'openai-chat',
        pricing: { inputPerMillion: opts.input ?? 1, outputPerMillion: opts.output ?? 4 },
        supportsPromptCaching: false,
      },
    ],
    ...(opts.unscored ? { unscored: true } : {}),
  };
}

describe('parseModelVersion', () => {
  test('separates the version numbers from the series', () => {
    expect(parseModelVersion('gpt-6.2-astra')).toEqual({ series: 'gpt-astra', version: [6, 2] });
    expect(parseModelVersion('claude-sonnet-4-6')).toEqual({ series: 'claude-sonnet', version: [4, 6] });
    expect(parseModelVersion('deepseek-v4.1-flash')).toEqual({ series: 'deepseek-flash', version: [4, 1] });
    expect(parseModelVersion('grok-4.20')).toEqual({ series: 'grok', version: [4, 20] });
    expect(parseModelVersion('mistral-large-4')).toEqual({ series: 'mistral-large', version: [4] });
  });

  test('ids without a clean version have none, so they are never compared', () => {
    expect(parseModelVersion('nova-lite')).toBeNull();
    expect(parseModelVersion('gpt-4o')).toBeNull(); // "4o" is not a version number
    expect(parseModelVersion('qwen3-coder-next')).toBeNull();
    expect(parseModelVersion('6.2')).toBeNull();
  });

  test('variant words stay in the series, so a "pro" model is a different line', () => {
    expect(parseModelVersion('gpt-6.3-astra-pro')!.series).toBe('gpt-astra-pro');
    expect(parseModelVersion('gpt-6.3-astra-pro')!.series).not.toBe(parseModelVersion('gpt-6.2-astra')!.series);
  });
});

describe('compareVersions', () => {
  test('compares segment by segment and treats a missing segment as zero', () => {
    expect(compareVersions([6, 3], [6, 2])).toBeGreaterThan(0);
    expect(compareVersions([5, 5], [4, 6])).toBeGreaterThan(0);
    expect(compareVersions([4, 20], [4, 7])).toBeGreaterThan(0);
    expect(compareVersions([6], [6, 0])).toBe(0);
    expect(compareVersions([6], [6, 1])).toBeLessThan(0);
  });
});

describe('replaces', () => {
  const older = profile('gpt-6.2-astra', { input: 2, output: 12, quality: 98 });

  test('a newer model that is as good and not pricier replaces the older one', () => {
    expect(replaces(profile('gpt-6.3-astra', { input: 2, output: 12, quality: 98 }), older)).toBe(true);
    expect(replaces(profile('gpt-6.3-astra', { input: 1.5, output: 9, quality: 99 }), older)).toBe(true);
  });

  test('a better but pricier model does not: the older one is still the cheaper option', () => {
    expect(replaces(profile('gpt-6.3-astra', { input: 4, output: 24, quality: 99 }), older)).toBe(false);
  });

  test('a cheaper but weaker model does not either', () => {
    expect(replaces(profile('gpt-6.3-astra', { input: 1, output: 6, quality: 94 }), older)).toBe(false);
  });

  test('tolerates rounding noise on price and quality', () => {
    expect(replaces(profile('gpt-6.3-astra', { input: 2.05, output: 12.3, quality: 97.7 }), older)).toBe(true);
  });

  test('an unscored model never replaces anything', () => {
    expect(replaces(profile('gpt-6.3-astra', { input: 0.1, output: 0.1, quality: 0, unscored: true }), older)).toBe(false);
  });

  test('exposes the scores it compares', () => {
    expect(qualityOf(older)).toBeCloseTo(98);
    expect(priceOf(older)).toBeCloseTo(4.5);
  });
});

describe('olderVersionsOf and findSupersessions', () => {
  const catalog = [
    profile('gpt-6.1-astra', { quality: 95, input: 3, output: 15 }),
    profile('gpt-6.2-astra', { quality: 98, input: 2, output: 12 }),
    profile('gpt-6.3-astra', { quality: 98, input: 2, output: 12 }),
    profile('gpt-6.3-astra-pro', { quality: 99, input: 8, output: 40 }),
    profile('gpt-6.2-sol', { quality: 94, input: 1, output: 4 }),
    profile('gpt-5.6-sol', { quality: 95, input: 2, output: 8 }),
    profile('claude-sonnet-5-5', { family: 'anthropic', quality: 97 }),
    profile('claude-sonnet-4-6', { family: 'anthropic', quality: 96 }),
    profile('gpt-4o'),
  ];

  test('older versions of a model are those in the same family and series with a lower version, newest first', () => {
    const newest = catalog.find((m) => m.id === 'gpt-6.3-astra')!;
    expect(olderVersionsOf(newest, catalog).map((m) => m.id)).toEqual(['gpt-6.2-astra', 'gpt-6.1-astra']);
    expect(olderVersionsOf(catalog.find((m) => m.id === 'gpt-4o')!, catalog)).toEqual([]);
  });

  test('a chain points at the newest version that replaces each model', () => {
    const found = findSupersessions(catalog);
    expect(found).toContainEqual({ modelId: 'gpt-6.1-astra', supersededBy: 'gpt-6.3-astra' });
    expect(found).toContainEqual({ modelId: 'gpt-6.2-astra', supersededBy: 'gpt-6.3-astra' });
  });

  test('leaves alone a newer model that is not a replacement, other series, and other families', () => {
    const ids = findSupersessions(catalog).map((s) => s.modelId);
    expect(ids).not.toContain('gpt-6.3-astra'); // the newest
    expect(ids).not.toContain('gpt-6.3-astra-pro'); // a different line
    expect(ids).not.toContain('gpt-6.2-sol'); // 5.6 is better but this one is cheaper and newer: nothing replaces it
    expect(ids).not.toContain('gpt-5.6-sol'); // 6.2 is cheaper but weaker
    expect(ids).toContain('claude-sonnet-4-6');
    expect(ids).not.toContain('claude-sonnet-5-5');
  });
});

describe('older versions leave the default list (registry integration)', () => {
  beforeEach(async () => {
    await modelRegistry.reset();
  });
  afterEach(async () => {
    await modelRegistry.reset();
  });

  const NOW = new Date('2026-11-24T00:00:00Z');
  const base: Partial<SyncOptions> = { now: NOW, minListingSize: 1, apply: true, actor: 'test' };
  const listing = () =>
    createOpenRouterAdapter({
      fetchImpl: (async () =>
        new Response(JSON.stringify({ data: listCanonicalModels({ statuses: ['active', 'legacy'] }).flatMap((m) => m.routes.filter((r) => r.provider === 'openrouter').map((r) => ({
          id: r.upstreamModelId,
          name: r.upstreamModelId,
          created: Math.floor(NOW.getTime() / 1000) - 864000,
          context_length: 128000,
          architecture: { output_modalities: ['text'] },
          pricing: { prompt: String(r.pricing.inputPerMillion / 1e6), completion: String(r.pricing.outputPerMillion / 1e6) },
          supported_parameters: ['tools'],
        }))) }))) as unknown as typeof fetch,
    });

  test('a sync moves replaced models to legacy with their successor recorded, and they stay usable and searchable', async () => {
    const report = await runModelSync([listing()], base);

    const moved = report.supersessions.filter((s) => s.action === 'legacy').map((s) => `${s.modelId}->${s.supersededBy}`);
    expect(moved).toContain('claude-sonnet-4-6->claude-sonnet-5-5');
    expect(getModelLifecycleStatus('claude-sonnet-4-6')).toBe('legacy');
    expect(modelRegistry.getRecord('claude-sonnet-4-6')?.supersededBy).toBe('claude-sonnet-5-5');
    expect(listGatewayLlmModels('standard').models.map((m) => m.id)).not.toContain('claude-sonnet-4-6');
    expect(listGatewayLlmModels('standard').models.map((m) => m.id)).toContain('claude-sonnet-5-5');
    expect(findCanonicalModel('claude-sonnet-4-6')).toBeDefined();
    expect(searchGatewayLlmModels({ query: 'sonnet-4-6' }).models[0]).toMatchObject({ status: 'legacy', supersededBy: 'claude-sonnet-5-5' });

    const [event] = await modelRegistry.listEvents({ modelId: 'claude-sonnet-4-6' });
    expect(event!.reason).toContain('Replaced by claude-sonnet-5-5');
  });

  test('a dry run reports the same moves and changes nothing', async () => {
    const report = await runModelSync([listing()], { ...base, apply: false });
    expect(report.supersessions.some((s) => s.action === 'would-legacy')).toBe(true);
    expect(getModelLifecycleStatus('claude-sonnet-4-6')).toBe('active');
    expect(modelRegistry.listRecords()).toEqual([]);
  });

  test('can be switched off, and is capped per run', async () => {
    const off = await runModelSync([listing()], { ...base, supersede: false });
    expect(off.supersessions).toEqual([]);
    expect(getModelLifecycleStatus('claude-sonnet-4-6')).toBe('active');

    const capped = await runModelSync([listing()], { ...base, maxLegacyPerRun: 1 });
    expect(capped.supersessions.filter((s) => s.action === 'legacy')).toHaveLength(1);
    expect(capped.supersessions.filter((s) => s.action === 'blocked').length).toBeGreaterThan(0);
  });

  test('does nothing when no provider listing was usable', async () => {
    const failing = createOpenRouterAdapter({ fetchImpl: (async () => new Response('', { status: 500 })) as unknown as typeof fetch });
    const report = await runModelSync([failing], base);
    expect(report.supersessions).toEqual([]);
    expect(modelRegistry.listRecords()).toEqual([]);
  });

  test('a discovered newer version is reported as a likely successor of the older one', async () => {
    const adapter = createOpenRouterAdapter({
      fetchImpl: (async () =>
        new Response(JSON.stringify({ data: [{
          id: 'anthropic/claude-sonnet-5.6',
          name: 'Anthropic: Claude Sonnet 5.6',
          created: Math.floor(NOW.getTime() / 1000) - 86400,
          context_length: 200000,
          architecture: { output_modalities: ['text'] },
          pricing: { prompt: '0.000003', completion: '0.000015' },
          supported_parameters: ['tools'],
        }] }))) as unknown as typeof fetch,
    });
    const report = await runModelSync([adapter], { ...base, apply: false });
    expect(report.providers[0]!.newCandidates[0]).toMatchObject({ id: 'claude-sonnet-5.6', likelySuccessorOf: expect.arrayContaining(['claude-sonnet-5-5']) });
  });

  describe('activating a scored candidate', () => {
    const candidate = (id: string) => ({ ...profile(id, { family: 'anthropic', input: 3, output: 15, quality: 0 }), unscored: true as const });

    test('retires the older version when the new one is as good and not pricier', async () => {
      await registerCandidateModel(candidate('claude-sonnet-6-0'), { actor: 'sync' });
      const result = await activateModel('claude-sonnet-6-0', {
        actor: 'reviewer',
        scores: { coding: 99, reasoning: 98, toolProficiency: 98 },
        zdrVerified: true,
      });
      expect(result.superseded).toContainEqual({ modelId: 'claude-sonnet-5-5', supersededBy: 'claude-sonnet-6-0' });
      expect(getModelLifecycleStatus('claude-sonnet-5-5')).toBe('legacy');
      expect(getModelLifecycleStatus('claude-sonnet-6-0')).toBe('active');
    });

    test('leaves the older version active when the new one is pricier, and says why', async () => {
      const pricey = { ...candidate('claude-sonnet-6-0'), routes: [{ ...candidate('x').routes[0]!, pricing: { inputPerMillion: 9, outputPerMillion: 45 } }] };
      await registerCandidate(pricey);
      const result = await activateModel('claude-sonnet-6-0', { actor: 'reviewer', scores: { coding: 99, reasoning: 99, toolProficiency: 99 } });
      expect(result.superseded).toEqual([]);
      expect(result.kept.find((k) => k.modelId === 'claude-sonnet-5-5')!.reason).toContain('pricier or less capable');
      expect(getModelLifecycleStatus('claude-sonnet-5-5')).toBe('active');
    });

    test('keepOlderVersions skips the replacement entirely', async () => {
      await registerCandidateModel(candidate('claude-sonnet-6-0'), { actor: 'sync' });
      const result = await activateModel('claude-sonnet-6-0', {
        actor: 'reviewer',
        scores: { coding: 99, reasoning: 98, toolProficiency: 98 },
        keepOlderVersions: true,
      });
      expect(result.superseded).toEqual([]);
      expect(getModelLifecycleStatus('claude-sonnet-5-5')).toBe('active');
    });

    test('an unscored candidate still cannot be activated', async () => {
      await registerCandidateModel(candidate('claude-sonnet-6-0'), { actor: 'sync' });
      await expect(activateModel('claude-sonnet-6-0', { actor: 'reviewer' })).rejects.toMatchObject({ code: 'invalid_input' });
      expect(getModelLifecycleStatus('claude-sonnet-5-5')).toBe('active');
    });

    async function registerCandidate(p: CanonicalModelProfile) {
      await registerCandidateModel(p, { actor: 'sync' });
    }
  });

  test('setModelStatus alone never touches other models', async () => {
    await setModelStatus('claude-sonnet-4-6', 'legacy', { actor: 'test' });
    expect(getModelLifecycleStatus('claude-sonnet-5-5')).toBe('active');
  });
});
