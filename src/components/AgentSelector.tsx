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
  statusMap = { antigravity: 'ready', claude_code: 'ready', codex: 'ready', orchestrator: 'ready' },
  capabilities = {},
}) => {
  const agents: { type: AgentType; label: string }[] = [
    { type: 'antigravity', label: 'Antigravity' },
    { type: 'claude_code', label: 'Claude Code' },
    { type: 'codex', label: 'Codex' },
    { type: 'orchestrator', label: 'Bridge' },
  ];

  return (
    <div className="inline-flex items-center p-0.5 rounded-md bg-neutral-900 border border-neutral-800/80">
      {agents.map((agent) => {
        const isSelected = activeAgent === agent.type;
        const status = capabilities[agent.type]?.installed === false ? 'offline' : (statusMap[agent.type] || 'ready');
        const isRunning = status === 'running';

        return (
          <button
            key={agent.type}
            onClick={() => onSelectAgent(agent.type)}
            className={`relative flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-all select-none ${
              isSelected
                ? 'bg-neutral-800 text-neutral-100 shadow-sm border border-neutral-700/50'
                : 'text-neutral-400 hover:text-neutral-200 border border-transparent'
            }`}
          >
            {isRunning && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
            )}
            {status === 'offline' && <span className="w-1.5 h-1.5 rounded-full bg-neutral-600 shrink-0" />}
            <span>{agent.label}</span>
          </button>
        );
      })}
    </div>
  );
};
