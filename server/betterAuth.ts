import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { betterAuth } from 'better-auth';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { getMigrations } from 'better-auth/db/migration';
import { passkey } from '@better-auth/passkey';
import { bearer } from 'better-auth/plugins/bearer';
import { PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingHttpHeaders } from 'node:http';

export type BetterAuthInstance = ReturnType<typeof betterAuth<any>>;
export interface LyraBetterAuthRuntime {
  auth: BetterAuthInstance;
  handleNodeRequest: ReturnType<typeof toNodeHandler>;
  close: () => Promise<void>;
  isHostedAws: boolean;
}

let runtime: LyraBetterAuthRuntime | null = null;
let pool: Pool | null = null;
let sqliteDb: InstanceType<typeof Database> | null = null;
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
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: {
          Text: {
            Data: `Continue to Lyra using this link:\n\n${url}\n\nIf you did not request this, you can ignore this message.`,
            Charset: 'UTF-8'
          }
        }
      }
    },
  }));
}

function resolveSecret(): string {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;
  const secretPath = path.resolve('server/data/.auth-secret');
  try {
    if (fs.existsSync(secretPath)) {
      const existing = fs.readFileSync(secretPath, 'utf8').trim();
      if (existing.length >= 32) return existing;
    }
  } catch {}
  const generated = 'lyra_' + Array.from({ length: 48 }, () => Math.random().toString(36)[2] || '0').join('');
  try {
    const dir = path.dirname(secretPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(secretPath, generated, 'utf8');
  } catch {}
  return generated;
}

export async function initializeBetterAuth(): Promise<LyraBetterAuthRuntime | null> {
  const secret = resolveSecret();
  let baseURL = process.env.BETTER_AUTH_URL || `http://localhost:${process.env.LYRA_HUB_PORT || '3001'}`;
  try {
    const parsed = new URL(baseURL);
    if (!parsed.hostname) throw new Error('Empty hostname');
  } catch {
    baseURL = `http://localhost:${process.env.LYRA_HUB_PORT || '3001'}`;
  }

  const isHostedAws = Boolean(process.env.LYRA_DATABASE_HOST);
  let databaseConfig: any;

  if (isHostedAws) {
    // AWS Aurora / RDS PostgreSQL
    console.log(`[Lyra Auth] Initializing Better Auth with AWS PostgreSQL (${process.env.LYRA_DATABASE_HOST})...`);
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
    databaseConfig = { dialect: new PostgresDialect({ pool }), type: 'postgres', schemaName: 'auth' };
  } else {
    // Local workspace SQLite database with auto persistence
    const dataDir = path.resolve('server/data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const dbPath = path.join(dataDir, 'auth.sqlite');
    sqliteDb = new Database(dbPath);
    databaseConfig = sqliteDb;
    console.log(`[Lyra Auth] Initializing Better Auth with local SQLite (${dbPath})...`);
  }

  const hostname = new URL(baseURL).hostname;
  const extraOrigins = [
    process.env.GRAM_PUBLIC_URL,
    ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS || '').split(','),
  ]
    .map((origin) => origin?.trim())
    .filter((origin): origin is string => Boolean(origin));

  const trustedOrigins = Array.from(
    new Set([
      baseURL,
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:5174',
      'http://127.0.0.1:5174',
      'http://localhost:3001',
      'http://127.0.0.1:3001',
      'http://localhost:7337',
      'http://127.0.0.1:7337',
      'tauri://localhost',
      ...extraOrigins,
    ])
  );

  const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  const auth = betterAuth({
    appName: 'Lyra',
    baseURL,
    secret,
    database: databaseConfig,
    trustedOrigins,
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ['google'],
        requireLocalEmailVerified: false,
      },
    },
    socialProviders:
      googleClientId && googleClientSecret
        ? {
            google: {
              clientId: googleClientId,
              clientSecret: googleClientSecret,
            },
          }
        : undefined,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: process.env.LYRA_HOSTED === 'true' && Boolean(process.env.LYRA_SES_FROM_EMAIL),
      disableSignUp: process.env.LYRA_AUTH_DISABLE_SIGNUP === 'true',
      minPasswordLength: 6,
      maxPasswordLength: 128,
      sendResetPassword: async ({ user, url }) => sendAuthEmail(user.email, 'Reset your Lyra password', url),
    },
    emailVerification: {
      sendOnSignUp: process.env.LYRA_HOSTED === 'true',
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => sendAuthEmail(user.email, 'Verify your Lyra account', url),
    },
    plugins: [
      passkey({
        rpID: hostname === 'localhost' ? 'localhost' : hostname,
        rpName: 'Lyra Cloud Swarm',
        origin: [
          baseURL,
          'http://localhost:5173',
          'http://127.0.0.1:5173',
          'http://localhost:3001'
        ]
      }),
      bearer()
    ],
    advanced: {
      useSecureCookies: process.env.LYRA_HOSTED === 'true'
    },
  });

  try {
    const migration = await getMigrations(auth.options, { throwOnUnsafe: false });
    if (migration.schemaProblems.length || migration.unsafeChanges.length) {
      console.warn(`[Lyra Auth] Database schema notes: ${[...migration.schemaProblems, ...migration.unsafeChanges].join('; ')}`);
    }
    await migration.runMigrations();
    console.log('[Lyra Auth] Schema verified and migrations up-to-date.');
  } catch (err) {
    console.warn('[Lyra Auth] Migration check returned:', err instanceof Error ? err.message : String(err));
  }

  runtime = {
    auth,
    handleNodeRequest: toNodeHandler(auth),
    close: async () => {
      await pool?.end();
      sqliteDb?.close();
      await sesClient?.destroy();
      pool = null;
      sqliteDb = null;
      sesClient = null;
      runtime = null;
    },
    isHostedAws
  };

  return runtime;
}

export function getBetterAuthRuntime() {
  return runtime;
}

export async function getBetterAuthSession(headers: IncomingHttpHeaders) {
  if (!runtime) return null;
  return runtime.auth.api.getSession({ headers: fromNodeHeaders(headers) });
}
