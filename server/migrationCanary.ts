import fs from 'fs';
import path from 'path';
import type { CheckItem } from './types';

export interface MigrationFileFinding {
  filePath: string;
  breakingChanges: string[];
  warnings: string[];
  hasRollback: boolean;
  rollbackPath?: string;
  reversible: boolean;
}

export interface MigrationAnalysisResult {
  hasMigrations: boolean;
  migrationFiles: string[];
  findings: MigrationFileFinding[];
  riskLevel: 'safe' | 'warning' | 'breaking';
  breakingChangesCount: number;
  warningsCount: number;
  allRollbacksPresent: boolean;
  summary: string;
}

export class MigrationCanary {
  private readonly migrationPatterns = [
    /prisma\/migrations\/.*\.sql$/i,
    /migrations\/.*\.(sql|ts|js)$/i,
    /db\/migrations\/.*\.(sql|ts|js)$/i,
    /kysely\/migrations\/.*\.(sql|ts|js)$/i,
    /schema\/migrations\/.*\.(sql|ts|js)$/i,
    /(^|\/)migrations\/.*$/i,
  ];

  public isRollbackFile(file: string | { filename?: string; path?: string }): boolean {
    if (!file) return false;
    const str = typeof file === 'string' ? file : file.filename || file.path || '';
    if (!str || typeof str !== 'string') return false;
    const normalized = str.replace(/\\/g, '/');
    return /\.down\.sql$/i.test(normalized) || /(^|\/)down\.sql$/i.test(normalized);
  }

  public isMigrationFile(file: string | { filename?: string; path?: string }): boolean {
    if (!file) return false;
    const str = typeof file === 'string' ? file : file.filename || file.path || '';
    if (!str || typeof str !== 'string') return false;
    const normalized = str.replace(/\\/g, '/');
    return this.migrationPatterns.some((pattern) => pattern.test(normalized));
  }

