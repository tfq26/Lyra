import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { listGatewayLlmModels, parseIncludedStatuses, searchGatewayLlmModels } from './gatewayLlmProxy';
import { registerCandidateModel, setModelStatus, validateCandidateProfile } from './modelLifecycle';
import { ModelRegistryError, modelRegistry } from './modelRegistry';
import {
  allCatalogModels,
  findCanonicalModel,
  getModelLifecycleStatus,
  listCanonicalModels,
  resolveProviderRoutes,
  UNIFIED_MODEL_CATALOG,
  type CanonicalModelProfile,
} from './unifiedModelCatalog';

const candidate = (overrides: Partial<CanonicalModelProfile> = {}): CanonicalModelProfile => ({
  id: 'acme-coder-1',
  name: 'Acme Coder 1',
  family: 'qwen',
  tier: 2,
  workflowGroups: ['coding'],
  metrics: { reasoningScore: 85, codingScore: 90, toolProficiency: 85, contextWindowTokens: 200_000, avgTtftMs: 300, tokensPerSecond: 120 },
  strengths: ['Cheap coder'],
  routes: [
    {
      provider: 'openrouter',
      upstreamModelId: 'acme/coder-1',
      priority: 1,
      apiStyle: 'openai-chat',
      pricing: { inputPerMillion: 0.2, outputPerMillion: 0.8 },
      supportsPromptCaching: false,
    },
  ],
  ...overrides,
});

const ids = (models: Array<{ id: string }>) => models.map((m) => m.id);

