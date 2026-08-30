export type AgentType = 'antigravity' | 'claude_code' | 'codex' | 'orchestrator';

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

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  agentType: AgentType;
  content: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  artifacts?: Artifact[];
  diffs?: FileDiff[];
  timestamp: string;
  status?: 'streaming' | 'done' | 'error';
}

export interface Session {
  id: string;
  title: string;
  activeAgent: AgentType;
  messages: Message[];
  workingDirectory: string;
  createdAt: string;
  updatedAt: string;
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
