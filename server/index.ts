import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { UnifiedStore } from './unifiedStore';
import { AntigravityAdapter } from './adapters/antigravityAdapter';
import { ClaudeAdapter } from './adapters/claudeAdapter';
import { CodexAdapter } from './adapters/codexAdapter';
import { ProcessManager } from './processManager';
import { MessageBus } from './messageBus';
import type { WSMessage } from './types';
import { assertSafeId, validateWorkingDirectory } from './security';

const PORT = 3001;

const store = new UnifiedStore();
const antigravityAdapter = new AntigravityAdapter(store);
const claudeAdapter = new ClaudeAdapter(store);
const codexAdapter = new CodexAdapter(store);
const processManager = new ProcessManager();
const messageBus = new MessageBus();
const authToken = process.env.LYRA_AUTH_TOKEN;

function isAuthorized(req: http.IncomingMessage) {
  if (!authToken) return process.env.NODE_ENV !== 'production';
  const cookies = req.headers.cookie || '';
  const cookieToken = cookies.split(';').map((part) => part.trim()).find((part) => part.startsWith('lyra_auth='))?.slice('lyra_auth='.length);
  return req.headers.authorization === `Bearer ${authToken}` || cookieToken === authToken;
}

setTimeout(() => {
  antigravityAdapter.start();
  claudeAdapter.start();
  codexAdapter.start();
}, 200);

const server = http.createServer((req, res) => {
  // CORS headers
  const origin = req.headers.origin;
  if (!origin || origin === `http://localhost:5173` || origin === `http://127.0.0.1:5173`) {
    res.setHeader('Access-Control-Allow-Origin', origin || 'http://localhost:5173');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  if (url.pathname === '/api/auth/bootstrap' && req.method === 'GET' && authToken) {
    res.writeHead(204, { 'Set-Cookie': `lyra_auth=${authToken}; HttpOnly; SameSite=Strict; Path=/` });
    res.end();
    return;
  }

  if (url.pathname.startsWith('/api/') && url.pathname !== '/api/health' && url.pathname !== '/api/auth/bootstrap' && !isAuthorized(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Authentication required' }));
    return;
  }

  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'Lyra Hub' }));
    return;
  }

  if (url.pathname === '/api/agents/capabilities' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(processManager.getCapabilities()));
    return;
  }

  // Get storage config
  if (url.pathname === '/api/storage/config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ storagePath: store.getStoragePath() }));
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
        const workspacePath = validateWorkingDirectory(String(payload.workspacePath || process.cwd()));
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

  // Get specific session events
  if (url.pathname.startsWith('/api/sessions/') && req.method === 'GET') {
    let sessionId: string;
    try { sessionId = assertSafeId(decodeURIComponent(url.pathname.replace('/api/sessions/', '')), 'session ID'); } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid session ID' })); return;
    }
    const sessionData = store.getSession(sessionId);
    if (sessionData) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(sessionData));
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
        if (payload.workspacePath !== undefined) updates.workspacePath = validateWorkingDirectory(String(payload.workspacePath));
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

// Broadcast unified events when created by adapters or processes
store.on('event_appended', (event) => {
  broadcast({
    type: 'unified_event',
    sessionId: event.sessionId,
    agentType: event.agent === 'user' ? undefined : event.agent,
    payload: event,
  });
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
processManager.on('thought', (data) => {
  store.appendEvent(data.sessionId, {
    agent: data.agentType,
    type: 'thought',
    payload: { text: data.thought },
    runId: data.runId,
  });

  broadcast({
    type: 'thought_chunk',
    sessionId: data.sessionId,
    agentType: data.agentType,
    runId: data.runId,
    payload: { text: data.thought, runId: data.runId },
  });
});

processManager.on('run_started', (data) => {
  store.appendEvent(data.sessionId, { agent: data.agentType, type: 'run_started', runId: data.runId, payload: data });
  broadcast({ type: 'run_started', sessionId: data.sessionId, agentType: data.agentType, runId: data.runId, payload: data } as WSMessage);
});

processManager.on('run_cancelled', (data) => {
  broadcast({ type: 'run_cancelled', runId: data.runId, payload: data } as WSMessage);
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
    payload: {},
  });
});

messageBus.on('task_created', (task) => {
  broadcast({
    type: 'bridge_dispatch',
    payload: task,
  });
});

wss.on('connection', (ws, req) => {
  const requestUrl = new URL(req.url || '/', `http://localhost:${PORT}`);
  const suppliedToken = req.headers.authorization?.replace(/^Bearer\s+/i, '') || requestUrl.searchParams.get('token');
  const cookieToken = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('lyra_auth='))?.slice('lyra_auth='.length);
  if (authToken && suppliedToken !== authToken && cookieToken !== authToken) {
    ws.close(1008, 'Authentication required');
    return;
  }
  console.log('[Lyra Hub] UI Client connected via WebSocket');

  // Send initial storage configuration
  ws.send(
    JSON.stringify({
      type: 'storage_path_updated',
      payload: { storagePath: store.getStoragePath() },
    })
  );

  ws.on('message', async (data) => {
    try {
      const msg: WSMessage = JSON.parse(data.toString());

      if (msg.type === 'user_prompt' || msg.type === 'chat_message') {
        const payload = msg.payload || {};
        const sessionId = assertSafeId(payload.sessionId || msg.sessionId || 'session-main', 'session ID');
        const agentType = payload.agentType || msg.agentType || 'antigravity';
        const prompt = payload.prompt || '';
        const cwd = validateWorkingDirectory(payload.cwd || process.cwd());
        const binding = store.getAgentBinding(sessionId, agentType);

        // Append user message event to unified storage
        store.appendEvent(sessionId, {
          agent: 'user',
          type: 'message',
          payload: { text: prompt },
        });

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
        });
      } else if (msg.type === 'cancel_run') {
        processManager.cancel(String(msg.payload?.runId || ''));
      } else if (msg.type === 'clear_session') {
        store.clearSession(assertSafeId(String(msg.sessionId || msg.payload?.sessionId), 'session ID'));
      } else if (msg.type === 'bridge_dispatch') {
        const { from, to, instruction, context } = msg.payload;
        const task = messageBus.createTask(from, to, instruction, context);

        store.appendEvent('session-main', {
          agent: 'orchestrator',
          type: 'status',
          payload: {
            text: `Dispatched handoff from ${from} to ${to}: ${instruction}`,
          },
        });

        // Execute pipeline automatically
        await processManager.runAgent({
          agentType: to,
          prompt: `[Handoff from ${from}]: ${instruction}\nContext:\n${context || ''}`,
          cwd: process.cwd(),
          sessionId: 'session-main',
        });

        messageBus.updateTask(task.id, { status: 'completed' });
      }
    } catch (e) {
      console.error('[Lyra Hub] Error handling message:', e);
    }
  });

  ws.on('close', () => {
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

server.listen(PORT, () => {
  console.log(`[Lyra Hub] Server running on http://localhost:${PORT}`);
  console.log(`[Lyra Hub] Unified Storage initialized at: ${store.getStoragePath()}`);
});
