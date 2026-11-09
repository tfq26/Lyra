import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, AgentType } from '../types';
import { MermaidDiagram } from './MermaidDiagram';
import { ToolExecutionCard } from './ToolExecutionCard';
import { DiffViewer } from './DiffViewer';
import { formatTimestamp } from '../lib/utils';
import { 
  ChevronDown, 
  ChevronRight, 
  Copy, 
  Check, 
} from 'lucide-react';

interface MessageItemProps {
  message: Message;
  onDispatchToAgent?: (toAgent: AgentType, content: string) => void;
}

export const MessageItem: React.FC<MessageItemProps> = ({ message }) => {
  const [showThinking, setShowThinking] = useState(false);
  const [copied, setCopied] = useState(false);

  const isUser = message.role === 'user';

  const sanitizeContent = (text: string): string => {
    if (!text) return '';
    if (isUser) {
      const match = text.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
      let cleaned = match ? (match[1] || '').trim() : text;
      return cleaned
        .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '')
        .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/g, '')
        .trim();
    }
    return text;
  };

  const displayContent = sanitizeContent(message.content);

  const handleCopy = () => {
    navigator.clipboard.writeText(displayContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const getAgentLabel = (agent: AgentType) => {
    switch (agent) {
      case 'antigravity':
        return 'Antigravity';
      case 'claude_code':
        return 'Claude';
      case 'codex':
        return 'Codex';
      case 'orchestrator':
        return 'Orchestrator';
      default:
        return 'Assistant';
    }
  };

  if (isUser) {
    return (
      <div className="flex flex-col items-end w-full group animate-fade-in">
        <div className="flex items-center gap-2 mb-1 px-1 text-[11px] text-neutral-500 opacity-0 group-hover:opacity-100 transition-opacity select-none">
          <span>{formatTimestamp(message.timestamp)}</span>
          <button
            onClick={handleCopy}
            className="text-neutral-500 hover:text-neutral-300 transition-colors p-0.5"
            title="Copy message"
          >
            {copied ? <Check className="w-3 h-3 text-neutral-300" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
        <div className="max-w-[85%] sm:max-w-[70%] rounded-2xl bg-neutral-800/90 border border-neutral-700/40 px-4 py-2.5 text-neutral-100 text-[13px] leading-relaxed shadow-xs">
          {displayContent}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start w-full space-y-2 group animate-fade-in">
      {/* Author Header */}
      <div className="flex items-center justify-between w-full select-none pt-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-neutral-200 tracking-tight">
            {getAgentLabel(message.agentType)}
          </span>
          <span className="text-[11px] text-neutral-500">
            {formatTimestamp(message.timestamp)}
          </span>
        </div>

        <button
          onClick={handleCopy}
          className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-neutral-300 transition-opacity p-1 rounded hover:bg-neutral-800/40"
          title="Copy message"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>

      {/* Thinking Accordion (Quiet & Clean) */}
      {message.thinking && (
        <div className="w-full">
          <button
            onClick={() => setShowThinking(!showThinking)}
            className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-400 transition-colors py-0.5 select-none"
          >
            {showThinking ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            <span>Thought process</span>
          </button>

          {showThinking && (
            <div className="mt-1.5 pl-3 border-l-2 border-neutral-800 text-neutral-400 text-xs font-mono whitespace-pre-wrap leading-relaxed py-1">
              {message.thinking}
            </div>
          )}
        </div>
      )}

      {/* Primary Message Content */}
      {displayContent && (
        <div className="w-full text-[13px] leading-relaxed text-neutral-200 prose prose-invert max-w-none prose-p:my-2 prose-pre:my-2 prose-pre:bg-neutral-900 prose-pre:border prose-pre:border-neutral-800/80">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {displayContent}
          </ReactMarkdown>
        </div>
      )}

      {/* Tool Executions */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="w-full space-y-1 pt-1">
          {message.toolCalls.map((tc) => (
            <ToolExecutionCard key={tc.id} toolCall={tc} />
          ))}
        </div>
      )}

      {/* File Diffs */}
      {message.diffs && message.diffs.length > 0 && (
        <div className="w-full space-y-2 pt-2">
          {message.diffs.map((diff, idx) => (
            <DiffViewer key={idx} diff={diff} />
          ))}
        </div>
      )}

      {/* Artifacts (Mermaid, etc.) */}
      {message.artifacts && message.artifacts.length > 0 && (
        <div className="w-full space-y-2 pt-2">
          {message.artifacts.map((art) => {
            if (art.type === 'mermaid') {
              return <MermaidDiagram key={art.id} chart={art.content} />;
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
};
