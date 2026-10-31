import { describe, it, expect } from 'bun:test';
import { EcsNativeDispatcher } from './ecsNativeDispatcher';

describe('EcsNativeDispatcher', () => {
  it('correctly reports not configured in local environment', () => {
    delete process.env.LYRA_HOSTED;
    const dispatcher = new EcsNativeDispatcher();
    expect(dispatcher.isConfigured()).toBe(false);
    expect(dispatcher.shouldUseFargate()).toBe(false);
  });

  it('correctly tracks active run sessions and stopped tasks', async () => {
    const dispatcher = new EcsNativeDispatcher();
    dispatcher.restoreActive('session-1', 'run-1');
    dispatcher.markFinished('run-1');

    const status = await dispatcher.getTaskStatus('run-1');
    expect(status.running).toBe(false);
  });
});
