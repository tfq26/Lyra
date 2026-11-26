import { describe, expect, test } from 'bun:test';
import { buildScheduledSyncRequest, runScheduledModelSync, summarizeSyncReport } from './scheduledSync';

const report = {
  dryRun: false,
  providers: [
    {
      provider: 'openrouter',
      ok: true,
      newCandidates: [{ registered: true }, { registered: false }],
      priceChanges: [{ status: 'applied' }, { status: 'held' }, { status: 'cleared' }],
    },
    { provider: 'bedrock', ok: true, newCandidates: [], priceChanges: [{ status: 'held' }] },
  ],
  supersessions: [{ modelId: 'a' }],
  errors: [],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('scheduled model sync', () => {
  test('sends one authenticated apply request for all three providers', async () => {
    const request = buildScheduledSyncRequest({ LYRA_GATEWAY_API_KEY: 'secret-key' });
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe('/api/gateway/llm/models/sync');
    expect(request.headers.get('Authorization')).toBe('Bearer secret-key');
    expect(await request.json()).toEqual({ apply: true, providers: ['openrouter', 'bedrock', 'foundry'] });
  });

  test('refuses to run without the gateway key, without leaking anything', () => {
    expect(() => buildScheduledSyncRequest({})).toThrow(/LYRA_GATEWAY_API_KEY is not set/);
  });

  test('summarizes the report into counts', () => {
    expect(summarizeSyncReport(report)).toEqual({
      providers: [
        { provider: 'openrouter', ok: true, newCandidates: 1, applied: 2, held: 1 },
        { provider: 'bedrock', ok: true, newCandidates: 0, applied: 0, held: 1 },
      ],
      supersessions: 1,
      errors: 0,
    });
  });

  test('logs the summary and never logs the key', async () => {
    const lines: string[] = [];
    const summary = await runScheduledModelSync(async () => json(report), { LYRA_GATEWAY_API_KEY: 'secret-key' }, (m) => lines.push(m));
    expect(summary.providers).toHaveLength(2);
    expect(lines.join('\n')).toContain('Scheduled sync');
    expect(lines.join('\n')).not.toContain('secret-key');
  });

  test('a busy sync is skipped quietly, not treated as a failure', async () => {
    const lines: string[] = [];
    const summary = await runScheduledModelSync(async () => json({ error: 'busy' }, 409), { LYRA_GATEWAY_API_KEY: 'k' }, (m) => lines.push(m));
    expect(summary.providers).toEqual([]);
    expect(lines[0]).toContain('already running');
  });

  test('fails loudly on HTTP errors, failed providers, or sync errors so the cron run shows as failed', async () => {
    const env = { LYRA_GATEWAY_API_KEY: 'k' };
    await expect(runScheduledModelSync(async () => json({ error: 'nope' }, 403), env, () => {})).rejects.toThrow(/HTTP 403/);
    const failed = { ...report, providers: [{ provider: 'bedrock', ok: false, error: 'HTTP 503', newCandidates: [], priceChanges: [] }] };
    await expect(runScheduledModelSync(async () => json(failed), env, () => {})).rejects.toThrow(/providers: bedrock/);
    await expect(runScheduledModelSync(async () => json({ ...report, errors: ['price x: boom'] }), env, () => {})).rejects.toThrow(/errors: 1/);
  });
});
