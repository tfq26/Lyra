import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AUTO_LEVELS, chooseOnFrontier, decideAutoModel, paretoFrontier, selectAutoModel } from './autoSelector';
import { cloudWatchTelemetry } from './cloudwatchEmf';
import { ModelDecisionEngine, type ModelProfile, type TaskRequirement } from './modelDecisionEngine';
import { listCanonicalModels } from './unifiedModelCatalog';

/** A frozen catalog so these tests do not move when real prices or scores change. */
function model(
  id: string,
  provider: string,
  input: number,
  output: number,
  coding: number,
  reasoning: number,
  extra: Partial<ModelProfile> = {}
): ModelProfile {
  return {
    id,
    name: id,
    provider,
    tier: 2,
    supportsToolStreaming: true,
    pricing: { inputPerMillion: input, outputPerMillion: output },
    metrics: { codingScore: coding, reasoningScore: reasoning, toolProficiency: coding, contextWindowTokens: 200_000, avgTtftMs: 300, tokensPerSecond: 100 },
    strengths: [],
    ...extra,
  };
}

const FIXTURE: ModelProfile[] = [
  model('nova', 'bedrock', 0.06, 0.24, 80, 76), // cheapest, weakest
  model('flash', 'openrouter', 0.05, 0.3, 88, 86), // near-free upgrade over nova
  model('mid', 'bedrock', 0.4, 1.6, 93, 90),
  model('pro', 'foundry', 0.55, 2.2, 95, 97),
  model('top', 'bedrock', 2, 10, 99, 100), // most capable at a premium price
  model('ultra', 'foundry', 15, 75, 99, 100), // marginally better than top at 4x the price
  model('overpriced', 'bedrock', 3, 15, 90, 90), // mid is cheaper and better
];

const PROFILE = { low: 'frugal', medium: 'balanced', high: 'frontier' } as const;
type Level = keyof typeof PROFILE;

const PROMPTS: Record<string, string> = {
  trivial: 'rename this variable',
  routine: 'add pagination to the users endpoint and update the tests',
  complex: 'refactor the database schema migration for the multi-tenant event journal',
  deep: 'find the race condition in our raft consensus implementation',
};

function pick(catalog: ModelProfile[], prompt: string, level: Level, extra: Partial<TaskRequirement> = {}) {
  return selectAutoModel({ prompt, lane: 'fast-patch', role: 'coder', policyProfile: PROFILE[level], ...extra }, catalog);
}

const blended = (m: ModelProfile) => m.pricing.inputPerMillion * 0.75 + m.pricing.outputPerMillion * 0.25;
const quality = (m: ModelProfile) => m.metrics.codingScore * 0.6 + m.metrics.reasoningScore * 0.25 + m.metrics.toolProficiency * 0.15;

describe('paretoFrontier', () => {
  test('drops models that are costlier and no better, keeps the cheapest of equals', () => {
    const items = [
      { id: 'a', cost: 1, quality: 80 },
      { id: 'b', cost: 2, quality: 79 }, // costlier and worse
      { id: 'c', cost: 3, quality: 90 },
      { id: 'd', cost: 3, quality: 85 }, // same cost, worse
      { id: 'e', cost: 5, quality: 90.1 }, // better by less than the noise threshold
      { id: 'f', cost: 6, quality: 95 },
    ];
    expect(paretoFrontier(items).map((i) => i.id)).toEqual(['a', 'c', 'f']);
  });

  test('handles empty and single-item input', () => {
    expect(paretoFrontier([])).toEqual([]);
    expect(paretoFrontier([{ cost: 1, quality: 1 }])).toHaveLength(1);
  });
});

