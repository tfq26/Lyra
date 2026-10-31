import { afterAll, afterEach, describe, expect, it } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AgentConfig } from '@strands-agents/sdk';
import { Agent } from '@strands-agents/sdk';
import type { ModelProviderProfile } from './types';
import { BedrockProvider } from './bedrockProvider';

describe('Strands Bedrock planner', () => {
  const previousHosted = process.env.LYRA_HOSTED;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyra-bedrock-test-'));
  afterAll(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  afterEach(() => {
    if (previousHosted === undefined) delete process.env.LYRA_HOSTED;
    else process.env.LYRA_HOSTED = previousHosted;
  });

  it('builds a persisted Strands agent with read-only project tools and customer-assumed Bedrock credentials', async () => {
    fs.mkdirSync(path.join(tempDir, 'src'));
    fs.writeFileSync(path.join(tempDir, 'README.md'), 'Lyra project fixture');
    fs.writeFileSync(path.join(tempDir, 'src', 'main.ts'), 'export const lyra = true;');
    fs.writeFileSync(path.join(tempDir, '.env'), 'SECRET=do-not-read');
    process.env.LYRA_HOSTED = 'true';
    let capturedConfig: AgentConfig | undefined;
    let assumedRole = '';
    const provider = new BedrockProvider({
      assumeRole: async (profile: ModelProviderProfile) => {
        assumedRole = profile.roleArn || '';
        return { accessKeyId: 'temporary-access', secretAccessKey: 'temporary-secret', sessionToken: 'temporary-session' };
      },
      invoke: async (config: AgentConfig) => {
        capturedConfig = config;
        await new Agent(config).initialize();
        return {
          text: '{"acceptanceCriteria":["the planner can inspect the project"],"tasks":[{"title":"Plan","description":"Read the project"}],"checks":[]}',
          usage: { promptTokens: 123, completionTokens: 45, totalTokens: 168 },
        };
      },
    });
    const result = await provider.generate({
      id: 'provider-test', name: 'planner', provider: 'bedrock', region: 'us-east-1',
      model: 'us.amazon.nova-micro-v1:0', roleArn: 'arn:aws:iam::123456789012:role/LyraBedrock',
      externalId: 'lyra-test-tenant', createdAt: '', updatedAt: '',
    }, 'Create a plan', { sessionId: 'conversation-1', runId: 'run-1', workspacePath: tempDir, storagePath: tempDir });

    expect(result.text).toContain('acceptanceCriteria');
    expect(result.usage).toEqual({ promptTokens: 123, completionTokens: 45, totalTokens: 168 });
    expect(assumedRole).toContain('LyraBedrock');
    expect(capturedConfig?.tools).toHaveLength(2);
    expect(capturedConfig?.sessionManager).toBeDefined();
    expect(capturedConfig?.systemPrompt).toContain('read-only');
  });
});
