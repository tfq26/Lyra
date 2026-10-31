#!/usr/bin/env bun
/**
 * Verification Script for GitHub App Setup
 * 
 * Verifies App ID and Private Key, resolves installation ID on tfq26/Duit,
 * generates a short-lived bot token, and tests PR permissions.
 */

import fs from 'node:fs';
import path from 'node:path';
import { GitHubAppAuth } from '../server/githubAppAuth';

async function main() {
  console.log('\n================================================================================');
  console.log('                   LYRA GITHUB APP SETUP VERIFICATION                           ');
  console.log('================================================================================');

  const appAuth = GitHubAppAuth.fromEnvOrFile();

  if (!appAuth) {
    console.log('⚠️  No GitHub App configuration found in environment or .lyra-github-app.json.');
    console.log('\nTo configure, please either:');
    console.log('1. Set environment variables:');
    console.log('   export GITHUB_APP_ID="<your-app-id>"');
    console.log('   export GITHUB_APP_PRIVATE_KEY_PATH="<path-to-downloaded-.pem-file>"');
    console.log('\n2. Or create a file named ".lyra-github-app.json" with:');
    console.log(`   {
     "appId": "<your-app-id>",
     "privateKeyPath": "<path-to-downloaded-.pem-file>"
   }`);
    console.log('\nOnce created, run this script again: bun scripts/verify-github-app.ts\n');
    return;
  }

  console.log('🔑 Generating RS256 JWT using private key...');
  const jwt = appAuth.generateJwt();
  console.log('   ✅ RS256 JWT generated successfully.');

  console.log('\n🔍 Discovering GitHub App installations...');
  try {
    const installations = await appAuth.getInstallations();
    console.log(`   ✅ Found ${installations.length} installation(s):`);
    for (const inst of installations) {
      console.log(`      - Installation ID: ${inst.id} (Account: ${inst.account.login}, Type: ${inst.account.type})`);
    }

    const owner = 'tfq26';
    const repo = 'Duit';
    console.log(`\n🎯 Generating Installation Access Token for ${owner}/${repo}...`);
    const tokenData = await appAuth.createInstallationToken(owner, repo);
    console.log('   🎉 Successfully generated installation access token!');
    console.log(`      Token prefix: ${tokenData.token.slice(0, 10)}...`);
    console.log(`      Expires at:   ${tokenData.expiresAt}`);
    console.log(`      Permissions:  ${JSON.stringify(tokenData.permissions)}`);

    console.log('\n🚀 Testing authenticated GitHub API access on tfq26/Duit...');
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        'Authorization': `token ${tokenData.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Lyra-Bot-Verify/1.0',
      },
    });

    if (repoRes.ok) {
      const repoData: any = await repoRes.json();
      console.log(`   ✅ Successfully verified access to repository: ${repoData.full_name}`);
      console.log(`   Default Branch: ${repoData.default_branch}`);
      console.log(`   Permissions: Push=${repoData.permissions?.push}, Pull=${repoData.permissions?.pull}`);
      console.log('\n✨ GitHub App setup is complete and ready for autonomous PR creation!\n');
    } else {
      console.error(`   ❌ Failed querying repository (${repoRes.status}):`, await repoRes.text());
    }
  } catch (err: any) {
    console.error('❌ Verification failed:', err.message || err);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
