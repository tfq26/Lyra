import { describe, expect, test } from 'bun:test';
import { ContextOptimizer } from './contextOptimizer';

describe('ContextOptimizer (Headroom-style CCR + Working-Set Ledger)', () => {
  test('compresses older oversized code/json tool results and allows exact line retrieval', async () => {
    const optimizer = new ContextOptimizer();
    const longCode = Array.from({ length: 80 }, (_, i) => `export function fn${i}() { return ${i}; }`).join('\n');

    const res = optimizer.optimizeGatewayTurn({
      sessionId: 'sess-ccr-1',
      tailKeepCount: 2,
      messages: [
        { role: 'user', content: 'Inspect src/big.ts' },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu_1', name: 'read_file', input: { path: 'src/big.ts' } }],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', toolUseId: 'tu_1', content: longCode }],
        },
        { role: 'assistant', content: 'Read src/big.ts.' },
        { role: 'user', content: 'Now switch models and summarize.' },
      ],
    });

    expect(res.stats.compressedBlocks).toBe(1);
    expect(res.stats.savedChars).toBeGreaterThan(1000);
    expect(res.workingSetBlock).toContain('src/big.ts');
    expect(res.workingSetBlock).toContain('ctx_');

    const compressedBlock = (res.messages[2]!.content as any[])[0].content as string;
    const match = compressedBlock.match(/id=(ctx_[a-f0-9]+)/);
    expect(match).not.toBeNull();

    const fetched = await optimizer.retrieveBlob(match![1]!, { startLine: 10, endLine: 12 });
    expect(fetched.found).toBe(true);
    expect(fetched.totalLines).toBe(80);
    expect(fetched.content).toContain('fn9()');
    expect(fetched.content).toContain('fn11()');
  });

  test('summarizes large JSON arrays by schema + sample items', () => {
    const optimizer = new ContextOptimizer();
    const rows = Array.from({ length: 40 }, (_, i) => ({ id: i, name: `item-${i}`, active: true }));
    const raw = JSON.stringify(rows);
    const id = optimizer.storeBlob(raw, 'json', 'sess-json');
    const stub = optimizer.compressPayload(raw, 'json', id, 'rows.json');
    expect(stub).toContain('Array(len=40');
    expect(stub).toContain('itemKeys=[id, name, active]');
    expect(stub).toContain(`retrieve_context("${id}")`);
  });
});
