import { execFileSync } from 'node:child_process';
import path from 'node:path';

export interface ProofContractReport {
  tamperedFilesRestored: string[];
  withinBlastRadius: boolean;
  outOfScopeFiles: string[];
  differentialRedGreen: boolean;
  autoPrEligible: boolean;
}

const PROTECTED_CONFIG_FILES = new Set([
  'package.json',
  'tsconfig.json',
  'bunfig.toml',
  'jest.config.js',
  'jest.config.ts',
  'vitest.config.ts',
  'vitest.config.js',
]);

export function isProtectedVerificationFile(relPath: string, allowedReproTestPath?: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (allowedReproTestPath) {
    const normalizedRepro = allowedReproTestPath.replace(/\\/g, '/').replace(/^\.\//, '');
    if (normalized === normalizedRepro) return false;
  }
  const base = path.basename(normalized);
  if (PROTECTED_CONFIG_FILES.has(base)) return true;
  return /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(base);
}

/**
 * Restores any modified protected build/test files in the sandbox worktree from HEAD
 * so an autonomous agent cannot weaken test assertions or compiler strictness to pass.
 */
export function enforceImmutableVerificationHarness(
  worktreePath: string,
  allowedReproTestPath?: string
): string[] {
  const restored: string[] = [];
  try {
    const statusOut = execFileSync('git', ['status', '--porcelain'], {
      cwd: worktreePath,
      encoding: 'utf8',
    });
    const lines = statusOut.split('\n').map((l) => l.trimEnd()).filter(Boolean);
    for (const line of lines) {
      const filePart = line.slice(3).trim();
      if (!filePart) continue;
      if (isProtectedVerificationFile(filePart, allowedReproTestPath)) {
        try {
          execFileSync('git', ['checkout', 'HEAD', '--', filePart], {
            cwd: worktreePath,
            stdio: 'ignore',
          });
          restored.push(filePart);
        } catch {
          // Untracked test file created by agent other than reproTest: leave or remove
        }
      }
    }
  } catch {
    // Non-git worktree or git unavailable: skip gracefully
  }
  return restored;
}

/**
 * Verifies that Night Shift edits remain within the AST-indexed failure neighborhood.
 */
export function evaluateBlastRadius(
  modifiedFiles: string[],
  allowedContextFiles: string[],
  allowedReproTestPath?: string
): { withinBlastRadius: boolean; outOfScopeFiles: string[] } {
  const normalize = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '').trim();
  const allowedSet = new Set(allowedContextFiles.map(normalize).filter(Boolean));
  if (allowedReproTestPath) allowedSet.add(normalize(allowedReproTestPath));

  // If AST index had no context files, allow surgical edits (<= 2 files)
  if (allowedSet.size === 0) {
    return {
      withinBlastRadius: modifiedFiles.length <= 2,
      outOfScopeFiles: modifiedFiles.length > 2 ? modifiedFiles.slice(2) : [],
    };
  }

  const outOfScopeFiles = Array.from(
    new Set(
      modifiedFiles
        .map(normalize)
        .filter((f) => f && !allowedSet.has(f))
    )
  );
  return {
    withinBlastRadius: outOfScopeFiles.length === 0,
    outOfScopeFiles,
  };
}

export function verifyDifferentialRedGreen(
  reproPassed: boolean,
  verifyPassed: boolean
): boolean {
  return !reproPassed && verifyPassed;
}
