import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { UnifiedStore } from './unifiedStore';
import { ProcessManager } from './processManager';
import { MessageBus } from './messageBus';
import { TeamCoordinator } from './teamCoordinator';
import { NativeAgentRuntime } from './nativeAgentRuntime';
import { saveProviderCredential } from './providerSecrets';
import { ModelCompatibilityService } from './modelCompatibility';
import { PostgresEventJournal } from './postgresEventJournal';
import { EcsNativeDispatcher } from './ecsNativeDispatcher';
import { PreviewManager } from './previewManager';
import { WorktreeManager } from './worktreeManager';
import { IdleManager } from './idleManager';
import { CloudMonitor } from './cloudMonitor';
import { getBetterAuthRuntime, getBetterAuthSession, initializeBetterAuth } from './betterAuth';
import { LyraHarnessGateway } from './gateway';
import { GitHubWebhookHandler } from './githubWebhookHandler';
import { BedrockModelCatalog } from './bedrockModelCatalog';
import { BEDROCK_CATALOG } from './modelDecisionEngine';
import { cloudWatchTelemetry } from './cloudwatchEmf';
import { sqsTaskQueue } from './sqsTaskQueue';
import { AHPServer } from './ahpProtocol';
import { OpenAiCompatBridge } from './openaiCompatBridge';
import { modelCouncil } from './modelCouncil';
import { triggerEngine } from './nightShift/triggerEngine';
import { nightShiftRunner } from './nightShift/nightShiftRunner';
import type { WSMessage, RunnerNode } from './types';
import { assertSafeId, validateWorkingDirectory } from './security';

const PORT = 3001;

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

/**
 * Automatically hydrates `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN`
 * from the active `aws login` CLI session (`aws configure export-credentials --format process`)
 * when not already set in environment variables.
 */
function hydrateAwsLoginCredentials() {
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
      if (parsed.SessionToken) {
        process.env.AWS_SESSION_TOKEN = parsed.SessionToken;
      }
      if (!process.env.AWS_REGION) {
        process.env.AWS_REGION = 'us-east-1';
      }
      console.log('[Lyra AWS] Hydrated live AWS Bedrock credentials from `aws login` session.');
    }
  } catch {
    // Non-fatal if aws cli is not logged in
  }
}

hydrateAwsLoginCredentials();
setInterval(hydrateAwsLoginCredentials, 10 * 60 * 1000).unref();

const store = new UnifiedStore();
const previewManager = new PreviewManager();
const worktreeManager = new WorktreeManager();
const ahpServer = new AHPServer(store);
let idleManager: IdleManager;

const registeredNodes = new Map<string, RunnerNode>([
  ['node-local', {
    id: 'node-local',
    name: 'Local Machine',
    type: 'local',
    os: process.platform,
    cpus: os.cpus().length,
    status: 'online',
    lastSeen: new Date().toISOString(),
  }],
  ['node-cloud', {
    id: 'node-cloud',
    name: 'AWS Fargate Cluster',
    type: 'cloud',
    os: 'linux',
    status: (process.env.LYRA_HOSTED === 'true' || process.env.AWS_REGION) ? 'online' : 'offline',
    lastSeen: new Date().toISOString(),
  }],
]);
let activeNodeId = 'node-local';
const processManager = new ProcessManager();
const messageBus = new MessageBus();
const eventJournal = process.env.LYRA_DATABASE_HOST
  ? new PostgresEventJournal(process.env.LYRA_TENANT_ID || 'local', {
      host: process.env.LYRA_DATABASE_HOST,
      port: Number(process.env.LYRA_DATABASE_PORT || 5432),
      database: process.env.LYRA_DATABASE_NAME || 'lyra',
      username: process.env.LYRA_DATABASE_USER || 'lyra',
      password: process.env.LYRA_DATABASE_PASSWORD || '',
      ssl: process.env.LYRA_DATABASE_SSL !== 'false',
    })
  : undefined;
const nativeAgentRuntime = new NativeAgentRuntime(store, () => eventJournal?.waitForWrites() || Promise.resolve());
const teamCoordinator = new TeamCoordinator(store, processManager, nativeAgentRuntime, previewManager);
const modelCompatibility = new ModelCompatibilityService(store);
const ecsNativeDispatcher = new EcsNativeDispatcher();
const runnerSockets = new Map<string, WebSocket>();
const legacyAuthToken = process.env.LYRA_AUTH_TOKEN;
const runnerToken = process.env.LYRA_RUNNER_TOKEN || process.env.LYRA_AUTH_TOKEN;
const harnessGateway = new LyraHarnessGateway(store, teamCoordinator);
ahpServer.attachGateway(harnessGateway);
const openAiBridge = new OpenAiCompatBridge(ahpServer);

function publicProviderProfile(profile: import('./types').ModelProviderProfile) {
  const { secretRef, externalId: _externalId, ...safe } = profile;
  const hasCredential = profile.credentialMode === 'managed'
    ? profile.provider === 'bedrock' || Boolean(secretRef || process.env.LYRA_MANAGED_OPENROUTER_SECRET_ARN || process.env.LYRA_MANAGED_OPENROUTER_API_KEY)
    : Boolean(secretRef) || (profile.provider === 'openrouter' ? Boolean(process.env.OPENROUTER_API_KEY) : process.env.LYRA_HOSTED !== 'true' || Boolean(profile.roleArn));
  return { ...safe, hasCredential };
}

function assertNativeModelReady(profileId: string) {
  const profile = store.listModelProviderProfiles().find((item) => item.id === profileId);
  if (!profile) throw new Error('Choose a saved Bedrock or OpenRouter connection in Settings before using Lyra.');
  const compatibility = store.getModelCompatibility(profile.id);
  if (!compatibility) throw new Error('Run the model compatibility check in Settings before starting a coding session.');
  const required = ['toolCalling', 'cancellation', 'sessionResume'] as const;
  const missing = required.filter((capability) => !compatibility.capabilities[capability]?.passed);
  if (missing.length) throw new Error(`This model has limited compatibility for long coding sessions: ${missing.join(', ')} did not pass. Choose another model or use it only for supported tasks.`);
  return profile;
}

async function isAuthorized(req: http.IncomingMessage) {
  if (!process.env.LYRA_HOSTED && legacyAuthToken) {
    const cookies = req.headers.cookie || '';
    const cookieToken = cookies.split(';').map((part) => part.trim()).find((part) => part.startsWith('lyra_auth='))?.slice('lyra_auth='.length);
    if (req.headers.authorization === `Bearer ${legacyAuthToken}` || cookieToken === legacyAuthToken) return true;
  }
  if (getBetterAuthRuntime()) return Boolean(await getBetterAuthSession(req.headers));
  return process.env.NODE_ENV !== 'production' && process.env.LYRA_HOSTED !== 'true';
}

function resolveWorkspacePath(requestedPath: string): string {
  const fallback = fs.existsSync('/workspace') ? '/workspace' : process.cwd();
  if (process.env.LYRA_HOSTED === 'true') {
    try { return validateWorkingDirectory(requestedPath, ['/workspace']); }
    catch { return validateWorkingDirectory(fallback, ['/workspace']); }
  }
  try {
    return validateWorkingDirectory(requestedPath);
  } catch {
    return validateWorkingDirectory(fallback);
  }
}

