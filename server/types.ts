export type AgentType = 'antigravity' | 'claude_code' | 'codex' | 'opencode' | 'strands' | 'orchestrator';
export type ExecutionMode = 'safe' | 'sandboxed' | 'unrestricted';

export type RunState =
  | 'queued'
  | 'planning'
  | 'awaiting-approval'
  | 'executing'
  | 'in_progress'
  | 'reviewing'
  | 'verifying'
  | 'pausing'
  | 'paused'
  | 'needs-attention'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TaskState =
  | 'pending'
  | 'ready'
  | 'running'
  | 'in_progress'
  | 'queued'
  | 'review'
  | 'verifying'
  | 'succeeded'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'cancelled';

export type UnifiedEventType =
  | 'message'
  | 'thought'
  | 'progress'
  | 'tool_call'
  | 'diff'
  | 'diagram'
  | 'status'
  | 'run_started'
  | 'run_completed'
  | 'run_failed'
  | 'run_cancelled'
  | 'error';

export type TeamStage = 'planning' | 'awaiting-approval' | 'executing' | 'in_progress' | 'reviewing' | 'verifying' | 'completed' | 'failed' | 'needs-attention' | 'cancelled';

export interface TeamConfig {
  lead: AgentType;
  leadProfileId?: string;
  worker?: AgentType;
  workers?: AgentType[];
  workerProfileIds?: string[];
  reviewer: AgentType;
  reviewerProfileId?: string;
  plannerProviderProfileId?: string;
  nativeProviderProfileId?: string;
  verifier?: AgentType;
  plannerModel?: string;
  workerModel?: string;
  reviewerModel?: string;
  concurrencyLimit?: number;
}

