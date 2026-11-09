import fs from 'node:fs';
import path from 'node:path';

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '.lyra',
  'bin',
  'obj',
  'target',
  'dist',
  'build',
  '.next',
  '.turbo',
  'coverage',
  '.cache',
  '.vscode',
  '.idea',
]);

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'in', 'to', 'of', 'a', 'an', 'is', 'it', 'on', 'at',
  'add', 'create', 'implement', 'update', 'fix', 'change', 'remove', 'make', 'do',
  'please', 'can', 'should', 'would', 'will', 'need', 'that', 'this', 'from', 'into'
]);

const ENTRYPOINT_NAMES = new Set([
  'program.cs',
  'startup.cs',
  'index.ts',
  'index.js',
  'app.ts',
  'app.js',
  'server.ts',
  'server.js',
  'main.ts',
  'main.js',
  'main.go',
  'main.rs',
  'app.py',
  'main.py',
]);

export interface CandidateFile {
  relativePath: string;
  score: number;
  reason: string;
}

/**
 * Deterministically scans the workspace to identify candidate target files for an objective
 * without making any LLM or Bedrock API calls (0 tokens, 0 cost).
 */
export function findCandidateFiles(
  workspacePath: string,
  objective: string,
  maxResults = 5
): CandidateFile[] {
  if (!fs.existsSync(workspacePath)) return [];

  // 1. Extract keywords from objective
  const rawWords = objective.toLowerCase().split(/[^a-z0-9_.-]+/).filter(Boolean);
  const keywords = Array.from(new Set(rawWords.filter((w) => w.length > 2 && !STOPWORDS.has(w))));

  const candidates: CandidateFile[] = [];

  const scanDir = (current: string, relPrefix = '') => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;

      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        scanDir(fullPath, relPath);
      } else if (entry.isFile()) {
        const lowerName = entry.name.toLowerCase();
        const lowerPath = relPath.toLowerCase();

        let score = 0;
        const reasons: string[] = [];

        // Check keyword matches in filename and path
        for (const kw of keywords) {
          if (lowerName.includes(kw)) {
            score += 10;
            reasons.push(`filename matches "${kw}"`);
          } else if (lowerPath.includes(kw)) {
            score += 5;
            reasons.push(`path matches "${kw}"`);
          }
        }

        // Check if file is a known entrypoint / routing file
        if (ENTRYPOINT_NAMES.has(lowerName)) {
          score += 4;
          reasons.push('primary application entrypoint');
        }

        // Check routing / endpoint / controller conventions
        if (lowerName.includes('controller') || lowerName.includes('endpoint') || lowerName.includes('route')) {
          score += 6;
          reasons.push('routing/endpoint controller');
        }

        if (score > 0) {
          candidates.push({
            relativePath: relPath,
            score,
            reason: reasons.slice(0, 2).join(', '),
          });
        }
      }
    }
  };

  scanDir(workspacePath);

  // Sort by score descending and return top results
  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

/**
 * Formats candidate files into a concise markdown section for prompts.
 */
export function formatCandidateFilesSection(candidates: CandidateFile[]): string {
  if (candidates.length === 0) return '';
  const lines = candidates.map((c) => `• \`${c.relativePath}\` (${c.reason})`);
  return `\nIdentified Candidate Target Files (Deterministic scan, 0 tokens spent):\n${lines.join('\n')}\n`;
}
