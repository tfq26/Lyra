import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import type { AgentType, TeamRun, TaskItem, CheckItem, HarnessProfile, HarnessId, SwarmMessage, TeamConfig, ModelProviderProfile, AgentCheckpoint, RunCheckpoint, ModelCompatibilityResult } from './types';
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
  agentOptions?: Record<string, unknown>;
  draft?: string;
  mode?: 'solo' | 'team';
  teamConfig?: TeamConfig;
}

export interface UnifiedEvent {
  eventId: string;
  sequence?: number;
  sessionId: string;
  timestamp: string;
  agent: AgentType | 'user';
  type: 'message' | 'thought' | 'progress' | 'tool_call' | 'diff' | 'diagram' | 'status' | 'run_started' | 'run_completed' | 'run_failed' | 'run_cancelled' | 'error';
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
  private harnessProfilesPath: string;
  private modelProviderProfilesPath: string;

  private readonly explicitCustomDir: boolean;
  private sessionSequences = new Map<string, number>();

  constructor(customStorageDir?: string) {
    super();
    const envStorage = process.env.LYRA_STORAGE_PATH;
    this.explicitCustomDir = Boolean(customStorageDir || envStorage);
    const baseDir = customStorageDir || envStorage || path.join(os.homedir(), '.lyra');
    this.configPath = path.join(baseDir, 'config.json');
    this.storagePath = path.join(baseDir, 'chats');
    this.harnessProfilesPath = path.join(baseDir, 'harness-profiles.json');
    this.modelProviderProfilesPath = path.join(baseDir, 'model-provider-profiles.json');
    this.init();
  }

  private applyBaseDir(baseDir: string) {
    this.configPath = path.join(baseDir, 'config.json');
    this.storagePath = path.join(baseDir, 'chats');
    this.harnessProfilesPath = path.join(baseDir, 'harness-profiles.json');
    this.modelProviderProfilesPath = path.join(baseDir, 'model-provider-profiles.json');
  }

  public init() {
    const setupStorage = () => {
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
    };

    try {
      setupStorage();
    } catch (e: any) {
      if (!this.explicitCustomDir && (e?.code === 'EPERM' || e?.code === 'EACCES' || e?.code === 'EROFS')) {
        try {
          const fallbackDir = path.join(process.cwd(), 'server', 'data', 'store');
          this.applyBaseDir(fallbackDir);
          setupStorage();
          return;
        } catch (fallbackErr) {
          console.error('[UnifiedStore] Workspace fallback initialization error:', fallbackErr);
          return;
        }
      }
      console.error('[UnifiedStore] Initialization error:', e);
    }
  }

  public getStoragePath(): string {
    return this.storagePath;
  }

