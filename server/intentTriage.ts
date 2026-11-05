/**
 * Sub-Millisecond 3-Lane Intent Triage Engine
 *
 * Classifies incoming engineering prompts into one of three execution lanes:
 * - `ask` (Lane 0): Instant read-only Q&A, code explanation, root-cause diagnosis. Zero worktrees, zero DAG.
 * - `fast-patch` (Lane 1): Surgical 1-2 file code edit streamed back as a previewable/1-click applicable patch.
 * - `full-swarm` (Lane 2): Multi-file parallel DAG orchestration across isolated Git worktrees + verification gates.
 */

import type { ExecutionLane } from './cloudwatchEmf';

export type LaneModePreference = 'auto' | ExecutionLane;

export interface IntentTriageInput {
  prompt: string;
  modePreference?: LaneModePreference;
  activeFilePath?: string;
  selectionText?: string;
  referencedFiles?: string[];
}

export interface IntentTriageDecision {
  lane: ExecutionLane;
  overridden: boolean;
  confidence: number;
  estimatedFileCount: number;
  detectedFiles: string[];
  rationale: string;
}

const FILE_PATH_PATTERN =
  /(?:^|[\s`'"])([A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|json|yaml|yml|md|css|scss|html|sql|sh))(?:$|[\s`'",.:;!?])/g;

const QUESTION_STARTERS =
  /^\s*(what|why|how|where|when|who|which|explain|describe|walk\s+me\s+through|summarize|tell\s+me|can\s+you\s+explain|is\s+there|are\s+there|does\s+this|do\s+we)\b/i;

const MUTATION_VERBS =
  /\b(fix|patch|update|change|modify|edit|rename|remove|delete|replace|add|create|write|implement|refactor|convert|extract|inline|wire|integrate|migrate|build|upgrade)\b/i;

const SWARM_SCOPE_PATTERNS =
  /\b(swarm|in\s+parallel|multi-agent|end-to-end|across\s+the\s+(?:codebase|repo|project|app)|entire\s+codebase|all\s+files|full-stack|frontend\s+and\s+backend|database\s+migration|reversible\s+migration|security\s+audit|new\s+subsystem|overhaul|re-architect|ci\/cd|too\s+basic|really\s+basic|looks?\s+(?:too\s+)?basic|redesign|modernize|properly|comprehensive|elevate\s+ui|feature-rich|full\s+redesign)\b/i;

const MICRO_PATCH_PATTERNS =
  /\b(typo|rename|comment|docstring|type\s+error|lint|import|null\s+check|guard|button|label|color|margin|padding|spacing|placeholder|header|footer|tooltip|log|console\.log|one\s+file|this\s+file|this\s+function)\b/i;

export function extractReferencedFiles(prompt: string, extras: string[] = []): string[] {
  const found = new Set<string>();
  for (const extra of extras) {
    const trimmed = extra?.trim();
    if (trimmed) found.add(trimmed);
  }
  for (const match of prompt.matchAll(FILE_PATH_PATTERN)) {
    const candidate = match[1]?.trim();
    if (candidate && !candidate.startsWith('http')) {
      found.add(candidate);
    }
  }
  return Array.from(found);
}

export function triageExecutionLane(input: IntentTriageInput): IntentTriageDecision {
  const prompt = (input.prompt || '').trim();
  const detectedFiles = extractReferencedFiles(prompt, [
    ...(input.referencedFiles || []),
    ...(input.activeFilePath ? [input.activeFilePath] : []),
  ]);

  if (input.modePreference && input.modePreference !== 'auto') {
    const fallbackCount =
      input.modePreference === 'full-swarm'
        ? Math.max(4, detectedFiles.length)
        : Math.max(1, detectedFiles.length || 1);
    return {
      lane: input.modePreference,
      overridden: true,
      confidence: 1.0,
      estimatedFileCount: fallbackCount,
      detectedFiles,
      rationale: `User explicitly selected '${input.modePreference}' mode.`,
    };
  }

  const hasQuestionStarter = QUESTION_STARTERS.test(prompt);
  const endsWithQuestion = /\?\s*$/.test(prompt);
  const hasMutationVerb = MUTATION_VERBS.test(prompt);
  const hasSwarmScope = SWARM_SCOPE_PATTERNS.test(prompt);
  const hasMicroSignal = MICRO_PATCH_PATTERNS.test(prompt);

  // 1. Check Lane 0 (Instant Ask): Informational / diagnostic questions without edit requests
  const politeEditRequest = /^\s*(can|could|would)\s+you\s+(please\s+)?(fix|patch|update|change|add|remove|delete|implement|refactor|create|write)\b/i.test(
    prompt
  );

  if (!politeEditRequest && ((hasQuestionStarter && !hasMutationVerb) || (endsWithQuestion && !hasMutationVerb))) {
    return {
      lane: 'ask',
      overridden: false,
      confidence: 0.94,
      estimatedFileCount: Math.max(1, detectedFiles.length || 1),
      detectedFiles,
      rationale: 'Informational or diagnostic query with no file-mutation verbs; routed to Lane 0 (Instant Ask).',
    };
  }

  if (!hasMutationVerb && !hasSwarmScope && prompt.split(/\s+/).length <= 18) {
    return {
      lane: 'ask',
      overridden: false,
      confidence: 0.84,
      estimatedFileCount: 1,
      detectedFiles,
      rationale: 'Short conversational prompt without code-mutation intent; routed to Lane 0 (Instant Ask).',
    };
  }

  // 2. Check Lane 2 (Full Swarm): Broad architectural scope or >= 3 distinct target files
  const explicitPromptFiles = extractReferencedFiles(prompt);
  if (hasSwarmScope || explicitPromptFiles.length >= 3 || prompt.length > 900) {
    const estFiles = Math.max(4, explicitPromptFiles.length || 4);
    return {
      lane: 'full-swarm',
      overridden: false,
      confidence: hasSwarmScope ? 0.95 : 0.87,
      estimatedFileCount: estFiles,
      detectedFiles,
      rationale: hasSwarmScope
        ? 'Detected multi-component / architectural scope; routed to Lane 2 (Full Cloud Swarm) with isolated Git worktrees.'
        : `Detected ${explicitPromptFiles.length >= 3 ? `${explicitPromptFiles.length} target files` : 'large multi-step specification'}; routed to Lane 2 (Full Cloud Swarm).`,
    };
  }

  // 3. Default actionable edits (1-2 files) -> Lane 1 (Fast Patch)
  const estFiles = Math.min(2, Math.max(1, detectedFiles.length || 1));
  return {
    lane: 'fast-patch',
    overridden: false,
    confidence: hasMicroSignal || Boolean(input.selectionText) ? 0.93 : 0.86,
    estimatedFileCount: estFiles,
    detectedFiles,
    rationale: `Targeted ${estFiles}-file code change; routed to Lane 1 (Fast Patch) for direct diff streaming & 1-click apply.`,
  };
}
