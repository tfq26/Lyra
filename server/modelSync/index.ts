import { createOpenRouterAdapter } from './openRouterAdapter';
import { runModelSync } from './syncEngine';
import type { ModelSourceAdapter, SyncOptions, SyncReport } from './types';

export * from './types';
export { createOpenRouterAdapter, parseOpenRouterListing } from './openRouterAdapter';
export { runModelSync } from './syncEngine';

/** Providers with a sync adapter today. Bedrock and Foundry plug in here once their adapters exist. */
const ADAPTER_FACTORIES: Record<string, () => ModelSourceAdapter> = {
  openrouter: () => createOpenRouterAdapter(),
};

/** Adapters selected by `LYRA_MODEL_SYNC_PROVIDERS` (comma separated, default `openrouter`). */
export function getConfiguredAdapters(env: NodeJS.ProcessEnv = process.env): { adapters: ModelSourceAdapter[]; unsupported: string[] } {
  const requested = (env.LYRA_MODEL_SYNC_PROVIDERS || 'openrouter')
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  const adapters: ModelSourceAdapter[] = [];
  const unsupported: string[] = [];
  for (const name of new Set(requested)) {
    const factory = ADAPTER_FACTORIES[name];
    if (factory) adapters.push(factory());
    else unsupported.push(name);
  }
  return { adapters, unsupported };
}

let running: Promise<SyncReport> | null = null;

export class ModelSyncBusyError extends Error {
  constructor() {
    super('A model sync is already running');
    this.name = 'ModelSyncBusyError';
  }
}

/** Runs the configured providers' sync, refusing to overlap with a run that is already in progress. */
export async function runConfiguredModelSync(options: Partial<SyncOptions> = {}): Promise<SyncReport & { unsupportedProviders: string[] }> {
  if (running) throw new ModelSyncBusyError();
  const { adapters, unsupported } = getConfiguredAdapters();
  running = runModelSync(adapters, options);
  try {
    return { ...(await running), unsupportedProviders: unsupported };
  } finally {
    running = null;
  }
}

/** Parses `all` or a comma/array list of `modelId:provider` entries. */
export function parseAcceptedPriceChanges(value: unknown): 'all' | string[] {
  if (value === 'all' || value === true) return 'all';
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return items.map((v) => String(v).trim()).filter(Boolean).slice(0, 200);
}

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Optional background sync, off unless `LYRA_MODEL_SYNC_INTERVAL_HOURS` is a positive number.
 * Scheduled runs use the safe defaults: price changes above the threshold stay held, and removals
 * and new models are capped.
 */
export function startModelSyncSchedule(env: NodeJS.ProcessEnv = process.env): boolean {
  const hours = Number(env.LYRA_MODEL_SYNC_INTERVAL_HOURS);
  if (!Number.isFinite(hours) || hours <= 0 || timer) return false;

  const run = async () => {
    try {
      const report = await runConfiguredModelSync({ apply: true, actor: 'model-sync-schedule' });
      const added = report.providers.reduce((n, p) => n + p.newCandidates.filter((c) => c.registered).length, 0);
      const held = report.providers.reduce((n, p) => n + p.priceChanges.filter((c) => c.status === 'held').length, 0);
      console.log(`[Lyra Models] Sync finished: ${added} new candidate(s), ${held} price change(s) held for review, ${report.errors.length} error(s).`);
    } catch (err) {
      if (!(err instanceof ModelSyncBusyError)) console.warn('[Lyra Models] Sync failed:', err instanceof Error ? err.message : String(err));
    }
  };

  // First run shortly after boot, then on the interval.
  setTimeout(run, 60_000).unref?.();
  timer = setInterval(run, hours * 3_600_000);
  timer.unref?.();
  return true;
}
