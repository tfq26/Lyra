import { describe, it, expect } from 'bun:test';
import { BedrockGuardrailService } from './bedrockGuardrails';

describe('BedrockGuardrailService', () => {
  const guardrails = new BedrockGuardrailService();

  it('allows safe development prompts and completions', async () => {
    const safePrompt = 'Please add a utility function in src/utils.ts to calculate discount rates.';
    const result = await guardrails.screenPrompt(safePrompt);
    expect(result.action).toBe('NONE');
    expect(result.violations.length).toBe(0);
    expect(result.sanitizedText).toBe(safePrompt);
  });

  it('detects and redacts exposed AWS Access Key IDs', async () => {
    const text = 'Use this key for testing: AKIAIOSFODNN7EXAMPLE to access S3.';
    const result = await guardrails.screenPrompt(text);
    expect(result.action).toBe('BLOCKED');
    expect(result.violations.some((v) => v.description.includes('AWS Access Key ID'))).toBe(true);
    expect(result.sanitizedText).toContain('[REDACTED_BY_GUARDRAIL]');
    expect(result.sanitizedText).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('detects and redacts GitHub Personal Access Tokens', async () => {
    const text = 'Clone with ghp_111122223333444455556666777788889999 repository';
    const result = await guardrails.screenPrompt(text);
    expect(result.action).toBe('BLOCKED');
    expect(result.violations.some((v) => v.description.includes('GitHub'))).toBe(true);
    expect(result.sanitizedText).toContain('[REDACTED_BY_GUARDRAIL]');
  });

  it('detects and blocks destructive filesystem wipe commands', async () => {
    const dangerousScript = 'run: rm -rf / or rm -fr /* to clean up everything';
    const result = await guardrails.screenCompletion(dangerousScript);
    expect(result.action).toBe('BLOCKED');
    expect(result.violations.some((v) => v.type === 'DESTRUCTIVE_COMMAND')).toBe(true);
  });

  it('detects and blocks raw disk overwrite commands', async () => {
    const ddCommand = 'dd if=/dev/zero of=/dev/sda bs=1M';
    const result = await guardrails.screenPrompt(ddCommand);
    expect(result.action).toBe('BLOCKED');
    expect(result.violations.some((v) => v.description.includes('disk overwrite'))).toBe(true);
  });
});
