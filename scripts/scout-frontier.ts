#!/usr/bin/env bun
/**
 * CLI Entrypoint for Lyra Product Scout & Competitive Intelligence
 * Run: bun scripts/scout-frontier.ts
 */

import { ProductScout } from '../server/scout/productScout';

async function main() {
  console.log('🛸 [Lyra Product Scout] Spawning frontier intelligence research process...');
  console.log('🎯 Target benchmarks: Claude Code, ChatGPT Canvas, Codex, Cursor/Windsurf, Linear\n');

  const scout = new ProductScout(process.cwd());
  const report = await scout.executeScoutRun();

  console.log(`✅ [Lyra Product Scout] Scan completed: ${report.runId}`);
  console.log(`📁 Blueprint directory: ${report.outputDir}\n`);
  console.log(`🔥 Breakthrough Features Scouted (${report.featuresDiscovered.length}):\n`);

  for (const f of report.featuresDiscovered) {
    console.log(`  * [${f.id}] ${f.featureName} (Scouted from: ${f.targetApp})`);
    console.log(`    Category:     ${f.category}`);
    console.log(`    Advantage:    ${f.competitiveAdvantage.slice(0, 100)}...`);
    console.log(`    Components:   ${f.uiComponentHierarchy.join(', ')}`);
    console.log(`    Verification: ${f.verificationCommand}\n`);
  }

  console.log('⚡ To dispatch Lyra to implement any feature autonomously:');
  console.log(`   ${report.featuresDiscovered[0].dispatchPrompt}\n`);
}

main().catch((err) => {
  console.error('❌ [Lyra Product Scout] Error:', err);
  process.exit(1);
});
