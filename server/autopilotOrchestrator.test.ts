import { afterEach, describe, expect, test } from 'bun:test';
import crypto from 'node:crypto';
import {
  IssueForgeAdapter,
  parseGitRemoteUrl,
  verifyForgeWebhookSignature,
} from './issueForgeAdapter';
import {
  AutopilotOrchestrator,
  parsePlanMarkdown,
  renderLiveIssueStatusComment,
  type AutopilotStreamEvent,
} from './autopilotOrchestrator';
import { GitHubWebhookHandler } from './githubWebhookHandler';

describe('IssueForgeAdapter & GitHub/Forgejo Parsing', () => {
  test('parseGitRemoteUrl detects GitHub and Forgejo from HTTPS and SSH URLs', () => {
    expect(parseGitRemoteUrl('https://github.com/acme/lyra.git')).toEqual({
      forge: 'github',
      owner: 'acme',
      repo: 'lyra',
      baseUrl: 'https://api.github.com',
    });
    expect(parseGitRemoteUrl('git@github.com:acme/gram.git')).toEqual({
      forge: 'github',
      owner: 'acme',
      repo: 'gram',
      baseUrl: 'https://api.github.com',
    });
    expect(parseGitRemoteUrl('https://git.2helix.org/taufeeq/lyra.git')).toEqual({
      forge: 'forgejo',
      owner: 'taufeeq',
      repo: 'lyra',
      baseUrl: 'https://git.2helix.org',
    });
    expect(parseGitRemoteUrl('git@code.internal.dev:team/app.git')).toEqual({
      forge: 'forgejo',
      owner: 'team',
      repo: 'app',
      baseUrl: 'https://code.internal.dev',
    });
  });

  test('verifyForgeWebhookSignature validates both GitHub sha256= and raw Forgejo hex signatures', () => {
    const payload = JSON.stringify({ action: 'labeled' });
    const secret = 'super-secret-key';
    const digest = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    expect(verifyForgeWebhookSignature(payload, `sha256=${digest}`, secret)).toBe(true);
    expect(verifyForgeWebhookSignature(payload, digest, secret)).toBe(true);
    expect(verifyForgeWebhookSignature(payload, 'sha256=deadbeef', secret)).toBe(false);
    expect(verifyForgeWebhookSignature(payload, undefined, secret)).toBe(false);
  });
});

