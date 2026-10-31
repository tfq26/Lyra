import * as vscode from 'vscode';
import { AuthManager } from './auth/authManager';
import { LyraClient } from './gateway/lyraClient';
import { GitSync } from './gateway/gitSync';
import { SwarmSidebarProvider } from './providers/swarmSidebarProvider';
import { SwarmStudioPanel } from './providers/swarmStudioPanel';

export function activate(context: vscode.ExtensionContext) {
  const authManager = new AuthManager(context);
  const lyraClient = new LyraClient(authManager);

  // 1. Register Activity Bar Sidebar Webview
  const sidebarProvider = new SwarmSidebarProvider(context.extensionUri, authManager, lyraClient);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('lyraSwarmSidebar', sidebarProvider)
  );

  // 2. Command: Open Studio Dashboard Tab
  context.subscriptions.push(
    vscode.commands.registerCommand('lyra.openStudio', (runId?: string) => {
      SwarmStudioPanel.render(context.extensionUri, lyraClient, runId);
    })
  );

  // 3. Command: Dispatch Feature
  context.subscriptions.push(
    vscode.commands.registerCommand('lyra.dispatch', async () => {
      const objective = await vscode.window.showInputBox({
        prompt: 'Enter the feature or refactor objective for Lyra Cloud Swarm',
        placeHolder: 'e.g. Build real-time CRDT room server with SQLite persistence...',
      });
      if (!objective) return;

      const cwd = GitSync.getWorkspaceRoot();
      if (!cwd) {
        vscode.window.showErrorMessage('Please open a workspace folder before dispatching.');
        return;
      }

      try {
        await GitSync.createSyncSnapshot(cwd);
        const res = await lyraClient.dispatchTask({ objective, workspacePath: cwd });
        vscode.window.showInformationMessage(`Lyra Swarm dispatched! Run: ${res.runId}`);
        SwarmStudioPanel.render(context.extensionUri, lyraClient, res.runId);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Dispatch failed: ${err.message}`);
      }
    })
  );

  // 4. Command: Sign In
  context.subscriptions.push(
    vscode.commands.registerCommand('lyra.signIn', async () => {
      const email = await vscode.window.showInputBox({ prompt: 'Lyra account email', value: 'developer@lyra.local' });
      if (!email) return;
      const pass = await vscode.window.showInputBox({ prompt: 'Lyra password or PAT', password: true });
      if (!pass) return;

      const res = await authManager.signIn(email, pass);
      if (res.success) {
        vscode.window.showInformationMessage(`Signed in as ${res.user?.email}`);
        sidebarProvider.update();
      } else {
        vscode.window.showErrorMessage(`Sign in failed: ${res.error}`);
      }
    })
  );

  // 5. Command: Sign Out
  context.subscriptions.push(
    vscode.commands.registerCommand('lyra.signOut', async () => {
      await authManager.signOut();
      vscode.window.showInformationMessage('Signed out of Lyra.');
      sidebarProvider.update();
    })
  );

  // 6. Command: Pull Verified Results
  context.subscriptions.push(
    vscode.commands.registerCommand('lyra.pullResults', async (branchName?: string) => {
      const cwd = GitSync.getWorkspaceRoot();
      if (!cwd) return;
      const branch = branchName || await vscode.window.showInputBox({ prompt: 'Branch name to pull', value: 'lyra/feature' });
      if (!branch) return;
      try {
        await GitSync.pullBranch(cwd, branch);
        vscode.window.showInformationMessage(`Successfully pulled ${branch}!`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Pull failed: ${err.message}`);
      }
    })
  );
}

export function deactivate() {
  SwarmStudioPanel.currentPanel?.dispose();
}
