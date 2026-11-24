/**
 * Lyra Central LLM Gateway Proxy
 *
 * Provides:
 * - Zero-Data-Retention (ZDR) & local-only privacy mode enforcement
 * - Streaming, tool-capable single-turn inference (`POST /api/gateway/llm/stream`)
 *   for Gram and external harnesses, with Bedrock + OpenRouter/Ollama routing
 * - Prompt caching (`cachePoint` on Bedrock, `cache_control` on Anthropic/OpenRouter)
 */

import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  type ContentBlock,
  type Message,
  type SystemContentBlock,
  type Tool,
} from '@aws-sdk/client-bedrock-runtime';
import { BEDROCK_CATALOG, ModelDecisionEngine, type ModelProfile } from './modelDecisionEngine';
import { sharedContextOptimizer } from './contextOptimizer';
import { cloudWatchTelemetry } from './cloudwatchEmf';
import { redactSecretText } from './security';
import {
  buildFoundryOpenAiBaseUrl,
  getFoundryConfig,
  listCanonicalModels,
  markProviderRouteCooldown,
  MODEL_ID_ALIASES,
  resolveProviderRoutes,
  UNIFIED_MODEL_CATALOG,
  type BackendProvider,
  type ProviderRoute,
  type ResolvedProviderRoute,
} from './unifiedModelCatalog';

export type PrivacyMode = 'standard' | 'zdr' | 'local-only';

export type GatewayLlmContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };

export interface GatewayLlmMessage {
  role: 'user' | 'assistant';
  content: string | GatewayLlmContentBlock[];
}

export interface GatewayLlmToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface GatewayLlmStreamRequest {
  model: string;
  sessionId?: string;
  mode?: 'chat' | 'plan' | 'code';
  provider?: 'bedrock' | 'foundry' | 'openrouter' | 'openai-compat';
  privacyMode?: PrivacyMode;
  effort?: 'low' | 'medium' | 'high';
  supportsPromptCaching?: boolean;
  systemPrompt?: string;
  messages: GatewayLlmMessage[];
  tools?: GatewayLlmToolDef[];
  byokConfig?: {
    provider: string;
    modelId: string;
    baseUrl?: string;
    apiKey?: string;
  };
}

const CONTRIBUTOR_MODEL_IDS = new Set([
  'meta/muse-spark-1.3',
]);

export function isLocalEndpointUrl(rawUrl?: string): boolean {
  if (!rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '::1';
  } catch {
    return false;
  }
}

export function enforcePrivacyPolicy(params: {
  privacyMode: PrivacyMode;
  provider: 'bedrock' | 'foundry' | 'openrouter' | 'openai-compat';
  modelId: string;
  baseUrl?: string;
  contributorWarning?: string;
}): void {
  const { privacyMode, provider, modelId, baseUrl, contributorWarning } = params;

  if (privacyMode === 'local-only') {
    if (provider !== 'openai-compat' || !isLocalEndpointUrl(baseUrl)) {
      throw new Error(
        `Privacy policy "local-only" blocks remote provider "${provider}" (${modelId}). Configure a local Ollama/localhost endpoint.`
      );
    }
    return;
  }

  if (privacyMode === 'zdr') {
    if (contributorWarning || CONTRIBUTOR_MODEL_IDS.has(modelId)) {
      throw new Error(
        `Privacy policy "zdr" blocks contributor/training model "${modelId}".`
      );
    }
    if (provider === 'openai-compat' && baseUrl && !isLocalEndpointUrl(baseUrl)) {
      // Non-local custom endpoints cannot guarantee ZDR unless explicitly using OpenRouter ZDR
      throw new Error(
        `Privacy policy "zdr" blocks unverified remote custom endpoint "${baseUrl}".`
      );
    }
  }
}

let cachedBedrockClient: BedrockRuntimeClient | null = null;
function getBedrockClient(): BedrockRuntimeClient {
  if (!cachedBedrockClient) {
    cachedBedrockClient = new BedrockRuntimeClient({
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
    });
  }
  return cachedBedrockClient;
}

