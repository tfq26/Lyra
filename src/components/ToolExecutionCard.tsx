import React, { useState } from 'react';
import type { ToolCall } from '../types';
import { ChevronRight, ChevronDown, Check, AlertCircle, Loader2 } from 'lucide-react';

interface ToolExecutionCardProps {
  toolCall: ToolCall;
}

export const ToolExecutionCard: React.FC<ToolExecutionCardProps> = ({ toolCall }) => {
  const [isOpen, setIsOpen] = useState(false);

  const getPrimaryParam = (tool: ToolCall): string => {
    if (!tool.args) return '';
    if (tool.args.CommandLine) return tool.args.CommandLine;
    if (tool.args.command) return tool.args.command;
    if (tool.args.AbsolutePath) return tool.args.AbsolutePath;
    if (tool.args.TargetFile) return tool.args.TargetFile;
    if (tool.args.Query) return `"${tool.args.Query}"`;
    if (tool.args.Pattern) return tool.args.Pattern;
    const firstKey = Object.keys(tool.args)[0];
    return firstKey ? `${firstKey}: ${JSON.stringify(tool.args[firstKey])}` : '';
  };

  const primaryParam = getPrimaryParam(toolCall);

  return (
    <div className="my-1 rounded-md border border-neutral-800/80 bg-neutral-900/40 text-xs transition-colors">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-2.5 py-1.5 text-left hover:bg-neutral-800/40 transition-colors select-none"
      >
        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
          {isOpen ? (
            <ChevronDown className="w-3 h-3 text-neutral-500 shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 text-neutral-500 shrink-0" />
          )}
          <span className="text-neutral-300 font-medium shrink-0">{toolCall.name}</span>
          {primaryParam && (
            <span className="truncate text-neutral-500 text-[11px]">
              {primaryParam}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {toolCall.status === 'completed' && <Check className="w-3 h-3 text-emerald-400" />}
          {(toolCall.status === 'running' || toolCall.status === 'pending') && (
            <Loader2 className="w-3 h-3 text-neutral-400 animate-spin" />
          )}
          {toolCall.status === 'error' && <AlertCircle className="w-3 h-3 text-rose-400" />}
        </div>
      </button>

      {isOpen && (
        <div className="border-t border-neutral-800/60 px-3 py-2 bg-[#09090b]/80 space-y-2 text-xs">
          {toolCall.args && (
            <div>
              <div className="text-[10px] uppercase text-neutral-500 tracking-wider mb-1">
                Arguments
              </div>
              <pre className="p-2 rounded bg-neutral-900/60 border border-neutral-800 text-[11px] text-neutral-300 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(toolCall.args, null, 2)}
              </pre>
            </div>
          )}

          {toolCall.output && (
            <div>
              <div className="text-[10px] uppercase text-neutral-500 tracking-wider mb-1">
                Output
              </div>
              <pre className="p-2 rounded bg-neutral-900/60 border border-neutral-800 text-[11px] text-neutral-300 overflow-x-auto whitespace-pre-wrap max-h-52 overflow-y-auto">
                {toolCall.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

