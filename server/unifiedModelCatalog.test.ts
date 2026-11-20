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