export type HarnessId = Exclude<AgentType, 'orchestrator'>;
export interface HarnessProfile {
  id: string;
  name: string;
  harness: HarnessId;
  enabled: boolean;
  model?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModelProviderProfile {
  id: string;
  name: string;
  provider: 'bedrock' | 'openrouter' | 'openai-compat';
  credentialMode?: 'byo' | 'managed';
  enabled?: boolean;
  region?: string;
  baseUrl?: string;
  model: string;
  roleArn?: string;
  /** Server-only Secrets Manager reference. Never serialize to the client. */
  secretRef?: string;
  /** @deprecated Read only for legacy profiles; new values belong in Secrets Manager. */
  externalId?: string;
  createdAt: string;
  updatedAt: string;
}

export type ModelCapability = 'streaming' | 'toolCalling' | 'structuredOutput' | 'cancellation' | 'sessionResume';
export interface ModelCompatibilityResult {
  profileId?: string;
  provider: ModelProviderProfile['provider'];
  model: string;
  tier: 'full' | 'limited';
  capabilities: Record<ModelCapability, { passed: boolean; detail?: string }>;
  testedAt: string;
  suiteVersion: string;
  warnings: string[];
  usage?: UsageMetrics;
}

export interface AgentCheckpoint {
  sessionId: string;
  runId: string;
  checkpointId: string;
  kind: 'turn-started' | 'turn-completed' | 'tool-completed' | 'approval-requested' | 'approval-resolved' | 'failed' | 'cancelled';
  sequence: number;
  timestamp: string;
  workspacePath: string;
  state: 'running' | 'paused' | 'completed' | 'needs-attention' | 'failed';
  detail?: string;
}

export interface RunCheckpoint {
  sessionId: string;
  runId: string;
  timestamp: string;
  stage: TeamStage;
  state: RunState;
  completedTaskIds: string[];
  failedTaskIds: string[];
  integrationBranch?: string;
  branchName?: string;
  worktreePath?: string;
  integrationWorktreePath?: string;
  checkStates?: Record<string, string>;
  activeHarnesses?: string[];
  tasksSnapshot: TaskItem[];
}

export interface SwarmMessage {
  id: string;
  runId: string;
  fromAgent: string;
  toAgent: string | 'team';
  taskId?: string;
  kind: 'message' | 'handoff' | 'blocker' | 'artifact' | 'status';
  text: string;
  createdAt: string;
}

export interface FileDiff {
  filename: string;
  originalPath?: string;
  additions: number;
  deletions: number;
  patch?: string;
  content?: string;
}

export interface UsageMetrics {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
}

export interface MaintenanceItem {
  id: string;
  category: 'package_upgrade' | 'deprecation_fix' | 'dead_code_cleanup';
  title: string;
  target: string;
  currentVersion?: string;
  targetVersion?: string;
  documentationUrl?: string;
  documentationExcerpt?: string;
  severity: 'low' | 'medium' | 'high';
  estimatedCostUsd?: number;
}

export interface MaintenanceAuditResult {
  workspacePath: string;
  scannedAt: string;
  items: MaintenanceItem[];
  summary: string;
}

export interface MaintenanceExecutionResult {
  itemId: string;
  category: MaintenanceItem['category'];
  target: string;
  status: 'succeeded' | 'failed' | 'skipped';
  branchName?: string;
  diffSummary?: string;
  testPassed?: boolean;
  documentationCitation?: string;
  prUrl?: string;
  error?: string;
}

export interface MaintenanceReport {
  runId: string;
  startedAt: string;
  completedAt: string;
  mode: 'packages' | 'deprecations' | 'cleanup' | 'all';
  results: MaintenanceExecutionResult[];
  totalAttempted: number;
  totalSucceeded: number;
  costUsd: number;
}

export interface HarnessCapabilities {
  name: string;
  label: string;
  installed: boolean;
  authenticated: boolean;
  ready: boolean;
  supportedModes: Array<'solo' | 'team'>;
  supportedOptions: string[];
}

export interface TaskAttempt {
  id: string;
  taskId: string;
  harness: AgentType;
  startedAt: string;
  endedAt?: string;
  completedAt?: string;
  exitCode?: number;
  error?: string;
  result?: string;
  logs?: string;
  status?: string;
  attemptNumber?: number;
  tokensUsed?: number;
  costUsd?: number;
  usage?: Partial<UsageMetrics>;
}

export interface TaskItem {
  id: string;
  runId: string;
  title: string;
  description?: string;
  scope?: string;
  assignedAgent: AgentType;
  assignedProfileId?: string;
  assignedModel?: string;
  assignedNodeId?: string;
  assignedNodeName?: string;
  stage: 'plan' | 'implement' | 'review' | 'verify';
  status: TaskState;
  dependencies?: string[];
  blockedReason?: string;
  worktreePath?: string;
  branchName?: string;
  expectedOutputs?: string[];
  attempts?: TaskAttempt[];
  result?: string;
}

export interface CheckItem {
  id: string;
  runId: string;
  name: string;
  command: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'unverified';
  exitCode?: number;
  output?: string;
  evidence?: string;
}

export interface RunnerNode {
  id: string;
  name: string;
  type: 'local' | 'homelab' | 'cloud';
  os: string;
  platform?: string;
  arch?: string;
  activeTasks?: number;
  maxConcurrency?: number;
  capabilities?: string[];
  cpus?: number;
  memoryMb?: number;
  status: 'online' | 'busy' | 'offline';
  lastSeen: string;
}

export interface StrategicAppraisal {
  problemSummary?: string;
  reusedAssets?: string[];
  costScaleNotes?: string;
  recommendedApproach?: string;
}

export interface TeamRun {
  id: string;
  sessionId: string;
  objective: string;
  stage: TeamStage;
  state: RunState;
  teamConfig: TeamConfig;
  appraisal?: StrategicAppraisal;
  worktreePath?: string;
  integrationWorktreePath?: string;
  branchName?: string;
  baseBranch?: string;
  integrationBranch?: string;
  conflicts?: string[];
  concurrencyLimit?: number;
  planApprovedAt?: string;
  planModel?: string;
  previewUrl?: string;
  messages?: SwarmMessage[];
  acceptanceCriteria: string[];
  tasks: TaskItem[];
  checks: CheckItem[];
  diffs: FileDiff[];
  repairAttempts: number;
  maxRepairAttempts: number;
  usage?: UsageMetrics;
  createdAt: string;
  updatedAt: string;
  summary?: string;
  error?: string;
}

export interface WSMessage {
  type:
    | 'user_prompt'
    | 'chat_message'
    | 'content_chunk'
    | 'thought_chunk'
    | 'tool_call'
    | 'tool_approval_required'
    | 'diff'
    | 'artifact'
    | 'done'
    | 'error'
    | 'bridge_dispatch'
    | 'sync_sessions'
    | 'session_events_catchup'
    | 'unified_event'
    | 'storage_path_updated'
    | 'antigravity_update'
    | 'cancel_run'
    | 'clear_session'
    | 'session_updated'
    | 'run_started'
    | 'run_cancelled'
    | 'team_run_start'
    | 'team_run_approve'
    | 'team_run_pause'
    | 'team_run_resume'
    | 'native_agent_resume'
    | 'tool_approval_decision'
    | 'runner_event'
    | 'runner_control'
    | 'swarm_message'
    | 'harness_profiles_updated'
    | 'model_provider_profiles_updated'
    | 'team_run_updated'
    | 'task_updated'
    | 'check_updated'
    | 'diffs_updated'
    | 'get_nodes'
    | 'nodes_list'
    | 'select_node'
    | 'node_selected'
    | 'register_node'
    | 'node_heartbeat'
    | 'wake_node'
    | 'node_hibernated'
    | 'node_resumed'
    | 'start_preview'
    | 'stop_preview'
    | 'preview_started'
    | 'preview_stopped'
    | 'team_run_merge'
    | 'team_run_merged'
    | 'run_updated';
  sessionId?: string;
  agentType?: AgentType;
  payload: any;
  runId?: string;
}
