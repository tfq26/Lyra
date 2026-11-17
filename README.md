# Lyra

Lyra is the cloud backend, authentication hub, LLM gateway proxy, and swarm runner for [Gram](../Gram) and external coding harnesses.

Production runs on Cloudflare Containers (`https://lyra.2helix.org`) via `cloudflare.config.ts` and `worker.ts`, routing inference to Amazon Bedrock and OpenRouter, authenticating users with Better Auth, and persisting runs either in local SQLite (`server/data/`) or AWS PostgreSQL/SQS/Fargate when configured.

## What Lyra Handles

1. **Authentication Hub (`server/betterAuth.ts`, `server/index.ts`)**:
   - Powered by Better Auth with Google OAuth, email/password accounts, account linking (`trustedProviders: ['google']`), and WebAuthn passkeys.
   - Issues both browser cookies and Bearer session tokens (`/api/auth/gram-start`, `/api/auth/gram-handoff`) so desktop and web Gram clients can sign in without copying API keys manually.
   - Uses SQLite (`server/data/auth.sqlite`) in local/container mode by default, or AWS Aurora/RDS PostgreSQL (`auth` schema) when `LYRA_DATABASE_HOST` is set.
2. **Central LLM Gateway (`server/gatewayLlmProxy.ts`)**:
   - `POST /api/gateway/llm/stream` proxies streaming, tool-capable turns to Amazon Bedrock (`ConverseStreamCommand` with prompt caching) and OpenRouter / OpenAI-compatible endpoints.
   - Enforces `standard`, `zdr` (zero data retention), and `local-only` privacy policies, redacts inline credentials (`server/security.ts`), and emits structured `diagnostics` on SSE stream errors.
3. **Adaptive Execution and Swarm Orchestration**:
   - `server/intentTriage.ts` routes turns across instant responses, single-file AST-verified patches (`server/fastLaneExecutor.ts`), and full multi-agent DAG swarms (`server/teamCoordinator.ts`).
   - `server/worktreeManager.ts` isolates swarm tasks into Git shadow worktrees (`.lyra/worktrees/`) and `server/proofSandbox/` runs verification commands before integration.
   - `server/ecsNativeDispatcher.ts` and `server/sqsTaskQueue.ts` support offloading cloud runs to AWS ECS Fargate via Amazon SQS + S3 claim-check.
4. **MCP Server and Telemetry**:
   - `server/harnessMcpServer.ts` (and `scripts/mcp-server-stdio.ts`) exposes Lyra tools over MCP (`lyra_dispatch_task`, `lyra_get_run_status`, `lyra_inspect_diff`, `lyra_create_github_pr`, etc.).
   - `server/cloudwatchEmf.ts` emits CloudWatch Embedded Metric Format telemetry.

## Running Locally

Prerequisites: [Bun](https://bun.sh) 1.2+.

```bash
bun install
```

Start the Lyra HTTP + WebSocket server on port `3001`:

```bash
bun run dev
```

Start the React web portal on port `5173` (optional):

```bash
cd site && bun run dev
```

Important URLs in local dev:

- `http://localhost:3001/api/health` -- Hub liveness check
- `http://localhost:3001/api/auth/status` -- Public auth provider capabilities
- `http://localhost:5173` -- Web portal
- `http://localhost:5173/console` -- Cloud console and telemetry view
- `http://localhost:5173/login` -- Sign-in and passkey management

## Deploying to Production

### Cloudflare Containers (`https://lyra.2helix.org`)

`cloudflare.config.ts` binds the Durable Object container (`LyraContainer` in `worker.ts`, built from `Dockerfile`) to `lyra-hub` on domain `lyra.2helix.org`.

```bash
bunx cf deploy
```

Make sure secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BETTER_AUTH_SECRET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, and optionally `LYRA_GATEWAY_API_KEY`) are configured in Cloudflare Worker secrets so `worker.ts` forwards them into the container environment.

### AWS Fargate Runner

```bash
bun run deploy:aws
```

See [infra/aws/README.md](infra/aws/README.md) for CloudFormation stack parameters and VPC/EFS/RDS setup.

## Environment Variables

`server/index.ts` loads `.env.local` and `.env` on startup, and refreshes temporary AWS credentials via `aws configure export-credentials --format process` every 10 minutes when static AWS keys are absent.

| Variable | Default / Fallback | Purpose |
| :--- | :--- | :--- |
| `PORT` / `LYRA_HUB_PORT` | `3001` | HTTP and WebSocket listen port (`worker.ts` uses `3001`) |
| `BETTER_AUTH_URL` | `http://localhost:3001` | Public base URL (`https://lyra.2helix.org` in production) |
| `BETTER_AUTH_SECRET` | Auto-generated in `server/data/.auth-secret` | Session signing secret (set explicitly in production) |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Local dev ports + `tauri://localhost` | Comma-separated extra allowed origins |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | unset | Enables Google OAuth (`googleEnabled: true`) |
| `LYRA_HOSTED` | unset (`false`) | Enables hosted security mode (`true` in `worker.ts`) |
| `LYRA_AUTH_DISABLE_SIGNUP` | unset (`false`) | Set to `true` to disable new self-service registrations |
| `LYRA_GATEWAY_API_KEY` | unset | Static API key accepted alongside Better Auth sessions |
| `AWS_REGION` | `us-east-1` | Region for Bedrock, Secrets Manager, SES, SQS, and ECS |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | CLI credential export | Credentials for AWS Bedrock `ConverseStreamCommand` |
| `OPENROUTER_API_KEY` | unset | API key for upstream OpenRouter models |
| `LYRA_DATABASE_HOST` (+ `PORT`/`NAME`/`USER`/`PASSWORD`) | SQLite fallback | Switches Better Auth to AWS PostgreSQL (`auth` schema) |

## Testing and Typechecking

```bash
# TypeScript validation
bun run typecheck

# Gateway, auth, routing, and coordinator unit tests
bun test server/adaptivePipeline.test.ts server/ahpProtocol.test.ts server/gateway.test.ts server/ecsNativeDispatcher.test.ts server/bedrockModelCatalog.test.ts server/modelDecisionEngine.test.ts server/teamCoordinator.test.ts
```

## Further Documentation

- [docs/api.md](docs/api.md) -- HTTP, SSE gateway, Better Auth handoff, and WebSocket endpoints
- [docs/architecture-and-features.md](docs/architecture-and-features.md) -- System architecture, routing, worktrees, and AWS integrations
- [docs/product-spec.md](docs/product-spec.md) -- Native Strands coding harness specification
- [infra/aws/README.md](infra/aws/README.md) -- AWS infrastructure templates and deployment notes
