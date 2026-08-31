import fs from 'fs';
import path from 'path';

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
  if (typeof value === 'string') return value.replace(/(bearer\s+|api[_-]?key\s*[:=]\s*|token\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, /key|token|secret|password/i.test(k) ? '[REDACTED]' : redactSecrets(v)]));
  return value;
}
