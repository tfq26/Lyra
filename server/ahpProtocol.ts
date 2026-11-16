/**
 * Agent Host Protocol (AHP v1.0) Server for Universal Cloud Harness
 *
 * Implements the open Agent Host Protocol standard for 24/7 cloud sessions,
 * cross-device session continuity, 3-lane adaptive routing (Instant Ask, Fast Patch,
 * Full Cloud Swarm), real-time token streaming, and IDE diff delivery.
 */

import { EventEmitter } from 'events';
import type { ExecutionLane, PolicyProfile, TurnTelemetryEvent } from './cloudwatchEmf';
import {
  fastLaneExecutor,
  FastLaneExecutor,
  type FastLanePatchBundle,
} from './fastLaneExecutor';
import type { LyraHarnessGateway } from './gateway';
import {
  triageExecutionLane,
  type IntentTriageDecision,
  type LaneModePreference,
} from './intentTriage';
import { resolveOptimalModel, type ModelRouteDecision } from './modelRouter';
import { modelCouncil, type StrandsMemoryEntry } from './modelCouncil';
import { sqsTaskQueue } from './sqsTaskQueue';
import type { UnifiedStore } from './unifiedStore';

export interface AHPSession {
  sessionId: string;
  title: string;
  workspacePath: string;
  model: string;
  lastLane?: ExecutionLane;
  latestSeq?: number;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  status: 'idle' | 'running' | 'completed' | 'error';
}

export interface AHPMessage {
  id: string;
  sequence: number;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  thinking?: string;
  timestamp: string;
  lane?: ExecutionLane;
  runId?: string;
  harness?: string;
  deviceId?: string;
  telemetry?: Partial<TurnTelemetryEvent>;
  patch?: FastLanePatchBundle;
  artifacts?: Array<{ title: string; path: string; summary?: string }>;
  toolCalls?: Array<{ name: string; args: any; result?: any }>;
}

export interface AHPSessionSyncDelta {
  sessionId: string;
  latestSeq: number;
  sinceSeq: number;
  meta: AHPSession;
  deltaMessages: AHPMessage[];
  strandsMemory: StrandsMemoryEntry[];
}

export interface AHPChatRequest {
  sessionId?: string;
  prompt: string;
  workspacePath?: string;
  modePreference?: LaneModePreference;
  policyProfile?: PolicyProfile;
  pinnedModelId?: string;
  activeFilePath?: string;
  selectionText?: string;
  referencedFiles?: string[];
  finopsMaxBudgetUsd?: number;
}

export interface AHPChatResponse {
  sessionId: string;
  messageId: string;
  lane: ExecutionLane;
  triage: IntentTriageDecision;
  route: ModelRouteDecision;
  content: string;
  runId?: string;
  patch?: FastLanePatchBundle;
  telemetry?: TurnTelemetryEvent;
}

export class AHPServer extends EventEmitter {
  private executor: FastLaneExecutor;
  private gateway?: LyraHarnessGateway;
  private syncSeq = 0;
  private syncedChats = new Map<string, Map<string, { data: any; deleted: boolean; syncSeq: number }>>();
  private syncedTasks = new Map<string, Map<string, { data: any; syncSeq: number }>>();

  constructor(
    private store: UnifiedStore,
    options?: { executor?: FastLaneExecutor; gateway?: LyraHarnessGateway }
  ) {
    super();
    this.executor = options?.executor || fastLaneExecutor;
    this.gateway = options?.gateway;
  }

  public attachGateway(gateway: LyraHarnessGateway): void {
    this.gateway = gateway;
  }

