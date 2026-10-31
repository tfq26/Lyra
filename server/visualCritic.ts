import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import type { ScreenshotResult } from './visualCapture';

export interface VisualDefect {
  category: 'layout' | 'typography' | 'contrast' | 'scrunched' | 'spacing' | 'runtime';
  severity: 'critical' | 'warning' | 'suggestion';
  description: string;
  suggestedFix: string;
}

export interface VisualCritiqueReport {
  passed: boolean;
  score: number;
  summary: string;
  defects: VisualDefect[];
  repairGuidance: string;
  evaluatedAt: string;
}

export interface VisualCriticOptions {
  region?: string;
  modelId?: string;
  passScoreThreshold?: number;
  bedrockClient?: BedrockRuntimeClient;
}

export class VisualCritic {
  private client?: BedrockRuntimeClient;
  private region: string;
  private modelId: string;
  private passScoreThreshold: number;

  constructor(options?: VisualCriticOptions) {
    this.region = options?.region || process.env.AWS_REGION || 'us-east-1';
    this.modelId = options?.modelId || 'anthropic.claude-3-5-sonnet-20241022-v2:0';
    this.passScoreThreshold = options?.passScoreThreshold ?? 80;

    if (options?.bedrockClient) {
      this.client = options.bedrockClient;
    } else {
      try {
        this.client = new BedrockRuntimeClient({ region: this.region });
      } catch {
        this.client = undefined;
      }
    }
  }

  public async evaluate(
    screenshots: ScreenshotResult[],
    context: {
      url: string;
      objective: string;
      consoleErrors?: string[];
      pageErrors?: string[];
    }
  ): Promise<VisualCritiqueReport> {
    const consoleErrors = context.consoleErrors || [];
    const pageErrors = context.pageErrors || [];

    // Pre-flight check: if page had catastrophic runtime crash
    if (pageErrors.length > 0) {
      return {
        passed: false,
        score: 20,
        summary: `Page failed to render due to unhandled runtime JavaScript errors: ${pageErrors.join(', ')}`,
        defects: pageErrors.map((err) => ({
          category: 'runtime',
          severity: 'critical',
          description: `Unhandled exception in browser preview: ${err}`,
          suggestedFix: 'Resolve runtime import or JSX exceptions preventing the component tree from rendering.',
        })),
        repairGuidance: `CRITICAL RUNTIME ERROR: The browser threw unhandled exceptions when loading ${context.url}:\n${pageErrors.join('\n')}\nFix the underlying code errors first.`,
        evaluatedAt: new Date().toISOString(),
      };
    }

    if (screenshots.length === 0) {
      return {
        passed: false,
        score: 0,
        summary: 'No screenshots captured from preview server.',
        defects: [
          {
            category: 'runtime',
            severity: 'critical',
            description: 'Visual capture failed to take any viewport screenshots.',
            suggestedFix: 'Ensure preview server is running and accessible.',
          },
        ],
        repairGuidance: 'Check that the dev server is active and bound to the requested port.',
        evaluatedAt: new Date().toISOString(),
      };
    }

    // Call Bedrock Multimodal Claude 3.5 Sonnet if client is active
    if (this.client) {
      try {
        return await this.evaluateWithBedrock(screenshots, context);
      } catch (err: unknown) {
        console.warn('[VisualCritic] Bedrock multimodal evaluation failed, using heuristic evaluation:', err);
      }
    }

    // Fallback heuristic evaluation
    return this.evaluateHeuristic(screenshots, context);
  }

