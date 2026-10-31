/**
 * Lyra Intelligent Model Router (Client)
 * 
 * Automatically resolves the optimal foundation model for any engineering task,
 * prompt, or swarm role. Users never need to configure model IDs or providers manually.
 */

export interface ModelRouteDecision {
  modelId: string;
  modelName: string;
  provider: 'bedrock' | 'openrouter';
  tier: 'frontier-reasoning' | 'frontier-coding' | 'fast-micro' | 'algorithmic';
  reason: string;
  temperature: number;
  maxTokens: number;
}

export interface RoutingContext {
  prompt?: string;
  taskTitle?: string;
  taskDescription?: string;
  role?: 'planner' | 'architect' | 'coder' | 'reviewer' | 'canary' | 'scribe' | 'worker';
  harness?: string;
  fileCount?: number;
  isFixOrRefactor?: boolean;
}

// Canonical Bedrock active model IDs managed by Lyra (guaranteed non-legacy)
export const MANAGED_MODELS = {
  CLAUDE_OPUS: 'us.anthropic.claude-opus-4-6-v1',
  CLAUDE_SONNET: 'us.anthropic.claude-sonnet-4-6',
  CLAUDE_HAIKU: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
} as const;

/**
 * Intelligently analyzes task requirements and returns the ideal model.
 */
export function resolveOptimalModel(ctx: RoutingContext): ModelRouteDecision {
  const combinedText = `${ctx.prompt || ''} ${ctx.taskTitle || ''} ${ctx.taskDescription || ''}`.toLowerCase();

  // 1. Role-specific overrides
  if (ctx.role === 'planner' || ctx.role === 'architect') {
    return {
      modelId: MANAGED_MODELS.CLAUDE_OPUS,
      modelName: 'Claude Opus 4.6',
      provider: 'bedrock',
      tier: 'frontier-reasoning',
      reason: 'System decomposition & architectural planning',
      temperature: 0.1,
      maxTokens: 16384,
    };
  }

  if (ctx.role === 'reviewer' || ctx.role === 'canary') {
    return {
      modelId: MANAGED_MODELS.CLAUDE_OPUS,
      modelName: 'Claude Opus 4.6',
      provider: 'bedrock',
      tier: 'frontier-reasoning',
      reason: 'Deep verification & security invariants audit',
      temperature: 0.0,
      maxTokens: 8192,
    };
  }

  if (ctx.role === 'scribe') {
    return {
      modelId: MANAGED_MODELS.CLAUDE_HAIKU,
      modelName: 'Claude Haiku 4.5',
      provider: 'bedrock',
      tier: 'fast-micro',
      reason: 'Architecture docs & markdown synthesis',
      temperature: 0.2,
      maxTokens: 8192,
    };
  }

  // 2. Keyword & Intent Classification

  // Tier A: Heavy Architecture, Concurrency, Database Schema, or Multi-file refactor
  const isHighComplexity = /\b(architect|architecture|refactor|migration|schema|concurrency|race condition|deadlock|memory leak|distributed|security|vulnerability|audit|redesign|infrastructure|cloudformation|kubernetes)\b/i.test(combinedText);
  if (isHighComplexity || (ctx.fileCount && ctx.fileCount > 8)) {
    return {
      modelId: MANAGED_MODELS.CLAUDE_OPUS,
      modelName: 'Claude Opus 4.6',
      provider: 'bedrock',
      tier: 'frontier-reasoning',
      reason: 'Complex systems architecture & deep reasoning',
      temperature: 0.1,
      maxTokens: 16384,
    };
  }

  // Tier B: Algorithmic, Mathematical, or Optimization Logic
  const isAlgorithmic = /\b(algorithm|dp|graph|tree|dijkstra|sort|optimize|benchmark|latency|complexity|big-o|math|formula|proof)\b/i.test(combinedText);
  if (isAlgorithmic) {
    return {
      modelId: MANAGED_MODELS.CLAUDE_OPUS,
      modelName: 'Claude Opus 4.6 (Deep Reasoning)',
      provider: 'bedrock',
      tier: 'algorithmic',
      reason: 'Extended thinking for algorithmic correctness',
      temperature: 0.1,
      maxTokens: 16384,
    };
  }

  // Tier C: Quick fixes, typo corrections, comments, single formatting
  const isMicroTask = /\b(typo|fix typo|rename|comment|docstring|format|lint|prettier|bump|small fix|clean up comments|remove unused)\b/i.test(combinedText);
  if (isMicroTask && !isHighComplexity) {
    return {
      modelId: MANAGED_MODELS.CLAUDE_HAIKU,
      modelName: 'Claude Haiku 4.5',
      provider: 'bedrock',
      tier: 'fast-micro',
      reason: 'Sub-second latency micro-edit',
      temperature: 0.2,
      maxTokens: 4096,
    };
  }

  // Tier D: Standard Feature Coding & Implementation (Default)
  return {
    modelId: MANAGED_MODELS.CLAUDE_SONNET,
    modelName: 'Claude Sonnet 4.6',
    provider: 'bedrock',
    tier: 'frontier-coding',
    reason: 'Precision code synthesis & test generation',
    temperature: 0.2,
    maxTokens: 8192,
  };
}
