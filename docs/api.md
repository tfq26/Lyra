# Lyra API Reference

All HTTP and WebSocket endpoints live in `server/index.ts`, with Better Auth owning `/api/auth/*` (except Lyra's `/api/auth/status`, `/api/auth/gram-start`, and `/api/auth/gram-handoff` helpers). Request and response JSON bodies use `Content-Type: application/json`.

## Authentication and Desktop OAuth Handoff

Protected routes under `/api/gateway/*` and `/api/ahp/*` accept **either**:
- `x-lyra-api-key: <key>` matching the configured gateway key
- `Authorization: Bearer <token>` holding a valid Better Auth session token (such as Gram's `gram_lyra_token`) or gateway key
- A valid Better Auth session cookie

### Auth Endpoints

| Method and path | Auth | Summary |
| :--- | :--- | :--- |
| `GET /api/health` | Public | Returns `{ status: "ok", service: "Lyra Hub" }` |
| `GET /api/auth/status` | Public | Returns `{ required: boolean, signUpEnabled: boolean, googleEnabled: boolean }` |
| `GET /api/auth/gram-start?redirect=...` | Public | Starts Google OAuth via Better Auth and sends the user through `/api/auth/gram-handoff`. Redirect target must be `localhost`, `127.0.0.1`, or listed in `GRAM_PUBLIC_URL` / `BETTER_AUTH_TRUSTED_ORIGINS`. |
| `GET /api/auth/gram-handoff?redirect=...` | Session cookie | Reads the newly issued Better Auth session token and redirects to `redirect#auth_token=<token>` (or `?auth_error=session_missing` if missing). |
| `POST /api/auth/sign-in/email` | Public | Better Auth email/password sign-in |
| `POST /api/auth/sign-up/email` | Public | Better Auth email/password sign-up (unless `LYRA_AUTH_DISABLE_SIGNUP=true`) |
| `POST /api/auth/sign-out` | Session | Invalidates current session |
| `GET /api/auth/get-session` | Session | Returns current Better Auth user and session object |

## Central LLM Gateway (`/api/gateway/llm/*`)

Handled by `server/gatewayLlmProxy.ts`.

### `GET /api/gateway/llm/models?privacyMode=standard|zdr|local-only&include=legacy,candidate|all`

Returns the model catalog filtered by `privacyMode`. `local-only` returns an empty list.

Each model has `id`, `name`, `family`, `tier`, `status`, `contextWindow`, `primaryProvider`, `pricing` (per million tokens), `scores` (0-100), `workflowGroups`, `aliases`, `zdrCompliant` and an optional `contributorWarning` / `supersededBy`. The response carries a `catalogVersion` hash, also sent as an `ETag`; send it back as `If-None-Match` to get `304 Not Modified`.

By default only `active` models are listed (the same set `auto` routing uses). Add `include=legacy`, `include=candidate` or `include=all` to also list those states. `retired` models are never listed.

### Model lifecycle

Models move through `candidate` → `active` → `legacy` → `retired`:

| Status | In default list / `auto` | Selectable by id | Searchable |
|---|---|---|---|
| `candidate` (newly discovered) | no | yes | yes |
| `active` | yes | yes | yes |
| `legacy` (superseded or deprecated) | no | yes | yes |
| `retired` (removed by the provider) | no | no | no |

Seed models are `active` unless changed. State is stored in `lyra_model_registry` (PostgreSQL in production, `server/data/model-registry.sqlite` locally) with an audit trail in `lyra_model_registry_events`. If storage is unavailable Lyra falls back to in-memory state, where every seed model is active.

### `GET /api/gateway/llm/models/search?q=&include=&limit=`

Searches `active`, `legacy` and `candidate` models (override with `include=legacy,candidate`, which is exact here). Every word in `q` must match the id, name, family or an alias. Results are ordered active first, `limit` defaults to 50 (max 200), and the response includes `total`.

### `POST /api/gateway/llm/models/:id/status` (admin)

Body: `{ "status": "legacy", "reason": "...", "supersededBy": "gpt-5" }`. Requires the gateway API key itself (user session tokens are rejected with `403`). Returns `404` for unknown models, `409` for invalid transitions and `400` for bad input.

Models discovered by sync are **unscored** (`scored: false`, `scores: null`) and cannot be activated without scores. To promote one, add `"scores": { "coding": 88, "reasoning": 84, "toolProficiency": 86, "tokensPerSecond": 120 }` (the first three are required, 0-100). Add `"zdrVerified": true` to clear the "zero-data-retention not verified" warning, otherwise the model stays out of `zdr` mode. Sending `scores` with `"status": "candidate"` records the scores without activating.

### `POST /api/gateway/llm/models/sync` (admin)

Discovers new models and syncs prices and removals from providers (`LYRA_MODEL_SYNC_PROVIDERS`, default `openrouter`). **Dry run unless `"apply": true`.** Body (all optional): `{ "apply": false, "acceptPriceChanges": "all" | ["grok-4.20:openrouter"], "maxNewModels": 25 }`. Returns a report per provider: `newCandidates`, `skipped` (reason counts), `priceChanges` (`applied`, `would-apply`, `held`, `cleared`), `missing`, `expiring` and `reappeared`. Returns `409` if a sync is already running.

What a sync does, per provider listing:

- **New models** become unscored `candidate`s (published in the last 60 days, tool-capable, text output, 32k+ context, priced, from a tracked vendor, not a variant such as `:free`). At most 25 per run.
- **Prices** are stored as per-provider overrides; the catalog's other fields are untouched. Changes over 50% are *held* until accepted; differences under 1% are ignored.
- **Missing models** are retired after 2 consecutive syncs without them, only when every provider serving the model was synced, at most 5 per run.
- **Announced removals** (a provider expiration date within 14 days) move an active model to `legacy`.
- A failed download, or a listing under 20 models, changes nothing.

The same sync runs from the CLI (`bun run models:sync`, `--apply`, `--accept-prices=...`) and optionally on a schedule (`LYRA_MODEL_SYNC_INTERVAL_HOURS`, off by default). Only OpenRouter has an adapter today; Bedrock and Foundry need their own.

### `GET /api/gateway/llm/models/events?modelId=&limit=` (admin)

Lifecycle history, newest first. Requires the gateway API key.

### `POST /api/gateway/llm/stream`

Streams a tool-capable single-turn inference call over Server-Sent Events (`text/event-stream`).

**Request body:**

```json
{
  "model": "us.anthropic.claude-opus-5-5",
  "provider": "bedrock",
  "privacyMode": "standard",
  "effort": "medium",
  "supportsPromptCaching": true,
  "systemPrompt": "...",
  "messages": [{ "role": "user", "content": "..." }],
  "tools": [],
  "byokConfig": {
    "provider": "ollama",
    "modelId": "qwen2.5-coder:32b",
    "baseUrl": "http://127.0.0.1:11434/v1"
  }
}
```

**SSE events:**

- `data: {"type":"thinking_delta","delta":"..."}`
- `data: {"type":"text_delta","delta":"..."}`
- `data: {"type":"done","result":{"text":"...","thinking":"...","toolCalls":[...],"stopReason":"...","usage":{...}}}`
- `data: {"type":"error","message":"...","diagnostics":{...}}`

When an upstream error or abort happens, `diagnostics` includes:

```json
{
  "source": "lyra-gateway",
  "provider": "bedrock",
  "model": "us.anthropic.claude-opus-5-5",
  "privacyMode": "standard",
  "effort": "medium",
  "aborted": false,
  "abortReason": "client_response_closed",
  "errorName": "Error",
  "errorCode": "...",
  "httpStatusCode": 500,
  "awsRequestId": "...",
  "elapsedMs": 412
}
```

## Gateway, AHP, and Swarm Endpoints

| Method and path | Purpose |
| :--- | :--- |
| `POST /api/gateway/auth/login` | Authenticates email/password credentials and issues a gateway token |
| `GET /api/gateway/auth/verify` | Validates Bearer/`x-lyra-api-key` credentials |
| `POST /api/gateway/dispatch` | Dispatches an autonomous task `{ objective, workspacePath, ... }` |
| `GET /api/gateway/handoff` | Builds a cross-harness handoff brief for a workspace or run |
| `GET /api/gateway/telemetry` | Returns CloudWatch EMF metrics, Pareto savings snapshot, and SQS queue health |
| `GET /api/gateway/sessions/sync` / `POST /api/gateway/sessions/sync` | Fetches or updates synchronized workspace sessions |
| `POST /api/gateway/council` | Triggers multi-model debate across Frontier, Security, and FinOps personas |
| `GET /api/gateway/ahp/sessions` / `POST /api/gateway/ahp/sessions` | Lists or creates AHP v1.3 sessions (also mounted at `/api/ahp/sessions`) |
| `GET /api/gateway/ahp/sessions/{id}` | Reads an AHP session transcript and context brief |
| `POST /api/gateway/ahp/rpc` | Handles AHP JSON-RPC 2.0 requests (also at `/api/ahp/rpc`) |
| `POST /api/gateway/ahp/sync` | Cross-device sequence-delta (`sinceSeq`) chat and task sync (requires Better Auth user in `LYRA_HOSTED=true`) |
| `POST /api/gateway/ahp/chat` | Streams 3-lane adaptive chat execution over SSE (`triage`, `status`, `chunk`, `done`, `error`) |
| `POST /api/gateway/ahp/escalate` | Escalates a session to a full worktree swarm |
| `POST /api/nightshift/webhook` / `POST /api/nightshift/investigate` | Triggers unattended Night Shift bug investigations |

## Session, Profile, and Workspace Endpoints

| Method and path | Purpose |
| :--- | :--- |
| `GET /api/model-provider-profiles` | Lists configured Bedrock/OpenRouter profiles (`hasCredential` flag only, never secrets) |
| `POST /api/model-provider-profiles` | Creates/updates a provider profile (`apiKey` / `externalId` require HTTPS in hosted mode) |
| `DELETE /api/model-provider-profiles/{profileId}` | Deletes a provider profile |
| `POST /api/model-provider-profiles/{profileId}/compatibility-check` | Tests streaming, tool calling, structured output, cancellation, and session resume |
| `GET /api/model-provider-profiles/{profileId}/compatibility` | Reads the latest compatibility check result |
| `GET /api/storage/config` / `POST /api/storage/config` | Reads or updates storage root path |
| `POST /api/workspaces/import` | Clones a public GitHub repo into a workspace for a session |
| `GET /api/sessions` / `POST /api/sessions` | Lists or creates persisted conversations |
| `GET /api/sessions/{id}` / `PATCH /api/sessions/{id}` / `DELETE /api/sessions/{id}` | Reads, updates metadata, or deletes a conversation |
| `GET /api/sessions/{id}/events?after={seq}` | Fetches ordered session events after cursor `after` |
| `GET /api/sessions/{id}/agent-checkpoints` | Reads recovery checkpoints for a session |

## WebSocket Protocol

The WebSocket server shares the hub port (`3001`) and authenticates with the Better Auth session cookie (or internal `LYRA_RUNNER_TOKEN` for Fargate workers).

- **Client messages**: `sync_sessions`, `user_prompt`, `native_agent_resume`, `tool_approval_decision`, `cancel_run`, `team_run_start`, `team_run_approve`, `team_run_pause`, `team_run_resume`, `swarm_message`, `clear_session`, `bridge_dispatch`.
- **Server events**: `unified_event` (carries `payload.sequence` cursor), `run_started`, `content_chunk`, `tool_call`, `tool_approval_required`, `done`, `error`, `session_updated`, `team_run_updated`, `task_updated`, `check_updated`, `diffs_updated`, `session_events_catchup`.

## Common HTTP Status Codes

- `400`: Malformed JSON, missing required fields (`model`, `messages`, `objective`), or unsupported profile config.
- `401`: Missing or invalid Better Auth session / API key on protected routes.
- `404`: Missing session, run, or provider profile.
- `429`: Rate limit exceeded on `/api/gateway/*` or `/api/ahp/*` (includes `Retry-After` header).
- `503`: PostgreSQL event history unavailable.
