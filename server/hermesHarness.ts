/**
 * Unified Hermes Agent Harness
 * 
 * A self-contained, zero-installation agent runtime.
 * Neither the user's local machine nor AWS needs any external CLI harnesses installed.
 * Models connect directly to this harness via standard tool calling.
 */

import { EventEmitter } from 'events';
import path from 'path';
import os from 'os';
import { Agent, SessionManager } from '@strands-agents/sdk';
import { BedrockModel } from '@strands-agents/sdk/models/bedrock';
import { OpenAIModel } from '@strands-agents/sdk/models/openai';
import { LocalFileStorage, S3Storage } from '@strands-agents/sdk/storage';
import { createNativeTools } from './nativeTools';
import { resolveOptimalModel, type ModelRouteDecision } from './modelRouter';
import { loadProviderCredential } from './providerSecrets';
import { CloudMonitor } from './cloudMonitor';
import type { ModelProviderProfile } from './types';
import type { RunAgentResult } from './processManager';
import type { UnifiedStore } from './unifiedStore';

export interface HermesRunOptions {
  prompt: string;
  cwd: string;
  sessionId: string;
  runId: string;
  processId?: string;
  model?: string;
  signal?: AbortSignal;
  store?: UnifiedStore;
  onChunk?: (delta: string, fullContent: string) => void;
  onToolCall?: (toolCall: any) => void;
  onProgress?: (message: string) => void;
}

export class HermesHarness extends EventEmitter {
  private static instance: HermesHarness;

  public static getInstance(): HermesHarness {
    if (!HermesHarness.instance) {
      HermesHarness.instance = new HermesHarness();
    }
    return HermesHarness.instance;
  }

  /**
   * Builds the Strands model instance for Hermes using Lyra's auto-routed Bedrock model.
   */
  private async createModel(profile?: ModelProviderProfile, customModelId?: string) {
    const modelId = customModelId || 'us.amazon.nova-pro-v1:0';
    const region = 'us-east-2';

    if (profile?.provider === 'openrouter') {
      const secret = await loadProviderCredential(profile);
      if (!secret.apiKey) throw new Error('OpenRouter API credentials missing.');
      return new OpenAIModel({
        api: 'chat',
        modelId,
        apiKey: secret.apiKey,
        maxTokens: 8192,
        temperature: 0.2,
        clientConfig: { baseURL: 'https://openrouter.ai/api/v1' },
      });
    }

    // Default to Amazon Bedrock with AWS credentials from environment or IAM task role
    return new BedrockModel({
      modelId,
      region,
      maxTokens: 8192,
      temperature: 0.2,
      cacheConfig: { strategy: 'auto' },
    });
  }

  /**
   * Executes an autonomous Hermes agent turn directly against the workspace.
   */
  public async execute(options: HermesRunOptions): Promise<RunAgentResult> {
    const {
      prompt,
      cwd,
      sessionId,
      runId,
      processId = `${runId}:hermes:${Date.now()}`,
      model: requestedModel,
      signal,
      store,
      onChunk,
      onProgress,
    } = options;

    let fullContent = '';

    try {
      // 1. Resolve optimal model automatically if not specified
      const optimal = resolveOptimalModel({
        prompt,
        role: 'worker',
      });
      const targetModelId = requestedModel || optimal.modelId;

      onProgress?.(`[Hermes] Connecting ${optimal.modelName} to unified harness...`);

      // 2. Instantiate native tools for file reading, editing, and execution
      const tools = createNativeTools(cwd, {
        signal,
        onToolEvent: (toolCall) => {
          this.emit('tool_call', {
            sessionId,
            runId,
            processId,
            agentType: 'hermes',
            toolCall,
          });
          options.onToolCall?.(toolCall);
        },
      });

      // 3. Create model connection
      let model;
      try {
        const profiles = store?.listModelProviderProfiles() || [];
        const profile = profiles.find((p) => p.enabled) || profiles[0];
        if (!profile) throw new Error('No provider profile');
        model = await this.createModel(profile, targetModelId);
      } catch (err) {
        // Fallback to local Bedrock model
        model = new BedrockModel({
          modelId: targetModelId,
          region: 'us-east-2',
          maxTokens: 8192,
          temperature: 0.2,
        });
      }

      // 4. Hermes System Prompt
      const systemPrompt = `You are Hermes, Lyra's unified autonomous software engineering agent.
You operate directly on the project workspace with tools to read, edit, patch, and verify files.
Rules:
1. Always inspect relevant files before modifying them.
2. Make focused, minimal changes that directly satisfy the objective.
3. Verify your changes by running project checks or inspecting git diff.
4. Never claim code runs or tests pass unless you executed them with your tools.
5. Provide clear, concise summaries of changes made.`;

      const storagePath = store?.getStoragePath() || path.join(os.homedir(), '.lyra', 'strands');
      const agent = new Agent({
        id: `hermes-${processId.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
        name: 'Hermes Agent',
        description: 'Unified autonomous engineering harness for Lyra',
        systemPrompt,
        model,
        tools,
        sessionManager: new SessionManager({
          sessionId: `hermes-${sessionId.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
          storage: new LocalFileStorage(storagePath),
        }),
      });

      // 5. Run agent stream
      const stream = agent.stream(prompt, {
        cancelSignal: signal,
        limits: { turns: 60 },
      });

      while (true) {
        const next = await stream.next();
        if (next.done) {
          break;
        }
        const event = next.value;
        if (
          event.type === 'modelStreamUpdateEvent' &&
          event.event.type === 'modelContentBlockDeltaEvent' &&
          event.event.delta.type === 'textDelta' &&
          event.event.delta.text
        ) {
          const delta = event.event.delta.text;
          fullContent += delta;
          onChunk?.(delta, fullContent);
          this.emit('content_chunk', {
            sessionId,
            runId,
            processId,
            agentType: 'hermes',
            delta,
            fullContent,
          });
        }
      }

      const usage = (agent as any).metrics?.agentInvocations?.reduce((sum: any, inv: any) => ({
        promptTokens: sum.promptTokens + (inv.usage?.inputTokens || 0),
        completionTokens: sum.completionTokens + (inv.usage?.outputTokens || 0),
        totalTokens: sum.totalTokens + (inv.usage?.totalTokens || 0),
      }), { promptTokens: 0, completionTokens: 0, totalTokens: 0 });

      if (usage?.totalTokens) {
        CloudMonitor.getInstance().recordInvocation(targetModelId, usage.promptTokens, usage.completionTokens);
      }

      await agent.shutdown().catch(() => undefined);

      return {
        sessionId,
        runId,
        processId,
        agentType: 'hermes',
        code: 0,
        fullContent,
        usage,
      };
    } catch (err: any) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (this.listenerCount('error') > 0) {
        this.emit('error', {
          sessionId,
          runId,
          processId,
          agentType: 'hermes',
          message: errorMsg,
        });
      } else {
        console.warn(`[HermesHarness] Non-fatal turn error for ${processId}:`, errorMsg);
      }

      return {
        sessionId,
        runId,
        processId,
        agentType: 'hermes',
        code: signal?.aborted ? 130 : 1,
        fullContent,
        error: errorMsg,
        cancelled: Boolean(signal?.aborted),
      };
    }
  }
}
