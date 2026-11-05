# Lyra — Adaptive Cloud Engineering Swarm & Universal Agent Harness

Lyra (`v1.3`) is a **24/7 cloud-native autonomous engineering platform** built on **Amazon Bedrock**, **Amazon SQS + S3 Claim-Check**, **AWS ECS Fargate**, and the **Agent Host Protocol (AHP v1.3)**.

Lyra replaces laptop-tethered AI coding tools with an adaptive, multi-lane cloud runtime: sub-second streaming answers and surgical AST-verified patches when you want instant velocity, and durable, worktree-isolated multi-agent swarms when you want autonomous multi-file engineering—syncing across **VS Code**, **Antigravity IDE**, and the **Web Portal** with zero local daemon or battery drain.

---

## Architecture Highlights (AWS Well-Architected v1.3)

### 1. 3-Lane Adaptive Execution Engine (`< 1ms` Triage)
Instead of forcing simple questions or 3-line fixes through a 30-second container + git worktree pipeline, `IntentTriage` routes every turn in under `1ms` (with optional user override `Auto / Ask / Fast Patch / Swarm` and 1-click *Escalate to Swarm*):
- **Lane 0 — Instant Ask**: Direct Amazon Bedrock `ConverseStreamCommand` streaming over AHP SSE with Bedrock Prompt Caching (`cachePoint: { type: 'default' }`) for sub-second TTFT.
- **Lane 1 — Fast Patch**: Single-file surgical `<lyra_patch>` edits verified in-memory (`< 3ms`) via `Bun.Transpiler` / JSON syntax checks and AST export-preservation guards without spawning git worktrees, streamed directly to VS Code with native side-by-side virtual diff preview (`lyra-patch:`) and 1-click `vscode.WorkspaceEdit` application.
- **Lane 2 — Full Cloud Swarm**: Parallel DAG execution across pre-warmed git worktrees (`lyra/task-*`), risk-gated plan auto-approval (`DecisionEngine`), compiler/unit-test verification gates, and off-critical-path `ScribeAgent` synthesis.

### 2. Autonomous Night Shift & Proof Sandbox
- **Unattended 24/7 Self-Healing**: `NightShiftEngine` runs scheduled or on-demand deep bug investigations, compiler log diagnoses, and multi-file repair loops without manual supervision.
- **Containerized Proof Sandbox**: `ProofSandbox` isolates verification runs (`tsc`, `npm run build`, `bun test`, unit tests) and generates deterministic, cryptographic **Proof Certificates** before code touches main branches.
- **AST Invariant Guard & Log Resolution**: Suffix-matching invariant detector resolves compiler errors from bare filenames (e.g., `hooks.ts` → `src/components/Canvas/hooks.ts`) and enforces AST invariants to prevent accidental deletion of existing exported interfaces or functions.

### 3. Multi-Model Council (Architectural Consensus)
- **3-Seat Parallel Debate**: Orchestrates distinct Bedrock models simultaneously (e.g., Frontier Architect, Security Auditor, and FinOps Specialist) to evaluate major architectural refactors, trade-offs, and migrations.
- **Consensus & Dissent Synthesis**: Aggregates structured scores and resolves dissents before executing complex swarms or irreversible database operations.

### 4. Reinforced AWS Bedrock Pareto Router & Recovery
- **Multi-Objective Policy Profiles (`Frugal` / `Balanced` / `Frontier`)**: `ModelDecisionEngine` dynamically scores active non-legacy Bedrock models across capability fit, predicted token cost, and live EWMA Time-to-First-Token (TTFT), plus supports explicit manual model pinning.
- **Cross-Region Inference Profiles (`us.*`) & Prompt Caching**: Discovers active Bedrock Inference Profiles via `ListInferenceProfilesCommand` to distribute burst throughput across US regions while reducing repeated prefix spend via `cachePoint` blocks.
- **Cross-Provider Throttle Failover & FinOps-Bounded Tier Escalation**: Automatically fails over across providers (e.g., Anthropic → Qwen / Amazon Nova) on Bedrock `ThrottlingException` / 5xx with a 60s EWMA cooldown penalty, and escalates `+1` capability tier on compiler or unit-test verification failure bounded by a per-run FinOps spend ceiling.

### 5. Durable Amazon SQS + DLQ + S3 Claim-Check Queueing
- **Eliminates ECS 6KB Override Bottlenecks**: `SqsTaskQueue` automatically offloads large task/context payloads (`> 6,000` bytes) to KMS/AES-256 encrypted Amazon S3 (`ArtifactBucket`) and enqueues lightweight claim-check envelopes to `RunQueue`.
- **Warm Fargate Long-Polling & Heartbeats**: ECS Fargate workers consume `RunQueue` via 20-second SQS long-polling (`WaitTimeSeconds: 20`) to eliminate container cold-start latency, renew `ChangeMessageVisibility` leases while healthy, and redrive poisoned tasks after 3 crashes to `RunQueueDlq`.

