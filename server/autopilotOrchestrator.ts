/**
 * Lyra AHP-Backed Autopilot Orchestrator (GitHub & Forgejo Issues -> Autonomous Dev -> Proof Contract -> Draft PR)
 *
 * Features:
 * - Parses Markdown plan frontmatter scopes (`forge`, `allow_write`, `draft_pr`, `max_retries`, `council_review`)
 * - Publishes Gram plans to GitHub or Forgejo Issues
 * - Backs every autonomous run with an AHP Session (`autopilot:<forge>:<owner>/<repo>#<issue>`)
 * - Maintains ONE live-updating status comment on the issue (in-place PATCH) with task checklist,
 *   phase timeline, redacted errors, and Proof Contract / Pre-PR Council results
 * - Supports interactive pause/resume (`needs-attention` -> `/lyra proceed`, `expand-scope`, `retry`, `abort`)
 * - Distills human unblocks into 24/7 `strandsMemory` so future runs learn from corrections
 */

import { EventEmitter } from 'node:events';
import {
  detectForgeFromWorkspace,
  issueForgeAdapter,
  type ForgeTarget,
  type ForgeType,
  type IssueForgeAdapter,
} from './issueForgeAdapter';
import { redactSecretText } from './security';
import { modelCouncil } from './modelCouncil';
import { reviewPatchAcrossProviders } from './unifiedModelCatalog';
import type { ProofContractReport } from './nightShift/proofContract';

export type AutopilotPhase =
  | 'queued'
  | 'indexing'
  | 'developing'
  | 'verifying'
  | 'council_review'
  | 'needs-attention'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface PlanFrontmatterConfig {
  forge?: ForgeType;
  allowWrite?: string[];
  draftPr: boolean;
  maxRetries: number;
  councilReview: boolean;
}

export interface ParsedPlanSpec {
  title: string;
  body: string;
  tasks: Array<{ label: string; done: boolean }>;
  config: PlanFrontmatterConfig;
}

export interface AutopilotErrorRecord {
  timestamp: string;
  phase: AutopilotPhase;
  message: string;
  detail?: string;
}

export interface AutopilotQuestion {
  id: string;
  createdAt: string;
  reason: 'verification_failed' | 'blast_radius' | 'tampered_harness' | 'clarification' | 'budget';
  question: string;
  options: Array<'proceed' | 'expand-scope' | 'retry' | 'abort'>;
  context?: string;
}

export interface AutopilotRunRecord {
  runId: string;
  ahpSessionId: string;
  forgeTarget: ForgeTarget;
  issueNumber: number;
  issueUrl?: string;
  title: string;
  planBody: string;
  config: PlanFrontmatterConfig;
  workspacePath: string;
  phase: AutopilotPhase;
  tasks: Array<{ label: string; done: boolean }>;
  statusCommentId?: number;
  errors: AutopilotErrorRecord[];
  pendingQuestion?: AutopilotQuestion;
  humanResponses: Array<{ action: string; message?: string; author?: string; timestamp: string }>;
  proofContract?: ProofContractReport;
  councilReviewSummary?: { approved: boolean; issues: string[]; reviewerModel: string; reviewerProvider: string };
  prNumber?: number;
  prUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutopilotStreamEvent {
  type:
    | 'RUN_STARTED'
    | 'PHASE_CHANGED'
    | 'TASK_UPDATED'
    | 'ERROR_ENCOUNTERED'
    | 'AWAITING_INPUT'
    | 'RUN_RESUMED'
    | 'RUN_FINISHED';
  runId: string;
  ahpSessionId: string;
  phase: AutopilotPhase;
  timestamp: string;
  message: string;
  record: AutopilotRunRecord;
}

/**
 * Extracts optional YAML-like frontmatter (`--- ... ---`), title, and task checklist from a Gram plan.
 */
export function parsePlanMarkdown(markdown: string): ParsedPlanSpec {
  let content = String(markdown || '').trim();
  const config: PlanFrontmatterConfig = {
    draftPr: true,
    maxRetries: 2,
    councilReview: true,
  };

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fmMatch) {
    const fmLines = fmMatch[1]!.split('\n');
    for (const rawLine of fmLines) {
      const line = rawLine.trim();
      const kv = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.+)$/);
      if (!kv) continue;
      const key = kv[1]!.toLowerCase();
      const val = kv[2]!.trim();
      if (key === 'forge' && (val === 'github' || val === 'forgejo')) {
        config.forge = val;
      } else if (key === 'draft_pr') {
        config.draftPr = val !== 'false';
      } else if (key === 'council_review') {
        config.councilReview = val !== 'false';
      } else if (key === 'max_retries') {
        const n = Number(val);
        if (Number.isFinite(n) && n >= 0 && n <= 10) config.maxRetries = Math.floor(n);
      } else if (key === 'allow_write') {
        const cleaned = val.replace(/^\[|\]$/g, '');
        config.allowWrite = cleaned
          .split(',')
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean);
      }
    }
    content = content.slice(fmMatch[0].length).trim();
  }

  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1]!.trim() : 'Lyra Autopilot Plan';

  const tasks: Array<{ label: string; done: boolean }> = [];
  for (const line of content.split('\n')) {
    const taskMatch = line.trim().match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (taskMatch) {
      tasks.push({
        done: taskMatch[1]!.toLowerCase() === 'x',
        label: taskMatch[2]!.trim(),
      });
    }
  }

  return { title, body: content, tasks, config };
}

