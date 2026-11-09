#!/usr/bin/env bun
/**
 * CLI Entrypoint for Lyra Autonomous Horizon Scout
 * Run: bun scripts/lyra-horizon-scout.ts [--model <modelId>]
 */

import { HorizonScout } from '../server/horizonScout';

async function main() {
  console.log('🛸 [Lyra Horizon Scout] Initiating frontier research scan...');
  const scout = new HorizonScout(process.cwd());
  const result = await scout.executeScan();

  console.log(`✅ [Lyra Horizon Scout] Scan completed: ${result.scanId}`);
  console.log(`📁 Backlog directory: ${result.backlogDir}\n`);

  for (const t of result.ticketsGenerated) {
    console.log(`  * [${t.priority.toUpperCase()}] ${t.id}: ${t.title} (${t.domain})`);
    console.log(`    Impacted files: ${t.impactedFiles.join(', ')}`);
    console.log(`    Verification:   ${t.verificationCommand}\n`);
  }

  console.log('💡 To dispatch an autonomous swarm on any ticket:');
  console.log(`   bun scripts/lyra-dispatch.ts --prompt "Implement ${result.ticketsGenerated[0].id}" --workers hermes\n`);
}

main().catch((err) => {
  console.error('❌ [Lyra Horizon Scout] Error:', err);
  process.exit(1);
});
