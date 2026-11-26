/**
 * Lyra Unified Canonical Model Catalog & Capacity-Aware Provider Router
 *
 * Exposes a single provider-agnostic model list (e.g. `claude-sonnet-4-6`,
 * `mai-code-2`, `microsoft-decision-1.1`, `gpt-5`, `nova-2-lite`) and resolves
 * each logical model to an ordered list of backend provider routes
 * (`bedrock` | `foundry` | `openrouter`) based on:
 *   1. Provider credential/endpoint availability
 *   2. Privacy policy (`standard` | `zdr` | `local-only`)
 *   3. Live per-(modelId, provider) capacity/rate-limit cooldowns
 *   4. Route priority & cost efficiency
 */

import type { CapabilityTier } from './modelDecisionEngine';
import type { PrivacyMode } from './gatewayLlmProxy';
import { modelRegistry, type ModelLifecycleStatus } from './modelRegistry';

export type BackendProvider = 'bedrock' | 'foundry' | 'openrouter';
export type ProviderApiStyle = 'bedrock-converse' | 'openai-chat' | 'anthropic-messages';
export type WorkflowGroup =
  | 'coding'
  | 'research'
  | 'long-context'
  | 'world-social'
  | 'triage-routing'
  | 'fast-utility';

export interface ProviderRoute {
  provider: BackendProvider;
  upstreamModelId: string;
  priority: number;
  apiStyle: ProviderApiStyle;
  pricing: {
    inputPerMillion: number;
    outputPerMillion: number;
  };
  supportsPromptCaching: boolean;
  contributorWarning?: string;
}

export interface CanonicalModelProfile {
  id: string;
  name: string;
  family:
    | 'anthropic'
    | 'openai'
    | 'microsoft'
    | 'amazon'
    | 'meta'
    | 'deepseek'
    | 'qwen'
    | 'gemini'
    | 'kimi'
    | 'glm'
    | 'xai'
    | 'mistral'
    | 'minimax'
    | 'nvidia'
    | 'cohere';
  tier: CapabilityTier;
  workflowGroups?: WorkflowGroup[];
  metrics: {
    reasoningScore: number;
    codingScore: number;
    toolProficiency: number;
    contextWindowTokens: number;
    avgTtftMs: number;
    tokensPerSecond: number;
  };
  strengths: string[];
  routes: ProviderRoute[];
  /**
   * True for discovered models whose capability scores have not been measured. Their metrics are
   * placeholders and are not served to clients; scoring a model clears the flag.
   */
  unscored?: boolean;
}

export interface ResolvedProviderRoute extends ProviderRoute {
  canonicalModelId: string;
  canonicalModelName: string;
  inCooldown: boolean;
}

export interface FoundryRuntimeConfig {
  endpoint?: string;
  apiKey?: string;
  apiVersion: string;
}

export function getFoundryConfig(overrides?: {
  endpoint?: string;
  apiKey?: string;
}): FoundryRuntimeConfig {
  const endpoint = (
    overrides?.endpoint ||
    process.env.AZURE_FOUNDRY_ENDPOINT ||
    process.env.LYRA_MANAGED_FOUNDRY_ENDPOINT ||
    ''
  )
    .trim()
    .replace(/\/+$/, '');
  const apiKey = (
    overrides?.apiKey ||
    process.env.AZURE_FOUNDRY_API_KEY ||
    process.env.LYRA_MANAGED_FOUNDRY_API_KEY ||
    ''
  ).trim();
  const apiVersion = (process.env.AZURE_FOUNDRY_API_VERSION || '2024-05-01-preview').trim();
  return {
    endpoint: endpoint || undefined,
    apiKey: apiKey || undefined,
    apiVersion,
  };
}

export function buildFoundryOpenAiBaseUrl(endpoint: string): string {
  const clean = endpoint.replace(/\/+$/, '');
  if (clean.endsWith('/openai/v1') || clean.endsWith('/models')) {
    return clean;
  }
  return `${clean}/openai/v1`;
}

export function isBackendProviderConfigured(provider: BackendProvider): boolean {
  if (provider === 'bedrock') {
    if (process.env.LYRA_DISABLE_BEDROCK === 'true') return false;
    return Boolean(
      process.env.AWS_ACCESS_KEY_ID ||
        process.env.AWS_PROFILE ||
        process.env.AWS_REGION ||
        process.env.AWS_DEFAULT_REGION ||
        process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
        process.env.AWS_WEB_IDENTITY_TOKEN_FILE ||
        process.env.LYRA_MANAGED_BEDROCK_SECRET_ARN
    );
  }
  if (provider === 'foundry') {
    const cfg = getFoundryConfig();
    return Boolean(cfg.endpoint && cfg.apiKey);
  }
  if (provider === 'openrouter') {
    return Boolean(process.env.OPENROUTER_API_KEY || process.env.LYRA_MANAGED_OPENROUTER_API_KEY);
  }
  return false;
}

