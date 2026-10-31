import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UnifiedStore } from './unifiedStore';
import { CloudMonitor } from './cloudMonitor';

describe('CloudMonitor Telemetry & Progress Tool', () => {
  let tempDir: string;
  let store: UnifiedStore;
  let monitor: CloudMonitor;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyra-monitor-test-'));
    store = new UnifiedStore(tempDir);
    monitor = new CloudMonitor(store);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('records model invocations and calculates estimated Bedrock costs accurately', () => {
    monitor.recordInvocation('us.anthropic.claude-sonnet-4-6', 10_000, 2_000);
    monitor.recordInvocation('us.anthropic.claude-opus-4-6-v1', 5_000, 1_000);

    const metrics = monitor.getCloudMetrics();
    expect(metrics.totalInvocations).toBe(2);
    expect(metrics.totalTokens).toBe(18_000);
    expect(metrics.totalEstimatedCostUsd).toBeGreaterThan(0);
    expect(metrics.models['us.anthropic.claude-sonnet-4-6']).toBeDefined();
    expect(metrics.models['us.anthropic.claude-sonnet-4-6']?.invocations).toBe(1);
    expect(metrics.models['us.anthropic.claude-sonnet-4-6']?.totalTokens).toBe(12_000);
  });

  it('gathers active run progress and formats live terminal dashboard', () => {
    const session = store.createSession({ id: 'session-mon-1', title: 'Monitor Session', workspacePath: tempDir });
    store.createRun({
      id: 'run-mon-1',
      sessionId: session.id,
      objective: 'Build autonomous cloud telemetry pipeline',
      stage: 'in_progress',
      state: 'in_progress',
      teamConfig: { lead: 'hermes', workers: ['hermes'], reviewer: 'hermes' },
      acceptanceCriteria: ['Pipeline functioning'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      diffs: [],
      repairAttempts: 0,
      maxRepairAttempts: 2,
      tasks: [
        {
          id: 'task-1',
          runId: 'run-mon-1',
          title: 'Implement data pipeline',
          assignedAgent: 'hermes',
          stage: 'implement',
          status: 'succeeded',
        },
        {
          id: 'task-2',
          runId: 'run-mon-1',
          title: 'Add CloudWatch exporter',
          assignedAgent: 'hermes',
          stage: 'implement',
          status: 'in_progress',
        },
      ],
      checks: [
        {
          id: 'chk-1',
          runId: 'run-mon-1',
          name: 'Unit tests',
          command: 'bun test',
          status: 'passed',
        },
      ],
    });

    const progress = monitor.getRunProgress('run-mon-1');
    expect(progress.length).toBe(1);
    expect(progress[0]!.runId).toBe('run-mon-1');
    expect(progress[0]!.tasks.total).toBe(2);
    expect(progress[0]!.tasks.completed).toBe(1);
    expect(progress[0]!.tasks.inProgress).toBe(1);
    expect(progress[0]!.checks.passed).toBe(1);

    const dashboard = monitor.renderDashboard('run-mon-1');
    expect(dashboard).toContain('LYRA CLOUD & PROGRESS MONITOR');
    expect(dashboard).toContain('run-mon-1');
    expect(dashboard).toContain('Build autonomous cloud telemetry pipeline');
  });

  it('captures snapshots and exports structured telemetry JSON reports', () => {
    const reportPath = path.join(tempDir, 'reports', 'telemetry.json');
    monitor.recordInvocation('us.anthropic.claude-haiku-4-5-20251001-v1:0', 800, 200);
    monitor.captureSnapshot();
    monitor.exportReport(reportPath);

    expect(fs.existsSync(reportPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    expect(content.cloudResources.totalInvocations).toBe(1);
    expect(content.snapshots.length).toBeGreaterThanOrEqual(1);
  });
});