  /**
   * List all cloud sessions stored on this 24/7 harness
   */
  public listSessions(): AHPSession[] {
    const sessions: AHPSession[] = [];

    try {
      const stored = this.store.listSessions();
      for (const s of stored) {
        const full = this.store.getSession(s.id);
        const messages = full?.events.filter((e) => e.type === 'message') || [];
        const lastAssistant = [...messages]
          .reverse()
          .find((e) => (e.payload as any)?.lane)?.payload as any;
        const activeRuns = this.store.listRuns(s.id);
        const isRunning = activeRuns.some(
          (r) => r.state === 'executing' || r.state === 'planning' || r.state === 'verifying'
        );

        sessions.push({
          sessionId: s.id,
          title: s.title || s.id,
          workspacePath: s.workspacePath || process.cwd(),
          model: (s.agentOptions?.model as string) || 'auto',
          lastLane: lastAssistant?.lane,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          messageCount: messages.length,
          status: isRunning ? 'running' : 'idle',
        });
      }
    } catch (err) {
      console.warn('[AHP] Error listing cloud sessions:', err);
    }

    sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return sessions;
  }

  /**
   * Create a new cloud session that persists across all your devices
   */
  public createSession(params: {
    sessionId?: string;
    title?: string;
    workspacePath?: string;
    model?: string;
  }): AHPSession {
    const id = params.sessionId || `session-${Date.now()}`;
    const title = params.title || `Task ${new Date().toLocaleTimeString()}`;
    const workspacePath = params.workspacePath || process.cwd();
    const model = params.model || 'auto';

    if (!this.store.getSession(id)) {
      this.store.createSession({
        id,
        title,
        workspacePath,
        activeAgents: ['antigravity', 'claude_code', 'codex'],
      });
    }

    const meta = this.store.getSession(id)?.meta;

    return {
      sessionId: id,
      title,
      workspacePath,
      model,
      createdAt: meta?.createdAt || new Date().toISOString(),
      updatedAt: meta?.updatedAt || new Date().toISOString(),
      messageCount: 0,
      status: 'idle',
    };
  }

  /**
   * Get complete transcript & events for a cloud session
   */
  public getSession(sessionId: string): {
    meta: AHPSession;
    messages: AHPMessage[];
  } | null {
    const full = this.store.getSession(sessionId);
    if (!full) return null;

    const messages: AHPMessage[] = full.events
      .filter((e) => e.type === 'message')
      .map((e, idx) => {
        const payload = (e.payload as any) || {};
        return {
          id: e.eventId || `evt-${idx}`,
          sequence: idx + 1,
          role: (payload.role || (e.agent === 'user' ? 'user' : 'assistant')) as any,
          content: payload.text || payload.content || String(payload),
          thinking: payload.thinking,
          timestamp: e.timestamp,
          lane: payload.lane,
          runId: payload.runId,
          harness: payload.harness || payload.source,
          deviceId: payload.deviceId,
          telemetry: payload.telemetry,
          patch: payload.patch,
          toolCalls: payload.toolCalls,
        };
      });

    return {
      meta: {
        sessionId: full.meta.id,
        title: full.meta.title,
        workspacePath: full.meta.workspacePath,
        model: (full.meta.agentOptions?.model as string) || 'auto',
        latestSeq: messages.length,
        createdAt: full.meta.createdAt,
        updatedAt: full.meta.updatedAt,
        messageCount: messages.length,
        status: 'idle',
      },
      messages,
    };
  }

  /**
   * Cross-device sequence-delta sync: returns only messages newer than `sinceSeq`
   * along with accumulated 24/7 Strands Repo Memory for the workspace.
   */
  public syncSessionDelta(params?: {
    sessionId?: string;
    sinceSeq?: number;
    workspacePath?: string;
  }): AHPSessionSyncDelta {
    const sinceSeq = Math.max(0, Number(params?.sinceSeq || 0));
    let targetSessionId = params?.sessionId;

    if (!targetSessionId) {
      const all = this.listSessions();
      const matched = params?.workspacePath
        ? all.find((s) => s.workspacePath === params.workspacePath) || all[0]
        : all[0];
      targetSessionId = matched?.sessionId || 'session-main';
    }

    let session = this.getSession(targetSessionId);
    if (!session) {
      this.createSession({
        sessionId: targetSessionId,
        title: 'Cloud Synced Harness Session',
        workspacePath: params?.workspacePath || process.cwd(),
      });
      session = this.getSession(targetSessionId)!;
    }

    const deltaMessages = session.messages.filter((m) => m.sequence > sinceSeq);
    const strandsMemory = modelCouncil.listMemoryEntries(session.meta.workspacePath, 10);

    return {
      sessionId: session.meta.sessionId,
      latestSeq: session.messages.length,
      sinceSeq,
      meta: session.meta,
      deltaMessages,
      strandsMemory,
    };
  }

