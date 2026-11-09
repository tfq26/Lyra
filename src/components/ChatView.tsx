import React, { useState, useRef, useEffect } from 'react';
import type { Message, AgentType, AgentRunOptions } from '../types';
import { MessageItem } from './MessageItem';
import { AgentSelector } from './AgentSelector';
import { ArrowUp, Loader2, Trash2, Square, Sparkles } from 'lucide-react';
import { MessageHistorySkeleton } from './Skeletons';

interface ChatViewProps {
  sessionTitle: string;
  messages: Message[];
  activeAgent: AgentType;
  onSelectAgent: (agent: AgentType) => void;
  onSendMessage: (content: string, agent: AgentType) => void;
  onDispatchToAgent: (toAgent: AgentType, content: string) => void;
  onClearSession?: () => void;
  onOpenFeedback?: () => void;
  isStreaming: boolean;
  agentStatuses: Record<AgentType, 'ready' | 'running' | 'idle' | 'offline'>;
  isLoadingMessages?: boolean;
  onCancelRun?: () => void;
  agentOptions: AgentRunOptions;
  onAgentOptionsChange: (options: AgentRunOptions) => void;
  agentCapabilities?: Record<string, { installed: boolean }>;
}

export const ChatView: React.FC<ChatViewProps> = ({
  sessionTitle,
  messages,
  activeAgent,
  onSelectAgent,
  onSendMessage,
  onDispatchToAgent,
  onClearSession,
  onOpenFeedback,
  isStreaming,
  agentStatuses,
  isLoadingMessages = false,
  onCancelRun,
  agentCapabilities = {},
}) => {
  const [prompt, setPrompt] = useState('');
  const mainRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const shouldAutoScrollRef = useRef(true);

  const handleScroll = () => {
    if (!mainRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = mainRef.current;
    shouldAutoScrollRef.current = scrollHeight - (scrollTop + clientHeight) < 100;
  };

  const scrollToBottom = (force = false) => {
    if ((force || shouldAutoScrollRef.current) && mainRef.current) {
      mainRef.current.scrollTop = mainRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isStreaming]);

  useEffect(() => {
    shouldAutoScrollRef.current = true;
    scrollToBottom(true);
  }, [sessionTitle]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!prompt.trim()) return;
    shouldAutoScrollRef.current = true;
    onSendMessage(prompt.trim(), activeAgent);
    setPrompt('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    setTimeout(() => scrollToBottom(true), 50);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
  };

  const handleInsertPrompt = (text: string) => {
    setPrompt(text);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const agentDisplayName = activeAgent === 'claude_code' ? 'Claude' : activeAgent === 'codex' ? 'Codex' : 'Antigravity';

  return (
    <div className="flex-1 flex flex-col h-screen bg-[#08080a]">
      {/* Calm, Professional Header */}
      <header 
        data-tauri-drag-region
        className="h-13 border-b border-neutral-800/60 px-5 flex items-center justify-between bg-[#08080a]/90 backdrop-blur-md z-10 select-none"
      >
        <div className="flex items-center gap-4">
          <AgentSelector
            activeAgent={activeAgent}
            onSelectAgent={onSelectAgent}
            statusMap={agentStatuses}
            capabilities={agentCapabilities}
          />
          <span className="text-xs text-neutral-500 truncate max-w-xs hidden md:inline">
            {sessionTitle}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {onOpenFeedback && (
            <button
              onClick={onOpenFeedback}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800/50 transition-colors text-xs font-medium"
              title="Request UI change or report issue (P0 Priority)"
            >
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              <span>Feedback</span>
            </button>
          )}

          {isStreaming && (
            <div className="flex items-center gap-2 text-xs text-neutral-400 mr-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-neutral-300" />
              <span>Generating...</span>
            </div>
          )}

          {isStreaming && onCancelRun && (
            <button
              onClick={onCancelRun}
              className="p-1.5 rounded-md text-neutral-500 hover:text-rose-400 hover:bg-neutral-800/50 transition-colors"
              title="Stop generation"
            >
              <Square className="w-4 h-4" />
            </button>
          )}

          {onClearSession && messages.length > 0 && (
            <button
              onClick={onClearSession}
              className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/50 transition-colors"
              title="Clear conversation"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* Messages Scroll Area */}
      <main ref={mainRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
        {isLoadingMessages ? (
          <MessageHistorySkeleton />
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto space-y-5 animate-fade-in">
            <div className="space-y-1.5">
              <h2 className="text-sm font-semibold text-neutral-100 tracking-tight">Lyra Console</h2>
              <p className="text-xs text-neutral-500 leading-relaxed">
                Autonomous pairing with {agentDisplayName}. Ask questions, dispatch tasks, or inspect code diffs.
              </p>
            </div>

            {/* Quiet Quick Actions */}
            <div className="flex flex-col w-full gap-2 pt-1 text-left">
              <button
                onClick={() =>
                  handleInsertPrompt(
                    'Analyze the architecture of this project and generate a Mermaid diagram.'
                  )
                }
                className="px-3.5 py-2.5 rounded-lg border border-neutral-800/70 bg-neutral-900/30 hover:bg-neutral-800/50 hover:border-neutral-700 transition-colors text-xs text-neutral-400 hover:text-neutral-200"
              >
                Analyze architecture and diagram dependencies
              </button>
              <button
                onClick={() =>
                  handleInsertPrompt(
                    'Review pending file diffs, explain the changes, and check test coverage.'
                  )
                }
                className="px-3.5 py-2.5 rounded-lg border border-neutral-800/70 bg-neutral-900/30 hover:bg-neutral-800/50 hover:border-neutral-700 transition-colors text-xs text-neutral-400 hover:text-neutral-200"
              >
                Review code changes and verify tests
              </button>
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto p-5 sm:p-8 space-y-6 animate-fade-in">
            {messages.map((message) => (
              <MessageItem
                key={message.id}
                message={message}
                onDispatchToAgent={onDispatchToAgent}
              />
            ))}
          </div>
        )}
      </main>

      {/* Input Area */}
      <footer className="p-4 sm:p-5 bg-[#08080a] border-t border-neutral-800/50">
        <div className="max-w-3xl mx-auto">
          <form
            onSubmit={handleSubmit}
            className="relative rounded-xl border border-neutral-800/80 bg-neutral-900/40 focus-within:border-neutral-700/90 focus-within:bg-neutral-900/70 transition-all shadow-xs"
          >
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder={`Message ${agentDisplayName}...`}
              rows={1}
              className="w-full bg-transparent px-4 py-3 pr-12 text-[13px] text-neutral-100 placeholder:text-neutral-600 focus:outline-none resize-none leading-relaxed"
              style={{ maxHeight: '180px' }}
            />

            <div className="absolute right-2.5 bottom-2.5 flex items-center">
              <button
                type="submit"
                disabled={!prompt.trim() || isStreaming}
                className="p-1.5 rounded-lg bg-neutral-100 text-neutral-950 hover:bg-white disabled:opacity-20 disabled:cursor-not-allowed transition-all"
                title="Send"
              >
                {isStreaming ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ArrowUp className="w-3.5 h-3.5 stroke-[2.5]" />
                )}
              </button>
            </div>
          </form>
        </div>
      </footer>
    </div>
  );
};