function toBedrockMessages(messages: GatewayLlmMessage[], allowToolBlocks = true): Message[] {
  return messages.map((msg) => {
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: [{ text: redactSecretText(msg.content) || ' ' }] };
    }
    const blocks: ContentBlock[] = [];
    for (const block of msg.content) {
      if (block.type === 'text') {
        blocks.push({ text: redactSecretText(block.text) || ' ' });
      } else if (block.type === 'tool_use') {
        if (allowToolBlocks) {
          blocks.push({ toolUse: { toolUseId: block.id, name: block.name, input: block.input as any } });
        } else {
          blocks.push({ text: `[Tool call ${block.name}: ${redactSecretText(JSON.stringify(block.input || {}))}]` });
        }
      } else if (block.type === 'tool_result') {
        if (allowToolBlocks) {
          blocks.push({
            toolResult: {
              toolUseId: block.toolUseId,
              content: [{ text: redactSecretText(block.content) || '(empty)' }],
              status: block.isError ? 'error' : 'success',
            },
          });
        } else {
          blocks.push({
            text: `[Tool result (${block.isError ? 'error' : 'ok'}): ${redactSecretText(block.content) || '(empty)'}]`,
          });
        }
      }
    }
    if (blocks.length === 0) blocks.push({ text: ' ' });
    return { role: msg.role, content: blocks };
  });
}

function toBedrockTools(tools: GatewayLlmToolDef[], withCachePoint: boolean): Tool[] {
  const mapped: Tool[] = tools.map((tool) => ({
    toolSpec: {
      name: tool.name,
      description: tool.description,
      inputSchema: { json: tool.inputSchema as any },
    },
  }));
  if (withCachePoint && mapped.length > 0) {
    mapped.push({ cachePoint: { type: 'default' } } as Tool);
  }
  return mapped;
}

function toOpenAiMessages(systemPrompt: string, messages: GatewayLlmMessage[], useAnthropicCache: boolean): any[] {
  const out: any[] = [];
  if (systemPrompt.trim()) {
    const cleanSystem = redactSecretText(systemPrompt);
    if (useAnthropicCache && cleanSystem.length >= 1024) {
      out.push({
        role: 'system',
        content: [{ type: 'text', text: cleanSystem, cache_control: { type: 'ephemeral' } }],
      });
    } else {
      out.push({ role: 'system', content: cleanSystem });
    }
  }
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      out.push({ role: msg.role, content: redactSecretText(msg.content) });
      continue;
    }
    if (msg.role === 'assistant') {
      const textParts: string[] = [];
      const toolCalls: any[] = [];
      for (const b of msg.content) {
        if (b.type === 'text' && b.text) textParts.push(redactSecretText(b.text));
        else if (b.type === 'tool_use') {
          toolCalls.push({
            id: b.id,
            type: 'function',
            function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
          });
        }
      }
      out.push({
        role: 'assistant',
        content: textParts.join('\n') || (toolCalls.length > 0 ? null : ''),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    } else {
      const textParts: string[] = [];
      for (const b of msg.content) {
        if (b.type === 'text' && b.text) textParts.push(redactSecretText(b.text));
        else if (b.type === 'tool_result') {
          out.push({
            role: 'tool',
            tool_call_id: b.toolUseId,
            content: redactSecretText(b.content) || '(empty)',
          });
        }
      }
      if (textParts.length > 0) out.push({ role: 'user', content: textParts.join('\n') });
    }
  }
  return out;
}

