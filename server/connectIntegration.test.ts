import { describe, it, expect, beforeAll } from 'bun:test';
import { EventEmitter } from 'node:events';
import { connectPresenceManager } from './connectPresence';
import { AHPServer } from './ahpProtocol';
import { UnifiedStore } from './unifiedStore';

// In-memory mock HTTP pipeline so tests run deterministically in sandbox
function createMockHttp() {
  const req = new EventEmitter() as any;
  req.headers = {};
  req.method = 'GET';
  req.url = '/';

  const res = new EventEmitter() as any;
  res.statusCode = 200;
  res.headers = {};
  res.body = '';
  res.writeHead = (code: number, headers?: any) => {
    res.statusCode = code;
    if (headers) Object.assign(res.headers, headers);
  };
  res.end = (chunk?: any) => {
    if (chunk) res.body += chunk;
    res.emit('finish');
  };
  return { req, res };
}

describe('Lyra Connect Cross-Device Integration Suite', () => {
  let ahpServer: AHPServer;
  let store: UnifiedStore;

  beforeAll(() => {
    const tempStoreDir = `/tmp/lyra-connect-suite-${Date.now()}`;
    store = new UnifiedStore(tempStoreDir);
    ahpServer = new AHPServer(store);
  });

  function dispatchRoute(
    method: string,
    path: string,
    body?: any,
    headers: Record<string, string> = {}
  ): Promise<{ status: number; body: any }> {
    return new Promise((resolve) => {
      const { req, res } = createMockHttp();
      req.method = method;
      req.url = path;
      req.headers = headers;

      res.on('finish', () => {
        let parsed = res.body;
        try {
          parsed = JSON.parse(res.body);
        } catch {
          // keep as string
        }
        resolve({ status: res.statusCode, body: parsed });
      });

      const url = new URL(path, 'http://localhost');

      // 1. Device Heartbeat
      if (url.pathname === '/api/connect/heartbeat' && method === 'POST') {
        const dev = connectPresenceManager.recordHeartbeat({
          deviceId: body?.deviceId,
          deviceName: body?.deviceName,
          deviceType: body?.deviceType,
          workspacePath: body?.workspacePath,
          activeSessionId: body?.activeSessionId,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, device: dev }));
        return;
      }

      // 2. List Online Devices
      if (url.pathname === '/api/connect/devices' && method === 'GET') {
        const devices = connectPresenceManager.listOnlineDevices();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ devices, count: devices.length }));
        return;
      }

      // 3. Cast Session
      if (url.pathname === '/api/connect/cast' && method === 'POST') {
        const result = connectPresenceManager.castSession({
          fromDeviceId: body?.fromDeviceId,
          targetDeviceId: body?.targetDeviceId,
          sessionId: body?.sessionId,
        });
        res.writeHead(result.success ? 200 : 404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }

      // 4. Session Delta Sync GET
      if (url.pathname === '/api/gateway/sessions/sync' && method === 'GET') {
        const sessionId = url.searchParams.get('sessionId') || undefined;
        const sinceSeq = Number(url.searchParams.get('sinceSeq') || 0);
        const workspacePath = url.searchParams.get('workspacePath') || undefined;
        const delta = ahpServer.syncSessionDelta({ sessionId, sinceSeq, workspacePath });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(delta));
        return;
      }

      // 5. Session Delta Sync POST (append turns)
      if (url.pathname === '/api/gateway/sessions/sync' && method === 'POST') {
        const sessionId = body?.sessionId || 'session-main';
        if (!ahpServer.getSession(sessionId)) {
          ahpServer.createSession({
            sessionId,
            title: body?.title || 'Cloud Synced Session',
            workspacePath: body?.workspacePath || process.cwd(),
          });
        }
        if (Array.isArray(body?.appendMessages)) {
          for (const m of body.appendMessages) {
            if (m?.content && (m.role === 'user' || m.role === 'assistant')) {
              ahpServer.appendMessage(sessionId, {
                role: m.role,
                content: String(m.content),
                harness: body?.harness || 'dsh-sync',
                deviceId: body?.deviceId,
              });
            }
          }
        }
        const delta = ahpServer.syncSessionDelta({
          sessionId,
          sinceSeq: Number(body?.sinceSeq || 0),
          workspacePath: body?.workspacePath,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(delta));
        return;
      }

      res.writeHead(404);
      res.end('Not Found');
    });
  }

  it('Device A and Device B register heartbeats and see each other online', async () => {
    // Device A: MacBook Pro
    const resA = await dispatchRoute('POST', '/api/connect/heartbeat', {
      deviceId: 'macbook-dev',
      deviceName: 'MacBook Pro M3 Max',
      deviceType: 'desktop',
      workspacePath: '/Users/taufeeqali/Projects/Lyra',
    });
    expect(resA.status).toBe(200);

    // Device B: iPhone 16
    const resB = await dispatchRoute('POST', '/api/connect/heartbeat', {
      deviceId: 'iphone-mobile',
      deviceName: 'iPhone 16 Pro',
      deviceType: 'mobile',
    });
    expect(resB.status).toBe(200);

    // Query online devices
    const listRes = await dispatchRoute('GET', '/api/connect/devices');
    expect(listRes.status).toBe(200);
    expect(listRes.body.count).toBeGreaterThanOrEqual(2);

    const devA = listRes.body.devices.find((d: any) => d.deviceId === 'macbook-dev');
    const devB = listRes.body.devices.find((d: any) => d.deviceId === 'iphone-mobile');
    expect(devA).toBeDefined();
    expect(devB).toBeDefined();
    expect(devA.deviceName).toBe('MacBook Pro M3 Max');
    expect(devB.deviceType).toBe('mobile');
  });

  it('Device A sends chat turns, Device B pulls delta with sinceSeq=0 and receives full history', async () => {
    const sessionId = 'session-cloud-test-1';

    // Device A posts turn 1
    const postRes1 = await dispatchRoute('POST', '/api/gateway/sessions/sync', {
      sessionId,
      title: 'Cloud Integration Test',
      deviceId: 'macbook-dev',
      harness: 'cline-cli',
      appendMessages: [
        { role: 'user', content: 'What is the Lyra Connect protocol architecture?' },
        { role: 'assistant', content: 'Lyra Connect uses AHP sequence-delta sync backed by PostgreSQL and S3.' },
      ],
      sinceSeq: 0,
    });
    expect(postRes1.status).toBe(200);
    expect(postRes1.body.latestSeq).toBe(2);

    // Device B pulls delta since sequence 0
    const pullResB = await dispatchRoute('GET', `/api/gateway/sessions/sync?sessionId=${sessionId}&sinceSeq=0`);
    expect(pullResB.status).toBe(200);
    expect(pullResB.body.sessionId).toBe(sessionId);
    expect(pullResB.body.latestSeq).toBe(2);
    expect(pullResB.body.deltaMessages.length).toBe(2);
    expect(pullResB.body.deltaMessages[0].sequence).toBe(1);
    expect(pullResB.body.deltaMessages[0].content).toContain('Lyra Connect protocol');
    expect(pullResB.body.deltaMessages[1].sequence).toBe(2);
    expect(pullResB.body.deltaMessages[1].content).toContain('PostgreSQL and S3');
  });

  it('Device A casts session to Device B, verifying handoff and seamless continuity', async () => {
    const sessionId = 'session-cloud-test-1';

    // Cast session from MacBook to iPhone
    const castRes = await dispatchRoute('POST', '/api/connect/cast', {
      fromDeviceId: 'macbook-dev',
      targetDeviceId: 'iphone-mobile',
      sessionId,
    });
    expect(castRes.status).toBe(200);
    expect(castRes.body.success).toBe(true);
    expect(castRes.body.targetDevice.deviceId).toBe('iphone-mobile');
    expect(castRes.body.targetDevice.activeSessionId).toBe(sessionId);

    // Device B confirms it is now active and appends a follow-up turn from mobile
    const mobileAppend = await dispatchRoute('POST', '/api/gateway/sessions/sync', {
      sessionId,
      deviceId: 'iphone-mobile',
      harness: 'mobile-web',
      appendMessages: [
        { role: 'user', content: 'Casting verified. Can we check SQS claim check status?' },
      ],
      sinceSeq: 2,
    });
    expect(mobileAppend.status).toBe(200);
    expect(mobileAppend.body.latestSeq).toBe(3);
    expect(mobileAppend.body.deltaMessages.length).toBe(1);
    expect(mobileAppend.body.deltaMessages[0].sequence).toBe(3);

    // Device A pulls delta since sequence 2 (only receives the single new message from mobile)
    const pullResA = await dispatchRoute('GET', `/api/gateway/sessions/sync?sessionId=${sessionId}&sinceSeq=2`);
    expect(pullResA.status).toBe(200);
    expect(pullResA.body.latestSeq).toBe(3);
    expect(pullResA.body.deltaMessages.length).toBe(1);
    expect(pullResA.body.deltaMessages[0].sequence).toBe(3);
    expect(pullResA.body.deltaMessages[0].content).toContain('Casting verified');
    expect(pullResA.body.deltaMessages[0].deviceId).toBe('iphone-mobile');
  });
});
