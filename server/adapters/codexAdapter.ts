import fs from 'fs';
import path from 'path';
import os from 'os';
import { UnifiedStore } from '../unifiedStore';

export class CodexAdapter {
  private baseDir: string;
  private store: UnifiedStore;
  private watchedFiles: Map<string, number> = new Map();
  private intervalId: NodeJS.Timeout | null = null;

  constructor(store: UnifiedStore) {
    this.store = store;
    this.baseDir = path.join(os.homedir(), '.codex');
  }

  public start() {
    if (!fs.existsSync(this.baseDir)) return;

    this.syncRecent();

    this.intervalId = setInterval(() => {
      this.syncRecent();
    }, 3000);
  }

  public stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }

  private syncRecent() {
    try {
      if (!fs.existsSync(this.baseDir)) return;
      const files = fs.readdirSync(this.baseDir, { withFileTypes: true })
        .filter((f) => f.isFile() && (f.name.endsWith('.json') || f.name.endsWith('.jsonl')));

      for (const file of files) {
        const fullPath = path.join(this.baseDir, file.name);
        this.processCodexLog(file.name.replace(/\.(json|jsonl)$/, ''), fullPath);
      }
    } catch {
      // Ignore scan hiccups
    }
  }

  private processCodexLog(sessionId: string, filePath: string) {
    try {
      const stats = fs.statSync(filePath);
      const prevSize = this.watchedFiles.get(filePath) || 0;

      if (stats.size > prevSize) {
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(stats.size - prevSize);
        fs.readSync(fd, buffer, 0, buffer.length, prevSize);
        fs.closeSync(fd);

        this.watchedFiles.set(filePath, stats.size);

        const lines = buffer.toString('utf-8').split('\n').filter(Boolean);
        const unifiedSessionId = `codex-${sessionId}`;

        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (entry.role === 'user') {
              this.store.appendEvent(unifiedSessionId, {
                agent: 'user',
                type: 'message',
                payload: { text: entry.content || '' },
              });
            } else {
              this.store.appendEvent(unifiedSessionId, {
                agent: 'codex',
                type: 'message',
                payload: { text: entry.content || '' },
              });
            }
          } catch {}
        }
      }
    } catch {}
  }
}
