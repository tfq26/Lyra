import crypto from 'node:crypto';
import type { LyraHarnessGateway } from './gateway';

export interface WebhookEventPayload {
  action: string;
  issue?: {
    number: number;
    pull_request?: Record<string, unknown>;
  };
  pull_request?: {
    number: number;
    head: { ref: string; sha: string };
    base: { ref: string };
  };
  comment?: {
    id: number;
    body: string;
    user: { login: string };
  };
  repository: {
    name: string;
    owner: { login: string };
    full_name: string;
    clone_url?: string;
  };
  sender?: { login: string };
}

export interface WebhookHandleResult {
  handled: boolean;
  action?: 'dispatched_fix' | 'reviewed' | 'maintained' | 'reported_status' | 'ignored';
  command?: string;
  issueNumber?: number;
  message?: string;
  runId?: string;
}

export class GitHubWebhookHandler {
  private secret?: string;

  constructor(private gateway: LyraHarnessGateway, options?: { secret?: string }) {
    this.secret = options?.secret || process.env.GITHUB_WEBHOOK_SECRET;
  }

  /**
   * Verify HMAC SHA256 signature from GitHub
   */
  public verifySignature(payloadRaw: string, signatureHeader?: string): boolean {
    if (!this.secret) return true; // Signature check skipped if no secret configured
    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;

    const signature = signatureHeader.slice(7);
    const expected = crypto.createHmac('sha256', this.secret).update(payloadRaw).digest('hex');

    try {
      return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      return false;
    }
  }

  /**
   * Process an incoming GitHub webhook payload
   */
  public async handleWebhook(
    payload: WebhookEventPayload,
    options?: { workspacePath?: string; githubToken?: string }
  ): Promise<WebhookHandleResult> {
    const commentBody = payload.comment?.body?.trim();
    const issueNumber = payload.pull_request?.number || payload.issue?.number;

    if (!commentBody || !commentBody.startsWith('/lyra')) {
      return { handled: false, action: 'ignored', message: 'No /lyra command detected' };
    }

    const commandMatch = commentBody.match(/^\/lyra\s+([a-zA-Z_-]+)(?:\s+(.*))?$/s);
    if (!commandMatch) {
      return { handled: false, action: 'ignored', message: 'Invalid /lyra command syntax' };
    }

    const subCommand = commandMatch[1]!.toLowerCase();
    const commandArgs = (commandMatch[2] || '').trim();

    const repoOwner = payload.repository.owner.login;
    const repoName = payload.repository.name;
    const branchName = payload.pull_request?.head.ref || 'main';
    const workspacePath = options?.workspacePath || process.cwd();

    switch (subCommand) {
      case 'fix': {
        const objective = commandArgs || `Fix requested on PR #${issueNumber} by @${payload.comment?.user.login || 'user'}`;
        const dispatch = await this.gateway.dispatchTask({
          objective,
          workspacePath,
        });

        return {
          handled: true,
          action: 'dispatched_fix',
          command: subCommand,
          issueNumber,
          runId: dispatch.runId,
          message: `Swarm dispatched for PR #${issueNumber}: "${objective}" (Run ID: ${dispatch.runId})`,
        };
      }

      case 'maintain': {
        const maint = await this.gateway.runMaintenance({
          workspacePath,
          mode: 'all',
          dryRun: false,
        });

        return {
          handled: true,
          action: 'maintained',
          command: subCommand,
          issueNumber,
          message: `Maintenance completed for ${maint.totalAttempted} item(s) on ${repoName}.`,
        };
      }

      case 'status': {
        return {
          handled: true,
          action: 'reported_status',
          command: subCommand,
          issueNumber,
          message: `Lyra Hub active on ${repoOwner}/${repoName}. Ready to receive tasks.`,
        };
      }

      default:
        return {
          handled: false,
          action: 'ignored',
          command: subCommand,
          message: `Unknown /lyra subcommand "${subCommand}". Supported commands: /lyra fix <instructions>, /lyra maintain, /lyra status`,
        };
    }
  }
}
