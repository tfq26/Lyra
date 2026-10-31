import { describe, expect, it } from 'bun:test';
import { parseSwarmPlan } from './planValidator';

const workers = [
  { harness: 'codex' as const, profileId: 'profile-codex', model: 'gpt-codex' },
  { harness: 'opencode' as const, profileId: 'profile-open', model: 'amazon.nova-micro' },
];

describe('swarm plan validation', () => {
  it('validates a JSON plan with strategic appraisal and assigns worker profiles round-robin', () => {
    const plan = parseSwarmPlan(JSON.stringify({
      appraisal: {
        problemSummary: 'Async file export requested to avoid browser memory crash',
        reusedAssets: ['@aws-sdk/client-s3'],
        costScaleNotes: '$0.003 / 1k uploads, no container impact',
      },
      acceptanceCriteria: ['Both modules are updated'],
      tasks: [
        { title: 'Update API', description: 'Add endpoint', scope: 'server/api.ts', expectedOutputs: ['route'] },
        { title: 'Update UI', description: 'Add control', scope: 'src/', recommendedHarness: 'opencode', dependsOn: ['Update API'] },
      ],
      checks: [{ name: 'Typecheck', command: 'bun run typecheck' }],
    }), 'run-1', workers);
    expect(plan.appraisal?.problemSummary).toContain('Async file export');
    expect(plan.appraisal?.reusedAssets).toEqual(['@aws-sdk/client-s3']);
    expect(plan.tasks[0]?.assignedProfileId).toBe('profile-codex');
    expect(plan.tasks[1]?.assignedProfileId).toBe('profile-open');
    expect(plan.tasks[1]?.dependencies).toEqual(['task-run-1-1']);
    expect(plan.checks[0]?.command).toBe('bun run typecheck');
  });

  it('rejects dependency cycles and missing acceptance criteria', () => {
    const cycle = JSON.stringify({ acceptanceCriteria: ['works'], tasks: [
      { title: 'A', dependsOn: ['B'] }, { title: 'B', dependsOn: ['A'] },
    ] });
    expect(() => parseSwarmPlan(cycle, 'run-2', workers)).toThrow('dependency cycle');
    expect(() => parseSwarmPlan(JSON.stringify({ tasks: [{ title: 'A' }] }), 'run-3', workers)).toThrow('acceptance criterion');
  });

  it('keeps compatibility with the existing plain-text plan format', () => {
    const result = parseSwarmPlan('ACCEPTANCE CRITERIA:\n- works\nTASKS:\n1. One - Change one\n2. Two [depends on: Task 1] - Change two', 'run-4', workers);
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[1]?.dependencies).toEqual(['task-run-4-1']);
  });

  it('correctly handles 0-indexed task dependencies in JSON plans', () => {
    const plan = parseSwarmPlan(JSON.stringify({
      acceptanceCriteria: ['Passes'],
      tasks: [
        { title: 'Init', description: 'Init structure', scope: '.' },
        { title: 'Core', description: 'Core models', scope: 'shared/', dependsOn: [0] },
        { title: 'Engine', description: 'Engine logic', scope: 'server/', dependsOn: [0, 1] },
      ],
      checks: [{ name: 'Test', command: 'bun test' }],
    }), 'run-zero', workers);
    expect(plan.tasks).toHaveLength(3);
    expect(plan.tasks[1]?.dependencies).toEqual(['task-run-zero-1']);
    expect(plan.tasks[2]?.dependencies).toEqual(['task-run-zero-1', 'task-run-zero-2']);
  });
});
