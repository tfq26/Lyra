import { redactSecretText } from './security';
import { LyraDataLayer } from './cloud/database';
import type { CloudProviderBundle } from './cloud/interfaces';
import type { LyraHarnessGateway } from './gateway';
import type { UnifiedStore } from './unifiedStore';
import { modelCouncil } from './modelCouncil';
import { nightShiftRunner } from './nightShift/nightShiftRunner';

export interface LyraCodeModeOptions {
  tenantId?: string;
  sessionId?: string;
  runId?: string;
  workspacePath?: string;
  timeoutMs?: number;
}

export interface LyraCodeModeResult {
  success: boolean;
  returnValue: unknown;
  logs: string[];
  durationMs: number;
  error?: string;
}

interface SdkDocEntry {
  namespace: string;
  summary: string;
  declaration: string;
}

const LYRA_SDK_DOCS: SdkDocEntry[] = [
  {
    namespace: 'lyra.db',
    summary: 'Tenant-scoped SQLite/Postgres queries, schema inspection, DB branching, and agent scratchpad KV.',
    declaration: `declare namespace lyra.db {
  function listTables(): Promise<string[]>;
  function describeTable(tableName: string): Promise<Array<{ name: string; type: string }>>;
  function queryReadOnly<T = Record<string, unknown>>(sql: string, params?: unknown[], maxRows?: number): Promise<T[]>;
  function scratchpadSet(namespace: string, key: string, value: unknown): Promise<void>;
  function scratchpadGet(namespace: string, key: string): Promise<string | null>;
  function scratchpadList(namespace: string): Promise<Array<{ key: string; value: string; updatedAt: string }>>;
  function createBranch(branchId: string): Promise<{ branchId: string; engine: string; connectionInfo?: string }>;
  function deleteBranch(branchId: string): Promise<void>;
}`,
  },
  {
    namespace: 'lyra.storage',
    summary: 'Tenant-scoped blob/artifact storage (Local FS / AWS S3 / Cloudflare R2).',
    declaration: `declare namespace lyra.storage {
  function putArtifact(key: string, body: string, contentType?: string): Promise<{ key: string; bytes: number }>;
  function getArtifactText(key: string): Promise<string | null>;
  function deleteArtifact(key: string): Promise<void>;
}`,
  },
  {
    namespace: 'lyra.swarm',
    summary: 'Dispatch autonomous swarm runs, check run status, inspect diffs, and handle pending requests.',
    declaration: `declare namespace lyra.swarm {
  function dispatchTask(args: { objective: string; workspacePath: string; model?: string; approvalPolicy?: 'auto' | 'risk-gated' | 'manual' }): Promise<{ sessionId: string; runId: string; status: string }>;
  function getRunStatus(sessionId: string, runId: string): Promise<unknown>;
  function getPendingRequests(runId: string): Promise<unknown>;
  function inspectDiff(runId: string, filePath?: string): Promise<unknown>;
}`,
  },
  {
    namespace: 'lyra.council',
    summary: 'Cross-model Architect Council review for high-stakes architectural or security trade-offs.',
    declaration: `declare namespace lyra.council {
  function analyze(prompt: string, workspacePath?: string): Promise<unknown>;
}`,
  },
  {
    namespace: 'lyra.nightshift',
    summary: 'Automated CI/test failure investigation and verification.',
    declaration: `declare namespace lyra.nightshift {
  function investigate(args: { errorLog: string; workspacePath?: string; source?: string }): Promise<unknown>;
}`,
  },
];

const WORKER_BOOTSTRAP_SOURCE = `
"use strict";
const _post = self.postMessage.bind(self);

// Scrub ambient host capabilities so scripts only use the injected lyra.* RPC SDK.
for (const key of ["fetch", "WebSocket", "XMLHttpRequest", "importScripts", "localStorage", "sessionStorage", "indexedDB", "Bun", "process"]) {
  try {
    Object.defineProperty(globalThis, key, { value: undefined, configurable: true, writable: false });
  } catch {
    try { globalThis[key] = undefined; } catch {}
  }
}

let _seq = 0;
const _pending = new Map();

self.addEventListener("message", async (ev) => {
  const msg = ev.data;
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "rpc_res") {
    const entry = _pending.get(msg.id);
    if (!entry) return;
    _pending.delete(msg.id);
    if (msg.error) entry.reject(new Error(msg.error));
    else entry.resolve(msg.result);
    return;
  }

  if (msg.type === "exec") {
    const logs = [];
    const customConsole = {
      log: (...args) => logs.push(args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ")),
      warn: (...args) => logs.push("[WARN] " + args.map(String).join(" ")),
      error: (...args) => logs.push("[ERROR] " + args.map(String).join(" ")),
    };

    const callRpc = (ns, method, args) => new Promise((resolve, reject) => {
      const id = ++_seq;
      _pending.set(id, { resolve, reject });
      _post({ type: "rpc_req", id, ns, method, args });
    });

    const makeNamespace = (ns) => new Proxy({}, {
      get(_t, prop) {
        if (typeof prop !== "string") return undefined;
        return (...args) => callRpc(ns, prop, args);
      }
    });

    const lyra = new Proxy({}, {
      get(_t, ns) {
        if (typeof ns !== "string") return undefined;
        return makeNamespace(ns);
      }
    });

    try {
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      const fn = new AsyncFunction(
        "lyra",
        "console",
        "Bun",
        "process",
        "fetch",
        "WebSocket",
        "XMLHttpRequest",
        "importScripts",
        "localStorage",
        "sessionStorage",
        "indexedDB",
        msg.script
      );
      const result = await fn(lyra, customConsole);
      _post({ type: "exec_done", success: true, returnValue: result ?? null, logs });
    } catch (err) {
      _post({ type: "exec_done", success: false, returnValue: null, logs, error: err && err.message ? err.message : String(err) });
    }
  }
});
`;

