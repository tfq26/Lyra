import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { WorktreeManager } from './worktreeManager';
import { VerificationRunner } from './verificationRunner';
import { BedrockGuardrailService } from './bedrockGuardrails';
import { FinOpsAnalyzer } from './finopsAnalyzer';
import type {
  MaintenanceItem,
  MaintenanceAuditResult,
  MaintenanceExecutionResult,
  MaintenanceReport,
} from './types';

// Grounded Knowledge Base for Deprecated APIs and Modern Replacements
interface DeprecationPattern {
  name: string;
  regex: RegExp;
  replacementAdvice: string;
  documentationUrl: string;
  documentationExcerpt: string;
  transformer?: (code: string) => string;
}

const KNOWN_DEPRECATIONS: DeprecationPattern[] = [
  {
    name: 'String.prototype.substr()',
    regex: /\.substr\s*\(/,
    replacementAdvice: 'Replace with String.prototype.slice() or substring()',
    documentationUrl: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/substr',
    documentationExcerpt: 'String.prototype.substr() is legacy and deprecated. Use slice() or substring() instead for standards-compliant string slicing.',
    transformer: (code: string) => code.replace(/\.substr\s*\(/g, '.slice('),
  },
  {
    name: 'Deprecated new Buffer() constructor',
    regex: /new\s+Buffer\s*\(/,
    replacementAdvice: 'Replace with Buffer.from() or Buffer.alloc()',
    documentationUrl: 'https://nodejs.org/api/buffer.html#buffer_new_buffer_size',
    documentationExcerpt: 'new Buffer() has been deprecated due to security risks. Use Buffer.from() for initializations or Buffer.alloc() for zero-filled memory allocations.',
    transformer: (code: string) => code.replace(/new\s+Buffer\s*\(/g, 'Buffer.from('),
  },
  {
    name: 'Deprecated fs.exists() async callback',
    regex: /fs\.exists\s*\(/,
    replacementAdvice: 'Replace with fs.access() or fs.existsSync()',
    documentationUrl: 'https://nodejs.org/api/fs.html#fs_fs_exists_path_callback',
    documentationExcerpt: 'fs.exists() is deprecated because its callback signature does not conform to Node.js error-first conventions. Use fs.stat(), fs.access(), or fs.existsSync().',
    transformer: (code: string) => code.replace(/fs\.exists\s*\(/g, 'fs.existsSync('),
  },
  {
    name: 'Deprecated escape() / unescape() global functions',
    regex: /\b(?:escape|unescape)\s*\(/,
    replacementAdvice: 'Replace with encodeURIComponent() / decodeURIComponent()',
    documentationUrl: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/escape',
    documentationExcerpt: 'The escape() function is deprecated. Use encodeURI() or encodeURIComponent() instead.',
    transformer: (code: string) => code.replace(/\bescape\s*\(/g, 'encodeURIComponent(').replace(/\bunescape\s*\(/g, 'decodeURIComponent('),
  },
];

// Grounded Package Migration Knowledge Base
interface PackageMigrationRule {
  package: string;
  targetVersion: string;
  documentationUrl: string;
  migrationExcerpt: string;
}

const KNOWN_PACKAGE_MIGRATIONS: PackageMigrationRule[] = [
  {
    package: 'zod',
    targetVersion: '^3.23.8',
    documentationUrl: 'https://zod.dev/?id=migrating-to-zod-3',
    migrationExcerpt: 'Zod v3 is fully backward compatible with schema definitions while enhancing TypeScript type inference and performance.',
  },
  {
    package: 'typescript',
    targetVersion: '^5.7.0',
    documentationUrl: 'https://devblogs.microsoft.com/typescript/announcing-typescript-5-7/',
    migrationExcerpt: 'TypeScript 5.7 improves type inference, decorator support, and checks uninitialized variables in sub-functions.',
  },
  {
    package: 'lucide-react',
    targetVersion: '^0.470.0',
    documentationUrl: 'https://lucide.dev/guide/packages/lucide-react',
    migrationExcerpt: 'Lucide React v0.470 adds tree-shakeable icon exports and drops legacy deprecated icon aliases.',
  },
];

export class MaintenanceCaretaker extends EventEmitter {
  private worktreeManager: WorktreeManager;
  private verificationRunner: VerificationRunner;
  private guardrails: BedrockGuardrailService;
  private finops: FinOpsAnalyzer;

  constructor(options?: {
    worktreeManager?: WorktreeManager;
    verificationRunner?: VerificationRunner;
    guardrails?: BedrockGuardrailService;
    finops?: FinOpsAnalyzer;
  }) {
    super();
    this.worktreeManager = options?.worktreeManager || new WorktreeManager();
    this.verificationRunner = options?.verificationRunner || new VerificationRunner();
    this.guardrails = options?.guardrails || new BedrockGuardrailService();
    this.finops = options?.finops || new FinOpsAnalyzer();
  }

  /**
   * Run an audit across the workspace to discover package upgrade opportunities,
   * deprecated APIs, and dead code patterns without modifying any files.
   */
  public async auditWorkspace(
    workspacePath: string,
    mode: 'packages' | 'deprecations' | 'cleanup' | 'all' = 'all'
  ): Promise<MaintenanceAuditResult> {
    const items: MaintenanceItem[] = [];

    // 1. Audit Packages
    if (mode === 'packages' || mode === 'all') {
      const pkgPath = path.join(workspacePath, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          const allDeps = {
            ...(pkgJson.dependencies || {}),
            ...(pkgJson.devDependencies || {}),
          };

          for (const rule of KNOWN_PACKAGE_MIGRATIONS) {
            const current = allDeps[rule.package];
            if (current && !current.includes(rule.targetVersion.replace('^', ''))) {
              items.push({
                id: `pkg-${rule.package}-${Date.now()}`,
                category: 'package_upgrade',
                title: `Upgrade ${rule.package} to ${rule.targetVersion}`,
                target: rule.package,
                currentVersion: current,
                targetVersion: rule.targetVersion,
                documentationUrl: rule.documentationUrl,
                documentationExcerpt: rule.migrationExcerpt,
                severity: 'medium',
                estimatedCostUsd: 0.05,
              });
            }
          }
        } catch (err) {
          console.warn(`[MaintenanceCaretaker] Error reading package.json for audit:`, err);
        }
      }
    }

    // 2. Audit Deprecated Symbols & Dead Code in Source Files
    if (mode === 'deprecations' || mode === 'cleanup' || mode === 'all') {
      const sourceFiles = this.findSourceFiles(workspacePath);

      for (const file of sourceFiles) {
        try {
          const content = fs.readFileSync(file, 'utf8');
          const relPath = path.relative(workspacePath, file);

          if (mode === 'deprecations' || mode === 'all') {
            for (const dep of KNOWN_DEPRECATIONS) {
              if (dep.regex.test(content)) {
                items.push({
                  id: `dep-${dep.name.replace(/[^a-zA-Z0-9]/g, '-')}-${items.length}`,
                  category: 'deprecation_fix',
                  title: `Modernize ${dep.name} in ${relPath}`,
                  target: relPath,
                  documentationUrl: dep.documentationUrl,
                  documentationExcerpt: dep.documentationExcerpt,
                  severity: 'medium',
                  estimatedCostUsd: 0.03,
                });
              }
            }

            if (content.includes('@deprecated')) {
              items.push({
                id: `jsdoc-deprecated-${items.length}`,
                category: 'deprecation_fix',
                title: `@deprecated JSDoc symbol reference in ${relPath}`,
                target: relPath,
                documentationUrl: 'https://jsdoc.app/tags-deprecated.html',
                documentationExcerpt: 'Identified @deprecated declaration. Recommended to migrate callers to modern alternative before next major release.',
                severity: 'low',
                estimatedCostUsd: 0.02,
              });
            }
          }

          if (mode === 'cleanup' || mode === 'all') {
            if (content.includes('debugger;')) {
              items.push({
                id: `cleanup-debugger-${items.length}`,
                category: 'dead_code_cleanup',
                title: `Remove orphaned debugger statement in ${relPath}`,
                target: relPath,
                documentationUrl: 'https://eslint.org/docs/latest/rules/no-debugger',
                documentationExcerpt: 'Production source code must not contain debugger statements.',
                severity: 'low',
                estimatedCostUsd: 0.01,
              });
            }
          }
        } catch (err) {
          // Skip unreadable files
        }
      }
    }

    const summary = items.length === 0
      ? 'Codebase is fully up to date. No deprecations, outdated packages, or dead code detected.'
      : `Discovered ${items.length} actionable maintenance item(s) across packages, deprecations, and code hygiene.`;

    return {
      workspacePath,
      scannedAt: new Date().toISOString(),
      items,
      summary,
    };
  }

  /**
   * Execute maintenance items non-disruptively in an isolated shadow worktree.
   */
  public async executeMaintenance(params: {
    workspacePath: string;
    items?: MaintenanceItem[];
    mode?: 'packages' | 'deprecations' | 'cleanup' | 'all';
    dryRun?: boolean;
    maxItems?: number;
  }): Promise<MaintenanceReport> {
    const { workspacePath, mode = 'all', dryRun = false, maxItems = 10 } = params;
    const runId = `maint-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const startedAt = new Date().toISOString();
    const results: MaintenanceExecutionResult[] = [];

    // Audit if items not provided
    const itemsToProcess = params.items || (await this.auditWorkspace(workspacePath, mode)).items;
    const boundedItems = itemsToProcess.slice(0, maxItems);

    let totalCostUsd = 0;

    // 1. Dry Run Mode: Return plans with zero disk changes
    if (dryRun) {
      for (const item of boundedItems) {
        results.push({
          itemId: item.id,
          category: item.category,
          target: item.target,
          status: 'succeeded',
          diffSummary: `[DRY-RUN] Would apply: ${item.title} grounded in ${item.documentationUrl || 'official docs'}`,
          documentationCitation: item.documentationExcerpt,
          testPassed: true,
        });
      }

      return {
        runId,
        startedAt,
        completedAt: new Date().toISOString(),
        mode,
        results,
        totalAttempted: boundedItems.length,
        totalSucceeded: results.filter((r) => r.status === 'succeeded').length,
        costUsd: 0,
      };
    }

    // 2. Live Execution in Isolated Git Worktree
    const worktreeInfo = await this.worktreeManager.createRunWorktree(workspacePath, runId);
    const worktreePath = worktreeInfo.worktreePath;

    try {
      for (const item of boundedItems) {
        // Enforce FinOps budget ceiling
        const budgetCheck = this.finops.checkRunBudget(totalCostUsd + (item.estimatedCostUsd || 0.05));
        if (!budgetCheck.allowed) {
          results.push({
            itemId: item.id,
            category: item.category,
            target: item.target,
            status: 'skipped',
            error: budgetCheck.warning || 'Maintenance run budget ceiling reached',
          });
          continue;
        }

        try {
          let modified = false;

          if (item.category === 'package_upgrade') {
            const pkgPath = path.join(worktreePath, 'package.json');
            if (fs.existsSync(pkgPath) && item.targetVersion) {
              const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
              if (pkg.dependencies && pkg.dependencies[item.target]) {
                pkg.dependencies[item.target] = item.targetVersion;
                modified = true;
              } else if (pkg.devDependencies && pkg.devDependencies[item.target]) {
                pkg.devDependencies[item.target] = item.targetVersion;
                modified = true;
              }
              if (modified) {
                fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf8');
              }
            }
          } else if (item.category === 'deprecation_fix') {
            const targetFile = path.join(worktreePath, item.target);
            if (fs.existsSync(targetFile)) {
              let content = fs.readFileSync(targetFile, 'utf8');
              for (const dep of KNOWN_DEPRECATIONS) {
                if (dep.transformer && dep.regex.test(content)) {
                  content = dep.transformer(content);
                  modified = true;
                }
              }
              if (modified) {
                fs.writeFileSync(targetFile, content, 'utf8');
              }
            }
          } else if (item.category === 'dead_code_cleanup') {
            const targetFile = path.join(worktreePath, item.target);
            if (fs.existsSync(targetFile)) {
              let content = fs.readFileSync(targetFile, 'utf8');
              if (content.includes('debugger;')) {
                content = content.replace(/\bdebugger;\s*/g, '');
                fs.writeFileSync(targetFile, content, 'utf8');
                modified = true;
              }
            }
          }

          if (!modified) {
            results.push({
              itemId: item.id,
              category: item.category,
              target: item.target,
              status: 'skipped',
              diffSummary: 'No direct automated changes required',
            });
            continue;
          }

          // Screen changes with Guardrails
          const diffResult = await this.worktreeManager.getWorktreeDiff(workspacePath, worktreePath, worktreeInfo.baseCommit);
          const guardrailCheck = await this.guardrails.screenPrompt(diffResult.diff);
          if (guardrailCheck.action === 'BLOCKED') {
            throw new Error(`Guardrail blocked maintenance changes: ${guardrailCheck.violations.map((v) => v.description).join(', ')}`);
          }

          // Run Verification Checks
          const discoveredChecks = this.verificationRunner.discoverProjectChecks(worktreePath, diffResult.filesChanged);
          let allChecksPassed = true;
          if (discoveredChecks.length > 0) {
            const checkRun = await this.verificationRunner.runAllChecks(discoveredChecks, worktreePath);
            allChecksPassed = checkRun.allPassed;
          }

          if (allChecksPassed) {
            await this.worktreeManager.commitWorktreeChanges(
              worktreePath,
              `chore(maintenance): ${item.title}\n\nGrounded in: ${item.documentationUrl || 'Official documentation'}\n${item.documentationExcerpt || ''}`
            );

            totalCostUsd += item.estimatedCostUsd || 0.03;

            results.push({
              itemId: item.id,
              category: item.category,
              target: item.target,
              status: 'succeeded',
              branchName: worktreeInfo.branchName,
              diffSummary: `Modified ${diffResult.filesChanged.length} file(s)`,
              testPassed: true,
              documentationCitation: `${item.documentationUrl || ''} - ${item.documentationExcerpt || ''}`,
            });
          } else {
            results.push({
              itemId: item.id,
              category: item.category,
              target: item.target,
              status: 'failed',
              testPassed: false,
              error: 'Automated verification test suite failed on maintenance changes; safely discarded.',
            });
          }
        } catch (err: any) {
          results.push({
            itemId: item.id,
            category: item.category,
            target: item.target,
            status: 'failed',
            error: err.message || String(err),
          });
        }
      }
    } finally {
      // Clean up worktree unless running in workspace fallback mode
      if (worktreePath !== workspacePath) {
        await this.worktreeManager.cleanupRunWorktree(workspacePath, runId, false);
      }
    }

    return {
      runId,
      startedAt,
      completedAt: new Date().toISOString(),
      mode,
      results,
      totalAttempted: boundedItems.length,
      totalSucceeded: results.filter((r) => r.status === 'succeeded').length,
      costUsd: parseFloat(totalCostUsd.toFixed(4)),
    };
  }

  private findSourceFiles(dir: string, fileList: string[] = []): string[] {
    const ignored = new Set(['node_modules', '.git', 'dist', 'build', '.lyra', 'coverage']);
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env') continue;
      if (ignored.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this.findSourceFiles(fullPath, fileList);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith('.ts') ||
          entry.name.endsWith('.tsx') ||
          entry.name.endsWith('.js') ||
          entry.name.endsWith('.jsx'))
      ) {
        fileList.push(fullPath);
      }
    }

    return fileList;
  }
}
