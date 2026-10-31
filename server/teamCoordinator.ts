import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import type { UnifiedStore } from './unifiedStore';
import type { ProcessManager } from './processManager';
import { WorktreeManager } from './worktreeManager';
import { VerificationRunner } from './verificationRunner';
import { BedrockProvider } from './bedrockProvider';
import { parseSwarmPlan } from './planValidator';
import { ScribeAgent } from './scribeAgent';
import { resolveOptimalModel } from './modelRouter';
import type { NativeAgentRuntime } from './nativeAgentRuntime';
import type { TeamRun, TaskItem, CheckItem, TeamConfig, AgentType, HarnessId, FileDiff, TeamStage, RunState } from './types';

export interface StartTeamRunParams {
  sessionId: string;
  objective: string;
  teamConfig: TeamConfig;
  workspacePath: string;
  runId?: string;
  maxRepairAttempts?: number;
  concurrencyLimit?: number;
  customChecks?: string[];
  autoApprovePlan?: boolean;
}

function parseReviewVerdict(text: string): { approved: boolean; findings: string[] } | null {
  const body = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const parsed = JSON.parse(body) as { approved?: unknown; findings?: unknown };
    if (typeof parsed.approved !== 'boolean' || !Array.isArray(parsed.findings)) return null;
    return { approved: parsed.approved, findings: parsed.findings.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 24) };
  } catch { return null; }
}

export class TeamCoordinator extends EventEmitter {
  private store: UnifiedStore;
  private processManager: ProcessManager;
  private worktreeManager: WorktreeManager;
  private verificationRunner: VerificationRunner;
  private bedrockProvider = new BedrockProvider();
  private scribeAgent = new ScribeAgent();
  private nativeRuntime?: NativeAgentRuntime;
  private activeRuns: Map<string, { sessionId: string; abortController: AbortController; approvePlan?: () => void; pauseRequested?: boolean; resume?: () => void }> = new Map();
  private integrationLocks: Map<string, Promise<any>> = new Map();

  constructor(store: UnifiedStore, processManager: ProcessManager, nativeRuntime?: NativeAgentRuntime) {
    super();
    this.store = store;
    this.processManager = processManager;
    this.nativeRuntime = nativeRuntime;
    this.worktreeManager = new WorktreeManager();
    this.verificationRunner = new VerificationRunner();
  }

  public getActiveRun(runId: string) {
    return this.activeRuns.get(runId);
  }

  public cancelRun(runId: string, sessionId?: string) {
    const active = this.activeRuns.get(runId);
    if (active) {
      active.approvePlan?.();
      active.resume?.();
      active.abortController.abort();
      this.activeRuns.delete(runId);
    }
    this.processManager.cancel(runId);

    if (sessionId) {
      const run = this.store.getRun(sessionId, runId);
      if (run && run.state !== 'completed' && run.state !== 'failed') {
        this.store.updateRun(sessionId, runId, {
          state: 'cancelled',
          stage: 'cancelled',
          summary: 'Team run was cancelled by the user.',
        });
      }
    }
  }

  public approvePlan(sessionId: string, runId: string): boolean {
    const run = this.store.getRun(sessionId, runId);
    const active = this.activeRuns.get(runId);
    if (!run || run.state !== 'awaiting-approval' || !active?.approvePlan) return false;
    this.store.updateRun(sessionId, runId, { planApprovedAt: new Date().toISOString() });
    active.approvePlan();
    active.approvePlan = undefined;
    return true;
  }

  public pauseRun(sessionId: string, runId: string): boolean {
    const run = this.store.getRun(sessionId, runId);
    const active = this.activeRuns.get(runId);
    if (!run || run.state !== 'executing' || !active) return false;
    active.pauseRequested = true;
    this.store.updateRun(sessionId, runId, { state: 'pausing' });
    this.store.addSwarmMessage(sessionId, runId, { fromAgent: 'orchestrator', toAgent: 'team', kind: 'status', text: 'Pause requested. Active tasks will reach their current boundary before Lyra pauses dispatch.' });
    return true;
  }

  public resumeRun(sessionId: string, runId: string): boolean {
    const run = this.store.getRun(sessionId, runId);
    const active = this.activeRuns.get(runId);
    if (!run || run.state !== 'paused' || !active?.resume) return false;
    active.pauseRequested = false;
    this.store.updateRun(sessionId, runId, { state: 'executing', stage: 'executing' });
    active.resume();
    active.resume = undefined;
    return true;
  }

