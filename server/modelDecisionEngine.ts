/**
 * Lyra Multi-Objective Model Decision Engine
 *
 * Dynamically evaluates candidate models on Amazon Bedrock by scoring:
 * 1. Capability Fit: Does the model meet the reasoning/coding complexity threshold?
 * 2. Cost Efficiency: Predicted dollar cost based on input/output token estimation.
 * 3. Task Duration / Latency: Estimated execution wall-clock time (live EWMA TTFT + throughput).
 * 4. Live Operational Health: Penalizes models experiencing AWS Bedrock throttling/5xx cooldowns.
 *
 * Objective Function:
 *   Score = (CapabilityFit * W_cap) - (NormalizedCost * W_cost) - (NormalizedDuration * W_duration) - HealthPenalty
 */

import { cloudWatchTelemetry, type ExecutionLane, type PolicyProfile } from './cloudwatchEmf';

export type CapabilityTier = 1 | 2 | 3 | 4;

export interface ModelProfile {
  id: string;
  name: string;
  provider: string;
  tier: CapabilityTier; // 1: fast-micro, 2: balanced-coding, 3: frontier-coding, 4: frontier-reasoning
  inferenceProfileId?: string;
  supportsPromptCaching?: boolean;
  supportsToolStreaming?: boolean;
  pricing: {
    inputPerMillion: number;
    outputPerMillion: number;
  };
  metrics: {
    reasoningScore: number;     // 0 - 100
    codingScore: number;        // 0 - 100
    toolProficiency: number;    // 0 - 100
    contextWindowTokens: number;
    avgTtftMs: number;          // Baseline Time to First Token
    tokensPerSecond: number;    // Streaming throughput
  };
  strengths: string[];
}

export interface TaskRequirement {
  prompt: string;
  role?: 'planner' | 'architect' | 'coder' | 'reviewer' | 'scribe' | 'worker' | 'canary';
  lane?: ExecutionLane;
  policyProfile?: PolicyProfile;
  pinnedModelId?: string;
  excludeModelIds?: string[];
  fileCount?: number;
  expectedOutputTokens?: number;
  urgency?: 'low' | 'normal' | 'high'; // affects duration weight
  costSensitivity?: 'low' | 'normal' | 'high'; // affects cost weight
}

export interface ModelEvaluation {
  modelId: string;
  modelName: string;
  provider: string;
  tier: CapabilityTier;
  meetsCapabilityThreshold: boolean;
  estimatedCostUsd: number;
  estimatedDurationSeconds: number;
  effectiveTtftMs: number;
  capabilityScore: number;
  compositeScore: number;
  throttledCooldown: boolean;
  tradeoffSummary: string;
}

export interface ModelDecisionResult {
  taskSummary: string;
  selectedModel: ModelProfile;
  failoverChain: ModelProfile[];
  pinnedOverride: boolean;
  decisionReason: string;
  allEvaluations: ModelEvaluation[];
  metricsBreakdown: {
    capabilityWeight: number;
    costWeight: number;
    durationWeight: number;
    taskComplexity: number; // 0 - 100
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
  };
}

export interface EscalationDecision {
  escalated: boolean;
  budgetExceeded: boolean;
  previousModel: ModelProfile;
  selectedModel: ModelProfile;
  estimatedTurnCostUsd: number;
  reason: string;
}

/**
 * Canonical Bedrock Model Registry with benchmark, pricing, tier, Cross-Region Inference Profile,
 * and Prompt Caching characteristics.
 */
