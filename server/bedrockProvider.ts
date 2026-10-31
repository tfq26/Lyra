import fs from 'fs';
import os from 'os';
import path from 'path';
import { Agent, SessionManager, tool, type AgentConfig } from '@strands-agents/sdk';
import { BedrockModel } from '@strands-agents/sdk/models/bedrock';
import { LocalFileStorage, S3Storage } from '@strands-agents/sdk/storage';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import type { ModelProviderProfile } from './types';
import { loadProviderCredential } from './providerSecrets';
import { createSessionManager, createStrandsModel } from './modelFactory';

export interface BedrockCompletion {
  text: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

interface PlannerContext {
  sessionId: string;
  runId: string;
  workspacePath: string;
  storagePath: string;
}

interface StrandsTestHooks {
  assumeRole?: (profile: ModelProviderProfile) => Promise<{ accessKeyId: string; secretAccessKey: string; sessionToken: string } | undefined>;
  invoke?: (config: AgentConfig, prompt: string) => Promise<BedrockCompletion>;
}

const excludedDirectories = new Set(['.git', '.lyra', '.hermes', '.codex', '.claude', '.gemini', '.aws', '.ssh', 'node_modules', 'vendor', 'dist', 'target']);
const excludedFiles = new Set(['id_rsa', 'id_ed25519', 'credentials', '.npmrc', '.pypirc', '.netrc', 'secrets.json']);

function isExcludedFileName(name: string): boolean {
  const normalized = name.toLowerCase();
  return excludedFiles.has(normalized) || normalized.startsWith('.env') || normalized.endsWith('.pem') || normalized.endsWith('.key');
}

function resolveProjectPath(workspacePath: string, requestedPath: string): string {
  const root = fs.realpathSync(workspacePath);
  const resolved = path.resolve(root, requestedPath || '.');
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error('Requested path is outside the assigned project worktree.');
  const real = fs.realpathSync(resolved);
  if (real !== root && !real.startsWith(`${root}${path.sep}`)) throw new Error('Symlink target is outside the assigned project worktree.');
  const segments = path.relative(root, real).split(path.sep).filter(Boolean);
  if (segments.some((segment) => excludedDirectories.has(segment.toLowerCase()) || isExcludedFileName(segment))) {
    throw new Error('The requested path is excluded from planner context.');
  }
  return real;
}

function makeReadOnlyTools(workspacePath: string) {
  const listFiles = tool({
    name: 'list_project_files',
    description: 'List source files and directories in the assigned project worktree. Excludes dependency, VCS, and secret directories.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Optional project-relative directory path.' } },
      additionalProperties: false,
    },
    callback: (input) => {
      const relative = String((input as { path?: unknown }).path || '.');
      const directory = resolveProjectPath(workspacePath, relative);
      const output: string[] = [];
      const visit = (current: string, depth: number) => {
        if (depth > 4 || output.length >= 240) return;
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          if (excludedDirectories.has(entry.name.toLowerCase())) continue;
          if (isExcludedFileName(entry.name)) continue;
          const fullPath = path.join(current, entry.name);
          const rel = path.relative(workspacePath, fullPath).split(path.sep).join('/');
          if (entry.isSymbolicLink()) continue;
          output.push(`${entry.isDirectory() ? 'dir' : 'file'} ${rel}`);
          if (entry.isDirectory()) visit(fullPath, depth + 1);
          if (output.length >= 240) break;
        }
      };
      visit(directory, 0);
      return output.join('\n') || 'No project files found in that directory.';
    },
  });

  const readFile = tool({
    name: 'read_project_file',
    description: 'Read a text file from the assigned project worktree. Never use this tool for credentials, environment files, or secrets.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Project-relative path to a text file.' } },
      required: ['path'],
      additionalProperties: false,
    },
    callback: (input) => {
      const relative = String((input as { path?: unknown }).path || '');
      if (!relative || isExcludedFileName(path.basename(relative))) throw new Error('This file is not available to the planner.');
      const resolved = resolveProjectPath(workspacePath, relative);
      if (!fs.statSync(resolved).isFile()) throw new Error('The requested path is not a file.');
      const bytes = fs.readFileSync(resolved);
      if (bytes.length > 48_000) throw new Error('File exceeds the planner read limit; request a smaller file or a specific section.');
      if (bytes.includes(0)) throw new Error('Binary files cannot be read by the planner tool.');
      return bytes.toString('utf8');
    },
  });

  return [listFiles, readFile];
}

export class BedrockProvider {
  constructor(private readonly testHooks: StrandsTestHooks = {}) {}

