#!/usr/bin/env bun
/**
 * Discover new models and sync prices/removals from providers into Lyra's model registry.
 *
 *   bun scripts/lyra-models-sync.ts                        # dry run: report only, nothing is written
 *   bun scripts/lyra-models-sync.ts --apply                # write changes
 *   bun scripts/lyra-models-sync.ts --apply --accept-prices=all
 *   bun scripts/lyra-models-sync.ts --accept-prices=gpt-6.2-sol:openrouter,grok-4.20:openrouter
 *   bun scripts/lyra-models-sync.ts --max-new=10 --window-days=30
 *
 * Providers: --providers=openrouter,bedrock,foundry, else LYRA_MODEL_SYNC_PROVIDERS (default: openrouter).
 * Bedrock and Foundry only track prices; OpenRouter also discovers and retires models. Storage follows the server:
 * PostgreSQL when configured, otherwise server/data/model-registry.sqlite.
 */

import { initModelRegistry } from '../server/modelRegistry';
import { getConfiguredAdapters, parseAcceptedPriceChanges, runModelSync, type SyncOptions } from '../server/modelSync';

function flag(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : 'true';
}

const money = (n: number) => `$${+n.toFixed(4)}`;
const price = (p: { inputPerMillion: number; outputPerMillion: number }) => `${money(p.inputPerMillion)}/${money(p.outputPerMillion)}`;

async function main() {
  const apply = flag('apply') === 'true';
  const options: Partial<SyncOptions> = { apply, actor: 'model-sync-cli' };
  const accept = flag('accept-prices');
  if (accept) options.acceptPriceChanges = parseAcceptedPriceChanges(accept);
  if (flag('max-new')) options.maxNewModels = Number(flag('max-new'));
  if (flag('window-days')) options.discoveryWindowDays = Number(flag('window-days'));

  const storage = await initModelRegistry();
  const providerFlag = flag('providers');
  const { adapters, unsupported } = getConfiguredAdapters(process.env, providerFlag ? providerFlag.split(',') : undefined);
  console.log(`Model sync (${apply ? 'APPLY' : 'dry run'}), registry storage: ${storage}, providers: ${adapters.map((a) => a.provider).join(', ') || 'none'}`);
  for (const name of unsupported) console.log(`  ! No sync adapter for "${name}" yet; skipped.`);

  const report = await runModelSync(adapters, options);

  for (const p of report.providers) {
    console.log(`\n== ${p.provider}: ${p.ok ? `${p.listingCount} models listed` : p.aborted ? `IGNORED (${p.aborted})` : `FAILED (${p.error})`}`);
    if (!p.ok) continue;

    console.log(`\nNew candidates (${p.newCandidates.length}):`);
    for (const c of p.newCandidates) {
      const successor = c.likelySuccessorOf?.length ? `  (newer version of ${c.likelySuccessorOf.join(', ')})` : '';
      console.log(`  + ${c.id.padEnd(34)} ${c.pricing ? price(c.pricing) : 'n/a'}  ${c.upstreamModelId}${successor}${c.error ? `  ERROR: ${c.error}` : ''}`);
    }
    const skipped = Object.entries(p.skipped).sort((a, b) => b[1] - a[1]);
    if (skipped.length) console.log(`  (not added: ${skipped.map(([r, n]) => `${r} ${n}`).join(', ')})`);

    console.log(`\nPrice changes (${p.priceChanges.length}):`);
    for (const c of p.priceChanges) {
      console.log(`  ${c.status.padEnd(11)} ${`${c.modelId}:${c.provider}`.padEnd(40)} ${price(c.from)} -> ${price(c.to)} (${c.changePct}%)`);
    }
    if (p.priceChanges.some((c) => c.status === 'held')) {
      console.log('  Held changes need approval: --accept-prices=all or --accept-prices=<modelId>:<provider>,...');
    }

    console.log(`\nMissing from listing (${p.missing.length}):`);
    for (const m of p.missing) {
      console.log(`  ${m.action.padEnd(12)} ${m.modelId} (missed ${m.missedSyncs} sync${m.missedSyncs === 1 ? '' : 's'})${m.reason ? ` - ${m.reason}` : ''}`);
    }

    if (p.expiring.length) {
      console.log(`\nProvider-announced removal (${p.expiring.length}):`);
      for (const e of p.expiring) console.log(`  ${e.action.padEnd(12)} ${e.modelId} on ${e.expiresAt.slice(0, 10)}`);
    }
    if (p.reappeared.length) console.log(`\nRetired models listed again (not reinstated automatically): ${p.reappeared.join(', ')}`);
  }

  if (report.supersessions.length) {
    console.log(`\nOlder versions replaced by a newer, at-least-as-good, not-pricier model (${report.supersessions.length}):`);
    for (const s of report.supersessions) console.log(`  ${s.action.padEnd(12)} ${s.modelId} -> ${s.supersededBy}${s.reason ? ` - ${s.reason}` : ''}`);
  }

  if (report.errors.length) console.log(`\nErrors:\n${report.errors.map((e) => `  - ${e}`).join('\n')}`);
  if (!apply) console.log('\nDry run only. Re-run with --apply to write these changes.');
  process.exit(report.errors.length ? 1 : 0);
}

main().catch((err) => {
  console.error('Model sync failed:', err);
  process.exit(1);
});
