/**
 * Model lifecycle registry.
 *
 * `UNIFIED_MODEL_CATALOG` (unifiedModelCatalog.ts) is the seed list of models. This registry
 * overlays a lifecycle status on top of it and can hold extra models discovered at runtime:
 *
 *   candidate -> active -> legacy -> retired
 *
 * - candidate: newly discovered. Findable and selectable by explicit id, but never picked by `auto`.
 * - active:    in the default model list and eligible for `auto` routing. Seed models are active
 *              until a record says otherwise.
 * - legacy:    hidden from the default list and from `auto`, but still routable by explicit id and
 *              still found by search.
 * - retired:   the provider removed it. Not routable and not searchable.
 *
 * Reads are synchronous (served from memory) because routing code is synchronous. Writes go to the
 * store first, then update memory, so a failed write never changes what clients see.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Database } from 'bun:sqlite';
import postgres from 'postgres';
import type { CanonicalModelProfile } from './unifiedModelCatalog';
import { resolvePostgresConfig } from './postgresConfig';

export type ModelLifecycleStatus = 'candidate' | 'active' | 'legacy' | 'retired';
export const MODEL_LIFECYCLE_STATUSES: readonly ModelLifecycleStatus[] = ['candidate', 'active', 'legacy', 'retired'];
export type ModelRecordSource = 'seed' | 'discovered' | 'manual';

export interface ModelLifecycleRecord {
  modelId: string;
  status: ModelLifecycleStatus;
  reason?: string;
  /** Model that replaces this one (informational; lets clients suggest a successor). */
  supersededBy?: string;
  source: ModelRecordSource;
  statusChangedAt: string;
  firstSeenAt: string;
  lastSeenAt?: string;
  updatedBy: string;
  /** Full profile for models that are not part of the seed catalog. */
  profile?: CanonicalModelProfile;
}

export type ModelRegistryAction = 'add' | 'status' | 'supersede';

export interface ModelRegistryEvent {
  id: number;
  modelId: string;
  at: string;
  actor: string;
  action: ModelRegistryAction;
  fromStatus?: ModelLifecycleStatus;
  toStatus?: ModelLifecycleStatus;
  reason?: string;
}

export type ModelRegistryEventInput = Omit<ModelRegistryEvent, 'id'>;

export interface ModelRegistryStore {
  init(): Promise<void>;
  loadRecords(): Promise<ModelLifecycleRecord[]>;
  /** Atomically upserts the record and appends the audit event. */
  save(record: ModelLifecycleRecord, event: ModelRegistryEventInput): Promise<void>;
  listEvents(options?: { modelId?: string; limit?: number }): Promise<ModelRegistryEvent[]>;
  close(): Promise<void>;
}

/** Allowed status changes. Same-status updates are no-ops. */
const TRANSITIONS: Record<ModelLifecycleStatus, readonly ModelLifecycleStatus[]> = {
  candidate: ['active', 'legacy', 'retired'],
  active: ['legacy', 'retired'],
  legacy: ['active', 'retired'],
  retired: ['candidate', 'active'],
};

