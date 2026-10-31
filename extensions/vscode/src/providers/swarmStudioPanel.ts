import * as vscode from 'vscode';
import type { LyraClient, RunStatusResult } from '../gateway/lyraClient';
import { GitSync } from '../gateway/gitSync';

export class SwarmStudioPanel {
  public static currentPanel: SwarmStudioPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private currentRunId?: string;
  private pollInterval?: NodeJS.Timeout;

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
          case 'refresh':
            await this.updateStatus();
            break;
          case 'pullBranch':
            await this.handlePullBranch(message.branch);
            break;
        }
      },
      null,
      this.disposables
    );
  }

  public static render(extensionUri: vscode.Uri, lyraClient: LyraClient, runId?: string) {
    if (SwarmStudioPanel.currentPanel) {
      SwarmStudioPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      if (runId) {
        SwarmStudioPanel.currentPanel.setRunId(runId);
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'lyraSwarmStudio',
      'Lyra Swarm Studio',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    SwarmStudioPanel.currentPanel = new SwarmStudioPanel(panel, extensionUri, lyraClient);
    if (runId) {
      SwarmStudioPanel.currentPanel.setRunId(runId);
    }
  }

  public setRunId(runId: string) {
    this.currentRunId = runId;
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.updateStatus();
    this.pollInterval = setInterval(() => this.updateStatus(), 4000);
  }

  private async handlePullBranch(branch?: string) {
    const cwd = GitSync.getWorkspaceRoot();
    if (!cwd) return;
    try {
      const targetBranch = branch || (this.currentRunId ? `lyra/feature-${this.currentRunId}` : undefined);
      if (!targetBranch) throw new Error('No target branch specified');
      await GitSync.pullBranch(cwd, targetBranch);
      vscode.window.showInformationMessage(`Successfully pulled ${targetBranch} into your workspace!`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Pull failed: ${err.message}`);
    }
  }

  private async updateStatus() {
    if (!this.currentRunId) {
      this.panel.webview.html = this.getEmptyHtml();
      return;
    }

    try {
      const status = await this.lyraClient.getRunStatus(this.currentRunId);
      this.panel.webview.html = this.getHtmlForStatus(status);
    } catch (err: any) {
      this.panel.webview.html = this.getErrorHtml(err.message);
    }
  }

  private getEmptyHtml(): string {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: system-ui, -apple-system, sans-serif; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); padding: 32px; text-align: center; }
        .hero { max-width: 500px; margin: 40px auto; }
        h2 { font-size: 24px; font-weight: 600; margin-bottom: 8px; }
        p { color: var(--vscode-descriptionForeground); font-size: 14px; line-height: 1.6; }
      </style>
    </head>
    <body>
      <div class="hero">
        <h2>⚡ Lyra Swarm Studio</h2>
        <p>No swarm tasks are currently active. Dispatch a task from the Lyra Cockpit in the sidebar to visualize parallel execution, model routing, and verification DAGs.</p>
      </div>
    </body>
    </html>`;
  }

  private getErrorHtml(error: string): string {
    return `<!DOCTYPE html>
    <html><body style="font-family: system-ui; padding: 24px; color: var(--vscode-editor-foreground);">
      <h3>Error Loading Swarm Run</h3>
      <p style="color: var(--vscode-errorForeground);">${error}</p>
      <button onclick="acquireVsCodeApi().postMessage({ command: 'refresh' })">Retry</button>
    </body></html>`;
  }

  private getHtmlForStatus(status: RunStatusResult): string {
    const tasks = status.tasks || [];
    const telemetry = status.telemetry;
    const isCompleted = status.state === 'completed' || status.stage === 'completed';

    const taskCards = tasks.map((t, idx) => {
      const badgeClass = t.status === 'succeeded' ? 'status-succeeded' : t.status === 'running' ? 'status-running' : 'status-pending';
      const icon = t.status === 'succeeded' ? '✓' : t.status === 'running' ? '⏳' : '○';
      return `
        <div class="task-card ${badgeClass}">
          <div class="task-header">
            <span class="task-num">Task ${idx + 1}</span>
            <span class="task-badge">${icon} ${t.status.toUpperCase()}</span>
          </div>
          <div class="task-title">${t.title}</div>
          <div class="task-meta">
            <span>Model: <strong>${t.assignedModel || 'qwen.qwen3-coder-480b-a35b-v1:0'}</strong></span>
            <span>Agent: <strong>${t.assignedAgent || 'hermes'}</strong></span>
          </div>
        </div>
      `;
    }).join('');

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <style>
        :root {
          --accent: #3b82f6;
          --success: #10b981;
          --warning: #f59e0b;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          background: var(--vscode-editor-background);
          color: var(--vscode-editor-foreground);
          padding: 24px;
          margin: 0;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid var(--vscode-panel-border);
          padding-bottom: 16px;
          margin-bottom: 24px;
        }
        .header h1 { font-size: 20px; font-weight: 600; margin: 0; }
        .hud {
          display: flex;
          gap: 16px;
          background: var(--vscode-editorWidget-background);
          border: 1px solid var(--vscode-editorWidget-border);
          border-radius: 8px;
          padding: 12px 20px;
          margin-bottom: 24px;
        }
        .hud-item { display: flex; flex-direction: column; }
        .hud-label { font-size: 11px; text-transform: uppercase; color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
        .hud-val { font-size: 15px; font-weight: 600; }
        .hud-val.green { color: var(--success); }
        .hud-val.blue { color: var(--accent); }
        .dag-container {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 16px;
          margin-bottom: 32px;
        }
        .task-card {
          background: var(--vscode-editorWidget-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 8px;
          padding: 16px;
          transition: transform 0.15s ease, border-color 0.15s ease;
        }
        .task-card.status-succeeded { border-left: 4px solid var(--success); }
        .task-card.status-running { border-left: 4px solid var(--accent); box-shadow: 0 0 12px rgba(59, 130, 246, 0.2); }
        .task-card.status-pending { border-left: 4px solid var(--vscode-descriptionForeground); opacity: 0.7; }
        .task-header { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 8px; }
        .task-num { color: var(--vscode-descriptionForeground); font-weight: 600; }
        .task-badge { font-weight: 700; font-size: 11px; }
        .task-title { font-size: 14px; font-weight: 600; margin-bottom: 12px; line-height: 1.4; }
        .task-meta { font-size: 12px; color: var(--vscode-descriptionForeground); display: flex; flex-direction: column; gap: 4px; }
        .actions { display: flex; gap: 12px; margin-top: 24px; }
        button {
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          border-radius: 4px;
          padding: 8px 16px;
          font-weight: 600;
          cursor: pointer;
        }
        button:hover { background: var(--vscode-button-hoverBackground); }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <h1>Run: ${status.runId}</h1>
          <span style="font-size: 12px; color: var(--vscode-descriptionForeground);">Stage: ${status.stage} • State: ${status.state}</span>
        </div>
        <div class="actions">
          <button onclick="vscode.postMessage({ command: 'refresh' })">🔄 Refresh</button>
          ${isCompleted ? `<button style="background: var(--success);" onclick="vscode.postMessage({ command: 'pullBranch' })">✓ Pull & Review Diffs</button>` : ''}
        </div>
      </div>

      <div class="hud">
        <div class="hud-item">
          <span class="hud-label">Auto-Routed Model</span>
          <span class="hud-val blue">${telemetry?.model || 'qwen.qwen3-coder-480b-a35b-v1:0'}</span>
        </div>
        <div class="hud-item">
          <span class="hud-label">Tokens Processed</span>
          <span class="hud-val">${telemetry ? `${(telemetry.totalTokens / 1000).toFixed(1)}k` : 'Calculating...'}</span>
        </div>
        <div class="hud-item">
          <span class="hud-label">Cloud FinOps Cost</span>
          <span class="hud-val green">${telemetry ? `$${telemetry.estimatedCostUsd.toFixed(4)} USD` : '$0.0000'}</span>
        </div>
        <div class="hud-item">
          <span class="hud-label">Elapsed Time</span>
          <span class="hud-val">${telemetry?.elapsedSeconds ? `${telemetry.elapsedSeconds}s` : 'Active'}</span>
        </div>
      </div>

      <h2>Execution DAG & Worktree Tasks (${tasks.filter(t => t.status === 'succeeded').length}/${tasks.length} Completed)</h2>
      <div class="dag-container">
        ${taskCards || '<p>Tasks are being scheduled by the lead planner...</p>'}
      </div>

      <script>
        const vscode = acquireVsCodeApi();
      </script>
    </body>
    </html>`;
  }

  public dispose() {
    SwarmStudioPanel.currentPanel = undefined;
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) d.dispose();
    }
  }
}
