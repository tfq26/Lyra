import fs from 'fs';
import path from 'path';
import os from 'os';
import { UnifiedStore } from '../unifiedStore';

export class AntigravityAdapter {
  private baseDir: string;
  private store: UnifiedStore;
  private watchedFiles: Map<string, number> = new Map();
  private intervalId: NodeJS.Timeout | null = null;

  constructor(store: UnifiedStore) {
    this.store = store;
    this.baseDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
  }

  public start() {
    if (!fs.existsSync(this.baseDir)) return;

    this.syncAllRecent();

    this.intervalId = setInterval(() => {
      this.syncAllRecent();
    }, 2000);
  }

  public stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }

  private syncAllRecent() {
    try {
      if (!fs.existsSync(this.baseDir)) return;
      const dirs = fs.readdirSync(this.baseDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'));

      for (const dir of dirs) {
        const transcriptPath = path.join(this.baseDir, dir.name, '.system_generated', 'logs', 'transcript.jsonl');
        if (fs.existsSync(transcriptPath)) {
          this.processTranscript(dir.name, transcriptPath);
        }
      }
    } catch (e) {
      // Ignore directory scan races
    }
  }

  private extractTitleFromTranscript(transcriptPath: string): string | null {
    try {
      const fd = fs.openSync(transcriptPath, 'r');
      const buffer = Buffer.alloc(8192);
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
      fs.closeSync(fd);
      const content = buffer.toString('utf-8', 0, bytesRead);
      const lines = content.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const step = JSON.parse(line);
          if (step.type === 'USER_INPUT' && step.content) {
            const userContent = String(step.content);
            const match = userContent.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
            let rawTitle = match ? (match[1] || '').trim() : userContent.trim();
            const firstLine = (rawTitle.split('\n')[0] || '').replace(/\s+/g, ' ').trim();
            if (firstLine) {
              return firstLine.length > 55 ? firstLine.slice(0, 52) + '...' : firstLine;
            }
          }
        } catch {}
      }
    } catch {}
    return null;
  }

  private processTranscript(conversationId: string, transcriptPath: string) {
    try {
      const stats = fs.statSync(transcriptPath);
      const prevSize = this.watchedFiles.get(transcriptPath) || 0;
      const unifiedSessionId = `agy-${conversationId}`;
      const mtimeStr = stats.mtime.toISOString();
      const ctimeStr = stats.birthtime ? stats.birthtime.toISOString() : mtimeStr;

      // Ensure session title is set and human readable
      const title = this.extractTitleFromTranscript(transcriptPath) || `Antigravity ${conversationId.slice(0, 8)}`;
      this.store.updateSessionMeta(unifiedSessionId, {
        title,
        activeAgents: ['antigravity'],
        updatedAt: mtimeStr,
        createdAt: ctimeStr,
      });

      if (stats.size > prevSize) {
        const fd = fs.openSync(transcriptPath, 'r');
        const buffer = Buffer.alloc(stats.size - prevSize);
        fs.readSync(fd, buffer, 0, buffer.length, prevSize);
        fs.closeSync(fd);

        this.watchedFiles.set(transcriptPath, stats.size);

        const newLines = buffer.toString('utf-8').split('\n').filter(Boolean);

        for (const line of newLines) {
          try {
            const step = JSON.parse(line);
            this.translateStepToUnified(unifiedSessionId, step);
          } catch {
            // Incomplete JSON line
          }
        }
      }
    } catch (e) {
      // File read error
    }
  }

  private translateStepToUnified(sessionId: string, step: any) {
    const type = step.type;

    if (type === 'USER_INPUT') {
      let rawText = step.content || '';
      const match = rawText.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
      let cleanText = match ? match[1].trim() : rawText;
      cleanText = cleanText
        .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '')
        .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/g, '')
        .trim();

      this.store.appendEvent(sessionId, {
        agent: 'user',
        type: 'message',
        payload: {
          text: cleanText,
        },
      });
    } else if (type === 'PLANNER_RESPONSE') {
      if (step.thinking) {
        this.store.appendEvent(sessionId, {
          agent: 'antigravity',
          type: 'thought',
          payload: {
            text: step.thinking,
          },
        });
      }

      if (step.tool_calls && Array.isArray(step.tool_calls)) {
        for (const tool of step.tool_calls) {
          this.store.appendEvent(sessionId, {
            agent: 'antigravity',
            type: 'tool_call',
            payload: {
              name: tool.name || tool.toolName,
              args: tool.args || {},
              status: 'completed',
            },
          });
        }
      }

      if (step.content) {
        this.store.appendEvent(sessionId, {
          agent: 'antigravity',
          type: 'message',
          payload: {
            text: step.content,
          },
        });
      }
    }
  }
}
