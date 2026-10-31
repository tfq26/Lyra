import React, { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { 
  Zap, 
  Cpu,
  Key,
  Terminal,
  GitBranch, 
  Layers, 
  CheckCircle2, 
  ExternalLink,
  Menu, 
  X 
} from 'lucide-react';

const Layout: React.FC = () => {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    { path: '/', label: 'Overview', icon: Zap },
    { path: '/simulator', label: 'Canvas 2.0 Simulator', icon: Layers },
    { path: '/comparison', label: 'Power Tool vs CNC', icon: Cpu },
    { path: '/pat-generator', label: 'PAT Portal', icon: Key },
    { path: '/onboarding', label: 'VS Code & Coder', icon: Terminal },
  ];

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col relative cyber-grid">
      <div className="ambient-glow" />

      {/* Top Micro-Bar: FinOps / Architecture 1 Status */}
      <div className="border-b border-zinc-800/60 bg-zinc-950/60 backdrop-blur-md relative z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-1.5 flex items-center justify-between text-[11px] font-mono text-zinc-400">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="font-medium text-zinc-300">Architecture 1 Active:</span>
            <span className="text-zinc-400">Zero-Daemon Ephemeral Cloud Runner</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-emerald-400/90 font-medium">Scale-to-Zero ($0.00 idle)</span>
            <span className="hidden sm:inline text-zinc-700">•</span>
            <span className="hidden sm:inline text-zinc-500">AWS Bedrock Managed Swarm</span>
          </div>
        </div>
      </div>

      {/* Main Navigation Header */}
      <header className="sticky top-0 z-50 bg-[#09090b]/80 border-b border-zinc-800/60 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          
          {/* Logo & Cluster Pill */}
          <div className="flex items-center gap-4">
            <Link to="/" className="flex items-center gap-2.5 group">
              <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-700/80 flex items-center justify-center shadow-sm group-hover:border-zinc-500 transition-colors">
                <GitBranch className="h-4 w-4 text-zinc-200 transform -rotate-45" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold tracking-tight text-white flex items-center gap-1.5">
                  Lyra
                  <span className="text-[10px] font-mono font-normal px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/50">v2.0</span>
                </span>
              </div>
            </Link>

            <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-zinc-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              <span>Bedrock: Qwen 2.5 Coder / Claude 3.5 Sonnet</span>
            </div>
          </div>

          {/* Desktop Navigation Links */}
          <nav className="hidden md:flex items-center gap-1 bg-zinc-900/60 p-1 rounded-lg border border-zinc-800/80">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-2 px-3 py-1 rounded-md text-xs font-medium transition-all duration-150 ${
                    isActive
                      ? 'bg-zinc-800 text-white shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                  }`}
                >
                  <Icon className={`h-3.5 w-3.5 ${isActive ? 'text-indigo-400' : 'text-zinc-500'}`} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Action CTAs */}
          <div className="flex items-center gap-2.5">
            <Link
              to="/onboarding"
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white text-zinc-950 hover:bg-zinc-200 transition-colors shadow-sm"
            >
              <span>VS Code Extension</span>
              <ExternalLink className="h-3 w-3" />
            </Link>

            {/* Mobile menu toggle */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Dropdown Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden px-4 pt-2 pb-4 space-y-1 bg-[#0A0D14] border-b border-white/[0.08]">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
                    isActive ? 'bg-indigo-600/30 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4 text-indigo-400" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        )}
      </header>

      {/* Main Outlet Container */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative z-10">
        <Outlet />
      </main>

      {/* High-Fidelity Developer Footer */}
      <footer className="border-t border-white/[0.08] bg-[#05070B] py-12 relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-10">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-indigo-500 flex items-center justify-center">
                  <GitBranch className="h-3.5 w-3.5 text-white" />
                </div>
                <span className="font-bold tracking-tight text-white">Lyra Swarm</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                The autonomous cloud CNC machine for deep multi-file software engineering on AWS Bedrock.
              </p>
              <div className="text-[11px] font-mono text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Zero Laptop Daemon Required</span>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300 font-mono mb-3">Interfaces</h4>
              <ul className="space-y-2 text-xs text-slate-400 font-medium">
                <li><Link to="/onboarding" className="hover:text-indigo-400 transition-colors">VS Code Extension (.vsix)</Link></li>
                <li><Link to="/onboarding" className="hover:text-indigo-400 transition-colors">Coder Browser IDE</Link></li>
                <li><Link to="/onboarding" className="hover:text-indigo-400 transition-colors">Lyra Ephemeral CLI (bun run dispatch)</Link></li>
                <li><a href="https://modelcontextprotocol.io" target="_blank" rel="noreferrer" className="hover:text-indigo-400 transition-colors">12-Tool MCP Stdio Server</a></li>
              </ul>
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300 font-mono mb-3">Intelligence & Safety</h4>
              <ul className="space-y-2 text-xs text-slate-400 font-medium">
                <li><Link to="/comparison" className="hover:text-indigo-400 transition-colors">Power Tool vs CNC Paradigm</Link></li>
                <li><Link to="/simulator" className="hover:text-indigo-400 transition-colors">Canvas 2.0 Swarm Engine</Link></li>
                <li><span className="text-slate-500">Pareto Multi-Objective Router</span></li>
                <li><span className="text-slate-500">Anti-Spawn Concurrency Lock (Max 4)</span></li>
              </ul>
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300 font-mono mb-3">FinOps Metrics</h4>
              <div className="p-3 rounded-xl bg-slate-900/80 border border-white/[0.06] space-y-1.5 text-xs font-mono">
                <div className="flex justify-between text-slate-400">
                  <span>Average Cost:</span>
                  <span className="text-emerald-400 font-semibold">$0.02 - $0.11</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Idle Cost:</span>
                  <span className="text-indigo-400 font-semibold">$0.00 (Fargate)</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Routing:</span>
                  <span className="text-slate-300">Qwen 480B / Nova</span>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-white/[0.06] flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-4">
            <p>© {new Date().getFullYear()} Lyra Autonomous Systems. Engineered with Google Antigravity & AWS Bedrock.</p>
            <div className="flex items-center gap-4 text-slate-400">
              <span className="font-mono text-[11px] text-indigo-400">v0.1.0-beta</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Layout;
