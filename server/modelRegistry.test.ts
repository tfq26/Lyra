import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  canTransition,
  initModelRegistry,
  InMemoryModelRegistryStore,
  ModelRegistry,
  ModelRegistryError,
  modelRegistry,
  SqliteModelRegistryStore,
  cleanText,
  type ModelLifecycleRecord,
  type ModelRegistryStore,
} from './modelRegistry';
import type { CanonicalModelProfile } from './unifiedModelCatalog';

const profile = (id: string): CanonicalModelProfile => ({
  id,
  name: `Model ${id}`,
  family: 'qwen',
  tier: 2,
  metrics: { reasoningScore: 80, codingScore: 80, toolProficiency: 80, contextWindowTokens: 128_000, avgTtftMs: 300, tokensPerSecond: 100 },
  strengths: [],
  routes: [
    {
      provider: 'openrouter',
      upstreamModelId: `vendor/${id}`,
      priority: 1,
      apiStyle: 'openai-chat',
      pricing: { inputPerMillion: 1, outputPerMillion: 2 },
      supportsPromptCaching: false,
    },
  ],
});

describe('lifecycle transitions', () => {
  test('allows the documented moves and rejects the rest', () => {
    expect(canTransition('candidate', 'active')).toBe(true);
    expect(canTransition('active', 'legacy')).toBe(true);
    expect(canTransition('legacy', 'active')).toBe(true);
    expect(canTransition('legacy', 'retired')).toBe(true);
    expect(canTransition('retired', 'active')).toBe(true);
    expect(canTransition('active', 'candidate')).toBe(false);
    expect(canTransition('retired', 'legacy')).toBe(false);
    expect(canTransition('active', 'active')).toBe(true);
  });
});

describe('cleanText', () => {
  test('strips control characters, trims and caps length', () => {
    expect(cleanText('  hi\u0000 there\n', 50)).toBe('hi  there');
    expect(cleanText('x'.repeat(500), 10)).toBe('xxxxxxxxxx');
    expect(cleanText('   ', 10)).toBeUndefined();
    expect(cleanText(42 as unknown, 10)).toBeUndefined();
  });
});

