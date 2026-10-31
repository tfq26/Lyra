import { describe, expect, it } from 'bun:test';
import { ModelDecisionEngine } from './modelDecisionEngine';

describe('ModelDecisionEngine Multi-Objective Optimization', () => {
  it('selects low-cost / fast model for simple formatting & typo tasks', () => {
    const decision = ModelDecisionEngine.decideOptimalModel({
      prompt: 'Fix typo in documentation header and format markdown',
      fileCount: 1,
      role: 'worker',
      urgency: 'high',
    });

    expect(decision.metricsBreakdown.taskComplexity).toBeLessThanOrEqual(50);
    // Should NOT choose expensive frontier models (Opus)
    expect(decision.selectedModel.id).not.toBe('anthropic.claude-opus-5-5');
    expect(['anthropic.claude-haiku-4-5-20251001-v1:0', 'qwen.qwen3-coder-480b-a35b-v1:0', 'amazon.nova-2-lite-v1:0']).toContain(decision.selectedModel.id);
  });

  it('selects high-capability frontier models for security audits and deep architectural tasks', () => {
    const decision = ModelDecisionEngine.decideOptimalModel({
      prompt: 'Perform deep security audit of cryptographic authentication and timing-attack vulnerabilities',
      fileCount: 8,
      role: 'reviewer',
    });

    expect(decision.metricsBreakdown.taskComplexity).toBeGreaterThanOrEqual(85);
    // Should choose frontier reasoning models (DeepSeek-R1, Sonnet 5, Opus 5.5)
    expect(['us.deepseek.r1-v1:0', 'anthropic.claude-sonnet-5', 'anthropic.claude-opus-5-5']).toContain(decision.selectedModel.id);
    expect(decision.selectedModel.metrics.reasoningScore).toBeGreaterThanOrEqual(90);
  });

  it('balances cost and duration dynamically when cost sensitivity is high', () => {
    const decision = ModelDecisionEngine.decideOptimalModel({
      prompt: 'Write boilerplate unit tests for user profile repository',
      fileCount: 2,
      role: 'worker',
      costSensitivity: 'high',
    });

    expect(decision.metricsBreakdown.costWeight).toBeGreaterThan(0.5);
    // Estimated cost should be tiny (< $0.01)
    const winningEval = decision.allEvaluations.find((e) => e.modelId === decision.selectedModel.id);
    expect(winningEval?.estimatedCostUsd).toBeLessThan(0.01);
  });
});
