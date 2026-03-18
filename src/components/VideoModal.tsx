'use client';

import { useState } from 'react';
import type { ExerciseEntry } from '@/types';

interface VideoModalProps {
  exercise: ExerciseEntry;
  onClose: () => void;
}

export default function VideoModal({ exercise, onClose }: VideoModalProps) {
  const [showOriginal, setShowOriginal] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700 z-10"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Title */}
        <h3 className="mb-3 pr-8 text-base font-semibold text-gray-900">
          {exercise.exerciseName}
        </h3>

        {/* Output video */}
        <div className="mb-3 overflow-hidden rounded-xl bg-black">
          <video src={exercise.outputVideoUrl} controls autoPlay className="w-full max-h-[50vh] object-contain" />
        </div>

        {/* Meta info */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-500">{exercise.positionName}</span>
          <span className="text-sm text-gray-300">·</span>
          <span className="text-sm text-gray-500">
            {exercise.mode === 'pro' ? 'Professional' : 'Standard'}
          </span>
        </div>

        {/* View Original */}
        <button
          onClick={() => setShowOriginal(!showOriginal)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          {showOriginal ? 'Hide Original' : 'View Original Video'}
        </button>

        {showOriginal && (
          <div className="mt-3 overflow-hidden rounded-xl bg-black">
            <p className="bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-500">
              Reference Video
            </p>
            <video src={exercise.inputVideoUrl} controls className="w-full max-h-[40vh] object-contain" />
          </div>
        )}
      </div>
    </div>
  );
}
