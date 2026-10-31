import { describe, it, expect, mock } from 'bun:test';
import { VisualCritic } from './visualCritic';
import { VerificationRunner } from './verificationRunner';
import type { ScreenshotResult } from './visualCapture';

describe('VisualCritic & Verification Loop', () => {
  it('flags critical defects when page runtime errors occur', async () => {
    const critic = new VisualCritic();
    const result = await critic.evaluate([], {
      url: 'http://localhost:5174',
      objective: 'Render developer portal',
      pageErrors: ['Uncaught TypeError: Cannot read properties of undefined (reading "map")'],
    });

    expect(result.passed).toBe(false);
    expect(result.score).toBeLessThan(50);
    expect(result.defects.length).toBeGreaterThan(0);
    expect(result.defects[0]?.severity).toBe('critical');
    expect(result.repairGuidance).toContain('CRITICAL RUNTIME ERROR');
  });

  it('fails when no screenshots are captured', async () => {
    const critic = new VisualCritic();
    const result = await critic.evaluate([], {
      url: 'http://localhost:5174',
      objective: 'Render landing page',
    });

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.summary).toContain('No screenshots captured');
  });

  it('heuristic evaluator passes adequate screenshots and flags console warnings', async () => {
    // Fake 20KB base64 string
    const fakeBase64 = Buffer.alloc(25_000, 'x').toString('base64');
    const screenshots: ScreenshotResult[] = [
      {
        viewport: 'desktop',
        filePath: '/tmp/test.png',
        base64: fakeBase64,
        width: 1440,
        height: 900,
      },
    ];

    const critic = new VisualCritic({ passScoreThreshold: 70 });
    const result = await critic.evaluate(screenshots, {
      url: 'http://localhost:5174',
      objective: 'Render high polish HUD',
      consoleErrors: ['[Warning] Deprecated feature used'],
    });

    expect(result.passed).toBe(true);
    expect(result.score).toBe(70); // 90 - 20 console penalty
    expect(result.defects.some((d) => d.category === 'runtime')).toBe(true);
  });

  it('evaluates with Bedrock multimodal mock response', async () => {
    const mockReport = {
      passed: true,
      score: 95,
      summary: 'Excellent modern full-bleed dark theme layout with Linear/Vercel aesthetic tokens.',
      defects: [
        {
          category: 'spacing',
          severity: 'suggestion',
          description: 'Increase bottom padding on mobile nav by 4px',
          suggestedFix: 'Add pb-4 to mobile container',
        },
      ],
      repairGuidance: 'No critical repairs required.',
    };

    const fakeBedrockClient = {
      send: mock(() => Promise.resolve({
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [
              {
                type: 'text',
                text: JSON.stringify(mockReport),
              },
            ],
          })
        ),
      })),
    };

    const fakeBase64 = Buffer.alloc(20_000, 'x').toString('base64');
    const screenshots: ScreenshotResult[] = [
      {
        viewport: 'desktop',
        filePath: '/tmp/test.png',
        base64: fakeBase64,
        width: 1440,
        height: 900,
      },
    ];

    const critic = new VisualCritic({ bedrockClient: fakeBedrockClient as any });
    const result = await critic.evaluate(screenshots, {
      url: 'http://localhost:5174',
      objective: 'Design modern dark portal',
    });

    expect(result.passed).toBe(true);
    expect(result.score).toBe(95);
    expect(result.summary).toContain('Linear/Vercel aesthetic tokens');
    expect(fakeBedrockClient.send).toHaveBeenCalledTimes(1);
  });

  it('VerificationRunner discovers visual critique check when frontend files are modified', () => {
    const runner = new VerificationRunner();
    const checks = runner.discoverProjectChecks(process.cwd(), [
      'site/src/pages/Home.tsx',
      'site/src/components/Cockpit.tsx',
    ]);

    const visualCheck = checks.find((c) => c.command === 'lyra visual-critique');
    expect(visualCheck).toBeDefined();
    expect(visualCheck?.name).toBe('Visual Design & Layout Critique');
  });

  it('VerificationRunner does not add visual critique check for pure backend changes', () => {
    const runner = new VerificationRunner();
    const checks = runner.discoverProjectChecks(process.cwd(), [
      'server/bedrockGuardrails.ts',
      'server/unifiedStore.ts',
    ]);

    const visualCheck = checks.find((c) => c.command === 'lyra visual-critique');
    expect(visualCheck).toBeUndefined();
  });
});
