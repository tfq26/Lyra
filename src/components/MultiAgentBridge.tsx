import React, { useState } from 'react';
import type { AgentBridgeTask, AgentType } from '../types';
import { Network, ArrowRight, Play, CheckCircle2, Loader2 } from 'lucide-react';

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
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 space-y-4 font-mono text-xs">
      <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
        <div className="flex items-center gap-2 text-neutral-200">
          <Network className="w-4 h-4 text-purple-400" />
          <span className="font-semibold text-sm">Cross-Agent Dispatch Bridge</span>
        </div>
        <span className="text-[11px] text-neutral-500">Autonomous Chain & Handoff</span>
      </div>

      <form onSubmit={handleStartWorkflow} className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 space-y-1">
            <label className="text-[10px] uppercase text-neutral-500 font-semibold tracking-wider">Source (Planner / Lead)</label>
            <select
              value={fromAgent}
              onChange={(e) => setFromAgent(e.target.value as AgentType)}
              className="w-full bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-neutral-300 text-xs focus:outline-none focus:border-neutral-700"
            >
              <option value="antigravity">Antigravity (Gemini 2.5 / 3.7)</option>
              <option value="claude_code">Claude Code (Claude 3.7)</option>
              <option value="codex">Codex CLI</option>
            </select>
          </div>

          <div className="pt-4 text-neutral-600">
            <ArrowRight className="w-4 h-4" />
          </div>

          <div className="flex-1 space-y-1">
            <label className="text-[10px] uppercase text-neutral-500 font-semibold tracking-wider">Target (Worker / Implementer)</label>
            <select
              value={toAgent}
              onChange={(e) => setToAgent(e.target.value as AgentType)}
              className="w-full bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-neutral-300 text-xs focus:outline-none focus:border-neutral-700"
            >
              <option value="claude_code">Claude Code (Claude 3.7)</option>
              <option value="codex">Codex CLI</option>
              <option value="antigravity">Antigravity (Gemini 2.5 / 3.7)</option>
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] uppercase text-neutral-500 font-semibold tracking-wider">Pipeline Goal</label>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={2}
            placeholder="e.g., Have Antigravity plan the database schema with a Mermaid diagram, then hand off task specs to Claude Code to create migrations..."
            className="w-full bg-neutral-950 border border-neutral-800 rounded p-2.5 text-neutral-200 placeholder:text-neutral-600 text-xs focus:outline-none focus:border-neutral-700 resize-none font-sans"
          />
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!instruction.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-neutral-100 text-neutral-900 font-medium hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-xs"
          >
            <Play className="w-3 h-3" />
            Dispatch Pipeline
          </button>
        </div>
      </form>

      {tasks.length > 0 && (
        <div className="border-t border-neutral-800 pt-3 space-y-2">
          <div className="text-[10px] uppercase text-neutral-500 font-semibold tracking-wider">Active Pipeline Tasks</div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {tasks.map((task) => (
              <div key={task.id} className="p-2.5 rounded border border-neutral-800 bg-neutral-950 flex items-start justify-between gap-2">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-neutral-400 text-[11px]">
                    <span className="text-neutral-300 font-medium">{task.fromAgent}</span>
                    <ArrowRight className="w-3 h-3 text-neutral-600" />
                    <span className="text-neutral-300 font-medium">{task.toAgent}</span>
                  </div>
                  <div className="text-neutral-300 text-xs truncate font-sans">{task.taskDescription}</div>
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
                      <CheckCircle2 className="w-3 h-3" />
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
