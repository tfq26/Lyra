import { describe, expect, it, beforeEach, afterAll } from 'bun:test';
import path from 'node:path';
import fs from 'node:fs';
import { LyraHarnessMcpServer } from './harnessMcpServer';
import { LyraHarnessGateway } from './gateway';
import { UnifiedStore } from './unifiedStore';

describe('Lyra Harness MCP Server', () => {
  let store: UnifiedStore;
  let gateway: LyraHarnessGateway;
  let mcpServer: LyraHarnessMcpServer;
  let testDirs: string[] = [];

  beforeEach(() => {
    const testStoreDir = path.join(process.cwd(), '.bun-temp', `store-mcp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    testDirs.push(testStoreDir);
    store = new UnifiedStore(testStoreDir);
    gateway = new LyraHarnessGateway(store);
    mcpServer = new LyraHarnessMcpServer(gateway, store);
  });

  afterAll(() => {
    for (const dir of testDirs) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('exposes the 17 standardized MCP harness tools (including Code Mode)', () => {
    const tools = mcpServer.getTools();
    expect(tools.length).toBe(17);
    const names = tools.map((t) => t.name);
    expect(names).toContain('lyra_dispatch_task');
    expect(names).toContain('lyra_get_run_status');
    expect(names).toContain('lyra_get_pending_requests');
    expect(names).toContain('lyra_provide_file_context');
    expect(names).toContain('lyra_respond_permission');
    expect(names).toContain('lyra_create_github_pr');
    expect(names).toContain('lyra_get_handoff');
    expect(names).toContain('lyra_inspect_diff');
    expect(names).toContain('lyra_resolve_conflict');
    expect(names).toContain('lyra_run_qa_sandbox');
    expect(names).toContain('lyra_dispatch_and_pr');
    expect(names).toContain('lyra_run_maintenance');
    expect(names).toContain('lyra_council_analyze');
    expect(names).toContain('lyra_sync_session');
    expect(names).toContain('lyra_nightshift_investigate');
    expect(names).toContain('lyra_search');
    expect(names).toContain('lyra_execute');
  });

  it('executes lyra_search and lyra_execute Code Mode tools via MCP', async () => {
    const searchRes = await mcpServer.executeTool('lyra_search', { query: 'db' });
    const parsedSearch = JSON.parse(searchRes.content[0]!.text);
    expect(parsedSearch.namespaces).toContain('lyra.db');

    const execRes = await mcpServer.executeTool('lyra_execute', {
      tenantId: 'mcp-tenant',
      script: `
        await lyra.db.scratchpadSet('ns1', 'k1', { ok: true });
        const val = await lyra.db.scratchpadGet('ns1', 'k1');
        return JSON.parse(val);
      `,
    });
    const parsedExec = JSON.parse(execRes.content[0]!.text);
    expect(parsedExec.success).toBe(true);
    expect(parsedExec.returnValue).toEqual({ ok: true });
  });

  it('executes QA sandbox and conflict resolution tools', async () => {
    const tempWorkspace = path.join(process.cwd(), '.bun-temp', `workspace-mcp-${Date.now()}`);
    testDirs.push(tempWorkspace);
    fs.mkdirSync(path.join(tempWorkspace, 'apps/api/src/http'), { recursive: true });
    fs.writeFileSync(path.join(tempWorkspace, 'apps/api/src/http/app.ts'), '// Initial file');

    const dispatch = await mcpServer.executeTool('lyra_dispatch_task', {
      objective: 'Implement OAuth refresh token rotation',
      workspacePath: tempWorkspace,
    });
    const { runId, sessionId } = JSON.parse(dispatch.content[0]!.text);

    // 1. QA sandbox tool
    const qaRes = await mcpServer.executeTool('lyra_run_qa_sandbox', { runId });
    const qaScorecard = JSON.parse(qaRes.content[0]!.text);
    expect(qaScorecard.runId).toBe(runId);
    expect(qaScorecard.overallScore).toBe(100);
    expect(qaScorecard.results.length).toBeGreaterThan(0);

    // 2. Conflict resolution tool
    const conflictRes = await mcpServer.executeTool('lyra_resolve_conflict', {
      runId,
      filePath: 'apps/api/src/http/app.ts',
      resolvedContent: '// Clean resolved code',
    });
    const conflictData = JSON.parse(conflictRes.content[0]!.text);
    expect(conflictData.success).toBe(true);

    // 3. Diff inspection tool
    const diffRes = await mcpServer.executeTool('lyra_inspect_diff', { runId });
    const diffData = JSON.parse(diffRes.content[0]!.text);
    expect(diffData.runId).toBe(runId);

    // 4. Status with FinOps telemetry
    const statusRes = await mcpServer.executeTool('lyra_get_run_status', { sessionId, runId });
    const statusData = JSON.parse(statusRes.content[0]!.text);
    expect(statusData.telemetry).toBeDefined();
    expect(statusData.telemetry.estimatedCostUsd).toBeGreaterThan(0);
    expect(typeof statusData.telemetry.model).toBe('string');
  });

  it('executes lyra_dispatch_task tool', async () => {
    const res = await mcpServer.executeTool('lyra_dispatch_task', {
      objective: 'Implement Apple HealthKit sync for Duit iOS',
      workspacePath: '/Users/taufeeqali/Projects/Duit',
    });

    expect(res.content.length).toBe(1);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.status).toBe('success');
    expect(parsed.sessionId).toBeDefined();
    expect(parsed.runId).toBeDefined();
  });

  it('executes context and permission handshake tools', async () => {
    const runId = 'run-mcp-test-1';
    
    // Remote agent requests file context
    const ctxReq = gateway.requestFileContext({
      runId,
      filePath: 'apps/ios/Duit/HealthKit.swift',
      reason: 'Need HKWorkoutType methods',
    });

    // Check pending requests via tool
    const pendingRes = await mcpServer.executeTool('lyra_get_pending_requests', { runId });
    const pending = JSON.parse(pendingRes.content[0]!.text);
    expect(pending.contexts.length).toBe(1);

    // Provide context via tool
    const fulfillRes = await mcpServer.executeTool('lyra_provide_file_context', {
      requestId: ctxReq.id,
      content: 'class HealthKitService { func requestAuthorization() {} }',
    });
    const fulfillData = JSON.parse(fulfillRes.content[0]!.text);
    expect(fulfillData.success).toBe(true);

    // Remote agent requests permission
    const permReq = gateway.requestPermission({
      runId,
      action: 'network_call',
      resource: 'https://api.apple.com',
      details: 'Checking developer certificates',
    });

    // Respond permission via tool
    const permRes = await mcpServer.executeTool('lyra_respond_permission', {
      requestId: permReq.id,
      approved: true,
    });
    const permData = JSON.parse(permRes.content[0]!.text);
    expect(permData.success).toBe(true);
    expect(permData.status).toBe('approved');
  });

  it('executes lyra_run_maintenance dry run via MCP', async () => {
    const res = await mcpServer.executeTool('lyra_run_maintenance', {
      workspacePath: process.cwd(),
      mode: 'deprecations',
      dryRun: true,
    });
    const report = JSON.parse(res.content[0]!.text);
    expect(report.runId).toContain('maint-');
    expect(report.mode).toBe('deprecations');
    expect(Array.isArray(report.results)).toBe(true);
  });
});
