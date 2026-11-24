import { describe, expect, it, beforeEach, afterAll } from 'bun:test';
import path from 'node:path';
import fs from 'node:fs';
import { LyraHarnessGateway, GatewayRateLimiter } from './gateway';
import { UnifiedStore } from './unifiedStore';

describe('Lyra Secure API Gateway & Harness Integration', () => {
  let store: UnifiedStore;
  let gateway: LyraHarnessGateway;
  const testStoreDir = path.join(process.cwd(), '.bun-temp', `store-gw-${Date.now()}`);
  const apiKey = 'test-secret-gateway-key-12345';

  beforeEach(() => {
    store = new UnifiedStore(testStoreDir);
    gateway = new LyraHarnessGateway(store, undefined, {
      apiKey,
      maxRequestsPerWindow: 5,
      rateLimitWindowMs: 1000,
    });
  });

  afterAll(() => {
    if (fs.existsSync(testStoreDir)) {
      fs.rmSync(testStoreDir, { recursive: true, force: true });
    }
  });

  describe('Authentication & Timing-Safe Verification', () => {
    it('approves exact valid API key', () => {
      expect(gateway.verifyAuth(apiKey)).toBe(true);
    });

    it('rejects invalid or missing API key', () => {
      expect(gateway.verifyAuth('wrong-key')).toBe(false);
      expect(gateway.verifyAuth('')).toBe(false);
      expect(gateway.verifyAuth(undefined)).toBe(false);
    });

    it('verifyAdminKey accepts only the gateway API key, not user session tokens', () => {
      (gateway as any).userTokens.set('lyra-pat-user-session', {
        email: 'user@example.com',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      });

      expect(gateway.verifyAuth('lyra-pat-user-session')).toBe(true);
      expect(gateway.verifyAdminKey('lyra-pat-user-session')).toBe(false);
      expect(gateway.verifyAdminKey(apiKey)).toBe(true);
      expect(gateway.verifyAdminKey('wrong-key')).toBe(false);
      expect(gateway.verifyAdminKey('')).toBe(false);
      expect(gateway.verifyAdminKey(undefined)).toBe(false);
    });
  });

  describe('Rate Limiter', () => {
    it('allows requests within threshold and blocks excess with 429 semantics', () => {
      const limiter = new GatewayRateLimiter(3, 1000);
      const client = 'harness-antigravity';

      expect(limiter.check(client).allowed).toBe(true);
      expect(limiter.check(client).allowed).toBe(true);
      expect(limiter.check(client).allowed).toBe(true);

      // 4th request exceeds threshold!
      const blocked = limiter.check(client);
      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0);
      expect(blocked.resetMs).toBeGreaterThan(0);
    });
  });

  describe('Autonomous Task Dispatching', () => {
    it('creates session and initializes run in store', async () => {
      const res = await gateway.dispatchTask({
        objective: 'Implement biometric auth in Duit iOS',
        workspacePath: '/Users/taufeeqali/Projects/Duit',
      });

      expect(res.sessionId).toContain('session-harness-');
      expect(res.runId).toContain('run-harness-');
      expect(res.status).toBe('dispatched');

      const session = store.getSession(res.sessionId);
      expect(session).toBeDefined();
      expect(session?.meta.title).toContain('Harness Dispatch');
    });
  });

  describe('Local File Context On-Demand Brokering', () => {
    it('allows remote agent to request local file excerpts and local harness to fulfill them', async () => {
      const runId = 'run-test-123';
      let receivedEvent: any = null;

      const unsubscribe = gateway.subscribeRunEvents(runId, (event) => {
        receivedEvent = event;
      });

      // 1. Remote agent requests file snippet
      const ctxReq = gateway.requestFileContext({
        runId,
        filePath: 'apps/ios/Duit/Models/User.swift',
        lineRange: [1, 25],
        reason: 'Need User struct properties to generate API payload',
      });

      expect(ctxReq.status).toBe('pending');
      expect(receivedEvent?.type).toBe('context_required');
      expect(receivedEvent?.request.filePath).toBe('apps/ios/Duit/Models/User.swift');

      // 2. Check pending requests
      const pending = gateway.getPendingRequests(runId);
      expect(pending.contexts.length).toBe(1);

      // 3. Local harness provides file snippet
      const resolved = gateway.provideFileContext(ctxReq.id, 'struct User { let id: String; let name: String }');
      expect(resolved).toBe(true);
      expect(ctxReq.status).toBe('resolved');
      expect(ctxReq.resolvedContent).toContain('struct User');

      // 4. Pending is now empty
      expect(gateway.getPendingRequests(runId).contexts.length).toBe(0);

      unsubscribe();
    });
  });

  describe('Permission Requests & Approval Handshakes', () => {
    it('halts and asks local harness for permission on sensitive actions', () => {
      const runId = 'run-test-456';
      let permEvent: any = null;

      gateway.subscribeRunEvents(runId, (event) => {
        permEvent = event;
      });

      // 1. Remote agent asks permission to push to external branch
      const permReq = gateway.requestPermission({
        runId,
        action: 'git_push',
        resource: 'origin/feat-biometric-auth',
        details: 'Attempting to push newly generated commits for review',
      });

      expect(permReq.status).toBe('pending');
      expect(permEvent?.type).toBe('permission_required');

      // 2. Local harness denies unauthorized action
      const denied = gateway.respondPermission(permReq.id, false, 'User policy: only pull requests allowed');
      expect(denied).toBe(true);
      expect(permReq.status).toBe('denied');
      expect(permReq.denialReason).toBe('User policy: only pull requests allowed');

      // 3. Second permission approved
      const permReq2 = gateway.requestPermission({
        runId,
        action: 'command_execution',
        resource: 'bun test',
        details: 'Running unit tests in sandbox',
      });
      const approved = gateway.respondPermission(permReq2.id, true);
      expect(approved).toBe(true);
      expect(permReq2.status).toBe('approved');
    });
  });
});
