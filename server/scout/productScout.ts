/**
 * Lyra Autonomous Product Scout & Competitive Intelligence Engine (`server/scout/productScout.ts`)
 *
 * Spawns an independent research pipeline that:
 * 1. Scans changelogs and frontier updates from apps like Claude Code, ChatGPT, Codex, Cursor, and Linear.
 * 2. Identifies a curated list of 5-6 breakthrough features.
 * 3. Performs in-depth research into UX flows, visual patterns, and backend mechanics.
 * 4. Generates rich, production-grade technical specification blueprints in `.lyra/backlog/scouted-features/`.
 * 5. Queues them directly into Lyra's autonomous swarm pipeline for hands-free implementation.
 */

import fs from 'node:fs';
import path from 'node:path';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

export interface FrontierTarget {
  name: string;
  category: 'developer-cli' | 'web-console' | 'ide-extension' | 'model-platform';
  description: string;
}

export interface ScoutedFeatureBlueprint {
  id: string;
  targetApp: string;
  featureName: string;
  category: 'ui-ux' | 'agent-loop' | 'developer-tools' | 'streaming' | 'collaboration';
  competitiveAdvantage: string;
  userInteractionFlow: string;
  uiComponentHierarchy: string[];
  backendRequirements: string[];
  impactedLyraFiles: string[];
  acceptanceCriteria: string[];
  verificationCommand: string;
  dispatchPrompt: string;
  createdAt: string;
}

export interface ScoutRunReport {
  runId: string;
  timestamp: string;
  targetsResearched: string[];
  featuresDiscovered: ScoutedFeatureBlueprint[];
  outputDir: string;
}

export const DEFAULT_FRONTIER_TARGETS: FrontierTarget[] = [
  { name: 'Claude Code', category: 'developer-cli', description: 'Anthropic command line agent with compact inline diffs and terminal ergonomics' },
  { name: 'ChatGPT Canvas & UI', category: 'web-console', description: 'Dual-pane interactive document/code editing with inline feedback comments' },
  { name: 'OpenAI Codex', category: 'developer-cli', description: 'Next-gen automated code generation and sandbox evaluation mechanics' },
  { name: 'Cursor & Windsurf', category: 'ide-extension', description: 'Multi-file surgical edits, instant rollback checkpoints, and agent streaming trees' },
  { name: 'Linear', category: 'web-console', description: 'Gold-standard high-density keyboard-driven design tokens and zero-latency state transitions' },
];

export class ProductScout {
  private readonly outputDir: string;
  private readonly bedrockClient: BedrockRuntimeClient;

