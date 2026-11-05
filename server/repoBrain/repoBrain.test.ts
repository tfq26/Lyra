import { describe, it, expect } from 'bun:test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { astIndexer } from './astIndexer';
import { invariantDetector } from './invariantDetector';

describe('Living Repo Brain AST & Invariant Suite', () => {
  const tempDir = path.join(os.tmpdir(), `test-repo-brain-${Date.now()}`);

  it('indexes symbols, call-sites, and imports accurately', async () => {
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });

    fs.writeFileSync(
      path.join(tempDir, 'src', 'math.ts'),
      `export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}
`,
      'utf8'
    );

    fs.writeFileSync(
      path.join(tempDir, 'src', 'calculator.ts'),
      `import { add, multiply } from './math';

export function calculateTotal(prices: number[], tax: number): number {
  const sum = add(prices[0] || 0, prices[1] || 0);
  return multiply(sum, tax);
}
`,
      'utf8'
    );

    const index = await astIndexer.indexWorkspace(tempDir);
    expect(index.totalFiles).toBe(2);
    expect(index.totalSymbols).toBeGreaterThanOrEqual(3);

    const calcFile = index.files.get('src/calculator.ts');
    expect(calcFile).toBeDefined();
    expect(calcFile!.imports.length).toBe(1);
    expect(calcFile!.imports[0]!.symbols).toEqual(['add', 'multiply']);

    // Verify traceCallGraph finds callers of 'multiply'
    const trace = astIndexer.traceCallGraph(index, 'multiply');
    expect(trace.directMatches.length).toBe(1);
    expect(trace.directMatches[0]!.filePath).toBe('src/math.ts');
    expect(trace.callers.length).toBe(1);
    expect(trace.callers[0]!.symbolName).toBe('calculateTotal');
  });

  it('maps stack traces directly to AST nodes and impacted callers', async () => {
    const index = await astIndexer.indexWorkspace(tempDir);
    const fakeTrace = `TypeError: Cannot read properties of undefined
    at calculateTotal (src/calculator.ts:4:15)
    at runTest (src/test.ts:12:1)`;

    const mapped = invariantDetector.mapStackTrace(index, fakeTrace);
    expect(mapped.parsedError.symbol).toBe('calculateTotal');
    expect(mapped.parsedError.file).toBe('src/calculator.ts');
    expect(mapped.matchedNode?.symbolName).toBe('calculateTotal');
    expect(mapped.relatedFiles).toContain('src/calculator.ts');

    // Clean up temp dir
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