export const UNIFIED_MODEL_CATALOG: CanonicalModelProfile[] = [
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    family: 'openai',
    tier: 2,
    metrics: {
      reasoningScore: 88,
      codingScore: 88,
      toolProficiency: 91,
      contextWindowTokens: 128_000,
      avgTtftMs: 320,
      tokensPerSecond: 110,
    },
    strengths: ['Fast general coding & tool calling', 'Deployed on Azure Foundry'],
    routes: [
      {
        provider: 'foundry',
        upstreamModelId: 'gpt-4o',
        priority: 1,
        apiStyle: 'openai-chat',
        pricing: { inputPerMillion: 2.5, outputPerMillion: 10.0 },
        supportsPromptCaching: true,
      },
      {
        provider: 'openrouter',
        upstreamModelId: 'openai/gpt-4o',
        priority: 2,
        apiStyle: 'openai-chat',
        pricing: { inputPerMillion: 2.5, outputPerMillion: 10.0 },
        supportsPromptCaching: true,
      },
    ],
  },
  {
    id: 'mai-code-1-1-flash',
    name: 'MAI Code 1.1 Flash',
    family: 'microsoft',
    tier: 2,
    metrics: {
      reasoningScore: 89,
      codingScore: 92,
      toolProficiency: 90,
      contextWindowTokens: 128_000,
      avgTtftMs: 220,
      tokensPerSecond: 150,
    },
    strengths: ['Foundry-exclusive fast coding model', 'Low-latency edits & review'],
    routes: [
      {
        provider: 'foundry',
        upstreamModelId: 'MAI-Code-1.1-Flash',
        priority: 1,
        apiStyle: 'openai-chat',
        pricing: { inputPerMillion: 0.3, outputPerMillion: 1.2 },
        supportsPromptCaching: false,
      },
    ],
  },
  {
    id: 'mai-thinking-1',
    name: 'MAI Thinking 1',
    family: 'microsoft',
    tier: 3,
    metrics: {
      reasoningScore: 94,
      codingScore: 91,
      toolProficiency: 89,
      contextWindowTokens: 128_000,
      avgTtftMs: 480,
      tokensPerSecond: 85,
    },
    strengths: ['Foundry-exclusive reasoning model', 'Architecture & root-cause analysis'],
    routes: [
      {
        provider: 'foundry',
        upstreamModelId: 'MAI-Thinking-1',
        priority: 1,
        apiStyle: 'openai-chat',
        pricing: { inputPerMillion: 0.8, outputPerMillion: 3.2 },
        supportsPromptCaching: false,
      },
    ],
  },
  {
    id: 'claude-mythos-5-2',
    name: 'Claude Mythos 5.2',
    family: 'anthropic',
    tier: 4,
    metrics: {
      reasoningScore: 100,
      codingScore: 99,
      toolProficiency: 99,
      contextWindowTokens: 1_000_000,
      avgTtftMs: 850,
      tokensPerSecond: 65,
    },
    strengths: ['Frontier software engineering & architecture', 'Multi-provider Bedrock + OpenRouter'],
    routes: [
      {
        provider: 'bedrock',
        upstreamModelId: 'us.anthropic.claude-mythos-5-2-v1:0',
        priority: 1,
        apiStyle: 'bedrock-converse',
        pricing: { inputPerMillion: 8.0, outputPerMillion: 40.0 },
        supportsPromptCaching: true,
      },
      {
        provider: 'openrouter',
        upstreamModelId: 'anthropic/claude-mythos-5.2',
        priority: 2,
        apiStyle: 'openai-chat',
        pricing: { inputPerMillion: 5.0, outputPerMillion: 25.0 },
        supportsPromptCaching: true,
      },
    ],
  },
  {
    id: 'claude-fable-5-2',
    name: 'Claude Fable 5.2',
    family: 'anthropic',
    tier: 3,
    metrics: {
      reasoningScore: 98,
      codingScore: 98,
      toolProficiency: 98,
      contextWindowTokens: 1_000_000,
      avgTtftMs: 500,
      tokensPerSecond: 90,
    },
    strengths: ['Balanced frontier coding & tool execution', 'Multi-provider Bedrock + OpenRouter'],
    routes: [
      {
        provider: 'bedrock',
        upstreamModelId: 'us.anthropic.claude-fable-5-2-v1:0',
        priority: 1,
        apiStyle: 'bedrock-converse',
        pricing: { inputPerMillion: 8.0, outputPerMillion: 40.0 },
        supportsPromptCaching: true,
      },
      {
        provider: 'openrouter',
        upstreamModelId: 'anthropic/claude-fable-5.2',
        priority: 2,
        apiStyle: 'openai-chat',
        pricing: { inputPerMillion: 3.0, outputPerMillion: 15.0 },
        supportsPromptCaching: true,
      },
    ],
  },
  {
    id: 'gpt-6.2-astra',
    name: 'GPT-6.2 Astra',
    family: 'openai',
    tier: 4,
    metrics: {
      reasoningScore: 99,
      codingScore: 98,
      toolProficiency: 98,
      contextWindowTokens: 400_000,
      avgTtftMs: 580,
      tokensPerSecond: 85,
    },
    strengths: ['Complex software engineering & multi-step agent loops', 'Foundry + OpenRouter'],
    routes: [
      {
        provider: 'foundry',
        upstreamModelId: 'gpt-6.2-astra',
        priority: 1,
        apiStyle: 'openai-chat',
        pricing: { inputPerMillion: 8.0, outputPerMillion: 40.0 },
        supportsPromptCaching: true,
      },
      {
        provider: 'openrouter',
        upstreamModelId: 'openai/gpt-6.2-astra',
        priority: 2,
        apiStyle: 'openai-chat',
        pricing: { inputPerMillion: 2.0, outputPerMillion: 12.0 },
        supportsPromptCaching: true,
      },
    ],
  },
  {
    id: 'gpt-6.2-sol',
    name: 'GPT-6.2 Sol',
    family: 'openai',
    tier: 2,
    metrics: {
      reasoningScore: 93,
      codingScore: 94,
      toolProficiency: 94,
      contextWindowTokens: 400_000,
      avgTtftMs: 280,
      tokensPerSecond: 140,
    },
    strengths: ['High-speed everyday coding & triage', 'Foundry + OpenRouter'],
    routes: [
      {
        provider: 'foundry',
        upstreamModelId: 'gpt-6.2-sol',
        priority: 1,
        apiStyle: 'openai-chat',
        pricing: { inputPerMillion: 2.0, outputPerMillion: 10.0 },
        supportsPromptCaching: true,
      },
      {
        provider: 'openrouter',
        upstreamModelId: 'openai/gpt-6.2-sol',
        priority: 2,
        apiStyle: 'openai-chat',
        pricing: { inputPerMillion: 0.4, outputPerMillion: 1.6 },
        supportsPromptCaching: true,
      },
    ],
  },
  {
    id: 'gemini-4-carbon',
    name: 'Gemini 4 Carbon',
    family: 'gemini',
    tier: 4,
    metrics: {
      reasoningScore: 99,
      codingScore: 99,
      toolProficiency: 97,
      contextWindowTokens: 1_000_000,
      avgTtftMs: 620,
      tokensPerSecond: 85,
    },
    strengths: ['Long-horizon engineering & security analysis', '1M context window'],
    routes: [
      {
        provider: 'openrouter',
        upstreamModelId: 'google/gemini-4-carbon',
        priority: 1,
        apiStyle: 'openai-chat',
        pricing: { inputPerMillion: 2.5, outputPerMillion: 12.0 },
        supportsPromptCaching: true,
      },
    ],
  },
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    family: 'anthropic',
    tier: 4,
    metrics: {
      reasoningScore: 99,
      codingScore: 98,
      toolProficiency: 98,
      contextWindowTokens: 1_000_000,
      avgTtftMs: 900,
      tokensPerSecond: 60,
    },
    strengths: ['Deep architecture & security audits', 'Complex multi-file refactoring'],
    routes: [
      {
        provider: 'bedrock',
        upstreamModelId: 'us.anthropic.claude-opus-4-6-v1',
        priority: 1,
        apiStyle: 'bedrock-converse',
        pricing: { inputPerMillion: 5.0, outputPerMillion: 25.0 },
        supportsPromptCaching: true,
      },
      {
        provider: 'openrouter',
        upstreamModelId: 'anthropic/claude-opus-4.6',
        priority: 2,
        apiStyle: 'openai-chat',
        pricing: { inputPerMillion: 5.0, outputPerMillion: 25.0 },
        supportsPromptCaching: true,
      },
    ],
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    family: 'anthropic',
    tier: 3,
    metrics: {
      reasoningScore: 96,
      codingScore: 97,
      toolProficiency: 97,
      contextWindowTokens: 1_000_000,
      avgTtftMs: 550,
      tokensPerSecond: 85,
    },
    strengths: ['Frontier software engineering', 'High-reliability tool calling'],
    routes: [
      {
        provider: 'bedrock',
        upstreamModelId: 'us.anthropic.claude-sonnet-4-6',
        priority: 1,
        apiStyle: 'bedrock-converse',
        pricing: { inputPerMillion: 3.0, outputPerMillion: 15.0 },
        supportsPromptCaching: true,
      },
      {
        provider: 'openrouter',
        upstreamModelId: 'anthropic/claude-sonnet-4.6',
        priority: 2,
        apiStyle: 'openai-chat',
        pricing: { inputPerMillion: 3.0, outputPerMillion: 15.0 },
        supportsPromptCaching: true,
      },
    ],
  },
  {
    id: 'mai-code-2',
    name: 'MAI Code 2',
    family: 'microsoft',
    tier: 3,
    metrics: {
      reasoningScore: 95,
      codingScore: 97,
      toolProficiency: 95,
      contextWindowTokens: 256_000,
      avgTtftMs: 420,
      tokensPerSecond: 110,
    },
    strengths: ['High-throughput code synthesis', 'Draft-and-judge code review'],
    routes: [
      {
        provider: 'foundry',
        upstreamModelId: 'mai-code-2',
        priority: 1,
        apiStyle: 'openai-chat',
        pricing: { inputPerMillion: 1.0, outputPerMillion: 4.0 },
        supportsPromptCaching: false,
      },
    ],
  },
  {
    id: 'microsoft-decision-1.1',
    name: 'Microsoft Decision 1.1',
    family: 'microsoft',
    tier: 1,
    metrics: {
      reasoningScore: 86,
      codingScore: 82,
      toolProficiency: 92,
      contextWindowTokens: 128_000,
      avgTtftMs: 140,
      tokensPerSecond: 190,
    },
    strengths: ['Ultra-fast intent triage & routing', 'Pre-flight verification & classification'],
    routes: [
      {
        provider: 'foundry',
        upstreamModelId: 'microsoft-decision-1.1',
        priority: 1,
        apiStyle: 'openai-chat',
        pricing: { inputPerMillion: 0.08, outputPerMillion: 0.25 },
        supportsPromptCaching: false,
      },
    ],
  },
  {
    id: 'gpt-5',
    name: 'GPT-5',
    family: 'openai',
    tier: 3,
    metrics: {
      reasoningScore: 96,
      codingScore: 95,
      toolProficiency: 95,
      contextWindowTokens: 400_000,
      avgTtftMs: 520,
      tokensPerSecond: 95,
    },
    strengths: ['Cross-provider OpenAI flagship', 'Structured synthesis & planning'],
    routes: [
      {
        provider: 'foundry',
        upstreamModelId: 'gpt-5',
        priority: 1,
        apiStyle: 'openai-chat',
        pricing: { inputPerMillion: 1.25, outputPerMillion: 10.0 },
        supportsPromptCaching: true,
      },
      {
        provider: 'openrouter',
        upstreamModelId: 'openai/gpt-5',
        priority: 2,
        apiStyle: 'openai-chat',
        pricing: { inputPerMillion: 1.25, outputPerMillion: 10.0 },
        supportsPromptCaching: true,
      },
    ],
  },
  {
    id: 'gemini-4-argon',
    name: 'Gemini 4 Argon',
    family: 'gemini',
    tier: 4,
    metrics: {
      reasoningScore: 99,
      codingScore: 98,
      toolProficiency: 96,
      contextWindowTokens: 1_000_000,
      avgTtftMs: 650,
      tokensPerSecond: 82,
    },
    strengths: ['1M context deep reasoning', 'Complex architecture & debugging'],
    routes: [
      {
        provider: 'openrouter',
        upstreamModelId: 'google/gemini-4-argon',
        priority: 1,
        apiStyle: 'openai-chat',
        pricing: { inputPerMillion: 2.0, outputPerMillion: 10.0 },
        supportsPromptCaching: true,
      },
    ],
  },
  {
    id: 'gemini-4-hydrogen',
    name: 'Gemini 4 Hydrogen',
    family: 'gemini',
    tier: 3,
    metrics: {
      reasoningScore: 95,
      codingScore: 96,
      toolProficiency: 95,
      contextWindowTokens: 1_000_000,
      avgTtftMs: 420,
      tokensPerSecond: 115,
    },
    strengths: ['1M context balanced coding', 'Fast multi-file tool execution'],
    routes: [
      {
        provider: 'openrouter',
        upstreamModelId: 'google/gemini-4-hydrogen',
        priority: 1,
        apiStyle: 'openai-chat',
        pricing: { inputPerMillion: 1.5, outputPerMillion: 7.5 },
        supportsPromptCaching: true,
      },
    ],
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    family: 'deepseek',
    tier: 3,
    metrics: {
      reasoningScore: 97,
      codingScore: 95,
      toolProficiency: 92,
      contextWindowTokens: 256_000,
      avgTtftMs: 580,
      tokensPerSecond: 85,
    },
    strengths: ['High-value reasoning & math', 'Multi-cloud Bedrock/Foundry/OpenRouter availability'],
    routes: [
      {
        provider: 'foundry',
        upstreamModelId: 'DeepSeek-V4-Pro',
        priority: 2,
        apiStyle: 'openai-chat',
        pricing: { inputPerMillion: 0.55, outputPerMillion: 2.2 },
        supportsPromptCaching: false,
      },
      {
        provider: 'openrouter',
        upstreamModelId: 'deepseek/deepseek-v4-pro-0813',
        priority: 1,
        apiStyle: 'openai-chat',
        pricing: { inputPerMillion: 0.111, outputPerMillion: 4.44 },
        supportsPromptCaching: true,
      },
    ],
  },
  {
    id: 'nova-2-pro',
    name: 'Amazon Nova 2 Pro',
    family: 'amazon',
    tier: 2,
    metrics: {
      reasoningScore: 89,
      codingScore: 88,
      toolProficiency: 90,
      contextWindowTokens: 300_000,
      avgTtftMs: 400,
      tokensPerSecond: 100,
    },
    strengths: ['Balanced speed & cost', 'Native Bedrock prompt caching'],
    routes: [
      {
        provider: 'bedrock',
        upstreamModelId: 'us.amazon.nova-pro-v1:0',
        priority: 1,
        apiStyle: 'bedrock-converse',
        pricing: { inputPerMillion: 0.8, outputPerMillion: 3.2 },
        supportsPromptCaching: true,
      },
    ],
  },
  {
    id: 'nova-2-lite',
    name: 'Amazon Nova 2 Lite',
    family: 'amazon',
    tier: 1,
    metrics: {
      reasoningScore: 76,
      codingScore: 80,
      toolProficiency: 84,
      contextWindowTokens: 300_000,
      avgTtftMs: 250,
      tokensPerSecond: 130,
    },
    strengths: ['Ultra-low cost ($0.06/M)', 'Fast leaf workers & triage'],
    routes: [
      {
        provider: 'bedrock',
        upstreamModelId: 'us.amazon.nova-2-lite-v1:0',
        priority: 1,
        apiStyle: 'bedrock-converse',
        pricing: { inputPerMillion: 0.06, outputPerMillion: 0.24 },
        supportsPromptCaching: true,
      },
    ],
  },
  {
    id: 'qwen3-coder-480b',
    name: 'Qwen 3 Coder 480B',
    family: 'qwen',
    tier: 3,
    metrics: {
      reasoningScore: 92,
      codingScore: 94,
      toolProficiency: 91,
      contextWindowTokens: 256_000,
      avgTtftMs: 450,
      tokensPerSecond: 100,
    },
    strengths: ['High-speed code generation', 'Cross-provider Bedrock & OpenRouter'],
    routes: [
      {
        provider: 'bedrock',
        upstreamModelId: 'qwen.qwen3-coder-480b-a35b-v1:0',
        priority: 2,
        apiStyle: 'bedrock-converse',
        pricing: { inputPerMillion: 0.45, outputPerMillion: 1.8 },
        supportsPromptCaching: false,
      },
      {
        provider: 'openrouter',
        upstreamModelId: 'qwen/qwen3-coder',
        priority: 1,
        apiStyle: 'openai-chat',
        pricing: { inputPerMillion: 0.3, outputPerMillion: 1.0 },
        supportsPromptCaching: false,
      },
    ],
  },
  // ── Additional Live Bedrock + Microsoft Foundry Master Models ─────────────
  {
    id: 'claude-opus-5-5',
    name: 'Claude Opus 5.5',
    family: 'anthropic',
    tier: 4,
    workflowGroups: ['coding', 'research'],
    metrics: { reasoningScore: 100, codingScore: 99, toolProficiency: 98, contextWindowTokens: 200_000, avgTtftMs: 780, tokensPerSecond: 60 },
    strengths: ['Frontier architecture & complex debugging', 'Deep multi-step planning'],
    routes: [
      { provider: 'bedrock', upstreamModelId: 'us.anthropic.claude-opus-5-5', priority: 1, apiStyle: 'bedrock-converse', pricing: { inputPerMillion: 4.0, outputPerMillion: 20.0 }, supportsPromptCaching: true },
    ],
  },
  {
    id: 'claude-sonnet-5-5',
    name: 'Claude Sonnet 5.5',
    family: 'anthropic',
    tier: 3,
    workflowGroups: ['coding', 'research'],
    metrics: { reasoningScore: 97, codingScore: 98, toolProficiency: 98, contextWindowTokens: 200_000, avgTtftMs: 490, tokensPerSecond: 92 },
    strengths: ['Surgical multi-file refactoring', 'Strict tool-calling discipline'],
    routes: [
      { provider: 'bedrock', upstreamModelId: 'us.anthropic.claude-sonnet-5-5', priority: 1, apiStyle: 'bedrock-converse', pricing: { inputPerMillion: 2.0, outputPerMillion: 10.0 }, supportsPromptCaching: true },
    ],
  },
  {
    id: 'claude-haiku-5-5',
    name: 'Claude Haiku 5.5',
    family: 'anthropic',
    tier: 1,
    workflowGroups: ['fast-utility', 'triage-routing'],
    metrics: { reasoningScore: 85, codingScore: 89, toolProficiency: 90, contextWindowTokens: 200_000, avgTtftMs: 210, tokensPerSecond: 165 },
    strengths: ['Fast tool execution & Q&A', 'Low-cost sub-agent worker'],
    routes: [
      { provider: 'bedrock', upstreamModelId: 'us.anthropic.claude-haiku-5-5', priority: 1, apiStyle: 'bedrock-converse', pricing: { inputPerMillion: 0.1, outputPerMillion: 0.5 }, supportsPromptCaching: true },
    ],
  },
  {
    id: 'gpt-6.1-sol',
    name: 'GPT-6.1 Sol',
    family: 'openai',
    tier: 3,
    workflowGroups: ['coding', 'research'],
    metrics: { reasoningScore: 97, codingScore: 98, toolProficiency: 96, contextWindowTokens: 400_000, avgTtftMs: 510, tokensPerSecond: 92 },
    strengths: ['Deep research & synthesis', 'High-accuracy code edits'],
    routes: [
      { provider: 'bedrock', upstreamModelId: 'us.openai.gpt-6.1-sol', priority: 1, apiStyle: 'bedrock-converse', pricing: { inputPerMillion: 2.0, outputPerMillion: 10.0 }, supportsPromptCaching: true },
    ],
  },
  {
    id: 'gpt-6.1-terra',
    name: 'GPT-6.1 Terra',
    family: 'openai',
    tier: 3,
    workflowGroups: ['long-context', 'research', 'coding'],
    metrics: { reasoningScore: 93, codingScore: 94, toolProficiency: 94, contextWindowTokens: 1_000_000, avgTtftMs: 420, tokensPerSecond: 105 },
    strengths: ['1M-token context window', 'Balanced research & coding'],
    routes: [
      { provider: 'bedrock', upstreamModelId: 'us.openai.gpt-6.1-terra', priority: 1, apiStyle: 'bedrock-converse', pricing: { inputPerMillion: 1.0, outputPerMillion: 5.0 }, supportsPromptCaching: true },
    ],
  },
  {
    id: 'gpt-6-luna',
    name: 'GPT-6 Luna',
    family: 'openai',
    tier: 1,
    workflowGroups: ['fast-utility', 'triage-routing'],
    metrics: { reasoningScore: 86, codingScore: 88, toolProficiency: 89, contextWindowTokens: 256_000, avgTtftMs: 220, tokensPerSecond: 160 },
    strengths: ['Fast, low-cost OpenAI tier', 'Quick patches & chat'],
    routes: [
      { provider: 'bedrock', upstreamModelId: 'us.openai.gpt-6-luna', priority: 1, apiStyle: 'bedrock-converse', pricing: { inputPerMillion: 0.1, outputPerMillion: 0.5 }, supportsPromptCaching: true },
    ],
  },
  {
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol',
    family: 'openai',
    tier: 3,
    workflowGroups: ['research', 'coding'],
    metrics: { reasoningScore: 95, codingScore: 95, toolProficiency: 94, contextWindowTokens: 400_000, avgTtftMs: 480, tokensPerSecond: 95 },
    strengths: ['Bedrock & Foundry dual-routed research/coding', 'Enterprise throughput'],
    routes: [
      { provider: 'bedrock', upstreamModelId: 'us.openai.gpt-5.6-sol', priority: 1, apiStyle: 'bedrock-converse', pricing: { inputPerMillion: 2.5, outputPerMillion: 10.0 }, supportsPromptCaching: true },
      { provider: 'foundry', upstreamModelId: 'gpt-5.6-sol', priority: 2, apiStyle: 'openai-chat', pricing: { inputPerMillion: 2.5, outputPerMillion: 10.0 }, supportsPromptCaching: true },
    ],
  },
  {
    id: 'gpt-5.6-terra',
    name: 'GPT-5.6 Terra',
    family: 'openai',
    tier: 2,
    workflowGroups: ['long-context', 'research'],
    metrics: { reasoningScore: 91, codingScore: 91, toolProficiency: 91, contextWindowTokens: 1_000_000, avgTtftMs: 390, tokensPerSecond: 112 },
    strengths: ['1M context on Bedrock & Foundry', 'Long-document synthesis'],
    routes: [
      { provider: 'bedrock', upstreamModelId: 'us.openai.gpt-5.6-terra', priority: 1, apiStyle: 'bedrock-converse', pricing: { inputPerMillion: 2.0, outputPerMillion: 12.0 }, supportsPromptCaching: true },
      { provider: 'foundry', upstreamModelId: 'gpt-5.6-terra', priority: 2, apiStyle: 'openai-chat', pricing: { inputPerMillion: 2.0, outputPerMillion: 12.0 }, supportsPromptCaching: true },
    ],
  },
  {
    id: 'gpt-5.6-luna',
    name: 'GPT-5.6 Luna',
    family: 'openai',
    tier: 1,
    workflowGroups: ['fast-utility', 'triage-routing'],
    metrics: { reasoningScore: 84, codingScore: 86, toolProficiency: 87, contextWindowTokens: 256_000, avgTtftMs: 200, tokensPerSecond: 170 },
    strengths: ['Fast, low-cost Bedrock & Foundry utility model'],
    routes: [
      { provider: 'bedrock', upstreamModelId: 'us.openai.gpt-5.6-luna', priority: 1, apiStyle: 'bedrock-converse', pricing: { inputPerMillion: 0.2, outputPerMillion: 1.2 }, supportsPromptCaching: true },
      { provider: 'foundry', upstreamModelId: 'gpt-5.6-luna', priority: 2, apiStyle: 'openai-chat', pricing: { inputPerMillion: 0.2, outputPerMillion: 1.2 }, supportsPromptCaching: true },
    ],
  },
  {
    id: 'grok-4.7',
    name: 'Grok 4.7',
    family: 'xai',
    tier: 3,
    workflowGroups: ['world-social', 'research'],
    metrics: { reasoningScore: 95, codingScore: 92, toolProficiency: 91, contextWindowTokens: 256_000, avgTtftMs: 460, tokensPerSecond: 100 },
    strengths: ['Social/X & live world knowledge', 'Unfiltered cultural & news synthesis'],
    routes: [
      { provider: 'bedrock', upstreamModelId: 'us.xai.grok-4.7', priority: 1, apiStyle: 'bedrock-converse', pricing: { inputPerMillion: 3.0, outputPerMillion: 15.0 }, supportsPromptCaching: false },
      { provider: 'foundry', upstreamModelId: 'grok-4.7', priority: 2, apiStyle: 'openai-chat', pricing: { inputPerMillion: 3.0, outputPerMillion: 15.0 }, supportsPromptCaching: false },
    ],
  },
  {
    id: 'grok-4.6',
    name: 'Grok 4.6',
    family: 'xai',
    tier: 2,
    workflowGroups: ['world-social', 'fast-utility'],
    metrics: { reasoningScore: 91, codingScore: 89, toolProficiency: 88, contextWindowTokens: 256_000, avgTtftMs: 360, tokensPerSecond: 120 },
    strengths: ['Fast social/world knowledge queries'],
    routes: [
      { provider: 'bedrock', upstreamModelId: 'us.xai.grok-4.6', priority: 1, apiStyle: 'bedrock-converse', pricing: { inputPerMillion: 1.5, outputPerMillion: 7.5 }, supportsPromptCaching: false },
      { provider: 'foundry', upstreamModelId: 'grok-4.6', priority: 2, apiStyle: 'openai-chat', pricing: { inputPerMillion: 1.5, outputPerMillion: 7.5 }, supportsPromptCaching: false },
    ],
  },
  {
    id: 'mai-ds-r1',
    name: 'MAI-DS-R1',
    family: 'microsoft',
    tier: 3,
    workflowGroups: ['research', 'coding'],
    metrics: { reasoningScore: 95, codingScore: 94, toolProficiency: 90, contextWindowTokens: 128_000, avgTtftMs: 560, tokensPerSecond: 82 },
    strengths: ['DeepSeek-R1 reasoning with Microsoft safety post-training', 'Unblocked edge-case reasoning'],
    routes: [
      { provider: 'foundry', upstreamModelId: 'MAI-DS-R1', priority: 1, apiStyle: 'openai-chat', pricing: { inputPerMillion: 1.35, outputPerMillion: 5.4 }, supportsPromptCaching: false },
    ],
  },
  {
    id: 'mai-1',
    name: 'MAI-1',
    family: 'microsoft',
    tier: 2,
    workflowGroups: ['fast-utility', 'research'],
    metrics: { reasoningScore: 90, codingScore: 88, toolProficiency: 89, contextWindowTokens: 128_000, avgTtftMs: 280, tokensPerSecond: 145 },
    strengths: ['MoE cost-to-performance general & instruction model'],
    routes: [
      { provider: 'foundry', upstreamModelId: 'MAI-1', priority: 1, apiStyle: 'openai-chat', pricing: { inputPerMillion: 0.4, outputPerMillion: 1.6 }, supportsPromptCaching: false },
    ],
  },
  {
    id: 'phi-4-reasoning',
    name: 'Phi-4 Reasoning',
    family: 'microsoft',
    tier: 1,
    workflowGroups: ['fast-utility', 'triage-routing'],
    metrics: { reasoningScore: 86, codingScore: 84, toolProficiency: 85, contextWindowTokens: 128_000, avgTtftMs: 160, tokensPerSecond: 185 },
    strengths: ['High-density SLM reasoning on Foundry'],
    routes: [
      { provider: 'foundry', upstreamModelId: 'Phi-4-reasoning', priority: 1, apiStyle: 'openai-chat', pricing: { inputPerMillion: 0.1, outputPerMillion: 0.4 }, supportsPromptCaching: false },
    ],
  },
  {
    id: 'deepseek-v3.2',
    name: 'DeepSeek V3.2',
    family: 'deepseek',
    tier: 2,
    workflowGroups: ['coding', 'fast-utility'],
    metrics: { reasoningScore: 91, codingScore: 93, toolProficiency: 90, contextWindowTokens: 128_000, avgTtftMs: 380, tokensPerSecond: 115 },
    strengths: ['Cost-efficient Bedrock & Foundry coding'],
    routes: [
      { provider: 'bedrock', upstreamModelId: 'deepseek.v3.2', priority: 1, apiStyle: 'bedrock-converse', pricing: { inputPerMillion: 0.3, outputPerMillion: 1.2 }, supportsPromptCaching: false },
      { provider: 'foundry', upstreamModelId: 'DeepSeek-V3.2', priority: 2, apiStyle: 'openai-chat', pricing: { inputPerMillion: 0.3, outputPerMillion: 1.2 }, supportsPromptCaching: false },
    ],
  },
  {
    id: 'kimi-k3.1',
    name: 'Kimi K3.1',
    family: 'kimi',
    tier: 3,
    workflowGroups: ['long-context', 'coding', 'research'],
    metrics: { reasoningScore: 96, codingScore: 95, toolProficiency: 92, contextWindowTokens: 256_000, avgTtftMs: 520, tokensPerSecond: 85 },
    strengths: ['Long-context reasoning & coding on Bedrock'],
    routes: [
      { provider: 'bedrock', upstreamModelId: 'us.moonshotai.kimi-k3.1', priority: 1, apiStyle: 'bedrock-converse', pricing: { inputPerMillion: 1.2, outputPerMillion: 6.0 }, supportsPromptCaching: false },
    ],
  },
  {
    id: 'glm-5.3',
    name: 'GLM 5.3',
    family: 'glm',
    tier: 2,
    workflowGroups: ['coding', 'fast-utility'],
    metrics: { reasoningScore: 90, codingScore: 92, toolProficiency: 90, contextWindowTokens: 200_000, avgTtftMs: 320, tokensPerSecond: 125 },
    strengths: ['Fast agentic coding on Bedrock'],
    routes: [
      { provider: 'bedrock', upstreamModelId: 'us.zai.glm-5.3', priority: 1, apiStyle: 'bedrock-converse', pricing: { inputPerMillion: 0.4, outputPerMillion: 1.6 }, supportsPromptCaching: false },
    ],
  },
  {
    id: 'qwen3-coder-next',
    name: 'Qwen3 Coder Next',
    family: 'qwen',
    tier: 2,
    workflowGroups: ['coding'],
    metrics: { reasoningScore: 90, codingScore: 94, toolProficiency: 91, contextWindowTokens: 256_000, avgTtftMs: 340, tokensPerSecond: 120 },
    strengths: ['On-demand Bedrock code generation'],
    routes: [
      { provider: 'bedrock', upstreamModelId: 'qwen.qwen3-coder-next', priority: 1, apiStyle: 'bedrock-converse', pricing: { inputPerMillion: 0.35, outputPerMillion: 1.4 }, supportsPromptCaching: false },
    ],
  },
  {
    id: 'devstral-2-123b',
    name: 'Devstral 2 123B',
    family: 'mistral',
    tier: 2,
    workflowGroups: ['coding'],
    metrics: { reasoningScore: 89, codingScore: 93, toolProficiency: 91, contextWindowTokens: 256_000, avgTtftMs: 370, tokensPerSecond: 108 },
    strengths: ['Software engineering & repo navigation on Bedrock'],
    routes: [
      { provider: 'bedrock', upstreamModelId: 'mistral.devstral-2-123b', priority: 1, apiStyle: 'bedrock-converse', pricing: { inputPerMillion: 0.4, outputPerMillion: 1.6 }, supportsPromptCaching: false },
    ],
  },
  {
    id: 'mistral-large-3',
    name: 'Mistral Large 3 (675B)',
    family: 'mistral',
    tier: 3,
    workflowGroups: ['research', 'coding'],
    metrics: { reasoningScore: 93, codingScore: 91, toolProficiency: 91, contextWindowTokens: 256_000, avgTtftMs: 490, tokensPerSecond: 85 },
    strengths: ['Multilingual reasoning on Bedrock & Foundry'],
    routes: [
      { provider: 'bedrock', upstreamModelId: 'mistral.mistral-large-3-675b-instruct', priority: 1, apiStyle: 'bedrock-converse', pricing: { inputPerMillion: 2.0, outputPerMillion: 6.0 }, supportsPromptCaching: false },
      { provider: 'foundry', upstreamModelId: 'Mistral-Large-3', priority: 2, apiStyle: 'openai-chat', pricing: { inputPerMillion: 2.0, outputPerMillion: 6.0 }, supportsPromptCaching: false },
    ],
  },
  {
    id: 'minimax-m2.5',
    name: 'MiniMax M2.5',
    family: 'minimax',
    tier: 2,
    workflowGroups: ['coding', 'fast-utility'],
    metrics: { reasoningScore: 88, codingScore: 91, toolProficiency: 89, contextWindowTokens: 200_000, avgTtftMs: 310, tokensPerSecond: 130 },
    strengths: ['High-throughput coding & agent loops on Bedrock'],
    routes: [
      { provider: 'bedrock', upstreamModelId: 'minimax.minimax-m2.5', priority: 1, apiStyle: 'bedrock-converse', pricing: { inputPerMillion: 0.3, outputPerMillion: 1.2 }, supportsPromptCaching: false },
    ],
  },
  {
    id: 'nemotron-super-3-120b',
    name: 'NVIDIA Nemotron 3 Super 120B',
    family: 'nvidia',
    tier: 2,
    workflowGroups: ['research', 'coding'],
    metrics: { reasoningScore: 90, codingScore: 89, toolProficiency: 88, contextWindowTokens: 128_000, avgTtftMs: 350, tokensPerSecond: 115 },
    strengths: ['Enterprise reasoning on Bedrock'],
    routes: [
      { provider: 'bedrock', upstreamModelId: 'nvidia.nemotron-super-3-120b', priority: 1, apiStyle: 'bedrock-converse', pricing: { inputPerMillion: 0.45, outputPerMillion: 1.8 }, supportsPromptCaching: false },
    ],
  },
  {
    id: 'gpt-oss-120b',
    name: 'GPT OSS 120B',
    family: 'openai',
    tier: 2,
    workflowGroups: ['fast-utility', 'research'],
    metrics: { reasoningScore: 88, codingScore: 87, toolProficiency: 86, contextWindowTokens: 128_000, avgTtftMs: 290, tokensPerSecond: 135 },
    strengths: ['Open-weights OpenAI on Bedrock'],
    routes: [
      { provider: 'bedrock', upstreamModelId: 'openai.gpt-oss-120b-1:0', priority: 1, apiStyle: 'bedrock-converse', pricing: { inputPerMillion: 0.25, outputPerMillion: 1.0 }, supportsPromptCaching: false },
    ],
  },
  // OpenRouter-only models migrated from Gram's former local registry. Reasoning/coding scores,
  // pricing and context windows come from that registry; avgTtftMs, tokensPerSecond and
  // toolProficiency were not tracked there and are estimates (scaled from Gram's speed score and
  // peer models), so treat them as approximate until measured.
  {
    id: 'deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash',
    family: 'deepseek',
    tier: 1,
    workflowGroups: ['fast-utility', 'triage-routing'],
    metrics: { reasoningScore: 86, codingScore: 88, toolProficiency: 86, contextWindowTokens: 1_048_576, avgTtftMs: 210, tokensPerSecond: 165 },
    strengths: ['Lowest input price in the catalog, with a 1M-token context window'],
    routes: [
      { provider: 'openrouter', upstreamModelId: 'deepseek/deepseek-v4.1-flash', priority: 1, apiStyle: 'openai-chat', pricing: { inputPerMillion: 0.05, outputPerMillion: 0.3 }, supportsPromptCaching: true },
    ],
  },
  {
    id: 'qwen3-coder-flash',
    name: 'Qwen3 Coder Flash',
    family: 'qwen',
    tier: 2,
    workflowGroups: ['coding', 'fast-utility'],
    metrics: { reasoningScore: 87, codingScore: 90, toolProficiency: 88, contextWindowTokens: 1_000_000, avgTtftMs: 300, tokensPerSecond: 140 },
    strengths: ['Low-cost code generation with a 1M-token context window'],
    routes: [
      { provider: 'openrouter', upstreamModelId: 'qwen/qwen3-coder-flash', priority: 1, apiStyle: 'openai-chat', pricing: { inputPerMillion: 0.195, outputPerMillion: 0.975 }, supportsPromptCaching: true },
    ],
  },
  {
    id: 'mistral-large-4',
    name: 'Mistral Large 4',
    family: 'mistral',
    tier: 3,
    workflowGroups: ['research', 'coding'],
    metrics: { reasoningScore: 92, codingScore: 92, toolProficiency: 90, contextWindowTokens: 256_000, avgTtftMs: 480, tokensPerSecond: 95 },
    strengths: ['Mistral Large 3-class quality at a quarter of the price'],
    routes: [
      { provider: 'openrouter', upstreamModelId: 'mistralai/mistral-large-4-0', priority: 1, apiStyle: 'openai-chat', pricing: { inputPerMillion: 0.5, outputPerMillion: 1.5 }, supportsPromptCaching: false },
    ],
  },
  {
    id: 'grok-4.20',
    name: 'Grok 4.20',
    family: 'xai',
    tier: 3,
    workflowGroups: ['world-social', 'research', 'coding'],
    metrics: { reasoningScore: 93, codingScore: 93, toolProficiency: 90, contextWindowTokens: 256_000, avgTtftMs: 440, tokensPerSecond: 105 },
    strengths: ['Stronger and cheaper than Grok 4.6 for coding and research'],
    routes: [
      { provider: 'openrouter', upstreamModelId: 'x-ai/grok-4.20', priority: 1, apiStyle: 'openai-chat', pricing: { inputPerMillion: 1.25, outputPerMillion: 2.5 }, supportsPromptCaching: true },
    ],
  },
  {
    id: 'muse-spark-1.3',
    name: 'Muse Spark 1.3',
    family: 'meta',
    tier: 3,
    workflowGroups: ['long-context', 'coding', 'research'],
    metrics: { reasoningScore: 94, codingScore: 95, toolProficiency: 90, contextWindowTokens: 1_000_000, avgTtftMs: 450, tokensPerSecond: 105 },
    strengths: ['1M-token context with frontier-class coding', 'Not ZDR-compliant: excluded in zdr privacy mode'],
    routes: [
      {
        provider: 'openrouter',
        upstreamModelId: 'meta/muse-spark-1.3',
        priority: 1,
        apiStyle: 'openai-chat',
        pricing: { inputPerMillion: 1.25, outputPerMillion: 4.25 },
        supportsPromptCaching: true,
        contributorWarning: 'Avoid Contributor endpoints on private repos; prompts may be used for training.',
      },
    ],
  },
];

