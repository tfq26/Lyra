import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  Terminal, 
  Layers, 
  Key, 
  ArrowRight, 
  Check, 
  Copy, 
  RotateCcw,
  Sparkles
} from 'lucide-react';

const Home: React.FC = () => {
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [terminalLineIndex, setTerminalLineIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<'stream' | 'worktrees' | 'finops'>('stream');

  const terminalLines = [
    { text: '$ bun run dispatch "Scaffold OAuth2 & Stripe Webhook with tests"', color: 'text-zinc-200 font-semibold' },
    { text: '🌿 Pre-flight git check: commit 8feb2e9 verified (clean working tree)', color: 'text-zinc-400' },
    { text: '⚡ Dynamic Pareto Router: AWS Bedrock Qwen 2.5 Coder + Claude 3.5 Sonnet', color: 'text-indigo-400' },
    { text: '📦 Decomposed DAG: 4 isolated git worktrees spawned on ephemeral Fargate:', color: 'text-zinc-300' },
    { text: '   ├─ [Worker 1] Scaffold Auth Models & JWT Middleware     (lyra/task-w1) [COMPLETED 34s]', color: 'text-emerald-400' },
    { text: '   ├─ [Worker 2] Implement Stripe Webhook & Signature      (lyra/task-w2) [COMPLETED 41s]', color: 'text-emerald-400' },
    { text: '   ├─ [Worker 3] Write Vitest Regression & Edge Suite       (lyra/task-w3) [COMPLETED 28s]', color: 'text-emerald-400' },
    { text: '   └─ [Worker 4] Wire Fastify Route Controllers             (lyra/task-w4) [COMPLETED 39s]', color: 'text-emerald-400' },
    { text: '👁️ Headless Playwright Visual Critic: 0 console errors • 94/100 UI score', color: 'text-cyan-400' },
    { text: '🧪 Verification: tsc --noEmit (0 errors) • 18/18 unit tests passed', color: 'text-emerald-400 font-medium' },
    { text: '🎉 Fast-forward merged into integration branch in 2m 14s total ($0.04 AWS cost)', color: 'text-white font-semibold' },
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setTerminalLineIndex((prev) => (prev < terminalLines.length ? prev + 1 : prev));
    }, 380);
    return () => clearInterval(timer);
  }, []);

  const resetTerminal = () => {
    setTerminalLineIndex(0);
  };

  const copyCommand = (cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  return (
    <div className="space-y-24 py-8">
      
      {/* HERO SECTION */}
      <section className="text-center max-w-4xl mx-auto space-y-6 pt-6 sm:pt-10">
        
        {/* Minimalist Pill */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900/80 border border-zinc-800 text-xs font-mono text-zinc-300 shadow-sm">
          <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
          <span>AWS Bedrock Autonomous Swarm</span>
          <span className="text-zinc-700">•</span>
          <span className="text-emerald-400 font-medium">~$0.02 - $0.11 / Task</span>
        </div>

        {/* Main Headline */}
        <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-white leading-[1.12]">
          The Cloud Swarm for{' '}
          <span className="bg-gradient-to-r from-zinc-100 via-indigo-200 to-indigo-400 bg-clip-text text-transparent">
            Deep Engineering.
          </span>
        </h1>

        {/* Subtitle */}
        <p className="text-base sm:text-lg text-zinc-400 max-w-2xl mx-auto leading-relaxed">
          Stop babysitting single-file IDE agents as they drift. Offload multi-file features, deep test suites, and refactors to an isolated cloud swarm on AWS Bedrock—while your laptop stays silent and your working tree stays clean.
        </p>

        {/* Primary CTA Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <Link
            to="/onboarding"
            className="w-full sm:w-auto px-5 py-2.5 rounded-lg font-medium text-sm bg-white text-zinc-950 hover:bg-zinc-200 shadow-sm transition-all flex items-center justify-center gap-2"
          >
            <span>Install VS Code Extension</span>
            <ArrowRight className="h-4 w-4" />
          </Link>

          <Link
            to="/simulator"
            className="w-full sm:w-auto px-5 py-2.5 rounded-lg font-medium text-sm bg-zinc-900/80 border border-zinc-800 text-zinc-200 hover:text-white hover:border-zinc-700 hover:bg-zinc-800/80 transition-all flex items-center justify-center gap-2 shadow-sm"
          >
            <Layers className="h-4 w-4 text-zinc-400" />
            <span>Launch Canvas 2.0 Simulator</span>
          </Link>
        </div>

        {/* 1-Line Quick CLI Snippet */}
        <div className="pt-2 flex items-center justify-center">
          <div className="flex items-center gap-2.5 px-3.5 py-1.5 rounded-lg bg-zinc-900/90 border border-zinc-800 text-xs font-mono text-zinc-300">
            <span className="text-indigo-400">$</span>
            <span>bun run dispatch "Add OAuth and Stripe webhook"</span>
            <button
              onClick={() => copyCommand('bun run dispatch "Add OAuth and Stripe webhook"')}
              className="text-zinc-500 hover:text-zinc-200 transition-colors ml-1"
              title="Copy command"
            >
              {copiedCmd ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </section>

      {/* LIVE INTERACTIVE TERMINAL HUD */}
      <section className="max-w-4xl mx-auto">
        <div className="rounded-xl bg-[#0c0d12] border border-zinc-800/80 shadow-2xl overflow-hidden">
          
          {/* Terminal Window Header Bar */}
          <div className="px-4 py-2.5 bg-zinc-950/80 border-b border-zinc-800/80 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-zinc-700 inline-block"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-zinc-700 inline-block"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-zinc-700 inline-block"></span>
              </div>
              <div className="flex items-center gap-1 bg-zinc-900/80 p-0.5 rounded border border-zinc-800/60 text-[11px] font-mono">
                <button
                  onClick={() => setActiveTab('stream')}
                  className={`px-2 py-0.5 rounded ${activeTab === 'stream' ? 'bg-zinc-800 text-white font-medium' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                  Live Run
                </button>
                <button
                  onClick={() => setActiveTab('worktrees')}
                  className={`px-2 py-0.5 rounded ${activeTab === 'worktrees' ? 'bg-zinc-800 text-white font-medium' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                  Worktrees (4)
                </button>
                <button
                  onClick={() => setActiveTab('finops')}
                  className={`px-2 py-0.5 rounded ${activeTab === 'finops' ? 'bg-zinc-800 text-white font-medium' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                  Bedrock FinOps
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={resetTerminal}
                className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 text-xs flex items-center gap-1 font-mono transition-colors"
                title="Replay stream"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Replay</span>
              </button>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800/80 text-zinc-300 border border-zinc-700/60">
                Pareto: Qwen 2.5 + Claude 3.5
              </span>
            </div>
          </div>

          {/* Terminal Body */}
          <div className="p-5 font-mono text-xs leading-relaxed min-h-[300px] overflow-x-auto space-y-1.5 text-zinc-300">
            {activeTab === 'stream' && (
              <>
                {terminalLines.slice(0, terminalLineIndex).map((line, idx) => (
                  <div key={idx} className={`${line.color} transition-opacity duration-150`}>
                    {line.text}
                  </div>
                ))}
                {terminalLineIndex < terminalLines.length && (
                  <span className="inline-block w-2 h-4 bg-indigo-400 animate-pulse ml-1 align-middle"></span>
                )}
              </>
            )}

            {activeTab === 'worktrees' && (
              <div className="space-y-3 py-2 text-zinc-300">
                <div className="text-zinc-400">// Isolated Git Worktrees created in parallel without branch collision:</div>
                <div className="p-2.5 rounded bg-zinc-900/60 border border-zinc-800/80 flex items-center justify-between">
                  <div>
                    <div className="text-white font-medium">lyra/task-w1 • Auth Models & Middleware</div>
                    <div className="text-[11px] text-zinc-500">models/user.ts, middleware/auth.ts (+142, -0)</div>
                  </div>
                  <span className="text-emerald-400 font-mono text-[11px]">VERIFIED (0 errors)</span>
                </div>
                <div className="p-2.5 rounded bg-zinc-900/60 border border-zinc-800/80 flex items-center justify-between">
                  <div>
                    <div className="text-white font-medium">lyra/task-w2 • Stripe Webhook Handler</div>
                    <div className="text-[11px] text-zinc-500">routes/webhooks/stripe.ts, services/billing.ts (+210, -4)</div>
                  </div>
                  <span className="text-emerald-400 font-mono text-[11px]">VERIFIED (0 errors)</span>
                </div>
                <div className="p-2.5 rounded bg-zinc-900/60 border border-zinc-800/80 flex items-center justify-between">
                  <div>
                    <div className="text-white font-medium">lyra/task-w3 • Vitest Regression Suite</div>
                    <div className="text-[11px] text-zinc-500">tests/auth.test.ts, tests/stripe.test.ts (+388, -0)</div>
                  </div>
                  <span className="text-emerald-400 font-mono text-[11px]">18/18 PASS</span>
                </div>
              </div>
            )}

            {activeTab === 'finops' && (
              <div className="space-y-3 py-2 text-zinc-300">
                <div className="text-zinc-400">// AWS Bedrock Pareto Router Cost Breakdown:</div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 rounded bg-zinc-900/60 border border-zinc-800/80">
                    <div className="text-[11px] text-zinc-500 uppercase tracking-wider">Worker Inferences</div>
                    <div className="text-lg font-semibold text-white mt-1">11,420 tokens</div>
                    <div className="text-[11px] text-emerald-400 mt-0.5">$0.028 (Qwen 2.5 Coder)</div>
                  </div>
                  <div className="p-3 rounded bg-zinc-900/60 border border-zinc-800/80">
                    <div className="text-[11px] text-zinc-500 uppercase tracking-wider">Visual Critic</div>
                    <div className="text-lg font-semibold text-white mt-1">2 screenshots</div>
                    <div className="text-[11px] text-emerald-400 mt-0.5">$0.012 (Claude 3.5 Sonnet)</div>
                  </div>
                  <div className="p-3 rounded bg-zinc-900/60 border border-zinc-800/80">
                    <div className="text-[11px] text-zinc-500 uppercase tracking-wider">Total Run Cost</div>
                    <div className="text-lg font-semibold text-emerald-400 mt-1">$0.040</div>
                    <div className="text-[11px] text-zinc-500 mt-0.5">Scale-to-Zero ($0.00 idle)</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Terminal Footer HUD */}
          <div className="px-5 py-2.5 bg-zinc-950/90 border-t border-zinc-800/80 flex flex-wrap items-center justify-between text-xs font-mono text-zinc-400 gap-2">
            <div className="flex items-center gap-4">
              <span>Duration: <strong className="text-zinc-200">2m 14s</strong></span>
              <span>Tokens: <strong className="text-zinc-200">11,420</strong></span>
              <span>Cost: <strong className="text-emerald-400">$0.04</strong></span>
            </div>
            <div className="flex items-center gap-1.5 text-emerald-400">
              <Check className="h-3.5 w-3.5" />
              <span>Zero Local CPU Footprint</span>
            </div>
          </div>
        </div>
      </section>

      {/* THE CORE METAPHOR: POWER TOOL VS CNC MACHINE */}
      <section className="max-w-5xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            The Fundamental Shift: Power Tool vs. CNC Machine
          </h2>
          <p className="text-sm text-zinc-400 max-w-2xl mx-auto">
            Why high-output engineering teams combine interactive pair-programming IDE agents with an autonomous cloud swarm.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Local IDE Agent Card */}
          <div className="rounded-xl p-6 space-y-4 border border-zinc-800/80 bg-zinc-900/40 relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-zinc-400 uppercase tracking-wider font-medium">The Interactive Hand Tool</span>
              <span className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">Cursor / Copilot</span>
            </div>
            <h3 className="text-lg font-semibold text-white">Manual, Synchronous Pair Programming</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Superb for in-the-moment single-file completions and active guidance. But fragile when handed a 40-file refactor or full module scaffold:
            </p>
            <ul className="space-y-2 text-xs text-zinc-400 font-medium">
              <li className="flex items-start gap-2">
                <span className="text-zinc-500 font-bold">✕</span>
                <span><strong className="text-zinc-300">Context Drift:</strong> Degrades on complex 10+ turn tasks as token context fills up.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-zinc-500 font-bold">✕</span>
                <span><strong className="text-zinc-300">Laptop Heat & Battery:</strong> Keeps your machine hot and fans spinning for 30 minutes.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-zinc-500 font-bold">✕</span>
                <span><strong className="text-zinc-300">Dirty Branch Pollution:</strong> Edits directly in your working directory, causing stash conflicts.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-zinc-500 font-bold">✕</span>
                <span><strong className="text-zinc-300">Session Fragility:</strong> Close your laptop lid or disconnect Wi-Fi, and the task aborts.</span>
              </li>
            </ul>
          </div>

          {/* Lyra Cloud Swarm Card */}
          <div className="rounded-xl p-6 space-y-4 border border-indigo-500/30 bg-zinc-900/60 relative overflow-hidden shadow-lg shadow-indigo-950/20">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-indigo-400 uppercase tracking-wider font-medium">The Heavy Cloud CNC</span>
              <span className="text-[11px] px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono">Lyra Cloud Swarm</span>
            </div>
            <h3 className="text-lg font-semibold text-white">Autonomous, Multi-Agent Cloud Execution</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Designed for asynchronous deep engineering tasks that require planning, testing, and isolated execution:
            </p>
            <ul className="space-y-2 text-xs text-zinc-400 font-medium">
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 font-bold">✓</span>
                <span><strong className="text-zinc-200">Dynamic Work-Stealing:</strong> Breaks tasks into clean dependency graphs across parallel workers.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 font-bold">✓</span>
                <span><strong className="text-zinc-200">Zero Local Resources:</strong> 100% offloaded to AWS Bedrock; laptop fans stay completely stopped.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 font-bold">✓</span>
                <span><strong className="text-zinc-200">Isolated Git Worktrees:</strong> Workers operate in background branches; your active code is never touched.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 font-bold">✓</span>
                <span><strong className="text-zinc-200">Lid-Close Indestructibility:</strong> Dispatch from Wi-Fi, close the lid, and pick up verified code on Coder.</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="text-center pt-1">
          <Link
            to="/comparison"
            className="text-xs font-mono text-zinc-400 hover:text-white transition-colors inline-flex items-center gap-1.5"
          >
            <span>View Full Interactive Comparison Matrix</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </section>

      {/* CORE CAPABILITIES GRID */}
      <section className="max-w-5xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            Engineered for High-Trust Developer Workflows
          </h2>
          <p className="text-sm text-zinc-400 max-w-2xl mx-auto">
            Everything you need to orchestrate autonomous AI swarms with enterprise safety and complete cost control.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          
          <Link to="/simulator" className="rounded-xl p-5 space-y-3 bg-zinc-900/40 border border-zinc-800/80 hover:border-zinc-700 hover:bg-zinc-900/70 transition-all group">
            <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700/60 flex items-center justify-center text-zinc-300 group-hover:text-white transition-colors">
              <Layers className="h-4 w-4" />
            </div>
            <h3 className="text-sm font-semibold text-white group-hover:text-indigo-400 transition-colors">
              Canvas 2.0 Swarm Engine
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Interactive HTML5 Canvas particle simulation modeling multi-agent communication, tool telemetry, and DAG lifecycle states in real-time.
            </p>
            <div className="text-xs font-mono text-zinc-400 group-hover:text-indigo-400 flex items-center gap-1 pt-1 transition-colors">
              <span>Launch Simulator</span>
              <ArrowRight className="h-3 w-3" />
            </div>
          </Link>

          <Link to="/pat-generator" className="rounded-xl p-5 space-y-3 bg-zinc-900/40 border border-zinc-800/80 hover:border-zinc-700 hover:bg-zinc-900/70 transition-all group">
            <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700/60 flex items-center justify-center text-zinc-300 group-hover:text-white transition-colors">
              <Key className="h-4 w-4" />
            </div>
            <h3 className="text-sm font-semibold text-white group-hover:text-indigo-400 transition-colors">
              Personal Access Tokens (PAT)
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Generate secure 30-day bearer tokens with granular permission scopes to authenticate your VS Code extension, Coder cloud IDE, or terminal scripts.
            </p>
            <div className="text-xs font-mono text-zinc-400 group-hover:text-indigo-400 flex items-center gap-1 pt-1 transition-colors">
              <span>Generate PAT Token</span>
              <ArrowRight className="h-3 w-3" />
            </div>
          </Link>

          <Link to="/onboarding" className="rounded-xl p-5 space-y-3 bg-zinc-900/40 border border-zinc-800/80 hover:border-zinc-700 hover:bg-zinc-900/70 transition-all group">
            <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700/60 flex items-center justify-center text-zinc-300 group-hover:text-white transition-colors">
              <Terminal className="h-4 w-4" />
            </div>
            <h3 className="text-sm font-semibold text-white group-hover:text-indigo-400 transition-colors">
              VS Code & Coder Setup
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              5-step guided installation wizard with one-click `.vsix` download, Activity Bar cockpit integration, and cloud workspace presets.
            </p>
            <div className="text-xs font-mono text-zinc-400 group-hover:text-indigo-400 flex items-center gap-1 pt-1 transition-colors">
              <span>Open Setup Guide</span>
              <ArrowRight className="h-3 w-3" />
            </div>
          </Link>

        </div>
      </section>

    </div>
  );
};

export default Home;
