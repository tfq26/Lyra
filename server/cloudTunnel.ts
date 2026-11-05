import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';

export interface TunnelInstance {
  tunnelId: string;
  localPort: number;
  publicUrl: string;
  process: ChildProcess;
  startedAt: string;
}

function resolveCloudflaredBinary(): string {
  const candidates = [
    '/opt/homebrew/bin/cloudflared',
    '/usr/local/bin/cloudflared',
    'cloudflared',
  ];
  for (const c of candidates) {
    if (c.startsWith('/') && fs.existsSync(c)) {
      return c;
    }
  }
  return 'cloudflared';
}

export class CloudTunnelManager {
  private activeTunnels = new Map<string, TunnelInstance>();

  /**
   * Spawns a public HTTPS Cloudflare quick tunnel for the given local port.
   * Resolves with the public URL (e.g. https://xxx.trycloudflare.com).
   */
  public async createTunnel(localPort: number, tunnelId = `tunnel-${Date.now()}`): Promise<{ publicUrl: string; tunnelId: string }> {
    // If a tunnel already exists for this port, return it
    for (const [id, t] of this.activeTunnels.entries()) {
      if (t.localPort === localPort) {
        return { publicUrl: t.publicUrl, tunnelId: id };
      }
    }

    const bin = resolveCloudflaredBinary();
    const env = {
      ...process.env,
      PATH: `${process.env.PATH || ''}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
    };

    return new Promise((resolve, reject) => {
      const child = spawn(bin, ['tunnel', '--url', `http://localhost:${localPort}`], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let resolved = false;
      let urlMatch = '';
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          child.kill('SIGTERM');
          reject(new Error(`Cloudflare tunnel spawn timed out after 15s on port ${localPort}`));
        }
      }, 15000);

      const processLine = (line: string) => {
        // Look for *.trycloudflare.com URL
        const match = line.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (match && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          urlMatch = match[0];

          const instance: TunnelInstance = {
            tunnelId,
            localPort,
            publicUrl: urlMatch,
            process: child,
            startedAt: new Date().toISOString(),
          };

          this.activeTunnels.set(tunnelId, instance);
          resolve({ publicUrl: urlMatch, tunnelId });
        }
      };

      if (child.stdout) {
        const rl = readline.createInterface({ input: child.stdout });
        rl.on('line', processLine);
      }

      if (child.stderr) {
        const rl = readline.createInterface({ input: child.stderr });
        rl.on('line', processLine);
      }

      child.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(err);
        }
      });

      child.on('exit', () => {
        this.activeTunnels.delete(tunnelId);
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(new Error(`cloudflared exited before establishing a tunnel`));
        }
      });
    });
  }

  public getTunnel(tunnelId: string): TunnelInstance | undefined {
    return this.activeTunnels.get(tunnelId);
  }

  public stopTunnel(tunnelId: string): boolean {
    const existing = this.activeTunnels.get(tunnelId);
    if (!existing) return false;
    existing.process.kill('SIGTERM');
    this.activeTunnels.delete(tunnelId);
    return true;
  }

  public stopAll(): void {
    for (const [id] of this.activeTunnels) {
      this.stopTunnel(id);
    }
  }
}

export const cloudTunnelManager = new CloudTunnelManager();
