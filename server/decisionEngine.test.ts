import { describe, it, expect } from 'bun:test';
import { DecisionEngine } from './decisionEngine';

describe('DecisionEngine', () => {
  const engine = new DecisionEngine();

  it('allows safe, grounded diffs and commands', async () => {
    const verdict = await engine.evaluate({
      stage: 'pre_merge',
      filesChanged: ['src/utils.ts'],
      diff: '+ export function add(a: number, b: number) { return a + b; }',
      command: 'bun test',
    });

    expect(verdict.allowed).toBe(true);
    expect(verdict.action).toBe('ALLOW');
    expect(verdict.violations.length).toBe(0);
  });

  it('denies diffs containing exposed AWS keys via Guardrails integration', async () => {
    const verdict = await engine.evaluate({
      stage: 'pre_merge',
      diff: '+ const secret = "AKIAIOSFODNN7EXAMPLE";',
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.action).toBe('DENY');
    expect(verdict.violations.some((v) => v.rule.includes('SECURITY'))).toBe(true);
  });

  it('denies destructive database schema changes (DROP TABLE)', async () => {
    const verdict = await engine.evaluate({
      stage: 'pre_merge',
      diff: '+ DROP TABLE users;',
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.action).toBe('DENY');
    expect(verdict.violations.some((v) => v.rule === 'BREAKING_SCHEMA_DROP_TABLE')).toBe(true);
  });

  it('requires approval when blast radius exceeds max files threshold', async () => {
    const manyFiles = Array.from({ length: 25 }, (_, i) => `src/file${i}.ts`);
    const verdict = await engine.evaluate({
      stage: 'plan',
      filesChanged: manyFiles,
      maxFilesPerTask: 20,
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.action).toBe('REQUIRE_APPROVAL');
    expect(verdict.violations.some((v) => v.rule === 'BLAST_RADIUS_EXCEEDED')).toBe(true);
  });

  it('flags unauthorized external network egress', async () => {
    const verdict = await engine.evaluate({
      stage: 'tool_execution',
      networkHost: 'untrusted-external-domain.xyz',
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.action).toBe('REQUIRE_APPROVAL');
    expect(verdict.violations.some((v) => v.rule === 'UNAUTHORIZED_NETWORK_EGRESS')).toBe(true);
  });
});