const server = http.createServer(async (req, res) => {
  idleManager?.recordActivity();
  // CORS headers
  const origin = req.headers.origin;
  const isAllowedOrigin = !origin ||
    origin === 'http://localhost:5173' ||
    origin === 'http://127.0.0.1:5173' ||
    origin === 'http://localhost:3001' ||
    origin === 'http://127.0.0.1:3001';
  if (isAllowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin || 'http://localhost:5173');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, Cookie, X-Lyra-Api-Key, X-Lyra-Session-Id, X-Lyra-Harness, X-Lyra-Device-Id'
  );
  res.setHeader('Access-Control-Expose-Headers', 'Set-Cookie, X-Lyra-Session-Id, X-Lyra-Latest-Seq');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  if (url.pathname === '/api/auth/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ required: Boolean(getBetterAuthRuntime()), signUpEnabled: process.env.LYRA_AUTH_DISABLE_SIGNUP !== 'true' }));
    return;
  }

  if (url.pathname.startsWith('/api/auth/') && getBetterAuthRuntime()) {
    await getBetterAuthRuntime()!.handleNodeRequest(req, res);
    return;
  }

  // --- AUTONOMOUS NIGHT SHIFT & PROOF SANDBOX WEBHOOKS & API ---
  if ((url.pathname === '/api/nightshift/webhook' || url.pathname === '/api/gateway/nightshift/webhook') && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const event =
          triggerEngine.parseGitHubWebhook(req.headers as any, body, payload) ||
          triggerEngine.parseSentryWebhook(payload);

        if (!event) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ignored', message: 'No actionable CI/error failure detected in webhook payload' }));
          return;
        }

        const workspace = process.cwd();
        void nightShiftRunner.runInvestigation({
          event,
          workspacePath: workspace,
        }).catch((err) => {
          console.error('[NightShift] Autonomous investigation failed:', err);
        });

        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'investigating',
          eventId: event.id,
          source: event.source,
          repository: event.repository,
          branch: event.branch,
        }));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err?.message || 'Invalid webhook payload' }));
      }
    });
    return;
  }

  if ((url.pathname === '/api/nightshift/investigate' || url.pathname === '/api/gateway/nightshift/investigate') && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body || '{}');
        if (!parsed.errorLog || typeof parsed.errorLog !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing errorLog string' }));
          return;
        }

        const workspace = parsed.workspacePath || process.cwd();
        const report = await nightShiftRunner.runInvestigation({
          event: {
            id: `api-${Date.now()}`,
            source: parsed.source || 'manual',
            repository: parsed.repository || path.basename(workspace),
            branch: parsed.branch || 'main',
            commitSha: 'HEAD',
            errorLog: parsed.errorLog,
            receivedAt: new Date().toISOString(),
          },
          workspacePath: workspace,
          testCommand: parsed.testCommand,
          testArgs: parsed.testArgs,
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(report));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err?.message || 'Investigation failed' }));
      }
    });
    return;
  }

  // --- SECURE HARNESS API GATEWAY ---
  if (url.pathname.startsWith('/api/gateway/')) {
    const clientIp = req.socket.remoteAddress || 'unknown-client';
    const authHeader = req.headers.authorization;
    const bearerKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const apiKey = (req.headers['x-lyra-api-key'] as string) || bearerKey;

    // 1. Rate Limiting Check
    const rate = harnessGateway.checkRateLimit(clientIp);
    res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
    if (!rate.allowed) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(Math.ceil(rate.resetMs / 1000)) });
      res.end(JSON.stringify({ error: 'Rate limit exceeded. Too many requests to Harness Gateway.' }));
      return;
    }

    // 2. Public Gateway Auth Endpoints
    if (url.pathname === '/api/gateway/auth/login' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const { email, password, token } = JSON.parse(body || '{}');
          const credential = password || token;
          const authResult = await harnessGateway.authenticateUserAsync(
            email || 'developer@lyra.local',
            credential || '',
            getBetterAuthRuntime()
          );
          if (!authResult.success) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: authResult.error }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(authResult));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'Invalid auth payload' }));
        }
      });
      return;
    }

    if (url.pathname === '/api/gateway/auth/verify' && req.method === 'GET') {
      const verifyResult = harnessGateway.verifyToken(apiKey);
      if (!verifyResult.valid) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ authenticated: false, error: 'Invalid or expired token' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ authenticated: true, user: verifyResult.user }));
      return;
    }

    // 3. Timing-safe Auth Check OR Better Auth Session Cookie Check for protected endpoints
    if (!harnessGateway.verifyAuth(apiKey) && !(await isAuthorized(req))) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized. Valid Lyra Gateway API key or Better Auth session required.' }));
      return;
    }

    // 3. Dispatch Task
    if (url.pathname === '/api/gateway/dispatch' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          if (!payload.objective || !payload.workspacePath) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing objective or workspacePath' }));
            return;
          }
          const result = await harnessGateway.dispatchTask(payload);
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'Dispatch failed' }));
        }
      });
      return;
    }

    // 4. Run Status
    const statusMatch = url.pathname.match(/^\/api\/gateway\/runs\/([^/]+)\/status$/);
    if (statusMatch && req.method === 'GET') {
      const runId = statusMatch[1]!;
      const sessionId = (url.searchParams.get('sessionId')) || '';
      const run = store.getRun(sessionId, runId);
      if (!run) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Run not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ runId: run.id, stage: run.stage || run.state, state: run.state, tasks: run.tasks, checks: run.checks }));
      return;
    }

    // 4b. Run Cancel
    const cancelMatch = url.pathname.match(/^\/api\/gateway\/runs\/([^/]+)\/cancel$/);
    if (cancelMatch && req.method === 'POST') {
      const runId = cancelMatch[1]!;
      const result = harnessGateway.cancelRun(runId);
      res.writeHead(result.success ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // 5. Pending Context/Permission Requests
    const pendingMatch = url.pathname.match(/^\/api\/gateway\/runs\/([^/]+)\/pending$/);
    if (pendingMatch && req.method === 'GET') {
      const runId = pendingMatch[1]!;
      const pending = harnessGateway.getPendingRequests(runId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(pending));
      return;
    }

    // 6. Provide File Context
    const contextMatch = url.pathname.match(/^\/api\/gateway\/runs\/([^/]+)\/context$/);
    if (contextMatch && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const { requestId, content } = JSON.parse(body || '{}');
          const success = harnessGateway.provideFileContext(requestId, content);
          res.writeHead(success ? 200 : 404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success, requestId }));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // 7. Respond to Permission
    const permMatch = url.pathname.match(/^\/api\/gateway\/runs\/([^/]+)\/permission$/);
    if (permMatch && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const { requestId, approved, reason } = JSON.parse(body || '{}');
          const success = harnessGateway.respondPermission(requestId, Boolean(approved), reason);
          res.writeHead(success ? 200 : 404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success, requestId, approved }));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // 8. Create GitHub Pull Request
    const prMatch = url.pathname.match(/^\/api\/gateway\/runs\/([^/]+)\/pr$/);
    if (prMatch && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const { repoOwner, repoName, branchName, baseBranch, title, body: prBody, githubToken } = JSON.parse(body || '{}');
          const pr = await harnessGateway.createGitHubPullRequest({
            repoOwner,
            repoName,
            branchName,
            baseBranch,
            title,
            body: prBody,
            githubToken,
          });
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(pr));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // 9. Real-time Events (SSE)
    const eventsMatch = url.pathname.match(/^\/api\/gateway\/runs\/([^/]+)\/events$/);
    if (eventsMatch && req.method === 'GET') {
      const runId = eventsMatch[1]!;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(`data: ${JSON.stringify({ type: 'connected', runId })}\n\n`);

      const unsubscribe = harnessGateway.subscribeRunEvents(runId, (event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      });

      req.on('close', () => {
        unsubscribe();
      });
      return;
    }

    // 10. Run Checkpoint
    const checkpointMatch = url.pathname.match(/^\/api\/gateway\/runs\/([^/]+)\/checkpoint$/);
    if (checkpointMatch && req.method === 'GET') {
      const runId = checkpointMatch[1]!;
      const match = harnessGateway.findRun(runId);
      if (!match) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Run ${runId} not found` }));
        return;
      }
      const checkpoint = store.getLatestRunCheckpoint(match.session.id, runId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ runId, checkpoint }));
      return;
    }

    // 11. Run Resume
    const resumeMatch = url.pathname.match(/^\/api\/gateway\/runs\/([^/]+)\/resume$/);
    if (resumeMatch && req.method === 'POST') {
      const runId = resumeMatch[1]!;
      const match = harnessGateway.findRun(runId);
      if (!match) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Run ${runId} not found` }));
        return;
      }
      try {
        const resumedRun = await teamCoordinator.resumeInterruptedRun(match.session.id, runId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'resumed', runId, state: resumedRun.state, stage: resumedRun.stage }));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // 12. Cross-Harness Handoff Brief
    if (url.pathname === '/api/gateway/handoff' && req.method === 'GET') {
      const workspacePath = url.searchParams.get('workspacePath') || undefined;
      const runId = url.searchParams.get('runId') || undefined;
      const handoff = harnessGateway.getHandoffBrief({ workspacePath, runId });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(handoff));
      return;
    }

    // 13. AHP Protocol: List sessions
    if ((url.pathname === '/api/gateway/ahp/sessions' || url.pathname === '/api/ahp/sessions') && req.method === 'GET') {
      const sessions = ahpServer.listSessions();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessions }));
      return;
    }

    // 16b. AHP Protocol: Create new session
    if ((url.pathname === '/api/gateway/ahp/sessions' || url.pathname === '/api/ahp/sessions') && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const session = ahpServer.createSession(parsed);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(session));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // 17. AHP Protocol: Get session transcript & context brief
    const ahpSessionMatch = url.pathname.match(/^\/api\/(?:gateway\/)?ahp\/sessions\/([^/]+)$/);
    if (ahpSessionMatch && req.method === 'GET') {
      const sessId = ahpSessionMatch[1]!;
      const data = ahpServer.getSession(sessId);
      if (!data) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `AHP Session ${sessId} not found` }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
      return;
    }

    // 18. AHP Protocol: JSON-RPC 2.0 endpoint
    if ((url.pathname === '/api/gateway/ahp/rpc' || url.pathname === '/api/ahp/rpc') && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const result = ahpServer.handleRpc(parsed);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
        }
      });
      return;
    }

    // 19. AHP Protocol v1.3: 3-Lane Adaptive Streaming Chat (Instant Ask, Fast Patch, Full Swarm)
    if ((url.pathname === '/api/gateway/ahp/chat' || url.pathname === '/api/ahp/chat') && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        let parsed: any = {};
        try {
          parsed = JSON.parse(body || '{}');
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
          return;
        }

        if (!parsed.prompt || typeof parsed.prompt !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing prompt string' }));
          return;
        }

        const wantsStream =
          parsed.stream !== false &&
          (parsed.stream === true || String(req.headers.accept || '').includes('text/event-stream'));

        if (wantsStream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
          });

          const sendSse = (event: string, data: unknown) => {
            if (!res.writableEnded) {
              res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
            }
          };

          try {
            const finalResult = await ahpServer.executeChatTurn(parsed, {
              onTriage: (triage, route) => sendSse('triage', { triage, route }),
              onStatus: (status) => sendSse('status', { status }),
              onChunk: (chunk) => sendSse('chunk', { chunk }),
            });
            sendSse('done', finalResult);
          } catch (err: any) {
            sendSse('error', { error: err?.message || 'Execution failed' });
          } finally {
            if (!res.writableEnded) res.end();
          }
          return;
        }

        try {
          const result = await ahpServer.executeChatTurn(parsed);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err?.message || 'Execution failed' }));
        }
      });
      return;
    }

    // 20. AHP Protocol v1.3: 1-Click Escalate Turn to Full Cloud Swarm
    if ((url.pathname === '/api/gateway/ahp/escalate' || url.pathname === '/api/ahp/escalate') && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          if (!parsed.sessionId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing sessionId' }));
            return;
          }
          const result = await ahpServer.escalateToSwarm(parsed);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err?.message || 'Escalation failed' }));
        }
      });
      return;
    }

    // 21. CloudWatch EMF + Pareto Routing + SQS Queue Health Telemetry Snapshot
    if (url.pathname === '/api/gateway/telemetry' && req.method === 'GET') {
      const queue = await sqsTaskQueue.getQueueHealth();
      const telemetry = cloudWatchTelemetry.getSnapshot();
      const sessions = ahpServer.listSessions();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          telemetry,
          queue,
          sessions: sessions.slice(0, 20),
          hermesMemory: modelCouncil.listMemoryEntries(undefined, 15),
          infrastructure: {
            hosted: process.env.LYRA_HOSTED === 'true',
            region: process.env.AWS_REGION || 'us-east-2',
            authStore: process.env.LYRA_DATABASE_HOST ? 'aws-rds-postgres' : 'local-sqlite',
            fargateConfigured: ecsNativeDispatcher.isConfigured(),
            sqsMode: queue.mode,
            emfNamespace: telemetry.namespace,
          },
        })
      );
      return;
    }

    // 22. Cross-Device Sequence-Delta Cloud Session Sync (for DeepSeek Harness `dsh`, VS Code, CLI)
    if (url.pathname === '/api/gateway/sessions/sync' && req.method === 'GET') {
      const sessionId = url.searchParams.get('sessionId') || undefined;
      const sinceSeq = Number(url.searchParams.get('sinceSeq') || 0);
      const workspacePath = url.searchParams.get('workspacePath') || undefined;
      const delta = ahpServer.syncSessionDelta({ sessionId, sinceSeq, workspacePath });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(delta));
      return;
    }

    if (url.pathname === '/api/gateway/sessions/sync' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const sessionId = parsed.sessionId || 'session-main';
          if (!ahpServer.getSession(sessionId)) {
            ahpServer.createSession({
              sessionId,
              title: parsed.title || 'Cloud Synced Session',
              workspacePath: parsed.workspacePath || process.cwd(),
            });
          }
          if (Array.isArray(parsed.appendMessages)) {
            for (const m of parsed.appendMessages) {
              if (m?.content && (m.role === 'user' || m.role === 'assistant')) {
                ahpServer.appendMessage(sessionId, {
                  role: m.role,
                  content: String(m.content),
                  harness: parsed.harness || 'dsh-sync',
                  deviceId: parsed.deviceId,
                });
              }
            }
          }
          const delta = ahpServer.syncSessionDelta({
            sessionId,
            sinceSeq: Number(parsed.sinceSeq || 0),
            workspacePath: parsed.workspacePath,
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(delta));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err?.message || 'Invalid sync payload' }));
        }
      });
      return;
    }

    // 23. Multi-Model Council & Cross-Document RAG Analyzer
    if (url.pathname === '/api/gateway/council' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          if (!parsed.question || typeof parsed.question !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing question string' }));
            return;
          }
          const sessionId = parsed.sessionId || 'session-main';
          if (!ahpServer.getSession(sessionId)) {
            ahpServer.createSession({
              sessionId,
              title: `[Council] ${parsed.question.slice(0, 40)}`,
              workspacePath: parsed.workspacePath || process.cwd(),
            });
          }
          ahpServer.appendMessage(sessionId, {
            role: 'user',
            content: parsed.question,
            harness: parsed.harness || 'council-client',
            deviceId: parsed.deviceId,
          });
          const result = await modelCouncil.analyze({
            question: parsed.question,
            workspacePath: parsed.workspacePath,
            sessionId,
            mode: parsed.mode,
            policyProfile: parsed.policyProfile,
            seatModels: parsed.seatModels,
            chairModelId: parsed.chairModelId,
            documentPaths: parsed.documentPaths,
          });
          ahpServer.appendMessage(sessionId, {
            role: 'assistant',
            content: result.formattedMarkdown,
            thinking: `Council (${result.mode}) across ${result.seats.length} Bedrock models.`,
            lane: 'ask',
            harness: parsed.harness || 'council-client',
            deviceId: parsed.deviceId,
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err?.message || 'Council analysis failed' }));
        }
      });
      return;
    }

    // 24. Gateway-scoped OpenAI-compatible endpoints
    if (url.pathname === '/api/gateway/v1/models' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(openAiBridge.listModels()));
      return;
    }

    if (url.pathname === '/api/gateway/v1/chat/completions' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          await openAiBridge.handleChatCompletions(req, res, parsed);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Invalid JSON body' } }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Gateway route not found' }));
    return;
  }

  // --- OPENAI-COMPATIBLE HARNESS PROVIDER (`/v1/models` & `/v1/chat/completions`) ---
  // Used by VS Code GitHub Copilot Chat (`chatLanguageModels.json`), DeepSeek Harness (`dsh`), OpenCode, etc.
  if (url.pathname === '/v1/models' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(openAiBridge.listModels()));
    return;
  }

  if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body || '{}');
        await openAiBridge.handleChatCompletions(req, res, parsed);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid JSON body' } }));
      }
    });
    return;
  }

  // Public Canonical Bedrock Model Catalog & Pareto Profiles (used by Landing Page & VS Code Extension)
  if (url.pathname === '/api/models/catalog' && req.method === 'GET') {
    const bedrockCatalog = new BedrockModelCatalog();
    const active = await bedrockCatalog.getActiveModels();
    const profiles = await bedrockCatalog.getCrossRegionInferenceProfiles();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        source: active.source,
        syncedAt: active.syncedAt,
        paretoCatalog: BEDROCK_CATALOG,
        activeModels: active.models,
        crossRegionProfiles: profiles.profiles,
        policyProfiles: [
          { id: 'frugal', label: 'Frugal', description: 'Minimizes token spend ($0.06-$0.80/M) while meeting capability threshold.' },
          { id: 'balanced', label: 'Balanced (Pareto)', description: 'Default multi-objective Pareto optimum across capability, TTFT, and cost.' },
          { id: 'frontier', label: 'Frontier', description: 'Prioritizes maximum reasoning & coding depth (Sonnet 5, DeepSeek-R1, Opus 5.5).' },
        ],
      })
    );
    return;
  }

  if (url.pathname.startsWith('/api/') && url.pathname !== '/api/health' && url.pathname !== '/api/auth/status' && !await isAuthorized(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Authentication required' }));
    return;
  }

  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'Lyra Hub' }));
    return;
  }

  // Active Bedrock Foundation Models (strictly non-legacy)
  if (url.pathname === '/api/models/active' && req.method === 'GET') {
    const catalog = new BedrockModelCatalog();
    const result = await catalog.getActiveModels();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // GitHub Bi-Directional Webhooks (/lyra bot)
  if (url.pathname === '/api/webhooks/github' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      const signature = req.headers['x-hub-signature-256'] as string | undefined;
      const webhookHandler = new GitHubWebhookHandler(harnessGateway);
      if (!webhookHandler.verifySignature(body, signature)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid webhook signature' }));
        return;
      }
      try {
        const payload = JSON.parse(body);
        const result = await webhookHandler.handleWebhook(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  const previewStartMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/preview\/start$/);
  if (previewStartMatch && req.method === 'POST') {
    const runId = previewStartMatch[1]!;
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const sessionId = payload.sessionId;
        const run = sessionId ? store.getRun(sessionId, runId) : undefined;
        const worktreePath = payload.worktreePath || run?.integrationWorktreePath || run?.worktreePath || process.cwd();
        const preview = await previewManager.startPreview(runId, worktreePath);
        if (sessionId && run) {
          store.updateRun(sessionId, runId, { previewUrl: preview.url });
          broadcast({ type: 'run_updated', sessionId, runId, payload: { ...run, previewUrl: preview.url } });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(preview));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
    });
    return;
  }

  const previewStopMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/preview\/stop$/);
  if (previewStopMatch && req.method === 'POST') {
    const runId = previewStopMatch[1]!;
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const sessionId = payload.sessionId;
        previewManager.stopPreview(runId);
        if (sessionId) {
          const run = store.getRun(sessionId, runId);
          if (run) {
            store.updateRun(sessionId, runId, { previewUrl: undefined });
            broadcast({ type: 'run_updated', sessionId, runId, payload: { ...run, previewUrl: undefined } });
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ stopped: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
    });
    return;
  }

  const mergeMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/merge$/);
  if (mergeMatch && req.method === 'POST') {
    const runId = mergeMatch[1]!;
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const sessionId = payload.sessionId;
        const repoPath = payload.workspacePath || process.cwd();
        const result = await teamCoordinator.mergeRunToMain(sessionId, runId, repoPath);
        if (result.success) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: result.error }));
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
    });
    return;
  }

  // Worktrees REST Endpoints
  if (url.pathname === '/api/worktrees' && req.method === 'GET') {
    try {
      const workspacePath = url.searchParams.get('workspacePath') || process.cwd();
      const rawWorktrees = await worktreeManager.listWorktrees(workspacePath);
      const activePreviews = previewManager.getActivePreviews();

      const worktrees = rawWorktrees.map((wt) => {
        const preview = activePreviews.find((p) => p.worktreePath === wt.path || p.runId === wt.branch);
        return {
          ...wt,
          preview: preview ? { url: preview.url, port: preview.port, startedAt: preview.startedAt, runId: preview.runId } : undefined,
        };
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ worktrees, previews: activePreviews }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  if (url.pathname === '/api/worktrees' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const workspacePath = payload.workspacePath || process.cwd();
        const branchName = payload.branchName;
        if (!branchName) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'branchName is required' }));
          return;
        }
        const result = await worktreeManager.createCustomWorktree(workspacePath, branchName);
        if (result.success) {
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: result.error }));
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
    });
    return;
  }

  if (url.pathname === '/api/worktrees' && req.method === 'DELETE') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const workspacePath = payload.workspacePath || process.cwd();
        const targetPath = payload.worktreePath;
        if (!targetPath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'worktreePath is required' }));
          return;
        }
        // If preview is running on this worktree, stop it
        const activePreviews = previewManager.getActivePreviews();
        const matchingPreview = activePreviews.find((p) => p.worktreePath === targetPath);
        if (matchingPreview) {
          previewManager.stopPreview(matchingPreview.runId);
        }

        const result = await worktreeManager.removeCustomWorktree(workspacePath, targetPath, payload.force ?? true);
        if (result.success) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: result.error }));
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
    });
    return;
  }

  if (url.pathname === '/api/worktrees/diff' && req.method === 'GET') {
    try {
      const targetPath = url.searchParams.get('path');
      const baseCommit = url.searchParams.get('baseCommit') || undefined;
      const workspacePath = url.searchParams.get('workspacePath') || process.cwd();
      if (!targetPath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'path is required' }));
        return;
      }
      const diffData = await worktreeManager.getWorktreeDiff(workspacePath, targetPath, baseCommit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(diffData));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  if (url.pathname === '/api/previews' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ previews: previewManager.getActivePreviews() }));
    return;
  }

  if (url.pathname === '/api/previews/start' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const worktreePath = payload.worktreePath || process.cwd();
        const previewId = payload.previewId || path.basename(worktreePath) || `preview-${Date.now()}`;
        const preview = await previewManager.startPreview(previewId, worktreePath);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ previewId, ...preview }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
    });
    return;
  }

  if (url.pathname === '/api/previews/stop' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const previewId = payload.previewId;
        if (!previewId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'previewId is required' }));
          return;
        }
        previewManager.stopPreview(previewId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ stopped: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
    });
    return;
  }

  if (url.pathname === '/api/nodes' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ nodes: Array.from(registeredNodes.values()), activeNodeId, isHibernated: idleManager.isHibernated() }));
    return;
  }

  if (url.pathname === '/api/nodes/select' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const { nodeId } = JSON.parse(body || '{}');
        if (nodeId && registeredNodes.has(nodeId)) {
          activeNodeId = nodeId;
          broadcast({ type: 'node_selected', payload: { activeNodeId } });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ activeNodeId }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unknown node ID' }));
        }
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid payload' }));
      }
    });
    return;
  }

  if (url.pathname === '/api/agents/capabilities' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(processManager.getCapabilities()));
    return;
  }

  if (url.pathname === '/api/agents/readiness' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(processManager.getReadiness()));
    return;
  }

  if (url.pathname === '/api/monitor/telemetry' && req.method === 'GET') {
    const monitor = CloudMonitor.getInstance(store);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(monitor.captureSnapshot()));
    return;
  }

  if (url.pathname === '/api/harness-profiles' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(store.listHarnessProfiles()));
    return;
  }

  if (url.pathname === '/api/harness-profiles' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const profile = store.saveHarnessProfile(JSON.parse(body || '{}'));
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(profile));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Invalid harness profile.' }));
      }
    });
    return;
  }

  if (url.pathname.startsWith('/api/harness-profiles/') && req.method === 'DELETE') {
    const profileId = assertSafeId(decodeURIComponent(url.pathname.split('/').pop() || ''), 'profile ID');
    const deleted = store.deleteHarnessProfile(profileId);
    res.writeHead(deleted ? 204 : 404);
    res.end();
    return;
  }

  const DEFAULT_BEDROCK_MODELS = [
    { id: 'us.amazon.nova-micro-v1:0', name: 'Nova Micro', provider: 'Amazon', category: 'Fast & Low Cost' },
    { id: 'us.amazon.nova-lite-v1:0', name: 'Nova Lite', provider: 'Amazon', category: 'Balanced Multimodal' },
    { id: 'us.amazon.nova-pro-v1:0', name: 'Nova Pro', provider: 'Amazon', category: 'High Capability' },
    { id: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0', name: 'Claude 3.7 Sonnet', provider: 'Anthropic', category: 'Flagship Reasoning' },
    { id: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0', name: 'Claude 3.5 Sonnet v2', provider: 'Anthropic', category: 'Coding & Architecture' },
    { id: 'us.anthropic.claude-3-5-haiku-20241022-v1:0', name: 'Claude 3.5 Haiku', provider: 'Anthropic', category: 'Fast & Lightweight' },
    { id: 'meta.llama3-3-70b-instruct-v1:0', name: 'Llama 3.3 70B', provider: 'Meta', category: 'Open Weights' },
    { id: 'mistral.mistral-large-2407-v1:0', name: 'Mistral Large 2', provider: 'Mistral AI', category: 'Reasoning & Coding' },
  ];

  if (url.pathname === '/api/models/bedrock' && req.method === 'GET') {
    const region = url.searchParams.get('region') || 'us-east-1';
    try {
      const child = spawn('aws', ['bedrock', 'list-foundation-models', '--region', region, '--output', 'json'], {
        env: process.env,
      });
      let out = '';
      child.stdout?.on('data', (d) => (out += d.toString()));
      child.on('close', (code) => {
        if (code === 0 && out.trim()) {
          try {
            const data = JSON.parse(out);
            const liveModels = (data.modelSummaries || [])
              .filter((m: any) => m.outputModalities?.includes('TEXT'))
              .map((m: any) => ({
                id: m.modelId,
                name: m.modelName,
                provider: m.providerName,
                category: m.providerName,
              }));
            if (liveModels.length > 0) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ models: liveModels, source: 'live' }));
              return;
            }
          } catch {}
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: DEFAULT_BEDROCK_MODELS, source: 'preset' }));
      });
      child.on('error', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: DEFAULT_BEDROCK_MODELS, source: 'preset' }));
      });
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: DEFAULT_BEDROCK_MODELS, source: 'preset' }));
    }
    return;
  }

  // AWS Account Status Check
  if (url.pathname === '/api/aws/status' && req.method === 'GET') {
    try {
      const child = spawn('aws', ['sts', 'get-caller-identity', '--output', 'json'], { env: process.env });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (d) => (stdout += d.toString()));
      child.stderr?.on('data', (d) => (stderr += d.toString()));
      child.on('close', (code) => {
        if (code === 0 && stdout.trim()) {
          try {
            const data = JSON.parse(stdout);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              connected: true,
              accountId: data.Account,
              arn: data.Arn,
              userId: data.UserId,
            }));
            return;
          } catch {}
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ connected: false, error: stderr || 'No active AWS credentials located' }));
      });
      child.on('error', (err) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ connected: false, error: err.message }));
      });
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ connected: false, error: String(err) }));
    }
    return;
  }

  // Automated IAM Role Provisioner
  if (url.pathname === '/api/aws/provision-iam' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const region = payload.region || 'us-east-1';
        const roleName = payload.roleName || 'LyraAgentRunnerRole';

        // 1. Check STS caller identity
        const stsRes = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
          const child = spawn('aws', ['sts', 'get-caller-identity', '--output', 'json'], { env: process.env });
          let stdout = '';
          let stderr = '';
          child.stdout?.on('data', (d) => (stdout += d.toString()));
          child.stderr?.on('data', (d) => (stderr += d.toString()));
          child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
          child.on('error', (err) => resolve({ code: 1, stdout: '', stderr: err.message }));
        });

        if (stsRes.code !== 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Not signed into AWS. Please run `aws sso login` or configure credentials in your terminal or browser first.',
          }));
          return;
        }

        const callerData = JSON.parse(stsRes.stdout);
        const accountId = callerData.Account;
        const roleArn = `arn:aws:iam::${accountId}:role/${roleName}`;

        const trustPolicy = JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { AWS: `arn:aws:iam::${accountId}:root` },
              Action: 'sts:AssumeRole',
            },
          ],
        });

        // 2. Create IAM Role (or ignore if already exists)
        await new Promise<void>((resolve) => {
          const child = spawn('aws', ['iam', 'create-role', '--role-name', roleName, '--assume-role-policy-document', trustPolicy], { env: process.env });
          child.on('close', () => resolve());
          child.on('error', () => resolve());
        });

        // 3. Attach AmazonBedrockFullAccess policy
        await new Promise<void>((resolve) => {
          const child = spawn('aws', ['iam', 'attach-role-policy', '--role-name', roleName, '--policy-arn', 'arn:aws:iam::aws:policy/AmazonBedrockFullAccess'], { env: process.env });
          child.on('close', () => resolve());
          child.on('error', () => resolve());
        });

        // 4. Save Bedrock provider profile in store
        const profileId = `provider-bedrock-${Date.now()}`;
        const newProfile = store.saveModelProviderProfile({
          id: profileId,
          name: 'Amazon Bedrock (Auto-Provisioned)',
          provider: 'bedrock',
          credentialMode: 'byo',
          model: payload.model || 'us.amazon.nova-micro-v1:0',
          region,
          roleArn,
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          accountId,
          roleArn,
          profile: publicProviderProfile(newProfile),
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
    });
    return;
  }

  // CloudFormation Template & Direct Launch
  if (url.pathname === '/api/aws/download-template' && req.method === 'GET') {
    const filePath = path.join(process.cwd(), 'infra', 'aws', 'lyra-bedrock-iam.yaml');
    if (fs.existsSync(filePath)) {
      res.writeHead(200, {
        'Content-Type': 'text/yaml',
        'Content-Disposition': 'attachment; filename="lyra-bedrock-iam.yaml"',
      });
      res.end(fs.readFileSync(filePath));
      return;
    }
  }

  if (url.pathname === '/api/aws/cloudformation' && req.method === 'GET') {
    const region = url.searchParams.get('region') || 'us-east-1';
    const cfTemplate = `AWSTemplateFormatVersion: '2010-09-09'
Description: 'Lyra Multi-Agent Bedrock Execution Role'
Resources:
  LyraBedrockRole:
    Type: 'AWS::IAM::Role'
    Properties:
      RoleName: LyraAgentRunnerRole
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              AWS: !Sub 'arn:aws:iam::\${AWS::AccountId}:root'
            Action: 'sts:AssumeRole'
      ManagedPolicyArns:
        - 'arn:aws:iam::aws:policy/AmazonBedrockFullAccess'
Outputs:
  RoleArn:
    Description: 'The ARN of the Lyra Bedrock Role'
    Value: !GetAtt LyraBedrockRole.Arn
`;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      template: cfTemplate,
      consoleUrl: `https://console.aws.amazon.com/cloudformation/home?region=${region}#/stacks/create/template`,
    }));
    return;
  }

  if (url.pathname === '/api/model-provider-profiles' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(store.listModelProviderProfiles().map(publicProviderProfile)));
    return;
  }

  if (url.pathname === '/api/model-provider-profiles' && req.method === 'POST') {
    let body = '';
    let tooLarge = false;
    req.on('data', (chunk) => { if (tooLarge) return; body += chunk; if (body.length > 16 * 1024) { tooLarge = true; body = ''; } });
    req.on('end', async () => {
      try {
        if (tooLarge) { res.writeHead(413, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Provider profile payload exceeds 16 KB.' })); return; }
        const payload = JSON.parse(body || '{}');
        if (payload.apiKey && String(payload.apiKey).length > 4096) throw new Error('OpenRouter API keys must be 4096 characters or fewer.');
        if (payload.externalId && String(payload.externalId).length > 1224) throw new Error('External ID exceeds the supported length.');
        if (payload.apiKey && !String(payload.apiKey).trim()) throw new Error('OpenRouter API key cannot be blank.');
        if (payload.roleArn && (!payload.externalId || !String(payload.externalId).trim())) throw new Error('Bedrock role connections require the role trust External ID.');
        const id = payload.id ? assertSafeId(String(payload.id), 'profile ID') : `provider-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const credential = { ...(payload.apiKey ? { apiKey: String(payload.apiKey).trim() } : {}), ...(payload.externalId ? { externalId: String(payload.externalId).trim() } : {}) };
        if (payload.provider !== 'bedrock' && payload.provider !== 'openrouter') throw new Error('Choose Amazon Bedrock or OpenRouter.');
        const existing = store.listModelProviderProfiles().find((item) => item.id === id);
        const credentialMode = payload.credentialMode === 'managed' ? 'managed' : payload.credentialMode === 'byo' ? 'byo' : existing?.credentialMode || 'byo';
        if (credentialMode === 'managed' && Object.keys(credential).length) throw new Error('Do not send provider credentials when selecting Lyra-managed usage.');
        if (process.env.LYRA_HOSTED === 'true' && Object.keys(credential).length && req.headers['x-forwarded-proto'] !== 'https') throw new Error('Provider credentials can only be saved over HTTPS. Configure an HTTPS ALB certificate before entering BYO secrets.');
        const provider = payload.provider as 'bedrock' | 'openrouter';
        const secretRef = Object.keys(credential).length ? await saveProviderCredential(id, credential) : (existing?.provider === provider && credentialMode === 'byo' ? existing.secretRef : undefined);
        const profile = store.saveModelProviderProfile({ ...payload, id, provider, credentialMode, secretRef });
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(publicProviderProfile(profile)));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Invalid provider profile.' }));
      }
    });
    return;
  }

  if (url.pathname.startsWith('/api/model-provider-profiles/') && req.method === 'DELETE') {
    const profileId = assertSafeId(decodeURIComponent(url.pathname.split('/').pop() || ''), 'profile ID');
    const deleted = store.deleteModelProviderProfile(profileId);
    res.writeHead(deleted ? 204 : 404);
    res.end();
    return;
  }

  const compatibilityMatch = url.pathname.match(/^\/api\/model-provider-profiles\/([^/]+)\/compatibility$/);
  if (compatibilityMatch && req.method === 'GET') {
    const profileId = assertSafeId(decodeURIComponent(compatibilityMatch[1] || ''), 'profile ID');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(store.getModelCompatibility(profileId)));
    return;
  }

  const compatibilityCheckMatch = url.pathname.match(/^\/api\/model-provider-profiles\/([^/]+)\/compatibility-check$/);
  if (compatibilityCheckMatch && req.method === 'POST') {
    const profileId = assertSafeId(decodeURIComponent(compatibilityCheckMatch[1] || ''), 'profile ID');
    modelCompatibility.check(profileId).then((result) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }).catch((error) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Model compatibility check failed.' }));
    });
    return;
  }

  if (url.pathname === '/api/agents/models' && req.method === 'GET') {
    Promise.all(['antigravity', 'claude_code', 'codex'].map(async (agentType) => [agentType, await processManager.getModels(agentType as 'antigravity' | 'claude_code' | 'codex')] as const))
      .then((entries) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(Object.fromEntries(entries)));
      })
      .catch(() => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unable to load agent models' }));
      });
    return;
  }

  // Get storage config
  if (url.pathname === '/api/storage/config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ storagePath: store.getStoragePath() }));
    return;
  }

  if (url.pathname === '/api/workspaces/import' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > 32 * 1024) req.destroy(); });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const repoUrl = new URL(String(payload.repoUrl || ''));
        const parts = repoUrl.pathname.replace(/\.git$/, '').split('/').filter(Boolean);
        if (repoUrl.protocol !== 'https:' || repoUrl.hostname !== 'github.com' || repoUrl.username || repoUrl.password || repoUrl.search || repoUrl.hash || parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_.-]{1,100}$/.test(part))) {
          throw new Error('Enter a public GitHub repository URL such as https://github.com/owner/repo.');
        }
        const [owner, repository] = parts;
        const canonical = `https://github.com/${owner}/${repository}.git`;
        const root = process.env.LYRA_HOSTED === 'true' ? '/workspace' : path.join(store.getStoragePath(), 'workspaces');
        fs.mkdirSync(root, { recursive: true });
        const name = `${owner}-${repository}`.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 180);
        const workspacePath = path.join(root, name);
        if (!workspacePath.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('Repository path is invalid.');
        if (!fs.existsSync(workspacePath)) {
          await new Promise<void>((resolve, reject) => {
            const child = spawn('git', ['clone', '--depth', '1', '--', canonical, workspacePath], { cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG || 'C.UTF-8' }, stdio: ['ignore', 'ignore', 'pipe'] });
            let stderr = '';
            child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000); });
            const timer = setTimeout(() => child.kill('SIGTERM'), 10 * 60 * 1000);
            child.on('error', (error) => { clearTimeout(timer); reject(error); });
            child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(stderr.includes('Authentication failed') || stderr.includes('could not read Username') ? 'This repository requires GitHub authentication. Private repository connections are not available in this beta.' : `GitHub clone failed: ${stderr.trim() || `git exited ${code}`}`)); });
          });
        }
        const existingRemote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: workspacePath, encoding: 'utf8' }).trim().replace(/\.git$/, '');
        if (existingRemote !== canonical.replace(/\.git$/, '')) throw new Error('A different repository already uses this workspace name.');
        const resolved = validateWorkingDirectory(workspacePath, [root]);
        if (payload.sessionId) store.updateSessionMeta(assertSafeId(String(payload.sessionId), 'session ID'), { workspacePath: resolved });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ workspacePath: resolved, repository: `${owner}/${repository}` }));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Unable to import GitHub repository.' }));
      }
    });
    return;
  }

  // Set storage config
  if (url.pathname === '/api/storage/config' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const { storagePath } = JSON.parse(body);
        if (storagePath) {
          store.setStoragePath(storagePath);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, storagePath: store.getStoragePath() }));
          return;
        }
      } catch {}
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid storage path payload' }));
    });
    return;
  }

  // List sessions
  if (url.pathname === '/api/sessions' && req.method === 'GET') {
    const sessions = store.listSessions().filter((session) => !session.archived);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(sessions));
    return;
  }

  if (url.pathname === '/api/sessions' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const title = String(payload.title || 'New Session').trim().slice(0, 120);
        const workspacePath = resolveWorkspacePath(String(payload.workspacePath || process.cwd()));
        const session = store.createSession({ title, workspacePath, activeAgents: payload.activeAgents });
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(session));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Invalid session payload' }));
      }
    });
    return;
  }

  // Get all runs across all sessions
  if (url.pathname === '/api/runs' && req.method === 'GET') {
    const sessions = store.listSessions();
    const allRuns = sessions.flatMap((s) => store.listRuns(s.id));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(allRuns));
    return;
  }

  // Get runs for a session
  if (url.pathname.match(/^\/api\/sessions\/[^/]+\/runs$/) && req.method === 'GET') {
    const parts = url.pathname.split('/');
    const sessionId = assertSafeId(decodeURIComponent(parts[3] || ''), 'session ID');
    const runs = store.listRuns(sessionId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(runs));
    return;
  }

  const checkpointsMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/agent-checkpoints$/);
  if (checkpointsMatch && req.method === 'GET') {
    const sessionId = assertSafeId(decodeURIComponent(checkpointsMatch[1] || ''), 'session ID');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(store.listAgentCheckpoints(sessionId)));
    return;
  }

  const eventsMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/events$/);
  if (eventsMatch && req.method === 'GET') {
    const sessionId = assertSafeId(decodeURIComponent(eventsMatch[1] || ''), 'session ID');
    const cursor = Number(url.searchParams.get('after') || 0);
    if (!Number.isSafeInteger(cursor) || cursor < 0) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid event cursor.' })); return; }
    let all;
    try {
      all = eventJournal
        ? await eventJournal.getSessionEvents(sessionId, cursor, 1000)
        : (store.getSession(sessionId)?.events || []).map((event, index) => ({ ...event, sequence: event.sequence || index + 1 })).filter((event) => (event.sequence || 0) > cursor).slice(0, 1000);
    } catch (error) {
      res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Event history is unavailable.' })); return;
    }
    const nextCursor = all.at(-1)?.sequence || cursor;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ events: all, nextCursor, hasMore: all.length === 1000 }));
    return;
  }

  // Get single run
  if (url.pathname.match(/^\/api\/sessions\/[^/]+\/runs\/[^/]+$/) && req.method === 'GET') {
    const parts = url.pathname.split('/');
    const sessionId = assertSafeId(decodeURIComponent(parts[3] || ''), 'session ID');
    const runId = assertSafeId(decodeURIComponent(parts[5] || ''), 'run ID');
    const run = store.getRun(sessionId, runId);
    if (run) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(run));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Run not found' }));
    }
    return;
  }

  // Get specific session events
  if (url.pathname.startsWith('/api/sessions/') && req.method === 'GET') {
    let sessionId: string;
    try { sessionId = assertSafeId(decodeURIComponent(url.pathname.replace('/api/sessions/', '')), 'session ID'); } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid session ID' })); return;
    }
    const sessionData = store.getSession(sessionId);
    if (sessionData) {
      try {
        const events = eventJournal ? await eventJournal.getSessionEvents(sessionId) : sessionData.events.map((event, index) => ({ ...event, sequence: event.sequence || index + 1 }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...sessionData, events, agentCheckpoints: store.listAgentCheckpoints(sessionId) }));
      } catch (error) {
        res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Event history is unavailable.' }));
      }
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found' }));
    }
    return;
  }

  if (url.pathname.startsWith('/api/sessions/') && (req.method === 'PATCH' || req.method === 'DELETE')) {
    let sessionId: string;
    try { sessionId = assertSafeId(decodeURIComponent(url.pathname.replace('/api/sessions/', '')), 'session ID'); } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid session ID' })); return;
    }
    if (req.method === 'DELETE') {
      const deleted = store.deleteSession(sessionId);
      if (deleted) await eventJournal?.deleteSession(sessionId);
      res.writeHead(deleted ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: deleted }));
      return;
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > 64 * 1024) req.destroy(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const updates: Record<string, unknown> = {};
        if (payload.title !== undefined) updates.title = String(payload.title).trim().slice(0, 120);
        if (payload.archived !== undefined) updates.archived = Boolean(payload.archived);
        if (payload.workspacePath !== undefined) updates.workspacePath = resolveWorkspacePath(String(payload.workspacePath));
        if (payload.agentOptions !== undefined && payload.agentOptions && typeof payload.agentOptions === 'object') updates.agentOptions = payload.agentOptions;
        if (payload.draft !== undefined) updates.draft = String(payload.draft);
        if (payload.mode !== undefined && (payload.mode === 'solo' || payload.mode === 'team')) updates.mode = payload.mode;
        if (payload.teamConfig !== undefined && payload.teamConfig && typeof payload.teamConfig === 'object') updates.teamConfig = payload.teamConfig;
        if (payload.activeAgents !== undefined && Array.isArray(payload.activeAgents)) updates.activeAgents = payload.activeAgents;
        const updated = store.updateSessionMeta(sessionId, updates);
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(updated));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Invalid session update' }));
      }
    });
    return;
  }

  if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
    const distRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
    const requested = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
    const candidate = path.resolve(distRoot, requested);
    const filePath = candidate.startsWith(`${distRoot}${path.sep}`) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()
      ? candidate
      : path.join(distRoot, 'index.html');
    if (fs.existsSync(filePath)) {
      const contentTypes: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
      res.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream' });
      res.end(fs.readFileSync(filePath));
      return;
    }
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

