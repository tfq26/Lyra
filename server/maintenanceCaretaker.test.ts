import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { MaintenanceCaretaker } from './maintenanceCaretaker';

describe('MaintenanceCaretaker', () => {
  let tempDir: string;
  let caretaker: MaintenanceCaretaker;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyra-maint-test-'));
    caretaker = new MaintenanceCaretaker();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('audits and detects outdated packages with official migration docs', async () => {
    const pkgJson = {
      name: 'test-app',
      dependencies: {
        zod: '^2.0.0',
        typescript: '^4.9.5',
      },
    };
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify(pkgJson, null, 2));

    const audit = await caretaker.auditWorkspace(tempDir, 'packages');
    expect(audit.items.length).toBeGreaterThanOrEqual(2);

    const zodItem = audit.items.find((i) => i.target === 'zod');
    expect(zodItem).toBeDefined();
    expect(zodItem?.documentationUrl).toContain('zod.dev');
    expect(zodItem?.targetVersion).toContain('3.');
  });

  it('audits and detects deprecated JavaScript/TypeScript API usages', async () => {
    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    const legacyCode = `
      export function parseToken(raw: string) {
        const part = raw.substr(0, 5);
        const buf = new Buffer(10);
        debugger;
        return escape(part);
      }
    `;
    fs.writeFileSync(path.join(srcDir, 'utils.ts'), legacyCode);

    const audit = await caretaker.auditWorkspace(tempDir, 'all');
    expect(audit.items.length).toBeGreaterThanOrEqual(3);

    const substrItem = audit.items.find((i) => i.title.includes('substr'));
    expect(substrItem).toBeDefined();
    expect(substrItem?.documentationUrl).toContain('developer.mozilla.org');

    const debuggerItem = audit.items.find((i) => i.category === 'dead_code_cleanup');
    expect(debuggerItem).toBeDefined();
  });

  it('executes dry-run maintenance with citations and zero modifications', async () => {
    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    const legacyCode = 'export const x = "hello".substr(1);';
    const filePath = path.join(srcDir, 'file.ts');
    fs.writeFileSync(filePath, legacyCode);

    const report = await caretaker.executeMaintenance({
      workspacePath: tempDir,
      mode: 'deprecations',
      dryRun: true,
    });

    expect(report.totalAttempted).toBeGreaterThanOrEqual(1);
    expect(report.results[0]!.status).toBe('succeeded');
    expect(report.results[0]!.diffSummary).toContain('[DRY-RUN]');
    expect(report.results[0]!.documentationCitation).toContain('slice() or substring()');

    // File remains unchanged
    expect(fs.readFileSync(filePath, 'utf8')).toBe(legacyCode);
  });
});
