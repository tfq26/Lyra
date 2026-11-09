import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { CheckItem } from './types';
import { MigrationCanary } from './migrationCanary';
import { VisualCapture } from './visualCapture';
import { VisualCritic } from './visualCritic';

export interface VerificationContext {
  previewUrl?: string;
  objective?: string;
  runId?: string;
}

export class VerificationRunner {
  private getExtendedEnv(): NodeJS.ProcessEnv {
    const home = os.homedir();
    return {
      ...process.env,
      PATH: `${path.join(home, '.local', 'bin')}:${path.join(home, '.nvm', 'versions', 'node', 'v22.18.0', 'bin')}:${path.join(home, '.bun', 'bin')}:${path.join(home, '.cargo', 'bin')}:${path.join(home, '.npm-global', 'bin')}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${process.env.PATH || ''}`,
    };
  }

  public discoverProjectChecks(cwd: string, changedFiles?: (string | { filename: string })[]): CheckItem[] {
    const checks: CheckItem[] = [];

    // Check for database migration canary
    const canary = new MigrationCanary();
    const hasMigrations = (changedFiles && changedFiles.some((f) => canary.isMigrationFile(typeof f === 'string' ? f : f.filename))) ||
      fs.existsSync(path.join(cwd, 'prisma/migrations')) ||
      fs.existsSync(path.join(cwd, 'migrations')) ||
      fs.existsSync(path.join(cwd, 'db/migrations')) ||
      fs.existsSync(path.join(cwd, 'kysely/migrations'));

    if (hasMigrations) {
      checks.push({
        id: `check-migration-canary-${Date.now()}`,
        runId: '',
        name: 'Database Migration Canary',
        command: 'lyra canary database-migrations',
        status: 'pending',
      });
    }

    // Check for frontend visual critique
    const isFrontendFile = (file: string) => /\.(tsx|jsx|html|css|vue|svelte)$/i.test(file);
    const touchesFrontend = Boolean(changedFiles && changedFiles.some((f) => isFrontendFile(typeof f === 'string' ? f : f.filename)));

    if (touchesFrontend) {
      checks.push({
        id: `check-visual-critique-${Date.now()}`,
        runId: '',
        name: 'Visual Design & Layout Critique',
        command: 'lyra visual-critique',
        status: 'pending',
      });
    }

    // Check for package.json
    const packageJsonPath = path.join(cwd, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        const scripts = pkg.scripts || {};

        if (scripts.typecheck) {
          checks.push({
            id: `check-typecheck-${Date.now()}`,
            runId: '',
            name: 'TypeScript Typecheck',
            command: 'npm run typecheck',
            status: 'pending',
          });
        } else if (fs.existsSync(path.join(cwd, 'tsconfig.json'))) {
          checks.push({
            id: `check-typecheck-${Date.now()}`,
            runId: '',
            name: 'TypeScript Typecheck',
            command: 'npx tsc --noEmit',
            status: 'pending',
          });
        }

        if (scripts.test && !scripts.test.includes('no test specified')) {
          checks.push({
            id: `check-test-${Date.now()}`,
            runId: '',
            name: 'Unit / Integration Tests',
            command: 'npm test',
            status: 'pending',
          });
        }

        if (scripts.lint) {
          checks.push({
            id: `check-lint-${Date.now()}`,
            runId: '',
            name: 'Code Linter',
            command: 'npm run lint',
            status: 'pending',
          });
        }

        if (scripts.build) {
          checks.push({
            id: `check-build-${Date.now()}`,
            runId: '',
            name: 'Project Build',
            command: 'npm run build',
            status: 'pending',
          });
        }
      } catch (err) {
        console.warn('[VerificationRunner] Error parsing package.json:', err);
      }
    }