const broadcast = (msg: WSMessage) => {
  const payloadStr = JSON.stringify(msg);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payloadStr);
    }
  });
};

idleManager = new IdleManager({
  idleTimeoutMs: process.env.LYRA_IDLE_TIMEOUT_MS ? Number(process.env.LYRA_IDLE_TIMEOUT_MS) : 5 * 60 * 1000,
  onHibernate: async (idleDurationMs) => {
    console.log(`[Lyra Hub] System entered smart idle hibernate after ${Math.round(idleDurationMs / 1000)}s of inactivity.`);
    previewManager.stopAll();
    await ecsNativeDispatcher.stopAll('Scale-to-zero hibernate due to inactivity');
    broadcast({
      type: 'node_hibernated',
      payload: {
        idleMinutes: Math.round(idleDurationMs / 60000),
      },
    });
  },
  onWake: async (sleptDurationMs) => {
    console.log(`[Lyra Hub] System awakened from smart idle hibernate (slept ${Math.round(sleptDurationMs / 1000)}s).`);
    broadcast({
      type: 'node_resumed',
      payload: {
        sleptMinutes: Math.round(sleptDurationMs / 60000),
      },
    });
  },
});
idleManager.startMonitoring();

// Broadcast unified events when created by adapters or processes
store.on('event_appended', (event) => {
  idleManager.recordActivity();
  const publish = () => broadcast({
    type: 'unified_event',
    sessionId: event.sessionId,
    agentType: event.agent === 'user' ? undefined : event.agent,
    payload: event,
  });
  if (eventJournal) void eventJournal.append(event).then((sequence) => broadcast({
    type: 'unified_event',
    sessionId: event.sessionId,
    agentType: event.agent === 'user' ? undefined : event.agent,
    payload: { ...event, sequence },
  })).catch((error) => console.error('[Lyra Hub] Failed to persist event in PostgreSQL:', error instanceof Error ? error.message : String(error)));
  else publish();
});

