import React from 'react';

const Architecture: React.FC = () => {
  return (
    <div className="space-y-12 max-w-3xl">
      <div className="space-y-3 apple-fade">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white font-display uppercase tracking-wide">
          System Architecture
        </h1>
        <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
          Lyra v1.3 decouples client surfaces from cloud execution across an adaptive 3-lane pipeline, backed by Amazon Bedrock Cross-Region Inference Profiles, Amazon SQS + S3 Claim-Check durable queueing, and CloudWatch EMF telemetry.
        </p>
      </div>

      {/* Blueprint Schematic */}
      <div className="clean-card p-6 font-mono text-xs leading-relaxed text-zinc-300 space-y-4 apple-fade delay-100">
        <div className="text-zinc-500">// Execution Topology (v1.3 AWS Well-Architected)</div>
        <pre className="text-zinc-300 overflow-x-auto">
{`┌──────────────────────────────────────────────────────────────┐
│ 1. CLIENT LAYER (Zero Local Daemon)                          │
│    VS Code Extension v1.3.0 · Cloud Console · Headless CLI   │
│    AHP SSE Streaming · Virtual lyra-patch: Diff Preview      │
└──────────────────────────────┬───────────────────────────────┘
                               │ AHP v1.3 (SSE + JSON-RPC 2.0)
┌──────────────────────────────▼───────────────────────────────┐
│ 2. ADAPTIVE GATEWAY & PARETO ROUTER (:3001)                  │
│    IntentTriage (<1ms): Lane 0 Ask · Lane 1 Fast Patch       │
│    ModelDecisionEngine: Frugal / Balanced / Frontier + EWMA  │
│    Better Auth (Aurora/RDS Postgres + WebAuthn Passkeys)     │
└──────────────┬───────────────────────────────┬───────────────┘
   Lane 0 / 1  │ Direct ConverseStream         │ Lane 2 (>6KB S3 Claim-Check)
               │ + Prompt Caching              ▼
               │                ┌──────────────────────────────┐
               │                │ 3. AMAZON SQS + DLQ          │
               │                │    RunQueue (20s Long-Poll)  │
               │                │    Visibility Heartbeats     │
               │                └──────────────┬───────────────┘
               ▼                               ▼
┌──────────────────────────────────────────────────────────────┐
│ 4. ISOLATED AWS BEDROCK & FARGATE EXECUTION                  │
│    Cross-Region Profiles (us.*) · Automatic Pareto Failover  │
│    Pre-Warmed Git Worktrees · Risk-Gated Plan Approval       │
│    Verification Gates (Bun AST / tsc / tests) + Tier+1 Repair│
│    CloudWatch EMF Structured Telemetry (Lyra/AgentHarness)   │
└──────────────────────────────────────────────────────────────┘`}
        </pre>
      </div>

      <div className="space-y-6 text-xs text-zinc-400 leading-relaxed apple-fade delay-200">
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-white">3-Lane Adaptive Execution</h2>
          <p>
            Every turn passes through a sub-millisecond classifier before allocating infrastructure. Questions stream directly over Bedrock <code className="text-zinc-200">ConverseStream</code> with Prompt Caching (<code className="text-zinc-200">cachePoint</code>); focused single-file fixes run through <code className="text-zinc-200">FastLaneExecutor</code> with in-memory <code className="text-zinc-200">Bun.Transpiler</code> syntax verification and stream a unified diff to VS Code without worktree overhead; multi-file objectives dispatch to the parallel cloud swarm.
          </p>
        </div>

        <div className="space-y-2">
          <h2 className="text-sm font-medium text-white">Pareto Failover &amp; FinOps-Bounded Escalation</h2>
          <p>
            The <code className="text-zinc-200">ModelDecisionEngine</code> scores active Bedrock models across capability fit, token cost, and live EWMA Time-to-First-Token (TTFT). On Bedrock throttling or 5xx errors, turns fail over automatically to the next cross-provider Pareto candidate. On syntax or unit-test verification failure, repair attempts escalate one capability tier upward within the per-run FinOps spend cap.
          </p>
        </div>

        <div className="space-y-2">
          <h2 className="text-sm font-medium text-white">Amazon SQS, Dead-Letter Queue &amp; S3 Claim-Check</h2>
          <p>
            Swarm payloads exceeding 6,000 bytes are offloaded to encrypted S3 (<code className="text-zinc-200">ArtifactBucket</code>) and passed via lightweight SQS claim-check pointers, eliminating ECS <code className="text-zinc-200">RunTask</code> environment override size limits. Warm Fargate workers consume messages via 20-second long-polling and renew visibility leases until completion, redriving poisoned runs to <code className="text-zinc-200">RunQueueDlq</code>.
          </p>
        </div>

        <div className="space-y-2">
          <h2 className="text-sm font-medium text-white">Pre-Warmed Worktrees &amp; Structured CloudWatch EMF</h2>
          <p>
            During Lead Architect planning, git worktrees pre-warm in parallel and low-risk plans auto-proceed via <code className="text-zinc-200">DecisionEngine</code> risk gating, while <code className="text-zinc-200">ScribeAgent</code> documentation updates run asynchronously off the critical path. Every turn emits structured AWS CloudWatch Embedded Metric Format payloads under <code className="text-zinc-200">Lyra/AgentHarness</code>.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Architecture;
