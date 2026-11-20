import { describe, expect, test } from 'bun:test';
import {
  A2A_SPECIALISTS,
  A2ATaskManager,
  buildLyraA2AAgentCard,
  ORCHESTRATION_ROUTING_POLICY,
  type AgUiEvent,
} from './a2aProtocol';

describe('A2A Subagent Delegation & AG-UI Event Protocol', () => {
  test('buildLyraA2AAgentCard advertises A2A, AG-UI, AHP, MCP and all specialist skills', () => {
    const card = buildLyraA2AAgentCard('https://lyra.2helix.org/');
    expect(card.url).toBe('https://lyra.2helix.org');
    expect(card.protocols).toEqual({ a2a: '0.2', agUi: '1.0', ahp: '1.0', mcp: '1.0' });
    const skillIds: string[] = card.skills.map((s) => s.id);
    expect(skillIds).toEqual(Object.keys(A2A_SPECIALISTS));
    expect(skillIds).toContain('pentest');
    expect(skillIds).toContain('test-writer');
  });

  test('delegateTask emits AG-UI lifecycle events and redacts secrets in objective', async () => {
    const manager = new A2ATaskManager();
    const events: AgUiEvent[] = [];
    manager.on('agui', (evt) => events.push(evt));

    const task = await manager.delegateTask({
      role: 'pentest',
      objective: 'Audit auth endpoint using token=sk-ant-123456789012345678901234',
      executeOverride: async () => ({
        text: 'No SQLi found; enforce rate limiting on /api/auth.',
        model: 'mai-code-2',
        provider: 'foundry',
      }),
    });

    expect(task.status).toBe('completed');
    expect(task.objective).not.toContain('sk-ant-123456789012345678901234');
    expect(task.modelUsed).toBe('mai-code-2');
    expect(task.providerUsed).toBe('foundry');
    expect(events.map((e) => e.type)).toEqual(['RUN_STARTED', 'STEP_STARTED', 'RUN_FINISHED']);
  });

  test('delegateTask enforces max concurrency cap (3) to prevent runaway token burn', async () => {
    const manager = new A2ATaskManager();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const slowExec = async () => {
      await gate;
      return { text: 'ok', model: 'nova-2-lite', provider: 'bedrock' };
    };

    const p1 = manager.delegateTask({ role: 'research', objective: 'Task 1', executeOverride: slowExec });
    const p2 = manager.delegateTask({ role: 'docs', objective: 'Task 2', executeOverride: slowExec });
    const p3 = manager.delegateTask({ role: 'pentest', objective: 'Task 3', executeOverride: slowExec });

    await expect(
      manager.delegateTask({ role: 'refactor', objective: 'Task 4', executeOverride: slowExec })
    ).rejects.toThrow(/concurrency cap/i);

    release();
    const results = await Promise.all([p1, p2, p3]);
    expect(results.every((r) => r.status === 'completed')).toBe(true);
  });

  test('ORCHESTRATION_ROUTING_POLICY explicitly distinguishes Direct, A2A, Council, and Autopilot', () => {
    expect(ORCHESTRATION_ROUTING_POLICY).toContain('Direct Execution');
    expect(ORCHESTRATION_ROUTING_POLICY).toContain('A2A Subagents');
    expect(ORCHESTRATION_ROUTING_POLICY).toContain('Model Council');
    expect(ORCHESTRATION_ROUTING_POLICY).toContain('Autopilot');
  });
});