store.on('session_updated', (meta) => {
  broadcast({
    type: 'session_updated',
    sessionId: meta.id,
    payload: meta,
  });
});

store.on('storage_path_changed', (newPath) => {
  broadcast({
    type: 'storage_path_updated',
    payload: { storagePath: newPath },
  });
});

processManager.on('session_binding', (binding) => {
  store.upsertAgentBinding({ ...binding, lastUsedAt: new Date().toISOString() });
});

// Process manager events
processManager.on('run_started', (data) => {
  store.appendEvent(data.sessionId, { agent: data.agentType, type: 'run_started', runId: data.runId, payload: data });
  broadcast({ type: 'run_started', sessionId: data.sessionId, agentType: data.agentType, runId: data.runId, payload: data } as WSMessage);
});

processManager.on('run_cancelled', (data) => {
  if (data.sessionId) {
    store.appendEvent(data.sessionId, { agent: data.agentType, type: 'run_cancelled', runId: data.runId, payload: data });
  }
  broadcast({ type: 'run_cancelled', sessionId: data.sessionId, agentType: data.agentType, runId: data.runId, payload: data } as WSMessage);
});

processManager.on('error', (data) => {
  if (data.sessionId) {
    store.appendEvent(data.sessionId, { agent: data.agentType, type: 'error', runId: data.runId, payload: { message: data.message } });
  }
  broadcast({ type: 'error', sessionId: data.sessionId, agentType: data.agentType, runId: data.runId, payload: { message: data.message } });
});

