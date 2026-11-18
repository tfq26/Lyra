import postgres from 'postgres';
import type { JSONValue } from '@strands-agents/sdk';
import type { UnifiedEvent, UnifiedStore } from './unifiedStore';

export class PostgresEventJournal {
  private readonly sql: ReturnType<typeof postgres>;
  private writes = new Set<Promise<unknown>>();
  private writeFailure?: Error;

  constructor(private readonly tenantId: string, connection: { host: string; port?: number; database: string; username: string; password: string; ssl?: boolean }) {
    this.sql = postgres({
      host: connection.host,
      port: connection.port || 5432,
      database: connection.database,
      username: connection.username,
      password: connection.password,
      ssl: connection.ssl ? 'require' : false,
      max: 5,
      idle_timeout: 30,
      connect_timeout: 10,
      onnotice: () => undefined,
    });
  }

  public async initialize(store: UnifiedStore, migrateLocalEvents = true): Promise<void> {
    await this.sql`CREATE TABLE IF NOT EXISTS lyra_events (
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
    )`;
    await this.sql`CREATE INDEX IF NOT EXISTS lyra_events_session_cursor ON lyra_events (tenant_id, session_id, sequence)`;
    await this.sql`CREATE SEQUENCE IF NOT EXISTS lyra_sync_seq`;
    await this.sql`CREATE TABLE IF NOT EXISTS lyra_synced_chats (
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
      sequence bigint NOT NULL DEFAULT nextval('lyra_sync_seq'),
      PRIMARY KEY (tenant_id, user_id, session_id)
    )`;
    await this.sql`CREATE INDEX IF NOT EXISTS lyra_synced_chats_seq_idx ON lyra_synced_chats (tenant_id, user_id, sequence)`;
    await this.sql`CREATE TABLE IF NOT EXISTS lyra_synced_tasks (
      tenant_id text NOT NULL,
      user_id text NOT NULL,
      session_id text NOT NULL,
      run_id text NOT NULL,
      stage text NOT NULL DEFAULT 'completed',
      checkpoint jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      sequence bigint NOT NULL DEFAULT nextval('lyra_sync_seq'),
      PRIMARY KEY (tenant_id, user_id, session_id, run_id)
    )`;
    await this.sql`CREATE INDEX IF NOT EXISTS lyra_synced_tasks_seq_idx ON lyra_synced_tasks (tenant_id, user_id, sequence)`;
    await this.sql`CREATE TABLE IF NOT EXISTS lyra_context_blobs (
      blob_id text PRIMARY KEY,
      session_id text,
      modality text NOT NULL DEFAULT 'text',
      content text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
    if (migrateLocalEvents) {
      for (const session of store.listSessions()) {
        const data = store.getSession(session.id);
        for (const event of data?.events || []) await this.append(event);
      }
    }
  }

  public append(event: UnifiedEvent): Promise<number> {
    const payload = JSON.parse(JSON.stringify(event.payload ?? null)) as JSONValue;
    const write = this.sql<{ sequence: number | string }[]>`INSERT INTO lyra_events (tenant_id, session_id, event_id, occurred_at, agent, event_type, run_id, payload)
      VALUES (${this.tenantId}, ${event.sessionId}, ${event.eventId}, ${event.timestamp}, ${event.agent}, ${event.type}, ${event.runId || null}, ${this.sql.json(payload)})
      ON CONFLICT (tenant_id, event_id) DO NOTHING RETURNING sequence`.then(async (rows) => {
        if (rows[0]) return Number(rows[0].sequence);
        const existing = await this.sql<{ sequence: number | string }[]>`SELECT sequence FROM lyra_events WHERE tenant_id = ${this.tenantId} AND event_id = ${event.eventId} LIMIT 1`;
        return Number(existing[0]?.sequence || 0);
      });
    this.writes.add(write);
    void write.then(() => this.writes.delete(write), (error) => {
      this.writeFailure = error instanceof Error ? error : new Error(String(error));
      this.writes.delete(write);
    });
    return write;
  }

  public async waitForWrites(): Promise<void> {
    await Promise.all([...this.writes]);
    if (this.writeFailure) throw new Error(`PostgreSQL event persistence failed: ${this.writeFailure.message}`);
  }

  public async saveContextBlob(blob: { id: string; sessionId?: string; modality: string; content: string }): Promise<void> {
    await this.sql`INSERT INTO lyra_context_blobs (blob_id, session_id, modality, content)
      VALUES (${blob.id}, ${blob.sessionId || null}, ${blob.modality}, ${blob.content})
      ON CONFLICT (blob_id) DO NOTHING`;
  }

  public async loadContextBlob(blobId: string): Promise<string | null> {
    const rows = await this.sql<{ content: string }[]>`SELECT content FROM lyra_context_blobs WHERE blob_id = ${blobId} LIMIT 1`;
    return rows[0]?.content ?? null;
  }

  public async getSessionEvents(sessionId: string, after = 0, limit = 10_000): Promise<UnifiedEvent[]> {
    await this.waitForWrites();
    const rows = await this.sql<{ sequence: number | string; event_id: string; session_id: string; occurred_at: Date; agent: UnifiedEvent['agent']; event_type: UnifiedEvent['type']; run_id: string | null; payload: unknown }[]>`
      SELECT sequence, event_id, session_id, occurred_at, agent, event_type, run_id, payload
      FROM lyra_events WHERE tenant_id = ${this.tenantId} AND session_id = ${sessionId} AND sequence > ${after} ORDER BY sequence ASC LIMIT ${Math.min(10_000, Math.max(1, limit))}`;
    return rows.map((row) => ({ sequence: Number(row.sequence), eventId: row.event_id, sessionId: row.session_id, timestamp: row.occurred_at.toISOString(), agent: row.agent, type: row.event_type, runId: row.run_id || undefined, payload: row.payload }));
  }

  public async syncChatsAndTasks(
    userId: string,
    payload: { sinceSeq?: number; chats?: any[]; tasks?: any[]; deletedChatIds?: string[] }
  ): Promise<{ latestSeq: number; chats: any[]; tasks: any[]; deletedChatIds: string[] }> {
    const sinceSeq = Number(payload.sinceSeq || 0);

    for (const chat of payload.chats || []) {
      if (!chat?.sessionId) continue;
      const msgs = JSON.parse(JSON.stringify(chat.messages || [])) as JSONValue;
      const updatedAt = chat.updatedAt || new Date().toISOString();
      await this.sql`
        INSERT INTO lyra_synced_chats (tenant_id, user_id, session_id, title, project_id, project_label, model_id, messages, updated_at, deleted, sequence)
        VALUES (${this.tenantId}, ${userId}, ${chat.sessionId}, ${chat.title || 'Untitled chat'}, ${chat.projectId || 'local'}, ${chat.projectLabel || 'Local workspace'}, ${chat.modelId || 'auto'}, ${this.sql.json(msgs)}, ${updatedAt}, false, nextval('lyra_sync_seq'))
        ON CONFLICT (tenant_id, user_id, session_id) DO UPDATE SET
          title = EXCLUDED.title,
          project_id = EXCLUDED.project_id,
          project_label = EXCLUDED.project_label,
          model_id = EXCLUDED.model_id,
          messages = EXCLUDED.messages,
          updated_at = EXCLUDED.updated_at,
          deleted = false,
          sequence = nextval('lyra_sync_seq')
        WHERE EXCLUDED.updated_at >= lyra_synced_chats.updated_at
      `;
    }

    for (const cp of payload.tasks || []) {
      if (!cp?.sessionId || !cp?.runId) continue;
      const cpJson = JSON.parse(JSON.stringify(cp)) as JSONValue;
      const updatedAt = cp.timestamp || new Date().toISOString();
      await this.sql`
        INSERT INTO lyra_synced_tasks (tenant_id, user_id, session_id, run_id, stage, checkpoint, updated_at, sequence)
        VALUES (${this.tenantId}, ${userId}, ${cp.sessionId}, ${cp.runId}, ${cp.stage || 'completed'}, ${this.sql.json(cpJson)}, ${updatedAt}, nextval('lyra_sync_seq'))
        ON CONFLICT (tenant_id, user_id, session_id, run_id) DO UPDATE SET
          stage = EXCLUDED.stage,
          checkpoint = EXCLUDED.checkpoint,
          updated_at = EXCLUDED.updated_at,
          sequence = nextval('lyra_sync_seq')
      `;
    }

    for (const delId of payload.deletedChatIds || []) {
      if (!delId) continue;
      await this.sql`
        INSERT INTO lyra_synced_chats (tenant_id, user_id, session_id, updated_at, deleted, sequence)
        VALUES (${this.tenantId}, ${userId}, ${delId}, ${new Date().toISOString()}, true, nextval('lyra_sync_seq'))
        ON CONFLICT (tenant_id, user_id, session_id) DO UPDATE SET
          deleted = true,
          updated_at = EXCLUDED.updated_at,
          sequence = nextval('lyra_sync_seq')
      `;
      await this.sql`DELETE FROM lyra_synced_tasks WHERE tenant_id = ${this.tenantId} AND user_id = ${userId} AND session_id = ${delId}`;
    }

    const chatRows = await this.sql<{ session_id: string; title: string; project_id: string; project_label: string; model_id: string; messages: unknown[]; updated_at: Date; deleted: boolean; sequence: number | string }[]>`
      SELECT session_id, title, project_id, project_label, model_id, messages, updated_at, deleted, sequence
      FROM lyra_synced_chats
      WHERE tenant_id = ${this.tenantId} AND user_id = ${userId} AND sequence > ${sinceSeq}
      ORDER BY sequence ASC
    `;

    const taskRows = await this.sql<{ checkpoint: any; sequence: number | string }[]>`
      SELECT checkpoint, sequence
      FROM lyra_synced_tasks
      WHERE tenant_id = ${this.tenantId} AND user_id = ${userId} AND sequence > ${sinceSeq}
      ORDER BY sequence ASC
    `;

    let latestSeq = sinceSeq;
    const chats: any[] = [];
    const deletedChatIds: string[] = [];
    for (const r of chatRows) {
      const seq = Number(r.sequence);
      if (seq > latestSeq) latestSeq = seq;
      if (r.deleted) {
        deletedChatIds.push(r.session_id);
      } else {
        chats.push({
          sessionId: r.session_id,
          title: r.title,
          projectId: r.project_id,
          projectLabel: r.project_label,
          modelId: r.model_id,
          messages: r.messages || [],
          updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
          syncSeq: seq,
        });
      }
    }

    const tasks: any[] = [];
    for (const r of taskRows) {
      const seq = Number(r.sequence);
      if (seq > latestSeq) latestSeq = seq;
      if (r.checkpoint && typeof r.checkpoint === 'object') {
        tasks.push({ ...r.checkpoint, syncSeq: seq });
      }
    }

    return { latestSeq, chats, tasks, deletedChatIds };
  }

  public async clearSession(sessionId: string): Promise<void> { await this.sql`DELETE FROM lyra_events WHERE tenant_id = ${this.tenantId} AND session_id = ${sessionId}`; }
  public async deleteSession(sessionId: string): Promise<void> { await this.clearSession(sessionId); }
  public async close(): Promise<void> { await this.waitForWrites(); await this.sql.end({ timeout: 5 }); }
}
