import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WebSocketServer } from 'ws';
import { RunnerDaemon } from './runnerDaemon';
import {
  resolveWorkspacePath,
  isSecretName,
  blockedDirectories,
  blockedFiles,
  calculateDirectorySize,
  runProcess,
  killAllActiveProcesses,
} from './nativeTools';

describe('Runner & Host Security Containment', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyra-security-test-'));
  });

  afterEach(() => {
    killAllActiveProcesses();
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  describe('Path Traversal & Secret Protection', () => {
    it('blocks access to sensitive private directories (.ssh, .aws, .config, .gnupg, etc.)', () => {
      expect(blockedDirectories.has('.ssh')).toBe(true);
      expect(blockedDirectories.has('.aws')).toBe(true);
      expect(blockedDirectories.has('.config')).toBe(true);
      expect(blockedDirectories.has('.gnupg')).toBe(true);
      expect(blockedDirectories.has('.kube')).toBe(true);
      expect(blockedDirectories.has('.docker')).toBe(true);
    });

    it('identifies sensitive credential files and private keys', () => {
      expect(isSecretName('id_rsa')).toBe(true);
      expect(isSecretName('id_ed25519')).toBe(true);
      expect(isSecretName('credentials')).toBe(true);
      expect(isSecretName('known_hosts')).toBe(true);
      expect(isSecretName('.env')).toBe(true);
      expect(isSecretName('.env.production')).toBe(true);
      expect(isSecretName('server.key')).toBe(true);
      expect(isSecretName('cert.pem')).toBe(true);
      expect(isSecretName('safe_code.ts')).toBe(false);
    });

    it('strictly forbids path traversal attempting to escape project root', () => {
      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      // Trying to escape via parent directory
      expect(() => resolveWorkspacePath(srcDir, '../outside.txt')).toThrow(/outside the assigned project workspace/);
      expect(() => resolveWorkspacePath(srcDir, '../../../../etc/passwd')).toThrow(/outside the assigned project workspace/);
    });

    it('strictly forbids accessing blocked directories even if inside project root', () => {
      const sshDir = path.join(testDir, '.ssh');
      fs.mkdirSync(sshDir, { recursive: true });

      expect(() => resolveWorkspacePath(testDir, '.ssh/id_rsa')).toThrow(/private or generated project data/);
    });
  });

  describe('Runner Sandbox Jail & Disk Quotas', () => {
    it('asserts and enforces sandbox root boundaries', () => {
      const sandboxesDir = path.join(testDir, 'sandboxes');
      fs.mkdirSync(sandboxesDir, { recursive: true });

      const runner = new RunnerDaemon({
        hubUrl: 'ws://localhost:9999',
        workspacesDir: sandboxesDir,
      });

      // Allowed: Subdirectory inside sandbox
      const validPath = path.join(sandboxesDir, 'session-1', 'run-1');
      expect(runner.assertSandboxBoundary(validPath)).toBe(validPath);

      // Denied: Escaping to host root or another directory
      expect(() => runner.assertSandboxBoundary('/etc')).toThrow(/Security Violation: Target path .* escapes the runner sandbox boundary/);
      expect(() => runner.assertSandboxBoundary('../../other-system-dir')).toThrow(/Security Violation: Target path .* escapes the runner sandbox boundary/);
    });

    it('calculates directory size and enforces disk quota limits', () => {
      const sandboxesDir = path.join(testDir, 'quota-test');
      fs.mkdirSync(sandboxesDir, { recursive: true });

      // Write a 10KB test file
      const dummyFile = path.join(sandboxesDir, 'sample.dat');
      fs.writeFileSync(dummyFile, Buffer.alloc(10 * 1024, 'a'));

      const size = calculateDirectorySize(sandboxesDir);
      expect(size).toBe(10 * 1024);

      // Configure a runner with a tiny 5KB quota
      const runner = new RunnerDaemon({
        hubUrl: 'ws://localhost:9999',
        workspacesDir: sandboxesDir,
        maxDiskQuotaBytes: 5 * 1024, // 5KB limit
      });

      expect(() => runner.checkDiskQuota()).toThrow(/Disk Quota Exceeded/);
    });
  });

  describe('Process Containment & Orphan Process Clean Up', () => {
    it('cleanly terminates process group when cancelled or timed out', async () => {
      const controller = new AbortController();

      // Launch a command that would normally run for 30 seconds
      const startTime = Date.now();
      const processPromise = runProcess('sleep 30', testDir, 10_000, controller.signal);

      // Cancel it after 100ms
      setTimeout(() => {
        controller.abort();
      }, 100);

      const result = await processPromise;
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(2000);
      expect(result).toContain('cancelled');
    });

    it('kills all active processes on runner shutdown', async () => {
      // Spawn two long-running background tasks
      const p1 = runProcess('sleep 20', testDir, 10_000);
      const p2 = runProcess('sleep 20', testDir, 10_000);

      await new Promise((r) => setTimeout(r, 50));

      // Global kill
      killAllActiveProcesses();

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBeDefined();
      expect(r2).toBeDefined();
    });
  });
});
