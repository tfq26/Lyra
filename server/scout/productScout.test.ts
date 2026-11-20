import { describe, it, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { ProductScout } from './productScout';

describe('Lyra Product Scout & Competitive Intelligence Engine', () => {
  const tempDir = `/tmp/lyra-product-scout-test-${Date.now()}`;

  it('scouts target apps and writes detailed feature blueprints to backlog', async () => {
    const scout = new ProductScout(tempDir);
    const report = await scout.executeScoutRun();

    expect(report.runId).toBeDefined();
    expect(report.featuresDiscovered.length).toBeGreaterThanOrEqual(5);
    expect(fs.existsSync(report.outputDir)).toBe(true);

    const first = report.featuresDiscovered[0];
    expect(first).toBeDefined();
    if (!first) return;
    const expectedFile = path.join(
      report.outputDir,
      `${first.id}-${first.featureName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.md`
    );

    expect(fs.existsSync(expectedFile)).toBe(true);
    const content = fs.readFileSync(expectedFile, 'utf8');
    expect(content).toContain(first.id);
    expect(content).toContain(first.targetApp);
    expect(content).toContain('User Interaction Flow');
    expect(content).toContain('UI Component Architecture');
    expect(content).toContain('Autonomous Swarm Dispatch Directive');
  });
});