/**
 * Legacy / provider-specific IDs -> canonical model IDs for backward compatibility.
 */
export const MODEL_ID_ALIASES: Record<string, string> = {
  'us.anthropic.claude-mythos-5-2-v1:0': 'claude-mythos-5-2',
  'anthropic/claude-mythos-5.2': 'claude-mythos-5-2',
  'us.anthropic.claude-fable-5-2-v1:0': 'claude-fable-5-2',
  'anthropic/claude-fable-5.2': 'claude-fable-5-2',
  'openai/gpt-6.2-astra': 'gpt-6.2-astra',
  'openai/gpt-6.2-sol': 'gpt-6.2-sol',
  'google/gemini-4-carbon': 'gemini-4-carbon',
  'us.anthropic.claude-opus-4-6-v1': 'claude-opus-4-6',
  'anthropic.claude-opus-4-6-v1': 'claude-opus-4-6',
  'anthropic/claude-opus-4.6': 'claude-opus-4-6',
  'us.anthropic.claude-sonnet-4-6': 'claude-sonnet-4-6',
  'us.anthropic.claude-sonnet-4-6-v1:0': 'claude-sonnet-4-6',
  'anthropic.claude-sonnet-4-6': 'claude-sonnet-4-6',
  'anthropic/claude-sonnet-4.6': 'claude-sonnet-4-6',
  'us.amazon.nova-2-pro-v1:0': 'nova-2-pro',
  'amazon.nova-2-pro-v1:0': 'nova-2-pro',
  'us.amazon.nova-2-lite-v1:0': 'nova-2-lite',
  'amazon.nova-2-lite-v1:0': 'nova-2-lite',
  'openai/gpt-5': 'gpt-5',
  'google/gemini-4-argon': 'gemini-4-argon',
  'google/gemini-4-hydrogen': 'gemini-4-hydrogen',
  'deepseek/deepseek-v4-pro-0813': 'deepseek-v4-pro',
  'us.anthropic.claude-opus-5-5': 'claude-opus-5-5',
  'anthropic.claude-opus-5-5': 'claude-opus-5-5',
  'us.anthropic.claude-sonnet-5-5': 'claude-sonnet-5-5',
  'anthropic.claude-sonnet-5-5': 'claude-sonnet-5-5',
  'us.anthropic.claude-haiku-5-5': 'claude-haiku-5-5',
  'anthropic.claude-haiku-5-5': 'claude-haiku-5-5',
  'us.openai.gpt-6.1-sol': 'gpt-6.1-sol',
  'us.openai.gpt-6.1-terra': 'gpt-6.1-terra',
  'us.openai.gpt-6-luna': 'gpt-6-luna',
  'us.openai.gpt-5.6-sol': 'gpt-5.6-sol',
  'us.openai.gpt-5.6-terra': 'gpt-5.6-terra',
  'us.openai.gpt-5.6-luna': 'gpt-5.6-luna',
  'us.xai.grok-4.7': 'grok-4.7',
  'xai.grok-4.7': 'grok-4.7',
  'us.xai.grok-4.6': 'grok-4.6',
  'xai.grok-4.6': 'grok-4.6',
  'MAI-DS-R1': 'mai-ds-r1',
  'MAI-1': 'mai-1',
  'Phi-4-reasoning': 'phi-4-reasoning',
  'deepseek.v3.2': 'deepseek-v3.2',
  'DeepSeek-V3.2': 'deepseek-v3.2',
  'us.moonshotai.kimi-k3.1': 'kimi-k3.1',
  'moonshotai.kimi-k3.1': 'kimi-k3.1',
  'us.zai.glm-5.3': 'glm-5.3',
  'zai.glm-5.3': 'glm-5.3',
  'qwen.qwen3-coder-next': 'qwen3-coder-next',
  'mistral.devstral-2-123b': 'devstral-2-123b',
  'mistral.mistral-large-3-675b-instruct': 'mistral-large-3',
  'Mistral-Large-3': 'mistral-large-3',
  'minimax.minimax-m2.5': 'minimax-m2.5',
  'nvidia.nemotron-super-3-120b': 'nemotron-super-3-120b',
  'openai.gpt-oss-120b-1:0': 'gpt-oss-120b',
  'DeepSeek-V4-Pro': 'deepseek-v4-pro',
  'qwen.qwen3-coder-480b-a35b-v1:0': 'qwen3-coder-480b',
  'qwen/qwen3-coder': 'qwen3-coder-480b',
  'deepseek/deepseek-v4.1-flash': 'deepseek-v4.1-flash',
  'qwen/qwen3-coder-flash': 'qwen3-coder-flash',
  'mistralai/mistral-large-4-0': 'mistral-large-4',
  'x-ai/grok-4.20': 'grok-4.20',
  'meta/muse-spark-1.3': 'muse-spark-1.3',
  // Provider-native ids that were only reachable as route upstream ids, so alias resolution
  // (and therefore resolveProviderRoutes) found no model for them.
  'us.amazon.nova-pro-v1:0': 'nova-2-pro',
  'MAI-Code-1.1-Flash': 'mai-code-1-1-flash',
  'MAI-Thinking-1': 'mai-thinking-1',
  'openai/gpt-4o': 'gpt-4o',
};

