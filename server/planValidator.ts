import type { AgentType, CheckItem, HarnessId, StrategicAppraisal, TaskItem } from './types';
import { resolveOptimalModel } from './modelRouter';

export interface WorkerSlot { harness: HarnessId; profileId?: string; model?: string; }
export interface ValidatedPlan { acceptanceCriteria: string[]; tasks: TaskItem[]; checks: CheckItem[]; appraisal?: StrategicAppraisal; }

function jsonBody(text: string): unknown | null {
  // Strip <thinking>...</thinking> blocks
  const cleanText = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();

  // 1. Try code blocks from last to first
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  const codeBlocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = codeBlockRegex.exec(cleanText)) !== null) {
    if (match[1]) codeBlocks.push(match[1].trim());
  }
  for (let i = codeBlocks.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(codeBlocks[i]!) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object' && (parsed.tasks || parsed.acceptanceCriteria)) {
        return parsed;
      }
    } catch {}
  }

  // 2. Scan from last closing brace backwards to find matching opening brace for last balanced JSON object
  const lastClose = cleanText.lastIndexOf('}');
  if (lastClose !== -1) {
    let depth = 0;
    for (let i = lastClose; i >= 0; i--) {
      if (cleanText[i] === '}') depth++;
      else if (cleanText[i] === '{') {
        depth--;
        if (depth === 0) {
          const candidate = cleanText.slice(i, lastClose + 1);
          try {
            const parsed = JSON.parse(candidate) as Record<string, unknown>;
            if (parsed && typeof parsed === 'object' && (parsed.tasks || parsed.acceptanceCriteria)) {
              return parsed;
            }
          } catch {}
        }
      }
    }
  }

  // 3. Fallback: try outer { ... }
  const startIdx = cleanText.indexOf('{');
  if (startIdx !== -1 && lastClose > startIdx) {
    try {
      return JSON.parse(cleanText.slice(startIdx, lastClose + 1));
    } catch {}
  }

  return null;
}

