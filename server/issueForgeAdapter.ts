/**
 * Unified GitHub & Forgejo Issue/PR Forge Adapter
 *
 * Abstracts GitHub REST v3 (`https://api.github.com`) and Forgejo/Gitea API v1
 * (`${FORGEJO_BASE_URL}/api/v1`) behind a single interface for:
 * - Creating & labeling issues from Gram Plan Mode
 * - Maintaining a single live-updating progress comment in-place (`updateIssueComment`)
 * - Posting human-in-the-loop ping comments (`createIssueComment`)
 * - Opening Draft PRs (`createPullRequest`)
 * - Verifying webhook HMAC SHA256 signatures for both GitHub and Forgejo
 */

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export type ForgeType = 'github' | 'forgejo';

export interface ForgeTarget {
  forge: ForgeType;
  owner: string;
  repo: string;
  baseUrl?: string; // Required for Forgejo unless FORGEJO_BASE_URL is set
  token?: string;
}

export interface CreateIssueInput extends ForgeTarget {
  title: string;
  body: string;
  labels?: string[];
}

export interface ForgeIssueResult {
  success: boolean;
  issueNumber?: number;
  issueUrl?: string;
  error?: string;
}

export interface ForgeCommentResult {
  success: boolean;
  commentId?: number;
  commentUrl?: string;
  error?: string;
}

export interface CreatePrInput extends ForgeTarget {
  head: string;
  base: string;
  title: string;
  body: string;
  draft?: boolean;
}

export interface ForgePrResult {
  success: boolean;
  prNumber?: number;
  prUrl?: string;
  error?: string;
}

export function resolveForgeApiBase(target: Pick<ForgeTarget, 'forge' | 'baseUrl'>): string {
  if (target.forge === 'github') {
    return (target.baseUrl || process.env.GITHUB_API_BASE_URL || 'https://api.github.com').replace(/\/+$/, '');
  }
  const raw = (target.baseUrl || process.env.FORGEJO_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!raw) {
    throw new Error('Forgejo baseUrl is required (set FORGEJO_BASE_URL or pass target.baseUrl).');
  }
  return raw.endsWith('/api/v1') ? raw : `${raw}/api/v1`;
}

export function resolveForgeToken(target: Pick<ForgeTarget, 'forge' | 'token'>): string | undefined {
  if (target.token?.trim()) return target.token.trim();
  return target.forge === 'github'
    ? process.env.GITHUB_TOKEN?.trim()
    : (process.env.FORGEJO_TOKEN || process.env.GITEA_TOKEN)?.trim();
}

export function buildForgeHeaders(target: Pick<ForgeTarget, 'forge' | 'token'>): Record<string, string> {
  const token = resolveForgeToken(target);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Lyra-Autopilot-Agent',
  };
  if (target.forge === 'github') {
    headers.Accept = 'application/vnd.github.v3+json';
    if (token) headers.Authorization = `Bearer ${token}`;
  } else {
    headers.Accept = 'application/json';
    if (token) headers.Authorization = `token ${token}`;
  }
  return headers;
}

/**
 * Infers `{ forge, owner, repo, baseUrl }` from a git remote URL (HTTPS or SSH).
 */
export function parseGitRemoteUrl(remoteUrl: string): ForgeTarget | null {
  const trimmed = remoteUrl.trim();
  if (!trimmed) return null;

  // SSH: git@host:owner/repo.git
  const sshMatch = trimmed.match(/^git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) {
    const host = sshMatch[1]!;
    const owner = sshMatch[2]!;
    const repo = sshMatch[3]!;
    const isGitHub = host.toLowerCase() === 'github.com';
    return {
      forge: isGitHub ? 'github' : 'forgejo',
      owner,
      repo,
      baseUrl: isGitHub ? 'https://api.github.com' : `https://${host}`,
    };
  }

  // HTTPS: https://host/owner/repo.git
  try {
    const parsed = new URL(trimmed);
    const segments = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (segments.length < 2) return null;
    const owner = segments[0]!;
    const repo = segments[1]!.replace(/\.git$/, '');
    const isGitHub = parsed.hostname.toLowerCase() === 'github.com';
    return {
      forge: isGitHub ? 'github' : 'forgejo',
      owner,
      repo,
      baseUrl: isGitHub ? 'https://api.github.com' : `${parsed.protocol}//${parsed.host}`,
    };
  } catch {
    return null;
  }
}

export function detectForgeFromWorkspace(workspacePath: string): ForgeTarget | null {
  try {
    const remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: workspacePath,
      encoding: 'utf8',
    }).trim();
    return parseGitRemoteUrl(remoteUrl);
  } catch {
    return null;
  }
}

