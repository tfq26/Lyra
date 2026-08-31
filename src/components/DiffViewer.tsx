import React, { useState } from 'react';
import type { FileDiff } from '../types';
import { ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';

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
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const renderPatchLines = () => {
    if (!diff.patch) {
      return (
        <div className="p-3 text-neutral-500 text-xs">
          {diff.content || 'No diff content.'}
        </div>
      );
    }

    const lines = diff.patch.split('\n');
    return (
      <div className="text-xs divide-y divide-neutral-900/40">
        {lines.map((line, idx) => {
          const isAdded = line.startsWith('+') && !line.startsWith('+++');
          const isRemoved = line.startsWith('-') && !line.startsWith('---');
          const isHunk = line.startsWith('@@');

          let lineBg = 'bg-transparent';
          let textColor = 'text-neutral-300';

          if (isAdded) {
            lineBg = 'bg-emerald-500/10 text-emerald-300';
          } else if (isRemoved) {
            lineBg = 'bg-rose-500/10 text-rose-300';
          } else if (isHunk) {
            lineBg = 'bg-neutral-900/60 text-neutral-500 font-medium';
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
    <div className="my-2 rounded-md border border-neutral-800/80 bg-[#09090b] overflow-hidden text-xs">
      <div className="flex items-center justify-between px-3 py-1.5 bg-neutral-900/50 border-b border-neutral-800/60 select-none">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 text-left text-neutral-300 hover:text-neutral-100 transition-colors"
        >
          {isOpen ? (
            <ChevronDown className="w-3 h-3 text-neutral-500" />
          ) : (
            <ChevronRight className="w-3 h-3 text-neutral-500" />
          )}
          <span className="font-medium">{diff.filename}</span>
        </button>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-emerald-400">+{diff.additions}</span>
            <span className="text-rose-400">-{diff.deletions}</span>
          </div>
          <button
            onClick={handleCopy}
            className="text-neutral-500 hover:text-neutral-300 transition-colors"
            title="Copy diff"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-neutral-300" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {isOpen && <div className="max-h-72 overflow-y-auto">{renderPatchLines()}</div>}
    </div>
  );
};

