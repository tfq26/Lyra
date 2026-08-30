import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, AgentType } from '../types';
import { MermaidDiagram } from './MermaidDiagram';
import { ToolExecutionCard } from './ToolExecutionCard';
import { DiffViewer } from './DiffViewer';
import { formatTimestamp } from '../lib/utils';
import { 
  Bot, 
  User, 
  BrainCircuit, 
  ChevronDown, 
  ChevronRight, 
  Copy, 
  Check, 
  ArrowRight,
  Sparkles,
  Terminal,
  Cpu
} from 'lucide-react';

interface MessageItemProps {
  message: Message;
  onDispatchToAgent?: (toAgent: AgentType, content: string) => void;
}

export const MessageItem: React.FC<MessageItemProps> = ({ message, onDispatchToAgent }) => {
  const [showThinking, setShowThinking] = useState(false);
  const [copied, setCopied] = useState(false);

  const isUser = message.role === 'user';

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getAgentBadge = (agent: AgentType) => {
    switch (agent) {
      case 'antigravity':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono bg-neutral-800 text-neutral-300 border border-neutral-700/60">
            <Sparkles className="w-3 h-3 text-sky-400" />
            Antigravity
          </span>
        );
      case 'claude_code':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono bg-neutral-800 text-neutral-300 border border-neutral-700/60">
            <Terminal className="w-3 h-3 text-amber-400" />
            Claude Code
          </span>
        );
      case 'codex':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono bg-neutral-800 text-neutral-300 border border-neutral-700/60">
            <Cpu className="w-3 h-3 text-emerald-400" />
            Codex CLI
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono bg-neutral-800 text-neutral-300 border border-neutral-700/60">
            Orchestrator
          </span>
        );
    }
  };

  return (
    <div className={`py-4 px-4 sm:px-6 transition-colors border-b border-neutral-900 ${isUser ? 'bg-neutral-950/40' : 'bg-transparent'}`}>
      <div className="max-w-4xl mx-auto space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isUser ? (
              <div className="w-6 h-6 rounded bg-neutral-800 flex items-center justify-center text-neutral-300 border border-neutral-700">
                <User className="w-3.5 h-3.5" />
              </div>
            ) : (
              <div className="w-6 h-6 rounded bg-neutral-900 flex items-center justify-center text-neutral-300 border border-neutral-800">
                <Bot className="w-3.5 h-3.5" />
              </div>
            )}
            
            <span className="text-xs font-medium text-neutral-300">
              {isUser ? 'You' : getAgentBadge(message.agentType)}
            </span>
            
            <span className="text-[11px] font-mono text-neutral-600">
              {formatTimestamp(message.timestamp)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {!isUser && onDispatchToAgent && (
              <div className="flex items-center gap-1">
                <span className="text-[10px] uppercase text-neutral-600 font-mono tracking-wider">Handoff:</span>
                {(['antigravity', 'claude_code', 'codex'] as AgentType[])
                  .filter((a) => a !== message.agentType)
                  .map((target) => (
                    <button
                      key={target}
                      onClick={() => onDispatchToAgent(target, message.content)}
                      className="px-2 py-0.5 rounded text-[10px] font-mono border border-neutral-800 bg-neutral-900/60 hover:bg-neutral-800 hover:text-white text-neutral-400 transition-colors flex items-center gap-1"
                    >
                      <ArrowRight className="w-2.5 h-2.5" />
                      {target === 'claude_code' ? 'Claude' : target === 'antigravity' ? 'AGY' : 'Codex'}
                    </button>
                  ))}
              </div>
            )}
            <button
              onClick={handleCopy}
              className="text-neutral-500 hover:text-neutral-300 transition-colors p-1"
              title="Copy message content"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Collapsible Reasoning / Thinking */}
        {message.thinking && (
          <div className="rounded border border-neutral-800/80 bg-neutral-900/30 overflow-hidden">
            <button
              onClick={() => setShowThinking(!showThinking)}
              className="w-full flex items-center justify-between px-3 py-1.5 text-left text-xs font-mono text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/30 transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <BrainCircuit className="w-3.5 h-3.5 text-neutral-400" />
                <span className="text-[11px] font-medium tracking-wide uppercase">Thought Process</span>
              </div>
              {showThinking ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
            {showThinking && (
              <div className="px-3 py-2 border-t border-neutral-800/60 text-xs font-mono text-neutral-400 whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto bg-neutral-950/40">
                {message.thinking}
              </div>
            )}
          </div>
        )}

        {/* Tool Executions */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-600 font-semibold px-1">
              Tool Actions ({message.toolCalls.length})
            </div>
            {message.toolCalls.map((tool) => (
              <ToolExecutionCard key={tool.id} toolCall={tool} />
            ))}
          </div>
        )}

        {/* File Diffs */}
        {message.diffs && message.diffs.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-600 font-semibold px-1">
              Code Diffs ({message.diffs.length})
            </div>
            {message.diffs.map((diff, i) => (
              <DiffViewer key={i} diff={diff} />
            ))}
          </div>
        )}

        {/* Main Content Render */}
        <div className="text-neutral-200 text-sm leading-relaxed space-y-3 prose prose-invert max-w-none prose-pre:bg-neutral-900 prose-pre:border prose-pre:border-neutral-800">
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
                    <code className="px-1.5 py-0.5 rounded text-[12px] font-mono bg-neutral-900 text-neutral-300 border border-neutral-800" {...props}>
                      {children}
                    </code>
                  );
                }

                return (
                  <div className="my-2 rounded border border-neutral-800 bg-neutral-950 overflow-hidden font-mono text-xs not-prose">
                    {language && (
                      <div className="flex items-center justify-between px-3 py-1 bg-neutral-900 border-b border-neutral-800 text-[11px] text-neutral-400">
                        <span>{language}</span>
                        <button
                          onClick={() => navigator.clipboard.writeText(codeString)}
                          className="hover:text-white transition-colors"
                        >
                          Copy
                        </button>
                      </div>
                    )}
                    <pre className="p-3 overflow-x-auto text-neutral-300">
                      <code>{codeString}</code>
                    </pre>
                  </div>
                );
              },
              p({ children }) {
                return <p className="mb-2 last:mb-0">{children}</p>;
              },
              ul({ children }) {
                return <ul className="list-disc pl-5 mb-2 space-y-1 text-neutral-300">{children}</ul>;
              },
              ol({ children }) {
                return <ol className="list-decimal pl-5 mb-2 space-y-1 text-neutral-300">{children}</ol>;
              },
              h1({ children }) {
                return <h1 className="text-base font-semibold text-white mt-4 mb-2 pb-1 border-b border-neutral-800">{children}</h1>;
              },
              h2({ children }) {
                return <h2 className="text-sm font-semibold text-white mt-3 mb-1.5">{children}</h2>;
              },
              h3({ children }) {
                return <h3 className="text-xs font-semibold text-neutral-200 mt-2 mb-1">{children}</h3>;
              },
              blockquote({ children }) {
                return <blockquote className="border-l-2 border-neutral-700 pl-3 py-1 text-neutral-400 my-2 italic text-xs">{children}</blockquote>;
              }
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
};
