import { describe, expect, it } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { ScribeAgent } from './scribeAgent';

describe('ScribeAgent', () => {
  it('generates architecture.md and AGENTS.md in the target workspace', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lyra-scribe-test-'));
    try {
      const scribe = new ScribeAgent();
      const result = await scribe.generateDocumentation({
        workspacePath: tempDir,
        objective: 'Add user authentication and rate limiting',
        diffs: [{ filename: 'server/auth.ts', additions: 10, deletions: 0 }, { filename: 'src/Login.tsx', additions: 5, deletions: 1 }],
        tasks: [{ title: 'Implement JWT verification', scope: 'server/auth.ts' }],
        criteria: ['Tokens must expire after 15 minutes', 'Invalid tokens return 401'],
      });

      expect(result.architectureUpdated).toBe(true);
      expect(result.agentsMapUpdated).toBe(true);

      const archContent = await fs.readFile(path.join(tempDir, 'docs', 'architecture.md'), 'utf-8');
      expect(archContent).toContain('Add user authentication and rate limiting');
      expect(archContent).toContain('mermaid');
      expect(archContent).toContain('server/auth.ts');

      const agentsContent = await fs.readFile(path.join(tempDir, 'AGENTS.md'), 'utf-8');
      expect(agentsContent).toContain('Machine Context Map for AI Agents');
      expect(agentsContent).toContain('Self-Documenting Code');
      expect(agentsContent).toContain('server/auth.ts');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
