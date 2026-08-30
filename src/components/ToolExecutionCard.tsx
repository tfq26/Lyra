import React, { useState } from 'react';
import type { ToolCall } from '../types';
import { ChevronRight, ChevronDown, Terminal, FileCode, Search, Wrench, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

interface ToolExecutionCardProps {
  toolCall: ToolCall;
}

export const ToolExecutionCard: React.FC<ToolExecutionCardProps> = ({ toolCall }) => {
  const [isOpen, setIsOpen] = useState(false);

  const getToolIcon = (name: string) => {
    switch (name.toLowerCase()) {
      case 'run_command':
      case 'bash':
      case 'terminal':
        return <Terminal className="w-3.5 h-3.5 text-neutral-300" />;
      case 'view_file':
      case 'write_to_file':
      case 'replace_file_content':
      case 'edit_file':
        return <FileCode className="w-3.5 h-3.5 text-neutral-300" />;
      case 'grep_search':
      case 'find_by_name':
      case 'search':
        return <Search className="w-3.5 h-3.5 text-neutral-300" />;
      default:
        return <Wrench className="w-3.5 h-3.5 text-neutral-300" />;
    }
  };

  const getStatusIcon = (status: ToolCall['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
      case 'running':
      case 'pending':
        return <Loader2 className="w-3.5 h-3.5 text-neutral-400 animate-spin" />;
      case 'error':
        return <AlertCircle className="w-3.5 h-3.5 text-rose-400" />;
    }
  };

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
    <div className="my-1.5 rounded border border-neutral-800 bg-neutral-900/40 text-xs font-mono transition-colors">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-neutral-800/40 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
          )}
          <span className="shrink-0">{getToolIcon(toolCall.name)}</span>
          <span className="font-medium text-neutral-200 shrink-0">{toolCall.name}</span>
          {primaryParam && (
            <span className="truncate text-neutral-400 text-[11px]">
              {primaryParam}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {getStatusIcon(toolCall.status)}
        </div>
      </button>

      {isOpen && (
        <div className="border-t border-neutral-800/80 px-3 py-2.5 bg-neutral-950/60 space-y-2">
          <div>
            <div className="text-[10px] uppercase text-neutral-500 tracking-wider mb-1 font-semibold">
              Arguments
            </div>
            <pre className="p-2 rounded bg-neutral-900 border border-neutral-800 text-[11px] text-neutral-300 overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(toolCall.args, null, 2)}
            </pre>
          </div>

          {toolCall.output && (
            <div>
              <div className="text-[10px] uppercase text-neutral-500 tracking-wider mb-1 font-semibold">
                Output
              </div>
              <pre className="p-2 rounded bg-neutral-900 border border-neutral-800 text-[11px] text-neutral-300 overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto">
                {toolCall.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
