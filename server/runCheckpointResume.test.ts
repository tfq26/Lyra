import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { UnifiedStore } from './unifiedStore';
import { TeamCoordinator } from './teamCoordinator';
import { ProcessManager } from './processManager';
import type { TeamRun } from './types';

describe('Run Checkpoint and Resiliency', () => {
  let tempDir: string;
  let store: UnifiedStore;
  let pm: ProcessManager;
  let coordinator: TeamCoordinator;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyra-checkpoint-test-'));
    store = new UnifiedStore(path.join(tempDir, 'store'));
    pm = new ProcessManager();
    coordinator = new TeamCoordinator(store, pm);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('persists and loads run checkpoints with task snapshots', () => {
    const sessionId = 'session-resilience-1';
    const runId = 'run-resilience-1';

    store.createSession({
      id: sessionId,
      title: 'Resilience Test Session',
      workspacePath: tempDir,
    });

    store.saveRunCheckpoint(sessionId, runId, {
      sessionId,
      runId,
      timestamp: new Date().toISOString(),
      stage: 'executing',
      state: 'executing',
      completedTaskIds: ['task-1'],
      failedTaskIds: [],
      branchName: 'lyra-run-1',
      integrationBranch: 'lyra-integration-1',
      worktreePath: tempDir,
      integrationWorktreePath: tempDir,
      checkStates: { 'check-1': 'passed' },
      tasksSnapshot: [
        {
          id: 'task-1',
          runId,
          title: 'Implement component',
          description: 'Desc',
          scope: 'src/Comp.tsx',
          status: 'succeeded',
          assignedAgent: 'codex',
          stage: 'implement',
        },
        {
          id: 'task-2',
          runId,
          title: 'Add tests',
          description: 'Desc',
          scope: 'src/Comp.test.tsx',
          status: 'pending',
          assignedAgent: 'codex',
          stage: 'implement',
        },
      ],
    });

    const checkpoint = store.getLatestRunCheckpoint(sessionId, runId);
    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.stage).toBe('executing');
    expect(checkpoint?.completedTaskIds).toContain('task-1');
    expect(checkpoint?.tasksSnapshot.length).toBe(2);
  });

  it('lists interrupted runs when runs are in active stages', () => {
    const sessionId = 'session-interrupted-1';
    const runId = 'run-interrupted-1';

    store.createSession({
      id: sessionId,
      title: 'Interrupted Session',
      workspacePath: tempDir,
    });

    const run: TeamRun = {
      id: runId,
      sessionId,
      objective: 'Build widget',
      stage: 'executing',
      state: 'executing',
      teamConfig: { lead: 'codex', reviewer: 'codex', worker: 'codex' },
      acceptanceCriteria: [],
      tasks: [],
      checks: [],
      diffs: [],
      conflicts: [],
      repairAttempts: 0,
      maxRepairAttempts: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    store.createRun(run);
    store.saveRunCheckpoint(sessionId, runId, {
      sessionId,
      runId,
      timestamp: new Date().toISOString(),
      stage: 'executing',
      state: 'executing',
      completedTaskIds: ['task-1'],
      failedTaskIds: [],
      tasksSnapshot: [],
    });

    const interrupted = store.listInterruptedRuns();
    expect(interrupted.length).toBeGreaterThan(0);
    const found = interrupted.find((item) => item.run.id === runId);
    expect(found).toBeDefined();
    expect(found?.checkpoint?.completedTaskIds).toContain('task-1');
  });

  it('refuses to resume an already completed run', async () => {
    const sessionId = 'session-done';
    const runId = 'run-done';

    store.createSession({ id: sessionId, title: 'Done Session', workspacePath: tempDir });
    store.createRun({
      id: runId,
      sessionId,
      objective: 'Objective',
      stage: 'completed',
      state: 'completed',
      teamConfig: { lead: 'codex', reviewer: 'codex' },
      acceptanceCriteria: [],
      tasks: [],
      checks: [],
      diffs: [],
      conflicts: [],
      repairAttempts: 0,
      maxRepairAttempts: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    expect(coordinator.resumeInterruptedRun(sessionId, runId)).rejects.toThrow('already completed');
  });
});