export const BEDROCK_CATALOG: ModelProfile[] = [
  {
    id: 'amazon.nova-2-lite-v1:0',
    name: 'Amazon Nova 2 Lite',
    provider: 'Amazon',
    tier: 1,
    inferenceProfileId: 'us.amazon.nova-2-lite-v1:0',
    supportsPromptCaching: true,
    supportsToolStreaming: true,
    pricing: { inputPerMillion: 0.06, outputPerMillion: 0.24 },
    metrics: {
      reasoningScore: 76,
      codingScore: 80,
      toolProficiency: 84,
      contextWindowTokens: 300_000,
      avgTtftMs: 250,
      tokensPerSecond: 130,
    },
    strengths: ['Ultra-low cost ($0.06/M)', 'Documentation & changelog synthesis', 'Formatting, typing, and lint triage'],
  },
  {
    id: 'anthropic.claude-haiku-4-5-20251001-v1:0',
    name: 'Claude Haiku 4.5',
    provider: 'Anthropic',
    tier: 1,
    inferenceProfileId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    supportsPromptCaching: true,
    supportsToolStreaming: true,
    pricing: { inputPerMillion: 0.8, outputPerMillion: 4.0 },
    metrics: {
      reasoningScore: 78,
      codingScore: 84,
      toolProficiency: 92,
      contextWindowTokens: 200_000,
      avgTtftMs: 360,
      tokensPerSecond: 115,
    },
    strengths: ['Sub-400ms TTFT', 'Instant Q&A & surgical edits', 'Prompt caching support'],
  },
  {
    id: 'us.meta.llama4-scout-17b-instruct-v1:0',
    name: 'Llama 4 Scout 17B Instruct',
    provider: 'Meta',
    tier: 1,
    inferenceProfileId: 'us.meta.llama4-scout-17b-instruct-v1:0',
    supportsPromptCaching: false,
    supportsToolStreaming: false,
    pricing: { inputPerMillion: 0.17, outputPerMillion: 0.66 },
    metrics: {
      reasoningScore: 82,
      codingScore: 85,
      toolProficiency: 88,
      contextWindowTokens: 512_000,
      avgTtftMs: 320,
      tokensPerSecond: 120,
    },
    strengths: ['512k token long-context RAG', 'Ultra-fast MoE TTFT', 'Low-cost code navigation'],
  },
  {
    id: 'us.amazon.nova-pro-v1:0',
    name: 'Amazon Nova Pro',
    provider: 'Amazon',
    tier: 2,
    inferenceProfileId: 'us.amazon.nova-pro-v1:0',
    supportsPromptCaching: true,
    supportsToolStreaming: true,
    pricing: { inputPerMillion: 0.8, outputPerMillion: 3.2 },
    metrics: {
      reasoningScore: 82,
      codingScore: 86,
      toolProficiency: 90,
      contextWindowTokens: 300_000,
      avgTtftMs: 450,
      tokensPerSecond: 95,
    },
    strengths: ['300k token multimodal context', 'Cost-effective general coding', 'Multimodal UI inspection'],
  },
  {
    id: 'us.meta.llama4-maverick-17b-instruct-v1:0',
    name: 'Llama 4 Maverick 17B Instruct',
    provider: 'Meta',
    tier: 2,
    inferenceProfileId: 'us.meta.llama4-maverick-17b-instruct-v1:0',
    supportsPromptCaching: false,
    supportsToolStreaming: false,
    pricing: { inputPerMillion: 0.24, outputPerMillion: 0.97 },
    metrics: {
      reasoningScore: 88,
      codingScore: 91,
      toolProficiency: 91,
      contextWindowTokens: 256_000,
      avgTtftMs: 440,
      tokensPerSecond: 105,
    },
    strengths: ['High-speed 128-expert MoE', 'Strong code generation & review', 'High FinOps efficiency'],
  },
  {
    id: 'us.meta.llama3-3-70b-instruct-v1:0',
    name: 'Llama 3.3 70B Instruct',
    provider: 'Meta',
    tier: 2,
    inferenceProfileId: 'us.meta.llama3-3-70b-instruct-v1:0',
    supportsPromptCaching: false,
    supportsToolStreaming: false,
    pricing: { inputPerMillion: 0.72, outputPerMillion: 0.72 },
    metrics: {
      reasoningScore: 87,
      codingScore: 89,
      toolProficiency: 90,
      contextWindowTokens: 128_000,
      avgTtftMs: 520,
      tokensPerSecond: 92,
    },
    strengths: ['Balanced open-weights frontier', 'Reliable code reviews & PR checks', 'Flat input/output pricing ($0.72/M)'],
  },
  {
    id: 'us.moonshotai.kimi-k3',
    name: 'Moonshot Kimi K3',
    provider: 'Moonshot',
    tier: 3,
    inferenceProfileId: 'us.moonshotai.kimi-k3',
    supportsPromptCaching: false,
    supportsToolStreaming: false,
    pricing: { inputPerMillion: 1.0, outputPerMillion: 3.5 },
    metrics: {
      reasoningScore: 95,
      codingScore: 96,
      toolProficiency: 96,
      contextWindowTokens: 256_000,
      avgTtftMs: 680,
      tokensPerSecond: 82,
    },
    strengths: ['Frontier software engineering & refactoring', 'Deep agentic tool proficiency', '256k context window'],
  },
  {
    id: 'qwen.qwen3-coder-480b-a35b-v1:0',
    name: 'Qwen3 Coder 480B Instruct',
    provider: 'Qwen',
    tier: 3,
    supportsPromptCaching: false,
    supportsToolStreaming: false,
    pricing: { inputPerMillion: 1.2, outputPerMillion: 4.8 },
    metrics: {
      reasoningScore: 88,
      codingScore: 96,
      toolProficiency: 93,
      contextWindowTokens: 128_000,
      avgTtftMs: 650,
      tokensPerSecond: 85,
    },
    strengths: ['Premier coding benchmark performance', 'Precision multi-file refactoring', 'TypeScript/Python specialist'],
  },
  {
    id: 'anthropic.claude-sonnet-5',
    name: 'Claude Sonnet 5',
    provider: 'Anthropic',
    tier: 3,
    inferenceProfileId: 'us.anthropic.claude-sonnet-5',
    supportsPromptCaching: true,
    supportsToolStreaming: true,
    pricing: { inputPerMillion: 3.0, outputPerMillion: 15.0 },
    metrics: {
      reasoningScore: 94,
      codingScore: 97,
      toolProficiency: 98,
      contextWindowTokens: 200_000,
      avgTtftMs: 780,
      tokensPerSecond: 78,
    },
    strengths: ['Frontier software implementation', 'Precise multi-file editing', 'Complex tool calling & Prompt Caching'],
  },
  {
    id: 'us.deepseek.r1-v1:0',
    name: 'DeepSeek-R1',
    provider: 'DeepSeek',
    tier: 4,
    inferenceProfileId: 'us.deepseek.r1-v1:0',
    supportsPromptCaching: false,
    supportsToolStreaming: false,
    pricing: { inputPerMillion: 0.55, outputPerMillion: 2.19 },
    metrics: {
      reasoningScore: 97,
      codingScore: 91,
      toolProficiency: 85,
      contextWindowTokens: 128_000,
      avgTtftMs: 1500,
      tokensPerSecond: 42,
    },
    strengths: ['Mathematical proof', 'Deep algorithmic optimization', 'CRDT & concurrency invariants'],
  },
  {
    id: 'anthropic.claude-opus-5-5',
    name: 'Claude Opus 5.5',
    provider: 'Anthropic',
    tier: 4,
    inferenceProfileId: 'us.anthropic.claude-opus-5-5',
    supportsPromptCaching: true,
    supportsToolStreaming: true,
    pricing: { inputPerMillion: 15.0, outputPerMillion: 75.0 },
    metrics: {
      reasoningScore: 98,
      codingScore: 97,
      toolProficiency: 99,
      contextWindowTokens: 200_000,
      avgTtftMs: 1200,
      tokensPerSecond: 45,
    },
    strengths: ['Deep architectural decomposition', 'Multi-step formal reasoning', 'Security invariant audits'],
  },
];

