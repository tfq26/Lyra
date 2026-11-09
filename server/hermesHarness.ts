/**
 * Unified Strands Agent Harness
 * 
 * Powered by AWS Strands Agents SDK (@strands-agents/sdk v1.22.0).
 * Self-contained, cloud-native agent runtime featuring:
 * - ModelRouter + FallbackStrategy for automatic multi-model Bedrock failover
 * - Bedrock prompt caching & auto context management (ContextOffloader)
 * - auxModel offloading for side tasks (summarization, memory)
 * - Process-isolated session state (preventing cross-agent state collisions)
 * - Industrial surgical file editing & polyglot verification
 */

import { EventEmitter } from 'events';
import path from 'path';
import os from 'os';
import { Agent, SessionManager } from '@strands-agents/sdk';
import { BedrockModel } from '@strands-agents/sdk/models/bedrock';
import { OpenAIModel } from '@strands-agents/sdk/models/openai';
import { ModelRouter, RoutingCandidate, FallbackStrategy } from '@strands-agents/sdk/models/routing';
import { LocalFileStorage } from '@strands-agents/sdk/storage';
import { createNativeTools } from './nativeTools';
import { resolveOptimalModel } from './modelRouter';
import { loadProviderCredential } from './providerSecrets';
import { CloudMonitor } from './cloudMonitor';
import type { ModelProviderProfile } from './types';
import type { RunAgentResult } from './processManager';
import type { UnifiedStore } from './unifiedStore';

export interface StrandsRunOptions {
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

export type HermesRunOptions = StrandsRunOptions;

export class StrandsHarness extends EventEmitter {
  private static instance: StrandsHarness;

  public static getInstance(): StrandsHarness {
    if (!StrandsHarness.instance) {
      StrandsHarness.instance = new StrandsHarness();
    }
    return StrandsHarness.instance;
  }

  /**
   * Builds the Strands model instance with automatic multi-model failover.
   */
  private async createModelRouter(profile?: ModelProviderProfile, customModelId?: string) {
    const defaultRegion = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
    const targetModelId = customModelId || 'us.amazon.nova-pro-v1:0';

    const isOpenRouter = profile?.provider === 'openrouter' ||
      targetModelId.includes('/') ||
      targetModelId.startsWith('openrouter:');

    if (isOpenRouter) {
      const cleanModelId = targetModelId.replace(/^openrouter:/, '');
      const secret = profile ? await loadProviderCredential(profile).catch(() => ({} as any)) : {};
      const apiKey = secret.apiKey || process.env.OPENROUTER_API_KEY || process.env.LYRA_MANAGED_OPENROUTER_API_KEY;

      if (!apiKey) {
        throw new Error(`OpenRouter API key is missing. Set OPENROUTER_API_KEY to use '${cleanModelId}'.`);
      }

      return new OpenAIModel({
        api: 'chat',
        modelId: cleanModelId,
        apiKey,
        maxTokens: 8192,
        temperature: 0.2,
        clientConfig: { baseURL: 'https://openrouter.ai/api/v1' },
      });
    }

    // Candidate 1: Primary requested or Pareto-optimal model
    const primaryModel = new BedrockModel({
      modelId: targetModelId,
      region: defaultRegion,
      maxTokens: 8192,
      temperature: 0.2,
      cacheConfig: { strategy: 'auto' },
    });

    // Fallback candidates
    const fallbackCandidates: RoutingCandidate[] = [
      new RoutingCandidate({ model: primaryModel, name: `primary:${targetModelId}` }),
    ];

    if (targetModelId !== 'us.amazon.nova-pro-v1:0') {
      fallbackCandidates.push(
        new RoutingCandidate({
          model: new BedrockModel({
            modelId: 'us.amazon.nova-pro-v1:0',
            region: defaultRegion,
            maxTokens: 8192,
            temperature: 0.2,
            cacheConfig: { strategy: 'auto' },
          }),
          name: 'fallback:nova-pro',
        })
      );
    }

    fallbackCandidates.push(
      new RoutingCandidate({
        model: new BedrockModel({
          modelId: 'us.amazon.nova-lite-v1:0',
          region: defaultRegion,
          maxTokens: 8192,
          temperature: 0.2,
          cacheConfig: { strategy: 'auto' },
        }),
        name: 'fallback:nova-lite',
      })
    );

    return new ModelRouter(fallbackCandidates, {
      strategy: new FallbackStrategy(),
      maxSwitches: 3,
    });
  }

  /**
   * Executes an autonomous Strands agent turn directly against the workspace.
   */
  public async execute(options: StrandsRunOptions): Promise<RunAgentResult> {
    const {
      prompt,
      cwd,
      sessionId,
      runId,
      processId = `${runId}:strands:${Date.now()}`,
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

      onProgress?.(`[Strands] Connecting ${optimal.modelName} via AWS Bedrock ModelRouter...`);

      // 2. Instantiate native tools with surgical edit_file, git_grep fallback, and polyglot run_check
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

      // 3. Create model router with resilient fallbacks
      const defaultRegion = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
      let model;
      try {
        const profiles = store?.listModelProviderProfiles() || [];
        const profile = profiles.find((p) => p.enabled) || profiles[0];
        model = await this.createModelRouter(profile, targetModelId);
      } catch (err) {
        // Fallback to direct Bedrock model router
        model = await this.createModelRouter(undefined, targetModelId);
      }

      // Fast, lightweight auxiliary model for background context management & summarization
      const auxModel = new BedrockModel({
        modelId: 'us.amazon.nova-lite-v1:0',
        region: defaultRegion,
        maxTokens: 4096,
        temperature: 0.1,
      });

      // 4. Autonomous Engineering System Prompt
      const systemPrompt = `You are Lyra's autonomous software engineering agent powered by AWS Bedrock and Strands SDK.
You operate directly on the project workspace with tools to read, edit, patch, and verify files.
Rules:
1. Always inspect relevant files before modifying them (use read_file or search_files).
2. For code modifications, prefer edit_file to surgically replace target code blocks with exact whitespace matching.
3. Verify your changes by running project checks (run_check with build/typecheck/test) or inspecting git_diff.
4. Never claim code runs or tests pass unless you executed them with your tools.
5. Provide clear, concise summaries of changes made.`;

      // 5. Build agent with process-isolated session storage (eliminates cross-worker session collisions)
      const storagePath = store?.getStoragePath() || path.join(os.homedir(), '.lyra', 'strands');
      const isolatedSessionKey = `strands-${processId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

      const agent = new Agent({
        id: `agent-${processId.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
        name: 'Strands Engineering Agent',
        description: 'Cloud-native autonomous engineering harness for Lyra',
        systemPrompt,
        model,
        auxModel,
        tools,
        contextManager: 'auto',
        sessionManager: new SessionManager({
          sessionId: isolatedSessionKey,
          storage: new LocalFileStorage(storagePath),
        }),
      });

      // 6. Run agent stream
      const stream = agent.stream(prompt, {
        cancelSignal: signal,
        limits: { turns: 35 },
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
        console.warn(`[StrandsHarness] Non-fatal turn error for ${processId}:`, errorMsg);
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

// Backward-compatible alias
export const HermesHarness = StrandsHarness;
