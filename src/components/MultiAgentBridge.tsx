import React, { useState } from 'react';
import type { AgentBridgeTask, AgentType } from '../types';
import { ArrowRight, Play, Check, Loader2 } from 'lucide-react';

interface MultiAgentBridgeProps {
  onDispatchWorkflow: (fromAgent: AgentType, toAgent: AgentType, instruction: string) => void;
  tasks: AgentBridgeTask[];
}

export const MultiAgentBridge: React.FC<MultiAgentBridgeProps> = ({ onDispatchWorkflow, tasks }) => {
  const [fromAgent, setFromAgent] = useState<AgentType>('antigravity');
  const [toAgent, setToAgent] = useState<AgentType>('claude_code');
  const [instruction, setInstruction] = useState('');

  const handleStartWorkflow = (e: React.FormEvent) => {
    e.preventDefault();
    if (!instruction.trim()) return;
    onDispatchWorkflow(fromAgent, toAgent, instruction);
    setInstruction('');
  };

  return (
    <div className="rounded-lg border border-neutral-800/80 bg-neutral-900/30 p-4 space-y-4 text-xs">
      <div className="flex items-center justify-between border-b border-neutral-800/60 pb-3">
        <div>
          <h2 className="font-medium text-sm text-neutral-100">Cross-Agent Bridge</h2>
          <p className="text-xs text-neutral-500 mt-0.5">Chain tasks between lead planning and execution engines</p>
        </div>
      </div>

      <form onSubmit={handleStartWorkflow} className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 space-y-1">
            <label className="text-[10px] uppercase text-neutral-500 font-semibold tracking-wider">Source (Lead / Planner)</label>
            <select
              value={fromAgent}
              onChange={(e) => setFromAgent(e.target.value as AgentType)}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-2.5 py-1.5 text-neutral-200 text-xs focus:outline-none focus:border-neutral-700"
            >
              <option value="antigravity">Antigravity (Gemini)</option>
              <option value="claude_code">Claude Code</option>
              <option value="codex">Codex</option>
            </select>
          </div>

          <div className="pt-4 text-neutral-600">
            <ArrowRight className="w-4 h-4" />
          </div>

          <div className="flex-1 space-y-1">
            <label className="text-[10px] uppercase text-neutral-500 font-semibold tracking-wider">Target (Implementer)</label>
            <select
              value={toAgent}
              onChange={(e) => setToAgent(e.target.value as AgentType)}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-2.5 py-1.5 text-neutral-200 text-xs focus:outline-none focus:border-neutral-700"
            >
              <option value="claude_code">Claude Code</option>
              <option value="codex">Codex</option>
              <option value="antigravity">Antigravity (Gemini)</option>
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] uppercase text-neutral-500 font-semibold tracking-wider">Objective</label>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={2}
            placeholder="e.g., Have Antigravity generate architectural plan and hand off implementation to Claude Code..."
            className="w-full bg-neutral-950 border border-neutral-800 rounded-md p-2.5 text-neutral-200 placeholder:text-neutral-600 text-xs focus:outline-none focus:border-neutral-700 resize-none"
          />
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!instruction.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-neutral-100 text-neutral-900 font-medium hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-xs"
          >
            <Play className="w-3 h-3" />
            <span>Dispatch Pipeline</span>
          </button>
        </div>
      </form>

      {tasks.length > 0 && (
        <div className="border-t border-neutral-800/60 pt-3 space-y-2">
          <div className="text-[10px] uppercase text-neutral-500 font-semibold tracking-wider">Pipeline Tasks</div>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {tasks.map((task) => (
              <div key={task.id} className="p-2 rounded border border-neutral-800 bg-[#09090b] flex items-start justify-between gap-2">
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-1.5 text-neutral-400 text-[11px]">
                    <span className="text-neutral-200">{task.fromAgent}</span>
                    <ArrowRight className="w-3 h-3 text-neutral-600" />
                    <span className="text-neutral-200">{task.toAgent}</span>
                  </div>
                  <div className="text-neutral-400 text-xs truncate">{task.taskDescription}</div>
                </div>

                <div className="shrink-0 flex items-center gap-1">
                  {task.status === 'running' && (
                    <span className="flex items-center gap-1 text-amber-400 text-[11px]">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Running
                    </span>
                  )}
                  {task.status === 'completed' && (
                    <span className="flex items-center gap-1 text-emerald-400 text-[11px]">
                      <Check className="w-3 h-3" />
                      Done
                    </span>
                  )}
                  {task.status === 'dispatched' && (
                    <span className="text-neutral-500 text-[11px]">Dispatched</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

