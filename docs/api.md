# Lyra API

This document describes the implemented Lyra HTTP and WebSocket API. The OpenAPI subset is in [`openapi.yaml`](./openapi.yaml). Better Auth owns the `/api/auth/*` routes; the REST routes below are Lyra-specific.

## Authentication

- Hosted deployments use Better Auth email/password accounts and PostgreSQL-backed sessions. Auth records are stored in the `auth` schema; password credentials are hashed by Better Auth. The session cookie is HttpOnly and Secure in hosted mode.
- `GET /api/auth/status` returns `{ "required": boolean, "signUpEnabled": boolean }` and is public. Hosted registration is disabled by default; operators provision team accounts with the controlled `auth:create-user` command. Verification and reset email delivery use SES.
- Better Auth's principal routes include `POST /api/auth/sign-in/email`, `POST /api/auth/sign-up/email` (only when enabled), `POST /api/auth/sign-out`, `GET /api/auth/get-session`, `POST /api/auth/request-password-reset`, `GET /api/auth/reset-password/{token}`, and `POST /api/auth/reset-password`.
- All other `/api/*` routes require a Better Auth session when auth is enabled. Local development can run without auth; the legacy `LYRA_AUTH_TOKEN` is supported only outside hosted mode. Internal Fargate runners use a separate `LYRA_RUNNER_TOKEN` and do not use user login cookies.
- The hosted beta is currently one shared Lyra tenant. Better Auth identifies users, but per-team membership and per-tenant data authorization are not implemented yet; do not enable open registration or treat this as a multi-tenant service.

## HTTP endpoints

All paths below are relative to the Lyra server origin. JSON bodies use `Content-Type: application/json`.

| Method and path | Purpose | Request / response summary |
| --- | --- | --- |
| `GET /api/health` | Liveness | `{ status: "ok", service: "Lyra Hub" }` |
| `GET /api/auth/status` | Public auth configuration | `{ required, signUpEnabled }` |
| `GET /api/agents/capabilities` | Legacy CLI capability discovery | Harness IDs mapped to installed binaries and options |
| `GET /api/agents/readiness` | Legacy CLI readiness | Installed/authenticated/readiness fields; CLI auth may be reported as unknown |
| `GET /api/agents/models` | Legacy CLI model discovery | Map of harness ID to model options |
| `GET /api/harness-profiles` | List legacy CLI profiles | Profile metadata only |
| `POST /api/harness-profiles` | Save legacy CLI profile | `{ name, harness, enabled?, model? }` |
| `DELETE /api/harness-profiles/{profileId}` | Delete legacy CLI profile | `204` when deleted; `404` otherwise |
| `GET /api/model-provider-profiles` | List Bedrock/OpenRouter profiles | Returns provider metadata and `hasCredential`; never returns secret references or secret values |
| `POST /api/model-provider-profiles` | Create/update provider profile | `{ id?, name, provider, credentialMode, model, region?, roleArn?, externalId?, apiKey? }`. `apiKey` and `externalId` are accepted only over HTTPS in hosted mode and are stored in Secrets Manager. They are never returned. |
| `DELETE /api/model-provider-profiles/{profileId}` | Delete provider profile | `204` when deleted; `404` otherwise |
| `GET /api/model-provider-profiles/{profileId}/compatibility` | Read latest compatibility result | Result or `null` if not checked |
| `POST /api/model-provider-profiles/{profileId}/compatibility-check` | Run synthetic compatibility suite | Returns `tier`, individual capability results, warnings, test time, and reported token usage |
| `GET /api/storage/config` | Read local/hosted storage setting | `{ storagePath }` |
| `POST /api/storage/config` | Change storage setting | `{ storagePath }` |
| `POST /api/workspaces/import` | Clone a public GitHub repository | `{ repoUrl, sessionId }` → `{ workspacePath, repository }`. Private repositories are not supported yet. |
| `GET /api/sessions` | List conversations | Session metadata; archived sessions are omitted |
| `POST /api/sessions` | Create conversation | `{ title, workspacePath, activeAgents? }` → session metadata |
| `GET /api/sessions/{sessionId}` | Read conversation | `{ meta, events, agentCheckpoints }` |
| `PATCH /api/sessions/{sessionId}` | Update conversation metadata | Supported fields include `title`, `archived`, `workspacePath`, `agentOptions`, `draft`, `mode`, and `teamConfig` |
| `DELETE /api/sessions/{sessionId}` | Delete conversation and local artifacts | `{ success }` |
| `GET /api/sessions/{sessionId}/events?after={sequence}` | Fetch ordered events after a cursor | `{ events, nextCursor, hasMore }`; page size is at most 1,000 |
| `GET /api/sessions/{sessionId}/agent-checkpoints` | Read recovery checkpoints | Ordered checkpoints with state, workspace, run ID, and detail |
| `GET /api/sessions/{sessionId}/runs` | List legacy CLI team runs | Array of team-run records |
| `GET /api/sessions/{sessionId}/runs/{runId}` | Read legacy CLI team run | Team-run record or `404` |

