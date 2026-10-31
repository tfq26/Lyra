import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';

export interface PreviewInstance {
  runId: string;
  port: number;
  url: string;
  worktreePath?: string;
  process: ChildProcess;
  startedAt: string;
}

export class PreviewManager {
  private activePreviews = new Map<string, PreviewInstance>();

  private findAvailablePort(startPort = 5174, maxTries = 30): Promise<number> {
    return new Promise((resolve, reject) => {
      let currentPort = startPort;
      const tryPort = () => {
        if (currentPort >= startPort + maxTries) {
          return reject(new Error('No available preview port found.'));
        }
        const server = net.createServer();
        server.unref();
        server.on('error', () => {
          currentPort++;
          tryPort();
        });
        server.listen(currentPort, () => {
          server.close(() => {
            resolve(currentPort);
          });
        });
      };
      tryPort();
    });
  }

  public async startPreview(runId: string, worktreePath: string): Promise<{ url: string; port: number }> {
    const existing = this.activePreviews.get(runId);
    if (existing) {
      return { url: existing.url, port: existing.port };
    }

    const port = await this.findAvailablePort();
    const url = `http://localhost:${port}`;

    const child = spawn('/bin/sh', ['-lc', `PORT=${port} bun run dev -- --port ${port} || npm run dev -- --port ${port}`], {
      cwd: worktreePath,
      env: { ...process.env, PORT: String(port) },
      stdio: 'pipe',
    });

    const instance: PreviewInstance = {
      runId,
      port,
      url,
      worktreePath,
      process: child,
      startedAt: new Date().toISOString(),
    };

    child.on('exit', () => {
      if (this.activePreviews.get(runId)?.process === child) {
        this.activePreviews.delete(runId);
      }
    });

    this.activePreviews.set(runId, instance);
    return { url, port };
  }

  public getActivePreviews(): { runId: string; port: number; url: string; worktreePath?: string; startedAt: string }[] {
    return Array.from(this.activePreviews.values()).map((p) => ({
      runId: p.runId,
      port: p.port,
      url: p.url,
      worktreePath: p.worktreePath,
      startedAt: p.startedAt,
    }));
  }

  public stopPreview(runId: string): boolean {
    const existing = this.activePreviews.get(runId);
    if (!existing) return false;
    existing.process.kill('SIGTERM');
    this.activePreviews.delete(runId);
    return true;
  }

  public getPreview(runId: string): { url: string; port: number } | undefined {
    const existing = this.activePreviews.get(runId);
    return existing ? { url: existing.url, port: existing.port } : undefined;
  }

  public stopAll(): void {
    for (const [runId] of this.activePreviews) {
      this.stopPreview(runId);
    }
  }
}
