/**
 * Lyra Central LLM Gateway Proxy
 *
 * Provides:
 * - Zero-Data-Retention (ZDR) & local-only privacy mode enforcement
 * - Streaming, tool-capable single-turn inference (`POST /api/gateway/llm/stream`)
 *   for Gram and external harnesses, with Bedrock + OpenRouter/Ollama routing
 * - Prompt caching (`cachePoint` on Bedrock, `cache_control` on Anthropic/OpenRouter)
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  type ContentBlock,
  type Message,
  type SystemContentBlock,
  type Tool,
} from '@aws-sdk/client-bedrock-runtime';
import { BEDROCK_CATALOG } from './modelDecisionEngine';
import { redactSecretText } from './security';

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
  provider?: 'bedrock' | 'openrouter' | 'openai-compat';
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
  provider: 'bedrock' | 'openrouter' | 'openai-compat';
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

function toBedrockMessages(messages: GatewayLlmMessage[]): Message[] {
  return messages.map((msg) => {
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: [{ text: redactSecretText(msg.content) || ' ' }] };
    }
    const blocks: ContentBlock[] = [];
    for (const block of msg.content) {
      if (block.type === 'text') {
        blocks.push({ text: redactSecretText(block.text) || ' ' });
      } else if (block.type === 'tool_use') {
        blocks.push({ toolUse: { toolUseId: block.id, name: block.name, input: block.input as any } });
      } else if (block.type === 'tool_result') {
        blocks.push({
          toolResult: {
            toolUseId: block.toolUseId,
            content: [{ text: redactSecretText(block.content) || '(empty)' }],
            status: block.isError ? 'error' : 'success',
          },
        });
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

export function listGatewayLlmModels(privacyMode: PrivacyMode = 'standard') {
  const models = BEDROCK_CATALOG.map((m) => ({
    id: m.inferenceProfileId || m.id,
    name: m.name,
    provider: 'bedrock' as const,
    contextWindow: m.metrics.contextWindowTokens,
    supportsPromptCaching: m.supportsPromptCaching,
    zdrCompliant: true,
  }));

  if (privacyMode === 'local-only') {
    return { privacyMode, models: [] };
  }
  return { privacyMode, models };
}

export async function handleGatewayLlmStream(
  req: IncomingMessage,
  res: ServerResponse,
  body: GatewayLlmStreamRequest
): Promise<void> {
  const privacyMode: PrivacyMode = body.privacyMode || (process.env.LYRA_PRIVACY_MODE as PrivacyMode) || 'standard';
  const byok = body.byokConfig;
  const resolvedProvider: 'bedrock' | 'openrouter' | 'openai-compat' =
    byok?.provider === 'ollama' || body.provider === 'openai-compat'
      ? 'openai-compat'
      : body.provider === 'openrouter' || byok?.provider === 'openrouter' || body.model.includes('/')
        ? 'openrouter'
        : 'bedrock';

  const baseUrl =
    byok?.baseUrl ||
    (resolvedProvider === 'openai-compat'
      ? process.env.LYRA_OPENAI_COMPAT_BASE_URL || 'http://127.0.0.1:11434/v1'
      : resolvedProvider === 'openrouter'
        ? 'https://openrouter.ai/api/v1'
        : undefined);

  enforcePrivacyPolicy({
    privacyMode,
    provider: resolvedProvider,
    modelId: byok?.modelId || body.model,
    baseUrl,
  });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  const startedAt = Date.now();
  let abortReason: string | undefined;
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

    if (resolvedProvider === 'bedrock') {
      const client = getBedrockClient();
      const catalogEntry = BEDROCK_CATALOG.find(
        (m) => m.id === body.model || m.inferenceProfileId === body.model
      );
      const supportsCaching = body.supportsPromptCaching ?? catalogEntry?.supportsPromptCaching ?? true;
      const cleanSystem = redactSecretText(body.systemPrompt || '');
      const systemBlocks: SystemContentBlock[] = cleanSystem ? [{ text: cleanSystem }] : [];
      if (supportsCaching && cleanSystem.length >= 1024) {
        systemBlocks.push({ cachePoint: { type: 'default' } } as SystemContentBlock);
      }

      const command = new ConverseStreamCommand({
        modelId: body.model,
        system: systemBlocks.length > 0 ? systemBlocks : undefined,
        messages: toBedrockMessages(body.messages || []),
        toolConfig:
          tools.length > 0
            ? { tools: toBedrockTools(tools, supportsCaching && tools.length >= 2) }
            : undefined,
        inferenceConfig: { maxTokens, temperature: 0.2 },
      });

      const response = await client.send(command, { abortSignal: abortController.signal });
      let text = '';
      let thinking = '';
      let stopReason = 'end_turn';
      let usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number } | undefined;
      const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
      const activeTools = new Map<number, { id: string; name: string; rawInput: string }>();

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
              text += delta.text;
              sendSse(res, { type: 'text_delta', delta: delta.text });
            } else if (delta.reasoningContent?.text) {
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
              try { parsed = entry.rawInput ? JSON.parse(entry.rawInput) : {}; } catch {}
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

      sendSse(res, { type: 'done', result: { text, thinking, toolCalls, stopReason, usage } });
      res.end();
      return;
    }

    // OpenRouter / OpenAI-compat / Ollama SSE proxy
    const cleanBaseUrl = (baseUrl || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
    const apiKey =
      byok?.apiKey?.trim() ||
      (resolvedProvider === 'openrouter' ? process.env.OPENROUTER_API_KEY : undefined);
    if (!apiKey && resolvedProvider !== 'openai-compat') {
      throw new Error('OPENROUTER_API_KEY is missing on Lyra gateway.');
    }

    const upstreamModelId = byok?.modelId || body.model;
    const useAnthropicCache = Boolean(
      body.supportsPromptCaching && (upstreamModelId.includes('anthropic') || upstreamModelId.includes('claude'))
    );

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Title': 'Lyra Gateway',
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const requestBody: Record<string, unknown> = {
      model: upstreamModelId,
      messages: toOpenAiMessages(body.systemPrompt || '', body.messages || [], useAnthropicCache),
      tools: tools.length > 0
        ? tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }))
        : undefined,
      stream: true,
      max_tokens: maxTokens,
      temperature: 0.2,
    };

    if (resolvedProvider === 'openrouter' && privacyMode === 'zdr') {
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
      throw new Error(`Upstream provider error (${upstream.status}): ${errText.slice(0, 300)}`);
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
            thinking += delta.reasoning_content;
            sendSse(res, { type: 'thinking_delta', delta: delta.reasoning_content });
          }
          if (typeof delta?.content === 'string' && delta.content) {
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

    sendSse(res, { type: 'done', result: { text, thinking, toolCalls, stopReason, usage } });
    res.end();
  } catch (err: any) {
    sendSse(res, {
      type: 'error',
      message: err?.message || 'Gateway LLM stream failed.',
      diagnostics: {
        source: 'lyra-gateway',
        provider: resolvedProvider,
        model: body.model,
        privacyMode,
        effort: body.effort || 'medium',
        aborted: abortController.signal.aborted,
        abortReason:
          abortReason ||
          (abortController.signal.reason !== undefined ? String(abortController.signal.reason) : undefined),
        errorName: err?.name,
        errorCode: err?.code,
        httpStatusCode: err?.$metadata?.httpStatusCode,
        awsRequestId: err?.$metadata?.requestId,
        elapsedMs: Date.now() - startedAt,
      },
    });
    res.end();
  }
}
