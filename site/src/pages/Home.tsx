import React, { useState, useEffect } from 'react';
import { Copy, Check, ArrowRight, Search } from 'lucide-react';
import { API_BASE_URL } from '../lib/auth-client';

interface BedrockModelEntry {
  name: string;
  id: string;
  inferenceProfileId?: string;
  provider: string;
  meta: string;
  role: string;
}

const DEFAULT_BEDROCK_MODELS: BedrockModelEntry[] = [
  {
    name: 'Claude Sonnet 5',
    id: 'anthropic.claude-sonnet-5',
    inferenceProfileId: 'us.anthropic.claude-sonnet-5',
    provider: 'Anthropic',
    meta: 'Tier 3 · Prompt Caching · 200k ctx',
    role: 'Frontier Software Implementation & Multi-File Editing',
  },
  {
    name: 'Claude Opus 5.5',
    id: 'anthropic.claude-opus-5-5',
    inferenceProfileId: 'us.anthropic.claude-opus-5-5',
    provider: 'Anthropic',
    meta: 'Tier 4 · Prompt Caching · 200k ctx',
    role: 'Deep Architectural Decomposition & Formal Reasoning',
  },
  {
    name: 'Claude Haiku 4.5',
    id: 'anthropic.claude-haiku-4-5-20251001-v1:0',
    inferenceProfileId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    provider: 'Anthropic',
    meta: 'Tier 1 · Sub-400ms TTFT · Prompt Caching',
    role: 'Instant Ask Q&A & Surgical Fast Patches',
  },
  {
    name: 'Amazon Nova 2 Lite',
    id: 'amazon.nova-2-lite-v1:0',
    inferenceProfileId: 'us.amazon.nova-2-lite-v1:0',
    provider: 'Amazon',
    meta: 'Tier 1 · $0.06/M Input · 300k ctx',
    role: 'Frugal Triage, Lint Repair & Scribe Synthesis',
  },
  {
    name: 'Amazon Nova Pro',
    id: 'us.amazon.nova-pro-v1:0',
    inferenceProfileId: 'us.amazon.nova-pro-v1:0',
    provider: 'Amazon',
    meta: 'Tier 2 · Multimodal · 300k ctx',
    role: 'Multimodal UI Inspection & High-Throughput Coding',
  },
  {
    name: 'Qwen3 Coder 480B Instruct',
    id: 'qwen.qwen3-coder-480b-a35b-v1:0',
    provider: 'Qwen',
    meta: 'Tier 3 · $1.20/M Input · 128k ctx',
    role: 'Cost-Effective Frontier Refactoring & TypeScript Specialist',
  },
  {
    name: 'DeepSeek-R1',
    id: 'us.deepseek.r1-v1:0',
    inferenceProfileId: 'us.deepseek.r1-v1:0',
    provider: 'DeepSeek',
    meta: 'Tier 4 · $0.55/M Input · Chain-of-Thought',
    role: 'Algorithmic Optimization & Concurrency Invariants',
  },
  {
    name: 'Llama 3.3 70B Instruct',
    id: 'us.meta.llama3-3-70b-instruct-v1:0',
    inferenceProfileId: 'us.meta.llama3-3-70b-instruct-v1:0',
    provider: 'Meta',
    meta: 'Tier 2 · $0.72/M Flat · 128k ctx',
    role: 'Open-Weights Worktree Worker & Code Review',
  },
];

