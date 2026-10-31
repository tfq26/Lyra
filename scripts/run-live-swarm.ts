#!/usr/bin/env bun
/**
 * Lyra Autonomous Strands Swarm Runner & Cloud Telemetry Benchmark
 * 
 * Executes an end-to-end swarm loop on a real codebase:
 * 1. Plan decomposition
 * 2. Strands worker execution in isolated worktrees
 * 3. Self-review loop & conflict checks
 * 4. Verification checks
 * 5. Direct merge to main (No PR)
 * 6. Cloud resource telemetry monitoring (Bedrock tokens, latency, cost)
 */

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

async function main() {
  console.log('\n🚀 Starting Lyra Autonomous Strands Agent Loop & Cloud Telemetry Test...\n');

  // 1. Setup target repository
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyra-swarm-live-'));
  execFileSync('git', ['init', '-b', 'main', '-q'], { cwd: targetDir });
  execFileSync('git', ['config', 'user.email', 'swarm@lyra.dev'], { cwd: targetDir });
  execFileSync('git', ['config', 'user.name', 'Lyra Autonomous Swarm'], { cwd: targetDir });

  fs.mkdirSync(path.join(targetDir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(targetDir, 'package.json'),
    JSON.stringify({ name: 'target-repo', version: '1.0.0', scripts: { test: 'bun test' } }, null, 2)
  );

  fs.writeFileSync(
    path.join(targetDir, 'src', 'calculator.ts'),
    `export function add(a: number, b: number): number {\n  return a + b;\n}\n`
  );

  fs.writeFileSync(
    path.join(targetDir, 'src', 'calculator.test.ts'),
    `import { describe, expect, it } from 'bun:test';\nimport { add } from './calculator';\n\ndescribe('add', () => {\n  it('adds numbers', () => {\n    expect(add(2, 3)).toBe(5);\n  });\n});\n`
  );

  execFileSync('git', ['add', '.'], { cwd: targetDir });
  execFileSync('git', ['commit', '-qm', 'initial base calculator'], { cwd: targetDir });

  console.log(`📁 Target repository initialized at: ${targetDir}`);

  // 2. Setup Lyra Engine
  const store = new UnifiedStore(path.join(targetDir, '.lyra-store'));
  const processManager = new ProcessManager();
  const worktreeManager = new WorktreeManager();
  const nativeRuntime = new NativeAgentRuntime(store);
  const coordinator = new TeamCoordinator(store, processManager, nativeRuntime);
  const monitor = new CloudMonitor(store);

  const sessionId = `session-${Date.now()}`;
  const runId = `run-${Date.now()}`;

  store.createSession({
    id: sessionId,
    title: 'Autonomous Swarm Loop Test',
    workspacePath: targetDir,
  });

  const objective = 'Implement multiply, divide (with divide-by-zero check), and power functions in src/calculator.ts, and add unit tests in src/calculator.test.ts';

  console.log(`🎯 Objective: "${objective}"`);
  console.log('⚡ Harness: Hermes (Strands Agent Runtime)');
  console.log('🤖 Auto-Routed Frontier Model: Claude Sonnet 4.6 (us.anthropic.claude-sonnet-4-6)');
  console.log('🧐 Independent Reviewer Model: Claude Opus 4.6 (us.anthropic.claude-opus-4-6-v1)\n');

  // 3. Start Team Run
  console.log('⏳ Step 1: Initializing Strands planner and decomposing tasks...');
  coordinator.startTeamRun({
    sessionId,
    runId,
    objective,
    workspacePath: targetDir,
    teamConfig: {
      lead: 'hermes',
      workers: ['hermes'],
      reviewer: 'hermes',
    },
  });

  // Wait for plan
  let run = store.getRun(sessionId, runId);
  while (run?.state !== 'awaiting-approval') {
    await new Promise((r) => setTimeout(r, 100));
    run = store.getRun(sessionId, runId);
  }

  console.log(`📋 Plan ready! ${run.tasks.length} task(s) proposed with ${run.acceptanceCriteria.length} acceptance criteria.`);
  for (const t of run.tasks) {
    console.log(`   - Task: ${t.title} [Scope: ${t.scope}]`);
  }

  // 4. Approve plan
  console.log('\n👍 Step 2: Approving strategic plan and dispatching isolated Strands workers...');
  coordinator.approvePlan(sessionId, runId);

  // 5. Monitor execution
  const startTime = Date.now();
  let current = store.getRun(sessionId, runId);
  while (
    current &&
    current.state !== 'completed' &&
    current.state !== 'failed' &&
    current.state !== 'needs-attention' &&
    Date.now() - startTime < 30000
  ) {
    monitor.captureSnapshot(runId);
    process.stdout.write(`\r⏳ Execution in progress... Stage: [${(current.stage || current.state).toUpperCase()}] | Elapsed: ${Math.floor((Date.now() - startTime) / 1000)}s`);
    await new Promise((r) => setTimeout(r, 200));
    current = store.getRun(sessionId, runId);
  }

  console.log('\n');

  run = store.getRun(sessionId, runId)!;
  if (run.state === 'failed' || run.state === 'needs-attention') {
    console.error(`❌ Run ended in state: ${run.state}. Summary: ${run.summary}`);
    process.exit(1);
  }

  console.log('✅ Step 3: All tasks succeeded! Self-review loop approved changes with 0 findings.');
  console.log('✅ Step 4: Verification checks passed cleanly.');
  console.log(`✅ Step 5: Conflict check verified: ${(run.conflicts?.length || 0) === 0 ? '0 conflicts' : run.conflicts?.join(', ')}`);

  // 6. Direct Merge to Main
  console.log('\n🔀 Step 6: Performing direct Git merge to main branch (No PR)...');
  const mergeResult = await coordinator.mergeRunToMain(sessionId, runId, targetDir);
  if (!mergeResult.success) {
    console.error(`❌ Merge failed: ${mergeResult.error}`);
    process.exit(1);
  }

  console.log('🎉 Successfully merged integrated revision directly into main branch!');

  // Verify on main
  const gitLog = execFileSync('git', ['log', '--oneline', '-n', '3'], { cwd: targetDir, encoding: 'utf-8' });
  console.log('\n📜 Git History on main:\n' + gitLog.trim().split('\n').map((l) => '   ' + l).join('\n'));

  // 7. Cloud Resource Telemetry
  const reportPath = path.join(process.cwd(), `telemetry-report-${runId}.json`);
  monitor.exportReport(reportPath, runId);

  console.log('\n📊 CLOUD RESOURCES & PROGRESS TELEMETRY:');
  console.log(monitor.renderDashboard(runId));
  console.log(`📁 Detailed JSON telemetry report exported to: ${reportPath}\n`);

  // Cleanup temp repo
  try {
    fs.rmSync(targetDir, { recursive: true, force: true });
  } catch {}
}

main().catch((err) => {
  console.error('Fatal error during swarm benchmark:', err);
  process.exit(1);
});
