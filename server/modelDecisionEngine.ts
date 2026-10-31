/**
 * Lyra Multi-Objective Model Decision Engine
 * 
 * Dynamically evaluates candidate models on Amazon Bedrock by scoring:
 * 1. Capability Fit: Does the model meet the reasoning/coding complexity threshold?
 * 2. Cost Efficiency: Predicted dollar cost based on input/output token estimation.
 * 3. Task Duration / Latency: Estimated execution wall-clock time (TTFT + throughput).
 * 
 * Objective Function:
 *   Score = (CapabilityFit * W_cap) - (NormalizedCost * W_cost) - (NormalizedDuration * W_duration)
 */

export interface ModelProfile {
  id: string;
  name: string;
  provider: string;
  pricing: {
    inputPerMillion: number;
    outputPerMillion: number;
  };
  metrics: {
    reasoningScore: number;     // 0 - 100
    codingScore: number;        // 0 - 100
    toolProficiency: number;    // 0 - 100
    contextWindowTokens: number;
    avgTtftMs: number;          // Time to first token
    tokensPerSecond: number;    // Streaming throughput
  };
  strengths: string[];
}

export interface TaskRequirement {
  prompt: string;
  role?: 'planner' | 'architect' | 'coder' | 'reviewer' | 'scribe' | 'worker' | 'canary';
  fileCount?: number;
  expectedOutputTokens?: number;
  urgency?: 'low' | 'normal' | 'high'; // affects duration weight
  costSensitivity?: 'low' | 'normal' | 'high'; // affects cost weight
}

export interface ModelEvaluation {
  modelId: string;
  modelName: string;
  provider: string;
  meetsCapabilityThreshold: boolean;
  estimatedCostUsd: number;
  estimatedDurationSeconds: number;
  capabilityScore: number;
  compositeScore: number;
  tradeoffSummary: string;
}

export interface ModelDecisionResult {
  taskSummary: string;
  selectedModel: ModelProfile;
  decisionReason: string;
  allEvaluations: ModelEvaluation[];
  metricsBreakdown: {
    capabilityWeight: number;
    costWeight: number;
    durationWeight: number;
    taskComplexity: number; // 0 - 100
  };
}

/**
 * Bedrock Model Registry with real benchmark, pricing, and latency characteristics
 */