  public async resumeInterruptedRun(sessionId: string, runId: string): Promise<TeamRun> {
    const existingRun = this.store.getRun(sessionId, runId);
    if (!existingRun) throw new Error(`Run ${runId} was not found in session ${sessionId}.`);
    if (existingRun.state === 'completed') throw new Error(`Run ${runId} is already completed.`);
    if (this.activeRuns.has(runId)) throw new Error(`Run ${runId} is already currently executing.`);

    const checkpoint = this.store.getLatestRunCheckpoint(sessionId, runId);
    const session = this.store.getSession(sessionId);
    const repoPath = session?.meta?.workspacePath || existingRun.worktreePath || process.cwd();

    const abortController = new AbortController();
    this.activeRuns.set(runId, { sessionId, abortController });

    this.store.updateRun(sessionId, runId, {
      state: 'executing',
      stage: 'executing',
      updatedAt: new Date().toISOString(),
    });

    this.store.appendEvent(sessionId, {
      agent: 'orchestrator',
      type: 'status',
      runId,
      payload: {
        text: `🔄 Resuming interrupted run ${runId} (Stage: ${checkpoint?.stage || existingRun.stage}, ${checkpoint?.completedTaskIds.length || 0} tasks already completed).`,
      },
    });

    this.executePipeline(existingRun, repoPath, abortController.signal, true).catch((err) => {
      console.error(`[TeamCoordinator] Pipeline error resuming run ${runId}:`, err);
      this.store.updateRun(sessionId, runId, {
        state: 'failed',
        stage: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
      this.activeRuns.delete(runId);
    });

    return this.store.getRun(sessionId, runId)!;
  }

  private saveRunCheckpoint(sessionId: string, runId: string, customStage?: TeamStage, customState?: RunState): void {
    const currentRun = this.store.getRun(sessionId, runId);
    if (!currentRun) return;
    this.store.saveRunCheckpoint(sessionId, runId, {
      sessionId,
      runId,
      timestamp: new Date().toISOString(),
      stage: customStage || currentRun.stage,
      state: customState || currentRun.state,
      completedTaskIds: (currentRun.tasks || []).filter((t) => t.status === 'succeeded').map((t) => t.id),
      failedTaskIds: (currentRun.tasks || []).filter((t) => t.status === 'failed').map((t) => t.id),
      integrationBranch: currentRun.integrationBranch,
      branchName: currentRun.branchName,
      worktreePath: currentRun.worktreePath,
      integrationWorktreePath: currentRun.integrationWorktreePath,
      checkStates: Object.fromEntries((currentRun.checks || []).map((c) => [c.id, c.status])),
      tasksSnapshot: currentRun.tasks || [],
    });
  }

  public async mergeRunToMain(sessionId: string, runId: string, repoPath: string): Promise<{ success: boolean; error?: string }> {
    const run = this.store.getRun(sessionId, runId);
    if (!run) return { success: false, error: 'Run not found' };
    if (!run.integrationBranch) return { success: false, error: 'No integration branch found for this run' };

    const result = await this.worktreeManager.mergeIntegrationBranchToMain(repoPath, run.integrationBranch);
    if (result.success) {
      await this.worktreeManager.cleanupRunWorktree(repoPath, runId, false);
      this.store.updateRun(sessionId, runId, {
        summary: `${run.summary || 'Team run completed.'} Successfully merged into main repository branch.`,
      });
      this.store.appendEvent(sessionId, {
        agent: 'orchestrator',
        type: 'status',
        runId,
        payload: { text: `✅ Changes from Run ${runId} have been merged into the main repository branch.` },
      });
      this.emit('run_updated', this.store.getRun(sessionId, runId));
      return { success: true };
    }

    return { success: false, error: result.error || (result.conflicts ? `Conflicts: ${result.conflicts.join(', ')}` : 'Merge failed') };
  }

  public async startTeamRun(params: StartTeamRunParams): Promise<TeamRun> {
    if ([...this.activeRuns.values()].some((active) => active.sessionId === params.sessionId)) {
      throw new Error('This conversation already has an active run. Wait for it to finish or stop it before starting another.');
    }
    const concurrencyLimit = params.concurrencyLimit ?? params.teamConfig.concurrencyLimit ?? 4;
    if (!Number.isInteger(concurrencyLimit) || Number(concurrencyLimit) < 1 || Number(concurrencyLimit) > 32) {
      throw new Error('Choose a worker concurrency limit between 1 and 32 before starting a swarm.');
    }
    if (!await this.worktreeManager.isGitRepo(params.workspacePath)) {
      throw new Error('Swarm runs require a Git repository so every agent can work in an isolated worktree.');
    }
    const available = this.processManager.getCapabilities();
    const profiles = this.store.listHarnessProfiles();
    const getProfile = (profileId?: string) => profileId ? profiles.find((profile) => profile.id === profileId && profile.enabled) : undefined;
    const leadProfile = getProfile(params.teamConfig.leadProfileId);
    const reviewerProfile = getProfile(params.teamConfig.reviewerProfileId);
    const plannerProviderProfile = params.teamConfig.plannerProviderProfileId
      ? this.store.listModelProviderProfiles().find((profile) => profile.id === params.teamConfig.plannerProviderProfileId)
      : undefined;
    const workerProfiles = (params.teamConfig.workerProfileIds || []).map(getProfile);
    if (params.teamConfig.leadProfileId && !leadProfile) throw new Error('The selected planner profile is missing or disabled.');
    if (params.teamConfig.reviewerProfileId && !reviewerProfile) throw new Error('The selected reviewer profile is missing or disabled.');
    if (workerProfiles.some((profile) => !profile)) throw new Error('A selected worker profile is missing or disabled.');
    if (params.teamConfig.plannerProviderProfileId && !plannerProviderProfile) throw new Error('The selected model provider profile is missing.');
    const selectedHarnesses = [...(!plannerProviderProfile ? [leadProfile?.harness || params.teamConfig.lead] : []), reviewerProfile?.harness || params.teamConfig.reviewer,
      ...(workerProfiles.length ? workerProfiles.map((profile) => profile!.harness) : params.teamConfig.workers || [params.teamConfig.worker || 'codex'])];
    for (const harness of new Set(selectedHarnesses)) {
      if (harness === 'orchestrator' || !available[harness]?.installed) {
        throw new Error(`The selected ${harness} harness is unavailable on this Lyra runtime.`);
      }
    }
    const runId = params.runId || `run-team-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const abortController = new AbortController();
    this.activeRuns.set(runId, { sessionId: params.sessionId, abortController });

    const initialRun: TeamRun = {
      id: runId,
      sessionId: params.sessionId,
      objective: params.objective,
      stage: 'planning',
      state: 'planning',
      teamConfig: params.teamConfig,
      concurrencyLimit,
      acceptanceCriteria: [],
      tasks: [],
      checks: [],
      diffs: [],
      conflicts: [],
      repairAttempts: 0,
      maxRepairAttempts: params.maxRepairAttempts ?? 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.store.createRun(initialRun);
    this.emit('run_updated', initialRun);

    // Run coordinator asynchronously
    this.executePipeline(initialRun, params.workspacePath, abortController.signal, false, params.autoApprovePlan).catch((err) => {
      console.error(`[TeamCoordinator] Pipeline error for run ${runId}:`, err);
      this.store.updateRun(params.sessionId, runId, {
        state: 'failed',
        stage: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
      this.activeRuns.delete(runId);
    });

    return initialRun;
  }

  private async executePipeline(
    run: TeamRun,
    repoPath: string,
    signal: AbortSignal,
    isResume = false,
    autoApprovePlan = false
  ): Promise<void> {
    const { sessionId, id: runId, teamConfig, objective } = run;
    const profiles = this.store.listHarnessProfiles();
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    const leadProfile = teamConfig.leadProfileId ? profileById.get(teamConfig.leadProfileId) : undefined;
    const reviewerProfile = teamConfig.reviewerProfileId ? profileById.get(teamConfig.reviewerProfileId) : undefined;
    const plannerProviderProfile = teamConfig.plannerProviderProfileId
      ? this.store.listModelProviderProfiles().find((profile) => profile.id === teamConfig.plannerProviderProfileId)
      : undefined;
    const leadAgent = plannerProviderProfile ? 'orchestrator' : leadProfile?.harness || teamConfig.lead;
    const reviewerAgent = reviewerProfile?.harness || teamConfig.reviewer;

    try {
      if (signal.aborted) return;

      // 1. Setup Base Run & Integration Worktree
      let executionCwd = run.worktreePath;
      let integrationCwd = run.integrationWorktreePath;
      let baseCommit = run.baseBranch;

      if (!executionCwd || !fs.existsSync(executionCwd)) {
        this.store.appendEvent(sessionId, {
          agent: 'orchestrator',
          type: 'status',
          payload: { text: `Initializing isolated git worktree environment for Team Run ${runId}...` },
          runId,
        });
        const worktreeInfo = await this.worktreeManager.createRunWorktree(repoPath, runId);
        executionCwd = worktreeInfo.worktreePath;
        baseCommit = worktreeInfo.baseCommit;
        this.store.updateRun(sessionId, runId, {
          worktreePath: worktreeInfo.worktreePath,
          branchName: worktreeInfo.branchName,
          baseBranch: worktreeInfo.baseCommit,
        });
      }

      if (!integrationCwd || !fs.existsSync(integrationCwd)) {
        const integrationInfo = await this.worktreeManager.createIntegrationBranch(repoPath, runId);
        integrationCwd = integrationInfo.worktreePath;
        this.store.updateRun(sessionId, runId, {
          integrationWorktreePath: integrationInfo.worktreePath,
          integrationBranch: integrationInfo.branchName,
        });
      }

      const workerProfiles = (teamConfig.workerProfileIds || []).map((profileId) => profileById.get(profileId)).filter((profile) => profile?.enabled);
      const workerSlots = workerProfiles.length
        ? workerProfiles.map((profile) => ({ harness: profile!.harness, profileId: profile!.id, model: profile!.model }))
        : (teamConfig.workers?.length ? teamConfig.workers : [teamConfig.worker || 'codex']).map((harness) => ({ harness: harness as HarnessId, profileId: undefined, model: undefined }));
      const workerAgents = workerSlots.map((slot) => slot.harness);

      let criteria = run.acceptanceCriteria || [];
      let tasks = run.tasks || [];

      // 2. Stage 1: Planning (Lead) - Only if not resuming an already planned run
      if (!isResume || tasks.length === 0) {
        if (signal.aborted) return;
        this.setRunStage(sessionId, runId, 'planning', 'planning');
        this.store.appendEvent(sessionId, {
          agent: leadAgent,
          type: 'status',
          payload: { text: `[Lead: ${teamConfig.lead}] Analyzing objective and building execution plan with dependency structure...` },
          runId,
        });

      const planPrompt = `You are Lyra's Lead Architect. Inspect the repository in read-only mode and return JSON only.
Objective: ${objective}
Available worker harnesses: ${workerSlots.map((slot) => `${slot.harness}${slot.profileId ? ` (profile ${slot.profileId})` : ''}`).join(', ')}

Return JSON with this structure:
{
  "appraisal": {
    "problemSummary": "Root problem assessment avoiding XY traps",
    "reusedAssets": ["Existing repo modules or libraries reused"],
    "costScaleNotes": "Expected scale, performance, and operational cost notes",
    "recommendedApproach": "Why this architecture was selected"
  },
  "acceptanceCriteria": ["Verifiable requirement"],
  "tasks": [
    {
      "title": "Task title",
      "description": "Implementation details including in-code TSDoc/invariants",
      "scope": "Target file boundaries",
      "recommendedHarness": "${workerSlots[0]?.harness || 'codex'}",
      "dependsOn": [],
      "expectedOutputs": ["Deliverable file or export"]
    }
  ],
  "checks": [
    {"name": "Check name", "command": "safe test/lint/build command"}
  ]
}
Split independent work into 1-24 tasks. Include concrete file scope and safe checks.`;

      let planContent: string;
      if (plannerProviderProfile) {
        const result = await this.bedrockProvider.generate(plannerProviderProfile, planPrompt, {
          sessionId, runId, workspacePath: executionCwd, storagePath: this.store.getStoragePath(),
        });
        planContent = result.text;
        this.store.updateRun(sessionId, runId, {
          planModel: plannerProviderProfile.model,
          ...(result.usage ? { usage: result.usage } : {}),
        });
      } else {
        const planResult = await this.processManager.runAgent({
          agentType: leadAgent,
          model: leadProfile?.model || teamConfig.plannerModel || resolveOptimalModel({ prompt: objective, role: 'planner' }).modelId,
          prompt: planPrompt,
          cwd: executionCwd,
          sessionId,
          runId,
          processId: `${runId}:planner`,
          executionMode: 'safe',
        });
        if (planResult.code !== 0 || planResult.cancelled) throw new Error(planResult.error || `Lead harness failed with exit code ${planResult.code}`);
        planContent = planResult.fullContent || '';
      }


      const validatedPlan = parseSwarmPlan(planContent, runId, workerSlots);
      criteria = validatedPlan.acceptanceCriteria;
      tasks = validatedPlan.tasks;

      this.store.updateRun(sessionId, runId, {
        appraisal: validatedPlan.appraisal,
        acceptanceCriteria: criteria,
        tasks,
        checks: validatedPlan.checks,
      });

      if (autoApprovePlan) {
        this.store.appendEvent(sessionId, {
          agent: 'orchestrator',
          type: 'status',
          runId,
          payload: { text: '⚡ Autonomous harness plan auto-approval enabled. Proceeding immediately to parallel worker execution.' },
        });
      } else {
        this.setRunStage(sessionId, runId, 'awaiting-approval', 'awaiting-approval');
        this.saveRunCheckpoint(sessionId, runId, 'awaiting-approval', 'awaiting-approval');
        this.store.appendEvent(sessionId, {
          agent: 'orchestrator', type: 'status', runId,
          payload: { text: 'Plan ready for approval. No implementation workers have started.' },
        });
        this.store.addSwarmMessage(sessionId, runId, {
          fromAgent: plannerProviderProfile ? `Bedrock:${plannerProviderProfile.model}` : `planner:${leadAgent}`, toAgent: 'team', kind: 'status',
          text: `Proposed ${tasks.length} task(s) and ${criteria.length} acceptance criterion(ia). Review the plan and approve it to start workers.`,
        });
        await new Promise<void>((resolve) => {
          const active = this.activeRuns.get(runId);
          if (!active || signal.aborted) return resolve();
          active.approvePlan = resolve;
        });
        if (signal.aborted) return;
      }
    }

      // 3. Stage 2: Parallel Dependency Execution (Workers)
      if (signal.aborted) return;
      this.setRunStage(sessionId, runId, 'executing', 'executing');

      const maxConcurrent = run.concurrencyLimit!;
      const workerAgent = teamConfig.worker || workerAgents[0] || 'codex';

      while (!signal.aborted) {
        const activeRun = this.activeRuns.get(runId);
        if (activeRun?.pauseRequested) {
          this.setRunStage(sessionId, runId, 'executing', 'paused');
          await new Promise<void>((resolve) => {
            if (signal.aborted || !activeRun.pauseRequested) return resolve();
            activeRun.resume = resolve;
          });
          if (signal.aborted) return;
          this.setRunStage(sessionId, runId, 'executing', 'executing');
        }
        const currentRunState = this.store.getRun(sessionId, runId);
        if (!currentRunState) break;

        const allTasks = currentRunState.tasks;
        const allCompleted = allTasks.every((t) => t.status === 'succeeded' || t.status === 'failed' || t.status === 'blocked');
        if (allCompleted) break;

        // Evaluate dependency states
        for (const task of allTasks) {
          if (task.status === 'pending' && task.dependencies && task.dependencies.length > 0) {
            const deps = allTasks.filter((t) => task.dependencies!.includes(t.id));
            const anyFailed = deps.some((d) => d.status === 'failed' || d.status === 'blocked');
            const allPassed = deps.every((d) => d.status === 'succeeded');

            if (anyFailed) {
              this.store.updateRunTask(sessionId, runId, task.id, {
                status: 'blocked',
                blockedReason: 'Prerequisite dependency task failed.',
              });
            } else if (allPassed) {
              this.store.updateRunTask(sessionId, runId, task.id, { status: 'ready' });
            }
          }
        }

        // Get currently running and ready tasks
        const updatedTasks = this.store.getRun(sessionId, runId)?.tasks || [];
        const runningTasks = updatedTasks.filter((t) => t.status === 'running');
        const readyTasks = updatedTasks.filter((t) => t.status === 'ready');

        if (runningTasks.length === 0 && readyTasks.length === 0) {
          // No more ready or running tasks
          break;
        }

        const availableSlots = Math.max(0, maxConcurrent - runningTasks.length);
        const tasksToStart = readyTasks.slice(0, availableSlots);

        if (tasksToStart.length === 0 && runningTasks.length > 0) {
          // Wait for running tasks to make progress
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }

        // Launch ready tasks in parallel
        await Promise.all(
          tasksToStart.map(async (task) => {
            if (signal.aborted) return;
            this.store.updateRunTask(sessionId, runId, task.id, { status: 'running' });

            this.store.appendEvent(sessionId, {
              agent: task.assignedAgent,
              type: 'status',
              payload: { text: `[Worker: ${task.assignedAgent}] Starting task in task worktree: ${task.title}` },
              runId,
            });
            // Create isolated task worktree branching from current integration branch
            const currentRun = this.store.getRun(sessionId, runId);
            const baseRef = currentRun?.integrationBranch || run.integrationBranch || 'HEAD';
            const taskWorktree = await this.worktreeManager.createTaskWorktree(repoPath, runId, task.id, baseRef);
            const taskCwd = taskWorktree.worktreePath;

            this.store.updateRunTask(sessionId, runId, task.id, {
              worktreePath: taskCwd,
              branchName: taskWorktree.branchName,
            });
            this.store.addSwarmMessage(sessionId, runId, {
              fromAgent: `worker:${task.assignedAgent}`, toAgent: 'team', taskId: task.id, kind: 'status',
              text: `Started “${task.title}” in isolated worktree ${taskWorktree.branchName || taskCwd}.`,
            });

            const attemptId = `attempt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const attemptStart = new Date().toISOString();
            const completedPredecessors = (this.store.getRun(sessionId, runId)?.tasks || [])
              .filter((t) => task.dependencies?.includes(t.id) && t.status === 'succeeded')
              .map((t) => `• ${t.title}: outputs [${(t.expectedOutputs || []).join(', ')}]`)
              .join('\n');

            const sharedHandoffs = (this.store.getRun(sessionId, runId)?.messages || [])
              .filter((message) => ['handoff', 'blocker'].includes(message.kind))
              .slice(-4)
              .map((message) => `• [${message.kind}]: ${message.text}`)
              .join('\n')
              .slice(-600);

            const workspaceSnapshot = this.getWorkspaceSnapshot(taskCwd);
            const workerPrompt = `You are an implementation agent in the Lyra swarm.
Objective: ${objective}
Your Assigned Task: ${task.title}
Description: ${task.description || task.title}
Scope: ${task.scope || 'Stay focused on your assigned task; do not edit files outside its scope.'}
Acceptance Criteria:
${criteria.map((c) => `- ${c}`).join('\n')}
${completedPredecessors ? `\nPredecessor Tasks Completed:\n${completedPredecessors}\n` : ''}
${sharedHandoffs ? `\nTeam Handoffs:\n${sharedHandoffs}\n` : ''}

Existing Workspace Structure & Files:
${workspaceSnapshot}

Standards:
1. Write clean, modular code with TSDoc/JSDoc on all exports.
2. Add inline comments explaining non-obvious invariants and edge cases.
3. Work only within your assigned scope. Other agents work in separate worktrees.
4. Do not waste turns re-listing files that are already listed above; start implementing directly.
At completion, report changes, decisions, blockers, and any handoff in a concise summary. If another agent needs information, include a line in this exact form: [LYRA MESSAGE to=team]message text[/LYRA MESSAGE].`;

            let workerResult: { code: number; fullContent?: string; error?: string; cancelled?: boolean };
            const isNative = task.assignedAgent === 'orchestrator' || !this.processManager.getCapabilities()[task.assignedAgent]?.installed;
            if (isNative && this.nativeRuntime) {
              const res = await this.nativeRuntime.runTask({
                sessionId,
                runId,
                taskId: task.id,
                prompt: workerPrompt,
                workspacePath: taskCwd,
                providerProfileId: task.assignedProfileId,
                signal,
              });
              workerResult = { code: res.code, fullContent: res.fullContent, error: res.error, cancelled: res.cancelled };
            } else {
              workerResult = await this.processManager.runAgent({
                agentType: task.assignedAgent,
                model: task.assignedModel,
                prompt: workerPrompt,
                cwd: taskCwd,
                sessionId,
                runId,
                processId: attemptId,
                executionMode: 'sandboxed',
              });
            }

            const attemptEnd = new Date().toISOString();
            const success = workerResult.code === 0 && !workerResult.cancelled && !workerResult.error;

            const attempt = {
              id: attemptId,
              taskId: task.id,
              harness: task.assignedAgent,
              startedAt: attemptStart,
              endedAt: attemptEnd,
              exitCode: workerResult.code,
              error: workerResult.error,
              result: workerResult.fullContent,
            };

            const updatedAttempts = [...(task.attempts || []), attempt];
            this.store.updateRunTask(sessionId, runId, task.id, {
              status: success ? 'succeeded' : 'failed',
              attempts: updatedAttempts,
              result: workerResult.fullContent,
            });
            this.store.addSwarmMessage(sessionId, runId, {
              fromAgent: `worker:${task.assignedAgent}`, toAgent: 'team', taskId: task.id,
              kind: success ? 'handoff' : 'blocker',
              text: success ? `Finished “${task.title}” with exit code ${workerResult.code}. ${(workerResult.fullContent || '').slice(-1200)}` : `Task “${task.title}” failed: ${workerResult.error || `exit ${workerResult.code}`}`,
            });

            for (const match of (workerResult.fullContent || '').matchAll(/\[LYRA MESSAGE to=team\]([\s\S]*?)\[\/LYRA MESSAGE\]/g)) {
              this.store.addSwarmMessage(sessionId, runId, {
                fromAgent: task.assignedAgent, toAgent: 'team', taskId: task.id,
                kind: 'message', text: (match[1] || '').trim(),
              });
            }


            if (success) {
              await this.worktreeManager.commitWorktreeChanges(taskCwd, `Lyra: Completed ${task.title}`);

              // Serialized integration into integration branch
              const prevLock = this.integrationLocks.get(runId) || Promise.resolve();
              let releaseLock: () => void = () => {};
              const nextLock = new Promise<void>((resolve) => { releaseLock = resolve; });
              this.integrationLocks.set(runId, nextLock);
              await prevLock;

              try {
                const mergeRes = await this.worktreeManager.mergeTaskBranch(
                  repoPath,
                  integrationCwd,
                  taskWorktree.branchName
                );

                if (!mergeRes.success) {
                  console.warn(`[TeamCoordinator] Merge conflict integrating task "${task.title}":`, mergeRes.conflicts, mergeRes.error);
                  this.store.updateRun(sessionId, runId, {
                    conflicts: mergeRes.conflicts,
                    state: 'needs-attention',
                    summary: `Merge conflict integrating task "${task.title}". Conflicting files: ${mergeRes.conflicts.join(', ')}`,
                  });
                  this.store.appendEvent(sessionId, {
                    agent: 'orchestrator',
                    type: 'status',
                    payload: { text: `⚠️ Merge conflict integrating task "${task.title}": ${mergeRes.conflicts.join(', ')}` },
                    runId,
                  });
                }
              } finally {
                releaseLock();
              }
            }
          })
        );
        this.saveRunCheckpoint(sessionId, runId);
      }

      // Check if any critical tasks failed or conflicts remain
      const finalTasks = this.store.getRun(sessionId, runId)?.tasks || [];
      const hasFailedTasks = finalTasks.some((t) => t.status === 'failed' || t.status === 'blocked');
      const conflicts = this.store.getRun(sessionId, runId)?.conflicts || [];

      if (conflicts.length > 0) {
        this.setRunStage(sessionId, runId, 'needs-attention', 'needs-attention');
        return;
      }

      if (hasFailedTasks) {
        throw new Error('One or more implementation tasks failed or were blocked.');
      }

      // 4. Stage 3: Review (Reviewer) on Integrated Revision
      if (signal.aborted) return;
      this.setRunStage(sessionId, runId, 'reviewing', 'reviewing');
      this.saveRunCheckpoint(sessionId, runId, 'reviewing', 'reviewing');
      this.store.appendEvent(sessionId, {
        agent: reviewerAgent,
        type: 'status',
        payload: { text: `[Reviewer: ${teamConfig.reviewer}] Reviewing integrated changes and diffs...` },
        runId,
      });

      let integratedDiff = await this.worktreeManager.getWorktreeDiff(repoPath, integrationCwd, baseCommit);
      this.store.updateRun(sessionId, runId, { diffs: integratedDiff.filesChanged });
      this.emit('diffs_updated', { sessionId, runId, diffs: integratedDiff.filesChanged });
      const maxRepairs = run.maxRepairAttempts ?? 2;
      let repairCount = this.store.getRun(sessionId, runId)?.repairAttempts || 0;
      let reviewApproved = false;
      let reviewRound = 0;
      while (!reviewApproved && !signal.aborted) {
        const reviewPrompt = `You are the independent code reviewer. Return JSON only: {"approved": boolean, "findings": ["specific actionable issue"]}. Set approved=true only if every acceptance criterion is met and findings is empty. Do not claim checks passed unless the supplied evidence shows that.
Objective: ${objective}
Acceptance Criteria:
${criteria.map((c) => `- ${c}`).join('\n')}
Integrated diff:
\`\`\`diff
${integratedDiff.diff.slice(0, 12000)}
\`\`\``;
        const reviewResult = await this.processManager.runAgent({
          agentType: reviewerAgent,
          model: reviewerProfile?.model || teamConfig.reviewerModel || resolveOptimalModel({ prompt: objective, role: 'reviewer' }).modelId,
          prompt: reviewPrompt,
          cwd: integrationCwd,
          sessionId,
          runId,
          processId: `${runId}:reviewer:${reviewRound}`,
          executionMode: 'safe',
        });
        if (reviewResult.code !== 0 || reviewResult.error || reviewResult.cancelled) throw new Error(reviewResult.error || `Reviewer harness failed with exit code ${reviewResult.code}`);
        const verdict = parseReviewVerdict(reviewResult.fullContent);
        if (!verdict) {
          this.store.addCheckToRun(sessionId, runId, { id: `review-${runId}`, runId, name: 'Independent code review', command: '', status: 'unverified', evidence: 'Reviewer output did not match the required structured verdict.' });
          this.setRunStage(sessionId, runId, 'needs-attention', 'needs-attention');
          this.store.updateRun(sessionId, runId, { summary: 'The independent reviewer did not return a verifiable approval. Review the transcript and resolve it manually.' });
          return;
        }
        if (verdict.approved && verdict.findings.length === 0) {
          reviewApproved = true;
          this.store.addCheckToRun(sessionId, runId, { id: `review-${runId}`, runId, name: 'Independent code review', command: 'Reviewer verdict', status: 'passed', exitCode: 0, evidence: 'Reviewer approved all acceptance criteria.' });
          break;
        }
        if (repairCount >= maxRepairs) {
          this.store.addCheckToRun(sessionId, runId, { id: `review-${runId}`, runId, name: 'Independent code review', command: 'Reviewer verdict', status: 'failed', exitCode: 1, evidence: verdict.findings.join('\n') || 'Reviewer did not approve the integrated changes.' });
          this.setRunStage(sessionId, runId, 'needs-attention', 'needs-attention');
          this.store.updateRun(sessionId, runId, { summary: `Independent review found unresolved issues after ${repairCount} repair attempt(s).` });
          return;
        }
        repairCount += 1;
        this.store.updateRun(sessionId, runId, { repairAttempts: repairCount });
        const repairPrompt = `Fix these independent review findings on the integrated revision. Keep changes within the listed issues, then summarize what changed.\n${verdict.findings.map((finding) => `- ${finding}`).join('\n')}`;
        const repairResult = await this.processManager.runAgent({
          agentType: workerAgent, model: teamConfig.plannerModel, prompt: repairPrompt,
          cwd: integrationCwd, sessionId, runId, processId: `${runId}:review-repair:${repairCount}`,
          executionMode: 'sandboxed',
        });
        if (repairResult.code !== 0 || repairResult.error || repairResult.cancelled) throw new Error(repairResult.error || `Review repair failed with exit code ${repairResult.code}`);
        await this.worktreeManager.commitWorktreeChanges(integrationCwd, `Lyra: Review repair ${repairCount}`);
        integratedDiff = await this.worktreeManager.getWorktreeDiff(repoPath, integrationCwd, baseCommit);
        this.store.updateRun(sessionId, runId, { diffs: integratedDiff.filesChanged });
        this.emit('diffs_updated', { sessionId, runId, diffs: integratedDiff.filesChanged });
        reviewRound += 1;
      }
      if (signal.aborted) return;


      // 5. Stage 4: Verification Checks on Integrated Revision
      if (signal.aborted) return;
      this.setRunStage(sessionId, runId, 'verifying', 'verifying');
      this.saveRunCheckpoint(sessionId, runId, 'verifying', 'verifying');
      this.store.appendEvent(sessionId, {
        agent: 'orchestrator',
        type: 'status',
        payload: { text: 'Running automated verification checks on integrated revision...' },
        runId,
      });

      const automaticChecks = this.verificationRunner.discoverProjectChecks(integrationCwd, integratedDiff?.filesChanged || []);
      const plannedChecks = (this.store.getRun(sessionId, runId)?.checks || []).filter((check) => check.name !== 'Independent code review');
      const discoveredChecks = [...plannedChecks, ...automaticChecks.filter((automatic) => !plannedChecks.some((planned) => planned.command === automatic.command))];
      if (discoveredChecks.length === 0) discoveredChecks.push({ id: `check-unverified-${runId}`, runId, name: 'Automated verification', command: '', status: 'unverified', evidence: 'No automated checks were proposed or discovered in the project.' });
      for (const check of discoveredChecks) {
        check.runId = runId;
        this.store.addCheckToRun(sessionId, runId, check);
      }

      let checkResults = await this.verificationRunner.runAllChecks(
        discoveredChecks,
        integrationCwd,
        (updatedCheck) => {
          this.store.updateRunCheck(sessionId, runId, updatedCheck.id, updatedCheck);
        }
      );

      // Bounded repair loop if checks fail
      let currentRun = this.store.getRun(sessionId, runId);
      repairCount = currentRun?.repairAttempts || repairCount;

      while (!checkResults.allPassed && repairCount < maxRepairs && !signal.aborted) {
        repairCount++;
        this.store.updateRun(sessionId, runId, { repairAttempts: repairCount });

        const failedChecks = checkResults.results.filter((c) => c.status !== 'passed');
        const failureEvidence = failedChecks.map((c) => `Check: ${c.name}\nCommand: ${c.command}\nOutput:\n${c.output || ''}`).join('\n---\n');

        this.store.appendEvent(sessionId, {
          agent: workerAgent,
          type: 'status',
          payload: { text: `[Repair Loop ${repairCount}/${maxRepairs}] Fixing failing checks on integrated revision...` },
          runId,
        });

        const repairPrompt = `The verification checks failed on the integrated revision.
Failing Checks:
${failureEvidence}

Please investigate and fix the code in this workspace so all checks pass.`;

        const isNativeRepair = workerAgent === 'orchestrator' || !this.processManager.getCapabilities()[workerAgent]?.installed;
        if (isNativeRepair && this.nativeRuntime) {
          await this.nativeRuntime.runTask({
            sessionId,
            runId,
            taskId: `repair-${repairCount}`,
            prompt: repairPrompt,
            workspacePath: integrationCwd,
            signal,
          });
        } else {
          await this.processManager.runAgent({
            agentType: workerAgent,
            prompt: repairPrompt,
            cwd: integrationCwd,
            sessionId,
            runId,
            processId: `${runId}:repair:${repairCount}`,
            executionMode: 'sandboxed',
          });
        }


        await this.worktreeManager.commitWorktreeChanges(integrationCwd, `Lyra: Integrated repair attempt ${repairCount}`);

        checkResults = await this.verificationRunner.runAllChecks(
          discoveredChecks,
          integrationCwd,
          (updatedCheck) => {
            this.store.updateRunCheck(sessionId, runId, updatedCheck.id, updatedCheck);
          }
        );
      }

      // Update final diffs
      const finalIntegratedDiff = await this.worktreeManager.getWorktreeDiff(repoPath, integrationCwd, baseCommit);
      this.store.updateRun(sessionId, runId, { diffs: finalIntegratedDiff.filesChanged });
      this.emit('diffs_updated', { sessionId, runId, diffs: finalIntegratedDiff.filesChanged });

      // Final Terminal State
      if (checkResults.allPassed) {
        // Run Scribe Documentarian to update docs/architecture.md and AGENTS.md
        try {
          const scribeResult = await this.scribeAgent.generateDocumentation({
            workspacePath: integrationCwd,
            objective,
            diffs: finalIntegratedDiff.filesChanged,
            tasks: (this.store.getRun(sessionId, runId)?.tasks || []).map((t) => ({ title: t.title, scope: t.scope })),
            criteria,
          });
          await this.worktreeManager.commitWorktreeChanges(integrationCwd, 'docs: update architecture blueprint and machine map via Scribe');
          this.store.addCheckToRun(sessionId, runId, {
            id: `scribe-${runId}`,
            runId,
            name: 'Living Architecture & Agent Map (Scribe)',
            command: 'docs/architecture.md & AGENTS.md',
            status: 'passed',
            exitCode: 0,
            evidence: scribeResult.summary,
          });
        } catch (scribeErr) {
          console.warn(`[TeamCoordinator] Scribe documentation generation failed for ${runId}:`, scribeErr);
        }

        this.setRunStage(sessionId, runId, 'completed', 'completed');
        this.saveRunCheckpoint(sessionId, runId, 'completed', 'completed');
        this.store.updateRun(sessionId, runId, {
          summary: `Successfully planned, implemented in parallel, reviewed, and verified all checks across ${leadAgent}, ${workerAgents.join(', ')}, and ${reviewerAgent}.${this.store.getRun(sessionId, runId)?.usage?.totalTokens ? ` Planner reported ${this.store.getRun(sessionId, runId)?.usage?.totalTokens} tokens; worker usage was unavailable.` : ' Provider usage was unavailable.'}`,
        });
        this.store.appendEvent(sessionId, {
          agent: 'orchestrator',
          type: 'status',
          payload: { text: `🎉 Team Run ${runId} completed successfully on integrated revision with all checks passing!` },
          runId,
        });
      } else {
        this.setRunStage(sessionId, runId, 'needs-attention', 'needs-attention');
        this.store.updateRun(sessionId, runId, {
          summary: `Team run completed implementation and review, but ${checkResults.results.filter(c => c.status !== 'passed').length} check(s) failed after ${repairCount} repair attempt(s).`,
        });
        this.store.appendEvent(sessionId, {
          agent: 'orchestrator',
          type: 'status',
          payload: { text: `⚠️ Team Run ${runId} requires attention: Verification checks failed.` },
          runId,
        });
      }
    } finally {
      this.activeRuns.delete(runId);
    }
  }

  private setRunStage(sessionId: string, runId: string, stage: TeamStage, state: RunState) {
    const updated = this.store.updateRun(sessionId, runId, { stage, state });
    if (updated) {
      this.emit('run_updated', updated);
    }
  }

  private getWorkspaceSnapshot(dir: string, maxFiles = 35): string {
    try {
      const entries: string[] = [];
      const scan = (current: string, prefix = '') => {
        if (entries.length >= maxFiles) return;
        if (!fs.existsSync(current)) return;
        const items = fs.readdirSync(current, { withFileTypes: true });
        for (const item of items) {
          if (entries.length >= maxFiles) return;
          if (item.name === '.git' || item.name === 'node_modules' || item.name === '.lyra' || item.name === 'dist') continue;
          const rel = prefix ? path.join(prefix, item.name) : item.name;
          entries.push(item.isDirectory() ? `${rel}/` : rel);
          if (item.isDirectory() && prefix.split(path.sep).length < 3) {
            scan(path.join(current, item.name), rel);
          }
        }
      };
      scan(dir);
      return entries.slice(0, maxFiles).map((e) => `• ${e}`).join('\n') || '• (empty repository)';
    } catch {
      return '• (unable to inspect files)';
    }
  }
}
