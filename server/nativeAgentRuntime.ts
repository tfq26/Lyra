import { EventEmitter } from 'node:events';
import { Agent } from '@strands-agents/sdk';
import { HumanInTheLoop } from '@strands-agents/sdk/vended-interventions/hitl';
import type { ModelProviderProfile } from './types';
import type { UnifiedStore } from './unifiedStore';
import { getNativeAgent } from './modelFactory';
import { createNativeTools } from './nativeTools';
import { redactSecrets } from './security';

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
}
interface PendingApproval { id: string; sessionId: string; runId: string; resolve: (answer: string) => void; }
interface ActiveAgent { sessionId: string; controller: AbortController; agent?: Agent; }

function redactApprovalPrompt(prompt: string): string {
  return prompt
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|AKIA[A-Z0-9]{16})\b/g, '[redacted credential]')
    .replace(/((?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*)([^\s,;]+)/gi, '$1[redacted]')
    .slice(0, 4000);
}

export class NativeAgentRuntime extends EventEmitter {
  private readonly active = new Map<string, ActiveAgent>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly cancelledBeforeStart = new Set<string>();

  constructor(private readonly store: UnifiedStore, private readonly persistEvents: () => Promise<void> = async () => undefined) { super(); }

  public async run(input: NativeRunInput): Promise<void> {
    if (this.active.has(input.runId)) throw new Error('This Lyra agent run is already active.');
    if ([...this.active.values()].some((active) => active.sessionId === input.sessionId)) throw new Error('This conversation already has an active Lyra run.');
    const profile = this.store.listModelProviderProfiles().find((item) => item.id === input.providerProfileId);
    if (!profile) throw new Error('Choose a saved Bedrock or OpenRouter connection in Settings before using Lyra.');
    const compatibility = this.store.getModelCompatibility(profile.id);
    if (!compatibility) throw new Error('Run the model compatibility check in Settings before starting a coding session.');
    const required = ['toolCalling', 'cancellation', 'sessionResume'] as const;
    const missing = required.filter((capability) => !compatibility.capabilities[capability]?.passed);
    if (missing.length) throw new Error(`This model has limited compatibility for long coding sessions: ${missing.join(', ')} did not pass. Choose another model or use it only for supported tasks.`);
    if (process.env.LYRA_HOSTED === 'true' && !input.tenantId) throw new Error('Authenticated tenant context is required for hosted agent runs.');
    const state: ActiveAgent = { sessionId: input.sessionId, controller: new AbortController() };
    this.active.set(input.runId, state);
    if (this.cancelledBeforeStart.delete(input.runId)) state.controller.abort();
    try {
    const start = this.store.saveAgentCheckpoint({ sessionId: input.sessionId, runId: input.runId, checkpointId: `cp-${Date.now()}`, kind: 'turn-started', workspacePath: input.workspacePath, state: 'running' });
    await this.persistEvents();
    this.emit('run_started', { sessionId: input.sessionId, runId: input.runId, sequence: start.sequence, agentType: 'orchestrator' });
      const tools = createNativeTools(input.workspacePath, {
        signal: state.controller.signal,
        onToolEvent: async (toolCall) => {
        const safeInput = { ...(toolCall.input as Record<string, unknown> || {}) };
        if ('content' in safeInput) safeInput.content = '[file content omitted]';
        if ('files' in safeInput) safeInput.files = '[batch files omitted]';
        if ('patch' in safeInput) safeInput.patch = '[patch content omitted]';
        if (toolCall.name === 'run_command') safeInput.command = '[command requires approval]';
        const safeToolCall = { id: `${input.runId}:${toolCall.name}:${Date.now()}`, name: toolCall.name, args: safeInput, status: toolCall.status === 'failed' ? 'error' : toolCall.status === 'completed' ? 'completed' : 'running', timestamp: new Date().toISOString() };
        this.store.appendEvent(input.sessionId, { agent: 'orchestrator', type: 'tool_call', runId: input.runId, payload: safeToolCall });
        await this.persistEvents();
        this.emit('tool_call', { sessionId: input.sessionId, runId: input.runId, agentType: 'orchestrator', toolCall: safeToolCall });
        if (toolCall.status === 'completed' || toolCall.status === 'failed') {
          this.store.saveAgentCheckpoint({ sessionId: input.sessionId, runId: input.runId, checkpointId: `cp-${Date.now()}`, kind: 'tool-completed', workspacePath: input.workspacePath, state: 'running', detail: `tool:${toolCall.name}:${toolCall.status}` });
          await this.persistEvents();
        }
      },
      });
      const approval = new HumanInTheLoop({
      allowedTools: ['list_files', 'read_file', 'search_files', 'write_file', 'write_files', 'apply_patch', 'git_status', 'git_diff'],
      ask: async (prompt) => this.waitForApproval(input, prompt),
      });
      const agent = await getNativeAgent(profile, input.sessionId, this.store.getStoragePath(), input.tenantId || 'local', tools, [approval]);
      state.agent = agent;
      const stream = agent.stream(input.prompt, { cancelSignal: state.controller.signal, limits: { turns: 80 } });
      let streamedContent = '';
      let result;
      while (true) {
        const next = await stream.next();
        if (next.done) { result = next.value; break; }
        const event = next.value;
        if (event.type === 'modelStreamUpdateEvent' && event.event.type === 'modelContentBlockDeltaEvent' && event.event.delta.type === 'textDelta' && event.event.delta.text) {
          streamedContent += event.event.delta.text;
          this.emit('content_chunk', { sessionId: input.sessionId, runId: input.runId, agentType: 'orchestrator', chunk: event.event.delta.text, fullContent: streamedContent });
        }
      }
      const text = result.lastMessage.content.filter((part): part is typeof part & { text: string } => 'text' in part).map((part) => part.text).join('');
      if (text) this.store.appendEvent(input.sessionId, { agent: 'orchestrator', type: 'message', runId: input.runId, payload: { text } });
      const usage = result.metrics?.agentInvocations.reduce((sum, invocation) => ({
        inputTokens: sum.inputTokens + (invocation.usage?.inputTokens || 0),
        outputTokens: sum.outputTokens + (invocation.usage?.outputTokens || 0),
        totalTokens: sum.totalTokens + (invocation.usage?.totalTokens || 0),
      }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 }) || { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
      if (usage.totalTokens) this.store.appendEvent(input.sessionId, {
        agent: 'orchestrator', type: 'status', runId: input.runId,
        payload: { providerUsage: { provider: profile.provider, model: profile.model, credentialMode: profile.credentialMode || 'byo', ...usage, cost: 'unavailable' } },
      });
      const wasCancelled = result.stopReason === 'cancelled';
      const completed = result.stopReason === 'endTurn' || result.stopReason === 'stopSequence';
      const final = this.store.saveAgentCheckpoint({ sessionId: input.sessionId, runId: input.runId, checkpointId: `cp-${Date.now()}`, kind: wasCancelled ? 'cancelled' : completed ? 'turn-completed' : 'failed', workspacePath: input.workspacePath, state: wasCancelled ? 'paused' : completed ? 'completed' : 'needs-attention', detail: result.stopReason });
      await this.persistEvents();
      this.emit('done', { sessionId: input.sessionId, runId: input.runId, agentType: 'orchestrator', code: wasCancelled ? 130 : completed ? 0 : 1, fullContent: text, sequence: final.sequence, usage: usage.totalTokens ? { promptTokens: usage.inputTokens, completionTokens: usage.outputTokens, totalTokens: usage.totalTokens } : undefined });
    } catch (error) {
      const message = String(redactSecrets(error instanceof Error ? error.message : String(error)));
      const checkpoint = this.store.getLatestAgentCheckpoint(input.sessionId, input.runId);
      const needsAttention = checkpoint?.state === 'paused';
      this.store.saveAgentCheckpoint({ sessionId: input.sessionId, runId: input.runId, checkpointId: `cp-${Date.now()}`, kind: 'failed', workspacePath: input.workspacePath, state: needsAttention ? 'needs-attention' : 'failed', detail: message });
      this.store.appendEvent(input.sessionId, { agent: 'orchestrator', type: 'error', runId: input.runId, payload: { message } });
      await this.persistEvents().catch(() => undefined);
      this.emit('error', { sessionId: input.sessionId, runId: input.runId, agentType: 'orchestrator', message });
      this.emit('done', { sessionId: input.sessionId, runId: input.runId, agentType: 'orchestrator', code: 1, fullContent: '' });
    } finally {
      this.active.delete(input.runId);
      await state.agent?.shutdown().catch(() => undefined);
    }
  }

  private async waitForApproval(input: NativeRunInput, prompt: string): Promise<string> {
    const id = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const safePrompt = redactApprovalPrompt(prompt);
    const checkpoint = this.store.saveAgentCheckpoint({ sessionId: input.sessionId, runId: input.runId, checkpointId: id, kind: 'approval-requested', workspacePath: input.workspacePath, state: 'paused', detail: safePrompt.slice(0, 2000) });
    this.store.appendEvent(input.sessionId, { agent: 'orchestrator', type: 'status', runId: input.runId, payload: { approvalRequired: { id, prompt: safePrompt, sequence: checkpoint.sequence } } });
    await this.persistEvents();
    this.emit('approval_required', { sessionId: input.sessionId, runId: input.runId, approvalId: id, prompt: safePrompt, sequence: checkpoint.sequence });
    return new Promise((resolve) => this.pendingApprovals.set(id, { id, sessionId: input.sessionId, runId: input.runId, resolve }));
  }

  public async decideApproval(sessionId: string, runId: string, approvalId: string, approved: boolean): Promise<boolean> {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending || pending.sessionId !== sessionId || pending.runId !== runId) return false;
    this.store.saveAgentCheckpoint({ sessionId, runId, checkpointId: approvalId, kind: 'approval-resolved', workspacePath: this.store.getLatestAgentCheckpoint(sessionId, runId)?.workspacePath || process.cwd(), state: 'running', detail: approved ? 'approved' : 'rejected' });
    this.store.appendEvent(sessionId, { agent: 'user', type: 'status', runId, payload: { approvalResolved: { approvalId, approved } } });
    await this.persistEvents();
    this.pendingApprovals.delete(approvalId);
    pending.resolve(approved ? 'yes' : 'no');
    return true;
  }