export function renderLiveIssueStatusComment(record: AutopilotRunRecord): string {
  const phaseEmoji: Record<AutopilotPhase, string> = {
    queued: '⏳',
    indexing: '🔍',
    developing: '🛠️',
    verifying: '🧪',
    council_review: '⚖️',
    'needs-attention': '✋',
    completed: '✅',
    failed: '❌',
    cancelled: '🛑',
  };

  const lines: string[] = [
    `<!-- lyra-autopilot-run:${record.runId} -->`,
    `### ${phaseEmoji[record.phase]} Lyra Autopilot — \`${record.phase.toUpperCase()}\``,
    `**Run ID:** \`${record.runId}\` · **AHP Session:** \`${record.ahpSessionId}\` · **Updated:** ${record.updatedAt}`,
    ``,
  ];

  if (record.tasks.length > 0) {
    lines.push(`#### Progress Checklist`);
    for (const t of record.tasks) {
      lines.push(`- [${t.done ? 'x' : ' '}] ${t.label}`);
    }
    lines.push(``);
  }

  if (record.proofContract) {
    lines.push(
      `#### Verifiable Proof Contract`,
      `- **RED → GREEN Differential:** ${record.proofContract.differentialRedGreen ? 'PASS' : 'PENDING/FAIL'}`,
      `- **Blast Radius:** ${record.proofContract.withinBlastRadius ? 'In-Scope' : `Out of scope (${record.proofContract.outOfScopeFiles.join(', ')})`}`,
      `- **Harness Integrity:** ${record.proofContract.tamperedFilesRestored.length === 0 ? 'Untampered' : `Restored ${record.proofContract.tamperedFilesRestored.join(', ')}`}`,
      ``
    );
  }

  if (record.councilReviewSummary) {
    lines.push(
      `#### Pre-PR Council Review (${record.councilReviewSummary.reviewerModel} via ${record.councilReviewSummary.reviewerProvider})`,
      `- **Verdict:** ${record.councilReviewSummary.approved ? 'Approved' : 'Changes Requested'}`,
      ...(record.councilReviewSummary.issues.length > 0
        ? record.councilReviewSummary.issues.map((i) => `  - ${i}`)
        : ['- No blocking defects detected.']),
      ``
    );
  }

  if (record.prUrl) {
    lines.push(`#### Pull Request`, `- Opened PR #${record.prNumber}: ${record.prUrl}`, ``);
  }

  if (record.errors.length > 0) {
    lines.push(`<details><summary>Errors Encountered (${record.errors.length})</summary>`, ``);
    for (const err of record.errors.slice(-5)) {
      lines.push(`- **[${err.phase}]** ${redactSecretText(err.message)}`);
      if (err.detail) {
        lines.push(`  \`\`\`text\n  ${redactSecretText(err.detail).slice(0, 600)}\n  \`\`\``);
      }
    }
    lines.push(`</details>`, ``);
  }

  if (record.pendingQuestion) {
    lines.push(
      `#### ✋ Action Needed`,
      record.pendingQuestion.question,
      ``,
      `Reply on this issue (or in Gram) with one of:`,
      ...record.pendingQuestion.options.map((opt) =>
        opt === 'proceed'
          ? `- \`/lyra proceed <your guidance>\``
          : `- \`/lyra ${opt}\``
      ),
      ``
    );
  }

  return lines.join('\n');
}

