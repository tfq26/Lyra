/**
 * Shared PostgreSQL connection resolver for Better Auth and PostgresEventJournal.
 * Supports either a single `DATABASE_URL` connection string or individual
 * `LYRA_DATABASE_*` environment variables.
 */

export interface ResolvedPostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

export function resolvePostgresConfig(): ResolvedPostgresConfig | null {
  const rawUrl = process.env.DATABASE_URL?.trim() || process.env.LYRA_DATABASE_URL?.trim();
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.hostname) {
        const sslMode = parsed.searchParams.get('sslmode');
        const sslDisabled =
          sslMode === 'disable' || process.env.LYRA_DATABASE_SSL === 'false';
        return {
          host: parsed.hostname,
          port: Number(parsed.port || 5432),
          database: parsed.pathname.replace(/^\/+/, '') || 'postgres',
          user: decodeURIComponent(parsed.username || 'postgres'),
          password: decodeURIComponent(parsed.password || ''),
          ssl: !sslDisabled,
        };
      }
    } catch {}
  }

  const host = process.env.LYRA_DATABASE_HOST?.trim();
  if (!host) return null;

  return {
    host,
    port: Number(process.env.LYRA_DATABASE_PORT || 5432),
    database: process.env.LYRA_DATABASE_NAME || 'lyra',
    user: process.env.LYRA_DATABASE_USER || 'lyra',
    password: process.env.LYRA_DATABASE_PASSWORD || '',
    ssl: process.env.LYRA_DATABASE_SSL !== 'false',
  };
}
