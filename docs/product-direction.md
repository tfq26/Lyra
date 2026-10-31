# Lyra Product Direction: The Engineering Operations Cockpit

## 1. Executive Summary & One-Line Positioning

> **Lyra is the Autonomous Engineering Operations Cockpit that turns high-level product objectives into verified, cost-audited, production-ready software.**

Lyra is **not an IDE** (like Kiro or Cursor) and **not a terminal CLI harness** (like Claude Code, Codex, or Antigravity). It is the **Air Traffic Control and Assembly Line** that orchestrates frontier models as strategic architects, native workers as a precision manufacturing floor, and AWS as an automated deployment pipeline.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        LYRA OPERATIONS COCKPIT                         │
├────────────────────────────────────────────────────────────────────────┤
│ 1. STRATEGIC APPRAISAL (Staff Engineer Mindset)                        │
│    • Resolves XY Problems  • Reuses Existing Assets  • Audits Scale    │
├────────────────────────────────────────────────────────────────────────┤
│ 2. CROSS-MODEL ARCHITECT COUNCIL (Multi-Vendor Reasoning)              │
│    • Lead Architect (e.g., Claude) ◄──► Red-Team Adversary (e.g., o3)  │
├────────────────────────────────────────────────────────────────────────┤
│ 3. PRECISION FACTORY FLOOR (Lyra Native Strands Workers)               │
│    • Atomic Micro-Tasks  • Isolated Git Worktrees  • In-Process Tools  │
├────────────────────────────────────────────────────────────────────────┤
│ 4. PRODUCTION SAFETY & DEPLOYMENT GATEWAY                              │
│    • Cloud Cost Telemetry  • Migration Canary  • 1-Click AWS Preview   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. The Market Problem & Competitive Differentiation

| Vector | The IDEs (Kiro, Cursor, Windsurf) | The CLI Harnesses (Claude Code, Antigravity, Codex) | **Lyra (Operations Cockpit)** |
| :--- | :--- | :--- | :--- |
| **Mental Model** | Text editor with AI auto-complete and chat. | Headless developer sitting in your terminal shell. | **Autonomous factory floor and mission control.** |
| **Target User** | Solo developer writing lines of code manually. | Developer executing terminal commands via text. | **Engineering teams & junior developers needing Staff-level guardrails.** |
| **Model Strategy** | Single-vendor lock-in (Kiro = Bedrock only). | Single CLI model loop per session. | **Heterogeneous council (e.g. Anthropic plans, OpenAI red-teams, Bedrock/OpenRouter executes).** |
| **Execution Surface** | Main workspace files in the open editor. | Local dirty working directory via PTY terminal streams. | **Deterministic Git worktree isolation with zero-touch rollback.** |
| **Scale & Safety** | None (trusts whatever passes manual check). | None (focuses on code syntax and process exit 0). | **Automated FinOps cost check, DB migration canary, and API contract protection.** |

---

## 3. The Four Core Pillars of Lyra

### Pillar 1: Strategic Solution Appraisal (The Staff Engineer Filter)
* **Goal**: Prevent the junior developer / customer "XY Problem" before any code is written.
* **Mechanism**:
  1. **Intent Validation**: Evaluates whether the requested feature solves the root requirement without causing unintended side effects.
  2. **Asset Audit**: Inspects `package.json`, existing services, and internal helpers to ensure the system reuses existing code and AWS primitives rather than inventing new dependencies.
  3. **Trade-Off Matrix**: Generates 2–3 explicit implementation paths (e.g., *Quick Synchronous* vs. *Scalable Asynchronous Event-Driven*) with complexity, cost, and maintenance tradeoffs clearly stated.

### Pillar 2: The Cross-Model Architect Council
* **Goal**: Eliminate single-vendor blind spots and prompt hallucinations.
* **Mechanism**:
  1. External frontier harnesses (Claude Code, Antigravity, or OpenAI) run in **strict read-only inspection mode**. They do not write code; they act as the Lead Architect.
  2. An independent adversarial model (via OpenRouter or Bedrock) runs an automated **Failure Mode Pre-Mortem** (concurrency deadlocks, network timeouts, auth bypass, rate limits).
  3. The resulting spec is broken into an atomic **Micro-Task DAG** with strict input/output contracts, affected file boundaries, and verification commands.

### Pillar 3: Precision Native Factory Floor
* **Goal**: 10x cheaper, 5x faster, and 100% immune to terminal/PTY parsing bugs.
* **Mechanism**:
  1. Tasks are delegated to **Lyra Native Strands Workers** using high-throughput, cost-effective models (Claude 3.5 Haiku, Bedrock Nova, or Qwen/Llama via OpenRouter).
  2. Each worker operates within its own **isolated Git worktree** (`worktreeManager.ts`).
  3. Native tools (`editFile`, `readFile`, `runCommand`) edit code deterministically in-process—no ANSI escape sequences, no terminal hang-ups.
  4. Work is only merged into the integration branch once local verification checks (`bun test`, `tsc --noEmit`) pass.

### Pillar 4: Production Safety & One-Click Cloud Delivery
* **Goal**: Turn verified code into running cloud software without DevOps headaches.
* **Mechanism**:
  1. **FinOps Cost Impact**: Warns the developer if new infrastructure or API patterns will increase monthly cloud spend.
  2. **Bidirectional Migration Canary**: Validates database schema changes on ephemeral test containers (`up -> down -> up`) to guarantee zero-downtime rollback.
  3. **Ephemeral Worktree Previews**: Boots a local or Fargate dev server on an isolated port to let the developer test the live application before merging.
  4. **Living Architectural Documentation**: Automatically generates Mermaid sequence/entity diagrams and formal Architecture Decision Records (ADRs) committed directly to the repo.

---

## 4. Immediate Roadmap: What to Keep, What to Cut, What to Build

### What to Cut / Deprecate
* **Cut external CLI coding workers**: Do not use Claude Code or Antigravity to write boilerplate code or run bash edits. It is brittle and expensive.
* **Cut generic chat interactions**: Stop behaving like a general conversational chatbot; orient the entire UI around Objectives, Appraisals, Swarm Tasks, and Verification Evidence.

### What to Keep & Refactor
* **Keep `worktreeManager.ts`**: This is Lyra's superpower. Every worker and preview runs in an isolated worktree.
* **Keep `planValidator.ts` & `teamCoordinator.ts`**: Evolve the planning step from a simple JSON prompt into the **Strategic Solution Appraisal**.
* **Keep Native Strands Agent (`nativeAgentRuntime.ts`)**: Make this the sole execution engine for file edits and verification.

### What to Build Next
1. **The Appraisal Card UI**: A clear 4-point design review presented to the user before tasks start (Problem Check, Reused Tools, Cost, Recommended Path).
2. **Read-Only Architect Harness Hook**: A configuration that runs the external CLI strictly to produce the Micro-Task DAG.
3. **Worktree Live Preview Link**: A one-click button in the UI that launches the isolated worktree dev server so the user can see their changes live side-by-side.
