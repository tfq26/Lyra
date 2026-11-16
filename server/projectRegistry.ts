import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import type { PolicyProfile } from './cloudwatchEmf';

export type ProjectCapability = 'ask' | 'agent' | 'council' | 'swarm';

export interface ProjectRecord {
  id: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  enabled: boolean;
  defaultPolicyProfile: PolicyProfile;
  allowedCapabilities: ProjectCapability[];
  dailyBudgetUsd?: number;
  dailySpentUsd: number;
  dailyResetDate: string;
  monthlyBudgetUsd?: number;
  spentUsd: number;
  maxConcurrentRuns?: number;
  totalTokens: number;
  requestCount: number;
  createdAt: string;
  lastUsedAt?: string;
}

export type PublicProjectRecord = Omit<ProjectRecord, 'keyHash'>;

export interface CreateProjectInput {
  name: string;
  defaultPolicyProfile?: PolicyProfile;
  allowedCapabilities?: ProjectCapability[];
  dailyBudgetUsd?: number;
  monthlyBudgetUsd?: number;
  maxConcurrentRuns?: number;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

export function extractProjectApiKey(req: http.IncomingMessage): string | null {
  const headerKey = req.headers['x-lyra-project'];
  if (typeof headerKey === 'string' && headerKey.startsWith('lyra_proj_')) {
    return headerKey.trim();
  }
  const auth = req.headers.authorization;
  if (typeof auth === 'string') {
    const match = auth.match(/^Bearer\s+(lyra_proj_[a-zA-Z0-9_-]+)$/i);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

export class ProjectRegistry {
  private readonly filePath: string;
  private readonly globalDailyCapUsd?: number;
  private projects = new Map<string, ProjectRecord>();
  private globalDailySpentUsd = 0;
  private globalDailyResetDate = todayUtc();

  constructor(
    filePath = path.join(os.homedir(), '.lyra', 'projects.json'),
    globalDailyCapUsd = Number(process.env.LYRA_GLOBAL_DAILY_CAP_USD || 0) || undefined
  ) {
    this.filePath = filePath;
    this.globalDailyCapUsd = globalDailyCapUsd;
    this.load();
  }

  private rollDailyCountersIfNeeded(proj?: ProjectRecord): void {
    const today = todayUtc();
    if (this.globalDailyResetDate !== today) {
      this.globalDailyResetDate = today;
      this.globalDailySpentUsd = 0;
    }
    if (proj && proj.dailyResetDate !== today) {
      proj.dailyResetDate = today;
      proj.dailySpentUsd = 0;
    }
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (Array.isArray(raw)) {
        for (const item of raw) {
          if (item?.id && item?.keyHash) {
            this.projects.set(item.id, item as ProjectRecord);
          }
        }
      }
    } catch {
      // Start clean if file is missing or unreadable
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(Array.from(this.projects.values()), null, 2), 'utf8');
    } catch {
      // Best-effort persistence
    }
  }

  public createProject(input: CreateProjectInput): { project: PublicProjectRecord; apiKey: string } {
    const name = String(input.name || '').trim();
    if (!name) throw new Error('Project name is required.');

    const rawSecret = crypto.randomBytes(24).toString('hex');
    const apiKey = `lyra_proj_${rawSecret}`;
    const id = `proj-${crypto.randomBytes(6).toString('hex')}`;
    const record: ProjectRecord = {
      id,
      name,
      keyPrefix: apiKey.slice(0, 18),
      keyHash: hashApiKey(apiKey),
      enabled: true,
      defaultPolicyProfile: input.defaultPolicyProfile || 'balanced',
      allowedCapabilities: input.allowedCapabilities?.length
        ? input.allowedCapabilities
        : ['ask', 'agent', 'council', 'swarm'],
      dailyBudgetUsd: typeof input.dailyBudgetUsd === 'number' && input.dailyBudgetUsd > 0
        ? input.dailyBudgetUsd
        : undefined,
      dailySpentUsd: 0,
      dailyResetDate: todayUtc(),
      monthlyBudgetUsd: typeof input.monthlyBudgetUsd === 'number' && input.monthlyBudgetUsd > 0
        ? input.monthlyBudgetUsd
        : undefined,
      spentUsd: 0,
      maxConcurrentRuns: typeof input.maxConcurrentRuns === 'number' && input.maxConcurrentRuns > 0
        ? Math.floor(input.maxConcurrentRuns)
        : 4,
      totalTokens: 0,
      requestCount: 0,
      createdAt: new Date().toISOString(),
    };

    this.projects.set(id, record);
    this.save();

    const { keyHash: _hash, ...publicProject } = record;
    return { project: publicProject, apiKey };
  }

  public authenticate(rawKey: string | null | undefined): PublicProjectRecord | null {
    if (!rawKey || !rawKey.startsWith('lyra_proj_')) return null;
    const incomingHash = hashApiKey(rawKey);
    for (const proj of this.projects.values()) {
      if (!proj.enabled) continue;
      const a = Buffer.from(proj.keyHash, 'hex');
      const b = Buffer.from(incomingHash, 'hex');
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        const { keyHash: _hash, ...publicProject } = proj;
        return publicProject;
      }
    }
    return null;
  }

