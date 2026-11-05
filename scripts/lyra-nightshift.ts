#!/usr/bin/env bun
/**
 * Lyra Night Shift CLI
 *
 * Commands:
 *   bun scripts/lyra-nightshift.ts audit       - Scans workspace with Living Repo Brain & flags invariant violations
 *   bun scripts/lyra-nightshift.ts repro <log> - Simulates a CI/runtime error, boots sandbox, proves RED, fixes & proves GREEN
 *   bun scripts/lyra-nightshift.ts daemon      - Starts the 24/7 background webhook listener on :3002
 */

import { astIndexer } from '../server/repoBrain/astIndexer';
import { invariantDetector } from '../server/repoBrain/invariantDetector';
import { nightShiftRunner } from '../server/nightShift/nightShiftRunner';
import { triggerEngine } from '../server/nightShift/triggerEngine';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

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

const args = process.argv.slice(2);
const command = args[0] || 'audit';

async function main() {
  if (command === 'audit') {
    const targetDir = args[1] ? path.resolve(args[1]) : process.cwd();
    console.log(`\n🧠 [Living Repo Brain] Indexing workspace: ${targetDir}...`);
    const t0 = Date.now();
    const index = await astIndexer.indexWorkspace(targetDir);
    const ms = Date.now() - t0;

    console.log(`✨ Indexed ${index.totalFiles} files and ${index.totalSymbols} symbols in ${ms}ms.`);

    const violations = invariantDetector.detectInvariants(index);
    if (violations.length === 0) {
      console.log(`✅ 0 invariant violations detected across call-sites and imports.\n`);
    } else {
      console.log(`\n⚠️  Found ${violations.length} invariant drift / broken call-site item(s):`);
      for (const v of violations.slice(0, 10)) {
        console.log(`- [${v.severity.toUpperCase()}] ${v.sourceFile}:${v.sourceLine} -> ${v.message}`);
        if (v.suggestedFix) console.log(`  Fix: ${v.suggestedFix}`);
      }
      console.log();
    }
    return;
  }

  if (command === 'repro') {
    let targetWorkspace = process.cwd();
    let errorLog = '';

    const remainingArgs = args.slice(1);
    const lastArg = remainingArgs[remainingArgs.length - 1];
    if (lastArg && fs.existsSync(lastArg) && fs.statSync(lastArg).isDirectory()) {
      targetWorkspace = path.resolve(lastArg);
      errorLog = remainingArgs.slice(0, -1).join(' ');
    } else {
      errorLog = remainingArgs.join(' ');
    }

    if (!errorLog) {
      errorLog = `TypeError: Cannot read properties of undefined (reading 'useEffect')\n    at useEffect (src/components/Canvas/StickyNote.tsx:62:9)`;
    }

    // Auto-detect test runner or build command in target workspace
    let testCommand = 'bun';
    let testArgs = ['test'];
    const isBuild =
      errorLog.includes('build') ||
      errorLog.includes('error TS') ||
      errorLog.includes('--jsx') ||
      errorLog.includes('TS17004') ||
      errorLog.includes('Cannot use JSX');

    if (isBuild) {
      testCommand = 'npm';
      testArgs = ['run', 'build'];
    } else {
      const pkgPath = path.join(targetWorkspace, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          if (pkg.scripts?.test?.includes('jest')) {
            testCommand = 'npx';
            testArgs = ['jest'];
          }
        } catch {}
      }
    }

    console.log(`\n🌙 [Autonomous Night Shift] Simulating investigation for error:`);
    console.log(`   "${errorLog.split('\n')[0]}"`);
    console.log(`   Workspace: ${targetWorkspace}`);
    console.log(`   Test Runner: ${testCommand} ${testArgs.join(' ')}\n`);

    const report = await nightShiftRunner.runInvestigation({
      event: {
        id: `sim-${Date.now()}`,
        source: 'manual',
        repository: path.basename(targetWorkspace),
        branch: 'main',
        commitSha: 'HEAD',
        errorLog,
        receivedAt: new Date().toISOString(),
      },
      workspacePath: targetWorkspace,
      testCommand,
      testArgs,
    });

    console.log(report.proofMarkdown);
    console.log(`\n✅ Night Shift investigation complete in ${(report.durationMs / 1000).toFixed(1)}s.`);
    return;
  }

  if (command === 'daemon') {
    const PORT = 3002;
    const server = http.createServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/api/nightshift/webhook') {
        let body = '';
        req.on('data', (d) => (body += d.toString()));
        req.on('end', async () => {
          try {
            const json = JSON.parse(body);
            const event =
              triggerEngine.parseGitHubWebhook(req.headers, body, json) ||
              triggerEngine.parseSentryWebhook(json) || {
                id: `webhook-${Date.now()}`,
                source: 'github_actions' as const,
                repository: json.repository || 'unknown',
                branch: json.branch || 'main',
                commitSha: json.sha || 'HEAD',
                errorLog: json.errorLog || json.message || 'Webhook error',
                receivedAt: new Date().toISOString(),
              };

            console.log(`[Night Shift Daemon] Received event from ${event.source}: ${event.errorLog.slice(0, 80)}...`);

            // Run investigation in background
            nightShiftRunner.runInvestigation({ event, workspacePath: process.cwd() }).then((rep) => {
              console.log(`[Night Shift Daemon] Investigation ${rep.runId} finished (Verified: ${rep.passedVerification})`);
            });

            res.writeHead(202, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'investigating', eventId: event.id }));
          } catch (err: any) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'online', service: 'Lyra Autonomous Night Shift Daemon' }));
    });

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🌙 [Lyra Night Shift Daemon] Listening on http://0.0.0.0:${PORT}/api/nightshift/webhook`);
    });
    return;
  }

  console.log(`Usage: bun scripts/lyra-nightshift.ts [audit|repro|daemon]`);
}

main().catch(console.error);
