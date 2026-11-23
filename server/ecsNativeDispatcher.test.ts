import { afterEach, beforeEach, describe, it, expect, spyOn } from 'bun:test';
import { EcsNativeDispatcher } from './ecsNativeDispatcher';

const ENV_KEYS = ['LYRA_HOSTED', 'LYRA_ECS_CLUSTER'] as const;

/**
 * The dispatcher reads LYRA_ECS_CLUSTER at construction time, and developer machines often
 * have it set via .env. Pin the env and stub the ECS client so these tests never reach AWS.
 */
function createDispatcher(handler: (commandName: string) => unknown) {
  const dispatcher = new EcsNativeDispatcher();
  const calls: string[] = [];
  (dispatcher as any).client = {
    send: async (command: { constructor: { name: string } }) => {
      const name = command.constructor.name;
      calls.push(name);
      return handler(name);
    },
  };
  return { dispatcher, calls };
}

describe('EcsNativeDispatcher', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    delete process.env.LYRA_HOSTED;
    process.env.LYRA_ECS_CLUSTER = 'test-cluster';
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('correctly reports not configured in local environment', () => {
    const dispatcher = new EcsNativeDispatcher();
    expect(dispatcher.isConfigured()).toBe(false);
    expect(dispatcher.shouldUseFargate()).toBe(false);
  });

  it('correctly tracks active run sessions and stopped tasks', async () => {
    const { dispatcher, calls } = createDispatcher(() => ({ taskArns: [], tasks: [] }));
    dispatcher.restoreActive('session-1', 'run-1');
    dispatcher.markFinished('run-1');

    const status = await dispatcher.getTaskStatus('run-1');
    expect(status.running).toBe(false);
    expect(calls).toEqual(['ListTasksCommand']);
  });

  it('reports a live Fargate task as running', async () => {
    const arn = 'arn:aws:ecs:us-east-1:123456789012:task/test-cluster/abc';
    const { dispatcher } = createDispatcher((name) =>
      name === 'ListTasksCommand' ? { taskArns: [arn] } : { tasks: [{ lastStatus: 'RUNNING' }] }
    );

    const status = await dispatcher.getTaskStatus('run-2');
    expect(status).toEqual({ running: true, taskArn: arn, status: 'RUNNING' });
  });

  it('treats a STOPPED task as not running', async () => {
    const arn = 'arn:aws:ecs:us-east-1:123456789012:task/test-cluster/def';
    const { dispatcher } = createDispatcher((name) =>
      name === 'ListTasksCommand' ? { taskArns: [arn] } : { tasks: [{ lastStatus: 'STOPPED' }] }
    );

    const status = await dispatcher.getTaskStatus('run-3');
    expect(status.running).toBe(false);
  });

  it('returns not running instead of throwing when the ARN lookup fails', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { dispatcher } = createDispatcher(() => {
        throw new Error('Unable to refresh credentials');
      });

      const status = await dispatcher.getTaskStatus('run-4');
      expect(status).toEqual({ running: false, taskArn: undefined, status: 'UNKNOWN' });
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('returns not running instead of throwing when describing a known task fails', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { dispatcher } = createDispatcher(() => {
        throw new Error('ThrottlingException');
      });
      (dispatcher as any).taskArns.set('run-5', 'arn:known');

      const status = await dispatcher.getTaskStatus('run-5');
      expect(status).toEqual({ running: false, taskArn: 'arn:known', status: 'UNKNOWN' });
    } finally {
      warn.mockRestore();
    }
  });
});
