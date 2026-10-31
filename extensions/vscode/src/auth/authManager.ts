import * as vscode from 'vscode';

export interface LyraUser {
  email: string;
}

export class AuthManager {
  private static readonly SECRET_KEY = 'lyra_auth_token';
  private static readonly USER_KEY = 'lyra_auth_user';

  constructor(private context: vscode.ExtensionContext) {}

  public getHubUrl(): string {
    const config = vscode.workspace.getConfiguration('lyra');
    return config.get<string>('hubUrl', 'https://api.lyra.dev').replace(/\/+$/, '');
  }

  public async getToken(): Promise<string | undefined> {
    return await this.context.secrets.get(AuthManager.SECRET_KEY);
  }

  public async getUser(): Promise<LyraUser | undefined> {
    const raw = this.context.globalState.get<string>(AuthManager.USER_KEY);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  public async signIn(email: string, passwordOrToken: string): Promise<{ success: boolean; user?: LyraUser; error?: string }> {
    const hubUrl = this.getHubUrl();
    try {
      const res = await fetch(`${hubUrl}/api/gateway/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: passwordOrToken, token: passwordOrToken }),
      });

      const data = await res.json() as any;
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || 'Authentication failed' };
      }

      await this.context.secrets.store(AuthManager.SECRET_KEY, data.token);
      await this.context.globalState.update(AuthManager.USER_KEY, JSON.stringify(data.user));

      return { success: true, user: data.user };
    } catch (err: any) {
      return { success: false, error: `Connection to Lyra Hub failed: ${err.message}` };
    }
  }

  public async signOut(): Promise<void> {
    await this.context.secrets.delete(AuthManager.SECRET_KEY);
    await this.context.globalState.update(AuthManager.USER_KEY, undefined);
  }

  public async verify(): Promise<{ authenticated: boolean; user?: LyraUser }> {
    const token = await this.getToken();
    if (!token) return { authenticated: false };

    const hubUrl = this.getHubUrl();
    try {
      const res = await fetch(`${hubUrl}/api/gateway/auth/verify`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        await this.signOut();
        return { authenticated: false };
      }
      const data = await res.json() as any;
      return { authenticated: true, user: data.user };
    } catch {
      return { authenticated: false };
    }
  }
}
