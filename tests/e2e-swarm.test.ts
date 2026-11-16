import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { UnifiedStore } from '../server/unifiedStore';
import { ProcessManager } from '../server/processManager';
import { WorktreeManager } from '../server/worktreeManager';
import { VerificationRunner } from '../server/verificationRunner';
import { NativeAgentRuntime } from '../server/nativeAgentRuntime';
import { ScribeAgent } from '../server/scribeAgent';
import { TeamCoordinator } from '../server/teamCoordinator';

describe('Headless End-to-End Swarm Assembly Line', () => {
  let tempRepo: string;
  let store: UnifiedStore;
  let processManager: ProcessManager;
  let worktreeManager: WorktreeManager;
  let nativeRuntime: NativeAgentRuntime;
  let coordinator: TeamCoordinator;

  beforeEach(() => {
    tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'lyra-e2e-swarm-'));
    execFileSync('git', ['init', '-b', 'main', '-q'], { cwd: tempRepo });
    execFileSync('git', ['config', 'user.email', 'swarms@lyra.dev'], { cwd: tempRepo });
    execFileSync('git', ['config', 'user.name', 'Lyra Swarm Engine'], { cwd: tempRepo });
    fs.writeFileSync(path.join(tempRepo, 'README.md'), '# Lyra Assembly Line Project\n');
    execFileSync('git', ['add', 'README.md'], { cwd: tempRepo });
    execFileSync('git', ['commit', '-qm', 'initial commit'], { cwd: tempRepo });

    store = new UnifiedStore(path.join(tempRepo, '.lyra-test-store'));
    processManager = new ProcessManager();
    processManager.getCapabilities = () => Object.fromEntries(['antigravity', 'claude_code', 'codex', 'opencode', 'strands'].map((harness) => [harness, { installed: true, options: [] }])) as unknown as ReturnType<ProcessManager['getCapabilities']>;
    worktreeManager = new WorktreeManager();
    nativeRuntime = new NativeAgentRuntime(store);
    coordinator = new TeamCoordinator(store, processManager, nativeRuntime);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempRepo, { recursive: true, force: true });
    } catch {}
  });

  it('executes full autonomous assembly line from prompt to verified merge without UI', async () => {
    const sessionId = 'session-e2e-1';
    const runId = 'run-e2e-1';

    // Mock ProcessManager agents to simulate the multi-agent assembly line
    processManager.runAgent = async ({ agentType, prompt, cwd = tempRepo, processId }) => {
      // 1. Planner Agent
      if (prompt.includes('Lead Architect')) {
        const planJson = {
          appraisal: {
            problemSummary: 'Implement database user profiles with audit logging and reversible migration.',
            reusedAssets: ['UnifiedStore', 'PostgresEventJournal'],
            costScaleNotes: 'Minimal cloud impact: additive single-table schema with indexed lookup.',
            recommendedApproach: 'Dual-file migration (up/down) with TypeScript domain service.',
          },
          summary: 'Database User Profiles & Audit Log Service',
          acceptanceCriteria: [
            'Database migration is additive with matching reversible down migration',
            'TypeScript user service exports typed validateUser function with TSDoc',
          ],
          tasks: [
            {
              title: 'Create reversible database migration',
              scope: 'migrations/001_users.sql, migrations/001_users.down.sql',
              expectedOutputs: ['migrations/001_users.sql', 'migrations/001_users.down.sql'],
              recommendedHarness: 'codex',
            },
            {
              title: 'Implement user service domain logic',
              scope: 'src/userService.ts',
              expectedOutputs: ['src/userService.ts'],
              recommendedHarness: 'codex',
              dependsOn: ['Create reversible database migration'],
            },
          ],
          checks: [
            {
              id: 'chk-canary',
              name: 'Database Migration Canary',
              command: 'lyra canary database-migrations',
            },
          ],
        };

        return {
          sessionId,
          runId,
          processId,
          agentType,
          code: 0,
          fullContent: '```json\n' + JSON.stringify(planJson, null, 2) + '\n```',
        };
      }

      // 2. Reviewer Agent
      if (prompt.includes('independent code reviewer')) {
        return {
          sessionId,
          runId,
          processId,
          agentType,
          code: 0,
          fullContent: JSON.stringify({
            approved: true,
            findings: [],
          }),
        };
      }

      // 3. Worker Agents executing tasks in isolated worktrees
      if (prompt.includes('Your Assigned Task: Create reversible database migration')) {
        const migDir = path.join(cwd, 'migrations');
        fs.mkdirSync(migDir, { recursive: true });
        fs.writeFileSync(
          path.join(migDir, '001_users.sql'),
          `CREATE TABLE users (\n  id VARCHAR(64) PRIMARY KEY,\n  email VARCHAR(255) NOT NULL UNIQUE,\n  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);\n`
        );
        fs.writeFileSync(
          path.join(migDir, '001_users.down.sql'),
          `DROP TABLE users;\n`
        );
        return {
          sessionId,
          runId,
          processId,
          agentType,
          code: 0,
          fullContent: 'Created additive migration and matching rollback script.',
        };
      }

      if (prompt.includes('Your Assigned Task: Implement user service domain logic')) {
        const srcDir = path.join(cwd, 'src');
        fs.mkdirSync(srcDir, { recursive: true });
        fs.writeFileSync(
          path.join(srcDir, 'userService.ts'),
          `/**\n * Validates user input before registration.\n * @invariant Email must be non-empty and well-formed\n */\nexport function validateUser(email: string): boolean {\n  return Boolean(email && email.includes('@'));\n}\n`
        );
        return {
          sessionId,
          runId,
          processId,
          agentType,
          code: 0,
          fullContent: 'Implemented user validation service with TSDoc documentation.',
        };
      }

      throw new Error(`Unexpected prompt in mock processManager: ${prompt}`);
    };

    // Step 1: Start Team Run (Asynchronous execution pipeline)
    const runPromise = coordinator.startTeamRun({
      sessionId,
      runId,
      objective: 'Create database-backed user profile migration with down script and domain service',
      workspacePath: tempRepo,
      teamConfig: {
        lead: 'antigravity',
        worker: 'codex',
        reviewer: 'claude_code',
      },
    });

    // Step 2: Wait for planning to complete and enter 'awaiting-approval'
    let run = store.getRun(sessionId, runId);
    while (run?.state !== 'awaiting-approval') {
      await new Promise((r) => setTimeout(r, 50));
      run = store.getRun(sessionId, runId);
    }

    expect(run.state).toBe('awaiting-approval');
    expect(run.stage).toBe('awaiting-approval');
    expect(run.appraisal?.problemSummary).toBeDefined();
    expect(run.tasks.length).toBe(2);

    // Step 3: Approve plan (Lead / Human sign-off)
    const approved = coordinator.approvePlan(sessionId, runId);
    expect(approved).toBe(true);

    // Step 4: Wait for the assembly line to complete all stages
    let current = store.getRun(sessionId, runId);
    const startTime = Date.now();
    while (
      current &&
      current.state !== 'completed' &&
      current.state !== 'failed' &&
      current.state !== 'needs-attention' &&
      Date.now() - startTime < 20000
    ) {
      await new Promise((r) => setTimeout(r, 100));
      current = store.getRun(sessionId, runId);
    }

    run = store.getRun(sessionId, runId)!;
    expect(run.state).toBe('completed');
    expect(run.stage).toBe('completed');

    // Verify all tasks succeeded
    expect(run.tasks.every((t) => t.status === 'succeeded')).toBe(true);

    // Wait briefly for off-critical-path async Scribe documentarian to record its check
    let scribeCheck = run.checks.find((c) => c.name.includes('Scribe'));
    const scribeWaitStart = Date.now();
    while (!scribeCheck && Date.now() - scribeWaitStart < 4000) {
      await new Promise((r) => setTimeout(r, 50));
      run = store.getRun(sessionId, runId)!;
      scribeCheck = run.checks.find((c) => c.name.includes('Scribe'));
    }

    // Verify checks passed (including Database Migration Canary and Scribe)
    expect(run.checks.length).toBeGreaterThanOrEqual(2);
    const canaryCheck = run.checks.find((c) => c.name.includes('Canary') || c.command.includes('canary'));
    expect(canaryCheck?.status).toBe('passed');
    expect(scribeCheck?.status).toBe('passed');

    // Step 5: Merge changes into main branch
    const mergeResult = await coordinator.mergeRunToMain(sessionId, runId, tempRepo);
    expect(mergeResult.success).toBe(true);

    // Verify repository files on main branch
    expect(fs.existsSync(path.join(tempRepo, 'migrations', '001_users.sql'))).toBe(true);
    expect(fs.existsSync(path.join(tempRepo, 'migrations', '001_users.down.sql'))).toBe(true);
    expect(fs.existsSync(path.join(tempRepo, 'src', 'userService.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tempRepo, 'docs', 'architecture.md'))).toBe(true);
    expect(fs.existsSync(path.join(tempRepo, 'AGENTS.md'))).toBe(true);

    // Verify git log contains merge commit
    const logOutput = execFileSync('git', ['log', '--oneline', '-n', '5'], { cwd: tempRepo, encoding: 'utf-8' });
    expect(logOutput).toContain('Lyra: Delivered integrated run changes');
  });
});
