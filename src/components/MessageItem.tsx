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
  ArrowRight
} from 'lucide-react';

interface MessageItemProps {
  message: Message;
  onDispatchToAgent?: (toAgent: AgentType, content: string) => void;
}

export const MessageItem: React.FC<MessageItemProps> = ({ message, onDispatchToAgent }) => {
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
        return 'Claude Code';
      case 'codex':
        return 'Codex';
      default:
        return 'Assistant';
    }
  };

  if (isUser) {
    return (
      <div className="flex flex-col items-end w-full group animate-fade-in">
        <div className="flex items-center gap-1.5 mb-0.5 px-1 text-[10px] text-neutral-500 opacity-0 group-hover:opacity-100 transition-opacity select-none">
          <span>{formatTimestamp(message.timestamp)}</span>
          <button
            onClick={handleCopy}
            className="text-neutral-500 hover:text-neutral-300 transition-colors p-0.5"
            title="Copy message"
          >
            {copied ? <Check className="w-2.5 h-2.5 text-neutral-300" /> : <Copy className="w-2.5 h-2.5" />}
          </button>
        </div>
        <div className="max-w-[80%] sm:max-w-[65%] rounded-xl rounded-tr-xs bg-neutral-800/80 border border-neutral-700/40 px-3 py-1.5 text-neutral-200 text-xs leading-normal shadow-xs">
          {displayContent}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start w-full space-y-2 group animate-fade-in">
      {/* Author Header */}
      <div className="flex items-center justify-between w-full">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center text-[10px] font-medium text-neutral-300">
            {message.agentType === 'claude_code' ? 'C' : message.agentType === 'codex' ? 'X' : 'A'}
          </div>
          <span className="text-xs font-medium text-neutral-200">
            {getAgentLabel(message.agentType)}
          </span>
          <span className="text-[11px] text-neutral-500">
            {formatTimestamp(message.timestamp)}
          </span>
        </div>

        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {onDispatchToAgent && (
            <div className="flex items-center gap-1">
              {(['antigravity', 'claude_code', 'codex'] as AgentType[])
                .filter((a) => a !== message.agentType)
                .map((target) => (
                  <button
                    key={target}
                    onClick={() => onDispatchToAgent(target, message.content)}
                    className="px-2 py-0.5 rounded text-[10px] border border-neutral-800 bg-neutral-900/60 hover:bg-neutral-800 hover:text-neutral-200 text-neutral-500 transition-colors flex items-center gap-1"
                  >
                    <ArrowRight className="w-2.5 h-2.5" />
                    <span>{target === 'claude_code' ? 'Claude' : target === 'antigravity' ? 'AGY' : 'Codex'}</span>
                  </button>
                ))}
            </div>
          )}
          <button
            onClick={handleCopy}
            className="text-neutral-500 hover:text-neutral-300 transition-colors p-1"
            title="Copy message"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-neutral-300" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Quiet Reasoning / Thinking Disclosure */}
      {message.thinking && (
        <div className="border-l-2 border-neutral-800 pl-3 py-0.5 my-1 space-y-1 ml-7">
          <button
            onClick={() => setShowThinking(!showThinking)}
            className="flex items-center gap-1.5 text-[11px] text-neutral-500 hover:text-neutral-300 transition-colors select-none"
          >
            {showThinking ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            <span>Reasoning</span>
          </button>
          {showThinking && (
            <div className="text-xs text-neutral-400 whitespace-pre-wrap leading-relaxed pt-1 max-h-60 overflow-y-auto">
              {message.thinking}
            </div>
          )}
        </div>
      )}

      {/* Tool Executions */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="space-y-1 my-1 w-full pl-7">
          {message.toolCalls.map((tool) => (
            <ToolExecutionCard key={tool.id} toolCall={tool} />
          ))}
        </div>
      )}

      {/* File Diffs */}
      {message.diffs && message.diffs.length > 0 && (
        <div className="space-y-1 my-1 w-full pl-7">
          {message.diffs.map((diff, i) => (
            <DiffViewer key={i} diff={diff} />
          ))}
        </div>
      )}

      {/* Content Render */}
      {message.content && (
        <div className="text-neutral-200 text-xs sm:text-sm leading-relaxed space-y-3 prose prose-invert max-w-none pl-7 w-full">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ node, className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '');
                  const language = match ? match[1] : '';
                  const codeString = String(children).replace(/\n$/, '');

                  if (language === 'mermaid') {
                    return <MermaidDiagram chart={codeString} />;
                  }

                  const isInline = !match && !codeString.includes('\n');
                  if (isInline) {
                    return (
                      <code className="px-1.5 py-0.5 rounded text-[11px] bg-neutral-900 text-neutral-300 border border-neutral-800" {...props}>
                        {children}
                      </code>
                    );
                  }

                  return (
                    <div className="my-3 rounded-md border border-neutral-800 bg-[#0c0c0e] overflow-hidden text-xs not-prose">
                      {language && (
                        <div className="flex items-center justify-between px-3 py-1.5 bg-neutral-900/60 border-b border-neutral-800 text-[11px] text-neutral-400">
                          <span>{language}</span>
                          <button
                            onClick={() => navigator.clipboard.writeText(codeString)}
                            className="hover:text-neutral-200 transition-colors"
                          >
                            Copy
                          </button>
                        </div>
                      )}
                      <pre className="p-3 overflow-x-auto text-neutral-200 text-xs">
                        <code>{codeString}</code>
                      </pre>
                    </div>
                  );
                },
                p({ children }) {
                  return <p className="mb-2.5 last:mb-0 leading-relaxed">{children}</p>;
                },
                ul({ children }) {
                  return <ul className="list-disc pl-5 mb-2 space-y-1 text-neutral-300">{children}</ul>;
                },
                ol({ children }) {
                  return <ol className="list-decimal pl-5 mb-2 space-y-1 text-neutral-300">{children}</ol>;
                },
                h1({ children }) {
                  return <h1 className="text-sm font-semibold text-neutral-100 mt-4 mb-2">{children}</h1>;
                },
                h2({ children }) {
                  return <h2 className="text-xs font-semibold text-neutral-100 mt-3 mb-1.5">{children}</h2>;
                },
                h3({ children }) {
                  return <h3 className="text-xs font-medium text-neutral-300 mt-2 mb-1">{children}</h3>;
                },
                blockquote({ children }) {
                  return <blockquote className="border-l-2 border-neutral-700 pl-3 py-0.5 text-neutral-400 my-2 italic text-xs">{children}</blockquote>;
                }
              }}
            >
              {displayContent}
            </ReactMarkdown>
          </div>
        )}
    </div>
  );
};
