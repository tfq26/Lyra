# Lyra

**Lyra** is the cloud brain, authentication hub, multi-provider LLM gateway, and swarm runner powering **[Gram](../Gram)** (`https://lyra.2helix.org`).

> Looking to run locally, configure secrets, or deploy to Cloudflare / AWS? See **[SETUP.md](SETUP.md)**.  
> For the full product overview, user flows, and roadmap through the Gram workspace, see **[Gram/README.md](../Gram/README.md)**.

---

## Why Lyra Exists

Gram keeps your code, `GramFS` overlays, Semantic Graph, and Personal Context fast and private on your own machine—while **Lyra** handles everything that benefits from a unified cloud control plane:

- **Single Sign-On Without Key Juggling:** Better Auth (Google OAuth, email/password, WebAuthn passkeys) issues browser sessions and Tauri desktop handoff tokens (`/api/auth/gram-start`, `/api/auth/gram-handoff`) so Gram connects securely without manual API key setup.
- **Multi-Provider Resilience (`auto` Routing):** Instead of hardcoding a single model vendor, Lyra's `UnifiedModelCatalog` and `ModelDecisionEngine` route `auto` requests across **Amazon Bedrock**, **Microsoft Azure AI Foundry** (`gpt-4o`, `MAI-Thinking-1`, `Phi-4-reasoning`), and **OpenRouter**—evaluating only configured, healthy, non-cooldown routes and failing over automatically on `400`, `403`, `404`, `429`, `503`, or `529`.
- **Privacy & Secret Guardrails:** Enforces `standard`, `zdr` (zero data retention), and `local-only` policies, redacts inline secrets (`server/security.ts`), and emits structured `diagnostics` on SSE errors.
- **Adaptive Execution & Cloud Swarms:** Routes turns across instant replies, single-file AST-verified patches (`server/fastLaneExecutor.ts`), isolated Git worktree swarms (`server/teamCoordinator.ts`, `server/worktreeManager.ts`), and optional AWS ECS Fargate / SQS offloading (`server/ecsNativeDispatcher.ts`, `server/sqsTaskQueue.ts`).
- **MCP & Telemetry:** Exposes Lyra tools over MCP (`server/harnessMcpServer.ts`) and emits CloudWatch Embedded Metric Format telemetry (`server/cloudwatchEmf.ts`).

---

## Current State & Roadmap

- **Currently Working:** Cloudflare Containers production deployment (`lyra.2helix.org`), Better Auth + Google OAuth + Tauri desktop handoff, multi-provider LLM gateway (Bedrock + Azure AI Foundry + OpenRouter) with configured-pool `auto` selection and automatic cooldown/failover, privacy policy enforcement, and SQLite/PostgreSQL persistence.
- **In Progress:** Scaling AWS Fargate/SQS/Aurora swarm offloading, proof-sandbox verification pipelines (`server/proofSandbox/`), and expanding deployed Foundry/Bedrock model coverage.
- **Future Features:** Trajectory-based mid-run model escalation, deeper multi-agent council/review workflows, and expanded MCP PR/maintenance automation.

---

## Further Documentation

- **[SETUP.md](SETUP.md)** -- Local dev, Cloudflare/AWS deployment, environment variables, and test commands
- **[docs/api.md](docs/api.md)** -- HTTP, SSE gateway, Better Auth handoff, and WebSocket endpoints
- **[docs/architecture-and-features.md](docs/architecture-and-features.md)** -- System architecture, routing, worktrees, and AWS integrations
- **[docs/product-spec.md](docs/product-spec.md)** -- Native Strands coding harness specification
- **[infra/aws/README.md](infra/aws/README.md)** -- AWS infrastructure templates and deployment notes
