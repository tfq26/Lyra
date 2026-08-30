import React, { useState, useEffect } from 'react';
import { Folder, HardDrive, Check, X, ArrowRight, RefreshCw } from 'lucide-react';

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
      }, 1000);
    } catch {
      // error handled
    } finally {
      setSaving(false);
    }
  };

  const handleSetPreset = (preset: string) => {
    setPathInput(preset);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg max-w-lg w-full p-5 shadow-2xl text-xs font-mono space-y-4">
        <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
          <div className="flex items-center gap-2 text-neutral-200">
            <HardDrive className="w-4 h-4 text-sky-400" />
            <span className="font-semibold text-sm">Unified Chat Storage Location</span>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-300 transition-colors p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-neutral-400 font-sans text-xs leading-relaxed">
          Lyra normalizes and mirrors conversation transcripts from <strong>Antigravity</strong>, <strong>Claude Code</strong>, and <strong>Codex</strong> into this single directory so the interface and tools share context.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase text-neutral-500 font-semibold tracking-wider">
              Storage Directory Path
            </label>
            <div className="relative">
              <input
                type="text"
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                placeholder="/Users/.../.lyra/chats"
                className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-neutral-200 focus:outline-none focus:border-neutral-700 text-xs font-mono"
              />
            </div>
          </div>

          {/* Quick presets */}
          <div className="space-y-1">
            <span className="text-[10px] uppercase text-neutral-500 font-semibold tracking-wider">
              Quick Presets
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => handleSetPreset('~/.lyra/chats')}
                className="px-2 py-1 rounded bg-neutral-950 border border-neutral-800 text-neutral-400 hover:text-white hover:border-neutral-700 transition-colors text-[11px]"
              >
                ~/.lyra/chats (Default User Store)
              </button>
              <button
                type="button"
                onClick={() => handleSetPreset('/Users/taufeeqali/projects/.lyra/chats')}
                className="px-2 py-1 rounded bg-neutral-950 border border-neutral-800 text-neutral-400 hover:text-white hover:border-neutral-700 transition-colors text-[11px]"
              >
                projects/.lyra/chats (Shared Projects)
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-neutral-800">
            <span className="text-neutral-500 text-[10px]">
              {savedSuccess ? 'Saved successfully!' : 'All new chats will sync here.'}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded border border-neutral-800 hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !pathInput.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-neutral-100 text-neutral-900 font-medium hover:bg-white disabled:opacity-40 transition-colors"
              >
                {savedSuccess ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    Saved
                  </>
                ) : (
                  <>
                    <Folder className="w-3.5 h-3.5" />
                    Save Location
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
