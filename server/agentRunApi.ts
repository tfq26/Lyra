import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AHPServer } from './ahpProtocol';
import type { PolicyProfile } from './cloudwatchEmf';
import { modelCouncil, type CouncilMode } from './modelCouncil';
import {
  buildStructuredPrompt,
  normalizeJsonOutput,
  type OpenAiResponseFormat,
} from './openaiCompatBridge';
import {
  extractProjectApiKey,
  type ProjectCapability,
  type ProjectRegistry,
  type PublicProjectRecord,
} from './projectRegistry';

export interface AgentRunRequest {
  prompt: string;
  capability?: Extract<ProjectCapability, 'ask' | 'agent' | 'council'>;
  mode?: 'sync' | 'async';
  policyProfile?: PolicyProfile;
  model?: string;
  sessionId?: string;
  workspacePath?: string;
  councilMode?: CouncilMode;
  responseFormat?: OpenAiResponseFormat;
  webhookUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentRunRecord {
  runId: string;
  projectId: string;
  sessionId: string;
  capability: 'ask' | 'agent' | 'council';
  status: 'queued' | 'running' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  output?: string;
  structuredOutput?: unknown;
  modelUsed?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    estimatedCostUsd?: number;
  };
  error?: string;
}

const MAX_PROMPT_CHARS = 120_000;

export function assertSafeWebhookUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid webhookUrl.');
  }

  const allowHttp = process.env.LYRA_ALLOW_HTTP_WEBHOOKS === 'true';
  if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) {
    throw new Error('webhookUrl must use https://.');
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
    /^fe80:/i.test(host) ||
    /^fc00:|^fd/i.test(host)
  ) {
    throw new Error('webhookUrl targets a disallowed internal or private network address.');
  }

  return parsed.toString();
}

export class AgentRunApi {
  private readonly runs = new Map<string, AgentRunRecord>();
  private readonly activeRunsByProject = new Map<string, number>();

  constructor(
    private readonly ahpServer: AHPServer,
    private readonly projectRegistry: ProjectRegistry,
    private readonly council = modelCouncil
  ) {}

