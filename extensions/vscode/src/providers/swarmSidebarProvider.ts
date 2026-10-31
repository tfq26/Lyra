import * as vscode from 'vscode';
import type { AuthManager } from '../auth/authManager';
import type { LyraClient } from '../gateway/lyraClient';
import { GitSync } from '../gateway/gitSync';
import { SwarmStudioPanel } from './swarmStudioPanel';

export class SwarmSidebarProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(
    private extensionUri: vscode.Uri,
    private authManager: AuthManager,
    private lyraClient: LyraClient
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    this.update();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'signIn':
          await this.handleSignIn();
          break;
        case 'signOut':
          await this.handleSignOut();
          break;
        case 'dispatch':
          await this.handleDispatch(message.objective);
          break;
        case 'openStudio':
          vscode.commands.executeCommand('lyra.openStudio');
          break;
      }
    });
  }

  public async update() {
    if (!this.view) return;
    const authStatus = await this.authManager.verify();
    this.view.webview.html = this.getHtml(authStatus);
  }

  private async handleSignIn() {
    const email = await vscode.window.showInputBox({
      prompt: 'Enter your Lyra account email',
      value: 'developer@lyra.local',
    });
    if (!email) return;

    const password = await vscode.window.showInputBox({
      prompt: 'Enter your Lyra password or Personal Access Token (PAT)',
      password: true,
    });
    if (!password) return;

    const res = await this.authManager.signIn(email, password);
    if (res.success) {
      vscode.window.showInformationMessage(`Signed in as ${res.user?.email}`);
      this.update();
    } else {
      vscode.window.showErrorMessage(`Sign in failed: ${res.error}`);
    }
  }

  private async handleSignOut() {
    await this.authManager.signOut();
    vscode.window.showInformationMessage('Signed out of Lyra.');
    this.update();
  }

  private async handleDispatch(objective: string) {
    if (!objective?.trim()) {
      vscode.window.showWarningMessage('Please enter a feature objective before dispatching.');
      return;
    }

    const cwd = GitSync.getWorkspaceRoot();
    if (!cwd) {
      vscode.window.showErrorMessage('No workspace folder open. Open a project before dispatching.');
      return;
    }

    try {
      // 1. Pre-flight Git sync snapshot
      vscode.window.showInformationMessage('Preparing Git pre-flight snapshot...');
      await GitSync.createSyncSnapshot(cwd);

      // 2. Dispatch to cloud swarm
      vscode.window.showInformationMessage('Dispatching to Lyra Cloud Swarm (AWS Bedrock)...');
      const res = await this.lyraClient.dispatchTask({
        objective,
        workspacePath: cwd,
      });

      vscode.window.showInformationMessage(`Swarm dispatched! Run ID: ${res.runId}`);
      SwarmStudioPanel.render(this.extensionUri, this.lyraClient, res.runId);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Dispatch failed: ${err.message}`);
    }
  }

  private getHtml(auth: { authenticated: boolean; user?: { email: string } }): string {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <style>
        body {
          font-family: var(--vscode-font-family);
          color: var(--vscode-foreground);
          padding: 12px;
          margin: 0;
        }
        .section {
          margin-bottom: 16px;
          border-bottom: 1px solid var(--vscode-panel-border);
          padding-bottom: 16px;
        }
        .auth-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: var(--vscode-badge-background);
          color: var(--vscode-badge-foreground);
          padding: 6px 10px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
        }
        textarea {
          width: 100%;
          box-sizing: border-box;
          background: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
          border-radius: 4px;
          padding: 8px;
          font-family: inherit;
          resize: vertical;
          min-height: 80px;
          margin-bottom: 8px;
        }
        button {
          width: 100%;
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          border-radius: 4px;
          padding: 8px;
          font-weight: 600;
          cursor: pointer;
          margin-bottom: 6px;
        }
        button:hover { background: var(--vscode-button-hoverBackground); }
        button.secondary {
          background: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
        }
        button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
        .meta-text {
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
          line-height: 1.4;
        }
      </style>
    </head>
    <body>
      <div class="section">
        ${auth.authenticated ? `
          <div class="auth-bar">
            <span>● Signed In: ${auth.user?.email}</span>
            <a href="#" style="color: inherit; text-decoration: underline;" onclick="vscode.postMessage({ command: 'signOut' })">Sign Out</a>
          </div>
        ` : `
          <button onclick="vscode.postMessage({ command: 'signIn' })">🔑 Sign In to Lyra Cloud</button>
          <div class="meta-text">Connect to your Lyra Hub or Coder server to enable cloud execution.</div>
        `}
      </div>

      <div class="section">
        <label style="font-weight: 600; font-size: 12px; display: block; margin-bottom: 6px;">Dispatch Cloud Feature:</label>
        <textarea id="objective" placeholder="e.g. Build spatial audio occlusion system with zero heap allocations in the audio thread..."></textarea>
        <button onclick="dispatch()">⚡ Dispatch to Cloud Swarm</button>
        <div class="meta-text">Automated pre-flight Git snapshot will be pushed before execution.</div>
      </div>

      <div class="section" style="border: none;">
        <button class="secondary" onclick="vscode.postMessage({ command: 'openStudio' })">📊 Open Swarm Studio</button>
      </div>

      <script>
        const vscode = acquireVsCodeApi();
        function dispatch() {
          const objective = document.getElementById('objective').value;
          vscode.postMessage({ command: 'dispatch', objective });
        }
      </script>
    </body>
    </html>`;
  }
}
