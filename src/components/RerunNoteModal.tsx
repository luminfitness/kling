'use client';

import { useState, useEffect, useRef } from 'react';

interface RerunNoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (note: string) => void;
  exerciseNames: string[];
}

export default function RerunNoteModal({
  isOpen,
  onClose,
  onConfirm,
  exerciseNames,
}: RerunNoteModalProps) {
  const [note, setNote] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setNote('');
      // Focus the textarea when modal opens
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleConfirm = () => {
    onConfirm(note.trim());
    setNote('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter' && e.metaKey) {
      e.preventDefault();
      handleConfirm();
    }
  };

  if (!isOpen) return null;

  const isMultiple = exerciseNames.length > 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl overflow-hidden">
        {/* Header */}
        <div className="border-b px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {isMultiple ? `Rerun ${exerciseNames.length} Exercises` : 'Rerun Exercise'}
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            {isMultiple
              ? `${exerciseNames.slice(0, 3).join(', ')}${exerciseNames.length > 3 ? ` and ${exerciseNames.length - 3} more` : ''}`
              : exerciseNames[0] || 'Unnamed Exercise'}
          </p>
        </div>

        {/* Content */}
        <div className="px-5 py-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Add a note (optional)
          </label>
          <textarea
            ref={textareaRef}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What needs to be fixed or changed?"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
            rows={3}
          />
          <p className="mt-1 text-xs text-gray-400">
            This note will be visible in the Pending table for reference.
          </p>
        </div>

        {/* Footer */}
        <div className="border-t px-5 py-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {isMultiple ? `Rerun ${exerciseNames.length}` : 'Rerun'}
          </button>
        </div>
      </div>
    </div>
  );
}
