import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Database } from 'bun:sqlite';
import { Pool } from 'pg';
import type {
  CloudBlobStorageAdapter,
  CloudDatabaseAdapter,
  CloudHealthStatus,
  CloudProviderId,
  DbBranchHandle,
} from './interfaces';
import { resolvePostgresConfig } from '../postgresConfig';
import { redactSecretText } from '../security';

const CORE_SCHEMA_SQLITE = [
  `CREATE TABLE IF NOT EXISTS lyra_events (
    tenant_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at TEXT NOT NULL,
    agent TEXT NOT NULL,
    event_type TEXT NOT NULL,
    run_id TEXT,
    payload TEXT NOT NULL,
    UNIQUE (tenant_id, event_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_lyra_events_session ON lyra_events (tenant_id, session_id, sequence)`,
  `CREATE TABLE IF NOT EXISTS lyra_synced_chats (
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'Untitled chat',
    project_id TEXT NOT NULL DEFAULT 'local',
    project_label TEXT NOT NULL DEFAULT 'Local workspace',
    model_id TEXT NOT NULL DEFAULT 'auto',
    messages TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, user_id, session_id)
  )`,
  `CREATE TABLE IF NOT EXISTS lyra_synced_tasks (
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT 'completed',
    checkpoint TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, user_id, session_id, run_id)
  )`,
  `CREATE TABLE IF NOT EXISTS lyra_context_blobs (
    blob_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    session_id TEXT,
    modality TEXT NOT NULL DEFAULT 'text',
    storage_key TEXT,
    content TEXT,
    byte_size INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS lyra_scratchpad (
    tenant_id TEXT NOT NULL,
    namespace TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, namespace, key)
  )`,
];

const CORE_SCHEMA_POSTGRES = [
  `CREATE TABLE IF NOT EXISTS lyra_events (
    tenant_id text NOT NULL,
    session_id text NOT NULL,
    event_id text NOT NULL,
    sequence bigserial NOT NULL,
    occurred_at timestamptz NOT NULL,
    agent text NOT NULL,
    event_type text NOT NULL,
    run_id text,
    payload jsonb NOT NULL,
    PRIMARY KEY (tenant_id, event_id),
    UNIQUE (tenant_id, session_id, sequence)
  )`,
  `CREATE INDEX IF NOT EXISTS lyra_events_session_cursor ON lyra_events (tenant_id, session_id, sequence)`,
  `CREATE TABLE IF NOT EXISTS lyra_synced_chats (
    tenant_id text NOT NULL,
    user_id text NOT NULL,
    session_id text NOT NULL,
    title text NOT NULL DEFAULT 'Untitled chat',
    project_id text NOT NULL DEFAULT 'local',
    project_label text NOT NULL DEFAULT 'Local workspace',
    model_id text NOT NULL DEFAULT 'auto',
    messages jsonb NOT NULL DEFAULT '[]'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted boolean NOT NULL DEFAULT false,
    PRIMARY KEY (tenant_id, user_id, session_id)
  )`,
  `CREATE TABLE IF NOT EXISTS lyra_synced_tasks (
    tenant_id text NOT NULL,
    user_id text NOT NULL,
    session_id text NOT NULL,
    run_id text NOT NULL,
    stage text NOT NULL DEFAULT 'completed',
    checkpoint jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, user_id, session_id, run_id)
  )`,
  `CREATE TABLE IF NOT EXISTS lyra_context_blobs (
    blob_id text PRIMARY KEY,
    tenant_id text NOT NULL DEFAULT 'default',
    session_id text,
    modality text NOT NULL DEFAULT 'text',
    storage_key text,
    content text,
    byte_size integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS lyra_scratchpad (
    tenant_id text NOT NULL,
    namespace text NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, namespace, key)
  )`,
];

export class SqliteCloudDatabaseAdapter implements CloudDatabaseAdapter {
  public readonly engine = 'sqlite' as const;
  private db: Database | null = null;
  private initialized = false;
  private readonly dbPath: string;
  private readonly branchPaths = new Map<string, string>();

  constructor(
    public readonly provider: CloudProviderId,
    dbPath?: string
  ) {
    this.dbPath = dbPath || process.env.LYRA_SQLITE_PATH || ':memory:';
  }

