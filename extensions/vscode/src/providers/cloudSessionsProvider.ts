import * as vscode from 'vscode';
import type { LyraClient } from '../gateway/lyraClient';
import type { AuthManager } from '../auth/authManager';

export class CloudSessionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly sessionId: string,
    public readonly title: string,
    public readonly model: string,
    public readonly messageCount: number,
    public readonly status: 'idle' | 'running' | 'completed' | 'error',
    public readonly updatedAt: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
  ) {
    super(title, collapsibleState);

    const isRunning = status === 'running';
    this.description = `${model} · ${messageCount} msg${messageCount === 1 ? '' : 's'}`;
    this.tooltip = `Session: ${title}\nModel: ${model}\nStatus: ${status}\nLast updated: ${new Date(updatedAt).toLocaleString()}`;

    this.iconPath = new vscode.ThemeIcon(
      isRunning ? 'sync~spin' : 'comment-discussion',
      isRunning ? new vscode.ThemeColor('charts.green') : new vscode.ThemeColor('foreground')
    );

    this.contextValue = 'cloudSession';

    this.command = {
      command: 'lyra.openUniversalChat',
      title: 'Open Cloud Chat',
      arguments: [sessionId],
    };
  }
}

export class CloudSessionsProvider implements vscode.TreeDataProvider<CloudSessionTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<CloudSessionTreeItem | undefined | void> =
    new vscode.EventEmitter<CloudSessionTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<CloudSessionTreeItem | undefined | void> =
    this._onDidChangeTreeData.event;

  private sessions: any[] = [];

  constructor(
    private authManager: AuthManager,
    private lyraClient: LyraClient
  ) {}

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  public getTreeItem(element: CloudSessionTreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: CloudSessionTreeItem): Promise<CloudSessionTreeItem[]> {
    if (element) return [];

    const auth = await this.authManager.verify();
    if (!auth.authenticated) {
      const signInItem = new CloudSessionTreeItem(
        'sign-in-prompt',
        'Sign in to view sessions',
        'Authentication required',
        0,
        'idle',
        new Date().toISOString()
      );
      signInItem.iconPath = new vscode.ThemeIcon('account');
      signInItem.command = {
        command: 'lyra.signIn',
        title: 'Sign In to Lyra Account',
      };
      return [signInItem];
    }

    try {
      const res = await this.lyraClient.listAhpSessions();
      this.sessions = res.sessions || [];

      if (this.sessions.length === 0) {
        const emptyItem = new CloudSessionTreeItem(
          'no-sessions',
          'No active sessions',
          'Select + to start a session',
          0,
          'idle',
          new Date().toISOString()
        );
        emptyItem.iconPath = new vscode.ThemeIcon('inbox');
        emptyItem.command = {
          command: 'lyra.newCloudSession',
          title: 'Start New Session',
        };
        return [emptyItem];
      }

      return this.sessions.map((s) => {
        return new CloudSessionTreeItem(
          s.sessionId,
          s.title || 'Untitled Session',
          s.model || 'claude-3-5-sonnet',
          s.messageCount || 0,
          s.status || 'idle',
          s.updatedAt || new Date().toISOString()
        );
      });
    } catch (err: any) {
      const errItem = new CloudSessionTreeItem(
        'error-item',
        `Disconnected: ${err.message}`,
        'Offline',
        0,
        'error',
        new Date().toISOString()
      );
      errItem.iconPath = new vscode.ThemeIcon('error');
      return [errItem];
    }
  }

  public getLatestSessionId(): string | undefined {
    return this.sessions[0]?.sessionId;
  }
}