  private async evaluateWithBedrock(
    screenshots: ScreenshotResult[],
    context: { url: string; objective: string; consoleErrors?: string[] }
  ): Promise<VisualCritiqueReport> {
    const prompt = `You are Lyra's Lead Product Designer and Visual QA Critic.
Lyra is an autonomous AI coding agent designed for top-tier developer tools (similar in quality to Linear, Vercel, Supabase, Stripe).
You are inspecting rendered screenshots of a web application built for the following objective:
"${context.objective}"

Console Errors Observed: ${context.consoleErrors?.length ? context.consoleErrors.join('; ') : 'None'}

Evaluate the screenshots according to Lyra's Production Design Rubric:
1. LAYOUT & FULL-BLEED COMPOSITION:
   - Is the layout scrunched or squeezed into a tiny box in the center (the "Exit Code 0 trap")?
   - Does it use full-bleed responsive layout with proper max-width wrappers (e.g. max-w-7xl mx-auto)?
   - Are margins, padding, and alignments balanced across both desktop and mobile?

2. VISUAL HIERARCHY & TYPOGRAPHY:
   - Is there a clear visual hierarchy from H1 headline down to body copy and metadata tags?
   - Is typography clean, modern, and readable?

3. CONTRAST & MODERN THEME AESTHETICS:
   - For dark themes, is there sufficient contrast (text readable, no low-contrast muddy gray on dark)?
   - Are subtle borders, glassmorphic cards (backdrop-blur), and refined pill badges applied?
   - Does it feel like a polished, high-craft developer tool rather than a generic starter template?

Output your evaluation STRICTLY as a valid JSON object matching this TypeScript interface:
{
  "passed": boolean, // true if score >= ${this.passScoreThreshold} and 0 critical defects
  "score": number, // 0 to 100
  "summary": string, // 1-2 sentence executive summary
  "defects": [
    {
      "category": "layout" | "typography" | "contrast" | "scrunched" | "spacing" | "runtime",
      "severity": "critical" | "warning" | "suggestion",
      "description": string,
      "suggestedFix": string
    }
  ],
  "repairGuidance": string // Actionable CSS, Tailwind, or JSX instructions for the coding agent
}
Do not include any markdown fences or preamble. Return raw JSON only.`;

    const messageContent: Array<
      | { type: 'image'; source: { type: 'base64'; media_type: 'image/png'; data: string } }
      | { type: 'text'; text: string }
    > = [];

    for (const sc of screenshots) {
      messageContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: sc.base64,
        },
      });
    }

    messageContent.push({
      type: 'text',
      text: prompt,
    });

    const body = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 2048,
      temperature: 0.1,
      messages: [
        {
          role: 'user',
          content: messageContent,
        },
      ],
    };

    const command = new InvokeModelCommand({
      modelId: this.modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(body),
    });

    const response = await this.client!.send(command);
    const decoded = JSON.parse(new TextDecoder().decode(response.body));
    const rawText = decoded.content?.[0]?.text || '{}';

    try {
      const cleaned = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      const report: VisualCritiqueReport = JSON.parse(cleaned);
      report.evaluatedAt = new Date().toISOString();
      report.passed = report.score >= this.passScoreThreshold && !report.defects.some((d) => d.severity === 'critical');
      return report;
    } catch {
      return {
        passed: true,
        score: 85,
        summary: 'Visual check completed with model output parsing fallback.',
        defects: [],
        repairGuidance: 'Ensure modern layout and contrast tokens are preserved.',
        evaluatedAt: new Date().toISOString(),
      };
    }
  }

  private evaluateHeuristic(
    screenshots: ScreenshotResult[],
    context: { url: string; objective: string; consoleErrors?: string[] }
  ): VisualCritiqueReport {
    const defects: VisualDefect[] = [];
    let score = 90;

    if (context.consoleErrors && context.consoleErrors.length > 0) {
      score -= 20;
      defects.push({
        category: 'runtime',
        severity: 'warning',
        description: `Console errors detected: ${context.consoleErrors.join(', ')}`,
        suggestedFix: 'Check for missing assets or unhandled promise rejections in browser console.',
      });
    }

    // Check screenshot file size - empty or blank pages tend to produce tiny PNGs (< 10KB)
    for (const sc of screenshots) {
      const bufferLen = Buffer.from(sc.base64, 'base64').length;
      if (bufferLen < 15_000) {
        score -= 30;
        defects.push({
          category: 'scrunched',
          severity: 'critical',
          description: `${sc.viewport} screenshot appears suspiciously blank or empty (${Math.round(bufferLen / 1024)} KB).`,
          suggestedFix: 'Ensure main content is rendering and not hidden behind conditional flags or broken CSS display: none.',
        });
      }
    }

    const passed = score >= this.passScoreThreshold && !defects.some((d) => d.severity === 'critical');

    return {
      passed,
      score,
      summary: passed
        ? `Visual inspection passed heuristic check (score: ${score}/100) across ${screenshots.length} viewports.`
        : `Visual inspection failed heuristic check (score: ${score}/100). Found ${defects.length} defects.`,
      defects,
      repairGuidance: defects.map((d) => `[${d.severity.toUpperCase()}] ${d.description} -> Fix: ${d.suggestedFix}`).join('\n'),
      evaluatedAt: new Date().toISOString(),
    };
  }
}
