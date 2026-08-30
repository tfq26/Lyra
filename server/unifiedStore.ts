import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import { AgentType } from './types';

export interface UnifiedSessionMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  workspacePath: string;
  activeAgents: AgentType[];
  tags?: string[];
}

export interface UnifiedEvent {
  eventId: string;
  sessionId: string;
  timestamp: string;
  agent: AgentType | 'user';
  type: 'message' | 'thought' | 'tool_call' | 'diff' | 'diagram' | 'status';
  payload: any;
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
          this.storagePath = cfg.storagePath;
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
    this.storagePath = newPath;
    if (!fs.existsSync(newPath)) {
      fs.mkdirSync(newPath, { recursive: true });
    }
    const sessionsDir = this.getSessionsDir();
    if (!fs.existsSync(sessionsDir)) {
      fs.mkdirSync(sessionsDir, { recursive: true });
    }

    // Save to ~/.lyra/config.json
    fs.writeFileSync(
      this.configPath,
      JSON.stringify({ storagePath: this.storagePath }, null, 2),
      'utf-8'
    );

    this.emit('storage_path_changed', this.storagePath);
  }

  public getSessionsDir(): string {
    return path.join(this.storagePath, 'sessions');
  }

  public getSessionDir(sessionId: string): string {
    return path.join(this.getSessionsDir(), sessionId);
  }

  public listSessions(): UnifiedSessionMeta[] {
    const sessionsDir = this.getSessionsDir();
    if (!fs.existsSync(sessionsDir)) return [];

    try {
      const dirs = fs.readdirSync(sessionsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'));

      const result: UnifiedSessionMeta[] = [];

      for (const d of dirs) {
        const metaPath = path.join(sessionsDir, d.name, 'meta.json');
        if (fs.existsSync(metaPath)) {
          try {
            const raw = fs.readFileSync(metaPath, 'utf-8');
            result.push(JSON.parse(raw));
          } catch {
            // ignore corrupted meta
          }
        } else {
          // auto-synthesize meta
          result.push({
            id: d.name,
            title: d.name,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            workspacePath: process.cwd(),
            activeAgents: ['antigravity'],
          });
        }
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
    };

    const eventsPath = path.join(sessionDir, 'events.jsonl');
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
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
      } catch {}
    }

    this.emit('event_appended', fullEvent);
    return fullEvent;
  }
}