  /**
   * Append a message to a session (from any device)
   */
  public appendMessage(
    sessionId: string,
    message: {
      role: 'user' | 'assistant';
      content: string;
      thinking?: string;
      lane?: ExecutionLane;
      runId?: string;
      harness?: string;
      deviceId?: string;
      telemetry?: Partial<TurnTelemetryEvent>;
      patch?: FastLanePatchBundle;
      toolCalls?: any[];
    }
  ): string {
    const evt = this.store.appendEvent(sessionId, {
      agent: message.role === 'user' ? 'user' : 'antigravity',
      type: 'message',
      runId: message.runId,
      payload: {
        role: message.role,
        text: message.content,
        thinking: message.thinking,
        lane: message.lane,
        runId: message.runId,
        harness: message.harness || 'cloud_harness',
        deviceId: message.deviceId,
        telemetry: message.telemetry,
        patch: message.patch,
        toolCalls: message.toolCalls,
        source: message.harness || 'cloud_harness',
      },
    });
    return evt?.eventId || `msg-${Date.now()}`;
  }

  /**
   * Executes a 3-lane adaptive chat turn (`ask`, `fast-patch`, or `full-swarm`) with optional streaming callbacks.
   */
  public async executeChatTurn(
    req: AHPChatRequest,
    callbacks?: {
      onTriage?: (triage: IntentTriageDecision, route: ModelRouteDecision) => void;
      onStatus?: (status: string) => void;
      onChunk?: (chunk: string) => void;
    }
  ): Promise<AHPChatResponse> {
    const workspacePath = req.workspacePath || process.cwd();
    let sessionId = req.sessionId;
    if (!sessionId || !this.store.getSession(sessionId)) {
      const created = this.createSession({
        sessionId,
        title: req.prompt.slice(0, 48),
        workspacePath,
        model: req.pinnedModelId || 'auto',
      });
      sessionId = created.sessionId;
    }

    const existingTranscript = this.getSession(sessionId)?.messages || [];
    const conversationHistory = existingTranscript
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-6)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    this.appendMessage(sessionId, {
      role: 'user',
      content: req.prompt,
    });

    const triage = triageExecutionLane({
      prompt: req.prompt,
      modePreference: req.modePreference,
      activeFilePath: req.activeFilePath,
      selectionText: req.selectionText,
      referencedFiles: req.referencedFiles,
    });

    // Lane 0 (Instant Ask) or Lane 1 (Fast Patch)
    if (triage.lane === 'ask' || triage.lane === 'fast-patch') {
      const previewRoute = resolveOptimalModel({
        prompt: req.prompt,
        lane: triage.lane,
        role: triage.lane === 'fast-patch' ? 'coder' : 'worker',
        policyProfile: req.policyProfile,
        pinnedModelId: req.pinnedModelId,
        fileCount: triage.estimatedFileCount,
      });
      callbacks?.onTriage?.(triage, previewRoute);

      const fastResult = await this.executor.execute({
        sessionId,
        prompt: req.prompt,
        lane: triage.lane,
        workspacePath,
        policyProfile: req.policyProfile,
        pinnedModelId: req.pinnedModelId,
        activeFilePath: req.activeFilePath,
        selectionText: req.selectionText,
        referencedFiles: triage.detectedFiles,
        conversationHistory,
        finopsMaxBudgetUsd: req.finopsMaxBudgetUsd,
        onChunk: callbacks?.onChunk,
        onStatus: callbacks?.onStatus,
      });

      const messageId = this.appendMessage(sessionId, {
        role: 'assistant',
        content: fastResult.content,
        thinking: `${triage.rationale} ${fastResult.route.reason}`,
        lane: triage.lane,
        telemetry: fastResult.telemetry,
        patch: fastResult.patch,
      });

      return {
        sessionId,
        messageId,
        lane: triage.lane,
        triage,
        route: fastResult.route,
        content: fastResult.content,
        patch: fastResult.patch,
        telemetry: fastResult.telemetry,
      };
    }

