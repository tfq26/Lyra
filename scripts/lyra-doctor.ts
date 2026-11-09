#!/usr/bin/env bun
/**
 * Lyra System Doctor & Environment Auditor
 *
 * Runs comprehensive operational diagnostics across:
 *   1. Runtime Environment (Bun, Node, OS, Memory, Architecture)
 *   2. Git & Worktree Subsystem
 *   3. AWS Cloud & Bedrock Frontier Credentials
 *   4. Preview & Tunneling Subsystem (cloudflared)
 *   5. FinOps Safety Guardrails (Run Budget & Monthly Spend Caps)
 *   6. Local Ports & Hub Reachability
 *
 * Usage:
 *   bun run scripts/lyra-doctor.ts
 *   bun run doctor
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import net from 'node:net';

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

interface DiagnosticItem {
  category: string;
  name: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  remedy?: string;
}

const diagnostics: DiagnosticItem[] = [];

function checkPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function runDoctor() {
  console.log('\n============================================================');
  console.log('🩺 [LYRA DOCTOR] System Health & Operational Audit');
  console.log('============================================================\n');

  // 1. Runtime Environment
  const bunVersion = process.versions.bun;
  if (bunVersion) {
    diagnostics.push({
      category: 'Runtime',
      name: 'Bun Engine',
      status: 'pass',
      detail: `v${bunVersion} (${os.platform()} ${os.arch()})`,
    });
  } else {
    diagnostics.push({
      category: 'Runtime',
      name: 'Bun Engine',
      status: 'fail',
      detail: 'Bun runtime not detected in current process.',
      remedy: 'Install Bun via: curl -fsSL https://bun.sh/install | bash',
    });
  }

  const memMb = Math.round(os.totalmem() / (1024 * 1024));
  const cpus = os.cpus().length;
  diagnostics.push({
    category: 'Hardware',
    name: 'Host Resources',
    status: memMb >= 4096 ? 'pass' : 'warn',
    detail: `${cpus} cores, ${memMb} MB RAM available`,
    remedy: memMb < 4096 ? 'Host has < 4GB RAM. Concurrency might be constrained.' : undefined,
  });

  // 2. Git & Worktrees
  try {
    const gitVer = execFileSync('git', ['--version'], { encoding: 'utf8' }).trim();
    const isGitRepo = fs.existsSync(path.join(process.cwd(), '.git'));
    
    if (isGitRepo) {
      diagnostics.push({
        category: 'Git',
        name: 'Repository & Worktrees',
        status: 'pass',
        detail: `${gitVer} (Active repository at ${process.cwd()})`,
      });
    } else {
      diagnostics.push({
        category: 'Git',
        name: 'Repository & Worktrees',
        status: 'warn',
        detail: `${gitVer} (Not inside a Git repository root)`,
        remedy: 'Run git init in your project directory to enable isolated agent worktrees.',
      });
    }
  } catch (err: any) {
    diagnostics.push({
      category: 'Git',
      name: 'Git Binary',
      status: 'fail',
      detail: `Git executable failed: ${err.message}`,
      remedy: 'Ensure git is installed and present in your system PATH.',
    });
  }

  // 3. AWS Bedrock Credentials
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
  const hasKey = Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
  const hasProfile = Boolean(process.env.AWS_PROFILE);

  if (hasKey || hasProfile) {
    diagnostics.push({
      category: 'AWS Cloud',
      name: 'Bedrock Authentication',
      status: 'pass',
      detail: `Configured for region '${region}' via ${hasKey ? 'static environment keys' : `profile '${process.env.AWS_PROFILE}'`}`,
    });
  } else {
    // Check if AWS CLI is configured
    try {
      const callerId = execFileSync('aws', ['sts', 'get-caller-identity', '--query', 'Arn', '--output', 'text'], {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();

      diagnostics.push({
        category: 'AWS Cloud',
        name: 'Bedrock Authentication',
        status: 'pass',
        detail: `Authenticated via AWS CLI as ${callerId} (region: ${region})`,
      });
    } catch {
      diagnostics.push({
        category: 'AWS Cloud',
        name: 'Bedrock Authentication',
        status: 'warn',
        detail: 'No AWS credentials detected in environment or AWS CLI cache.',
        remedy: 'Configure AWS credentials (aws configure) or set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env.local to access live Bedrock models.',
      });
    }
  }

  // 4. Cloudflare Tunnel
  try {
    const cfVer = execFileSync('cloudflared', ['--version'], { encoding: 'utf8' }).trim();
    diagnostics.push({
      category: 'Networking',
      name: 'Cloudflare Tunnel (cloudflared)',
      status: 'pass',
      detail: cfVer.split('\n')[0] || 'Installed',
    });
  } catch {
    diagnostics.push({
      category: 'Networking',
      name: 'Cloudflare Tunnel (cloudflared)',
      status: 'warn',
      detail: 'cloudflared not detected in PATH. Ephemeral public tunnels will fall back to local URLs.',
      remedy: 'Install cloudflared: brew install cloudflared (macOS) or curl -fsSL https://pkg.cloudflare.com/cloudflared ...',
    });
  }

  // 5. FinOps Safety Guardrails
  const maxRunBudget = process.env.LYRA_MAX_RUN_BUDGET_USD || '25.00';
  const monthlyCap = process.env.LYRA_MONTHLY_SPEND_CAP_USD || '250.00';
  diagnostics.push({
    category: 'FinOps',
    name: 'Budget Ceilings',
    status: 'pass',
    detail: `Max per-run budget: $${maxRunBudget} | Monthly spend cap: $${monthlyCap}`,
  });

  // 6. Local Ports
  const hubPortFree = await checkPortFree(3001);
  const previewPortFree = await checkPortFree(5176);

  diagnostics.push({
    category: 'Networking',
    name: 'Lyra Hub Port (3001)',
    status: 'pass',
    detail: hubPortFree ? 'Port 3001 is available for Lyra Hub.' : 'Port 3001 is active (Lyra Hub or another server is currently listening).',
  });

  diagnostics.push({
    category: 'Networking',
    name: 'Preview Port (5176)',
    status: 'pass',
    detail: previewPortFree ? 'Port 5176 is available for live previews.' : 'Port 5176 is currently occupied.',
  });

  // Render Scorecard
  let failCount = 0;
  let warnCount = 0;

  for (const item of diagnostics) {
    let icon = '✅';
    if (item.status === 'warn') {
      icon = '⚠️ ';
      warnCount++;
    } else if (item.status === 'fail') {
      icon = '❌';
      failCount++;
    }

    console.log(`${icon} [${item.category}] ${item.name}: ${item.detail}`);
    if (item.remedy) {
      console.log(`   💡 Remediation: ${item.remedy}`);
    }
  }

  console.log('\n============================================================');
  if (failCount === 0 && warnCount === 0) {
    console.log('🎉 System Status: 100% HEALTHY. Lyra is fully operational.');
  } else if (failCount === 0) {
    console.log(`⚡ System Status: OPERATIONAL with ${warnCount} warning(s). Offline/local fallback modes active.`);
  } else {
    console.log(`🚨 System Status: ${failCount} critical issue(s) require attention.`);
  }
  console.log('============================================================\n');

  if (failCount > 0) process.exit(1);
}

runDoctor().catch((err) => {
  console.error('Fatal doctor execution error:', err);
  process.exit(1);
});
