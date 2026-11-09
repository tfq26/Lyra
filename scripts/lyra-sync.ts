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
  const finalPath = getCursorPath(cursor.sessionId);
  const tmpPath = `${finalPath}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(cursor, null, 2), 'utf8');
  fs.renameSync(tmpPath, finalPath);
}

export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  maxRetries = 3
): Promise<Response> {
  let attempt = 0;
  while (true) {
    try {
      const res = await fetch(url, init);
      if (res.status >= 500 && attempt < maxRetries) {
        throw new Error(`Server temporarily unavailable (${res.status})`);
      }
      return res;
    } catch (err: any) {
      attempt++;
      if (attempt > maxRetries) throw err;
      const delayMs = Math.min(2000, 100 * Math.pow(2, attempt) + Math.random() * 50);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

async function listCloudSessions(): Promise<void> {
  const res = await fetchWithRetry(`${hubUrl}/api/gateway/ahp/sessions`, {
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

  const res = await fetchWithRetry(`${hubUrl}/api/gateway/sessions/sync?${params.toString()}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`Sync pull failed (${res.status})`);
  }

  const delta = (await res.json()) as any;
  const newMsgs = Array.isArray(delta.deltaMessages) ? delta.deltaMessages : [];

  if (newMsgs.length > 0) {
    const existingSeqs = new Set(cursor.messages.map((m) => m.sequence));
    for (const m of newMsgs) {
      if (!existingSeqs.has(m.sequence)) {
        cursor.messages.push({
          sequence: m.sequence,
          role: m.role,
          content: m.content,
          harness: m.harness,
          deviceId: m.deviceId,
          timestamp: m.timestamp,
        });
        existingSeqs.add(m.sequence);
      }
    }
    cursor.messages.sort((a, b) => a.sequence - b.sequence);
    cursor.lastSyncedSeq = Math.max(
      cursor.lastSyncedSeq,
      delta.latestSeq || 0,
      ...cursor.messages.map((m) => m.sequence)
    );
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
  const res = await fetchWithRetry(`${hubUrl}/v1/chat/completions`, {
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

  if (cmd === 'devices' || cmd === 'presence') {
    const res = await fetchWithRetry(`${hubUrl}/api/connect/devices`);
    if (!res.ok) throw new Error(`Failed to list devices (${res.status})`);
    const data = await res.json() as { devices: any[] };
    console.log(`\n=== 📡 Lyra Connect: Online Paired Devices (${data.devices.length}) ===`);
    if (data.devices.length === 0) {
      console.log('No online devices detected. Start VS Code, Web Portal, or CLI to connect.');
      return;
    }
    for (const d of data.devices) {
      const typeIcon = d.deviceType === 'mobile' ? '📱' : d.deviceType === 'web' ? '🌐' : d.deviceType === 'cli' ? '⌨️' : '💻';
      console.log(`${typeIcon} ${d.deviceName} (${d.deviceId})`);
      console.log(`   Type: ${d.deviceType} | Active Session: ${d.activeSessionId || 'none'} | Workspace: ${d.workspacePath || 'none'}`);
    }
    console.log();
    return;
  }

  if (cmd === 'cast' || cmd === 'handoff') {
    const targetDevice = positional[0];
    const targetSession = positional[1] || sessionFlag;
    if (!targetDevice) {
      throw new Error('Usage: bun scripts/lyra-sync.ts cast <targetDeviceId> [sessionId]');
    }
    const res = await fetchWithRetry(`${hubUrl}/api/connect/cast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromDeviceId: deviceId,
        targetDeviceId: targetDevice,
        sessionId: targetSession,
      }),
    });
    const result = await res.json() as any;
    if (!res.ok || !result.success) {
      throw new Error(result.error || `Failed to cast session (${res.status})`);
    }
    console.log(`\n✨ [Lyra Connect] Session "${targetSession}" successfully cast to device "${targetDevice}"!`);
    console.log(`   Target Device: ${result.targetDevice.deviceName} (${result.targetDevice.deviceType})`);
    console.log(`   Context & turn sequence synchronized.\n`);
    return;
  }

  console.log(`Unknown command '${cmd}'. Available commands: list, pull, chat, council, devices, cast`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('[lyra-sync]', err.message || err);
    process.exit(1);
  });
}