### Provider profile example

```json
{
  "name": "OpenRouter coding",
  "provider": "openrouter",
  "credentialMode": "byo",
  "model": "provider/model-id",
  "apiKey": "provided only in the HTTPS request"
}
```

The response omits the API key and secret reference. Hosted credential writes require an HTTPS request at the ALB. Local/self-hosted OpenRouter development uses `OPENROUTER_API_KEY` rather than saving a key to the profile file.

### Compatibility result

`tier` is `full` or `limited`; `capabilities` reports `streaming`, `toolCalling`, `structuredOutput`, `cancellation`, and `sessionResume` independently. Native long-session coding requires tool calling, cancellation, and session resume to pass. A limited model can only be used for workflows that do not require its failed capabilities.

## WebSocket protocol

The user WebSocket is opened on the Lyra server origin and authenticates with the Better Auth session cookie. The Fargate runner uses a separate internal bearer token. Messages are JSON objects with `type`, optional `sessionId`, optional `runId`, and `payload`.

### Client to server

| Type | Payload | Purpose |
| --- | --- | --- |
| `sync_sessions` | `{ cursors: { [sessionId]: sequence } }` | Catch up after reconnect; server returns `session_events_catchup` pages |
| `user_prompt` | `{ runtime: "native", prompt, providerProfileId, cwd, runId, ... }` | Start a native Strands turn. Hosted mode launches an isolated Fargate task; local mode runs in the local hub process. |
| `native_agent_resume` | `{ sessionId, runId, providerProfileId }` | Resume a run marked `needs-attention` after workspace review |
| `tool_approval_decision` | `{ sessionId, runId, approvalId, approved }` | Approve or reject a paused shell command |
| `cancel_run` | `{ runId, sessionId? }` | Cancel a native or legacy team run |
| `team_run_start` | `{ objective, teamConfig, cwd, runId, ... }` | Start the legacy CLI team coordinator |
| `team_run_approve` | `{ runId, sessionId }` | Approve a legacy CLI team plan |
| `team_run_pause` / `team_run_resume` | `{ runId, sessionId }` | Pause/resume a legacy team run |
| `swarm_message` | `{ runId, fromAgent, toAgent, kind, text, taskId? }` | Add a legacy team handoff or note |
| `clear_session` | `{ sessionId }` | Clear conversation events |
| `bridge_dispatch` | `{ from, to, instruction, context?, sessionId, cwd }` | Dispatch through the legacy CLI bridge |

### Server to client

The server emits `unified_event`, `run_started`, `content_chunk`, `tool_call`, `tool_approval_required`, `done`, `error`, `session_updated`, `team_run_updated`, `task_updated`, `check_updated`, `diffs_updated`, and `session_events_catchup` messages. `unified_event.payload.sequence` is the durable per-session cursor; clients should persist it and request catch-up after reconnecting. Tool activity events omit file contents, patches, and raw shell command text.

## Error behavior

- `400`: invalid profile, workspace, run state, compatibility request, or malformed input.
- `401`: missing/invalid Better Auth session on a protected route.
- `404`: missing session, run, or profile.
- `503`: PostgreSQL event history unavailable.
- WebSocket errors use `{ type: "error", sessionId?, runId?, payload: { message } }`. A failed run also emits `done` with a non-zero `code` when the server can identify its run.
