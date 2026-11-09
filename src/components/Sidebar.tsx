import React, { useState } from 'react';
import type { Session, AgentType } from '../types';
import { 
  Plus, 
  MessageSquare, 
  Network, 
  Search,
  Folder,
  HardDrive,
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
  storagePath,
  onOpenStorageConfig,
  isLoadingSessions = false,
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

  return (
    <aside className="w-64 h-screen bg-[#08080a] border-r border-neutral-800/60 flex flex-col justify-between select-none text-xs">
      {/* Top Header */}
      <div>
        <div 
          data-tauri-drag-region
          className={`h-13 px-3.5 flex items-center justify-between border-b border-neutral-800/50 ${isDesktop ? 'pl-20' : ''}`}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-5 h-5 rounded-md bg-neutral-100 flex items-center justify-center text-neutral-950 font-semibold text-[11px]">
              L
            </div>
            <span className="font-semibold text-[13px] text-neutral-100 tracking-tight">Lyra</span>
          </div>

          <button
            onClick={onCreateSession}
            className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800/50 transition-colors"
            title="New Chat (Cmd+N)"
            aria-label="New session"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Primary View Navigation */}
        <div className="p-2 space-y-0.5 border-b border-neutral-800/40">
          <button
            onClick={() => onSelectTab('chat')}
            className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md transition-colors text-left text-xs ${
              activeTab === 'chat'
                ? 'bg-neutral-800/70 text-neutral-100 font-medium'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/30'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5 text-neutral-400" />
            <span>Chat</span>
          </button>
          
          <button
            onClick={() => onSelectTab('bridge')}
            className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md transition-colors text-left text-xs ${
              activeTab === 'bridge'
                ? 'bg-neutral-800/70 text-neutral-100 font-medium'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/30'
            }`}
          >
            <Network className="w-3.5 h-3.5 text-neutral-400" />
            <span>Agent Bridge</span>
          </button>
        </div>

        {/* Search */}
        <div className="px-2 pt-2.5 pb-1">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-neutral-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter sessions..."
              className="w-full bg-neutral-900/40 border border-neutral-800/70 rounded-md pl-8 pr-2.5 py-1 text-xs text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-neutral-700 transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto sidebar-scrollbar px-2 py-1 space-y-0.5">
        <div className="px-2.5 pt-3 pb-1 text-[10px] uppercase font-semibold text-neutral-500 tracking-wider">
          Sessions
        </div>
        {isLoadingSessions ? (
          <SessionListSkeleton />
        ) : filteredSessions.length === 0 ? (
          <div className="px-2.5 py-3 text-neutral-600 text-xs">No sessions found</div>
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
                <span className="truncate">{session.title || session.id}</span>
              </button>
            );
          })
        )}
      </div>

      {/* Quiet, Professional Footer */}
      <div className="p-2.5 border-t border-neutral-800/50 space-y-1 bg-[#08080a]">
        <button
          onClick={handleChooseFolder}
          className="w-full text-left px-2 py-1.5 rounded-md hover:bg-neutral-800/40 text-neutral-400 hover:text-neutral-200 transition-colors flex items-center justify-between group"
          title={`Working Directory: ${workingDirectory}`}
        >
          <div className="flex items-center gap-2 truncate">
            <Folder className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
            <span className="truncate text-xs">
              {workingDirectory.split('/').pop() || workingDirectory}
            </span>
          </div>
          <span className="text-[10px] text-neutral-600 group-hover:text-neutral-400">
            {isDesktop ? 'Browse' : 'Path'}
          </span>
        </button>

        <button
          onClick={onOpenStorageConfig}
          className="w-full text-left px-2 py-1.5 rounded-md hover:bg-neutral-800/40 text-neutral-500 hover:text-neutral-300 transition-colors flex items-center gap-2 text-xs"
          title={`Storage: ${storagePath}`}
        >
          <HardDrive className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
          <span className="truncate text-[11px] text-neutral-500">
            {storagePath.replace(/^\/Users\/[^/]+/, '~')}
          </span>
        </button>
      </div>
    </aside>
  );
};