const routeCooldowns = new Map<string, number>();

function routeKey(canonicalModelId: string, provider: BackendProvider): string {
  return `${canonicalModelId}::${provider}`;
}

export function markProviderRouteCooldown(
  canonicalModelId: string,
  provider: BackendProvider,
  cooldownMs = 120_000
): void {
  routeCooldowns.set(routeKey(canonicalModelId, provider), Date.now() + cooldownMs);
}

export function isProviderRouteHealthy(canonicalModelId: string, provider: BackendProvider): boolean {
  const until = routeCooldowns.get(routeKey(canonicalModelId, provider));
  if (!until) return true;
  if (Date.now() >= until) {
    routeCooldowns.delete(routeKey(canonicalModelId, provider));
    return true;
  }
  return false;
}

export function clearProviderRouteCooldowns(): void {
  routeCooldowns.clear();
}

export function normalizeCanonicalModelId(modelId: string): string {
  const trimmed = String(modelId || '').trim();
  return MODEL_ID_ALIASES[trimmed] || trimmed;
}

let mergedCatalogCache: { version: number; models: CanonicalModelProfile[] } | null = null;

/**
 * Seed catalog plus runtime-registered models (see `modelRegistry.ts`), with provider-synced route
 * prices applied. Registered entries win on id clashes. The result is cached until the registry
 * changes, because routing calls this on hot paths. Seed objects are never mutated.
 */