const THROTTLE_COOLDOWN_MS = 60_000;

export class ModelDecisionEngine {
  /**
   * Look up a ModelProfile by exact ID or Cross-Region Inference Profile alias.
   */
  public static findModelProfile(modelId: string, catalog: ModelProfile[] = BEDROCK_CATALOG): ModelProfile | undefined {
    const normalized = modelId.replace(/^us\./, '');
    return catalog.find(
      (m) =>
        m.id === modelId ||
        m.inferenceProfileId === modelId ||
        m.id.replace(/^us\./, '') === normalized
    );
  }

  /**
   * Analyzes task complexity based on intent keywords, lane, role, and file scope.
   * Returns a normalized required capability score (0 - 100).
   */
  public static analyzeTaskComplexity(req: TaskRequirement): {
    requiredCapability: number;
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
    tags: string[];
  } {
    const text = req.prompt.toLowerCase();
    const tags: string[] = [];
    let complexity = 50; // default baseline

    // Lane-specific baseline adjustments
    if (req.lane === 'ask') {
      complexity = 42;
      tags.push('instant-ask');
    } else if (req.lane === 'fast-patch') {
      complexity = 64;
      tags.push('fast-patch');
    } else if (req.lane === 'full-swarm') {
      complexity = Math.max(complexity, 82);
      tags.push('full-swarm');
    }

    // Role weighting
    if (req.role === 'architect' || req.role === 'planner') {
      complexity = Math.max(complexity, 88);
      tags.push('system-planning');
    } else if (req.role === 'reviewer') {
      complexity = Math.max(complexity, 82);
      tags.push('verification-audit');
    } else if (req.role === 'scribe') {
      complexity = Math.min(complexity, 65);
      tags.push('documentation');
    }

    // High complexity keywords
    if (/\b(distributed|concurrency|race condition|deadlock|consensus|raft|crypto|cryptographic|timing-attack|security audit|vulnerability|zero-day|kernel|assembly|compiler)\b/i.test(text)) {
      complexity = Math.max(complexity, 95);
      tags.push('deep-reasoning');
    } else if (/\b(architecture|refactor|migration|database schema|reversible migration|event journal|multi-tenant)\b/i.test(text)) {
      complexity = Math.max(complexity, 88);
      tags.push('complex-systems');
    } else if (/\b(algorithm|dijkstra|dynamic programming|big-o|optimize|tree|graph|proof|math)\b/i.test(text)) {
      complexity = Math.max(complexity, 86);
      tags.push('algorithmic');
    }

    // Micro task keywords (can be downscaled to cheaper fast-TTFT models)
    if (/\b(typo|fix typo|rename|comment|docstring|format|lint|prettier|changelog|markdown)\b/i.test(text) && !tags.includes('deep-reasoning')) {
      complexity = Math.min(complexity, 50);
      tags.push('micro-edit');
    } else if (/\b(unit test|test suite|assert|coverage)\b/i.test(text) && !tags.includes('deep-reasoning')) {
      complexity = Math.min(complexity, 75);
      tags.push('testing');
    }

    // Policy profile floor adjustments
    if (req.policyProfile === 'frontier') {
      complexity = Math.max(complexity, 90);
      tags.push('frontier-policy');
    }

    // Scope adjustments
    const fileCount = req.fileCount || 1;
    if (fileCount > 6) complexity = Math.min(100, complexity + 10);
    else if (fileCount === 1 && tags.includes('micro-edit')) complexity = Math.max(30, complexity - 15);

    const estimatedInputTokens = Math.max(800, fileCount * 1200 + req.prompt.length * 2);
    const estimatedOutputTokens =
      req.expectedOutputTokens ||
      (req.lane === 'ask'
        ? 450
        : tags.includes('micro-edit')
          ? 400
          : tags.includes('complex-systems')
            ? 2500
            : 1200);

    return {
      requiredCapability: Math.round(complexity),
      estimatedInputTokens,
      estimatedOutputTokens,
      tags,
    };
  }