function sendSse(res: ServerResponse, payload: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/** Highest-priority route (lowest `priority` number); in ZDR mode only routes without a contributor warning count. */
function pickPrimaryRoute(routes: ProviderRoute[], privacyMode: PrivacyMode): ProviderRoute | undefined {
  const eligible = privacyMode === 'zdr' ? routes.filter((r) => !r.contributorWarning) : routes;
  return eligible.slice().sort((a, b) => a.priority - b.priority)[0];
}

/** Streaming speed on a 0-100 scale, relative to the fastest model in the catalog. */
function speedScore(tokensPerSecond: number): number {
  const fastest = Math.max(...UNIFIED_MODEL_CATALOG.map((m) => m.metrics.tokensPerSecond), 1);
  return Math.max(0, Math.min(100, Math.round((tokensPerSecond / fastest) * 100)));
}

/**
 * Model list served to clients (Gram, extensions). Existing fields are stable; pricing, scores,
 * workflows and legacy-id aliases let clients route locally without bundling their own catalog.
 * `catalogVersion` is a content hash clients can use as an ETag to skip unchanged refreshes.
 */
export function listGatewayLlmModels(privacyMode: PrivacyMode = 'standard') {
  if (privacyMode === 'local-only') {
    return { privacyMode, catalogVersion: catalogVersionOf([]), models: [] };
  }

  const aliasesByModel = new Map<string, string[]>();
  for (const [alias, canonicalId] of Object.entries(MODEL_ID_ALIASES)) {
    aliasesByModel.set(canonicalId, [...(aliasesByModel.get(canonicalId) ?? []), alias]);
  }

  const models = listCanonicalModels({ privacyMode }).map((m) => {
    const primary = pickPrimaryRoute(m.routes, privacyMode);
    return {
      id: m.id,
      name: m.name,
      family: m.family,
      tier: m.tier,
      contextWindow: m.metrics.contextWindowTokens,
      supportsPromptCaching: m.routes.some((r) => r.supportsPromptCaching),
      zdrCompliant: m.routes.some((r) => !r.contributorWarning),
      providers: m.routes.map((r) => r.provider),
      primaryProvider: primary?.provider,
      pricing: primary
        ? { inputPerMillion: primary.pricing.inputPerMillion, outputPerMillion: primary.pricing.outputPerMillion }
        : undefined,
      scores: {
        coding: m.metrics.codingScore,
        reasoning: m.metrics.reasoningScore,
        toolProficiency: m.metrics.toolProficiency,
        speed: speedScore(m.metrics.tokensPerSecond),
      },
      workflowGroups: m.workflowGroups ?? [],
      contributorWarning: m.routes.find((r) => r.contributorWarning)?.contributorWarning,
      aliases: aliasesByModel.get(m.id) ?? [],
    };
  });

  return { privacyMode, catalogVersion: catalogVersionOf(models), models };
}

function catalogVersionOf(models: unknown[]): string {
  return createHash('sha1').update(JSON.stringify(models)).digest('hex').slice(0, 16);
}

function isCapacityOrTransientError(err: any, httpStatus?: number): { retryable: boolean; isCapacity: boolean } {
  const errName = String(err?.name || '');
  const errMsg = String(err?.message || '');
  const status = httpStatus ?? err?.$metadata?.httpStatusCode ?? err?.status;
  const isAccessDenied =
    errName === 'AccessDeniedException' ||
    status === 403 ||
    status === 404 ||
    /not available for this account|not authorized|model.*not found|end of life|model identifier is invalid|invalid model|DeploymentNotFound|deployment for this resource does not exist/i.test(errMsg);
  const isThrottle =
    errName === 'ThrottlingException' ||
    status === 429 ||
    status === 503 ||
    status === 529 ||
    /too many requests|throttl|rate.?limit|capacity|overloaded|service unavailable/i.test(errMsg);
  return { retryable: isAccessDenied || isThrottle, isCapacity: isThrottle || isAccessDenied };
}

export async function handleGatewayLlmStream(
  req: IncomingMessage,
  res: ServerResponse,
  body: GatewayLlmStreamRequest
): Promise<void> {
  const privacyMode: PrivacyMode = body.privacyMode || (process.env.LYRA_PRIVACY_MODE as PrivacyMode) || 'standard';
  const byok = body.byokConfig;
  const initialProvider: 'bedrock' | 'foundry' | 'openrouter' | 'openai-compat' =
    byok?.provider === 'ollama' || body.provider === 'openai-compat'
      ? 'openai-compat'
      : byok?.provider === 'foundry' || body.provider === 'foundry'
        ? 'foundry'
        : body.provider === 'openrouter' || byok?.provider === 'openrouter' || body.model.includes('/')
          ? 'openrouter'
          : 'bedrock';

  const initialBaseUrl =
    byok?.baseUrl ||
    (initialProvider === 'openai-compat'
      ? process.env.LYRA_OPENAI_COMPAT_BASE_URL || 'http://127.0.0.1:11434/v1'
      : initialProvider === 'foundry'
        ? getFoundryConfig().endpoint
        : initialProvider === 'openrouter'
          ? 'https://openrouter.ai/api/v1'
          : undefined);

  enforcePrivacyPolicy({
    privacyMode,
    provider: initialProvider,
    modelId: byok?.modelId || body.model,
    baseUrl: initialBaseUrl,
  });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  const startedAt = Date.now();
  let abortReason: string | undefined;
  let activeModelId = body.model;
  let activeProvider: 'bedrock' | 'foundry' | 'openrouter' | 'openai-compat' = initialProvider;
  const abortController = new AbortController();
  req.on('aborted', () => {
    abortReason = 'client_request_aborted';
    abortController.abort('client_request_aborted');
  });
  res.on('close', () => {
    if (!res.writableEnded) {
      abortReason = 'client_response_closed';
      abortController.abort('client_response_closed');
    }
  });

  try {
    const tools = Array.isArray(body.tools) ? body.tools : [];
    const maxTokens = body.effort === 'high' ? 8192 : body.effort === 'low' ? 2048 : 4096;
    const sessionIdHeader = Array.isArray(req.headers['x-lyra-session-id'])
      ? req.headers['x-lyra-session-id'][0]
      : req.headers['x-lyra-session-id'];
    const optimized = sharedContextOptimizer.optimizeGatewayTurn({
      sessionId: body.sessionId || sessionIdHeader,
      messages: body.messages || [],
    });
    const optimizedMessages = optimized.messages;

    const extractLastUserPrompt = (): string => {
      const msgs = body.messages || [];
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (!m || m.role !== 'user') continue;
        if (typeof m.content === 'string' && m.content.trim()) return m.content.trim();
        if (Array.isArray(m.content)) {
          const textPart = m.content.find((b) => b.type === 'text' && b.text?.trim());
          if (textPart && textPart.type === 'text') return textPart.text.trim();
        }
      }
      return 'General coding question';
    };

    const isAuto = body.model === 'auto';

    // Build ordered execution routes across Bedrock, Foundry, and OpenRouter
    interface ExecutionAttempt {
      provider: 'bedrock' | 'foundry' | 'openrouter' | 'openai-compat';
      upstreamModelId: string;
      canonicalModelId?: string;
      supportsPromptCaching: boolean;
      baseUrl?: string;
      apiKey?: string;
    }

    const buildConfiguredAutoCatalog = (): ModelProfile[] => {
      const configured: ModelProfile[] = [];
      for (const cm of listCanonicalModels()) {
        const routes = resolveProviderRoutes(cm.id, {
          privacyMode,
          requireConfigured: true,
        });
        const healthyRoutes = routes.filter(
          (r) => !r.inCooldown && !ModelDecisionEngine.isAccessDenied(r.upstreamModelId)
        );
        if (healthyRoutes.length === 0) continue;
        const primaryRoute = healthyRoutes[0]!;
        configured.push({
          id: cm.id,
          name: cm.name,
          provider: primaryRoute.provider,
          tier: cm.tier as 1 | 2 | 3 | 4,
          inferenceProfileId: primaryRoute.upstreamModelId,
          supportsPromptCaching: primaryRoute.supportsPromptCaching,
          supportsToolStreaming: true,
          pricing: primaryRoute.pricing,
          metrics: cm.metrics,
          strengths: cm.strengths,
        });
      }
      return configured.length > 0 ? configured : BEDROCK_CATALOG;
    };

    const attempts: ExecutionAttempt[] = [];
    const seenAttemptKeys = new Set<string>();
    const pushAttempt = (attempt: ExecutionAttempt) => {
      const key = `${attempt.provider}:${attempt.upstreamModelId}`;
      if (seenAttemptKeys.has(key)) return;
      seenAttemptKeys.add(key);
      attempts.push(attempt);
    };

    if (byok || initialProvider === 'openai-compat') {
      pushAttempt({
        provider: initialProvider,
        upstreamModelId: byok?.modelId || body.model,
        supportsPromptCaching: Boolean(body.supportsPromptCaching),
        baseUrl: initialBaseUrl,
        apiKey: byok?.apiKey?.trim(),
      });
    } else if (isAuto) {
      const autoCatalog = buildConfiguredAutoCatalog();
      const decision = ModelDecisionEngine.decideOptimalModel(
        {
          prompt: extractLastUserPrompt(),
          lane: body.mode === 'chat' ? 'ask' : 'fast-patch',
          role: body.mode === 'plan' ? 'planner' : 'coder',
          policyProfile:
            body.effort === 'high' ? 'frontier' : body.effort === 'low' ? 'frugal' : 'balanced',
        },
        autoCatalog
      );
      const autoModels: ModelProfile[] = [decision.selectedModel, ...decision.failoverChain];
      for (const m of autoModels) {
        const routes = resolveProviderRoutes(m.id, {
          privacyMode,
          requireConfigured: true,
        });
        if (routes.length > 0) {
          for (const r of routes) {
            if (ModelDecisionEngine.isAccessDenied(r.upstreamModelId)) continue;
            pushAttempt({
              provider: r.provider,
              upstreamModelId: r.upstreamModelId,
              canonicalModelId: r.canonicalModelId,
              supportsPromptCaching: body.supportsPromptCaching ?? r.supportsPromptCaching,
            });
          }
        } else {
          pushAttempt({
            provider: 'bedrock',
            upstreamModelId: m.inferenceProfileId || m.id,
            supportsPromptCaching: body.supportsPromptCaching ?? Boolean(m.supportsPromptCaching),
          });
        }
      }

      // Guaranteed cross-provider fallback tail (verified Foundry deployments + broadly enabled Bedrock/OpenRouter models)
      const guaranteedFallbacks = [
        'gpt-4o',
        'mai-thinking-1',
        'phi-4-reasoning',
        'claude-sonnet-4-6',
        'claude-haiku-4-5',
        'nova-2-lite',
      ];
      for (const fallbackId of guaranteedFallbacks) {
        if (attempts.length >= 8) break;
        const routes = resolveProviderRoutes(fallbackId, {
          privacyMode,
          requireConfigured: true,
        });
        for (const r of routes) {
          if (r.inCooldown || ModelDecisionEngine.isAccessDenied(r.upstreamModelId)) continue;
          pushAttempt({
            provider: r.provider,
            upstreamModelId: r.upstreamModelId,
            canonicalModelId: r.canonicalModelId,
            supportsPromptCaching: body.supportsPromptCaching ?? r.supportsPromptCaching,
          });
        }
      }
    } else {
      const canonicalRoutes: ResolvedProviderRoute[] = resolveProviderRoutes(body.model, {
        privacyMode,
        preferredProvider:
          initialProvider === 'foundry' || initialProvider === 'openrouter'
            ? initialProvider
            : undefined,
        requireConfigured: true,
      });
      if (canonicalRoutes.length > 0) {
        for (const r of canonicalRoutes) {
          pushAttempt({
            provider: r.provider,
            upstreamModelId: r.upstreamModelId,
            canonicalModelId: r.canonicalModelId,
            supportsPromptCaching: body.supportsPromptCaching ?? r.supportsPromptCaching,
          });
        }
      } else {
        pushAttempt({
          provider: initialProvider,
          upstreamModelId: body.model,
          supportsPromptCaching: Boolean(body.supportsPromptCaching),
          baseUrl: initialBaseUrl,
        });
      }
    }

    let lastErr: any = null;
    for (let aIdx = 0; aIdx < attempts.length; aIdx++) {
      const attempt = attempts[aIdx]!;
      activeProvider = attempt.provider;
      activeModelId = attempt.upstreamModelId;
      let streamedAnyDelta = false;

      try {
        if (attempt.provider === 'bedrock') {
          const client = getBedrockClient();
          const isAnthropic = activeModelId.includes('anthropic') || activeModelId.includes('claude');
          const supportsSystemCache = attempt.supportsPromptCaching && (isAnthropic || activeModelId.includes('amazon.nova'));
          const supportsToolsCache = attempt.supportsPromptCaching && isAnthropic;
          const cleanSystem = redactSecretText(body.systemPrompt || '');
          const systemBlocks: SystemContentBlock[] = cleanSystem ? [{ text: cleanSystem }] : [];
          if (supportsSystemCache && cleanSystem.length >= 1024) {
            systemBlocks.push({ cachePoint: { type: 'default' } } as SystemContentBlock);
          }
          if (optimized.workingSetBlock) {
            systemBlocks.push({ text: optimized.workingSetBlock });
          }

          const command = new ConverseStreamCommand({
            modelId: activeModelId,
            system: systemBlocks.length > 0 ? systemBlocks : undefined,
            messages: toBedrockMessages(optimizedMessages, tools.length > 0),
            toolConfig:
              tools.length > 0
                ? { tools: toBedrockTools(tools, supportsToolsCache && tools.length >= 2) }
                : undefined,
            inferenceConfig: { maxTokens, temperature: 0.2 },
          });

          let text = '';
          let thinking = '';
          let stopReason = 'end_turn';
          let usage:
            | { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }
            | undefined;
          const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
          const activeTools = new Map<number, { id: string; name: string; rawInput: string }>();

          const response = await client.send(command, { abortSignal: abortController.signal });
          if (response.stream) {
            for await (const event of response.stream) {
              if (event.contentBlockStart?.start?.toolUse) {
                const idx = event.contentBlockStart.contentBlockIndex ?? 0;
                activeTools.set(idx, {
                  id: event.contentBlockStart.start.toolUse.toolUseId || `tool_${idx}`,
                  name: event.contentBlockStart.start.toolUse.name || 'unknown',
                  rawInput: '',
                });
              } else if (event.contentBlockDelta?.delta) {
                const delta = event.contentBlockDelta.delta as any;
                const idx = event.contentBlockDelta.contentBlockIndex ?? 0;
                if (typeof delta.text === 'string' && delta.text) {
                  streamedAnyDelta = true;
                  text += delta.text;
                  sendSse(res, { type: 'text_delta', delta: delta.text });
                } else if (delta.reasoningContent?.text) {
                  streamedAnyDelta = true;
                  thinking += delta.reasoningContent.text;
                  sendSse(res, { type: 'thinking_delta', delta: delta.reasoningContent.text });
                } else if (delta.toolUse?.input) {
                  const entry = activeTools.get(idx);
                  if (entry) entry.rawInput += delta.toolUse.input;
                }
              } else if (event.contentBlockStop) {
                const idx = event.contentBlockStop.contentBlockIndex ?? 0;
                const entry = activeTools.get(idx);
                if (entry) {
                  let parsed: Record<string, unknown> = {};
                  try {
                    parsed = entry.rawInput ? JSON.parse(entry.rawInput) : {};
                  } catch {}
                  toolCalls.push({ id: entry.id, name: entry.name, input: parsed });
                  activeTools.delete(idx);
                }
              } else if (event.messageStop?.stopReason) {
                stopReason = event.messageStop.stopReason;
              } else if (event.metadata?.usage) {
                usage = {
                  inputTokens: event.metadata.usage.inputTokens ?? 0,
                  outputTokens: event.metadata.usage.outputTokens ?? 0,
                  cacheReadTokens: (event.metadata.usage as any).cacheReadInputTokens ?? 0,
                  cacheWriteTokens: (event.metadata.usage as any).cacheWriteInputTokens ?? 0,
                };
              }
            }
          }

          cloudWatchTelemetry.recordTurn({
            turnId: `gw-${startedAt}-${aIdx}`,
            sessionId: body.sessionId || 'gateway',
            lane: body.mode === 'chat' ? 'ask' : 'fast-patch',
            policyProfile: body.effort === 'high' ? 'frontier' : body.effort === 'low' ? 'frugal' : 'balanced',
            modelId: activeModelId,
            modelName: attempt.canonicalModelId || activeModelId,
            provider: 'bedrock',
            ttftMs: Date.now() - startedAt,
            durationMs: Date.now() - startedAt,
            inputTokens: usage?.inputTokens ?? 0,
            outputTokens: usage?.outputTokens ?? 0,
            cacheReadTokens: usage?.cacheReadTokens ?? 0,
            cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
            estimatedCostUsd: 0,
            failoverCount: aIdx,
            escalatedTier: false,
            throttled: false,
            succeeded: true,
          });

          sendSse(res, {
            type: 'done',
            result: {
              text,
              thinking,
              toolCalls,
              stopReason,
              usage,
              resolvedModelId: activeModelId,
              resolvedProvider: 'bedrock',
              contextOptimization: optimized.stats,
            },
          });
          res.end();
          return;
        }

        // Foundry / OpenRouter / OpenAI-compat / Ollama SSE proxy
        let cleanBaseUrl = (attempt.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
        let apiKey = attempt.apiKey;
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Title': 'Lyra Gateway',
        };

        if (attempt.provider === 'foundry') {
          const foundryCfg = getFoundryConfig({ endpoint: attempt.baseUrl, apiKey });
          if (!foundryCfg.endpoint || !foundryCfg.apiKey) {
            throw new Error('AZURE_FOUNDRY_ENDPOINT and AZURE_FOUNDRY_API_KEY are required for Foundry.');
          }
          cleanBaseUrl = buildFoundryOpenAiBaseUrl(foundryCfg.endpoint);
          apiKey = foundryCfg.apiKey;
          headers['api-key'] = apiKey;
          headers.Authorization = `Bearer ${apiKey}`;
        } else if (attempt.provider === 'openrouter') {
          cleanBaseUrl = 'https://openrouter.ai/api/v1';
          apiKey = apiKey || process.env.OPENROUTER_API_KEY || process.env.LYRA_MANAGED_OPENROUTER_API_KEY;
          if (!apiKey) {
            throw new Error('OPENROUTER_API_KEY is missing on Lyra gateway.');
          }
          headers.Authorization = `Bearer ${apiKey}`;
        } else if (apiKey) {
          headers.Authorization = `Bearer ${apiKey}`;
        }

        const useAnthropicCache = Boolean(
          attempt.supportsPromptCaching && (activeModelId.includes('anthropic') || activeModelId.includes('claude'))
        );

        const effectiveSystem = [body.systemPrompt || '', optimized.workingSetBlock].filter(Boolean).join('\n\n');
        const requestBody: Record<string, unknown> = {
          model: activeModelId,
          messages: toOpenAiMessages(effectiveSystem, optimizedMessages, useAnthropicCache),
          tools: tools.length > 0
            ? tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }))
            : undefined,
          stream: true,
          max_tokens: maxTokens,
          temperature: 0.2,
        };

        if (attempt.provider === 'openrouter' && privacyMode === 'zdr') {
          requestBody.provider = { data_collection: 'deny', zdr: true };
        }

        const upstream = await fetch(`${cleanBaseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
          signal: abortController.signal,
        });

        if (!upstream.ok || !upstream.body) {
          const errText = await upstream.text().catch(() => '');
          const httpErr: any = new Error(`Upstream provider error (${upstream.status}): ${errText.slice(0, 300)}`);
          httpErr.status = upstream.status;
          throw httpErr;
        }

        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let text = '';
        let thinking = '';
        let stopReason = 'stop';
        let usage: { inputTokens: number; outputTokens: number } | undefined;
        const toolMap = new Map<number, { id: string; name: string; rawArgs: string }>();

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const parsed = JSON.parse(payload);
              const choice = parsed.choices?.[0];
              const delta = choice?.delta;
              if (delta?.reasoning_content) {
                streamedAnyDelta = true;
                thinking += delta.reasoning_content;
                sendSse(res, { type: 'thinking_delta', delta: delta.reasoning_content });
              }
              if (typeof delta?.content === 'string' && delta.content) {
                streamedAnyDelta = true;
                text += delta.content;
                sendSse(res, { type: 'text_delta', delta: delta.content });
              }
              if (Array.isArray(delta?.tool_calls)) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  const entry = toolMap.get(idx) ?? {
                    id: tc.id || `tool_${idx}`,
                    name: tc.function?.name || '',
                    rawArgs: '',
                  };
                  if (tc.id) entry.id = tc.id;
                  if (tc.function?.name) entry.name = tc.function.name;
                  if (tc.function?.arguments) entry.rawArgs += tc.function.arguments;
                  toolMap.set(idx, entry);
                }
              }
              if (choice?.finish_reason) stopReason = choice.finish_reason;
              if (parsed.usage) {
                usage = {
                  inputTokens: parsed.usage.prompt_tokens ?? 0,
                  outputTokens: parsed.usage.completion_tokens ?? 0,
                };
              }
            } catch {}
          }
        }

        const toolCalls = Array.from(toolMap.values()).map((entry) => {
          let input: Record<string, unknown> = {};
          try { input = entry.rawArgs ? JSON.parse(entry.rawArgs) : {}; } catch {}
          return { id: entry.id, name: entry.name, input };
        });

        cloudWatchTelemetry.recordTurn({
          turnId: `gw-${startedAt}-${aIdx}`,
          sessionId: body.sessionId || 'gateway',
          lane: body.mode === 'chat' ? 'ask' : 'fast-patch',
          policyProfile: body.effort === 'high' ? 'frontier' : body.effort === 'low' ? 'frugal' : 'balanced',
          modelId: activeModelId,
          modelName: attempt.canonicalModelId || activeModelId,
          provider: attempt.provider,
          ttftMs: Date.now() - startedAt,
          durationMs: Date.now() - startedAt,
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          estimatedCostUsd: 0,
          failoverCount: aIdx,
          escalatedTier: false,
          throttled: false,
          succeeded: true,
        });

        sendSse(res, {
          type: 'done',
          result: {
            text,
            thinking,
            toolCalls,
            stopReason,
            usage,
            resolvedModelId: activeModelId,
            resolvedProvider: attempt.provider,
          },
        });
        res.end();
        return;
      } catch (err: any) {
        lastErr = err;
        const { retryable, isCapacity } = isCapacityOrTransientError(err);
        if (isCapacity && attempt.canonicalModelId && (attempt.provider === 'bedrock' || attempt.provider === 'foundry' || attempt.provider === 'openrouter')) {
          markProviderRouteCooldown(attempt.canonicalModelId, attempt.provider as BackendProvider);
        }
        if (
          attempt.provider === 'bedrock' &&
          (String(err?.name || '') === 'AccessDeniedException' ||
            /model identifier is invalid|not available for this account|model.*not found/i.test(String(err?.message || '')))
        ) {
          ModelDecisionEngine.markAccessDenied(activeModelId);
          if (attempt.canonicalModelId) {
            ModelDecisionEngine.markAccessDenied(attempt.canonicalModelId);
          }
        }
        const canRetry =
          !abortController.signal.aborted &&
          !streamedAnyDelta &&
          aIdx < attempts.length - 1 &&
          retryable;
        if (canRetry) {
          continue;
        }
        throw err;
      }
    }
    if (lastErr) throw lastErr;
  } catch (err: any) {
    sendSse(res, {
      type: 'error',
      message: err?.message || 'Gateway LLM stream failed.',
      diagnostics: {
        source: 'lyra-gateway',
        provider: activeProvider,
        model: activeModelId,
        requestedModel: body.model,
        privacyMode,
        effort: body.effort || 'medium',
        aborted: abortController.signal.aborted,
        abortReason:
          abortReason ||
          (abortController.signal.reason !== undefined ? String(abortController.signal.reason) : undefined),
        errorName: err?.name,
        errorCode: err?.code,
        httpStatusCode: err?.$metadata?.httpStatusCode ?? err?.status,
        awsRequestId: err?.$metadata?.requestId,
        elapsedMs: Date.now() - startedAt,
      },
    });
    res.end();
  }
}