describe('ModelRegistry', () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  const stores: Array<[string, () => ModelRegistryStore]> = [
    ['in-memory store', () => new InMemoryModelRegistryStore()],
    ['sqlite store', () => new SqliteModelRegistryStore(':memory:')],
  ];

  for (const [label, makeStore] of stores) {
    describe(label, () => {
      test('seed models are active until a record says otherwise', async () => {
        const registry = new ModelRegistry();
        await registry.useStore(makeStore());
        expect(registry.getStatus('claude-sonnet-4-6')).toBe('active');
        expect(registry.getRecord('claude-sonnet-4-6')).toBeUndefined();
      });

      test('setStatus records the change with an audit event', async () => {
        const registry = new ModelRegistry();
        await registry.useStore(makeStore());

        const record = await registry.setStatus('gpt-4o', 'legacy', { actor: 'tester', reason: 'superseded', supersededBy: 'gpt-5' });
        expect(record).toMatchObject({ status: 'legacy', supersededBy: 'gpt-5', source: 'seed', updatedBy: 'tester' });
        expect(registry.getStatus('gpt-4o')).toBe('legacy');

        const [event] = await registry.listEvents({ modelId: 'gpt-4o' });
        expect(event).toMatchObject({ modelId: 'gpt-4o', action: 'status', fromStatus: 'active', toStatus: 'legacy', actor: 'tester', reason: 'superseded' });
      });

      test('rejects invalid transitions without changing anything', async () => {
        const registry = new ModelRegistry();
        await registry.useStore(makeStore());
        await registry.setStatus('gpt-4o', 'retired', { actor: 'tester' });
        await expect(registry.setStatus('gpt-4o', 'legacy', { actor: 'tester' })).rejects.toMatchObject({ code: 'invalid_transition' });
        expect(registry.getStatus('gpt-4o')).toBe('retired');
        expect(await registry.listEvents({ modelId: 'gpt-4o' })).toHaveLength(1);
      });

      test('promoting back to active clears the successor link', async () => {
        const registry = new ModelRegistry();
        await registry.useStore(makeStore());
        await registry.setStatus('gpt-4o', 'legacy', { actor: 'a', supersededBy: 'gpt-5' });
        const restored = await registry.setStatus('gpt-4o', 'active', { actor: 'a' });
        expect(restored.supersededBy).toBeUndefined();
      });

      test('addCandidate stores the full profile and refuses duplicates', async () => {
        const registry = new ModelRegistry();
        await registry.useStore(makeStore());

        const record = await registry.addCandidate(profile('new-model'), { actor: 'sync', source: 'discovered' });
        expect(record).toMatchObject({ status: 'candidate', source: 'discovered' });
        expect(registry.dynamicProfiles().map((p) => p.id)).toEqual(['new-model']);
        await expect(registry.addCandidate(profile('new-model'), { actor: 'sync' })).rejects.toMatchObject({ code: 'already_exists' });

        const events = await registry.listEvents({ modelId: 'new-model' });
        expect(events.map((e) => e.action)).toEqual(['add']);
      });

      test('events are returned newest first and respect the limit', async () => {
        const registry = new ModelRegistry();
        await registry.useStore(makeStore());
        await registry.setStatus('gpt-4o', 'legacy', { actor: 'a' });
        await registry.setStatus('gpt-4o', 'retired', { actor: 'a' });
        await registry.setStatus('gpt-4o', 'active', { actor: 'a' });

        const all = await registry.listEvents({ modelId: 'gpt-4o' });
        expect(all.map((e) => e.toStatus)).toEqual(['active', 'retired', 'legacy']);
        expect(await registry.listEvents({ modelId: 'gpt-4o', limit: 1 })).toHaveLength(1);
      });
    });
  }

  test('state survives a restart (sqlite file)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyra-registry-'));
    tmpDirs.push(dir);
    const file = path.join(dir, 'registry.sqlite');

    const first = new ModelRegistry();
    await first.useStore(new SqliteModelRegistryStore(file));
    await first.setStatus('gpt-4o', 'legacy', { actor: 'a', reason: 'old', supersededBy: 'gpt-5' });
    await first.addCandidate(profile('fresh-model'), { actor: 'sync' });

    const second = new ModelRegistry();
    await second.useStore(new SqliteModelRegistryStore(file));
    expect(second.getStatus('gpt-4o')).toBe('legacy');
    expect(second.getRecord('gpt-4o')).toMatchObject({ reason: 'old', supersededBy: 'gpt-5' });
    expect(second.getRecord('fresh-model')?.profile?.routes[0]?.upstreamModelId).toBe('vendor/fresh-model');
    expect((await second.listEvents()).length).toBe(2);
  });

  test('reload picks up changes written by another instance', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyra-registry-'));
    tmpDirs.push(dir);
    const file = path.join(dir, 'registry.sqlite');

    const a = new ModelRegistry();
    const b = new ModelRegistry();
    await a.useStore(new SqliteModelRegistryStore(file));
    await b.useStore(new SqliteModelRegistryStore(file));

    await a.setStatus('gpt-4o', 'legacy', { actor: 'a' });
    expect(b.getStatus('gpt-4o')).toBe('active');
    await b.reload();
    expect(b.getStatus('gpt-4o')).toBe('legacy');
  });

  test('a failed write leaves the visible state unchanged', async () => {
    class FailingStore extends InMemoryModelRegistryStore {
      override async save(_record: ModelLifecycleRecord): Promise<void> {
        throw new Error('database unavailable');
      }
    }
    const registry = new ModelRegistry();
    await registry.useStore(new FailingStore());

    await expect(registry.setStatus('gpt-4o', 'retired', { actor: 'a' })).rejects.toThrow('database unavailable');
    expect(registry.getStatus('gpt-4o')).toBe('active');
    await expect(registry.addCandidate(profile('x-model'), { actor: 'a' })).rejects.toThrow('database unavailable');
    expect(registry.dynamicProfiles()).toEqual([]);
  });

  describe('initModelRegistry', () => {
    const ENV_KEYS = ['DATABASE_URL', 'LYRA_DATABASE_URL', 'LYRA_DATABASE_HOST', 'LYRA_MODEL_REGISTRY_PATH'];
    const saved: Record<string, string | undefined> = {};

    afterEach(async () => {
      for (const key of ENV_KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
      await modelRegistry.reset();
    });

    // Bun auto-loads .env, so pin every variable that selects the backend.
    const pinEnv = (dbPath: string) => {
      for (const key of ENV_KEYS) saved[key] = process.env[key];
      delete process.env.DATABASE_URL;
      delete process.env.LYRA_DATABASE_URL;
      delete process.env.LYRA_DATABASE_HOST;
      process.env.LYRA_MODEL_REGISTRY_PATH = dbPath;
    };

    test('uses a local SQLite file when PostgreSQL is not configured', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyra-registry-'));
      tmpDirs.push(dir);
      pinEnv(path.join(dir, 'registry.sqlite'));

      expect(await initModelRegistry()).toBe('sqlite');
      await modelRegistry.setStatus('gpt-4o', 'legacy', { actor: 'test' });
      expect(fs.existsSync(path.join(dir, 'registry.sqlite'))).toBe(true);
    });

    test('falls back to in-memory state (all seed models active) when storage cannot be opened', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyra-registry-'));
      tmpDirs.push(dir);
      const blocker = path.join(dir, 'a-file');
      fs.writeFileSync(blocker, 'x');
      pinEnv(path.join(blocker, 'nested', 'registry.sqlite')); // parent is a file, so this cannot be created

      expect(await initModelRegistry()).toBe('memory');
      expect(modelRegistry.getStatus('gpt-4o')).toBe('active');
    });
  });

  test('errors carry a machine-readable code', async () => {
    const registry = new ModelRegistry();
    await registry.useStore(new InMemoryModelRegistryStore());
    await registry.setStatus('gpt-4o', 'retired', { actor: 'a' });
    const err = await registry.setStatus('gpt-4o', 'legacy', { actor: 'a' }).catch((e) => e);
    expect(err).toBeInstanceOf(ModelRegistryError);
    expect(err.code).toBe('invalid_transition');
  });
});
