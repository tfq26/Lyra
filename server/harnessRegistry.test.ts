import { describe, expect, test } from 'bun:test';
import { HarnessRegistry, type HarnessAdapter } from './harnessAdapter';
import type { HarnessCapabilities } from './types';
import type { RunAgentParams, RunAgentResult } from './processManager';

describe('Milestone 4: Harness Adapter Contract & Registry', () => {
  test('registers and retrieves custom test harness adapter', async () => {
    const registry = HarnessRegistry.getInstance();

    const mockAdapter: HarnessAdapter = {
      type: 'test_mock_harness',
      getCapabilities: async (): Promise<HarnessCapabilities> => ({
        name: 'test_mock_harness',
        label: 'Test Mock Harness',
        installed: true,
        authenticated: true,
        ready: true,
        supportedModes: ['solo', 'team'],
        supportedOptions: ['model', 'effort'],
      }),
      getModels: async () => [
        { id: 'mock-model-1', label: 'Mock Model 1' },
      ],
      runAgent: async (params: RunAgentParams): Promise<RunAgentResult> => ({
        sessionId: params.sessionId,
        runId: params.runId || 'run-mock',
        agentType: 'codex',
        code: 0,
        fullContent: 'Mock response from test harness',
      }),
      cancel: () => true,
    };

    registry.register(mockAdapter);

    expect(registry.has('test_mock_harness')).toBe(true);
    const retrieved = registry.get('test_mock_harness');
    expect(retrieved).toBeDefined();

    const capabilities = await registry.getAllCapabilities();
    expect(capabilities['test_mock_harness']).toBeDefined();
    expect(capabilities['test_mock_harness']?.installed).toBe(true);

    const models = await registry.getAllModels();
    expect(models['test_mock_harness']).toBeDefined();
    expect(models['test_mock_harness']?.length).toBe(1);

    // Unregister cleanly
    registry.unregister('test_mock_harness');
    expect(registry.has('test_mock_harness')).toBe(false);
  });
});
