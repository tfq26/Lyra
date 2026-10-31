import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { WebSocket } from 'ws';
import { UnifiedStore } from './unifiedStore';
import { NativeAgentRuntime } from './nativeAgentRuntime';
import { calculateDirectorySize, killAllActiveProcesses } from './nativeTools';
import type { RunnerNode, WSMessage } from './types';

export interface RunnerDaemonOptions {
  hubUrl: string; // e.g. "ws://localhost:3001" or "wss://hub.lyra.dev"
  token?: string;
  nodeId?: string;
  nodeName?: string;
  nodeType?: 'homelab' | 'local' | 'cloud';
  workspacesDir?: string;
  heartbeatIntervalMs?: number;
  reconnectIntervalMs?: number;
  maxDiskQuotaBytes?: number; // e.g. 2GB max
  taskTimeoutMs?: number; // e.g. 10 minutes max per task
}

interface ActiveRunnerTask {
  sessionId: string;
  runId: string;
  abortController: AbortController;
  timeoutTimer: NodeJS.Timeout;
  sandboxPath: string;
}

export class RunnerDaemon {
  private ws: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private readonly hubUrl: string;
  private readonly token?: string;
  private readonly node: RunnerNode;
  private readonly workspacesDir: string;
  private readonly heartbeatIntervalMs: number;
  private readonly reconnectIntervalMs: number;
  private readonly maxDiskQuotaBytes: number;
  private readonly taskTimeoutMs: number;
  private readonly store: UnifiedStore;
  private readonly nativeRuntime: NativeAgentRuntime;
  private readonly activeTasks = new Map<string, ActiveRunnerTask>();

  constructor(options: RunnerDaemonOptions) {
    this.hubUrl = options.hubUrl;
    this.token = options.token || process.env.LYRA_RUNNER_TOKEN || process.env.LYRA_AUTH_TOKEN;
    const hostname = os.hostname();
    const defaultId = `node-${hostname.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Math.random().toString(36).slice(2, 6)}`;
    
    this.node = {
      id: options.nodeId || defaultId,
      name: options.nodeName || `${hostname} (${os.platform()})`,
      type: options.nodeType || 'homelab',
      os: os.platform(),
      cpus: os.cpus().length,
      memoryMb: Math.round(os.totalmem() / (1024 * 1024)),
      status: 'online',
      lastSeen: new Date().toISOString(),
    };

    const baseDir = options.workspacesDir || process.env.LYRA_RUNNER_DIR || path.join(os.homedir(), '.lyra', 'sandboxes');
    this.workspacesDir = path.resolve(baseDir);
    try {
      if (!fs.existsSync(this.workspacesDir)) {
        fs.mkdirSync(this.workspacesDir, { recursive: true });
      }
      const testFile = path.join(this.workspacesDir, '.write-test-' + Math.random().toString(36).substring(7));
      fs.writeFileSync(testFile, 'ok');
      fs.unlinkSync(testFile);
    } catch {
      // Fallback to temp directory if home directory path is unwriteable
      this.workspacesDir = path.join(os.tmpdir(), 'lyra-sandboxes');
      fs.mkdirSync(this.workspacesDir, { recursive: true });
    }

    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15000;
    this.reconnectIntervalMs = options.reconnectIntervalMs ?? 3000;
    this.maxDiskQuotaBytes = options.maxDiskQuotaBytes ?? 2 * 1024 * 1024 * 1024; // 2 GB default
    this.taskTimeoutMs = options.taskTimeoutMs ?? 600_000; // 10 minutes default

    this.store = new UnifiedStore(path.join(this.workspacesDir, '.lyra-store'));
    this.nativeRuntime = new NativeAgentRuntime(this.store);
  }

  public getNode(): RunnerNode {
    return this.node;
  }

