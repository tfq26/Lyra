import fs from 'fs';
import path from 'path';
import os from 'os';
import { UnifiedStore } from '../unifiedStore';

export class ClaudeAdapter {
  private baseDir: string;
  private store: UnifiedStore;
  private watchedFiles: Map<string, number> = new Map();
  private intervalId: NodeJS.Timeout | null = null;

  constructor(store: UnifiedStore) {
    this.store = store;
    this.baseDir = path.join(os.homedir(), '.claude');
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
        .filter((f) => f.isFile() && f.name.endsWith('.jsonl'));

      for (const file of files) {
        const fullPath = path.join(this.baseDir, file.name);
        this.processClaudeLog(file.name.replace('.jsonl', ''), fullPath);
      }
    } catch {
      // Ignore directory scan races
    }
  }

  private processClaudeLog(sessionId: string, filePath: string) {
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
        const unifiedSessionId = `claude-${sessionId}`;

        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (entry.type === 'user' || entry.role === 'user') {
              this.store.appendEvent(unifiedSessionId, {
                agent: 'user',
                type: 'message',
                payload: { text: entry.text || entry.content || '' },
              });
            } else if (entry.type === 'assistant' || entry.role === 'assistant') {
              this.store.appendEvent(unifiedSessionId, {
                agent: 'claude_code',
                type: 'message',
                payload: { text: entry.text || entry.content || '' },
              });
            }
          } catch {}
        }
      }
    } catch {}
  }
}
