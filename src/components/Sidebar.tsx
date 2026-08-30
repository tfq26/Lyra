import React, { useState } from 'react';
import type { Session, AgentType } from '../types';
import { 
  FolderGit2, 
  Plus, 
  MessageSquare, 
  Network, 
  Sparkles, 
  Terminal, 
  Cpu,
  Search,
  HardDrive,
  Settings
} from 'lucide-react';

interface SidebarProps {
  sessions: Session[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  activeTab: 'chat' | 'bridge' | 'artifacts';
  onSelectTab: (tab: 'chat' | 'bridge' | 'artifacts') => void;
  workingDirectory: string;
  agentStatuses: Record<AgentType, 'ready' | 'running' | 'idle' | 'offline'>;
  storagePath: string;
  onOpenStorageConfig: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onCreateSession,
  activeTab,
  onSelectTab,
  workingDirectory,
  agentStatuses,
  storagePath,
  onOpenStorageConfig,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [agentFilter, setAgentFilter] = useState<'all' | AgentType>('all');

  const getAgentDot = (status: 'ready' | 'running' | 'idle' | 'offline') => {
    switch (status) {
      case 'running':
        return 'bg-amber-400 animate-pulse';
      case 'ready':
        return 'bg-emerald-400';
      default:
        return 'bg-neutral-600';
    }
  };

  const filteredSessions = sessions.filter((s) => {
    const matchesSearch = s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesAgent = agentFilter === 'all' || s.activeAgent === agentFilter;
    return matchesSearch && matchesAgent;
  });

  return (
    <aside className="w-64 h-screen bg-neutral-950 border-r border-neutral-900 flex flex-col justify-between select-none text-xs font-mono">
      {/* Top Header */}
      <div className="p-3 border-b border-neutral-900 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-neutral-100 text-neutral-950 flex items-center justify-center font-bold text-[11px]">
              L
            </div>
            <span className="font-semibold tracking-wider text-sm text-neutral-100">LYRA</span>
            <span className="text-[10px] text-neutral-600 px-1 py-0.5 rounded border border-neutral-800">
              v0.1
            </span>
          </div>

          <button
            onClick={onCreateSession}
            className="p-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-900 border border-neutral-800 transition-colors"
            title="New Session"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Unified Storage location trigger */}
        <button
          onClick={onOpenStorageConfig}
          className="w-full text-left p-2 rounded bg-neutral-900/60 hover:bg-neutral-900 border border-neutral-800/80 hover:border-neutral-700 transition-all space-y-1 group"
          title={`Click to change storage directory: ${storagePath}`}
        >
          <div className="flex items-center justify-between text-neutral-500 text-[10px] uppercase tracking-wider font-semibold">
            <span className="flex items-center gap-1.5">
              <HardDrive className="w-3 h-3 text-sky-400" />
              Unified Storage
            </span>
            <Settings className="w-3 h-3 text-neutral-500 group-hover:text-neutral-300 transition-colors" />
          </div>
          <div className="text-neutral-300 text-[11px] truncate font-sans">
            {storagePath.split('/').slice(-2).join('/') || storagePath}
          </div>
        </button>
      </div>

      {/* Navigation tabs */}
      <div className="p-2 border-b border-neutral-900 space-y-0.5">
        <button
          onClick={() => onSelectTab('chat')}
          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded transition-colors text-left ${
            activeTab === 'chat'
              ? 'bg-neutral-900 text-white font-medium'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/40'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span className="flex-1">Console & Chat</span>
        </button>
        
        <button
          onClick={() => onSelectTab('bridge')}
          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded transition-colors text-left ${
            activeTab === 'bridge'
              ? 'bg-neutral-900 text-white font-medium'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/40'
          }`}
        >
          <Network className="w-3.5 h-3.5 text-purple-400" />
          <span className="flex-1">Agent Bridge</span>
        </button>
      </div>

      {/* Search & Filter Bar */}
      <div className="px-2 pt-2 space-y-2">
        <div className="relative">
          <Search className="w-3 h-3 absolute left-2.5 top-2.5 text-neutral-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search sessions..."
            className="w-full bg-neutral-900/80 border border-neutral-800 rounded pl-7 pr-2.5 py-1.5 text-[11px] text-neutral-300 placeholder:text-neutral-600 focus:outline-none focus:border-neutral-700 font-sans"
          />
        </div>

        {/* Engine filter pills */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 text-[10px]">
          {(['all', 'antigravity', 'claude_code', 'codex'] as const).map((agent) => (
            <button
              key={agent}
              onClick={() => setAgentFilter(agent)}
              className={`px-1.5 py-0.5 rounded capitalize whitespace-nowrap transition-colors ${
                agentFilter === agent
                  ? 'bg-neutral-800 text-white border border-neutral-700'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {agent === 'all' ? 'All' : agent === 'antigravity' ? 'AGY' : agent === 'claude_code' ? 'Claude' : 'Codex'}
            </button>
          ))}
        </div>
      </div>

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filteredSessions.length === 0 ? (
          <div className="px-2 py-3 text-neutral-600 text-[11px]">No sessions found.</div>
        ) : (
          filteredSessions.map((session) => {
            const isSelected = session.id === activeSessionId;
            return (
              <button
                key={session.id}
                onClick={() => onSelectSession(session.id)}
                className={`w-full text-left px-2.5 py-2 rounded text-xs transition-colors flex items-center justify-between group ${
                  isSelected
                    ? 'bg-neutral-900 text-neutral-100 font-medium border border-neutral-800'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/40'
                }`}
              >
                <div className="truncate pr-2 font-sans">{session.title || session.id}</div>
                <span className="text-[10px] text-neutral-600 group-hover:text-neutral-400 font-mono">
                  {session.messages.length}
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* Connected CLI Agents status bar */}
      <div className="p-3 border-t border-neutral-900 space-y-2 bg-neutral-950">
        <div className="text-[10px] uppercase text-neutral-600 font-semibold tracking-wider">
          Active CLI Adapters
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-neutral-400">
            <span className="flex items-center gap-1.5 text-[11px]">
              <Sparkles className="w-3 h-3 text-sky-400" />
              Antigravity Adapter
            </span>
            <span className={`w-2 h-2 rounded-full ${getAgentDot(agentStatuses.antigravity)}`} />
          </div>

          <div className="flex items-center justify-between text-neutral-400">
            <span className="flex items-center gap-1.5 text-[11px]">
              <Terminal className="w-3 h-3 text-amber-400" />
              Claude Adapter
            </span>
            <span className={`w-2 h-2 rounded-full ${getAgentDot(agentStatuses.claude_code)}`} />
          </div>

          <div className="flex items-center justify-between text-neutral-400">
            <span className="flex items-center gap-1.5 text-[11px]">
              <Cpu className="w-3 h-3 text-emerald-400" />
              Codex Adapter
            </span>
            <span className={`w-2 h-2 rounded-full ${getAgentDot(agentStatuses.codex)}`} />
          </div>
        </div>
      </div>
    </aside>
  );
};
