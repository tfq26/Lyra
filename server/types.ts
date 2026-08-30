export type AgentType = 'antigravity' | 'claude_code' | 'codex' | 'orchestrator';

export interface WSMessage {
  type: 
    | 'user_prompt' 
    | 'content_chunk' 
    | 'thought_chunk' 
    | 'tool_call' 
    | 'diff' 
    | 'artifact' 
    | 'done' 
    | 'error' 
    | 'bridge_dispatch'
    | 'sync_sessions'
    | 'unified_event'
    | 'storage_path_updated'
    | 'antigravity_update';
  sessionId?: string;
  agentType?: AgentType;
  payload: any;
}
