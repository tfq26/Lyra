#!/usr/bin/env bun
/**
 * Lyra Cloud Dispatcher (Architecture 1: Zero-Daemon Ephemeral Cloud Runner)
 * 
 * Dispatches autonomous software development tasks directly to ephemeral
 * cloud runners on AWS Bedrock. No long-running background server required on your laptop.
 * 
 * Usage:
 *   bun run scripts/lyra-dispatch.ts "Implement OAuth2 & Stripe webhook"
 *   bun run scripts/lyra-dispatch.ts --async "Refactor database models"
 *   bun run scripts/lyra-dispatch.ts --model us.anthropic.claude-sonnet-5 "Fix race condition"
 */

import { parseArgs } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { UnifiedStore } from '../server/unifiedStore';
import { TeamCoordinator } from '../server/teamCoordinator';
import { ProcessManager } from '../server/processManager';
import { NativeAgentRuntime } from '../server/nativeAgentRuntime';
import { resolveOptimalModel } from '../server/modelRouter';
import { LyraHarnessGateway } from '../server/gateway';

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

loadEnvFile(path.join(process.cwd(), '.env.local'));
loadEnvFile(path.join(process.cwd(), '.env'));

function hydrateAwsCredentials() {
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) return;
  try {
    const raw = execFileSync('aws', ['configure', 'export-credentials', '--format', 'process'], {
      encoding: 'utf8',
      timeout: 4000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const parsed = JSON.parse(raw);
    if (parsed.AccessKeyId && parsed.SecretAccessKey) {
      process.env.AWS_ACCESS_KEY_ID = parsed.AccessKeyId;
      process.env.AWS_SECRET_ACCESS_KEY = parsed.SecretAccessKey;
      if (parsed.SessionToken) process.env.AWS_SESSION_TOKEN = parsed.SessionToken;
      if (!process.env.AWS_REGION) process.env.AWS_REGION = 'us-east-1';
    }
  } catch {
    // non-fatal
  }
}

hydrateAwsCredentials();

interface GitExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

function execGit(args: string[], cwd: string): Promise<GitExecResult> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? 0 }));
    child.on('error', (err) => resolve({ stdout, stderr: err.message, code: 1 }));
  });
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: 'boolean', short: 'h', default: false },
      async: { type: 'boolean', short: 'd', default: false },
      wait: { type: 'boolean', short: 'w', default: true },
      model: { type: 'string', short: 'm', default: 'auto' },
      workspace: { type: 'string', short: 'C', default: process.cwd() },
      'auto-merge': { type: 'boolean', default: false },
      cloudUrl: { type: 'string', default: process.env.LYRA_CLOUD_URL || process.env.LYRA_HUB_URL },
      apiKey: { type: 'string', default: process.env.LYRA_GATEWAY_API_KEY || 'lyra-harness-default-secret' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`\n🌌 [Lyra Cloud Swarm] Ephemeral Cloud Dispatcher (Architecture 1)
Usage:
  bun run dispatch "Task description" [options]

Options:
  -d, --async      Fire-and-forget; exits immediately after cloud dispatch
  -m, --model      Target Bedrock model (default: auto Pareto routing)
  -C, --workspace  Target workspace repository path (default: current directory)
  --cloudUrl       Remote Lyra Cloud Gateway URL (default: $LYRA_CLOUD_URL)
  --apiKey         Lyra Gateway PAT Token / API Key
  -h, --help       Show this help message
`);
    process.exit(0);
  }

  const objective = positionals.join(' ').trim();
  if (!objective) {
    console.error('❌ Error: Objective required.');
    console.error('Example: bun run scripts/lyra-dispatch.ts "Add password reset flow with unit tests"');
    process.exit(1);
  }

  const workspacePath = path.resolve(values.workspace);
  console.log(`\n🌌 [Lyra Cloud Swarm] Ephemeral Cloud Dispatcher (Architecture 1: Zero-Daemon)`);
  console.log(`📂 Workspace: ${workspacePath}`);
  console.log(`🎯 Objective: "${objective}"`);

  // 1. Pre-flight Git Verification
  const gitStatus = await execGit(['status', '--porcelain'], workspacePath);
  const headCommit = (await execGit(['rev-parse', '--short', 'HEAD'], workspacePath)).stdout;
  console.log(`🌿 Base Git Commit: ${headCommit}`);

  // 2. Multi-Objective Model Decision
  const optimalModel = resolveOptimalModel({ prompt: objective, role: 'coder' });
  const selectedModelId = values.model !== 'auto' ? values.model! : optimalModel.modelId;
  console.log(`🧠 Pareto Bedrock Model: ${values.model !== 'auto' ? values.model : optimalModel.modelName} (${optimalModel.reason})`);

  // 3. Dispatch Strategy: Remote Cloud Gateway vs. Ephemeral In-Process Runner
  if (values.cloudUrl && !values.cloudUrl.includes('localhost:3001')) {
    console.log(`☁️ Dispatching to Lyra Cloud Gateway: ${values.cloudUrl}...`);
    try {
      const res = await fetch(`${values.cloudUrl.replace(/\/+$/, '')}/api/gateway/dispatch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${values.apiKey}`,
        },
        body: JSON.stringify({
          workspacePath,
          objective,
          model: selectedModelId,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Cloud dispatch failed' })) as any;
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data = await res.json() as any;
      console.log(`\n🚀 [Cloud Runner Activated]`);
      console.log(`   Session ID: ${data.sessionId}`);
      console.log(`   Run ID:     ${data.runId}`);
      console.log(`   Status:     ${data.status}`);

      if (values.async) {
        console.log(`\n✨ Task running in cloud. You can close your terminal safely.`);
        console.log(`   Run status: ${values.cloudUrl}/api/gateway/runs/${data.runId}/status`);
        process.exit(0);
      }
      return;
    } catch (err: any) {
      console.warn(`⚠️ Cloud gateway unreachable (${err.message}). Falling back to ephemeral local cloud runner...`);
    }
  }

  // 4. Ephemeral Runner: Executes on-demand and terminates when finished (0 standing daemon)
  console.log(`⚡ Launching ephemeral cloud swarm runner (Scale-to-Zero)...`);
  const store = new UnifiedStore(process.env.LYRA_STORAGE_PATH);
  const processManager = new ProcessManager();
  const nativeRuntime = new NativeAgentRuntime(store);
  const teamCoordinator = new TeamCoordinator(store, processManager, nativeRuntime);
  const gateway = new LyraHarnessGateway(store, teamCoordinator, { apiKey: values.apiKey });

  const dispatchResult = await gateway.dispatchTask({
    workspacePath,
    objective,
    model: selectedModelId,
    approvalPolicy: 'auto',
  });

  console.log(`\n🚀 [Run Dispatched]`);
  console.log(`   Run ID: ${dispatchResult.runId}`);
  console.log(`   Integration Branch: lyra/integration-${dispatchResult.runId}`);

  if (values.async) {
    console.log(`\n✨ Dispatched in background. Terminal exiting immediately.`);
    process.exit(0);
  }

  // Wait for completion if not async
  console.log(`\n⏳ Coordinating cloud workers on AWS Bedrock...`);
  const startTime = Date.now();

  await new Promise<void>((resolve) => {
    const checkInterval = setInterval(async () => {
      const run = store.getRun(dispatchResult.sessionId, dispatchResult.runId);
      if (!run) return;

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const state = run.state || run.stage;
      const succeededTasks = run.tasks?.filter((t) => t.status === 'succeeded').length || 0;
      const totalTasks = run.tasks?.length || 0;

      process.stdout.write(`\r[${elapsed}s] State: ${state.toUpperCase().padEnd(16)} | Tasks: ${succeededTasks}/${totalTasks} completed`);

      const stateStr = String(state);
      if (stateStr === 'completed' || stateStr === 'succeeded' || stateStr === 'failed' || stateStr === 'cancelled' || stateStr === 'needs-attention') {
        clearInterval(checkInterval);
        console.log(`\n\n🏁 Swarm Run Finished with state: [${stateStr.toUpperCase()}] in ${elapsed}s`);
        if (stateStr === 'completed' || stateStr === 'succeeded') {
          console.log(`✅ Integration branch ready: lyra/integration-${dispatchResult.runId}`);
          if (values['auto-merge']) {
            console.log(`🔀 Auto-merging lyra/integration-${dispatchResult.runId} into current branch...`);
            const ffMerge = await execGit(['merge', '--ff-only', `lyra/integration-${dispatchResult.runId}`], workspacePath);
            if (ffMerge.code === 0) {
              console.log(`🎉 Fast-forward merged successfully into branch!`);
              await execGit(['worktree', 'prune'], workspacePath);
            } else {
              const stdMerge = await execGit(['merge', '-m', `Lyra: Auto-merge ${objective}`, `lyra/integration-${dispatchResult.runId}`], workspacePath);
              if (stdMerge.code === 0) {
                console.log(`🎉 Merged successfully into branch!`);
                await execGit(['worktree', 'prune'], workspacePath);
              } else {
                console.warn(`⚠️ Merge notice: ${stdMerge.stderr || ffMerge.stderr}. Please inspect manually.`);
              }
            }
          } else {
            console.log(`   Run 'git merge lyra/integration-${dispatchResult.runId}' to merge.`);
          }
        }
        resolve();
      }
    }, 2000);
  });

  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Dispatch error:', err.message || err);
  process.exit(1);
});