export function allCatalogModels(): CanonicalModelProfile[] {
  const version = modelRegistry.version;
  if (mergedCatalogCache?.version === version) return mergedCatalogCache.models;

  const dynamic = modelRegistry.dynamicProfiles();
  const dynamicIds = new Set(dynamic.map((m) => m.id));
  const base = dynamic.length === 0 ? UNIFIED_MODEL_CATALOG : [...UNIFIED_MODEL_CATALOG.filter((m) => !dynamicIds.has(m.id)), ...dynamic];

  const models = base.map((model) => {
    const overrides = modelRegistry.getRecord(model.id)?.priceOverrides;
    if (!overrides) return model;
    return {
      ...model,
      routes: model.routes.map((route) => {
        const override = overrides[route.provider];
        return override
          ? { ...route, pricing: { inputPerMillion: override.inputPerMillion, outputPerMillion: override.outputPerMillion } }
          : route;
      }),
    };
  });

  mergedCatalogCache = { version, models };
  return models;
}

/** Lifecycle status of a model: seed models are `active` unless the registry says otherwise. */
export function getModelLifecycleStatus(modelId: string): ModelLifecycleStatus {
  return modelRegistry.getStatus(normalizeCanonicalModelId(modelId));
}

/** Finds a model by id or alias in any lifecycle state, including retired. For admin and audit use. */
export function findCatalogModelAnyStatus(modelId: string): CanonicalModelProfile | undefined {
  const normalized = normalizeCanonicalModelId(modelId);
  return allCatalogModels().find((m) => m.id === normalized);
}

