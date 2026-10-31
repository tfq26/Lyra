import fs from 'fs';
import path from 'path';
import { chromium, type Browser } from 'playwright';

export interface ViewportConfig {
  name: 'desktop' | 'mobile';
  width: number;
  height: number;
}

export interface ScreenshotResult {
  viewport: 'desktop' | 'mobile';
  filePath: string;
  base64: string;
  width: number;
  height: number;
}

export interface CaptureReport {
  success: boolean;
  url: string;
  screenshots: ScreenshotResult[];
  consoleErrors: string[];
  pageErrors: string[];
  error?: string;
  durationMs: number;
}

export class VisualCapture {
  private outputDir: string;

  constructor(outputDir = '.lyra/screenshots') {
    this.outputDir = outputDir;
  }

  public async capturePreview(
    url: string,
    runId: string,
    customViewports?: ViewportConfig[]
  ): Promise<CaptureReport> {
    const startTime = Date.now();
    const resolvedDir = path.resolve(process.cwd(), this.outputDir);
    if (!fs.existsSync(resolvedDir)) {
      fs.mkdirSync(resolvedDir, { recursive: true });
    }

    const viewports: ViewportConfig[] = customViewports || [
      { name: 'desktop', width: 1440, height: 900 },
      { name: 'mobile', width: 375, height: 812 },
    ];

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const screenshots: ScreenshotResult[] = [];

    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });

      for (const vp of viewports) {
        const page = await browser.newPage({
          viewport: { width: vp.width, height: vp.height },
        });

        page.on('console', (msg) => {
          if (msg.type() === 'error') {
            consoleErrors.push(msg.text());
          }
        });

        page.on('pageerror', (err) => {
          pageErrors.push(err.message);
        });

        // Navigate with timeout
        await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 }).catch(async () => {
          // If networkidle times out (e.g. streaming sockets), fall back to domcontentloaded
          await page.waitForLoadState('domcontentloaded');
        });

        // Give animations or client-side hydration 500ms to settle
        await new Promise((r) => setTimeout(r, 600));

        const fileName = `run-${runId}-${vp.name}.png`;
        const filePath = path.join(resolvedDir, fileName);

        const imageBuffer = await page.screenshot({
          path: filePath,
          fullPage: false,
        });

        screenshots.push({
          viewport: vp.name,
          filePath,
          base64: imageBuffer.toString('base64'),
          width: vp.width,
          height: vp.height,
        });

        await page.close();
      }

      await browser.close();

      return {
        success: true,
        url,
        screenshots,
        consoleErrors,
        pageErrors,
        durationMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      if (browser) {
        await browser.close().catch(() => {});
      }
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        url,
        screenshots,
        consoleErrors,
        pageErrors,
        error: errorMessage,
        durationMs: Date.now() - startTime,
      };
    }
  }
}
