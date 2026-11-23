# Lyra

Cloud brain for Gram: Better Auth hub, multi-provider LLM gateway (Bedrock, Azure Foundry, OpenRouter) with `auto` routing, and swarm runner. Bun + TypeScript, ESM. See README.md, SETUP.md, docs/architecture-and-features.md.

## Commands
- Dev server: `bun run dev` (server/index.ts)
- Typecheck: `bun run typecheck` (tsc --noEmit)
- Tests: `bun test <file>` (colocated `server/*.test.ts`); live/e2e tests are in `tests/` and need real credentials, so don't run them by default
- Env check: `bun run doctor`
- Full test list: SETUP.md
- Full suite: `bun test` (~15s, no credentials needed; `tests/live-*` are the credentialed ones)
- Fast check: `.claude/verify.sh` (typecheck, ~4s); the global Stop hook runs it after each turn
- `site/` is a separate package with its own lockfile; run its scripts from `site/`

## Layout
- `server/` gateway, routing (`modelDecisionEngine`, `unifiedModelCatalog`), auth, coordinators, MCP server (`harnessMcpServer.ts`)
- `server/cloud/` provider abstraction: `interfaces.ts`, `registry.ts`, `providers/{aws,azure,cloudflare,local}.ts`, `database.ts`. A change to `interfaces.ts` must be mirrored in every provider and `registry.test.ts`.
- `scripts/` CLI and deploy tooling, `infra/` AWS templates, `site/` and `extensions/` front-ends, `docs/` specs

## Conventions
- Tests live next to the module as `<name>.test.ts`; add or update one with each change.
- IMPORTANT: never commit `.env`, `.env.local`, or secrets. Secret redaction lives in `server/security.ts`.
- Deploys (Cloudflare, AWS) are outward-facing: confirm before running them.

## Gotchas
- Bun auto-loads `.env`/`.env.local`, so tests inherit your real settings (e.g. `LYRA_ECS_CLUSTER`) and can hit AWS. Tests must pin the env vars they depend on and stub cloud clients; restore env after each test.
- `server/betterAuth.ts` resolves `server/data` relative to cwd. Auth tests `chdir` into a temp dir to avoid touching the real `auth.sqlite`.
- Hosted mode (`LYRA_HOSTED=true`) must fail closed: require `BETTER_AUTH_SECRET`, never log reset/verify links. Do not re-add `requireLocalEmailVerified: false` (account-takeover risk).
- `trustedOrigins` must keep `localhost` and `tauri://localhost`: local Gram signs in against the hosted hub.
- There is no CI and no linter; `bun test` and `bun run typecheck` are the only gates, so run both before opening a PR.
- Gram lives in `../Gram` and duplicates `codeMode`, `processManager` and `worktreeManager`. Check whether a fix belongs in both.
