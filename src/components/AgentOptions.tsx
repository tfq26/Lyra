import React from 'react';
import type { AgentRunOptions, ModelOption } from '../types';
import { Settings2 } from 'lucide-react';

interface AgentOptionsProps {
  agent: string;
  options: AgentRunOptions;
  onChange: (options: AgentRunOptions) => void;
  models: ModelOption[];
  onSave: () => void;
  saving?: boolean;
}

export const AgentOptions: React.FC<AgentOptionsProps> = ({ agent, options, onChange, models, onSave, saving = false }) => (
  <details className="group relative">
    <summary className="list-none cursor-pointer inline-flex items-center gap-1.5 text-[11px] text-neutral-500 hover:text-neutral-300 select-none">
      <Settings2 className="w-3 h-3" /> Options
    </summary>
    <div className="absolute left-0 top-full z-40 mt-2 flex w-max max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2 rounded-md border border-neutral-800 bg-[#111113] p-2 text-[11px] shadow-2xl">
      <select
        value={options.model || ''}
        onChange={(e) => onChange({ ...options, model: e.target.value || undefined })}
        className="w-56 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-neutral-200 focus:outline-none focus:border-neutral-700"
        aria-label="Model"
      >
        <option value="">CLI default</option>
        {models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
      </select>
      {/* Keep a compact text fallback for a model returned by a newer CLI that is not in the cached list. */}
      {options.model && !models.some((model) => model.id === options.model) && <input
        value={options.model}
        onChange={(e) => onChange({ ...options, model: e.target.value || undefined })}
        className="w-44 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-neutral-200 focus:outline-none focus:border-neutral-700"
        aria-label="Model override"
      />}
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
      <button type="button" onClick={onSave} disabled={saving} className="rounded bg-neutral-200 px-2.5 py-1 font-medium text-neutral-950 hover:bg-white disabled:opacity-40">
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  </details>
);
