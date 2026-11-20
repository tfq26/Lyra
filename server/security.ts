import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SECRET_DIR_SEGMENTS = new Set([
  '.aws', '.ssh', '.claude', '.codex', '.lyra', '.hermes',
  '.config', '.gnupg', '.local', '.kube', '.docker', '.cache', '.password-store',
]);

const SECRET_FILENAMES = new Set([
  'credentials', 'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa',
  'known_hosts', 'authorized_keys', '.npmrc', '.netrc', '.pypirc',
  '.bashrc', '.bash_profile', '.zshrc', '.zprofile', '.profile',
]);

export function isSecretFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    SECRET_FILENAMES.has(lower) ||
    lower.startsWith('.env') ||
    lower.endsWith('.pem') ||
    lower.endsWith('.key') ||
    lower.endsWith('.p12') ||
    lower.endsWith('.pfx') ||
    lower.endsWith('.kdbx') ||
    /^secrets?\.(json|ya?ml|toml|ini|txt)$/i.test(lower) ||
    /^credentials?\.(json|ya?ml|toml|ini|txt)$/i.test(lower)
  );
}

export function isSecretFilePath(filePath: string): boolean {
  if (!filePath) return false;
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.some((part) => SECRET_DIR_SEGMENTS.has(part.toLowerCase()) || isSecretFileName(part));
}

export function redactSecretText(input: string): string {
  if (!input) return input;
  return input
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]')
    .replace(/\b(?:sk-or-v1-[a-zA-Z0-9]{20,}|sk-ant-[a-zA-Z0-9_-]{20,}|sk-[a-zA-Z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})\b/g, '[REDACTED_TOKEN]')
    .replace(/((?:bearer\s+|api[_-]?key\s*[:=]\s*|token\s*[:=]\s*|secret\s*[:=]\s*|password\s*[:=]\s*|aws_secret_access_key\s*[:=]\s*)['"]?)[^\s,'";]+(['"]?)/gi, '$1[REDACTED]$2');
}

export function buildSafeSubprocessEnv(cwd: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const home = process.env.HOME || os.homedir();
  const localBin = path.join(cwd, 'node_modules', '.bin');
  const execDir = path.dirname(process.execPath);
  const basePath = process.env.PATH || '/usr/local/bin:/usr/bin:/bin';
  return {
    PATH: `${localBin}:${execDir}:${basePath}`,
    HOME: home,
    USER: process.env.USER || '',
    LOGNAME: process.env.LOGNAME || '',
    SHELL: process.env.SHELL || '/bin/sh',
    TERM: process.env.TERM || 'xterm-256color',
    TMPDIR: process.env.TMPDIR || '/tmp',
    LANG: process.env.LANG || 'C.UTF-8',
    LC_ALL: process.env.LC_ALL || '',
    CI: '1',
    ...extra,
  };
}

export function assertSafeId(value: string, label = 'id'): string {
  if (!value || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value) || value.includes('..')) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

export function resolveUserPath(input: string): string {
  const expanded = input.startsWith('~/') ? path.join(process.env.HOME || '', input.slice(2)) : input;
  const resolved = path.resolve(expanded);
  if (!path.isAbsolute(resolved)) throw new Error('Storage path must be absolute');
  return resolved;
}

export function validateWorkingDirectory(cwd: string, allowedRoots: string[] = []): string {
  const resolved = path.resolve(cwd);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) throw new Error('Working directory does not exist');
  if (allowedRoots.length && !allowedRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`))) {
    throw new Error('Working directory is outside the allowed workspace');
  }
  return resolved;
}

export function redactSecrets(value: unknown): unknown {
  if (typeof value === 'string') return redactSecretText(value);
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, /key|token|secret|password/i.test(k) ? '[REDACTED]' : redactSecrets(v)]));
  return value;
}

export interface ExecutionSandboxPolicy {
  version: '1.0';
  runtime: 'mxc';
  filesystem: {
    readOnly: string[];
    readWrite: string[];
    deny: string[];
  };
  network: {
    mode: 'deny' | 'allowlist' | 'unrestricted';
    allowedHosts: string[];
  };
  ui: {
    allowDisplay: boolean;
    allowClipboard: boolean;
  };
}

/**
 * Generates an MXC-compatible OS sandboxing policy for autonomous agent runners,
 * locking writes to the active workspace/worktree and denying host credential dirs.
 */
export function buildExecutionSandboxPolicy(
  workspaceRoot: string,
  options?: {
    allowNetwork?: boolean;
    allowedHosts?: string[];
    extraReadOnlyPaths?: string[];
  }
): ExecutionSandboxPolicy {
  const resolvedWorkspace = path.resolve(workspaceRoot);
  const home = process.env.HOME || os.homedir();
  const denyPaths = Array.from(SECRET_DIR_SEGMENTS).map((seg) => path.join(home, seg));
  const allowedHosts = options?.allowedHosts ?? [];

  return {
    version: '1.0',
    runtime: 'mxc',
    filesystem: {
      readOnly: ['/usr', '/bin', '/lib', '/etc', ...(options?.extraReadOnlyPaths || [])],
      readWrite: [resolvedWorkspace, os.tmpdir()],
      deny: denyPaths,
    },
    network: {
      mode: options?.allowNetwork
        ? allowedHosts.length > 0
          ? 'allowlist'
          : 'unrestricted'
        : 'deny',
      allowedHosts,
    },
    ui: {
      allowDisplay: false,
      allowClipboard: false,
    },
  };
}

let cachedMxcAvailable: boolean | null = null;
export function isMxcBinaryAvailable(): boolean {
  if (cachedMxcAvailable !== null) return cachedMxcAvailable;
  const res = spawnSync('which', ['mxc'], { stdio: 'ignore' });
  cachedMxcAvailable = res.status === 0;
  return cachedMxcAvailable;
}

/**
 * Wraps a command + args with `mxc run --policy <file> --` when sandboxed execution
 * is requested and the `mxc` binary is available on PATH. Falls back cleanly to the
 * raw command when `mxc` is not installed or executionMode is not `sandboxed`.
 */
export function wrapCommandWithMxcSandbox(
  bin: string,
  args: string[],
  workspaceRoot: string,
  options?: { executionMode?: string; allowNetwork?: boolean; allowedHosts?: string[] }
): { bin: string; args: string[]; policyFile?: string; cleanup: () => void } {
  const shouldSandbox =
    options?.executionMode === 'sandboxed' || process.env.LYRA_MXC_SANDBOX === 'true';
  if (!shouldSandbox || !isMxcBinaryAvailable()) {
    return { bin, args, cleanup: () => {} };
  }

  const policy = buildExecutionSandboxPolicy(workspaceRoot, {
    allowNetwork: options?.allowNetwork ?? true,
    allowedHosts: options?.allowedHosts,
  });
  const policyFile = path.join(
    os.tmpdir(),
    `lyra-mxc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`
  );
  fs.writeFileSync(policyFile, JSON.stringify(policy, null, 2), 'utf8');

  return {
    bin: 'mxc',
    args: ['run', '--policy', policyFile, '--', bin, ...args],
    policyFile,
    cleanup: () => {
      try {
        fs.unlinkSync(policyFile);
      } catch {}
    },
  };
}