describe('selectAutoModel on a fixed catalog', () => {
  test('never picks a model that another model beats on both cost and quality', () => {
    for (const level of ['low', 'medium', 'high'] as Level[]) {
      for (const prompt of Object.values(PROMPTS)) {
        expect(pick(FIXTURE, prompt, level).selectedModel.id).not.toBe('overpriced');
      }
    }
  });

  test('cost and quality never go down from low to medium to high', () => {
    for (const prompt of Object.values(PROMPTS)) {
      const [low, medium, high] = (['low', 'medium', 'high'] as Level[]).map((l) => pick(FIXTURE, prompt, l).selectedModel);
      expect(blended(low!)).toBeLessThanOrEqual(blended(medium!));
      expect(blended(medium!)).toBeLessThanOrEqual(blended(high!));
      expect(quality(low!)).toBeLessThanOrEqual(quality(medium!));
      expect(quality(medium!)).toBeLessThanOrEqual(quality(high!));
    }
  });

  test('the three levels pick different models for hard tasks: cheap, balanced, most capable', () => {
    const [low, medium, high] = (['low', 'medium', 'high'] as Level[]).map((l) => pick(FIXTURE, PROMPTS.deep!, l).selectedModel.id);
    expect(low).toBe('flash');
    expect(medium).toBe('pro');
    expect(high).toBe('top');
  });

  test('easy tasks stay cheap: the same level spends far less on a typo than on a hard problem', () => {
    for (const level of ['medium', 'high'] as Level[]) {
      const easy = pick(FIXTURE, PROMPTS.trivial!, level).selectedModel;
      const hard = pick(FIXTURE, PROMPTS.deep!, level).selectedModel;
      expect(blended(easy)).toBeLessThan(blended(hard));
    }
  });

  test('high stays within its cost ceiling relative to what medium would spend', () => {
    const cost = (result: ReturnType<typeof pick>) =>
      result.allEvaluations.find((e) => e.modelId === result.selectedModel.id)!.estimatedCostUsd;
    for (const prompt of Object.values(PROMPTS)) {
      const medium = pick(FIXTURE, prompt, 'medium');
      const high = pick(FIXTURE, prompt, 'high');
      expect(cost(high)).toBeLessThanOrEqual(cost(medium) * AUTO_LEVELS.high.costCeilingVsMedium! * 1.001);
      expect(high.selectedModel.id).not.toBe('ultra');
    }
  });

  test('the cost ceiling is a limit, not a ban: an expensive model is used when it is all there is', () => {
    const ultra = FIXTURE.find((m) => m.id === 'ultra')!;
    expect(pick([ultra], PROMPTS.deep!, 'high').selectedModel.id).toBe('ultra');
  });

  test('a near-free upgrade is taken even at low (flash beats nova for ~10% more)', () => {
    expect(pick(FIXTURE, PROMPTS.routine!, 'low').selectedModel.id).toBe('flash');
  });

  test('explains itself and reports every candidate', () => {
    const result = pick(FIXTURE, PROMPTS.complex!, 'high');
    expect(result.decisionReason).toContain('Auto high');
    expect(result.decisionReason).toContain(result.selectedModel.name);
    expect(result.allEvaluations).toHaveLength(FIXTURE.length);
    const scores = result.allEvaluations.map((e) => e.compositeScore);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(result.allEvaluations.find((e) => e.modelId === 'overpriced')!.tradeoffSummary).toContain('cheaper and at least as good');
    expect(result.pinnedOverride).toBe(false);
  });

  test('speed breaks ties between choices that are equally good for this level', () => {
    const candidate = (id: string, cost: number, quality: number, duration: number) => ({
      model: model(id, 'bedrock', 1, 1, 90, 90),
      quality,
      cost,
      duration,
      ttftMs: 300,
      throttled: false,
    });
    // Both are on the frontier and their utilities differ by exactly the tie threshold.
    const slowFirst = chooseOnFrontier([candidate('a', 1, 90, 9), candidate('b', 1.02, 90.3, 1)], 'medium', 64);
    expect(slowFirst.pick.model.id).toBe('b');
    const fastFirst = chooseOnFrontier([candidate('a', 1, 90, 1), candidate('b', 1.02, 90.3, 9)], 'medium', 64);
    expect(fastFirst.pick.model.id).toBe('a');
  });

  describe('failover chain', () => {
    test('excludes the selection, has no duplicates, and tries another provider first', () => {
      const result = pick(FIXTURE, PROMPTS.routine!, 'medium');
      const chain = result.failoverChain.map((m) => m.id);
      expect(chain).not.toContain(result.selectedModel.id);
      expect(new Set(chain).size).toBe(chain.length);
      expect(result.failoverChain[0]!.provider).not.toBe(result.selectedModel.provider);
      expect(chain.length).toBeGreaterThan(0);
    });

    test('is capped', () => {
      const many = Array.from({ length: 20 }, (_, i) => model(`m${i}`, i % 2 ? 'bedrock' : 'foundry', 0.1 + i, 1 + i, 80 + i * 0.5, 80));
      expect(pick(many, PROMPTS.routine!, 'medium').failoverChain.length).toBeLessThanOrEqual(6);
    });
  });

  describe('constraints', () => {
    test('respects excluded models', () => {
      const result = pick(FIXTURE, PROMPTS.deep!, 'high', { excludeModelIds: ['top'] });
      expect(result.selectedModel.id).not.toBe('top');
      expect(result.failoverChain.map((m) => m.id)).not.toContain('top');
    });

    test('honors a pinned model', () => {
      const result = pick(FIXTURE, PROMPTS.trivial!, 'low', { pinnedModelId: 'top' });
      expect(result.selectedModel.id).toBe('top');
      expect(result.pinnedOverride).toBe(true);
    });

    test('ignores models without tool streaming when the role needs it', () => {
      const catalog = [model('no-tools', 'bedrock', 0.01, 0.01, 99, 99, { supportsToolStreaming: false }), ...FIXTURE];
      expect(pick(catalog, PROMPTS.routine!, 'low').selectedModel.id).not.toBe('no-tools');
    });

    test('still answers with a single model or when everything is excluded', () => {
      expect(pick([FIXTURE[0]!], PROMPTS.deep!, 'high').selectedModel.id).toBe('nova');
      expect(pick(FIXTURE, PROMPTS.deep!, 'high', { excludeModelIds: FIXTURE.map((m) => m.id) }).selectedModel).toBeDefined();
    });

    test('skips a model that was just throttled, unless nothing else is left', () => {
      cloudWatchTelemetry.reset();
      cloudWatchTelemetry.recordModelThrottle('top');
      try {
        expect(pick(FIXTURE, PROMPTS.deep!, 'high').selectedModel.id).not.toBe('top');
        const onlyTop = [FIXTURE.find((m) => m.id === 'top')!];
        expect(pick(onlyTop, PROMPTS.deep!, 'high').selectedModel.id).toBe('top');
      } finally {
        cloudWatchTelemetry.reset();
      }
    });
  });

  test('chooseOnFrontier reports the frontier and the target quality it aimed for', () => {
    const candidates = FIXTURE.map((m) => ({ model: m, quality: quality(m), cost: blended(m), duration: 1, ttftMs: 300, throttled: false }));
    const { frontier, target, pick: chosen } = chooseOnFrontier(candidates, 'medium', 90);
    expect(frontier.map((c) => c.model.id)).not.toContain('overpriced');
    expect(target).toBe(AUTO_LEVELS.medium.target(90));
    expect(frontier).toContain(chosen);
  });
});