export function parseSwarmPlan(text: string, runId: string, workers: WorkerSlot[]): ValidatedPlan {
  if (workers.length === 0) throw new Error('Choose at least one worker connection before planning a swarm.');
  const parsed = jsonBody(text);
  let rawCriteria: unknown[] = [];
  let rawTasks: Array<Record<string, unknown>> = [];
  let rawChecks: Array<Record<string, unknown>> = [];
  let appraisal: StrategicAppraisal | undefined;

  if (parsed && typeof parsed === 'object') {
    const plan = parsed as Record<string, unknown>;
    rawCriteria = Array.isArray(plan.acceptanceCriteria) ? plan.acceptanceCriteria : [];
    rawTasks = Array.isArray(plan.tasks) ? plan.tasks.filter((task): task is Record<string, unknown> => !!task && typeof task === 'object') : [];
    rawChecks = Array.isArray(plan.checks) ? plan.checks.filter((check): check is Record<string, unknown> => !!check && typeof check === 'object') : [];
    if (plan.appraisal && typeof plan.appraisal === 'object') {
      const rawAppraisal = plan.appraisal as Record<string, unknown>;
      appraisal = {
        problemSummary: rawAppraisal.problemSummary ? String(rawAppraisal.problemSummary).trim() : undefined,
        reusedAssets: Array.isArray(rawAppraisal.reusedAssets) ? rawAppraisal.reusedAssets.map(String).map((s) => s.trim()).filter(Boolean) : undefined,
        costScaleNotes: rawAppraisal.costScaleNotes ? String(rawAppraisal.costScaleNotes).trim() : undefined,
        recommendedApproach: rawAppraisal.recommendedApproach ? String(rawAppraisal.recommendedApproach).trim() : undefined,
      };
    }
  } else {
    const rows = text.split(/\r?\n/);
    let section: 'criteria' | 'tasks' | 'checks' | null = null;
    for (const line of rows) {
      const value = line.trim();
      if (/^ACCEPTANCE CRITERIA/i.test(value)) { section = 'criteria'; continue; }
      if (/^TASKS/i.test(value)) { section = 'tasks'; continue; }
      if (/^CHECKS/i.test(value)) { section = 'checks'; continue; }
      if (section === 'criteria' && value.startsWith('-')) rawCriteria.push(value.slice(1).trim());
      if (section === 'tasks' && /^\d+\./.test(value)) {
        const content = value.replace(/^\d+\.\s*/, '');
        const depMatch = content.match(/\[depends on:\s*(.*?)\]/i);
        const clean = content.replace(/\[depends on:\s*.*?\]/i, '').trim();
        const [title, ...description] = clean.split(' - ');
        rawTasks.push({ title, description: description.join(' - '), dependsOn: depMatch?.[1] ? depMatch[1].split(',').map((dep) => dep.trim()) : [] });
      }
      if (section === 'checks' && /^\d+\./.test(value)) {
        const [name, command] = value.replace(/^\d+\.\s*/, '').split(' - ');
        if (name && command) rawChecks.push({ name, command });
      }
    }
  }

  const criteria = rawCriteria.map((item) => String(item).trim()).filter(Boolean).slice(0, 24);
  if (criteria.length === 0) throw new Error('Planner output must include at least one acceptance criterion.');
  if (rawTasks.length === 0 || rawTasks.length > 24) throw new Error('Planner output must include between 1 and 24 tasks (anti-sprawl limit).');

  const taskIds = rawTasks.map((_, index) => `task-${runId}-${index + 1}`);
  const titles = new Map<string, string>();
  const usesZeroIndex = rawTasks.some((raw) => {
    const deps = Array.isArray(raw.dependsOn) ? raw.dependsOn : [];
    return deps.some((d) => String(d).trim() === '0' || String(d).trim().toLowerCase() === 'task 0');
  });

  rawTasks.forEach((task, index) => {
    const title = String(task.title || '').trim();
    if (!title) throw new Error(`Task ${index + 1} needs a title.`);
    titles.set(title.toLowerCase(), taskIds[index]!);
    if (usesZeroIndex) {
      titles.set(String(index), taskIds[index]!);
      titles.set(`task ${index}`, taskIds[index]!);
    } else {
      titles.set(String(index + 1), taskIds[index]!);
      titles.set(`task ${index + 1}`, taskIds[index]!);
    }
    titles.set(taskIds[index]!.toLowerCase(), taskIds[index]!);
  });
  const workerUse = new Map<string, number>();
  const tasks: TaskItem[] = rawTasks.map((raw, index) => {
    const title = String(raw.title).trim();
    const recommendedHarness = String(raw.recommendedHarness || '').trim();
    let slotIndex = index % workers.length;
    if (recommendedHarness) {
      const candidates = workers.map((slot, workerIndex) => ({ slot, workerIndex })).filter(({ slot }) => slot.harness === recommendedHarness);
      if (candidates.length === 0) throw new Error(`Task “${title}” recommends unavailable worker harness “${recommendedHarness}”.`);
      candidates.sort((a, b) => (workerUse.get(a.slot.profileId || a.slot.harness) || 0) - (workerUse.get(b.slot.profileId || b.slot.harness) || 0));
      slotIndex = candidates[0]!.workerIndex;
    }
    const slot = workers[slotIndex]!;
    const slotKey = slot.profileId || slot.harness;
    workerUse.set(slotKey, (workerUse.get(slotKey) || 0) + 1);
    const dependsOn = Array.isArray(raw.dependsOn) ? raw.dependsOn : [];
    const dependencies = dependsOn.map((dependency) => {
      const key = String(dependency).trim();
      const normalizedKey = /^task\s+(\d+)$/i.test(key) ? key.match(/\d+/)![0] : key;
      const id = titles.get(normalizedKey.toLowerCase()) || titles.get(normalizedKey);
      if (!id) throw new Error(`Task “${title}” depends on unknown task “${key}”.`);
      return id;
    });
    return {
      id: taskIds[index]!, runId, title,
      description: String(raw.description || title).trim(),
      scope: String(raw.scope || raw.description || title).trim(),
      expectedOutputs: Array.isArray(raw.expectedOutputs) ? raw.expectedOutputs.map(String).slice(0, 12) : [],
      assignedAgent: slot.harness as AgentType,
      assignedProfileId: slot.profileId,
      assignedModel: slot.model || resolveOptimalModel({
        taskTitle: title,
        taskDescription: String(raw.description || title).trim(),
        role: 'worker',
        harness: slot.harness,
      }).modelId,
      stage: 'implement',
      status: dependencies.length ? 'pending' : 'ready',
      dependencies: [...new Set(dependencies)],
      attempts: [],
    };
  });
  validateAcyclic(tasks);

  const checks: CheckItem[] = rawChecks.slice(0, 12).map((check, index) => {
    const name = String(check.name || '').trim();
    const command = String(check.command || '').trim();
    if (!name || !command || command.length > 500) throw new Error(`Proposed check ${index + 1} needs a name and a command under 500 characters.`);
    return { id: `check-${runId}-${index + 1}`, runId, name, command, status: 'pending' };
  });
  return { acceptanceCriteria: criteria, tasks, checks, ...(appraisal ? { appraisal } : {}) };
}

function validateAcyclic(tasks: TaskItem[]) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error('Planner output contains a task dependency cycle.');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependencies || []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  tasks.forEach((task) => visit(task.id));
}
