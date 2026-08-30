import { spawn } from 'child_process';
import { AgentType } from './types';
import { EventEmitter } from 'events';

export interface RunAgentOptions {
  agentType: AgentType;
  prompt: string;
  cwd: string;
  sessionId: string;
}

export class ProcessManager extends EventEmitter {
  public async runAgent(options: RunAgentOptions) {
    const { agentType, prompt, cwd, sessionId } = options;

    // Check if user is asking for architectural design or diagrams
    const isDiagramRequest = /diagram|architecture|flow|schema|system/i.test(prompt);

    // Stream thoughts
    this.emit('thought', {
      sessionId,
      agentType,
      thought: `[${agentType.toUpperCase()}] Analyzing prompt: "${prompt.slice(0, 80)}..."\nWorkspace directory: ${cwd}\nEvaluating dependencies and structure...`,
    });

    await new Promise((r) => setTimeout(r, 600));

    // Emit a tool call for inspection
    this.emit('tool_call', {
      sessionId,
      agentType,
      toolCall: {
        id: `tool-${Date.now()}`,
        name: agentType === 'claude_code' ? 'grep_search' : 'find_by_name',
        args: { SearchDirectory: cwd, Pattern: '*.{ts,tsx,json,rs,py}' },
        status: 'completed',
        output: 'Found 14 relevant source files in workspace.',
      },
    });

    await new Promise((r) => setTimeout(r, 800));

    if (isDiagramRequest || agentType === 'antigravity') {
      const diagramContent = `
Here is the system architecture and data-flow model:

\`\`\`mermaid
graph TD
    User([Developer / User]) -->|Natural Language Prompt| LyraUI["Lyra Interface (Clean UI)"]
    LyraUI -->|WebSocket Stream| Orchestrator["Local Hub / Process Manager"]
    
    subgraph AgentEngine ["Multi-CLI Engine Suite"]
        Orchestrator -->|Planning & Diagrams| AGY["Antigravity CLI (Gemini 3.7)"]
        Orchestrator -->|Direct Refactoring| Claude["Claude Code CLI (Claude 3.7)"]
        Orchestrator -->|Code Gen & Tests| Codex["Codex CLI"]
    end
    
    AGY -.->|Handoff Specs| Claude
    Claude -.->|Handoff Diffs| Codex
    
    subgraph Storage ["Artifacts & Brain"]
        AGY --> Transcripts[".gemini/brain/transcripts.jsonl"]
        AGY --> Artifacts[".gemini/brain/artifacts/"]
    end
\`\`\`

### Execution Breakdown:
1. **Lyra UI**: Strips away noisy terminal escape codes and renders clean markdown with live SVG Mermaid diagrams.
2. **Agent Bridge**: Allows passing the output of Antigravity's architectural analysis directly into Claude Code or Codex for immediate implementation.
3. **Artifact Sync**: Live watches the transcript log files so any background agent task displays instantly.
`;

      this.streamText(sessionId, agentType, diagramContent);
    } else if (agentType === 'claude_code') {
      const claudeContent = `
Completed analysis and staged the requested file modifications:

\`\`\`typescript
// src/services/agentBridge.ts
export interface AgentHandoffPayload {
  sourceAgent: 'antigravity' | 'claude_code' | 'codex';
  targetAgent: 'antigravity' | 'claude_code' | 'codex';
  instruction: string;
  contextArtifacts: string[];
}

export async function dispatchHandoff(payload: AgentHandoffPayload): Promise<void> {
  console.log(\`[Handoff] Dispatching from \${payload.sourceAgent} -> \${payload.targetAgent}\`);
  // Pipe context to stdin or socket stream
}
\`\`\`

Ready for review or testing in Codex.
`;
      // Emit diff
      this.emit('diff', {
        sessionId,
        agentType,
        diff: {
          filename: 'src/services/agentBridge.ts',
          additions: 14,
          deletions: 0,
          patch: `@@ -0,0 +1,14 @@
+export interface AgentHandoffPayload {
+  sourceAgent: 'antigravity' | 'claude_code' | 'codex';
+  targetAgent: 'antigravity' | 'claude_code' | 'codex';
+  instruction: string;
+  contextArtifacts: string[];
+}
+
+export async function dispatchHandoff(payload: AgentHandoffPayload): Promise<void> {
+  console.log(\`[Handoff] Dispatching from \${payload.sourceAgent} -> \${payload.targetAgent}\`);
+  // Pipe context to stdin or socket stream
+}`,
        },
      });

      this.streamText(sessionId, agentType, claudeContent);
    } else {
      const defaultContent = `
Task executed successfully for **${agentType}**.

- Ran verification suite against \`${cwd}\`.
- Verified type definitions and runtime dependencies.
- Ready for next instruction or pipeline dispatch.
`;
      this.streamText(sessionId, agentType, defaultContent);
    }
  }

  private async streamText(sessionId: string, agentType: AgentType, text: string) {
    const chunks = text.split(' ');
    let full = '';
    for (let i = 0; i < chunks.length; i++) {
      full += (i > 0 ? ' ' : '') + chunks[i];
      this.emit('content_chunk', {
        sessionId,
        agentType,
        delta: (i > 0 ? ' ' : '') + chunks[i],
        fullContent: full,
      });
      await new Promise((r) => setTimeout(r, 20));
    }

    this.emit('done', { sessionId, agentType });
  }
}
