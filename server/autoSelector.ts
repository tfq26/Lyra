/**
 * Auto model selector: picks a model for `model: "auto"` by moving along the cost/quality frontier.
 *
 * Every candidate gets a quality score for this task (coding, reasoning, tool use) and an
 * estimated dollar cost from the task's expected tokens and the model's real prices. Models that
 * another model beats on both (cheaper and at least as good) are never chosen. Among the rest, the
 * level decides how much quality a doubling of cost has to buy:
 *
 *   low     cheapest model that is good enough: quality is worth little against cost
 *   medium  the knee of the curve: pay more only while quality still rises quickly
 *   high    the most capable model, within a cost ceiling relative to what medium would spend
 *
 * Quality beyond what the task needs is worth nothing, so easy tasks stay cheap at every level and
 * the levels diverge as tasks get harder. Speed only breaks ties, and unhealthy models are skipped.
 */

import { cloudWatchTelemetry, type PolicyProfile } from './cloudwatchEmf';
import {
  ModelDecisionEngine,
  THROTTLE_COOLDOWN_MS,
  type ModelDecisionResult,
  type ModelEvaluation,
  type ModelProfile,
  type TaskRequirement,
} from './modelDecisionEngine';

export type AutoLevel = 'low' | 'medium' | 'high';

export const AUTO_LEVEL_FOR_PROFILE: Record<PolicyProfile, AutoLevel> = {
  frugal: 'low',
  balanced: 'medium',
  frontier: 'high',
};

