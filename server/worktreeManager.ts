import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { FileDiff } from './types';

export interface WorktreeInfo {
  worktreePath: string;
  branchName: string;
  baseCommit: string;
  isGit: boolean;
}

export interface MergeResult {
  success: boolean;
  conflicts: string[];
  error?: string;
}

export class WorktreeManager {
  private getExtendedEnv(): NodeJS.ProcessEnv {
    const home = os.homedir();
    return {
      ...process.env,
      PATH: `${path.join(home, '.local', 'bin')}:${path.join(home, '.nvm', 'versions', 'node', 'v22.18.0', 'bin')}:${path.join(home, '.bun', 'bin')}:${path.join(home, '.cargo', 'bin')}:${path.join(home, '.npm-global', 'bin')}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${process.env.PATH || ''}`,
    };
  }

  private execGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve) => {
      const child = spawn('git', args, { cwd, env: this.getExtendedEnv() });
      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
      child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));

      child.on('close', (code) => {
        resolve({ stdout, stderr, code: code ?? 0 });
      });

      child.on('error', (err) => {
        resolve({ stdout, stderr: err.message, code: 1 });
      });
    });
  }

  public async isGitRepo(workspacePath: string): Promise<boolean> {
    try {
      const { code } = await this.execGit(['rev-parse', '--is-inside-work-tree'], workspacePath);
      return code === 0;
    } catch {
      return false;
    }
  }

  public async getHeadCommit(repoPath: string): Promise<string> {
    const { stdout, code } = await this.execGit(['rev-parse', 'HEAD'], repoPath);
    if (code === 0) return stdout.trim();
    return 'HEAD';
  }

  public async createRunWorktree(repoPath: string, runId: string): Promise<WorktreeInfo> {
    const isGit = await this.isGitRepo(repoPath);
    if (!isGit) {
      return {
        worktreePath: repoPath,
        branchName: '',
        baseCommit: '',
        isGit: false,
      };
    }

    const worktreesBaseDir = path.join(repoPath, '.lyra', 'worktrees');
    if (!fs.existsSync(worktreesBaseDir)) {
      fs.mkdirSync(worktreesBaseDir, { recursive: true });
    }

    const safeRunId = runId.replace(/[^a-zA-Z0-9_-]/g, '-');
    const worktreePath = path.join(worktreesBaseDir, safeRunId);
    const branchName = `lyra/run-${safeRunId}`;
    const baseCommit = await this.getHeadCommit(repoPath);

    if (fs.existsSync(worktreePath)) {
      await this.cleanupRunWorktree(repoPath, runId);
    }

    await this.execGit(['branch', '-D', branchName], repoPath);

    const { code, stderr } = await this.execGit(
      ['worktree', 'add', '-b', branchName, worktreePath, 'HEAD'],
      repoPath
    );

    if (code !== 0) {
      console.warn(`[WorktreeManager] Failed to create git worktree: ${stderr}. Falling back to workspace path.`);
      return {
        worktreePath: repoPath,
        branchName: '',
        baseCommit,
        isGit: true,
      };
    }

    return {
      worktreePath,
      branchName,
      baseCommit,
      isGit: true,
    };
  }

  public async createTaskWorktree(repoPath: string, runId: string, taskId: string, baseRef = 'HEAD'): Promise<WorktreeInfo> {
    const isGit = await this.isGitRepo(repoPath);
    if (!isGit) {
      return {
        worktreePath: repoPath,
        branchName: '',
        baseCommit: '',
        isGit: false,
      };
    }

    const safeRunId = runId.replace(/[^a-zA-Z0-9_-]/g, '-');
    const safeTaskId = taskId.replace(/[^a-zA-Z0-9_-]/g, '-');
    const taskWorktreesDir = path.join(repoPath, '.lyra', 'worktrees', safeRunId, 'tasks');

    if (!fs.existsSync(taskWorktreesDir)) {
      fs.mkdirSync(taskWorktreesDir, { recursive: true });
    }

    const worktreePath = path.join(taskWorktreesDir, safeTaskId);
    const branchName = `lyra/task-${safeRunId}-${safeTaskId}`;
    const baseCommit = await this.getHeadCommit(repoPath);

    if (fs.existsSync(worktreePath)) {
      await this.execGit(['worktree', 'remove', '--force', worktreePath], repoPath);
      if (fs.existsSync(worktreePath)) {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
    }

    await this.execGit(['branch', '-D', branchName], repoPath);

    const { code, stderr } = await this.execGit(
      ['worktree', 'add', '-b', branchName, worktreePath, baseRef],
      repoPath
    );

    if (code !== 0) {
      console.warn(`[WorktreeManager] Failed to create task worktree: ${stderr}. Falling back to workspace path.`);
      return {
        worktreePath: repoPath,
        branchName: '',
        baseCommit,
        isGit: true,
      };
    }

    return {
      worktreePath,
      branchName,
      baseCommit,
      isGit: true,
    };
  }

  public async createIntegrationBranch(repoPath: string, runId: string): Promise<WorktreeInfo> {
    const isGit = await this.isGitRepo(repoPath);
    if (!isGit) {
      return {
        worktreePath: repoPath,
        branchName: '',
        baseCommit: '',
        isGit: false,
      };
    }

    const safeRunId = runId.replace(/[^a-zA-Z0-9_-]/g, '-');
    const worktreesBaseDir = path.join(repoPath, '.lyra', 'worktrees');
    const worktreePath = path.join(worktreesBaseDir, `${safeRunId}-integration`);
    const branchName = `lyra/integration-${safeRunId}`;
    const baseCommit = await this.getHeadCommit(repoPath);

    if (fs.existsSync(worktreePath)) {
      await this.execGit(['worktree', 'remove', '--force', worktreePath], repoPath);
      if (fs.existsSync(worktreePath)) {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
    }

    await this.execGit(['branch', '-D', branchName], repoPath);

    const { code } = await this.execGit(
      ['worktree', 'add', '-b', branchName, worktreePath, 'HEAD'],
      repoPath
    );

    if (code !== 0) {
      return {
        worktreePath: repoPath,
        branchName: '',
        baseCommit,
        isGit: true,
      };
    }

    return {
      worktreePath,
      branchName,
      baseCommit,
      isGit: true,
    };
  }

  public async mergeTaskBranch(
    repoPath: string,
    integrationWorktreePath: string,
    taskBranchName: string
  ): Promise<MergeResult> {
    const isGit = await this.isGitRepo(integrationWorktreePath);
    if (!isGit) return { success: true, conflicts: [] };

    // Attempt git merge
    const mergeRes = await this.execGit(
      ['merge', '--no-ff', '-m', `Lyra: Integrated ${taskBranchName}`, taskBranchName],
      integrationWorktreePath
    );

    if (mergeRes.code === 0) {
      return { success: true, conflicts: [] };
    }

    // Check for merge conflicts
    const conflictRes = await this.execGit(
      ['diff', '--name-only', '--diff-filter=U'],
      integrationWorktreePath
    );

    const conflicts = conflictRes.stdout.trim().split('\n').filter(Boolean);

    // Abort merge to keep integration worktree clean if conflicted
    await this.execGit(['merge', '--abort'], integrationWorktreePath);

    return {
      success: false,
      conflicts: conflicts.length > 0 ? conflicts : ['Unresolved merge conflict during integration'],
      error: mergeRes.stderr || mergeRes.stdout,
    };
  }

  public async getWorktreeDiff(
    repoPath: string,
    worktreePath: string,
    baseCommit?: string
  ): Promise<{ diff: string; filesChanged: FileDiff[] }> {
    const isGit = await this.isGitRepo(worktreePath);
    if (!isGit) {
      return { diff: '', filesChanged: [] };
    }

    const ref = baseCommit || 'HEAD';
    const diffRes = await this.execGit(['diff', ref], worktreePath);
    const rawDiff = diffRes.stdout;

    const numstatRes = await this.execGit(['diff', '--numstat', ref], worktreePath);
    const filesChanged: FileDiff[] = [];

    const lines = numstatRes.stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const parts = line.split('\t');
      if (parts.length >= 3) {
        const p0 = parts[0] || '0';
        const p1 = parts[1] || '0';
        const adds = p0 === '-' ? 0 : parseInt(p0, 10) || 0;
        const dels = p1 === '-' ? 0 : parseInt(p1, 10) || 0;
        const filename = parts.slice(2).join('\t');

        let patch: string | undefined;
        try {
          const fileDiffRes = await this.execGit(['diff', ref, '--', filename], worktreePath);
          patch = fileDiffRes.stdout;
        } catch {}

        filesChanged.push({
          filename,
          additions: adds,
          deletions: dels,
          patch,
        });
      }
    }

    return {
      diff: rawDiff,
      filesChanged,
    };
  }

  public async commitWorktreeChanges(worktreePath: string, message: string): Promise<boolean> {
    const isGit = await this.isGitRepo(worktreePath);
    if (!isGit) return false;

    await this.execGit(['add', '-A'], worktreePath);
    const { code } = await this.execGit(['commit', '-m', message], worktreePath);
    return code === 0;
  }

  public async mergeIntegrationBranchToMain(
    repoPath: string,
    integrationBranchName: string,
    targetBranch = 'main'
  ): Promise<{ success: boolean; conflicts?: string[]; error?: string }> {
    const isGit = await this.isGitRepo(repoPath);
    if (!isGit) return { success: false, error: 'Not a Git repository' };

    const currentBranchRes = await this.execGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath);
    const branchToMergeInto = currentBranchRes.stdout.trim() || targetBranch;

    const mergeRes = await this.execGit(
      ['merge', '--no-ff', '-m', `Lyra: Delivered integrated run changes from ${integrationBranchName}`, integrationBranchName],
      repoPath
    );

    if (mergeRes.code === 0) {
      return { success: true };
    }

    const statusRes = await this.execGit(['status', '--porcelain'], repoPath);
    const conflicts = statusRes.stdout
      .split('\n')
      .filter((line) => line.startsWith('UU') || line.startsWith('AA') || line.startsWith('DU'))
      .map((line) => line.slice(3).trim());

    await this.execGit(['merge', '--abort'], repoPath);

    return {
      success: false,
      conflicts: conflicts.length > 0 ? conflicts : ['Unresolved merge conflicts'],
      error: mergeRes.stderr || mergeRes.stdout,
    };
  }

  public async cleanupRunWorktree(repoPath: string, runId: string, deleteBranch = false): Promise<void> {
    const isGit = await this.isGitRepo(repoPath);
    if (!isGit) return;

    const safeRunId = runId.replace(/[^a-zA-Z0-9_-]/g, '-');
    const worktreesBaseDir = path.join(repoPath, '.lyra', 'worktrees');
    const runWorktreePath = path.join(worktreesBaseDir, safeRunId);
    const integrationWorktreePath = path.join(worktreesBaseDir, `${safeRunId}-integration`);

    for (const wtPath of [runWorktreePath, integrationWorktreePath]) {
      if (fs.existsSync(wtPath)) {
        await this.execGit(['worktree', 'remove', '--force', wtPath], repoPath);
        if (fs.existsSync(wtPath)) {
          fs.rmSync(wtPath, { recursive: true, force: true });
        }
      }
    }

    // Clean any task worktrees
    const taskWorktreesDir = path.join(runWorktreePath, 'tasks');
    if (fs.existsSync(taskWorktreesDir)) {
      fs.rmSync(taskWorktreesDir, { recursive: true, force: true });
    }

    await this.execGit(['worktree', 'prune'], repoPath);
  }

  public async listWorktrees(repoPath: string): Promise<Array<{
    path: string;
    head: string;
    branch: string;
    isMain: boolean;
    bare?: boolean;
  }>> {
    const { stdout, code } = await this.execGit(['worktree', 'list', '--porcelain'], repoPath);
    if (code !== 0) {
      return [{
        path: repoPath,
        head: await this.getHeadCommit(repoPath),
        branch: 'main',
        isMain: true,
      }];
    }

    const entries: Array<{ path: string; head: string; branch: string; isMain: boolean; bare?: boolean }> = [];
    const blocks = stdout.trim().split('\n\n');
    for (const block of blocks) {
      if (!block.trim()) continue;
      const lines = block.split('\n');
      let wtPath = '';
      let head = '';
      let branch = '';
      let bare = false;

      for (const line of lines) {
        if (line.startsWith('worktree ')) wtPath = line.substring(9).trim();
        else if (line.startsWith('HEAD ')) head = line.substring(5).trim();
        else if (line.startsWith('branch ')) branch = line.substring(7).replace('refs/heads/', '').trim();
        else if (line === 'bare') bare = true;
      }

      if (wtPath) {
        entries.push({
          path: wtPath,
          head: head || 'HEAD',
          branch: branch || (wtPath === repoPath ? 'main' : path.basename(wtPath)),
          isMain: wtPath === repoPath,
          bare,
        });
      }
    }

    return entries.length > 0 ? entries : [{
      path: repoPath,
      head: await this.getHeadCommit(repoPath),
      branch: 'main',
      isMain: true,
    }];
  }

  public async createCustomWorktree(repoPath: string, branchName: string): Promise<{ success: boolean; path: string; error?: string }> {
    const isGit = await this.isGitRepo(repoPath);
    if (!isGit) return { success: false, path: '', error: 'Target directory is not a git repository' };

    const safeBranch = branchName.trim().replace(/[^a-zA-Z0-9._/-]/g, '-');
    const worktreePath = path.join(repoPath, '.lyra', 'worktrees', safeBranch.replace(/\//g, '-'));

    if (fs.existsSync(worktreePath)) {
      return { success: false, path: worktreePath, error: `Worktree path already exists: ${worktreePath}` };
    }

    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

    // Try checking out new branch, or existing branch
    let res = await this.execGit(['worktree', 'add', '-b', safeBranch, worktreePath], repoPath);
    if (res.code !== 0) {
      // Branch might already exist, try checking it out directly
      res = await this.execGit(['worktree', 'add', worktreePath, safeBranch], repoPath);
    }

    if (res.code !== 0) {
      return { success: false, path: worktreePath, error: res.stderr || res.stdout };
    }

    return { success: true, path: worktreePath };
  }

  public async removeCustomWorktree(repoPath: string, worktreePath: string, force = true): Promise<{ success: boolean; error?: string }> {
    const isGit = await this.isGitRepo(repoPath);
    if (!isGit) return { success: false, error: 'Target directory is not a git repository' };

    if (worktreePath === repoPath) {
      return { success: false, error: 'Cannot remove the primary workspace repository worktree.' };
    }

    const args = ['worktree', 'remove'];
    if (force) args.push('--force');
    args.push(worktreePath);

    const res = await this.execGit(args, repoPath);
    if (fs.existsSync(worktreePath)) {
      try {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      } catch {}
    }

    await this.execGit(['worktree', 'prune'], repoPath);
    return { success: res.code === 0, error: res.code === 0 ? undefined : res.stderr || res.stdout };
  }
}