export class LyraCodeMode {
  private readonly dataLayer: LyraDataLayer;

  constructor(
    private readonly cloud: CloudProviderBundle,
    private readonly gateway?: LyraHarnessGateway,
    private readonly store?: UnifiedStore
  ) {
    this.dataLayer = new LyraDataLayer(cloud.database, cloud.storage);
  }

  /**
   * Code Mode discovery primitive: returns TypeScript SDK declarations matching the query.
   */
  public search(query?: string): { namespaces: string[]; sdkDeclarations: string } {
    const q = (query || '').trim().toLowerCase();
    const matched = q
      ? LYRA_SDK_DOCS.filter(
          (d) =>
            d.namespace.toLowerCase().includes(q) ||
            d.summary.toLowerCase().includes(q) ||
            d.declaration.toLowerCase().includes(q)
        )
      : LYRA_SDK_DOCS;

    const list = matched.length > 0 ? matched : LYRA_SDK_DOCS;
    return {
      namespaces: list.map((d) => d.namespace),
      sdkDeclarations: list.map((d) => `// ${d.summary}\n${d.declaration}`).join('\n\n'),
    };
  }

  private async dispatchRpc(
    ns: string,
    method: string,
    args: unknown[],
    options: Required<Pick<LyraCodeModeOptions, 'tenantId'>> & LyraCodeModeOptions
  ): Promise<unknown> {
    const tenantId = options.tenantId;

    if (ns === 'db') {
      switch (method) {
        case 'listTables':
          return this.dataLayer.listTables();
        case 'describeTable':
          return this.dataLayer.describeTable(String(args[0] || ''));
        case 'queryReadOnly':
          return this.dataLayer.queryReadOnly(
            String(args[0] || ''),
            Array.isArray(args[1]) ? args[1] : [],
            typeof args[2] === 'number' ? args[2] : 100
          );
        case 'scratchpadSet':
          return this.dataLayer.scratchpadSet(
            tenantId,
            String(args[0] || 'default'),
            String(args[1] || ''),
            args[2]
          );
        case 'scratchpadGet':
          return this.dataLayer.scratchpadGet(
            tenantId,
            String(args[0] || 'default'),
            String(args[1] || '')
          );
        case 'scratchpadList':
          return this.dataLayer.scratchpadList(tenantId, String(args[0] || 'default'));
        case 'createBranch':
          if (!this.cloud.database.createBranch) {
            throw new Error(`createBranch is not supported by ${this.cloud.database.provider}`);
          }
          return this.cloud.database.createBranch(String(args[0] || `run-${Date.now()}`));
        case 'deleteBranch':
          if (!this.cloud.database.deleteBranch) {
            throw new Error(`deleteBranch is not supported by ${this.cloud.database.provider}`);
          }
          return this.cloud.database.deleteBranch(String(args[0] || ''));
        default:
          throw new Error(`Unknown lyra.db method: ${method}`);
      }
    }

    if (ns === 'storage') {
      switch (method) {
        case 'putArtifact':
          return this.dataLayer.putArtifact(
            tenantId,
            String(args[0] || ''),
            String(args[1] ?? ''),
            typeof args[2] === 'string' ? args[2] : 'text/plain'
          );
        case 'getArtifactText':
          return this.dataLayer.getArtifactText(tenantId, String(args[0] || ''));
        case 'deleteArtifact': {
          const rawKey = String(args[0] || '').replace(/^\/+/, '');
          const scopedKey = rawKey.startsWith(`${tenantId}/`) ? rawKey : `${tenantId}/${rawKey}`;
          return this.cloud.storage.deleteObject(scopedKey);
        }
        default:
          throw new Error(`Unknown lyra.storage method: ${method}`);
      }
    }

    if (ns === 'swarm') {
      if (!this.gateway) {
        throw new Error('lyra.swarm is not available in standalone Code Mode.');
      }
      switch (method) {
        case 'dispatchTask': {
          const payload = (args[0] || {}) as Record<string, any>;
          return this.gateway.dispatchTask({
            objective: String(payload.objective || ''),
            workspacePath: String(payload.workspacePath || options.workspacePath || process.cwd()),
            model: payload.model,
            approvalPolicy: payload.approvalPolicy || 'auto',
          });
        }
        case 'getRunStatus': {
          const sessionId = String(args[0] || '');
          const runId = String(args[1] || '');
          const match = this.gateway.findRun(runId);
          return match ? match.run : (sessionId && this.store ? this.store.getRun(sessionId, runId) : null);
        }
        case 'getPendingRequests':
          return this.gateway.getPendingRequests(String(args[0] || ''));
        case 'inspectDiff':
          return this.gateway.inspectDiff({
            runId: String(args[0] || ''),
            filePath: typeof args[1] === 'string' ? args[1] : undefined,
          });
        default:
          throw new Error(`Unknown lyra.swarm method: ${method}`);
      }
    }

    if (ns === 'council') {
      if (method === 'analyze') {
        return modelCouncil.analyze({
          question: String(args[0] || ''),
          workspacePath: typeof args[1] === 'string' ? args[1] : options.workspacePath || process.cwd(),
          sessionId: options.sessionId || 'session-main',
        });
      }
      throw new Error(`Unknown lyra.council method: ${method}`);
    }

    if (ns === 'nightshift') {
      if (method === 'investigate') {
        const payload = (args[0] || {}) as Record<string, any>;
        return nightShiftRunner.runInvestigation({
          event: {
            id: `codemode-${Date.now()}`,
            source: payload.source || 'manual',
            repository: 'local',
            branch: 'main',
            commitSha: 'HEAD',
            errorLog: String(payload.errorLog || ''),
            receivedAt: new Date().toISOString(),
          },
          workspacePath: payload.workspacePath || options.workspacePath || process.cwd(),
        });
      }
      throw new Error(`Unknown lyra.nightshift method: ${method}`);
    }

    throw new Error(`Unknown lyra namespace: ${ns}`);
  }

