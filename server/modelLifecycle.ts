/**
 * Model lifecycle operations: validated entry points for changing a model's status and for
 * registering newly discovered models. Callers (HTTP admin routes, future sync jobs) go through
 * here so that every change is validated and audited the same way.
 */

import {
  cleanText,
  ModelRegistryError,
  modelRegistry,
  type ModelLifecycleRecord,
  type ModelLifecycleStatus,
  type ModelRecordSource,
} from './modelRegistry';
import {
  allCatalogModels,
  findCatalogModelAnyStatus,
  normalizeCanonicalModelId,
  type BackendProvider,
  type CanonicalModelProfile,
} from './unifiedModelCatalog';

const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,99}$/i;
const PROVIDERS: readonly BackendProvider[] = ['bedrock', 'foundry', 'openrouter'];
const API_STYLES = ['bedrock-converse', 'openai-chat', 'anthropic-messages'] as const;
const WORKFLOW_GROUPS = ['coding', 'research', 'long-context', 'world-social', 'triage-routing', 'fast-utility'] as const;
const FAMILIES = [
  'anthropic', 'openai', 'microsoft', 'amazon', 'meta', 'deepseek', 'qwen', 'gemini',
  'kimi', 'glm', 'xai', 'mistral', 'minimax', 'nvidia', 'cohere',
] as const;

export interface ModelScores {
  coding: number;
  reasoning: number;
  toolProficiency: number;
  /** Optional; defaults to the catalog median so an unmeasured model is not ranked as slowest or fastest. */
  tokensPerSecond?: number;
  avgTtftMs?: number;
}

export interface SetModelStatusOptions {
  actor: string;
  reason?: string;
  supersededBy?: string;
  /** Required to activate a discovered model, whose quality has not been measured yet. */
  scores?: ModelScores;
  /** Clears the "zero-data-retention not verified" warning on a discovered model. */
  zdrVerified?: boolean;
}

/** Changes a model's lifecycle status, validating that the model (and its successor) exist. */
export async function setModelStatus(
  modelId: string,
  status: ModelLifecycleStatus,
  options: SetModelStatusOptions
): Promise<ModelLifecycleRecord> {
  const model = findCatalogModelAnyStatus(modelId);
  if (!model) throw new ModelRegistryError(`Unknown model: ${modelId}`, 'unknown_model');

  let supersededBy: string | undefined;
  if (options.supersededBy) {
    const successor = findCatalogModelAnyStatus(options.supersededBy);
    if (!successor) throw new ModelRegistryError(`Unknown successor model: ${options.supersededBy}`, 'unknown_model');
    if (successor.id === model.id) throw new ModelRegistryError('A model cannot supersede itself', 'invalid_input');
    supersededBy = successor.id;
  }

  const current = modelRegistry.getStatus(model.id);
  if (model.unscored) {
    if (status === 'active' && !options.scores) {
      throw new ModelRegistryError('This discovered model has not been scored. Provide scores to activate it.', 'invalid_input');
    }
    if (options.scores) {
      await modelRegistry.updateProfile(model.id, applyScores(model, options.scores, options.zdrVerified), {
        actor: options.actor,
        reason: 'Scored by a reviewer',
      });
      if (status === current) return modelRegistry.getRecord(model.id)!;
    }
  }

  return modelRegistry.setStatus(model.id, status, { actor: options.actor, reason: options.reason, supersededBy });
}

function medianTokensPerSecond(): number {
  const speeds = allCatalogModels()
    .filter((m) => !m.unscored)
    .map((m) => m.metrics.tokensPerSecond)
    .sort((a, b) => a - b);
  return speeds.length > 0 ? speeds[Math.floor(speeds.length / 2)]! : 100;
}

/** Returns the profile with measured scores filled in and the `unscored` flag cleared. */
function applyScores(model: CanonicalModelProfile, scores: ModelScores, zdrVerified?: boolean): CanonicalModelProfile {
  const { unscored: _unscored, ...rest } = model;
  return {
    ...rest,
    metrics: {
      ...model.metrics,
      codingScore: finiteInRange(scores.coding, 0, 100, 'coding score'),
      reasoningScore: finiteInRange(scores.reasoning, 0, 100, 'reasoning score'),
      toolProficiency: finiteInRange(scores.toolProficiency, 0, 100, 'toolProficiency score'),
      tokensPerSecond:
        scores.tokensPerSecond === undefined ? medianTokensPerSecond() : finiteInRange(scores.tokensPerSecond, 1, 100_000, 'tokensPerSecond'),
      avgTtftMs: scores.avgTtftMs === undefined ? model.metrics.avgTtftMs || 500 : finiteInRange(scores.avgTtftMs, 0, 600_000, 'avgTtftMs'),
    },
    strengths: model.strengths.filter((s) => !s.includes('not yet scored')),
    routes: zdrVerified ? model.routes.map(({ contributorWarning: _warning, ...route }) => route) : model.routes,
  };
}

