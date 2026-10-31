import { afterAll, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UnifiedStore } from './unifiedStore';
import { NativeAgentRuntime } from './nativeAgentRuntime';

describe('native agent compatibility gate', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lyra-native-runtime-'));
  const store = new UnifiedStore(directory);
  const session = store.createSession({ title: 'Native runtime gate', workspacePath: directory });
  afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));

  it('requires a saved provider connection and compatibility result before agent startup', async () => {
    const runtime = new NativeAgentRuntime(store);
    await expect(runtime.run({ sessionId: session.id, runId: 'native-missing', prompt: 'inspect', workspacePath: directory, providerProfileId: 'missing' })).rejects.toThrow('Choose a saved');

    const profile = store.saveModelProviderProfile({ name: 'Limited OpenRouter', provider: 'openrouter', model: 'sample/model' });
    store.saveModelCompatibility(profile.id, {
      profileId: profile.id,
      provider: 'openrouter',
      model: profile.model,
      tier: 'limited',
      capabilities: {
        streaming: { passed: true },
        toolCalling: { passed: false, detail: 'Tool call was not returned.' },
        structuredOutput: { passed: false },
        cancellation: { passed: true },
        sessionResume: { passed: true },
      },
      testedAt: new Date().toISOString(),
      suiteVersion: 'test',
      warnings: ['toolCalling failed'],
    });
    await expect(runtime.run({ sessionId: session.id, runId: 'native-limited', prompt: 'inspect', workspacePath: directory, providerProfileId: profile.id })).rejects.toThrow('toolCalling');
  });
});
