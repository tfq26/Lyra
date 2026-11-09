import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { UnifiedStore } from './unifiedStore';
import type { TeamRun, TaskItem, CheckItem } from './types';

export interface ModelUsageStats {
  modelId: string;
  modelName: string;
  invocations: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface CloudResourceMetrics {
  timestamp: string;
  region: string;
  awsAccount?: string;
  totalInvocations: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
  models: Record<string, ModelUsageStats>;
  hostResources: {
    rssMemoryMb: number;
    heapUsedMb: number;
    systemMemoryTotalMb: number;
    systemMemoryFreeMb: number;
    cpus: number;
    loadAvg: number[];
  };
}

export interface RunProgressTelemetry {
  runId: string;
  sessionId: string;
  objective: string;
  stage: string;
  state: string;
  elapsedSeconds: number;
  tasks: {
    total: number;
    queued: number;
    inProgress: number;
    review: number;
    completed: number;
    failed: number;
  };
  review: {
    verdictApproved?: boolean;
    findingsCount: number;
    repairAttempts: number;
  };
  checks: {
    total: number;
    passed: number;
    failed: number;
    unverified: number;
  };
  diffs: {
    filesChanged: string[];
    hasConflicts: boolean;
    conflicts: string[];
  };
  tokensUsed: number;
  estimatedCostUsd: number;
  latestActivity?: string;
}

export interface TelemetrySnapshot {
  timestamp: string;
  cloudResources: CloudResourceMetrics;
  activeRuns: RunProgressTelemetry[];
}

/**
 * Standard Bedrock Model Pricing Rates (per 1,000,000 tokens)
 */
const BEDROCK_RATES: Record<string, { name: string; inputPerMillion: number; outputPerMillion: number }> = {
  'us.amazon.nova-2-lite-v1:0': { name: 'Nova 2 Lite', inputPerMillion: 0.06, outputPerMillion: 0.24 },
  'amazon.nova-2-lite-v1:0': { name: 'Nova 2 Lite', inputPerMillion: 0.06, outputPerMillion: 0.24 },
  'us.amazon.nova-lite-v1:0': { name: 'Nova Lite', inputPerMillion: 0.06, outputPerMillion: 0.24 },
  'amazon.nova-lite-v1:0': { name: 'Nova Lite', inputPerMillion: 0.06, outputPerMillion: 0.24 },
  'us.amazon.nova-2-pro-v1:0': { name: 'Nova 2 Pro', inputPerMillion: 0.8, outputPerMillion: 3.2 },
  'amazon.nova-2-pro-v1:0': { name: 'Nova 2 Pro', inputPerMillion: 0.8, outputPerMillion: 3.2 },
  'us.amazon.nova-pro-v1:0': { name: 'Nova Pro', inputPerMillion: 0.8, outputPerMillion: 3.2 },
  'amazon.nova-pro-v1:0': { name: 'Nova Pro', inputPerMillion: 0.8, outputPerMillion: 3.2 },
  'us.amazon.nova-micro-v1:0': { name: 'Nova Micro', inputPerMillion: 0.035, outputPerMillion: 0.14 },
  'amazon.nova-micro-v1:0': { name: 'Nova Micro', inputPerMillion: 0.035, outputPerMillion: 0.14 },
  'us.deepseek.r1-v1:0': { name: 'DeepSeek-R1', inputPerMillion: 0.55, outputPerMillion: 2.19 },
  'deepseek.r1-v1:0': { name: 'DeepSeek-R1', inputPerMillion: 0.55, outputPerMillion: 2.19 },
  'us.anthropic.claude-sonnet-4-6': { name: 'Claude Sonnet 4.6', inputPerMillion: 3.0, outputPerMillion: 15.0 },
  'us.anthropic.claude-opus-4-6-v1': { name: 'Claude Opus 4.6', inputPerMillion: 15.0, outputPerMillion: 75.0 },
  'us.anthropic.claude-haiku-4-5-20251001-v1:0': { name: 'Claude Haiku 4.5', inputPerMillion: 0.8, outputPerMillion: 4.0 },
  'us.anthropic.claude-sonnet-4-5-20250929-v1:0': { name: 'Claude Sonnet 4.5', inputPerMillion: 3.0, outputPerMillion: 15.0 },
};

export class CloudMonitor extends EventEmitter {
  private static instance: CloudMonitor;
  private store: UnifiedStore;
  private region: string;
  private startTime = Date.now();
  private snapshots: TelemetrySnapshot[] = [];
  private modelInvocations = new Map<string, { invocations: number; inputTokens: number; outputTokens: number }>();

  constructor(store?: UnifiedStore) {
    super();
    this.store = store || new UnifiedStore();
    this.region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
  }

  public static getInstance(store?: UnifiedStore): CloudMonitor {
    if (!CloudMonitor.instance) {
      CloudMonitor.instance = new CloudMonitor(store);
    }
    return CloudMonitor.instance;
  }

