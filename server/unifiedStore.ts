import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import type { AgentType } from './types';
import { assertSafeId, resolveUserPath } from './security';

export interface UnifiedSessionMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  workspacePath: string;
  activeAgents: AgentType[];
  tags?: string[];
  archived?: boolean;
}

export interface UnifiedEvent {
  eventId: string;
  sessionId: string;
  timestamp: string;
  agent: AgentType | 'user';
  type: 'message' | 'thought' | 'progress' | 'tool_call' | 'diff' | 'diagram' | 'status' | 'run_started' | 'run_completed' | 'run_failed' | 'run_cancelled';
  payload: unknown;
  runId?: string;
}

export interface AgentSessionBinding {
  sessionId: string;
  agentType: AgentType;
  nativeSessionId?: string;
  nativeConversationId?: string;
  lastRunId?: string;
  lastUsedAt: string;
}

export class UnifiedStore extends EventEmitter {
  private configPath: string;
  private storagePath: string;

  constructor() {
    super();
    const homeDir = os.homedir();
    const lyraHome = path.join(homeDir, '.lyra');
    this.configPath = path.join(lyraHome, 'config.json');

    // Default storage directory: ~/.lyra/chats
    this.storagePath = path.join(lyraHome, 'chats');
    this.init();
  }

  public init() {
    try {
      const lyraHome = path.dirname(this.configPath);
      if (!fs.existsSync(lyraHome)) {
        fs.mkdirSync(lyraHome, { recursive: true });
      }

      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        const cfg = JSON.parse(raw);
        if (cfg.storagePath && typeof cfg.storagePath === 'string') {
          this.storagePath = resolveUserPath(cfg.storagePath);
        }
      } else {
        fs.writeFileSync(
          this.configPath,
          JSON.stringify({ storagePath: this.storagePath }, null, 2),
          'utf-8'
        );
      }

      const sessionsDir = this.getSessionsDir();
      if (!fs.existsSync(sessionsDir)) {
        fs.mkdirSync(sessionsDir, { recursive: true });
      }

      // Seed an initial demo session if empty
      const existing = fs.readdirSync(sessionsDir);
      if (existing.length === 0) {
        this.createSession({
          id: 'session-main',
          title: 'Architecture & Multi-CLI Workspace',
          workspacePath: process.cwd(),
          activeAgents: ['antigravity', 'claude_code', 'codex'],
        });
      }
    } catch (e) {
      console.error('[UnifiedStore] Initialization error:', e);
    }
  }

  public getStoragePath(): string {
    return this.storagePath;
  }

  public setStoragePath(newPath: string) {
    this.storagePath = resolveUserPath(newPath);
    if (!fs.existsSync(newPath)) {
      fs.mkdirSync(newPath, { recursive: true });
    }
    const sessionsDir = this.getSessionsDir();
    if (!fs.existsSync(sessionsDir)) {
      fs.mkdirSync(sessionsDir, { recursive: true });
    }

    // Save to ~/.lyra/config.json
    this.atomicWrite(this.configPath, JSON.stringify({ storagePath: this.storagePath }, null, 2));

    this.emit('storage_path_changed', this.storagePath);
  }

  public getSessionsDir(): string {
    return path.join(this.storagePath, 'sessions');
  }

  public getSessionDir(sessionId: string): string {
    return path.join(this.getSessionsDir(), assertSafeId(sessionId, 'session ID'));
  }

  private atomicWrite(filePath: string, content: string) {
    const tempPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, content, 'utf-8');
    fs.renameSync(tempPath, filePath);
  }

  public listSessions(): UnifiedSessionMeta[] {
    const sessionsDir = this.getSessionsDir();
    if (!fs.existsSync(sessionsDir)) return [];

    try {
      const dirs = fs.readdirSync(sessionsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'));

      const nonChatPrefixes = [
        'codex-.',
        'codex-models_cache',
        'codex-version',
        'codex-chrome-native-hosts',
        'codex-realtime-voice-continuity',
        'codex-session_index',
        'codex-history',
      ];

      const result: UnifiedSessionMeta[] = [];

      for (const d of dirs) {
        if (nonChatPrefixes.some((prefix) => d.name.startsWith(prefix) || d.name === prefix)) {
          continue;
        }

        const metaPath = path.join(sessionsDir, d.name, 'meta.json');
        let meta: UnifiedSessionMeta | null = null;

        if (fs.existsSync(metaPath)) {
          try {
            const raw = fs.readFileSync(metaPath, 'utf-8');
            meta = JSON.parse(raw);
          } catch {}
        }

        if (!meta) {
          meta = {
            id: d.name,
            title: d.name,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            workspacePath: process.cwd(),
            activeAgents: ['antigravity'],
          };
        }

        // If title is just the ID or starts with agy-, try to extract the first user message
        if (!meta.title || meta.title === d.name || meta.title.startsWith('agy-')) {
          const eventsPath = path.join(sessionsDir, d.name, 'events.jsonl');
          if (fs.existsSync(eventsPath)) {
            try {
              const fd = fs.openSync(eventsPath, 'r');
              const buffer = Buffer.alloc(8192);
              const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
              fs.closeSync(fd);
              const lines = buffer.toString('utf-8', 0, bytesRead).split('\n').filter(Boolean);
              for (const line of lines) {
                try {
                  const ev = JSON.parse(line);
                  if (ev.agent === 'user' && ev.payload?.text) {
                    const raw = String(ev.payload.text)
                      .replace(/<USER_REQUEST>|<\/USER_REQUEST>/g, '')
                      .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '')
                      .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/g, '')
                      .trim();
                    const firstLine = (raw.split('\n')[0] || '').replace(/\s+/g, ' ').trim();
                    if (firstLine) {
                      meta.title = firstLine.length > 55 ? firstLine.slice(0, 52) + '...' : firstLine;
                      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
                      break;
                    }
                  }
                } catch {}
              }
            } catch {}
          }
        }

        result.push(meta);
      }

      return result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    } catch (e) {
      console.error('[UnifiedStore] Failed to list sessions:', e);
      return [];
    }
  }

  public getSession(sessionId: string): { meta: UnifiedSessionMeta; events: UnifiedEvent[] } | null {
    const sessionDir = this.getSessionDir(sessionId);
    if (!fs.existsSync(sessionDir)) return null;

    const metaPath = path.join(sessionDir, 'meta.json');
    const eventsPath = path.join(sessionDir, 'events.jsonl');

    let meta: UnifiedSessionMeta = {
      id: sessionId,
      title: sessionId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      workspacePath: process.cwd(),
      activeAgents: ['antigravity'],
    };

    if (fs.existsSync(metaPath)) {
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      } catch {}
    }

    const events: UnifiedEvent[] = [];
    if (fs.existsSync(eventsPath)) {
      try {
        const lines = fs.readFileSync(eventsPath, 'utf-8').split('\n').filter(Boolean);
        for (const line of lines) {
          events.push(JSON.parse(line));
        }
      } catch {}
    }

    return { meta, events };
  }

  public createSession(params: {
    id?: string;
    title: string;
    workspacePath: string;
    activeAgents?: AgentType[];
  }): UnifiedSessionMeta {
    const id = params.id || `session-${Date.now()}`;
    const sessionDir = this.getSessionDir(id);
    const artifactsDir = path.join(sessionDir, 'artifacts');

    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.mkdirSync(artifactsDir, { recursive: true });
    }

    const meta: UnifiedSessionMeta = {
      id,
      title: params.title,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      workspacePath: params.workspacePath,
      activeAgents: params.activeAgents || ['antigravity'],
    };

    fs.writeFileSync(path.join(sessionDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');

    // Create empty events.jsonl
    const eventsPath = path.join(sessionDir, 'events.jsonl');
    if (!fs.existsSync(eventsPath)) {
      fs.writeFileSync(eventsPath, '', 'utf-8');
    }

    this.emit('session_created', meta);
    return meta;
  }

  public appendEvent(sessionId: string, event: Omit<UnifiedEvent, 'eventId' | 'sessionId' | 'timestamp'>): UnifiedEvent {
    const sessionDir = this.getSessionDir(sessionId);
    if (!fs.existsSync(sessionDir)) {
      this.createSession({
        id: sessionId,
        title: sessionId,
        workspacePath: process.cwd(),
      });
    }

    const fullEvent: UnifiedEvent = {
      eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      sessionId,
      timestamp: new Date().toISOString(),
      agent: event.agent,
      type: event.type,
      payload: event.payload,
      runId: event.runId,
    };

    const eventsPath = path.join(sessionDir, 'events.jsonl');

    // Check if the last event is identical
    if (fs.existsSync(eventsPath)) {
      try {
        const lines = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n').filter(Boolean);
        if (lines.length > 0) {
          const lastEvent: UnifiedEvent = JSON.parse(lines[lines.length - 1] || '{}');
          if (
            lastEvent.agent === fullEvent.agent &&
            lastEvent.type === fullEvent.type &&
            JSON.stringify(lastEvent.payload) === JSON.stringify(fullEvent.payload)
          ) {
            return lastEvent;
          }
        }
      } catch {}
    }

    fs.appendFileSync(eventsPath, JSON.stringify(fullEvent) + '\n', 'utf-8');

    // Update meta timestamp & activeAgents if needed
    const metaPath = path.join(sessionDir, 'meta.json');
    if (fs.existsSync(metaPath)) {
      try {
        const meta: UnifiedSessionMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        meta.updatedAt = fullEvent.timestamp;
        if (event.agent !== 'user' && !meta.activeAgents.includes(event.agent)) {
          meta.activeAgents.push(event.agent);
        }
        this.atomicWrite(metaPath, JSON.stringify(meta, null, 2));
      } catch {}
    }

    this.emit('event_appended', fullEvent);
    return fullEvent;
  }

  public clearSession(sessionId: string) {
    const sessionDir = this.getSessionDir(sessionId);
    if (!fs.existsSync(sessionDir)) return;
    fs.writeFileSync(path.join(sessionDir, 'events.jsonl'), '', 'utf-8');
    this.updateSessionMeta(sessionId, { updatedAt: new Date().toISOString() });
  }

  public deleteSession(sessionId: string): boolean {
    const sessionDir = this.getSessionDir(sessionId);
    if (!fs.existsSync(sessionDir)) return false;
    fs.rmSync(sessionDir, { recursive: true, force: true });
    this.emit('session_deleted', sessionId);
    return true;
  }

  public getCheckpoint(source: string): number {
    const file = path.join(this.storagePath, 'checkpoints.json');
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      return Number(data[source] || 0);
    } catch { return 0; }
  }

  public setCheckpoint(source: string, offset: number) {
    const file = path.join(this.storagePath, 'checkpoints.json');
    let data: Record<string, number> = {};
    try { data = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch {}
    data[source] = offset;
    this.atomicWrite(file, JSON.stringify(data, null, 2));
  }

  public getAgentBinding(sessionId: string, agentType: AgentType): AgentSessionBinding | null {
    try {
      const bindings = JSON.parse(fs.readFileSync(path.join(this.storagePath, 'agent-sessions.json'), 'utf-8')) as AgentSessionBinding[];
      return bindings.find((binding) => binding.sessionId === sessionId && binding.agentType === agentType) || null;
    } catch { return null; }
  }

  public upsertAgentBinding(binding: AgentSessionBinding) {
    const file = path.join(this.storagePath, 'agent-sessions.json');
    let bindings: AgentSessionBinding[] = [];
    try { bindings = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch {}
    const index = bindings.findIndex((item) => item.sessionId === binding.sessionId && item.agentType === binding.agentType);
    if (index >= 0) bindings[index] = { ...bindings[index], ...binding };
    else bindings.push(binding);
    this.atomicWrite(file, JSON.stringify(bindings, null, 2));
    this.emit('agent_binding_updated', binding);
  }

  public updateSessionMeta(sessionId: string, updates: Partial<UnifiedSessionMeta>) {
    const sessionDir = this.getSessionDir(sessionId);
    if (!fs.existsSync(sessionDir)) {
      this.createSession({
        id: sessionId,
        title: updates.title || sessionId,
        workspacePath: updates.workspacePath || process.cwd(),
        activeAgents: updates.activeAgents || ['antigravity'],
      });
    }

    const metaPath = path.join(sessionDir, 'meta.json');
    let meta: UnifiedSessionMeta = {
      id: sessionId,
      title: sessionId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      workspacePath: process.cwd(),
      activeAgents: ['antigravity'],
    };

    if (fs.existsSync(metaPath)) {
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      } catch {}
    }

    const updated = { ...meta, ...updates };
    fs.writeFileSync(metaPath, JSON.stringify(updated, null, 2), 'utf-8');
    this.emit('session_updated', updated);
    return updated;
  }
}
