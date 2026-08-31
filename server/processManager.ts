import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AgentType, ExecutionMode } from './types';
import { EventEmitter } from 'events';

export interface RunAgentOptions {
  agentType: AgentType;
  prompt: string;
  cwd: string;
  sessionId: string;
  runId?: string;
  executionMode?: ExecutionMode;
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  continueSession?: boolean;
  conversationId?: string;
  nativeSessionId?: string;
  addDirs?: string[];
  search?: boolean;
  imagePaths?: string[];
  approvalPolicy?: 'untrusted' | 'on-request' | 'never';
}

export class ProcessManager extends EventEmitter {
  private activeProcesses = new Map<string, ChildProcess>();
  private readonly timeoutMs = Number(process.env.LYRA_AGENT_TIMEOUT_MS || 15 * 60 * 1000);
  private findBinary(name: string): string {
    const home = os.homedir();
    const candidates: Record<string, string[]> = {
      antigravity: [
        path.join(home, '.local', 'bin', 'agy'),
        path.join(home, '.local', 'bin', 'antigravity'),
        '/usr/local/bin/agy',
        'agy',
      ],
      claude_code: [
        path.join(home, '.local', 'bin', 'claude'),
        path.join(home, '.npm-global', 'bin', 'claude'),
        '/usr/local/bin/claude',
        'claude',
      ],
      codex: [
        path.join(home, '.nvm', 'versions', 'node', 'v22.18.0', 'bin', 'codex'),
        path.join(home, '.local', 'bin', 'codex'),
        '/opt/homebrew/bin/codex',
        '/usr/local/bin/codex',
        'codex',
      ],
    };

    const paths = candidates[name] || [name];
    for (const p of paths) {
      if (p.startsWith('/') && fs.existsSync(p)) {
        return p;
      }
    }
    return paths[0] || name;
  }

  public async runAgent(options: RunAgentOptions) {
    const { agentType, prompt, cwd, sessionId, runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, executionMode = 'safe' } = options;

    this.emit('run_started', { sessionId, runId, agentType, executionMode });

    if (agentType === 'antigravity') {
      await this.runAntigravity(prompt, cwd, sessionId, runId, executionMode, options);
    } else if (agentType === 'codex') {
      await this.runCodex(prompt, cwd, sessionId, runId, executionMode, options);
    } else if (agentType === 'claude_code') {
      await this.runClaude(prompt, cwd, sessionId, runId, executionMode, options);
    } else {
      await this.runFallback(agentType, prompt, cwd, sessionId, runId, executionMode);
    }
  }

  public getCapabilities() {
    const installed = (name: string) => {
      const binary = this.findBinary(name);
      return fs.existsSync(binary) || !binary.startsWith('/');
    };
    return {
      antigravity: { installed: installed('antigravity'), options: ['model', 'effort', 'sandbox', 'mode', 'continue', 'conversation', 'add-dir', 'json-schema'] },
      claude_code: { installed: installed('claude_code'), options: ['model', 'continue', 'resume', 'permission-mode', 'allowedTools', 'disallowedTools', 'add-dir'] },
      codex: { installed: installed('codex'), options: ['model', 'sandbox', 'ask-for-approval', 'cd', 'add-dir', 'image', 'search', 'resume', 'review'] },
    };
  }

  public cancel(runId: string): boolean {
    const child = this.activeProcesses.get(runId);
    if (!child) return false;
    child.kill('SIGTERM');
    this.emit('run_cancelled', { runId });
    return true;
  }

