import { describe, expect, it, beforeEach, afterAll } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AHPServer } from './ahpProtocol';
import { CloudWatchEmfRegistry, cloudWatchTelemetry } from './cloudwatchEmf';
import { FastLaneExecutor } from './fastLaneExecutor';
import { triageExecutionLane } from './intentTriage';
import { ModelDecisionEngine } from './modelDecisionEngine';
import { ModelCouncilAnalyzer } from './modelCouncil';
import { resolveOptimalModel } from './modelRouter';
import { OpenAiCompatBridge } from './openaiCompatBridge';
import { SqsTaskQueue } from './sqsTaskQueue';
import { UnifiedStore } from './unifiedStore';

describe('Lyra v1.3 Adaptive 3-Lane Pipeline, Pareto Failover & AWS Well-Architected Suite', () => {
  let tempWorkspace: string;

  beforeEach(() => {
    tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'lyra-v13-test-'));
    fs.writeFileSync(
      path.join(tempWorkspace, 'math.ts'),
      'export function add(a: number, b: number): number {\n  return a - b;\n}\n',
      'utf8'
    );
  });

  afterAll(() => {
    try {
      fs.rmSync(tempWorkspace, { recursive: true, force: true });
    } catch {}
    cloudWatchTelemetry.reset();
  });

  describe('1. 3-Lane Sub-Millisecond Intent Triage', () => {
    it('routes informational and diagnostic questions to Lane 0 (Instant Ask)', () => {
      const res = triageExecutionLane({
        prompt: 'How does EcsNativeDispatcher handle Fargate task status reconciliation?',
      });
      expect(res.lane).toBe('ask');
      expect(res.overridden).toBe(false);
    });

    it('routes 1-2 file surgical edits to Lane 1 (Fast Patch)', () => {
      const res = triageExecutionLane({
        prompt: 'Fix the subtraction bug in math.ts so add returns a + b',
        activeFilePath: 'math.ts',
      });
      expect(res.lane).toBe('fast-patch');
      expect(res.detectedFiles).toContain('math.ts');
    });

    it('routes multi-file (>=3 files) or architectural objectives to Lane 2 (Full Swarm)', () => {
      const res = triageExecutionLane({
        prompt:
          'Refactor server/index.ts, server/gateway.ts, and site/src/pages/Home.tsx end-to-end across the codebase',
      });
      expect(res.lane).toBe('full-swarm');
      expect(res.estimatedFileCount).toBeGreaterThanOrEqual(3);
    });

    it('respects explicit user mode pill override', () => {
      const res = triageExecutionLane({
        prompt: 'Explain how auth works',
        modePreference: 'fast-patch',
      });
      expect(res.lane).toBe('fast-patch');
      expect(res.overridden).toBe(true);
    });
  });

  describe('2. Reinforced Pareto Router, Throttle Cooldown & FinOps Tier Escalation', () => {
    it('produces cross-provider failover chains and Cross-Region Inference Profile IDs', () => {
      const route = resolveOptimalModel({
        prompt: 'Fix null check in auth handler',
        lane: 'fast-patch',
        policyProfile: 'balanced',
      });
      expect(route.crossRegionProfileId.length).toBeGreaterThan(0);
      expect(route.failoverChain.length).toBeGreaterThan(0);
      expect(route.failoverChain[0]!.modelId).not.toBe(route.modelId);
    });

    it('shifts selection away from a model experiencing AWS Bedrock throttling cooldown', () => {
      const baseline = ModelDecisionEngine.decideOptimalModel({
        prompt: 'Fix typo in header comment',
        lane: 'ask',
        policyProfile: 'frugal',
      });
      const firstWinnerId = baseline.selectedModel.id;

      cloudWatchTelemetry.recordModelThrottle(firstWinnerId, 3200);

      const postThrottle = ModelDecisionEngine.decideOptimalModel({
        prompt: 'Fix typo in header comment',
        lane: 'ask',
        policyProfile: 'frugal',
      });
      expect(postThrottle.selectedModel.id).not.toBe(firstWinnerId);

      // Clear cooldown by recording healthy turn
      cloudWatchTelemetry.recordTurn({
        turnId: 'heal-1',
        sessionId: 'sess-1',
        lane: 'ask',
        policyProfile: 'frugal',
        modelId: firstWinnerId,
        modelName: baseline.selectedModel.name,
        provider: baseline.selectedModel.provider,
        ttftMs: 260,
        durationMs: 400,
        inputTokens: 500,
        outputTokens: 120,
        cacheReadTokens: 300,
        cacheWriteTokens: 0,
        estimatedCostUsd: 0.0001,
        failoverCount: 0,
        escalatedTier: false,
        throttled: false,
        succeeded: true,
      });
      cloudWatchTelemetry.reset();
    });

    it('escalates 1 capability tier upward on verification failure and enforces FinOps spend cap', () => {
      const escalated = ModelDecisionEngine.escalateModelForRepair({
        currentModelId: 'anthropic.claude-haiku-4-5-20251001-v1:0', // Tier 1
        remainingBudgetUsd: 0.5,
      });
      expect(escalated.escalated).toBe(true);
      expect(escalated.budgetExceeded).toBe(false);
      expect(escalated.selectedModel.tier).toBeGreaterThan(1);

      const capped = ModelDecisionEngine.escalateModelForRepair({
        currentModelId: 'anthropic.claude-sonnet-5',
        remainingBudgetUsd: 0,
      });
      expect(capped.escalated).toBe(false);
      expect(capped.budgetExceeded).toBe(true);
    });
  });

  describe('3. AWS SQS + DLQ + S3 Claim-Check Task Queue', () => {
    it('offloads >6KB payloads via S3 Claim-Check and hydrates transparently on long-poll', async () => {
      const queue = new SqsTaskQueue<{ runId: string; sessionId: string; prompt: string }>({
        queueUrl: '',
        maxReceiveCount: 2,
      });

      const largePrompt = 'A'.repeat(12_000); // > 6,000 bytes ECS limit!
      const enqueued = await queue.enqueue({
        runId: 'run-large-1',
        sessionId: 'sess-large-1',
        prompt: largePrompt,
      });

      expect(enqueued.usedClaimCheck).toBe(true);
      expect(enqueued.claimCheckKey).toContain('lyra/claim-checks/run-large-1/');

      const dequeued = await queue.pollOnce({ visibilityTimeoutSeconds: 30 });
      expect(dequeued).not.toBeNull();
      expect(dequeued!.usedClaimCheck).toBe(true);
      expect(dequeued!.payload.prompt.length).toBe(12_000);

      await queue.complete(dequeued!.receiptHandle);
      const health = await queue.getQueueHealth();
      expect(health.claimChecksOffloaded).toBe(1);
      expect(health.totalCompleted).toBe(1);
      expect(health.approximateVisible).toBe(0);
    });

    it('redrives poisoned tasks to the Dead-Letter Queue (DLQ) after maxReceiveCount', async () => {
      const queue = new SqsTaskQueue<{ runId: string; sessionId: string; prompt: string }>({
        queueUrl: '',
        maxReceiveCount: 2,
      });

      await queue.enqueue({ runId: 'run-poison', sessionId: 'sess-1', prompt: 'crash' });

      // Attempt 1 fails
      const try1 = await queue.pollOnce({ visibilityTimeoutSeconds: 30 });
      expect(try1?.receiveCount).toBe(1);
      await queue.releaseForRetry(try1!.receiptHandle, 0);

      // Attempt 2 fails
      const try2 = await queue.pollOnce({ visibilityTimeoutSeconds: 30 });
      expect(try2?.receiveCount).toBe(2);
      await queue.releaseForRetry(try2!.receiptHandle, 0);

      // Attempt 3 exceeds maxReceiveCount=2 -> redriven to DLQ!
      const try3 = await queue.pollOnce({ visibilityTimeoutSeconds: 30 });
      expect(try3).toBeNull();

      const health = await queue.getQueueHealth();
      expect(health.approximateDlqVisible).toBe(1);
    });
  });

  describe('4. FastLaneExecutor Patch Verification, Auto-Escalation & CloudWatch EMF', () => {
    it('auto-escalates 1 tier when initial Tier 1 patch fails TypeScript syntax check and produces verified unified diff', async () => {
      let callCount = 0;
      const invokedModels: string[] = [];

      const executor = new FastLaneExecutor({
        invokeHook: async (input) => {
          callCount += 1;
          invokedModels.push(input.modelId);

          if (callCount === 1) {
            // Simulate broken TypeScript syntax from Tier 1 fast model
            return {
              text:
                'Fixing add function.\n' +
                '<lyra_patch file="math.ts">\n' +
                '<search>\nreturn a - b;\n</search>\n' +
                '<replace>\nreturn a + (((;\n</replace>\n' +
                '</lyra_patch>',
              ttftMs: 210,
              inputTokens: 900,
              outputTokens: 90,
              cacheReadTokens: 600,
            };
          }

          // Tier-escalated model produces valid TypeScript fix
          return {
            text:
              'Fixed arithmetic operator in `add` so it returns `a + b`.\n' +
              '<lyra_patch file="math.ts">\n' +
              '<search>\n  return a - b;\n</search>\n' +
              '<replace>\n  return a + b;\n</replace>\n' +
              '</lyra_patch>',
            ttftMs: 420,
            inputTokens: 1100,
            outputTokens: 110,
            cacheReadTokens: 700,
          };
        },
      });

      const store = new UnifiedStore(path.join(tempWorkspace, '.lyra-store'));
      const ahp = new AHPServer(store, { executor });

      const turn = await ahp.executeChatTurn({
        prompt: 'Fix the subtraction bug in math.ts',
        workspacePath: tempWorkspace,
        modePreference: 'fast-patch',
        policyProfile: 'frugal',
        activeFilePath: 'math.ts',
      });

      expect(callCount).toBe(2);
      expect(invokedModels[1]).not.toBe(invokedModels[0]);
      expect(turn.telemetry?.escalatedTier).toBe(true);
      expect(turn.patch?.allVerified).toBe(true);
      expect(turn.patch?.edits.length).toBe(1);
      expect(turn.patch?.edits[0]!.unifiedDiff).toContain('-  return a - b;');
      expect(turn.patch?.edits[0]!.unifiedDiff).toContain('+  return a + b;');

      // Validate CloudWatch EMF payload specification compliance
      const emfRegistry = new CloudWatchEmfRegistry();
      const emfJson = emfRegistry.buildEmfPayload(turn.telemetry!, 2) as any;
      expect(emfJson._aws.CloudWatchMetrics[0].Namespace).toBe('Lyra/AgentHarness');
      expect(emfJson.Lane).toBe('fast-patch');
      expect(emfJson.TierEscalation).toBe(1);
      expect(emfJson.QueueDepth).toBe(2);
    });
  });

  describe('5. Multi-Model Council, 24/7 Hermes Memory & Cross-Device Session Sync', () => {
    it('executes 3-seat parallel Multi-Model Council analysis and persists distilled 24/7 Hermes Repo Memory', async () => {
      fs.writeFileSync(
        path.join(tempWorkspace, 'README.md'),
        '# Architecture\nUses Amazon SQS with S3 Claim-Check offload above 6KB.\n',
        'utf8'
      );

      const council = new ModelCouncilAnalyzer(path.join(tempWorkspace, '.lyra-store'));
      const res = await council.analyze({
        question: 'How should we synchronize cloud architecture sessions and SQS claim-check state across devices?',
        workspacePath: tempWorkspace,
        sessionId: 'session-sync-test',
      });

      expect(res.seats.length).toBe(3);
      expect(res.seats.map((s) => s.seatId)).toEqual([
        'docs-finops-rag',
        'codebase-specialist',
        'invariant-critic',
      ]);
      // Verify all 3 specialist seats were dynamically selected as distinct models via ModelDecisionEngine
      const seatModelIds = res.seats.map((s) => s.modelId);
      expect(new Set(seatModelIds).size).toBe(3);
      for (const seat of res.seats) {
        expect(seat.selectionReason.length).toBeGreaterThan(10);
      }
      expect(res.chairSelectionReason.length).toBeGreaterThan(10);

      // Verify changing policyProfile ('frugal' vs 'frontier') dynamically shifts the selected roster
      const frugalRoster = council.selectCouncilRoster({
        question: 'Design distributed consensus protocol',
        mode: 'architecture-debate',
        policyProfile: 'frugal',
        docFileCount: 2,
        codeFileCount: 4,
      });
      const frontierRoster = council.selectCouncilRoster({
        question: 'Design distributed consensus protocol',
        mode: 'architecture-debate',
        policyProfile: 'frontier',
        docFileCount: 2,
        codeFileCount: 4,
      });
      expect(frontierRoster.chairDecision.selectedModel.tier).toBeGreaterThanOrEqual(
        frugalRoster.chairDecision.selectedModel.tier
      );

      expect(res.consensus.length).toBeGreaterThan(0);
      expect(res.disagreements.length).toBeGreaterThan(0);
      expect(res.formattedMarkdown).toContain('Lyra Multi-Model Council Analysis');
      expect(res.memoryEntry.id).toStartWith('mem-');

      const storedMemories = council.listMemoryEntries(tempWorkspace);
      expect(storedMemories.length).toBe(1);
      expect(storedMemories[0]!.id).toBe(res.memoryEntry.id);
    });

    it('synchronizes sequence-delta chat messages (sinceSeq) across Device A and Device B and exposes OpenAI-compatible models', () => {
      const store = new UnifiedStore(path.join(tempWorkspace, '.lyra-store-sync'));
      const ahp = new AHPServer(store);
      const bridge = new OpenAiCompatBridge(ahp);

      // Verify OpenAI /v1/models exposes lyra-auto, lyra-council, and Bedrock profiles
      const modelList = bridge.listModels();
      expect(modelList.object).toBe('list');
      expect(modelList.data.some((m) => m.id === 'lyra-auto')).toBe(true);
      expect(modelList.data.some((m) => m.id === 'lyra-council')).toBe(true);

      // Device A (macbook-dsh) creates session and appends 2 messages
      ahp.createSession({
        sessionId: 'session-cross-device',
        title: 'Cross-Device Sync Test',
        workspacePath: tempWorkspace,
      });
      ahp.appendMessage('session-cross-device', {
        role: 'user',
        content: 'Start authentication refactor on Laptop A',
        harness: 'dsh-cli',
        deviceId: 'macbook-pro',
      });
      ahp.appendMessage('session-cross-device', {
        role: 'assistant',
        content: 'Completed JWT verification helper on Laptop A.',
        harness: 'dsh-cli',
        deviceId: 'macbook-pro',
      });

      // Device B (desktop-vscode) pulls from sinceSeq = 0
      const firstPull = ahp.syncSessionDelta({
        sessionId: 'session-cross-device',
        sinceSeq: 0,
        workspacePath: tempWorkspace,
      });
      expect(firstPull.latestSeq).toBe(2);
      expect(firstPull.deltaMessages.length).toBe(2);
      expect(firstPull.deltaMessages[0]!.sequence).toBe(1);
      expect(firstPull.deltaMessages[1]!.sequence).toBe(2);

      // Device A adds a 3rd message
      ahp.appendMessage('session-cross-device', {
        role: 'user',
        content: 'Now add unit tests for token expiry',
        harness: 'dsh-cli',
        deviceId: 'macbook-pro',
      });

      // Device B pulls incremental delta sinceSeq = 2 -> receives ONLY seq #3
      const secondPull = ahp.syncSessionDelta({
        sessionId: 'session-cross-device',
        sinceSeq: 2,
        workspacePath: tempWorkspace,
      });
      expect(secondPull.latestSeq).toBe(3);
      expect(secondPull.deltaMessages.length).toBe(1);
      expect(secondPull.deltaMessages[0]!.sequence).toBe(3);
      expect(secondPull.deltaMessages[0]!.content).toContain('unit tests for token expiry');

      // Verify cross-device context prefix hydrates recent turns for stateless Copilot Chat clients
      const prefix = bridge.buildCrossDeviceContextPrefix('session-cross-device', tempWorkspace);
      expect(prefix).toContain('seq #3');
      expect(prefix).toContain('unit tests for token expiry');
    });
  });
});
