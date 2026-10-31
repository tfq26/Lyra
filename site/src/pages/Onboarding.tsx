import React, { useState } from 'react';
import { 
  Terminal, 
  Copy, 
  Check, 
  Laptop, 
  Cloud 
} from 'lucide-react';

const Onboarding: React.FC = () => {
  const [envTab, setEnvTab] = useState<'vscode' | 'coder' | 'cli'>('vscode');
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCmd(id);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-10 py-4">
      
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-xs font-mono text-cyan-300">
          <Terminal className="h-3.5 w-3.5 text-cyan-400" />
          <span>Interactive Onboarding & Installation</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          Connect Your Workspace to Lyra
        </h1>
        <p className="text-sm text-slate-400 max-w-xl mx-auto">
          Get up and running in under 2 minutes. Install the official lightweight extension or use the zero-daemon CLI.
        </p>
      </div>

      {/* Environment Selector Tabs */}
      <div className="flex justify-center">
        <div className="flex p-1.5 rounded-2xl bg-slate-900/90 border border-white/[0.08] gap-1">
          {[
            { id: 'vscode', label: 'VS Code Desktop', icon: Laptop },
            { id: 'coder', label: 'Coder (Cloud / Browser)', icon: Cloud },
            { id: 'cli', label: 'Ephemeral CLI', icon: Terminal },
          ].map((tab) => {
            const Icon = tab.icon;
            const isSelected = envTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setEnvTab(tab.id as any)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-mono font-semibold transition-all ${
                  isSelected
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25 border border-indigo-500/40'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Guide Content: VS Code */}
      {envTab === 'vscode' && (
        <div className="space-y-6 animate-fade-in">
          
          {/* Step 1: Install VSIX */}
          <div className="glass-panel rounded-2xl p-6 sm:p-8 space-y-4 border border-white/[0.08]">
            <div className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-500/40 text-indigo-400 font-mono font-bold flex items-center justify-center text-sm">
                1
              </span>
              <div>
                <h3 className="text-base font-bold text-white">Install the Packaged Extension (.vsix)</h3>
                <p className="text-xs text-slate-400">Ultra-lightweight (19.15 KB), zero external telemetry.</p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#06080E] border border-white/[0.08] font-mono text-xs text-slate-300 flex items-center justify-between gap-4">
              <code className="text-indigo-300 overflow-x-auto select-all">
                code --install-extension extensions/vscode/lyra-swarm-1.0.0.vsix
              </code>
              <button
                onClick={() => copyToClipboard('code --install-extension extensions/vscode/lyra-swarm-1.0.0.vsix', 'step1')}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs flex items-center gap-1.5 shrink-0"
              >
                {copiedCmd === 'step1' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copiedCmd === 'step1' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <div className="text-xs text-slate-400 flex items-center gap-2">
              <span className="text-slate-500">Alternatively:</span>
              <span>Open VS Code → <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">Cmd+Shift+P</kbd> → select <em>"Extensions: Install from VSIX..."</em></span>
            </div>
          </div>

          {/* Step 2: Authenticate */}
          <div className="glass-panel rounded-2xl p-6 sm:p-8 space-y-4 border border-white/[0.08]">
            <div className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-xl bg-purple-500/20 border border-purple-500/40 text-purple-400 font-mono font-bold flex items-center justify-center text-sm">
                2
              </span>
              <div>
                <h3 className="text-base font-bold text-white">Authenticate with your Personal Access Token</h3>
                <p className="text-xs text-slate-400">Securely stored in your operating system keychain via SecretStorage.</p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-900/60 border border-white/[0.06] space-y-2 text-xs font-mono text-slate-300">
              <div className="flex items-center gap-2">
                <span className="text-purple-400 font-bold">1.</span>
                <span>Generate a PAT token in the <a href="/pat-generator" className="text-indigo-400 underline">PAT Portal</a>.</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-purple-400 font-bold">2.</span>
                <span>Press <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">Cmd+Shift+P</kbd> and run <strong>"Lyra: Sign In"</strong>.</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-purple-400 font-bold">3.</span>
                <span>Paste your token (<code className="text-indigo-300">lyra-pat-...</code>). You're ready to dispatch.</span>
              </div>
            </div>
          </div>

          {/* Step 3: Dispatch & Cockpit */}
          <div className="glass-panel rounded-2xl p-6 sm:p-8 space-y-4 border border-white/[0.08]">
            <div className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-400 font-mono font-bold flex items-center justify-center text-sm">
                3
              </span>
              <div>
                <h3 className="text-base font-bold text-white">Launch Studio & Dispatch Swarms</h3>
                <p className="text-xs text-slate-400">Monitor parallel DAG cards and live Bedrock FinOps HUD in real-time.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
              <div className="p-4 rounded-xl bg-[#06080E] border border-white/[0.06] space-y-1.5">
                <span className="text-slate-400 uppercase text-[10px] block">Activity Bar Icon</span>
                <span className="text-white font-semibold">Click the Lyra Swarm icon in the sidebar</span>
                <p className="text-slate-500 text-[11px]">Quick dispatch form, cluster status, and pull sync button.</p>
              </div>
              <div className="p-4 rounded-xl bg-[#06080E] border border-white/[0.06] space-y-1.5">
                <span className="text-slate-400 uppercase text-[10px] block">Studio Dashboard</span>
                <span className="text-white font-semibold">Command: Lyra: Open Swarm Studio Dashboard</span>
                <p className="text-slate-500 text-[11px]">Full-tab visual DAG view with live token count & diff reviews.</p>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* Guide Content: Coder */}
      {envTab === 'coder' && (
        <div className="space-y-6 animate-fade-in">
          <div className="glass-panel rounded-2xl p-6 sm:p-8 space-y-5 border border-white/[0.08]">
            <div className="flex items-center gap-3">
              <Cloud className="h-6 w-6 text-indigo-400" />
              <div>
                <h3 className="text-lg font-bold text-white">Coder Cloud Workspaces</h3>
                <p className="text-xs text-slate-400">Seamlessly run Lyra in browser-based VS Code instances.</p>
              </div>
            </div>

            <div className="space-y-4 text-xs font-mono text-slate-300">
              <div className="p-4 rounded-xl bg-slate-900/60 border border-white/[0.06] space-y-3">
                <h4 className="text-white font-semibold text-sm">Option A: Drag & Drop Install</h4>
                <p className="text-slate-400">
                  Open your Coder web workspace, navigate to the Extensions view in the left sidebar, and simply drag the <code className="text-indigo-300">lyra-swarm-1.0.0.vsix</code> file directly into the browser window. Coder installs it automatically.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-900/60 border border-white/[0.06] space-y-3">
                <h4 className="text-white font-semibold text-sm">Option B: Coder Terraform Template Preset</h4>
                <p className="text-slate-400">
                  Add the extension directly into your workspace startup script in <code className="text-indigo-300">main.tf</code>:
                </p>
                <div className="p-3 rounded-lg bg-[#06080E] border border-white/[0.08] text-indigo-300">
                  code-server --install-extension /path/to/lyra-swarm-1.0.0.vsix
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Guide Content: CLI */}
      {envTab === 'cli' && (
        <div className="space-y-6 animate-fade-in">
          <div className="glass-panel rounded-2xl p-6 sm:p-8 space-y-5 border border-white/[0.08]">
            <div className="flex items-center gap-3">
              <Terminal className="h-6 w-6 text-cyan-400" />
              <div>
                <h3 className="text-lg font-bold text-white">Zero-Daemon Ephemeral CLI</h3>
                <p className="text-xs text-slate-400">No background server required. Runs on-demand, scales to zero.</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-[#06080E] border border-white/[0.08] space-y-2 font-mono text-xs">
                <span className="text-slate-500 uppercase text-[10px] block">Interactive Dispatch (with live tailing):</span>
                <code className="text-cyan-300 select-all block">
                  bun run dispatch "Add password reset flow with unit tests"
                </code>
              </div>

              <div className="p-4 rounded-xl bg-[#06080E] border border-white/[0.08] space-y-2 font-mono text-xs">
                <span className="text-slate-500 uppercase text-[10px] block">Fire-and-Forget Dispatch (immediate terminal exit):</span>
                <code className="text-cyan-300 select-all block">
                  bun run dispatch --async "Refactor auth middleware to JWT"
                </code>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Onboarding;
