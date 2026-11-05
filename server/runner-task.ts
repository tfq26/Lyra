import path from 'node:path';
import fs from 'node:fs';
import { WebSocket } from 'ws';
import { ProcessManager } from './processManager';
import { UnifiedStore, type UnifiedEvent } from './unifiedStore';
import { NativeAgentRuntime, type NativeRunInput } from './nativeAgentRuntime';
import { PostgresEventJournal } from './postgresEventJournal';
import { sqsTaskQueue, type SqsTaskEnvelope } from './sqsTaskQueue';
import type { AgentType } from './types';
import { redactSecrets } from './security';

interface RunnerTaskPayload {
  runtime?: 'native' | 'cli';
  runId: string;
  processId?: string;
  sessionId: string;
  agentType?: Exclude<AgentType, 'orchestrator'>;
  prompt: string;
  workspacePath: string;
  providerProfileId?: string;
  tenantId?: string;
  resume?: boolean;
  model?: string;
}

class RunnerChannel {
  private socket?: WebSocket;
  private stopped = false;
  private readonly pending: string[] = [];
  private reconnecting?: Promise<void>;

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly runId: string,
    private readonly onMessage: (value: any) => void
  ) {}

  private connectOnce(): Promise<WebSocket> {
    const separator = this.url.includes('?') ? '&' : '?';
    const socket = new WebSocket(
      `${this.url}${separator}runner=1&runId=${encodeURIComponent(this.runId)}`,
      { headers: { authorization: `Bearer ${this.token}` } }
    );
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => {
        socket.removeListener('open', onOpen);
        reject(error);
      };
      const onOpen = () => {
        socket.removeListener('error', onError);
        resolve(socket);
      };
      socket.once('error', onError);
      socket.once('open', onOpen);
    });
  }

  public async start() {
    this.socket = await this.connectOnce();
    this.attach(this.socket);
    this.reconnecting = this.reconnectLoop();
    this.send({
      type: 'runner_event',
      sessionId: '',
      runId: this.runId,
      payload: { eventType: 'runner_ready', payload: { runId: this.runId } },
    });
  }

  private attach(socket: WebSocket) {
    socket.on('message', (data) => {
      try {
        this.onMessage(JSON.parse(data.toString()));
      } catch {}
    });
    socket.on('close', () => {
      if (this.socket === socket) this.socket = undefined;
    });
    for (const message of this.pending.splice(0)) socket.send(message);
  }

  private async reconnectLoop() {
    while (!this.stopped) {
      const current = this.socket;
      if (current) await new Promise<void>((resolve) => current.once('close', () => resolve()));
      if (this.stopped) break;
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        const socket = await this.connectOnce();
        this.socket = socket;
        this.attach(socket);
        this.send({
          type: 'runner_event',
          sessionId: '',
          runId: this.runId,
          payload: { eventType: 'runner_ready', payload: { runId: this.runId } },
        });
      } catch {
        /* Retry while the task continues. The persisted event journal remains authoritative. */
      }
    }
  }

  public send(value: unknown) {
    const serialized = JSON.stringify(value);
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(serialized);
    else {
      this.pending.push(serialized);
      while (this.pending.length > 200) this.pending.shift();
    }
  }

  public async close() {
    this.stopped = true;
    this.socket?.close();
    await this.reconnecting?.catch(() => undefined);
  }
}

function makeJournal() {
  if (!process.env.LYRA_DATABASE_HOST) return undefined;
  return new PostgresEventJournal(process.env.LYRA_TENANT_ID || 'local', {
    host: process.env.LYRA_DATABASE_HOST,
    port: Number(process.env.LYRA_DATABASE_PORT || 5432),
    database: process.env.LYRA_DATABASE_NAME || 'lyra',
    username: process.env.LYRA_DATABASE_USER || 'lyra',
    password: process.env.LYRA_DATABASE_PASSWORD || '',
    ssl: process.env.LYRA_DATABASE_SSL !== 'false',
  });
}

