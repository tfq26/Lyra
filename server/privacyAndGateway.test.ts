import { describe, expect, test } from 'bun:test';
import { buildSafeSubprocessEnv, isSecretFilePath, redactSecretText } from './security';
import { enforcePrivacyPolicy } from './gatewayLlmProxy';
import { createNativeTools, inferNativeToolGroupsFromPrompt } from './nativeTools';

describe('Lyra Security, Subprocess Isolation & ZDR Policy', () => {
  test('isSecretFilePath blocks .env, keys, and credential dirs', () => {
    expect(isSecretFilePath('.env')).toBe(true);
    expect(isSecretFilePath('sub/.env.local')).toBe(true);
    expect(isSecretFilePath('.aws/credentials')).toBe(true);
    expect(isSecretFilePath('keys/deploy.key')).toBe(true);
    expect(isSecretFilePath('server/gateway.ts')).toBe(false);
  });

  test('redactSecretText scrubs tokens, AWS keys, and private keys', () => {
    const raw = 'token=abc12345 AKIA1234567890ABCDEF sk-ant-api03-1234567890abcdefghij';
    const clean = redactSecretText(raw);
    expect(clean).not.toContain('abc12345');
    expect(clean).not.toContain('AKIA1234567890ABCDEF');
    expect(clean).not.toContain('sk-ant-api03-1234567890abcdefghij');
  });

  test('buildSafeSubprocessEnv does not leak server secrets', () => {
    const prev = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-should-not-leak-to-child';
    try {
      const env = buildSafeSubprocessEnv('/tmp');
      expect(env.OPENROUTER_API_KEY).toBeUndefined();
      expect(env.PATH).toBeTruthy();
    } finally {
      if (prev === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = prev;
    }
  });

  test('enforcePrivacyPolicy enforces zdr and local-only rules', () => {
    expect(() =>
      enforcePrivacyPolicy({
        privacyMode: 'zdr',
        provider: 'openrouter',
        modelId: 'meta/muse-spark-1.3',
      })
    ).toThrow(/blocks contributor\/training model/);

    expect(() =>
      enforcePrivacyPolicy({
        privacyMode: 'local-only',
        provider: 'bedrock',
        modelId: 'us.amazon.nova-2-pro-v1:0',
      })
    ).toThrow(/local-only/);

    expect(() =>
      enforcePrivacyPolicy({
        privacyMode: 'local-only',
        provider: 'openai-compat',
        modelId: 'qwen2.5-coder:14b',
        baseUrl: 'http://127.0.0.1:11434/v1',
      })
    ).not.toThrow();

    expect(() =>
      enforcePrivacyPolicy({
        privacyMode: 'zdr',
        provider: 'bedrock',
        modelId: 'us.anthropic.claude-sonnet-5-5',
      })
    ).not.toThrow();
  });

  test('inferNativeToolGroupsFromPrompt loads minimal tool groups', () => {
    expect(inferNativeToolGroupsFromPrompt('Explain how auth works')).toEqual(['core']);
    expect(inferNativeToolGroupsFromPrompt('Run tests and check git diff')).toEqual(['core', 'git', 'execution']);

    const coreOnly = createNativeTools('/tmp', { toolGroups: ['core'] });
    expect(coreOnly.length).toBe(7);
  });
});
