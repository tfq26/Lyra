import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { betterAuth } from 'better-auth';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { getMigrations } from 'better-auth/db/migration';
import { PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { IncomingHttpHeaders } from 'node:http';

export type BetterAuthInstance = ReturnType<typeof betterAuth<any>>;
export interface LyraBetterAuthRuntime { auth: BetterAuthInstance; handleNodeRequest: ReturnType<typeof toNodeHandler>; close: () => Promise<void>; }

let runtime: LyraBetterAuthRuntime | null = null;
let pool: Pool | null = null;
let sesClient: SESv2Client | null = null;

async function sendAuthEmail(to: string, subject: string, url: string) {
  const from = process.env.LYRA_SES_FROM_EMAIL;
  if (process.env.LYRA_HOSTED !== 'true' || !from) {
    console.info(`[Lyra Auth] ${subject} for ${to}: ${url}`);
    return;
  }
  sesClient ||= new SESv2Client({ region: process.env.LYRA_SES_REGION || process.env.AWS_REGION || 'us-east-1' });
  await sesClient.send(new SendEmailCommand({
    FromEmailAddress: from,
    Destination: { ToAddresses: [to] },
    Content: { Simple: { Subject: { Data: subject, Charset: 'UTF-8' }, Body: { Text: { Data: `Continue to Lyra using this link:\n\n${url}\n\nIf you did not request this, you can ignore this message.`, Charset: 'UTF-8' } } } },
  }));
}

export async function initializeBetterAuth(): Promise<LyraBetterAuthRuntime | null> {
  if (!process.env.LYRA_DATABASE_HOST) return null;
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error('BETTER_AUTH_SECRET must be configured in AWS Secrets Manager before enabling login.');
  if (process.env.LYRA_HOSTED === 'true' && !process.env.LYRA_SES_FROM_EMAIL) {
    console.warn('[Lyra Auth] LYRA_SES_FROM_EMAIL is not set. Verification links will be logged to stdout/CloudWatch instead of sent via SES.');
  }

  pool = new Pool({
    host: process.env.LYRA_DATABASE_HOST,
    port: Number(process.env.LYRA_DATABASE_PORT || 5432),
    database: process.env.LYRA_DATABASE_NAME || 'lyra',
    user: process.env.LYRA_DATABASE_USER || 'lyra',
    password: process.env.LYRA_DATABASE_PASSWORD,
    ssl: process.env.LYRA_DATABASE_SSL === 'false' ? undefined : { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30_000,
  });
  await pool.query('CREATE SCHEMA IF NOT EXISTS auth');
  let baseURL = process.env.BETTER_AUTH_URL || `http://localhost:${process.env.LYRA_HUB_PORT || '3001'}`;
  try {
    const parsed = new URL(baseURL);
    if (!parsed.hostname) throw new Error('Empty hostname');
  } catch {
    baseURL = `http://localhost:${process.env.LYRA_HUB_PORT || '3001'}`;
  }
  const auth = betterAuth({
    appName: 'Lyra',
    baseURL,
    secret,
    database: { dialect: new PostgresDialect({ pool }), type: 'postgres', schemaName: 'auth' },
    trustedOrigins: [baseURL, 'http://localhost:5173', 'http://127.0.0.1:5173', 'tauri://localhost'],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: process.env.LYRA_HOSTED === 'true' && Boolean(process.env.LYRA_SES_FROM_EMAIL),
      disableSignUp: process.env.LYRA_AUTH_DISABLE_SIGNUP === 'true',
      minPasswordLength: 12,
      maxPasswordLength: 128,
      sendResetPassword: async ({ user, url }) => sendAuthEmail(user.email, 'Reset your Lyra password', url),
    },
    emailVerification: {
      sendOnSignUp: process.env.LYRA_HOSTED === 'true',
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => sendAuthEmail(user.email, 'Verify your Lyra account', url),
    },
    advanced: { useSecureCookies: process.env.LYRA_HOSTED === 'true' },
  });
  const migration = await getMigrations(auth.options, { throwOnUnsafe: true });
  if (migration.schemaProblems.length || migration.unsafeChanges.length) throw new Error(`Better Auth database schema is not safe to migrate: ${[...migration.schemaProblems, ...migration.unsafeChanges].join('; ')}`);
  await migration.runMigrations();
  runtime = { auth, handleNodeRequest: toNodeHandler(auth), close: async () => { await pool?.end(); await sesClient?.destroy(); pool = null; sesClient = null; runtime = null; } };
  return runtime;
}

export function getBetterAuthRuntime() { return runtime; }

export async function getBetterAuthSession(headers: IncomingHttpHeaders) {
  if (!runtime) return null;
  return runtime.auth.api.getSession({ headers: fromNodeHeaders(headers) });
}
