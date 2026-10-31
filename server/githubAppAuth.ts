/**
 * GitHub App Authentication Helper for Lyra Swarms
 * 
 * Implements standard GitHub App RS256 JWT generation and installation token exchange
 * using native Node.js `node:crypto` with zero third-party dependencies.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface GitHubAppConfig {
  appId: string | number;
  privateKey: string; // PEM private key string
  installationId?: string | number;
}

export interface InstallationTokenResponse {
  token: string;
  expiresAt: string;
  permissions: Record<string, string>;
  repositorySelection?: string;
}

function base64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input;
  return buf.toString('base64url');
}

export class GitHubAppAuth {
  private appId: string;
  private privateKey: string;
  private installationId?: string;

  constructor(config: GitHubAppConfig) {
    this.appId = String(config.appId);
    this.privateKey = config.privateKey.trim();
    if (config.installationId) {
      this.installationId = String(config.installationId);
    }
  }

  /**
   * Load configuration from environment variables or a JSON file.
   */
  public static fromEnvOrFile(configPath?: string): GitHubAppAuth | null {
    // 1. Check environment variables
    const appId = process.env.GITHUB_APP_ID || process.env.LYRA_GITHUB_APP_ID;
    let privateKey = process.env.GITHUB_APP_PRIVATE_KEY || process.env.LYRA_GITHUB_APP_PRIVATE_KEY;
    const keyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH || process.env.LYRA_GITHUB_APP_KEY_PATH;
    const installationId = process.env.GITHUB_APP_INSTALLATION_ID || process.env.LYRA_GITHUB_INSTALLATION_ID;

    if (!privateKey && keyPath && fs.existsSync(keyPath)) {
      privateKey = fs.readFileSync(keyPath, 'utf-8');
    }

    if (appId && privateKey) {
      return new GitHubAppAuth({ appId, privateKey, installationId });
    }

    // 2. Check JSON file
    const targetFile = configPath || path.join(process.cwd(), '.lyra-github-app.json');
    if (fs.existsSync(targetFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(targetFile, 'utf-8'));
        if (parsed.appId && (parsed.privateKey || parsed.privateKeyPath)) {
          const key = parsed.privateKey || fs.readFileSync(parsed.privateKeyPath, 'utf-8');
          return new GitHubAppAuth({
            appId: parsed.appId,
            privateKey: key,
            installationId: parsed.installationId,
          });
        }
      } catch (err) {
        console.warn('Failed reading GitHub App config file:', err);
      }
    }

    return null;
  }

  /**
   * Generates a signed RS256 JWT for GitHub App authentication (valid for 10 minutes).
   */
  public generateJwt(): string {
    const now = Math.floor(Date.now() / 1000);
    const header = {
      alg: 'RS256',
      typ: 'JWT',
    };

    const payload = {
      iat: now - 60, // 60 seconds clock skew tolerance
      exp: now + 600, // 10 minutes max expiration
      iss: this.appId,
    };

    const encodedHeader = base64url(JSON.stringify(header));
    const encodedPayload = base64url(JSON.stringify(payload));
    const dataToSign = `${encodedHeader}.${encodedPayload}`;

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(dataToSign);
    const signature = signer.sign(this.privateKey, 'base64url');

    return `${dataToSign}.${signature}`;
  }

  /**
   * Retrieves all installations of this GitHub App.
   */
  public async getInstallations(): Promise<Array<{ id: number; account: { login: string; type: string } }>> {
    const jwt = this.generateJwt();
    const res = await fetch('https://api.github.com/app/installations', {
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Lyra-Bot-Auth/1.0',
      },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to fetch installations (${res.status}): ${err}`);
    }

    return await res.json() as any;
  }

  /**
   * Finds the installation ID for a specific repository or owner.
   */
  public async resolveInstallationId(owner: string, repo?: string): Promise<string> {
    if (this.installationId) return this.installationId;

    const jwt = this.generateJwt();
    const endpoint = repo
      ? `https://api.github.com/repos/${owner}/${repo}/installation`
      : `https://api.github.com/users/${owner}/installation`;

    const res = await fetch(endpoint, {
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Lyra-Bot-Auth/1.0',
      },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to resolve installation for ${owner}${repo ? '/' + repo : ''} (${res.status}): ${err}`);
    }

    const data: any = await res.json();
    this.installationId = String(data.id);
    return this.installationId;
  }

  /**
   * Generates a scoped installation access token for bot operations (pushing branches, opening PRs).
   */
  public async createInstallationToken(owner?: string, repo?: string): Promise<InstallationTokenResponse> {
    let targetInstId = this.installationId;
    if (!targetInstId && owner) {
      targetInstId = await this.resolveInstallationId(owner, repo);
    }

    if (!targetInstId) {
      throw new Error('Installation ID must be provided or resolved before generating an installation access token.');
    }

    const jwt = this.generateJwt();
    const res = await fetch(`https://api.github.com/app/installations/${targetInstId}/access_tokens`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Lyra-Bot-Auth/1.0',
      },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to create installation token (${res.status}): ${err}`);
    }

    const data: any = await res.json();
    return {
      token: data.token,
      expiresAt: data.expires_at,
      permissions: data.permissions || {},
      repositorySelection: data.repository_selection,
    };
  }

  /**
   * Formats an authenticated Git remote URL using the bot token.
   */
  public formatGitUrl(token: string, owner: string, repo: string): string {
    return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  }
}
