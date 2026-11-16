import { describe, expect, test } from 'bun:test';
import { RunnerPool } from './runnerPool';
import type { RunnerNode } from './types';

function makeNode(id: string, overrides: Partial<RunnerNode> = {}): RunnerNode {
  return {
    id,
    name: `Homelab ${id}`,
    type: 'homelab',
    os: 'linux',
    cpus: 4,
    memoryMb: 16384,
    maxConcurrency: 4,
    activeTasks: 0,
    status: 'online',
    lastSeen: new Date().toISOString(),
    ...overrides,
  };
}

const openSocket = { readyState: 1 };
const closedSocket = { readyState: 3 };

describe('RunnerPool', () => {
  test('picks least-busy online homelab node across 2 Tailscale servers', () => {
    const pool = new RunnerPool();
    pool.register(makeNode('ts-1', { activeTasks: 2, maxConcurrency: 4 }), { ...openSocket });
    pool.register(makeNode('ts-2', { activeTasks: 0, maxConcurrency: 4 }), { ...openSocket });

    const picked = pool.pickNode({ nodeType: 'homelab' });
    expect(picked?.node.id).toBe('ts-2');

    pool.recordTaskStart('ts-2');
    pool.recordTaskStart('ts-2');
    pool.recordTaskStart('ts-2');
    // Now ts-2 has 3/4 (0.75) and ts-1 has 2/4 (0.50)
    const nextPicked = pool.pickNode({ nodeType: 'homelab' });
    expect(nextPicked?.node.id).toBe('ts-1');
  });

  test('skips saturated, offline, and closed-socket nodes', () => {
    const pool = new RunnerPool();
    pool.register(makeNode('ts-full', { activeTasks: 2, maxConcurrency: 2 }), { ...openSocket });
    pool.register(makeNode('ts-closed', { activeTasks: 0, maxConcurrency: 4 }), { ...closedSocket });
    pool.register(makeNode('ts-ready', { activeTasks: 1, maxConcurrency: 4 }), { ...openSocket });

    const picked = pool.pickNode({ nodeType: 'homelab', capability: 'swarm' });
    expect(picked?.node.id).toBe('ts-ready');
  });

  test('updates load on heartbeat and marks node busy when at maxConcurrency', () => {
    const pool = new RunnerPool();
    pool.register(makeNode('ts-1', { maxConcurrency: 2 }), { ...openSocket });

    const updated = pool.heartbeat('ts-1', { activeTasks: 2 });
    expect(updated?.status).toBe('busy');
    expect(pool.pickNode({ nodeType: 'homelab' })).toBeNull();

    const freed = pool.heartbeat('ts-1', { activeTasks: 1 });
    expect(freed?.status).toBe('online');
    expect(pool.pickNode({ nodeType: 'homelab' })?.node.id).toBe('ts-1');
  });

  test('prunes stale nodes and handles socket disconnect', () => {
    const pool = new RunnerPool();
    const sock1 = { ...openSocket };
    pool.register(makeNode('ts-1'), sock1);
    pool.register(makeNode('ts-2'), { ...openSocket });

    const removedId = pool.removeSocket(sock1);
    expect(removedId).toBe('ts-1');
    expect(pool.getNode('ts-1')?.status).toBe('offline');

    const staleTime = Date.now() + 60_000;
    const offlined = pool.pruneStale(45_000, staleTime);
    expect(offlined).toEqual(['ts-2']);
    expect(pool.getNode('ts-2')?.status).toBe('offline');
  });
});
