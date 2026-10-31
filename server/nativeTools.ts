import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { tool } from '@strands-agents/sdk';

export const blockedDirectories = new Set([
  '.aws', '.ssh', '.claude', '.codex', '.lyra', '.hermes', 'node_modules', '.git',
  '.config', '.gnupg', '.local', '.kube', '.docker', '.cache', '.password-store'
]);
export const blockedFiles = new Set([
  'credentials', 'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa', 'known_hosts', 'authorized_keys',
  '.npmrc', '.netrc', '.pypirc', '.bashrc', '.bash_profile', '.zshrc', '.zprofile', '.profile'
]);

export function isSecretName(name: string) {
  const lower = name.toLowerCase();
  return blockedFiles.has(lower)
    || lower.startsWith('.env')
    || lower.endsWith('.pem')
    || lower.endsWith('.key')
    || lower.endsWith('.p12')
    || lower.endsWith('.pfx')
    || lower.endsWith('.kdbx');
}

export function resolveWorkspacePath(rootPath: string, requested: string, allowMissing = false): string {
  const root = fs.realpathSync(rootPath);
  const resolved = path.resolve(root, requested || '.');
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error('Path is outside the assigned project workspace.');
  const relative = path.relative(root, resolved);
  const parts = relative.split(path.sep).filter(Boolean);
  if (parts.some((part) => blockedDirectories.has(part.toLowerCase()) || isSecretName(part))) throw new Error('This path contains private or generated project data and is not available to the agent.');
  let real: string;
  try { real = fs.realpathSync(resolved); }
  catch (error) {
    if (!allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    let parentPath = path.dirname(resolved);
    while (parentPath !== root && !fs.existsSync(parentPath)) parentPath = path.dirname(parentPath);
    const parent = fs.realpathSync(parentPath);
    real = path.join(parent, path.relative(parentPath, resolved));
  }
  try { if (fs.lstatSync(resolved).isSymbolicLink()) throw new Error('Symbolic links cannot be written through project tools.'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (real !== root && !real.startsWith(root + path.sep)) throw new Error('Symlink target is outside the assigned project workspace.');
  return resolved;
}

export function calculateDirectorySize(dirPath: string): number {
  let totalSize = 0;
  if (!fs.existsSync(dirPath)) return 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          totalSize += calculateDirectorySize(fullPath);
        } else if (entry.isFile()) {
          totalSize += fs.statSync(fullPath).size;
        }
      } catch {}
    }
  } catch {}
  return totalSize;
}

export const activeProcessGroups = new Set<number>();

export function killAllActiveProcesses(): void {
  for (const pid of activeProcessGroups) {
    try {
      if (process.platform !== 'win32') {
        process.kill(-pid, 'SIGKILL');
      } else {
        process.kill(pid, 'SIGKILL');
      }
    } catch {}
  }
  activeProcessGroups.clear();
}

function safeEnvironment(cwd: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: cwd, // Bound HOME to the sandboxed workspace to prevent probing ~/.ssh or ~/.aws
    TMPDIR: process.env.TMPDIR || '/tmp',
    LANG: process.env.LANG || 'C.UTF-8',
    CI: '1',
  };
}

export function runProcess(command: string, cwd: string, timeoutMs = 180_000, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error('Process execution aborted before start.'));
    }

    const isDetached = process.platform !== 'win32';
    const child = spawn('/bin/sh', ['-lc', command], {
      cwd,
      env: safeEnvironment(cwd),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: isDetached,
    });

    const pid = child.pid;
    if (pid) {
      activeProcessGroups.add(pid);
    }

    let output = '';
    let timedOut = false;
    let aborted = false;

    const append = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 120_000) output = output.slice(-120_000);
    };

    child.stdout.on('data', append);
    child.stderr.on('data', append);

    const killGroup = (sig: NodeJS.Signals = 'SIGKILL') => {
      if (pid) {
        activeProcessGroups.delete(pid);
        try {
          if (isDetached) {
            process.kill(-pid, sig);
          } else {
            child.kill(sig);
          }
        } catch {
          try { child.kill(sig); } catch {}
        }
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup('SIGKILL');
    }, timeoutMs);

    const abortHandler = () => {
      aborted = true;
      clearTimeout(timer);
      killGroup('SIGKILL');
    };

    if (signal) {
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    child.on('error', (error) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', abortHandler);
      if (pid) activeProcessGroups.delete(pid);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', abortHandler);
      if (pid) activeProcessGroups.delete(pid);
      const statusNote = timedOut ? ', timed out' : aborted ? ', cancelled' : '';
      resolve(`${output}\n[exit ${code ?? 'unknown'}${statusNote}]`);
    });
  });
}

