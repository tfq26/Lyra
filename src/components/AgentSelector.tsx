import React from 'react';
import type { AgentType } from '../types';
import { Sparkles, Terminal, Cpu, Network } from 'lucide-react';

interface AgentSelectorProps {
  activeAgent: AgentType;
  onSelectAgent: (agent: AgentType) => void;
  statusMap?: Record<AgentType, 'ready' | 'running' | 'idle' | 'offline'>;
}

export const AgentSelector: React.FC<AgentSelectorProps> = ({
  activeAgent,
  onSelectAgent,
  statusMap = { antigravity: 'ready', claude_code: 'ready', codex: 'ready', orchestrator: 'ready' },
}) => {
  const agents: { type: AgentType; label: string; icon: React.ReactNode; description: string }[] = [
    {
      type: 'antigravity',
      label: 'Antigravity',
      icon: <Sparkles className="w-3.5 h-3.5 text-sky-400" />,
      description: 'Architect & multi-turn planner',
    },
    {
      type: 'claude_code',
      label: 'Claude Code',
      icon: <Terminal className="w-3.5 h-3.5 text-amber-400" />,
      description: 'Fast terminal-first refactor engine',
    },
    {
      type: 'codex',
      label: 'Codex CLI',
      icon: <Cpu className="w-3.5 h-3.5 text-emerald-400" />,
      description: 'Targeted code gen & test suites',
    },
    {
      type: 'orchestrator',
      label: 'Team Bridge',
      icon: <Network className="w-3.5 h-3.5 text-purple-400" />,
      description: 'Cross-agent task pipeline',
    },
  ];

  return (
    <div className="flex items-center gap-1 bg-neutral-900/80 p-1 rounded-md border border-neutral-800">
      {agents.map((agent) => {
        const isSelected = activeAgent === agent.type;
        const status = statusMap[agent.type] || 'ready';

        return (
          <button
            key={agent.type}
            onClick={() => onSelectAgent(agent.type)}
            className={`flex items-center gap-2 px-2.5 py-1 rounded text-xs font-mono transition-all ${
              isSelected
                ? 'bg-neutral-800 text-white shadow-sm border border-neutral-700'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/40 border border-transparent'
            }`}
          >
            {agent.icon}
            <span className="font-medium">{agent.label}</span>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                status === 'running'
                  ? 'bg-amber-400 animate-pulse'
                  : status === 'ready'
                  ? 'bg-emerald-400'
                  : 'bg-neutral-600'
              }`}
            />
          </button>
        );
      })}
    </div>
  );
};
