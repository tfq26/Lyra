import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const home = os.homedir();
const pluginDir = path.join(home, 'plugins', 'lyra-harness');
const manifestDir = path.join(pluginDir, '.codex-plugin');
const assetsDir = path.join(pluginDir, 'assets');
const councilSkillDir = path.join(pluginDir, 'skills', 'lyra-council');
const councilAgentsDir = path.join(councilSkillDir, 'agents');
const teammateSkillDir = path.join(pluginDir, 'skills', 'lyra-teammate');
const teammateAgentsDir = path.join(teammateSkillDir, 'agents');
const marketplaceDir = path.join(home, '.agents', 'plugins');
const codexSkillsDir = path.join(home, '.codex', 'skills');

for (const dir of [
  manifestDir,
  assetsDir,
  councilAgentsDir,
  teammateAgentsDir,
  marketplaceDir,
  path.join(codexSkillsDir, 'lyra-council', 'agents'),
  path.join(codexSkillsDir, 'lyra-teammate', 'agents'),
]) {
  fs.mkdirSync(dir, { recursive: true });
}

const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect width="64" height="64" rx="16" fill="#0F172A"/>
  <path d="M32 10L48 22V42L32 54L16 42V22L32 10Z" stroke="#38BDF8" stroke-width="3" fill="#0284C7" fill-opacity="0.18"/>
  <circle cx="32" cy="24" r="4" fill="#38BDF8"/>
  <circle cx="23" cy="39" r="4" fill="#A855F7"/>
  <circle cx="41" cy="39" r="4" fill="#10B981"/>
  <path d="M32 28V34M27 37L32 34M37 37L32 34" stroke="#F8FAFC" stroke-width="2.5" stroke-linecap="round"/>
</svg>`;

fs.writeFileSync(path.join(assetsDir, 'logo.svg'), logoSvg, 'utf8');

const mcpJson = {
  mcpServers: {
    lyra_harness: {
      command: '/Users/taufeeqali/.nvm/versions/node/v22.18.0/bin/bun',
      args: ['run', '/Users/taufeeqali/Projects/Lyra/scripts/mcp-server-stdio.ts'],
      env: {
        LYRA_HUB_URL: 'http://localhost:3001',
        LYRA_GATEWAY_API_KEY: 'lyra-harness-default-secret',
      },
      startup_timeout_sec: 15,
      tool_timeout_sec: 600,
    },
  },
};

fs.writeFileSync(path.join(pluginDir, '.mcp.json'), JSON.stringify(mcpJson, null, 2) + '\n', 'utf8');

const pluginManifest = {
  name: 'lyra-harness',
  version: '1.3.0',
  description:
    'Lyra Multi-Model Council (Pareto Bedrock Selector) & 24/7 Hermes Repo Memory Teammate for DeepSeek Harness Desktop.',
  author: {
    name: 'Taufeeq Ali',
    email: 'taufeeq@lyra.dev',
    url: 'https://github.com/taufeeqali',
  },
  homepage: 'http://localhost:3001',
  repository: 'https://github.com/taufeeqali/Lyra',
  license: 'MIT',
  keywords: [
    'lyra',
    'bedrock',
    'multi-model-council',
    'pareto-router',
    'rag',
    'hermes-memory',
    'cross-device-sync',
  ],
  skills: './skills/',
  mcpServers: './.mcp.json',
  interface: {
    displayName: 'Lyra Bedrock Council & 24/7 Teammate',
    shortDescription: 'Pareto Multi-Model Council, RAG & Cross-Device Memory',
    longDescription:
      'Convenes 3 distinct Amazon Bedrock models + a Synthesis Chair (dynamically selected by the Pareto Model Selector) to debate architecture, triangulate bugs, synthesize multi-doc RAG evidence, and maintain 24/7 Hermes Repo Memory across all your devices.',
    developerName: 'Lyra Engineering',
    category: 'Developer Tools',
    capabilities: ['Interactive', 'Read', 'Write'],
    websiteURL: 'http://localhost:3001',
    privacyPolicyURL: 'http://localhost:3001/docs',
    termsOfServiceURL: 'http://localhost:3001/docs',
    defaultPrompt: [
      'Convene the Lyra Multi-Model Council to analyze this repo architecture',
      'Sync my latest Lyra cross-device chat history and 24/7 Hermes memory',
      'Run a 3-model security and root-cause triangulation on this module',
    ],
    brandColor: '#0284C7',
    composerIcon: './assets/logo.svg',
    logo: './assets/logo.svg',
    screenshots: [],
  },
};

fs.writeFileSync(
  path.join(manifestDir, 'plugin.json'),
  JSON.stringify(pluginManifest, null, 2) + '\n',
  'utf8'
);

const councilSkillMd = `---
name: lyra-council
description: "Convene Lyra's Multi-Model Council on Amazon Bedrock. Dynamically selects 3 distinct specialist models + a Synthesis Chair via the Pareto Model Selector to analyze architecture trade-offs, cross-document RAG, security invariants, and Heisenbug root causes."
---

# Lyra Multi-Model Council (\`lyra_council_analyze\`)

Use this skill whenever the user asks to:
- Convene the **Multi-Model Council** or get multiple model perspectives on a question,
- Analyze cross-document / multi-file RAG trade-offs across the repository,
- Triangulate a complex bug, concurrency race condition, or security invariant,
- Compare ` + '`frugal`' + `, ` + '`balanced`' + `, or ` + '`frontier`' + ` Pareto model policies.

## Workflow

