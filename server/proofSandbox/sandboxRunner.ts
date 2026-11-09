import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { WorktreeManager, type WorktreeInfo } from '../worktreeManager';

export interface SandboxExecutionReceipt {
  phase: 'reproduction_red' | 'verification_green' | (string & {});
  passed: boolean;
  exitCode: number;
  durationMs: number;
  failingTests: string[];
  stdout: string;
  stderr: string;
  command: string;
  sessionId?: string;
  args?: string[];
}

export interface SandboxSession {
  sessionId: string;
  worktree: WorktreeInfo;
  cleanup: () => Promise<void>;
}

export class SandboxRunner {
  constructor(private worktreeManager: WorktreeManager = new WorktreeManager()) {}

  /**
   * Spawns an isolated sandbox session inside a git worktree.
   */
  public async createSession(repoPath: string, testId: string): Promise<SandboxSession> {
    const safeId = `sbx-${Date.now()}-${testId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const worktree = await this.worktreeManager.createRunWorktree(repoPath, safeId);

    // Sync uncommitted and untracked files into the worktree so it reflects current development state
    if (worktree.worktreePath !== repoPath && fs.existsSync(worktree.worktreePath)) {
      try {
        const { stdout } = await (this.worktreeManager as any).execGit(['status', '--porcelain'], repoPath);
        for (const line of (stdout || '').split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const filePath = trimmed.slice(2).trim().replace(/^->\s*/, '');
          if (
            filePath.startsWith('.lyra') ||
            filePath.startsWith('node_modules') ||
            filePath.startsWith('.git')
          ) {
            continue;
          }
          const srcFull = path.join(repoPath, filePath);
          const destFull = path.join(worktree.worktreePath, filePath);
          if (fs.existsSync(srcFull) && fs.statSync(srcFull).isFile()) {
            fs.mkdirSync(path.dirname(destFull), { recursive: true });
            fs.copyFileSync(srcFull, destFull);
          }
        }
      } catch {
        // non-fatal sync
      }
    }

    const cleanup = async () => {
      try {
        await this.worktreeManager.cleanupRunWorktree(repoPath, safeId);
      } catch {
        // non-fatal cleanup
      }
    };

    return {
      sessionId: safeId,
      worktree,
      cleanup,
    };
  }

  /**
   * Executes a test or build command inside the isolated worktree and returns a structured receipt.
   */
  public async runCommand(
    cwd: string,
    command: string,
    args: string[] = [],
    phase: SandboxExecutionReceipt['phase'] = 'verification_green',
    timeoutMs = 60000
  ): Promise<SandboxExecutionReceipt> {
    const startedAt = Date.now();

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let killed = false;

      const executable = command === 'bun' && process.execPath.includes('bun') ? process.execPath : command;
      const child = spawn(executable, args, {
        cwd,
        env: {
          ...process.env,
          PATH: `${path.dirname(process.execPath)}:${process.env.PATH || ''}`,
          CI: 'true',
          NODE_ENV: 'test',
        },
      });

      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGKILL');
      }, timeoutMs);

      child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
      child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));

      child.on('close', (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startedAt;
        const exitCode = killed ? 124 : code ?? 0;
        const passed = exitCode === 0;

        // Parse failing test titles
        const failingTests: string[] = [];
        const fullOutput = stdout + '\n' + stderr;
        for (const line of fullOutput.split('\n')) {
          if (line.includes('FAIL') || line.includes('error:') || line.includes('AssertionError') || line.includes('✕')) {
            failingTests.push(line.trim());
          }
        }

        resolve({
          phase,
          passed,
          exitCode,
          durationMs,
          failingTests: failingTests.slice(0, 10),
          stdout,
          stderr,
          command: `${command} ${args.join(' ')}`,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          phase,
          passed: false,
          exitCode: 1,
          durationMs: Date.now() - startedAt,
          failingTests: [err.message],
          stdout,
          stderr: err.message,
          command: `${command} ${args.join(' ')}`,
        });
      });
    });
  }
}

export const sandboxRunner = new SandboxRunner();
