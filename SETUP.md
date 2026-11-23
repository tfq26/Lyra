# Lyra Setup & Deployment Guide

For an overview of Gram + Lyra's features, flows, and roadmap, see [README.md](README.md) (and [Gram/README.md](../Gram/README.md)).

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

Make sure secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BETTER_AUTH_SECRET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AZURE_FOUNDRY_ENDPOINT`, `AZURE_FOUNDRY_API_KEY`, `OPENROUTER_API_KEY`, and optionally `LYRA_GATEWAY_API_KEY`) are configured in Cloudflare Worker secrets so `worker.ts` forwards them into the container environment.

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
| `AZURE_FOUNDRY_ENDPOINT` / `AZURE_FOUNDRY_API_KEY` | unset | Azure AI Foundry OpenAI-v1 endpoint and API key (forwarded by `worker.ts`) |
| `AZURE_FOUNDRY_API_VERSION` | `2025-04-01-preview` | API version used for Azure AI Foundry requests |
| `OPENROUTER_API_KEY` | unset | API key for upstream OpenRouter models |
| `LYRA_DATABASE_HOST` (+ `PORT`/`NAME`/`USER`/`PASSWORD`) | SQLite fallback | Switches Better Auth to AWS PostgreSQL (`auth` schema) |

## Testing and Typechecking

```bash
# TypeScript validation
bun run typecheck

# Gateway, auth, routing, and coordinator unit tests
bun test server/unifiedModelCatalog.test.ts server/privacyAndGateway.test.ts server/adaptivePipeline.test.ts server/ahpProtocol.test.ts server/gateway.test.ts server/ecsNativeDispatcher.test.ts server/bedrockModelCatalog.test.ts server/modelDecisionEngine.test.ts server/teamCoordinator.test.ts
```
