import React, { useState } from 'react';
import { 
  Key, 
  Copy, 
  Check, 
  Eye, 
  EyeOff, 
  ShieldCheck, 
  Clock, 
  Sparkles 
} from 'lucide-react';

const PatGenerator: React.FC = () => {
  const [tokenName, setTokenName] = useState('My Laptop VS Code');
  const [token, setToken] = useState('');
  const [copied, setCopied] = useState(false);
  const [showToken, setShowToken] = useState(true);
  const [scopes, setScopes] = useState({
    dispatch: true,
    worktree: true,
    telemetry: true,
    admin: false,
  });
  const [expiry, setExpiry] = useState('30');

  const generateToken = () => {
    const chars = '0123456789abcdef';
    let hex = '';
    for (let i = 0; i < 48; i++) {
      hex += chars[Math.floor(Math.random() * chars.length)];
    }
    const generated = `lyra-pat-${hex}`;
    setToken(generated);
    setCopied(false);
    setShowToken(true);
  };

  const copyToClipboard = () => {
    if (!token) return;
    navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 py-4">
      
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-xs font-mono text-purple-300">
          <Key className="h-3.5 w-3.5 text-purple-400" />
          <span>Personal Access Token (PAT) Portal</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          API & Swarm Authentication
        </h1>
        <p className="text-sm text-slate-400 max-w-xl mx-auto">
          Generate secure tokens to authenticate your VS Code extension, Coder cloud workspaces, or CI/CD pipelines against the Lyra Cloud Swarm.
        </p>
      </div>

      {/* Main Generator Card */}
      <div className="glass-panel rounded-2xl shimmer-border p-6 sm:p-8 space-y-6 shadow-2xl">
        
        {/* Token Label Input */}
        <div className="space-y-2">
          <label className="text-xs font-mono uppercase text-slate-300 font-semibold block">
            Token Description / Client Label
          </label>
          <input
            type="text"
            value={tokenName}
            onChange={(e) => setTokenName(e.target.value)}
            placeholder="e.g., MacBook Pro VS Code, Coder Server, GitHub Actions"
            className="w-full px-4 py-2.5 rounded-xl bg-slate-900/90 border border-white/[0.1] text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/60 font-mono"
          />
        </div>

        {/* Expiration & Scopes */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          
          <div className="space-y-3">
            <label className="text-xs font-mono uppercase text-slate-300 font-semibold flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-indigo-400" />
              <span>Token Validity & Expiration</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { val: '7', label: '7 Days' },
                { val: '30', label: '30 Days' },
                { val: '90', label: '90 Days' },
              ].map((exp) => (
                <button
                  key={exp.val}
                  type="button"
                  onClick={() => setExpiry(exp.val)}
                  className={`py-2 px-3 rounded-xl text-xs font-mono transition-all ${
                    expiry === exp.val
                      ? 'bg-indigo-600 text-white border border-indigo-500/50 shadow-md'
                      : 'bg-slate-900/60 text-slate-400 border border-white/[0.06] hover:text-white'
                  }`}
                >
                  {exp.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-xs font-mono uppercase text-slate-300 font-semibold flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-indigo-400" />
              <span>Permission Scopes</span>
            </label>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              {[
                { key: 'dispatch', label: 'swarm:dispatch', desc: 'Trigger tasks' },
                { key: 'worktree', label: 'worktree:merge', desc: 'Auto-merges' },
                { key: 'telemetry', label: 'finops:metrics', desc: 'Token logs' },
                { key: 'admin', label: 'gateway:admin', desc: 'Cluster control' },
              ].map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setScopes({ ...scopes, [s.key]: !scopes[s.key as keyof typeof scopes] })}
                  className={`p-2.5 rounded-xl border text-left transition-all ${
                    scopes[s.key as keyof typeof scopes]
                      ? 'bg-indigo-950/40 border-indigo-500/40 text-indigo-200'
                      : 'bg-slate-900/40 border-white/[0.06] text-slate-500'
                  }`}
                >
                  <div className="font-semibold">{s.label}</div>
                  <div className="text-[10px] text-slate-400">{s.desc}</div>
                </button>
              ))}
            </div>
          </div>

        </div>

        {/* Generate Button */}
        <div className="pt-4">
          <button
            onClick={generateToken}
            className="w-full py-3.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-indigo-500 via-purple-600 to-indigo-600 text-white shadow-xl shadow-indigo-500/25 hover:shadow-indigo-500/40 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2"
          >
            <Sparkles className="h-4 w-4" />
            <span>Generate New Personal Access Token</span>
          </button>
        </div>

        {/* Generated Token Result Display */}
        {token && (
          <div className="pt-4 border-t border-white/[0.08] space-y-4 animate-fade-in">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase text-emerald-400 font-semibold flex items-center gap-1.5">
                <Check className="h-4 w-4" />
                <span>Token Ready — Copy Immediately</span>
              </span>
              <button
                onClick={() => setShowToken(!showToken)}
                className="text-xs font-mono text-slate-400 hover:text-white flex items-center gap-1"
              >
                {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                <span>{showToken ? 'Hide' : 'Reveal'}</span>
              </button>
            </div>

            <div className="p-4 rounded-xl bg-[#06080E] border border-indigo-500/40 flex items-center justify-between gap-4 shadow-lg shadow-indigo-500/10 font-mono text-xs sm:text-sm">
              <div className="overflow-x-auto text-indigo-300 font-semibold select-all">
                {showToken ? token : '•'.repeat(token.length)}
              </div>
              <button
                onClick={copyToClipboard}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-all shrink-0"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copied ? 'Copied!' : 'Copy'}</span>
              </button>
            </div>

            {/* Usage Instructions */}
            <div className="p-4 rounded-xl bg-slate-900/80 border border-white/[0.06] space-y-2 text-xs font-mono text-slate-300">
              <div className="text-slate-400 font-semibold uppercase text-[10px]">How to use in VS Code or Coder:</div>
              <ol className="list-decimal list-inside space-y-1 text-slate-300">
                <li>Press <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700">Cmd+Shift+P</kbd> in VS Code.</li>
                <li>Type <span className="text-indigo-400">"Lyra: Sign In"</span> and press Enter.</li>
                <li>Paste this token when prompted. Your IDE is now permanently connected.</li>
              </ol>
            </div>
          </div>
        )}

      </div>

    </div>
  );
};

export default PatGenerator;