    // Lane 2 (Full Cloud Swarm)
    const swarmRoute = resolveOptimalModel({
      prompt: req.prompt,
      lane: 'full-swarm',
      role: 'planner',
      policyProfile: req.policyProfile,
      pinnedModelId: req.pinnedModelId,
      fileCount: triage.estimatedFileCount,
    });
    callbacks?.onTriage?.(triage, swarmRoute);
    callbacks?.onStatus?.(
      `Enqueuing Lane 2 Full Swarm via SQS + S3 Claim-Check (Lead Planner: ${swarmRoute.modelName})...`
    );

    if (!this.gateway) {
      throw new Error('Harness gateway not attached to AHPServer for Lane 2 swarm dispatch.');
    }

    const dispatched = await this.gateway.dispatchTask({
      sessionId,
      objective: req.prompt,
      workspacePath,
      model: req.pinnedModelId,
      policyProfile: req.policyProfile || 'balanced',
      approvalPolicy: 'risk-gated',
      maxRunBudgetUsd: req.finopsMaxBudgetUsd ?? 1.5,
    });

    await sqsTaskQueue.enqueue({
      runId: dispatched.runId,
      sessionId,
      prompt: req.prompt,
      workspacePath,
      policyProfile: req.policyProfile || 'balanced',
      modelId: swarmRoute.modelId,
    });

    const content = `Dispatched to **Lane 2: Full Cloud Swarm** (Run \`${dispatched.runId}\`).\n\n` +
      `- **Lead Planner**: ${swarmRoute.modelName} (\`${swarmRoute.crossRegionProfileId}\`)\n` +
      `- **Pipeline**: Parallel Git worktree pre-warming, DecisionEngine risk-gated approval, automated verification, and off-critical-path Scribe docs.`;

    callbacks?.onChunk?.(content);

    const messageId = this.appendMessage(sessionId, {
      role: 'assistant',
      content,
      thinking: `${triage.rationale} ${swarmRoute.reason}`,
      lane: 'full-swarm',
      runId: dispatched.runId,
    });

