import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';

export class AntigravityWatcher extends EventEmitter {
  private baseDir: string;
  private watchedFiles: Map<string, number> = new Map();
  private intervalId: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.baseDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
  }

  public start() {
    if (!fs.existsSync(this.baseDir)) {
      return;
    }

    // Poll for new conversation directories and transcripts
    this.intervalId = setInterval(() => {
      this.scanDirectory();
    }, 2000);

    this.scanDirectory();
  }

  public stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }

  public getRecentConversations(limit = 10) {
    if (!fs.existsSync(this.baseDir)) return [];

    try {
      const dirs = fs.readdirSync(this.baseDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.'))
        .map(d => {
          const fullPath = path.join(this.baseDir, d.name);
          const stat = fs.statSync(fullPath);
          return {
            id: d.name,
            path: fullPath,
            updatedAt: stat.mtimeMs,
          };
        })
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit);

      return dirs;
    } catch (e) {
      console.error('Error scanning antigravity conversations:', e);
      return [];
    }
  }

  private scanDirectory() {
    try {
      const conversations = this.getRecentConversations(5);
      for (const conv of conversations) {
        const transcriptPath = path.join(conv.path, '.system_generated', 'logs', 'transcript.jsonl');
        if (fs.existsSync(transcriptPath)) {
          this.checkTranscriptUpdate(conv.id, transcriptPath);
        }
      }
    } catch (err) {
      // Ignore scan hiccups
    }
  }

  private checkTranscriptUpdate(conversationId: string, filePath: string) {
    try {
      const stats = fs.statSync(filePath);
      const prevSize = this.watchedFiles.get(filePath) || 0;

      if (stats.size > prevSize) {
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(stats.size - prevSize);
        fs.readSync(fd, buffer, 0, buffer.length, prevSize);
        fs.closeSync(fd);

        this.watchedFiles.set(filePath, stats.size);

        const newLines = buffer.toString('utf-8').split('\n').filter(Boolean);
        for (const line of newLines) {
          try {
            const step = JSON.parse(line);
            this.emit('step', { conversationId, step });
          } catch {
            // Partial JSON chunk
          }
        }
      }
    } catch (err) {
      // Handle file lock or read race
    }
  }
}