  private getDb(): Database {
    if (!this.db) {
      if (this.dbPath !== ':memory:') {
        fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
      }
      this.db = new Database(this.dbPath);
      this.db.exec('PRAGMA journal_mode = WAL;');
      this.db.exec('PRAGMA foreign_keys = ON;');
    }
    return this.db;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const db = this.getDb();
    for (const stmt of CORE_SCHEMA_SQLITE) {
      db.exec(stmt);
    }
    this.initialized = true;
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    await this.initialize();
    const stmt = this.getDb().query(sql);
    return stmt.all(...(params as any[])) as T[];
  }

  async execute(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    await this.initialize();
    const stmt = this.getDb().query(sql);
    const res = stmt.run(...(params as any[]));
    return { changes: Number(res.changes || 0) };
  }

  async createBranch(branchId: string): Promise<DbBranchHandle> {
    await this.initialize();
    const safeId = branchId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const branchDir = path.join(os.tmpdir(), 'lyra-db-branches');
    fs.mkdirSync(branchDir, { recursive: true });
    const branchFile = path.join(branchDir, `${safeId}.sqlite`);
    if (this.dbPath !== ':memory:' && fs.existsSync(this.dbPath)) {
      fs.copyFileSync(this.dbPath, branchFile);
    } else {
      const branchDb = new Database(branchFile);
      for (const stmt of CORE_SCHEMA_SQLITE) branchDb.exec(stmt);
      branchDb.close();
    }
    this.branchPaths.set(branchId, branchFile);
    return {
      branchId,
      provider: this.provider,
      engine: 'sqlite',
      connectionInfo: branchFile,
    };
  }

  async deleteBranch(branchId: string): Promise<void> {
    const file = this.branchPaths.get(branchId);
    if (file && fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
    this.branchPaths.delete(branchId);
  }

  async healthCheck(): Promise<CloudHealthStatus> {
    try {
      await this.query('SELECT 1 AS ok');
      return {
        provider: this.provider,
        ok: true,
        details: { engine: 'sqlite', dbPath: this.dbPath },
      };
    } catch (err: any) {
      return {
        provider: this.provider,
        ok: false,
        details: { engine: 'sqlite', error: err?.message || String(err) },
      };
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
    }
  }
}

export class PostgresCloudDatabaseAdapter implements CloudDatabaseAdapter {
  public readonly engine = 'postgres' as const;
  private pool: Pool | null = null;
  private initialized = false;

  constructor(public readonly provider: CloudProviderId) {}

  private getPool(): Pool {
    if (!this.pool) {
      const cfg = resolvePostgresConfig();
      if (!cfg) {
        throw new Error(
          `${this.provider} CloudDatabaseAdapter requires DATABASE_URL or LYRA_DATABASE_HOST.`
        );
      }
      this.pool = new Pool({
        host: cfg.host,
        port: cfg.port,
        database: cfg.database,
        user: cfg.user,
        password: cfg.password,
        ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
        max: 10,
      });
    }
    return this.pool;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const pool = this.getPool();
    for (const stmt of CORE_SCHEMA_POSTGRES) {
      await pool.query(stmt);
    }
    this.initialized = true;
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    await this.initialize();
    const res = await this.getPool().query(sql, params);
    return res.rows as T[];
  }

  async execute(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    await this.initialize();
    const res = await this.getPool().query(sql, params);
    return { changes: Number(res.rowCount || 0) };
  }

  async createBranch(branchId: string): Promise<DbBranchHandle> {
    await this.initialize();
    const schemaName = `run_${branchId.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()}`;
    await this.getPool().query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
    return {
      branchId,
      provider: this.provider,
      engine: 'postgres',
      connectionInfo: `schema:${schemaName}`,
    };
  }

  async deleteBranch(branchId: string): Promise<void> {
    const schemaName = `run_${branchId.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()}`;
    await this.getPool().query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  }

  async healthCheck(): Promise<CloudHealthStatus> {
    try {
      await this.query('SELECT 1 AS ok');
      return { provider: this.provider, ok: true, details: { engine: 'postgres' } };
    } catch (err: any) {
      return {
        provider: this.provider,
        ok: false,
        details: { engine: 'postgres', error: err?.message || String(err) },
      };
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.initialized = false;
    }
  }
}

/**
 * Agent-safe, tenant-scoped facade over CloudDatabaseAdapter + CloudBlobStorageAdapter.
 */
export class LyraDataLayer {
  constructor(
    private readonly db: CloudDatabaseAdapter,
    private readonly storage: CloudBlobStorageAdapter
  ) {}

