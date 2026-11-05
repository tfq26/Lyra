/**
 * OpenAI-Compatible Chat Completions & Cloud Session Sync Bridge (`/v1/models` & `/v1/chat/completions`)
 *
 * Allows any local harness — GitHub Copilot Chat (`chatLanguageModels.json`), DeepSeek Harness (`dsh`),
 * OpenCode, Cursor, or CLI tools — to use Lyra's AWS Bedrock Pareto Router and Multi-Model Council
 * as a native model provider while automatically syncing chat history across devices in the cloud.
 */

import type http from 'node:http';
import path from 'node:path';
import type { AHPServer } from './ahpProtocol';
import { BEDROCK_CATALOG } from './modelDecisionEngine';
import { modelCouncil, type CouncilMode } from './modelCouncil';
import { nightShiftRunner } from './nightShift/nightShiftRunner';

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
  councilMode?: CouncilMode;
  policyProfile?: 'frugal' | 'balanced' | 'frontier';
  seatModels?: string[];
  chairModelId?: string;
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

  /**
   * Returns the OpenAI `/v1/models` list including Lyra's virtual routing models
   * (`lyra-auto`, `lyra-council`) and active AWS Bedrock Inference Profiles.
   */
  public listModels() {
    const now = Math.floor(Date.now() / 1000);
    const virtualModels = [
      {
        id: 'lyra',
        object: 'model',
        created: now,
        owned_by: 'lyra-ai',
        name: 'Lyra (Autonomous AI Engineer · Self-Routing)',
        context_window: 200_000,
      },
      {
        id: 'lyra-auto',
        object: 'model',
        created: now,
        owned_by: 'lyra-pareto-router',
        name: 'Lyra Auto (Pareto Bedrock Router · Cloud Synced)',
        context_window: 200_000,
      },
      {
        id: 'lyra-council',
        object: 'model',
        created: now,
        owned_by: 'lyra-multi-model-council',
        name: 'Lyra Council (Pareto-Selected Multi-Model RAG & Cross-Examination)',
        context_window: 300_000,
      },
      {
        id: 'lyra-nightshift',
        object: 'model',
        created: now,
        owned_by: 'lyra-autonomous-nightshift',
        name: 'Lyra Night Shift (Living Repo Brain + Proof Sandbox)',
        context_window: 200_000,
      },
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

  /**
   * Builds a compact cross-device continuity context from the Cloud Session & 24/7 Hermes Memory
   * when a harness on a new device starts a turn.
   */
  public buildCrossDeviceContextPrefix(sessionId: string, workspacePath: string): string {
    const sync = this.ahpServer.syncSessionDelta({
      sessionId,
      sinceSeq: 0,
      workspacePath,
    });

    const recentMessages = sync.deltaMessages.slice(-4);
    const recentMemories = sync.hermesMemory.slice(0, 3);

    if (recentMessages.length === 0 && recentMemories.length === 0) {
      return '';
    }

    const parts: string[] = ['[Lyra Cloud Cross-Device Session Context]'];
    if (recentMessages.length > 0) {
      parts.push(
        'Recent synced turns from cloud session (' +
          sessionId +
          ', seq 1..' +
          sync.latestSeq +
          '):'
      );
      for (const m of recentMessages) {
        parts.push(`- [seq #${m.sequence} ${m.role}]: ${m.content.slice(0, 220)}`);
      }
    }
    if (recentMemories.length > 0) {
      parts.push('24/7 Hermes Repo Memory Insights:');
      for (const mem of recentMemories) {
        parts.push(`- (${mem.topic}): ${mem.consensusSummary}`);
      }
    }
    return parts.join('\n');
  }

  /**
   * Handles `POST /v1/chat/completions` (both SSE streaming and JSON response)
   * while journaling turns into the user's Cloud Session for cross-device sync.
   */
  public async handleChatCompletions(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    body: OpenAiChatCompletionRequest
  ): Promise<void> {
    const requestedModel = (body.model || 'lyra-auto').trim();
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const userMessages = messages.filter((m) => m.role === 'user');
    const lastUserMsg = userMessages[userMessages.length - 1];
    const rawPrompt = lastUserMsg ? extractTextContent(lastUserMsg.content).trim() : '';

    if (!rawPrompt) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: 'messages array must contain at least one user message with text content.',
            type: 'invalid_request_error',
          },
        })
      );
      return;
    }

    const sessionId =
      (req.headers['x-lyra-session-id'] as string) ||
      body.sessionId ||
      'session-main';
    const harnessName =
      (req.headers['x-lyra-harness'] as string) ||
      (req.headers['user-agent']?.includes('VSCode') ? 'vscode-copilot-chat' : 'external-harness');
    const deviceId = (req.headers['x-lyra-device-id'] as string) || 'device-default';
    const workspacePath = body.workspacePath || process.cwd();

    // Ensure cloud session exists
    if (!this.ahpServer.getSession(sessionId)) {
      this.ahpServer.createSession({
        sessionId,
        title: rawPrompt.slice(0, 48),
        workspacePath,
        model: requestedModel,
      });
    }

    // If the client on Device B only sent a single user message, hydrate cross-device context
    const crossDevicePrefix =
      userMessages.length === 1
        ? this.buildCrossDeviceContextPrefix(sessionId, workspacePath)
        : '';
    const enrichedPrompt = crossDevicePrefix
      ? `${crossDevicePrefix}\n\n[Current User Request]\n${rawPrompt}`
      : rawPrompt;

    const completionId = `chatcmpl-lyra-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const isAutoOrUnified =
      requestedModel === 'lyra' ||
      requestedModel === 'lyra-auto' ||
      requestedModel === 'default' ||
      requestedModel === '';

    const hasStackOrErrorTrace =
      /at\s+(?:[A-Za-z0-9_$.]+\s+\()?[A-Za-z0-9_./-]+\.[a-zA-Z0-9]+:\d+(?::\d+)?\)?/.test(rawPrompt) ||
      /(?:TypeError|ReferenceError|SyntaxError|RangeError|Error|Exception):\s+[^\n\r]+/i.test(rawPrompt) ||
      /\b(test(?:s)?\s+failed|failing\s+test(?:s)?|jest\s+failed|reproduce\s+(?:and\s+fix|this\s+bug))\b/i.test(rawPrompt);

    const hasCouncilQuery =
      /\b(convene\s+council|architectural\s+debate|pros\s+and\s+cons|trade-offs?|compare\s+(?:architecture|frameworks|approaches)|multi-perspective|security\s+triangulation)\b/i.test(rawPrompt);

    const isCouncil =
      requestedModel.startsWith('lyra-council') ||
      rawPrompt.toLowerCase().startsWith('/council ') ||
      rawPrompt.toLowerCase().startsWith('@council ') ||
      (isAutoOrUnified && hasCouncilQuery);

    const isNightShift =
      requestedModel === 'lyra-nightshift' ||
      rawPrompt.toLowerCase().startsWith('/nightshift ') ||
      rawPrompt.toLowerCase().startsWith('/repro ') ||
      (isAutoOrUnified && hasStackOrErrorTrace);

    // Helper for OpenAI SSE chunk formatting
    const writeSseChunk = (deltaContent: string, finishReason: string | null = null, resolvedModel = requestedModel) => {
      if (res.writableEnded) return;
      const chunkPayload = {
        id: completionId,
        object: 'chat.completion.chunk',
        created,
        model: resolvedModel,
        choices: [
          {
            index: 0,
            delta: finishReason ? {} : { content: deltaContent },
            finish_reason: finishReason,
          },
        ],
      };
      res.write(`data: ${JSON.stringify(chunkPayload)}\n\n`);
    };

    if (body.stream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Lyra-Session-Id': sessionId,
      });
    }

    try {
      if (isCouncil) {
        const cleanQuestion = rawPrompt.replace(/^(\/council|@council)\s+/i, '');
        this.ahpServer.appendMessage(sessionId, {
          role: 'user',
          content: cleanQuestion,
          harness: harnessName,
          deviceId,
        });

        const councilPolicy =
          body.policyProfile ||
          (requestedModel === 'lyra-council-frugal'
            ? 'frugal'
            : requestedModel === 'lyra-council-frontier'
            ? 'frontier'
            : 'balanced');

        const councilRes = await modelCouncil.analyze({
          question: cleanQuestion,
          workspacePath,
          sessionId,
          mode: body.councilMode,
          policyProfile: councilPolicy,
          seatModels: body.seatModels,
          chairModelId: body.chairModelId,
          onProgress: (status) => {
            if (body.stream) {
              writeSseChunk(`> ${status}\n\n`, null, 'lyra-council');
            }
          },
        });

        this.ahpServer.appendMessage(sessionId, {
          role: 'assistant',
          content: councilRes.formattedMarkdown,
          thinking: `Multi-Model Council (${councilRes.mode}) synthesized across ${councilRes.seats.length} Bedrock models.`,
          lane: 'ask',
          harness: harnessName,
          deviceId,
        });

        if (body.stream) {
          writeSseChunk(councilRes.formattedMarkdown, null, 'lyra-council');
          writeSseChunk('', 'stop', 'lyra-council');
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        const syncState = this.ahpServer.syncSessionDelta({ sessionId, workspacePath });
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'X-Lyra-Session-Id': sessionId,
          'X-Lyra-Latest-Seq': String(syncState.latestSeq),
        });
        res.end(
          JSON.stringify({
            id: completionId,
            object: 'chat.completion',
            created,
            model: 'lyra-council',
            sessionId,
            sequence: syncState.latestSeq,
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: councilRes.formattedMarkdown,
                },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 1850,
              completion_tokens: 620,
              total_tokens: 2470,
            },
          })
        );
        return;
      }

      if (isNightShift) {
        const cleanError = rawPrompt.replace(/^(\/nightshift|\/repro)\s+/i, '').trim();
        this.ahpServer.appendMessage(sessionId, {
          role: 'user',
          content: cleanError,
          harness: harnessName,
          deviceId,
        });

        if (body.stream) {
          writeSseChunk('> 🌙 [Autonomous Night Shift] Booting Living Repo Brain and Proof Sandbox...\n\n', null, 'lyra-nightshift');
        }

        const report = await nightShiftRunner.runInvestigation({
          event: {
            id: `openai-${Date.now()}`,
            source: 'manual',
            repository: workspacePath ? path.basename(workspacePath) : 'local',
            branch: 'main',
            commitSha: 'HEAD',
            errorLog: cleanError,
            receivedAt: new Date().toISOString(),
          },
          workspacePath,
        });

        this.ahpServer.appendMessage(sessionId, {
          role: 'assistant',
          content: report.proofMarkdown,
          thinking: `Autonomous Night Shift investigation completed in ${(report.durationMs / 1000).toFixed(1)}s with status ${report.passedVerification ? 'GREEN' : 'RED'}.`,
          lane: 'fast-patch',
          harness: harnessName,
          deviceId,
        });

        if (body.stream) {
          writeSseChunk(report.proofMarkdown, null, 'lyra-nightshift');
          writeSseChunk('', 'stop', 'lyra-nightshift');
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        const syncState = this.ahpServer.syncSessionDelta({ sessionId, workspacePath });
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'X-Lyra-Session-Id': sessionId,
          'X-Lyra-Latest-Seq': String(syncState.latestSeq),
        });
        res.end(
          JSON.stringify({
            id: completionId,
            object: 'chat.completion',
            created,
            model: 'lyra-nightshift',
            sessionId,
            sequence: syncState.latestSeq,
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: report.proofMarkdown,
                },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: Math.ceil(cleanError.length / 4),
              completion_tokens: Math.ceil(report.proofMarkdown.length / 4),
              total_tokens: Math.ceil((cleanError.length + report.proofMarkdown.length) / 4),
            },
          })
        );
        return;
      }

      // Standard 3-Lane Adaptive & Pareto Bedrock execution (auto-synced to Cloud Session)
      const pinnedModelId =
        requestedModel === 'lyra' ||
        requestedModel === 'lyra-auto' ||
        requestedModel === 'lyra-frugal' ||
        requestedModel === 'lyra-frontier' ||
        requestedModel === 'auto' ||
        requestedModel === 'default'
          ? undefined
          : requestedModel;

      const policyProfile =
        requestedModel === 'lyra-frugal'
          ? 'frugal'
          : requestedModel === 'lyra-frontier'
          ? 'frontier'
          : 'balanced';

      let streamedAny = false;
      const turnResult = await this.ahpServer.executeChatTurn(
        {
          sessionId,
          prompt: enrichedPrompt,
          workspacePath,
          policyProfile,
          pinnedModelId,
        },
        {
          onChunk: (chunk) => {
            if (body.stream && chunk) {
              streamedAny = true;
              writeSseChunk(chunk, null, pinnedModelId || requestedModel);
            }
          },
        }
      );

      if (body.stream) {
        if (!streamedAny && turnResult.content) {
          writeSseChunk(turnResult.content, null, turnResult.route.crossRegionProfileId);
        }
        writeSseChunk('', 'stop', turnResult.route.crossRegionProfileId);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      const syncState = this.ahpServer.syncSessionDelta({ sessionId, workspacePath });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'X-Lyra-Session-Id': sessionId,
        'X-Lyra-Latest-Seq': String(syncState.latestSeq),
      });
      res.end(
        JSON.stringify({
          id: completionId,
          object: 'chat.completion',
          created,
          model: turnResult.route.crossRegionProfileId || requestedModel,
          sessionId,
          sequence: syncState.latestSeq,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: turnResult.content,
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: turnResult.telemetry?.inputTokens ?? 250,
            completion_tokens: turnResult.telemetry?.outputTokens ?? 120,
            total_tokens:
              (turnResult.telemetry?.inputTokens ?? 250) +
              (turnResult.telemetry?.outputTokens ?? 120),
          },
        })
      );
    } catch (err: any) {
      if (body.stream && !res.writableEnded) {
        writeSseChunk(`\n[Lyra Error]: ${err?.message || 'Execution failed'}`, 'stop');
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      if (!res.writableEnded) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              message: err?.message || 'Execution failed',
              type: 'server_error',
            },
          })
        );
      }
    }
  }
}