export interface RegisterCandidateOptions {
  actor: string;
  source?: ModelRecordSource;
  reason?: string;
}

/**
 * Registers a model that is not in the seed catalog as a `candidate`: searchable and selectable by
 * explicit id, but never chosen by `auto` until it is promoted to `active`.
 */
export async function registerCandidateModel(
  profile: CanonicalModelProfile,
  options: RegisterCandidateOptions
): Promise<ModelLifecycleRecord> {
  const clean = validateCandidateProfile(profile);
  if (findCatalogModelAnyStatus(clean.id) || normalizeCanonicalModelId(clean.id) !== clean.id) {
    throw new ModelRegistryError(`Model ${clean.id} already exists or collides with an alias`, 'already_exists');
  }
  return modelRegistry.addCandidate(clean, options);
}

function fail(message: string): never {
  throw new ModelRegistryError(message, 'invalid_input');
}

function finiteInRange(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`${label} must be a number between ${min} and ${max}`);
  }
  return value;
}

/**
 * Provider-supplied data is untrusted: it is rebuilt field by field so unknown properties are
 * dropped, text is stripped of control characters and capped, and numbers are range-checked.
 */
export function validateCandidateProfile(input: CanonicalModelProfile): CanonicalModelProfile {
  if (!input || typeof input !== 'object') fail('Model profile is required');
  if (typeof input.id !== 'string' || !MODEL_ID_PATTERN.test(input.id)) {
    fail('Model id must be 1-100 characters of letters, digits, ".", "_", ":" or "-"');
  }
  const name = cleanText(input.name, 120);
  if (!name) fail('Model name is required');
  const family = cleanText(input.family, 40);
  if (!family || !(FAMILIES as readonly string[]).includes(family)) {
    fail(`Model family must be one of: ${FAMILIES.join(', ')}`);
  }
  if (!Array.isArray(input.routes) || input.routes.length === 0 || input.routes.length > 6) {
    fail('A model needs 1-6 provider routes');
  }

  const routes = input.routes.map((route, index) => {
    if (!PROVIDERS.includes(route.provider)) fail(`Route ${index}: unknown provider`);
    if (!(API_STYLES as readonly string[]).includes(route.apiStyle)) fail(`Route ${index}: unknown apiStyle`);
    const upstreamModelId = cleanText(route.upstreamModelId, 200);
    if (!upstreamModelId) fail(`Route ${index}: upstreamModelId is required`);
    return {
      provider: route.provider,
      upstreamModelId,
      priority: finiteInRange(route.priority, 1, 100, `Route ${index} priority`),
      apiStyle: route.apiStyle,
      pricing: {
        inputPerMillion: finiteInRange(route.pricing?.inputPerMillion, 0, 10_000, `Route ${index} input price`),
        outputPerMillion: finiteInRange(route.pricing?.outputPerMillion, 0, 10_000, `Route ${index} output price`),
      },
      supportsPromptCaching: Boolean(route.supportsPromptCaching),
      ...(route.contributorWarning ? { contributorWarning: cleanText(route.contributorWarning, 300) } : {}),
    };
  });

  const m = input.metrics;
  return {
    id: input.id,
    name,
    family: family as CanonicalModelProfile['family'],
    tier: finiteInRange(input.tier, 1, 4, 'tier') as CanonicalModelProfile['tier'],
    workflowGroups: (input.workflowGroups ?? []).filter((g) => (WORKFLOW_GROUPS as readonly string[]).includes(g)),
    metrics: {
      reasoningScore: finiteInRange(m?.reasoningScore, 0, 100, 'reasoningScore'),
      codingScore: finiteInRange(m?.codingScore, 0, 100, 'codingScore'),
      toolProficiency: finiteInRange(m?.toolProficiency, 0, 100, 'toolProficiency'),
      contextWindowTokens: finiteInRange(m?.contextWindowTokens, 1, 100_000_000, 'contextWindowTokens'),
      avgTtftMs: finiteInRange(m?.avgTtftMs, 0, 600_000, 'avgTtftMs'),
      tokensPerSecond: finiteInRange(m?.tokensPerSecond, 0, 100_000, 'tokensPerSecond'),
    },
    strengths: (input.strengths ?? []).slice(0, 5).map((s) => cleanText(s, 200) ?? '').filter(Boolean),
    routes,
    ...(input.unscored ? { unscored: true } : {}),
  };
}