describe('model lifecycle in the catalog', () => {
  const savedKey = process.env.OPENROUTER_API_KEY;

  beforeEach(async () => {
    await modelRegistry.reset();
    process.env.OPENROUTER_API_KEY = 'or-test-key';
  });

  afterEach(async () => {
    await modelRegistry.reset();
    if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = savedKey;
  });

  test('with an empty registry the default list is the whole seed catalog', () => {
    expect(listCanonicalModels().length).toBe(UNIFIED_MODEL_CATALOG.length);
    expect(ids(listGatewayLlmModels('standard').models).sort()).toEqual(UNIFIED_MODEL_CATALOG.map((m) => m.id).sort());
    expect(getModelLifecycleStatus('claude-sonnet-4-6')).toBe('active');
  });

  describe('legacy models', () => {
    test('are hidden from the default list and auto, but still routable and searchable', async () => {
      await setModelStatus('gpt-4o', 'legacy', { actor: 'test', supersededBy: 'gpt-5' });

      expect(ids(listCanonicalModels())).not.toContain('gpt-4o');
      expect(ids(listGatewayLlmModels('standard').models)).not.toContain('gpt-4o');
      expect(ids(listCanonicalModels({ statuses: ['active', 'legacy'] }))).toContain('gpt-4o');

      expect(findCanonicalModel('gpt-4o')?.id).toBe('gpt-4o');
      expect(findCanonicalModel('openai/gpt-4o')?.id).toBe('gpt-4o');
      expect(resolveProviderRoutes('gpt-4o', {}).length).toBeGreaterThan(0);

      const found = searchGatewayLlmModels({ query: 'gpt-4o' }).models.find((m) => m.id === 'gpt-4o');
      expect(found).toMatchObject({ status: 'legacy', supersededBy: 'gpt-5' });
    });

    test('are listed when requested with include=legacy', async () => {
      await setModelStatus('gpt-4o', 'legacy', { actor: 'test' });
      const withLegacy = listGatewayLlmModels('standard', { include: parseIncludedStatuses('legacy') });
      expect(withLegacy.models.find((m) => m.id === 'gpt-4o')?.status).toBe('legacy');
      expect(ids(withLegacy.models)).toContain('claude-sonnet-4-6');
    });

    test('changing visibility changes the catalog version so clients refresh', async () => {
      const before = listGatewayLlmModels('standard').catalogVersion;
      await setModelStatus('gpt-4o', 'legacy', { actor: 'test' });
      const after = listGatewayLlmModels('standard').catalogVersion;
      expect(after).not.toBe(before);
      await setModelStatus('gpt-4o', 'active', { actor: 'test' });
      expect(listGatewayLlmModels('standard').catalogVersion).toBe(before);
    });
  });

  describe('retired models', () => {
    test('are neither routable nor searchable once the provider removed them', async () => {
      await setModelStatus('gpt-4o', 'retired', { actor: 'test', reason: 'provider removed it' });

      expect(findCanonicalModel('gpt-4o')).toBeUndefined();
      expect(resolveProviderRoutes('gpt-4o', {})).toEqual([]);
      expect(ids(listGatewayLlmModels('standard', { include: parseIncludedStatuses('all') }).models)).not.toContain('gpt-4o');
      expect(ids(searchGatewayLlmModels({ query: 'gpt-4o', statuses: ['active', 'legacy', 'candidate', 'retired'] }).models)).not.toContain('gpt-4o');
    });

    test('can be reinstated if the provider brings the model back', async () => {
      await setModelStatus('gpt-4o', 'retired', { actor: 'test' });
      await setModelStatus('gpt-4o', 'active', { actor: 'test', reason: 'provider restored it' });
      expect(findCanonicalModel('gpt-4o')?.id).toBe('gpt-4o');
      expect(ids(listCanonicalModels())).toContain('gpt-4o');
    });
  });

  describe('candidate models', () => {
    test('can be selected by id and searched, but are never picked by auto', async () => {
      await registerCandidateModel(candidate(), { actor: 'sync' });

      expect(ids(allCatalogModels())).toContain('acme-coder-1');
      expect(getModelLifecycleStatus('acme-coder-1')).toBe('candidate');

      // Not in the default list that auto routing and clients use.
      expect(ids(listCanonicalModels())).not.toContain('acme-coder-1');
      expect(ids(listGatewayLlmModels('standard').models)).not.toContain('acme-coder-1');

      // Explicit selection works, and search finds it.
      expect(resolveProviderRoutes('acme-coder-1', { requireConfigured: true })[0]?.upstreamModelId).toBe('acme/coder-1');
      const [hit] = searchGatewayLlmModels({ query: 'acme coder' }).models;
      expect(hit).toMatchObject({ id: 'acme-coder-1', status: 'candidate', primaryProvider: 'openrouter' });
    });

    test('appear in the default list once promoted to active', async () => {
      await registerCandidateModel(candidate(), { actor: 'sync' });
      await setModelStatus('acme-coder-1', 'active', { actor: 'reviewer', reason: 'scored and approved' });
      expect(ids(listCanonicalModels())).toContain('acme-coder-1');
      expect(ids(listGatewayLlmModels('standard').models)).toContain('acme-coder-1');
    });

    test('cannot reuse a seed id or an alias', async () => {
      await expect(registerCandidateModel(candidate({ id: 'gpt-4o' }), { actor: 'sync' })).rejects.toMatchObject({ code: 'already_exists' });
      await expect(registerCandidateModel(candidate({ id: 'openai/gpt-4o' }), { actor: 'sync' })).rejects.toThrow();
    });
  });

  describe('status changes', () => {
    test('reject unknown models, unknown successors and self-succession', async () => {
      await expect(setModelStatus('no-such-model', 'legacy', { actor: 't' })).rejects.toMatchObject({ code: 'unknown_model' });
      await expect(setModelStatus('gpt-4o', 'legacy', { actor: 't', supersededBy: 'no-such-model' })).rejects.toMatchObject({ code: 'unknown_model' });
      await expect(setModelStatus('gpt-4o', 'legacy', { actor: 't', supersededBy: 'openai/gpt-4o' })).rejects.toMatchObject({ code: 'invalid_input' });
    });

    test('accept legacy ids and normalise them to the canonical id', async () => {
      const record = await setModelStatus('us.anthropic.claude-sonnet-4-6', 'legacy', { actor: 't' });
      expect(record.modelId).toBe('claude-sonnet-4-6');
      expect(getModelLifecycleStatus('us.anthropic.claude-sonnet-4-6')).toBe('legacy');
    });
  });

  describe('search', () => {
    test('matches every word against id, name, family and aliases, active models first', async () => {
      await setModelStatus('claude-sonnet-4-6', 'legacy', { actor: 't' });
      const result = searchGatewayLlmModels({ query: 'anthropic sonnet' });
      expect(result.models.length).toBeGreaterThan(1);
      const statuses = result.models.map((m) => m.status);
      expect(statuses).toEqual([...statuses].sort((a, b) => (a === 'active' ? 0 : 1) - (b === 'active' ? 0 : 1)));
      expect(ids(result.models)).toContain('claude-sonnet-4-6');
      expect(searchGatewayLlmModels({ query: 'anthropic/claude-sonnet-4.6' }).models.map((m) => m.id)).toEqual(['claude-sonnet-4-6']);
    });

    test('respects the limit, reports the total, and returns nothing in local-only mode', () => {
      const result = searchGatewayLlmModels({ query: '', limit: 5 });
      expect(result.models).toHaveLength(5);
      expect(result.total).toBeGreaterThan(5);
      expect(searchGatewayLlmModels({ query: 'claude', privacyMode: 'local-only' })).toMatchObject({ total: 0, models: [] });
    });

    test('hides models that would break zdr privacy mode', async () => {
      const zdrIds = ids(searchGatewayLlmModels({ query: 'muse', privacyMode: 'zdr' }).models);
      const standardIds = ids(searchGatewayLlmModels({ query: 'muse', privacyMode: 'standard' }).models);
      expect(standardIds).toContain('muse-spark-1.3');
      expect(zdrIds).not.toContain('muse-spark-1.3');
    });
  });
});

