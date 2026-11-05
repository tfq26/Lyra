import * as path from 'path';
import * as vscode from 'vscode';
import { GitSync } from '../gateway/gitSync';
import type { FastLanePatchBundleDto, LyraClient } from '../gateway/lyraClient';
import { PatchPreviewProvider } from './patchPreviewProvider';

export class UniversalChatPanel {
  public static currentPanel: UniversalChatPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private currentSessionId?: string;
  private patchRegistry = new Map<string, FastLanePatchBundleDto>();

  private constructor(
    panel: vscode.WebviewPanel,
    private extensionUri: vscode.Uri,
    private lyraClient: LyraClient
  ) {
    this.panel = panel;
    this.panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'init':
            await Promise.all([this.handleLoadCatalog(), this.handleLoadSessions()]);
            break;
          case 'loadSessions':
            await this.handleLoadSessions();
            break;
          case 'createSession':
            await this.handleCreateSession(message.title, message.model);
            break;
          case 'selectSession':
            await this.handleSelectSession(message.sessionId);
            break;
          case 'sendMessage':
            await this.handleSendMessage(message);
            break;
          case 'previewPatch':
            await this.handlePreviewPatch(message.patchId, message.editIndex ?? 0);
            break;
          case 'applyPatch':
            await this.handleApplyPatch(message.patchId);
            break;
          case 'escalateToSwarm':
            await this.handleEscalateToSwarm(message);
            break;
          case 'openStudio':
            if (message.runId) {
              await vscode.commands.executeCommand('lyra.openStudio', message.runId);
            }
            break;
        }
      },
      null,
      this.disposables
    );

    this.panel.webview.html = this.getHtml();
  }

  public static render(extensionUri: vscode.Uri, lyraClient: LyraClient, sessionId?: string) {
    if (UniversalChatPanel.currentPanel) {
      UniversalChatPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      if (sessionId) {
        void UniversalChatPanel.currentPanel.handleSelectSession(sessionId);
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'lyraUniversalChat',
      'Lyra Agent Sessions',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    UniversalChatPanel.currentPanel = new UniversalChatPanel(panel, extensionUri, lyraClient);
    if (sessionId) {
      void UniversalChatPanel.currentPanel.handleSelectSession(sessionId);
    }
  }

  private async handleLoadCatalog() {
    try {
      const cfg = vscode.workspace.getConfiguration('lyra');
      const defaultPolicy = cfg.get<string>('defaultPolicyProfile', 'balanced');
      const autoApply = cfg.get<boolean>('autoApplyFastPatch', false);
      const catalog = await this.lyraClient.getModelCatalog();
      this.panel.webview.postMessage({
        type: 'catalogLoaded',
        models: catalog.paretoCatalog || [],
        defaultPolicy,
        autoApply,
      });
    } catch {
      // Fallback defaults already rendered in webview
    }
  }

  private async handleLoadSessions() {
    try {
      const res = await this.lyraClient.listAhpSessions();
      const sessions = res.sessions || [];
      this.panel.webview.postMessage({
        type: 'sessionsLoaded',
        sessions,
      });

      if (!this.currentSessionId && sessions.length > 0) {
        await this.handleSelectSession(sessions[0].sessionId);
      }
    } catch (err: any) {
      this.panel.webview.postMessage({
        type: 'statusUpdate',
        status: 'disconnected',
        error: err.message,
      });
    }
  }

  private async handleCreateSession(title?: string, model?: string) {
    const cwd = GitSync.getWorkspaceRoot() || process.cwd();
    try {
      const session = await this.lyraClient.createAhpSession({
        title:
          title ||
          `Session ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        workspacePath: cwd,
        model: model || 'auto',
      });
      await this.handleLoadSessions();
      await this.handleSelectSession(session.sessionId);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Session creation failed: ${err.message}`);
    }
  }

  private async handleSelectSession(sessionId: string) {
    try {
      this.currentSessionId = sessionId;
      const data = await this.lyraClient.getAhpSession(sessionId);
      const messages = (data.messages || []).map((m: any) => {
        if (m.patch && m.patch.edits?.length) {
          const patchId = `patch-hist-${m.id || Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          this.patchRegistry.set(patchId, m.patch);
          return { ...m, patchId };
        }
        return m;
      });
      this.panel.webview.postMessage({
        type: 'sessionSelected',
        data: { ...data, messages },
      });
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to load session ${sessionId}: ${err.message}`);
    }
  }

  private captureEditorContext(workspaceRoot: string): {
    activeFilePath?: string;
    selectionText?: string;
  } {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') return {};
    const fsPath = editor.document.uri.fsPath;
    const activeFilePath = fsPath.startsWith(workspaceRoot)
      ? path.relative(workspaceRoot, fsPath).split(path.sep).join('/')
      : undefined;
    const selectionText = !editor.selection.isEmpty
      ? editor.document.getText(editor.selection)
      : undefined;
    return { activeFilePath, selectionText };
  }

  private async handleSendMessage(message: {
    sessionId?: string;
    prompt: string;
    modePreference?: 'auto' | 'ask' | 'fast-patch' | 'full-swarm';
    policyProfile?: 'frugal' | 'balanced' | 'frontier';
    pinnedModelId?: string;
    autoApply?: boolean;
  }) {
    const cwd = GitSync.getWorkspaceRoot();
    if (!cwd) {
      vscode.window.showErrorMessage('Open a workspace folder in VS Code to run Lyra.');
      return;
    }

    const turnKey = `stream-${Date.now()}`;
    const editorCtx = this.captureEditorContext(cwd);

    this.panel.webview.postMessage({
      type: 'turnStarted',
      turnKey,
    });

    try {
      const finalResult = await this.lyraClient.streamAhpChat(
        {
          sessionId: message.sessionId || this.currentSessionId,
          prompt: message.prompt,
          workspacePath: cwd,
          modePreference: message.modePreference || 'auto',
          policyProfile: message.policyProfile || 'balanced',
          pinnedModelId:
            message.pinnedModelId && message.pinnedModelId !== 'auto'
              ? message.pinnedModelId
              : undefined,
          activeFilePath: editorCtx.activeFilePath,
          selectionText: editorCtx.selectionText,
        },
        {
          onTriage: (payload) => {
            this.panel.webview.postMessage({
              type: 'turnTriage',
              turnKey,
              triage: payload.triage,
              route: payload.route,
            });
          },
          onStatus: (status) => {
            this.panel.webview.postMessage({
              type: 'turnStatus',
              turnKey,
              status,
            });
          },
          onChunk: (chunk) => {
            this.panel.webview.postMessage({
              type: 'turnChunk',
              turnKey,
              chunk,
            });
          },
        }
      );

      if (finalResult?.sessionId && finalResult.sessionId !== this.currentSessionId) {
        this.currentSessionId = finalResult.sessionId;
        void this.handleLoadSessions();
      }

      let patchId: string | undefined;
      if (finalResult?.patch?.edits?.length) {
        patchId = `patch-${Date.now()}`;
        this.patchRegistry.set(patchId, finalResult.patch);

        if (message.autoApply && finalResult.patch.allVerified) {
          await PatchPreviewProvider.applyPatchBundle(cwd, finalResult.patch.edits);
          vscode.window.setStatusBarMessage(
            `Lyra Fast Patch auto-applied (${finalResult.patch.edits.length} file${
              finalResult.patch.edits.length === 1 ? '' : 's'
            }).`,
            4000
          );
        }
      }

      this.panel.webview.postMessage({
        type: 'turnCompleted',
        turnKey,
        result: finalResult,
        patchId,
        autoApplied: Boolean(message.autoApply && patchId && finalResult?.patch?.allVerified),
      });
    } catch (err: any) {
      this.panel.webview.postMessage({
        type: 'turnError',
        turnKey,
        error: err.message || 'Execution failed',
      });
    }
  }

  private async handlePreviewPatch(patchId: string, editIndex: number) {
    const cwd = GitSync.getWorkspaceRoot();
    const bundle = this.patchRegistry.get(patchId);
    if (!cwd || !bundle || !bundle.edits[editIndex]) return;
    try {
      await PatchPreviewProvider.openNativeDiffPreview(cwd, bundle.edits[editIndex]);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Diff preview failed: ${err.message}`);
    }
  }

  private async handleApplyPatch(patchId: string) {
    const cwd = GitSync.getWorkspaceRoot();
    const bundle = this.patchRegistry.get(patchId);
    if (!cwd || !bundle || !bundle.edits.length) return;
    try {
      const res = await PatchPreviewProvider.applyPatchBundle(cwd, bundle.edits);
      this.panel.webview.postMessage({
        type: 'patchApplied',
        patchId,
        appliedCount: res.appliedCount,
      });
      vscode.window.showInformationMessage(
        `Applied Lyra Fast Patch across ${res.appliedCount} file${res.appliedCount === 1 ? '' : 's'}.`
      );
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to apply patch: ${err.message}`);
    }
  }

  private async handleEscalateToSwarm(message: {
    sessionId?: string;
    prompt?: string;
    policyProfile?: 'frugal' | 'balanced' | 'frontier';
    pinnedModelId?: string;
  }) {
    const cwd = GitSync.getWorkspaceRoot();
    const sessionId = message.sessionId || this.currentSessionId;
    if (!cwd || !sessionId) return;

    const turnKey = `escalate-${Date.now()}`;
    this.panel.webview.postMessage({ type: 'turnStarted', turnKey });
    try {
      const res = await this.lyraClient.escalateToSwarm({
        sessionId,
        prompt: message.prompt,
        workspacePath: cwd,
        policyProfile: message.policyProfile || 'balanced',
        pinnedModelId:
          message.pinnedModelId && message.pinnedModelId !== 'auto'
            ? message.pinnedModelId
            : undefined,
      });
      this.panel.webview.postMessage({
        type: 'turnCompleted',
        turnKey,
        result: res,
      });
    } catch (err: any) {
      this.panel.webview.postMessage({
        type: 'turnError',
        turnKey,
        error: err.message || 'Swarm escalation failed',
      });
    }
  }

  public dispose() {
    UniversalChatPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) x.dispose();
    }
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lyra Agent Sessions</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--vscode-font-size, 13px);
      line-height: 1.5;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
      padding: 8px 14px;
      background: var(--vscode-sideBarSectionHeader-background, var(--vscode-editor-background));
      border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-widget-border));
    }

    .header-controls {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      flex: 1;
    }

    select {
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border, var(--vscode-widget-border));
      padding: 3px 7px;
      border-radius: 2px;
      font-size: 11.5px;
      outline: none;
      font-family: inherit;
    }

    select:focus { border-color: var(--vscode-focusBorder); }
    #sessionSelect { min-width: 150px; max-width: 220px; }

    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 4px 10px;
      border-radius: 2px;
      font-size: 11.5px;
      cursor: pointer;
      font-family: inherit;
    }

    button:hover { background: var(--vscode-button-hoverBackground); }
    button:disabled { opacity: 0.55; cursor: default; }

    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }

    .status-tag {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--vscode-testing-iconPassed);
    }

    .stream-container {
      flex: 1;
      overflow-y: auto;
      padding: 16px 18px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .message-row {
      display: flex;
      flex-direction: column;
      gap: 5px;
      max-width: 96%;
    }

    .message-row.user { align-self: flex-end; max-width: 85%; }
    .message-row.assistant { align-self: flex-start; width: 100%; }

    .author-line {
      font-size: 11px;
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .lane-label {
      font-weight: 500;
      padding: 1px 6px;
      border-radius: 2px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      font-size: 10.5px;
    }

    .message-card {
      padding: 8px 12px;
      border-radius: 3px;
      line-height: 1.5;
      word-break: break-word;
      white-space: pre-wrap;
    }

    .message-row.user .message-card {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
      color: var(--vscode-input-foreground);
    }

    .message-row.assistant .message-card {
      background: transparent;
      border-left: 2px solid var(--vscode-focusBorder);
      padding-left: 12px;
    }

    .telemetry-line {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 10.5px;
      color: var(--vscode-descriptionForeground);
      padding-left: 14px;
    }

    .patch-box {
      margin-top: 6px;
      margin-left: 14px;
      border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border));
      background: var(--vscode-textCodeBlock-background);
      border-radius: 3px;
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .patch-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11.5px;
      font-weight: 600;
    }

    .diff-pre {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      max-height: 180px;
      overflow: auto;
      white-space: pre;
      color: var(--vscode-editor-foreground);
      padding: 6px;
      border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border));
      background: var(--vscode-editor-background);
    }

    .action-bar {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      padding-left: 14px;
      margin-top: 2px;
    }

    .composer-area {
      padding: 10px 14px;
      background: var(--vscode-editor-background);
      border-top: 1px solid var(--vscode-panel-border, var(--vscode-widget-border));
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .mode-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
    }

    .mode-pills {
      display: inline-flex;
      border: 1px solid var(--vscode-dropdown-border, var(--vscode-widget-border));
      border-radius: 3px;
      overflow: hidden;
    }

    .mode-pill {
      background: var(--vscode-editor-background);
      color: var(--vscode-descriptionForeground);
      border: none;
      border-right: 1px solid var(--vscode-dropdown-border, var(--vscode-widget-border));
      padding: 3px 9px;
      font-size: 11px;
      border-radius: 0;
    }

    .mode-pill:last-child { border-right: none; }
    .mode-pill.active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      font-weight: 600;
    }

    .auto-apply-label {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      user-select: none;
    }

    .input-wrapper {
      display: flex;
      gap: 8px;
    }

    textarea {
      flex: 1;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
      padding: 8px 10px;
      border-radius: 3px;
      font-family: inherit;
      font-size: 13px;
      resize: vertical;
      min-height: 52px;
      outline: none;
    }

    textarea:focus { border-color: var(--vscode-focusBorder); }
    textarea::placeholder { color: var(--vscode-input-placeholderForeground); }

    .send-action { display: flex; flex-direction: column; justify-content: flex-end; }
    .send-action button { padding: 8px 14px; height: 34px; font-weight: 500; }
    .hint-text { font-size: 11px; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-controls">
      <select id="sessionSelect" title="Synced 24/7 Cloud Session">
        <option value="">New cloud session...</option>
      </select>
      <button class="secondary" id="newSessionBtn">New</button>
      <select id="policySelect" title="Pareto Routing Policy Profile">
        <option value="balanced">Policy: Balanced (Pareto)</option>
        <option value="frugal">Policy: Frugal</option>
        <option value="frontier">Policy: Frontier</option>
      </select>
      <select id="modelSelect" title="Model Selection (Auto Pareto Router or Manual Pin)">
        <option value="auto">Model: Auto (Pareto Router)</option>
        <option value="anthropic.claude-haiku-4-5-20251001-v1:0">Claude Haiku 4.5</option>
        <option value="amazon.nova-2-lite-v1:0">Amazon Nova 2 Lite</option>
        <option value="us.amazon.nova-pro-v1:0">Amazon Nova Pro</option>
        <option value="qwen.qwen3-coder-480b-a35b-v1:0">Qwen3 Coder 480B</option>
        <option value="anthropic.claude-sonnet-5">Claude Sonnet 5</option>
        <option value="us.deepseek.r1-v1:0">DeepSeek-R1</option>
        <option value="anthropic.claude-opus-5-5">Claude Opus 5.5</option>
      </select>
    </div>
    <div class="status-tag">
      <span class="status-dot" id="statusDot"></span>
      <span id="statusText">AHP Ready</span>
    </div>
  </div>

  <div class="stream-container" id="streamContainer">
    <div class="message-row assistant">
      <div class="author-line">Lyra <span class="lane-label">Adaptive 3-Lane</span></div>
      <div class="message-card">Ask a quick question (Lane 0), request a 1-2 file fix with instant diff preview (Lane 1), or dispatch a parallel multi-worktree cloud swarm (Lane 2).</div>
    </div>
  </div>

  <div class="composer-area">
    <div class="mode-toolbar">
      <div class="mode-pills" id="modePills">
        <button type="button" class="mode-pill active" data-mode="auto">Auto</button>
        <button type="button" class="mode-pill" data-mode="ask">Ask</button>
        <button type="button" class="mode-pill" data-mode="fast-patch">Fast Patch</button>
        <button type="button" class="mode-pill" data-mode="full-swarm">Swarm</button>
      </div>
      <label class="auto-apply-label">
        <input type="checkbox" id="autoApplyToggle" />
        <span>Auto-apply verified Fast Patches</span>
      </label>
    </div>
    <div class="input-wrapper">
      <textarea id="promptInput" placeholder="Ask a question, describe a quick fix, or dispatch a swarm objective..."></textarea>
      <div class="send-action">
        <button id="sendBtn">Send</button>
      </div>
    </div>
    <div class="hint-text">Enter to send · Shift+Enter for newline · Active editor file & selection forwarded automatically.</div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const sessionSelect = document.getElementById('sessionSelect');
    const newSessionBtn = document.getElementById('newSessionBtn');
    const policySelect = document.getElementById('policySelect');
    const modelSelect = document.getElementById('modelSelect');
    const autoApplyToggle = document.getElementById('autoApplyToggle');
    const streamContainer = document.getElementById('streamContainer');
    const promptInput = document.getElementById('promptInput');
    const sendBtn = document.getElementById('sendBtn');
    const statusText = document.getElementById('statusText');

    let selectedMode = 'auto';
    const activeTurnDom = new Map();

    document.querySelectorAll('.mode-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-pill').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        selectedMode = btn.getAttribute('data-mode') || 'auto';
      });
    });

    sessionSelect.addEventListener('change', () => {
      if (sessionSelect.value) {
        vscode.postMessage({ command: 'selectSession', sessionId: sessionSelect.value });
      }
    });

    newSessionBtn.addEventListener('click', () => {
      vscode.postMessage({ command: 'createSession', model: modelSelect.value });
    });

    sendBtn.addEventListener('click', sendMessage);
    promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    function formatLaneLabel(lane) {
      if (lane === 'ask') return 'Lane 0 · Instant Ask';
      if (lane === 'fast-patch') return 'Lane 1 · Fast Patch';
      if (lane === 'full-swarm') return 'Lane 2 · Full Swarm';
      return 'Auto-Triage';
    }

    function formatTelemetry(telemetry, route) {
      if (!telemetry && !route) return '';
      const parts = [];
      const modelName = (telemetry && telemetry.modelName) || (route && route.modelName);
      if (modelName) parts.push(modelName);
      if (route && route.crossRegionProfileId) parts.push(route.crossRegionProfileId);
      if (telemetry && telemetry.ttftMs) parts.push('TTFT ' + telemetry.ttftMs + 'ms');
      if (telemetry && telemetry.durationMs) parts.push((telemetry.durationMs / 1000).toFixed(2) + 's');
      if (telemetry && typeof telemetry.estimatedCostUsd === 'number') {
        parts.push('$' + telemetry.estimatedCostUsd.toFixed(4));
      }
      if (telemetry && telemetry.cacheReadTokens > 0) {
        const denom = (telemetry.inputTokens || 0) + telemetry.cacheReadTokens;
        const pct = denom > 0 ? Math.round((telemetry.cacheReadTokens / denom) * 100) : 0;
        parts.push('Prompt Cache ' + pct + '%');
      }
      if (telemetry && telemetry.failoverCount > 0) parts.push('Failover x' + telemetry.failoverCount);
      if (telemetry && telemetry.escalatedTier) parts.push('Escalated +1 Tier');
      return parts.join(' · ');
    }

    function sendMessage() {
      const text = promptInput.value.trim();
      if (!text) return;

      appendStaticMessage({ role: 'user', content: text });
      promptInput.value = '';

      vscode.postMessage({
        command: 'sendMessage',
        sessionId: sessionSelect.value || undefined,
        prompt: text,
        modePreference: selectedMode,
        policyProfile: policySelect.value,
        pinnedModelId: modelSelect.value,
        autoApply: autoApplyToggle.checked,
      });
    }

    function createAssistantTurnShell() {
      const row = document.createElement('div');
      row.className = 'message-row assistant';

      const author = document.createElement('div');
      author.className = 'author-line';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = 'Lyra';
      const badge = document.createElement('span');
      badge.className = 'lane-label';
      badge.textContent = 'Triaging...';
      author.appendChild(nameSpan);
      author.appendChild(badge);
      row.appendChild(author);

      const card = document.createElement('div');
      card.className = 'message-card';
      card.textContent = '';
      row.appendChild(card);

      const telemetryEl = document.createElement('div');
      telemetryEl.className = 'telemetry-line';
      row.appendChild(telemetryEl);

      const extrasContainer = document.createElement('div');
      row.appendChild(extrasContainer);

      streamContainer.appendChild(row);
      streamContainer.scrollTop = streamContainer.scrollHeight;
      return { row, badge, card, telemetryEl, extrasContainer, streamedText: '' };
    }

    function renderPatchAndActions(container, opts) {
      container.innerHTML = '';
      const { patch, patchId, lane, runId, autoApplied } = opts;

      if (patch && patch.edits && patch.edits.length > 0 && patchId) {
        const box = document.createElement('div');
        box.className = 'patch-box';

        const hdr = document.createElement('div');
        hdr.className = 'patch-header';
        hdr.textContent = patch.summary + (patch.allVerified ? ' · Syntax Verified' : '');
        box.appendChild(hdr);

        const pre = document.createElement('pre');
        pre.className = 'diff-pre';
        pre.textContent = patch.edits.map((e) => e.unifiedDiff).join('\\n\\n');
        box.appendChild(pre);
        container.appendChild(box);
      }

      const actions = document.createElement('div');
      actions.className = 'action-bar';

      if (patch && patch.edits && patch.edits.length > 0 && patchId) {
        const applyBtn = document.createElement('button');
        applyBtn.id = 'apply-' + patchId;
        applyBtn.textContent = autoApplied ? 'Applied' : 'Apply Patch';
        applyBtn.disabled = Boolean(autoApplied);
        applyBtn.addEventListener('click', () => {
          vscode.postMessage({ command: 'applyPatch', patchId });
        });
        actions.appendChild(applyBtn);

        patch.edits.forEach((edit, idx) => {
          const diffBtn = document.createElement('button');
          diffBtn.className = 'secondary';
          diffBtn.textContent = patch.edits.length > 1 ? 'Preview Diff (' + edit.filePath + ')' : 'Preview Diff';
          diffBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'previewPatch', patchId, editIndex: idx });
          });
          actions.appendChild(diffBtn);
        });
      }

      if (lane === 'ask' || lane === 'fast-patch') {
        const escBtn = document.createElement('button');
        escBtn.className = 'secondary';
        escBtn.textContent = 'Escalate to Swarm';
        escBtn.addEventListener('click', () => {
          vscode.postMessage({
            command: 'escalateToSwarm',
            sessionId: sessionSelect.value || undefined,
            policyProfile: policySelect.value,
            pinnedModelId: modelSelect.value,
          });
        });
        actions.appendChild(escBtn);
      }

      if (runId) {
        const studioBtn = document.createElement('button');
        studioBtn.className = 'secondary';
        studioBtn.textContent = 'Open Swarm Studio';
        studioBtn.addEventListener('click', () => {
          vscode.postMessage({ command: 'openStudio', runId });
        });
        actions.appendChild(studioBtn);
      }

      if (actions.childNodes.length > 0) {
        container.appendChild(actions);
      }
    }

    function appendStaticMessage(m) {
      if (m.role === 'user') {
        const row = document.createElement('div');
        row.className = 'message-row user';
        const author = document.createElement('div');
        author.className = 'author-line';
        author.textContent = 'You';
        const card = document.createElement('div');
        card.className = 'message-card';
        card.textContent = m.content;
        row.appendChild(author);
        row.appendChild(card);
        streamContainer.appendChild(row);
      } else {
        const shell = createAssistantTurnShell();
        shell.badge.textContent = m.lane ? formatLaneLabel(m.lane) : 'Assistant';
        shell.card.textContent = m.content;
        const tLine = formatTelemetry(m.telemetry, null);
        if (tLine) shell.telemetryEl.textContent = tLine;
        renderPatchAndActions(shell.extrasContainer, {
          patch: m.patch,
          patchId: m.patchId,
          lane: m.lane,
          runId: m.runId,
        });
      }
      streamContainer.scrollTop = streamContainer.scrollHeight;
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'catalogLoaded': {
          if (msg.defaultPolicy) policySelect.value = msg.defaultPolicy;
          if (typeof msg.autoApply === 'boolean') autoApplyToggle.checked = msg.autoApply;
          if (Array.isArray(msg.models) && msg.models.length > 0) {
            modelSelect.innerHTML = '<option value="auto">Model: Auto (Pareto Router)</option>';
            msg.models.forEach((m) => {
              const opt = document.createElement('option');
              opt.value = m.id;
              opt.textContent = m.name + ' (' + m.provider + ')';
              modelSelect.appendChild(opt);
            });
          }
          break;
        }

        case 'sessionsLoaded': {
          const prev = sessionSelect.value;
          sessionSelect.innerHTML = '<option value="">New cloud session...</option>';
          (msg.sessions || []).forEach((s) => {
            const opt = document.createElement('option');
            opt.value = s.sessionId;
            opt.textContent = s.title;
            sessionSelect.appendChild(opt);
          });
          if (prev) sessionSelect.value = prev;
          break;
        }

        case 'sessionSelected': {
          streamContainer.innerHTML = '';
          const meta = msg.data.meta;
          const messages = msg.data.messages || [];
          sessionSelect.value = meta.sessionId;

          if (messages.length === 0) {
            appendStaticMessage({
              role: 'assistant',
              lane: 'ask',
              content: 'Cloud session synced. Enter a question, quick fix, or swarm objective.',
            });
          } else {
            messages.forEach((m) => appendStaticMessage(m));
          }
          break;
        }

        case 'turnStarted': {
          const shell = createAssistantTurnShell();
          shell.card.textContent = 'Routing...';
          activeTurnDom.set(msg.turnKey, shell);
          break;
        }

        case 'turnTriage': {
          const shell = activeTurnDom.get(msg.turnKey);
          if (!shell) break;
          shell.badge.textContent = formatLaneLabel(msg.triage.lane);
          shell.telemetryEl.textContent = formatTelemetry(null, msg.route);
          break;
        }

        case 'turnStatus': {
          const shell = activeTurnDom.get(msg.turnKey);
          if (!shell) break;
          statusText.textContent = msg.status.slice(0, 42);
          if (!shell.streamedText) {
            shell.card.textContent = msg.status;
          }
          break;
        }

        case 'turnChunk': {
          const shell = activeTurnDom.get(msg.turnKey);
          if (!shell) break;
          shell.streamedText += msg.chunk;
          shell.card.textContent = shell.streamedText;
          streamContainer.scrollTop = streamContainer.scrollHeight;
          break;
        }

        case 'turnCompleted': {
          statusText.textContent = 'AHP Ready';
          const shell = activeTurnDom.get(msg.turnKey);
          if (!shell) break;
          const res = msg.result || {};
          if (res.sessionId) sessionSelect.value = res.sessionId;
          shell.badge.textContent = formatLaneLabel(res.lane);
          shell.card.textContent = res.content || shell.streamedText;
          shell.telemetryEl.textContent = formatTelemetry(res.telemetry, res.route);
          renderPatchAndActions(shell.extrasContainer, {
            patch: res.patch,
            patchId: msg.patchId,
            lane: res.lane,
            runId: res.runId,
            autoApplied: msg.autoApplied,
          });
          activeTurnDom.delete(msg.turnKey);
          streamContainer.scrollTop = streamContainer.scrollHeight;
          break;
        }

        case 'patchApplied': {
          const btn = document.getElementById('apply-' + msg.patchId);
          if (btn) {
            btn.textContent = 'Applied';
            btn.disabled = true;
          }
          break;
        }

        case 'turnError': {
          statusText.textContent = 'Error';
          const shell = activeTurnDom.get(msg.turnKey);
          if (shell) {
            shell.badge.textContent = 'Error';
            shell.card.textContent = 'Error: ' + msg.error;
            activeTurnDom.delete(msg.turnKey);
          }
          break;
        }
      }
    });

    vscode.postMessage({ command: 'init' });
  </script>
</body>
</html>`;
  }
}
