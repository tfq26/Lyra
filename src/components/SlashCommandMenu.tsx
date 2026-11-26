import React from 'react';
import type { SlashCommand } from '../lib/slashCommands';

interface SlashCommandMenuProps {
  commands: SlashCommand[];
  onSelect: (command: SlashCommand) => void;
}

export const SlashCommandMenu: React.FC<SlashCommandMenuProps> = ({ commands, onSelect }) => {
  if (!commands.length) return null;
  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-lg border border-neutral-800 bg-[#111113] shadow-2xl">
      <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-neutral-600">Commands</div>
      {commands.map((command) => (
        <button
          key={command.name}
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(command)}
          className="w-full flex items-center justify-between gap-4 px-3 py-2 text-left hover:bg-neutral-800/80 transition-colors"
        >
          <span className="font-mono text-xs text-neutral-200">{command.name}</span>
          <span className="flex-1 text-[11px] text-neutral-500 truncate">{command.description}</span>
          <span className="text-[10px] text-neutral-600">{command.supportsHeadless ? 'direct' : 'interactive'}</span>
        </button>
      ))}
    </div>
  );
};