describe('parseIncludedStatuses', () => {
  test('parses lists and never exposes retired', () => {
    expect(parseIncludedStatuses(null)).toBeUndefined();
    expect(parseIncludedStatuses('')).toBeUndefined();
    expect(parseIncludedStatuses('bogus')).toBeUndefined();
    expect(parseIncludedStatuses('all')).toEqual(['active', 'legacy', 'candidate']);
    expect(parseIncludedStatuses('legacy')).toEqual(['active', 'legacy']);
    expect(parseIncludedStatuses('candidate, legacy')).toEqual(['active', 'candidate', 'legacy']);
    expect(parseIncludedStatuses('retired')).toBeUndefined();
    expect(parseIncludedStatuses('legacy', true)).toEqual(['legacy']);
  });
});

describe('validateCandidateProfile', () => {
  const invalid = (patch: Partial<CanonicalModelProfile> | ((p: CanonicalModelProfile) => void), message: RegExp) => {
    const p = candidate();
    if (typeof patch === 'function') patch(p);
    else Object.assign(p, patch);
    expect(() => validateCandidateProfile(p)).toThrow(message);
  };

  test('accepts a well-formed profile and drops unknown properties', () => {
    const dirty = { ...candidate(), injected: '<script>alert(1)</script>' } as unknown as CanonicalModelProfile;
    const clean = validateCandidateProfile(dirty);
    expect(clean).not.toHaveProperty('injected');
    expect(clean.id).toBe('acme-coder-1');
  });

  test('rejects bad ids, families and routes', () => {
    invalid({ id: 'has space' }, /Model id/);
    invalid({ id: '../etc/passwd' }, /Model id/);
    invalid({ name: '   ' }, /name is required/);
    invalid({ family: 'not-a-family' as any }, /family/);
    invalid({ routes: [] }, /1-6 provider routes/);
    invalid((p) => ((p.routes[0] as any).provider = 'evil'), /unknown provider/);
    invalid((p) => ((p.routes[0] as any).apiStyle = 'soap'), /apiStyle/);
  });

  test('rejects out-of-range numbers', () => {
    invalid((p) => (p.routes[0]!.pricing.inputPerMillion = -1), /input price/);
    invalid((p) => (p.routes[0]!.pricing.outputPerMillion = Number.NaN), /output price/);
    invalid((p) => (p.metrics.codingScore = 150), /codingScore/);
    invalid({ tier: 9 as any }, /tier/);
  });

  test('strips control characters from provider-supplied text', () => {
    const p = candidate({ name: 'Acme\u0000 Coder\n1', strengths: ['good\u0007 at code'] });
    const clean = validateCandidateProfile(p);
    expect(clean.name).toBe('Acme  Coder 1');
    expect(clean.strengths).toEqual(['good  at code']);
  });

  test('raises ModelRegistryError so callers can map it to a 400', () => {
    expect(() => validateCandidateProfile(candidate({ id: 'bad id' }))).toThrow(ModelRegistryError);
  });
});
