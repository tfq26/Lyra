# Lyra Architecture & Core Subsystems

Lyra serves two roles in the ecosystem:

1. **Hosted Hub (`https://lyra.2helix.org`)**: Centralized Better Auth identity, Google OAuth handoff for local/desktop Gram instances, and the `/api/gateway/llm/stream` LLM proxy.
2. **Autonomous Swarm & Strands Runtime**: Multi-lane coding execution with Git shadow worktrees, verification gates, AWS Bedrock routing, and optional ECS Fargate cloud offload.

## Deployment Architecture

In production, traffic arrives at Cloudflare Workers (`worker.ts`) and routes into the `LyraContainer` Durable Object (`cloudflare.config.ts`), running `server/index.ts` inside a Node/Bun container (`Dockerfile`) on port `3001`:

```text
Gram / Browser / MCP Client
          |
          | HTTPS (lyra.2helix.org)
          v
Cloudflare Worker + Durable Object (`worker.ts`)
          |
          v  Container port 3001
Lyra HTTP & WebSocket Server (`server/index.ts`)
   ├── Auth: Better Auth (`server/betterAuth.ts`) -> SQLite or AWS Aurora Postgres
   ├── LLM Gateway (`server/gatewayLlmProxy.ts`) -> AWS Bedrock / OpenRouter / Ollama
   ├── Execution (`strandsHarness.ts`, `teamCoordinator.ts`, `worktreeManager.ts`)
   └── AWS Cloud (`ecsNativeDispatcher.ts`, `sqsTaskQueue.ts`, `previewDeployer.ts`)
```

## Subsystems

### 1. Better Auth and Multi-Surface Sessions (`server/betterAuth.ts`, `server/index.ts`)

- Supports Google OAuth, email/password, account linking (`requireLocalEmailVerified: false` so Google logins link cleanly with matching email accounts), and WebAuthn passkeys.
- Enables CORS + `trustedOrigins` for local Gram web (`localhost:5174`, `localhost:7337`), the Vite portal (`localhost:5173`), and Tauri (`tauri://localhost`).
- Provides `/api/auth/gram-start` and `/api/auth/gram-handoff` so native desktop clients can sign in via the user's system browser without third-party cookie restrictions inside WebViews.

### 2. Central LLM Gateway (`server/gatewayLlmProxy.ts`)

- Accepts OpenAI-style/neutral `messages` + `tools` payloads at `POST /api/gateway/llm/stream` and translates them to either AWS Bedrock `ConverseStreamCommand` (inserting `cachePoint` blocks when `supportsPromptCaching` is enabled and content meets threshold) or OpenRouter/OpenAI-compatible `/chat/completions`.
- Enforces `standard`, `zdr`, and `local-only` privacy policies via `enforcePrivacyPolicy()` before dispatching upstream requests.
- Aborts upstream Bedrock/fetch streams only on true client disconnect (`req.on('aborted')` or `res.on('close')` when `!res.writableEnded`), avoiding premature aborts when `IncomingMessage` finishes reading the POST body.
- Sends structured `diagnostics` (`provider`, `model`, `aborted`, `abortReason`, `errorName`, `errorCode`, `httpStatusCode`, `awsRequestId`, `elapsedMs`) on any `type: "error"` SSE event.

### 3. 3-Lane Adaptive Pipeline (`server/intentTriage.ts`, `server/fastLaneExecutor.ts`, `server/teamCoordinator.ts`)

- **Lane 0 (Instant Ask)**: Direct Bedrock `ConverseStreamCommand` response for Q&A turns without spawning worktrees.
- **Lane 1 (Fast Patch)**: Single-file `<lyra_patch>` edits syntax-checked in memory before streaming diffs to the client.
- **Lane 2 (Full Swarm)**: Plan decomposition into a task DAG executed in parallel Git shadow worktrees under `.lyra/worktrees/`, serialized integration merges, independent review, and verification checks (`tsc`, builds, unit tests).

### 4. Shadow Worktrees (`server/worktreeManager.ts`)

Swarm tasks branch from `HEAD` inside `.lyra/worktrees/run-*` so workers never clobber dirty uncommitted edits in the user's primary working tree. Completed task branches merge sequentially into a run integration worktree before verification.

### 5. Verification, Night Shift, and Maintenance (`server/proofSandbox/`, `server/nightShift/`, `server/maintenanceCaretaker.ts`)

- **Verification & Proof Sandbox**: Runs project checks (`tsc`, builds, tests) against integrated changes before marking runs green.
- **Night Shift**: Runs unattended investigations (`scripts/lyra-nightshift.ts` or `/api/nightshift/*`) to isolate compiler/test regressions.
- **Maintenance Caretaker**: Audits dependencies and deprecations in an isolated worktree and discards changes automatically if checks fail.

### 6. Model Routing, Guardrails, and FinOps (`server/modelDecisionEngine.ts`, `server/bedrockGuardrails.ts`, `server/finopsAnalyzer.ts`)

- `modelDecisionEngine.ts` ranks non-legacy Bedrock models using policy profiles (`Frugal`, `Balanced`, `Frontier`), latency EWMA tracking, and cross-provider cooldown failover on throttling or 5xx responses.
- `bedrockGuardrails.ts` and `security.ts` redact leaked tokens (`AKIA...`, `ghp_...`, private keys) and block destructive commands before execution.
- `finopsAnalyzer.ts` enforces per-run and monthly spend limits and computes estimated infra cost deltas.

### 7. AWS Cloud Offload and Observability

- `server/sqsTaskQueue.ts` offloads payloads larger than 6 KB to S3 (claim-check pattern) and queues Fargate task envelopes in SQS.
- `server/ecsNativeDispatcher.ts` dispatches isolated cloud tasks onto AWS ECS Fargate.
- `server/previewDeployer.ts` publishes build outputs to S3 / CloudFront (with local server fallback).
- `server/cloudwatchEmf.ts` writes CloudWatch Embedded Metric Format records under namespace `Lyra/AgentHarness`.

### 8. MCP Server (`server/harnessMcpServer.ts`, `scripts/mcp-server-stdio.ts`)

Exposes swarm dispatch, run status, pending permissions/context requests, diff inspection, conflict resolution, QA sandbox runs, maintenance runs, and GitHub PR creation over MCP for external tools.