export class AutopilotOrchestrator extends EventEmitter {
  private readonly runs = new Map<string, AutopilotRunRecord>();
  private readonly issueToRunId = new Map<string, string>();

  constructor(private readonly forge: IssueForgeAdapter = issueForgeAdapter) {
    super();
  }

  private issueKey(target: Pick<ForgeTarget, 'forge' | 'owner' | 'repo'>, issueNumber: number): string {
    return `${target.forge}:${target.owner}/${target.repo}#${issueNumber}`;
  }

  public listRuns(): AutopilotRunRecord[] {
    return Array.from(this.runs.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  public getRun(runId: string): AutopilotRunRecord | undefined {
    return this.runs.get(runId);
  }

  public getRunByIssue(target: Pick<ForgeTarget, 'forge' | 'owner' | 'repo'>, issueNumber: number): AutopilotRunRecord | undefined {
    const runId = this.issueToRunId.get(this.issueKey(target, issueNumber));
    return runId ? this.runs.get(runId) : undefined;
  }

  private emitLifecycle(
    type: AutopilotStreamEvent['type'],
    record: AutopilotRunRecord,
    message: string
  ): void {
    const event: AutopilotStreamEvent = {
      type,
      runId: record.runId,
      ahpSessionId: record.ahpSessionId,
      phase: record.phase,
      timestamp: new Date().toISOString(),
      message,
      record: { ...record },
    };
    this.emit('event', event);
    this.emit(`run:${record.runId}`, event);
  }

  public async syncLiveIssueComment(record: AutopilotRunRecord): Promise<void> {
    const body = renderLiveIssueStatusComment(record);
    if (record.statusCommentId) {
      await this.forge.updateIssueComment({
        ...record.forgeTarget,
        commentId: record.statusCommentId,
        body,
      });
    } else {
      const created = await this.forge.createIssueComment({
        ...record.forgeTarget,
        issueNumber: record.issueNumber,
        body,
      });
      if (created.success && created.commentId) {
        record.statusCommentId = created.commentId;
      }
    }
  }

  /**
   * Publishes a Gram Plan Mode markdown spec as a GitHub or Forgejo Issue,
   * and optionally starts an Autopilot run immediately.
   */
  public async publishPlanAsIssue(params: {
    markdown: string;
    workspacePath: string;
    forgeTarget?: ForgeTarget;
    autoStart?: boolean;
  }): Promise<{
    issue: { success: boolean; issueNumber?: number; issueUrl?: string; error?: string };
    run?: AutopilotRunRecord;
  }> {
    const parsed = parsePlanMarkdown(params.markdown);
    const detected = params.forgeTarget || detectForgeFromWorkspace(params.workspacePath);
    if (!detected) {
      return {
        issue: {
          success: false,
          error: 'Could not detect GitHub or Forgejo remote from workspace. Pass forgeTarget explicitly.',
        },
      };
    }

    const target: ForgeTarget = {
      ...detected,
      forge: parsed.config.forge || detected.forge,
    };

    const labels = params.autoStart ? ['lyra:autopilot'] : ['lyra:plan'];
    const issue = await this.forge.createIssue({
      ...target,
      title: parsed.title,
      body: parsed.body,
      labels,
    });

    if (!issue.success || !issue.issueNumber) {
      return { issue };
    }

    if (params.autoStart) {
      const run = await this.startRun({
        forgeTarget: target,
        issueNumber: issue.issueNumber,
        issueUrl: issue.issueUrl,
        title: parsed.title,
        planMarkdown: params.markdown,
        workspacePath: params.workspacePath,
      });
      return { issue, run };
    }

    return { issue };
  }

  public async startRun(params: {
    forgeTarget: ForgeTarget;
    issueNumber: number;
    issueUrl?: string;
    title: string;
    planMarkdown: string;
    workspacePath: string;
  }): Promise<AutopilotRunRecord> {
    const parsed = parsePlanMarkdown(params.planMarkdown);
    const now = new Date().toISOString();
    const runId = `ap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const ahpSessionId = `autopilot:${params.forgeTarget.forge}:${params.forgeTarget.owner}/${params.forgeTarget.repo}#${params.issueNumber}`;

    const record: AutopilotRunRecord = {
      runId,
      ahpSessionId,
      forgeTarget: params.forgeTarget,
      issueNumber: params.issueNumber,
      issueUrl: params.issueUrl,
      title: params.title || parsed.title,
      planBody: parsed.body,
      config: parsed.config,
      workspacePath: params.workspacePath,
      phase: 'queued',
      tasks: parsed.tasks,
      errors: [],
      humanResponses: [],
      createdAt: now,
      updatedAt: now,
    };

    this.runs.set(runId, record);
    this.issueToRunId.set(this.issueKey(params.forgeTarget, params.issueNumber), runId);
    await this.syncLiveIssueComment(record);
    this.emitLifecycle('RUN_STARTED', record, `Started Autopilot run for issue #${params.issueNumber}`);
    return record;
  }

  public async transitionPhase(
    runId: string,
    phase: AutopilotPhase,
    detail?: string
  ): Promise<AutopilotRunRecord> {
    const record = this.runs.get(runId);
    if (!record) throw new Error(`Autopilot run not found: ${runId}`);
    record.phase = phase;
    record.updatedAt = new Date().toISOString();
    await this.syncLiveIssueComment(record);
    this.emitLifecycle(
      phase === 'completed' || phase === 'failed' || phase === 'cancelled'
        ? 'RUN_FINISHED'
        : 'PHASE_CHANGED',
      record,
      detail || `Transitioned to ${phase}`
    );
    return record;
  }

  public async recordError(
    runId: string,
    message: string,
    detail?: string
  ): Promise<AutopilotRunRecord> {
    const record = this.runs.get(runId);
    if (!record) throw new Error(`Autopilot run not found: ${runId}`);
    record.errors.push({
      timestamp: new Date().toISOString(),
      phase: record.phase,
      message: redactSecretText(message),
      detail: detail ? redactSecretText(detail) : undefined,
    });
    record.updatedAt = new Date().toISOString();
    await this.syncLiveIssueComment(record);
    this.emitLifecycle('ERROR_ENCOUNTERED', record, message);
    return record;
  }

  /**
   * Pauses the run in `needs-attention`, updates the living status comment, and posts
   * a dedicated ping comment on the issue so the user is notified and can steer it.
   */
  public async pauseForUserInput(
    runId: string,
    question: Omit<AutopilotQuestion, 'id' | 'createdAt'>
  ): Promise<AutopilotRunRecord> {
    const record = this.runs.get(runId);
    if (!record) throw new Error(`Autopilot run not found: ${runId}`);

    record.phase = 'needs-attention';
    record.pendingQuestion = {
      ...question,
      id: `q-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    record.updatedAt = new Date().toISOString();

    await this.syncLiveIssueComment(record);
    await this.forge.createIssueComment({
      ...record.forgeTarget,
      issueNumber: record.issueNumber,
      body: `✋ **Lyra Autopilot needs your input** (\`${record.runId}\`)\n\n${question.question}\n\nReply with \`/lyra proceed <guidance>\`, \`/lyra expand-scope\`, \`/lyra retry\`, or \`/lyra abort\`.`,
    });

    this.emitLifecycle('AWAITING_INPUT', record, question.question);
    return record;
  }

  /**
   * Resumes or aborts a paused run from either a GitHub/Forgejo comment or Gram UI,
   * distilling human guidance into 24/7 Strands Repo Memory.
   */
  public async respondToRun(
    runId: string,
    input: {
      action: 'proceed' | 'expand-scope' | 'retry' | 'abort';
      message?: string;
      author?: string;
    }
  ): Promise<AutopilotRunRecord> {
    const record = this.runs.get(runId);
    if (!record) throw new Error(`Autopilot run not found: ${runId}`);

    const now = new Date().toISOString();
    record.humanResponses.push({
      action: input.action,
      message: input.message,
      author: input.author || 'user',
      timestamp: now,
    });
    record.pendingQuestion = undefined;
    record.updatedAt = now;

    if (input.message?.trim()) {
      try {
        modelCouncil.saveMemoryEntry({
          workspacePath: record.workspacePath,
          sessionId: record.ahpSessionId,
          topic: `Autopilot guidance for #${record.issueNumber}: ${record.title}`.slice(0, 100),
          consensusSummary: input.message.trim().slice(0, 240),
          keyDisagreement: 'Human steering applied during Autopilot pause.',
          recommendedAction: input.message.trim().slice(0, 300),
          citations: record.proofContract?.outOfScopeFiles || [],
        });
      } catch {}
    }

    if (input.action === 'abort') {
      record.phase = 'cancelled';
      await this.syncLiveIssueComment(record);
      this.emitLifecycle('RUN_FINISHED', record, 'Run cancelled by user.');
      return record;
    }

    if (input.action === 'expand-scope' && record.proofContract?.outOfScopeFiles?.length) {
      record.config.allowWrite = Array.from(
        new Set([...(record.config.allowWrite || []), ...record.proofContract.outOfScopeFiles])
      );
    }

    record.phase = 'developing';
    await this.syncLiveIssueComment(record);
    this.emitLifecycle(
      'RUN_RESUMED',
      record,
      `Resumed via ${input.action}${input.message ? `: ${input.message}` : ''}`
    );
    return record;
  }

  /**
   * Runs the Pre-PR Cross-Family Council gate (Code Review Max pattern) and opens a Draft PR.
   */
  public async finalizeWithDraftPr(
    runId: string,
    params: {
      headBranch: string;
      baseBranch: string;
      patchDiff: string;
      proofContract: ProofContractReport;
    }
  ): Promise<AutopilotRunRecord> {
    const record = this.runs.get(runId);
    if (!record) throw new Error(`Autopilot run not found: ${runId}`);

    record.proofContract = params.proofContract;
    if (record.config.councilReview && params.patchDiff.trim()) {
      await this.transitionPhase(runId, 'council_review', 'Running cross-family pre-PR council review');
      record.councilReviewSummary = await reviewPatchAcrossProviders({
        patchDiff: params.patchDiff,
        taskSummary: record.title,
      });
    }

    const prBody = [
      `Closes #${record.issueNumber}`,
      ``,
      renderLiveIssueStatusComment(record),
    ].join('\n');

    const pr = await this.forge.createPullRequest({
      ...record.forgeTarget,
      head: params.headBranch,
      base: params.baseBranch,
      title: record.title,
      body: prBody,
      draft: record.config.draftPr,
    });

    if (pr.success) {
      record.prNumber = pr.prNumber;
      record.prUrl = pr.prUrl;
      await this.transitionPhase(runId, 'completed', `Opened PR #${pr.prNumber}`);
    } else {
      await this.recordError(runId, pr.error || 'Failed to open pull request');
      await this.pauseForUserInput(runId, {
        reason: 'clarification',
        question: `Verification succeeded, but opening the PR failed: ${pr.error}. How would you like to proceed?`,
        options: ['retry', 'abort'],
      });
    }
    return record;
  }
}

export const autopilotOrchestrator = new AutopilotOrchestrator();
