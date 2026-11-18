import { afterEach, describe, expect, test } from 'bun:test';
import { resolvePostgresConfig } from './postgresConfig';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('resolvePostgresConfig', () => {
  test('parses DATABASE_URL with ssl enabled by default', () => {
    delete process.env.LYRA_DATABASE_HOST;
    process.env.DATABASE_URL = 'postgresql://postgres:secret%21@tramway.proxy.rlwy.net:54321/railway';
    const cfg = resolvePostgresConfig();
    expect(cfg).toEqual({
      host: 'tramway.proxy.rlwy.net',
      port: 54321,
      database: 'railway',
      user: 'postgres',
      password: 'secret!',
      ssl: true,
    });
  });

  test('respects sslmode=disable on DATABASE_URL', () => {
    process.env.DATABASE_URL = 'postgresql://lyra:pass@localhost:5432/lyra?sslmode=disable';
    const cfg = resolvePostgresConfig();
    expect(cfg?.ssl).toBe(false);
    expect(cfg?.port).toBe(5432);
  });

  test('falls back to LYRA_DATABASE_* vars when DATABASE_URL is unset', () => {
    delete process.env.DATABASE_URL;
    delete process.env.LYRA_DATABASE_URL;
    process.env.LYRA_DATABASE_HOST = 'db.example.com';
    process.env.LYRA_DATABASE_PORT = '5433';
    process.env.LYRA_DATABASE_NAME = 'lyra_prod';
    process.env.LYRA_DATABASE_USER = 'lyra_admin';
    process.env.LYRA_DATABASE_PASSWORD = 'pw';
    process.env.LYRA_DATABASE_SSL = 'false';
    expect(resolvePostgresConfig()).toEqual({
      host: 'db.example.com',
      port: 5433,
      database: 'lyra_prod',
      user: 'lyra_admin',
      password: 'pw',
      ssl: false,
    });
  });
});
