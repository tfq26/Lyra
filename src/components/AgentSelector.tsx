import React from 'react';
import type { AgentType } from '../types';

interface AgentSelectorProps {
  activeAgent: AgentType;
  onSelectAgent: (agent: AgentType) => void;
  statusMap?: Record<AgentType, 'ready' | 'running' | 'idle' | 'offline'>;
  capabilities?: Record<string, { installed: boolean }>;
}

export const AgentSelector: React.FC<AgentSelectorProps> = ({
  activeAgent,
  onSelectAgent,
}) => {
  const agents: { type: AgentType; label: string }[] = [
    { type: 'antigravity', label: 'Antigravity' },
    { type: 'claude_code', label: 'Claude' },
    { type: 'codex', label: 'Codex' },
    { type: 'orchestrator', label: 'Orchestrator' },
  ];

  return (
    <nav className="flex items-center gap-1 p-0.5 rounded-lg bg-neutral-900/60 border border-neutral-800/60">
      {agents.map((agent) => {
        const isSelected = activeAgent === agent.type;

        return (
          <button
            key={agent.type}
            onClick={() => onSelectAgent(agent.type)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all select-none ${
              isSelected
                ? 'bg-neutral-800 text-neutral-100 shadow-xs'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/30'
            }`}
          >
            {agent.label}
          </button>
        );
      })}
    </nav>
  );
};
