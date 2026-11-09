import React, { useState, useEffect } from 'react';
import { Check, X } from 'lucide-react';

interface StorageConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPath: string;
  onSavePath: (newPath: string) => Promise<void>;
}

export const StorageConfigModal: React.FC<StorageConfigModalProps> = ({
  isOpen,
  onClose,
  currentPath,
  onSavePath,
}) => {
  const [pathInput, setPathInput] = useState(currentPath);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    setPathInput(currentPath);
  }, [currentPath]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pathInput.trim()) return;
    setSaving(true);
    try {
      await onSavePath(pathInput.trim());
      setSavedSuccess(true);
      setTimeout(() => {
        setSavedSuccess(false);
        onClose();
      }, 800);
    } catch {
      // error handled
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0c0c0e] border border-neutral-800 rounded-lg max-w-md w-full p-4 shadow-xl text-xs space-y-3.5">
        <div className="flex items-center justify-between border-b border-neutral-800/70 pb-2.5">
          <span className="font-medium text-neutral-200">Unified Storage Location</span>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-300 transition-colors p-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <p className="text-neutral-400 text-xs leading-relaxed">
          Lyra normalizes transcripts from Antigravity, Claude Code, and Codex into this directory.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <label className="text-[10px] uppercase text-neutral-500 font-semibold tracking-wider">
              Directory Path
            </label>
            <input
              type="text"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              placeholder="~/.lyra/chats"
              className="w-full bg-[#09090b] border border-neutral-800 rounded-md px-3 py-1.5 text-neutral-200 focus:outline-none focus:border-neutral-700 text-xs"
            />
          </div>

          <div className="flex items-center gap-1.5 pt-1">
            <button
              type="button"
              onClick={() => setPathInput('~/.lyra/chats')}
              className="px-2 py-1 rounded bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-neutral-200 transition-colors text-[11px]"
            >
              Default (~/.lyra/chats)
            </button>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-800/70">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md border border-neutral-800 hover:bg-neutral-800/50 text-neutral-400 hover:text-neutral-200 transition-colors text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !pathInput.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-neutral-100 text-neutral-900 font-medium hover:bg-white disabled:opacity-30 transition-colors text-xs"
            >
              {savedSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  Saved
                </>
              ) : (
                'Save'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

