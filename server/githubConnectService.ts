/**
 * Lyra Autonomous GitHub Connect Service
 * 
 * Provides frictionless 1-click GitHub setup:
 * 1. Zero-Friction Local Mode: Detects existing authenticated GitHub CLI (`gh`) session.
 * 2. 1-Click Hosted App Mode: Directs user to GitHub App installation page and receives callback.
 * 3. App Manifest Mode: Generates pre-configured GitHub App Manifest for automatic registration.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { UnifiedStore } from './unifiedStore';

export interface GitHubConnectionState {
  connected: boolean;
  source: 'gh-cli' | 'github-app' | 'none';
  username?: string;
  installationId?: string;
  token?: string;
  lastConnected: string;
}

export class GitHubConnectService {
  constructor(private store: UnifiedStore) {}

  /**
   * Automatically detect existing authenticated GitHub credentials from the environment.
   */
  public detectLocalCredentials(): { available: boolean; username?: string; token?: string; error?: string } {
    try {
      const ghPath = execSync('which gh', { encoding: 'utf-8' }).trim();
      if (!ghPath) return { available: false, error: 'gh CLI not installed' };

      const statusOutput = execSync('gh auth status', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).toString();
      const userMatch = statusOutput.match(/account\s+([A-Za-z0-9_-]+)/i);
      const username = userMatch ? userMatch[1] : undefined;

      const token = execSync('gh auth token', { encoding: 'utf-8' }).trim();

      if (token) {
        return { available: true, username, token };
      }
      return { available: false, error: 'No active gh auth token' };
    } catch (err: any) {
      return { available: false, error: err.message || 'Failed checking local gh status' };
    }
  }

  /**
   * Connect automatically using the local GitHub CLI session.
   */
  public connectViaLocalCli(): GitHubConnectionState {
    const creds = this.detectLocalCredentials();
    if (!creds.available || !creds.token) {
      throw new Error(`Cannot connect via GitHub CLI: ${creds.error || 'No active session'}`);
    }

    const state: GitHubConnectionState = {
      connected: true,
      source: 'gh-cli',
      username: creds.username,
      token: creds.token,
      lastConnected: new Date().toISOString(),
    };

    this.saveConnectionState(state);
    return state;
  }

  /**
   * Generate GitHub App Manifest payload for 1-click automatic app creation.
   */
  public generateAppManifest(hubUrl = 'http://localhost:3001'): {
    actionUrl: string;
    manifestJson: string;
  } {
    const manifest = {
      name: `Lyra Bot (${process.env.USER || 'autonomous'})`,
      url: hubUrl,
      hook_attributes: {
        active: false,
      },
      redirect_url: `${hubUrl}/api/github/callback`,
      public: false,
      default_permissions: {
        contents: 'write',
        pull_requests: 'write',
        metadata: 'read',
      },
      default_events: [],
    };

    return {
      actionUrl: 'https://github.com/settings/apps/new',
      manifestJson: JSON.stringify(manifest),
    };
  }

  /**
   * Handle the installation callback from GitHub.
   */
  public handleInstallationCallback(params: {
    installationId: string;
    setupAction?: string;
  }): GitHubConnectionState {
    const state: GitHubConnectionState = {
      connected: true,
      source: 'github-app',
      installationId: params.installationId,
      lastConnected: new Date().toISOString(),
    };

    this.saveConnectionState(state);
    return state;
  }

  /**
   * Save connection state to workspace config.
   */
  public saveConnectionState(state: GitHubConnectionState): void {
    const configPath = path.join(process.cwd(), '.lyra-github-connection.json');
    fs.writeFileSync(configPath, JSON.stringify(state, null, 2), 'utf-8');
  }

  /**
   * Retrieve active connection state.
   */
  public getConnectionState(): GitHubConnectionState {
    const configPath = path.join(process.cwd(), '.lyra-github-connection.json');
    if (fs.existsSync(configPath)) {
      try {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      } catch {
        // fallback
      }
    }

    // Try auto-detecting local gh
    const detected = this.detectLocalCredentials();
    if (detected.available && detected.token) {
      return {
        connected: true,
        source: 'gh-cli',
        username: detected.username,
        token: detected.token,
        lastConnected: new Date().toISOString(),
      };
    }

    return {
      connected: false,
      source: 'none',
      lastConnected: new Date().toISOString(),
    };
  }
}
