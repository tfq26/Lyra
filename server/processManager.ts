import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AgentType, ExecutionMode } from './types';
import { EventEmitter } from 'events';
import { StrandsHarness } from './strandsHarness';

export interface RunAgentOptions {
  agentType: AgentType;
  prompt: string;
  cwd: string;
  sessionId: string;
  runId?: string;
  processId?: string;
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
  isSlashCommand?: boolean;
  slashCommand?: string;
}

export type RunAgentParams = RunAgentOptions;

export interface RunAgentResult {
  sessionId: string;
  runId: string;
  agentType: AgentType;
  code: number;
  fullContent: string;
  error?: string;
  cancelled?: boolean;
  processId?: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

interface ActiveProcessInfo {
  child: ChildProcess;
  sessionId: string;
  runId: string;
  agentType: AgentType;
  cancelled: boolean;
  timedOut: boolean;
  timeoutId: NodeJS.Timeout;
}

export class ProcessManager extends EventEmitter {
  private activeProcesses = new Map<string, ActiveProcessInfo>();
  private readonly timeoutMs = Number(process.env.LYRA_AGENT_TIMEOUT_MS || 15 * 60 * 1000);

  constructor() {
    super();
    // Default no-op error listener to prevent ERR_UNHANDLED_ERROR crashes in Node/Bun event emitter
    this.on('error', () => {});
  }

  public findBinary(name: string): string | null {
    const home = os.homedir();
    const candidates: Record<string, string[]> = {
      antigravity: [
        path.join(home, '.local', 'bin', 'agy'),
        path.join(home, '.local', 'bin', 'antigravity'),
        '/opt/homebrew/bin/agy',
        '/opt/homebrew/bin/antigravity',
        '/usr/local/bin/agy',
        '/usr/local/bin/antigravity',
        'agy',
        'antigravity',
      ],
      claude_code: [
        path.join(home, '.local', 'bin', 'claude'),
        path.join(home, '.npm-global', 'bin', 'claude'),
        '/opt/homebrew/bin/claude',
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
      opencode: [path.join(home, '.local', 'bin', 'opencode'), path.join(home, '.bun', 'bin', 'opencode'), '/usr/local/bin/opencode', 'opencode'],
    };

    const paths = candidates[name] || [name];
    for (const p of paths) {
      if (p.startsWith('/') && fs.existsSync(p)) {
        try {
          fs.accessSync(p, fs.constants.X_OK);
          return p;
        } catch {
          return p;
        }
      }
    }

    // Check system PATH
    const envPath = `${path.join(home, '.local', 'bin')}:${path.join(home, '.nvm', 'versions', 'node', 'v22.18.0', 'bin')}:${process.env.PATH || ''}`;
    const dirs = envPath.split(':').filter(Boolean);
    for (const dir of dirs) {
      for (const p of paths) {
        const binName = path.basename(p);
        const fullCandidate = path.join(dir, binName);
        if (fs.existsSync(fullCandidate)) {
          return fullCandidate;
        }
      }
    }

    return null;
  }

  public getCapabilities() {
    const isInstalled = (name: string) => Boolean(this.findBinary(name));
    return {
      strands: { installed: true, options: ['model', 'effort', 'sandbox', 'max-turns'] },
      antigravity: {
        installed: isInstalled('antigravity'),
        options: ['model', 'effort', 'sandbox', 'mode', 'continue', 'conversation', 'add-dir', 'json-schema'],
      },
      claude_code: {
        installed: isInstalled('claude_code'),
        options: ['model', 'continue', 'resume', 'permission-mode', 'allowedTools', 'disallowedTools', 'add-dir'],
      },
      codex: {
        installed: isInstalled('codex'),
        options: ['model', 'sandbox', 'ask-for-approval', 'cd', 'add-dir', 'image', 'search', 'resume', 'review'],
      },
      opencode: { installed: isInstalled('opencode'), options: ['model', 'format', 'directory'] },
    };
  }

  public getReadiness() {
    const isInstalled = (name: string) => Boolean(this.findBinary(name));
    return {
      strands: { installed: true, authenticated: true, ready: true, reason: 'Unified Strands harness ready.' },
      antigravity: { installed: isInstalled('antigravity'), authenticated: 'unknown', ready: isInstalled('antigravity'), reason: isInstalled('antigravity') ? 'Ready' : 'CLI executable not found.' },
      claude_code: { installed: isInstalled('claude_code'), authenticated: 'unknown', ready: isInstalled('claude_code'), reason: isInstalled('claude_code') ? 'Ready' : 'CLI executable not found.' },
      codex: { installed: isInstalled('codex'), authenticated: 'unknown', ready: isInstalled('codex'), reason: isInstalled('codex') ? 'Ready' : 'CLI executable not found.' },
      opencode: { installed: isInstalled('opencode'), authenticated: 'unknown', ready: isInstalled('opencode'), reason: isInstalled('opencode') ? 'Ready' : 'CLI executable not found.' },
    };
  }

  public async getModels(agentType: AgentType): Promise<Array<{ id: string; label: string }>> {
    const modelEnv: Partial<Record<AgentType, string>> = {
      antigravity: 'LYRA_ANTIGRAVITY_MODELS',
      claude_code: 'LYRA_CLAUDE_MODELS',
      codex: 'LYRA_CODEX_MODELS',
      opencode: 'LYRA_OPENCODE_MODELS',
      strands: 'LYRA_STRANDS_MODELS',
    };
    const configured = modelEnv[agentType] ? process.env[modelEnv[agentType]!] : undefined;
    if (configured) return configured.split(',').map((value) => value.trim()).filter(Boolean).map((value) => ({ id: value, label: value }));
    if (agentType !== 'antigravity') return [{ id: 'default', label: agentType === 'opencode' ? 'OpenCode provider default' : agentType === 'strands' ? 'Strands provider default' : 'CLI default' }];

    const binary = this.findBinary('antigravity');
    if (!binary) {
      return [{ id: 'default', label: 'CLI default (Antigravity not installed)' }];
    }

    const child = spawn(binary, ['models'], { env: process.env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 15000);
    child.stdout?.on('data', (data) => { stdout += data.toString(); });
    child.stderr?.on('data', (data) => { stderr += data.toString(); });
    return new Promise((resolve) => {
      child.on('close', () => {
        clearTimeout(timer);
        const models = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
          const [id, ...labelParts] = line.split(/\s+/);
          return id && labelParts.length ? { id, label: labelParts.join(' ') } : null;
        }).filter((model): model is { id: string; label: string } => Boolean(model));
        resolve(models.length ? models : [{ id: 'default', label: stderr.includes('not logged') ? 'CLI default (sign in to load models)' : 'CLI default' }]);
      });
      child.on('error', () => { clearTimeout(timer); resolve([{ id: 'default', label: 'CLI default' }]); });
    });
  }

