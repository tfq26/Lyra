export type AgentType = 'antigravity' | 'claude_code' | 'codex' | 'orchestrator';
export type ExecutionMode = 'safe' | 'sandboxed' | 'unrestricted';

export type UnifiedEventType = 'message' | 'thought' | 'progress' | 'tool_call' | 'diff' | 'diagram' | 'status' | 'run_started' | 'run_completed' | 'run_failed' | 'run_cancelled';

export interface WSMessage {
  type: 
    | 'user_prompt'
    | 'chat_message'
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
    | 'antigravity_update'
    | 'cancel_run'
    | 'clear_session'
    | 'session_updated'
    | 'run_started'
    | 'run_cancelled';
  sessionId?: string;
  agentType?: AgentType;
  payload: any;
  runId?: string;
}