### 6. Lyra Connect: Cross-Device Continuity (Spotify Connect for AI Agents)
- **Continuous Session Handoff**: Cloud-native session continuity protocol allowing seamless handoff between VS Code, Antigravity IDE, Web Portal, and mobile devices.
- **Sequence-Delta Synchronization (`sinceSeq`)**: Lightweight delta streams sync active generation state, plan DAG checkpoints, and virtual diffs across devices with zero dropped tokens or out-of-order mutations.

### 7. Structured AWS CloudWatch EMF Observability
- `CloudWatchEmfRegistry` emits zero-dependency AWS CloudWatch Embedded Metric Format (`_aws.CloudWatchMetrics`) payloads under namespace `Lyra/AgentHarness` (`TTFT_ms`, `TurnDuration_ms`, `EstimatedCostUsd`, `CacheHitRatioPct`, `FailoverCount`, `TierEscalation`, `QueueDepth`) and powers the live `/console` dashboard (Pareto savings vs. Frontier baseline, Prompt Cache hit ratio, and SQS/DLQ health).

---

## Execution Topology

```
┌───────────────────────────────────────────────────────────────────┐
│ 1. CLIENT LAYER (Zero Local Daemons · Lyra Connect)              │
│    • VS Code & Antigravity Extension (lyra-swarm-1.3.0.vsix)      │
│    • Native lyra-patch: Virtual Diff Preview & WorkspaceEdit      │
│    • Web Portal & Cloud Console (/console)                        │
└─────────────────────────────────┬─────────────────────────────────┘
                                  │ AHP v1.3 (SSE Stream + JSON-RPC 2.0)
┌─────────────────────────────────▼─────────────────────────────────┐
│ 2. ADAPTIVE GATEWAY & PARETO ROUTER (:3001)                       │
│    • IntentTriage (<1ms): Instant Ask · Fast Patch · Full Swarm   │
│    • Multi-Model Council (Frontier · Security · FinOps)           │
│    • ModelDecisionEngine (Frugal / Balanced / Frontier + EWMA)    │
│    • Better Auth (Aurora/RDS Postgres + WebAuthn Passkeys + SES)  │
└───────────────┬───────────────────────────────────┬───────────────┘
    Lane 0 / 1  │ Direct ConverseStream             │ Lane 2 (>6KB S3 Claim-Check)
                │ + Prompt Caching                  ▼
                │                   ┌───────────────────────────────┐
                │                   │ 3. AMAZON SQS + DLQ           │
                │                   │    RunQueue (20s Long-Poll)   │
                │                   │    Visibility Lease Heartbeats│
                │                   └───────────────┬───────────────┘
                ▼                                   ▼
┌───────────────────────────────────────────────────────────────────┐
│ 4. ISOLATED AWS BEDROCK & FARGATE EXECUTION                       │
│    • Cross-Region Inference Profiles (us.*) + Auto-Failover       │
│    • Pre-Warmed Git Worktrees + Risk-Gated Plan Auto-Approval     │
│    • Proof Sandbox (Verification Gates · AST Invariants)          │
│    • Autonomous Night Shift (Unattended Self-Healing Swarm)       │
│    • CloudWatch EMF Telemetry (Namespace: Lyra/AgentHarness)      │
└───────────────────────────────────────────────────────────────────┘
```

---

## Proven Case Study: Autonomous CollabCanvas Overhaul

In empirical benchmark testing, Lyra's autonomous engine tackled **CollabCanvas**—a broken, minimal prototype with failing TypeScript compilation:
- **Autonomous Night Shift Resolution**: Analyzed compiler logs, detected missing JSX configuration (`TS17004`), resolved recursive Quadtree imports, patched CRDT listener spread typings, and produced a **100% verified green build** in 85.7s.
- **Production-Grade UI Elevation**: Upgraded the canvas to a FigJam/Miro-grade collaborative experience:
  - FigJam-style bottom dock toolbar with 6 pastel color presets and undo/redo stacks.
  - Floating top bar with editable board title, sync status indicator, and collaborator avatars.
  - Viewport HUD with continuous zoom controls, world coordinates, and 1-click **Fit to Content** bounding box calculation.
  - Tactile sticky notes with category tagging, 1-click color palette dial, duplicate/trash actions, and corner resize handles.
  - Multiplayer cursor presence simulation and interactive keyboard shortcuts (`?`, `V`, `H`, `N`, `Cmd+D`, `Cmd+Z`).

---

## Authentication & Passkey Sync

