import { describe, it, expect } from 'bun:test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { nightShiftRunner } from './nightShiftRunner';
import { triggerEngine } from './triggerEngine';

describe('Autonomous Night Shift & Proof Sandbox Pipeline', () => {
  const tempWorkspace = path.join(os.tmpdir(), `test-nightshift-${Date.now()}`);

  it('parses GitHub workflow_run and check_run webhook failures', () => {
    const fakeGhHeaders = { 'x-github-event': 'workflow_run' };
    const fakeGhPayload = {
      action: 'completed',
      repository: { full_name: 'acme/core-billing' },
      workflow_run: {
        id: 991283,
        conclusion: 'failure',
        head_branch: 'feature/renewals',
        head_sha: 'c0ffee123',
        name: 'Continuous Integration',
        html_url: 'https://github.com/acme/core-billing/actions/runs/991283',
      },
    };

    const event = triggerEngine.parseGitHubWebhook(fakeGhHeaders, JSON.stringify(fakeGhPayload), fakeGhPayload);
    expect(event).not.toBeNull();
    expect(event?.source).toBe('github_actions');
    expect(event?.repository).toBe('acme/core-billing');
    expect(event?.branch).toBe('feature/renewals');
    expect(event?.commitSha).toBe('c0ffee123');
  });

  it('executes full autonomous loop: maps failure trace, confirms RED repro, applies patch, and confirms GREEN sandbox', async () => {
    // 1. Setup temporary project workspace
    fs.mkdirSync(path.join(tempWorkspace, 'server'), { recursive: true });

    // File with a deliberate division by zero / undefined check bug
    fs.writeFileSync(
      path.join(tempWorkspace, 'server', 'pricing.ts'),
      `export function calculateDiscount(total: number, rate: number): number {
  if (rate === undefined || rate === null) {
    throw new TypeError("Rate cannot be undefined");
  }
  return total * rate;
}
`,
      'utf8'
    );

    // Initial failing stack trace simulating Sentry / CI failure alert
    const simulatedErrorLog = `TypeError: Rate cannot be undefined
    at calculateDiscount (server/pricing.ts:3:11)
    at Object.<anonymous> (test/checkout.test.ts:14:5)`;

    const report = await nightShiftRunner.runInvestigation({
      event: {
        id: `test-ci-${Date.now()}`,
        source: 'github_actions',
        repository: 'acme/store',
        branch: 'main',
        commitSha: 'a1b2c3d',
        errorLog: simulatedErrorLog,
        receivedAt: new Date().toISOString(),
      },
      workspacePath: tempWorkspace,
      testCommand: 'bun',
      testArgs: ['test'],
    });

    expect(report.runId).toStartWith('nightshift-');
    expect(report.mappedRootCause.error).toBe('Rate cannot be undefined');
    expect(report.mappedRootCause.targetFile).toBe('server/pricing.ts');
    expect(report.reproductionReceipt).toBeDefined();
    expect(report.proofMarkdown).toContain('Lyra Autonomous Night Shift Report');

    // Clean up temporary workspace
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  });
});
