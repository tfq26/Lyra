import React, { useState, useEffect, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { MultiAgentBridge } from './components/MultiAgentBridge';
import { StorageConfigModal } from './components/StorageConfigModal';
import type { Session, Message, AgentType, AgentBridgeTask, ToolCall, FileDiff, AgentRunOptions } from './types';
import { sendDesktopNotification } from './lib/platform';

export function App() {
  const authToken = (import.meta as any).env?.VITE_LYRA_AUTH_TOKEN as string | undefined;
  const apiFetch = (input: RequestInfo | URL, init: RequestInit = {}) => fetch(input, {
    ...init,
    headers: { ...(init.headers || {}), ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
  });
  const [sessions, setSessions] = useState<Session[]>([
    {
      id: 'session-main',
      title: 'General',
      activeAgent: 'antigravity',
      workingDirectory: '/Users/taufeeqali/projects/Lyra',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
      executionMode: 'safe',
    },
  ]);


  const [activeSessionId, setActiveSessionId] = useState<string>('session-main');
  const [activeTab, setActiveTab] = useState<'chat' | 'bridge' | 'artifacts'>('chat');
  const [activeAgent, setActiveAgent] = useState<AgentType>('antigravity');
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeRunIds, setActiveRunIds] = useState<Set<string>>(new Set());
  const [agentOptions, setAgentOptions] = useState<AgentRunOptions>({});
  const [agentCapabilities, setAgentCapabilities] = useState<Record<string, { installed: boolean; options: string[] }>>({});
  const [bridgeTasks, setBridgeTasks] = useState<AgentBridgeTask[]>([]);
  const [storagePath, setStoragePath] = useState<string>('~/.lyra/chats');
  const [isStorageModalOpen, setIsStorageModalOpen] = useState(false);

  const [agentStatuses, setAgentStatuses] = useState<Record<AgentType, 'ready' | 'running' | 'idle' | 'offline'>>({
    antigravity: 'ready',
    claude_code: 'ready',
    codex: 'ready',
    orchestrator: 'ready',
  });

  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);

  // Fetch initial sessions & storage config from API
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        setIsLoadingSessions(true);
        await apiFetch('/api/auth/bootstrap', { credentials: 'include' });
        const [configRes, sessionsRes, capabilitiesRes] = await Promise.all([
          apiFetch('/api/storage/config'),
          apiFetch('/api/sessions'),
          apiFetch('/api/agents/capabilities'),
        ]);

        if (capabilitiesRes.ok) setAgentCapabilities(await capabilitiesRes.json());

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
                const existing = merged.find((m) => m.id === s.id);
                if (!existing) {
                  merged.push({
                    id: s.id,
                    title: s.title || s.id,
                    activeAgent: s.activeAgents?.[0] || 'antigravity',
                    workingDirectory: s.workspacePath || '/Users/taufeeqali/projects/Lyra',
                    createdAt: s.createdAt,
                    updatedAt: s.updatedAt,
                    messages: [],
                  });
                } else if (s.title && existing.title !== s.title) {
                  existing.title = s.title;
                }
              }
              return merged;
            });
          }
        }
      } catch (err) {
        // Hub might still be starting
      } finally {
        setIsLoadingSessions(false);
      }
    };

    fetchInitialData();
  }, []);

  const cleanUserText = (text: string): string => {
    if (!text) return '';
    const match = text.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
    let cleaned = match ? (match[1] || '').trim() : text;
    return cleaned
      .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '')
      .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/g, '')
      .trim();
  };

  const convertEventsToMessages = (events: any[], fallbackAgent: AgentType): Message[] => {
    const messages: Message[] = [];

    for (const ev of events) {
      if (ev.type === 'message') {
        const isUser = ev.agent === 'user';
        const rawContent = ev.payload?.text || '';
        const content = isUser ? cleanUserText(rawContent) : rawContent;
        messages.push({
          id: ev.eventId,
          role: isUser ? 'user' : 'assistant',
          agentType: isUser ? fallbackAgent : (ev.agent as AgentType),
          content,
          timestamp: ev.timestamp,
        });
      } else if (ev.type === 'thought') {
        const last = messages[messages.length - 1];
        if (last && last.role === 'assistant') {
          last.thinking = (last.thinking ? last.thinking + '\n' : '') + (ev.payload?.text || '');
        } else {
          messages.push({
            id: ev.eventId,
            role: 'assistant',
            agentType: ev.agent === 'user' ? fallbackAgent : (ev.agent as AgentType),
            content: '',
            thinking: ev.payload?.text || '',
            timestamp: ev.timestamp,
          });
        }
      } else if (ev.type === 'tool_call') {
        const last = messages[messages.length - 1];
        const toolCall: ToolCall = {
          id: ev.eventId,
          name: ev.payload?.name || '',
          args: ev.payload?.args,
          output: ev.payload?.output,
          status: ev.payload?.status || 'completed',
          timestamp: ev.timestamp,
        };
        if (last && last.role === 'assistant') {
          last.toolCalls = [...(last.toolCalls || []), toolCall];
        } else {
          messages.push({
            id: ev.eventId,
            role: 'assistant',
            agentType: ev.agent === 'user' ? fallbackAgent : (ev.agent as AgentType),
            content: '',
            toolCalls: [toolCall],
            timestamp: ev.timestamp,
          });
        }
      } else if (ev.type === 'diff') {
        const last = messages[messages.length - 1];
        const diff: FileDiff = {
          filename: ev.payload?.filename || ev.payload?.file || 'file',
          additions: ev.payload?.additions || 0,
          deletions: ev.payload?.deletions || 0,
          patch: ev.payload?.patch || ev.payload?.content,
        };
        if (last && last.role === 'assistant') {
          last.diffs = [...(last.diffs || []), diff];
        } else {
          messages.push({
            id: ev.eventId,
            role: 'assistant',
            agentType: ev.agent === 'user' ? fallbackAgent : (ev.agent as AgentType),
            content: '',
            diffs: [diff],
            timestamp: ev.timestamp,
          });
        }
      }
    }

    return messages;
  };

  // Load session messages when switching sessions
  useEffect(() => {
    if (!activeSessionId) return;

    const targetSession = sessions.find((s) => s.id === activeSessionId);
    if (targetSession && targetSession.messages && targetSession.messages.length > 0) {
      return;
    }

    const loadSession = async () => {
      try {
        setIsLoadingMessages(true);
      const res = await apiFetch(`/api/sessions/${encodeURIComponent(activeSessionId)}`);
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.events)) {
            const loaded = convertEventsToMessages(data.events, activeAgent);
            setSessions((prev) =>
              prev.map((s) =>
                s.id === activeSessionId
                  ? {
                      ...s,
                      title: data.meta?.title || s.title,
                      activeAgent: data.meta?.activeAgents?.[0] || s.activeAgent,
                      messages: loaded,
                    }
                  : s
              )
            );
            if (data.meta?.activeAgents?.[0]) {
              setActiveAgent(data.meta.activeAgents[0]);
            }
          }
        }
      } catch (err) {
        console.error('Failed to load session messages:', err);
      } finally {
        setIsLoadingMessages(false);
      }
    };

    loadSession();
  }, [activeSessionId]);

  // Setup WebSocket connection to Lyra Hub
  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: NodeJS.Timeout;

    const connect = () => {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsHost = window.location.port === '5173'
        ? `${window.location.hostname}:3001`
        : (window.location.host || 'localhost:3001');
      const wsUrl = authToken ? `${wsProtocol}//${wsHost}?token=${encodeURIComponent(authToken)}` : `${wsProtocol}//${wsHost}`;
      ws = new WebSocket(wsUrl);
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
  }, []);

  const currentSession = sessions.find((s) => s.id === activeSessionId) || sessions[0]!;

  const handleServerEvent = (msg: any) => {
    if (msg.type === 'storage_path_updated') {
      if (msg.payload?.storagePath) {
        setStoragePath(msg.payload.storagePath);
      }
    } else if (msg.type === 'session_updated') {
      const meta = msg.payload;
      if (meta?.id) {
        setSessions((prev) =>
          prev.map((s) => (s.id === meta.id ? { ...s, title: meta.title || s.title } : s))
        );
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
          const rawContent = payload.text || '';
          const cleanContent = isUser ? cleanUserText(rawContent) : rawContent;
          const newMsg: Message = {
            id: eventId,
            role: isUser ? 'user' : 'assistant',
            agentType: isUser ? activeAgent : (agent as AgentType),
            content: cleanContent,
            timestamp,
          };

          // Robust deduplication for user messages
          if (isUser) {
            const hasExisting = targetSession.messages.some(
              (m) =>
                m.role === 'user' &&
                (m.id === newMsg.id ||
                  m.content.trim() === newMsg.content.trim() ||
                  (Math.abs(new Date(m.timestamp).getTime() - new Date(newMsg.timestamp).getTime()) < 60000 &&
                   m.content.trim().slice(0, 40) === newMsg.content.trim().slice(0, 40)))
            );
            if (hasExisting) {
              return prev;
            }
          }

          // Robust deduplication for assistant messages
          if (!isUser) {
            const lastMsg = targetSession.messages[targetSession.messages.length - 1];

            // If the last message was a streaming placeholder or is already displaying this content, finalize it in place
            if (lastMsg && lastMsg.role === 'assistant') {
              if (
                lastMsg.status === 'streaming' ||
                !lastMsg.content ||
                lastMsg.content.trim() === newMsg.content.trim() ||
                newMsg.content.trim().startsWith(lastMsg.content.trim())
              ) {
                const updatedLast: Message = {
                  ...lastMsg,
                  id: eventId || lastMsg.id,
                  content: newMsg.content || lastMsg.content,
                  status: undefined,
                  timestamp,
                };
                const updatedMessages = [...targetSession.messages.slice(0, -1), updatedLast];
                const updatedSession = { ...targetSession, messages: updatedMessages, updatedAt: timestamp };
                const next = [...prev];
                if (sessionIndex >= 0) next[sessionIndex] = updatedSession;
                return next;
              }
            }

            // If any assistant message in the session already has identical content, ignore duplicate event
            const hasDuplicate = targetSession.messages.some(
              (m) =>
                m.role === 'assistant' &&
                (m.id === newMsg.id || m.content.trim() === newMsg.content.trim())
            );
            if (hasDuplicate) {
              return prev;
            }
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
          if (session.id !== (msg.sessionId || activeSessionId)) return session;
          const lastMsg = [...session.messages].reverse().find(
            (m) => m.role === 'assistant' && (!msg.payload.runId || m.runId === msg.payload.runId)
          );
          if (lastMsg && lastMsg.role === 'assistant') {
            return {
              ...session,
              messages: [
                ...session.messages.filter((m) => m.id !== lastMsg.id),
                {
                  ...lastMsg,
                  thinking: (lastMsg.thinking || '') + (lastMsg.thinking ? '\n' : '') + (msg.payload?.text || msg.payload || ''),
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
          if (session.id !== (msg.sessionId || activeSessionId)) return session;
          const lastMsg = [...session.messages].reverse().find(
            (m) => m.role === 'assistant' && (!msg.payload?.runId || m.runId === msg.payload.runId)
          );
          if (lastMsg && lastMsg.role === 'assistant') {
            const currentTools = lastMsg.toolCalls || [];
            return {
              ...session,
              messages: [
                ...session.messages.filter((m) => m.id !== lastMsg.id),
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
          if (session.id !== (msg.sessionId || activeSessionId)) return session;
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
          if (session.id !== (msg.sessionId || activeSessionId)) return session;
          const lastMsg = [...session.messages].reverse().find(
            (m) => m.role === 'assistant' && (!msg.payload?.runId || m.runId === msg.payload.runId)
          );
          if (lastMsg && lastMsg.role === 'assistant') {
            return {
              ...session,
              messages: [
                ...session.messages.filter((m) => m.id !== lastMsg.id),
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
      if (msg.runId) setActiveRunIds((prev) => {
        const next = new Set(prev);
        next.delete(msg.runId);
        setIsStreaming(next.size > 0);
        return next;
      });
      if (!msg.runId) setIsStreaming(false);
      const agentFinished = msg.agentType || activeAgent;
      setAgentStatuses((prev) => ({ ...prev, [agentFinished]: 'ready' }));
      const agentName = agentFinished === 'claude_code' ? 'Claude Code' : agentFinished === 'codex' ? 'Codex' : 'Antigravity';
      sendDesktopNotification('Agent Completed', `${agentName} finished processing task.`);
    } else if (msg.type === 'bridge_dispatch') {
      setBridgeTasks((prev) => [msg.payload, ...prev]);
    }
  };

  // Global desktop keyboard shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;
      if (isMeta && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        handleCreateSession();
      } else if (isMeta && e.key === '[') {
        e.preventDefault();
        setActiveTab('chat');
      } else if (isMeta && e.key === ']') {
        e.preventDefault();
        setActiveTab('bridge');
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [sessions]);

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
      runId: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };

    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId
          ? {
              ...s,
              messages: [...s.messages, userMsg, assistantMsgPlaceholder],
              updatedAt: new Date().toISOString(),
            }
          : s
      )
    );

    setIsStreaming(true);
    setActiveRunIds((prev) => new Set(prev).add(assistantMsgPlaceholder.runId!));
    setAgentStatuses((prev) => ({ ...prev, [agent]: 'running' }));

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'user_prompt',
          sessionId: activeSessionId,
          agentType: agent,
          payload: {
            prompt: content,
            agentType: agent,
            cwd: currentSession.workingDirectory || '/Users/taufeeqali/projects/Lyra',
            sessionId: activeSessionId,
            runId: assistantMsgPlaceholder.runId,
            executionMode: currentSession.executionMode || 'safe',
            ...agentOptions,
          },
        })
      );
    }
  };

  const handleDispatchToAgent = (toAgent: AgentType, instruction: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'bridge_dispatch',
          payload: {
            from: activeAgent,
            to: toAgent,
            instruction,
          },
        })
      );
    }
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

  const handleCreateSession = async () => {
    try {
      const response = await apiFetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Workspace Session #${sessions.length + 1}`,
          workspacePath: currentSession.workingDirectory || '/Users/taufeeqali/projects/Lyra',
          activeAgents: ['antigravity'],
        }),
      });
      if (!response.ok) throw new Error('Unable to create session');
      const meta = await response.json();
      const newSession: Session = {
        id: meta.id,
        title: meta.title,
        activeAgent: meta.activeAgents?.[0] || 'antigravity',
        workingDirectory: meta.workspacePath || currentSession.workingDirectory,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        messages: [],
        executionMode: 'safe',
      };
      setSessions((prev) => [newSession, ...prev.filter((session) => session.id !== newSession.id)]);
      setActiveSessionId(newSession.id);
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  };

  const handleSelectWorkingDirectory = (newDir: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === activeSessionId ? { ...s, workingDirectory: newDir } : s))
    );
  };

  const handleStartCli = (agent: AgentType) => {
    setActiveAgent(agent);
    handleSendMessage(`CLI status check for ${agent}`, agent);
  };

  const handleSaveStoragePath = async (newPath: string) => {
    try {
      const res = await apiFetch('/api/storage/config', {
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
    <div className="flex h-screen w-screen overflow-hidden bg-neutral-950 text-neutral-100">
      {/* Minimal Left Sidebar */}
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={setActiveSessionId}
        onCreateSession={handleCreateSession}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        workingDirectory={currentSession.workingDirectory}
        onSelectWorkingDirectory={handleSelectWorkingDirectory}
        agentStatuses={agentStatuses}
        storagePath={storagePath}
        onOpenStorageConfig={() => setIsStorageModalOpen(true)}
        isLoadingSessions={isLoadingSessions}
        onStartCli={handleStartCli}
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
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'clear_session', sessionId: activeSessionId, payload: {} }));
            }
          }}
          isStreaming={activeRunIds.size > 0}
          agentStatuses={agentStatuses}
          isLoadingMessages={isLoadingMessages}
          agentOptions={agentOptions}
          onAgentOptionsChange={setAgentOptions}
          agentCapabilities={agentCapabilities}
          onCancelRun={() => {
            const runId = [...activeRunIds][0];
            if (runId && wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'cancel_run', payload: { runId } }));
            }
          }}
        />
      )}

      {activeTab === 'bridge' && (
        <div className="flex-1 p-6 overflow-y-auto bg-neutral-950 space-y-6">
          <div className="max-w-4xl mx-auto space-y-4">
            <div>
              <h1 className="text-base font-semibold text-neutral-100">Inter-Agent Pipeline & Bridge</h1>
              <p className="text-xs text-neutral-500 mt-1">
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
