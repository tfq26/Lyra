import { EventEmitter } from 'node:events';
import type { UnifiedStore } from './unifiedStore';
import { redactSecrets } from './security';
import { StrandsHarness } from './strandsHarness';

export interface NativeRunInput {
  sessionId: string;
  runId: string;
  prompt: string;
  workspacePath: string;
  providerProfileId: string;
  tenantId?: string;
}

export interface NativeTaskRunInput {
  sessionId: string;
  runId: string;
  taskId: string;
  prompt: string;
  workspacePath: string;
  providerProfileId?: string;
  tenantId?: string;
  signal?: AbortSignal;
}

export interface NativeTaskRunResult {
  code: number;
  fullContent: string;
  error?: string;
  cancelled?: boolean;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

interface PendingApproval {
  id: string;
  sessionId: string;
  runId: string;
  resolve: (answer: string) => void;
}

function redactApprovalPrompt(prompt: string): string {
  return prompt
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|AKIA[A-Z0-9]{16})\b/g, '[redacted credential]')
    .replace(/((?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*)([^\s,;]+)/gi, '$1[redacted]')
    .slice(0, 4000);
}

/**
 * NativeAgentRuntime
 * 
 * Lightweight adapter delegating unified Strands execution to StrandsHarness
 * while preserving checkpointing, compatibility gate checks, and approvals.
 */
export class NativeAgentRuntime extends EventEmitter {
  private readonly active = new Set<string>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(
    private readonly store: UnifiedStore,
    private readonly persistEvents: () => Promise<void> = async () => undefined
  ) {
    super();
  }

  public async run(input: NativeRunInput): Promise<void> {
    if (this.active.has(input.runId)) throw new Error('This Lyra agent run is already active.');
    const profile = this.store.listModelProviderProfiles().find((item) => item.id === input.providerProfileId);
    if (!profile) throw new Error('Choose a saved Bedrock or OpenRouter connection in Settings before using Lyra.');
    const compatibility = this.store.getModelCompatibility(profile.id);
    if (!compatibility) throw new Error('Run the model compatibility check in Settings before starting a coding session.');
    const required = ['toolCalling', 'cancellation', 'sessionResume'] as const;
    const missing = required.filter((capability) => !compatibility.capabilities[capability]?.passed);
    if (missing.length) throw new Error(`This model has limited compatibility for long coding sessions: ${missing.join(', ')} did not pass. Choose another model or use it only for supported tasks.`);
    if (process.env.LYRA_HOSTED === 'true' && !input.tenantId) throw new Error('Authenticated tenant context is required for hosted agent runs.');

    const controller = new AbortController();
    this.active.add(input.runId);
    this.abortControllers.set(input.runId, controller);

    try {
      const start = this.store.saveAgentCheckpoint({
        sessionId: input.sessionId,
        runId: input.runId,
        checkpointId: `cp-${Date.now()}`,
        kind: 'turn-started',
        workspacePath: input.workspacePath,
        state: 'running',
      });
      await this.persistEvents();
      this.emit('run_started', { sessionId: input.sessionId, runId: input.runId, sequence: start.sequence, agentType: 'orchestrator' });

      const res = await StrandsHarness.getInstance().execute({
        sessionId: input.sessionId,
        runId: input.runId,
        processId: input.runId,
        prompt: input.prompt,
        cwd: input.workspacePath,
        signal: controller.signal,
        store: this.store,
        onChunk: (delta, full) => {
          this.emit('content_chunk', { sessionId: input.sessionId, runId: input.runId, agentType: 'orchestrator', chunk: delta, fullContent: full });
        },
        onToolCall: (toolCall) => {
          this.emit('tool_call', { sessionId: input.sessionId, runId: input.runId, agentType: 'orchestrator', toolCall });
        },
      });

      if (res.fullContent) {
        this.store.appendEvent(input.sessionId, { agent: 'orchestrator', type: 'message', runId: input.runId, payload: { text: res.fullContent } });
      }

      const completed = res.code === 0;
      const final = this.store.saveAgentCheckpoint({
        sessionId: input.sessionId,
        runId: input.runId,
        checkpointId: `cp-${Date.now()}`,
        kind: res.cancelled ? 'cancelled' : completed ? 'turn-completed' : 'failed',
        workspacePath: input.workspacePath,
        state: res.cancelled ? 'paused' : completed ? 'completed' : 'needs-attention',
      });
      await this.persistEvents();

      this.emit('done', {
        sessionId: input.sessionId,
        runId: input.runId,
        agentType: 'orchestrator',
        code: res.code,
        fullContent: res.fullContent,
        sequence: final.sequence,
        usage: res.usage,
      });
    } catch (error) {
      const message = String(redactSecrets(error instanceof Error ? error.message : String(error)));
      this.emit('error', { sessionId: input.sessionId, runId: input.runId, agentType: 'orchestrator', message });
      this.emit('done', { sessionId: input.sessionId, runId: input.runId, agentType: 'orchestrator', code: 1, fullContent: '' });
      throw error;
    } finally {
      this.active.delete(input.runId);
      this.abortControllers.delete(input.runId);
    }
  }

  public async runTask(input: NativeTaskRunInput): Promise<NativeTaskRunResult> {
    const res = await StrandsHarness.getInstance().execute({
      sessionId: input.sessionId,
      runId: input.runId,
      processId: `${input.runId}:${input.taskId}`,
      prompt: input.prompt,
      cwd: input.workspacePath,
      signal: input.signal,
      store: this.store,
    });
    return {
      code: res.code,
      fullContent: res.fullContent,
      error: res.error,
      cancelled: res.cancelled,
      usage: res.usage,
    };
  }

  public async decideApproval(sessionId: string, runId: string, approvalId: string, approved: boolean): Promise<boolean> {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending || pending.sessionId !== sessionId || pending.runId !== runId) return false;
    this.pendingApprovals.delete(approvalId);
    pending.resolve(approved ? 'yes' : 'no');
    return true;
  }

  public cancel(runId: string): boolean {
    const controller = this.abortControllers.get(runId);
    if (controller) {
      controller.abort();
      return true;
    }
    return false;
  }

  public async resume(sessionId: string, runId: string, providerProfileId: string, tenantId?: string): Promise<boolean> {
    const checkpoint = this.store.getLatestAgentCheckpoint(sessionId, runId);
    if (!checkpoint) return false;
    await this.run({
      sessionId,
      runId,
      providerProfileId,
      tenantId,
      workspacePath: checkpoint.workspacePath,
      prompt: 'Continue interrupted coding task from latest state.',
    });
    return true;
  }
}
