/**
 * OpenAI-Compatible Chat Completions & Cloud Session Sync Bridge (`/v1/models` & `/v1/chat/completions`)
 *
 * Lightweight adapter allowing external harnesses to use Lyra's models via OpenAI-compatible endpoints.
 */

import type http from 'node:http';
import type { AHPServer } from './ahpProtocol';
import { BEDROCK_CATALOG } from './modelDecisionEngine';

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

export class OpenAiCompatBridge {
  constructor(private readonly ahpServer: AHPServer) {}

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

    const sessionId = (req.headers['x-lyra-session-id'] as string) || body.sessionId || 'session-main';
    const workspacePath = body.workspacePath || process.cwd();

    const turnResult = await this.ahpServer.executeChatTurn({
      sessionId,
      prompt: rawPrompt,
      workspacePath,
      policyProfile: body.policyProfile || 'balanced',
      pinnedModelId: body.model && !body.model.startsWith('lyra') ? body.model : undefined,
    });

    res.writeHead(200, { 'Content-Type': 'application/json', 'X-Lyra-Session-Id': sessionId });
    res.end(JSON.stringify({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model || 'lyra-auto',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: turnResult.content },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
    }));
  }
}