  async listTables(): Promise<string[]> {
    if (this.db.engine === 'sqlite') {
      const rows = await this.db.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
      );
      return rows.map((r) => r.name);
    }
    const rows = await this.db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
    );
    return rows.map((r) => r.table_name);
  }

  async describeTable(tableName: string): Promise<Array<{ name: string; type: string }>> {
    const safeTable = tableName.replace(/[^a-zA-Z0-9_]/g, '');
    if (this.db.engine === 'sqlite') {
      const rows = await this.db.query<{ name: string; type: string }>(
        `PRAGMA table_info("${safeTable}")`
      );
      return rows.map((r) => ({ name: r.name, type: r.type }));
    }
    const rows = await this.db.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
      [safeTable]
    );
    return rows.map((r) => ({ name: r.column_name, type: r.data_type }));
  }

  async queryReadOnly<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
    maxRows = 100
  ): Promise<T[]> {
    const trimmed = sql.trim().replace(/;+\s*$/, '');
    if (!/^(SELECT|WITH|PRAGMA\s+table_info)\b/i.test(trimmed)) {
      throw new Error('Only read-only SELECT / WITH queries are permitted in queryReadOnly.');
    }
    if (/;\s*\S/.test(trimmed)) {
      throw new Error('Multiple SQL statements are not permitted.');
    }
    const cappedLimit = Math.min(Math.max(1, maxRows), 500);
    const hasLimit = /\bLIMIT\s+\d+\b/i.test(trimmed);
    const finalSql =
      hasLimit || /^PRAGMA\b/i.test(trimmed) ? trimmed : `${trimmed} LIMIT ${cappedLimit}`;
    const rows = await this.db.query<T>(finalSql, params);
    const redacted = redactSecretText(JSON.stringify(rows));
    return JSON.parse(redacted) as T[];
  }

  async scratchpadSet(
    tenantId: string,
    namespace: string,
    key: string,
    value: unknown
  ): Promise<void> {
    const serialized = redactSecretText(
      typeof value === 'string' ? value : JSON.stringify(value ?? null)
    );
    const now = new Date().toISOString();
    if (this.db.engine === 'sqlite') {
      await this.db.execute(
        `INSERT INTO lyra_scratchpad (tenant_id, namespace, key, value, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (tenant_id, namespace, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [tenantId, namespace, key, serialized, now]
      );
    } else {
      await this.db.execute(
        `INSERT INTO lyra_scratchpad (tenant_id, namespace, key, value, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, namespace, key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [tenantId, namespace, key, serialized, now]
      );
    }
  }

  async scratchpadGet(
    tenantId: string,
    namespace: string,
    key: string
  ): Promise<string | null> {
    const sql =
      this.db.engine === 'sqlite'
        ? `SELECT value FROM lyra_scratchpad WHERE tenant_id = ? AND namespace = ? AND key = ? LIMIT 1`
        : `SELECT value FROM lyra_scratchpad WHERE tenant_id = $1 AND namespace = $2 AND key = $3 LIMIT 1`;
    const rows = await this.db.query<{ value: string }>(sql, [tenantId, namespace, key]);
    return rows[0]?.value ?? null;
  }

  async scratchpadList(
    tenantId: string,
    namespace: string
  ): Promise<Array<{ key: string; value: string; updatedAt: string }>> {
    const sql =
      this.db.engine === 'sqlite'
        ? `SELECT key, value, updated_at FROM lyra_scratchpad WHERE tenant_id = ? AND namespace = ? ORDER BY key`
        : `SELECT key, value, updated_at FROM lyra_scratchpad WHERE tenant_id = $1 AND namespace = $2 ORDER BY key`;
    const rows = await this.db.query<{ key: string; value: string; updated_at: string }>(sql, [
      tenantId,
      namespace,
    ]);
    return rows.map((r) => ({ key: r.key, value: r.value, updatedAt: r.updated_at }));
  }

  async putArtifact(
    tenantId: string,
    key: string,
    body: string | Uint8Array,
    contentType = 'text/plain'
  ): Promise<{ key: string; bytes: number }> {
    const scopedKey = `${tenantId}/${key.replace(/^\/+/, '')}`;
    const bytes = typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength;
    await this.storage.putObject(scopedKey, body, contentType);
    return { key: scopedKey, bytes };
  }

  async getArtifactText(tenantId: string, key: string): Promise<string | null> {
    const scopedKey = key.startsWith(`${tenantId}/`)
      ? key
      : `${tenantId}/${key.replace(/^\/+/, '')}`;
    const raw = await this.storage.getObject(scopedKey);
    if (!raw) return null;
    return redactSecretText(new TextDecoder().decode(raw));
  }
}
