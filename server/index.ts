import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { UnifiedStore } from './unifiedStore';
import { AntigravityAdapter } from './adapters/antigravityAdapter';
import { ClaudeAdapter } from './adapters/claudeAdapter';
import { CodexAdapter } from './adapters/codexAdapter';
import { ProcessManager } from './processManager';
import { MessageBus } from './messageBus';
import { WSMessage } from './types';

const PORT = 3001;

const store = new UnifiedStore();
const antigravityAdapter = new AntigravityAdapter(store);
const claudeAdapter = new ClaudeAdapter(store);
const codexAdapter = new CodexAdapter(store);
const processManager = new ProcessManager();
const messageBus = new MessageBus();

antigravityAdapter.start();
claudeAdapter.start();
codexAdapter.start();

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'Lyra Hub' }));
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
    const sessions = store.listSessions();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(sessions));
    return;
  }

  // Get specific session events
  if (url.pathname.startsWith('/api/sessions/') && req.method === 'GET') {
    const sessionId = url.pathname.replace('/api/sessions/', '');
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

store.on('storage_path_changed', (newPath) => {
  broadcast({
    type: 'storage_path_updated',
    payload: { storagePath: newPath },
  });
});

// Process manager events
processManager.on('thought', (data) => {
  store.appendEvent(data.sessionId, {
    agent: data.agentType,
    type: 'thought',
    payload: { text: data.thought },
  });

  broadcast({
    type: 'thought_chunk',
    sessionId: data.sessionId,
    agentType: data.agentType,
    payload: data.thought,
  });
});

processManager.on('tool_call', (data) => {
  store.appendEvent(data.sessionId, {
    agent: data.agentType,
    type: 'tool_call',
    payload: data.toolCall,
  });

  broadcast({
    type: 'tool_call',
    sessionId: data.sessionId,
    agentType: data.agentType,
    payload: data.toolCall,
  });
});

processManager.on('diff', (data) => {
  store.appendEvent(data.sessionId, {
    agent: data.agentType,
    type: 'diff',
    payload: data.diff,
  });

  broadcast({
    type: 'diff',
    sessionId: data.sessionId,
    agentType: data.agentType,
    payload: data.diff,
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
  broadcast({
    type: 'done',
    sessionId: data.sessionId,
    agentType: data.agentType,
    payload: {},
  });
});

messageBus.on('task_created', (task) => {
  broadcast({
    type: 'bridge_dispatch',
    payload: task,
  });
});

wss.on('connection', (ws) => {
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

      if (msg.type === 'user_prompt') {
        const { sessionId, agentType, prompt, cwd } = msg.payload;

        // Append user message event to unified storage
        store.appendEvent(sessionId || 'session-main', {
          agent: 'user',
          type: 'message',
          payload: { text: prompt },
        });

        await processManager.runAgent({
          agentType: agentType || 'antigravity',
          prompt,
          cwd: cwd || process.cwd(),
          sessionId: sessionId || 'session-main',
        });
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

server.listen(PORT, () => {
  console.log(`[Lyra Hub] Server running on http://localhost:${PORT}`);
  console.log(`[Lyra Hub] Unified Storage initialized at: ${store.getStoragePath()}`);
});
