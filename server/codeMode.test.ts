import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalCloudProvider } from './cloud/providers/local';
import { LyraCodeMode } from './codeMode';

describe('LyraCodeMode (Isolated Worker Sandbox)', () => {
  test('search() returns filtered TypeScript SDK declarations', () => {
    const local = new LocalCloudProvider();
    const cm = new LyraCodeMode(local);

    const dbDocs = cm.search('db');
    expect(dbDocs.namespaces).toContain('lyra.db');
    expect(dbDocs.sdkDeclarations).toContain('queryReadOnly');

    const allDocs = cm.search();
    expect(allDocs.namespaces.length).toBeGreaterThanOrEqual(5);
  });

  test('execute() runs isolated scripts with lyra.db and lyra.storage and blocks ambient globals', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyra-codemode-test-'));
    const local = new LocalCloudProvider({ blobDir: tmpDir });
    const cm = new LyraCodeMode(local);

    try {
      const res = await cm.execute(
        `
        const hasProcess = typeof process !== 'undefined';
        const hasFetch = typeof fetch !== 'undefined';
        const hasBun = typeof Bun !== 'undefined';

        await lyra.db.scratchpadSet('run-1', 'step', { count: 42 });
        const tables = await lyra.db.listTables();
        await lyra.storage.putArtifact('notes/hello.txt', 'hello from codemode');
        const artifact = await lyra.storage.getArtifactText('notes/hello.txt');

        return { hasProcess, hasFetch, hasBun, hasScratchpad: tables.includes('lyra_scratchpad'), artifact };
        `,
        { tenantId: 'tenant-a' }
      );

      expect(res.success).toBe(true);
      expect(res.returnValue).toEqual({
        hasProcess: false,
        hasFetch: false,
        hasBun: false,
        hasScratchpad: true,
        artifact: 'hello from codemode',
      });
    } finally {
      await local.database.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('execute() blocks mutating SQL in queryReadOnly and redacts secrets in outputs', async () => {
    const local = new LocalCloudProvider();
    const cm = new LyraCodeMode(local);

    try {
      const badSql = await cm.execute(`return await lyra.db.queryReadOnly('DROP TABLE lyra_events')`);
      expect(badSql.success).toBe(false);
      expect(badSql.error).toContain('read-only');

      const redacted = await cm.execute(`
        console.log('token=ghp_1234567890abcdefghij1234567890abcdef');
        return { key: 'AKIAIOSFODNN7EXAMPLE' };
      `);
      expect(redacted.success).toBe(true);
      expect(JSON.stringify(redacted)).not.toContain('AKIAIOSFODNN7EXAMPLE');
      expect(JSON.stringify(redacted)).not.toContain('ghp_1234567890abcdefghij1234567890abcdef');
    } finally {
      await local.database.close();
    }
  });
});
