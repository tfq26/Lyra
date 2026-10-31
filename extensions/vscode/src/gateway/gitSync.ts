import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export class GitSync {
  public static getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  private static async runGit(args: string[], cwd: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', args, { cwd });
      return stdout.trim();
    } catch (err: any) {
      throw new Error(`Git error (${args.join(' ')}): ${err.stderr || err.message}`);
    }
  }

  public static async isGitRepo(cwd: string): Promise<boolean> {
    try {
      await this.runGit(['rev-parse', '--is-inside-work-tree'], cwd);
      return true;
    } catch {
      return false;
    }
  }

  public static async hasUncommittedChanges(cwd: string): Promise<boolean> {
    const status = await this.runGit(['status', '--porcelain'], cwd);
    return status.length > 0;
  }

  public static async createSyncSnapshot(cwd: string): Promise<{ branch: string; pushed: boolean }> {
    const isRepo = await this.isGitRepo(cwd);
    if (!isRepo) throw new Error('Current workspace is not a Git repository.');

    const dirty = await this.hasUncommittedChanges(cwd);
    const timestamp = Date.now();
    const syncBranch = `lyra/sync-${timestamp}`;

    if (dirty) {
      // Create sync branch and commit current snapshot
      await this.runGit(['checkout', '-b', syncBranch], cwd);
      await this.runGit(['add', '-A'], cwd);
      await this.runGit(['commit', '-m', `Lyra: Pre-flight snapshot before cloud swarm dispatch`], cwd);

      try {
        await this.runGit(['push', '-u', 'origin', syncBranch], cwd);
        return { branch: syncBranch, pushed: true };
      } catch (err: any) {
        console.warn('Could not push to origin (maybe offline or no remote):', err.message);
        return { branch: syncBranch, pushed: false };
      }
    }

    const currentBranch = await this.runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
    return { branch: currentBranch, pushed: false };
  }

  public static async pullBranch(cwd: string, branchName: string): Promise<void> {
    await this.runGit(['fetch', 'origin', branchName], cwd);
    await this.runGit(['merge', `origin/${branchName}`], cwd);
  }
}
