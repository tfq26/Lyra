import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeBetterAuth, type LyraBetterAuthRuntime } from './betterAuth';

const ENV_KEYS = [
  'LYRA_HOSTED',
  'LYRA_SES_FROM_EMAIL',
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'DATABASE_URL',
  'LYRA_POSTGRES_HOST',
  'PGHOST',
];

describe('Better Auth hardening', () => {
  const originalCwd = process.cwd();
  const savedEnv: Record<string, string | undefined> = {};
  let tmpDir = '';
  let runtime: LyraBetterAuthRuntime | null = null;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    // initializeBetterAuth writes server/data relative to cwd; keep it out of the repo.
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyra-auth-test-'));
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    await runtime?.close();
    runtime = null;
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  test('hosted mode refuses to start without BETTER_AUTH_SECRET', async () => {
    process.env.LYRA_HOSTED = 'true';
    await expect(initializeBetterAuth()).rejects.toThrow('BETTER_AUTH_SECRET');
  });

  test('local fallback secret is generated from crypto randomness and persisted', async () => {
    runtime = await initializeBetterAuth();
    const secret = fs.readFileSync(path.join(tmpDir, 'server/data/.auth-secret'), 'utf8').trim();
    expect(secret).toMatch(/^lyra_[0-9a-f]{64}$/);
  });

  test('account linking does not bypass local email verification', async () => {
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(40);
    runtime = await initializeBetterAuth();
    const linking = (runtime!.auth.options as any).account?.accountLinking;
    expect(linking?.enabled).toBe(true);
    expect(linking?.requireLocalEmailVerified).not.toBe(false);
  });

  test('minimum password length is at least 8', async () => {
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(40);
    runtime = await initializeBetterAuth();
    expect((runtime!.auth.options as any).emailAndPassword.minPasswordLength).toBeGreaterThanOrEqual(8);
  });

  test('hosted mode without SES never logs reset links', async () => {
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(40);
    process.env.LYRA_HOSTED = 'true';
    const info = spyOn(console, 'info').mockImplementation(() => {});
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const log = spyOn(console, 'log').mockImplementation(() => {});
    try {
      runtime = await initializeBetterAuth();
      info.mockClear();
      warn.mockClear();
      log.mockClear();
      const url = 'https://lyra.example/reset?token=SECRET-TOKEN';
      await (runtime!.auth.options as any).emailAndPassword.sendResetPassword({ user: { email: 'a@b.co' }, url });
      const output = [...info.mock.calls, ...warn.mock.calls, ...log.mock.calls].flat().join(' ');
      expect(output).not.toContain('SECRET-TOKEN');
      expect(warn).toHaveBeenCalled();
    } finally {
      info.mockRestore();
      warn.mockRestore();
      log.mockRestore();
    }
  });

  test('local dev still prints reset links for convenience', async () => {
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(40);
    const info = spyOn(console, 'info').mockImplementation(() => {});
    const log = spyOn(console, 'log').mockImplementation(() => {});
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      runtime = await initializeBetterAuth();
      info.mockClear();
      const url = 'http://localhost:3001/reset?token=DEV-TOKEN';
      await (runtime!.auth.options as any).emailAndPassword.sendResetPassword({ user: { email: 'a@b.co' }, url });
      expect(info.mock.calls.flat().join(' ')).toContain('DEV-TOKEN');
    } finally {
      info.mockRestore();
      log.mockRestore();
      warn.mockRestore();
    }
  });
});
