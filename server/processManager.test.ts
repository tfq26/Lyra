import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ProcessManager } from './processManager';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('ProcessManager Execution Lifecycle', () => {
  let pm: ProcessManager;
  let tempDir: string;

  beforeEach(() => {
    pm = new ProcessManager();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyra-process-test-'));
  });

  afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  it('correctly discovers capabilities and distinguishes installed harnesses', () => {
    const caps = pm.getCapabilities();
    expect(caps).toHaveProperty('antigravity');
    expect(caps).toHaveProperty('claude_code');
    expect(caps).toHaveProperty('codex');
    expect(typeof caps.antigravity.installed).toBe('boolean');
    expect(typeof caps.claude_code.installed).toBe('boolean');
    expect(typeof caps.codex.installed).toBe('boolean');
  });

  it('rejects unavailable harness with exit code 127 and emits error without simulated success', async () => {
    let errorEmitted = false;
    let doneEmitted = false;
    let thoughtEmitted = false;

    pm.on('error', (ev) => {
      errorEmitted = true;
      expect(ev.message).toContain('not installed');
    });

    pm.on('done', (ev) => {
      doneEmitted = true;
      expect(ev.code).toBe(127);
    });

    pm.on('thought', (ev) => {
      thoughtEmitted = true;
      expect(ev.thought).toContain('not installed');
    });

    // orchestrator is not a CLI harness
    const result = await pm.runAgent({
      agentType: 'orchestrator',
      prompt: 'hello',
      cwd: process.cwd(),
      sessionId: 'test-session',
      runId: 'test-run-1',
    });

    expect(result.code).toBe(127);
    expect(result.error).toContain('not installed');
    expect(result.fullContent).toBe('');
    expect(errorEmitted).toBe(true);
    expect(doneEmitted).toBe(true);
    expect(thoughtEmitted).toBe(true);
  });

  it('handles cancellation properly', () => {
    const cancelRes = pm.cancel('non-existent');
    expect(cancelRes).toBe(false);
  });

  it('tracks and cancels multiple harness instances independently under one parent run', async () => {
    const fakeCli = path.join(tempDir, 'fake-opencode');
    fs.writeFileSync(fakeCli, '#!/bin/sh\nexec sleep 30\n', 'utf8');
    fs.chmodSync(fakeCli, 0o755);
    pm.findBinary = () => fakeCli;
    const first = pm.runAgent({ agentType: 'opencode', prompt: 'one', cwd: tempDir, sessionId: 's1', runId: 'shared-run', processId: 'attempt-one' });
    const second = pm.runAgent({ agentType: 'opencode', prompt: 'two', cwd: tempDir, sessionId: 's1', runId: 'shared-run', processId: 'attempt-two' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(pm.cancel('shared-run')).toBe(true);
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.cancelled).toBe(true);
    expect(secondResult.cancelled).toBe(true);
    expect(firstResult.processId).toBe('attempt-one');
    expect(secondResult.processId).toBe('attempt-two');
  });
});