  private async assumeRole(profile: ModelProviderProfile, externalId?: string) {
    if (!profile.roleArn) return undefined;
    if (!externalId) throw new Error('Bedrock role profiles require an External ID stored in Secrets Manager.');
    const sts = new STSClient({ region: profile.region });
    try {
      const response = await sts.send(new AssumeRoleCommand({
        RoleArn: profile.roleArn,
        RoleSessionName: `lyra-${Date.now()}`,
        ExternalId: externalId,
        DurationSeconds: 900,
      }));
      const credentials = response.Credentials;
      if (!credentials?.AccessKeyId || !credentials.SecretAccessKey || !credentials.SessionToken) {
        throw new Error('AWS STS did not return temporary credentials for the configured role.');
      }
      return {
        accessKeyId: credentials.AccessKeyId,
        secretAccessKey: credentials.SecretAccessKey,
        sessionToken: credentials.SessionToken,
      };
    } finally {
      sts.destroy();
    }
  }

  public async generate(profile: ModelProviderProfile, prompt: string, context: PlannerContext): Promise<BedrockCompletion> {
    if (profile.provider === 'openrouter') {
      const model = await createStrandsModel(profile);
      const agentConfig: AgentConfig = {
        id: `planner-${context.runId}`,
        name: 'Lyra Planner',
        description: 'Read-only project planner that returns validated task plans for Lyra.',
        systemPrompt: 'You are a read-only software project planner. Inspect source only through the supplied read-only tools. Never claim changes were made or checks passed. Produce the requested structured plan and keep task scopes small enough to execute independently.',
        model,
        tools: makeReadOnlyTools(context.workspacePath),
        sessionManager: createSessionManager(`lyra-${context.sessionId.replace(/[^a-zA-Z0-9_-]/g, '-')}-planner`, context.storagePath, process.env.LYRA_TENANT_ID || 'local'),
      };
      return this.testHooks.invoke ? this.testHooks.invoke(agentConfig, prompt) : this.invokeStrands(agentConfig, prompt);
    }
    if (process.env.LYRA_HOSTED === 'true' && profile.credentialMode !== 'managed' && !profile.roleArn) {
      throw new Error('Hosted Bedrock connections must use an explicitly configured customer IAM role.');
    }
    const secret = await loadProviderCredential(profile);
    const credentials = this.testHooks.assumeRole
      ? await this.testHooks.assumeRole(profile)
      : await this.assumeRole(profile, secret.externalId || profile.externalId);
    const model = new BedrockModel({
      modelId: profile.model,
      region: profile.region,
      maxTokens: 8192,
      temperature: 0.2,
      cacheConfig: { strategy: 'auto' },
      ...(credentials ? { clientConfig: { credentials } } : {}),
    });

    const bucket = process.env.LYRA_STRANDS_SESSION_BUCKET;
    const tenantId = process.env.LYRA_TENANT_ID;
    if (bucket && process.env.LYRA_HOSTED === 'true' && !tenantId) {
      throw new Error('S3-backed Strands sessions require an authenticated tenant ID to isolate session keys.');
    }
    const sessionId = `lyra-${context.sessionId.replace(/[^a-zA-Z0-9_-]/g, '-')}-planner`;
    const storage = bucket
      ? new S3Storage(bucket, { prefix: `lyra/strands/${(tenantId || 'local').replace(/[^a-zA-Z0-9_-]/g, '-')}/` })
      : new LocalFileStorage(path.join(context.storagePath || path.join(os.homedir(), '.lyra'), 'strands'));
    const agentConfig: AgentConfig = {
      id: `planner-${context.runId}`,
      name: 'Lyra Bedrock Planner',
      description: 'Read-only project planner that returns validated task plans for Lyra.',
      systemPrompt: 'You are a read-only software project planner. Inspect source only through the supplied read-only tools. Never claim changes were made or checks passed. Produce the requested structured plan and keep task scopes small enough to execute independently.',
      model,
      tools: makeReadOnlyTools(context.workspacePath),
      sessionManager: new SessionManager({ sessionId, storage }),
    };

    const result = this.testHooks.invoke
      ? await this.testHooks.invoke(agentConfig, prompt)
      : await this.invokeStrands(agentConfig, prompt);
    return result;
  }

  private async invokeStrands(config: AgentConfig, prompt: string): Promise<BedrockCompletion> {
    const result = await new Agent(config).invoke(prompt);
    const text = result.lastMessage.content
      .filter((block): block is typeof block & { text: string } => 'text' in block)
      .map((block) => block.text)
      .join('');
    if (!text.trim()) throw new Error('Strands planner returned an empty response.');
    const usage = result.metrics?.agentInvocations.reduce((sum, invocation) => ({
      inputTokens: sum.inputTokens + (invocation.usage?.inputTokens || 0),
      outputTokens: sum.outputTokens + (invocation.usage?.outputTokens || 0),
      totalTokens: sum.totalTokens + (invocation.usage?.totalTokens || 0),
    }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    return {
      text,
      ...(usage?.totalTokens ? { usage: { promptTokens: usage.inputTokens, completionTokens: usage.outputTokens, totalTokens: usage.totalTokens } } : {}),
    };
  }
}
