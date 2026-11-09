import React from 'react';

export const SessionListSkeleton: React.FC = () => {
  return (
    <div className="space-y-1 px-1 py-1 animate-fade-in">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div
          key={i}
          className="w-full px-2.5 py-2 rounded-md bg-neutral-900/40 border border-neutral-900/80 flex items-center justify-between"
        >
          <div
            className="h-3 rounded animate-shimmer bg-neutral-800/60"
            style={{ width: `${45 + ((i * 17) % 40)}%` }}
          />
          <div className="h-2 w-5 rounded animate-shimmer bg-neutral-800/40" />
        </div>
      ))}
    </div>
  );
};

export const MessageHistorySkeleton: React.FC = () => {
  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6 animate-fade-in">
      {/* User prompt skeleton (right-aligned compact bubble) */}
      <div className="flex flex-col items-end w-full space-y-1">
        <div className="h-2 w-12 rounded animate-shimmer bg-neutral-800/40 mr-1" />
        <div className="w-1/2 sm:w-1/3 rounded-xl rounded-tr-xs bg-neutral-800/70 border border-neutral-700/40 px-3 py-2 space-y-1.5">
          <div className="h-2.5 w-full rounded animate-shimmer bg-neutral-700/50" />
          <div className="h-2.5 w-3/4 rounded animate-shimmer bg-neutral-700/40" />
        </div>
      </div>

      {/* Assistant response skeleton (left-aligned) */}
      <div className="flex flex-col items-start w-full space-y-2.5">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full animate-shimmer bg-neutral-800/80" />
          <div className="h-2.5 w-16 rounded animate-shimmer bg-neutral-800/60" />
          <div className="h-2 w-12 rounded animate-shimmer bg-neutral-800/30" />
        </div>

        {/* Quiet reasoning indicator skeleton */}
        <div className="h-5 w-32 rounded border border-neutral-800/60 bg-neutral-900/40 animate-shimmer ml-7" />

        <div className="space-y-2 pt-1 pl-7 w-full max-w-2xl">
          <div className="h-3.5 w-full rounded animate-shimmer bg-neutral-800/60" />
          <div className="h-3.5 w-11/12 rounded animate-shimmer bg-neutral-800/50" />
          <div className="h-3.5 w-4/5 rounded animate-shimmer bg-neutral-800/40" />
        </div>
      </div>
    </div>
  );
};
