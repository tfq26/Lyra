/**
 * Lyra Autonomous Horizon Scout (`server/horizonScout.ts`)
 *
 * Bi-weekly autonomous intelligence & product evolution agent.
 * Scans the frontier of AI coding harnesses, model APIs, MCP protocols, and UI paradigms,
 * distilling actionable engineering feature tickets into `.lyra/backlog/feature-tickets/`
 * ready for autonomous dispatch by Lyra's swarms.
 */

import fs from 'node:fs';
import path from 'node:path';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

export interface HorizonFeatureTicket {
  id: string;
  title: string;
  domain: 'harness' | 'model-routing' | 'ui-ux' | 'mcp' | 'finops' | 'testing';
  priority: 'p0' | 'p1' | 'p2';
  summary: string;
  motivation: string;
  proposedArchitecture: string[];
  impactedFiles: string[];
  acceptanceCriteria: string[];
  verificationCommand: string;
  estimatedComplexity: 'low' | 'medium' | 'high';
  createdAt: string;
}

export interface HorizonScanResult {
  scanId: string;
  timestamp: string;
  modelUsed: string;
  ticketsGenerated: HorizonFeatureTicket[];
  backlogDir: string;
}

export class HorizonScout {
  private readonly backlogDir: string;
  private readonly bedrockClient: BedrockRuntimeClient;

  constructor(workspaceRoot = process.cwd()) {
    this.backlogDir = path.join(workspaceRoot, '.lyra', 'backlog', 'feature-tickets');
    this.bedrockClient = new BedrockRuntimeClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
  }

  /**
   * Ensures the backlog directory exists.
   */
  private ensureBacklogDir(): void {
    if (!fs.existsSync(this.backlogDir)) {
      fs.mkdirSync(this.backlogDir, { recursive: true });
    }
  }

  /**
   * Generates a template feature ticket file in markdown format for human and agent ingestion.
   */
  public writeTicketToBacklog(ticket: HorizonFeatureTicket): string {
    this.ensureBacklogDir();
    const fileName = `${ticket.id}-${ticket.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
    const filePath = path.join(this.backlogDir, fileName);

    const content = `# Feature Spec: ${ticket.title}

- **Ticket ID:** \`${ticket.id}\`
- **Domain:** \`${ticket.domain}\`
- **Priority:** \`${ticket.priority.toUpperCase()}\`
- **Complexity:** \`${ticket.estimatedComplexity}\`
- **Generated:** ${ticket.createdAt}

---

## 1. Executive Summary & Motivation
${ticket.summary}

### Motivation
${ticket.motivation}

---

## 2. Technical Architecture & Implementation Details
${ticket.proposedArchitecture.map((step) => `- ${step}`).join('\n')}

---

## 3. Impacted Files
${ticket.impactedFiles.map((file) => `- \`${file}\``).join('\n')}

---

## 4. Acceptance Criteria & Automated Verification
${ticket.acceptanceCriteria.map((crit) => `- [ ] ${crit}`).join('\n')}

