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

  public async getSessionEvents(sessionId: string, after = 0, limit = 10_000): Promise<UnifiedEvent[]> {
    await this.waitForWrites();
    const rows = await this.sql<{ sequence: number | string; event_id: string; session_id: string; occurred_at: Date; agent: UnifiedEvent['agent']; event_type: UnifiedEvent['type']; run_id: string | null; payload: unknown }[]>`
      SELECT sequence, event_id, session_id, occurred_at, agent, event_type, run_id, payload
      FROM lyra_events WHERE tenant_id = ${this.tenantId} AND session_id = ${sessionId} AND sequence > ${after} ORDER BY sequence ASC LIMIT ${Math.min(10_000, Math.max(1, limit))}`;
    return rows.map((row) => ({ sequence: Number(row.sequence), eventId: row.event_id, sessionId: row.session_id, timestamp: row.occurred_at.toISOString(), agent: row.agent, type: row.event_type, runId: row.run_id || undefined, payload: row.payload }));
  }

  public async clearSession(sessionId: string): Promise<void> { await this.sql`DELETE FROM lyra_events WHERE tenant_id = ${this.tenantId} AND session_id = ${sessionId}`; }
  public async deleteSession(sessionId: string): Promise<void> { await this.clearSession(sessionId); }
  public async close(): Promise<void> { await this.waitForWrites(); await this.sql.end({ timeout: 5 }); }
}
