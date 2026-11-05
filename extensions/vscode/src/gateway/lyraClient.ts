import type { AuthManager } from '../auth/authManager';

export interface TaskStatus {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  assignedModel?: string;
  assignedAgent?: string;
}

export interface RunTelemetry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  elapsedSeconds: number;
}

export interface RunStatusResult {
  runId: string;
  stage: string;
  state: string;
  tasks: TaskStatus[];
  checks: Array<{ id: string; name: string; status: string }>;
  telemetry?: RunTelemetry;
  summary?: string;
}

export interface ProposedFilePatchDto {
  filePath: string;
  isNewFile: boolean;
  originalContent: string;
  updatedContent: string;
  unifiedDiff: string;
  verifiedSyntax: boolean;
  verificationNote?: string;
}

export interface FastLanePatchBundleDto {
  summary: string;
  edits: ProposedFilePatchDto[];
  allVerified: boolean;
}

export interface AhpChatStreamParams {
  sessionId?: string;
  prompt: string;
  workspacePath: string;
  modePreference?: 'auto' | 'ask' | 'fast-patch' | 'full-swarm';
  policyProfile?: 'frugal' | 'balanced' | 'frontier';
  pinnedModelId?: string;
  activeFilePath?: string;
  selectionText?: string;
  finopsMaxBudgetUsd?: number;
}

export class LyraClient {
  constructor(private authManager: AuthManager) {}

  private async getHeaders(): Promise<Record<string, string>> {
    const token = await this.authManager.getToken();
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  public async dispatchTask(params: {
    objective: string;
    workspacePath: string;
    model?: string;
    policyProfile?: 'frugal' | 'balanced' | 'frontier';
  }): Promise<{ sessionId: string; runId: string; status: string }> {
    const hubUrl = this.authManager.getHubUrl();
    const headers = await this.getHeaders();

    const res = await fetch(`${hubUrl}/api/gateway/dispatch`, {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({ error: 'Dispatch failed' }))) as any;
      throw new Error(err.error || `Dispatch failed with status ${res.status}`);
    }

    return (await res.json()) as any;
  }

  public async streamAhpChat(
    params: AhpChatStreamParams,
    handlers: {
      onTriage?: (data: any) => void;
      onStatus?: (status: string) => void;
      onChunk?: (chunk: string) => void;
      onDone?: (finalResult: any) => void;
    }
  ): Promise<any> {
    const hubUrl = this.authManager.getHubUrl();
    const headers = await this.getHeaders();
    headers.Accept = 'text/event-stream';

    const res = await fetch(`${hubUrl}/api/gateway/ahp/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...params, stream: true }),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({ error: `Chat request failed (${res.status})` }))) as any;
      throw new Error(err.error || `Chat request failed with status ${res.status}`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream') || !res.body) {
      const data = await res.json();
      handlers.onDone?.(data);
      return data;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalPayload: any = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIdx: number;
      while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
        const rawBlock = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);

        let eventName = 'message';
        let dataLine = '';
        for (const line of rawBlock.split('\n')) {
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataLine += line.slice(5).trim();
          }
        }
        if (!dataLine) continue;

        let parsed: any;
        try {
          parsed = JSON.parse(dataLine);
        } catch {
          continue;
        }

        if (eventName === 'triage') {
          handlers.onTriage?.(parsed);
        } else if (eventName === 'status') {
          handlers.onStatus?.(parsed.status);
        } else if (eventName === 'chunk') {
          handlers.onChunk?.(parsed.chunk);
        } else if (eventName === 'done') {
          finalPayload = parsed;
          handlers.onDone?.(parsed);
        } else if (eventName === 'error') {
          throw new Error(parsed.error || 'Streaming execution error');
        }
      }
    }

    return finalPayload;
  }

  public async escalateToSwarm(params: {
    sessionId: string;
    prompt?: string;
    workspacePath: string;
    policyProfile?: 'frugal' | 'balanced' | 'frontier';
    pinnedModelId?: string;
  }): Promise<any> {
    const hubUrl = this.authManager.getHubUrl();
    const headers = await this.getHeaders();
    const res = await fetch(`${hubUrl}/api/gateway/ahp/escalate`, {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ error: 'Escalation failed' }))) as any;
      throw new Error(err.error || `Escalation failed (${res.status})`);
    }
    return await res.json();
  }

  public async getModelCatalog(): Promise<{
    paretoCatalog: Array<{ id: string; name: string; provider: string; tier: number }>;
    policyProfiles: Array<{ id: string; label: string; description: string }>;
  }> {
    const hubUrl = this.authManager.getHubUrl();
    const res = await fetch(`${hubUrl}/api/models/catalog`);
    if (!res.ok) {
      return { paretoCatalog: [], policyProfiles: [] };
    }
    return (await res.json()) as any;
  }

  public async getRunStatus(runId: string, sessionId?: string): Promise<RunStatusResult> {
    const hubUrl = this.authManager.getHubUrl();
    const headers = await this.getHeaders();
    const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';

    const res = await fetch(`${hubUrl}/api/gateway/runs/${runId}/status${query}`, {
      headers,
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch run status: ${res.statusText}`);
    }

    return (await res.json()) as any;
  }

  public async getHandoff(workspacePath?: string, runId?: string) {
    const hubUrl = this.authManager.getHubUrl();
    const headers = await this.getHeaders();
    const params = new URLSearchParams();
    if (workspacePath) params.set('workspacePath', workspacePath);
    if (runId) params.set('runId', runId);

    const res = await fetch(`${hubUrl}/api/gateway/handoff?${params.toString()}`, {
      headers,
    });

    if (!res.ok) return null;
    return await res.json();
  }

  public async listAhpSessions() {
    const hubUrl = this.authManager.getHubUrl();
    const headers = await this.getHeaders();
    const res = await fetch(`${hubUrl}/api/gateway/ahp/sessions`, { headers });
    if (!res.ok) return { sessions: [] };
    return (await res.json()) as { sessions: any[] };
  }

  public async getAhpSession(sessionId: string) {
    const hubUrl = this.authManager.getHubUrl();
    const headers = await this.getHeaders();
    const res = await fetch(
      `${hubUrl}/api/gateway/ahp/sessions/${encodeURIComponent(sessionId)}`,
      { headers }
    );
    if (!res.ok) throw new Error(`Session ${sessionId} not found`);
    return (await res.json()) as any;
  }

  public async createAhpSession(params: {
    title?: string;
    workspacePath?: string;
    model?: string;
  }) {
    const hubUrl = this.authManager.getHubUrl();
    const headers = await this.getHeaders();
    const res = await fetch(`${hubUrl}/api/gateway/ahp/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error('Failed to create session');
    return (await res.json()) as any;
  }
}