  public cancel(runId: string): boolean {
    const matches = [...this.activeProcesses.entries()].filter(([key, proc]) => key === runId || proc.runId === runId);
    for (const [processId, proc] of matches) {
      proc.cancelled = true;
      clearTimeout(proc.timeoutId);
      try {
        proc.child.kill('SIGTERM');
        setTimeout(() => {
          if (this.activeProcesses.has(processId)) {
            try { proc.child.kill('SIGKILL'); } catch {}
          }
        }, 1500);
      } catch {}
      this.emit('run_cancelled', { runId: proc.runId, processId, sessionId: proc.sessionId, agentType: proc.agentType });
    }
    return matches.length > 0;
  }

  public async runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
    const {
      agentType,
      prompt,
      cwd,
      sessionId,
      runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      executionMode = 'safe',
    } = options;

    this.emit('run_started', { sessionId, runId, agentType, executionMode });

    if (agentType === 'strands') {
      return StrandsHarness.getInstance().execute({
        prompt,
        cwd,
        sessionId,
        runId,
        processId: options.processId,
        model: options.model,
        signal: (options as any).signal,
        onChunk: (delta, full) => {
          this.emit('content_chunk', { sessionId, runId, processId: options.processId, agentType: options.agentType || 'strands', delta, fullContent: full });
        },
        onProgress: (message) => {
          this.emit('thought', { sessionId, runId, agentType: options.agentType || 'strands', thought: message });
        },
      });
    }

