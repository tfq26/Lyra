import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCloudProviderFromEnv } from './registry';
import { LocalCloudProvider } from './providers/local';

describe('Cloud provider abstraction & hybrid registry', () => {
  test('LocalCloudProvider supports FIFO queue, deduplication, pubsub, and blob storage', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyra-cloud-test-'));
    try {
      const local = new LocalCloudProvider({ blobDir: tmpDir });

      const first = await local.queue.enqueue('sync', {
        groupId: 'sess-1',
        deduplicationId: 'msg-1',
        payload: { text: 'hello' },
      });
      const dup = await local.queue.enqueue('sync', {
        groupId: 'sess-1',
        deduplicationId: 'msg-1',
        payload: { text: 'hello' },
      });
      expect(dup.messageId).toBe('dedup-msg-1');

      const msgs = await local.queue.receive<{ text: string }>('sync');
      expect(msgs.length).toBe(1);
      expect(msgs[0]?.id).toBe(first.messageId);
      await local.queue.ack('sync', msgs[0]!.receiptHandle!);
      expect((await local.queue.receive('sync')).length).toBe(0);

      const received: string[] = [];
      const unsub = local.pubsub.subscribe<{ text: string }>('user-1', (e) => received.push(e.payload.text));
      await local.pubsub.publish('user-1', 'chat_delta', { text: 'ping' });
      unsub();
      expect(received).toEqual(['ping']);

      await local.storage.putObject('artifacts/test.txt', 'hello-blob');
      const data = await local.storage.getObject('artifacts/test.txt');
      expect(new TextDecoder().decode(data!)).toBe('hello-blob');
      await local.storage.deleteObject('artifacts/test.txt');
      expect(await local.storage.getObject('artifacts/test.txt')).toBeNull();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('createCloudProviderFromEnv supports hybrid per-capability overrides', async () => {
    const hybrid = createCloudProviderFromEnv({
      LYRA_CLOUD_PROVIDER: 'local',
      LYRA_STORAGE_PROVIDER: 'cloudflare',
      LYRA_QUEUE_PROVIDER: 'azure',
      LYRA_SANDBOX_PROVIDER: 'aws',
      LYRA_DATABASE_PROVIDER: 'cloudflare',
    });

    expect(hybrid.id).toBe('local');
    expect(hybrid.pubsub.provider).toBe('local');
    expect(hybrid.storage.provider).toBe('cloudflare');
    expect(hybrid.queue.provider).toBe('azure');
    expect(hybrid.sandbox.provider).toBe('aws');
    expect(hybrid.database.provider).toBe('cloudflare');
    expect(hybrid.database.engine).toBe('sqlite');
  });

  test('LocalCloudProvider database supports initialization, queries, and branching', async () => {
    const local = new LocalCloudProvider();
    await local.database.initialize();
    const tables = await local.database.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'lyra_scratchpad'`
    );
    expect(tables.length).toBe(1);

    const branch = await local.database.createBranch!('run-test-1');
    expect(branch.engine).toBe('sqlite');
    expect(branch.connectionInfo).toBeTruthy();
    await local.database.deleteBranch!('run-test-1');
    await local.database.close();
  });
});