1. Call the \`lyra_council_analyze\` MCP tool (from \`lyra_harness\`) with:
   - \`question\`: The user's architectural, debugging, or RAG question.
   - \`workspacePath\`: The current workspace root path.
   - \`mode\`: One of \`rag-synthesis\`, \`architecture-debate\`, \`security-triangulation\`, or \`heisenbug-rca\`.
   - \`policyProfile\`: \`balanced\` (default), \`frugal\`, or \`frontier\`.
2. Present the returned Council report clearly, highlighting:
   - Which **3 distinct Bedrock models** and **Chair** the Pareto Model Selector chose (and why),
   - **High-Confidence Consensus** across all 3 models,
   - **Cross-Examination & Edge-Case Tension** where the models disagreed,
   - **Synthesized Solution** and the **24/7 Hermes Repo Memory ID** persisted for future turns.
`;

const councilAgentYaml = `interface:
  display_name: "Lyra Multi-Model Council"
  short_description: "3-Seat Pareto Bedrock Council + Chair Synthesis"
  default_prompt: "Use $lyra-council to convene 3 distinct Amazon Bedrock models and a Synthesis Chair to analyze this problem."
policy:
  allow_implicit_invocation: true
`;

fs.writeFileSync(path.join(councilSkillDir, 'SKILL.md'), councilSkillMd, 'utf8');
fs.writeFileSync(path.join(councilAgentsDir, 'openai.yaml'), councilAgentYaml, 'utf8');
fs.writeFileSync(path.join(codexSkillsDir, 'lyra-council', 'SKILL.md'), councilSkillMd, 'utf8');
fs.writeFileSync(path.join(codexSkillsDir, 'lyra-council', 'agents', 'openai.yaml'), councilAgentYaml, 'utf8');

const teammateSkillMd = `---
name: lyra-teammate
description: "Synchronize cross-device chat sessions (sinceSeq), retrieve 24/7 Hermes Repo Memory checkpoints, and dispatch background QA/verification runs via Lyra."
---

# Lyra 24/7 Teammate & Cross-Device Session Sync

Use this skill whenever the user wants to:
- Resume or sync a chat session from another device (\`lyra_sync_session\`),
- Inspect learned **24/7 Hermes Repo Memory** insights or handoff briefs (\`lyra_get_handoff\`),
- Dispatch an autonomous background verification or maintenance run (\`lyra_dispatch_task\`, \`lyra_run_qa_sandbox\`, \`lyra_run_maintenance\`).

## Workflow

1. To sync cross-device chat deltas and learned repo memory, call \`lyra_sync_session\` with \`sinceSeq: 0\` (or the last known sequence cursor) and \`workspacePath\`.
2. To check background teammate handoffs, call \`lyra_get_handoff\`.
3. Summarize new cross-device turns, active learned invariants, and recommended next actions concisely.
`;

const teammateAgentYaml = `interface:
  display_name: "Lyra 24/7 Teammate"
  short_description: "Cross-device session sync, repo memory & background QA"
  default_prompt: "Use $lyra-teammate to sync my latest cross-device session deltas, check 24/7 Hermes Repo Memory, and prepare a handoff brief."
policy:
  allow_implicit_invocation: true
`;

fs.writeFileSync(path.join(teammateSkillDir, 'SKILL.md'), teammateSkillMd, 'utf8');
fs.writeFileSync(path.join(teammateAgentsDir, 'openai.yaml'), teammateAgentYaml, 'utf8');
fs.writeFileSync(path.join(codexSkillsDir, 'lyra-teammate', 'SKILL.md'), teammateSkillMd, 'utf8');
fs.writeFileSync(path.join(codexSkillsDir, 'lyra-teammate', 'agents', 'openai.yaml'), teammateAgentYaml, 'utf8');

const marketplaceJson = {
  name: 'lyra-personal',
  interface: {
    displayName: 'Lyra Engineering Suite',
  },
  plugins: [
    {
      name: 'lyra-harness',
      source: {
        source: 'local',
        path: './plugins/lyra-harness',
      },
      policy: {
        installation: 'INSTALLED_BY_DEFAULT',
        authentication: 'ON_INSTALL',
      },
      category: 'Developer Tools',
    },
  ],
};

fs.writeFileSync(
  path.join(marketplaceDir, 'marketplace.json'),
  JSON.stringify(marketplaceJson, null, 2) + '\n',
  'utf8'
);

// Ensure ~/.codex/config.toml has [mcp_servers.lyra_harness] and [model_providers.lyra]
const configPath = path.join(home, '.codex', 'config.toml');
if (fs.existsSync(configPath)) {
  let toml = fs.readFileSync(configPath, 'utf8');
  if (!toml.includes('[mcp_servers.lyra_harness]')) {
    const block = `
[mcp_servers.lyra_harness]
command = "/Users/taufeeqali/.nvm/versions/node/v22.18.0/bin/bun"
args = ["run", "/Users/taufeeqali/Projects/Lyra/scripts/mcp-server-stdio.ts"]
startup_timeout_sec = 15

[mcp_servers.lyra_harness.env]
LYRA_HUB_URL = "http://localhost:3001"
LYRA_GATEWAY_API_KEY = "lyra-harness-default-secret"
`;
    // Insert right after [mcp_servers.playwright] block
    const anchor = 'args = ["@playwright/mcp@latest"]';
    if (toml.includes(anchor)) {
      toml = toml.replace(anchor, anchor + '\n' + block);
    } else {
      toml += '\n' + block;
    }
    fs.writeFileSync(configPath, toml, 'utf8');
    console.log('Added [mcp_servers.lyra_harness] to ~/.codex/config.toml');
  } else {
    console.log('[mcp_servers.lyra_harness] already present in ~/.codex/config.toml');
  }
}

console.log('Successfully installed Lyra plugin, agents, skills, and MCP server into DeepSeek Harness Desktop!');