  public cancel(runId: string): boolean {
    const active = this.active.get(runId);
    if (!active) { this.cancelledBeforeStart.add(runId); return true; }
    active.controller.abort();
    active.agent?.cancel();
    return true;
  }

  public async resume(sessionId: string, runId: string, providerProfileId: string, tenantId?: string): Promise<boolean> {
    const checkpoint = this.store.getLatestAgentCheckpoint(sessionId, runId);
    const dispatchedResume = checkpoint?.state === 'running' && checkpoint.kind === 'turn-started' && checkpoint.detail === 'resume-dispatched';
    if (!checkpoint || (!['needs-attention', 'paused'].includes(checkpoint.state) && !dispatchedResume)) return false;
    await this.run({ sessionId, runId, providerProfileId, tenantId, workspacePath: checkpoint.workspacePath, prompt: 'Continue the interrupted coding task from the latest saved conversation and repository state. Inspect the workspace and Git status before acting. Do not repeat any side effect unless you verify whether it already completed.' });
    return true;
  }

  public async runTask(input: NativeTaskRunInput): Promise<NativeTaskRunResult> {
    const profiles = this.store.listModelProviderProfiles();
    const profile = (input.providerProfileId
      ? profiles.find((p) => p.id === input.providerProfileId)
      : profiles.find((p) => p.enabled)) || profiles[0];
    if (!profile) {
      throw new Error('No active model provider profile found for native worker.');
    }

    try {
      const tools = createNativeTools(input.workspacePath, {
        signal: input.signal,
        onToolEvent: async (toolCall) => {
          const safeInput = { ...(toolCall.input as Record<string, unknown> || {}) };
          if ('content' in safeInput) safeInput.content = '[file content omitted]';
          if ('files' in safeInput) safeInput.files = '[batch files omitted]';
          if ('patch' in safeInput) safeInput.patch = '[patch content omitted]';
          const safeToolCall = {
            id: `${input.runId}:${input.taskId}:${toolCall.name}:${Date.now()}`,
            name: toolCall.name,
            args: safeInput,
            status: toolCall.status === 'failed' ? 'error' : toolCall.status === 'completed' ? 'completed' : 'running',
            timestamp: new Date().toISOString(),
          };
          this.store.appendEvent(input.sessionId, {
            agent: 'orchestrator',
            type: 'tool_call',
            runId: input.runId,
            payload: safeToolCall,
          });
          this.emit('tool_call', {
            sessionId: input.sessionId,
            runId: input.runId,
            agentType: 'orchestrator',
            toolCall: safeToolCall,
          });
        },
      });

      const agent = await getNativeAgent(
        profile,
        `${input.sessionId}-${input.taskId}`,
        this.store.getStoragePath(),
        input.tenantId || 'local',
        tools
      );

      const stream = agent.stream(input.prompt, {
        cancelSignal: input.signal,
        limits: { turns: 30 },
      });

      let streamedContent = '';
      let result;
      while (true) {
        const next = await stream.next();
        if (next.done) {
          result = next.value;
          break;
        }
        const event = next.value;
        if (
          event.type === 'modelStreamUpdateEvent' &&
          event.event.type === 'modelContentBlockDeltaEvent' &&
          event.event.delta.type === 'textDelta' &&
          event.event.delta.text
        ) {
          streamedContent += event.event.delta.text;
          this.emit('content_chunk', {
            sessionId: input.sessionId,
            runId: input.runId,
            agentType: 'orchestrator',
            chunk: event.event.delta.text,
            fullContent: streamedContent,
          });
        }
      }

      const text = result?.lastMessage?.content
        ? (result.lastMessage.content as Array<unknown>)
            .filter((part): part is { text: string } => typeof part === 'object' && part !== null && 'text' in part)
            .map((part) => part.text)
            .join('')
        : streamedContent;

      const wasCancelled = result?.stopReason === 'cancelled' || input.signal?.aborted;
      const completed = result?.stopReason === 'endTurn' || result?.stopReason === 'stopSequence';

      return {
        code: wasCancelled ? 130 : completed ? 0 : 0,
        fullContent: text || streamedContent,
        cancelled: wasCancelled,
      };
    } catch (err) {
      return {
        code: 1,
        fullContent: '',
        error: err instanceof Error ? err.message : String(err),
        cancelled: input.signal?.aborted,
      };
    }
  }
}