  /**
   * Alias for `decideOptimalModel` so callers can invoke `ModelDecisionEngine.decide(...)`.
   */
  public static decide(
    req: TaskRequirement,
    catalog: ModelProfile[] = BEDROCK_CATALOG
  ): ModelDecisionResult {
    return this.decideOptimalModel(req, catalog);
  }

  /**
   * Evaluates all candidate models using Pareto multi-objective optimization + live EWMA telemetry,
   * returning the primary winning model AND an ordered cross-provider failover chain.
   */
  public static decideOptimalModel(
    req: TaskRequirement,
    catalog: ModelProfile[] = BEDROCK_CATALOG
  ): ModelDecisionResult {
    const analysis = this.analyzeTaskComplexity(req);
    const requiredCap = analysis.requiredCapability;
    const excluded = new Set(req.excludeModelIds || []);

    // Derive weights from PolicyProfile + explicit urgency / costSensitivity
    let W_cap = 0.50;
    let W_cost = 0.30;
    let W_dur = 0.20;

    const effectiveUrgency =
      req.urgency || (req.lane === 'ask' || req.lane === 'fast-patch' ? 'high' : 'normal');
    const effectiveCostSensitivity =
      req.costSensitivity ||
      (req.policyProfile === 'frugal'
        ? 'high'
        : req.policyProfile === 'frontier'
          ? 'low'
          : 'normal');

    if (effectiveCostSensitivity === 'high') {
      W_cost = 0.55;
      W_dur = 0.15;
      W_cap = 0.30;
    } else if (req.policyProfile === 'frontier') {
      W_cap = 0.72;
      W_dur = 0.18;
      W_cost = 0.10;
    } else if (effectiveUrgency === 'high') {
      W_dur = 0.40;
      W_cost = 0.15;
      W_cap = 0.45;
    }

    const evaluations: ModelEvaluation[] = [];
    const now = Date.now();

    let maxCost = 0.0001;
    let maxDur = 0.0001;

    for (const model of catalog) {
      const live = cloudWatchTelemetry.getModelLiveHealth(model.id);
      const effectiveTtft = live && live.invocations > 0 ? live.ewmaTtftMs : model.metrics.avgTtftMs;
      const cost =
        (analysis.estimatedInputTokens / 1_000_000) * model.pricing.inputPerMillion +
        (analysis.estimatedOutputTokens / 1_000_000) * model.pricing.outputPerMillion;
      const dur = effectiveTtft / 1000 + analysis.estimatedOutputTokens / model.metrics.tokensPerSecond;
      if (cost > maxCost) maxCost = cost;
      if (dur > maxDur) maxDur = dur;
    }

    const requiresToolStreaming = req.role === 'planner' || req.role === 'worker' || req.role === 'coder';
    for (const model of catalog) {
      if (excluded.has(model.id)) continue;
      if (requiresToolStreaming && model.supportsToolStreaming === false) continue;

      const live = cloudWatchTelemetry.getModelLiveHealth(model.id);
      const effectiveTtft = live && live.invocations > 0 ? live.ewmaTtftMs : model.metrics.avgTtftMs;
      const inThrottleCooldown = Boolean(
        live?.lastThrottledAt && now - live.lastThrottledAt < THROTTLE_COOLDOWN_MS
      );

      const capScore =
        analysis.tags.includes('algorithmic') || analysis.tags.includes('deep-reasoning')
          ? model.metrics.reasoningScore * 0.7 + model.metrics.codingScore * 0.3
          : model.metrics.codingScore * 0.6 +
            model.metrics.reasoningScore * 0.25 +
            model.metrics.toolProficiency * 0.15;

      const meetsThreshold = capScore >= requiredCap - 5;

      const estimatedCost =
        (analysis.estimatedInputTokens / 1_000_000) * model.pricing.inputPerMillion +
        (analysis.estimatedOutputTokens / 1_000_000) * model.pricing.outputPerMillion;

      const estimatedDuration =
        effectiveTtft / 1000 + analysis.estimatedOutputTokens / model.metrics.tokensPerSecond;

      const normalizedCost = (estimatedCost / maxCost) * 100;
      const normalizedDuration = (estimatedDuration / maxDur) * 100;

      let composite = capScore * W_cap - normalizedCost * W_cost - normalizedDuration * W_dur;

      if (!meetsThreshold) {
        composite -= 60;
      }

      if (meetsThreshold && capScore >= requiredCap && normalizedCost < 25) {
        composite += 12;
      }

      // Prompt caching efficiency bonus for interactive multi-turn lanes
      if ((req.lane === 'ask' || req.lane === 'fast-patch') && model.supportsPromptCaching) {
        composite += 4;
      }

      // Live operational health penalty when model recently throttled or had 5xx errors
      if (inThrottleCooldown) {
        composite -= 45;
      } else if (live && live.ewmaSuccessRate < 0.65) {
        composite -= 25;
      }

      const tradeoffSummary = meetsThreshold
        ? `Meets capability (${Math.round(capScore)}/100). Est: $${estimatedCost.toFixed(4)} in ${estimatedDuration.toFixed(1)}s (TTFT ${effectiveTtft}ms)${inThrottleCooldown ? ' [Throttle Cooldown]' : ''}.`
        : `Under-qualified: capability (${Math.round(capScore)}) below required threshold (${requiredCap}).`;

      evaluations.push({
        modelId: model.id,
        modelName: model.name,
        provider: model.provider,
        tier: model.tier,
        meetsCapabilityThreshold: meetsThreshold,
        capabilityScore: Math.round(capScore),
        estimatedCostUsd: Number(estimatedCost.toFixed(5)),
        estimatedDurationSeconds: Number(estimatedDuration.toFixed(1)),
        effectiveTtftMs: effectiveTtft,
        compositeScore: Number(composite.toFixed(2)),
        throttledCooldown: inThrottleCooldown,
        tradeoffSummary,
      });
    }

    evaluations.sort((a, b) => b.compositeScore - a.compositeScore);

    // Honor explicit manual model pin if valid in catalog
    const pinnedModel =
      req.pinnedModelId && req.pinnedModelId !== 'auto'
        ? this.findModelProfile(req.pinnedModelId, catalog)
        : undefined;

    const winnerEval = evaluations[0]!;
    const winnerModel = pinnedModel || catalog.find((m) => m.id === winnerEval.modelId)!;

    // Build ordered failover chain (preferring cross-provider diversity first, then next Pareto score)
    const candidateFailovers = evaluations
      .filter((e) => e.modelId !== winnerModel.id && e.meetsCapabilityThreshold)
      .map((e) => catalog.find((m) => m.id === e.modelId)!)
      .filter(Boolean);

    const diverseFirst = [
      ...candidateFailovers.filter((m) => m.provider !== winnerModel.provider),
      ...candidateFailovers.filter((m) => m.provider === winnerModel.provider),
    ];
    const failoverChain = diverseFirst.slice(0, 3);

    let reason = '';
    if (pinnedModel) {
      reason = `Pinned by user to ${pinnedModel.name} (${pinnedModel.id}); automatic failover chain ready (${failoverChain.map((f) => f.name).join(' -> ') || 'none'}).`;
    } else if (winnerModel.id === 'anthropic.claude-sonnet-5') {
      reason = `Selected Claude Sonnet 5 as the optimal frontier coding workhorse (${winnerEval.capabilityScore}/100 capability, Prompt Caching enabled) at 1/5th the cost of Opus 5.5.`;
    } else if (winnerModel.id === 'anthropic.claude-opus-5-5') {
      reason = `Selected Claude Opus 5.5 for high-complexity reasoning (${requiredCap}/100 threshold); maximum architectural & security precision prioritized.`;
    } else if (winnerModel.id === 'anthropic.claude-haiku-4-5-20251001-v1:0') {
      reason = `Selected Claude Haiku 4.5 for low-latency execution (~${winnerEval.effectiveTtftMs}ms TTFT, $${winnerEval.estimatedCostUsd} est.) with Bedrock Prompt Caching.`;
    } else if (winnerModel.id === 'amazon.nova-2-lite-v1:0') {
      reason = `Selected Amazon Nova 2 Lite: ultra-fast ~${winnerEval.effectiveTtftMs}ms TTFT and rock-bottom cost ($${winnerEval.estimatedCostUsd}) meeting complexity threshold (${requiredCap}/100).`;
    } else if (winnerModel.id === 'qwen.qwen3-coder-480b-a35b-v1:0') {
      reason = `Selected Qwen3 Coder 480B: top-tier coding score (${winnerEval.capabilityScore}/100) at 60% lower cost than proprietary frontier models.`;
    } else if (winnerModel.id === 'us.deepseek.r1-v1:0') {
      reason = `Selected DeepSeek-R1: frontier formal/algorithmic reasoning (${winnerModel.metrics.reasoningScore}/100) with high FinOps efficiency ($${winnerEval.estimatedCostUsd}).`;
    } else {
      reason = `Selected ${winnerModel.name} with highest Pareto composite score (${winnerEval.compositeScore}) across capability, cost, and live latency.`;
    }

    return {
      taskSummary: req.prompt.length > 80 ? req.prompt.slice(0, 77) + '...' : req.prompt,
      selectedModel: winnerModel,
      failoverChain,
      pinnedOverride: Boolean(pinnedModel),
      decisionReason: reason,
      allEvaluations: evaluations,
      metricsBreakdown: {
        capabilityWeight: W_cap,
        costWeight: W_cost,
        durationWeight: W_dur,
        taskComplexity: requiredCap,
        estimatedInputTokens: analysis.estimatedInputTokens,
        estimatedOutputTokens: analysis.estimatedOutputTokens,
      },
    };
  }

