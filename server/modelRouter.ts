/**
 * Lyra Intelligent Model Router
 *
 * Automatically resolves the optimal foundation model (and ordered failover chain)
 * for any engineering task, execution lane, policy profile, or swarm role.
 */

import { BedrockModelCatalog } from './bedrockModelCatalog';
import type { ExecutionLane, PolicyProfile } from './cloudwatchEmf';
import {
  ModelDecisionEngine,
  type CapabilityTier,
  type TaskRequirement,
} from './modelDecisionEngine';

export interface FailoverTarget {
  modelId: string;
  crossRegionProfileId: string;
  modelName: string;
  provider: string;
  supportsPromptCaching: boolean;
  pricing: { inputPerMillion: number; outputPerMillion: number };
}

export interface ModelRouteDecision {
  modelId: string;
  crossRegionProfileId: string;
  modelName: string;
  provider: 'bedrock' | 'openrouter';
  providerBrand: string;
  tier: 'frontier-reasoning' | 'frontier-coding' | 'fast-micro' | 'algorithmic';
  capabilityTier: CapabilityTier;
  policyProfile: PolicyProfile;
  pinnedOverride: boolean;
  supportsPromptCaching: boolean;
  pricing: { inputPerMillion: number; outputPerMillion: number };
  estimatedCostUsd: number;
  failoverChain: FailoverTarget[];
  reason: string;
  temperature: number;
  maxTokens: number;
  isLegacy?: boolean;
}

export interface RoutingContext {
  prompt?: string;
  taskTitle?: string;
  taskDescription?: string;
  role?: 'planner' | 'architect' | 'coder' | 'reviewer' | 'canary' | 'scribe' | 'worker';
  lane?: ExecutionLane;
  policyProfile?: PolicyProfile;
  pinnedModelId?: string;
  harness?: string;
  fileCount?: number;
  isFixOrRefactor?: boolean;
  costPreference?: 'frugal' | 'balanced' | 'performance';
}

const catalog = new BedrockModelCatalog();

/**
 * Autonomous Multi-Objective Model Router.
 *
 * Evaluates the Pareto frontier across active AWS Bedrock foundation models,
 * maps the winning model to its Cross-Region Inference Profile (`us.*`),
 * and computes an ordered cross-provider failover chain.
 */
export function resolveOptimalModel(ctx: RoutingContext): ModelRouteDecision {
  const promptText = `${ctx.prompt || ''} ${ctx.taskTitle || ''} ${ctx.taskDescription || ''}`.trim();

  const policyProfile: PolicyProfile =
    ctx.policyProfile ||
    (ctx.costPreference === 'frugal'
      ? 'frugal'
      : ctx.costPreference === 'balanced'
        ? 'balanced'
        : 'frontier');

  // If user pinned a legacy model ID (e.g. claude-3-5-sonnet), upgrade cleanly first
  const normalizedPinned =
    ctx.pinnedModelId && ctx.pinnedModelId !== 'auto'
      ? catalog.resolveActiveModel(ctx.pinnedModelId).modelId
      : undefined;

  const req: TaskRequirement = {
    prompt: promptText || 'Software implementation task',
    role: ctx.role,
    lane: ctx.lane,
    policyProfile,
    pinnedModelId: normalizedPinned,
    fileCount: ctx.fileCount,
    costSensitivity:
      policyProfile === 'frugal' ? 'high' : policyProfile === 'frontier' ? 'low' : 'normal',
  };

  const evaluation = ModelDecisionEngine.decideOptimalModel(req);
  const selected = evaluation.selectedModel;
  const resolved = catalog.resolveActiveModel(selected.id);
  const crossRegionProfileId =
    selected.inferenceProfileId || catalog.resolveCrossRegionProfileId(resolved.modelId);

  let tier: ModelRouteDecision['tier'] = 'frontier-coding';
  if (
    ctx.role === 'planner' ||
    ctx.role === 'architect' ||
    ctx.role === 'reviewer' ||
    selected.tier === 4
  ) {
    tier = selected.id.includes('deepseek') || selected.id.includes('r1')
      ? 'algorithmic'
      : 'frontier-reasoning';
  } else if (
    ctx.role === 'scribe' ||
    selected.tier === 1 ||
    selected.id.includes('lite') ||
    selected.id.includes('micro') ||
    selected.id.includes('haiku')
  ) {
    tier = 'fast-micro';
  }

  const winningEval = evaluation.allEvaluations.find((e) => e.modelId === selected.id);
  const failoverChain: FailoverTarget[] = evaluation.failoverChain.map((f) => {
    const fActive = catalog.resolveActiveModel(f.id).modelId;
    return {
      modelId: fActive,
      crossRegionProfileId: f.inferenceProfileId || catalog.resolveCrossRegionProfileId(fActive),
      modelName: f.name,
      provider: f.provider,
      supportsPromptCaching: Boolean(f.supportsPromptCaching ?? catalog.supportsPromptCaching(fActive)),
      pricing: f.pricing,
    };
  });

  return {
    modelId: resolved.modelId,
    crossRegionProfileId,
    modelName: selected.name,
    provider: 'bedrock',
    providerBrand: selected.provider,
    tier,
    capabilityTier: selected.tier,
    policyProfile,
    pinnedOverride: evaluation.pinnedOverride,
    supportsPromptCaching: Boolean(
      selected.supportsPromptCaching ?? catalog.supportsPromptCaching(resolved.modelId)
    ),
    pricing: selected.pricing,
    estimatedCostUsd: winningEval?.estimatedCostUsd ?? 0.001,
    failoverChain,
    reason: evaluation.decisionReason,
    temperature: tier === 'algorithmic' || tier === 'frontier-reasoning' ? 0.1 : 0.2,
    maxTokens:
      ctx.lane === 'ask'
        ? 2048
        : ctx.lane === 'fast-patch'
          ? 4096
          : tier === 'frontier-reasoning'
            ? 16384
            : 8192,
    isLegacy: false,
  };
}
