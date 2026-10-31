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
  }): Promise<{ sessionId: string; runId: string; status: string }> {
    const hubUrl = this.authManager.getHubUrl();
    const headers = await this.getHeaders();

    const res = await fetch(`${hubUrl}/api/gateway/dispatch`, {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Dispatch failed' })) as any;
      throw new Error(err.error || `Dispatch failed with status ${res.status}`);
    }

    return await res.json() as any;
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

    return await res.json() as any;
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
}
