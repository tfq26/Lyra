#!/usr/bin/env bun
/**
 * Lyra 1-Click Autonomous GitHub Connect
 * 
 * Checks for existing local credentials (e.g. GitHub CLI `gh`) or launches
 * 1-click browser installation for instant PR capabilities.
 */

import path from 'node:path';
import { GitHubConnectService } from '../server/githubConnectService';
import { UnifiedStore } from '../server/unifiedStore';

async function main() {
  console.log('\n================================================================================');
  console.log('                 LYRA 1-CLICK AUTONOMOUS GITHUB CONNECT                         ');
  console.log('================================================================================');

  const store = new UnifiedStore(path.join(process.cwd(), '.lyra-store'));
  const connectService = new GitHubConnectService(store);

  console.log('🔍 Checking for existing GitHub credentials on your system...');
  const detected = connectService.detectLocalCredentials();

  if (detected.available && detected.token) {
    console.log(`\n🎉 Found active GitHub session for account: @${detected.username || 'user'}`);
    console.log('   Autonomously connecting Lyra to your GitHub account...');

    const state = connectService.connectViaLocalCli();

    console.log('\n✅ Successfully connected!');
    console.log(`   Account:    @${state.username}`);
    console.log(`   Source:     ${state.source}`);
    console.log(`   Connected:  ${state.lastConnected}`);

    // Verify repository access to Duit
    const owner = 'tfq26';
    const repo = 'Duit';
    console.log(`\n🔍 Verifying write/PR permissions on ${owner}/${repo}...`);

    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: {
          'Authorization': `token ${state.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Lyra-Bot/1.0',
        },
      });

      if (res.ok) {
        const data: any = await res.json();
        console.log(`   ✅ Confirmed access to repository: ${data.full_name}`);
        console.log(`   Push Permission: ${data.permissions?.push}`);
        console.log(`   Pull Permission: ${data.permissions?.pull}`);
        console.log('\n🚀 Lyra is now completely configured to push branches and open Pull Requests!');
        console.log('   Zero manual app creation or token copying required.\n');
      } else {
        console.warn(`   ⚠️ Repository check returned status ${res.status}`);
      }
    } catch (err: any) {
      console.warn('   ⚠️ Could not reach GitHub API:', err.message);
    }

    return;
  }

  // Fallback: 1-Click Hosted App Manifest
  console.log('\n🌐 No local GitHub session found. Starting 1-Click GitHub App Manifest...');
  const { actionUrl, manifestJson } = connectService.generateAppManifest('http://localhost:3001');

  console.log(`\nClick this URL to approve in 1 click (no manual form filling required):`);
  console.log(`👉 ${actionUrl}\n`);
}

main().catch((err) => {
  console.error('Connection failed:', err);
  process.exit(1);
});