export const BEDROCK_CATALOG: ModelProfile[] = [
  {
    id: 'qwen.qwen3-coder-480b-a35b-v1:0',
    name: 'Qwen3 Coder 480B Instruct',
    provider: 'Qwen',
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
    id: 'us.deepseek.r1-v1:0',
    name: 'DeepSeek-R1',
    provider: 'DeepSeek',
    pricing: { inputPerMillion: 0.55, outputPerMillion: 2.19 },
    metrics: {
      reasoningScore: 97,
      codingScore: 91,
      toolProficiency: 85,
      contextWindowTokens: 128_000,
      avgTtftMs: 1600,
      tokensPerSecond: 40,
    },
    strengths: ['Mathematical proof', 'Deep algorithmic optimization', 'CRDT & concurrency invariants'],
  },
  {
    id: 'amazon.nova-2-lite-v1:0',
    name: 'Amazon Nova 2 Lite',
    provider: 'Amazon',
    pricing: { inputPerMillion: 0.06, outputPerMillion: 0.24 },
    metrics: {
      reasoningScore: 74,
      codingScore: 78,
      toolProficiency: 82,
      contextWindowTokens: 300_000,
      avgTtftMs: 250,
      tokensPerSecond: 130,
    },
    strengths: ['Ultra-low cost ($0.06/M)', 'Documentation & changelog synthesis', 'Formatting, typing, and lint triage'],
  },
  {
    id: 'us.meta.llama3-3-70b-instruct-v1:0',
    name: 'Llama 3.3 70B Instruct',
    provider: 'Meta',
    pricing: { inputPerMillion: 0.72, outputPerMillion: 0.72 },
    metrics: {
      reasoningScore: 87,
      codingScore: 89,
      toolProficiency: 90,
      contextWindowTokens: 128_000,
      avgTtftMs: 550,
      tokensPerSecond: 90,
    },
    strengths: ['Balanced open-weights frontier', 'Reliable code reviews & PR checks', 'Flat input/output pricing ($0.72/M)'],
  },
  {
    id: 'us.amazon.nova-pro-v1:0',
    name: 'Amazon Nova Pro',
    provider: 'Amazon',
    pricing: { inputPerMillion: 0.8, outputPerMillion: 3.2 },
    metrics: {
      reasoningScore: 80,
      codingScore: 84,
      toolProficiency: 89,
      contextWindowTokens: 300_000,
      avgTtftMs: 450,
      tokensPerSecond: 95,
    },
    strengths: ['300k token multimodal context', 'Cost-effective general coding', 'Multimodal UI inspection'],
  },
  {
    id: 'anthropic.claude-sonnet-5',
    name: 'Claude Sonnet 5',
    provider: 'Anthropic',
    pricing: { inputPerMillion: 3.0, outputPerMillion: 15.0 },
    metrics: {
      reasoningScore: 94,
      codingScore: 97,
      toolProficiency: 98,
      contextWindowTokens: 200_000,
      avgTtftMs: 800,
      tokensPerSecond: 75,
    },
    strengths: ['Frontier software implementation', 'Precise multi-file editing', 'Complex tool calling'],
  },
  {
    id: 'anthropic.claude-opus-5-5',
    name: 'Claude Opus 5.5',
    provider: 'Anthropic',
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
  {
    id: 'anthropic.claude-haiku-4-5-20251001-v1:0',
    name: 'Claude Haiku 4.5',
    provider: 'Anthropic',
    pricing: { inputPerMillion: 0.8, outputPerMillion: 4.0 },
    metrics: {
      reasoningScore: 78,
      codingScore: 84,
      toolProficiency: 92,
      contextWindowTokens: 200_000,
      avgTtftMs: 400,
      tokensPerSecond: 110,
    },
    strengths: ['Sub-second latency', 'Unit test generation', 'Fast triage & summaries'],
  },
];

export class ModelDecisionEngine {
  /**
   * Analyzes the task complexity based on intent keywords, role, and file scope.
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
    if (/\b(distributed|concurrency|race condition|deadlock|consensus|raft|crypto|security audit|vulnerability|zero-day|kernel|assembly|compiler)\b/i.test(text)) {
      complexity = Math.max(complexity, 95);
      tags.push('deep-reasoning');
    } else if (/\b(architecture|refactor|migration|database schema|reversible migration|event journal|multi-tenant)\b/i.test(text)) {
      complexity = Math.max(complexity, 88);
      tags.push('complex-systems');
    } else if (/\b(algorithm|dijkstra|dynamic programming|big-o|optimize|tree|graph|proof|math)\b/i.test(text)) {
      complexity = Math.max(complexity, 86);
      tags.push('algorithmic');
    }

    // Micro task keywords (can be downscaled to cheaper models)
    if (/\b(typo|fix typo|rename|comment|docstring|format|lint|prettier|changelog|markdown)\b/i.test(text) && !tags.includes('deep-reasoning')) {
      complexity = Math.min(complexity, 50);
      tags.push('micro-edit');
    } else if (/\b(unit test|test suite|assert|coverage)\b/i.test(text) && !tags.includes('deep-reasoning')) {
      complexity = Math.min(complexity, 75);
      tags.push('testing');
    }

    // Scope adjustments
    const fileCount = req.fileCount || 1;
    if (fileCount > 6) complexity = Math.min(100, complexity + 10);
    else if (fileCount === 1 && tags.includes('micro-edit')) complexity = Math.max(30, complexity - 15);

    // Estimate token footprint
    const estimatedInputTokens = Math.max(800, fileCount * 1200 + req.prompt.length * 2);
    const estimatedOutputTokens = req.expectedOutputTokens || (tags.includes('micro-edit') ? 400 : tags.includes('complex-systems') ? 2500 : 1200);

    return {
      requiredCapability: Math.round(complexity),
      estimatedInputTokens,
      estimatedOutputTokens,
      tags,
    };
  }

  /**
   * Evaluates all models against the task using multi-objective optimization.
   */
  public static decideOptimalModel(
    req: TaskRequirement,
    catalog: ModelProfile[] = BEDROCK_CATALOG
  ): ModelDecisionResult {
    const analysis = this.analyzeTaskComplexity(req);
    const requiredCap = analysis.requiredCapability;

    // Determine optimization weights (Capability vs Cost vs Duration)
    let W_cap = 0.50;
    let W_cost = 0.30;
    let W_dur = 0.20;

    if (req.urgency === 'high') {
      W_dur = 0.40;
      W_cost = 0.15;
      W_cap = 0.45;
    } else if (req.costSensitivity === 'high') {
      W_cost = 0.55;
      W_dur = 0.15;
      W_cap = 0.30;
    }

    const evaluations: ModelEvaluation[] = [];

    // Pre-calculate min/max for normalization
    let maxCost = 0.0001;
    let maxDur = 0.0001;

    for (const model of catalog) {
      const cost =
        (analysis.estimatedInputTokens / 1_000_000) * model.pricing.inputPerMillion +
        (analysis.estimatedOutputTokens / 1_000_000) * model.pricing.outputPerMillion;
      const dur = (model.metrics.avgTtftMs / 1000) + (analysis.estimatedOutputTokens / model.metrics.tokensPerSecond);
      if (cost > maxCost) maxCost = cost;
      if (dur > maxDur) maxDur = dur;
    }

    for (const model of catalog) {
      // 1. Calculate Capability Score
      // If task is algorithmic, weight reasoning; if coding, weight coding score
      const capScore = analysis.tags.includes('algorithmic') || analysis.tags.includes('deep-reasoning')
        ? (model.metrics.reasoningScore * 0.7 + model.metrics.codingScore * 0.3)
        : (model.metrics.codingScore * 0.6 + model.metrics.reasoningScore * 0.25 + model.metrics.toolProficiency * 0.15);

      const meetsThreshold = capScore >= (requiredCap - 5);

      // 2. Cost in USD
      const estimatedCost =
        (analysis.estimatedInputTokens / 1_000_000) * model.pricing.inputPerMillion +
        (analysis.estimatedOutputTokens / 1_000_000) * model.pricing.outputPerMillion;

      // 3. Duration in seconds
      const estimatedDuration =
        (model.metrics.avgTtftMs / 1000) + (analysis.estimatedOutputTokens / model.metrics.tokensPerSecond);

      // 4. Normalized penalty scores (0 - 100)
      const normalizedCost = (estimatedCost / maxCost) * 100;
      const normalizedDuration = (estimatedDuration / maxDur) * 100;

      // 5. Multi-Objective Composite Score
      let composite = (capScore * W_cap) - (normalizedCost * W_cost) - (normalizedDuration * W_dur);

      // Disqualification penalty if model fails the minimum complexity capability
      if (!meetsThreshold) {
        composite -= 60; // heavy penalty: cheap doesn't help if it can't solve the problem
      }

      // Bonus if model is exceptionally well-suited without overpaying
      if (meetsThreshold && capScore >= requiredCap && normalizedCost < 25) {
        composite += 12; // efficiency sweet-spot bonus
      }

      const tradeoffSummary = meetsThreshold
        ? `Meets capability (${Math.round(capScore)}/100). Est: $${estimatedCost.toFixed(4)} in ${estimatedDuration.toFixed(1)}s.`
        : `Under-qualified: capability (${Math.round(capScore)}) below required threshold (${requiredCap}).`;

      evaluations.push({
        modelId: model.id,
        modelName: model.name,
        provider: model.provider,
        meetsCapabilityThreshold: meetsThreshold,
        capabilityScore: Math.round(capScore),
        estimatedCostUsd: Number(estimatedCost.toFixed(5)),
        estimatedDurationSeconds: Number(estimatedDuration.toFixed(1)),
        compositeScore: Number(composite.toFixed(2)),
        tradeoffSummary,
      });
    }

    // Sort by composite score descending
    evaluations.sort((a, b) => b.compositeScore - a.compositeScore);

    const winnerEval = evaluations[0]!;
    const winnerModel = catalog.find((m) => m.id === winnerEval.modelId)!;

    let reason = '';
    if (winnerEval.modelId === 'us.anthropic.claude-sonnet-4-6') {
      reason = `Selected Claude Sonnet 4.6 as the optimal balanced workhorse: frontier coding capability (${winnerEval.capabilityScore}/100) at 1/5th the cost of Opus with sub-second TTFT.`;
    } else if (winnerEval.modelId === 'us.anthropic.claude-opus-4-6-v1') {
      reason = `Selected Claude Opus 4.6 due to high task complexity requirement (${requiredCap}/100); maximum reasoning precision prioritized over cost.`;
    } else if (winnerEval.modelId === 'us.anthropic.claude-haiku-4-5-20251001-v1:0') {
      reason = `Selected Claude Haiku 4.5 for high-speed micro-task: instant response (${winnerEval.estimatedDurationSeconds}s) and ultra-low cost ($${winnerEval.estimatedCostUsd}).`;
    } else if (winnerEval.modelId === 'us.amazon.nova-micro-v1:0') {
      reason = `Selected Amazon Nova Micro: rock-bottom cost ($${winnerEval.estimatedCostUsd}) perfectly sufficient for simple formatting/typo fix.`;
    } else if (winnerEval.modelId === 'qwen.qwen3-coder-next') {
      reason = `Selected Qwen3 Coder Next: top-tier coding capability (${winnerEval.capabilityScore}/100) at 1/5th the cost of proprietary frontier models.`;
    } else {
      reason = `Selected ${winnerModel.name} with highest composite score (${winnerEval.compositeScore}) balancing capability, cost, and latency.`;
    }

    return {
      taskSummary: req.prompt.length > 80 ? req.prompt.slice(0, 77) + '...' : req.prompt,
      selectedModel: winnerModel,
      decisionReason: reason,
      allEvaluations: evaluations,
      metricsBreakdown: {
        capabilityWeight: W_cap,
        costWeight: W_cost,
        durationWeight: W_dur,
        taskComplexity: requiredCap,
      },
    };
  }
}