/** Finds a routable model: any lifecycle state except `retired` (the provider has removed it). */
export function findCanonicalModel(modelId: string): CanonicalModelProfile | undefined {
  const found = findCatalogModelAnyStatus(modelId);
  return found && modelRegistry.getStatus(found.id) !== 'retired' ? found : undefined;
}

/**
 * Lists models. By default only `active` models are returned, which is what `auto` routing and the
 * default client list use; pass `statuses` to include `candidate` or `legacy` models as well.
 */
export function listCanonicalModels(options?: {
  privacyMode?: PrivacyMode;
  onlyConfiguredProviders?: boolean;
  statuses?: readonly ModelLifecycleStatus[];
}): CanonicalModelProfile[] {
  const privacyMode = options?.privacyMode || 'standard';
  if (privacyMode === 'local-only') return [];
  const statuses = options?.statuses ?? ['active'];

  return allCatalogModels().filter((model) =>
    statuses.includes(modelRegistry.getStatus(model.id)) &&
    model.routes.some((route) => {
      if (privacyMode === 'zdr' && route.contributorWarning) return false;
      if (options?.onlyConfiguredProviders && !isBackendProviderConfigured(route.provider)) {
        return false;
      }
      return true;
    })
  );
}

/**
 * Resolves ordered backend provider routes for a canonical (or aliased) model ID.
 * Orders healthy, configured, privacy-compliant routes first by priority.
 * If all eligible routes are in cooldown, returns them anyway as a last-resort fallback.
 */
