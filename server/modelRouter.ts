/**
 * Lyra Intelligent Model Router
 * 
 * Automatically resolves the optimal foundation model for any engineering task,
 * prompt, or swarm role. Users never need to configure model IDs or providers manually.
 */

import { BedrockModelCatalog } from './bedrockModelCatalog';
import { ModelDecisionEngine, type TaskRequirement } from './modelDecisionEngine';

export interface ModelRouteDecision {
  modelId: string;
  modelName: string;
  provider: 'bedrock' | 'openrouter';
  tier: 'frontier-reasoning' | 'frontier-coding' | 'fast-micro' | 'algorithmic';
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
  harness?: string;
  fileCount?: number;
  isFixOrRefactor?: boolean;
  costPreference?: 'frugal' | 'balanced' | 'performance';
}

const catalog = new BedrockModelCatalog();

/**
 * Autonomous Multi-Objective Model Router.
 * 
 * Uses dynamic Pareto-frontier optimization (Capability vs. Cost vs. Latency)
 * across all AWS Bedrock providers (Amazon, Qwen, DeepSeek, Meta, Anthropic, OpenAI).
 * Automatically selects the cheapest model that meets or exceeds the task capability bar.
 */
export function resolveOptimalModel(ctx: RoutingContext): ModelRouteDecision {
  const promptText = `${ctx.prompt || ''} ${ctx.taskTitle || ''} ${ctx.taskDescription || ''}`.trim();
  
  const req: TaskRequirement = {
    prompt: promptText || 'Software implementation task',
    role: ctx.role,
    fileCount: ctx.fileCount,
    costSensitivity: ctx.costPreference === 'frugal' ? 'high' : ctx.costPreference === 'performance' ? 'low' : 'normal',
  };

  // Mathematically evaluate Pareto frontier across all active Bedrock models
  const evaluation = ModelDecisionEngine.decideOptimalModel(req);
  const selected = evaluation.selectedModel;

  // Resolve legacy deprecations if any
  const resolved = catalog.resolveActiveModel(selected.id);

  let tier: ModelRouteDecision['tier'] = 'frontier-coding';
  if (ctx.role === 'planner' || ctx.role === 'architect' || ctx.role === 'reviewer') {
    tier = 'frontier-reasoning';
  } else if (ctx.role === 'scribe' || selected.id.includes('lite') || selected.id.includes('micro') || selected.id.includes('haiku')) {
    tier = 'fast-micro';
  } else if (selected.id.includes('deepseek') || selected.id.includes('r1')) {
    tier = 'algorithmic';
  }

  return {
    modelId: resolved.modelId,
    modelName: selected.name,
    provider: 'bedrock',
    tier,
    reason: evaluation.decisionReason,
    temperature: tier === 'algorithmic' ? 0.1 : tier === 'frontier-reasoning' ? 0.1 : 0.2,
    maxTokens: tier === 'frontier-reasoning' ? 16384 : 8192,
    isLegacy: false,
  };
}