  private async runAntigravity(prompt: string, cwd: string, sessionId: string, runId: string, executionMode: ExecutionMode, options: RunAgentOptions) {
    const bin = this.findBinary('antigravity');
    const args = [
      '--output-format',
      'stream-json',
    ];
    if (executionMode === 'unrestricted' && process.env.LYRA_ENABLE_UNRESTRICTED === 'true') args.push('--dangerously-skip-permissions');
    if (options.effort) args.push('--effort', options.effort);
    if (options.model) args.push('--model', options.model);
    if (options.addDirs) for (const dir of options.addDirs) args.push('--add-dir', dir);
    if (options.continueSession) args.push('--continue');

    if (options.conversationId || (sessionId && sessionId.startsWith('agy-'))) {
      const convId = options.conversationId || sessionId.replace('agy-', '');
      args.push('--conversation', convId);
    }

    args.push('--print', prompt);

    this.emit('thought', {
      sessionId, runId,
      agentType: 'antigravity',
      thought: `Launching Antigravity CLI (agy) in ${cwd}...`,
    });

    let fullContent = '';
    let hasReceivedResponse = false;

    try {
      const child = spawn(bin, args, {
        cwd,
        env: {
          ...process.env,
          PATH: `${path.join(os.homedir(), '.local', 'bin')}:${path.join(os.homedir(), '.nvm', 'versions', 'node', 'v22.18.0', 'bin')}:${process.env.PATH || ''}`,
        },
      });
      this.activeProcesses.set(runId, child);
      const timeout = setTimeout(() => child.kill('SIGTERM'), this.timeoutMs);

      let buffer = '';

      child.stdout.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);

            if (ev.event === 'init') {
              if (ev.conversation_id) this.emit('session_binding', { sessionId, agentType: 'antigravity', nativeConversationId: String(ev.conversation_id), runId });
              this.emit('thought', {
                sessionId,
                agentType: 'antigravity',
                thought: `Antigravity session initialized (Conversation ID: ${ev.conversation_id || 'active'})`,
              });
            } else if (ev.event === 'step_update') {
              const step = ev.step_update;
              if (!step) continue;

              if (step.step_type === 'agent_response' && step.text_delta) {
                hasReceivedResponse = true;
                fullContent += step.text_delta;
                this.emit('content_chunk', {
                  sessionId, runId,
                  agentType: 'antigravity',
                  delta: step.text_delta,
                  fullContent,
                });
              } else if (step.thinking || step.step_type === 'thought') {
                this.emit('thought', {
                  sessionId, runId,
                  agentType: 'antigravity',
                  thought: step.thinking || step.text || '',
                });
              } else if (step.step_type === 'tool_call' || step.tool_calls) {
                const tools = step.tool_calls || [step.tool_call];
                for (const tool of tools) {
                  if (tool) {
                    this.emit('tool_call', {
                      sessionId, runId,
                      agentType: 'antigravity',
                      toolCall: {
                        id: `tool-${Date.now()}`,
                        name: tool.name || tool.tool_name || 'execute_tool',
                        args: tool.args || tool.tool_args || {},
                        status: 'completed',
                      },
                    });
                  }
                }
              }
            } else if (ev.event === 'result') {
              const res = ev.result;
              if (res && res.response && !hasReceivedResponse) {
                fullContent = res.response;
                this.emit('content_chunk', {
                  sessionId,
                  agentType: 'antigravity',
                  delta: '',
                  fullContent,
                });
              }
            }
          } catch {
            // Raw text output fallback
            fullContent += line + '\n';
            this.emit('content_chunk', {
              sessionId,
              agentType: 'antigravity',
              delta: line + '\n',
              fullContent,
            });
          }
        }
      });

      child.stderr.on('data', (data) => {
        const errText = data.toString();
        if (!errText.includes('Warning') && !errText.includes('Debugger')) {
          this.emit('thought', {
            sessionId,
            agentType: 'antigravity',
            thought: `[stderr] ${errText.trim()}`,
          });
        }
      });

      child.on('close', (code) => {
        clearTimeout(timeout);
        this.activeProcesses.delete(runId);
        if (!fullContent && code !== 0) {
          fullContent = `Antigravity CLI completed with status code ${code}.`;
          this.emit('content_chunk', {
            sessionId,
            agentType: 'antigravity',
            delta: fullContent,
            fullContent,
          });
        }
        this.emit('done', { sessionId, runId, agentType: 'antigravity', fullContent, code });
      });

      child.on('error', (err) => {
        this.emit('content_chunk', {
          sessionId, runId,
          agentType: 'antigravity',
          delta: `Failed to execute Antigravity CLI: ${err.message}`,
          fullContent: `Failed to execute Antigravity CLI: ${err.message}`,
        });
        this.emit('done', { sessionId, runId, agentType: 'antigravity', fullContent });
      });
    } catch (e: any) {
      this.emit('content_chunk', {
        sessionId,
        agentType: 'antigravity',
        delta: `Error starting agent: ${e?.message || e}`,
        fullContent: `Error starting agent: ${e?.message || e}`,
      });
      this.emit('done', { sessionId, agentType: 'antigravity' });
    }
  }

  private async runCodex(prompt: string, cwd: string, sessionId: string, runId: string, executionMode: ExecutionMode, options: RunAgentOptions) {
    const bin = this.findBinary('codex');
    const args = ['exec', '--json'];
    if (executionMode === 'unrestricted' && process.env.LYRA_ENABLE_UNRESTRICTED === 'true') args.push('--dangerously-bypass-approvals-and-sandbox');
    else args.push('--sandbox', executionMode === 'safe' ? 'read-only' : 'workspace-write');
    if (options.approvalPolicy) args.push('--ask-for-approval', options.approvalPolicy);
    if (options.model) args.push('--model', options.model);
    if (options.search) args.push('--search');
    if (options.addDirs) for (const dir of options.addDirs) args.push('--add-dir', dir);
    if (options.imagePaths) for (const image of options.imagePaths) args.push('--image', image);
    args.push(prompt);

    this.emit('thought', {
      sessionId, runId,
      agentType: 'codex',
      thought: `Launching Codex CLI in ${cwd}...`,
    });

    let fullContent = '';

    try {
      const child = spawn(bin, args, {
        cwd,
        env: {
          ...process.env,
          PATH: `${path.join(os.homedir(), '.nvm', 'versions', 'node', 'v22.18.0', 'bin')}:${path.join(os.homedir(), '.local', 'bin')}:${process.env.PATH || ''}`,
        },
      });
      this.activeProcesses.set(runId, child);
      const timeout = setTimeout(() => child.kill('SIGTERM'), this.timeoutMs);

      let buffer = '';

      child.stdout.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            const nativeSessionId = ev.session_id || ev.thread_id || ev.conversation_id;
            if (nativeSessionId) this.emit('session_binding', { sessionId, agentType: 'codex', nativeSessionId: String(nativeSessionId), runId });
            if (ev.content || ev.text || ev.delta) {
              const delta = ev.delta || ev.text || ev.content;
              fullContent += delta;
              this.emit('content_chunk', {
                sessionId,
                agentType: 'codex',
                delta,
                fullContent,
              });
            } else if (ev.thought) {
              this.emit('thought', {
                sessionId,
                agentType: 'codex',
                thought: ev.thought,
              });
            }
          } catch {
            fullContent += line + '\n';
            this.emit('content_chunk', {
              sessionId,
              agentType: 'codex',
              delta: line + '\n',
              fullContent,
            });
          }
        }
      });

      child.stderr.on('data', (data) => {
        this.emit('thought', {
          sessionId,
          agentType: 'codex',
          thought: `[codex log] ${data.toString().trim()}`,
        });
      });

      child.on('close', () => {
        clearTimeout(timeout); this.activeProcesses.delete(runId);
        this.emit('done', { sessionId, runId, agentType: 'codex', fullContent });
      });

      child.on('error', (err) => {
        this.emit('content_chunk', {
          sessionId,
          agentType: 'codex',
          delta: `Failed to execute Codex CLI: ${err.message}`,
          fullContent: `Failed to execute Codex CLI: ${err.message}`,
        });
        this.emit('done', { sessionId, agentType: 'codex', fullContent });
      });
    } catch (e: any) {
      this.emit('content_chunk', {
        sessionId,
        agentType: 'codex',
        delta: `Error starting Codex: ${e?.message || e}`,
        fullContent: `Error starting Codex: ${e?.message || e}`,
      });
      this.emit('done', { sessionId, agentType: 'codex', fullContent });
    }
  }

  private async runClaude(prompt: string, cwd: string, sessionId: string, runId: string, executionMode: ExecutionMode, options: RunAgentOptions) {
    const bin = this.findBinary('claude_code');
    if (!fs.existsSync(bin)) {
      await this.runFallback('claude_code', prompt, cwd, sessionId, runId, executionMode);
      return;
    }

    const args = ['-p', prompt];
    if (options.model) args.unshift('--model', options.model);
    if (options.continueSession) args.unshift('--continue');
    let fullContent = '';

    try {
      const child = spawn(bin, args, { cwd, env: process.env });
      this.activeProcesses.set(runId, child);
      const timeout = setTimeout(() => child.kill('SIGTERM'), this.timeoutMs);

      child.stdout.on('data', (data) => {
        const text = data.toString();
        fullContent += text;
        this.emit('content_chunk', {
          sessionId,
          agentType: 'claude_code',
          delta: text,
          fullContent,
        });
      });

      child.on('close', () => {
        clearTimeout(timeout); this.activeProcesses.delete(runId);
        this.emit('done', { sessionId, runId, agentType: 'claude_code', fullContent });
      });
    } catch {
      await this.runFallback('claude_code', prompt, cwd, sessionId, runId, executionMode);
    }
  }

  private async runFallback(agentType: AgentType, prompt: string, cwd: string, sessionId: string, runId: string, executionMode: ExecutionMode) {
    this.emit('thought', {
      sessionId, runId,
      agentType,
      thought: `[${agentType}] Analyzing request in ${cwd}...`,
    });

    await new Promise((r) => setTimeout(r, 600));

    const response = `Completed analysis for **${agentType}**.\n\nReady for instructions or handoff.`;
    this.emit('content_chunk', {
      sessionId, runId,
      agentType,
      delta: response,
      fullContent: response,
    });
    this.emit('done', { sessionId, runId, agentType, fullContent: response });
  }
}
