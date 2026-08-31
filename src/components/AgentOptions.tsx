import React from 'react';
import type { AgentRunOptions } from '../types';
import { Settings2 } from 'lucide-react';

interface AgentOptionsProps {
  agent: string;
  options: AgentRunOptions;
  onChange: (options: AgentRunOptions) => void;
}

export const AgentOptions: React.FC<AgentOptionsProps> = ({ agent, options, onChange }) => (
  <details className="group">
    <summary className="list-none cursor-pointer inline-flex items-center gap-1.5 text-[11px] text-neutral-500 hover:text-neutral-300 select-none">
      <Settings2 className="w-3 h-3" /> Options
    </summary>
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-neutral-800 bg-neutral-950/80 p-2 text-[11px]">
      <input
        value={options.model || ''}
        onChange={(e) => onChange({ ...options, model: e.target.value || undefined })}
        placeholder={`${agent} default model`}
        className="w-40 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-neutral-700"
        aria-label="Model override"
      />
      {agent === 'antigravity' && (
        <select
          value={options.effort || ''}
          onChange={(e) => onChange({ ...options, effort: (e.target.value || undefined) as AgentRunOptions['effort'] })}
          className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-neutral-300 focus:outline-none"
          aria-label="Reasoning effort"
        >
          <option value="">Default effort</option>
          <option value="low">Low effort</option>
          <option value="medium">Medium effort</option>
          <option value="high">High effort</option>
        </select>
      )}
      {agent === 'codex' && (
        <label className="inline-flex items-center gap-1.5 text-neutral-400">
          <input type="checkbox" checked={Boolean(options.search)} onChange={(e) => onChange({ ...options, search: e.target.checked })} /> Web search
        </label>
      )}
      <label className="inline-flex items-center gap-1.5 text-neutral-400">
        <input type="checkbox" checked={Boolean(options.continueSession)} onChange={(e) => onChange({ ...options, continueSession: e.target.checked })} /> Continue
      </label>
    </div>
  </details>
);
