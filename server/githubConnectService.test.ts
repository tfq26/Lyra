import { describe, expect, it, beforeEach, afterAll } from 'bun:test';
import path from 'node:path';
import fs from 'node:fs';
import { GitHubConnectService } from './githubConnectService';
import { UnifiedStore } from './unifiedStore';

describe('GitHubConnectService', () => {
  let store: UnifiedStore;
  let service: GitHubConnectService;
  const testStoreDir = path.join(process.cwd(), '.bun-temp', `store-gh-${Date.now()}`);
  const connFile = path.join(process.cwd(), '.lyra-github-connection.json');

  beforeEach(() => {
    store = new UnifiedStore(testStoreDir);
    service = new GitHubConnectService(store);
  });

  afterAll(() => {
    if (fs.existsSync(testStoreDir)) fs.rmSync(testStoreDir, { recursive: true, force: true });
    if (fs.existsSync(connFile)) fs.unlinkSync(connFile);
  });

  it('generates a valid GitHub App Manifest with required permissions', () => {
    const { actionUrl, manifestJson } = service.generateAppManifest('http://localhost:3001');
    expect(actionUrl).toBe('https://github.com/settings/apps/new');
    
    const manifest = JSON.parse(manifestJson);
    expect(manifest.default_permissions.contents).toBe('write');
    expect(manifest.default_permissions.pull_requests).toBe('write');
    expect(manifest.hook_attributes.active).toBe(false);
    expect(manifest.redirect_url).toBe('http://localhost:3001/api/github/callback');
  });

  it('saves and restores GitHub connection state', () => {
    service.saveConnectionState({
      connected: true,
      source: 'github-app',
      installationId: '987654321',
      lastConnected: new Date().toISOString(),
    });

    const state = service.getConnectionState();
    expect(state.connected).toBe(true);
    expect(state.source).toBe('github-app');
    expect(state.installationId).toBe('987654321');
  });

  it('handles installation callback and transitions state to connected', () => {
    const state = service.handleInstallationCallback({
      installationId: '11223344',
      setupAction: 'install',
    });

    expect(state.connected).toBe(true);
    expect(state.installationId).toBe('11223344');
  });
});
