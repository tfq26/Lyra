import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  enforceImmutableVerificationHarness,
  evaluateBlastRadius,
  isProtectedVerificationFile,
  verifyDifferentialRedGreen,
} from './nightShift/proofContract';
import {
  buildAnonymizedCouncilBriefs,
  groundSeatCitations,
  type CouncilSeatAnalysis,
} from './modelCouncil';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

describe('Night Shift Verifiable Proof Contract', () => {
  test('restores tampered package.json, tsconfig.json, and existing test files while preserving reproTest and source fix', () => {
    const repo = makeTempDir('lyra-proof-contract-');
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'package.json'), '{"scripts":{"test":"bun test"}}', 'utf8');
    fs.writeFileSync(path.join(repo, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}', 'utf8');
    fs.writeFileSync(path.join(repo, 'src', 'app.ts'), 'export const add = (a: number, b: number) => a - b;\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'src', 'app.test.ts'), 'expect(add(1, 2)).toBe(3);\n', 'utf8');

    execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@lyra.local'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Lyra Test'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['add', '.'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: repo, stdio: 'ignore' });

    // Simulate agent tampering with protected files + writing valid fix & repro test
    fs.writeFileSync(path.join(repo, 'package.json'), '{"scripts":{"test":"echo ok"}}', 'utf8');
    fs.writeFileSync(path.join(repo, 'src', 'app.test.ts'), 'expect(true).toBe(true);\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'src', 'app.ts'), 'export const add = (a: number, b: number) => a + b;\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'src', 'repro_999.test.ts'), 'expect(add(1, 2)).toBe(3);\n', 'utf8');

    const restored = enforceImmutableVerificationHarness(repo, 'src/repro_999.test.ts');
    expect(restored.sort()).toEqual(['package.json', 'src/app.test.ts']);
    expect(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).toBe('{"scripts":{"test":"bun test"}}');
    expect(fs.readFileSync(path.join(repo, 'src', 'app.test.ts'), 'utf8')).toBe('expect(add(1, 2)).toBe(3);\n');
    expect(fs.readFileSync(path.join(repo, 'src', 'app.ts'), 'utf8')).toContain('a + b');
    expect(fs.existsSync(path.join(repo, 'src', 'repro_999.test.ts'))).toBe(true);
  });

  test('isProtectedVerificationFile allows only the generated repro test', () => {
    expect(isProtectedVerificationFile('src/repro_1.test.ts', 'src/repro_1.test.ts')).toBe(false);
    expect(isProtectedVerificationFile('src/other.test.ts', 'src/repro_1.test.ts')).toBe(true);
    expect(isProtectedVerificationFile('tsconfig.json', 'src/repro_1.test.ts')).toBe(true);
    expect(isProtectedVerificationFile('src/service.ts', 'src/repro_1.test.ts')).toBe(false);
  });

  test('evaluateBlastRadius flags edits outside AST neighborhood', () => {
    const ok = evaluateBlastRadius(
      ['src/auth.ts', 'src/repro_1.test.ts'],
      ['src/auth.ts', 'src/session.ts'],
      'src/repro_1.test.ts'
    );
    expect(ok.withinBlastRadius).toBe(true);
    expect(ok.outOfScopeFiles).toEqual([]);

    const bad = evaluateBlastRadius(
      ['src/auth.ts', 'src/billing.ts'],
      ['src/auth.ts'],
      'src/repro_1.test.ts'
    );
    expect(bad.withinBlastRadius).toBe(false);
    expect(bad.outOfScopeFiles).toEqual(['src/billing.ts']);
  });

  test('verifyDifferentialRedGreen requires RED before patch and GREEN after patch', () => {
    expect(verifyDifferentialRedGreen(false, true)).toBe(true);
    expect(verifyDifferentialRedGreen(true, true)).toBe(false);
    expect(verifyDifferentialRedGreen(false, false)).toBe(false);
  });
});

describe('Grounded Cross-Family Model Council', () => {
  test('groundSeatCitations verifies real paths and flags hallucinated or traversal paths', () => {
    const ws = makeTempDir('lyra-council-grounding-');
    fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'src', 'realFile.ts'), 'export const ok = true;\n', 'utf8');

    const seat: CouncilSeatAnalysis = {
      seatId: 'codebase-specialist',
      roleTitle: 'Codebase Specialist',
      modelId: 'gpt-6.2-astra',
      modelName: 'GPT-6.2 Astra',
      provider: 'foundry',
      selectionReason: 'frontier',
      inspectedFiles: ['src/realFile.ts'],
      keyFindings: ['Checked `src/realFile.ts` and `src/ghostModule.ts`.'],
      hypothesisOrProposal: 'Update `src/realFile.ts` instead of `../outside/secret.ts`.',
      riskOrEdgeCase: 'Watch `src/missingHelper.ts`.',
      durationMs: 12,
    };

    const grounded = groundSeatCitations(seat, ws);
    expect(grounded.grounding?.verifiedPaths).toEqual(['src/realFile.ts']);
    expect(grounded.grounding?.unverifiedPaths).toContain('src/ghostModule.ts');
    expect(grounded.grounding?.unverifiedPaths).toContain('src/missingHelper.ts');
    expect(grounded.grounding?.groundingScore).toBeLessThan(1);
  });

  test('buildAnonymizedCouncilBriefs strips model identities and exposes grounding tags', () => {
    const seats: CouncilSeatAnalysis[] = [
      {
        seatId: 'docs-finops-rag',
        roleTitle: 'Docs Analyst',
        modelId: 'claude-mythos-5-2',
        modelName: 'Claude Mythos 5.2',
        provider: 'bedrock',
        selectionReason: 'frontier',
        inspectedFiles: ['README.md'],
        keyFindings: ['Checked README.md'],
        hypothesisOrProposal: 'Document failover',
        riskOrEdgeCase: 'Stale docs',
        durationMs: 10,
        grounding: { verifiedPaths: ['README.md'], unverifiedPaths: [], groundingScore: 1 },
      },
      {
        seatId: 'codebase-specialist',
        roleTitle: 'Codebase Specialist',
        modelId: 'gpt-6.2-astra',
        modelName: 'GPT-6.2 Astra',
        provider: 'foundry',
        selectionReason: 'frontier',
        inspectedFiles: ['src/fake.ts'],
        keyFindings: ['Checked src/fake.ts'],
        hypothesisOrProposal: 'Edit src/fake.ts',
        riskOrEdgeCase: 'None',
        durationMs: 12,
        grounding: { verifiedPaths: [], unverifiedPaths: ['src/fake.ts'], groundingScore: 0 },
      },
    ];

    const briefs = buildAnonymizedCouncilBriefs(seats);
    expect(briefs).toContain('Proposal A — Docs Analyst');
    expect(briefs).toContain('Proposal B — Codebase Specialist');
    expect(briefs).not.toContain('Claude Mythos 5.2');
    expect(briefs).not.toContain('GPT-6.2 Astra');
    expect(briefs).toContain('[VERIFIED]: README.md');
    expect(briefs).toContain('[UNVERIFIED]: src/fake.ts');
  });
});
