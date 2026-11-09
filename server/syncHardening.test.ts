import { describe, it, expect, beforeEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { AHPServer } from './ahpProtocol';
import { UnifiedStore } from './unifiedStore';
import { fetchWithRetry } from '../scripts/lyra-sync';

describe('Lyra Connect Hardening: Network Drops & Concurrent Turns', () => {
  let store: UnifiedStore;
  let ahpServer: AHPServer;
  const tempDir = `/tmp/lyra-sync-hardening-${Date.now()}`;

  beforeEach(() => {
    store = new UnifiedStore(tempDir);
    ahpServer = new AHPServer(store);
  });

  describe('1. Intermittent Network Drops & Resilient Reconnection', () => {
    it('retries with exponential backoff on transient 500/503 network errors', async () => {
      let callCount = 0;
      // Mock global fetch temporarily to simulate 2 network errors followed by success
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = (async (url: string, init?: any) => {
          callCount++;
          if (callCount < 3) {
            return new Response('Transient 503 Service Unavailable', { status: 503 });
          }
          return new Response(JSON.stringify({ ok: true, callCount }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }) as any;

        const res = await fetchWithRetry('http://mock-hub/api/test', undefined, 4);
        expect(res.status).toBe(200);
        const data = await res.json() as any;
        expect(data.ok).toBe(true);
        expect(callCount).toBe(3); // Verified 2 retries then success
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('resumes seamlessly from lastSyncedSeq after offline gap with zero duplicates', () => {
      const sessionId = 'session-reconnect-test';
      ahpServer.createSession({ sessionId, title: 'Network Reconnect Test' });

      // Device A appends 3 turns
      ahpServer.appendMessage(sessionId, { role: 'user', content: 'Turn 1: Online' });
      ahpServer.appendMessage(sessionId, { role: 'assistant', content: 'Turn 1 Reply' });
      ahpServer.appendMessage(sessionId, { role: 'user', content: 'Turn 2: Online' });

      // Device B syncs initial 3 turns
      const sync1 = ahpServer.syncSessionDelta({ sessionId, sinceSeq: 0 });
      expect(sync1.deltaMessages.length).toBe(3);
      expect(sync1.latestSeq).toBe(3);

      const deviceBCursor = {
        lastSyncedSeq: sync1.latestSeq,
        messages: sync1.deltaMessages.map((m) => ({ sequence: m.sequence, content: m.content })),
      };

      // Device B drops offline. While offline, Device A and cloud swarm append 4 more turns
      ahpServer.appendMessage(sessionId, { role: 'assistant', content: 'Turn 2 Reply (offline to B)' });
      ahpServer.appendMessage(sessionId, { role: 'user', content: 'Turn 3 (offline to B)' });
      ahpServer.appendMessage(sessionId, { role: 'assistant', content: 'Turn 3 Reply (offline to B)' });
      ahpServer.appendMessage(sessionId, { role: 'user', content: 'Turn 4: Reconnected' });

      // Device B comes back online 10 minutes later and requests delta since lastSyncedSeq (3)
      const sync2 = ahpServer.syncSessionDelta({ sessionId, sinceSeq: deviceBCursor.lastSyncedSeq });
      expect(sync2.sinceSeq).toBe(3);
      expect(sync2.latestSeq).toBe(7);
      expect(sync2.deltaMessages.length).toBe(4);

      // Verify strict sequence continuation: 4, 5, 6, 7
      expect(sync2.deltaMessages.map((m) => m.sequence)).toEqual([4, 5, 6, 7]);

      // Deduplicate into client cursor
      const seenSeqs = new Set(deviceBCursor.messages.map((m) => m.sequence));
      for (const m of sync2.deltaMessages) {
        if (!seenSeqs.has(m.sequence)) {
          deviceBCursor.messages.push({ sequence: m.sequence, content: m.content });
          seenSeqs.add(m.sequence);
        }
      }
      deviceBCursor.lastSyncedSeq = sync2.latestSeq;

      // Invariant: Exactly 7 unique messages in strictly increasing sequence order
      expect(deviceBCursor.messages.length).toBe(7);
      expect(deviceBCursor.messages.map((m) => m.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(deviceBCursor.lastSyncedSeq).toBe(7);
    });
  });

  describe('2. Concurrent Turn Invariants & Monotonic Sequences', () => {
    it('preserves strictly monotonic sequence numbers without duplicates under burst concurrent writes', async () => {
      const sessionId = 'session-burst-concurrent';
      ahpServer.createSession({ sessionId, title: 'Burst Concurrency Test' });

      const devices = ['macbook-pro', 'iphone-16', 'linux-workstation', 'ipad-pro', 'cli-runner'];
      const totalConcurrentTurns = 20;

      // Fire 20 writes simultaneously across multiple devices
      const promises = Array.from({ length: totalConcurrentTurns }, (_, i) => {
        const device = devices[i % devices.length];
        return Promise.resolve().then(() => {
          ahpServer.appendMessage(sessionId, {
            role: i % 2 === 0 ? 'user' : 'assistant',
            content: `Concurrent turn #${i} from ${device}`,
            deviceId: device,
          });
        });
      });

      await Promise.all(promises);

      // Retrieve full session
      const delta = ahpServer.syncSessionDelta({ sessionId, sinceSeq: 0 });
      expect(delta.latestSeq).toBe(totalConcurrentTurns);
      expect(delta.deltaMessages.length).toBe(totalConcurrentTurns);

      // Invariant 1: Every sequence number from 1 to 20 is present exactly once
      const sequences = delta.deltaMessages.map((m) => m.sequence);
      const expected = Array.from({ length: totalConcurrentTurns }, (_, i) => i + 1);
      expect(sequences).toEqual(expected);

      // Invariant 2: No duplicates exist
      const uniqueSequences = new Set(sequences);
      expect(uniqueSequences.size).toBe(totalConcurrentTurns);

      // Invariant 3: Slicing by sinceSeq is deterministic across devices
      const partialSync = ahpServer.syncSessionDelta({ sessionId, sinceSeq: 15 });
      expect(partialSync.deltaMessages.length).toBe(5);
      expect(partialSync.deltaMessages.map((m) => m.sequence)).toEqual([16, 17, 18, 19, 20]);
    });
  });
});
