import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { PreviewDeployer } from './previewDeployer';

describe('PreviewDeployer', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyra-preview-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('correctly reports local provider fallback when S3 is not configured', async () => {
    delete process.env.LYRA_PREVIEWS_BUCKET;
    delete process.env.AWS_S3_PREVIEW_BUCKET;

    const deployer = new PreviewDeployer();
    expect(deployer.isCloudConfigured()).toBe(false);

    // Create a mock dist/index.html in tempDir
    const dist = path.join(tempDir, 'dist');
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.html'), '<h1>Test</h1>');

    const result = await deployer.deployPreview({
      runId: 'test-run-123',
      worktreePath: tempDir,
    });

    expect(result.success).toBe(true);
    expect(['local', 'tunnel']).toContain(result.provider);
    if (result.provider === 'tunnel') {
      expect(result.previewUrl).toContain('http');
      expect(result.localUrl).toContain('http://localhost:');
    } else {
      expect(result.previewUrl).toContain('http://localhost:');
    }

    // Clean up
    await deployer.teardownPreview('test-run-123');
  });

  it('handles teardown gracefully for active previews', async () => {
    const deployer = new PreviewDeployer();
    const result = await deployer.deployPreview({
      runId: 'test-run-teardown',
      worktreePath: tempDir,
    });

    expect(result.success).toBe(true);
    const stopped = await deployer.teardownPreview('test-run-teardown');
    expect(stopped).toBe(true);
  });
});
