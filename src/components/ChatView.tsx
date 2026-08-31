import React, { useState, useRef, useEffect } from 'react';
import type { Message, AgentType, AgentRunOptions } from '../types';
import { MessageItem } from './MessageItem';
import { AgentSelector } from './AgentSelector';
import { ArrowUp, Loader2, Trash2, Square } from 'lucide-react';
import { MessageHistorySkeleton } from './Skeletons';
import { AgentOptions } from './AgentOptions';

interface ChatViewProps {
  sessionTitle: string;
  messages: Message[];
  activeAgent: AgentType;
  onSelectAgent: (agent: AgentType) => void;
  onSendMessage: (content: string, agent: AgentType) => void;
  onDispatchToAgent: (toAgent: AgentType, content: string) => void;
  onClearSession?: () => void;
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
  isStreaming,
  agentStatuses,
  isLoadingMessages = false,
  onCancelRun,
  agentOptions,
  onAgentOptionsChange,
  agentCapabilities = {},
}) => {
  const [prompt, setPrompt] = useState('');
  const mainRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const shouldAutoScrollRef = useRef(true);

  const handleScroll = () => {
    if (!mainRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = mainRef.current;
    // Keep auto-scroll active if user is within 100px of bottom
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

  return (
    <div className="flex-1 flex flex-col h-screen bg-[#09090b]">
      {/* Calm Top Header */}
      <header 
        data-tauri-drag-region
        className="h-12 border-b border-neutral-800/70 px-4 flex items-center justify-between bg-[#09090b]/90 backdrop-blur-sm z-10 select-none"
      >
        <div className="flex items-center gap-3">
          <AgentSelector
            activeAgent={activeAgent}
            onSelectAgent={onSelectAgent}
            statusMap={agentStatuses}
            capabilities={agentCapabilities}
          />
          <span className="text-xs text-neutral-500 truncate max-w-xs hidden sm:inline">
            {sessionTitle}
          </span>
          <AgentOptions agent={activeAgent} options={agentOptions} onChange={onAgentOptionsChange} />
        </div>

        <div className="flex items-center gap-2">
          {isStreaming && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] text-neutral-400 bg-neutral-900 border border-neutral-800">
              <Loader2 className="w-3 h-3 animate-spin text-neutral-300" />
              <span>Thinking...</span>
            </div>
          )}

          {isStreaming && onCancelRun && (
            <button onClick={onCancelRun} className="p-1.5 rounded-md text-neutral-500 hover:text-rose-300 hover:bg-neutral-800/50 transition-colors" title="Cancel run">
              <Square className="w-3.5 h-3.5" />
            </button>
          )}

          {onClearSession && messages.length > 0 && (
            <button
              onClick={onClearSession}
              className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/50 transition-colors"
              title="Clear messages"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </header>

      {/* Messages area */}
      <main ref={mainRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
        {isLoadingMessages ? (
          <MessageHistorySkeleton />
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-6 text-center max-w-lg mx-auto space-y-4 animate-fade-in">
            <div className="space-y-1">
              <h2 className="text-sm font-medium text-neutral-200">Unified Agent Workspace</h2>
              <p className="text-xs text-neutral-500 leading-relaxed">
                Seamlessly interact with Antigravity, Claude Code, and Codex in a unified workspace.
              </p>
            </div>

            {/* Subtle quick prompts */}
            <div className="flex flex-wrap items-center justify-center gap-1.5 pt-2">
              <button
                onClick={() =>
                  handleInsertPrompt(
                    'Analyze the architecture of this project and generate a Mermaid diagram.'
                  )
                }
                className="px-2.5 py-1.5 rounded-md border border-neutral-800 bg-neutral-900/40 hover:bg-neutral-800/60 hover:border-neutral-700 transition-colors text-neutral-400 hover:text-neutral-200 text-xs text-left"
              >
                Generate architecture diagram
              </button>
              <button
                onClick={() =>
                  handleInsertPrompt(
                    'Review pending file diffs, explain the changes, and check test coverage.'
                  )
                }
                className="px-2.5 py-1.5 rounded-md border border-neutral-800 bg-neutral-900/40 hover:bg-neutral-800/60 hover:border-neutral-700 transition-colors text-neutral-400 hover:text-neutral-200 text-xs text-left"
              >
                Review code diffs
              </button>
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6 animate-fade-in">
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

      {/* Input area */}
      <footer className="p-4 bg-[#09090b] border-t border-neutral-800/70">
        <div className="max-w-3xl mx-auto">
          <form
            onSubmit={handleSubmit}
            className="relative rounded-lg border border-neutral-800 bg-neutral-900/60 focus-within:border-neutral-700 focus-within:bg-neutral-900 transition-all shadow-sm"
          >
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder={`Ask ${activeAgent === 'claude_code' ? 'Claude' : activeAgent === 'codex' ? 'Codex' : 'Antigravity'}...`}
              rows={1}
              className="w-full bg-transparent px-3.5 py-2.5 pr-10 text-xs text-neutral-100 placeholder:text-neutral-600 focus:outline-none resize-none"
              style={{ maxHeight: '180px' }}
            />

            <div className="absolute right-2 bottom-2 flex items-center">
              <button
                type="submit"
                disabled={!prompt.trim() || isStreaming}
                className="p-1 rounded-md bg-neutral-200 text-neutral-950 hover:bg-white disabled:opacity-20 disabled:cursor-not-allowed transition-all"
                title="Send instruction"
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