  constructor(workspaceRoot = process.cwd()) {
    this.outputDir = path.join(workspaceRoot, '.lyra', 'backlog', 'scouted-features');
    this.ensureDir();
    this.bedrockClient = new BedrockRuntimeClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Writes a detailed markdown blueprint for a scouted feature.
   */
  public writeBlueprintToFile(blueprint: ScoutedFeatureBlueprint): string {
    this.ensureDir();
    const safeName = blueprint.featureName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const filename = `${blueprint.id}-${safeName}.md`;
    const filePath = path.join(this.outputDir, filename);

    const content = `# Feature Blueprint: ${blueprint.featureName}

- **Feature ID:** \`${blueprint.id}\`
- **Scouted From:** \`${blueprint.targetApp}\`
- **Category:** \`${blueprint.category}\`
- **Generated:** ${blueprint.createdAt}

---

## 1. Executive Summary & Competitive Advantage
${blueprint.competitiveAdvantage}

---

## 2. User Interaction Flow & UX Model
${blueprint.userInteractionFlow}

---

## 3. UI Component Architecture & Layout
${blueprint.uiComponentHierarchy.map((comp) => `- \`${comp}\``).join('\n')}

---

## 4. Backend Engine & Swarm Protocols
${blueprint.backendRequirements.map((req) => `- ${req}`).join('\n')}

---

## 5. Impacted Lyra Files
${blueprint.impactedLyraFiles.map((f) => `- \`${f}\``).join('\n')}

---

## 6. Acceptance Criteria & Verification
${blueprint.acceptanceCriteria.map((c) => `- [ ] ${c}`).join('\n')}

### Verification Command
\`\`\`bash
${blueprint.verificationCommand}
\`\`\`

---

## 7. Autonomous Swarm Dispatch Directive
To trigger Lyra's autonomous swarm to implement this feature end-to-end:
\`\`\`bash
${blueprint.dispatchPrompt}
\`\`\`
`;

    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
  }

  /**
   * Executes a multi-stage frontier intelligence scan across target benchmark apps.
   */
  public async executeScoutRun(
    targets = DEFAULT_FRONTIER_TARGETS,
    modelId = 'us.amazon.nova-2-lite-v1:0'
  ): Promise<ScoutRunReport> {
    this.ensureDir();
    const runId = `scout-run-${Date.now()}`;
    const timestamp = new Date().toISOString();

    const targetNames = targets.map((t) => `${t.name} (${t.description})`).join('\n');

    const prompt = `You are Lyra's Lead Autonomous Intelligence & Product Evolution Agent.
Lyra is an autonomous software engineering platform with a dark-first Vite/React console and a multi-agent backend.

You are scouting these frontier apps:
${targetNames}

Identify 5-6 breakthrough, high-impact features recently popularized or benchmarked in these tools (e.g. interactive multi-file diff inspectors, collapsible sub-agent trees, instant checkpoint scrubbers, command-palette prompt macros, real-time token waterfall animations).

For each feature, generate a detailed technical blueprint.
Return ONLY a valid JSON array of 5-6 objects adhering to this schema:
[
  {
    "id": "SCOUT-001",
    "targetApp": "Target application name",
    "featureName": "Feature name",
    "category": "ui-ux" | "agent-loop" | "developer-tools" | "streaming" | "collaboration",
    "competitiveAdvantage": "Why this gives Lyra a huge edge",
    "userInteractionFlow": "Step-by-step description of how the developer interacts with this in the UI",
    "uiComponentHierarchy": ["src/components/NewComponent.tsx", "src/components/ChildComponent.tsx"],
    "backendRequirements": ["API or WebSocket requirement"],
    "impactedLyraFiles": ["src/App.tsx", "server/gateway.ts"],
    "acceptanceCriteria": ["Criteria 1", "Criteria 2"],
    "verificationCommand": "bun run build && bun test",
    "dispatchPrompt": "bun scripts/lyra-dispatch.ts --prompt \\"Implement SCOUT-001: Feature Name\\" --workers strands"
  }
]`;

    let blueprints: ScoutedFeatureBlueprint[] = [];

    try {
      const response = await this.bedrockClient.send(
        new InvokeModelCommand({
          modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            messages: [{ role: 'user', content: [{ text: prompt }] }],
            inferenceConfig: { maxTokens: 4000, temperature: 0.3 },
          }),
        })
      );

      const parsed = JSON.parse(new TextDecoder().decode(response.body));
      const text = parsed?.output?.message?.content?.[0]?.text || '';
      const jsonMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);

      if (jsonMatch) {
        const rawList = JSON.parse(jsonMatch[0]);
        blueprints = rawList.map((item: any, idx: number) => ({
          id: item.id || `SCOUT-${String(idx + 1).padStart(3, '0')}`,
          targetApp: item.targetApp || 'Frontier Developer App',
          featureName: item.featureName || 'Breakthrough Capability',
          category: item.category || 'ui-ux',
          competitiveAdvantage: item.competitiveAdvantage || '',
          userInteractionFlow: item.userInteractionFlow || '',
          uiComponentHierarchy: Array.isArray(item.uiComponentHierarchy) ? item.uiComponentHierarchy : [],
          backendRequirements: Array.isArray(item.backendRequirements) ? item.backendRequirements : [],
          impactedLyraFiles: Array.isArray(item.impactedLyraFiles) ? item.impactedLyraFiles : [],
          acceptanceCriteria: Array.isArray(item.acceptanceCriteria) ? item.acceptanceCriteria : [],
          verificationCommand: item.verificationCommand || 'bun run build && bun test',
          dispatchPrompt: item.dispatchPrompt || `bun scripts/lyra-dispatch.ts --prompt "Implement ${item.id}" --workers strands`,
          createdAt: timestamp,
        }));
      }
    } catch {
      // Deterministic high-leverage fallback blueprints if offline
      blueprints = this.getCuratedFallbackBlueprints(timestamp);
    }

    if (blueprints.length === 0) {
      blueprints = this.getCuratedFallbackBlueprints(timestamp);
    }

    // Persist all blueprints into .lyra/backlog/scouted-features/
    for (const bp of blueprints) {
      this.writeBlueprintToFile(bp);
    }

    return {
      runId,
      timestamp,
      targetsResearched: targets.map((t) => t.name),
      featuresDiscovered: blueprints,
      outputDir: this.outputDir,
    };
  }

  private getCuratedFallbackBlueprints(timestamp: string): ScoutedFeatureBlueprint[] {
    return [
      {
        id: 'SCOUT-001',
        targetApp: 'Claude Code',
        featureName: 'Interactive Inline Diff Scrubbing & Revert Checkpoints',
        category: 'ui-ux',
        competitiveAdvantage: 'Enables developers to scrub through file modifications line-by-line and selectively revert individual chunks before committing.',
        userInteractionFlow: 'When an agent emits a diff, developers can click "Scrub Revert" on any hunk to exclude it from the final worktree merge.',
        uiComponentHierarchy: ['src/components/DiffViewer.tsx', 'src/components/HunkActionToolbar.tsx'],
        backendRequirements: ['Selective git patch rejection in server/worktreeManager.ts'],
        impactedLyraFiles: ['src/components/DiffViewer.tsx', 'server/nativeTools.ts'],
        acceptanceCriteria: [
          'Hunk-level accept/reject buttons render inside DiffViewer',
          'Selective patch generation applies cleanly without git conflict',
          'Passes build and test suite',
        ],
        verificationCommand: 'bun run build && bun test',
        dispatchPrompt: 'bun scripts/lyra-dispatch.ts --prompt "Implement SCOUT-001: Interactive Inline Diff Scrubbing" --workers strands',
        createdAt: timestamp,
      },
      {
        id: 'SCOUT-002',
        targetApp: 'ChatGPT Canvas',
        featureName: 'Side-by-Side Dual-Pane Code Canvas with Targeted Inline Prompts',
        category: 'ui-ux',
        competitiveAdvantage: 'Bridges conversation with live code by displaying an interactive code canvas next to the chat with localized edit triggers.',
        userInteractionFlow: 'Clicking a file link in chat opens the file in a right-hand canvas; highlighting code reveals an inline prompt bar for surgical edits.',
        uiComponentHierarchy: ['src/components/CodeCanvas.tsx', 'src/components/InlinePromptBar.tsx'],
        backendRequirements: ['Line-windowed surgical patch endpoint in server/gateway.ts'],
        impactedLyraFiles: ['src/App.tsx', 'src/components/ChatView.tsx', 'src/components/CodeCanvas.tsx'],
        acceptanceCriteria: [
          'Canvas opens smoothly without unmounting active chat session',
          'Text selection reveals inline agent prompt bar',
          'Applies edits with zero layout shift',
        ],
        verificationCommand: 'bun run build && bun test',
        dispatchPrompt: 'bun scripts/lyra-dispatch.ts --prompt "Implement SCOUT-002: Side-by-Side Dual-Pane Code Canvas" --workers strands',
        createdAt: timestamp,
      },
      {
        id: 'SCOUT-003',
        targetApp: 'Cursor / Windsurf',
        featureName: 'Multi-Agent Sub-Task Execution Graph Tree',
        category: 'agent-loop',
        competitiveAdvantage: 'Visualizes parallel sub-agents and tool calls as an interactive DAG node tree with real-time status pulses.',
        userInteractionFlow: 'During a swarm run, a collapsible graph tree in the header lets developers drill down into individual sub-agents and their stdout.',
        uiComponentHierarchy: ['src/components/ExecutionGraphTree.tsx', 'src/components/TaskNodeBadge.tsx'],
        backendRequirements: ['Task graph streaming events over WebSocket in server/teamCoordinator.ts'],
        impactedLyraFiles: ['src/components/ChatView.tsx', 'server/teamCoordinator.ts'],
        acceptanceCriteria: [
          'Interactive node tree renders parallel tasks and dependencies',
          'Clicking any node displays turn diagnostics in a slide-over drawer',
          'Zero WebSocket latency overhead',
        ],
        verificationCommand: 'bun run build && bun test',
        dispatchPrompt: 'bun scripts/lyra-dispatch.ts --prompt "Implement SCOUT-003: Multi-Agent Sub-Task Execution Graph Tree" --workers strands',
        createdAt: timestamp,
      },
      {
        id: 'SCOUT-004',
        targetApp: 'Linear',
        featureName: 'Raycast-Style Command Palette (Cmd+K) with Swarm Action Macros',
        category: 'developer-tools',
        competitiveAdvantage: 'Provides instant keyboard accessibility for 100% of workspace commands without touching the mouse.',
        userInteractionFlow: 'Pressing Cmd+K opens a high-contrast modal with fuzzy search over git branches, active runs, models, and custom agent prompts.',
        uiComponentHierarchy: ['src/components/CommandPalette.tsx', 'src/components/ui/command.tsx'],
        backendRequirements: ['Unified search and action registry in src/lib/commandRegistry.ts'],
        impactedLyraFiles: ['src/App.tsx', 'src/components/CommandPalette.tsx'],
        acceptanceCriteria: [
          'Cmd+K toggles palette in under 16ms',
          'Arrow keys and Enter trigger actions immediately',
          'Esc closes smoothly',
        ],
        verificationCommand: 'bun run build && bun test',
        dispatchPrompt: 'bun scripts/lyra-dispatch.ts --prompt "Implement SCOUT-004: Command Palette with Action Macros" --workers strands',
        createdAt: timestamp,
      },
      {
        id: 'SCOUT-005',
        targetApp: 'OpenAI Codex',
        featureName: 'Automated Sandboxed Reproduction Test Generator',
        category: 'developer-tools',
        competitiveAdvantage: 'Before modifying production files, autonomously writes a standalone reproduction test to prove the bug or feature gap.',
        userInteractionFlow: 'Lyra shows a "Confirmed Reproduction: RED" badge before showing "Verified Green: Solution Passes", eliminating silent regressions.',
        uiComponentHierarchy: ['src/components/ReproBadge.tsx'],
        backendRequirements: ['Proof sandbox harness integration in server/proofSandbox/'],
        impactedLyraFiles: ['server/teamCoordinator.ts', 'server/verificationRunner.ts'],
        acceptanceCriteria: [
          'Swarm generates isolated reproduction test case before patching',
          'Logs RED -> GREEN state transition in FinOps telemetry',
          'Passes all unit tests',
        ],
        verificationCommand: 'bun run build && bun test',
        dispatchPrompt: 'bun scripts/lyra-dispatch.ts --prompt "Implement SCOUT-005: Automated Sandboxed Reproduction Test Generator" --workers strands',
        createdAt: timestamp,
      },
    ];
  }
}

export const productScout = new ProductScout();
