import crypto from 'node:crypto';

export interface CiFailureEvent {
  id: string;
  source: 'github_actions' | 'gitlab_ci' | 'sentry' | 'cloudwatch' | 'manual';
  repository: string;
  branch: string;
  commitSha: string;
  failedJobName?: string;
  errorLog: string;
  receivedAt: string;
}

export class TriggerEngine {
  private secret?: string;

  constructor(options?: { secret?: string }) {
    this.secret = options?.secret || process.env.GITHUB_WEBHOOK_SECRET;
  }

  /**
   * Parses incoming webhook payloads from GitHub Actions workflow_run failures.
   */
  public parseGitHubWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
    payload: any
  ): CiFailureEvent | null {
    const eventName = headers['x-github-event'] as string;

    // Check for workflow_run failure: workflow_run completed with conclusion "failure"
    if (eventName === 'workflow_run' && payload.action === 'completed' && payload.workflow_run?.conclusion === 'failure') {
      const run = payload.workflow_run;
      return {
        id: `ci-${run.id}`,
        source: 'github_actions',
        repository: payload.repository?.full_name || 'unknown/repo',
        branch: run.head_branch || 'main',
        commitSha: run.head_sha || 'HEAD',
        failedJobName: run.name || 'CI Workflow',
        errorLog: `GitHub Workflow "${run.name}" failed on branch ${run.head_branch} (commit ${run.head_sha}). See: ${run.html_url}`,
        receivedAt: new Date().toISOString(),
      };
    }

    // Check for check_run failure
    if (eventName === 'check_run' && payload.action === 'completed' && payload.check_run?.conclusion === 'failure') {
      const check = payload.check_run;
      const logExcerpt = [
        check.output?.title,
        check.output?.summary,
        check.output?.text,
      ].filter(Boolean).join('\n');

      return {
        id: `check-${check.id}`,
        source: 'github_actions',
        repository: payload.repository?.full_name || 'unknown/repo',
        branch: check.check_suite?.head_branch || 'main',
        commitSha: check.head_sha || 'HEAD',
        failedJobName: check.name,
        errorLog: logExcerpt || `Check run ${check.name} failed.`,
        receivedAt: new Date().toISOString(),
      };
    }

    return null;
  }

  /**
   * Parses Sentry webhook alert payloads.
   */
  public parseSentryWebhook(payload: any): CiFailureEvent | null {
    if (!payload?.event) return null;
    const evt = payload.event;
    const stackTrace = evt.exception?.values?.map((v: any) => 
      `${v.type}: ${v.value}\n` + (v.stacktrace?.frames?.map((f: any) => `    at ${f.function} (${f.filename}:${f.lineno})`).join('\n') || '')
    ).join('\n\n') || evt.message || 'Sentry Error';

    return {
      id: `sentry-${evt.event_id || Date.now()}`,
      source: 'sentry',
      repository: payload.project_name || 'local',
      branch: 'main',
      commitSha: evt.release || 'HEAD',
      errorLog: stackTrace,
      receivedAt: new Date().toISOString(),
    };
  }
}

export const triggerEngine = new TriggerEngine();
