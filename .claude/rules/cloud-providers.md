---
paths:
  - "server/cloud/**"
---
# Cloud provider abstraction

- `interfaces.ts` defines `CloudProviderId` and the adapter contracts (queue, pub/sub, storage, database). Providers live in `providers/{local,aws,azure,cloudflare}.ts` and are wired in `registry.ts`.
- Any change to an interface or to `CloudProviderId` must be applied to **every** provider and to `registry.ts`, and covered in `registry.test.ts`.
- The `local` provider is the reference implementation and the fallback; keep it working without credentials.
- Provider tests must not reach real cloud services: stub clients and pin env vars.
- Confirm with `bun run typecheck && bun test server/cloud`.
