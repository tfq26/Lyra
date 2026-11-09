import React, { useState } from 'react';
import { X, Send, CheckCircle2, Loader2, Sparkles } from 'lucide-react';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const FeedbackModal: React.FC<FeedbackModalProps> = ({ isOpen, onClose }) => {
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<'ui-bug' | 'layout-polish' | 'feature-request'>('layout-polish');
  const [autoDispatch, setAutoDispatch] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedTicketId, setSubmittedTicketId] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) return;

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, category, autoDispatch }),
      });

      if (res.ok) {
        const data = await res.json();
        setSubmittedTicketId(data.ticket?.id || 'FEEDBACK-RECORDED');
        setTimeout(() => {
          setDescription('');
          setSubmittedTicketId(null);
          onClose();
        }, 2200);
      }
    } catch (err) {
      console.error('Failed to submit feedback:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fade-in select-none">
      <div className="w-full max-w-md rounded-xl border border-neutral-800 bg-[#0c0c0e] p-5 shadow-2xl text-xs space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-neutral-800/60">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <span className="font-semibold text-sm text-neutral-100">Direct User Feedback (P0)</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800/50 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {submittedTicketId ? (
          <div className="py-6 flex flex-col items-center justify-center space-y-2 text-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 animate-bounce" />
            <p className="font-medium text-neutral-100 text-sm">Feedback Received & Prioritized</p>
            <p className="text-neutral-500 text-xs font-mono">{submittedTicketId}</p>
            <p className="text-neutral-400 text-xs pt-1">Lyra's autonomous swarm has queued this task for implementation.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-neutral-400 font-medium mb-1.5">
                What would you like Lyra to improve or fix?
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., 'Make the sidebar search bar rounded and increase contrast on active sessions' or 'Add a shortcut key for clear conversation'"
                rows={3}
                required
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:border-neutral-700 leading-relaxed resize-none"
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <span className="text-neutral-400 font-medium block">Category</span>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as any)}
                  className="rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1 text-neutral-200 focus:outline-none"
                >
                  <option value="layout-polish">UI / Layout Polish</option>
                  <option value="ui-bug">UI Bug</option>
                  <option value="feature-request">New Feature</option>
                </select>
              </div>

              <label className="flex items-center gap-2 cursor-pointer pt-4">
                <input
                  type="checkbox"
                  checked={autoDispatch}
                  onChange={(e) => setAutoDispatch(e.target.checked)}
                  className="rounded border-neutral-800 bg-neutral-900 text-cyan-500 focus:ring-0"
                />
                <span className="text-neutral-300">Auto-dispatch swarm</span>
              </label>
            </div>

            <p className="text-[11px] text-neutral-500 leading-normal border-t border-neutral-800/40 pt-2.5">
              User feedback is treated as <strong>P0 (Highest Priority)</strong>. The autonomous swarm runs verification tests (<code className="text-neutral-400">bun run build && bun test</code>) before committing changes.
            </p>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-md text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!description.trim() || isSubmitting}
                className="px-3.5 py-1.5 rounded-md bg-neutral-100 text-neutral-950 font-medium hover:bg-white disabled:opacity-40 transition-all flex items-center gap-1.5"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Queuing...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Submit P0 Feedback</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
