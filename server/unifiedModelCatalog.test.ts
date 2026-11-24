import { afterEach, describe, expect, test } from 'bun:test';
import {
  buildFoundryOpenAiBaseUrl,
  clearProviderRouteCooldowns,
  findCanonicalModel,
  markProviderRouteCooldown,
  normalizeCanonicalModelId,
  resolveProviderRoutes,
  reviewPatchAcrossProviders,
} from './unifiedModelCatalog';
import { enforcePrivacyPolicy, listGatewayLlmModels } from './gatewayLlmProxy';
import { buildExecutionSandboxPolicy, wrapCommandWithMxcSandbox } from './security';
import { triageExecutionLaneWithDecisionModel } from './intentTriage';

describe('Unified Canonical Model Catalog & Capacity Router', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    clearProviderRouteCooldowns();
    process.env = { ...originalEnv };
  });

  test('normalizes legacy Bedrock and OpenRouter IDs to canonical model IDs', () => {
    expect(normalizeCanonicalModelId('us.anthropic.claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
    expect(normalizeCanonicalModelId('anthropic/claude-sonnet-4.6')).toBe('claude-sonnet-4-6');
    expect(normalizeCanonicalModelId('us.amazon.nova-2-lite-v1:0')).toBe('nova-2-lite');
    expect(findCanonicalModel('DeepSeek-V4-Pro')?.id).toBe('deepseek-v4-pro');
  });

  test('listGatewayLlmModels returns deduplicated canonical models with provider list', () => {
    const { models } = listGatewayLlmModels('standard');
    const ids = models.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('claude-sonnet-4-6');
    expect(ids).toContain('mai-code-2');
    expect(ids).toContain('microsoft-decision-1.1');

    const sonnet = models.find((m) => m.id === 'claude-sonnet-4-6');
    expect(sonnet?.providers).toEqual(['bedrock', 'openrouter']);
  });

  test('listGatewayLlmModels exposes pricing, scores, workflows and legacy aliases for clients', () => {
    const { models } = listGatewayLlmModels('standard');
    const sonnet = models.find((m) => m.id === 'claude-sonnet-4-6')!;

    expect(sonnet.primaryProvider).toBe('bedrock');
    expect(sonnet.pricing?.inputPerMillion).toBeGreaterThan(0);
    expect(sonnet.pricing?.outputPerMillion).toBeGreaterThanOrEqual(sonnet.pricing!.inputPerMillion);
    expect(sonnet.aliases).toContain('us.anthropic.claude-sonnet-4-6');
    expect(sonnet.aliases).toContain('anthropic/claude-sonnet-4.6');
    expect(Array.isArray(sonnet.workflowGroups)).toBe(true);

    for (const m of models) {
      for (const score of Object.values(m.scores)) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
    }
    // The fastest model in the catalog defines the top of the speed scale.
    expect(Math.max(...models.map((m) => m.scores.speed))).toBe(100);
  });

  test('every alias served to clients resolves back to its canonical model', () => {
    for (const m of listGatewayLlmModels('standard').models) {
      for (const alias of m.aliases) {
        expect(findCanonicalModel(alias)?.id).toBe(m.id);
      }
    }
  });

  test('zdr mode drops contributor-warning models and prices only compliant routes', () => {
    const standard = listGatewayLlmModels('standard');
    const zdr = listGatewayLlmModels('zdr');
    expect(zdr.models.length).toBeLessThanOrEqual(standard.models.length);
    expect(zdr.models.every((m) => m.zdrCompliant)).toBe(true);
  });

  describe('OpenRouter models migrated from Gram', () => {
    const migrated: Array<[legacyId: string, canonicalId: string]> = [
      ['deepseek/deepseek-v4.1-flash', 'deepseek-v4.1-flash'],
      ['qwen/qwen3-coder-flash', 'qwen3-coder-flash'],
      ['mistralai/mistral-large-4-0', 'mistral-large-4'],
      ['x-ai/grok-4.20', 'grok-4.20'],
      ['meta/muse-spark-1.3', 'muse-spark-1.3'],
    ];

    test('Gram legacy ids resolve to the new canonical models', () => {
      for (const [legacyId, canonicalId] of migrated) {
        expect(normalizeCanonicalModelId(legacyId)).toBe(canonicalId);
        expect(findCanonicalModel(legacyId)?.routes.map((r) => r.provider)).toEqual(['openrouter']);
      }
    });

    test('routes only resolve when OpenRouter is configured', () => {
      delete process.env.OPENROUTER_API_KEY;
      expect(resolveProviderRoutes('grok-4.20', { requireConfigured: true })).toEqual([]);

      process.env.OPENROUTER_API_KEY = 'or-test-key';
      const routes = resolveProviderRoutes('x-ai/grok-4.20', { requireConfigured: true });
      expect(routes.map((r) => r.provider)).toEqual(['openrouter']);
      expect(routes[0]?.upstreamModelId).toBe('x-ai/grok-4.20');
    });

    test('muse-spark-1.3 is hidden in zdr mode; the other four stay available', () => {
      const standardIds = listGatewayLlmModels('standard').models.map((m) => m.id);
      const zdrIds = listGatewayLlmModels('zdr').models.map((m) => m.id);
      expect(standardIds).toContain('muse-spark-1.3');
      expect(zdrIds).not.toContain('muse-spark-1.3');
      for (const id of ['deepseek-v4.1-flash', 'qwen3-coder-flash', 'mistral-large-4', 'grok-4.20']) {
        expect(zdrIds).toContain(id);
      }
      const spark = listGatewayLlmModels('standard').models.find((m) => m.id === 'muse-spark-1.3');
      expect(spark?.zdrCompliant).toBe(false);
      expect(spark?.contributorWarning).toContain('Contributor');
    });

    test('deepseek-v4.1-flash has the lowest input price in the catalog', () => {
      const byInputPrice = listGatewayLlmModels('standard')
        .models.slice()
        .sort((a, b) => (a.pricing?.inputPerMillion ?? Infinity) - (b.pricing?.inputPerMillion ?? Infinity));
      expect(byInputPrice[0]?.id).toBe('deepseek-v4.1-flash');
    });
  });

  test('local-only mode serves an empty catalog', () => {
    const result = listGatewayLlmModels('local-only');
    expect(result.models).toEqual([]);
    expect(result.catalogVersion).toMatch(/^[0-9a-f]{16}$/);
  });

  test('catalogVersion is stable for identical catalogs and changes with privacy mode content', () => {
    const a = listGatewayLlmModels('standard');
    const b = listGatewayLlmModels('standard');
    expect(a.catalogVersion).toBe(b.catalogVersion);
    expect(a.catalogVersion).toMatch(/^[0-9a-f]{16}$/);
    expect(a.catalogVersion).not.toBe(listGatewayLlmModels('local-only').catalogVersion);
  });

  test('routes to healthy configured providers and demotes capacity-limited routes', () => {
    process.env.AZURE_FOUNDRY_ENDPOINT = 'https://my-foundry.services.ai.azure.com';
    process.env.AZURE_FOUNDRY_API_KEY = 'foundry-test-key';
    process.env.OPENROUTER_API_KEY = 'or-test-key';

    const initial = resolveProviderRoutes('gpt-5', { requireConfigured: true });
    expect(initial.map((r) => r.provider)).toEqual(['foundry', 'openrouter']);
    expect(initial[0]?.inCooldown).toBe(false);

    markProviderRouteCooldown('gpt-5', 'foundry', 60_000);
    const afterThrottle = resolveProviderRoutes('gpt-5', { requireConfigured: true });
    expect(afterThrottle.map((r) => r.provider)).toEqual(['openrouter', 'foundry']);
    expect(afterThrottle[0]?.inCooldown).toBe(false);
    expect(afterThrottle[1]?.inCooldown).toBe(true);
  });

  test('buildFoundryOpenAiBaseUrl normalizes Foundry endpoints', () => {
    expect(buildFoundryOpenAiBaseUrl('https://demo.services.ai.azure.com/')).toBe(
      'https://demo.services.ai.azure.com/openai/v1'
    );
    expect(buildFoundryOpenAiBaseUrl('https://demo.services.ai.azure.com/openai/v1')).toBe(
      'https://demo.services.ai.azure.com/openai/v1'
    );
  });

  test('enforcePrivacyPolicy blocks foundry in local-only mode but allows in zdr', () => {
    expect(() =>
      enforcePrivacyPolicy({
        privacyMode: 'local-only',
        provider: 'foundry',
        modelId: 'mai-code-2',
      })
    ).toThrow(/local-only/);

    expect(() =>
      enforcePrivacyPolicy({
        privacyMode: 'zdr',
        provider: 'foundry',
        modelId: 'mai-code-2',
      })
    ).not.toThrow();
  });

  test('buildExecutionSandboxPolicy locks writes to workspace and denies secret dirs', () => {
    const policy = buildExecutionSandboxPolicy('/tmp/lyra-ws', { allowNetwork: false });
    expect(policy.runtime).toBe('mxc');
    expect(policy.filesystem.readWrite).toContain('/tmp/lyra-ws');
    expect(policy.filesystem.deny.some((p) => p.endsWith('.aws'))).toBe(true);
    expect(policy.filesystem.deny.some((p) => p.endsWith('.ssh'))).toBe(true);
    expect(policy.network.mode).toBe('deny');
  });

  test('triageExecutionLaneWithDecisionModel falls back cleanly when no decision provider is configured', async () => {
    delete process.env.AZURE_FOUNDRY_ENDPOINT;
    delete process.env.AZURE_FOUNDRY_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    process.env.LYRA_DISABLE_BEDROCK = 'true';
    const res = await triageExecutionLaneWithDecisionModel({
      prompt: 'Update the retry logic in gatewayLlmProxy.ts',
    });
    expect(res.lane).toBe('fast-patch');
    expect(res.decisionModelUsed).toBeUndefined();
  });

  test('wrapCommandWithMxcSandbox passes through cleanly when not sandboxed', () => {
    const wrapped = wrapCommandWithMxcSandbox('bun', ['test'], '/tmp/lyra-ws', {
      executionMode: 'safe',
    });
    expect(wrapped.bin).toBe('bun');
    expect(wrapped.args).toEqual(['test']);
    wrapped.cleanup();
  });

  test('reviewPatchAcrossProviders returns heuristic approval when no providers are configured', async () => {
    delete process.env.AZURE_FOUNDRY_ENDPOINT;
    delete process.env.AZURE_FOUNDRY_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    process.env.LYRA_DISABLE_BEDROCK = 'true';
    const res = await reviewPatchAcrossProviders({
      patchDiff: '+ const x = 1;',
      taskSummary: 'Add x',
    });
    expect(res.approved).toBe(true);
    expect(res.reviewerProvider).toBe('heuristic');
  });
});
