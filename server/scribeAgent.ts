import fs from 'fs/promises';
import path from 'path';
import type { FileDiff } from './types';

export interface ScribeInput {
  workspacePath: string;
  objective: string;
  diffs: FileDiff[];
  tasks: Array<{ title: string; scope?: string }>;
  criteria: string[];
}

export interface ScribeResult {
  architectureUpdated: boolean;
  agentsMapUpdated: boolean;
  summary: string;
}

export class ScribeAgent {
  public async generateDocumentation(input: ScribeInput): Promise<ScribeResult> {
    const { workspacePath, objective, diffs, tasks, criteria } = input;
    const docsDir = path.join(workspacePath, 'docs');
    await fs.mkdir(docsDir, { recursive: true });

    // 1. Generate or update docs/architecture.md
    const archPath = path.join(docsDir, 'architecture.md');
    const changedFilesList = diffs.map((d: any) => `- \`${d.filename || d.file}\` (${d.status || 'modified'})`).join('\n') || '- None';
    const taskSummary = tasks.map((t) => `- **${t.title}**: ${t.scope || 'Scoped changes'}`).join('\n');
    const criteriaSummary = criteria.map((c) => `- ${c}`).join('\n');

    const architectureContent = `# Architecture & System Blueprint

## Objective
${objective}

## Acceptance Criteria
${criteriaSummary}

## Architecture Overview
This document represents the living system architecture maintained automatically by the Lyra Scribe.

\`\`\`mermaid
flowchart TD
    subgraph Client ["Client / Surface"]
        UI["Lyra Interface (Desktop / Web)"]
    end

    subgraph Hub ["Lyra Operations Hub"]
        Orch["Team Coordinator / Planner"]
        Worktrees["Isolated Git Worktrees"]
        Verify["Verification & Canary Runner"]
        Scribe["Scribe Documentarian"]
    end

    subgraph Storage ["Durable State"]
        GitRepo["Git Repository (Source of Truth)"]
        Postgres["Event Journal"]
    end

    UI -->|WebSocket / HTTP| Orch
    Orch --> Worktrees
    Worktrees --> Verify
    Verify --> Scribe
    Scribe --> GitRepo
    Orch --> Postgres
\`\`\`

## Recent Implementation Tasks
${taskSummary}

## Modified Surface
${changedFilesList}

*Updated automatically by Lyra Scribe on ${new Date().toISOString()}*
`;

    await fs.writeFile(archPath, architectureContent, 'utf-8');

    // 2. Generate or update AGENTS.md (Machine Map for Future Agents)
    const agentsMapPath = path.join(workspacePath, 'AGENTS.md');
    const agentsContent = `# AGENTS.md: Machine Context Map for AI Agents

> **Note for AI Agents**: This file is maintained by Lyra Scribe. Read this file before planning or modifying code in this repository.

## System Invariants & Hard Rules
1. **Git-First Invariant**: The repository is the single source of truth. Never assume uncommitted cloud state.
2. **Clean Scope**: Work only within assigned file scopes. Do not modify unrelated modules.
3. **Self-Documenting Code**: All new exports must include concise TSDoc/JSDoc with @invariant annotations where relevant.
4. **Verification**: Never report completion without passing the project's test suite and verification commands.

## Architecture & Domain Boundaries
- \`src/\`: Client application (Vite, React, Tailwind, Radix UI).
- \`server/\`: Operations Hub, process manager, team coordinator, and native agent runtimes.
- \`docs/\`: Architectural specs, API contracts, and decision records.

## Recent Architectural Changes
- **Objective**: ${objective}
- **Affected Components**:
${diffs.slice(0, 15).map((d: any) => `  - \`${d.filename || d.file}\``).join('\n') || '  - None'}

*Maintained automatically by Lyra Scribe.*
`;

    await fs.writeFile(agentsMapPath, agentsContent, 'utf-8');

    return {
      architectureUpdated: true,
      agentsMapUpdated: true,
      summary: `Scribe generated living architecture at docs/architecture.md and machine map at AGENTS.md.`,
    };
  }
}
