import React, { useState, useRef, useEffect } from 'react';
import type { Message, AgentType } from '../types';
import { MessageItem } from './MessageItem';
import { AgentSelector } from './AgentSelector';
import { ArrowUp, Loader2, Sparkles, FileCode2, Workflow, TerminalSquare, Network, Eraser } from 'lucide-react';

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
}) => {
  const [prompt, setPrompt] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isStreaming]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!prompt.trim() || isStreaming) return;
    onSendMessage(prompt.trim(), activeAgent);
    setPrompt('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
  };

  const handleInsertTemplate = (text: string) => {
    setPrompt(text);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  return (
    <div className="flex-1 flex flex-col h-screen bg-neutral-950">
      {/* Top Bar */}
      <header className="h-12 border-b border-neutral-900 px-4 flex items-center justify-between bg-neutral-950/80 backdrop-blur z-10">
        <div className="flex items-center gap-3">
          <AgentSelector
            activeAgent={activeAgent}
            onSelectAgent={onSelectAgent}
            statusMap={agentStatuses}
          />
          <div className="h-4 w-px bg-neutral-800 hidden sm:block" />
          <span className="text-xs font-mono text-neutral-400 truncate max-w-xs hidden sm:inline">
            {sessionTitle}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {isStreaming && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono bg-amber-950/30 border border-amber-800/50 text-amber-300">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Processing...</span>
            </div>
          )}

          {onClearSession && messages.length > 0 && (
            <button
              onClick={onClearSession}
              className="p-1 rounded text-neutral-500 hover:text-neutral-300 hover:bg-neutral-900 transition-colors"
              title="Clear current view"
            >
              <Eraser className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </header>

      {/* Messages area */}
      <main className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-6 text-center max-w-xl mx-auto space-y-6">
            <div className="w-10 h-10 rounded border border-neutral-800 bg-neutral-900 flex items-center justify-center text-neutral-300">
              <Sparkles className="w-5 h-5" />
            </div>
            
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-neutral-200">Unified Multi-Agent Workspace</h2>
              <p className="text-xs text-neutral-500 max-w-md">
                All CLI chats from Antigravity, Claude Code, and Codex are unified in this session. Ask for system diagrams, review code diffs, or execute handoffs.
              </p>
            </div>

            {/* Quick Starters */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full text-left font-mono text-xs">
              <button
                onClick={() =>
                  handleInsertTemplate(
                    'Analyze the architecture of this project and generate a detailed Mermaid system diagram.'
                  )
                }
                className="p-3 rounded border border-neutral-900 bg-neutral-900/40 hover:bg-neutral-900 hover:border-neutral-800 transition-all text-neutral-300 space-y-1 group"
              >
                <div className="flex items-center gap-1.5 font-medium text-neutral-200">
                  <Workflow className="w-3.5 h-3.5 text-sky-400" />
                  Generate Architecture Diagram
                </div>
                <div className="text-[11px] text-neutral-500 truncate">
                  Visualizes system flows in Mermaid
                </div>
              </button>

              <button
                onClick={() =>
                  handleInsertTemplate(
                    'Plan the refactor of our service layer, break down the tasks into steps, and generate the diffs.'
                  )
                }
                className="p-3 rounded border border-neutral-900 bg-neutral-900/40 hover:bg-neutral-900 hover:border-neutral-800 transition-all text-neutral-300 space-y-1 group"
              >
                <div className="flex items-center gap-1.5 font-medium text-neutral-200">
                  <FileCode2 className="w-3.5 h-3.5 text-amber-400" />
                  Plan & Review Diffs
                </div>
                <div className="text-[11px] text-neutral-500 truncate">
                  Collapsible thoughts & side-by-side diffs
                </div>
              </button>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-neutral-900">
            {messages.map((message) => (
              <MessageItem
                key={message.id}
                message={message}
                onDispatchToAgent={onDispatchToAgent}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </main>

      {/* Input area */}
      <footer className="p-4 border-t border-neutral-900 bg-neutral-950 space-y-2">
        <div className="max-w-4xl mx-auto space-y-2">
          {/* Quick command shortcut pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto text-[11px] font-mono text-neutral-500">
            <span className="text-[10px] uppercase font-semibold text-neutral-600 tracking-wider">Quick:</span>
            <button
              onClick={() => handleInsertTemplate('/diagram Create a system architecture diagram for our codebase')}
              className="px-2 py-0.5 rounded border border-neutral-800/80 bg-neutral-900/40 hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              /diagram
            </button>
            <button
              onClick={() => handleInsertTemplate('/handoff Hand off architecture specification to Claude Code for execution')}
              className="px-2 py-0.5 rounded border border-neutral-800/80 bg-neutral-900/40 hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              /handoff
            </button>
            <button
              onClick={() => handleInsertTemplate('/diff Review pending file diffs and verify test coverage with Codex')}
              className="px-2 py-0.5 rounded border border-neutral-800/80 bg-neutral-900/40 hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              /diff
            </button>
          </div>

          <form
            onSubmit={handleSubmit}
            className="relative rounded-lg border border-neutral-800 bg-neutral-900/50 focus-within:border-neutral-700 transition-colors"
          >
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder={`Send instruction to ${activeAgent}... (Enter to send, Shift+Enter for newline)`}
              rows={1}
              className="w-full bg-transparent px-3.5 py-3 pr-12 text-xs text-neutral-200 placeholder:text-neutral-600 focus:outline-none resize-none font-sans"
              style={{ maxHeight: '200px' }}
            />

            <div className="absolute right-2 bottom-2 flex items-center gap-1">
              <button
                type="submit"
                disabled={!prompt.trim() || isStreaming}
                className="p-1.5 rounded bg-neutral-100 text-neutral-950 hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
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

          <div className="flex items-center justify-between text-[11px] font-mono text-neutral-600 px-1">
            <span>Engine: {activeAgent}</span>
            <span>Return to send • Shift+Return for newline</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