Lyra features a unified authentication layer powered by **Better Auth**:
- **AWS Cloud Storage**: In hosted environments, accounts, sessions, and passkeys persist in **Amazon RDS / Aurora PostgreSQL** (`infra/aws/template.yaml`) with transactional email handled by **Amazon SES** and secrets managed in **AWS Secrets Manager**. In local development, it falls back seamlessly to persistent SQLite (`server/data/auth.sqlite`).
- **WebAuthn Passkeys**: Passwordless biometric authentication (Touch ID, Face ID, Windows Hello, YubiKey) via `@better-auth/passkey`.
- **Cross-Surface Sync**: Session cookies and bearer sync tokens issued at `/account` authenticate REST endpoints, `/console` telemetry, AHP SSE streams, and the VS Code extension.

---

## VS Code & Antigravity Extension (`v1.3.0`)

Built strictly on native VS Code theme variables (`var(--vscode-*)`):
- **Adaptive Mode & Policy Controls**: Switch between `Auto`, `Ask`, `Fast Patch`, and `Swarm` modes, select `Balanced`, `Frugal`, or `Frontier` Pareto profiles, or pin any active Bedrock model.
- **Native Diff Preview & 1-Click Patch Apply**: Fast Patch turns stream surgical edits with `Apply Patch`, native side-by-side `Preview Diff` (`lyra-patch:`), optional `Auto-Apply`, and `1-Click Escalate to Swarm`.
- **Cloud Sessions TreeView & Universal Chat**: Real-time `lyraCloudSessions` sidebar synced continuously across workstations via Lyra Connect.

### Install Extension
```bash
code --install-extension extensions/vscode/lyra-swarm-1.3.0.vsix
```

---

## Active AWS Bedrock Pareto Catalog

| Model | Provider | Cross-Region Profile / ID | Tier & Capabilities |
| :--- | :--- | :--- | :--- |
| **Claude Sonnet 5** | Anthropic | `us.anthropic.claude-sonnet-5` | Tier 3 · Frontier Implementation & Prompt Caching |
| **Claude Opus 5.5** | Anthropic | `us.anthropic.claude-opus-5-5` | Tier 4 · Deep Architecture & Formal Reasoning |
| **Claude Haiku 4.5** | Anthropic | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | Tier 1 · Sub-400ms TTFT Instant Ask & Fast Patch |
| **Amazon Nova 2 Lite** | Amazon | `us.amazon.nova-2-lite-v1:0` | Tier 1 · Frugal Triage ($0.06/M) & Scribe Docs |
| **Amazon Nova Pro** | Amazon | `us.amazon.nova-pro-v1:0` | Tier 2 · 300k Multimodal Context & Coding |
| **Qwen3 Coder 480B** | Qwen | `qwen.qwen3-coder-480b-a35b-v1:0` | Tier 3 · High-Precision Multi-File Refactoring |
| **DeepSeek-R1** | DeepSeek | `us.deepseek.r1-v1:0` | Tier 4 · Algorithmic Proofs & Concurrency Invariants |
| **Llama 3.3 70B** | Meta | `us.meta.llama3-3-70b-instruct-v1:0` | Tier 2 · Open-Weights Worktree Worker ($0.72/M) |

---

## Quickstart & Verification

### 1. Start Backend Gateway & Web Portal
```bash
# Terminal 1: Launch Lyra Cloud Gateway (:3001)
bun run server/index.ts

# Terminal 2: Launch Web Portal & Cloud Console (:5173)
cd site && bun run dev
```
- **Overview & Live Model Registry**: `http://localhost:5173`
- **Cloud Console (Sessions, Pareto FinOps & EMF Ledger)**: `http://localhost:5173/console`
- **Architecture & System Design**: `http://localhost:5173/architecture`
- **Interactive Documentation**: `http://localhost:5173/docs`
- **Account & Passkey Login**: `http://localhost:5173/login`

### 2. Autonomous Night Shift Verification Run
```bash
# Run autonomous unattended bug investigation and proof verification
bun run scripts/lyra-nightshift.ts --workspace /path/to/repo --test "npm run build"
```

### 3. Run Typecheck, Build & Test Suites
```bash
# Full TypeScript validation (backend + scripts)
npx tsc --noEmit

# Production Vite build for Web Portal
cd site && npx vite build

# Adaptive 3-lane triage, Pareto failover/escalation, SQS Claim-Check & CloudWatch EMF tests
bun test server/adaptivePipeline.test.ts server/ahpProtocol.test.ts server/gateway.test.ts server/ecsNativeDispatcher.test.ts server/bedrockModelCatalog.test.ts server/modelDecisionEngine.test.ts server/teamCoordinator.test.ts
```

---

## License
Engineered under the Apache 2.0 License.
