export type AgentType = 'antigravity' | 'claude_code' | 'codex' | 'opencode' | 'hermes' | 'orchestrator';
export type ExecutionMode = 'safe' | 'sandboxed' | 'unrestricted';

export interface AgentRunOptions {
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  search?: boolean;
  continueSession?: boolean;
}

export interface ModelOption {
  id: string;
  label: string;
}

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  level: 'info' | 'success' | 'warning' | 'error';
  agentType?: AgentType;
  createdAt: string;
  read?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
  output?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  timestamp?: string;
}

export interface FileDiff {
  filename: string;
  originalPath?: string;
  additions: number;
  deletions: number;
  patch?: string;
  content?: string;
}

export interface Artifact {
  id: string;
  title: string;
  type: 'markdown' | 'mermaid' | 'diff' | 'image' | 'code';
  content: string;
  path?: string;
}

export type TeamStage = 'planning' | 'awaiting-approval' | 'executing' | 'reviewing' | 'verifying' | 'completed' | 'failed' | 'needs-attention' | 'cancelled';

export interface UsageMetrics {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
}

export interface HarnessCapabilities {
  name: string;
  label: string;
  installed: boolean;
  authenticated: boolean;
  ready: boolean;
  supportedModes: Array<'solo' | 'team'>;
  supportedOptions: string[];
  version?: string;
  reason?: string;
}

export interface HarnessProfile {
  id: string;
  name: string;
  harness: Exclude<AgentType, 'orchestrator'>;
  enabled: boolean;
  model?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModelProviderProfile {
  id: string;
  name: string;
  provider: 'bedrock' | 'openrouter';
  credentialMode: 'byo' | 'managed';
  region?: string;
  model: string;
  roleArn?: string;
  hasCredential?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ModelCompatibilityResult {
  profileId?: string;
  provider: 'bedrock' | 'openrouter';
  model: string;
  tier: 'full' | 'limited';
  capabilities: Record<string, { passed: boolean; detail?: string }>;
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

export interface TaskAttempt {
  id: string;
  taskId: string;
  harness: AgentType;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  error?: string;
  result?: string;
  usage?: Partial<UsageMetrics>;
}

export interface TaskItem {
  id: string;
  runId?: string;
  title: string;
  description?: string;
  scope?: string;
  assignedAgent: AgentType;
  assignedProfileId?: string;
  assignedModel?: string;
  stage?: 'plan' | 'implement' | 'review' | 'verify';
  status: 'pending' | 'ready' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'cancelled';
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
  runId?: string;
  name: string;
  command?: string;
  status: 'passed' | 'failed' | 'unverified' | 'running' | 'pending';
  exitCode?: number;
  output?: string;
  evidence?: string;
}

export interface TeamConfig {
  lead: AgentType;
  leadProfileId?: string;
  workers: AgentType[];
  worker?: AgentType;
  workerProfileIds?: string[];
  reviewer: AgentType;
  reviewerProfileId?: string;
  plannerProviderProfileId?: string;
  nativeProviderProfileId?: string;
  verifier?: AgentType;
  plannerModel?: string;
  reviewerModel?: string;
  concurrencyLimit?: number;
}

export interface RunnerNode {
  id: string;
  name: string;
  type: 'local' | 'homelab' | 'cloud';
  os: string;
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
  state: 'queued' | 'planning' | 'awaiting-approval' | 'executing' | 'reviewing' | 'verifying' | 'pausing' | 'paused' | 'needs-attention' | 'completed' | 'failed' | 'cancelled';
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

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  agentType: AgentType;
  content: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  artifacts?: Artifact[];
  diffs?: FileDiff[];
  teamRun?: TeamRun;
  timestamp: string;
  status?: 'streaming' | 'done' | 'error';
  runId?: string;
}

export interface Session {
  id: string;
  title: string;
  activeAgent: AgentType;
  messages: Message[];
  workingDirectory: string;
  createdAt: string;
  updatedAt: string;
  executionMode?: ExecutionMode;
  agentOptions?: Partial<Record<AgentType, AgentRunOptions>>;
  draft?: string;
  mode?: 'solo' | 'team';
  teamConfig?: TeamConfig;
}

export interface AgentBridgeTask {
  id: string;
  fromAgent: AgentType;
  toAgent: AgentType;
  taskDescription: string;
  contextPayload: string;
  status: 'draft' | 'dispatched' | 'running' | 'completed';
  result?: string;
}

export interface ActivePreview {
  runId: string;
  port: number;
  url: string;
  worktreePath?: string;
  startedAt: string;
}

export interface WorktreeEntry {
  path: string;
  head: string;
  branch: string;
  isMain: boolean;
  bare?: boolean;
  preview?: {
    url: string;
    port: number;
    startedAt: string;
    runId: string;
  };
}
