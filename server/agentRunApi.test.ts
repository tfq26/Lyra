import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import { AgentRunApi, assertSafeWebhookUrl } from './agentRunApi';
import { OpenAiCompatBridge } from './openaiCompatBridge';
import { ProjectRegistry } from './projectRegistry';

function createMockRes() {
  const res: any = {
    statusCode: 200,
    headers: {},
    body: '',
    writeHead(status: number, headers: Record<string, string> = {}) {
      res.statusCode = status;
      res.headers = headers;
    },
    end(chunk = '') {
      res.body += chunk;
    },
  };
  return res;
}

describe('AgentRunApi & OpenAiCompatBridge', () => {
  test('authenticates project key, namespaces session, and returns structured JSON', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyra-agent-api-'));
    const registry = new ProjectRegistry(path.join(tmpDir, 'projects.json'));
    const { project, apiKey } = registry.createProject({ name: 'Analytics App', defaultPolicyProfile: 'balanced' });

    const seenCalls: any[] = [];
    const mockAhp: any = {
      async executeChatTurn(params: any) {
        seenCalls.push(params);
        return {
          content: '```json\n{"summary":"ok","score":98}\n```',
          route: { modelId: 'us.anthropic.claude-sonnet-4-5' },
          telemetry: { inputTokens: 50, outputTokens: 25, estimatedCostUsd: 0.002 },
        };
      },
    };

    const api = new AgentRunApi(mockAhp, registry);

    // Rejects missing key
    const unauthRes = createMockRes();
    await api.handleCreateRun({ headers: {} } as any, unauthRes, { prompt: 'hello' });
    expect(unauthRes.statusCode).toBe(401);

    // Executes sync structured run
    const okRes = createMockRes();
    await api.handleCreateRun(
      { headers: { authorization: `Bearer ${apiKey}` } } as any,
      okRes,
      {
        prompt: 'Analyze metrics',
        capability: 'agent',
        sessionId: 'user-42',
        responseFormat: {
          type: 'json_schema',
          json_schema: { name: 'report', schema: { type: 'object', properties: { summary: { type: 'string' }, score: { type: 'number' } } } },
        },
      }
    );

    expect(okRes.statusCode).toBe(200);
    const parsed = JSON.parse(okRes.body);
    expect(parsed.status).toBe('completed');
    expect(parsed.sessionId).toBe(`${project.id}:user-42`);
    expect(parsed.structuredOutput).toEqual({ summary: 'ok', score: 98 });
    expect(seenCalls[0].prompt).toContain('JSON Schema');

    // OpenAI compat bridge also enforces project key & normalizes JSON
    const bridge = new OpenAiCompatBridge(mockAhp, registry);
    const compatRes = createMockRes();
    await bridge.handleChatCompletions(
      { headers: { 'x-lyra-project': apiKey } } as any,
      compatRes,
      {
        messages: [{ role: 'user', content: 'Return json' }],
        response_format: { type: 'json_object' },
      }
    );
    expect(compatRes.statusCode).toBe(200);
    const compatBody = JSON.parse(compatRes.body);
    expect(compatBody.choices[0].message.content).toBe('{"summary":"ok","score":98}');

    // OpenAI compat bridge enforces auth when no project key & admin check returns false
    const lockedBridge = new OpenAiCompatBridge(mockAhp, registry, async () => false);
    const rejectedRes = createMockRes();
    await lockedBridge.handleChatCompletions({ headers: {} } as any, rejectedRes, {
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(rejectedRes.statusCode).toBe(401);

    // SSRF protection blocks AWS IMDS, loopback, and Tailscale IPs
    expect(() => assertSafeWebhookUrl('https://169.254.169.254/latest/meta-data')).toThrow();
    expect(() => assertSafeWebhookUrl('https://127.0.0.1:3001/hook')).toThrow();
    expect(() => assertSafeWebhookUrl('https://100.64.0.5/hook')).toThrow();
    expect(() => assertSafeWebhookUrl('http://example.com/hook')).toThrow();
    expect(assertSafeWebhookUrl('https://example.com/webhook')).toBe('https://example.com/webhook');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