  public analyzeContent(filePath: string, content: string, rollbackContent?: string): MigrationFileFinding {
    const breakingChanges: string[] = [];
    const warnings: string[] = [];

    // Normalizing text: strip single-line and multi-line comments
    const stripped = content
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');

    // 1. Detect DROP TABLE
    const dropTableMatches = stripped.match(/DROP\s+TABLE(?:\s+IF\s+EXISTS)?\s+["`']?([a-zA-Z0-9_]+)["`']?/gi);
    if (dropTableMatches) {
      for (const match of dropTableMatches) {
        breakingChanges.push(`Non-reversible destruction: "${match.trim()}". Existing data will be permanently dropped.`);
      }
    }

    // 2. Detect DROP COLUMN
    const dropColumnMatches = stripped.match(/ALTER\s+TABLE\s+["`']?([a-zA-Z0-9_]+)["`']?\s+DROP\s+COLUMN(?:\s+IF\s+EXISTS)?\s+["`']?([a-zA-Z0-9_]+)["`']?/gi);
    if (dropColumnMatches) {
      for (const match of dropColumnMatches) {
        breakingChanges.push(`Data loss operation: "${match.trim()}". Column contents will be lost.`);
      }
    }

    // 3. Detect TRUNCATE
    const truncateMatches = stripped.match(/TRUNCATE(?:\s+TABLE)?\s+["`']?([a-zA-Z0-9_]+)["`']?/gi);
    if (truncateMatches) {
      for (const match of truncateMatches) {
        breakingChanges.push(`Destructive table wipe: "${match.trim()}".`);
      }
    }

    // 4. Detect Column Renames (breaking change for running services without zero-downtime expand-contract)
    const renameColumnMatches = stripped.match(/RENAME\s+COLUMN\s+["`']?([a-zA-Z0-9_]+)["`']?\s+TO\s+["`']?([a-zA-Z0-9_]+)["`']?/gi);
    if (renameColumnMatches) {
      breakingChanges.push(`Breaking schema rename: "${renameColumnMatches[0].trim()}". Requires expand-and-contract phase to prevent app crashes.`);
    }

    // 5. Detect adding non-nullable column without default
    const addColStatements = stripped.match(/ADD\s+COLUMN\s+["`']?([a-zA-Z0-9_]+)["`']?[^,;]+/gi);
    if (addColStatements) {
      for (const stmt of addColStatements) {
        if (/\bNOT\s+NULL\b/i.test(stmt) && !/\bDEFAULT\b/i.test(stmt)) {
          breakingChanges.push(`Unsafe non-nullable column addition without DEFAULT: "${stmt.trim()}". Migration will fail if existing rows exist.`);
        }
      }
    }

    // 6. Check for rollback support
    let hasRollback = Boolean(rollbackContent && rollbackContent.trim().length > 0);
    if (!hasRollback) {
      // In JS/TS migrations, check if down() or rollback() function is implemented
      if (/\b(export\s+(?:async\s+)?function\s+down|async\s+down\(|exports\.down\s*=)/i.test(content)) {
        hasRollback = true;
      }
    }

    if (breakingChanges.length > 0 && !hasRollback) {
      warnings.push('Destructive migration has no corresponding down/rollback migration file or function.');
    }

    return {
      filePath,
      breakingChanges,
      warnings,
      hasRollback,
      reversible: hasRollback && breakingChanges.length === 0,
    };
  }

  public analyzeFiles(
    files: { path: string; content?: string }[],
    workspacePath?: string
  ): MigrationAnalysisResult {
    const forwardMigrationItems = files.filter((f) => this.isMigrationFile(f.path) && !this.isRollbackFile(f.path));
    if (forwardMigrationItems.length === 0) {
      return {
        hasMigrations: false,
        migrationFiles: [],
        findings: [],
        riskLevel: 'safe',
        breakingChangesCount: 0,
        warningsCount: 0,
        allRollbacksPresent: true,
        summary: 'No database migration files detected in change set.',
      };
    }

    const findings: MigrationFileFinding[] = [];
    let breakingChangesCount = 0;
    let warningsCount = 0;
    let allRollbacksPresent = true;

    for (const item of forwardMigrationItems) {
      let content = item.content;
      if (content === undefined && workspacePath) {
        const fullPath = path.isAbsolute(item.path) ? item.path : path.join(workspacePath, item.path);
        if (fs.existsSync(fullPath)) {
          try {
            content = fs.readFileSync(fullPath, 'utf-8');
          } catch {
            content = '';
          }
        }
      }
      content = content || '';

      // Check for matching down migration
      let rollbackContent: string | undefined;
      const downCandidates = [
        item.path.replace(/\.up\.sql$/i, '.down.sql'),
        item.path.replace(/\.sql$/i, '.down.sql'),
        path.join(path.dirname(item.path), 'down.sql'),
      ];

      for (const candidate of downCandidates) {
        if (candidate !== item.path) {
          const matchInFiles = files.find((f) => f.path === candidate);
          if (matchInFiles?.content) {
            rollbackContent = matchInFiles.content;
            break;
          } else if (workspacePath) {
            const candFullPath = path.isAbsolute(candidate) ? candidate : path.join(workspacePath, candidate);
            if (fs.existsSync(candFullPath)) {
              try {
                rollbackContent = fs.readFileSync(candFullPath, 'utf-8');
                break;
              } catch {}
            }
          }
        }
      }

      const finding = this.analyzeContent(item.path, content, rollbackContent);
      findings.push(finding);
      breakingChangesCount += finding.breakingChanges.length;
      warningsCount += finding.warnings.length;
      if (!finding.hasRollback) {
        allRollbacksPresent = false;
      }
    }

    let riskLevel: 'safe' | 'warning' | 'breaking' = 'safe';
    if (breakingChangesCount > 0) {
      riskLevel = 'breaking';
    } else if (warningsCount > 0 || !allRollbacksPresent) {
      riskLevel = 'warning';
    }

    let summary = `Analyzed ${forwardMigrationItems.length} migration file(s). Risk level: ${riskLevel}.`;
    if (breakingChangesCount > 0) {
      summary += ` Found ${breakingChangesCount} breaking change(s) that require review.`;
    } else if (riskLevel === 'safe') {
      summary += ' All migrations are additive and reversible.';
    }

    return {
      hasMigrations: true,
      migrationFiles: forwardMigrationItems.map((f) => f.path),
      findings,
      riskLevel,
      breakingChangesCount,
      warningsCount,
      allRollbacksPresent,
      summary,
    };
  }

  public runCanaryCheck(
    workspacePath: string,
    changedFiles: string[] = []
  ): { passed: boolean; checkItem: CheckItem; details: MigrationAnalysisResult } {
    let filesToCheck: string[] = changedFiles;

    if (filesToCheck.length === 0 && fs.existsSync(workspacePath)) {
      // Discover migration files in workspace
      filesToCheck = this.discoverMigrationFilesInDir(workspacePath);
    }

    const analysis = this.analyzeFiles(
      filesToCheck.map((p) => ({ path: p })),
      workspacePath
    );

    const passed = analysis.riskLevel !== 'breaking';
    const evidence = [
      analysis.summary,
      ...analysis.findings.flatMap((f) => [
        `File: ${f.filePath}`,
        ...f.breakingChanges.map((b) => `  [BREAKING]: ${b}`),
        ...f.warnings.map((w) => `  [WARNING]: ${w}`),
      ]),
    ].join('\n');

    const checkItem: CheckItem = {
      id: `check-migration-canary-${Date.now()}`,
      runId: '',
      name: 'Database Migration Canary',
      command: 'migration-canary inspect',
      status: passed ? 'passed' : 'failed',
      exitCode: passed ? 0 : 1,
      evidence,
    };

    return { passed, checkItem, details: analysis };
  }

  private discoverMigrationFilesInDir(dir: string, currentDepth = 0, maxDepth = 4): string[] {
    if (currentDepth > maxDepth || !fs.existsSync(dir)) return [];
    const results: string[] = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...this.discoverMigrationFilesInDir(full, currentDepth + 1, maxDepth));
        } else if (this.isMigrationFile(full)) {
          results.push(full);
        }
      }
    } catch {}
    return results;
  }
}
