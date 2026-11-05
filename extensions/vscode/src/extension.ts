import * as vscode from 'vscode';
import { AuthManager } from './auth/authManager';
import { LyraClient } from './gateway/lyraClient';
import { GitSync } from './gateway/gitSync';
import { SwarmSidebarProvider } from './providers/swarmSidebarProvider';
import { SwarmStudioPanel } from './providers/swarmStudioPanel';
import { UniversalChatPanel } from './providers/universalChatPanel';
import { CloudSessionsProvider } from './providers/cloudSessionsProvider';
import { LYRA_PATCH_SCHEME, PatchPreviewProvider } from './providers/patchPreviewProvider';

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  const authManager = new AuthManager(context);
  const lyraClient = new LyraClient(authManager);

  // 0. Register Virtual Document Provider for Native Side-by-Side Fast Patch Diffs
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      LYRA_PATCH_SCHEME,
      PatchPreviewProvider.instance
    )
  );

  // 1. Register Activity Bar Sidebar Webview
  const sidebarProvider = new SwarmSidebarProvider(context.extensionUri, authManager, lyraClient);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('lyraSwarmSidebar', sidebarProvider)
  );

  // 1b. Register Native Cloud Sessions Tree View
  const cloudSessionsProvider = new CloudSessionsProvider(authManager, lyraClient);
  vscode.window.registerTreeDataProvider('lyraCloudSessions', cloudSessionsProvider);

  // 1c. Register Status Bar Indicator
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'lyra.openUniversalChat';
  context.subscriptions.push(statusBarItem);
  updateStatusBar(authManager);

  // 2. Command: Open Studio Dashboard Tab
  context.subscriptions.push(
    vscode.commands.registerCommand('lyra.openStudio', (runId?: string) => {
      SwarmStudioPanel.render(context.extensionUri, lyraClient, runId);
    })
  );

  // 2b. Command: Open Cloud Agents Chat
  context.subscriptions.push(
    vscode.commands.registerCommand('lyra.openUniversalChat', (sessionId?: string) => {
      UniversalChatPanel.render(context.extensionUri, lyraClient, sessionId);
    })
  );

  // 2c. Command: Start New Cloud Chat
  context.subscriptions.push(
    vscode.commands.registerCommand('lyra.newCloudSession', async () => {
      const title = await vscode.window.showInputBox({
        prompt: 'Enter a title for your 24/7 cloud session',
        placeHolder: 'e.g. Build spatial audio culling algorithm...',
      });
      if (!title) return;

      const cwd = GitSync.getWorkspaceRoot() || process.cwd();
      try {
        const session = await lyraClient.createAhpSession({
          title,
          workspacePath: cwd,
          model: 'auto',
        });
        cloudSessionsProvider.refresh();
        UniversalChatPanel.render(context.extensionUri, lyraClient, session.sessionId);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to create session: ${err.message}`);
      }
    })
  );

  // 2d. Command: Refresh Cloud Sessions
  context.subscriptions.push(
    vscode.commands.registerCommand('lyra.refreshSessions', () => {
      cloudSessionsProvider.refresh();
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
        vscode.window.showInformationMessage(`Task dispatched. Run ID: ${res.runId}`);
        SwarmStudioPanel.render(context.extensionUri, lyraClient, res.runId);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Dispatch failed: ${err.message}`);
      }
    })
  );

  // 4. Command: Sign In (Auto-configures & Auto-loads active cloud chats)
  context.subscriptions.push(
    vscode.commands.registerCommand('lyra.signIn', async () => {
      const choice = await vscode.window.showQuickPick(
        [
          {
            label: '$(key) Paste Sync Token from Portal',
            description: '1-click sync token from http://localhost:5173/account',
          },
          {
            label: '$(mail) Sign In with Email & Password',
            description: 'Authenticate with your Lyra / Better Auth credentials',
          },
        ],
        { placeHolder: 'Choose how to connect to your Lyra Cloud Swarm' }
      );
      if (!choice) return;

      if (choice.label.includes('Paste Sync Token')) {
        const token = await vscode.window.showInputBox({
          prompt: 'Paste your Lyra Session Token from the portal (copied from Account Sync)',
          placeHolder: 'Paste token here...',
          password: true,
        });
        if (!token) return;

        const res = await authManager.signIn('synced-user@lyra.dev', token.trim());
        if (res.success) {
          vscode.window.showInformationMessage(`Lyra cloud account synced successfully.`);
          sidebarProvider.update();
          cloudSessionsProvider.refresh();
          updateStatusBar(authManager);
          setTimeout(() => {
            const latestId = cloudSessionsProvider.getLatestSessionId();
            UniversalChatPanel.render(context.extensionUri, lyraClient, latestId);
          }, 300);
        } else {
          vscode.window.showErrorMessage(`Token verification failed: ${res.error}`);
        }
        return;
      }

      const email = await vscode.window.showInputBox({
        prompt: 'Lyra account email',
        value: 'engineer@lyra.dev',
      });
      if (!email) return;

      const pass = await vscode.window.showInputBox({
        prompt: 'Lyra account password',
        password: true,
      });
      if (!pass) return;

      const res = await authManager.signIn(email, pass);
      if (res.success) {
        vscode.window.showInformationMessage(`Signed in as ${res.user?.email}`);

        // Update UI & status
        sidebarProvider.update();
        cloudSessionsProvider.refresh();
        updateStatusBar(authManager);

        // Auto-open Universal Chat with latest active cloud session
        setTimeout(() => {
          const latestId = cloudSessionsProvider.getLatestSessionId();
          UniversalChatPanel.render(context.extensionUri, lyraClient, latestId);
        }, 300);
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
      cloudSessionsProvider.refresh();
      updateStatusBar(authManager);
    })
  );

  // 6. Command: Pull Verified Results
  context.subscriptions.push(
    vscode.commands.registerCommand('lyra.pullResults', async (branchName?: string) => {
      const cwd = GitSync.getWorkspaceRoot();
      if (!cwd) return;
      const branch = branchName || (await vscode.window.showInputBox({ prompt: 'Branch name to pull', value: 'lyra/feature' }));
      if (!branch) return;
      try {
        await GitSync.pullBranch(cwd, branch);
        vscode.window.showInformationMessage(`Branch ${branch} pulled successfully.`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Pull failed: ${err.message}`);
      }
    })
  );
}

async function updateStatusBar(authManager: AuthManager) {
  const auth = await authManager.verify();
  if (auth.authenticated) {
    statusBarItem.text = '$(cloud) Lyra: Connected';
    statusBarItem.tooltip = `Connected to Lyra 24/7 Cloud Runner (${auth.user?.email}). Click to open Cloud Chats.`;
  } else {
    statusBarItem.text = '$(cloud-offline) Lyra: Sign In';
    statusBarItem.tooltip = 'Click to connect to your Lyra Cloud Runner';
    statusBarItem.command = 'lyra.signIn';
  }
  statusBarItem.show();
}

export function deactivate() {
  SwarmStudioPanel.currentPanel?.dispose();
  UniversalChatPanel.currentPanel?.dispose();
  statusBarItem?.dispose();
}