### Verification Command
\`\`\`bash
${ticket.verificationCommand}
\`\`\`

---

## 5. Autonomous Dispatch Instructions
To execute this ticket autonomously with Lyra:
\`\`\`bash
bun scripts/lyra-dispatch.ts --prompt "Implement feature ${ticket.id}: ${ticket.title}" --workers strands
\`\`\`
`;

    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
  }

  /**
   * Performs an autonomous horizon scan, analyzing the frontier of AI developer tools.
   */
  public async executeScan(modelId = 'us.amazon.nova-2-lite-v1:0'): Promise<HorizonScanResult> {
    this.ensureBacklogDir();
    const scanId = `horizon-scan-${Date.now()}`;
    const timestamp = new Date().toISOString();

    const prompt = `You are Lyra's Lead Autonomous Product Architect and Horizon Scout.
Lyra is an autonomous software engineering swarm system built in TypeScript/Bun, using AWS Bedrock and OpenRouter models, native worktrees, compile gates, and an adaptive 3-lane pipeline.

Review the frontier of AI coding tools, developer harnesses (Cursor, Claude Code, Windsurf, OpenHands, Goose, Aider), Model Context Protocol (MCP) advancements, and developer console UI/UX paradigms.

Produce 2 high-leverage, concrete, production-ready feature tickets that Lyra should autonomously implement next.
Return ONLY a valid JSON array of objects adhering to this schema:
[
  {
    "id": "LYRA-HORIZON-001",
    "title": "Short title",
    "domain": "harness" | "model-routing" | "ui-ux" | "mcp" | "finops" | "testing",
    "priority": "p0" | "p1" | "p2",
    "summary": "1-2 sentence description",
    "motivation": "Why this feature gives Lyra an industry-leading advantage",
    "proposedArchitecture": ["step 1", "step 2"],
    "impactedFiles": ["server/filename.ts"],
    "acceptanceCriteria": ["criterion 1", "criterion 2"],
    "verificationCommand": "bun test server/filename.test.ts",
    "estimatedComplexity": "low" | "medium" | "high"
  }
]`;

    let tickets: HorizonFeatureTicket[] = [];

    try {
      const response = await this.bedrockClient.send(
        new InvokeModelCommand({
          modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            messages: [{ role: 'user', content: [{ text: prompt }] }],
            inferenceConfig: { maxTokens: 3000, temperature: 0.3 },
          }),
        })
      );

      const parsed = JSON.parse(new TextDecoder().decode(response.body));
      const text = parsed?.output?.message?.content?.[0]?.text || '';
      const jsonMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (jsonMatch) {
        const rawTickets = JSON.parse(jsonMatch[0]);
        tickets = rawTickets.map((t: any, idx: number) => ({
          id: t.id || `LYRA-HORIZON-${String(idx + 1).padStart(3, '0')}`,
          title: t.title || 'Frontier Capability Upgrade',
          domain: t.domain || 'harness',
          priority: t.priority || 'p1',
          summary: t.summary || '',
          motivation: t.motivation || '',
          proposedArchitecture: Array.isArray(t.proposedArchitecture) ? t.proposedArchitecture : [],
          impactedFiles: Array.isArray(t.impactedFiles) ? t.impactedFiles : [],
          acceptanceCriteria: Array.isArray(t.acceptanceCriteria) ? t.acceptanceCriteria : [],
          verificationCommand: t.verificationCommand || 'bun test',
          estimatedComplexity: t.estimatedComplexity || 'medium',
          createdAt: timestamp,
        }));
      }
    } catch (err: any) {
      // Deterministic fallback feature tickets if cloud invoke is offline
      tickets = [
        {
          id: 'LYRA-HORIZON-001',
          title: 'Dynamic MCP Tool Hot-Reloading & Stdio Registry',
          domain: 'mcp',
          priority: 'p1',
          summary: 'Allow Lyra swarms to discover and hot-reload Model Context Protocol (MCP) servers on demand without restarting the Hub.',
          motivation: 'Ensures external toolkits (databases, Chrome DevTools, GitHub) can be loaded into active agent sessions dynamically.',
          proposedArchitecture: [
            'Add McpDynamicRegistry in server/harnessMcpServer.ts',
            'Support stdio subprocess health checks and auto-restart',
            'Expose /api/mcp/servers endpoint for frontend management',
          ],
          impactedFiles: ['server/harnessMcpServer.ts', 'server/gateway.ts'],
          acceptanceCriteria: [
            'Dynamic MCP server registers without hub restart',
            'Tools appear in nativeAgentRuntime active tool list',
            'Passes automated unit tests',
          ],
          verificationCommand: 'bun test server/harnessMcpServer.test.ts',
          estimatedComplexity: 'medium',
          createdAt: timestamp,
        },
        {
          id: 'LYRA-HORIZON-002',
          title: 'Live Streaming Token Waterfall & Cost Ceiling Interceptor',
          domain: 'finops',
          priority: 'p0',
          summary: 'Real-time WebSocket token streaming with instantaneous hardware spend-cap pausing at exact dollar thresholds.',
          motivation: 'Prevents rogue subagent token burn and guarantees 100% FinOps predictability under long autonomous runs.',
          proposedArchitecture: [
            'Extend recordRunUsage in server/cloudMonitor.ts with hard spend-cap circuit breaker',
            'Broadcast turn-by-turn token delta events over WebSocket',
            'Add FinOps alert badge in src/components/DiffViewer.tsx',
          ],
          impactedFiles: ['server/cloudMonitor.ts', 'server/teamCoordinator.ts'],
          acceptanceCriteria: [
            'Run pauses automatically when spend reaches $1.00 hard cap',
            'Emits WebSocket notification to all connected clients',
            'Passes cloudMonitor test suite',
          ],
          verificationCommand: 'bun test server/cloudMonitor.test.ts',
          estimatedComplexity: 'low',
          createdAt: timestamp,
        },
      ];
    }

    // Persist each ticket into .lyra/backlog/feature-tickets/
    for (const ticket of tickets) {
      this.writeTicketToBacklog(ticket);
    }

    return {
      scanId,
      timestamp,
      modelUsed: modelId,
      ticketsGenerated: tickets,
      backlogDir: this.backlogDir,
    };
  }
}
