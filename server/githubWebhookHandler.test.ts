import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { GitHubWebhookHandler, type WebhookEventPayload } from './githubWebhookHandler';
import { LyraHarnessGateway } from './gateway';
import { UnifiedStore } from './unifiedStore';

describe('GitHubWebhookHandler', () => {
  let tempDir: string;
  let store: UnifiedStore;
  let gateway: LyraHarnessGateway;
  let handler: GitHubWebhookHandler;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyra-webhook-test-'));
    store = new UnifiedStore(path.join(tempDir, 'store'));
    gateway = new LyraHarnessGateway(store);
    handler = new GitHubWebhookHandler(gateway, { secret: 'test-secret-123' });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('verifies valid HMAC SHA256 signatures and rejects forged ones', () => {
    const payload = JSON.stringify({ action: 'created' });
    const crypto = require('crypto');
    const validSig = 'sha256=' + crypto.createHmac('sha256', 'test-secret-123').update(payload).digest('hex');

    expect(handler.verifySignature(payload, validSig)).toBe(true);
    expect(handler.verifySignature(payload, 'sha256=forged-signature')).toBe(false);
    expect(handler.verifySignature(payload, undefined)).toBe(false);
  });

  it('dispatches task when /lyra fix command is parsed from PR comment', async () => {
    const payload: WebhookEventPayload = {
      action: 'created',
      issue: {
        number: 42,
        pull_request: {},
      },
      comment: {
        id: 101,
        body: '/lyra fix Add missing error handling for 404 responses',
        user: { login: 'dev-user' },
      },
      repository: {
        name: 'Duit',
        owner: { login: 'tfq26' },
        full_name: 'tfq26/Duit',
      },
    };

    const result = await handler.handleWebhook(payload, { workspacePath: tempDir });
    expect(result.handled).toBe(true);
    expect(result.action).toBe('dispatched_fix');
    expect(result.issueNumber).toBe(42);
    expect(result.runId).toBeDefined();
    expect(result.message).toContain('Swarm dispatched for PR #42');
  });

  it('ignores non-/lyra comments gracefully', async () => {
    const payload: WebhookEventPayload = {
      action: 'created',
      comment: {
        id: 102,
        body: 'Looks good to me! LGTM',
        user: { login: 'dev-user' },
      },
      repository: {
        name: 'Duit',
        owner: { login: 'tfq26' },
        full_name: 'tfq26/Duit',
      },
    };

    const result = await handler.handleWebhook(payload);
    expect(result.handled).toBe(false);
    expect(result.action).toBe('ignored');
  });
});