processManager.on('tool_call', (data) => {
  store.appendEvent(data.sessionId, {
    agent: data.agentType,
    type: 'tool_call',
    payload: data.toolCall,
    runId: data.runId,
  });

  broadcast({
    type: 'tool_call',
    sessionId: data.sessionId,
    agentType: data.agentType,
    runId: data.runId,
    payload: { ...data.toolCall, runId: data.runId },
  });
});

processManager.on('diff', (data) => {
  store.appendEvent(data.sessionId, {
    agent: data.agentType,
    type: 'diff',
    payload: data.diff,
    runId: data.runId,
  });

  broadcast({
    type: 'diff',
    sessionId: data.sessionId,
    agentType: data.agentType,
    runId: data.runId,
    payload: { ...data.diff, runId: data.runId },
  });
});

processManager.on('content_chunk', (data) => {
  broadcast({
    type: 'content_chunk',
    sessionId: data.sessionId,
    agentType: data.agentType,
    runId: data.runId,
    payload: data,
  });
});

processManager.on('done', (data) => {
  if (data.fullContent) {
    store.appendEvent(data.sessionId, {
      agent: data.agentType,
      type: 'message',
      payload: { text: data.fullContent },
      runId: data.runId,
    });
  }

  broadcast({
    type: 'done',
    sessionId: data.sessionId,
    agentType: data.agentType,
    runId: data.runId,
    payload: { code: data.code },
  });
});