export interface AutoLevelParams {
  /** Quality points one doubling of cost must buy. Higher means more cost-averse. */
  lambda: number;
  /** Quality the task is worth paying for, from the task's required capability (0-100). */
  target: (requiredCapability: number) => number;
  /** High only: never spend more than this multiple of what medium would spend. */
  costCeilingVsMedium?: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const AUTO_LEVELS: Record<AutoLevel, AutoLevelParams> = {
  low: { lambda: 6, target: (need) => clamp(need - 8, 80, 90) },
  medium: { lambda: 1.8, target: (need) => clamp(need + 28, 86, 97) },
  high: { lambda: 0.8, target: (need) => clamp(need + 20, 94, 100), costCeilingVsMedium: 8 },
};

/**
 * Credit for quality above what the task needs, as a fraction of the excess. Small but non-zero, so
 * a nearly free upgrade (a few percent more cost for several quality points) is still taken.
 */
const EXCESS_QUALITY_CREDIT = 0.25;
/** Quality differences smaller than this are noise; the cheaper model wins. */
const QUALITY_EPSILON = 0.25;
/** Utility differences smaller than this are ties, broken by speed. */
const UTILITY_TIE = 0.25;
/** Interactive lanes reuse long prompts, so prompt-caching models cost less in practice. */
const CACHING_COST_FACTOR = 0.9;
const MAX_FAILOVERS = 6;

interface Candidate {
  model: ModelProfile;
  quality: number;
  cost: number;
  duration: number;
  ttftMs: number;
  throttled: boolean;
}

function qualityFor(model: ModelProfile, tags: string[]): number {
  const m = model.metrics;
  return tags.includes('algorithmic') || tags.includes('deep-reasoning')
    ? m.reasoningScore * 0.7 + m.codingScore * 0.3
    : m.codingScore * 0.6 + m.reasoningScore * 0.25 + m.toolProficiency * 0.15;
}

/** Candidates not beaten on both cost and quality, cheapest first. */
export function paretoFrontier<T extends { cost: number; quality: number }>(items: T[]): T[] {
  const sorted = items.slice().sort((a, b) => a.cost - b.cost || b.quality - a.quality);
  const frontier: T[] = [];
  let bestQuality = -Infinity;
  for (const item of sorted) {
    if (item.quality > bestQuality + QUALITY_EPSILON) {
      frontier.push(item);
      bestQuality = item.quality;
    }
  }
  return frontier;
}

function utility(candidate: Candidate, referenceCost: number, target: number, lambda: number): number {
  const doublings = Math.log2(Math.max(candidate.cost, referenceCost) / referenceCost);
  const excess = Math.max(0, candidate.quality - target);
  return Math.min(candidate.quality, target) + EXCESS_QUALITY_CREDIT * excess - lambda * doublings;
}

function best(frontier: Candidate[], target: number, lambda: number): { pick: Candidate; scores: Map<string, number> } {
  const referenceCost = Math.max(frontier[0]!.cost, 1e-9);
  const scores = new Map<string, number>();
  for (const c of frontier) scores.set(c.model.id, utility(c, referenceCost, target, lambda));
  const top = Math.max(...scores.values());
  const tied = frontier.filter((c) => top - scores.get(c.model.id)! <= UTILITY_TIE);
  // Within the tie band prefer the faster, then the cheaper, model.
  tied.sort((a, b) => a.duration - b.duration || a.cost - b.cost);
  return { pick: tied[0]!, scores };
}

/** The cost/quality choice for one level. Exposed so tests can inspect the frontier. */
export function chooseOnFrontier(
  candidates: Candidate[],
  level: AutoLevel,
  requiredCapability: number
): { pick: Candidate; frontier: Candidate[]; target: number; scores: Map<string, number> } {
  const params = AUTO_LEVELS[level];
  const frontier = paretoFrontier(candidates);
  const target = params.target(requiredCapability);

  let usable = frontier;
  if (level === 'high' && params.costCeilingVsMedium) {
    const medium = best(frontier, AUTO_LEVELS.medium.target(requiredCapability), AUTO_LEVELS.medium.lambda).pick;
    const ceiling = medium.cost * params.costCeilingVsMedium;
    const within = frontier.filter((c) => c.cost <= ceiling);
    usable = within.length > 0 ? within : [medium];
  }
  const chosen = best(usable, target, params.lambda);
  return { pick: chosen.pick, frontier, target, scores: chosen.scores };
}

export function selectAutoModel(req: TaskRequirement, catalog: ModelProfile[]): ModelDecisionResult {
  // The level is applied here; keep the engine's own profile floor out of the complexity estimate.
  const analysis = ModelDecisionEngine.analyzeTaskComplexity({ ...req, policyProfile: undefined });
  const level = AUTO_LEVEL_FOR_PROFILE[req.policyProfile ?? 'balanced'];
  const excluded = new Set(req.excludeModelIds ?? []);
  const interactive = req.lane === 'ask' || req.lane === 'fast-patch';
  const requiresToolStreaming = req.role === 'planner' || req.role === 'worker' || req.role === 'coder';
  const now = Date.now();

  const build = (model: ModelProfile): Candidate => {
    const live = cloudWatchTelemetry.getModelLiveHealth(model.id);
    const ttftMs = live && live.invocations > 0 ? live.ewmaTtftMs : model.metrics.avgTtftMs;
    const throttled = Boolean(live?.lastThrottledAt && now - live.lastThrottledAt < THROTTLE_COOLDOWN_MS);
    const rawCost =
      (analysis.estimatedInputTokens / 1_000_000) * model.pricing.inputPerMillion +
      (analysis.estimatedOutputTokens / 1_000_000) * model.pricing.outputPerMillion;
    return {
      model,
      quality: qualityFor(model, analysis.tags),
      cost: rawCost * (interactive && model.supportsPromptCaching ? CACHING_COST_FACTOR : 1),
      duration: ttftMs / 1000 + analysis.estimatedOutputTokens / Math.max(model.metrics.tokensPerSecond, 1),
      ttftMs,
      throttled,
    };
  };

  const usable = catalog.filter(
    (m) =>
      !excluded.has(m.id) &&
      !ModelDecisionEngine.isAccessDenied(m.id) &&
      !(m.inferenceProfileId && ModelDecisionEngine.isAccessDenied(m.inferenceProfileId)) &&
      !(requiresToolStreaming && m.supportsToolStreaming === false)
  );
  const all = (usable.length > 0 ? usable : catalog).map(build);
  const unhealthy = (c: Candidate) => {
    const live = cloudWatchTelemetry.getModelLiveHealth(c.model.id);
    return c.throttled || Boolean(live && live.ewmaSuccessRate < 0.65);
  };
  const healthy = all.filter((c) => !unhealthy(c));
  const candidates = healthy.length > 0 ? healthy : all;

  const { pick, frontier, target, scores } = chooseOnFrontier(candidates, level, analysis.requiredCapability);
  const referenceCost = Math.max(frontier[0]!.cost, 1e-9);
  const params = AUTO_LEVELS[level];

  const scoreOf = (c: Candidate) => scores.get(c.model.id) ?? utility(c, referenceCost, target, params.lambda);
  const evaluations: ModelEvaluation[] = candidates
    .map((c): ModelEvaluation => {
      const meets = c.quality >= analysis.requiredCapability - 5;
      return {
        modelId: c.model.id,
        modelName: c.model.name,
        provider: c.model.provider,
        tier: c.model.tier,
        meetsCapabilityThreshold: meets,
        capabilityScore: Math.round(c.quality),
        estimatedCostUsd: Number(c.cost.toFixed(5)),
        estimatedDurationSeconds: Number(c.duration.toFixed(1)),
        effectiveTtftMs: c.ttftMs,
        compositeScore: Number(scoreOf(c).toFixed(2)),
        throttledCooldown: c.throttled,
        tradeoffSummary: `Quality ${Math.round(c.quality)}/100, est. $${c.cost.toFixed(4)} in ${c.duration.toFixed(1)}s${frontier.includes(c) ? '' : ' (another model is cheaper and at least as good)'}.`,
      };
    })
    .sort((a, b) => b.compositeScore - a.compositeScore);

  const pinned =
    req.pinnedModelId && req.pinnedModelId !== 'auto' ? catalog.find((m) => m.id === req.pinnedModelId) : undefined;
  const selected = pinned ?? pick.model;

  // Failover prefers a different provider first, then the next best choice for this level.
  const ranked = candidates
    .filter((c) => c.model.id !== selected.id)
    .sort((a, b) => scoreOf(b) - scoreOf(a))
    .map((c) => c.model);
  const failoverChain = [
    ...ranked.filter((m) => m.provider !== selected.provider),
    ...ranked.filter((m) => m.provider === selected.provider),
  ].slice(0, MAX_FAILOVERS);

  const chosenEval = evaluations.find((e) => e.modelId === pick.model.id)!;
  return {
    taskSummary: req.prompt.length > 80 ? `${req.prompt.slice(0, 77)}...` : req.prompt,
    selectedModel: selected,
    failoverChain,
    pinnedOverride: Boolean(pinned),
    decisionReason: pinned
      ? `Pinned model ${pinned.name}.`
      : `Auto ${level}: ${pick.model.name} (quality ${chosenEval.capabilityScore}/100, est. $${chosenEval.estimatedCostUsd}) is the best cost/quality choice on a ${frontier.length}-model frontier for a task needing ~${analysis.requiredCapability}/100.`,
    allEvaluations: evaluations,
    metricsBreakdown: {
      capabilityWeight: 1,
      costWeight: params.lambda,
      durationWeight: 0,
      taskComplexity: analysis.requiredCapability,
      estimatedInputTokens: analysis.estimatedInputTokens,
      estimatedOutputTokens: analysis.estimatedOutputTokens,
    },
  };
}

/**
 * Entry point for `model: "auto"`. Set `LYRA_AUTO_SELECTOR=legacy` to fall back to the previous
 * weighted-score engine without a deploy of different code.
 */
export function decideAutoModel(req: TaskRequirement, catalog: ModelProfile[]): ModelDecisionResult {
  return process.env.LYRA_AUTO_SELECTOR === 'legacy'
    ? ModelDecisionEngine.decideOptimalModel(req, catalog)
    : selectAutoModel(req, catalog);
}
