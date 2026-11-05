/**
 * AWS CloudWatch Embedded Metric Format (EMF) & Live Routing Telemetry Aggregator
 *
 * Emits zero-dependency structured AWS CloudWatch EMF JSON payloads to stdout when
 * running on ECS/CloudWatch Logs (`LYRA_HOSTED=true` or `LYRA_EMIT_EMF=true`), while
 * maintaining an in-memory EWMA latency/reliability feedback loop for the Pareto
 * ModelDecisionEngine and real-time observability endpoints.
 */

export type ExecutionLane = 'ask' | 'fast-patch' | 'full-swarm';
export type PolicyProfile = 'frugal' | 'balanced' | 'frontier';

export interface TurnTelemetryEvent {
  turnId: string;
  sessionId: string;
  runId?: string;
  lane: ExecutionLane;
  policyProfile: PolicyProfile;
  modelId: string;
  modelName: string;
  provider: string;
  ttftMs: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedCostUsd: number;
  frontierBaselineCostUsd: number;
  failoverCount: number;
  escalatedTier: boolean;
  throttled: boolean;
  succeeded: boolean;
  reason?: string;
  timestamp: string;
}

export interface ModelLiveHealth {
  modelId: string;
  invocations: number;
  ewmaTtftMs: number;
  ewmaSuccessRate: number;
  recentThrottleCount: number;
  lastThrottledAt?: number;
  lastUpdatedAt: string;
}

export interface LaneStatsSummary {
  lane: ExecutionLane;
  count: number;
  p50TtftMs: number;
  p95TtftMs: number;
  avgDurationMs: number;
  totalCostUsd: number;
}

export interface TelemetrySnapshot {
  namespace: string;
  emfEnabled: boolean;
  totals: {
    turns: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens: number;
    cacheHitRatio: number;
    totalCostUsd: number;
    frontierBaselineCostUsd: number;
    paretoSavingsUsd: number;
    promptCacheSavingsUsd: number;
    failoversTriggered: number;
    tierEscalationsTriggered: number;
  };
  lanes: Record<ExecutionLane, LaneStatsSummary>;
  modelHealth: ModelLiveHealth[];
  recentTurns: TurnTelemetryEvent[];
}

const OPUS_INPUT_PER_M = 15.0;
const OPUS_OUTPUT_PER_M = 75.0;
const EWMA_ALPHA = 0.25;
const MAX_RECENT_TURNS = 150;

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1));
  return Math.round(sortedValues[idx]!);
}

export class CloudWatchEmfRegistry {
  private readonly namespace = 'Lyra/AgentHarness';
  private recentTurns: TurnTelemetryEvent[] = [];
  private modelHealth = new Map<string, ModelLiveHealth>();

  private totalTurns = 0;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalCacheReadTokens = 0;
  private totalCostUsd = 0;
  private frontierBaselineCostUsd = 0;
  private promptCacheSavingsUsd = 0;
  private failoversTriggered = 0;
  private tierEscalationsTriggered = 0;

  public isEmfStdoutEnabled(): boolean {
    return process.env.LYRA_HOSTED === 'true' || process.env.LYRA_EMIT_EMF === 'true';
  }