const Home: React.FC = () => {
  const [copied, setCopied] = useState(false);
  const [activeCodeTab, setActiveCodeTab] = useState<'cli' | 'ahp'>('cli');
  const [selectedProvider, setSelectedProvider] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [models, setModels] = useState<BedrockModelEntry[]>(DEFAULT_BEDROCK_MODELS);
  const [catalogSource, setCatalogSource] = useState<string>('pareto-registry');

  const installCmd = 'code --install-extension lyra-swarm-1.3.0.vsix';

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/api/models/catalog`)
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (cancelled || !payload) return;
        const pareto = Array.isArray(payload.paretoCatalog) ? payload.paretoCatalog : [];
        const active = Array.isArray(payload.activeModels) ? payload.activeModels : [];

        const merged = new Map<string, BedrockModelEntry>();
        for (const p of pareto) {
          const ctxK = p.metrics?.contextWindowTokens ? `${Math.round(p.metrics.contextWindowTokens / 1000)}k ctx` : '128k ctx';
          const price = p.pricing?.inputPerMillion !== undefined ? `$${p.pricing.inputPerMillion}/M in` : '';
          const cache = p.supportsPromptCaching ? 'Prompt Caching' : '';
          const metaParts = [`Tier ${p.tier || 2}`, price, cache, ctxK].filter(Boolean);
          merged.set(p.id, {
            name: p.name,
            id: p.id,
            inferenceProfileId: p.inferenceProfileId,
            provider: p.provider,
            meta: metaParts.join(' · '),
            role: Array.isArray(p.strengths) && p.strengths.length > 0 ? p.strengths.slice(0, 2).join(' · ') : 'Autonomous Engineering',
          });
        }

        for (const a of active) {
          if (!a?.modelId) continue;
          const normalizedKey = String(a.modelId).replace(/^us\./, '');
          const alreadyHas = Array.from(merged.keys()).some((k) => k.replace(/^us\./, '') === normalizedKey);
          if (!alreadyHas) {
            const modalities = Array.isArray(a.inputModalities) ? a.inputModalities.join(', ') : 'TEXT';
            merged.set(a.modelId, {
              name: a.modelName || a.modelId,
              id: a.modelId,
              provider: a.providerName || 'Bedrock',
              meta: `Active · ${modalities}`,
              role: 'Active AWS Bedrock Foundation Model',
            });
          }
        }

        if (merged.size > 0) {
          setModels(Array.from(merged.values()));
          setCatalogSource(payload.source === 'aws-live' ? 'aws-bedrock-live' : 'pareto-registry');
        }
      })
      .catch(() => {
        // Keep clean static fallback when backend is offline
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(installCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const uniqueProviders = Array.from(new Set(models.map((m) => m.provider)));
  const providers = ['All', ...uniqueProviders];

  const filteredModels = models.filter((m) => {
    const matchesProvider = selectedProvider === 'All' || m.provider === selectedProvider;
    const q = searchQuery.toLowerCase();
    const matchesQuery =
      m.name.toLowerCase().includes(q) ||
      m.id.toLowerCase().includes(q) ||
      (m.inferenceProfileId || '').toLowerCase().includes(q) ||
      m.role.toLowerCase().includes(q);
    return matchesProvider && matchesQuery;
  });

  return (
    <div className="space-y-20">
      {/* Hero Section */}
      <section className="space-y-6 max-w-2xl">
        <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight text-white leading-[1.15] apple-fade">
          <span className="block font-display text-4xl sm:text-6xl text-white tracking-wide mb-2">
            AUTONOMOUS SWARM
          </span>
          Adaptive cloud agent sessions for VS Code.
        </h1>

        <p className="text-sm sm:text-base text-zinc-400 leading-relaxed apple-fade delay-100">
          Sub-second answers and surgical single-file diffs when you need speed; isolated multi-agent AWS Fargate and SQS cloud swarms when you need scale—syncing across all your devices with zero local battery drain.
        </p>

        {/* Action Bar */}
        <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 apple-fade delay-200">
          <div className="flex items-center justify-between gap-3 px-3.5 py-2 rounded bg-zinc-900 border border-white/[0.08] font-mono text-xs text-zinc-300">
            <span className="text-zinc-500">$</span>
            <span className="select-all">{installCmd}</span>
            <button
              onClick={copyToClipboard}
              className="text-zinc-400 hover:text-white transition-colors"
              title="Copy install command"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>

          <a
            href="/extensions/vscode/lyra-swarm-1.3.0.vsix"
            download
            className="apple-btn px-4 py-2 rounded bg-white text-black font-medium text-xs hover:bg-zinc-200 transition-colors flex items-center justify-center gap-1.5"
          >
            <span>Download VSIX v1.3.0</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </section>

      {/* Code / Protocol Snippet */}
      <section className="clean-card overflow-hidden apple-fade delay-300">
        <div className="px-4 py-2 border-b border-white/[0.08] bg-zinc-950/60 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => setActiveCodeTab('cli')}
              className={`px-2.5 py-1 rounded transition-colors ${
                activeCodeTab === 'cli' ? 'bg-zinc-800 text-white font-medium' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              3-Lane Dispatch
            </button>
            <button
              onClick={() => setActiveCodeTab('ahp')}
              className={`px-2.5 py-1 rounded transition-colors ${
                activeCodeTab === 'ahp' ? 'bg-zinc-800 text-white font-medium' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Agent Host Protocol (AHP v1.3)
            </button>
          </div>
          <span className="text-[11px] font-mono text-zinc-500">Zero Local Daemon</span>
        </div>

        <div className="p-4 font-mono text-xs leading-relaxed overflow-x-auto text-zinc-300">
          {activeCodeTab === 'cli' ? (
            <pre className="text-zinc-300">
              <span className="text-zinc-500"># Adaptive Triage (&lt;1ms) routes across Instant Ask, Fast Patch, or Full Swarm</span>{'\n'}
              <span className="text-white">$ lyra dispatch "Add OAuth2 and Stripe webhook with regression suite"</span>{'\n'}
              <span className="text-zinc-400">→ Lane 2 (Full Swarm) · Enqueued via SQS + S3 Claim-Check</span>{'\n'}
              <span className="text-zinc-400">→ Pre-warmed worktrees ready · Risk-gated plan auto-approved:</span>{'\n'}
              <span className="text-zinc-300">   ├─ Worker 1 (us.anthropic.claude-sonnet-5): Auth models &amp; middleware</span>{'\n'}
              <span className="text-zinc-300">   ├─ Worker 2 (qwen3-coder-480b): Stripe webhook verification</span>{'\n'}
              <span className="text-zinc-300">   └─ Worker 3 (us.amazon.nova-2-lite): Vitest regression suite</span>{'\n'}
              <span className="text-emerald-400">✓ Verification gate: tsc (0 errors) • 27/27 tests passed • EMF logged</span>
            </pre>
          ) : (
            <pre className="text-zinc-300">
              <span className="text-zinc-500">// Streaming AHP v1.3 adaptive turn with Pareto policy profile</span>{'\n'}
              <span className="text-zinc-400">POST /api/gateway/ahp/chat (Accept: text/event-stream)</span>{'\n'}
              {JSON.stringify(
                {
                  sessionId: 'session-main',
                  prompt: 'Fix null guard in server/gateway.ts',
                  mode: 'auto',
                  policyProfile: 'balanced',
                  stream: true,
                },
                null,
                2
              )}
            </pre>
          )}
        </div>
      </section>

      {/* 3 Core Points (Clean Grid) */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6 apple-fade delay-400">
        <div className="apple-card p-5 space-y-2">
          <h2 className="text-sm font-semibold text-white">3-Lane Adaptive Triage</h2>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Sub-millisecond intent routing dispatches questions to Instant Ask, focused edits to AST-verified Fast Patch diffs, and multi-file work to Full Cloud Swarms.
          </p>
        </div>

        <div className="apple-card p-5 space-y-2">
          <h2 className="text-sm font-semibold text-white">Pareto Bedrock Router</h2>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Multi-objective routing across Frugal, Balanced, and Frontier policies with Cross-Region Inference Profiles, Prompt Caching, and automatic throttle failover.
          </p>
        </div>

        <div className="apple-card p-5 space-y-2">
          <h2 className="text-sm font-semibold text-white">SQS &amp; Worktree Isolation</h2>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Warm Fargate runners consume tasks over Amazon SQS with S3 Claim-Check offload, executing inside isolated git worktrees gated by compiler and unit tests.
          </p>
        </div>
      </section>

      {/* AWS Bedrock Supported Models Catalog */}
      <section className="space-y-4 apple-fade delay-500">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white font-display tracking-wide uppercase">
              AWS Bedrock Supported Foundation Models
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Active non-legacy models synced for Pareto routing ({catalogSource}).
            </p>
          </div>

          {/* Search Box */}
          <div className="flex items-center gap-2 px-2.5 py-1 rounded bg-zinc-900 border border-white/[0.08] text-xs">
            <Search className="h-3.5 w-3.5 text-zinc-500" />
            <input
              type="text"
              placeholder="Filter models..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent border-none outline-none text-zinc-200 placeholder-zinc-500 text-xs w-28 sm:w-36 font-mono"
            />
          </div>
        </div>

        {/* Provider Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          {providers.map((p) => (
            <button
              key={p}
              onClick={() => setSelectedProvider(p)}
              className={`apple-btn px-2.5 py-1 rounded transition-colors whitespace-nowrap ${
                selectedProvider === p ? 'bg-zinc-800 text-white font-medium' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Models List Table */}
        <div className="clean-card divide-y divide-white/[0.08] text-xs overflow-hidden">
          {filteredModels.length === 0 ? (
            <div className="p-4 text-center text-zinc-500 font-mono text-xs">No models match the filter criteria.</div>
          ) : (
            filteredModels.map((m) => (
              <div key={m.id} className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-zinc-900/40 transition-colors">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white">{m.name}</span>
                    <span className="text-[11px] text-zinc-500">· {m.provider}</span>
                  </div>
                  <div className="font-mono text-[11px] text-zinc-500 select-all">
                    {m.inferenceProfileId || m.id}
                  </div>
                </div>

                <div className="sm:text-right space-y-0.5">
                  <div className="text-zinc-300 text-[11px]">{m.role}</div>
                  <div className="text-zinc-500 font-mono text-[10px]">{m.meta}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
};

export default Home;
