import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { CheckItem } from './types';
import { MigrationCanary } from './migrationCanary';

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

  public runCheck(check: CheckItem, cwd: string, timeoutMs = 60000): Promise<CheckItem> {
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
    onProgress?: (updatedCheck: CheckItem) => void
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
      const res = await this.runCheck(check, cwd);
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
