import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { WorktreeManager } from './worktreeManager';
import { VerificationRunner } from './verificationRunner';
import { UnifiedStore } from './unifiedStore';
import { ProcessManager } from './processManager';
import { TeamCoordinator } from './teamCoordinator';

describe('Milestone 3 & 4: Team Coordination, Worktrees & Dependency Scheduling', () => {
  let tempDir: string;
  let store: UnifiedStore;
  let processManager: ProcessManager;
  let worktreeManager: WorktreeManager;
  let verificationRunner: VerificationRunner;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyra-milestone3-test-'));
    execFileSync('git', ['init', '-q'], { cwd: tempDir });
    execFileSync('git', ['config', 'user.email', 'lyra-tests@example.invalid'], { cwd: tempDir });
    execFileSync('git', ['config', 'user.name', 'Lyra Tests'], { cwd: tempDir });
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# Fixture\n');
    execFileSync('git', ['add', 'README.md'], { cwd: tempDir });
    execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: tempDir });
    store = new UnifiedStore(tempDir);
    processManager = new ProcessManager();
    processManager.getCapabilities = () => Object.fromEntries(['antigravity', 'claude_code', 'codex', 'opencode', 'hermes'].map((harness) => [harness, { installed: true, options: [] }])) as unknown as ReturnType<ProcessManager['getCapabilities']>;
    processManager.runAgent = async ({ agentType, runId = 'test-run', sessionId, processId }) => ({
      sessionId, runId, processId, agentType, code: 127, fullContent: '', error: 'test harness stub',
    });
    worktreeManager = new WorktreeManager();
    verificationRunner = new VerificationRunner();
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test('WorktreeManager correctly identifies non-git folder and falls back gracefully', async () => {
    const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyra-plain-test-'));
    const isGit = await worktreeManager.isGitRepo(plainDir);
    expect(isGit).toBe(false);

    const info = await worktreeManager.createRunWorktree(plainDir, 'run-test-1');
    expect(info.isGit).toBe(false);
    expect(info.worktreePath).toBe(plainDir);

    const taskInfo = await worktreeManager.createTaskWorktree(plainDir, 'run-test-1', 'task-1');
    expect(taskInfo.isGit).toBe(false);
    expect(taskInfo.worktreePath).toBe(plainDir);
    fs.rmSync(plainDir, { recursive: true, force: true });
  });

  test('VerificationRunner discovers and executes checks', async () => {
    const emptyResult = await verificationRunner.runAllChecks([], tempDir);
    expect(emptyResult.allPassed).toBe(false);

    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'test-project',
        scripts: {
          test: 'echo "Tests passed successfully"',
        },
      }),
      'utf-8'
    );

    const checks = verificationRunner.discoverProjectChecks(tempDir);
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.some((c) => c.command.includes('test'))).toBe(true);

    const testCheck = checks.find((c) => c.command.includes('test'))!;
    const result = await verificationRunner.runCheck(testCheck, tempDir);
    expect(result.status).toBe('passed');
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Tests passed successfully');
  });

  test('TeamCoordinator initializes and tracks Run, Tasks, Checks, and Usage Metrics', async () => {
    const session = store.createSession({
      title: 'Team Test Session',
      workspacePath: tempDir,
    });

    const coordinator = new TeamCoordinator(store, processManager);

    const run = await coordinator.startTeamRun({
      sessionId: session.id,
      objective: 'Build authentication module',
      teamConfig: {
        lead: 'antigravity',
        worker: 'codex',
        reviewer: 'claude_code',
      },
      workspacePath: tempDir,
      runId: 'run-unit-1',
      concurrencyLimit: 2,
    });

    expect(run.id).toBe('run-unit-1');
    expect(run.sessionId).toBe(session.id);
    expect(run.objective).toBe('Build authentication module');
    expect(run.stage).toBe('planning');
    expect(run.concurrencyLimit).toBe(2);

    const storedRun = store.getRun(session.id, 'run-unit-1');
    expect(storedRun).not.toBeNull();
    expect(storedRun?.id).toBe('run-unit-1');
    coordinator.cancelRun(run.id, session.id);

    // Add mock tasks with dependencies
    store.addTaskToRun(session.id, 'run-unit-1', {
      id: 'task-1',
      runId: 'run-unit-1',
      title: 'Design API Schema',
      assignedAgent: 'codex',
      stage: 'implement',
      status: 'succeeded',
    });

    store.addTaskToRun(session.id, 'run-unit-1', {
      id: 'task-2',
      runId: 'run-unit-1',
      title: 'Implement Endpoints',
      assignedAgent: 'codex',
      stage: 'implement',
      status: 'pending',
      dependencies: ['task-1'],
    });

    // Add a check
    store.addCheckToRun(session.id, 'run-unit-1', {
      id: 'chk-1',
      runId: 'run-unit-1',
      name: 'Lint check',
      command: 'npm run lint',
      status: 'passed',
      exitCode: 0,
    });

    // Update telemetry
    store.updateRun(session.id, 'run-unit-1', {
      usage: {
        promptTokens: 1500,
        completionTokens: 800,
        totalTokens: 2300,
        estimatedCostUsd: 0.0165,
      },
    });

    const updated = store.getRun(session.id, 'run-unit-1');
    expect(updated?.tasks.length).toBe(2);
    expect(updated?.tasks[0]?.title).toBe('Design API Schema');
    expect(updated?.tasks[1]?.dependencies).toEqual(['task-1']);
    expect(updated?.checks.length).toBe(1);
    expect(updated?.checks[0]?.status).toBe('passed');
    expect(updated?.usage?.totalTokens).toBe(2300);
  });

  test('TeamCoordinator handles run cancellation cleanly', async () => {
    const session = store.createSession({
      title: 'Cancellation Test',
      workspacePath: tempDir,
    });

    const coordinator = new TeamCoordinator(store, processManager);

    await coordinator.startTeamRun({
      sessionId: session.id,
      objective: 'Long running task',
      teamConfig: { lead: 'antigravity', worker: 'codex', reviewer: 'claude_code' },
      workspacePath: tempDir,
      runId: 'run-cancel-1',
      concurrencyLimit: 2,
    });

    coordinator.cancelRun('run-cancel-1', session.id);

    const cancelledRun = store.getRun(session.id, 'run-cancel-1');
    expect(cancelledRun?.state).toBe('cancelled');
    expect(cancelledRun?.stage).toBe('cancelled');
  });

  test('plans mixed-harness work, waits for approval, then runs workers concurrently with isolated attempt IDs', async () => {
    const session = store.createSession({ title: 'Swarm Approval', workspacePath: tempDir });
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'swarm-fixture', scripts: { test: 'echo verified' } }));
    execFileSync('git', ['add', 'package.json'], { cwd: tempDir });
    execFileSync('git', ['commit', '-qm', 'add passing check'], { cwd: tempDir });
    const fake = new ProcessManager();
    fake.getCapabilities = () => Object.fromEntries(['antigravity', 'claude_code', 'codex', 'opencode', 'hermes'].map((harness) => [harness, { installed: true, options: [] }])) as unknown as ReturnType<ProcessManager['getCapabilities']>;
    let activeWorkers = 0;
    let peakWorkers = 0;
    let reviewerRuns = 0;
    const processIds: string[] = [];
    fake.runAgent = async (options) => {
      processIds.push(options.processId || '');
      if (options.processId?.endsWith(':planner')) {
        return { sessionId: options.sessionId, runId: options.runId || '', agentType: options.agentType, code: 0, fullContent: 'ACCEPTANCE CRITERIA:\n- both changes exist\n\nTASKS:\n1. Change A - Update file A\n2. Change B - Update file B' };
      }
      if (options.prompt.includes('Your Assigned Task')) {
        activeWorkers += 1;
        peakWorkers = Math.max(peakWorkers, activeWorkers);
        await new Promise((resolve) => setTimeout(resolve, 30));
        activeWorkers -= 1;
      }
      if (options.prompt.includes('independent code reviewer')) {
        reviewerRuns += 1;
        return { sessionId: options.sessionId, runId: options.runId || '', agentType: options.agentType, code: 0, fullContent: '{"approved":true,"findings":[]}' };
      }
      return { sessionId: options.sessionId, runId: options.runId || '', agentType: options.agentType, code: 0, fullContent: 'Completed.' };
    };
    const coordinator = new TeamCoordinator(store, fake);
    const run = await coordinator.startTeamRun({
      sessionId: session.id,
      objective: 'Make two independent changes',
      teamConfig: { lead: 'codex', workers: ['codex', 'opencode'], reviewer: 'hermes', concurrencyLimit: 2 },
      concurrencyLimit: 2,
      workspacePath: tempDir,
      runId: 'run-approved-swarm',
    });
    for (let attempt = 0; attempt < 100 && store.getRun(session.id, run.id)?.state !== 'awaiting-approval'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(store.getRun(session.id, run.id)?.state).toBe('awaiting-approval');
    expect(store.getRun(session.id, run.id)?.tasks).toHaveLength(2);
    expect(processIds).toHaveLength(1);
    expect(coordinator.approvePlan(session.id, run.id)).toBe(true);
    for (let attempt = 0; attempt < 100 && peakWorkers < 2; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(peakWorkers).toBe(2);
    for (let attempt = 0; attempt < 100 && activeWorkers === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 1));
    expect(coordinator.pauseRun(session.id, run.id)).toBe(true);
    for (let attempt = 0; attempt < 100 && store.getRun(session.id, run.id)?.state !== 'paused'; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.getRun(session.id, run.id)?.state).toBe('paused');
    expect(reviewerRuns).toBe(0);
    expect(coordinator.resumeRun(session.id, run.id)).toBe(true);
    for (let attempt = 0; attempt < 100 && store.getRun(session.id, run.id)?.state !== 'completed'; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.getRun(session.id, run.id)?.state).toBe('completed');
    expect(reviewerRuns).toBe(1);
    expect(new Set(processIds).size).toBe(processIds.length);
  });
});