    return {
      sessionId,
      messageId,
      lane: 'full-swarm',
      triage,
      route: swarmRoute,
      content,
      runId: dispatched.runId,
    };
  }

  /**
   * Promotes a previous Lane 0 / Lane 1 conversation turn into a full Lane 2 Cloud Swarm run.
   */
  public async escalateToSwarm(params: {
    sessionId: string;
    prompt?: string;
    workspacePath?: string;
    policyProfile?: PolicyProfile;
    pinnedModelId?: string;
    finopsMaxBudgetUsd?: number;
  }): Promise<AHPChatResponse> {
    const session = this.getSession(params.sessionId);
    const lastUserMessage = [...(session?.messages || [])]
      .reverse()
      .find((m) => m.role === 'user')?.content;
    const objective =
      params.prompt ||
      lastUserMessage ||
      session?.meta.title ||
      'Execute full multi-agent swarm implementation';

    return this.executeChatTurn({
      sessionId: params.sessionId,
      prompt: objective,
      workspacePath: params.workspacePath || session?.meta.workspacePath || process.cwd(),
      modePreference: 'full-swarm',
      policyProfile: params.policyProfile || 'balanced',
      pinnedModelId: params.pinnedModelId,
      finopsMaxBudgetUsd: params.finopsMaxBudgetUsd ?? 1.5,
    });
  }

  /**
   * Synchronize chats and task checkpoints across devices using sequence-delta (`sinceSeq`)
   */
  public syncChatsAndTasks(
    userId: string,
    payload: { sinceSeq?: number; chats?: any[]; tasks?: any[]; deletedChatIds?: string[] }
  ): { latestSeq: number; chats: any[]; tasks: any[]; deletedChatIds: string[] } {
    const sinceSeq = Number(payload.sinceSeq || 0);
    if (!this.syncedChats.has(userId)) this.syncedChats.set(userId, new Map());
    if (!this.syncedTasks.has(userId)) this.syncedTasks.set(userId, new Map());
    const userChats = this.syncedChats.get(userId)!;
    const userTasks = this.syncedTasks.get(userId)!;

    for (const chat of payload.chats || []) {
      if (!chat?.sessionId) continue;
      const existing = userChats.get(chat.sessionId);
      const incomingTime = chat.updatedAt || new Date().toISOString();
      if (!existing || incomingTime >= (existing.data?.updatedAt || '')) {
        this.syncSeq += 1;
        userChats.set(chat.sessionId, {
          data: { ...chat, updatedAt: incomingTime, syncSeq: this.syncSeq },
          deleted: false,
          syncSeq: this.syncSeq,
        });
      }
    }

    for (const cp of payload.tasks || []) {
      if (!cp?.sessionId || !cp?.runId) continue;
      const key = `${cp.sessionId}:${cp.runId}`;
      const existing = userTasks.get(key);
      if (!existing || (cp.sequence ?? 0) >= (existing.data?.sequence ?? 0)) {
        this.syncSeq += 1;
        userTasks.set(key, {
          data: { ...cp, syncSeq: this.syncSeq },
          syncSeq: this.syncSeq,
        });
      }
    }

    for (const delId of payload.deletedChatIds || []) {
      if (!delId) continue;
      this.syncSeq += 1;
      userChats.set(delId, {
        data: { sessionId: delId, updatedAt: new Date().toISOString() },
        deleted: true,
        syncSeq: this.syncSeq,
      });
      for (const key of userTasks.keys()) {
        if (key.startsWith(`${delId}:`)) userTasks.delete(key);
      }
    }

    const chats: any[] = [];
    const deletedChatIds: string[] = [];
    let latestSeq = sinceSeq;
    for (const [sessionId, entry] of userChats.entries()) {
      if (entry.syncSeq > latestSeq) latestSeq = entry.syncSeq;
      if (entry.syncSeq > sinceSeq) {
        if (entry.deleted) {
          deletedChatIds.push(sessionId);
        } else {
          chats.push(entry.data);
        }
      }
    }

    const tasks: any[] = [];
    for (const entry of userTasks.values()) {
      if (entry.syncSeq > latestSeq) latestSeq = entry.syncSeq;
      if (entry.syncSeq > sinceSeq) {
        tasks.push(entry.data);
      }
    }

    return { latestSeq, chats, tasks, deletedChatIds };
  }

  /**
   * Handle JSON-RPC 2.0 AHP request
   */
  public handleRpc(request: { id: string | number; method: string; params?: any }): {
    jsonrpc: '2.0';
    id: string | number;
    result?: any;
    error?: { code: number; message: string; data?: any };
  } {
    const { id, method, params } = request;

    switch (method) {
      case 'ahp/sessions/list': {
        const list = this.listSessions();
        return { jsonrpc: '2.0', id, result: { sessions: list } };
      }

      case 'ahp/sessions/create': {
        const session = this.createSession(params || {});
        return { jsonrpc: '2.0', id, result: session };
      }

      case 'ahp/sessions/get': {
        const sessionId = params?.sessionId;
        if (!sessionId) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Missing sessionId parameter' },
          };
        }
        const data = this.getSession(sessionId);
        if (!data) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32001, message: `Session ${sessionId} not found` },
          };
        }
        return { jsonrpc: '2.0', id, result: data };
      }

      case 'ahp/sessions/sync': {
        const delta = this.syncSessionDelta(params || {});
        return { jsonrpc: '2.0', id, result: delta };
      }

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `AHP Method '${method}' not found` },
        };
    }
  }
}
