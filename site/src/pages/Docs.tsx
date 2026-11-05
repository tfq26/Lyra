import React from 'react';

const Docs: React.FC = () => {
  const copilotModelsConfig = JSON.stringify(
    [
      {
        name: 'Lyra Cloud Bedrock & Council',
        vendor: 'customendpoint',
        apiKey: 'lyra-harness-default-secret',
        apiType: 'chat-completions',
        models: [
          {
            id: 'lyra-auto',
            name: 'Lyra Auto (Pareto Router · Cloud Synced)',
            url: 'http://localhost:3001/v1/chat/completions',
            toolCalling: true,
            vision: true,
            maxInputTokens: 200000,
            maxOutputTokens: 8192,
          },
          {
            id: 'lyra-council',
            name: 'Lyra Council (Pareto-Selected Multi-Model RAG)',
            url: 'http://localhost:3001/v1/chat/completions',
            toolCalling: true,
            vision: false,
            maxInputTokens: 300000,
            maxOutputTokens: 8192,
          },
          {
            id: 'us.anthropic.claude-sonnet-5',
            name: 'Claude Sonnet 5 (Lyra Bedrock)',
            url: 'http://localhost:3001/v1/chat/completions',
            toolCalling: true,
            vision: true,
            maxInputTokens: 200000,
            maxOutputTokens: 8192,
          },
          {
            id: 'us.deepseek.r1-v1:0',
            name: 'DeepSeek-R1 (Lyra Bedrock)',
            url: 'http://localhost:3001/v1/chat/completions',
            toolCalling: true,
            vision: false,
            maxInputTokens: 128000,
            maxOutputTokens: 8192,
          },
        ],
      },
    ],
    null,
    2
  );

  return (
    <div className="space-y-12 max-w-3xl">
      <div className="space-y-3 apple-fade">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white font-display uppercase tracking-wide">
          Harness Setup &amp; Cloud Sync
        </h1>
        <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
          Lyra operates strictly through your existing developer harnesses—GitHub Copilot Chat, DeepSeek Harness (<code className="text-zinc-200">dsh</code>), Antigravity, Claude Code, and VS Code—syncing sessions and 24/7 Hermes memory across devices in the cloud.
        </p>
      </div>

      <div className="space-y-8 text-xs text-zinc-300 leading-relaxed apple-fade delay-100">
        {/* Step 1 */}
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-white">1. Add Lyra as a Model Provider in GitHub Copilot Chat</h2>
          <p className="text-zinc-400">
            Open <code className="text-zinc-200">Chat: Manage Language Models</code> (<code className="text-zinc-200">chatLanguageModels.json</code>) in VS Code to add Lyra&apos;s Pareto Router, Multi-Model Council, and AWS Bedrock fleet directly to the Copilot Chat model picker:
          </p>
          <pre className="clean-card p-3.5 font-mono text-zinc-300 text-[11px] overflow-x-auto leading-relaxed">
            {copilotModelsConfig}
          </pre>
        </div>

        {/* Step 2 */}
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-white">2. Cross-Device Chat Sync with DeepSeek Harness (dsh) &amp; CLI</h2>
          <p className="text-zinc-400">
            Every turn sent through <code className="text-zinc-200">/v1/chat/completions</code> or MCP is sequence-indexed in the Cloud Session Journal. Switch machines at any time and pull missing turns (<code className="text-zinc-200">sinceSeq</code>) plus 24/7 Hermes Repo Memory:
          </p>
          <pre className="clean-card p-3.5 font-mono text-zinc-300 text-[11px] overflow-x-auto leading-relaxed">
{`# List active cloud sessions across all your devices
bun scripts/lyra-sync.ts list

# Pull new sequence-delta messages & 24/7 Hermes memory on Device B
bun scripts/lyra-sync.ts pull session-main

# Run a synced turn or trigger the Multi-Model RAG Council from terminal
bun scripts/lyra-sync.ts council "Reconcile SQS claim-check limits with runner heartbeats"`}
          </pre>
        </div>

        {/* Step 3 */}
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-white">3. Connect the MCP Server (<code className="text-zinc-200">lyra_harness</code>)</h2>
          <p className="text-zinc-400">
            Register <code className="text-zinc-200">scripts/mcp-server-stdio.ts</code> in your IDE&apos;s MCP settings to unlock <code className="text-zinc-200">lyra_council_analyze</code>, <code className="text-zinc-200">lyra_sync_session</code>, <code className="text-zinc-200">lyra_dispatch_task</code>, and <code className="text-zinc-200">lyra_inspect_diff</code> inside any agent window.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Docs;
