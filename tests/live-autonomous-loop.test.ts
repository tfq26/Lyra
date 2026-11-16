import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { UnifiedStore } from '../server/unifiedStore';
import { ProcessManager } from '../server/processManager';
import { WorktreeManager } from '../server/worktreeManager';
import { NativeAgentRuntime } from '../server/nativeAgentRuntime';
import { TeamCoordinator } from '../server/teamCoordinator';
import { CloudMonitor } from '../server/cloudMonitor';

describe('Autonomous Strands Agent Loop with Review, Conflict Check & Direct Merge', () => {
  let tempRepo: string;
  let store: UnifiedStore;
  let processManager: ProcessManager;
  let worktreeManager: WorktreeManager;
  let nativeRuntime: NativeAgentRuntime;
  let coordinator: TeamCoordinator;
  let monitor: CloudMonitor;

  beforeEach(() => {
    // 1. Initialize a real target git codebase
    tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'lyra-live-codebase-'));
    execFileSync('git', ['init', '-b', 'main', '-q'], { cwd: tempRepo });
    execFileSync('git', ['config', 'user.email', 'strands-agent@lyra.dev'], { cwd: tempRepo });
    execFileSync('git', ['config', 'user.name', 'Lyra Strands Engine'], { cwd: tempRepo });

    // Seed realistic codebase with TypeScript source and unit test
    fs.mkdirSync(path.join(tempRepo, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tempRepo, 'package.json'),
      JSON.stringify(
        {
          name: 'live-target-project',
          version: '1.0.0',
          scripts: { test: 'bun test' },
        },
        null,
        2
      )
    );

    fs.writeFileSync(
      path.join(tempRepo, 'src', 'stringUtils.ts'),
      `/**\n * Capitalizes the first letter of a string.\n */\nexport function capitalize(str: string): string {\n  if (!str) return '';\n  return str.charAt(0).toUpperCase() + str.slice(1);\n}\n`
    );

    fs.writeFileSync(
      path.join(tempRepo, 'src', 'stringUtils.test.ts'),
      `import { describe, expect, it } from 'bun:test';\nimport { capitalize } from './stringUtils';\n\ndescribe('capitalize', () => {\n  it('capitalizes a lowercase word', () => {\n    expect(capitalize('lyra')).toBe('Lyra');\n  });\n});\n`
    );

    execFileSync('git', ['add', '.'], { cwd: tempRepo });
    execFileSync('git', ['commit', '-qm', 'initial base codebase'], { cwd: tempRepo });

    // 2. Initialize Lyra Engine & Store
    const storeDir = path.join(tempRepo, '.lyra-store');
    store = new UnifiedStore(storeDir);
    processManager = new ProcessManager();
    worktreeManager = new WorktreeManager();
    nativeRuntime = new NativeAgentRuntime(store);
    coordinator = new TeamCoordinator(store, processManager, nativeRuntime);
    monitor = new CloudMonitor(store);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempRepo, { recursive: true, force: true });
    } catch {}
  });

  it('runs complete autonomous loop: plan -> strands workers -> self review -> conflict check -> direct merge', async () => {
    const sessionId = 'session-strands-test';
    const runId = 'run-strands-test';

    store.createSession({
      id: sessionId,
      title: 'Live Strands Verification',
      workspacePath: tempRepo,
    });

    // Configure ProcessManager to execute Strands agents with simulated Bedrock responses
    processManager.runAgent = async ({ agentType, prompt, cwd = tempRepo, processId }) => {
      // Record model invocation in CloudMonitor
      monitor.recordInvocation('us.anthropic.claude-sonnet-4-6', 1200, 350);

      // 1. Planner Stage: System architect decomposes requirements into tasks with acceptance criteria
      if (prompt.includes('Lead Architect') || prompt.includes('Strategic Appraisal')) {
        const plan = {
          appraisal: {
            problemSummary: 'Implement slugify and camelCase utilities with unit tests in src/stringUtils.ts',
            reusedAssets: ['src/stringUtils.ts'],
            costScaleNotes: 'Micro task, sub-second execution.',
            recommendedApproach: 'Extend stringUtils.ts with type definitions and expand unit tests.',
          },
          summary: 'String utilities expansion with slugify and camelCase',
          acceptanceCriteria: [
            'slugify converts input to kebab-case slug without special characters',
            'camelCase converts space or dash-separated string to camelCase',
            'All unit tests pass in src/stringUtils.test.ts',
          ],
          tasks: [
            {
              title: 'Implement slugify and camelCase in stringUtils.ts',
              scope: 'src/stringUtils.ts',
              expectedOutputs: ['src/stringUtils.ts'],
              recommendedHarness: 'strands',
            },
            {
              title: 'Add comprehensive unit tests for slugify and camelCase',
              scope: 'src/stringUtils.test.ts',
              expectedOutputs: ['src/stringUtils.test.ts'],
              recommendedHarness: 'strands',
              dependsOn: ['Implement slugify and camelCase in stringUtils.ts'],
            },
          ],
          checks: [
            {
              id: 'chk-unit-tests',
              name: 'Unit Tests Suite',
              command: 'bun test src/stringUtils.test.ts',
            },
          ],
        };

        return {
          sessionId,
          runId,
          processId,
          agentType: 'strands',
          code: 0,
          fullContent: '```json\n' + JSON.stringify(plan, null, 2) + '\n```',
          usage: { promptTokens: 1200, completionTokens: 350, totalTokens: 1550 },
        };
      }

      // 2. Reviewer Stage: Independent self-review verifying diff against criteria
      if (prompt.includes('independent code reviewer')) {
        return {
          sessionId,
          runId,
          processId,
          agentType: 'strands',
          code: 0,
          fullContent: JSON.stringify({
            approved: true,
            findings: [],
          }),
          usage: { promptTokens: 1500, completionTokens: 60, totalTokens: 1560 },
        };
      }

      // 3. Worker Stage: Strands Worker implementing code in worktree
      if (prompt.includes('Your Assigned Task: Add comprehensive unit tests')) {
        const testFile = path.join(cwd, 'src', 'stringUtils.test.ts');
        const testCode = `import { describe, expect, it } from 'bun:test';\nimport { capitalize, slugify, camelCase } from './stringUtils';\n\ndescribe('stringUtils', () => {\n  it('capitalize', () => {\n    expect(capitalize('lyra')).toBe('Lyra');\n  });\n\n  it('slugify converts titles to slugs', () => {\n    expect(slugify('Hello World! 2026')).toBe('hello-world-2026');\n  });\n\n  it('camelCase converts separated words', () => {\n    expect(camelCase('autonomous strands loop')).toBe('autonomousStrandsLoop');\n  });\n});\n`;
        fs.writeFileSync(testFile, testCode, 'utf-8');

        return {
          sessionId,
          runId,
          processId,
          agentType: 'strands',
          code: 0,
          fullContent: 'Added comprehensive test suite covering slugify and camelCase.',
          usage: { promptTokens: 950, completionTokens: 220, totalTokens: 1170 },
        };
      }

      if (prompt.includes('Your Assigned Task: Implement slugify and camelCase')) {
        const targetFile = path.join(cwd, 'src', 'stringUtils.ts');
        const code = `/**\n * Capitalizes the first letter of a string.\n */\nexport function capitalize(str: string): string {\n  if (!str) return '';\n  return str.charAt(0).toUpperCase() + str.slice(1);\n}\n\n/**\n * Converts text into a URL-friendly slug.\n */\nexport function slugify(str: string): string {\n  return str\n    .toLowerCase()\n    .trim()\n    .replace(/[^\\w\\s-]/g, '')\n    .replace(/[\\s_-]+/g, '-')\n    .replace(/^-+|-+$/g, '');\n}\n\n/**\n * Converts text to camelCase.\n */\nexport function camelCase(str: string): string {\n  return str\n    .toLowerCase()\n    .replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => chr.toUpperCase());\n}\n`;
        fs.writeFileSync(targetFile, code, 'utf-8');

        return {
          sessionId,
          runId,
          processId,
          agentType: 'strands',
          code: 0,
          fullContent: 'Implemented slugify and camelCase with complete TypeScript definitions.',
          usage: { promptTokens: 900, completionTokens: 250, totalTokens: 1150 },
        };
      }

      throw new Error(`Unexpected prompt: ${prompt}`);
    };

    // Step A: Start Team Run
    const runPromise = coordinator.startTeamRun({
      sessionId,
      runId,
      objective: 'Implement slugify and camelCase utility functions with unit tests',
      workspacePath: tempRepo,
      teamConfig: {
        lead: 'strands',
        worker: 'strands',
        reviewer: 'strands',
      },
    });

    // Step B: Wait for strategic plan and approve it
    let run = store.getRun(sessionId, runId);
    while (run?.state !== 'awaiting-approval') {
      await new Promise((r) => setTimeout(r, 40));
      run = store.getRun(sessionId, runId);
    }

    expect(run.state).toBe('awaiting-approval');
    expect(run.tasks.length).toBe(2);
    expect(run.acceptanceCriteria.length).toBe(3);

    // Human/Lead approval
    coordinator.approvePlan(sessionId, runId);

    // Step C: Monitor execution progress
    const startTime = Date.now();
    let current = store.getRun(sessionId, runId);
    while (
      current &&
      current.state !== 'completed' &&
      current.state !== 'failed' &&
      current.state !== 'needs-attention' &&
      Date.now() - startTime < 15000
    ) {
      monitor.captureSnapshot(runId);
      await new Promise((r) => setTimeout(r, 60));
      current = store.getRun(sessionId, runId);
    }

    run = store.getRun(sessionId, runId)!;
    expect(run.state).toBe('completed');
    expect(run.tasks.every((t) => t.status === 'succeeded')).toBe(true);

    // Step D: Verify Self-Review Loop succeeded
    const reviewCheck = run.checks.find((c) => c.name.toLowerCase().includes('review'));
    expect(reviewCheck).toBeDefined();
    expect(reviewCheck?.status).toBe('passed');

    // Step E: Verify Automated Checks Passed
    const unitCheck = run.checks.find((c) => c.name.includes('Unit Tests') || c.command.includes('bun test'));
    expect(unitCheck?.status).toBe('passed');

    // Step F: Verify No Merge Conflicts
    expect(run.conflicts?.length || 0).toBe(0);

    // Step G: Direct Merge to Main (No PR)
    const mergeResult = await coordinator.mergeRunToMain(sessionId, runId, tempRepo);
    expect(mergeResult.success).toBe(true);

    // Verify main branch files directly
    const mainUtils = fs.readFileSync(path.join(tempRepo, 'src', 'stringUtils.ts'), 'utf-8');
    expect(mainUtils).toContain('export function slugify');
    expect(mainUtils).toContain('export function camelCase');

    const mainTests = fs.readFileSync(path.join(tempRepo, 'src', 'stringUtils.test.ts'), 'utf-8');
    expect(mainTests).toContain("expect(slugify('Hello World! 2026')).toBe('hello-world-2026')");

    // Execute actual tests on main branch to verify code integrity
    const testProc = spawnSync(process.execPath, ['test', 'src/stringUtils.test.ts'], { cwd: tempRepo, encoding: 'utf-8' });
    expect(testProc.status).toBe(0);
    expect((testProc.stdout || '') + (testProc.stderr || '')).toContain('pass');

    // Verify clean merge commit in Git history
    const gitLog = execFileSync('git', ['log', '--oneline', '-n', '5'], { cwd: tempRepo, encoding: 'utf-8' });
    expect(gitLog).toContain('Lyra: Delivered integrated run changes');

    // Step H: Verify Cloud Resource Monitor Gathered Telemetry Data
    const reportPath = path.join(tempRepo, 'telemetry-report.json');
    monitor.exportReport(reportPath, runId);
    expect(fs.existsSync(reportPath)).toBe(true);

    const telemetryReport = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    expect(telemetryReport.cloudResources.totalInvocations).toBeGreaterThanOrEqual(3);
    expect(telemetryReport.cloudResources.totalTokens).toBeGreaterThan(0);
    expect(telemetryReport.cloudResources.totalEstimatedCostUsd).toBeGreaterThan(0);
    expect(telemetryReport.runs.length).toBe(1);
    expect(telemetryReport.runs[0].diffs.hasConflicts).toBe(false);
  });
});
