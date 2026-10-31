import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  Terminal, 
  Layers, 
  Key, 
  ArrowRight, 
  Zap, 
  Check, 
  Copy, 
  RotateCcw 
} from 'lucide-react';

const Home: React.FC = () => {
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [terminalLineIndex, setTerminalLineIndex] = useState(0);

  const terminalLines = [
    { text: '$ bun run dispatch "Scaffold OAuth2 & Stripe Webhook with tests"', color: 'text-indigo-400 font-bold' },
    { text: '🌿 Pre-flight git check: commit 8feb2e9 verified (working tree clean)', color: 'text-slate-400' },
    { text: '🧠 Pareto Router: Selected Qwen3 Coder 480B (Est. $0.04 | 96/100 code benchmark)', color: 'text-cyan-400' },
    { text: '⚡ Lead Architect: 49 inspections complete. Decomposed objective into 4 parallel tasks.', color: 'text-purple-400' },
    { text: '📦 Spawning isolated git worktrees on Bedrock:', color: 'text-slate-300' },
    { text: '   ├─ [Worker 1] Scaffold Auth Models & JWT Middleware     (lyra/task-w1) [COMPLETED]', color: 'text-emerald-400' },
    { text: '   ├─ [Worker 2] Implement Stripe Webhook & Signature      (lyra/task-w2) [COMPLETED]', color: 'text-emerald-400' },
    { text: '   ├─ [Worker 3] Write Vitest Regression & Edge Suite       (lyra/task-w3) [COMPLETED]', color: 'text-emerald-400' },
    { text: '   └─ [Worker 4] Wire Fastify Route Controllers             (lyra/task-w4) [COMPLETED]', color: 'text-emerald-400' },
    { text: '🧪 Verification: tsc --noEmit (0 errors) • 18/18 unit tests passed', color: 'text-emerald-400 font-semibold' },
    { text: '🎉 Successfully merged into integration branch: lyra/integration-feat-auth-stripe', color: 'text-indigo-300 font-bold' },
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setTerminalLineIndex((prev) => (prev < terminalLines.length ? prev + 1 : prev));
    }, 450);
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
    <div className="space-y-24 py-6">
      
      {/* HERO SECTION */}
      <section className="text-center max-w-4xl mx-auto space-y-6 pt-4 sm:pt-8">
        
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full glass-panel border border-indigo-500/30 text-xs font-mono text-indigo-300 shadow-lg shadow-indigo-500/10">
          <Zap className="h-3.5 w-3.5 text-indigo-400" />
          <span>AWS Bedrock Autonomous Swarm</span>
          <span className="text-indigo-500">•</span>
          <span className="text-emerald-400 font-semibold">~$0.02 - $0.11 / Feature</span>
        </div>

        {/* Main Headline */}
        <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight leading-[1.15] text-white">
          The Background Autonomous Swarm for{' '}
          <span className="bg-gradient-to-r from-indigo-400 via-purple-300 to-cyan-400 bg-clip-text text-transparent">
            Deep Engineering.
          </span>
        </h1>

        {/* Subtitle */}
        <p className="text-base sm:text-lg text-slate-300 max-w-2xl mx-auto leading-relaxed">
          Stop babysitting single-prompt IDE agents as they drift. Offload 30-minute multi-file tasks, deep test suites, and refactors to an isolated cloud swarm on AWS Bedrock—while your laptop stays silent and your working branch stays clean.
        </p>

        {/* Primary CTA Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
          <Link
            to="/onboarding"
            className="w-full sm:w-auto px-6 py-3.5 rounded-xl font-semibold text-sm bg-gradient-to-r from-indigo-500 via-indigo-600 to-purple-600 text-white shadow-xl shadow-indigo-500/25 hover:shadow-indigo-500/40 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
          >
            <span>Install VS Code Extension</span>
            <ArrowRight className="h-4 w-4" />
          </Link>

          <Link
            to="/simulator"
            className="w-full sm:w-auto px-6 py-3.5 rounded-xl font-semibold text-sm glass-panel text-slate-200 hover:text-white hover:bg-slate-800/80 hover:border-indigo-500/40 transition-all flex items-center justify-center gap-2"
          >
            <Layers className="h-4 w-4 text-indigo-400" />
            <span>Launch Canvas 2.0 Simulator</span>
          </Link>
        </div>

        {/* 1-Line Quick CLI Snippet */}
        <div className="pt-4 flex items-center justify-center">
          <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-slate-900/90 border border-white/[0.08] text-xs font-mono text-slate-300">
            <span className="text-indigo-400">$</span>
            <span>bun run dispatch "Add OAuth and Stripe webhook"</span>
            <button
              onClick={() => copyCommand('bun run dispatch "Add OAuth and Stripe webhook"')}
              className="text-slate-500 hover:text-slate-200 transition-colors ml-2"
              title="Copy command"
            >
              {copiedCmd ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </section>

      {/* LIVE INTERACTIVE TERMINAL HUD */}
      <section className="max-w-4xl mx-auto">
        <div className="rounded-2xl glass-panel shimmer-border shadow-2xl overflow-hidden">
          
          {/* Terminal Window Header Bar */}
          <div className="px-4 py-3 bg-slate-950/80 border-b border-white/[0.08] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-rose-500/80 inline-block"></span>
              <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block"></span>
              <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block"></span>
              <span className="ml-2 text-xs font-mono text-slate-400 font-medium">lyra-cloud-runner — ephemeral AWS task</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={resetTerminal}
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 text-xs flex items-center gap-1 font-mono"
                title="Replay stream"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Replay</span>
              </button>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                Pareto: Qwen 480B
              </span>
            </div>
          </div>

          {/* Terminal Body */}
          <div className="p-6 bg-[#06080E] font-mono text-xs sm:text-[13px] leading-relaxed min-h-[320px] overflow-x-auto space-y-1.5">
            {terminalLines.slice(0, terminalLineIndex).map((line, idx) => (
              <div key={idx} className={`${line.color} animate-fade-in`}>
                {line.text}
              </div>
            ))}
            {terminalLineIndex < terminalLines.length && (
              <span className="inline-block w-2 h-4 bg-indigo-400 animate-pulse ml-1 align-middle"></span>
            )}
          </div>

          {/* Terminal Footer HUD */}
          <div className="px-6 py-2.5 bg-slate-950/90 border-t border-white/[0.06] flex flex-wrap items-center justify-between text-xs font-mono text-slate-400 gap-2">
            <div className="flex items-center gap-4">
              <span>Duration: <strong className="text-slate-200">42s</strong></span>
              <span>Tokens: <strong className="text-slate-200">11,250</strong></span>
              <span>Cost: <strong className="text-emerald-400">$0.04</strong></span>
            </div>
            <div className="flex items-center gap-1 text-emerald-400">
              <Check className="h-3.5 w-3.5" />
              <span>Zero Local CPU Footprint</span>
            </div>
          </div>
        </div>
      </section>

      {/* THE CORE METAPHOR: POWER TOOL VS CNC MACHINE */}
      <section className="max-w-6xl mx-auto space-y-10">
        <div className="text-center space-y-3">
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            The Fundamental Shift: Power Tool vs. CNC Machine
          </h2>
          <p className="text-sm sm:text-base text-slate-400 max-w-2xl mx-auto">
            Why you need an autonomous cloud swarm alongside your interactive pair-programming IDE agents.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          
          {/* Local IDE Agent Card */}
          <div className="glass-panel rounded-2xl p-6 sm:p-8 space-y-5 border border-rose-500/20 bg-rose-950/10 relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-rose-400 uppercase tracking-wider font-semibold">The Interactive Hand Tool</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 font-mono">Cursor / Copilot</span>
            </div>
            <h3 className="text-xl font-bold text-white">Manual, Synchronous Pair Programming</h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              Superb for in-the-moment single-file completions and active guidance. But try giving it a 40-file refactor or full module scaffold:
            </p>
            <ul className="space-y-2.5 text-xs text-slate-400 font-medium">
              <li className="flex items-start gap-2">
                <span className="text-rose-400 font-bold">✕</span>
                <span><strong>Context Drift:</strong> Degrades on complex 10+ turn tasks as token context fills up.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-rose-400 font-bold">✕</span>
                <span><strong>Laptop Heat & Battery:</strong> Keeps your machine hot and fans spinning for 30 minutes.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-rose-400 font-bold">✕</span>
                <span><strong>Dirty Branch Pollution:</strong> Edits directly in your working directory, causing stash conflicts.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-rose-400 font-bold">✕</span>
                <span><strong>Session Fragility:</strong> Close your laptop lid or disconnect Wi-Fi, and the task aborts.</span>
              </li>
            </ul>
          </div>

          {/* Lyra Cloud Swarm Card */}
          <div className="glass-panel rounded-2xl p-6 sm:p-8 space-y-5 border border-indigo-500/30 bg-indigo-950/10 relative overflow-hidden shadow-xl shadow-indigo-500/10">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-indigo-400 uppercase tracking-wider font-semibold">The Heavy Cloud CNC</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-mono">Lyra Cloud Swarm</span>
            </div>
            <h3 className="text-xl font-bold text-white">Autonomous, Multi-Agent Cloud Execution</h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              Designed for asynchronous deep engineering tasks that require planning, testing, and isolated execution:
            </p>
            <ul className="space-y-2.5 text-xs text-slate-300 font-medium">
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 font-bold">✓</span>
                <span><strong>DAG Decomposition:</strong> Breaks tasks into clean dependency graphs across 4 parallel workers.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 font-bold">✓</span>
                <span><strong>Zero Local Resources:</strong> 100% offloaded to AWS Bedrock; laptop fans stay completely stopped.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 font-bold">✓</span>
                <span><strong>Isolated Git Worktrees:</strong> Workers operate in background branches; your active code is never touched.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 font-bold">✓</span>
                <span><strong>Lid-Close Indestructibility:</strong> Dispatch from Wi-Fi, close the lid, and pick up verified code on Coder.</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="text-center pt-2">
          <Link
            to="/comparison"
            className="text-xs font-mono text-indigo-400 hover:text-indigo-300 transition-colors inline-flex items-center gap-1.5"
          >
            <span>View Full Interactive Comparison Matrix</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </section>

      {/* CORE CAPABILITIES GRID */}
      <section className="max-w-6xl mx-auto space-y-10">
        <div className="text-center space-y-3">
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            Engineered for High-Trust Developer Workflows
          </h2>
          <p className="text-sm sm:text-base text-slate-400 max-w-2xl mx-auto">
            Everything you need to orchestrate autonomous AI swarms with enterprise safety and complete cost control.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          <Link to="/simulator" className="glass-panel glass-panel-hover rounded-2xl p-6 space-y-4 group transition-all">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center text-indigo-400 group-hover:bg-indigo-500 group-hover:text-white transition-all">
              <Layers className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-bold text-white group-hover:text-indigo-400 transition-colors">
              Canvas 2.0 Swarm Engine
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Interactive HTML5 Canvas particle simulation modeling multi-agent communication, tool telemetry, and DAG lifecycle states in real-time.
            </p>
            <div className="text-xs font-mono text-indigo-400 flex items-center gap-1 pt-2">
              <span>Launch Simulator</span>
              <ArrowRight className="h-3 w-3" />
            </div>
          </Link>

          <Link to="/pat-generator" className="glass-panel glass-panel-hover rounded-2xl p-6 space-y-4 group transition-all">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center text-purple-400 group-hover:bg-purple-500 group-hover:text-white transition-all">
              <Key className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-bold text-white group-hover:text-purple-400 transition-colors">
              Personal Access Tokens (PAT)
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Generate secure 30-day bearer tokens with granular permission scopes to authenticate your VS Code extension, Coder cloud IDE, or terminal scripts.
            </p>
            <div className="text-xs font-mono text-purple-400 flex items-center gap-1 pt-2">
              <span>Generate PAT Token</span>
              <ArrowRight className="h-3 w-3" />
            </div>
          </Link>

          <Link to="/onboarding" className="glass-panel glass-panel-hover rounded-2xl p-6 space-y-4 group transition-all">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center text-cyan-400 group-hover:bg-cyan-500 group-hover:text-white transition-all">
              <Terminal className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-bold text-white group-hover:text-cyan-400 transition-colors">
              VS Code & Coder Setup
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              5-step guided installation wizard with one-click `.vsix` download, Activity Bar cockpit integration, and cloud workspace presets.
            </p>
            <div className="text-xs font-mono text-cyan-400 flex items-center gap-1 pt-2">
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
