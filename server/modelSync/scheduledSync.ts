/**
 * The daily model sync, run from a Cloudflare Cron Trigger.
 *
 * The hub's container sleeps after 30 minutes idle, so an in-process timer cannot be relied on. The Worker's
 * `scheduled()` handler instead sends one authenticated request to the container's sync endpoint, which wakes
 * it. The sync keeps its usual guards: price changes over 50% are held, new models arrive as hidden unscored
 * candidates, and removals and retirements are capped.
 *
 * This file imports nothing from Cloudflare so it can be tested directly.
 */

export const SCHEDULED_SYNC_PROVIDERS = ['openrouter', 'bedrock', 'foundry'] as const;
const SYNC_PATH = '/api/gateway/llm/models/sync';

export interface ScheduledSyncEnv {
  LYRA_GATEWAY_API_KEY?: string;
}

export interface ScheduledSyncSummary {
  providers: Array<{ provider: string; ok: boolean; newCandidates: number; applied: number; held: number; error?: string }>;
  supersessions: number;
  errors: number;
}

export function buildScheduledSyncRequest(env: ScheduledSyncEnv, origin = 'https://lyra.2helix.org'): Request {
  const key = env.LYRA_GATEWAY_API_KEY;
  if (!key) throw new Error('LYRA_GATEWAY_API_KEY is not set on the Worker; the scheduled model sync cannot authenticate');
  return new Request(`${origin}${SYNC_PATH}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ apply: true, providers: [...SCHEDULED_SYNC_PROVIDERS] }),
  });
}

export function summarizeSyncReport(report: any): ScheduledSyncSummary {
  const providers = Array.isArray(report?.providers) ? report.providers : [];
  return {
    providers: providers.map((p: any) => {
      const changes: Array<{ status?: string }> = Array.isArray(p.priceChanges) ? p.priceChanges : [];
      return {
        provider: String(p.provider),
        ok: p.ok === true,
        newCandidates: Array.isArray(p.newCandidates) ? p.newCandidates.filter((c: any) => c.registered).length : 0,
        applied: changes.filter((c) => c.status === 'applied' || c.status === 'cleared').length,
        held: changes.filter((c) => c.status === 'held').length,
        ...(p.error || p.aborted ? { error: String(p.error ?? p.aborted) } : {}),
      };
    }),
    supersessions: Array.isArray(report?.supersessions) ? report.supersessions.length : 0,
    errors: Array.isArray(report?.errors) ? report.errors.length : 0,
  };
}

/**
 * Runs the sync through `send` (the container's fetch). Throws when the sync could not run or any provider
 * failed, so the failed cron invocation is visible in Cloudflare; the summary is logged either way.
 */
export async function runScheduledModelSync(
  send: (request: Request) => Promise<Response>,
  env: ScheduledSyncEnv,
  log: (message: string) => void = console.log
): Promise<ScheduledSyncSummary> {
  const response = await send(buildScheduledSyncRequest(env));
  if (response.status === 409) {
    log('[Lyra Models] Scheduled sync skipped: another sync is already running.');
    return { providers: [], supersessions: 0, errors: 0 };
  }
  if (!response.ok) throw new Error(`Scheduled model sync failed: HTTP ${response.status}`);

  const summary = summarizeSyncReport(await response.json());
  log(`[Lyra Models] Scheduled sync: ${JSON.stringify(summary)}`);
  const failed = summary.providers.filter((p) => !p.ok).map((p) => p.provider);
  if (failed.length > 0 || summary.errors > 0) {
    throw new Error(`Scheduled model sync finished with problems (providers: ${failed.join(', ') || 'none'}, errors: ${summary.errors})`);
  }
  return summary;
}