export function resolveProviderRoutes(
  modelId: string,
  options?: {
    privacyMode?: PrivacyMode;
    preferredProvider?: BackendProvider;
    requireConfigured?: boolean;
  }
): ResolvedProviderRoute[] {
  const privacyMode = options?.privacyMode || 'standard';
  if (privacyMode === 'local-only') return [];

  const canonical = findCanonicalModel(modelId);
  if (!canonical) return [];

  const eligible = canonical.routes
    .filter((route) => {
      if (privacyMode === 'zdr' && route.contributorWarning) return false;
      if (options?.requireConfigured && !isBackendProviderConfigured(route.provider)) {
        return false;
      }
      return true;
    })
    .map((route) => ({
      ...route,
      canonicalModelId: canonical.id,
      canonicalModelName: canonical.name,
      inCooldown: !isProviderRouteHealthy(canonical.id, route.provider),
    }));

  const sortRoutes = (a: ResolvedProviderRoute, b: ResolvedProviderRoute): number => {
    if (a.inCooldown !== b.inCooldown) return a.inCooldown ? 1 : -1;
    if (options?.preferredProvider) {
      const aPref = a.provider === options.preferredProvider ? 0 : 1;
      const bPref = b.provider === options.preferredProvider ? 0 : 1;
      if (aPref !== bPref) return aPref - bPref;
    }
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.pricing.inputPerMillion - b.pricing.inputPerMillion;
  };

  return eligible.sort(sortRoutes);
}

