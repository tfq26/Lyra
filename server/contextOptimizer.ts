/**
 * Headroom-Style Context Optimizer for Lyra Gateway
 *
 * 1. CCR (Compress-Cache-Retrieve):
 *    Hashes oversized tool_result payloads (`ctx_<hash>`), stores the raw payload
 *    in an LRU cache (+ optional Postgres persistence), and replaces older turns'
 *    bulky blocks with modality-aware compressed stubs + retrieval instructions.
 *
 * 2. Modality-Aware Compression:
 *    - JSON arrays/objects: preserves schema/keys, count, and sample items
 *    - Code: preserves imports, exported symbols/signatures, and head/tail lines
 *    - Logs/CLI output: preserves error/warning lines and tail summary
 *
 * 3. Cross-Model Working-Set Ledger:
 *    Tracks files read/edited and commands executed per sessionId so switching
 *    models mid-session does not waste tokens re-reading unchanged context.
 */

import crypto from 'node:crypto';
import type { GatewayLlmContentBlock, GatewayLlmMessage } from './gatewayLlmProxy';

export interface StoredContextBlob {
  id: string;
  sessionId?: string;
  content: string;
  modality: 'json' | 'code' | 'log' | 'text';
  charCount: number;
  createdAt: number;
}

export interface WorkingSetEntry {
  key: string;
  kind: 'file' | 'command' | 'search';
  label: string;
  ctxId?: string;
  status?: 'ok' | 'error';
  summary: string;
  updatedAt: number;
}

export interface ContextOptimizeResult {
  messages: GatewayLlmMessage[];
  workingSetBlock: string;
  stats: {
    compressedBlocks: number;
    savedChars: number;
    savedTokensEst: number;
    workingSetItems: number;
  };
}

export type BlobPersistHook = {
  save: (blob: StoredContextBlob) => Promise<void>;
  load: (id: string) => Promise<string | null>;
};

const MAX_IN_MEMORY_BLOBS = 600;
const MAX_SESSIONS = 300;
const COMPRESS_THRESHOLD_CHARS = 1_200;

export class ContextOptimizer {
  private readonly blobs = new Map<string, StoredContextBlob>();
  private readonly workingSets = new Map<string, Map<string, WorkingSetEntry>>();
  private persistHook?: BlobPersistHook;

  public setPersistHook(hook: BlobPersistHook): void {
    this.persistHook = hook;
  }

  public storeBlob(content: string, modality: StoredContextBlob['modality'], sessionId?: string): string {
    const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
    const id = `ctx_${hash}`;
    if (!this.blobs.has(id)) {
      if (this.blobs.size >= MAX_IN_MEMORY_BLOBS) {
        const oldestKey = this.blobs.keys().next().value;
        if (oldestKey) this.blobs.delete(oldestKey);
      }
      const blob: StoredContextBlob = {
        id,
        sessionId,
        content,
        modality,
        charCount: content.length,
        createdAt: Date.now(),
      };
      this.blobs.set(id, blob);
      if (this.persistHook) {
        void this.persistHook.save(blob).catch(() => {});
      }
    }
    return id;
  }

  public async retrieveBlob(
    id: string,
    options?: { startLine?: number; endLine?: number; maxChars?: number }
  ): Promise<{ found: boolean; id: string; totalLines?: number; content?: string }> {
    let raw = this.blobs.get(id)?.content;
    if (!raw && this.persistHook) {
      raw = (await this.persistHook.load(id).catch(() => null)) || undefined;
    }
    if (!raw) {
      return { found: false, id };
    }
    const lines = raw.split('\n');
    const start = Math.max(1, options?.startLine || 1);
    const end = Math.min(lines.length, options?.endLine || lines.length);
    const slice = lines.slice(start - 1, end).join('\n');
    const maxChars = options?.maxChars ?? 16_000;
    const truncated =
      slice.length > maxChars
        ? `${slice.slice(0, maxChars)}\n... [truncated ${slice.length - maxChars} chars; pass startLine/endLine for more]`
        : slice;
    return {
      found: true,
      id,
      totalLines: lines.length,
      content: truncated,
    };
  }