    // Check for nested subprojects (e.g., src/Draco.Web, frontend, client, web)
    const candidateSubDirs = ['src/Draco.Web', 'frontend', 'client', 'web', 'ui'];
    for (const sub of candidateSubDirs) {
      const subPkgPath = path.join(cwd, sub, 'package.json');
      if (fs.existsSync(subPkgPath)) {
        try {
          const subPkg = JSON.parse(fs.readFileSync(subPkgPath, 'utf-8'));
          if (subPkg.scripts?.build) {
            checks.push({
              id: `check-nested-build-${sub.replace(/[^a-zA-Z0-9_-]/g, '-')}-${Date.now()}`,
              runId: '',
              name: `${sub} Build`,
              command: `cd ${sub} && bun run build`,
              status: 'pending',
            });
          }
        } catch {}
      }
    }

    // Check for .NET solution (.sln) or project files (.csproj)
    try {
      const hasDotnet = fs.readdirSync(cwd).some((f) => f.endsWith('.sln') || f.endsWith('.csproj'));
      if (hasDotnet) {
        checks.push({
          id: `check-dotnet-build-${Date.now()}`,
          runId: '',
          name: '.NET Solution Build',
          command: 'dotnet build',
          status: 'pending',
        });
      }
    } catch {}

    // Check for Cargo.toml
    if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) {
      checks.push({
        id: `check-cargo-check-${Date.now()}`,
        runId: '',
        name: 'Cargo Check',
        command: 'cargo check',
        status: 'pending',
      });
      checks.push({
        id: `check-cargo-test-${Date.now()}`,
        runId: '',
        name: 'Cargo Test',
        command: 'cargo test',
        status: 'pending',
      });
    }

    // Check for pytest / python
    if (fs.existsSync(path.join(cwd, 'pytest.ini')) || fs.existsSync(path.join(cwd, 'tests'))) {
      checks.push({
        id: `check-pytest-${Date.now()}`,
        runId: '',
        name: 'Pytest Suite',
        command: 'pytest',
        status: 'pending',
      });
    }

    return checks;
  }

  private async runVisualCritiqueCheck(
    check: CheckItem,
    _cwd: string,
    context?: VerificationContext
  ): Promise<CheckItem> {
    const runId = context?.runId || check.runId || `critique-${Date.now()}`;
    const capture = new VisualCapture();
    const critic = new VisualCritic();

    let previewUrl = context?.previewUrl;
    if (!previewUrl) {
      for (const port of [5174, 5173, 3000, 8080]) {
        try {
          const res = await fetch(`http://localhost:${port}`);
          if (res.ok || res.status === 200 || res.status === 404) {
            previewUrl = `http://localhost:${port}`;
            break;
          }
        } catch {
          // Port not listening
        }
      }
    }

    if (!previewUrl) {
      return {
        ...check,
        status: 'unverified',
        output: 'Visual critique check skipped: No active preview server detected.',
        evidence: 'No active web dev preview server found on ports 5174, 5173, 3000, or 8080.',
      };
    }

    const captureReport = await capture.capturePreview(previewUrl, runId);
    if (!captureReport.success && captureReport.screenshots.length === 0) {
      return {
        ...check,
        status: 'failed',
        exitCode: 1,
        output: `Failed to capture preview screenshot: ${captureReport.error || 'Unknown error'}`,
        evidence: `Preview URL: ${previewUrl}\nError: ${captureReport.error || 'Screenshot capture failed'}`,
      };
    }

    const critique = await critic.evaluate(captureReport.screenshots, {
      url: previewUrl,
      objective: context?.objective || 'Frontend web application UI',
      consoleErrors: captureReport.consoleErrors,
      pageErrors: captureReport.pageErrors,
    });

    const defectLines = critique.defects
      .map((d) => `[${d.severity.toUpperCase()}] (${d.category}) ${d.description}\n  Suggested Fix: ${d.suggestedFix}`)
      .join('\n');

    const evidence = `Visual QA Score: ${critique.score}/100\nPassed: ${critique.passed}\nPreview URL: ${previewUrl}\nSummary: ${critique.summary}\n\nDefects (${critique.defects.length}):\n${defectLines || 'None'}\n\nRepair Guidance:\n${critique.repairGuidance}`;

    return {
      ...check,
      status: critique.passed ? 'passed' : 'failed',
      exitCode: critique.passed ? 0 : 1,
      output: critique.summary,
      evidence,
    };
  }

  public runCheck(
    check: CheckItem,
    cwd: string,
    timeoutMs = 60000,
    context?: VerificationContext
  ): Promise<CheckItem> {
    if (check.command === 'lyra visual-critique') {
      return this.runVisualCritiqueCheck(check, cwd, context);
    }

    if (check.command === 'lyra canary database-migrations' || check.command === 'migration-canary inspect') {
      const canary = new MigrationCanary();
      const canaryResult = canary.runCanaryCheck(cwd);
      return Promise.resolve({
        ...check,
        status: canaryResult.passed ? 'passed' : 'failed',
        exitCode: canaryResult.passed ? 0 : 1,
        output: canaryResult.checkItem.evidence || canaryResult.details.summary,
        evidence: canaryResult.checkItem.evidence || canaryResult.details.summary,
      });
    }

    return new Promise((resolve) => {
      const startTime = Date.now();
      const updatedCheck: CheckItem = {
        ...check,
        status: 'running',
      };

      const child = spawn(check.command, [], {
        cwd,
        env: this.getExtendedEnv(),
        shell: true,
      });

      let output = '';

      child.stdout?.on('data', (d: Buffer) => {
        output += d.toString();
      });
      child.stderr?.on('data', (d: Buffer) => {
        output += d.toString();
      });

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        updatedCheck.status = 'failed';
        updatedCheck.exitCode = 124;
        updatedCheck.output = output + '\n[VerificationRunner] Check timed out after ' + timeoutMs + 'ms';
        updatedCheck.evidence = `Command: ${check.command}\nTimeout after ${timeoutMs}ms\nOutput:\n${output.slice(-2000)}`;
        resolve(updatedCheck);
      }, timeoutMs);

      child.on('close', (code: number | null) => {
        clearTimeout(timer);
        const duration = Date.now() - startTime;
        const passed = code === 0;
        updatedCheck.status = passed ? 'passed' : 'failed';
        updatedCheck.exitCode = code ?? (passed ? 0 : 1);
        updatedCheck.output = output;
        updatedCheck.evidence = `Command: ${check.command}\nDuration: ${duration}ms\nExit Code: ${code}\nOutput:\n${output.slice(-2000)}`;
        resolve(updatedCheck);
      });

      child.on('error', (err: Error) => {
        clearTimeout(timer);
        updatedCheck.status = 'failed';
        updatedCheck.exitCode = 1;
        updatedCheck.output = err.message;
        updatedCheck.evidence = `Command: ${check.command}\nSpawn error: ${err.message}`;
        resolve(updatedCheck);
      });
    });
  }

  public async runAllChecks(
    checks: CheckItem[],
    cwd: string,
    onProgress?: (updatedCheck: CheckItem) => void,
    context?: VerificationContext
  ): Promise<{ allPassed: boolean; results: CheckItem[] }> {
    const results: CheckItem[] = [];
    if (checks.length === 0) return { allPassed: false, results };
    let allPassed = true;

    for (const check of checks) {
      if (check.status === 'unverified' || !check.command?.trim()) {
        const unverified = { ...check, status: 'unverified' as const, output: check.output || '', evidence: check.evidence || 'No executable verification command was available.' };
        results.push(unverified);
        allPassed = false;
        if (onProgress) onProgress(unverified);
        continue;
      }
      if (onProgress) {
        onProgress({ ...check, status: 'running' });
      }
      const res = await this.runCheck(check, cwd, 60000, context);
      results.push(res);
      if (onProgress) {
        onProgress(res);
      }
      if (res.status !== 'passed') {
        allPassed = false;
      }
    }

    return { allPassed, results };
  }
}