describe('AutopilotOrchestrator Lifecycle (Plan -> Issue -> Live Progress -> Pause/Resume -> Draft PR)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('parsePlanMarkdown extracts YAML frontmatter scopes, title, and task checklist', () => {
    const md = `---
forge: forgejo
allow_write: [server/auth.ts, server/session.ts]
draft_pr: true
max_retries: 3
council_review: true
---
# Add OAuth Refresh Tokens

## Tasks
- [ ] Add refresh token column
- [x] Update session middleware
`;
    const parsed = parsePlanMarkdown(md);
    expect(parsed.title).toBe('Add OAuth Refresh Tokens');
    expect(parsed.config.forge).toBe('forgejo');
    expect(parsed.config.allowWrite).toEqual(['server/auth.ts', 'server/session.ts']);
    expect(parsed.config.draftPr).toBe(true);
    expect(parsed.config.maxRetries).toBe(3);
    expect(parsed.tasks).toEqual([
      { label: 'Add refresh token column', done: false },
      { label: 'Update session middleware', done: true },
    ]);
  });

  test('runs full issue lifecycle with single in-place status comment, error redaction, pause/resume, and Draft PR', async () => {
    const calls: Array<{ url: string; method: string; body: any; auth: string }> = [];
    let nextCommentId = 500;

    globalThis.fetch = (async (input: any, init?: any) => {
      const url = String(input);
      const method = init?.method || 'GET';
      const body = init?.body ? JSON.parse(init.body) : undefined;
      const auth = init?.headers?.Authorization || '';
      calls.push({ url, method, body, auth });

      if (url.endsWith('/issues') && method === 'POST') {
        return new Response(JSON.stringify({ number: 42, html_url: 'https://git.2helix.org/acme/lyra/issues/42' }), { status: 201 });
      }
      if (url.includes('/issues/42/comments') && method === 'POST') {
        nextCommentId += 1;
        return new Response(JSON.stringify({ id: nextCommentId, html_url: `https://git.2helix.org/acme/lyra/issues/42#issuecomment-${nextCommentId}` }), { status: 201 });
      }
      if (url.includes('/issues/comments/') && method === 'PATCH') {
        return new Response(JSON.stringify({ id: 501, html_url: 'https://git.2helix.org/acme/lyra/issues/42#issuecomment-501' }), { status: 200 });
      }
      if (url.endsWith('/pulls') && method === 'POST') {
        return new Response(JSON.stringify({ number: 99, html_url: 'https://git.2helix.org/acme/lyra/pulls/99' }), { status: 201 });
      }
      return new Response('{}', { status: 200 });
    }) as any;

    const adapter = new IssueForgeAdapter();
    const orchestrator = new AutopilotOrchestrator(adapter);
    const events: AutopilotStreamEvent[] = [];
    orchestrator.on('event', (evt) => events.push(evt));

    const published = await orchestrator.publishPlanAsIssue({
      markdown: `---\nforge: forgejo\ndraft_pr: true\ncouncil_review: false\n---\n# Fix Token Refresh\n- [ ] Patch auth.ts\n`,
      workspacePath: process.cwd(),
      forgeTarget: {
        forge: 'forgejo',
        owner: 'acme',
        repo: 'lyra',
        baseUrl: 'https://git.2helix.org',
        token: 'fj-secret-token',
      },
      autoStart: true,
    });

    expect(published.issue.success).toBe(true);
    expect(published.issue.issueNumber).toBe(42);
    expect(published.run?.statusCommentId).toBe(501);
    expect(published.run?.ahpSessionId).toBe('autopilot:forgejo:acme/lyra#42');

    const runId = published.run!.runId;

    // 1. Transition phase & record error with secret -> updates SAME comment 501 via PATCH and redacts secret
    await orchestrator.transitionPhase(runId, 'developing');
    await orchestrator.recordError(runId, 'Build failed with token=sk-ant-123456789012345678901234');
    const recAfterErr = orchestrator.getRun(runId)!;
    expect(recAfterErr.errors[0]?.message).not.toContain('sk-ant-123456789012345678901234');
    expect(calls.some((c) => c.method === 'PATCH' && c.url.endsWith('/issues/comments/501'))).toBe(true);

    // 2. Pause for human input -> updates living comment AND posts a dedicated ping comment
    recAfterErr.proofContract = {
      tamperedFilesRestored: [],
      withinBlastRadius: false,
      outOfScopeFiles: ['server/extra.ts'],
      differentialRedGreen: false,
      autoPrEligible: false,
    };
    await orchestrator.pauseForUserInput(runId, {
      reason: 'blast_radius',
      question: 'Edit touched server/extra.ts outside AST neighborhood. Expand scope?',
      options: ['expand-scope', 'proceed', 'abort'],
    });
    expect(orchestrator.getRun(runId)?.phase).toBe('needs-attention');
    expect(events.some((e) => e.type === 'AWAITING_INPUT')).toBe(true);

    // 3. Respond with expand-scope -> adds server/extra.ts to allowWrite and resumes
    const resumed = await orchestrator.respondToRun(runId, {
      action: 'expand-scope',
      message: 'Allow server/extra.ts for token helper.',
      author: 'taufeeq',
    });
    expect(resumed.phase).toBe('developing');
    expect(resumed.config.allowWrite).toContain('server/extra.ts');
    expect(resumed.pendingQuestion).toBeUndefined();

    // 4. Finalize with Draft PR -> opens WIP PR on Forgejo linking Closes #42
    const done = await orchestrator.finalizeWithDraftPr(runId, {
      headBranch: 'autopilot/issue-42',
      baseBranch: 'main',
      patchDiff: '+ export const refresh = true;',
      proofContract: {
        tamperedFilesRestored: [],
        withinBlastRadius: true,
        outOfScopeFiles: [],
        differentialRedGreen: true,
        autoPrEligible: true,
      },
    });
    expect(done.phase).toBe('completed');
    expect(done.prNumber).toBe(99);
    const prCall = calls.find((c) => c.url.endsWith('/pulls'));
    expect(prCall?.body.title).toBe('WIP: Fix Token Refresh');
    expect(prCall?.body.body).toContain('Closes #42');
    expect(prCall?.auth).toBe('token fj-secret-token');

    const finalComment = renderLiveIssueStatusComment(done);
    expect(finalComment).toContain('<!-- lyra-autopilot-run:');
    expect(finalComment).toContain('RED → GREEN Differential:** PASS');
  });

  test('GitHubWebhookHandler handles lyra:autopilot label and /lyra abort on Forgejo', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ id: 700 }), { status: 201 })) as any;

    const handler = new GitHubWebhookHandler({} as any, { secret: 'webhook-sec' });
    const startRes = await handler.handleWebhook(
      {
        action: 'labeled',
        label: { name: 'lyra:autopilot' },
        issue: { number: 77, title: 'Add dark mode', body: '- [ ] Update CSS' },
        repository: { name: 'gram', owner: { login: 'acme' }, full_name: 'acme/gram' },
      },
      { forge: 'forgejo', forgeBaseUrl: 'https://git.2helix.org', githubToken: 'tok' }
    );
    expect(startRes.handled).toBe(true);
    expect(startRes.action).toBe('autopilot_started');
    expect(startRes.runId).toBeTruthy();

    const abortRes = await handler.handleWebhook(
      {
        action: 'created',
        issue: { number: 77 },
        comment: { id: 1, body: '/lyra abort', user: { login: 'taufeeq' } },
        repository: { name: 'gram', owner: { login: 'acme' }, full_name: 'acme/gram' },
      },
      { forge: 'forgejo', forgeBaseUrl: 'https://git.2helix.org', githubToken: 'tok' }
    );
    expect(abortRes.handled).toBe(true);
    expect(abortRes.action).toBe('autopilot_aborted');
  });
});
