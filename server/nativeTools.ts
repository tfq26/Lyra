import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tool } from '@strands-agents/sdk';
import { buildSafeSubprocessEnv, redactSecretText } from './security';

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
  return buildSafeSubprocessEnv(cwd);
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

export type NativeToolGroup = 'core' | 'git' | 'execution' | 'all';

export interface NativeToolHooks {
  onToolEvent?: (event: { name: string; input: unknown; output?: string; status: 'running' | 'completed' | 'failed' }) => void | Promise<void>;
  signal?: AbortSignal;
  toolGroups?: NativeToolGroup[];
}

export function inferNativeToolGroupsFromPrompt(prompt: string): NativeToolGroup[] {
  const lower = prompt.toLowerCase();
  const groups: NativeToolGroup[] = ['core'];
  if (/\b(git|diff|status|commit|branch|merge|patch|rebase|pr)\b/.test(lower)) {
    groups.push('git');
  }
  if (/\b(test|build|lint|typecheck|tsc|bun|npm|pnpm|yarn|cargo|pytest|run|verify|check|server|start|install)\b/.test(lower)) {
    groups.push('execution');
  }
  return groups;
}

export function createNativeTools(workspacePath: string, hooks: NativeToolHooks = {}) {
  const root = fs.realpathSync(workspacePath);
  const wrap = (name: string, callback: (input: any) => unknown): ((input: unknown) => Promise<string>) => async (input: unknown) => {
    const safeInput = { ...(input as Record<string, unknown> || {}) };
    if ('content' in safeInput) safeInput.content = '[file content omitted]';
    if ('files' in safeInput) safeInput.files = '[batch files content omitted]';
    if ('patch' in safeInput) safeInput.patch = '[patch content omitted]';
    if ('target' in safeInput) safeInput.target = '[target content omitted]';
    if ('replacement' in safeInput) safeInput.replacement = '[replacement content omitted]';
    if (name === 'run_command') safeInput.command = '[command requires approval]';
    await hooks.onToolEvent?.({ name, input: safeInput, status: 'running' });
    try {
      const output = await callback(input as never);
      const rawText = typeof output === 'string' ? output : JSON.stringify(output);
      const text = redactSecretText(rawText);
      const summary = ['read_file', 'search_files', 'git_diff', 'run_check', 'run_command'].includes(name) ? `Completed (${text.length} characters).` : text.slice(0, 1000);
      await hooks.onToolEvent?.({ name, input: safeInput, output: summary, status: 'completed' });
      return text;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      await hooks.onToolEvent?.({ name, input: safeInput, output: text, status: 'failed' });
      throw error;
    }
  };

  const listFiles = tool({
    name: 'list_files',
    description: 'List source files in the assigned project, excluding secrets, dependencies, and version control internals.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, additionalProperties: false },
    callback: wrap('list_files', ({ path: requested }: { path?: string }) => {
      const start = resolveWorkspacePath(root, requested || '.');
      try {
        const gitFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
          cwd: start,
          encoding: 'utf8',
          maxBuffer: 2_000_000,
        }).trim();
        if (gitFiles) {
          const lines = gitFiles
            .split('\n')
            .filter((f) => !f.startsWith('.git') && !isSecretName(path.basename(f)))
            .slice(0, 2000)
            .map((f) => `file ${f}`);
          return lines.join('\n');
        }
      } catch {}

      const items: string[] = [];
      const walk = (dir: string, depth: number) => {
        if (depth > 6 || items.length >= 1000) return;
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
    }),
  });

  const readFile = tool({
    name: 'read_file',
    description: 'Read a UTF-8 text file inside the assigned project. Supports optional startLine and endLine to inspect a specific numbered line window.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        startLine: { type: 'number', description: 'Optional 1-based start line' },
        endLine: { type: 'number', description: 'Optional 1-based end line' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    callback: wrap('read_file', ({ path: requested, startLine, endLine }: { path: string; startLine?: number; endLine?: number }) => {
      const file = resolveWorkspacePath(root, requested);
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > 500_000) throw new Error('File is not a regular text file or exceeds the 500 KB read limit.');
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes('\0')) throw new Error('Binary files are not available through read_file.');

      if (startLine !== undefined || endLine !== undefined) {
        const lines = content.split('\n');
        const start = Math.max(1, startLine || 1);
        const end = Math.min(lines.length, endLine || lines.length);
        const sliced = lines.slice(start - 1, end);
        return sliced.map((line, idx) => `${start + idx} | ${line}`).join('\n');
      }
      return content;
    }),
  });

  const searchFiles = tool({
    name: 'search_files',
    description: 'Search source text in the assigned project, excluding secrets, dependencies, and VCS internals.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, path: { type: 'string' } }, required: ['query'], additionalProperties: false },
    callback: wrap('search_files', async ({ query, path: requested }: { query: string; path?: string }) => {
      const start = resolveWorkspacePath(root, requested || '.');
      if (!query.trim() || query.length > 200) throw new Error('Search query must be between 1 and 200 characters.');
      try {
        return execFileSync('rg', [
          '--line-number', '--hidden',
          '--glob', '!node_modules/**', '--glob', '!.git/**', '--glob', '!.lyra/**',
          '--glob', '!**/.aws/**', '--glob', '!**/.ssh/**', '--glob', '!**/.claude/**',
          '--glob', '!**/.codex/**', '--glob', '!**/.hermes/**', '--glob', '!**/.env*',
          '--glob', '!**/*.pem', '--glob', '!**/*.key',
          '--fixed-strings', '--', query, '.'
        ], { cwd: start, encoding: 'utf8', maxBuffer: 200_000 }).slice(0, 50_000);
      } catch (error: any) {
        if (error?.status === 1) return 'No matches found.';
        try {
          return execFileSync('git', [
            'grep', '-n', '--fixed-strings', '-e', query, '--', '.',
            ':(exclude)**/.env*', ':(exclude)**/*.pem', ':(exclude)**/*.key',
            ':(exclude)**/.aws/**', ':(exclude)**/.ssh/**', ':(exclude)**/.lyra/**',
          ], {
            cwd: start,
            encoding: 'utf8',
            maxBuffer: 200_000,
          }).slice(0, 50_000);
        } catch (gitErr: any) {
          if (gitErr?.status === 1) return 'No matches found.';
          throw error;
        }
      }
    }),
  });

  const editFile = tool({
    name: 'edit_file',
    description: 'Surgically replace an exact target block of code with a replacement block in a file. Preferred for all code edits.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to project file' },
        target: { type: 'string', description: 'Exact text to be replaced, including whitespace and line breaks' },
        replacement: { type: 'string', description: 'Drop-in replacement text' },
      },
      required: ['path', 'target', 'replacement'],
      additionalProperties: false,
    },
    callback: wrap('edit_file', ({ path: requested, target, replacement }: { path: string; target: string; replacement: string }) => {
      const file = resolveWorkspacePath(root, requested, false);
      if (!fs.existsSync(file)) throw new Error(`File not found: ${requested}`);
      let content = fs.readFileSync(file, 'utf8');

      if (!content.includes(target)) {
        // Try normalized line breaks
        const normalizedContent = content.replace(/\r\n/g, '\n');
        const normalizedTarget = target.replace(/\r\n/g, '\n');
        if (normalizedContent.includes(normalizedTarget)) {
          content = normalizedContent;
          target = normalizedTarget;
          replacement = replacement.replace(/\r\n/g, '\n');
        } else {
          const targetLines = normalizedTarget.split('\n');
          const repLines = replacement ? replacement.replace(/\r\n/g, '\n').split('\n') : [];
          let currentContentLines = normalizedContent.split('\n');
          let replacedCount = 0;

          while (true) {
            let foundIdx = -1;
            // Pass 1: Trailing whitespace tolerance
            for (let i = 0; i <= currentContentLines.length - targetLines.length; i++) {
              let matches = true;
              for (let j = 0; j < targetLines.length; j++) {
                if (currentContentLines[i + j]?.trimEnd() !== targetLines[j]?.trimEnd()) {
                  matches = false;
                  break;
                }
              }
              if (matches) {
                foundIdx = i;
                break;
              }
            }

            // Pass 2: Full leading & trailing whitespace tolerance (handles indentation differences)
            if (foundIdx === -1) {
              for (let i = 0; i <= currentContentLines.length - targetLines.length; i++) {
                let matches = true;
                for (let j = 0; j < targetLines.length; j++) {
                  if (currentContentLines[i + j]?.trim() !== targetLines[j]?.trim()) {
                    matches = false;
                    break;
                  }
                }
                if (matches) {
                  foundIdx = i;
                  break;
                }
              }
            }

            if (foundIdx === -1) break;

            const before = currentContentLines.slice(0, foundIdx);
            const after = currentContentLines.slice(foundIdx + targetLines.length);
            currentContentLines = [...before, ...repLines, ...after];
            replacedCount++;
          }

          if (replacedCount > 0) {
            const updated = currentContentLines.join('\n');
            fs.writeFileSync(file, updated, 'utf8');
            return `Successfully edited ${path.relative(root, file)} (replaced ${replacedCount} matching block(s) with whitespace normalization).`;
          }

          throw new Error(`Target text block not found in ${requested}. Tip: Call read_file on "${requested}" first to inspect the current contents and exact indentation.`);
        }
      }

      const updated = content.replaceAll(target, replacement);
      fs.writeFileSync(file, updated, 'utf8');
      return `Successfully edited ${path.relative(root, file)} (replaced matching block(s)).`;
    }),
  });

  const writeFile = tool({ name: 'write_file', description: 'Create or replace a project file. Paths must remain inside the assigned project workspace.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false }, callback: wrap('write_file', ({ path: requested, content }: { path: string; content: string }) => {
    if (content.length > 500_000) throw new Error('File writes are limited to 500 KB.');
    const file = resolveWorkspacePath(root, requested, true);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
    return `Wrote ${path.relative(root, file)} (${content.length} characters).`;
  }) });

  const writeFiles = tool({
    name: 'write_files',
    description: 'Create or replace multiple project files in a single fast turn. Strongly preferred when creating new components, tests, and styles simultaneously.',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Relative path to project file' },
              content: { type: 'string', description: 'Complete file content to write' },
            },
            required: ['path', 'content'],
          },
        },
      },
      required: ['files'],
      additionalProperties: false,
    },
    callback: wrap('write_files', ({ files }: { files: Array<{ path: string; content: string }> }) => {
      if (!Array.isArray(files) || files.length === 0) {
        throw new Error('files array must contain at least one file entry.');
      }
      const results: string[] = [];
      for (const f of files) {
        if (f.content.length > 500_000) throw new Error(`File ${f.path} exceeds 500 KB.`);
        const file = resolveWorkspacePath(root, f.path, true);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, f.content, 'utf8');
        results.push(`Wrote ${path.relative(root, file)} (${f.content.length} characters)`);
      }
      return `Batch wrote ${results.length} files:\n${results.join('\n')}`;
    }),
  });

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

  const runCheck = tool({
    name: 'run_check',
    description: 'Run a project verification command such as a test, typecheck, lint, or build script.',
    inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false },
    callback: wrap('run_check', async ({ command }: { command: string }) => {
      const trimmed = command.trim();
      const isSafeCheck = /^(bun|npm|pnpm|yarn|npx|dotnet|cargo|pytest|git|tsc|vitest|jest)\b/i.test(trimmed)
        || /^(cd\s+[^&;|\n]+\s*&&\s*(bun|npm|pnpm|yarn|npx|dotnet|cargo|pytest|git|tsc|vitest|jest)\b)/i.test(trimmed);

      if (!isSafeCheck || commandNeedsApproval(trimmed)) {
        throw new Error('This is not a pre-approved verification command. Use run_command and request approval.');
      }
      return await runProcess(trimmed, root, 180_000, hooks.signal);
    }),
  });
  const runCommand = tool({ name: 'run_command', description: 'Run a shell command in the project workspace. Lyra requests user approval before execution.', inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false }, callback: wrap('run_command', async ({ command }: { command: string }) => await runProcess(command, root, 180_000, hooks.signal)) });

  const groups = new Set<NativeToolGroup>(hooks.toolGroups && hooks.toolGroups.length > 0 ? hooks.toolGroups : ['all']);
  const includeAll = groups.has('all');
  const selected = [
    ...(includeAll || groups.has('core') ? [listFiles, readFile, searchFiles, editFile, writeFile, writeFiles, applyPatch] : []),
    ...(includeAll || groups.has('git') ? [gitStatus, gitDiff] : []),
    ...(includeAll || groups.has('execution') ? [runCheck, runCommand] : []),
  ];
  return selected;
}

export function requiresApproval(toolName: string, input: unknown) {
  return toolName === 'run_command';
}
