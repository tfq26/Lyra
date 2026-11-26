import React from 'react';
import { Bell, CheckCheck, CircleAlert, CircleCheck, Info, XCircle } from 'lucide-react';
import type { AppNotification } from '../types';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from './ui/popover';

interface NotificationCenterProps {
  notifications: AppNotification[];
  onMarkAllRead: () => void;
}

interface NotificationListProps {
  notifications: AppNotification[];
  onMarkAllRead: () => void;
  compact?: boolean;
}

const levelIcon = {
  info: <Info className="size-3.5 text-sky-400" />,
  success: <CircleCheck className="size-3.5 text-emerald-400" />,
  warning: <CircleAlert className="size-3.5 text-amber-400" />,
  error: <XCircle className="size-3.5 text-rose-400" />,
};

export const NotificationList: React.FC<NotificationListProps> = ({ notifications, onMarkAllRead, compact = false }) => (
  <div className="flex min-h-0 flex-1 flex-col">
    <div className={`flex items-center justify-between border-b border-neutral-800/70 ${compact ? 'px-2.5 py-2' : 'px-3 py-2.5'}`}>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium text-neutral-300">Notifications</span>
        {notifications.length > 0 && <Badge variant="outline" className="h-4 rounded px-1 text-[9px] text-neutral-500">{notifications.length}</Badge>}
      </div>
      {notifications.some((notification) => !notification.read) && <Button variant="ghost" size="xs" onClick={onMarkAllRead} className="h-5 px-1.5 text-[10px] text-neutral-500 hover:text-neutral-200"><CheckCheck /> Read all</Button>}
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto">
      {notifications.length === 0 ? (
        <div className="flex h-full items-center justify-center px-3 text-center text-[11px] text-neutral-600">No recent activity</div>
      ) : notifications.map((notification) => (
        <div key={notification.id} className={`flex gap-2 border-b border-neutral-900/80 px-3 py-2.5 ${notification.read ? 'opacity-55' : ''}`}>
          <div className="mt-0.5 shrink-0">{levelIcon[notification.level]}</div>
          <div className="min-w-0">
            <div className="truncate text-[11px] font-medium text-neutral-300">{notification.title}</div>
            <div className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-neutral-500">{notification.message}</div>
            <div className="mt-1 text-[9px] text-neutral-700">{new Date(notification.createdAt).toLocaleTimeString()}</div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

export const NotificationCenter: React.FC<NotificationCenterProps> = ({ notifications, onMarkAllRead }) => {
  const unreadCount = notifications.filter((notification) => !notification.read).length;
  return (
    <Popover onOpenChange={(open) => { if (open) onMarkAllRead(); }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative text-neutral-400 hover:text-neutral-100" aria-label="Open notifications">
          <Bell />
          {unreadCount > 0 && <Badge variant="destructive" className="absolute -right-1 -top-1 h-4 min-w-4 justify-center px-1 text-[9px]">{unreadCount > 9 ? '9+' : unreadCount}</Badge>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 border-neutral-800 bg-[#111113] p-0 text-neutral-200">
        <PopoverHeader className="flex-row items-center justify-between border-b border-neutral-800 px-3 py-2">
          <PopoverTitle className="text-xs">Notifications</PopoverTitle>
          {notifications.length > 0 && <Button variant="ghost" size="xs" onClick={onMarkAllRead} className="text-[10px] text-neutral-500"> <CheckCheck /> Read all</Button>}
        </PopoverHeader>
        <NotificationList notifications={notifications} onMarkAllRead={onMarkAllRead} />
      </PopoverContent>
    </Popover>
  );
};