nativeAgentRuntime.on('run_started', (data) => broadcast({ type: 'run_started', sessionId: data.sessionId, agentType: data.agentType, runId: data.runId, payload: data }));
nativeAgentRuntime.on('content_chunk', (data) => broadcast({ type: 'content_chunk', sessionId: data.sessionId, agentType: data.agentType, runId: data.runId, payload: data }));
nativeAgentRuntime.on('tool_call', (data) => broadcast({ type: 'tool_call', sessionId: data.sessionId, agentType: data.agentType, runId: data.runId, payload: { ...data.toolCall, runId: data.runId } }));
nativeAgentRuntime.on('approval_required', (data) => broadcast({ type: 'tool_approval_required', sessionId: data.sessionId, agentType: 'orchestrator', runId: data.runId, payload: data }));
nativeAgentRuntime.on('error', (data) => broadcast({ type: 'error', sessionId: data.sessionId, agentType: 'orchestrator', runId: data.runId, payload: { message: data.message } }));
nativeAgentRuntime.on('done', (data) => {
  if (data.usage) store.appendEvent(data.sessionId, { agent: 'orchestrator', type: 'status', runId: data.runId, payload: { usage: data.usage } });
  broadcast({ type: 'done', sessionId: data.sessionId, agentType: 'orchestrator', runId: data.runId, payload: { code: data.code, usage: data.usage } });
});

messageBus.on('task_created', (task) => {
  broadcast({
    type: 'bridge_dispatch',
    payload: task,
  });
});

store.on('team_run_created', (run) => {
  broadcast({
    type: 'team_run_updated',
    sessionId: run.sessionId,
    payload: run,
    runId: run.id,
  });
});

store.on('team_run_updated', (run) => {
  broadcast({
    type: 'team_run_updated',
    sessionId: run.sessionId,
    payload: run,
    runId: run.id,
  });
});

store.on('task_updated', (data) => {
  broadcast({
    type: 'task_updated',
    sessionId: data.sessionId,
    payload: data.task,
    runId: data.runId,
  });
});

store.on('check_updated', (data) => {
  broadcast({
    type: 'check_updated',
    sessionId: data.sessionId,
    payload: data.check,
    runId: data.runId,
  });
});

store.on('harness_profiles_updated', (profiles) => {
  broadcast({ type: 'harness_profiles_updated', payload: profiles });
});

store.on('model_provider_profiles_updated', (profiles) => {
  broadcast({ type: 'model_provider_profiles_updated', payload: (profiles as import('./types').ModelProviderProfile[]).map(publicProviderProfile) });
});

store.on('swarm_message', (data) => {
  broadcast({ type: 'swarm_message', sessionId: data.sessionId, runId: data.runId, payload: data.message });
});

teamCoordinator.on('diffs_updated', (data) => {
  broadcast({
    type: 'diffs_updated',
    sessionId: data.sessionId,
    payload: data.diffs,
    runId: data.runId,
  });
});

const workerMonitor = setInterval(() => {
  if (process.env.LYRA_HOSTED !== 'true') return;
  void ecsNativeDispatcher.reconcileStoppedTasks().then(async (stopped) => {
    for (const task of stopped) {
      if (!task.sessionId) continue;
      const checkpoint = store.getLatestAgentCheckpoint(task.sessionId, task.runId);
      if (!checkpoint || (checkpoint.state !== 'running' && checkpoint.kind !== 'approval-requested')) continue;
      store.saveAgentCheckpoint({ sessionId: checkpoint.sessionId, runId: checkpoint.runId, checkpointId: `worker-stopped-${Date.now()}`, kind: 'failed', workspacePath: checkpoint.workspacePath, state: 'needs-attention', detail: 'The isolated worker stopped before reporting completion. Inspect the workspace before resuming.' });
    }
    await eventJournal?.waitForWrites();
  }).catch((error) => console.error('[Lyra Hub] Worker monitor failed:', error instanceof Error ? error.message : String(error)));
}, 30_000);
workerMonitor.unref();