  public detectModality(text: string, toolName?: string): StoredContextBlob['modality'] {
    const trimmed = text.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        JSON.parse(trimmed);
        return 'json';
      } catch {}
    }
    if (
      toolName === 'run_command' ||
      toolName === 'run_tests' ||
      toolName === 'validate_project' ||
      /(?:^|\n)(?:error TS\d+|FAIL|PASS|✓|✗|Exit code|npm ERR!|bun test)/i.test(text)
    ) {
      return 'log';
    }
    if (
      toolName === 'read_file' ||
      /(?:^|\n)\s*(?:import\s+|export\s+|function\s+|class\s+|interface\s+|type\s+|const\s+|def\s+|pub\s+fn\s+)/m.test(text)
    ) {
      return 'code';
    }
    return 'text';
  }

  public compressPayload(content: string, modality: StoredContextBlob['modality'], ctxId: string, label?: string): string {
    const lines = content.split('\n');
    const header = `[CCR ${modality.toUpperCase()} | id=${ctxId} | ${lines.length} lines, ${content.length} chars${label ? ` | ${label}` : ''}]`;

    if (modality === 'json') {
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          const sampleKeys =
            parsed[0] && typeof parsed[0] === 'object' ? Object.keys(parsed[0]).slice(0, 12).join(', ') : typeof parsed[0];
          const first = JSON.stringify(parsed[0] ?? null).slice(0, 260);
          const last = parsed.length > 1 ? JSON.stringify(parsed[parsed.length - 1]).slice(0, 200) : '';
          return `${header}\nArray(len=${parsed.length}, itemKeys=[${sampleKeys}])\nfirst: ${first}${last ? `\nlast: ${last}` : ''}\nUse retrieve_context("${ctxId}") for full JSON.`;
        }
        if (parsed && typeof parsed === 'object') {
          const keys = Object.keys(parsed);
          const preview = JSON.stringify(parsed).slice(0, 420);
          return `${header}\nObject(keys=[${keys.slice(0, 20).join(', ')}])\npreview: ${preview}\nUse retrieve_context("${ctxId}") for full JSON.`;
        }
      } catch {}
    }

    if (modality === 'code') {
      const sigLines = lines
        .map((line, idx) => ({ line, num: idx + 1 }))
        .filter(({ line }) =>
          /^\s*(?:export\s+|public\s+|async\s+function|function\s+|class\s+|interface\s+|type\s+|const\s+\w+\s*=|def\s+|fn\s+|pub\s+)/.test(
            line
          )
        )
        .slice(0, 18)
        .map(({ line, num }) => `L${num}: ${line.trim().slice(0, 110)}`);
      const head = lines.slice(0, 6).join('\n').slice(0, 320);
      return `${header}\n${head}${sigLines.length ? `\nSignatures:\n${sigLines.join('\n')}` : ''}\nUse retrieve_context("${ctxId}", startLine, endLine) for exact code.`;
    }

    if (modality === 'log') {
      const errorLines = lines
        .filter((l) => /\b(?:error|fail|failed|exception|fatal|warn|panic|TS\d{4})\b/i.test(l))
        .slice(0, 12)
        .map((l) => l.trim().slice(0, 140));
      const tail = lines.slice(-6).join('\n').slice(0, 360);
      return `${header}${errorLines.length ? `\nErrors/Signals:\n${errorLines.join('\n')}` : ''}\nTail:\n${tail}\nUse retrieve_context("${ctxId}") for full output.`;
    }

    const head = content.slice(0, 260);
    const tail = content.length > 420 ? content.slice(-140) : '';
    return `${header}\n${head}${tail ? `\n...\n${tail}` : ''}\nUse retrieve_context("${ctxId}") for full text.`;
  }

  private getSessionSet(sessionId: string): Map<string, WorkingSetEntry> {
    let set = this.workingSets.get(sessionId);
    if (!set) {
      if (this.workingSets.size >= MAX_SESSIONS) {
        const oldest = this.workingSets.keys().next().value;
        if (oldest) this.workingSets.delete(oldest);
      }
      set = new Map<string, WorkingSetEntry>();
      this.workingSets.set(sessionId, set);
    }
    return set;
  }

  public optimizeGatewayTurn(params: {
    sessionId?: string;
    messages: GatewayLlmMessage[];
    tailKeepCount?: number;
  }): ContextOptimizeResult {
    const tailKeepCount = params.tailKeepCount ?? 4;
    const messages = params.messages || [];
    const sessionKey = params.sessionId?.trim() || 'default';
    const workingSet = this.getSessionSet(sessionKey);

    // 1. Index tool_use metadata across the conversation
    const toolMeta = new Map<string, { name: string; input: Record<string, unknown>; msgIdx: number }>();
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
      for (const block of msg.content) {
        if (block.type === 'tool_use') {
          toolMeta.set(block.id, { name: block.name, input: block.input || {}, msgIdx: i });
        }
      }
    }

    // 2. Compress older oversized tool_result blocks (outside tailKeepCount) and update WorkingSetLedger
    const tailStart = Math.max(0, messages.length - tailKeepCount);
    let compressedBlocks = 0;
    let savedChars = 0;

    const optimizedMessages: GatewayLlmMessage[] = messages.map((msg, idx) => {
      if (!Array.isArray(msg.content)) return msg;

      let changed = false;
      const nextBlocks: GatewayLlmContentBlock[] = msg.content.map((block) => {
        if (block.type !== 'tool_result') return block;

        const meta = toolMeta.get(block.toolUseId);
        const toolName = meta?.name || 'tool';
        const targetLabel = String(
          meta?.input?.path || meta?.input?.directory || meta?.input?.command || meta?.input?.query || ''
        ).slice(0, 120);

        const rawContent = block.content || '';
        const isAlreadyCcr = rawContent.startsWith('[CCR ');
        const modality = this.detectModality(rawContent, toolName);
        let ctxId: string | undefined;

        if (!isAlreadyCcr && rawContent.length >= COMPRESS_THRESHOLD_CHARS) {
          ctxId = this.storeBlob(rawContent, modality, sessionKey);
        }

        // Record into Cross-Model Working-Set Ledger
        if (targetLabel) {
          const kind: WorkingSetEntry['kind'] =
            toolName === 'run_command' || toolName === 'run_tests' || toolName === 'validate_project'
              ? 'command'
              : toolName === 'search_code' || toolName === 'search_web'
                ? 'search'
                : 'file';
          const entryKey = `${kind}:${targetLabel}`;
          workingSet.set(entryKey, {
            key: entryKey,
            kind,
            label: targetLabel,
            ctxId: ctxId || workingSet.get(entryKey)?.ctxId,
            status: block.isError ? 'error' : 'ok',
            summary: `${toolName} (${block.isError ? 'error' : 'ok'}, ${rawContent.length} chars)`,
            updatedAt: Date.now(),
          });
        }

        // Only rewrite older turns outside the recent tail window so current tool outputs stay full-fidelity
        if (idx < tailStart && !isAlreadyCcr && !block.isError && rawContent.length >= COMPRESS_THRESHOLD_CHARS && ctxId) {
          const compressed = this.compressPayload(rawContent, modality, ctxId, targetLabel || toolName);
          if (compressed.length < rawContent.length) {
            changed = true;
            compressedBlocks += 1;
            savedChars += rawContent.length - compressed.length;
            return { ...block, content: compressed };
          }
        }
        return block;
      });

      return changed ? { ...msg, content: nextBlocks } : msg;
    });

    // 3. Build compact Cross-Model Working-Set Ledger block (max 16 recent items)
    const entries = Array.from(workingSet.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 16);
    const workingSetBlock =
      entries.length > 0
        ? [
            '<CROSS_MODEL_WORKING_SET>',
            'Files/commands already inspected in this session (use retrieve_context(id) instead of re-reading unchanged files):',
            ...entries.map(
              (e) =>
                `- [${e.kind}] ${e.label}: ${e.summary}${e.ctxId ? ` [ctx=${e.ctxId}]` : ''}`
            ),
            '</CROSS_MODEL_WORKING_SET>',
          ].join('\n')
        : '';

    return {
      messages: optimizedMessages,
      workingSetBlock,
      stats: {
        compressedBlocks,
        savedChars,
        savedTokensEst: Math.round(savedChars / 3.4),
        workingSetItems: entries.length,
      },
    };
  }
}

export const sharedContextOptimizer = new ContextOptimizer();