export function canTransition(from: ModelLifecycleStatus, to: ModelLifecycleStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export function isModelLifecycleStatus(value: unknown): value is ModelLifecycleStatus {
  return typeof value === 'string' && (MODEL_LIFECYCLE_STATUSES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------------------------

export class InMemoryModelRegistryStore implements ModelRegistryStore {
  private records = new Map<string, ModelLifecycleRecord>();
  private events: ModelRegistryEvent[] = [];

  async init(): Promise<void> {}
  async loadRecords(): Promise<ModelLifecycleRecord[]> {
    return Array.from(this.records.values()).map((r) => structuredClone(r));
  }
  async save(record: ModelLifecycleRecord, event: ModelRegistryEventInput): Promise<void> {
    this.records.set(record.modelId, structuredClone(record));
    this.events.push({ ...event, id: this.events.length + 1 });
  }
  async listEvents(options?: { modelId?: string; limit?: number }): Promise<ModelRegistryEvent[]> {
    return filterEvents(this.events, options);
  }
  async close(): Promise<void> {}
}

function filterEvents(events: ModelRegistryEvent[], options?: { modelId?: string; limit?: number }): ModelRegistryEvent[] {
  const limit = Math.min(Math.max(options?.limit ?? 100, 1), 500);
  return events
    .filter((e) => !options?.modelId || e.modelId === options.modelId)
    .sort((a, b) => b.id - a.id)
    .slice(0, limit);
}

export class SqliteModelRegistryStore implements ModelRegistryStore {
  private db: Database;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
  }

  async init(): Promise<void> {
    this.db.run(`CREATE TABLE IF NOT EXISTS lyra_model_registry (
      model_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      reason TEXT,
      superseded_by TEXT,
      source TEXT NOT NULL,
      status_changed_at TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT,
      updated_by TEXT NOT NULL,
      profile TEXT
    )`);
    this.db.run(`CREATE TABLE IF NOT EXISTS lyra_model_registry_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id TEXT NOT NULL,
      at TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      reason TEXT
    )`);
    this.db.run(`CREATE INDEX IF NOT EXISTS lyra_model_registry_events_model ON lyra_model_registry_events (model_id, id)`);
  }

  async loadRecords(): Promise<ModelLifecycleRecord[]> {
    const rows = this.db.query(`SELECT * FROM lyra_model_registry`).all() as any[];
    return rows.map((r) => ({
      modelId: r.model_id,
      status: r.status,
      reason: r.reason ?? undefined,
      supersededBy: r.superseded_by ?? undefined,
      source: r.source,
      statusChangedAt: r.status_changed_at,
      firstSeenAt: r.first_seen_at,
      lastSeenAt: r.last_seen_at ?? undefined,
      updatedBy: r.updated_by,
      profile: r.profile ? JSON.parse(r.profile) : undefined,
    }));
  }

  async save(record: ModelLifecycleRecord, event: ModelRegistryEventInput): Promise<void> {
    const write = this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO lyra_model_registry
             (model_id, status, reason, superseded_by, source, status_changed_at, first_seen_at, last_seen_at, updated_by, profile)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(model_id) DO UPDATE SET
             status = excluded.status, reason = excluded.reason, superseded_by = excluded.superseded_by,
             source = excluded.source, status_changed_at = excluded.status_changed_at,
             last_seen_at = excluded.last_seen_at, updated_by = excluded.updated_by, profile = excluded.profile`
        )
        .run(
          record.modelId,
          record.status,
          record.reason ?? null,
          record.supersededBy ?? null,
          record.source,
          record.statusChangedAt,
          record.firstSeenAt,
          record.lastSeenAt ?? null,
          record.updatedBy,
          record.profile ? JSON.stringify(record.profile) : null
        );
      this.db
        .query(
          `INSERT INTO lyra_model_registry_events (model_id, at, actor, action, from_status, to_status, reason)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(event.modelId, event.at, event.actor, event.action, event.fromStatus ?? null, event.toStatus ?? null, event.reason ?? null);
    });
    write();
  }

  async listEvents(options?: { modelId?: string; limit?: number }): Promise<ModelRegistryEvent[]> {
    const limit = Math.min(Math.max(options?.limit ?? 100, 1), 500);
    const rows = (options?.modelId
      ? this.db.query(`SELECT * FROM lyra_model_registry_events WHERE model_id = ? ORDER BY id DESC LIMIT ?`).all(options.modelId, limit)
      : this.db.query(`SELECT * FROM lyra_model_registry_events ORDER BY id DESC LIMIT ?`).all(limit)) as any[];
    return rows.map(eventFromRow);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

function eventFromRow(r: any): ModelRegistryEvent {
  return {
    id: Number(r.id),
    modelId: r.model_id,
    at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
    actor: r.actor,
    action: r.action,
    fromStatus: r.from_status ?? undefined,
    toStatus: r.to_status ?? undefined,
    reason: r.reason ?? undefined,
  };
}

export class PostgresModelRegistryStore implements ModelRegistryStore {
  private readonly sql: ReturnType<typeof postgres>;

  constructor(connection: { host: string; port?: number; database: string; username: string; password: string; ssl?: boolean }) {
    this.sql = postgres({
      host: connection.host,
      port: connection.port || 5432,
      database: connection.database,
      username: connection.username,
      password: connection.password,
      ssl: connection.ssl ? 'require' : false,
      max: 3,
      idle_timeout: 30,
      connect_timeout: 10,
      onnotice: () => undefined,
    });
  }

  async init(): Promise<void> {
    await this.sql`CREATE TABLE IF NOT EXISTS lyra_model_registry (
      model_id text PRIMARY KEY,
      status text NOT NULL,
      reason text,
      superseded_by text,
      source text NOT NULL,
      status_changed_at timestamptz NOT NULL,
      first_seen_at timestamptz NOT NULL,
      last_seen_at timestamptz,
      updated_by text NOT NULL,
      profile jsonb
    )`;
    await this.sql`CREATE TABLE IF NOT EXISTS lyra_model_registry_events (
      id bigserial PRIMARY KEY,
      model_id text NOT NULL,
      at timestamptz NOT NULL,
      actor text NOT NULL,
      action text NOT NULL,
      from_status text,
      to_status text,
      reason text
    )`;
    await this.sql`CREATE INDEX IF NOT EXISTS lyra_model_registry_events_model ON lyra_model_registry_events (model_id, id)`;
  }

  async loadRecords(): Promise<ModelLifecycleRecord[]> {
    const rows = await this.sql`SELECT * FROM lyra_model_registry`;
    const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
    return rows.map((r: any) => ({
      modelId: r.model_id,
      status: r.status,
      reason: r.reason ?? undefined,
      supersededBy: r.superseded_by ?? undefined,
      source: r.source,
      statusChangedAt: iso(r.status_changed_at),
      firstSeenAt: iso(r.first_seen_at),
      lastSeenAt: r.last_seen_at ? iso(r.last_seen_at) : undefined,
      updatedBy: r.updated_by,
      profile: r.profile ?? undefined,
    }));
  }

  async save(record: ModelLifecycleRecord, event: ModelRegistryEventInput): Promise<void> {
    await this.sql.begin(async (tx: any) => {
      await tx`INSERT INTO lyra_model_registry
          (model_id, status, reason, superseded_by, source, status_changed_at, first_seen_at, last_seen_at, updated_by, profile)
        VALUES (${record.modelId}, ${record.status}, ${record.reason ?? null}, ${record.supersededBy ?? null}, ${record.source},
          ${record.statusChangedAt}, ${record.firstSeenAt}, ${record.lastSeenAt ?? null}, ${record.updatedBy},
          ${record.profile ? tx.json(record.profile as any) : null})
        ON CONFLICT (model_id) DO UPDATE SET
          status = EXCLUDED.status, reason = EXCLUDED.reason, superseded_by = EXCLUDED.superseded_by,
          source = EXCLUDED.source, status_changed_at = EXCLUDED.status_changed_at,
          last_seen_at = EXCLUDED.last_seen_at, updated_by = EXCLUDED.updated_by, profile = EXCLUDED.profile`;
      await tx`INSERT INTO lyra_model_registry_events (model_id, at, actor, action, from_status, to_status, reason)
        VALUES (${event.modelId}, ${event.at}, ${event.actor}, ${event.action}, ${event.fromStatus ?? null}, ${event.toStatus ?? null}, ${event.reason ?? null})`;
    });
  }

  async listEvents(options?: { modelId?: string; limit?: number }): Promise<ModelRegistryEvent[]> {
    const limit = Math.min(Math.max(options?.limit ?? 100, 1), 500);
    const rows = options?.modelId
      ? await this.sql`SELECT * FROM lyra_model_registry_events WHERE model_id = ${options.modelId} ORDER BY id DESC LIMIT ${limit}`
      : await this.sql`SELECT * FROM lyra_model_registry_events ORDER BY id DESC LIMIT ${limit}`;
    return rows.map(eventFromRow);
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}

// ---------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------

export class ModelRegistryError extends Error {
  constructor(message: string, readonly code: 'invalid_transition' | 'unknown_model' | 'already_exists' | 'invalid_input') {
    super(message);
    this.name = 'ModelRegistryError';
  }
}

export interface StatusChangeOptions {
  actor: string;
  reason?: string;
  supersededBy?: string;
}

export class ModelRegistry {
  private records = new Map<string, ModelLifecycleRecord>();
  private store: ModelRegistryStore = new InMemoryModelRegistryStore();

  /** Switches to a persistent store and loads its records into memory. */
  async useStore(store: ModelRegistryStore): Promise<void> {
    await store.init();
    const records = await store.loadRecords();
    const previous = this.store;
    this.store = store;
    this.records = new Map(records.map((r) => [r.modelId, r]));
    if (previous !== store) await previous.close().catch(() => undefined);
  }

  /** Re-reads records from the store (picks up changes made by another instance). */
  async reload(): Promise<void> {
    const records = await this.store.loadRecords();
    this.records = new Map(records.map((r) => [r.modelId, r]));
  }

  /** Back to an empty in-memory registry. Used by tests. */
  async reset(): Promise<void> {
    await this.useStore(new InMemoryModelRegistryStore());
  }

  getRecord(modelId: string): ModelLifecycleRecord | undefined {
    return this.records.get(modelId);
  }

  /** Seed models without a record are active. */
  getStatus(modelId: string): ModelLifecycleStatus {
    return this.records.get(modelId)?.status ?? 'active';
  }

  listRecords(): ModelLifecycleRecord[] {
    return Array.from(this.records.values());
  }

  /** Profiles of models that exist only in the registry (not in the seed catalog). */
  dynamicProfiles(): CanonicalModelProfile[] {
    return this.listRecords()
      .filter((r) => r.profile)
      .map((r) => r.profile!);
  }

  async listEvents(options?: { modelId?: string; limit?: number }): Promise<ModelRegistryEvent[]> {
    return this.store.listEvents(options);
  }

  async setStatus(modelId: string, status: ModelLifecycleStatus, options: StatusChangeOptions): Promise<ModelLifecycleRecord> {
    const existing = this.records.get(modelId);
    const from = existing?.status ?? 'active';
    if (!canTransition(from, status)) {
      throw new ModelRegistryError(`Cannot move ${modelId} from ${from} to ${status}`, 'invalid_transition');
    }
    const now = new Date().toISOString();
    const next: ModelLifecycleRecord = {
      modelId,
      status,
      reason: cleanText(options.reason, 500),
      supersededBy: status === 'active' || status === 'candidate' ? undefined : options.supersededBy ?? existing?.supersededBy,
      source: existing?.source ?? 'seed',
      statusChangedAt: from === status && existing ? existing.statusChangedAt : now,
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastSeenAt: existing?.lastSeenAt,
      updatedBy: cleanText(options.actor, 100) || 'unknown',
      profile: existing?.profile,
    };
    await this.store.save(next, {
      modelId,
      at: now,
      actor: next.updatedBy,
      action: from === status ? 'supersede' : 'status',
      fromStatus: from,
      toStatus: status,
      reason: next.reason,
    });
    this.records.set(modelId, next);
    return next;
  }

  /** Registers a model that is not in the seed catalog as a candidate. The profile must be validated by the caller. */
  async addCandidate(
    profile: CanonicalModelProfile,
    options: { actor: string; source?: ModelRecordSource; reason?: string }
  ): Promise<ModelLifecycleRecord> {
    if (this.records.has(profile.id)) {
      throw new ModelRegistryError(`Model ${profile.id} is already registered`, 'already_exists');
    }
    const now = new Date().toISOString();
    const record: ModelLifecycleRecord = {
      modelId: profile.id,
      status: 'candidate',
      reason: cleanText(options.reason, 500),
      source: options.source ?? 'discovered',
      statusChangedAt: now,
      firstSeenAt: now,
      lastSeenAt: now,
      updatedBy: cleanText(options.actor, 100) || 'unknown',
      profile,
    };
    await this.store.save(record, {
      modelId: profile.id,
      at: now,
      actor: record.updatedBy,
      action: 'add',
      toStatus: 'candidate',
      reason: record.reason,
    });
    this.records.set(profile.id, record);
    return record;
  }
}

/** Strips control characters and caps length; provider- and user-supplied text is untrusted. */
export function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
  return cleaned || undefined;
}

export const modelRegistry = new ModelRegistry();

let refreshTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Connects the shared registry to durable storage: Postgres when configured (production), otherwise
 * a local SQLite file. If storage cannot be opened the registry stays in memory, which means every
 * seed model is active (the pre-registry behavior) rather than failing the server.
 */
export async function initModelRegistry(): Promise<'postgres' | 'sqlite' | 'memory'> {
  try {
    const pg = resolvePostgresConfig();
    if (pg) {
      await modelRegistry.useStore(
        new PostgresModelRegistryStore({
          host: pg.host,
          port: pg.port,
          database: pg.database,
          username: pg.user,
          password: pg.password,
          ssl: pg.ssl,
        })
      );
      startRefresh();
      return 'postgres';
    }
    const dbPath = process.env.LYRA_MODEL_REGISTRY_PATH || path.resolve('server/data/model-registry.sqlite');
    await modelRegistry.useStore(new SqliteModelRegistryStore(dbPath));
    return 'sqlite';
  } catch (err) {
    console.warn('[Lyra Models] Registry storage unavailable, using in-memory lifecycle state:', err instanceof Error ? err.message : String(err));
    return 'memory';
  }
}

function startRefresh(): void {
  if (refreshTimer) return;
  // Pick up changes made by another instance without a restart.
  refreshTimer = setInterval(() => {
    modelRegistry.reload().catch((err) => console.warn('[Lyra Models] Registry reload failed:', err instanceof Error ? err.message : String(err)));
  }, 5 * 60 * 1000);
  refreshTimer.unref?.();
}