wss.on('connection', async (ws, req) => {
  const requestUrl = new URL(req.url || '/', `http://localhost:${PORT}`);
  const isRunner = requestUrl.searchParams.get('runner') === '1';
  let runnerRunId: string | undefined;
  if (isRunner) {
    try { runnerRunId = assertSafeId(requestUrl.searchParams.get('runId') || '', 'run ID'); }
    catch { ws.close(1008, 'Invalid runner identity'); return; }
  }
  const suppliedToken = req.headers.authorization?.replace(/^Bearer\s+/i, '') || requestUrl.searchParams.get('token');
  if (isRunner) {
    if (!runnerToken || suppliedToken !== runnerToken) { ws.close(1008, 'Runner authentication required'); return; }
  } else if (getBetterAuthRuntime()) {
    try { if (!await getBetterAuthSession(req.headers)) { ws.close(1008, 'Authentication required'); return; } }
    catch { ws.close(1008, 'Authentication required'); return; }
  } else if (process.env.LYRA_HOSTED === 'true' || (process.env.NODE_ENV === 'production' && !legacyAuthToken)) {
    ws.close(1008, 'Authentication required'); return;
  } else if (legacyAuthToken) {
    const cookies = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('lyra_auth='))?.slice('lyra_auth='.length);
    if (suppliedToken !== legacyAuthToken && cookies !== legacyAuthToken) { ws.close(1008, 'Authentication required'); return; }
  }
  const runnerNodeId = requestUrl.searchParams.get('nodeId');
  if (runnerNodeId && runnerToken && suppliedToken !== runnerToken) {
    ws.close(1008, 'Runner node authentication required');
    return;
  }
  if (runnerNodeId) runnerSockets.set(runnerNodeId, ws);
  if (isRunner && runnerRunId) runnerSockets.set(runnerRunId, ws);
  console.log('[Lyra Hub] UI Client connected via WebSocket');

  ws.on('close', () => {
    for (const [nodeId, socket] of runnerSockets.entries()) {
      if (socket === ws) {
        runnerSockets.delete(nodeId);
        const node = registeredNodes.get(nodeId);
        if (node && node.type !== 'local' && node.type !== 'cloud') {
          node.status = 'offline';
          broadcast({ type: 'nodes_list', payload: { nodes: Array.from(registeredNodes.values()), activeNodeId } });
        }
      }
    }
  });

  // Send initial storage configuration
  ws.send(
    JSON.stringify({
      type: 'storage_path_updated',
      payload: { storagePath: store.getStoragePath() },
    })
  );

  ws.on('message', async (data) => {
    idleManager.recordActivity();
    let incoming: WSMessage | undefined;
    try {
      const msg: WSMessage = JSON.parse(data.toString());
      incoming = msg;

      if (isRunner) {
        if (msg.type !== 'runner_event' || msg.runId !== runnerRunId) return;
        const eventType = String(msg.payload?.eventType || '');
        const payload = msg.payload?.payload;
        if (eventType === 'unified_event' && payload?.eventId) {
          broadcast({ type: 'unified_event', sessionId: payload.sessionId, agentType: payload.agent === 'user' ? undefined : payload.agent, payload });
        } else if (eventType === 'approval_required') {
          broadcast({ type: 'tool_approval_required', sessionId: msg.sessionId, agentType: 'orchestrator', runId: runnerRunId, payload: { ...payload, runId: runnerRunId } });
        } else if (['run_started', 'content_chunk', 'tool_call', 'error', 'done'].includes(eventType)) {
          broadcast({ type: eventType as WSMessage['type'], sessionId: msg.sessionId, agentType: 'orchestrator', runId: runnerRunId, payload });
          if (eventType === 'done' && runnerRunId) ecsNativeDispatcher.markFinished(runnerRunId);
        }
        return;
      }

      if (msg.type === 'sync_sessions') {
        const cursors = msg.payload?.cursors && typeof msg.payload.cursors === 'object' ? Object.entries(msg.payload.cursors as Record<string, unknown>).slice(0, 50) : [];
        for (const [rawSessionId, rawCursor] of cursors) {
          const sessionId = assertSafeId(rawSessionId, 'session ID');
          const cursor = Number(rawCursor || 0);
          if (!Number.isSafeInteger(cursor) || cursor < 0) continue;
          const events = eventJournal
            ? await eventJournal.getSessionEvents(sessionId, cursor, 1000)
            : (store.getSession(sessionId)?.events || []).map((event, index) => ({ ...event, sequence: event.sequence || index + 1 })).filter((event) => (event.sequence || 0) > cursor).slice(0, 1000);
          const nextCursor = events.at(-1)?.sequence || cursor;
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'session_events_catchup', sessionId, payload: { sessionId, events, nextCursor, hasMore: events.length === 1000 } }));
        }
      } else if (msg.type === 'team_run_start') {
        const payload = msg.payload || {};
        const sessionId = assertSafeId(payload.sessionId || msg.sessionId || 'session-main', 'session ID');
        const objective = payload.objective || payload.prompt || '';
        const teamConfig = payload.teamConfig || { lead: 'antigravity', worker: 'codex', reviewer: 'claude_code' };
        const requestedCwd = String(payload.cwd || process.cwd());
        const cwd = resolveWorkspacePath(requestedCwd);
        if (cwd !== requestedCwd) store.updateSessionMeta(sessionId, { workspacePath: cwd });
        const runId = assertSafeId(String(payload.runId || `run-${Date.now()}`), 'run ID');

        // Append user objective message to unified storage
        store.appendEvent(sessionId, {
          agent: 'user',
          type: 'message',
          payload: { text: `[Team Objective]: ${objective}` },
          runId,
        });
        await eventJournal?.waitForWrites();

        if (activeNodeId === 'node-cloud' || process.env.LYRA_HOSTED === 'true') {
          const session = store.getSession(sessionId);
          const providerProfileId = String(payload.providerProfileId || session?.meta.teamConfig?.nativeProviderProfileId || '');
          if (providerProfileId) {
            const profile = assertNativeModelReady(providerProfileId);
            store.saveAgentCheckpoint({ sessionId, runId, checkpointId: `runner-dispatch-${Date.now()}`, kind: 'turn-started', workspacePath: cwd, state: 'running', detail: 'runner-dispatched' });
            await eventJournal?.waitForWrites();
            store.appendEvent(sessionId, {
              agent: 'orchestrator',
              type: 'status',
              runId,
              payload: { text: `Dispatching team swarm to AWS Fargate cluster: ${objective}` },
            });
            await ecsNativeDispatcher.start({
              runtime: 'native',
              sessionId,
              runId,
              providerProfileId: profile.id,
              prompt: `[Team Swarm Objective]: ${objective}`,
              workspacePath: cwd,
              tenantId: process.env.LYRA_TENANT_ID || 'single-tenant-beta',
            });
            return;
          }
        } else if (activeNodeId !== 'node-local' && runnerSockets.has(activeNodeId)) {
          const runnerSocket = runnerSockets.get(activeNodeId);
          if (runnerSocket?.readyState === WebSocket.OPEN) {
            runnerSocket.send(JSON.stringify({
              type: 'team_run_start',
              sessionId,
              runId,
              payload: {
                sessionId,
                runId,
                objective,
                teamConfig,
                cwd,
                maxRepairAttempts: payload.maxRepairAttempts,
                concurrencyLimit: payload.concurrencyLimit,
              },
            }));
            store.appendEvent(sessionId, {
              agent: 'orchestrator',
              type: 'status',
              runId,
              payload: { text: `Dispatched team swarm to remote runner node: ${registeredNodes.get(activeNodeId)?.name || activeNodeId}` },
            });
            return;
          } else {
            throw new Error(`Selected runner node ${activeNodeId} is currently disconnected.`);
          }
        }

        await teamCoordinator.startTeamRun({
          sessionId,
          objective,
          teamConfig,
          workspacePath: cwd,
          runId,
          maxRepairAttempts: payload.maxRepairAttempts,
          concurrencyLimit: payload.concurrencyLimit,
        });
      } else if (msg.type === 'team_run_approve') {
        const sessionId = assertSafeId(String(msg.sessionId || msg.payload?.sessionId || ''), 'session ID');
        const runId = assertSafeId(String(msg.runId || msg.payload?.runId || ''), 'run ID');
        if (!teamCoordinator.approvePlan(sessionId, runId)) {
          broadcast({ type: 'error', sessionId, runId, payload: { message: 'This plan is no longer waiting for approval.' } });
        }
      } else if (msg.type === 'start_preview') {
        const sessionId = assertSafeId(String(msg.sessionId || msg.payload?.sessionId || ''), 'session ID');
        const runId = assertSafeId(String(msg.runId || msg.payload?.runId || ''), 'run ID');
        const run = store.getRun(sessionId, runId);
        const targetPath = msg.payload?.worktreePath || run?.integrationWorktreePath || run?.worktreePath || process.cwd();
        try {
          const preview = await previewManager.startPreview(runId, targetPath);
          if (run) {
            store.updateRun(sessionId, runId, { previewUrl: preview.url });
            broadcast({ type: 'run_updated', sessionId, runId, payload: { ...run, previewUrl: preview.url } });
          }
          ws.send(JSON.stringify({ type: 'preview_started', payload: { runId, ...preview } }));
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', payload: { message: err instanceof Error ? err.message : String(err) } }));
        }
      } else if (msg.type === 'stop_preview') {
        const sessionId = assertSafeId(String(msg.sessionId || msg.payload?.sessionId || ''), 'session ID');
        const runId = assertSafeId(String(msg.runId || msg.payload?.runId || ''), 'run ID');
        previewManager.stopPreview(runId);
        const run = store.getRun(sessionId, runId);
        if (run) {
          store.updateRun(sessionId, runId, { previewUrl: undefined });
          broadcast({ type: 'run_updated', sessionId, runId, payload: { ...run, previewUrl: undefined } });
        }
        ws.send(JSON.stringify({ type: 'preview_stopped', payload: { runId } }));
      } else if (msg.type === 'team_run_merge') {
        const sessionId = assertSafeId(String(msg.sessionId || msg.payload?.sessionId || ''), 'session ID');
        const runId = assertSafeId(String(msg.runId || msg.payload?.runId || ''), 'run ID');
        const repoPath = msg.payload?.workspacePath || process.cwd();
        const mergeResult = await teamCoordinator.mergeRunToMain(sessionId, runId, repoPath);
        if (mergeResult.success) {
          ws.send(JSON.stringify({ type: 'team_run_merged', payload: { sessionId, runId } }));
        } else {
          broadcast({ type: 'error', sessionId, runId, payload: { message: mergeResult.error || 'Failed to merge changes into main branch.' } });
        }
      } else if (msg.type === 'get_nodes') {
        ws.send(JSON.stringify({ type: 'nodes_list', payload: { nodes: Array.from(registeredNodes.values()), activeNodeId } }));
      } else if (msg.type === 'select_node') {
        const { nodeId } = msg.payload || {};
        if (nodeId && registeredNodes.has(nodeId)) {
          activeNodeId = nodeId;
          broadcast({ type: 'node_selected', payload: { activeNodeId } });
        }
      } else if (msg.type === 'register_node') {
        const node = msg.payload as RunnerNode;
        if (node && node.id) {
          runnerSockets.set(node.id, ws);
          registeredNodes.set(node.id, {
            ...node,
            status: 'online',
            lastSeen: new Date().toISOString(),
          });
          broadcast({ type: 'nodes_list', payload: { nodes: Array.from(registeredNodes.values()), activeNodeId } });
        }
      } else if (msg.type === 'wake_node') {
        await idleManager.wakeNow();
      } else if (msg.type === 'node_heartbeat') {
        const { id } = msg.payload || {};
        const node = id ? registeredNodes.get(id) : undefined;
        if (node) {
          node.lastSeen = new Date().toISOString();
          node.status = 'online';
        }
      } else if (msg.type === 'team_run_pause' || msg.type === 'team_run_resume') {
        const sessionId = assertSafeId(String(msg.sessionId || msg.payload?.sessionId || ''), 'session ID');
        const runId = assertSafeId(String(msg.runId || msg.payload?.runId || ''), 'run ID');
        const changed = msg.type === 'team_run_pause'
          ? teamCoordinator.pauseRun(sessionId, runId)
          : teamCoordinator.resumeRun(sessionId, runId);
        if (!changed) broadcast({ type: 'error', sessionId, runId, payload: { message: `Cannot ${msg.type === 'team_run_pause' ? 'pause' : 'resume'} this run in its current state.` } });
      } else if (msg.type === 'swarm_message') {
        const sessionId = assertSafeId(String(msg.sessionId || msg.payload?.sessionId || ''), 'session ID');
        const runId = assertSafeId(String(msg.runId || msg.payload?.runId || ''), 'run ID');
        const kind = ['message', 'handoff', 'blocker', 'artifact', 'status'].includes(msg.payload?.kind) ? msg.payload.kind : 'message';
        store.addSwarmMessage(sessionId, runId, {
          fromAgent: String(msg.payload?.fromAgent || 'user').slice(0, 100),
          toAgent: String(msg.payload?.toAgent || 'team').slice(0, 100),
          taskId: msg.payload?.taskId ? String(msg.payload.taskId).slice(0, 100) : undefined,
          kind,
          text: String(msg.payload?.text || ''),
        });
      } else if (msg.type === 'native_agent_resume') {
        const sessionId = assertSafeId(String(msg.sessionId || msg.payload?.sessionId || ''), 'session ID');
        const runId = assertSafeId(String(msg.runId || msg.payload?.runId || ''), 'run ID');
        const providerProfileId = assertSafeId(String(msg.payload?.providerProfileId || ''), 'provider profile ID');
        if (process.env.LYRA_HOSTED === 'true') {
          const checkpoint = store.getLatestAgentCheckpoint(sessionId, runId);
          if (!checkpoint || checkpoint.state !== 'needs-attention') throw new Error('This native agent run is not waiting for recovery.');
          const profile = assertNativeModelReady(providerProfileId);
          store.saveAgentCheckpoint({ sessionId, runId, checkpointId: `resume-dispatch-${Date.now()}`, kind: 'turn-started', workspacePath: checkpoint.workspacePath, state: 'running', detail: 'resume-dispatched' });
          await eventJournal?.waitForWrites();
          await ecsNativeDispatcher.start({ runtime: 'native', sessionId, runId, providerProfileId: profile.id, tenantId: process.env.LYRA_TENANT_ID || 'single-tenant-beta', workspacePath: checkpoint.workspacePath, prompt: 'Continue the interrupted coding task from the latest saved conversation and repository state. Inspect the workspace and Git status before acting. Do not repeat any side effect unless you verify whether it already completed.', resume: true });
        } else {
          const resumed = await nativeAgentRuntime.resume(sessionId, runId, providerProfileId, process.env.LYRA_TENANT_ID || 'local');
          if (!resumed) throw new Error('This native agent run is not waiting for recovery.');
        }
      } else if (msg.type === 'tool_approval_decision') {
        const sessionId = assertSafeId(String(msg.sessionId || msg.payload?.sessionId || ''), 'session ID');
        const runId = assertSafeId(String(msg.runId || msg.payload?.runId || ''), 'run ID');
        const approvalId = assertSafeId(String(msg.payload?.approvalId || ''), 'approval ID');
        const runner = runnerSockets.get(runId);
        if (runner?.readyState === WebSocket.OPEN) runner.send(JSON.stringify({ type: 'runner_control', sessionId, runId, payload: { command: 'approval', approvalId, approved: msg.payload?.approved === true } }));
        else if (!await nativeAgentRuntime.decideApproval(sessionId, runId, approvalId, msg.payload?.approved === true)) broadcast({ type: 'error', sessionId, runId, payload: { message: 'That approval request is no longer active. Review the workspace before resuming.' } });
      } else if (msg.type === 'user_prompt' || msg.type === 'chat_message') {
        const payload = msg.payload || {};
        const sessionId = assertSafeId(payload.sessionId || msg.sessionId || 'session-main', 'session ID');
        const agentType = payload.agentType || msg.agentType || 'antigravity';
        const prompt = payload.prompt || '';
        const requestedCwd = String(payload.cwd || process.cwd());
        const cwd = resolveWorkspacePath(requestedCwd);
        if (cwd !== requestedCwd) store.updateSessionMeta(sessionId, { workspacePath: cwd });
        const binding = store.getAgentBinding(sessionId, agentType);

        // Append user message event to unified storage
        store.appendEvent(sessionId, {
          agent: 'user',
          type: 'message',
          payload: { text: prompt },
          runId: payload.runId,
        });

        if (payload.runtime === 'native') {
          const session = store.getSession(sessionId);
          const providerProfileId = String(payload.providerProfileId || session?.meta.teamConfig?.nativeProviderProfileId || '');
          if (!providerProfileId) throw new Error('Choose a Bedrock or OpenRouter coding model in Settings before starting Lyra.');
          const runId = assertSafeId(String(payload.runId || `run-${Date.now()}`), 'run ID');
          if (activeNodeId === 'node-cloud' || process.env.LYRA_HOSTED === 'true') {
            const profile = assertNativeModelReady(providerProfileId);
            await eventJournal?.waitForWrites();
            try {
              store.saveAgentCheckpoint({ sessionId, runId, checkpointId: `runner-dispatch-${Date.now()}`, kind: 'turn-started', workspacePath: cwd, state: 'running', detail: 'runner-dispatched' });
              await eventJournal?.waitForWrites();
              await ecsNativeDispatcher.start({ runtime: 'native', sessionId, runId, providerProfileId: profile.id, prompt, workspacePath: cwd, tenantId: process.env.LYRA_TENANT_ID || 'single-tenant-beta' });
            } catch (error) {
              store.saveAgentCheckpoint({ sessionId, runId, checkpointId: `start-failed-${Date.now()}`, kind: 'failed', workspacePath: cwd, state: 'failed', detail: error instanceof Error ? error.message : String(error) });
              await eventJournal?.waitForWrites().catch(() => undefined);
              throw error;
            }
          } else if (activeNodeId !== 'node-local' && runnerSockets.has(activeNodeId)) {
            const runnerSocket = runnerSockets.get(activeNodeId);
            if (runnerSocket?.readyState === WebSocket.OPEN) {
              runnerSocket.send(JSON.stringify({
                type: 'run_task',
                sessionId,
                runId,
                payload: { runtime: 'native', prompt, workspacePath: cwd, providerProfileId },
              }));
              store.appendEvent(sessionId, {
                agent: 'orchestrator',
                type: 'status',
                runId,
                payload: { text: `Dispatched task to remote runner node: ${registeredNodes.get(activeNodeId)?.name || activeNodeId}` },
              });
            } else {
              throw new Error(`Selected runner node ${activeNodeId} is currently disconnected.`);
            }
          } else {
            await nativeAgentRuntime.run({ sessionId, runId, prompt, workspacePath: cwd, providerProfileId, tenantId: process.env.LYRA_TENANT_ID || 'local' });
          }
          return;
        }

        await processManager.runAgent({
          agentType,
          prompt,
          cwd,
          sessionId,
          runId: payload.runId,
          executionMode: payload.executionMode || 'safe',
          model: payload.model,
          effort: payload.effort,
          continueSession: payload.continueSession,
          conversationId: payload.conversationId || binding?.nativeConversationId,
          nativeSessionId: binding?.nativeSessionId,
          addDirs: payload.addDirs,
          search: payload.search,
          imagePaths: payload.imagePaths,
          approvalPolicy: payload.approvalPolicy,
          isSlashCommand: payload.isSlashCommand,
          slashCommand: payload.slashCommand,
        });
      } else if (msg.type === 'cancel_run') {
        const runIdToCancel = String(msg.payload?.runId || msg.runId || '');
        if (runIdToCancel) {
          teamCoordinator.cancelRun(runIdToCancel, msg.sessionId || msg.payload?.sessionId);
          processManager.cancel(runIdToCancel);
          const runner = runnerSockets.get(runIdToCancel);
          if (runner?.readyState === WebSocket.OPEN) runner.send(JSON.stringify({ type: 'runner_control', sessionId: msg.sessionId, runId: runIdToCancel, payload: { command: 'cancel' } }));
          else if (process.env.LYRA_HOSTED === 'true') {
            const checkpoint = msg.sessionId ? store.getLatestAgentCheckpoint(msg.sessionId, runIdToCancel) : null;
            const stopped = await ecsNativeDispatcher.stop(runIdToCancel);
            if (stopped && checkpoint) {
              store.saveAgentCheckpoint({ sessionId: checkpoint.sessionId, runId: checkpoint.runId, checkpointId: `cancel-${Date.now()}`, kind: 'cancelled', workspacePath: checkpoint.workspacePath, state: 'paused', detail: 'Stopped by the user.' });
              await eventJournal?.waitForWrites().catch(() => undefined);
            }
          }
          else nativeAgentRuntime.cancel(runIdToCancel);
        }
      } else if (msg.type === 'clear_session') {
        const sessionId = assertSafeId(String(msg.sessionId || msg.payload?.sessionId), 'session ID');
        store.clearSession(sessionId);
        await eventJournal?.clearSession(sessionId);
      } else if (msg.type === 'bridge_dispatch') {
        const { from, to, instruction, context } = msg.payload || {};
        const targetSessionId = assertSafeId(msg.payload?.sessionId || msg.sessionId || 'session-main', 'session ID');
        const sessionData = store.getSession(targetSessionId);
        const cwd = resolveWorkspacePath(msg.payload?.cwd || sessionData?.meta?.workspacePath || process.cwd());
        const runId = msg.payload?.runId || `run-bridge-${Date.now()}`;

        const task = messageBus.createTask(from, to, instruction, context);

        store.appendEvent(targetSessionId, {
          agent: 'orchestrator',
          type: 'status',
          payload: {
            text: `Dispatched handoff from ${from} to ${to}: ${instruction}`,
          },
          runId,
        });

        // Execute pipeline automatically and await actual outcome
        const result = await processManager.runAgent({
          agentType: to,
          prompt: `[Handoff from ${from}]: ${instruction}\nContext:\n${context || ''}`,
          cwd,
          sessionId: targetSessionId,
          runId,
        });

        const isSuccess = result.code === 0 && !result.cancelled && !result.error;
        messageBus.updateTask(task.id, {
          status: isSuccess ? 'completed' : 'failed',
          result: result.fullContent || result.error || (result.cancelled ? 'Cancelled' : `Exited with status ${result.code}`),
        });
      }
    } catch (e) {
      console.error('[Lyra Hub] Error handling message:', e);
      const sessionId = incoming?.sessionId || incoming?.payload?.sessionId;
      const runId = incoming?.runId || incoming?.payload?.runId;
      const message = e instanceof Error ? e.message : String(e);
      broadcast({ type: 'error', sessionId, runId, payload: { message } });
      if (runId) broadcast({ type: 'done', sessionId, runId, agentType: 'orchestrator', payload: { code: 1 } });
    }
  });

  ws.on('close', () => {
    if (isRunner && runnerRunId && runnerSockets.get(runnerRunId) === ws) {
      runnerSockets.delete(runnerRunId);
      setTimeout(() => {
        void (async () => {
          if (runnerSockets.has(runnerRunId)) return;
          const checkpoint = store.listInterruptedAgentRuns().find((item) => item.runId === runnerRunId);
          if (!checkpoint || await ecsNativeDispatcher.isRunRunning(runnerRunId)) return;
          store.saveAgentCheckpoint({ sessionId: checkpoint.sessionId, runId: runnerRunId, checkpointId: `runner-disconnect-${Date.now()}`, kind: 'failed', workspacePath: checkpoint.workspacePath, state: 'needs-attention', detail: 'The isolated worker stopped before reporting completion. Inspect the workspace before resuming.' });
          await eventJournal?.waitForWrites().catch(() => undefined);
        })().catch((error) => console.error('[Lyra Hub] Runner recovery check failed:', error instanceof Error ? error.message : String(error)));
      }, 20_000);
    }
    console.log('[Lyra Hub] UI Client disconnected');
  });
});