describe('decideAutoModel', () => {
  const original = process.env.LYRA_AUTO_SELECTOR;
  beforeEach(() => {
    delete process.env.LYRA_AUTO_SELECTOR;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.LYRA_AUTO_SELECTOR;
    else process.env.LYRA_AUTO_SELECTOR = original;
  });

  test('uses the frontier selector by default and the previous engine when asked', () => {
    const req: TaskRequirement = { prompt: PROMPTS.deep!, lane: 'fast-patch', role: 'coder', policyProfile: 'frontier' };
    const fresh = decideAutoModel(req, FIXTURE);
    expect(fresh.decisionReason).toContain('Auto high');

    process.env.LYRA_AUTO_SELECTOR = 'legacy';
    const legacy = decideAutoModel(req, FIXTURE);
    expect(legacy.decisionReason).not.toContain('Auto high');
    expect(legacy.selectedModel).toEqual(ModelDecisionEngine.decideOptimalModel(req, FIXTURE).selectedModel);
  });
});

describe('on the real catalog', () => {
  const catalog: ModelProfile[] = listCanonicalModels().map((cm) => {
    const route = cm.routes.slice().sort((a, b) => a.priority - b.priority)[0]!;
    return {
      id: cm.id,
      name: cm.name,
      provider: route.provider,
      tier: cm.tier,
      inferenceProfileId: route.upstreamModelId,
      supportsPromptCaching: route.supportsPromptCaching,
      supportsToolStreaming: true,
      pricing: route.pricing,
      metrics: cm.metrics,
      strengths: cm.strengths,
    };
  });

  const prompts = [
    'fix a typo in the readme', 'what does this function do', 'write a unit test for the parser', 'add a button to the settings page',
    'implement oauth login', 'optimize this algorithm with dynamic programming', 'refactor the architecture of the payment service',
    'security audit of the auth flow', 'debug the deadlock in the job queue', 'build a CLI that syncs files', 'migrate the database schema',
    'review this pull request',
  ];

  test('low, medium and high are ordered by cost and quality for every prompt', () => {
    for (const prompt of prompts) {
      const [low, medium, high] = (['low', 'medium', 'high'] as Level[]).map((l) => pick(catalog, prompt, l).selectedModel);
      expect(blended(low!)).toBeLessThanOrEqual(blended(medium!) + 1e-9);
      expect(blended(medium!)).toBeLessThanOrEqual(blended(high!) + 1e-9);
      expect(quality(low!)).toBeLessThanOrEqual(quality(medium!) + 1e-9);
      expect(quality(medium!)).toBeLessThanOrEqual(quality(high!) + 1e-9);
    }
  });

  test('the levels are meaningfully different on average: each step costs more and is smarter', () => {
    const avg = (level: Level) => {
      const picks = prompts.map((p) => pick(catalog, p, level).selectedModel);
      return { cost: picks.reduce((n, m) => n + blended(m), 0) / picks.length, quality: picks.reduce((n, m) => n + quality(m), 0) / picks.length };
    };
    const low = avg('low');
    const medium = avg('medium');
    const high = avg('high');
    expect(medium.cost).toBeGreaterThan(low.cost * 1.5);
    expect(high.cost).toBeGreaterThan(medium.cost * 1.5);
    expect(medium.quality).toBeGreaterThan(low.quality + 1);
    expect(high.quality).toBeGreaterThan(medium.quality + 1);
  });

  test('uses more than one model per level across prompts, so difficulty matters', () => {
    const distinct = (level: Level) => new Set(prompts.map((p) => pick(catalog, p, level).selectedModel.id)).size;
    expect(distinct('medium')).toBeGreaterThan(1);
    expect(distinct('high')).toBeGreaterThan(1);
  });
});