  /**
   * Builds a compliant AWS CloudWatch Embedded Metric Format (EMF) JSON object.
   */
  public buildEmfPayload(event: TurnTelemetryEvent, queueDepth = 0): Record<string, unknown> {
    const cacheDenom = event.inputTokens + event.cacheReadTokens;
    const cacheHitRatio = cacheDenom > 0 ? Number(((event.cacheReadTokens / cacheDenom) * 100).toFixed(2)) : 0;

    return {
      _aws: {
        Timestamp: Date.parse(event.timestamp) || Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: this.namespace,
            Dimensions: [
              ['Lane', 'PolicyProfile'],
              ['ModelId'],
              ['Lane'],
            ],
            Metrics: [
              { Name: 'TTFT_ms', Unit: 'Milliseconds' },
              { Name: 'TurnDuration_ms', Unit: 'Milliseconds' },
              { Name: 'EstimatedCostUsd', Unit: 'None' },
              { Name: 'CacheHitRatioPct', Unit: 'Percent' },
              { Name: 'FailoverCount', Unit: 'Count' },
              { Name: 'TierEscalation', Unit: 'Count' },
              { Name: 'QueueDepth', Unit: 'Count' },
            ],
          },
        ],
      },
      Lane: event.lane,
      PolicyProfile: event.policyProfile,
      ModelId: event.modelId,
      Provider: event.provider,
      SessionId: event.sessionId,
      RunId: event.runId || 'inline',
      TTFT_ms: Math.max(1, Math.round(event.ttftMs)),
      TurnDuration_ms: Math.max(1, Math.round(event.durationMs)),
      EstimatedCostUsd: Number(event.estimatedCostUsd.toFixed(6)),
      CacheHitRatioPct: cacheHitRatio,
      FailoverCount: event.failoverCount,
      TierEscalation: event.escalatedTier ? 1 : 0,
      QueueDepth: queueDepth,
      Succeeded: event.succeeded,
    };
  }

  /**
   * Records a model throttle/5xx event immediately so subsequent Pareto routing calls
   * penalize or bypass the degraded model during its cooldown window.
   */
  public recordModelThrottle(modelId: string, observedLatencyMs = 2500): void {
    const existing = this.modelHealth.get(modelId);
    const now = Date.now();
    if (!existing) {
      this.modelHealth.set(modelId, {
        modelId,
        invocations: 1,
        ewmaTtftMs: observedLatencyMs,
        ewmaSuccessRate: 0.35,
        recentThrottleCount: 1,
        lastThrottledAt: now,
        lastUpdatedAt: new Date(now).toISOString(),
      });
      return;
    }

    existing.invocations += 1;
    existing.ewmaTtftMs = Math.round(EWMA_ALPHA * observedLatencyMs + (1 - EWMA_ALPHA) * existing.ewmaTtftMs);
    existing.ewmaSuccessRate = Number((EWMA_ALPHA * 0 + (1 - EWMA_ALPHA) * existing.ewmaSuccessRate).toFixed(3));
    existing.recentThrottleCount += 1;
    existing.lastThrottledAt = now;
    existing.lastUpdatedAt = new Date(now).toISOString();
  }

  /**
   * Records a completed turn, updates EWMA live health for the Pareto router,
   * and emits an AWS CloudWatch EMF structured log line if enabled.
   */
  public recordTurn(
    partial: Omit<TurnTelemetryEvent, 'frontierBaselineCostUsd' | 'timestamp'> & {
      timestamp?: string;
      inputPricePerMillion?: number;
      queueDepth?: number;
    }
  ): TurnTelemetryEvent {
    const timestamp = partial.timestamp || new Date().toISOString();
    const totalEffectiveInput = partial.inputTokens + partial.cacheReadTokens;
    const frontierBaselineCostUsd =
      (totalEffectiveInput / 1_000_000) * OPUS_INPUT_PER_M +
      (partial.outputTokens / 1_000_000) * OPUS_OUTPUT_PER_M;

    // Bedrock prompt cache reads receive up to 90% discount on cached input tokens
    const inputUnitPrice = partial.inputPricePerMillion ?? 3.0;
    const cacheReadDiscountUsd = (partial.cacheReadTokens / 1_000_000) * inputUnitPrice * 0.9;

    const event: TurnTelemetryEvent = {
      turnId: partial.turnId,
      sessionId: partial.sessionId,
      runId: partial.runId,
      lane: partial.lane,
      policyProfile: partial.policyProfile,
      modelId: partial.modelId,
      modelName: partial.modelName,
      provider: partial.provider,
      ttftMs: Math.max(1, Math.round(partial.ttftMs)),
      durationMs: Math.max(1, Math.round(partial.durationMs)),
      inputTokens: partial.inputTokens,
      outputTokens: partial.outputTokens,
      cacheReadTokens: partial.cacheReadTokens,
      cacheWriteTokens: partial.cacheWriteTokens,
      estimatedCostUsd: Number(partial.estimatedCostUsd.toFixed(6)),
      frontierBaselineCostUsd: Number(frontierBaselineCostUsd.toFixed(6)),
      failoverCount: partial.failoverCount,
      escalatedTier: partial.escalatedTier,
      throttled: partial.throttled,
      succeeded: partial.succeeded,
      reason: partial.reason,
      timestamp,
    };

    this.recentTurns.unshift(event);
    if (this.recentTurns.length > MAX_RECENT_TURNS) {
      this.recentTurns.length = MAX_RECENT_TURNS;
    }

    this.totalTurns += 1;
    this.totalInputTokens += event.inputTokens;
    this.totalOutputTokens += event.outputTokens;
    this.totalCacheReadTokens += event.cacheReadTokens;
    this.totalCostUsd += event.estimatedCostUsd;
    this.frontierBaselineCostUsd += event.frontierBaselineCostUsd;
    this.promptCacheSavingsUsd += cacheReadDiscountUsd;
    this.failoversTriggered += event.failoverCount;
    if (event.escalatedTier) this.tierEscalationsTriggered += 1;

    // Update EWMA per-model health for live Pareto feedback
    const existing = this.modelHealth.get(event.modelId);
    const successSample = event.succeeded && !event.throttled ? 1 : 0;
    if (!existing) {
      this.modelHealth.set(event.modelId, {
        modelId: event.modelId,
        invocations: 1,
        ewmaTtftMs: event.ttftMs,
        ewmaSuccessRate: successSample === 1 ? 1.0 : 0.5,
        recentThrottleCount: event.throttled ? 1 : 0,
        lastThrottledAt: event.throttled ? Date.now() : undefined,
        lastUpdatedAt: timestamp,
      });
    } else {
      existing.invocations += 1;
      existing.ewmaTtftMs = Math.round(EWMA_ALPHA * event.ttftMs + (1 - EWMA_ALPHA) * existing.ewmaTtftMs);
      existing.ewmaSuccessRate = Number((EWMA_ALPHA * successSample + (1 - EWMA_ALPHA) * existing.ewmaSuccessRate).toFixed(3));
      if (event.throttled) {
        existing.recentThrottleCount += 1;
        existing.lastThrottledAt = Date.now();
      } else if (existing.recentThrottleCount > 0 && successSample === 1) {
        existing.recentThrottleCount = Math.max(0, existing.recentThrottleCount - 1);
      }
      existing.lastUpdatedAt = timestamp;
    }

    if (this.isEmfStdoutEnabled()) {
      const emf = this.buildEmfPayload(event, partial.queueDepth ?? 0);
      process.stdout.write(`${JSON.stringify(emf)}\n`);
    }

    return event;
  }

  public getModelLiveHealth(modelId: string): ModelLiveHealth | undefined {
    return this.modelHealth.get(modelId);
  }

  public getSnapshot(): TelemetrySnapshot {
    const laneBuckets: Record<ExecutionLane, TurnTelemetryEvent[]> = {
      ask: [],
      'fast-patch': [],
      'full-swarm': [],
    };

    for (const t of this.recentTurns) {
      laneBuckets[t.lane].push(t);
    }

    const summarizeLane = (lane: ExecutionLane): LaneStatsSummary => {
      const list = laneBuckets[lane];
      const sortedTtft = list.map((x) => x.ttftMs).sort((a, b) => a - b);
      const totalDur = list.reduce((sum, x) => sum + x.durationMs, 0);
      const totalCost = list.reduce((sum, x) => sum + x.estimatedCostUsd, 0);
      return {
        lane,
        count: list.length,
        p50TtftMs: percentile(sortedTtft, 50),
        p95TtftMs: percentile(sortedTtft, 95),
        avgDurationMs: list.length > 0 ? Math.round(totalDur / list.length) : 0,
        totalCostUsd: Number(totalCost.toFixed(5)),
      };
    };

    const denom = this.totalInputTokens + this.totalCacheReadTokens;
    const cacheHitRatio = denom > 0 ? Number(((this.totalCacheReadTokens / denom) * 100).toFixed(1)) : 0;
    const paretoSavings = Math.max(0, this.frontierBaselineCostUsd - this.totalCostUsd);

    return {
      namespace: this.namespace,
      emfEnabled: this.isEmfStdoutEnabled(),
      totals: {
        turns: this.totalTurns,
        totalInputTokens: this.totalInputTokens,
        totalOutputTokens: this.totalOutputTokens,
        totalCacheReadTokens: this.totalCacheReadTokens,
        cacheHitRatio,
        totalCostUsd: Number(this.totalCostUsd.toFixed(5)),
        frontierBaselineCostUsd: Number(this.frontierBaselineCostUsd.toFixed(5)),
        paretoSavingsUsd: Number(paretoSavings.toFixed(5)),
        promptCacheSavingsUsd: Number(this.promptCacheSavingsUsd.toFixed(5)),
        failoversTriggered: this.failoversTriggered,
        tierEscalationsTriggered: this.tierEscalationsTriggered,
      },
      lanes: {
        ask: summarizeLane('ask'),
        'fast-patch': summarizeLane('fast-patch'),
        'full-swarm': summarizeLane('full-swarm'),
      },
      modelHealth: Array.from(this.modelHealth.values()),
      recentTurns: this.recentTurns.slice(0, 40),
    };
  }
}

export const cloudWatchTelemetry = new CloudWatchEmfRegistry();