  public start(): Promise<void> {
    this.isRunning = true;
    return this.connect();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const [runId, task] of this.activeTasks) {
      clearTimeout(task.timeoutTimer);
      task.abortController.abort();
    }
    this.activeTasks.clear();
    killAllActiveProcesses();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    console.log(`[Lyra Runner] Node ${this.node.name} (${this.node.id}) stopped and processes killed.`);
  }

  public assertSandboxBoundary(requestedPath?: string): string {
    if (!requestedPath) return this.workspacesDir;
    const root = fs.realpathSync(this.workspacesDir);
    const resolved = path.resolve(this.workspacesDir, requestedPath);
    let realTarget: string;
    try {
      realTarget = fs.realpathSync(resolved);
    } catch {
      let parent = path.dirname(resolved);
      while (parent !== root && !fs.existsSync(parent)) parent = path.dirname(parent);
      const realParent = fs.realpathSync(parent);
      realTarget = path.join(realParent, path.relative(parent, resolved));
    }
    if (realTarget !== root && !realTarget.startsWith(root + path.sep)) {
      throw new Error(`Security Violation: Target path '${requestedPath}' escapes the runner sandbox boundary.`);
    }
    return resolved;
  }

  public checkDiskQuota(): void {
    const currentBytes = calculateDirectorySize(this.workspacesDir);
    if (currentBytes > this.maxDiskQuotaBytes) {
      throw new Error(`Disk Quota Exceeded: Runner sandbox is utilizing ${(currentBytes / (1024 * 1024)).toFixed(1)}MB, exceeding maximum limit of ${(this.maxDiskQuotaBytes / (1024 * 1024)).toFixed(0)}MB.`);
    }
  }

  public cancelTask(runId: string): void {
    const task = this.activeTasks.get(runId);
    if (task) {
      console.log(`[Lyra Runner] Cancelling active task ${runId}...`);
      clearTimeout(task.timeoutTimer);
      task.abortController.abort();
      this.activeTasks.delete(runId);
      killAllActiveProcesses();
    }
  }

  private connect(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.isRunning) return resolve();

      const separator = this.hubUrl.includes('?') ? '&' : '?';
      const urlWithNode = `${this.hubUrl}${separator}nodeId=${encodeURIComponent(this.node.id)}`;

      const headers: Record<string, string> = {};
      if (this.token) {
        headers['Authorization'] = `Bearer ${this.token}`;
      }

      console.log(`[Lyra Runner] Connecting to Hub at ${this.hubUrl} as ${this.node.name} (${this.node.id})...`);

      this.ws = new WebSocket(urlWithNode, { headers });

      this.ws.on('open', () => {
        console.log(`[Lyra Runner] Connected to Hub successfully. Registering node...`);
        this.registerNode();
        this.startHeartbeat();
        resolve();
      });

      this.ws.on('message', async (data) => {
        try {
          const msg = JSON.parse(data.toString());
          await this.handleHubMessage(msg);
        } catch (err) {
          console.error('[Lyra Runner] Error parsing incoming message:', err);
        }
      });

      this.ws.on('close', (code, reason) => {
        console.warn(`[Lyra Runner] Disconnected from Hub (${code}: ${reason.toString() || 'connection closed'}).`);
        if (this.heartbeatTimer) {
          clearInterval(this.heartbeatTimer);
          this.heartbeatTimer = null;
        }
        if (this.isRunning) {
          this.scheduleReconnect();
        }
      });

      this.ws.on('error', (err) => {
        console.error('[Lyra Runner] WebSocket error:', err.message);
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.isRunning) {
        void this.connect();
      }
    }, this.reconnectIntervalMs);
  }

  private registerNode(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.node.lastSeen = new Date().toISOString();
    this.node.status = 'online';

    const msg = {
      type: 'register_node',
      payload: this.node,
    };
    this.ws.send(JSON.stringify(msg));
    console.log(`[Lyra Runner] Node registered with Hub.`);
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'node_heartbeat',
          payload: { id: this.node.id },
        }));
      }
    }, this.heartbeatIntervalMs);
    this.heartbeatTimer.unref();
  }

  private async handleHubMessage(msg: any): Promise<void> {
    if (msg.type === 'run_task') {
      await this.executeTask(msg);
    } else if (msg.type === 'team_run_start') {
      await this.executeTeamRun(msg);
    } else if (msg.type === 'cancel_task' || msg.type === 'abort_task') {
      const runId = msg.runId || msg.payload?.runId;
      if (runId) {
        this.cancelTask(runId);
      }
    }
  }

  private async executeTask(msg: any): Promise<void> {
    const { sessionId, runId, payload } = msg;
    const prompt = payload?.prompt || '';
    const safeRunId = runId || `run-${Date.now()}`;
    const safeSessionId = sessionId || 'session-runner';
    const providerProfileId = payload?.providerProfileId;

    console.log(`[Lyra Runner] Executing task for run ${safeRunId} (Session: ${safeSessionId})...`);
    this.node.status = 'busy';

    let timeoutTimer: NodeJS.Timeout | null = null;
    const abortController = new AbortController();

    try {
      // Security 1: Enforce disk quota before initiating task
      this.checkDiskQuota();

      // Security 2: Enforce sandboxed workspace path strictly inside this.workspacesDir
      const isolatedWorkspace = path.join(this.workspacesDir, 'sandboxes', safeSessionId, safeRunId);
      fs.mkdirSync(isolatedWorkspace, { recursive: true });

      const workspacePath = payload?.workspacePath
        ? this.assertSandboxBoundary(payload.workspacePath)
        : isolatedWorkspace;

      // Security 3: Setup task timeout and process group containment
      timeoutTimer = setTimeout(() => {
        console.warn(`[Lyra Runner] Task ${safeRunId} exceeded timeout of ${this.taskTimeoutMs}ms. Aborting...`);
        abortController.abort();
        killAllActiveProcesses();
      }, this.taskTimeoutMs);

      this.activeTasks.set(safeRunId, {
        sessionId: safeSessionId,
        runId: safeRunId,
        abortController,
        timeoutTimer,
        sandboxPath: workspacePath,
      });

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'unified_event',
          sessionId: safeSessionId,
          runId: safeRunId,
          payload: {
            id: `evt-${Date.now()}`,
            sessionId: safeSessionId,
            runId: safeRunId,
            agent: 'orchestrator',
            type: 'status',
            payload: { text: `[${this.node.name}] Sandboxed workspace initialized (${path.basename(workspacePath)}). Starting task execution.` },
            timestamp: new Date().toISOString(),
          },
        }));
      }

      await this.nativeRuntime.run({
        sessionId: safeSessionId,
        runId: safeRunId,
        prompt,
        workspacePath,
        providerProfileId,
        tenantId: 'remote-runner',
      });

      // Post-execution quota check
      this.checkDiskQuota();

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'unified_event',
          sessionId: safeSessionId,
          runId: safeRunId,
          payload: {
            id: `evt-${Date.now()}`,
            sessionId: safeSessionId,
            runId: safeRunId,
            agent: 'orchestrator',
            type: 'status',
            payload: { text: `[${this.node.name}] Successfully completed task inside sandboxed workspace.` },
            timestamp: new Date().toISOString(),
          },
        }));
      }
    } catch (err) {
      console.error(`[Lyra Runner] Error executing task ${safeRunId}:`, err);
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'error',
          sessionId: safeSessionId,
          runId: safeRunId,
          payload: { message: err instanceof Error ? err.message : String(err) },
        }));
      }
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      this.activeTasks.delete(safeRunId);
      killAllActiveProcesses();
      this.node.status = 'online';
    }
  }

  private async executeTeamRun(msg: any): Promise<void> {
    const { sessionId, runId, payload } = msg;
    console.log(`[Lyra Runner] Received team swarm dispatch for run ${runId}: ${payload?.objective}`);
    // Acknowledge receipt
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'unified_event',
        sessionId,
        runId,
        payload: {
          id: `evt-${Date.now()}`,
          sessionId,
          runId,
          agent: 'orchestrator',
          type: 'status',
          payload: { text: `[${this.node.name}] Team swarm accepted by remote runner node.` },
          timestamp: new Date().toISOString(),
        },
      }));
    }
  }
}

// CLI entry point
if (import.meta.main) {
  const args = process.argv.slice(2);
  let hubUrl = 'ws://localhost:3001';
  let token: string | undefined = process.env.LYRA_RUNNER_TOKEN;
  let nodeName: string | undefined;
  let nodeId: string | undefined;
  let nodeType: 'homelab' | 'local' | 'cloud' | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--hub' && args[i + 1]) {
      hubUrl = args[i + 1]!;
      i++;
    } else if (args[i] === '--token' && args[i + 1]) {
      token = args[i + 1]!;
      i++;
    } else if (args[i] === '--name' && args[i + 1]) {
      nodeName = args[i + 1]!;
      i++;
    } else if (args[i] === '--id' && args[i + 1]) {
      nodeId = args[i + 1]!;
      i++;
    } else if (args[i] === '--type' && args[i + 1]) {
      nodeType = args[i + 1]! as any;
      i++;
    }
  }

  const runner = new RunnerDaemon({ hubUrl, token, nodeName, nodeId, nodeType });
  void runner.start();

  const shutdown = () => {
    console.log('\nShutting down runner daemon...');
    runner.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
