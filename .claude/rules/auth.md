---
paths:
  - "server/betterAuth.ts"
  - "server/betterAuth.test.ts"
  - "server/gateway.ts"
---
# Auth (Better Auth)

- Lyra is the identity hub for Gram: treat every change here as security-sensitive and keep `server/betterAuth.test.ts` passing (`bun test server/betterAuth.test.ts`).
- Hosted mode fails closed: no fallback secrets, no reset/verify links in logs.
- Keep account linking safe: do not disable local email verification when linking Google.
- Changing `trustedOrigins` or passkey origins can break local Gram or Tauri sign-in; verify both.
- Never print or paste secret values from `.env*`.
