import React, { useState } from 'react';
import type { Session, AgentType } from '../types';
import { 
  Plus, 
  MessageSquare, 
  Network, 
  Search,
  HardDrive,
  FolderTree,
  Terminal,
  Play,
  CheckCircle2
} from 'lucide-react';
import { SessionListSkeleton } from './Skeletons';
import { isTauri, pickDirectory } from '../lib/platform';

interface SidebarProps {
  sessions: Session[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  activeTab: 'chat' | 'bridge' | 'artifacts';
  onSelectTab: (tab: 'chat' | 'bridge' | 'artifacts') => void;
  workingDirectory: string;
  onSelectWorkingDirectory?: (path: string) => void;
  agentStatuses: Record<AgentType, 'ready' | 'running' | 'idle' | 'offline'>;
  storagePath: string;
  onOpenStorageConfig: () => void;
  isLoadingSessions?: boolean;
  onStartCli?: (agent: AgentType) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onCreateSession,
  activeTab,
  onSelectTab,
  workingDirectory,
  onSelectWorkingDirectory,
  agentStatuses,
  storagePath,
  onOpenStorageConfig,
  isLoadingSessions = false,
  onStartCli,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const isDesktop = isTauri();

  const handleChooseFolder = async () => {
    const selected = await pickDirectory(workingDirectory);
    if (selected && onSelectWorkingDirectory) {
      onSelectWorkingDirectory(selected);
    }
  };

  const filteredSessions = [...sessions]
    .filter((s) => {
      return (
        s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.id.toLowerCase().includes(searchQuery.toLowerCase())
      );
    })
    .sort((a, b) => {
      const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return timeB - timeA;
    });

  const isAnyRunning = Object.values(agentStatuses).some((s) => s === 'running');

  return (
    <aside className="w-60 h-screen bg-[#09090b] border-r border-neutral-800/70 flex flex-col justify-between select-none text-xs">
      {/* Top Header */}
      <div>
        <div 
          data-tauri-drag-region
          className={`h-12 px-3 flex items-center justify-between border-b border-neutral-800/70 ${isDesktop ? 'pl-20' : ''}`}
        >
          <div className="flex items-center gap-2 pointer-events-none">
            <div className="w-4 h-4 rounded bg-neutral-100 flex items-center justify-center text-[#09090b] font-bold text-[10px]">
              L
            </div>
            <span className="font-medium text-xs text-neutral-200 tracking-tight">Lyra</span>
            {isDesktop && (
              <span className="px-1.5 py-0.2 rounded text-[9px] bg-neutral-800 border border-neutral-700/60 text-neutral-400 font-medium">
                App
              </span>
            )}
          </div>

          <button
            onClick={onCreateSession}
            className="p-1 rounded text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800/60 transition-colors pointer-events-auto"
            title="New Chat (Cmd+N)"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Primary View Navigation */}
        <div className="p-2 space-y-0.5 border-b border-neutral-800/50">
          <button
            onClick={() => onSelectTab('chat')}
            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md transition-colors text-left text-xs ${
              activeTab === 'chat'
                ? 'bg-neutral-800/80 text-neutral-100 font-medium'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/30'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Console</span>
          </button>
          
          <button
            onClick={() => onSelectTab('bridge')}
            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md transition-colors text-left text-xs ${
              activeTab === 'bridge'
                ? 'bg-neutral-800/80 text-neutral-100 font-medium'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/30'
            }`}
          >
            <Network className="w-3.5 h-3.5" />
            <span>Agent Bridge</span>
          </button>
        </div>

        {/* Search */}
        <div className="px-2 pt-2 pb-1">
          <div className="relative">
            <Search className="w-3 h-3 absolute left-2.5 top-2 text-neutral-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="w-full bg-neutral-900/60 border border-neutral-800/80 rounded-md pl-7 pr-2.5 py-1 text-xs text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-neutral-700"
            />
          </div>
        </div>
      </div>

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto sidebar-scrollbar px-2 py-1 space-y-0.5">
        <div className="px-2 pt-2 pb-1 text-[10px] uppercase font-semibold text-neutral-600 tracking-wider">
          Sessions
        </div>
        {isLoadingSessions ? (
          <SessionListSkeleton />
        ) : filteredSessions.length === 0 ? (
          <div className="px-2 py-2 text-neutral-600 text-[11px]">No sessions</div>
        ) : (
          filteredSessions.map((session) => {
            const isSelected = session.id === activeSessionId && activeTab === 'chat';
            return (
              <button
                key={session.id}
                onClick={() => {
                  onSelectSession(session.id);
                  onSelectTab('chat');
                }}
                className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs transition-colors flex items-center justify-between group ${
                  isSelected
                    ? 'bg-neutral-800/80 text-neutral-100 font-medium'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/30'
                }`}
              >
                <div className="truncate pr-2">{session.title || session.id}</div>
                {session.messages.length > 0 && (
                  <span className="text-[10px] text-neutral-600 group-hover:text-neutral-500">
                    {session.messages.length}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>

      {/* Calm Footer: Storage & Workspace status */}
      <div className="p-2.5 border-t border-neutral-800/70 space-y-2 bg-[#09090b]">
        {/* Workspace directory picker */}
        <button
          onClick={handleChooseFolder}
          className="w-full text-left p-1.5 rounded-md hover:bg-neutral-800/40 text-neutral-400 hover:text-neutral-200 transition-colors flex items-center justify-between group"
          title={`Working Directory: ${workingDirectory} (Click to change)`}
        >
          <div className="flex items-center gap-1.5 truncate">
            <FolderTree className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
            <span className="truncate max-w-[130px] text-[11px]">
              {workingDirectory.split('/').pop() || workingDirectory}
            </span>
          </div>
          <span className="text-[10px] text-neutral-600 group-hover:text-neutral-400">
            {isDesktop ? 'Browse' : 'Path'}
          </span>
        </button>

        {/* Local CLI Engine Status / Startup Bar */}
        <div className="px-1.5 pt-1 border-t border-neutral-800/40 flex items-center justify-between text-[11px] text-neutral-500">
          <div className="flex items-center gap-1.5">
            <Terminal className="w-3 h-3 text-neutral-500" />
            <span className="text-[10px] text-neutral-400">Local CLIs:</span>
          </div>

          <div className="flex items-center gap-1">
            {(['antigravity', 'claude_code', 'codex'] as AgentType[]).map((agent) => {
              const status = agentStatuses[agent];
              const isRunning = status === 'running';
              const label = agent === 'claude_code' ? 'C' : agent === 'codex' ? 'X' : 'A';
              const name = agent === 'claude_code' ? 'Claude' : agent === 'codex' ? 'Codex' : 'Antigravity';

              return (
                <button
                  key={agent}
                  onClick={() => onStartCli && onStartCli(agent)}
                  className={`px-1.5 py-0.5 rounded text-[9px] font-medium border transition-colors flex items-center gap-1 ${
                    isRunning
                      ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                      : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700'
                  }`}
                  title={`${name} CLI (${status}) - Click to start/check`}
                >
                  <span className={`w-1 h-1 rounded-full ${isRunning ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`} />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
};