server.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`[Lyra Hub] Port ${PORT} already in use. Connected to existing Hub instance.`);
  } else {
    console.error('[Lyra Hub] Server error:', err);
  }
});

async function startServer() {
  const betterAuth = await initializeBetterAuth();
  if (process.env.LYRA_HOSTED === 'true' && !betterAuth) throw new Error('Hosted Lyra requires Better Auth backed by PostgreSQL.');
  if (eventJournal) await eventJournal.initialize(store);
  for (const checkpoint of store.listInterruptedAgentRuns()) {
    if (process.env.LYRA_HOSTED === 'true' && await ecsNativeDispatcher.isRunRunning(checkpoint.runId)) {
      ecsNativeDispatcher.restoreActive(checkpoint.sessionId, checkpoint.runId);
      continue;
    }
    store.saveAgentCheckpoint({
      sessionId: checkpoint.sessionId,
      runId: checkpoint.runId,
      checkpointId: `recovery-${Date.now()}`,
      kind: 'failed',
      workspacePath: checkpoint.workspacePath,
      state: 'needs-attention',
      detail: 'Lyra restarted while this run was active. Inspect the workspace before resuming.',
    });
  }
  await eventJournal?.waitForWrites();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Lyra Hub] Server running on http://0.0.0.0:${PORT} (accessible via LAN/Tailscale)`);
    console.log(`[Lyra Hub] Unified Storage initialized at: ${store.getStoragePath()}`);
    if (eventJournal) console.log('[Lyra Hub] PostgreSQL event journal is enabled.');
  });
}

void startServer().catch((error) => {
  console.error('[Lyra Hub] Startup failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => {
  server.close();
  void eventJournal?.close();
  void getBetterAuthRuntime()?.close();
});
