/**
 * OpenAI-Compatible Chat Completions & Cloud Session Sync Bridge (`/v1/models` & `/v1/chat/completions`)
 *
 * Lightweight adapter allowing external harnesses to use Lyra's models via OpenAI-compatible endpoints.
 */

import type http from 'node:http';
import type { AHPServer } from './ahpProtocol';
import { BEDROCK_CATALOG } from './modelDecisionEngine';
import { extractProjectApiKey, type ProjectRegistry } from './projectRegistry';

export interface OpenAiResponseFormat {
  type: 'text' | 'json_object' | 'json_schema';
  json_schema?: {
    name?: string;
    schema?: Record<string, any>;
    strict?: boolean;
  };
}

export interface OpenAiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{ type: string; text?: string }>;
}

export interface OpenAiChatCompletionRequest {
  model?: string;
  messages: OpenAiChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  sessionId?: string;
  workspacePath?: string;
  policyProfile?: 'frugal' | 'balanced' | 'frontier';
  response_format?: OpenAiResponseFormat;
}

function extractTextContent(content: OpenAiChatMessage['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return String(content || '');
}

export function buildStructuredPrompt(prompt: string, responseFormat?: OpenAiResponseFormat): string {
  if (!responseFormat || responseFormat.type === 'text') return prompt;
  if (responseFormat.type === 'json_object') {
    return `${prompt}\n\n[CRITICAL OUTPUT REQUIREMENT]\nRespond with valid JSON only. Do not include markdown fences or explanatory prose outside the JSON object.`;
  }
  const schemaText = responseFormat.json_schema?.schema
    ? JSON.stringify(responseFormat.json_schema.schema)
    : '{}';
  return `${prompt}\n\n[CRITICAL OUTPUT REQUIREMENT]\nRespond with a single valid JSON value strictly conforming to this JSON Schema (${responseFormat.json_schema?.name || 'response'}):\n${schemaText}\nDo not include markdown fences or any text outside the JSON.`;
}

export function normalizeJsonOutput(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) return fenced[1].trim();
  return trimmed;
}

export class OpenAiCompatBridge {
  constructor(
    private readonly ahpServer: AHPServer,
    private readonly projectRegistry?: ProjectRegistry,
    private readonly isAdminAuthorized?: (req: http.IncomingMessage) => Promise<boolean>
  ) {}

  public listModels() {
    const now = Math.floor(Date.now() / 1000);
    const virtualModels = [
      { id: 'lyra', object: 'model', created: now, owned_by: 'lyra-ai', name: 'Lyra', context_window: 200_000 },
      { id: 'lyra-auto', object: 'model', created: now, owned_by: 'lyra-pareto-router', name: 'Lyra Auto', context_window: 200_000 },
      { id: 'lyra-council', object: 'model', created: now, owned_by: 'lyra-multi-model-council', name: 'Lyra Council', context_window: 300_000 },
      { id: 'lyra-nightshift', object: 'model', created: now, owned_by: 'lyra-autonomous-nightshift', name: 'Lyra Night Shift', context_window: 200_000 },
    ];

    const bedrockModels = BEDROCK_CATALOG.map((m) => ({
      id: m.inferenceProfileId || m.id,
      object: 'model',
      created: now,
      owned_by: m.provider.toLowerCase(),
      name: `${m.name} (Lyra Cloud Synced)`,
      context_window: m.metrics.contextWindowTokens,
    }));

    return {
      object: 'list',
      data: [...virtualModels, ...bedrockModels],
    };
  }

  public buildCrossDeviceContextPrefix(sessionId: string, workspacePath: string): string {
    const sync = this.ahpServer.syncSessionDelta({ sessionId, sinceSeq: 0, workspacePath });
    const recentMessages = sync.deltaMessages.slice(-4);
    if (recentMessages.length === 0) return '';

    const parts: string[] = ['[Lyra Cloud Cross-Device Session Context]'];
    for (const m of recentMessages) {
      parts.push(`- [seq #${m.sequence} ${m.role}]: ${m.content.slice(0, 220)}`);
    }
    return parts.join('\n');
  }

  public async handleChatCompletions(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    body: OpenAiChatCompletionRequest
  ): Promise<void> {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const lastUserMsg = messages.filter((m) => m.role === 'user').pop();
    const rawPrompt = lastUserMsg ? extractTextContent(lastUserMsg.content).trim() : '';

    if (!rawPrompt) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'A user message with text content is required.', type: 'invalid_request_error' } }));
      return;
    }

    const rawKey = extractProjectApiKey(req);
    let projectId: string | undefined;
    let projectPolicy: 'frugal' | 'balanced' | 'frontier' | undefined;
    if (rawKey && this.projectRegistry) {
      const project = this.projectRegistry.authenticate(rawKey);
      if (!project) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid or revoked Lyra project API key.', type: 'authentication_error' } }));
        return;
      }
      const budget = this.projectRegistry.checkBudget(project.id);
      if (!budget.allowed) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: budget.reason || `Budget exceeded for project ${project.name}.`, type: 'insufficient_quota' } }));
        return;
      }
      projectId = project.id;
      projectPolicy = project.defaultPolicyProfile;
    } else if (this.isAdminAuthorized && !(await this.isAdminAuthorized(req))) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Authentication required. Provide a Lyra project API key or session token.', type: 'authentication_error' } }));
      return;
    }

    const baseSessionId = (req.headers['x-lyra-session-id'] as string) || body.sessionId || 'session-main';
    const sessionId = projectId ? `${projectId}:${baseSessionId}` : baseSessionId;
    const workspacePath = body.workspacePath || process.cwd();
    const promptWithFormat = buildStructuredPrompt(rawPrompt, body.response_format);

    const turnResult = await this.ahpServer.executeChatTurn({
      sessionId,
      prompt: promptWithFormat,
      workspacePath,
      policyProfile: body.policyProfile || projectPolicy || 'balanced',
      pinnedModelId: body.model && !body.model.startsWith('lyra') ? body.model : undefined,
    });

    const finalContent = body.response_format && body.response_format.type !== 'text'
      ? normalizeJsonOutput(turnResult.content)
      : turnResult.content;

    const promptTokens = turnResult.telemetry?.inputTokens ?? 0;
    const completionTokens = turnResult.telemetry?.outputTokens ?? 0;
    const totalTokens = promptTokens + completionTokens;
    const estimatedCostUsd = turnResult.telemetry?.estimatedCostUsd ?? 0;

    if (projectId && this.projectRegistry) {
      this.projectRegistry.recordUsage(projectId, estimatedCostUsd, totalTokens);
    }

    res.writeHead(200, { 'Content-Type': 'application/json', 'X-Lyra-Session-Id': sessionId });
    res.end(JSON.stringify({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model || 'lyra-auto',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: finalContent },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
      },
    }));
  }
}