    if (agentType === 'antigravity') {
      if (!this.findBinary('antigravity')) {
        return StrandsHarness.getInstance().execute({ prompt, cwd, sessionId, runId, processId: options.processId, model: options.model });
      }
      return this.runAntigravity(prompt, cwd, sessionId, runId, executionMode, options);
    } else if (agentType === 'codex') {
      if (!this.findBinary('codex')) {
        return StrandsHarness.getInstance().execute({ prompt, cwd, sessionId, runId, processId: options.processId, model: options.model });
      }
      return this.runCodex(prompt, cwd, sessionId, runId, executionMode, options);
    } else if (agentType === 'claude_code') {
      if (!this.findBinary('claude_code')) {
        return StrandsHarness.getInstance().execute({ prompt, cwd, sessionId, runId, processId: options.processId, model: options.model });
      }
      return this.runClaude(prompt, cwd, sessionId, runId, executionMode, options);
    } else if (agentType === 'opencode') {
      return this.runPortableCli(options, executionMode);
    } else {
      return this.handleUnavailableHarness(agentType, cwd, sessionId, runId);
    }
  }

  private handleUnavailableHarness(
    agentType: AgentType,
    cwd: string,
    sessionId: string,
    runId: string
  ): RunAgentResult {
    const errorMsg = `Harness executable for "${agentType}" is not installed or available on this system.`;
    this.emit('thought', {
      sessionId,
      runId,
      agentType,
      thought: `[${agentType}] ${errorMsg}`,
    });
    this.emit('error', {
      sessionId,
      runId,
      agentType,
      message: errorMsg,
    });
    this.emit('done', {
      sessionId,
      runId,
      agentType,
      fullContent: '',
      code: 127,
    });
    return {
      sessionId,
      runId,
      agentType,
      code: 127,
      fullContent: '',
      error: errorMsg,
    };
  }

  private getExtendedEnv(): NodeJS.ProcessEnv {
    const home = os.homedir();
    return {
      ...process.env,
      PATH: `${path.join(home, '.local', 'bin')}:${path.join(home, '.nvm', 'versions', 'node', 'v22.18.0', 'bin')}:${path.join(home, '.bun', 'bin')}:${path.join(home, '.cargo', 'bin')}:${path.join(home, '.npm-global', 'bin')}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${process.env.PATH || ''}`,
    };
  }

