#!/usr/bin/env bun
/**
 * Live Demonstration: Harness Integration (Local Harness <-> Lyra Cloud Swarm)
 * 
 * Simulates a local harness (Antigravity / Codex) dispatching work to Lyra,
 * receiving a local context query, fulfilling it on demand, responding to
 * an elevated permission request, and monitoring the swarm progress.
 */

import path from 'node:path';
import fs from 'node:fs';
import { UnifiedStore } from '../server/unifiedStore';
import { LyraHarnessGateway } from '../server/gateway';
import { LyraHarnessMcpServer } from '../server/harnessMcpServer';

async function main() {
  console.log('\n================================================================================');
  console.log('             LYRA HARNESS INTEGRATION LIVE DEMONSTRATION                        ');
  console.log('================================================================================');

  const repoPath = '/Users/taufeeqali/Projects/Duit';
  const store = new UnifiedStore(path.join(repoPath, '.lyra-store'));
  const gateway = new LyraHarnessGateway(store);
  const mcpServer = new LyraHarnessMcpServer(gateway, store);

  console.log('🔌 Step 1: Initializing Local Harness MCP Server & Security Gateway...');
  const tools = mcpServer.getTools();
  console.log(`   ✅ Registered ${tools.length} MCP tools for Antigravity / Codex:`);
  for (const t of tools) {
    console.log(`      - [MCP Tool] ${t.name}: ${t.description.slice(0, 75)}...`);
  }

  // 1. Dispatch Task via MCP Tool
  console.log('\n📡 Step 2: Local Harness invokes `lyra_dispatch_task`...');
  const dispatchRes = await mcpServer.executeTool('lyra_dispatch_task', {
    objective: 'Implement Session Token Revocation and Token Blacklist in Duit API',
    workspacePath: repoPath,
  });
  const dispatchData = JSON.parse(dispatchRes.content[0]!.text);
  console.log('   ✅ Swarm Dispatched:');
  console.log(`      Session ID: ${dispatchData.sessionId}`);
  console.log(`      Run ID:     ${dispatchData.runId}`);

  const runId = dispatchData.runId;

  // 2. Real-time Event Subscription (SSE simulation)
  console.log('\n🎧 Step 3: Local Harness subscribes to real-time events for Run...');
  const eventsReceived: any[] = [];
  const unsubscribe = gateway.subscribeRunEvents(runId, (event) => {
    eventsReceived.push(event);
    console.log(`   🔔 [Event Stream] ${event.type}:`, JSON.stringify(event).slice(0, 90) + '...');
  });

  // 3. Remote Cloud Agent requests local file context
  console.log('\n❓ Step 4: Remote Lyra Agent requests local file context...');
  const ctxReq = gateway.requestFileContext({
    runId,
    filePath: 'apps/api/src/modules/auth/authRoutes.ts',
    lineRange: [1, 30],
    reason: 'Need existing Fastify auth route schemas to align token revocation endpoint',
  });
  console.log(`   Remote Agent asked: "${ctxReq.reason}" for file: ${ctxReq.filePath}`);

  // 4. Local Harness checks pending requests
  const pendingRes = await mcpServer.executeTool('lyra_get_pending_requests', { runId });
  const pendingData = JSON.parse(pendingRes.content[0]!.text);
  console.log(`   Pending context requests found: ${pendingData.contexts.length}`);

  // 5. Local Harness fulfills context without syncing entire filesystem
  console.log('\n📖 Step 5: Local Harness reads local file and fulfills context via `lyra_provide_file_context`...');
  const sampleAuthCode = `export async function registerAuthRoutes(app: FastifyInstance) {
  app.post('/login', async () => ({ token: 'jwt-xyz' }));
  app.post('/logout', async () => ({ ok: true }));
}`;

  const provideRes = await mcpServer.executeTool('lyra_provide_file_context', {
    requestId: ctxReq.id,
    content: sampleAuthCode,
  });
  console.log('   ✅ Context delivered to remote agent:', JSON.parse(provideRes.content[0]!.text));

  // 6. Remote Cloud Agent requests elevated permission (e.g. Git Push)
  console.log('\n🛡️ Step 6: Remote Lyra Agent encounters sensitive action, requests permission...');
  const permReq = gateway.requestPermission({
    runId,
    action: 'git_push',
    resource: 'origin/lyra/feat-session-revocation',
    details: 'Pushing tested feature branch to origin for Pull Request creation',
  });
  console.log(`   Permission requested: [${permReq.action}] on ${permReq.resource}`);

  // 7. Local Harness approves permission
  console.log('\n✋ Step 7: Local Harness evaluates safety policy and approves via `lyra_respond_permission`...');
  const permRes = await mcpServer.executeTool('lyra_respond_permission', {
    requestId: permReq.id,
    approved: true,
  });
  console.log('   ✅ Permission resolved:', JSON.parse(permRes.content[0]!.text));

  // 8. Local Harness queries swarm status
  console.log('\n📊 Step 8: Local Harness queries swarm execution state via `lyra_get_run_status`...');
  const statusRes = await mcpServer.executeTool('lyra_get_run_status', {
    sessionId: dispatchData.sessionId,
    runId,
  });
  console.log('   Current Swarm Status:');
  console.log('   ' + statusRes.content[0]!.text.split('\n').join('\n   '));

  // 9. Checkpoint & Resiliency Demonstration
  console.log('\n💾 Step 9: Simulating Task Resiliency Checkpointing...');
  store.saveRunCheckpoint(dispatchData.sessionId, runId, {
    sessionId: dispatchData.sessionId,
    runId,
    timestamp: new Date().toISOString(),
    stage: 'executing',
    state: 'executing',
    completedTaskIds: ['task-auth-scaffold'],
    failedTaskIds: [],
    branchName: 'lyra/run-test',
    integrationBranch: 'lyra/int-test',
    tasksSnapshot: [],
  });
  const latestCheckpoint = store.getLatestRunCheckpoint(dispatchData.sessionId, runId);
  console.log(`   ✅ Latest Checkpoint persisted: Completed tasks: [${latestCheckpoint?.completedTaskIds.join(', ')}]`);

  // 10. QA Sandbox & Live Telemetry
  console.log('\n🧪 Step 10: Executing Dynamic QA Sandbox via `lyra_run_qa_sandbox`...');
  const qaRes = await mcpServer.executeTool('lyra_run_qa_sandbox', { runId });
  const qaData = JSON.parse(qaRes.content[0]!.text);
  console.log(`   ✅ QA Scorecard: Overall Score ${qaData.overallScore}% (${qaData.passedScenarios}/${qaData.totalScenarios} scenarios passed)`);

  // 11. Autonomous Codebase Maintenance Caretaker
  console.log('\n🧹 Step 11: Running Grounded Codebase Maintenance via `lyra_run_maintenance`...');
  const maintRes = await mcpServer.executeTool('lyra_run_maintenance', {
    workspacePath: repoPath,
    mode: 'deprecations',
    dryRun: true,
  });
  const maintData = JSON.parse(maintRes.content[0]!.text);
  console.log(`   ✅ Maintenance Audit: Discovered ${maintData.totalAttempted} item(s)`);
  if (maintData.results[0]) {
    console.log(`      Sample Action: ${maintData.results[0].diffSummary}`);
    console.log(`      Grounding Citation: ${maintData.results[0].documentationCitation}`);
  }

  unsubscribe();
  console.log('\n🏁 Complete Lyra Harness, Cloud & Resiliency demonstration completed successfully!\n');
}

main().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});
