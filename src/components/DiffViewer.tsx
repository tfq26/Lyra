import React, { useState } from 'react';
import type { FileDiff } from '../types';
import { FileCode, Plus, Minus, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';

interface DiffViewerProps {
  diff: FileDiff;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ diff }) => {
  const [isOpen, setIsOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (diff.patch || diff.content) {
      navigator.clipboard.writeText(diff.patch || diff.content || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const renderPatchLines = () => {
    if (!diff.patch) {
      return (
        <div className="p-3 text-neutral-400 font-mono text-xs">
          {diff.content || 'No diff details available.'}
        </div>
      );
    }

    const lines = diff.patch.split('\n');
    return (
      <div className="font-mono text-xs divide-y divide-neutral-900/50">
        {lines.map((line, idx) => {
          const isAdded = line.startsWith('+') && !line.startsWith('+++');
          const isRemoved = line.startsWith('-') && !line.startsWith('---');
          const isHunk = line.startsWith('@@');

          let lineBg = 'bg-transparent';
          let textColor = 'text-neutral-300';

          if (isAdded) {
            lineBg = 'bg-emerald-950/20 text-emerald-300';
          } else if (isRemoved) {
            lineBg = 'bg-rose-950/20 text-rose-300';
          } else if (isHunk) {
            lineBg = 'bg-neutral-900 text-neutral-500 font-semibold';
          }

          return (
            <div key={idx} className={`flex items-start px-2 py-0.5 ${lineBg}`}>
              <span className="w-8 select-none text-neutral-600 text-[10px] text-right pr-2">
                {idx + 1}
              </span>
              <pre className={`flex-1 overflow-x-auto whitespace-pre ${textColor}`}>
                {line}
              </pre>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="my-2 rounded border border-neutral-800 bg-neutral-950 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-neutral-900 border-b border-neutral-800">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 text-left text-xs font-mono text-neutral-200 hover:text-white transition-colors"
        >
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-neutral-500" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-neutral-500" />
          )}
          <FileCode className="w-3.5 h-3.5 text-neutral-400" />
          <span className="font-medium">{diff.filename}</span>
        </button>

        <div className="flex items-center gap-3 text-xs font-mono">
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="flex items-center text-emerald-400">
              <Plus className="w-3 h-3" />
              {diff.additions}
            </span>
            <span className="flex items-center text-rose-400">
              <Minus className="w-3 h-3" />
              {diff.deletions}
            </span>
          </div>
          <button
            onClick={handleCopy}
            className="text-neutral-400 hover:text-neutral-200 transition-colors"
            title="Copy diff patch"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {isOpen && <div className="max-h-80 overflow-y-auto">{renderPatchLines()}</div>}
    </div>
  );
};
