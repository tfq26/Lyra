import { describe, it, expect, afterAll } from 'bun:test';
import { UnifiedStore } from './unifiedStore';
import path from 'path';
import fs from 'fs';

describe('UnifiedStore', () => {
  const testStorageDir = path.join(process.cwd(), '.test-lyra-store');
  const store = new UnifiedStore(testStorageDir);

  afterAll(() => {
    try {
      if (fs.existsSync(testStorageDir)) {
        fs.rmSync(testStorageDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it('creates and retrieves a session with drafts and mode', () => {
    const sessionId = `test-sess-${Date.now()}`;
    const session = store.createSession({
      id: sessionId,
      title: 'Test Session',
      workspacePath: process.cwd(),
      activeAgents: ['antigravity', 'codex'],
    });

    expect(session.id).toBe(sessionId);
    expect(session.title).toBe('Test Session');

    // Update session meta with draft and mode
    const updated = store.updateSessionMeta(sessionId, {
      draft: 'Draft content in progress',
      mode: 'solo',
    });

    expect(updated.draft).toBe('Draft content in progress');
    expect(updated.mode).toBe('solo');

    const fetched = store.getSession(sessionId);
    expect(fetched).not.toBeNull();
    expect(fetched?.meta.draft).toBe('Draft content in progress');
    expect(fetched?.meta.mode).toBe('solo');

    // Clean up
    store.deleteSession(sessionId);
    expect(store.getSession(sessionId)).toBeNull();
  });

  it('excludes legacy agy- and codex- directories from listSessions', () => {
    const agyId = `agy-legacy-${Date.now()}`;
    const codexId = `codex-cache-${Date.now()}`;
    store.createSession({ id: agyId, title: 'Old Antigravity Chat', workspacePath: process.cwd() });
    store.createSession({ id: codexId, title: 'Codex Cache', workspacePath: process.cwd() });

    const listed = store.listSessions();
    expect(listed.some((s) => s.id === agyId)).toBe(false);
    expect(listed.some((s) => s.id === codexId)).toBe(false);

    store.deleteSession(agyId);
    store.deleteSession(codexId);
  });

  it('appends and loads events reliably', () => {
    const sessionId = `test-events-${Date.now()}`;
    store.createSession({
      id: sessionId,
      title: 'Event Test',
      workspacePath: process.cwd(),
    });

    const ev1 = store.appendEvent(sessionId, {
      agent: 'user',
      type: 'message',
      payload: { text: 'Hello Lyra' },
    });

    const ev2 = store.appendEvent(sessionId, {
      agent: 'codex',
      type: 'thought',
      payload: { text: 'Analyzing repository...' },
      runId: 'run-123',
    });

    const data = store.getSession(sessionId);
    expect(data?.events.length).toBe(2);
    expect(data?.events[0]?.type).toBe('message');
    expect(data?.events[1]?.type).toBe('thought');
    expect(data?.events[1]?.runId).toBe('run-123');
    expect(ev1.sequence).toBe(1);
    expect(ev2.sequence).toBe(2);

    // Clean up
    store.deleteSession(sessionId);
  });

  it('saves reusable harness profiles without persisting supplied credential fields', () => {
    const profile = store.saveHarnessProfile({
      name: 'OpenCode team default',
      harness: 'opencode',
      enabled: true,
      model: 'amazon-bedrock/anthropic.claude-haiku',
      ...( { apiKey: 'must-not-be-stored' } as any ),
    });
    expect(store.listHarnessProfiles().some((item) => item.id === profile.id)).toBe(true);
    const raw = fs.readFileSync(path.join(testStorageDir, 'harness-profiles.json'), 'utf8');
    expect(raw).not.toContain('must-not-be-stored');
    expect(store.deleteHarnessProfile(profile.id)).toBe(true);
  });

  it('persists Bedrock model profiles as role references without accepting static AWS keys', () => {
    const profile = store.saveModelProviderProfile({
      name: 'Low-cost planner', provider: 'bedrock', credentialMode: 'byo', region: 'us-east-1', model: 'us.amazon.nova-micro-v1:0',
      roleArn: 'arn:aws:iam::123456789012:role/LyraBedrock', secretRef: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:lyra/provider/ref',
      ...( { accessKeyId: 'must-not-be-stored', secretAccessKey: 'must-not-be-stored' } as any ),
    });
    expect(store.listModelProviderProfiles().find((item) => item.id === profile.id)?.model).toBe(profile.model);
    const raw = fs.readFileSync(path.join(testStorageDir, 'model-provider-profiles.json'), 'utf8');
    expect(raw).not.toContain('must-not-be-stored');
    expect(raw).not.toContain('lyra-team-tenant-42');
    expect(store.deleteModelProviderProfile(profile.id)).toBe(true);
  });

  it('persists ordered native-agent checkpoints and finds interrupted runs after restart', () => {
    const session = store.createSession({ title: 'Native agent recovery', workspacePath: testStorageDir });
    const started = store.saveAgentCheckpoint({ sessionId: session.id, runId: 'native-run-1', checkpointId: 'cp-start', kind: 'turn-started', workspacePath: testStorageDir, state: 'running' });
    const approval = store.saveAgentCheckpoint({ sessionId: session.id, runId: 'native-run-1', checkpointId: 'approval-1', kind: 'approval-requested', workspacePath: testStorageDir, state: 'paused', detail: 'Run a verification command?' });
    expect(approval.sequence).toBe(started.sequence + 1);
    expect(store.getLatestAgentCheckpoint(session.id, 'native-run-1')?.checkpointId).toBe('approval-1');
    expect(store.listInterruptedAgentRuns().some((checkpoint) => checkpoint.runId === 'native-run-1' && checkpoint.state === 'paused')).toBe(true);
    expect(store.getSession(session.id)?.events.at(-1)?.payload).toMatchObject({ agentCheckpoint: { kind: 'approval-requested', sequence: approval.sequence } });
  });
});
