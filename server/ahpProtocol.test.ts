import { describe, it, expect, beforeEach } from 'bun:test';
import { AHPServer } from './ahpProtocol';
import { UnifiedStore } from './unifiedStore';

describe('AHPServer (Agent Host Protocol v1.0) Cloud Sessions', () => {
  let store: UnifiedStore;
  let ahp: AHPServer;

  beforeEach(() => {
    store = new UnifiedStore('/tmp/lyra-ahp-cloud-' + Date.now());
    ahp = new AHPServer(store);
  });

  it('creates a new cloud session and lists it across devices', () => {
    const session = ahp.createSession({
      title: 'Real-time CRDT Engine',
      workspacePath: '/Users/taufeeqali/Projects/CollabCanvas',
      model: 'claude-3-5-sonnet',
    });

    expect(session.sessionId).toBeDefined();
    expect(session.title).toBe('Real-time CRDT Engine');

    const res = ahp.handleRpc({
      id: 1,
      method: 'ahp/sessions/list',
    });

    expect(res.jsonrpc).toBe('2.0');
    expect(res.result?.sessions.some((s: any) => s.sessionId === session.sessionId)).toBe(true);
  });

  it('appends messages and retrieves full session transcript', () => {
    const session = ahp.createSession({ title: 'Autonomous QA Test' });

    ahp.appendMessage(session.sessionId, {
      role: 'user',
      content: 'Write unit tests for the spatial quadtree',
    });

    ahp.appendMessage(session.sessionId, {
      role: 'assistant',
      content: 'I have added 8 unit tests in `src/utils/__tests__/quadtree.test.ts`.',
      thinking: 'Analyzed bounds splitting and node insertion invariants.',
    });

    const res = ahp.handleRpc({
      id: 2,
      method: 'ahp/sessions/get',
      params: { sessionId: session.sessionId },
    });

    expect(res.result?.meta.sessionId).toBe(session.sessionId);
    expect(res.result?.messages.length).toBe(2);
    expect(res.result?.messages[0].content).toContain('spatial quadtree');
    expect(res.result?.messages[1].thinking).toContain('Analyzed bounds splitting');
  });

  it('returns clean error on unknown RPC method', () => {
    const res = ahp.handleRpc({
      id: 3,
      method: 'invalid/method',
    });

    expect(res.error).toBeDefined();
    expect(res.error?.code).toBe(-32601);
  });
});
