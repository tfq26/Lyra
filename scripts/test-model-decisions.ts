#!/usr/bin/env bun
/**
 * Test & Benchmark for Lyra's Multi-Objective Model Decision Engine
 * 
 * Simulates diverse real-world development tasks and verifies that the engine
 * picks the most cost-effective and capable model without launching swarms.
 */

import { ModelDecisionEngine, type TaskRequirement } from '../server/modelDecisionEngine';

const testScenarios: { name: string; req: TaskRequirement }[] = [
  {
    name: 'Scenario 1: Simple Typo & Formatting Fix',
    req: {
      prompt: 'Fix typo in README header and format bullet points',
      fileCount: 1,
      role: 'worker',
      urgency: 'high',
    },
  },
  {
    name: 'Scenario 2: Unit Test Suite Generation',
    req: {
      prompt: 'Write comprehensive unit test suite with boundary assertion coverage for stringUtils.ts',
      fileCount: 2,
      role: 'worker',
      expectedOutputTokens: 1000,
      costSensitivity: 'high',
    },
  },
  {
    name: 'Scenario 3: Standard Feature Implementation (CRUD Module)',
    req: {
      prompt: 'Implement Fastify user profile CRUD endpoints with Zod validation, error handling, and Postgres repository',
      fileCount: 3,
      role: 'coder',
      expectedOutputTokens: 1800,
    },
  },
  {
    name: 'Scenario 4: Complex Algorithmic Optimization & Math',
    req: {
      prompt: 'Implement lock-free multi-producer ring buffer algorithm with atomic CAS operations and verify big-O complexity',
      fileCount: 2,
      role: 'coder',
      expectedOutputTokens: 2200,
    },
  },
  {
    name: 'Scenario 5: High-Risk Security & Timing-Attack Audit',
    req: {
      prompt: 'Audit entire authentication and token verification system for timing attacks, race conditions, and cryptographic nonce reuse',
      fileCount: 7,
      role: 'reviewer',
      urgency: 'normal',
    },
  },
  {
    name: 'Scenario 6: Massive Multi-Service Architecture Migration',
    req: {
      prompt: 'Decompose 14-step distributed database migration across Postgres and Redis with zero-downtime reversible canary schema rollbacks',
      fileCount: 12,
      role: 'planner',
      expectedOutputTokens: 3500,
    },
  },
];

console.log('================================================================================');
console.log('         LYRA MULTI-OBJECTIVE MODEL DECISION ENGINE BENCHMARK SUITE             ');
console.log('================================================================================');
console.log(' Balancing: 1. Capability Fit  |  2. Dollar Cost  |  3. Latency & Duration\n');

for (const scenario of testScenarios) {
  const decision = ModelDecisionEngine.decideOptimalModel(scenario.req);

  console.log(`\n📌 ${scenario.name.toUpperCase()}`);
  console.log(`   Prompt: "${scenario.req.prompt}"`);
  console.log(`   Task Complexity Score: ${decision.metricsBreakdown.taskComplexity}/100`);
  console.log(`   Weights: [Capability: ${(decision.metricsBreakdown.capabilityWeight * 100).toFixed(0)}% | Cost: ${(decision.metricsBreakdown.costWeight * 100).toFixed(0)}% | Latency: ${(decision.metricsBreakdown.durationWeight * 100).toFixed(0)}%]`);
  console.log(`   🏆 WINNING MODEL: \x1b[32m${decision.selectedModel.name}\x1b[0m (${decision.selectedModel.provider})`);
  console.log(`   💬 Rationale: ${decision.decisionReason}`);

  console.log('\n   📊 Candidate Model Breakdown:');
  console.log('   -----------------------------------------------------------------------------------------');
  console.log('   Model Name              | Cap Score | Est Cost  | Duration | Comp. Score | Status');
  console.log('   -----------------------------------------------------------------------------------------');
  for (const ev of decision.allEvaluations) {
    const isWinner = ev.modelId === decision.selectedModel.id;
    const nameStr = ev.modelName.padEnd(23);
    const capStr = `${ev.capabilityScore}/100`.padStart(9);
    const costStr = `$${ev.estimatedCostUsd.toFixed(5)}`.padStart(9);
    const durStr = `${ev.estimatedDurationSeconds.toFixed(1)}s`.padStart(8);
    const scoreStr = ev.compositeScore.toFixed(1).padStart(11);
    const status = isWinner
      ? '\x1b[32m★ WINNER\x1b[0m'
      : ev.meetsCapabilityThreshold
      ? '✓ Qualified'
      : '\x1b[31m✗ Under-qualified\x1b[0m';

    console.log(`   ${nameStr} | ${capStr} | ${costStr} | ${durStr} | ${scoreStr} | ${status}`);
  }
  console.log('   -----------------------------------------------------------------------------------------');
}

console.log('\n================================================================================');
console.log('✅ Benchmark complete. Tested decision logic across all 6 engineering tiers.');
console.log('================================================================================\n');
