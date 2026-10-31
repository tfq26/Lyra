import { describe, expect, it } from 'bun:test';
import { MigrationCanary } from './migrationCanary';

describe('MigrationCanary', () => {
  const canary = new MigrationCanary();

  it('identifies migration file paths correctly', () => {
    expect(canary.isMigrationFile('prisma/migrations/20260101_init/migration.sql')).toBe(true);
    expect(canary.isMigrationFile('migrations/001_create_users.sql')).toBe(true);
    expect(canary.isMigrationFile('db/migrations/002_add_tenants.ts')).toBe(true);
    expect(canary.isMigrationFile('src/components/App.tsx')).toBe(false);
    expect(canary.isMigrationFile('server/index.ts')).toBe(false);
  });

  it('detects safe additive migrations', () => {
    const sql = `
      -- Create users table
      CREATE TABLE users (
        id VARCHAR(64) PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_users_email ON users(email);
    `;

    const result = canary.analyzeFiles([
      { path: 'migrations/001_create_users.sql', content: sql },
    ]);

    expect(result.hasMigrations).toBe(true);
    expect(result.riskLevel).toBe('warning'); // warning only because no rollback provided
    expect(result.breakingChangesCount).toBe(0);
  });

  it('detects breaking changes: DROP TABLE and DROP COLUMN', () => {
    const sql = `
      ALTER TABLE users DROP COLUMN legacy_auth_token;
      DROP TABLE deprecated_sessions;
      TRUNCATE temp_cache;
    `;

    const result = canary.analyzeFiles([
      { path: 'migrations/002_cleanup.sql', content: sql },
    ]);

    expect(result.hasMigrations).toBe(true);
    expect(result.riskLevel).toBe('breaking');
    expect(result.breakingChangesCount).toBe(3);
    expect(result.findings[0]!.breakingChanges.some((b) => b.includes('DROP COLUMN'))).toBe(true);
    expect(result.findings[0]!.breakingChanges.some((b) => b.includes('DROP TABLE'))).toBe(true);
    expect(result.findings[0]!.breakingChanges.some((b) => b.includes('TRUNCATE'))).toBe(true);
  });

  it('detects unsafe non-nullable column without DEFAULT', () => {
    const unsafeSql = `
      ALTER TABLE users ADD COLUMN phone_number VARCHAR(32) NOT NULL;
    `;
    const safeSql = `
      ALTER TABLE users ADD COLUMN phone_number VARCHAR(32) NOT NULL DEFAULT '';
    `;

    const unsafeResult = canary.analyzeFiles([
      { path: 'migrations/003_unsafe.sql', content: unsafeSql },
    ]);
    expect(unsafeResult.riskLevel).toBe('breaking');
    expect(unsafeResult.breakingChangesCount).toBe(1);

    const safeResult = canary.analyzeFiles([
      { path: 'migrations/003_safe.sql', content: safeSql },
    ]);
    expect(safeResult.breakingChangesCount).toBe(0);
  });

  it('recognizes matching down/rollback migrations', () => {
    const upSql = `CREATE TABLE audit_logs (id TEXT PRIMARY KEY);`;
    const downSql = `DROP TABLE audit_logs;`;

    const result = canary.analyzeFiles([
      { path: 'migrations/004_audit.up.sql', content: upSql },
      { path: 'migrations/004_audit.down.sql', content: downSql },
    ]);

    expect(result.hasMigrations).toBe(true);
    expect(result.allRollbacksPresent).toBe(true);
    expect(result.riskLevel).toBe('safe');
  });

  it('executes runCanaryCheck and produces a valid CheckItem', () => {
    const check = canary.runCanaryCheck('/fake/workspace', []);
    expect(check.passed).toBe(true);
    expect(check.checkItem.name).toBe('Database Migration Canary');
    expect(check.checkItem.status).toBe('passed');
  });
});