  /**
   * Escalates 1 capability tier upward when compiler/test verification fails,
   * strictly bounded by the FinOps per-run spend cap.
   */
  public static escalateModelForRepair(
    params: {
      currentModelId: string;
      remainingBudgetUsd?: number;
      estimatedInputTokens?: number;
      estimatedOutputTokens?: number;
    },
    catalog: ModelProfile[] = BEDROCK_CATALOG
  ): EscalationDecision {
    const current =
      this.findModelProfile(params.currentModelId, catalog) ||
      catalog.find((m) => m.id === 'anthropic.claude-haiku-4-5-20251001-v1:0') ||
      catalog[0]!;
    const remainingBudget = params.remainingBudgetUsd ?? 1.5;
    const inTokens = params.estimatedInputTokens ?? 4000;
    const outTokens = params.estimatedOutputTokens ?? 1800;

    const estimateCost = (m: ModelProfile) =>
      (inTokens / 1_000_000) * m.pricing.inputPerMillion +
      (outTokens / 1_000_000) * m.pricing.outputPerMillion;

    if (remainingBudget <= 0) {
      return {
        escalated: false,
        budgetExceeded: true,
        previousModel: current,
        selectedModel: current,
        estimatedTurnCostUsd: Number(estimateCost(current).toFixed(5)),
        reason: `FinOps per-run budget cap exhausted ($${remainingBudget.toFixed(4)} remaining); blocked automatic tier escalation.`,
      };
    }

    const targetTier = Math.min(4, current.tier + 1) as CapabilityTier;
    const higherCandidates = catalog
      .filter((m) => m.tier >= targetTier && m.id !== current.id)
      .sort((a, b) => {
        // Prefer exact next tier first, then higher coding+reasoning score, then lower cost
        if (a.tier !== b.tier) return a.tier - b.tier;
        const scoreA = a.metrics.codingScore * 0.6 + a.metrics.reasoningScore * 0.4;
        const scoreB = b.metrics.codingScore * 0.6 + b.metrics.reasoningScore * 0.4;
        return scoreB - scoreA;
      });

    for (const candidate of higherCandidates) {
      const turnCost = estimateCost(candidate);
      if (turnCost <= remainingBudget) {
        return {
          escalated: true,
          budgetExceeded: false,
          previousModel: current,
          selectedModel: candidate,
          estimatedTurnCostUsd: Number(turnCost.toFixed(5)),
          reason: `Escalated from Tier ${current.tier} (${current.name}) to Tier ${candidate.tier} (${candidate.name}) after verification failure (est. $${turnCost.toFixed(4)} within $${remainingBudget.toFixed(2)} remaining FinOps cap).`,
        };
      }
    }

    const currentCost = estimateCost(current);
    const budgetExceeded = higherCandidates.length > 0;
    return {
      escalated: false,
      budgetExceeded,
      previousModel: current,
      selectedModel: current,
      estimatedTurnCostUsd: Number(currentCost.toFixed(5)),
      reason: budgetExceeded
        ? `Higher-tier models exceed remaining FinOps spend cap ($${remainingBudget.toFixed(4)}); retrying within current tier (${current.name}).`
        : `Already at maximum capability Tier ${current.tier} (${current.name}).`,
    };
  }
}
