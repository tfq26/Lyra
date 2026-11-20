import type { LyraHarnessGateway } from './gateway';
import { autopilotOrchestrator } from './autopilotOrchestrator';
import { verifyForgeWebhookSignature, type ForgeType } from './issueForgeAdapter';

export interface WebhookEventPayload {
  action: string;
  label?: { name: string };
  issue?: {
    number: number;
    title?: string;
    body?: string;
    html_url?: string;
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
  action?:
    | 'dispatched_fix'
    | 'autopilot_started'
    | 'autopilot_resumed'
    | 'autopilot_aborted'
    | 'reviewed'
    | 'maintained'
    | 'reported_status'
    | 'ignored';
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
   * Verify HMAC SHA256 signature from GitHub or Forgejo
   */
  public verifySignature(payloadRaw: string, signatureHeader?: string, secretOverride?: string): boolean {
    return verifyForgeWebhookSignature(payloadRaw, signatureHeader, secretOverride ?? this.secret);
  }

  /**
   * Process an incoming GitHub or Forgejo webhook payload
   */
  public async handleWebhook(
    payload: WebhookEventPayload,
    options?: { workspacePath?: string; githubToken?: string; forge?: ForgeType; forgeBaseUrl?: string }
  ): Promise<WebhookHandleResult> {
    const forge: ForgeType = options?.forge || 'github';
    const repoOwner = payload.repository.owner.login;
    const repoName = payload.repository.name;
    const workspacePath = options?.workspacePath || process.cwd();
    const issueNumber = payload.pull_request?.number || payload.issue?.number;

    // 1. Issue labeled with `lyra:autopilot` -> start Autopilot run
    if (
      payload.action === 'labeled' &&
      payload.label?.name?.toLowerCase() === 'lyra:autopilot' &&
      payload.issue?.number
    ) {
      const run = await autopilotOrchestrator.startRun({
        forgeTarget: {
          forge,
          owner: repoOwner,
          repo: repoName,
          baseUrl: options?.forgeBaseUrl,
          token: options?.githubToken,
        },
        issueNumber: payload.issue.number,
        issueUrl: payload.issue.html_url,
        title: payload.issue.title || `Issue #${payload.issue.number}`,
        planMarkdown: payload.issue.body || payload.issue.title || `Issue #${payload.issue.number}`,
        workspacePath,
      });
      return {
        handled: true,
        action: 'autopilot_started',
        command: 'label:lyra:autopilot',
        issueNumber: payload.issue.number,
        runId: run.runId,
        message: `Autopilot started on ${forge} ${repoOwner}/${repoName}#${payload.issue.number} (${run.runId}).`,
      };
    }

    const commentBody = payload.comment?.body?.trim();

    if (!commentBody || !commentBody.startsWith('/lyra')) {
      return { handled: false, action: 'ignored', message: 'No /lyra command detected' };
    }

    const commandMatch = commentBody.match(/^\/lyra\s+([a-zA-Z_-]+)(?:\s+(.*))?$/s);
    if (!commandMatch) {
      return { handled: false, action: 'ignored', message: 'Invalid /lyra command syntax' };
    }

    const subCommand = commandMatch[1]!.toLowerCase();
    const commandArgs = (commandMatch[2] || '').trim();

    switch (subCommand) {
      case 'run': {
        if (!issueNumber) {
          return { handled: false, action: 'ignored', message: 'Missing issue number for /lyra run.' };
        }
        const run = await autopilotOrchestrator.startRun({
          forgeTarget: {
            forge,
            owner: repoOwner,
            repo: repoName,
            baseUrl: options?.forgeBaseUrl,
            token: options?.githubToken,
          },
          issueNumber,
          issueUrl: payload.issue?.html_url,
          title: payload.issue?.title || `Issue #${issueNumber}`,
          planMarkdown: commandArgs || payload.issue?.body || `Issue #${issueNumber}`,
          workspacePath,
        });
        return {
          handled: true,
          action: 'autopilot_started',
          command: subCommand,
          issueNumber,
          runId: run.runId,
          message: `Autopilot started for #${issueNumber} (${run.runId}).`,
        };
      }

      case 'proceed':
      case 'expand-scope':
      case 'retry':
      case 'abort': {
        if (!issueNumber) {
          return { handled: false, action: 'ignored', message: `Missing issue number for /lyra ${subCommand}.` };
        }
        const existing = autopilotOrchestrator.getRunByIssue(
          { forge, owner: repoOwner, repo: repoName },
          issueNumber
        );
        if (!existing) {
          return { handled: false, action: 'ignored', message: `No active Autopilot run found for #${issueNumber}.` };
        }
        const updated = await autopilotOrchestrator.respondToRun(existing.runId, {
          action: subCommand,
          message: commandArgs || undefined,
          author: payload.comment?.user.login || 'user',
        });
        return {
          handled: true,
          action: subCommand === 'abort' ? 'autopilot_aborted' : 'autopilot_resumed',
          command: subCommand,
          issueNumber,
          runId: updated.runId,
          message: `Autopilot run ${updated.runId} updated via /lyra ${subCommand} (phase: ${updated.phase}).`,
        };
      }
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