  private runPortableCli(options: RunAgentOptions, executionMode: ExecutionMode): Promise<RunAgentResult> {
    const { agentType, prompt, cwd, sessionId } = options;
    const runId = options.runId || `run-${Date.now()}`;
    const processId = options.processId || `${runId}:${agentType}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`;
    const binaryName = 'opencode';
    const bin = this.findBinary(binaryName);
    if (!bin) return Promise.resolve(this.handleUnavailableHarness(agentType, cwd, sessionId, runId));

    const args = agentType === 'opencode'
      ? ['run', '--format', 'json', ...(options.model ? ['--model', options.model] : []), prompt]
      : ['--query', prompt, ...(options.model ? ['--model', options.model] : [])];
    let fullContent = '';
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: RunAgentResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        this.activeProcesses.delete(processId);
        resolve({ ...result, processId });
      };
      const child = spawn(bin, args, { cwd, env: this.getExtendedEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
      const timeoutId = setTimeout(() => {
        const proc = this.activeProcesses.get(processId);
        if (proc) {
          proc.timedOut = true;
          try { proc.child.kill('SIGTERM'); } catch {}
        }
      }, this.timeoutMs);
      this.activeProcesses.set(processId, { child, sessionId, runId, agentType, cancelled: false, timedOut: false, timeoutId });
      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        fullContent += text;
        this.emit('content_chunk', { sessionId, runId, processId, agentType, delta: text, fullContent });
      });
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString().trim();
        if (text) this.emit('progress', { sessionId, runId, processId, agentType, message: text.slice(0, 2000) });
      });
      child.on('error', (error) => {
        const message = `Failed to start ${agentType}: ${error.message}`;
        this.emit('error', { sessionId, runId, processId, agentType, message });
        finish({ sessionId, runId, agentType, code: 1, fullContent, error: message });
      });
      child.on('close', (code) => {
        const proc = this.activeProcesses.get(processId);
        if (proc?.cancelled) {
          this.emit('done', { sessionId, runId, processId, agentType, code: 130, fullContent });
          finish({ sessionId, runId, agentType, code: 130, fullContent, cancelled: true });
        } else if (proc?.timedOut) {
          const message = `${agentType} CLI timed out after ${this.timeoutMs / 1000}s.`;
          this.emit('error', { sessionId, runId, processId, agentType, message });
          this.emit('done', { sessionId, runId, processId, agentType, code: 124, fullContent });
          finish({ sessionId, runId, agentType, code: 124, fullContent, error: message });
        } else {
          const exitCode = code ?? 1;
          this.emit('done', { sessionId, runId, processId, agentType, code: exitCode, fullContent });
          finish({ sessionId, runId, agentType, code: exitCode, fullContent });
        }
      });
    });
  }

  private runAntigravity(
    prompt: string,
    cwd: string,
    sessionId: string,
    runId: string,
    executionMode: ExecutionMode,
    options: RunAgentOptions
  ): Promise<RunAgentResult> {
    const processId = options.processId || runId;
    const bin = this.findBinary('antigravity');
    if (!bin) {
      return Promise.resolve(this.handleUnavailableHarness('antigravity', cwd, sessionId, runId));
    }

    const args = ['--output-format', 'stream-json'];
    if (executionMode === 'unrestricted' && process.env.LYRA_ENABLE_UNRESTRICTED === 'true') {
      args.push('--dangerously-skip-permissions');
    }
    if (executionMode === 'safe') args.push('--mode', 'plan');
    else if (executionMode === 'sandboxed') args.push('--mode', 'accept-edits');
    const modelEncodesEffort = Boolean(options.model && /-(low|medium|high)$/.test(options.model));
    if (options.effort && !modelEncodesEffort) args.push('--effort', options.effort);
    if (options.model) args.push('--model', options.model);
    if (options.addDirs) for (const dir of options.addDirs) args.push('--add-dir', dir);
    if (options.continueSession) args.push('--continue');

    if (options.conversationId) {
      args.push('--conversation', options.conversationId);
    }

    args.push('--print', prompt);

    this.emit('thought', {
      sessionId,
      runId,
      agentType: 'antigravity',
      thought: `Launching Antigravity CLI in ${cwd}...`,
    });

    let fullContent = '';
    let hasReceivedResponse = false;

    return new Promise<RunAgentResult>((resolve) => {
      let isSettled = false;
      const finish = (result: RunAgentResult) => {
        if (isSettled) return;
        isSettled = true;
        this.activeProcesses.delete(processId);
        resolve(result);
      };

      try {
        const child = spawn(bin, args, {
          cwd,
          env: this.getExtendedEnv(),
        });

        const timeoutId = setTimeout(() => {
          const proc = this.activeProcesses.get(processId);
          if (proc) {
            proc.timedOut = true;
            try { proc.child.kill('SIGTERM'); } catch {}
          }
        }, this.timeoutMs);

        this.activeProcesses.set(processId, {
          child,
          sessionId,
          runId,
          agentType: 'antigravity',
          cancelled: false,
          timedOut: false,
          timeoutId,
        });

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
                if (ev.conversation_id) {
                  this.emit('session_binding', {
                    sessionId,
                    agentType: 'antigravity',
                    nativeConversationId: String(ev.conversation_id),
                    runId,
                  });
                }
                this.emit('thought', {
                  sessionId,
                  runId,
                  agentType: 'antigravity',
                  thought: `Antigravity session initialized (${ev.conversation_id || 'active'})`,
                });
              } else if (ev.event === 'step_update') {
                const step = ev.step_update;
                if (!step) continue;

                if (step.step_type === 'agent_response' && step.text_delta) {
                  hasReceivedResponse = true;
                  fullContent += step.text_delta;
                  this.emit('content_chunk', {
                    sessionId,
                    runId,
                    agentType: 'antigravity',
                    delta: step.text_delta,
                    fullContent,
                  });
                } else if (step.thinking || step.step_type === 'thought') {
                  this.emit('thought', {
                    sessionId,
                    runId,
                    agentType: 'antigravity',
                    thought: step.thinking || step.text || '',
                  });
                } else if (step.step_type === 'tool_call' || step.tool_calls) {
                  const tools = step.tool_calls || [step.tool_call];
                  for (const tool of tools) {
                    if (tool) {
                      this.emit('tool_call', {
                        sessionId,
                        runId,
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
                    runId,
                    agentType: 'antigravity',
                    delta: fullContent,
                    fullContent,
                  });
                }
              }
            } catch {
              fullContent += line + '\n';
              this.emit('content_chunk', {
                sessionId,
                runId,
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
              runId,
              agentType: 'antigravity',
              thought: `[stderr] ${errText.trim()}`,
            });
          }
        });

        child.on('close', (code) => {
          clearTimeout(timeoutId);
          const proc = this.activeProcesses.get(processId);
          const wasCancelled = proc?.cancelled || false;
          const wasTimedOut = proc?.timedOut || false;

          if (wasCancelled) {
            this.emit('run_cancelled', { sessionId, runId, agentType: 'antigravity' });
            this.emit('done', { sessionId, runId, agentType: 'antigravity', fullContent, code: 130 });
            finish({ sessionId, runId, agentType: 'antigravity', code: 130, fullContent, cancelled: true });
            return;
          }

          if (wasTimedOut) {
            const timeoutMsg = `Antigravity CLI timed out after ${this.timeoutMs / 1000}s.`;
            this.emit('error', { sessionId, runId, agentType: 'antigravity', message: timeoutMsg });
            this.emit('done', { sessionId, runId, agentType: 'antigravity', fullContent, code: 124 });
            finish({ sessionId, runId, agentType: 'antigravity', code: 124, fullContent, error: timeoutMsg });
            return;
          }

          const exitCode = code ?? 0;
          if (!fullContent && exitCode !== 0) {
            fullContent = `Antigravity CLI exited with status code ${exitCode}.`;
            this.emit('content_chunk', {
              sessionId,
              runId,
              agentType: 'antigravity',
              delta: fullContent,
              fullContent,
            });
          }

          this.emit('done', { sessionId, runId, agentType: 'antigravity', fullContent, code: exitCode });
          finish({ sessionId, runId, agentType: 'antigravity', code: exitCode, fullContent });
        });

        child.on('error', (err) => {
          clearTimeout(timeoutId);
          const errMessage = `Failed to execute Antigravity CLI: ${err.message}`;
          this.emit('error', { sessionId, runId, agentType: 'antigravity', message: errMessage });
          this.emit('content_chunk', {
            sessionId,
            runId,
            agentType: 'antigravity',
            delta: errMessage,
            fullContent: errMessage,
          });
          this.emit('done', { sessionId, runId, agentType: 'antigravity', fullContent: errMessage, code: 1 });
          finish({ sessionId, runId, agentType: 'antigravity', code: 1, fullContent: errMessage, error: err.message });
        });
      } catch (e: any) {
        const errMessage = `Error starting Antigravity: ${e?.message || e}`;
        this.emit('error', { sessionId, runId, agentType: 'antigravity', message: errMessage });
        this.emit('done', { sessionId, runId, agentType: 'antigravity', fullContent: '', code: 1 });
        finish({ sessionId, runId, agentType: 'antigravity', code: 1, fullContent: '', error: errMessage });
      }
    });
  }

  private runCodex(
    prompt: string,
    cwd: string,
    sessionId: string,
    runId: string,
    executionMode: ExecutionMode,
    options: RunAgentOptions
  ): Promise<RunAgentResult> {
    const processId = options.processId || runId;
    const bin = this.findBinary('codex');
    if (!bin) {
      return Promise.resolve(this.handleUnavailableHarness('codex', cwd, sessionId, runId));
    }

    const args = ['exec', '--json'];
    if (executionMode === 'unrestricted' && process.env.LYRA_ENABLE_UNRESTRICTED === 'true') {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    } else {
      args.push('--sandbox', executionMode === 'safe' ? 'read-only' : 'workspace-write');
    }
    if (options.approvalPolicy) args.push('--ask-for-approval', options.approvalPolicy);
    if (options.model) args.push('--model', options.model);
    if (options.search) args.push('--search');
    if (options.addDirs) for (const dir of options.addDirs) args.push('--add-dir', dir);
    if (options.imagePaths) for (const image of options.imagePaths) args.push('--image', image);
    args.push(prompt);

    this.emit('thought', {
      sessionId,
      runId,
      agentType: 'codex',
      thought: `Launching Codex CLI in ${cwd}...`,
    });

    let fullContent = '';

    return new Promise<RunAgentResult>((resolve) => {
      let isSettled = false;
      const finish = (result: RunAgentResult) => {
        if (isSettled) return;
        isSettled = true;
        this.activeProcesses.delete(processId);
        resolve(result);
      };

      try {
        const child = spawn(bin, args, {
          cwd,
          env: this.getExtendedEnv(),
        });

        const timeoutId = setTimeout(() => {
          const proc = this.activeProcesses.get(processId);
          if (proc) {
            proc.timedOut = true;
            try { proc.child.kill('SIGTERM'); } catch {}
          }
        }, this.timeoutMs);

        this.activeProcesses.set(processId, {
          child,
          sessionId,
          runId,
          agentType: 'codex',
          cancelled: false,
          timedOut: false,
          timeoutId,
        });

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
              if (nativeSessionId) {
                this.emit('session_binding', {
                  sessionId,
                  agentType: 'codex',
                  nativeSessionId: String(nativeSessionId),
                  runId,
                });
              }
              if (ev.content || ev.text || ev.delta) {
                const delta = ev.delta || ev.text || ev.content;
                fullContent += delta;
                this.emit('content_chunk', {
                  sessionId,
                  runId,
                  agentType: 'codex',
                  delta,
                  fullContent,
                });
              } else if (ev.thought) {
                this.emit('thought', {
                  sessionId,
                  runId,
                  agentType: 'codex',
                  thought: ev.thought,
                });
              }
            } catch {
              fullContent += line + '\n';
              this.emit('content_chunk', {
                sessionId,
                runId,
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
            runId,
            agentType: 'codex',
            thought: `[codex log] ${data.toString().trim()}`,
          });
        });

        child.on('close', (code) => {
          clearTimeout(timeoutId);
          const proc = this.activeProcesses.get(processId);
          const wasCancelled = proc?.cancelled || false;
          const wasTimedOut = proc?.timedOut || false;

          if (wasCancelled) {
            this.emit('run_cancelled', { sessionId, runId, agentType: 'codex' });
            this.emit('done', { sessionId, runId, agentType: 'codex', fullContent, code: 130 });
            finish({ sessionId, runId, agentType: 'codex', code: 130, fullContent, cancelled: true });
            return;
          }

          if (wasTimedOut) {
            const timeoutMsg = `Codex CLI timed out after ${this.timeoutMs / 1000}s.`;
            this.emit('error', { sessionId, runId, agentType: 'codex', message: timeoutMsg });
            this.emit('done', { sessionId, runId, agentType: 'codex', fullContent, code: 124 });
            finish({ sessionId, runId, agentType: 'codex', code: 124, fullContent, error: timeoutMsg });
            return;
          }

          const exitCode = code ?? 0;
          this.emit('done', { sessionId, runId, agentType: 'codex', fullContent, code: exitCode });
          finish({ sessionId, runId, agentType: 'codex', code: exitCode, fullContent });
        });

        child.on('error', (err) => {
          clearTimeout(timeoutId);
          const errMessage = `Failed to execute Codex CLI: ${err.message}`;
          this.emit('error', { sessionId, runId, agentType: 'codex', message: errMessage });
          this.emit('content_chunk', {
            sessionId,
            runId,
            agentType: 'codex',
            delta: errMessage,
            fullContent: errMessage,
          });
          this.emit('done', { sessionId, runId, agentType: 'codex', fullContent: errMessage, code: 1 });
          finish({ sessionId, runId, agentType: 'codex', code: 1, fullContent: errMessage, error: err.message });
        });
      } catch (e: any) {
        const errMessage = `Error starting Codex: ${e?.message || e}`;
        this.emit('error', { sessionId, runId, agentType: 'codex', message: errMessage });
        this.emit('done', { sessionId, runId, agentType: 'codex', fullContent: '', code: 1 });
        finish({ sessionId, runId, agentType: 'codex', code: 1, fullContent: '', error: errMessage });
      }
    });
  }

  private runClaude(
    prompt: string,
    cwd: string,
    sessionId: string,
    runId: string,
    executionMode: ExecutionMode,
    options: RunAgentOptions
  ): Promise<RunAgentResult> {
    const processId = options.processId || runId;
    const bin = this.findBinary('claude_code');
    if (!bin) {
      return Promise.resolve(this.handleUnavailableHarness('claude_code', cwd, sessionId, runId));
    }

    const args = ['-p', prompt];
    if (executionMode === 'safe') args.unshift('--permission-mode', 'plan');
    else if (executionMode === 'sandboxed') args.unshift('--permission-mode', 'acceptEdits');
    else if (executionMode === 'unrestricted' && process.env.LYRA_ENABLE_UNRESTRICTED === 'true') args.unshift('--dangerously-skip-permissions');
    if (options.model) args.unshift('--model', options.model);
    if (options.continueSession) args.unshift('--continue');

    this.emit('thought', {
      sessionId,
      runId,
      agentType: 'claude_code',
      thought: `Launching Claude Code in ${cwd}...`,
    });

    let fullContent = '';

    return new Promise<RunAgentResult>((resolve) => {
      let isSettled = false;
      const finish = (result: RunAgentResult) => {
        if (isSettled) return;
        isSettled = true;
        this.activeProcesses.delete(processId);
        resolve(result);
      };

      try {
        const child = spawn(bin, args, {
          cwd,
          env: this.getExtendedEnv(),
        });

        const timeoutId = setTimeout(() => {
          const proc = this.activeProcesses.get(processId);
          if (proc) {
            proc.timedOut = true;
            try { proc.child.kill('SIGTERM'); } catch {}
          }
        }, this.timeoutMs);

        this.activeProcesses.set(processId, {
          child,
          sessionId,
          runId,
          agentType: 'claude_code',
          cancelled: false,
          timedOut: false,
          timeoutId,
        });

        child.stdout.on('data', (data) => {
          const text = data.toString();
          fullContent += text;
          this.emit('content_chunk', {
            sessionId,
            runId,
            agentType: 'claude_code',
            delta: text,
            fullContent,
          });
        });

        child.stderr.on('data', (data) => {
          this.emit('thought', {
            sessionId,
            runId,
            agentType: 'claude_code',
            thought: `[claude log] ${data.toString().trim()}`,
          });
        });

        child.on('close', (code) => {
          clearTimeout(timeoutId);
          const proc = this.activeProcesses.get(processId);
          const wasCancelled = proc?.cancelled || false;
          const wasTimedOut = proc?.timedOut || false;

          if (wasCancelled) {
            this.emit('run_cancelled', { sessionId, runId, agentType: 'claude_code' });
            this.emit('done', { sessionId, runId, agentType: 'claude_code', fullContent, code: 130 });
            finish({ sessionId, runId, agentType: 'claude_code', code: 130, fullContent, cancelled: true });
            return;
          }

          if (wasTimedOut) {
            const timeoutMsg = `Claude Code CLI timed out after ${this.timeoutMs / 1000}s.`;
            this.emit('error', { sessionId, runId, agentType: 'claude_code', message: timeoutMsg });
            this.emit('done', { sessionId, runId, agentType: 'claude_code', fullContent, code: 124 });
            finish({ sessionId, runId, agentType: 'claude_code', code: 124, fullContent, error: timeoutMsg });
            return;
          }

          const exitCode = code ?? 0;
          this.emit('done', { sessionId, runId, agentType: 'claude_code', fullContent, code: exitCode });
          finish({ sessionId, runId, agentType: 'claude_code', code: exitCode, fullContent });
        });

        child.on('error', (err) => {
          clearTimeout(timeoutId);
          const errMessage = `Failed to execute Claude Code: ${err.message}`;
          this.emit('error', { sessionId, runId, agentType: 'claude_code', message: errMessage });
          this.emit('content_chunk', {
            sessionId,
            runId,
            agentType: 'claude_code',
            delta: errMessage,
            fullContent: errMessage,
          });
          this.emit('done', { sessionId, runId, agentType: 'claude_code', fullContent: errMessage, code: 1 });
          finish({ sessionId, runId, agentType: 'claude_code', code: 1, fullContent: errMessage, error: err.message });
        });
      } catch (e: any) {
        const errMessage = `Error starting Claude Code: ${e?.message || e}`;
        this.emit('error', { sessionId, runId, agentType: 'claude_code', message: errMessage });
        this.emit('done', { sessionId, runId, agentType: 'claude_code', fullContent: '', code: 1 });
        finish({ sessionId, runId, agentType: 'claude_code', code: 1, fullContent: '', error: errMessage });
      }
    });
  }
}
