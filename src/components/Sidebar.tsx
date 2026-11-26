import React, { useEffect, useRef, useState } from 'react';
import type { Session, AgentType } from '../types';
import { 
  Plus, 
  MessageSquare, 
  Network, 
  Search,
  HardDrive,
  FolderTree,
  Bell
} from 'lucide-react';
import { SessionListSkeleton } from './Skeletons';
import { isTauri, pickDirectory } from '../lib/platform';
import harpIcon from '../public/icons/harp-svgrepo-com.svg';
import type { AppNotification } from '../types';
import { NotificationList } from './NotificationCenter';

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
  notifications?: AppNotification[];
  onMarkNotificationsRead?: () => void;
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
  notifications = [],
  onMarkNotificationsRead,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sessionPaneRatio, setSessionPaneRatio] = useState(0.62);
  const sidebarContentRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);
  const isDesktop = isTauri();

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!resizingRef.current || !sidebarContentRef.current) return;
      const bounds = sidebarContentRef.current.getBoundingClientRect();
      const ratio = (event.clientY - bounds.top) / bounds.height;
      setSessionPaneRatio(Math.max(0.28, Math.min(0.82, ratio)));
    };
    const stopResize = () => { resizingRef.current = false; document.body.style.cursor = ''; };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    return () => { window.removeEventListener('pointermove', handlePointerMove); window.removeEventListener('pointerup', stopResize); };
  }, []);

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
            <img src={harpIcon} alt="" className="w-4 h-4" />
            <span className="font-medium text-xs text-neutral-200 tracking-tight">Lyra</span>
            <span className="text-[10px] text-neutral-600 font-mono">v{__APP_VERSION__}</span>
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

      {/* Chats and notifications split pane */}
      <div ref={sidebarContentRef} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-[140px] min-w-0 overflow-y-auto sidebar-scrollbar px-2 py-1 space-y-0.5" style={{ flex: `${sessionPaneRatio} 1 0%` }}>
          <div className="px-2 pt-2 pb-1 text-[10px] uppercase font-semibold text-neutral-600 tracking-wider">Chats</div>
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

        <div
          role="separator"
          aria-label="Resize chats and notifications"
          aria-valuemin={28}
          aria-valuemax={82}
          aria-valuenow={Math.round(sessionPaneRatio * 100)}
          tabIndex={0}
          onPointerDown={(event) => { event.preventDefault(); resizingRef.current = true; document.body.style.cursor = 'row-resize'; }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp') { event.preventDefault(); setSessionPaneRatio((value) => Math.max(0.28, value - 0.04)); }
            if (event.key === 'ArrowDown') { event.preventDefault(); setSessionPaneRatio((value) => Math.min(0.82, value + 0.04)); }
          }}
          className="group relative z-10 h-2 shrink-0 cursor-row-resize border-y border-neutral-800/60 bg-neutral-950 outline-none focus-visible:bg-neutral-800"
        >
          <div className="absolute left-1/2 top-1/2 h-px w-8 -translate-x-1/2 -translate-y-1/2 bg-neutral-700/70 transition-colors group-hover:bg-neutral-400" />
        </div>

        <div className="min-h-[120px] min-w-0 overflow-hidden bg-[#0b0b0d]" style={{ flex: `${1 - sessionPaneRatio} 1 0%` }}>
          <NotificationList notifications={notifications} onMarkAllRead={onMarkNotificationsRead || (() => undefined)} compact />
        </div>
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

        <div className="px-1.5 pt-1 border-t border-neutral-800/40 flex items-center gap-1.5 text-[10px] text-neutral-600">
          <Bell className="w-3 h-3" /><span>Drag the divider to resize chats and notifications</span>
        </div>
      </div>
    </aside>
  );
};