  /**
   * Records a model invocation event for cloud metrics tracking.
   */
  public recordInvocation(modelId: string, inputTokens: number, outputTokens: number): void {
    const existing = this.modelInvocations.get(modelId) || { invocations: 0, inputTokens: 0, outputTokens: 0 };
    existing.invocations += 1;
    existing.inputTokens += inputTokens;
    existing.outputTokens += outputTokens;
    this.modelInvocations.set(modelId, existing);
    this.emit('invocation_recorded', { modelId, inputTokens, outputTokens });
  }

  /**
   * Resolves pricing rates for a given model ID.
   */
  public getModelPricing(modelId: string): { name: string; inputPerMillion: number; outputPerMillion: number } {
    return BEDROCK_RATES[modelId] || { name: modelId, inputPerMillion: 0.06, outputPerMillion: 0.24 };
  }

  /**
   * Calculates cloud resources and estimated costs.
   */
  public getCloudMetrics(): CloudResourceMetrics {
    const models: Record<string, ModelUsageStats> = {};
    let totalInvocations = 0;
    let totalTokens = 0;
    let totalEstimatedCostUsd = 0;

    for (const [modelId, stats] of this.modelInvocations.entries()) {
      const rate = BEDROCK_RATES[modelId] || { name: modelId, inputPerMillion: 3.0, outputPerMillion: 15.0 };
      const cost =
        (stats.inputTokens / 1_000_000) * rate.inputPerMillion +
        (stats.outputTokens / 1_000_000) * rate.outputPerMillion;

      models[modelId] = {
        modelId,
        modelName: rate.name,
        invocations: stats.invocations,
        inputTokens: stats.inputTokens,
        outputTokens: stats.outputTokens,
        totalTokens: stats.inputTokens + stats.outputTokens,
        estimatedCostUsd: Number(cost.toFixed(6)),
      };

      totalInvocations += stats.invocations;
      totalTokens += stats.inputTokens + stats.outputTokens;
      totalEstimatedCostUsd += cost;
    }

    const mem = process.memoryUsage();

    return {
      timestamp: new Date().toISOString(),
      region: this.region,
      awsAccount: process.env.AWS_ACCOUNT_ID || '074139044445',
      totalInvocations,
      totalTokens,
      totalEstimatedCostUsd: Number(totalEstimatedCostUsd.toFixed(6)),
      models,
      hostResources: {
        rssMemoryMb: Math.round(mem.rss / (1024 * 1024)),
        heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
        systemMemoryTotalMb: Math.round(os.totalmem() / (1024 * 1024)),
        systemMemoryFreeMb: Math.round(os.freemem() / (1024 * 1024)),
        cpus: os.cpus().length,
        loadAvg: os.loadavg(),
      },
    };
  }

  /**
   * Gathers active run progress and swarm states.
   */
  public getRunProgress(targetRunId?: string): RunProgressTelemetry[] {
    const runs: RunProgressTelemetry[] = [];
    const sessions = this.store.listSessions();

    for (const session of sessions) {
      const sessionRuns = this.store.listRuns(session.id);
      for (const run of sessionRuns) {
        if (targetRunId && run.id !== targetRunId) continue;

        let elapsedSeconds = 0;
        if (run.createdAt) {
          const start = new Date(run.createdAt).getTime();
          const end = run.updatedAt ? new Date(run.updatedAt).getTime() : Date.now();
          elapsedSeconds = Math.max(0, Math.floor((end - start) / 1000));
        }

        const tasks = run.tasks || [];
        const taskCounts = {
          total: tasks.length,
          queued: tasks.filter((t) => t.status === 'queued').length,
          inProgress: tasks.filter((t) => t.status === 'in_progress').length,
          review: tasks.filter((t) => t.status === 'review').length,
          completed: tasks.filter((t) => t.status === 'succeeded').length,
          failed: tasks.filter((t) => t.status === 'failed' || t.status === 'blocked').length,
        };

        const checks = run.checks || [];
        const checkCounts = {
          total: checks.length,
          passed: checks.filter((c) => c.status === 'passed').length,
          failed: checks.filter((c) => c.status === 'failed').length,
          unverified: checks.filter((c) => c.status === 'unverified').length,
        };

        let runTokens = run.usage?.totalTokens || 0;
        let runCost = 0;

        for (const task of tasks) {
          for (const attempt of task.attempts || []) {
            if (attempt.tokensUsed) runTokens += attempt.tokensUsed;
            if (attempt.costUsd) runCost += attempt.costUsd;
          }
        }

        const latestTask = tasks.slice().reverse().find((t) => t.status === 'in_progress' || t.status === 'review');

        runs.push({
          runId: run.id,
          sessionId: session.id,
          objective: run.objective,
          stage: run.stage || run.state,
          state: run.state,
          elapsedSeconds,
          tasks: taskCounts,
          review: {
            findingsCount: run.conflicts?.length || 0,
            repairAttempts: run.repairAttempts || 0,
          },
          checks: checkCounts,
          diffs: {
            filesChanged: (run.diffs || []).map((d) => d.filename),
            hasConflicts: (run.conflicts?.length || 0) > 0,
            conflicts: run.conflicts || [],
          },
          tokensUsed: runTokens,
          estimatedCostUsd: Number(runCost.toFixed(6)),
          latestActivity: latestTask?.title || run.summary || 'Processing...',
        });
      }
    }

    return runs;
  }

