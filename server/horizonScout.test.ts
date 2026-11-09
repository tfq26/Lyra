import { describe, it, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { HorizonScout } from './horizonScout';

describe('Lyra Horizon Scout Autonomous Intelligence Agent', () => {
  const tempDir = `/tmp/lyra-horizon-test-${Date.now()}`;

  it('generates structured feature tickets and persists them into backlog markdown', async () => {
    const scout = new HorizonScout(tempDir);
    const result = await scout.executeScan();

    expect(result.scanId).toBeDefined();
    expect(result.ticketsGenerated.length).toBeGreaterThan(0);
    expect(fs.existsSync(result.backlogDir)).toBe(true);

    const firstTicket = result.ticketsGenerated[0];
    const expectedFilePath = path.join(
      result.backlogDir,
      `${firstTicket.id}-${firstTicket.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`
    );

    expect(fs.existsSync(expectedFilePath)).toBe(true);
    const content = fs.readFileSync(expectedFilePath, 'utf8');
    expect(content).toContain(firstTicket.id);
    expect(content).toContain(firstTicket.title);
    expect(content).toContain('Acceptance Criteria');
    expect(content).toContain('Autonomous Dispatch Instructions');
  });
});
