/**
 * Lyra A2A (Agent-to-Agent) Subagent Delegation & AG-UI Event Protocol
 *
 * Enables fast, bounded parallel worker delegation (e.g., pentest/security audit,
 * test generation, targeted refactors, docs) using low-cost canonical models via
 * `invokeCanonicalModelText`, while emitting AG-UI-standard lifecycle events.
 *
 * Also defines `ORCHESTRATION_ROUTING_POLICY` so agents know exactly when to use:
 * - Direct execution (default)
 * - A2A Subagents (parallel specialist work)
 * - Model Council (high-stakes cross-family consensus)
 * - Autopilot (async issue-to-PR worktrees)
 */

import { EventEmitter } from 'node:events';
import { invokeCanonicalModelText } from './unifiedModelCatalog';
import { redactSecretText } from './security';

export type A2ASpecialistRole = 'pentest' | 'test-writer' | 'refactor' | 'docs' | 'research';

export interface A2ASpecialistSpec {
  role: A2ASpecialistRole;
  name: string;
  description: string;
  preferredModels: string[];
  maxTokens: number;
  timeoutMs: number;
  readOnly: boolean;
}

export const A2A_SPECIALISTS: Record<A2ASpecialistRole, A2ASpecialistSpec> = {
  pentest: {
    role: 'pentest',
    name: 'Security & Pentest Auditor',
    description: 'Audits diffs/endpoints for auth bypass, injection, SSRF, secret leaks, and privilege escalation.',
    preferredModels: ['mai-code-2', 'claude-fable-5-2', 'gpt-6.2-sol'],
    maxTokens: 900,
    timeoutMs: 25_000,
    readOnly: true,
  },
  'test-writer': {
    role: 'test-writer',
    name: 'Unit & Regression Test Worker',
    description: 'Generates focused unit/integration tests for specified files without modifying production code.',
    preferredModels: ['gpt-6.2-sol', 'mai-code-2', 'nova-2-pro'],
    maxTokens: 1200,
    timeoutMs: 25_000,
    readOnly: false,
  },
  refactor: {
    role: 'refactor',
    name: 'Scoped Refactor Worker',
    description: 'Performs mechanical, well-scoped refactors (renames, type fixes, extractions) on specific files.',
    preferredModels: ['gpt-6.2-sol', 'nova-2-pro', 'mai-code-2'],
    maxTokens: 1200,
    timeoutMs: 25_000,
    readOnly: false,
  },
  docs: {
    role: 'docs',
    name: 'Documentation & Schema Sync Worker',
    description: 'Updates README, JSDoc, or schema docs to match code changes.',
    preferredModels: ['nova-2-lite', 'gpt-6.2-sol'],
    maxTokens: 800,
    timeoutMs: 15_000,
    readOnly: false,
  },
  research: {
    role: 'research',
    name: 'Fast Codebase Researcher',
    description: 'Summarizes file call-graphs, configs, or dependencies for the parent agent.',
    preferredModels: ['nova-2-lite', 'gemini-4-hydrogen', 'gpt-6.2-sol'],
    maxTokens: 700,
    timeoutMs: 15_000,
    readOnly: true,
  },
};

/**
 * Compact, anti-token-burn routing instructions injected into agent prompts
 * so models never waste tokens spawning unnecessary councils or subagents.
 */
export const ORCHESTRATION_ROUTING_POLICY = `## Orchestration & Protocol Discipline (Token-Efficiency Rules)
Choose the lightest tool that solves the task — NEVER stack protocols unnecessarily:
1. **Direct Execution (Default):** 1–3 files or clear single-threaded task. Do NOT invoke A2A subagents, Model Council, or Autopilot.
2. **A2A Subagents (\`pentest\`, \`test-writer\`, \`refactor\`, \`docs\`, \`research\`):** Use ONLY for independent, parallelizable specialist work (e.g., security/pentest audit alongside feature work, or writing tests across multiple modules). Uses fast/cheap worker models (max 3 concurrent).
3. **Model Council:** Use ONLY for high-stakes architectural trade-offs, security design decisions, or genuine uncertainty where cross-family consensus prevents costly mistakes. NEVER use for routine coding.
4. **Autopilot (Issue → PR):** Use for multi-file specs or background tasks that should run asynchronously in an isolated worktree with Proof Contract verification and a Draft PR.`;

export type AgUiEventType =
  | 'RUN_STARTED'
  | 'STEP_STARTED'
  | 'STATE_DELTA'
  | 'AWAITING_INPUT'
  | 'RUN_FINISHED'
  | 'RUN_ERROR';

export interface AgUiEvent {
  type: AgUiEventType;
  runId: string;
  stepName?: string;
  timestamp: string;
  delta?: Record<string, unknown>;
  message?: string;
}

