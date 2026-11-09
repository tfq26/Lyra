import { describe, expect, it, afterEach } from 'bun:test';
import { EventEmitter } from 'node:events';
import { RunnerDaemon } from './runnerDaemon';

describe('RunnerDaemon', () => {
  let runner: RunnerDaemon | null = null;

  afterEach(() => {
    if (runner) {
      runner.stop();
      runner = null;
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

    class MockWebSocket extends EventEmitter {
      public readyState = 1; // WebSocket.OPEN
      constructor() {
        super();
        setTimeout(() => this.emit('open'), 5);
      }
      send(data: string) {
        try {
          receivedMessages.push(JSON.parse(data));
        } catch {}
      }
      close() {
        this.readyState = 3;
        this.emit('close', 1000, 'Normal');
      }
    }

    runner = new RunnerDaemon({
      hubUrl: 'ws://127.0.0.1:3001',
      nodeName: 'Mock Homelab Runner',
      nodeId: 'node-mock-runner',
      heartbeatIntervalMs: 50,
      webSocketFactory: () => new MockWebSocket(),
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
