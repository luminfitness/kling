'use client';

import { useRef } from 'react';
import { createPortal } from 'react-dom';

interface BatchExercise {
  name: string;
  file: File;
  status: 'pending' | 'processing' | 'done' | 'error';
  error?: string;
  candidates: Array<{
    rank: number;
    startTime: number;
    endTime: number;
    duration: number;
    score: number;
    url1f: string | null;
    url3f: string | null;
  }>;
  flagged: boolean;
}

interface LoopUploadModalProps {
  onClose: () => void;
  onFilesSelected: (files: FileList) => void;
  onProcess: () => void;
  exercises: BatchExercise[];
  onClear: () => void;
}

export default function LoopUploadModal({
  onClose,
  onFilesSelected,
  onProcess,
  exercises,
  onClear,
}: LoopUploadModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const modal = (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full mx-4 p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Upload Videos</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length > 0) onFilesSelected(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 mx-auto text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <p className="text-sm text-gray-600 font-medium">Drop exercise videos here or click to browse</p>
          <p className="text-xs text-gray-400 mt-1">Select multiple MP4/MOV files</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && e.target.files.length > 0 && onFilesSelected(e.target.files)}
          />
        </div>

        {/* File list */}
        {exercises.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700">
                {exercises.length} video{exercises.length > 1 ? 's' : ''} selected
              </p>
              <button
                onClick={onClear}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Clear
              </button>
            </div>
            <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
              {exercises.map((ex, i) => (
                <div key={i} className="px-3 py-2 text-sm text-gray-600 flex items-center justify-between">
                  <span className="truncate">{ex.name}</span>
                  <span className="text-xs text-gray-400 ml-2 shrink-0">
                    {(ex.file.size / 1024 / 1024).toFixed(1)} MB
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onProcess}
            disabled={exercises.length === 0}
            className="px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 transition-colors"
          >
            Process All
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
