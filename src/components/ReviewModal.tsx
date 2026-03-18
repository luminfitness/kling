'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ExerciseEntry } from '@/types';

interface ReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  exercises: ExerciseEntry[];
  onMarkReviewed: (id: string) => void;
  onFlag: (id: string) => void;
  onRerun?: (exercise: ExerciseEntry) => void;
}

export default function ReviewModal({
  isOpen,
  onClose,
  exercises,
  onMarkReviewed,
  onFlag,
  onRerun,
}: ReviewModalProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showOriginal, setShowOriginal] = useState(false);
  // Track the ID of the exercise we're viewing to maintain position after list changes
  const currentExerciseIdRef = useRef<string | null>(null);

  // Reset index when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(0);
      setShowOriginal(false);
      currentExerciseIdRef.current = exercises[0]?.id ?? null;
    }
  }, [isOpen]);

  // When exercises array changes (after approve/flag), maintain position
  useEffect(() => {
    if (!isOpen || !currentExerciseIdRef.current) return;

    // Find where the current exercise went
    const newIndex = exercises.findIndex(e => e.id === currentExerciseIdRef.current);

    if (newIndex === -1) {
      // Current exercise was removed (approved), stay at same index or go to end
      const safeIndex = Math.min(currentIndex, exercises.length - 1);
      setCurrentIndex(Math.max(0, safeIndex));
      currentExerciseIdRef.current = exercises[safeIndex]?.id ?? null;
    }
  }, [exercises, isOpen, currentIndex]);

  const currentExercise = exercises[currentIndex];
  const hasNext = currentIndex < exercises.length - 1;
  const hasPrev = currentIndex > 0;

  // Update ref whenever we change exercises
  useEffect(() => {
    if (currentExercise) {
      currentExerciseIdRef.current = currentExercise.id;
    }
  }, [currentExercise]);

  const handleApprove = useCallback(() => {
    if (!currentExercise) return;
    onMarkReviewed(currentExercise.id);
    // The useEffect will handle keeping us at the right position
    // If this was the last one, modal will close automatically
    if (exercises.length <= 1) {
      setTimeout(() => onClose(), 100);
    }
  }, [currentExercise, onMarkReviewed, exercises.length, onClose]);

  const handleFlag = useCallback(() => {
    if (!currentExercise) return;
    onFlag(currentExercise.id);
    // Move to next after flagging
    if (exercises.length <= 1) {
      setTimeout(() => onClose(), 100);
    }
  }, [currentExercise, onFlag, exercises.length, onClose]);

  const handleRerun = useCallback(() => {
    if (!currentExercise || !onRerun) return;
    onRerun(currentExercise);
    // Move to next after triggering rerun
    if (exercises.length <= 1) {
      setTimeout(() => onClose(), 100);
    }
  }, [currentExercise, onRerun, exercises.length, onClose]);

  const handleNext = useCallback(() => {
    if (hasNext) {
      setCurrentIndex(prev => prev + 1);
      setShowOriginal(false);
    }
  }, [hasNext]);

  const handlePrev = useCallback(() => {
    if (hasPrev) {
      setCurrentIndex(prev => prev - 1);
      setShowOriginal(false);
    }
  }, [hasPrev]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        handlePrev();
      } else if (e.key === 'Enter' || e.key === 'y') {
        e.preventDefault();
        handleApprove();
      } else if (e.key === 'f') {
        e.preventDefault();
        handleFlag();
      } else if (e.key === 'r' && onRerun) {
        e.preventDefault();
        handleRerun();
      } else if (e.key === 'o') {
        e.preventDefault();
        setShowOriginal(prev => !prev);
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleNext, handlePrev, handleApprove, handleFlag, handleRerun, onRerun, onClose]);

  if (!isOpen) return null;

  // No exercises to review
  if (exercises.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl text-center">
          <div className="mb-4 flex h-16 w-16 mx-auto items-center justify-center rounded-full bg-green-100">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">All Done!</h2>
          <p className="text-sm text-gray-500 mb-4">All exercises have been reviewed.</p>
          <button
            onClick={onClose}
            className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="relative w-full max-w-xl rounded-2xl bg-white shadow-xl flex flex-col">
        {/* Header with exercise info */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {/* Status indicator */}
              {currentExercise?.flagged && (
                <span className="flex-shrink-0" title="Flagged">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-orange-500" fill="currentColor" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
                  </svg>
                </span>
              )}
              <h2 className="text-base font-bold text-gray-900 truncate">
                {currentExercise?.exerciseName || 'Unnamed Exercise'}
              </h2>
              <span className="text-xs text-gray-400 whitespace-nowrap">
                {currentIndex + 1}/{exercises.length}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="rounded bg-gray-100 px-1.5 py-0.5">{currentExercise?.equipmentType}</span>
              <span>•</span>
              <span>{currentExercise?.positionName}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="ml-2 rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Video Player */}
        <div className="px-4 py-3">
          {currentExercise && (
            <div className="space-y-2">
              {/* Main video container */}
              <div className="relative rounded-lg overflow-hidden bg-black" style={{ height: '280px' }}>
                {showOriginal ? (
                  currentExercise.inputVideoUrl ? (
                    <video
                      key={`original-${currentExercise.id}`}
                      src={currentExercise.inputVideoUrl}
                      className="w-full h-full object-contain"
                      controls
                      autoPlay
                      loop
                      muted
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                      No original video available
                    </div>
                  )
                ) : (
                  currentExercise.outputVideoUrl ? (
                    <video
                      key={`output-${currentExercise.id}`}
                      src={currentExercise.outputVideoUrl}
                      className="w-full h-full object-contain"
                      controls
                      autoPlay
                      loop
                      muted
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                      No video available
                    </div>
                  )
                )}
              </div>

              {/* Toggle Original button */}
              {currentExercise.inputVideoUrl && (
                <button
                  onClick={() => setShowOriginal(prev => !prev)}
                  className={`w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    showOriginal
                      ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  {showOriginal ? 'Viewing Original' : 'View Original'}
                  <span className="opacity-60">(O)</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer with Actions */}
        <div className="border-t px-4 py-3">
          {/* Navigation dots */}
          {exercises.length > 1 && (
            <div className="flex items-center justify-center gap-1 mb-3">
              <button
                onClick={handlePrev}
                disabled={!hasPrev}
                className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="flex gap-1 px-2">
                {exercises.slice(0, 10).map((ex, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setCurrentIndex(idx);
                      setShowOriginal(false);
                    }}
                    className={`h-1.5 w-1.5 rounded-full transition-colors ${
                      idx === currentIndex
                        ? 'bg-blue-600'
                        : ex.flagged
                          ? 'bg-orange-400 hover:bg-orange-500'
                          : 'bg-gray-300 hover:bg-gray-400'
                    }`}
                  />
                ))}
                {exercises.length > 10 && (
                  <span className="text-xs text-gray-400 ml-1">+{exercises.length - 10}</span>
                )}
              </div>
              <button
                onClick={handleNext}
                disabled={!hasNext}
                className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleFlag}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border-2 border-orange-200 bg-orange-50 px-3 py-2 text-sm font-medium text-orange-700 hover:bg-orange-100 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
              </svg>
              Flag
              <span className="text-xs opacity-60">(F)</span>
            </button>
            {onRerun && (
              <button
                onClick={handleRerun}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border-2 border-purple-200 bg-purple-50 px-3 py-2 text-sm font-medium text-purple-700 hover:bg-purple-100 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Rerun
                <span className="text-xs opacity-60">(R)</span>
              </button>
            )}
            <button
              onClick={handleApprove}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Approve
              <span className="text-xs opacity-60">(Enter)</span>
            </button>
          </div>

          {/* Keyboard hints */}
          <p className="mt-2 text-center text-xs text-gray-400">
            Arrow keys to navigate • Enter to approve • F to flag{onRerun ? ' • R to rerun' : ''} • O to toggle original
          </p>
        </div>
      </div>
    </div>
  );
}
