import React, { useState, useEffect, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { MultiAgentBridge } from './components/MultiAgentBridge';
import { StorageConfigModal } from './components/StorageConfigModal';
import type { Session, Message, AgentType, AgentBridgeTask, ToolCall, FileDiff } from './types';

export function App() {
  const [sessions, setSessions] = useState<Session[]>([
    {
      id: 'session-main',
      title: 'Unified Multi-CLI Session',
      activeAgent: 'antigravity',
      workingDirectory: '/Users/taufeeqali/projects/Lyra',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [
        {
          id: 'msg-init',
          role: 'assistant',
          agentType: 'antigravity',
          content: `### Lyra Unified Workspace Ready

All CLI chats from **Antigravity**, **Claude Code**, and **Codex** are mapped into a single storage folder.

- **Storage Location**: Configurable via the sidebar (defaults to \`~/.lyra/chats\`).
- **Live Normalization**: Terminal runs stream automatically into this UI.
- **Visuals**: Architecture diagrams, diffs, and tool steps render as interactive components.`,
          timestamp: new Date().toISOString(),
          thinking: 'Initialized unified storage bus. Ready to ingest and orchestrate all AI coding CLIs.',
        },
      ],
    },
  ]);

  const [activeSessionId, setActiveSessionId] = useState<string>('session-main');
  const [activeTab, setActiveTab] = useState<'chat' | 'bridge' | 'artifacts'>('chat');
  const [activeAgent, setActiveAgent] = useState<AgentType>('antigravity');
  const [isStreaming, setIsStreaming] = useState(false);
  const [bridgeTasks, setBridgeTasks] = useState<AgentBridgeTask[]>([]);
  const [storagePath, setStoragePath] = useState<string>('~/.lyra/chats');
  const [isStorageModalOpen, setIsStorageModalOpen] = useState(false);

  const [agentStatuses, setAgentStatuses] = useState<Record<AgentType, 'ready' | 'running' | 'idle' | 'offline'>>({
    antigravity: 'ready',
    claude_code: 'ready',
    codex: 'ready',
    orchestrator: 'ready',
  });

  const wsRef = useRef<WebSocket | null>(null);

  // Fetch initial sessions & storage config from API
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const [configRes, sessionsRes] = await Promise.all([
          fetch('/api/storage/config'),
          fetch('/api/sessions'),
        ]);

        if (configRes.ok) {
          const configData = await configRes.json();
          if (configData.storagePath) {
            setStoragePath(configData.storagePath);
          }
        }

        if (sessionsRes.ok) {
          const sessionsData = await sessionsRes.json();
          if (Array.isArray(sessionsData) && sessionsData.length > 0) {
            setSessions((prev) => {
              const merged = [...prev];
              for (const s of sessionsData) {
                if (!merged.find((m) => m.id === s.id)) {
                  merged.push({
                    id: s.id,
                    title: s.title || s.id,
                    activeAgent: s.activeAgents?.[0] || 'antigravity',
                    workingDirectory: s.workspacePath || '/Users/taufeeqali/projects/Lyra',
                    createdAt: s.createdAt,
                    updatedAt: s.updatedAt,
                    messages: [],
                  });
                }
              }
              return merged;
            });
          }
        }
      } catch (err) {
        // Hub might still be starting
      }
    };

    fetchInitialData();
  }, []);

  // Setup WebSocket connection to Lyra Hub
  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: NodeJS.Timeout;

    const connect = () => {
      ws = new WebSocket('ws://localhost:3001');
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[Lyra UI] Connected to hub server');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleServerEvent(data);
        } catch (e) {
          console.error('Failed to parse server message', e);
        }
      };

      ws.onclose = () => {
        reconnectTimer = setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      if (ws) ws.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [activeSessionId]);

  const currentSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];

  const handleServerEvent = (msg: any) => {
    if (msg.type === 'storage_path_updated') {
      if (msg.payload?.storagePath) {
        setStoragePath(msg.payload.storagePath);
      }
    } else if (msg.type === 'unified_event') {
      const { sessionId, agent, type, payload, timestamp, eventId } = msg.payload;

      setSessions((prev) => {
        const sessionIndex = prev.findIndex((s) => s.id === sessionId);
        let targetSession = sessionIndex >= 0 ? prev[sessionIndex] : null;

        if (!targetSession) {
          targetSession = {
            id: sessionId,
            title: sessionId,
            activeAgent: agent === 'user' ? 'antigravity' : (agent as AgentType),
            workingDirectory: '/Users/taufeeqali/projects/Lyra',
            createdAt: timestamp,
            updatedAt: timestamp,
            messages: [],
          };
        }

        if (type === 'message') {
          const isUser = agent === 'user';
          const newMsg: Message = {
            id: eventId,
            role: isUser ? 'user' : 'assistant',
            agentType: isUser ? activeAgent : (agent as AgentType),
            content: payload.text || '',
            timestamp,
          };

          // Avoid duplicating identical recent messages
          const lastMsg = targetSession.messages[targetSession.messages.length - 1];
          if (lastMsg && lastMsg.content === newMsg.content && lastMsg.role === newMsg.role) {
            return prev;
          }

          const updatedMessages = [...targetSession.messages, newMsg];
          const updatedSession = { ...targetSession, messages: updatedMessages, updatedAt: timestamp };

          if (sessionIndex >= 0) {
            const next = [...prev];
            next[sessionIndex] = updatedSession;
            return next;
          } else {
            return [updatedSession, ...prev];
          }
        } else if (type === 'thought') {
          const lastMsg = targetSession.messages[targetSession.messages.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            const updatedLast = {
              ...lastMsg,
              thinking: (lastMsg.thinking || '') + (lastMsg.thinking ? '\n' : '') + payload.text,
            };
            const updatedMessages = [...targetSession.messages.slice(0, -1), updatedLast];
            const updatedSession = { ...targetSession, messages: updatedMessages };

            const next = [...prev];
            if (sessionIndex >= 0) next[sessionIndex] = updatedSession;
            return next;
          }
        } else if (type === 'tool_call') {
          const lastMsg = targetSession.messages[targetSession.messages.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            const toolCall: ToolCall = {
              id: eventId,
              name: payload.name,
              args: payload.args,
              output: payload.output,
              status: payload.status || 'completed',
              timestamp,
            };
            const updatedLast = {
              ...lastMsg,
              toolCalls: [...(lastMsg.toolCalls || []), toolCall],
            };
            const updatedMessages = [...targetSession.messages.slice(0, -1), updatedLast];
            const updatedSession = { ...targetSession, messages: updatedMessages };

            const next = [...prev];
            if (sessionIndex >= 0) next[sessionIndex] = updatedSession;
            return next;
          }
        } else if (type === 'diff') {
          const lastMsg = targetSession.messages[targetSession.messages.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            const diff: FileDiff = {
              filename: payload.filename || payload.file,
              additions: payload.additions || 0,
              deletions: payload.deletions || 0,
              patch: payload.patch,
            };
            const updatedLast = {
              ...lastMsg,
              diffs: [...(lastMsg.diffs || []), diff],
            };
            const updatedMessages = [...targetSession.messages.slice(0, -1), updatedLast];
            const updatedSession = { ...targetSession, messages: updatedMessages };

            const next = [...prev];
            if (sessionIndex >= 0) next[sessionIndex] = updatedSession;
            return next;
          }
        }

        return prev;
      });
    } else if (msg.type === 'thought_chunk') {
      setSessions((prev) =>
        prev.map((session) => {
          if (session.id !== activeSessionId) return session;
          const lastMsg = session.messages[session.messages.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            return {
              ...session,
              messages: [
                ...session.messages.slice(0, -1),
                {
                  ...lastMsg,
                  thinking: (lastMsg.thinking || '') + (lastMsg.thinking ? '\n' : '') + msg.payload,
                },
              ],
            };
          }
          return session;
        })
      );
    } else if (msg.type === 'tool_call') {
      setSessions((prev) =>
        prev.map((session) => {
          if (session.id !== activeSessionId) return session;
          const lastMsg = session.messages[session.messages.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            const currentTools = lastMsg.toolCalls || [];
            return {
              ...session,
              messages: [
                ...session.messages.slice(0, -1),
                {
                  ...lastMsg,
                  toolCalls: [...currentTools, msg.payload],
                },
              ],
            };
          }
          return session;
        })
      );
    } else if (msg.type === 'diff') {
      setSessions((prev) =>
        prev.map((session) => {
          if (session.id !== activeSessionId) return session;
          const lastMsg = session.messages[session.messages.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            const currentDiffs = lastMsg.diffs || [];
            return {
              ...session,
              messages: [
                ...session.messages.slice(0, -1),
                {
                  ...lastMsg,
                  diffs: [...currentDiffs, msg.payload],
                },
              ],
            };
          }
          return session;
        })
      );
    } else if (msg.type === 'content_chunk') {
      setSessions((prev) =>
        prev.map((session) => {
          if (session.id !== activeSessionId) return session;
          const lastMsg = session.messages[session.messages.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            return {
              ...session,
              messages: [
                ...session.messages.slice(0, -1),
                {
                  ...lastMsg,
                  content: msg.payload.fullContent,
                },
              ],
            };
          }
          return session;
        })
      );
    } else if (msg.type === 'done') {
      setIsStreaming(false);
      setAgentStatuses((prev) => ({ ...prev, [msg.agentType || activeAgent]: 'ready' }));
    } else if (msg.type === 'bridge_dispatch') {
      setBridgeTasks((prev) => [msg.payload, ...prev]);
    }
  };

  const handleSendMessage = (content: string, agent: AgentType) => {
    const userMsg: Message = {
      id: `msg-${Date.now()}-user`,
      role: 'user',
      agentType: agent,
      content,
      timestamp: new Date().toISOString(),
    };

    const assistantMsgPlaceholder: Message = {
      id: `msg-${Date.now()}-assistant`,
      role: 'assistant',
      agentType: agent,
      content: '',
      timestamp: new Date().toISOString(),
      status: 'streaming',
    };

    setSessions((prev) =>
      prev.map((s) => {
        if (s.id === activeSessionId) {
          return {
            ...s,
            messages: [...s.messages, userMsg, assistantMsgPlaceholder],
            updatedAt: new Date().toISOString(),
          };
        }
        return s;
      })
    );

    setIsStreaming(true);
    setAgentStatuses((prev) => ({ ...prev, [agent]: 'running' }));

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'user_prompt',
          sessionId: activeSessionId,
          agentType: agent,
          payload: {
            prompt: content,
            cwd: currentSession.workingDirectory,
            sessionId: activeSessionId,
          },
        })
      );
    }
  };

  const handleDispatchToAgent = (toAgent: AgentType, content: string) => {
    setActiveAgent(toAgent);
    setActiveTab('chat');
    handleSendMessage(`Review and implement the following specification from the lead agent:\n\n${content}`, toAgent);
  };

  const handleDispatchWorkflow = (fromAgent: AgentType, toAgent: AgentType, instruction: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'bridge_dispatch',
          payload: {
            from: fromAgent,
            to: toAgent,
            instruction,
          },
        })
      );
    }
  };

  const handleCreateSession = () => {
    const newSession: Session = {
      id: `session-${Date.now()}`,
      title: `Workspace Session #${sessions.length + 1}`,
      activeAgent: 'antigravity',
      workingDirectory: '/Users/taufeeqali/projects/Lyra',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };
    setSessions([newSession, ...sessions]);
    setActiveSessionId(newSession.id);
  };

  const handleSaveStoragePath = async (newPath: string) => {
    try {
      const res = await fetch('/api/storage/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storagePath: newPath }),
      });
      if (res.ok) {
        setStoragePath(newPath);
      }
    } catch (e) {
      console.error('Failed to update storage path:', e);
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-neutral-950 text-neutral-100 font-sans">
      {/* Minimal Left Sidebar */}
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={setActiveSessionId}
        onCreateSession={handleCreateSession}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        workingDirectory={currentSession.workingDirectory}
        agentStatuses={agentStatuses}
        storagePath={storagePath}
        onOpenStorageConfig={() => setIsStorageModalOpen(true)}
      />

      {/* Main Workspace Area */}
      {activeTab === 'chat' && (
        <ChatView
          sessionTitle={currentSession.title}
          messages={currentSession.messages}
          activeAgent={activeAgent}
          onSelectAgent={setActiveAgent}
          onSendMessage={handleSendMessage}
          onDispatchToAgent={handleDispatchToAgent}
          onClearSession={() => {
            setSessions((prev) =>
              prev.map((s) => (s.id === activeSessionId ? { ...s, messages: [] } : s))
            );
          }}
          isStreaming={isStreaming}
          agentStatuses={agentStatuses}
        />
      )}

      {activeTab === 'bridge' && (
        <div className="flex-1 p-6 overflow-y-auto bg-neutral-950 space-y-6">
          <div className="max-w-4xl mx-auto space-y-4">
            <div>
              <h1 className="text-base font-semibold text-neutral-100">Inter-Agent Pipeline & Bridge</h1>
              <p className="text-xs text-neutral-500 font-mono mt-1">
                Chain commands between Antigravity (planning), Claude Code (refactoring), and Codex (testing).
              </p>
            </div>

            <MultiAgentBridge
              onDispatchWorkflow={handleDispatchWorkflow}
              tasks={bridgeTasks}
            />
          </div>
        </div>
      )}

      {/* Storage Configuration Modal */}
      <StorageConfigModal
        isOpen={isStorageModalOpen}
        onClose={() => setIsStorageModalOpen(false)}
        currentPath={storagePath}
        onSavePath={handleSaveStoragePath}
      />
    </div>
  );
}
