import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Agent, SessionManager, tool } from '@strands-agents/sdk';
import { LocalFileStorage } from '@strands-agents/sdk/storage';
import { z } from 'zod';
import type { ModelCompatibilityResult, ModelProviderProfile } from './types';
import type { UnifiedStore } from './unifiedStore';
import { createStrandsModel } from './modelFactory';
import { redactSecrets } from './security';

const SUITE_VERSION = 'lyra-compat-v1';

export class ModelCompatibilityService {
  constructor(private readonly store: UnifiedStore) {}

  public async check(profileId: string): Promise<ModelCompatibilityResult> {
    const profile = this.store.listModelProviderProfiles().find((item) => item.id === profileId);
    if (!profile) throw new Error('Model provider connection was not found.');
    const capabilities: ModelCompatibilityResult['capabilities'] = {
      streaming: { passed: false }, toolCalling: { passed: false }, structuredOutput: { passed: false }, cancellation: { passed: false }, sessionResume: { passed: false },
    };
    const warnings: string[] = [];
    const model = await createStrandsModel(profile);
    let usageTotal = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    const streamAgent = new Agent({ model, name: 'Lyra compatibility check' });
    try {
      const stream = streamAgent.stream('Reply with exactly LYRA_STREAM_OK.', { limits: { turns: 1, outputTokens: 40 } });
      let streamedText = '';
      let streamResult;
      while (true) {
        const next = await stream.next();
        if (next.done) { streamResult = next.value; break; }
        const event = next.value;
        if (event.type === 'modelStreamUpdateEvent' && event.event.type === 'modelContentBlockDeltaEvent' && event.event.delta.type === 'textDelta') streamedText += event.event.delta.text || '';
      }
      capabilities.streaming = { passed: streamedText.length > 0, detail: streamedText.length ? 'Text deltas received.' : 'No streamed text deltas.' };
      this.addUsage(usageTotal, streamResult.metrics?.agentInvocations.at(-1)?.usage);
    } catch (error) { capabilities.streaming.detail = this.reason(error); }
    await streamAgent.shutdown().catch(() => undefined);

    let called = false;
    const probe = tool({ name: 'compatibility_probe', description: 'Return the supplied marker exactly as given.', inputSchema: { type: 'object', properties: { marker: { type: 'string' } }, required: ['marker'], additionalProperties: false }, callback: (input) => { called = true; return String((input as { marker?: unknown }).marker || ''); } });
    const toolAgent = new Agent({ model, tools: [probe], name: 'Lyra compatibility check' });
    try {
      const result = await toolAgent.invoke('Call compatibility_probe with marker "LYRA_TOOL_OK" and then state the returned marker.', { limits: { turns: 3, outputTokens: 100 } });
      capabilities.toolCalling = { passed: called, detail: called ? 'The model requested the tool and completed the round trip.' : 'The model did not call the registered tool.' };
      this.addUsage(usageTotal, result.metrics?.agentInvocations.at(-1)?.usage);
    } catch (error) { capabilities.toolCalling.detail = this.reason(error); }
    await toolAgent.shutdown().catch(() => undefined);

    const structuredAgent = new Agent({ model, name: 'Lyra compatibility check' });
    try {
      const result = await structuredAgent.invoke('Return a valid result with ok set to true and value set to LYRA_JSON_OK.', { structuredOutputSchema: z.object({ ok: z.boolean(), value: z.string() }), limits: { turns: 1, outputTokens: 100 } });
      const output = result.structuredOutput as { ok?: unknown; value?: unknown } | undefined;
      capabilities.structuredOutput = { passed: output?.ok === true && output.value === 'LYRA_JSON_OK', detail: output?.ok === true ? 'Schema-valid structured output.' : 'Model did not satisfy the required schema.' };
      this.addUsage(usageTotal, result.metrics?.agentInvocations.at(-1)?.usage);
    } catch (error) { capabilities.structuredOutput.detail = this.reason(error); }
    await structuredAgent.shutdown().catch(() => undefined);

    const cancelAgent = new Agent({ model, name: 'Lyra cancellation check' });
    const cancelController = new AbortController();
    const cancellationTimer = setTimeout(() => cancelController.abort(), 50);
    try {
      const result = await cancelAgent.invoke('Reply with the word done.', { cancelSignal: cancelController.signal, limits: { turns: 1, outputTokens: 20 } });
      capabilities.cancellation = { passed: result.stopReason === 'cancelled', detail: result.stopReason === 'cancelled' ? 'Cancellation stopped the invocation.' : 'The invocation completed before cancellation took effect.' };
    } catch (error) {
      capabilities.cancellation = cancelController.signal.aborted && (error as { name?: string }).name === 'AbortError'
        ? { passed: true, detail: 'Cancellation aborted the invocation.' }
        : { passed: false, detail: this.reason(error) };
    } finally { clearTimeout(cancellationTimer); }
    await cancelAgent.shutdown().catch(() => undefined);

    const sessionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lyra-compat-session-'));
    try {
      const storage = new LocalFileStorage(sessionRoot);
      const sessionId = `compat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const first = new Agent({ model, sessionManager: new SessionManager({ sessionId, storage, saveLatestOn: 'message' }), name: 'Lyra compatibility check' });
      await first.invoke('Remember this exact marker for the next turn: LYRA_SESSION_OK.', { limits: { turns: 1, outputTokens: 50 } });
      await first.shutdown();
      const second = new Agent({ model, sessionManager: new SessionManager({ sessionId, storage, saveLatestOn: 'message' }), name: 'Lyra compatibility check' });
      const resumed = await second.invoke('What exact marker did I ask you to remember?', { limits: { turns: 1, outputTokens: 50 } });
      const response = resumed.lastMessage.content.filter((item) => 'text' in item).map((item) => 'text' in item ? item.text : '').join('');
      capabilities.sessionResume = { passed: response.includes('LYRA_SESSION_OK'), detail: response.includes('LYRA_SESSION_OK') ? 'Context restored in a new agent instance.' : 'The new agent instance did not recover the prior turn.' };
      await second.shutdown();
      this.addUsage(usageTotal, resumed.metrics?.agentInvocations.at(-1)?.usage);
    } catch (error) { capabilities.sessionResume.detail = this.reason(error); }
    finally { fs.rmSync(sessionRoot, { recursive: true, force: true }); }

    for (const [name, result] of Object.entries(capabilities)) if (!result.passed) warnings.push(`${name}: ${result.detail || 'check did not pass'}`);
    const result: ModelCompatibilityResult = {
      provider: profile.provider,
      model: profile.model,
      tier: Object.values(capabilities).every((item) => item.passed) ? 'full' : 'limited',
      capabilities,
      testedAt: new Date().toISOString(),
      suiteVersion: SUITE_VERSION,
      warnings,
      ...(usageTotal.totalTokens ? { usage: usageTotal } : {}),
    };
    this.store.saveModelCompatibility(profileId, result);
    return result;
  }

  private addUsage(total: { promptTokens: number; completionTokens: number; totalTokens: number }, usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }) {
    if (!usage) return;
    total.promptTokens += usage.inputTokens || 0;
    total.completionTokens += usage.outputTokens || 0;
    total.totalTokens += usage.totalTokens || 0;
  }

  private reason(error: unknown) { return String(redactSecrets(error instanceof Error ? error.message : String(error))).slice(0, 400); }
}