  private authenticateRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): PublicProjectRecord | null {
    const rawKey = extractProjectApiKey(req);
    const project = this.projectRegistry.authenticate(rawKey);
    if (!project) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: 'Valid Lyra project API key required (Authorization: Bearer lyra_proj_... or x-lyra-project).',
            type: 'authentication_error',
          },
        })
      );
      return null;
    }

    const budget = this.projectRegistry.checkBudget(project.id);
    if (!budget.allowed) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: budget.reason || `Budget exceeded for project ${project.name}.`,
            type: 'insufficient_quota',
          },
        })
      );
      return null;
    }

    return project;
  }

  private resolveScratchWorkspace(projectId: string, requested?: string): string {
    if (requested && requested.trim()) return requested.trim();
    const preferred = path.join(os.homedir(), '.lyra', 'projects', projectId, 'scratch');
    try {
      if (!fs.existsSync(preferred)) fs.mkdirSync(preferred, { recursive: true });
      return preferred;
    } catch {
      const fallback = path.join(os.tmpdir(), 'lyra-projects', projectId, 'scratch');
      if (!fs.existsSync(fallback)) fs.mkdirSync(fallback, { recursive: true });
      return fallback;
    }
  }

  private async executeRun(record: AgentRunRecord, body: AgentRunRequest, project: PublicProjectRecord): Promise<void> {
    record.status = 'running';
    record.updatedAt = new Date().toISOString();

    const workspacePath = this.resolveScratchWorkspace(project.id, body.workspacePath);
    const policyProfile = body.policyProfile || project.defaultPolicyProfile || 'balanced';
    const prompt = buildStructuredPrompt(body.prompt.trim(), body.responseFormat);

    try {
      if (record.capability === 'council') {
        const result = await this.council.analyze({
          question: prompt,
          workspacePath,
          sessionId: record.sessionId,
          mode: body.councilMode || 'architecture-debate',
          policyProfile,
        });
        const rawText = result.formattedMarkdown || result.recommendedSolution || JSON.stringify(result);
        const output = body.responseFormat && body.responseFormat.type !== 'text'
          ? normalizeJsonOutput(rawText)
          : rawText;

        record.output = output;
        record.modelUsed = result.chairModel;
        record.usage = { estimatedCostUsd: result.estimatedCostUsd };
        if (body.responseFormat && body.responseFormat.type !== 'text') {
          try {
            record.structuredOutput = JSON.parse(output);
          } catch {
            // Leave structuredOutput undefined if model returned non-JSON
          }
        }
        this.projectRegistry.recordUsage(project.id, result.estimatedCostUsd || 0, 0);
      } else {
        const turnResult = await this.ahpServer.executeChatTurn({
          sessionId: record.sessionId,
          prompt,
          workspacePath,
          policyProfile,
          pinnedModelId: body.model && !body.model.startsWith('lyra') ? body.model : undefined,
        });
        const output = body.responseFormat && body.responseFormat.type !== 'text'
          ? normalizeJsonOutput(turnResult.content)
          : turnResult.content;

        const promptTokens = turnResult.telemetry?.inputTokens ?? 0;
        const completionTokens = turnResult.telemetry?.outputTokens ?? 0;
        const totalTokens = promptTokens + completionTokens;
        const estimatedCostUsd = turnResult.telemetry?.estimatedCostUsd ?? 0;

        record.output = output;
        record.modelUsed = turnResult.route?.modelId || turnResult.telemetry?.modelId;
        record.usage = { promptTokens, completionTokens, totalTokens, estimatedCostUsd };

        if (body.responseFormat && body.responseFormat.type !== 'text') {
          try {
            record.structuredOutput = JSON.parse(output);
          } catch {
            // Leave structuredOutput undefined if model returned non-JSON
          }
        }

        this.projectRegistry.recordUsage(project.id, estimatedCostUsd, totalTokens);
      }

      record.status = 'completed';
      record.completedAt = new Date().toISOString();
      record.updatedAt = record.completedAt;
    } catch (err: any) {
      record.status = 'failed';
      record.error = err?.message || String(err);
      record.updatedAt = new Date().toISOString();
    }

    if (body.webhookUrl) {
      void fetch(body.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      }).catch(() => undefined);
    }
  }

  public async handleCreateRun(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    body: AgentRunRequest
  ): Promise<void> {
    const project = this.authenticateRequest(req, res);
    if (!project) return;

    const prompt = String(body?.prompt || '').trim();
    if (!prompt) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'prompt is required.', type: 'invalid_request_error' } }));
      return;
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `prompt exceeds maximum length (${MAX_PROMPT_CHARS} chars).`, type: 'invalid_request_error' } }));
      return;
    }

    let safeWebhookUrl: string | undefined;
    if (body.webhookUrl) {
      try {
        safeWebhookUrl = assertSafeWebhookUrl(body.webhookUrl);
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: err?.message || 'Invalid webhookUrl.', type: 'invalid_request_error' } }));
        return;
      }
    }

    const activeCount = this.activeRunsByProject.get(project.id) || 0;
    const maxConcurrent = project.maxConcurrentRuns ?? 4;
    if (activeCount >= maxConcurrent) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `Concurrent run limit (${maxConcurrent}) reached for project ${project.name}.`, type: 'rate_limit_exceeded' } }));
      return;
    }

    const capability = body.capability || 'agent';
    if (!project.allowedCapabilities.includes(capability)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: `Capability '${capability}' is not enabled for project ${project.name}.`, type: 'permission_error' },
        })
      );
      return;
    }

    const runId = `agrun-${crypto.randomBytes(6).toString('hex')}`;
    const baseSession = body.sessionId || `run-${runId}`;
    const now = new Date().toISOString();

    const record: AgentRunRecord = {
      runId,
      projectId: project.id,
      sessionId: `${project.id}:${baseSession}`,
      capability,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    };
    this.runs.set(runId, record);
    this.activeRunsByProject.set(project.id, activeCount + 1);
    const runPromise = this.executeRun(record, { ...body, webhookUrl: safeWebhookUrl }, project).finally(() => {
      const current = this.activeRunsByProject.get(project.id) || 1;
      if (current <= 1) this.activeRunsByProject.delete(project.id);
      else this.activeRunsByProject.set(project.id, current - 1);
    });

    if (body.mode === 'async') {
      void runPromise;
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(record));
      return;
    }

    await runPromise;
    const statusCode = record.status === 'failed' ? 500 : 200;
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(record));
  }

  public handleGetRun(req: http.IncomingMessage, res: http.ServerResponse, runId: string): void {
    const project = this.authenticateRequest(req, res);
    if (!project) return;

    const record = this.runs.get(runId);
    if (!record || record.projectId !== project.id) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Agent run not found.', type: 'not_found_error' } }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(record));
  }
}