  /**
   * Executes a TypeScript/JavaScript snippet inside a fresh, scrubbed Bun Worker isolate
   * with host-enforced RPC bindings and automatic secret redaction.
   */
  public async execute(
    script: string,
    options: LyraCodeModeOptions = {}
  ): Promise<LyraCodeModeResult> {
    const timeoutMs = Math.max(100, Math.min(options.timeoutMs ?? 5000, 30_000));
    const tenantId = options.tenantId || 'default';
    const startTime = performance.now();

    const blob = new Blob([WORKER_BOOTSTRAP_SOURCE], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    const worker = new Worker(workerUrl);

    try {
      return await new Promise<LyraCodeModeResult>((resolve) => {
        let settled = false;
        const finish = (res: LyraCodeModeResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({
            ...res,
            logs: res.logs.map((l) => redactSecretText(l)),
            returnValue:
              res.returnValue === undefined
                ? null
                : JSON.parse(redactSecretText(JSON.stringify(res.returnValue)) || 'null'),
            error: res.error ? redactSecretText(res.error) : undefined,
          });
        };

        const timer = setTimeout(() => {
          finish({
            success: false,
            returnValue: null,
            logs: [],
            durationMs: Math.round(performance.now() - startTime),
            error: `Lyra Code Mode script timed out after ${timeoutMs}ms`,
          });
        }, timeoutMs);

        worker.addEventListener('message', async (ev: MessageEvent) => {
          const msg = ev.data as any;
          if (!msg || typeof msg !== 'object') return;

          if (msg.type === 'rpc_req') {
            try {
              const result = await this.dispatchRpc(msg.ns, msg.method, msg.args || [], {
                ...options,
                tenantId,
              });
              worker.postMessage({ type: 'rpc_res', id: msg.id, result });
            } catch (err: any) {
              worker.postMessage({
                type: 'rpc_res',
                id: msg.id,
                error: err?.message || String(err),
              });
            }
            return;
          }

          if (msg.type === 'exec_done') {
            finish({
              success: Boolean(msg.success),
              returnValue: msg.returnValue ?? null,
              logs: Array.isArray(msg.logs) ? msg.logs : [],
              durationMs: Math.round(performance.now() - startTime),
              error: msg.error,
            });
          }
        });

        worker.addEventListener('error', (err) => {
          finish({
            success: false,
            returnValue: null,
            logs: [],
            durationMs: Math.round(performance.now() - startTime),
            error: err?.message || 'Worker execution error',
          });
        });

        worker.postMessage({ type: 'exec', script });
      });
    } finally {
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
    }
  }
}