async function runNative(payload: RunnerTaskPayload, workspacePath: string) {
  const store = new UnifiedStore(process.env.LYRA_STORAGE_PATH || undefined);
  const journal = makeJournal();
  if (journal) await journal.initialize(store, false);
  if (process.env.LYRA_HOSTED === 'true' && !journal) {
    throw new Error('Hosted native runner requires the PostgreSQL event journal.');
  }
  const token = process.env.LYRA_RUNNER_TOKEN;
  const socketUrl = process.env.LYRA_RUNNER_WS_URL;
  if (!token || !socketUrl?.startsWith('wss://')) {
    throw new Error('Hosted native worker requires authenticated HTTPS WebSocket connectivity to the Lyra API.');
  }
  let channel: RunnerChannel;
  const runtime = new NativeAgentRuntime(store, () => journal?.waitForWrites() || Promise.resolve());

  const send = (eventType: string, data: unknown) =>
    channel.send({
      type: 'runner_event',
      sessionId: payload.sessionId,
      runId: payload.runId,
      payload: { eventType, payload: data },
    });
  store.on('event_appended', (event: UnifiedEvent) => {
    if (!journal) return;
    void journal
      .append(event)
      .then((sequence) => send('unified_event', { ...event, sequence }))
      .catch((error) =>
        process.stderr.write(
          `[LyraRunner] Event persistence failed: ${error instanceof Error ? error.message : String(error)}\n`
        )
      );
  });

  channel = new RunnerChannel(socketUrl, token, payload.runId, (message) => {
    if (message.type !== 'runner_control' || message.runId !== payload.runId) return;
    const command = message.payload?.command;
    if (command === 'approval') {
      void runtime.decideApproval(
        payload.sessionId,
        payload.runId,
        String(message.payload.approvalId),
        message.payload.approved === true
      );
    } else if (command === 'cancel') {
      runtime.cancel(payload.runId);
    }
  });
  await channel.start();
  for (const eventType of [
    'run_started',
    'content_chunk',
    'tool_call',
    'approval_required',
    'error',
    'done',
  ] as const) {
    runtime.on(eventType, (data) => {
      send(eventType, data);
      if (eventType === 'done') channel.close();
    });
  }
  const nativeInput: NativeRunInput = {
    sessionId: payload.sessionId,
    runId: payload.runId,
    prompt: payload.prompt,
    workspacePath,
    providerProfileId: String(payload.providerProfileId || ''),
    tenantId: payload.tenantId || process.env.LYRA_TENANT_ID || 'local',
  };
  try {
    if (payload.resume) {
      const resumed = await runtime.resume(
        nativeInput.sessionId,
        nativeInput.runId,
        nativeInput.providerProfileId,
        nativeInput.tenantId
      );
      if (!resumed) throw new Error('Native agent run has no recoverable checkpoint.');
    } else {
      await runtime.run(nativeInput);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const checkpoint = store.getLatestAgentCheckpoint(payload.sessionId, payload.runId);
    if (checkpoint && (checkpoint.state === 'running' || checkpoint.state === 'paused')) {
      store.saveAgentCheckpoint({
        sessionId: payload.sessionId,
        runId: payload.runId,
        checkpointId: `runner-failed-${Date.now()}`,
        kind: 'failed',
        workspacePath,
        state: 'needs-attention',
        detail: message,
      });
      await journal?.waitForWrites().catch(() => undefined);
    }
    send('error', { sessionId: payload.sessionId, runId: payload.runId, message });
    send('done', {
      sessionId: payload.sessionId,
      runId: payload.runId,
      agentType: 'orchestrator',
      code: 1,
      fullContent: '',
    });
    throw error;
  } finally {
    await channel.close();
    await journal?.close();
  }
}

async function executePayload(payload: RunnerTaskPayload) {
  if (!payload.runId || !payload.sessionId || !payload.prompt) {
    throw new Error('Runner payload is missing required run/session data.');
  }
  const workspacePath = path.resolve(payload.workspacePath || '/workspace');
  if (
    (workspacePath !== '/workspace' && !workspacePath.startsWith('/workspace/')) ||
    !fs.existsSync(workspacePath) ||
    !fs.statSync(workspacePath).isDirectory()
  ) {
    throw new Error('Runner workspace must be an existing directory under /workspace.');
  }
  if (payload.runtime === 'native') {
    await runNative(payload, workspacePath);
    return;
  }
  const manager = new ProcessManager();
  const result = await manager.runAgent({
    agentType: payload.agentType || 'codex',
    prompt: payload.prompt,
    cwd: workspacePath,
    sessionId: payload.sessionId,
    runId: payload.runId,
    processId: payload.processId,
    model: payload.model,
    executionMode: 'safe',
  });
  process.stdout.write(
    `${JSON.stringify({ ...result, fullContent: result.fullContent.slice(-100_000) })}\n`
  );
  if (result.code !== 0) {
    throw new Error(result.error || `Runner task exited with code ${result.code}`);
  }
}

/**
 * Warm Fargate SQS Long-Polling Loop with S3 Claim-Check hydration,
 * `ChangeMessageVisibility` heartbeats, DLQ redrive on failure, and idle scale-to-zero.
 */
async function runWarmSqsWorkerLoop() {
  const maxIdleMs = Number(process.env.LYRA_WARM_WORKER_IDLE_MS || 15 * 60 * 1000);
  let lastActiveAt = Date.now();
  let shuttingDown = false;

  process.on('SIGTERM', () => {
    shuttingDown = true;
  });

  while (!shuttingDown) {
    const task = await sqsTaskQueue.pollOnce({
      waitTimeSeconds: 20,
      visibilityTimeoutSeconds: 180,
    });

    if (!task) {
      if (Date.now() - lastActiveAt >= maxIdleMs) {
        process.stdout.write('[LyraRunner] Warm SQS worker idle threshold reached; scaling down cleanly.\n');
        return;
      }
      continue;
    }

    lastActiveAt = Date.now();
    const stopHeartbeat = sqsTaskQueue.startVisibilityHeartbeat(task.receiptHandle, {
      visibilityTimeoutSeconds: 180,
      intervalMs: 45_000,
    });

    try {
      await executePayload(task.payload as RunnerTaskPayload);
      await sqsTaskQueue.complete(task.receiptHandle);
      lastActiveAt = Date.now();
    } catch (err) {
      process.stderr.write(
        `[LyraRunner] SQS task ${task.envelope.runId} attempt #${task.receiveCount} failed: ${
          err instanceof Error ? err.message : String(err)
        }\n`
      );
      await sqsTaskQueue.releaseForRetry(task.receiptHandle, 15).catch(() => undefined);
    } finally {
      stopHeartbeat();
    }
  }
}

async function main() {
  if (process.env.LYRA_RUNNER_MODE === 'sqs' || process.argv.includes('--sqs-worker')) {
    await runWarmSqsWorkerLoop();
    return;
  }

  const envelopeRaw = process.env.LYRA_RUNNER_ENVELOPE_JSON;
  if (envelopeRaw) {
    const envelope = JSON.parse(envelopeRaw) as SqsTaskEnvelope<RunnerTaskPayload>;
    const hydrated = await sqsTaskQueue.hydratePayload(envelope);
    await executePayload(hydrated);
    return;
  }

  const raw = process.env.LYRA_RUNNER_PAYLOAD_JSON;
  if (!raw) throw new Error('LYRA_RUNNER_PAYLOAD_JSON or LYRA_RUNNER_MODE=sqs is required.');
  const payload = JSON.parse(raw) as RunnerTaskPayload;
  await executePayload(payload);
}

main().catch((error) => {
  process.stderr.write(
    `[LyraRunner] ${String(redactSecrets(error instanceof Error ? error.message : String(error)))}\n`
  );
  process.exitCode = 1;
});