/**
 * Verifies HMAC SHA256 webhook signatures for GitHub (`sha256=<hex>`) and Forgejo (`<hex>` or `sha256=<hex>`).
 */
export function verifyForgeWebhookSignature(
  payloadRaw: string,
  signatureHeader: string | undefined,
  secret: string | undefined
): boolean {
  if (!secret) return true;
  if (!signatureHeader) return false;
  const normalizedSig = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice(7)
    : signatureHeader;
  const expected = crypto.createHmac('sha256', secret).update(payloadRaw).digest('hex');
  try {
    const a = Buffer.from(normalizedSig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export class IssueForgeAdapter {
  public async createIssue(input: CreateIssueInput): Promise<ForgeIssueResult> {
    const token = resolveForgeToken(input);
    if (!token) {
      return {
        success: false,
        error: `${input.forge === 'github' ? 'GITHUB_TOKEN' : 'FORGEJO_TOKEN'} is not configured.`,
      };
    }

    try {
      const apiBase = resolveForgeApiBase(input);
      const url = `${apiBase}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues`;
      const payload: Record<string, unknown> = {
        title: input.title,
        body: input.body,
      };
      // GitHub accepts string label names directly; Forgejo accepts label names on newer versions or via label endpoint
      if (input.labels?.length && input.forge === 'github') {
        payload.labels = input.labels;
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: buildForgeHeaders(input),
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { success: false, error: (err as any).message || `${input.forge} returned ${res.status}` };
      }
      const data = (await res.json()) as any;
      return {
        success: true,
        issueNumber: data.number,
        issueUrl: data.html_url || data.url,
      };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to create issue.' };
    }
  }

  public async createIssueComment(
    target: ForgeTarget & { issueNumber: number; body: string }
  ): Promise<ForgeCommentResult> {
    const token = resolveForgeToken(target);
    if (!token) {
      return {
        success: false,
        error: `${target.forge === 'github' ? 'GITHUB_TOKEN' : 'FORGEJO_TOKEN'} is not configured.`,
      };
    }

    try {
      const apiBase = resolveForgeApiBase(target);
      const url = `${apiBase}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/issues/${target.issueNumber}/comments`;
      const res = await fetch(url, {
        method: 'POST',
        headers: buildForgeHeaders(target),
        body: JSON.stringify({ body: target.body }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { success: false, error: (err as any).message || `${target.forge} returned ${res.status}` };
      }
      const data = (await res.json()) as any;
      return {
        success: true,
        commentId: data.id,
        commentUrl: data.html_url || data.url,
      };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to post issue comment.' };
    }
  }

  public async updateIssueComment(
    target: ForgeTarget & { commentId: number; body: string }
  ): Promise<ForgeCommentResult> {
    const token = resolveForgeToken(target);
    if (!token) {
      return {
        success: false,
        error: `${target.forge === 'github' ? 'GITHUB_TOKEN' : 'FORGEJO_TOKEN'} is not configured.`,
      };
    }

    try {
      const apiBase = resolveForgeApiBase(target);
      const url = `${apiBase}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/issues/comments/${target.commentId}`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: buildForgeHeaders(target),
        body: JSON.stringify({ body: target.body }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { success: false, error: (err as any).message || `${target.forge} returned ${res.status}` };
      }
      const data = (await res.json()) as any;
      return {
        success: true,
        commentId: data.id ?? target.commentId,
        commentUrl: data.html_url || data.url,
      };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to update issue comment.' };
    }
  }

  public async createPullRequest(input: CreatePrInput): Promise<ForgePrResult> {
    const token = resolveForgeToken(input);
    if (!token) {
      return {
        success: false,
        error: `${input.forge === 'github' ? 'GITHUB_TOKEN' : 'FORGEJO_TOKEN'} not configured in environment; skipped remote PR creation.`,
      };
    }

    try {
      const apiBase = resolveForgeApiBase(input);
      const url = `${apiBase}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls`;
      const isDraft = input.draft ?? true;
      const title =
        input.forge === 'forgejo' && isDraft && !/^WIP:/i.test(input.title)
          ? `WIP: ${input.title}`
          : input.title;

      const payload: Record<string, unknown> = {
        title,
        head: input.head,
        base: input.base,
        body: input.body,
      };
      if (input.forge === 'github') {
        payload.draft = isDraft;
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: buildForgeHeaders(input),
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { success: false, error: (err as any).message || `${input.forge} returned ${res.status}` };
      }
      const data = (await res.json()) as any;
      return {
        success: true,
        prNumber: data.number,
        prUrl: data.html_url || data.url,
      };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to create pull request.' };
    }
  }
}

export const issueForgeAdapter = new IssueForgeAdapter();