  public listHarnessProfiles(): HarnessProfile[] {
    try {
      const value = JSON.parse(fs.readFileSync(this.harnessProfilesPath, 'utf8'));
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  public saveHarnessProfile(input: { id?: string; name: string; harness: HarnessId; enabled?: boolean; model?: string }): HarnessProfile {
    const name = String(input.name || '').trim().slice(0, 80);
    if (!name) throw new Error('Profile name is required.');
    if (!['antigravity', 'claude_code', 'codex', 'opencode', 'hermes'].includes(input.harness)) {
      throw new Error('Unsupported harness type.');
    }
    const profiles = this.listHarnessProfiles();
    const id = input.id || `profile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const previous = profiles.find((profile) => profile.id === id);
    const now = new Date().toISOString();
    const profile: HarnessProfile = {
      id,
      name,
      harness: input.harness,
      enabled: input.enabled !== false,
      ...(input.model ? { model: String(input.model).slice(0, 160) } : {}),
      createdAt: previous?.createdAt || now,
      updatedAt: now,
    };
    const next = previous ? profiles.map((item) => item.id === id ? profile : item) : [...profiles, profile];
    this.atomicWrite(this.harnessProfilesPath, JSON.stringify(next, null, 2));
    this.emit('harness_profiles_updated', next);
    return profile;
  }

  public deleteHarnessProfile(profileId: string): boolean {
    const profiles = this.listHarnessProfiles();
    const next = profiles.filter((profile) => profile.id !== profileId);
    if (next.length === profiles.length) return false;
    this.atomicWrite(this.harnessProfilesPath, JSON.stringify(next, null, 2));
    this.emit('harness_profiles_updated', next);
    return true;
  }

  public listModelProviderProfiles(): ModelProviderProfile[] {
    try {
      let profiles: ModelProviderProfile[] = [];
      if (fs.existsSync(this.modelProviderProfilesPath)) {
        const value = JSON.parse(fs.readFileSync(this.modelProviderProfilesPath, 'utf8'));
        if (Array.isArray(value)) {
          profiles = value.map((item) => ({
            ...item,
            provider: item.provider === 'openrouter' ? 'openrouter' : 'bedrock',
            credentialMode: item.credentialMode === 'managed' ? 'managed' : 'byo',
            region: typeof item.region === 'string' ? item.region : undefined,
            // Older local profiles stored the STS external ID inline. Do not expose or reuse it.
            externalId: undefined,
          })).map(({ externalId: _externalId, ...profile }) => profile as ModelProviderProfile);
        }
      }
      if (profiles.length === 0) {
        const defaultProfile: ModelProviderProfile = {
          id: 'lyra-managed-bedrock',
          name: 'Lyra Managed Bedrock (Nova Pro)',
          provider: 'bedrock',
          credentialMode: 'managed',
          model: 'us.amazon.nova-pro-v1:0',
          region: 'us-east-2',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        profiles = [defaultProfile];
        this.atomicWrite(this.modelProviderProfilesPath, JSON.stringify(profiles, null, 2));
      }
      return profiles;
    } catch {
      return [{
        id: 'lyra-managed-bedrock',
        name: 'Lyra Managed Bedrock (Nova Pro)',
        provider: 'bedrock',
        credentialMode: 'managed',
        model: 'us.amazon.nova-pro-v1:0',
        region: 'us-east-2',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }];
    }
  }

  public saveModelProviderProfile(input: { id?: string; name: string; provider: 'bedrock' | 'openrouter'; credentialMode?: 'byo' | 'managed'; region?: string; model: string; roleArn?: string; secretRef?: string }): ModelProviderProfile {
    const name = String(input.name || '').trim().slice(0, 80);
    if (input.provider !== 'bedrock' && input.provider !== 'openrouter') throw new Error('Only Amazon Bedrock and OpenRouter model providers are supported.');
    if (input.credentialMode !== undefined && input.credentialMode !== 'byo' && input.credentialMode !== 'managed') throw new Error('Credential mode must be byo or managed.');
    const region = input.provider === 'bedrock' ? String(input.region || '').trim().slice(0, 64) : undefined;
    const model = String(input.model || '').trim().slice(0, 200);
    const roleArn = input.roleArn ? String(input.roleArn).trim().slice(0, 300) : undefined;
    if (!name || !model) throw new Error('Provider profile requires a name and model ID.');
    if (input.provider === 'bedrock' && !region) throw new Error('Bedrock profile requires an AWS region.');
    if (region && !/^[a-z]{2}(-gov)?-[a-z]+-\d$/.test(region)) throw new Error('Bedrock region is invalid.');
    if (input.provider === 'openrouter' && roleArn) throw new Error('IAM roles can only be configured for Bedrock.');
    if (roleArn && !/^arn:(aws|aws-us-gov|aws-cn):iam::\d{12}:role\/[A-Za-z0-9+=,.@_/-]+$/.test(roleArn)) throw new Error('Role ARN must identify an IAM role in an AWS account.');
    const profiles = this.listModelProviderProfiles();
    const id = input.id || `provider-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const previous = profiles.find((profile) => profile.id === id);
    if (previous && (previous.provider !== input.provider || previous.model !== model || previous.region !== region)) this.deleteModelCompatibility(id);
    const now = new Date().toISOString();
    const profile: ModelProviderProfile = { id, name, provider: input.provider, credentialMode: input.credentialMode || 'byo', ...(region ? { region } : {}), model, ...(roleArn ? { roleArn } : {}), ...(input.secretRef ? { secretRef: input.secretRef } : {}), createdAt: previous?.createdAt || now, updatedAt: now };
    const next = previous ? profiles.map((item) => item.id === id ? profile : item) : [...profiles, profile];
    this.atomicWrite(this.modelProviderProfilesPath, JSON.stringify(next, null, 2));
    this.emit('model_provider_profiles_updated', next);
    return profile;
  }

  public saveBedrockProfile(input: { id?: string; name: string; region: string; model: string; roleArn?: string; externalId?: string }): ModelProviderProfile {
    if (input.externalId) throw new Error('External IDs must be stored in Secrets Manager, not in the local profile store.');
    return this.saveModelProviderProfile({ ...input, provider: 'bedrock', credentialMode: 'byo' });
  }

  public deleteModelProviderProfile(profileId: string): boolean {
    const profiles = this.listModelProviderProfiles();
    const next = profiles.filter((profile) => profile.id !== profileId);
    if (next.length === profiles.length) return false;
    this.atomicWrite(this.modelProviderProfilesPath, JSON.stringify(next, null, 2));
    this.deleteModelCompatibility(profileId);
    this.emit('model_provider_profiles_updated', next);
    return true;
  }

  private getModelCompatibilityPath() { return path.join(path.dirname(this.modelProviderProfilesPath), 'model-compatibility.json'); }

  public getModelCompatibility(profileId: string): ModelCompatibilityResult | null {
    if (profileId === 'lyra-managed-bedrock') {
      return {
        profileId,
        provider: 'bedrock',
        model: 'us.amazon.nova-pro-v1:0',
        tier: 'full',
        testedAt: new Date().toISOString(),
        suiteVersion: '1.0',
        warnings: [],
        capabilities: {
          streaming: { passed: true },
          toolCalling: { passed: true },
          structuredOutput: { passed: true },
          cancellation: { passed: true },
          sessionResume: { passed: true },
        },
      };
    }
    try { const values = JSON.parse(fs.readFileSync(this.getModelCompatibilityPath(), 'utf8')) as Record<string, ModelCompatibilityResult>; return values[profileId] || null; }
    catch { return null; }
  }

  public saveModelCompatibility(profileId: string, result: ModelCompatibilityResult): void {
    const file = this.getModelCompatibilityPath();
    let values: Record<string, ModelCompatibilityResult> = {};
    try { values = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    values[profileId] = { ...result, profileId };
    this.atomicWrite(file, JSON.stringify(values, null, 2));
  }

  private deleteModelCompatibility(profileId: string): void {
    const file = this.getModelCompatibilityPath();
    let values: Record<string, ModelCompatibilityResult> = {};
    try { values = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }
    delete values[profileId];
    this.atomicWrite(file, JSON.stringify(values, null, 2));
  }

  public addSwarmMessage(sessionId: string, runId: string, message: Omit<SwarmMessage, 'id' | 'runId' | 'createdAt'>): SwarmMessage | null {
    const run = this.getRun(sessionId, runId);
    if (!run) return null;
    const item: SwarmMessage = {
      ...message,
      id: `swarm-message-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      runId,
      text: String(message.text).slice(0, 8000),
      createdAt: new Date().toISOString(),
    };
    const messages = [...(run.messages || []), item];
    this.updateRun(sessionId, runId, { messages });
    this.appendEvent(sessionId, {
      agent: 'orchestrator', type: 'status', runId,
      payload: { swarmMessage: item },
    });
    this.emit('swarm_message', { sessionId, runId, message: item });
    return item;
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

  private readLastEvent(eventsPath: string): UnifiedEvent | null {
    if (!fs.existsSync(eventsPath)) return null;
    const fd = fs.openSync(eventsPath, 'r');
    try {
      let position = fs.fstatSync(fd).size;
      let suffix = '';
      while (position > 0) {
        const size = Math.min(8192, position);
        position -= size;
        const buffer = Buffer.alloc(size);
        fs.readSync(fd, buffer, 0, size, position);
        suffix = buffer.toString('utf8') + suffix;
        if (suffix.includes('\n')) break;
      }
      const line = suffix.split('\n').filter(Boolean).at(-1);
      return line ? JSON.parse(line) as UnifiedEvent : null;
    } finally { fs.closeSync(fd); }
  }

  public listSessions(): UnifiedSessionMeta[] {
    const sessionsDir = this.getSessionsDir();
    if (!fs.existsSync(sessionsDir)) return [];

    try {
      const dirs = fs.readdirSync(sessionsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'));

      const nonChatPrefixes = [
        'codex-',
        'agy-',
      ];

      const result: UnifiedSessionMeta[] = [];

      for (const d of dirs) {
        if (nonChatPrefixes.some((prefix) => d.name.startsWith(prefix))) {
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

        // If title is missing or just the ID, try to extract the first user message
        if (!meta.title || meta.title === d.name) {
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
                    const raw = String(ev.payload.text).trim();
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

    // Read only the final JSONL record so long conversations do not make each append O(history).
    let lastEvent: UnifiedEvent | null = null;
    try { lastEvent = this.readLastEvent(eventsPath); } catch {}
    if (lastEvent && lastEvent.agent === fullEvent.agent && lastEvent.type === fullEvent.type && JSON.stringify(lastEvent.payload) === JSON.stringify(fullEvent.payload)) return lastEvent;

    let priorSequence = this.sessionSequences.get(sessionId);
    if (priorSequence === undefined) {
      if (lastEvent?.sequence !== undefined) {
        priorSequence = lastEvent.sequence;
      } else {
        try { priorSequence = Number(fs.readFileSync(path.join(sessionDir, 'event-sequence.txt'), 'utf8')) || 0; } catch { priorSequence = 0; }
      }
    }
    const nextSeq = (priorSequence || 0) + 1;
    this.sessionSequences.set(sessionId, nextSeq);
    fullEvent.sequence = nextSeq;

    fs.appendFileSync(eventsPath, JSON.stringify(fullEvent) + '\n', 'utf-8');
    this.atomicWrite(path.join(sessionDir, 'event-sequence.txt'), String(fullEvent.sequence));

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

  public saveAgentCheckpoint(input: Omit<AgentCheckpoint, 'sequence' | 'timestamp'> & { sequence?: number; timestamp?: string }): AgentCheckpoint {
    const sessionDir = this.getSessionDir(input.sessionId);
    if (!fs.existsSync(sessionDir)) this.createSession({ id: input.sessionId, title: input.sessionId, workspacePath: input.workspacePath });
    const file = path.join(sessionDir, 'agent-checkpoints.json');
    let checkpoints: AgentCheckpoint[] = [];
    try { checkpoints = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    const previous = checkpoints.filter((item) => item.runId === input.runId).at(-1);
    const checkpoint: AgentCheckpoint = {
      ...input,
      sequence: input.sequence ?? (previous?.sequence || 0) + 1,
      timestamp: input.timestamp || new Date().toISOString(),
    };
    checkpoints.push(checkpoint);
    this.atomicWrite(file, JSON.stringify(checkpoints, null, 2));
    this.appendEvent(input.sessionId, {
      agent: 'orchestrator', type: 'status', runId: input.runId,
      payload: { agentCheckpoint: checkpoint },
    });
    return checkpoint;
  }

  public getLatestAgentCheckpoint(sessionId: string, runId: string): AgentCheckpoint | null {
    try {
      const entries = JSON.parse(fs.readFileSync(path.join(this.getSessionDir(sessionId), 'agent-checkpoints.json'), 'utf8')) as AgentCheckpoint[];
      return entries.filter((item) => item.runId === runId).at(-1) || null;
    } catch { return null; }
  }

  public listAgentCheckpoints(sessionId: string): AgentCheckpoint[] {
    try { return JSON.parse(fs.readFileSync(path.join(this.getSessionDir(sessionId), 'agent-checkpoints.json'), 'utf8')) as AgentCheckpoint[]; }
    catch { return []; }
  }

  public listInterruptedAgentRuns(): AgentCheckpoint[] {
    const interrupted: AgentCheckpoint[] = [];
    for (const session of this.listSessions()) {
      try {
        const entries = JSON.parse(fs.readFileSync(path.join(this.getSessionDir(session.id), 'agent-checkpoints.json'), 'utf8')) as AgentCheckpoint[];
        const byRun = new Map<string, AgentCheckpoint>();
        for (const entry of entries) byRun.set(entry.runId, entry);
        for (const checkpoint of byRun.values()) if (checkpoint.state === 'running' || (checkpoint.state === 'paused' && checkpoint.kind === 'approval-requested')) interrupted.push(checkpoint);
      } catch {}
    }
    return interrupted;
  }

  public saveRunCheckpoint(sessionId: string, runId: string, checkpoint: RunCheckpoint): void {
    const sessionDir = this.getSessionDir(sessionId);
    if (!fs.existsSync(sessionDir)) return;
    const file = path.join(sessionDir, `run-${runId}-checkpoint.json`);
    this.atomicWrite(file, JSON.stringify(checkpoint, null, 2));
    this.appendEvent(sessionId, {
      agent: 'orchestrator',
      type: 'status',
      runId,
      payload: { runCheckpoint: checkpoint },
    });
  }

  public getLatestRunCheckpoint(sessionId: string, runId: string): RunCheckpoint | null {
    try {
      const file = path.join(this.getSessionDir(sessionId), `run-${runId}-checkpoint.json`);
      if (!fs.existsSync(file)) return null;
      return JSON.parse(fs.readFileSync(file, 'utf8')) as RunCheckpoint;
    } catch {
      return null;
    }
  }

  public listInterruptedRuns(): Array<{ sessionId: string; run: TeamRun; checkpoint: RunCheckpoint | null }> {
    const interrupted: Array<{ sessionId: string; run: TeamRun; checkpoint: RunCheckpoint | null }> = [];
    for (const session of this.listSessions()) {
      const runs = this.listRuns(session.id);
      for (const run of runs) {
        if (run.state === 'executing' || run.state === 'planning' || run.state === 'awaiting-approval' || run.state === 'reviewing' || run.state === 'verifying') {
          const cp = this.getLatestRunCheckpoint(session.id, run.id);
          interrupted.push({ sessionId: session.id, run, checkpoint: cp });
        }
      }
    }
    return interrupted;
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

  public getRunsDir(sessionId: string): string {
    const sessionDir = this.getSessionDir(sessionId);
    const runsDir = path.join(sessionDir, 'runs');
    if (!fs.existsSync(runsDir)) {
      fs.mkdirSync(runsDir, { recursive: true });
    }
    return runsDir;
  }

  public createRun(run: TeamRun): TeamRun {
    const runsDir = this.getRunsDir(run.sessionId);
    const runFilePath = path.join(runsDir, `${assertSafeId(run.id, 'run ID')}.json`);
    this.atomicWrite(runFilePath, JSON.stringify(run, null, 2));
    this.emit('team_run_created', run);
    return run;
  }

  public getRun(sessionId: string, runId: string): TeamRun | null {
    try {
      const runsDir = this.getRunsDir(sessionId);
      const runFilePath = path.join(runsDir, `${assertSafeId(runId, 'run ID')}.json`);
      if (!fs.existsSync(runFilePath)) return null;
      return JSON.parse(fs.readFileSync(runFilePath, 'utf-8'));
    } catch {
      return null;
    }
  }

  public listRuns(sessionId: string): TeamRun[] {
    try {
      const runsDir = this.getRunsDir(sessionId);
      if (!fs.existsSync(runsDir)) return [];
      const files = fs.readdirSync(runsDir).filter((f) => f.endsWith('.json'));
      const runs: TeamRun[] = [];
      for (const f of files) {
        try {
          const run = JSON.parse(fs.readFileSync(path.join(runsDir, f), 'utf-8'));
          runs.push(run);
        } catch {}
      }
      return runs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch {
      return [];
    }
  }

  public updateRun(sessionId: string, runId: string, updates: Partial<TeamRun>): TeamRun | null {
    const current = this.getRun(sessionId, runId);
    if (!current) return null;
    const updated: TeamRun = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    const runsDir = this.getRunsDir(sessionId);
    const runFilePath = path.join(runsDir, `${assertSafeId(runId, 'run ID')}.json`);
    this.atomicWrite(runFilePath, JSON.stringify(updated, null, 2));
    this.emit('team_run_updated', updated);
    return updated;
  }

  public addTaskToRun(sessionId: string, runId: string, task: TaskItem): TaskItem | null {
    const run = this.getRun(sessionId, runId);
    if (!run) return null;
    const existingIndex = run.tasks.findIndex((t) => t.id === task.id);
    if (existingIndex >= 0) {
      run.tasks[existingIndex] = task;
    } else {
      run.tasks.push(task);
    }
    this.updateRun(sessionId, runId, { tasks: run.tasks });
    this.emit('task_updated', { sessionId, runId, task });
    return task;
  }

  public updateRunTask(sessionId: string, runId: string, taskId: string, updates: Partial<TaskItem>): TaskItem | null {
    const run = this.getRun(sessionId, runId);
    if (!run) return null;
    const taskIndex = run.tasks.findIndex((t) => t.id === taskId);
    if (taskIndex < 0) return null;
    const current = run.tasks[taskIndex];
    if (!current) return null;
    const updatedTask: TaskItem = {
      ...current,
      ...updates,
      id: current.id,
      runId: current.runId,
      title: updates.title ?? current.title,
      assignedAgent: updates.assignedAgent ?? current.assignedAgent,
      stage: updates.stage ?? current.stage,
      status: updates.status ?? current.status,
    };
    run.tasks[taskIndex] = updatedTask;
    this.updateRun(sessionId, runId, { tasks: run.tasks });
    this.emit('task_updated', { sessionId, runId, task: updatedTask });
    return updatedTask;
  }

  public addCheckToRun(sessionId: string, runId: string, check: CheckItem): CheckItem | null {
    const run = this.getRun(sessionId, runId);
    if (!run) return null;
    const existingIndex = run.checks.findIndex((c) => c.id === check.id);
    if (existingIndex >= 0) {
      run.checks[existingIndex] = check;
    } else {
      run.checks.push(check);
    }
    this.updateRun(sessionId, runId, { checks: run.checks });
    this.emit('check_updated', { sessionId, runId, check });
    return check;
  }

  public updateRunCheck(sessionId: string, runId: string, checkId: string, updates: Partial<CheckItem>): CheckItem | null {
    const run = this.getRun(sessionId, runId);
    if (!run) return null;
    const checkIndex = run.checks.findIndex((c) => c.id === checkId);
    if (checkIndex < 0) return null;
    const current = run.checks[checkIndex];
    if (!current) return null;
    const updatedCheck: CheckItem = {
      ...current,
      ...updates,
      id: current.id,
      runId: current.runId,
      name: updates.name ?? current.name,
      command: updates.command ?? current.command,
      status: updates.status ?? current.status,
    };
    run.checks[checkIndex] = updatedCheck;
    this.updateRun(sessionId, runId, { checks: run.checks });
    this.emit('check_updated', { sessionId, runId, check: updatedCheck });
    return updatedCheck;
  }
}
