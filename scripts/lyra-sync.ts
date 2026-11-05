#!/usr/bin/env bun
/**
 * Lyra Cross-Device Cloud Session Sync & DeepSeek Harness (`dsh`) Bridge CLI
 *
 * Syncs cloud chat transcripts (via sequence-delta `sinceSeq`) and 24/7 Hermes Repo Memory
 * between devices so DeepSeek Harness (`dsh`), VS Code, and CLI sessions stay in lockstep
 * without any web chat UI.
 *
 * Usage:
 *   bun scripts/lyra-sync.ts list
 *   bun scripts/lyra-sync.ts pull [sessionId]
 *   bun scripts/lyra-sync.ts chat "Explain the SQS claim-check threshold" [--session=session-main]
 *   bun scripts/lyra-sync.ts council "How should we handle stale worktrees across devices?" [--session=session-main]
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const hubUrl = (process.env.LYRA_HUB_URL || 'http://localhost:3001').replace(/\/+$/, '');
const apiKey = process.env.LYRA_GATEWAY_API_KEY || 'lyra-harness-default-secret';
const deviceId = process.env.LYRA_DEVICE_ID || `${os.hostname()}-${process.platform}`;
const syncDir = path.join(process.cwd(), 'server', 'data', 'synced-client');

interface LocalSessionCursor {
  sessionId: string;
  deviceId: string;
  lastSyncedSeq: number;
  updatedAt: string;
  messages: Array<{
    sequence: number;
    role: string;
    content: string;
    harness?: string;
    deviceId?: string;
    timestamp: string;
  }>;
}

function getCursorPath(sessionId: string): string {
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(syncDir, `${safeId}.json`);
}

function readLocalCursor(sessionId: string): LocalSessionCursor {
  const filePath = getCursorPath(sessionId);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as LocalSessionCursor;
    }
  } catch {
    // ignore corrupt cursor
  }
  return {
    sessionId,
    deviceId,
    lastSyncedSeq: 0,
    updatedAt: new Date(0).toISOString(),
    messages: [],
  };
}

function writeLocalCursor(cursor: LocalSessionCursor): void {
  if (!fs.existsSync(syncDir)) {
    fs.mkdirSync(syncDir, { recursive: true });
  }
  fs.writeFileSync(getCursorPath(cursor.sessionId), JSON.stringify(cursor, null, 2), 'utf8');
}

async function listCloudSessions(): Promise<void> {
  const res = await fetch(`${hubUrl}/api/gateway/ahp/sessions`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to list cloud sessions (${res.status})`);
  }
  const data = (await res.json()) as { sessions: any[] };
  console.log(`\n=== Lyra 24/7 Cloud Sessions (${hubUrl}) ===`);
  if (!data.sessions || data.sessions.length === 0) {
    console.log('No sessions found.');
    return;
  }
  for (const s of data.sessions) {
    const local = readLocalCursor(s.sessionId);
    console.log(
      `• ${s.sessionId} — "${s.title}" | Cloud Msgs: ${s.messageCount} | Local Synced Seq: ${local.lastSyncedSeq} | Status: ${s.status}`
    );
  }
}

async function pullSessionDelta(sessionId = 'session-main'): Promise<void> {
  const cursor = readLocalCursor(sessionId);
  const params = new URLSearchParams({
    sessionId,
    sinceSeq: String(cursor.lastSyncedSeq),
    workspacePath: process.cwd(),
  });

  const res = await fetch(`${hubUrl}/api/gateway/sessions/sync?${params.toString()}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`Sync pull failed (${res.status})`);
  }

  const delta = (await res.json()) as any;
  const newMsgs = Array.isArray(delta.deltaMessages) ? delta.deltaMessages : [];

  if (newMsgs.length > 0) {
    for (const m of newMsgs) {
      cursor.messages.push({
        sequence: m.sequence,
        role: m.role,
        content: m.content,
        harness: m.harness,
        deviceId: m.deviceId,
        timestamp: m.timestamp,
      });
    }
    cursor.lastSyncedSeq = delta.latestSeq;
    cursor.updatedAt = new Date().toISOString();
    writeLocalCursor(cursor);
  }

  console.log(
    `\n=== Cloud Session Sync [${delta.sessionId}] (Device: ${deviceId}) ===`
  );
  console.log(
    `Synced Sequence: ${cursor.lastSyncedSeq} (Pulled ${newMsgs.length} new message(s) since seq #${delta.sinceSeq})`
  );

  if (newMsgs.length > 0) {
    console.log(`\n--- New Delta Messages ---`);
    for (const m of newMsgs) {
      console.log(
        `[seq #${m.sequence}] (${m.role.toUpperCase()} via ${m.harness || 'cloud'}): ${m.content.slice(0, 300)}${m.content.length > 300 ? '...' : ''}`
      );
    }
  }

  if (Array.isArray(delta.hermesMemory) && delta.hermesMemory.length > 0) {
    console.log(`\n--- 24/7 Hermes Repo Memory (${delta.hermesMemory.length} entry/entries) ---`);
    for (const mem of delta.hermesMemory.slice(0, 3)) {
      console.log(`• [${mem.id}] ${mem.topic}: ${mem.consensusSummary}`);
    }
  }
}

async function runSyncedChat(prompt: string, sessionId = 'session-main', model = 'lyra-auto'): Promise<void> {
  const res = await fetch(`${hubUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-Lyra-Session-Id': sessionId,
      'X-Lyra-Harness': 'dsh-cli',
      'X-Lyra-Device-Id': deviceId,
    },
    body: JSON.stringify({
      model,
      sessionId,
      workspacePath: process.cwd(),
      stream: false,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Chat request failed (${res.status}): ${errText}`);
  }

  const completion = (await res.json()) as any;
  const answer = completion.choices?.[0]?.message?.content || '';
  console.log(`\n[${completion.model} · session=${sessionId} · seq=#${completion.sequence}]\n`);
  console.log(answer);

  // Pull delta so local cursor is immediately up to date
  await pullSessionDelta(sessionId);
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'list';
  const sessionFlag = args.find((a) => a.startsWith('--session='))?.split('=')[1] || 'session-main';
  const modelFlag = args.find((a) => a.startsWith('--model='))?.split('=')[1] || 'lyra-auto';
  const positional = args.slice(1).filter((a) => !a.startsWith('--'));

  if (cmd === 'list') {
    await listCloudSessions();
    return;
  }

  if (cmd === 'pull' || cmd === 'sync') {
    await pullSessionDelta(positional[0] || sessionFlag);
    return;
  }

  if (cmd === 'chat') {
    const prompt = positional.join(' ').trim();
    if (!prompt) {
      throw new Error('Usage: bun scripts/lyra-sync.ts chat "<prompt>" [--session=session-main]');
    }
    await runSyncedChat(prompt, sessionFlag, modelFlag);
    return;
  }

  if (cmd === 'council') {
    const question = positional.join(' ').trim();
    if (!question) {
      throw new Error('Usage: bun scripts/lyra-sync.ts council "<question>" [--session=session-main]');
    }
    await runSyncedChat(question, sessionFlag, 'lyra-council');
    return;
  }

  console.log(`Unknown command '${cmd}'. Available commands: list, pull, chat, council`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('[lyra-sync]', err.message || err);
    process.exit(1);
  });
}