  /**
   * Captures a point-in-time telemetry snapshot.
   */
  public captureSnapshot(targetRunId?: string): TelemetrySnapshot {
    const snapshot: TelemetrySnapshot = {
      timestamp: new Date().toISOString(),
      cloudResources: this.getCloudMetrics(),
      activeRuns: this.getRunProgress(targetRunId),
    };
    this.snapshots.push(snapshot);
    if (this.snapshots.length > 500) this.snapshots.shift();
    return snapshot;
  }

  /**
   * Exports gathered data to a JSON file.
   */
  public exportReport(outputPath: string, targetRunId?: string): void {
    const data = {
      exportTime: new Date().toISOString(),
      cloudResources: this.getCloudMetrics(),
      runs: this.getRunProgress(targetRunId),
      snapshots: this.snapshots,
    };
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Generates a terminal-formatted live dashboard string.
   */
  public renderDashboard(targetRunId?: string): string {
    const cloud = this.getCloudMetrics();
    const runs = this.getRunProgress(targetRunId);

    const lines: string[] = [];
    lines.push('================================================================================');
    lines.push('                       LYRA CLOUD & PROGRESS MONITOR                            ');
    lines.push('================================================================================');
    lines.push(` AWS Region: ${cloud.region.padEnd(12)} Account: ${cloud.awsAccount || 'N/A'}`);
    lines.push(` Total Invocations: ${cloud.totalInvocations.toString().padEnd(8)} Total Tokens: ${cloud.totalTokens.toLocaleString().padEnd(12)} Est. Cost: $${cloud.totalEstimatedCostUsd.toFixed(4)}`);
    lines.push(` Process Memory RSS: ${cloud.hostResources.rssMemoryMb} MB | Heap: ${cloud.hostResources.heapUsedMb} MB | CPUs: ${cloud.hostResources.cpus}`);
    lines.push('--------------------------------------------------------------------------------');
    lines.push(' BEDROCK MODEL USAGE:');

    const modelEntries = Object.values(cloud.models);
    if (modelEntries.length === 0) {
      lines.push('  (No direct invocations recorded yet in this process session)');
    } else {
      for (const m of modelEntries) {
        lines.push(`  • ${m.modelName.padEnd(20)} | Invocations: ${m.invocations.toString().padStart(4)} | Tokens: ${m.totalTokens.toLocaleString().padStart(8)} | Cost: $${m.estimatedCostUsd.toFixed(4)}`);
      }
    }

    lines.push('--------------------------------------------------------------------------------');
    lines.push(` ACTIVE RUNS & PROGRESS (${runs.length} runs):`);

    if (runs.length === 0) {
      lines.push('  No active or historical team runs found.');
    } else {
      for (const r of runs) {
        const m = Math.floor(r.elapsedSeconds / 60);
        const s = r.elapsedSeconds % 60;
        const timeStr = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;

        lines.push(`\n [Run: ${r.runId}] Stage: ${r.stage.toUpperCase()} | Elapsed: ${timeStr}`);
        lines.push(`  Goal: ${r.objective}`);
        lines.push(`  Tasks: [Queued: ${r.tasks.queued} | Running: ${r.tasks.inProgress} | Review: ${r.tasks.review} | Done: ${r.tasks.completed}/${r.tasks.total}]`);
        lines.push(`  Checks: [Passed: ${r.checks.passed}/${r.checks.total} | Failed: ${r.checks.failed}] | Repairs: ${r.review.repairAttempts}`);
        lines.push(`  Diffs: ${r.diffs.filesChanged.length} files changed | Conflicts: ${r.diffs.hasConflicts ? '⚠️ YES (' + r.diffs.conflicts.join(', ') + ')' : '✅ None'}`);
        lines.push(`  Activity: ${r.latestActivity}`);
      }
    }

    lines.push('================================================================================\n');
    return lines.join('\n');
  }
}

// Standalone CLI Execution when invoked directly
if (import.meta.main) {
  const monitor = CloudMonitor.getInstance();
  const args = process.argv.slice(2);
  const isWatch = args.includes('--watch');
  const outIndex = args.indexOf('--out');
  const outFile = outIndex !== -1 ? args[outIndex + 1] : undefined;
  const targetRun = args.find((a) => !a.startsWith('--') && a !== outFile);

  if (isWatch) {
    console.clear();
    console.log(monitor.renderDashboard(targetRun));

    setInterval(() => {
      console.clear();
      monitor.captureSnapshot(targetRun);
      console.log(monitor.renderDashboard(targetRun));
      if (outFile) {
        monitor.exportReport(outFile, targetRun);
      }
    }, 2000);
  } else {
    monitor.captureSnapshot(targetRun);
    console.log(monitor.renderDashboard(targetRun));
    if (outFile) {
      monitor.exportReport(outFile, targetRun);
      console.log(`Telemetry exported to ${outFile}`);
    }
  }
}
