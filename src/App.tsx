import React, { useState, useEffect, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { MultiAgentBridge } from './components/MultiAgentBridge';
import { StorageConfigModal } from './components/StorageConfigModal';
import type { Session, Message, AgentType, AgentBridgeTask, ToolCall, FileDiff, AgentRunOptions, ModelOption, AppNotification } from './types';
import { findSlashCommand, getSlashCommands, parseSlashCommand } from './lib/slashCommands';
import { sendDesktopNotification } from './lib/platform';
import { Toaster } from './components/ui/sonner';
import { toast } from 'sonner';

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
  const [agentModels, setAgentModels] = useState<Record<string, ModelOption[]>>({});
  const [isSavingAgentOptions, setIsSavingAgentOptions] = useState(false);
  const [agentCapabilities, setAgentCapabilities] = useState<Record<string, { installed: boolean; options: string[] }>>({});
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
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
  const notificationKeysRef = useRef(new Map<string, number>());

  const agentLabel = (agent?: AgentType) => agent === 'claude_code' ? 'Claude Code' : agent === 'codex' ? 'Codex' : agent === 'antigravity' ? 'Antigravity' : 'Lyra';
  const addNotification = (level: AppNotification['level'], title: string, message: string, agentType?: AgentType) => {
    const key = `${level}:${title}:${message}`;
    const lastShown = notificationKeysRef.current.get(key) || 0;
    if (Date.now() - lastShown < 5000) return;
    notificationKeysRef.current.set(key, Date.now());
    const notification: AppNotification = {
      id: `notification-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title, message, level, agentType, createdAt: new Date().toISOString(),
    };
    setNotifications((prev) => [notification, ...prev].slice(0, 100));
    if (level === 'error') toast.error(title, { description: message });
    else if (level === 'warning') toast.warning(title, { description: message });
    else if (level === 'success') toast.success(title, { description: message });
    else toast.info(title, { description: message });
    void sendDesktopNotification(title, message);
  };

  // Fetch initial sessions & storage config from API
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        setIsLoadingSessions(true);
        await apiFetch('/api/auth/bootstrap', { credentials: 'include' });
        const [configRes, sessionsRes, capabilitiesRes, modelsRes] = await Promise.all([
          apiFetch('/api/storage/config'),
          apiFetch('/api/sessions'),
          apiFetch('/api/agents/capabilities'),
          apiFetch('/api/agents/models'),
        ]);

        if (capabilitiesRes.ok) {
          const capabilities = await capabilitiesRes.json();
          setAgentCapabilities(capabilities);
          for (const [agent, info] of Object.entries(capabilities) as Array<[AgentType, { installed: boolean }]>) {
            if (info.installed === false) addNotification('warning', `${agentLabel(agent)} unavailable`, 'This CLI is not installed or could not be found.', agent);
          }
        }
        if (modelsRes.ok) setAgentModels(await modelsRes.json());

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
                    agentOptions: s.agentOptions || {},
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
                      agentOptions: data.meta?.agentOptions || s.agentOptions || {},
                      messages: loaded,
                    }
                  : s
              )
            );
            if (data.meta?.activeAgents?.[0]) {
              setActiveAgent(data.meta.activeAgents[0]);
              setAgentOptions(data.meta?.agentOptions?.[data.meta.activeAgents[0]] || {});
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
          prev.map((s) => (s.id === meta.id ? {
            ...s,
            title: meta.title || s.title,
            workingDirectory: meta.workspacePath || s.workingDirectory,
            updatedAt: meta.updatedAt || s.updatedAt,
          } : s))
        );
      }
    } else if (msg.type === 'run_started') {
      addNotification('info', `${agentLabel(msg.agentType)} started`, 'The agent is processing your request.', msg.agentType);
    } else if (msg.type === 'run_cancelled') {
      addNotification('warning', `${agentLabel(msg.agentType)} stopped`, 'The active run was cancelled.', msg.agentType);
    } else if (msg.type === 'error') {
      addNotification('error', `${agentLabel(msg.agentType)} error`, String(msg.payload?.message || msg.payload || 'The CLI reported an error.'), msg.agentType);
    } else if (msg.type === 'thought_chunk') {
      const thought = String(msg.payload?.text || msg.payload || '');
      if (/error|failed|failure|auth|permission|attention|warning|unavailable/i.test(thought)) {
        addNotification('warning', `${agentLabel(msg.agentType)} needs attention`, thought.slice(0, 240), msg.agentType);
      }
    } else if (msg.type === 'unified_event') {
      const { sessionId, agent, type, payload, timestamp, eventId } = msg.payload;
      if (type === 'status' && payload?.text) addNotification('info', `${agentLabel(agent)} status`, String(payload.text).slice(0, 240), agent);
      if (type === 'tool_call' && payload?.status === 'error') addNotification('error', `${agentLabel(agent)} tool failed`, String(payload.output || payload.name || 'A tool call failed.').slice(0, 240), agent);

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
      setSessions((prev) => prev.map((session) => {
        if (session.id !== (msg.sessionId || activeSessionId)) return session;
        return {
          ...session,
          messages: session.messages.map((message) =>
            (!msg.runId || message.runId === msg.runId) && message.role === 'assistant'
              ? { ...message, status: 'done' as const }
              : message
          ),
        };
      }));
      const agentFinished = msg.agentType || activeAgent;
      setAgentStatuses((prev) => ({ ...prev, [agentFinished]: 'ready' }));
      const agentName = agentFinished === 'claude_code' ? 'Claude Code' : agentFinished === 'codex' ? 'Codex' : 'Antigravity';
      addNotification(msg.code && msg.code !== 0 ? 'error' : 'success', msg.code && msg.code !== 0 ? `${agentName} failed` : `${agentName} completed`, msg.code && msg.code !== 0 ? `Exited with status ${msg.code}.` : 'Finished processing task.', agentFinished);
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

  const handleSendMessage = (content: string, agent: AgentType, isSlashCommand = false) => {
    const slash = isSlashCommand ? parseSlashCommand(content) : null;
    if (slash?.command === '/clear') {
      setSessions((prev) => prev.map((session) => session.id === activeSessionId ? { ...session, messages: [] } : session));
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: 'clear_session', sessionId: activeSessionId, payload: {} }));
      return;
    }
    if (slash?.command === '/new') {
      void handleCreateSession();
      return;
    }
    if (slash?.command === '/stop') {
      const runId = [...activeRunIds][0];
      if (runId && wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: 'cancel_run', payload: { runId } }));
      return;
    }
    if (slash?.command === '/help') {
      const helpMessage: Message = {
        id: `help-${Date.now()}`,
        role: 'assistant',
        agentType: agent,
        content: getSlashCommands(agent, '/').map((command) => `- **${command.name}** — ${command.description}`).join('\n'),
        timestamp: new Date().toISOString(),
        status: 'done',
      };
      setSessions((prev) => prev.map((session) => session.id === activeSessionId ? { ...session, messages: [...session.messages, helpMessage] } : session));
      return;
    }
    if (slash && findSlashCommand(agent, slash.command)?.supportsHeadless === false) {
      const notice: Message = {
        id: `slash-notice-${Date.now()}`,
        role: 'assistant',
        agentType: agent,
        content: `${slash.command} requires an interactive ${agent} session. Lyra will support persistent CLI sessions for this command in a later update.`,
        timestamp: new Date().toISOString(),
        status: 'done',
      };
      setSessions((prev) => prev.map((session) => session.id === activeSessionId ? { ...session, messages: [...session.messages, notice] } : session));
      return;
    }
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
            isSlashCommand,
            slashCommand: isSlashCommand ? parseSlashCommand(content)?.command : undefined,
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
      />

      {/* Main Workspace Area */}
      {activeTab === 'chat' && (
        <ChatView
          sessionTitle={currentSession.title}
          messages={currentSession.messages}
          activeAgent={activeAgent}
          onSelectAgent={(agent) => {
            setActiveAgent(agent);
            setAgentOptions(currentSession.agentOptions?.[agent] || {});
          }}
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
          onAgentOptionsChange={(options) => setAgentOptions(options)}
          onSaveAgentOptions={async () => {
            setIsSavingAgentOptions(true);
            try {
              const nextAgentOptions = { ...(currentSession.agentOptions || {}), [activeAgent]: agentOptions };
              const response = await apiFetch(`/api/sessions/${encodeURIComponent(activeSessionId)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agentOptions: nextAgentOptions }),
              });
              if (!response.ok) throw new Error('Unable to save agent options');
              setSessions((prev) => prev.map((session) => session.id === activeSessionId ? { ...session, agentOptions: nextAgentOptions } : session));
            } catch (error) {
              console.error('Failed to save agent options:', error);
            } finally {
              setIsSavingAgentOptions(false);
            }
          }}
          savingAgentOptions={isSavingAgentOptions}
          agentModels={agentModels[activeAgent] || []}
          agentCapabilities={agentCapabilities}
          notifications={notifications}
          onMarkNotificationsRead={() => setNotifications((prev) => prev.map((notification) => ({ ...notification, read: true })))}
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
      <Toaster theme="dark" position="bottom-right" />
    </div>
  );
}
