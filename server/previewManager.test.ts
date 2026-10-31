import { describe, expect, it } from 'bun:test';
import { PreviewManager } from './previewManager';

describe('PreviewManager', () => {
  it('manages preview instances and port discovery', async () => {
    const pm = new PreviewManager();
    const result = await pm.startPreview('run-preview-test', process.cwd());
    expect(result.port).toBeGreaterThanOrEqual(5174);
    expect(result.url).toBe(`http://localhost:${result.port}`);

    const retrieved = pm.getPreview('run-preview-test');
    expect(retrieved?.url).toBe(result.url);

    const stopped = pm.stopPreview('run-preview-test');
    expect(stopped).toBe(true);

    expect(pm.getPreview('run-preview-test')).toBeUndefined();
  });
});
