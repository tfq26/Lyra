/**
 * Sub-Millisecond 3-Lane Intent Triage Engine
 *
 * Classifies incoming engineering prompts into one of three execution lanes:
 * - `ask` (Lane 0): Instant read-only Q&A, code explanation, root-cause diagnosis. Zero worktrees, zero DAG.
 * - `fast-patch` (Lane 1): Surgical 1-2 file code edit streamed back as a previewable/1-click applicable patch.
 * - `full-swarm` (Lane 2): Multi-file parallel DAG orchestration across isolated Git worktrees + verification gates.
 */

import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { ExecutionLane } from './cloudwatchEmf';
import {
  buildFoundryOpenAiBaseUrl,
  getFoundryConfig,
  resolveProviderRoutes,
  type ResolvedProviderRoute,
} from './unifiedModelCatalog';

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

const DECISION_MODEL_CANDIDATES = [
  'gpt-4o',
  'phi-4-reasoning',
  'mai-code-1-1-flash',
  'nova-2-lite',
  'gemini-4-hydrogen',
];

function selectDecisionModelRoute(): ResolvedProviderRoute | null {
  for (const modelId of DECISION_MODEL_CANDIDATES) {
    const routes = resolveProviderRoutes(modelId, { requireConfigured: true });
    const healthy = routes.find((r) => !r.inCooldown);
    if (healthy) return healthy;
  }
  return null;
}

/**
 * Two-stage Ignite 2026 Decision-Model Pre-Flight:
 * Runs sub-millisecond heuristic triage first; for borderline prompts (< 0.90 confidence),
 * delegates lane classification to the fastest configured decision model across
 * Foundry (microsoft-decision-1.1), Bedrock (nova-2-lite), or OpenRouter (gemini-4-hydrogen),
 * with a tight timeout and safe heuristic fallback.
 */
export async function triageExecutionLaneWithDecisionModel(
  input: IntentTriageInput,
  options?: { timeoutMs?: number }
): Promise<IntentTriageDecision & { decisionModelUsed?: string; decisionProvider?: string }> {
  const heuristic = triageExecutionLane(input);
  if (heuristic.overridden || heuristic.confidence >= 0.9) {
    return heuristic;
  }

  const route = selectDecisionModelRoute();
  if (!route) {
    return heuristic;
  }

  const systemPrompt =
    'Classify the coding request into JSON {"lane":"ask"|"fast-patch"|"full-swarm","estimatedFileCount":number,"rationale":string}.';
  const userPrompt = input.prompt.slice(0, 1500);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? 1500);

  try {
    let raw: string | undefined;

    if (route.provider === 'bedrock') {
      const client = new BedrockRuntimeClient({
        region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
      });
      const resp = await client.send(
        new ConverseCommand({
          modelId: route.upstreamModelId,
          system: [{ text: systemPrompt }],
          messages: [{ role: 'user', content: [{ text: userPrompt }] }],
          inferenceConfig: { maxTokens: 120, temperature: 0 },
        }),
        { abortSignal: controller.signal }
      );
      raw = resp.output?.message?.content?.find((b) => 'text' in b && b.text)?.text;
    } else {
      let baseUrl = 'https://openrouter.ai/api/v1';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (route.provider === 'foundry') {
        const foundryCfg = getFoundryConfig();
        if (!foundryCfg.endpoint || !foundryCfg.apiKey) return heuristic;
        baseUrl = buildFoundryOpenAiBaseUrl(foundryCfg.endpoint);
        headers['api-key'] = foundryCfg.apiKey;
        headers.Authorization = `Bearer ${foundryCfg.apiKey}`;
      } else {
        const apiKey = process.env.OPENROUTER_API_KEY || process.env.LYRA_MANAGED_OPENROUTER_API_KEY;
        if (!apiKey) return heuristic;
        headers.Authorization = `Bearer ${apiKey}`;
      }

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: route.upstreamModelId,
          temperature: 0,
          max_tokens: 120,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
        signal: controller.signal,
      });
      if (!res.ok) return heuristic;
      const data = (await res.json()) as any;
      raw = data?.choices?.[0]?.message?.content;
    }

    if (!raw) return heuristic;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw) as {
      lane?: string;
      estimatedFileCount?: number;
      rationale?: string;
    };
    if (parsed.lane !== 'ask' && parsed.lane !== 'fast-patch' && parsed.lane !== 'full-swarm') {
      return heuristic;
    }
    return {
      lane: parsed.lane,
      overridden: false,
      confidence: 0.92,
      estimatedFileCount: Math.max(1, Number(parsed.estimatedFileCount) || heuristic.estimatedFileCount),
      detectedFiles: heuristic.detectedFiles,
      rationale: parsed.rationale || `Classified by ${route.canonicalModelId} (${route.provider}) pre-flight.`,
      decisionModelUsed: route.canonicalModelId,
      decisionProvider: route.provider,
    };
  } catch {
    return heuristic;
  } finally {
    clearTimeout(timeout);
  }
}
