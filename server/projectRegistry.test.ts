import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import { ProjectRegistry } from './projectRegistry';

describe('ProjectRegistry', () => {
  test('creates hashed project keys, authenticates, tracks usage, enforces budget, and revokes', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyra-proj-test-'));
    const storePath = path.join(tmpDir, 'projects.json');
    const registry = new ProjectRegistry(storePath);

    const { project, apiKey } = registry.createProject({
      name: 'My SaaS App',
      defaultPolicyProfile: 'frontier',
      monthlyBudgetUsd: 5.0,
    });

    expect(apiKey.startsWith('lyra_proj_')).toBe(true);
    expect((project as any).keyHash).toBeUndefined();

    // Persisted file should not contain plaintext apiKey
    const rawSaved = fs.readFileSync(storePath, 'utf8');
    expect(rawSaved.includes(apiKey)).toBe(false);

    // Authenticates valid key, rejects invalid key
    const authed = registry.authenticate(apiKey);
    expect(authed?.id).toBe(project.id);
    expect(registry.authenticate('lyra_proj_invalid')).toBeNull();

    // Budget enforcement
    expect(registry.checkBudget(project.id).allowed).toBe(true);
    registry.recordUsage(project.id, 5.25, 12000);
    expect(registry.checkBudget(project.id).allowed).toBe(false);

    // Revocation
    expect(registry.revokeProject(project.id)).toBe(true);
    expect(registry.authenticate(apiKey)).toBeNull();

    // Daily cap & global daily cap
    const cappedRegistry = new ProjectRegistry(path.join(tmpDir, 'projects-capped.json'), 1.0);
    const { project: p2 } = cappedRegistry.createProject({ name: 'Daily Capped', dailyBudgetUsd: 0.5, monthlyBudgetUsd: 50 });
    const { project: p3 } = cappedRegistry.createProject({ name: 'Other App', dailyBudgetUsd: 5, monthlyBudgetUsd: 50 });
    cappedRegistry.recordUsage(p2.id, 0.5, 1000);
    expect(cappedRegistry.checkBudget(p2.id).allowed).toBe(false);
    expect(cappedRegistry.checkBudget(p3.id).allowed).toBe(true);
    cappedRegistry.recordUsage(p3.id, 0.5, 1000); // globalDailySpentUsd is now 1.0 == globalDailyCapUsd
    expect(cappedRegistry.checkBudget(p3.id).allowed).toBe(false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