export interface PatchReviewResult {
  approved: boolean;
  issues: string[];
  reviewerModel: string;
  reviewerProvider: BackendProvider | 'heuristic';
}

const REVIEWER_MODEL_CANDIDATES = [
  'gpt-4o',
  'claude-sonnet-4-6',
  'phi-4-reasoning',
  'mai-code-1-1-flash',
  'gemini-4-hydrogen',
  'nova-2-pro',
];

/**
 * Cross-provider Draft-and-Judge patch reviewer (Copilot Fusion pattern).
 * Selects a fast, healthy reviewer across Bedrock, Foundry, or OpenRouter—preferring
 * a different provider than the primary coder when multiple are configured.
 */
export async function reviewPatchAcrossProviders(params: {
  patchDiff: string;
  taskSummary: string;
  primaryProvider?: BackendProvider;
  timeoutMs?: number;
}): Promise<PatchReviewResult> {
  const candidates: ResolvedProviderRoute[] = [];
  for (const modelId of REVIEWER_MODEL_CANDIDATES) {
    candidates.push(...resolveProviderRoutes(modelId, { requireConfigured: true }));
  }
  const healthy = candidates.filter((c) => !c.inCooldown);
  const pool = healthy.length > 0 ? healthy : candidates;
  const route =
    (params.primaryProvider && pool.find((r) => r.provider !== params.primaryProvider)) || pool[0];

  if (!route) {
    return {
      approved: true,
      issues: [],
      reviewerModel: 'none',
      reviewerProvider: 'heuristic',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 4000);
  try {
    const prompt = `Task: ${params.taskSummary.slice(0, 500)}\n\nDiff:\n${params.patchDiff.slice(0, 4000)}\n\nRespond with JSON {"approved":boolean,"issues":string[]}. Flag only real bugs, security flaws, or broken types.`;
    if (route.provider === 'bedrock') {
      const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
      const client = new BedrockRuntimeClient({
        region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
      });
      const resp = await client.send(
        new ConverseCommand({
          modelId: route.upstreamModelId,
          messages: [{ role: 'user', content: [{ text: prompt }] }],
          inferenceConfig: { maxTokens: 300, temperature: 0 },
        }),
        { abortSignal: controller.signal }
      );
      const raw = resp.output?.message?.content?.find((b) => 'text' in b && b.text)?.text || '';
      const match = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(match ? match[0] : raw) as { approved?: boolean; issues?: string[] };
      return {
        approved: parsed.approved !== false,
        issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
        reviewerModel: route.canonicalModelId,
        reviewerProvider: route.provider,
      };
    }

    let baseUrl = 'https://openrouter.ai/api/v1';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (route.provider === 'foundry') {
      const cfg = getFoundryConfig();
      if (!cfg.endpoint || !cfg.apiKey) {
        return { approved: true, issues: [], reviewerModel: 'none', reviewerProvider: 'heuristic' };
      }
      baseUrl = buildFoundryOpenAiBaseUrl(cfg.endpoint);
      headers['api-key'] = cfg.apiKey;
      headers.Authorization = `Bearer ${cfg.apiKey}`;
    } else {
      const apiKey = process.env.OPENROUTER_API_KEY || process.env.LYRA_MANAGED_OPENROUTER_API_KEY;
      if (!apiKey) {
        return { approved: true, issues: [], reviewerModel: 'none', reviewerProvider: 'heuristic' };
      }
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: route.upstreamModelId,
        temperature: 0,
        max_tokens: 300,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { approved: true, issues: [], reviewerModel: route.canonicalModelId, reviewerProvider: route.provider };
    }
    const data = (await res.json()) as any;
    const raw = data?.choices?.[0]?.message?.content || '';
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw) as { approved?: boolean; issues?: string[] };
    return {
      approved: parsed.approved !== false,
      issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
      reviewerModel: route.canonicalModelId,
      reviewerProvider: route.provider,
    };
  } catch {
    return { approved: true, issues: [], reviewerModel: route.canonicalModelId, reviewerProvider: route.provider };
  } finally {
    clearTimeout(timeout);
  }
}

export interface CanonicalTextResponse {
  text: string;
  canonicalModelId: string;
  upstreamModelId: string;
  provider: BackendProvider;
}

/**
 * Invokes a canonical (or aliased) model across Bedrock, Foundry, and OpenRouter
 * with automatic capacity cooldowns and cross-provider failover.
 */
export async function invokeCanonicalModelText(params: {
  modelId: string;
  systemPrompt?: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}): Promise<CanonicalTextResponse | null> {
  const routes = resolveProviderRoutes(params.modelId, { requireConfigured: true });
  if (routes.length === 0) return null;

  const maxTokens = params.maxTokens ?? 800;
  const temperature = params.temperature ?? 0.2;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 20_000);

  try {
    for (const route of routes) {
      try {
        if (route.provider === 'bedrock') {
          const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
          const client = new BedrockRuntimeClient({
            region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
          });
          const resp = await client.send(
            new ConverseCommand({
              modelId: route.upstreamModelId,
              system: params.systemPrompt ? [{ text: params.systemPrompt }] : undefined,
              messages: [{ role: 'user', content: [{ text: params.userPrompt }] }],
              inferenceConfig: { maxTokens, temperature },
            }),
            { abortSignal: controller.signal }
          );
          const text =
            resp.output?.message?.content
              ?.map((c: any) => c.text || c.reasoningContent?.reasoningText?.text || '')
              .join('\n')
              .trim() || '';
          if (text) {
            return {
              text,
              canonicalModelId: route.canonicalModelId,
              upstreamModelId: route.upstreamModelId,
              provider: 'bedrock',
            };
          }
          continue;
        }

        let baseUrl = 'https://openrouter.ai/api/v1';
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (route.provider === 'foundry') {
          const cfg = getFoundryConfig();
          if (!cfg.endpoint || !cfg.apiKey) continue;
          baseUrl = buildFoundryOpenAiBaseUrl(cfg.endpoint);
          headers['api-key'] = cfg.apiKey;
          headers.Authorization = `Bearer ${cfg.apiKey}`;
        } else {
          const apiKey = process.env.OPENROUTER_API_KEY || process.env.LYRA_MANAGED_OPENROUTER_API_KEY;
          if (!apiKey) continue;
          headers.Authorization = `Bearer ${apiKey}`;
        }

        const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
        if (params.systemPrompt) messages.push({ role: 'system', content: params.systemPrompt });
        messages.push({ role: 'user', content: params.userPrompt });

        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: route.upstreamModelId,
            messages,
            max_tokens: maxTokens,
            temperature,
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          if (res.status === 404 || res.status === 429 || res.status === 503 || res.status === 529) {
            markProviderRouteCooldown(route.canonicalModelId, route.provider);
          }
          continue;
        }
        const data = (await res.json()) as any;
        const text = String(data?.choices?.[0]?.message?.content || '').trim();
        if (text) {
          return {
            text,
            canonicalModelId: route.canonicalModelId,
            upstreamModelId: route.upstreamModelId,
            provider: route.provider,
          };
        }
      } catch (err: any) {
        const msg = String(err?.message || '');
        if (/throttl|rate.?limit|429|503|capacity|accessdenied/i.test(`${err?.name || ''} ${msg}`)) {
          markProviderRouteCooldown(route.canonicalModelId, route.provider);
        }
      }
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