export interface A2ATaskRecord {
  id: string;
  role: A2ASpecialistRole;
  objective: string;
  contextSnippet?: string;
  status: 'submitted' | 'working' | 'completed' | 'failed';
  modelUsed?: string;
  providerUsed?: string;
  output?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export function buildLyraA2AAgentCard(baseUrl = 'http://127.0.0.1:3001') {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  return {
    name: 'Lyra Autonomous Engineering Hub',
    description: 'Multi-provider coding swarm, A2A specialist workers, Grounded Model Council, and Autopilot Issue-to-PR runtime.',
    url: cleanBase,
    version: '2.0.0',
    protocols: {
      a2a: '0.2',
      agUi: '1.0',
      ahp: '1.0',
      mcp: '1.0',
    },
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    skills: Object.values(A2A_SPECIALISTS).map((s) => ({
      id: s.role,
      name: s.name,
      description: s.description,
      tags: [s.role, s.readOnly ? 'read-only' : 'write-capable'],
    })),
  };
}

export class A2ATaskManager extends EventEmitter {
  private readonly tasks = new Map<string, A2ATaskRecord>();
  private readonly maxConcurrent = 3;
  private activeCount = 0;

  public listTasks(): A2ATaskRecord[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  public getTask(taskId: string): A2ATaskRecord | undefined {
    return this.tasks.get(taskId);
  }

  private emitAgUi(event: Omit<AgUiEvent, 'timestamp'>): void {
    const full: AgUiEvent = { ...event, timestamp: new Date().toISOString() };
    this.emit('agui', full);
    this.emit(`task:${event.runId}`, full);
  }

  /**
   * Delegates a bounded specialist task to a fast/cheap worker model.
   * Rejects if concurrency cap (3) is reached to prevent runaway token burn.
   */
  public async delegateTask(params: {
    role: A2ASpecialistRole;
    objective: string;
    contextSnippet?: string;
    executeOverride?: (spec: A2ASpecialistSpec) => Promise<{ text: string; model: string; provider: string }>;
  }): Promise<A2ATaskRecord> {
    const spec = A2A_SPECIALISTS[params.role];
    if (!spec) {
      throw new Error(`Unknown A2A specialist role: ${params.role}`);
    }
    if (this.activeCount >= this.maxConcurrent) {
      throw new Error(`A2A concurrency cap (${this.maxConcurrent}) reached. Wait for an active worker to finish.`);
    }

    const now = new Date().toISOString();
    const id = `a2a-${params.role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const record: A2ATaskRecord = {
      id,
      role: params.role,
      objective: redactSecretText(params.objective).slice(0, 2000),
      contextSnippet: params.contextSnippet ? redactSecretText(params.contextSnippet).slice(0, 6000) : undefined,
      status: 'submitted',
      createdAt: now,
      updatedAt: now,
    };

    this.tasks.set(id, record);
    this.activeCount += 1;
    this.emitAgUi({ type: 'RUN_STARTED', runId: id, stepName: spec.role, message: `Delegated to ${spec.name}` });

    try {
      record.status = 'working';
      record.updatedAt = new Date().toISOString();
      this.emitAgUi({ type: 'STEP_STARTED', runId: id, stepName: spec.role });

      if (params.executeOverride) {
        const res = await params.executeOverride(spec);
        record.output = res.text;
        record.modelUsed = res.model;
        record.providerUsed = res.provider;
      } else {
        const systemPrompt = `You are Lyra's ${spec.name} (${spec.role}). ${spec.description}
Be concise, cite exact file paths/symbols, and stay strictly within your specialist scope.`;
        const userPrompt = [
          `Objective: ${record.objective}`,
          record.contextSnippet ? `\nContext:\n${record.contextSnippet}` : '',
        ].join('\n');

        let resolved = null;
        for (const modelId of spec.preferredModels) {
          resolved = await invokeCanonicalModelText({
            modelId,
            systemPrompt,
            userPrompt,
            maxTokens: spec.maxTokens,
            temperature: 0.1,
            timeoutMs: spec.timeoutMs,
          });
          if (resolved?.text) break;
        }

        if (!resolved?.text) {
          throw new Error(`No configured provider could serve A2A specialist '${spec.role}'.`);
        }
        record.output = resolved.text;
        record.modelUsed = resolved.canonicalModelId;
        record.providerUsed = resolved.provider;
      }

      record.status = 'completed';
      record.updatedAt = new Date().toISOString();
      this.emitAgUi({
        type: 'RUN_FINISHED',
        runId: id,
        stepName: spec.role,
        delta: { status: 'completed', modelUsed: record.modelUsed, providerUsed: record.providerUsed },
      });
      return record;
    } catch (err: any) {
      record.status = 'failed';
      record.error = err?.message || 'A2A task failed.';
      record.updatedAt = new Date().toISOString();
      this.emitAgUi({ type: 'RUN_ERROR', runId: id, stepName: spec.role, message: record.error });
      return record;
    } finally {
      this.activeCount = Math.max(0, this.activeCount - 1);
    }
  }
}

export const a2aTaskManager = new A2ATaskManager();
