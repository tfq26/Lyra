import React, { useState } from 'react';
import { 
  Flame, 
  Zap 
} from 'lucide-react';

interface ComparisonRow {
  title: string;
  category: string;
  localTool: {
    title: string;
    description: string;
    verdict: boolean;
  };
  lyraSwarm: {
    title: string;
    description: string;
    verdict: boolean;
  };
}

const ToolComparison: React.FC = () => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const rows: ComparisonRow[] = [
    {
      title: "Execution Duration & Autonomy",
      category: "architecture",
      localTool: {
        title: "10s - 2min (Synchronous)",
        description: "Requires active developer guidance. Drifts and stops if you look away.",
        verdict: false,
      },
      lyraSwarm: {
        title: "10min - 45min (Unattended)",
        description: "Autonomous Coordinator decomposes DAG, delegates to 4 workers, and self-heals.",
        verdict: true,
      },
    },
    {
      title: "Local CPU, Fans & Battery Life",
      category: "hardware",
      localTool: {
        title: "High Laptop Drain (4,800 RPM Fans)",
        description: "Local model context or heavy IDE processes spin fans and drain battery.",
        verdict: false,
      },
      lyraSwarm: {
        title: "Zero Local Footprint (0% CPU)",
        description: "100% offloaded to AWS Bedrock and cloud runners. Laptop stays silent and cold.",
        verdict: true,
      },
    },
    {
      title: "Git Working Tree Cleanliness",
      category: "git",
      localTool: {
        title: "Direct Working Tree Pollution",
        description: "Edits your active files in-place, risking conflicts with your uncommitted edits.",
        verdict: false,
      },
      lyraSwarm: {
        title: "Isolated Git Worktrees",
        description: "Workers operate in isolated background worktree branches. Clean merge on pass.",
        verdict: true,
      },
    },
    {
      title: "Lid-Close & Cross-Device Continuation",
      category: "hardware",
      localTool: {
        title: "Fragile WebSocket Session",
        description: "Closing your laptop lid or switching Wi-Fi terminates the agent immediately.",
        verdict: false,
      },
      lyraSwarm: {
        title: "Git-Backed Indestructibility",
        description: "Handoff state lives as Git commits. Dispatch on laptop, resume in Coder browser.",
        verdict: true,
      },
    },
    {
      title: "Deep 30+ File Refactor Scalability",
      category: "architecture",
      localTool: {
        title: "Single Context Bottleneck",
        description: "Single context window overflows or hallucinates on large multi-file scopes.",
        verdict: false,
      },
      lyraSwarm: {
        title: "Parallel Multi-Worker Swarm",
        description: "Lead Architect splits objective into non-overlapping subtasks running concurrently.",
        verdict: true,
      },
    },
    {
      title: "FinOps & Dollar Cost Transparency",
      category: "cost",
      localTool: {
        title: "$20/mo Flat Seat + Rate Limits",
        description: "Opaque hourly rate limits with throttles during peak usage periods.",
        verdict: false,
      },
      lyraSwarm: {
        title: "$0.02 - $0.11 / Feature (Pareto Routing)",
        description: "Dynamically picks Qwen 480B or Nova based on task complexity. Zero idle cost.",
        verdict: true,
      },
    },
  ];

  const filteredRows = selectedCategory === 'all'
    ? rows
    : rows.filter((r) => r.category === selectedCategory);

  return (
    <div className="space-y-10 py-4 max-w-6xl mx-auto">
      
      {/* Category Filter Pills */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {[
          { id: 'all', label: 'All Dimensions' },
          { id: 'hardware', label: 'Hardware & Battery' },
          { id: 'git', label: 'Git & Worktrees' },
          { id: 'architecture', label: 'Multi-Agent Architecture' },
          { id: 'cost', label: 'FinOps & Cost' },
        ].map((cat) => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            className={`px-4 py-2 rounded-xl text-xs font-mono transition-all ${
              selectedCategory === cat.id
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25 border border-indigo-500/40'
                : 'glass-panel text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Comparison Grid */}
      <div className="glass-panel rounded-2xl shimmer-border overflow-hidden shadow-2xl">
        <div className="grid grid-cols-1 md:grid-cols-12 bg-slate-950/90 border-b border-white/[0.08] p-4 text-xs font-mono font-semibold uppercase tracking-wider text-slate-400">
          <div className="md:col-span-4">Evaluation Dimension</div>
          <div className="md:col-span-4 text-rose-400 flex items-center gap-1.5">
            <Flame className="h-4 w-4" />
            <span>Interactive Hand Tool (Cursor / Copilot)</span>
          </div>
          <div className="md:col-span-4 text-indigo-400 flex items-center gap-1.5">
            <Zap className="h-4 w-4" />
            <span>Lyra Autonomous Swarm (AWS Bedrock)</span>
          </div>
        </div>

        <div className="divide-y divide-white/[0.06]">
          {filteredRows.map((row, idx) => (
            <div key={idx} className="grid grid-cols-1 md:grid-cols-12 p-5 gap-4 hover:bg-white/[0.02] transition-colors items-center">
              
              {/* Dimension Title */}
              <div className="md:col-span-4">
                <h4 className="text-sm font-bold text-white mb-1">{row.title}</h4>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 uppercase">
                  {row.category}
                </span>
              </div>

              {/* Local Hand Tool Column */}
              <div className="md:col-span-4 p-3 rounded-xl bg-rose-950/20 border border-rose-500/20 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center text-xs font-bold">
                    ✕
                  </span>
                  <span className="text-xs font-semibold text-rose-200">{row.localTool.title}</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed pl-6">
                  {row.localTool.description}
                </p>
              </div>

              {/* Lyra Cloud Swarm Column */}
              <div className="md:col-span-4 p-3 rounded-xl bg-indigo-950/25 border border-indigo-500/30 space-y-1 shadow-md shadow-indigo-500/5">
                <div className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-xs font-bold">
                    ✓
                  </span>
                  <span className="text-xs font-semibold text-indigo-200">{row.lyraSwarm.title}</span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed pl-6">
                  {row.lyraSwarm.description}
                </p>
              </div>

            </div>
          ))}
        </div>
      </div>

    </div>
  );
};

export default ToolComparison;
