import { describe, expect, it, afterEach } from 'bun:test';
import { WebSocketServer } from 'ws';
import { RunnerDaemon } from './runnerDaemon';

describe('RunnerDaemon', () => {
  let wss: WebSocketServer | null = null;
  let runner: RunnerDaemon | null = null;

  afterEach(() => {
    if (runner) {
      runner.stop();
      runner = null;
    }
    if (wss) {
      wss.close();
      wss = null;
    }
  });

  it('initializes node profile with system attributes', () => {
    runner = new RunnerDaemon({
      hubUrl: 'ws://localhost:9999',
      nodeName: 'Test Homelab Node',
      nodeId: 'node-test-123',
    });

    const node = runner.getNode();
    expect(node.id).toBe('node-test-123');
    expect(node.name).toBe('Test Homelab Node');
    expect(node.type).toBe('homelab');
    expect(node.cpus).toBeGreaterThan(0);
    expect(node.memoryMb).toBeGreaterThan(0);
    expect(node.status).toBe('online');
  });

  it('connects to hub, registers node, and sends heartbeat', async () => {
    const receivedMessages: any[] = [];

    // Create a mock hub WebSocket server on dynamic port and wait for it to be listening
    let port = 0;
    await new Promise<void>((resolve) => {
      wss = new WebSocketServer({ host: '127.0.0.1', port: 0 }, () => {
        port = (wss!.address() as any).port;
        resolve();
      });
    });

    wss!.on('connection', (ws) => {
      ws.on('message', (data) => {
        try {
          receivedMessages.push(JSON.parse(data.toString()));
        } catch {}
      });
    });

    runner = new RunnerDaemon({
      hubUrl: `ws://127.0.0.1:${port}`,
      nodeName: 'Mock Homelab Runner',
      nodeId: 'node-mock-runner',
      heartbeatIntervalMs: 50,
    });

    await runner.start();

    // Wait 120ms to allow connection, registration, and at least one heartbeat
    await new Promise((r) => setTimeout(r, 120));

    expect(receivedMessages.length).toBeGreaterThanOrEqual(2);
    
    // First message should be register_node
    const regMsg = receivedMessages.find((m) => m.type === 'register_node');
    expect(regMsg).toBeDefined();
    expect(regMsg.payload.id).toBe('node-mock-runner');
    expect(regMsg.payload.name).toBe('Mock Homelab Runner');

    // Heartbeat message should be sent
    const heartbeatMsg = receivedMessages.find((m) => m.type === 'node_heartbeat');
    expect(heartbeatMsg).toBeDefined();
    expect(heartbeatMsg.payload.id).toBe('node-mock-runner');
  });
});