function commandNeedsApproval(command: string): boolean {
  const c = command.trim();
  return !c || /(^|\s)(sudo|su|rm|rmdir|mkfs|dd|shutdown|reboot|chmod|chown|curl|wget|ssh|scp|nc|netcat)(\s|$)/i.test(c)
    || /git\s+(reset|clean|push|checkout\s+--|branch\s+-[dD]|rebase)/i.test(c)
    || /\b(>|>>|\|\s*(sh|bash)|\$\(|`)/.test(c)
    || /(^|\s)(npm|bun|pnpm|yarn|pip|uv|cargo)\s+(install|add|remove|uninstall|publish)(\s|$)/i.test(c);
}

export interface NativeToolHooks {
  onToolEvent?: (event: { name: string; input: unknown; output?: string; status: 'running' | 'completed' | 'failed' }) => void | Promise<void>;
  signal?: AbortSignal;
}

export function createNativeTools(workspacePath: string, hooks: NativeToolHooks = {}) {
  const root = fs.realpathSync(workspacePath);
  const wrap = (name: string, callback: (input: any) => unknown): ((input: unknown) => Promise<string>) => async (input: unknown) => {
    const safeInput = { ...(input as Record<string, unknown> || {}) };
    if ('content' in safeInput) safeInput.content = '[file content omitted]';
    if ('patch' in safeInput) safeInput.patch = '[patch content omitted]';
    if (name === 'run_command') safeInput.command = '[command requires approval]';
    await hooks.onToolEvent?.({ name, input: safeInput, status: 'running' });
    try {
      const output = await callback(input as never);
      const text = typeof output === 'string' ? output : JSON.stringify(output);
      const summary = ['read_file', 'search_files', 'git_diff', 'run_check', 'run_command'].includes(name) ? `Completed (${text.length} characters).` : text.slice(0, 1000);
      await hooks.onToolEvent?.({ name, input: safeInput, output: summary, status: 'completed' });
      return text;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      await hooks.onToolEvent?.({ name, input: safeInput, output: text, status: 'failed' });
      throw error;
    }
  };

  const listFiles = tool({ name: 'list_files', description: 'List source files in the assigned project, excluding secrets, dependencies, and version control internals.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, additionalProperties: false }, callback: wrap('list_files', ({ path: requested }: { path?: string }) => {
    const start = resolveWorkspacePath(root, requested || '.');
    const items: string[] = [];
    const walk = (dir: string, depth: number) => {
      if (depth > 5 || items.length >= 400) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (blockedDirectories.has(entry.name.toLowerCase()) || isSecretName(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        items.push(`${entry.isDirectory() ? 'dir' : 'file'} ${path.relative(root, full).split(path.sep).join('/')}`);
        if (entry.isDirectory()) walk(full, depth + 1);
      }
    };
    walk(start, 0);
    return items.join('\n') || 'No source files found.';
  }) });

  const readFile = tool({ name: 'read_file', description: 'Read a UTF-8 text file inside the assigned project. Secret files and generated data are excluded.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false }, callback: wrap('read_file', ({ path: requested }: { path: string }) => {
    const file = resolveWorkspacePath(root, requested);
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 200_000) throw new Error('File is not a regular text file or exceeds the 200 KB read limit.');
    const bytes = fs.readFileSync(file);
    if (bytes.includes(0)) throw new Error('Binary files are not available through read_file.');
    return bytes.toString('utf8');
  }) });

  const searchFiles = tool({ name: 'search_files', description: 'Search source text in the assigned project, excluding secrets, dependencies, and VCS internals.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, path: { type: 'string' } }, required: ['query'], additionalProperties: false }, callback: wrap('search_files', async ({ query, path: requested }: { query: string; path?: string }) => {
    const start = resolveWorkspacePath(root, requested || '.');
    if (!query.trim() || query.length > 200) throw new Error('Search query must be between 1 and 200 characters.');
    try { return execFileSync('rg', ['--line-number', '--hidden', '--glob', '!node_modules/**', '--glob', '!.git/**', '--glob', '!.lyra/**', '--glob', '!**/.aws/**', '--glob', '!**/.ssh/**', '--glob', '!**/.claude/**', '--glob', '!**/.codex/**', '--glob', '!**/.hermes/**', '--glob', '!**/.env*', '--glob', '!**/*.pem', '--glob', '!**/*.key', '--fixed-strings', '--', query, '.'], { cwd: start, encoding: 'utf8', maxBuffer: 200_000 }).slice(0, 50_000); }
    catch (error) { if ((error as NodeJS.ErrnoException & { status?: number }).status === 1) return 'No matches found.'; throw error; }
  }) });

  const writeFile = tool({ name: 'write_file', description: 'Create or replace a project file. Paths must remain inside the assigned project workspace.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false }, callback: wrap('write_file', ({ path: requested, content }: { path: string; content: string }) => {
    if (content.length > 500_000) throw new Error('File writes are limited to 500 KB.');
    const file = resolveWorkspacePath(root, requested, true);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
    return `Wrote ${path.relative(root, file)} (${content.length} characters).`;
  }) });

  const applyPatch = tool({ name: 'apply_patch', description: 'Apply a unified diff patch to files inside the assigned project workspace.', inputSchema: { type: 'object', properties: { patch: { type: 'string' } }, required: ['patch'], additionalProperties: false }, callback: wrap('apply_patch', ({ patch }: { patch: string }) => {
    if (patch.length > 500_000) throw new Error('Patch exceeds 500 KB.');
    const paths = [...patch.matchAll(/^\*\* (?:Update|Add|Delete) File: (.+)$/gm)].map((match) => match[1] || '');
    const diffPaths = [...patch.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)].flatMap((match) => [match[1] || '', match[2] || '']);
    for (const file of [...paths, ...diffPaths]) resolveWorkspacePath(root, file.replace(/^[ab]\//, ''), true);
    execFileSync('git', ['apply', '--whitespace=nowarn', '-'], { cwd: root, input: patch, stdio: ['pipe', 'pipe', 'pipe'] });
    return `Patch applied to ${[...paths, ...diffPaths].length} path(s).`;
  }) });

  const gitStatus = tool({ name: 'git_status', description: 'Show current Git status for the assigned project.', inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Optional directory or file path' } } }, callback: wrap('git_status', () => execFileSync('git', ['status', '--short', '--branch'], { cwd: root, encoding: 'utf8' }).slice(0, 20_000)) });
  const gitDiff = tool({ name: 'git_diff', description: 'Show the current project diff. Secret files and private config directories are excluded.', inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Optional file or directory path filter' } } }, callback: wrap('git_diff', () => execFileSync('git', ['diff', '--', '.', ':(exclude)**/.aws/**', ':(exclude)**/.ssh/**', ':(exclude)**/.claude/**', ':(exclude)**/.codex/**', ':(exclude)**/.hermes/**', ':(exclude)**/.env*', ':(exclude)**/*.pem', ':(exclude)**/*.key'], { cwd: root, encoding: 'utf8', maxBuffer: 2_000_000 }).slice(0, 100_000)) });

  const runCheck = tool({ name: 'run_check', description: 'Run a project verification command such as a test, typecheck, lint, or build script.', inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false }, callback: wrap('run_check', async ({ command }: { command: string }) => {
    const safeCommand = /^(bun (run (typecheck|build|lint|test|check)|test)|npm (run (typecheck|build|lint|test|check)|test)|pnpm (run (typecheck|build|lint|test|check)|test)|yarn (typecheck|build|lint|test|check)|git (status|diff|log))$/;
    if (!safeCommand.test(command.trim()) || commandNeedsApproval(command)) throw new Error('This is not a pre-approved verification command. Use run_command and request approval.');
    return await runProcess(command, root, 180_000, hooks.signal);
  }) });
  const runCommand = tool({ name: 'run_command', description: 'Run a shell command in the project workspace. Lyra requests user approval before execution.', inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false }, callback: wrap('run_command', async ({ command }: { command: string }) => await runProcess(command, root, 180_000, hooks.signal)) });

  return [listFiles, readFile, searchFiles, writeFile, applyPatch, gitStatus, gitDiff, runCheck, runCommand];
}

export function requiresApproval(toolName: string, input: unknown) {
  return toolName === 'run_command';
}