  public checkBudget(projectId: string): { allowed: boolean; spentUsd: number; budgetUsd?: number; reason?: string } {
    const proj = this.projects.get(projectId);
    if (!proj) return { allowed: false, spentUsd: 0, reason: 'Unknown project.' };
    this.rollDailyCountersIfNeeded(proj);

    if (typeof this.globalDailyCapUsd === 'number' && this.globalDailySpentUsd >= this.globalDailyCapUsd) {
      return {
        allowed: false,
        spentUsd: this.globalDailySpentUsd,
        budgetUsd: this.globalDailyCapUsd,
        reason: `Global daily spend cap ($${this.globalDailyCapUsd}) reached.`,
      };
    }
    if (typeof proj.dailyBudgetUsd === 'number' && (proj.dailySpentUsd || 0) >= proj.dailyBudgetUsd) {
      return {
        allowed: false,
        spentUsd: proj.dailySpentUsd || 0,
        budgetUsd: proj.dailyBudgetUsd,
        reason: `Daily budget ($${proj.dailyBudgetUsd}) exceeded for project ${proj.name}.`,
      };
    }
    if (typeof proj.monthlyBudgetUsd === 'number' && proj.spentUsd >= proj.monthlyBudgetUsd) {
      return {
        allowed: false,
        spentUsd: proj.spentUsd,
        budgetUsd: proj.monthlyBudgetUsd,
        reason: `Monthly budget ($${proj.monthlyBudgetUsd}) exceeded for project ${proj.name}.`,
      };
    }
    return { allowed: true, spentUsd: proj.spentUsd, budgetUsd: proj.monthlyBudgetUsd };
  }

  public recordUsage(projectId: string, costUsd = 0, tokens = 0): void {
    const proj = this.projects.get(projectId);
    if (!proj) return;
    this.rollDailyCountersIfNeeded(proj);
    const delta = Math.max(0, costUsd);
    this.globalDailySpentUsd = Number((this.globalDailySpentUsd + delta).toFixed(6));
    proj.dailySpentUsd = Number(((proj.dailySpentUsd || 0) + delta).toFixed(6));
    proj.spentUsd = Number((proj.spentUsd + delta).toFixed(6));
    proj.totalTokens += Math.max(0, Math.round(tokens));
    proj.requestCount += 1;
    proj.lastUsedAt = new Date().toISOString();
    this.save();
  }

  public listProjects(): PublicProjectRecord[] {
    return Array.from(this.projects.values()).map(({ keyHash: _hash, ...rest }) => rest);
  }

  public revokeProject(projectId: string): boolean {
    const proj = this.projects.get(projectId);
    if (!proj) return false;
    proj.enabled = false;
    this.save();
    return true;
  }
}
