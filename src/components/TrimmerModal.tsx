'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  autoTrimExercise,
  downloadTrimmedVideo,
  cleanupTrimResults,
  type TrimResult,
  type TrimProgressUpdate,
} from '@/lib/trimmerService';
import type { ExerciseEntry } from '@/types';

interface TrimmerModalProps {
  isOpen: boolean;
  onClose: () => void;
  exercises: ExerciseEntry[];
}

type ModalView = 'selection' | 'processing' | 'results';

interface ProcessingState {
  currentIndex: number;
  total: number;
  currentProgress: TrimProgressUpdate;
  results: TrimResult[];
}

export default function TrimmerModal({
  isOpen,
  onClose,
  exercises,
}: TrimmerModalProps) {
  const [view, setView] = useState<ModalView>('selection');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [processingState, setProcessingState] = useState<ProcessingState | null>(null);

  // Filter to only show eligible exercises (reviewed and not flagged)
  const eligibleExercises = useMemo(
    () => exercises.filter((e) => e.reviewed && !e.flagged),
    [exercises]
  );

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(eligibleExercises.map((e) => e.id)));
  }, [eligibleExercises]);

  const handleDeselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleStartTrim = useCallback(async () => {
    const selectedExercises = eligibleExercises.filter((e) =>
      selectedIds.has(e.id)
    );

    if (selectedExercises.length === 0) return;

    setView('processing');
    setProcessingState({
      currentIndex: 0,
      total: selectedExercises.length,
      currentProgress: { stage: 'extracting', percent: 0 },
      results: [],
    });

    const results: TrimResult[] = [];

    for (let i = 0; i < selectedExercises.length; i++) {
      const exercise = selectedExercises[i];

      setProcessingState((prev) =>
        prev
          ? {
              ...prev,
              currentIndex: i,
              currentProgress: { stage: 'extracting', percent: 0 },
            }
          : prev
      );

      const result = await autoTrimExercise(exercise, (progress) => {
        setProcessingState((prev) =>
          prev ? { ...prev, currentProgress: progress } : prev
        );
      });

      results.push(result);

      setProcessingState((prev) =>
        prev ? { ...prev, results: [...results] } : prev
      );
    }

    setProcessingState((prev) =>
      prev
        ? {
            ...prev,
            currentIndex: selectedExercises.length,
            results,
          }
        : prev
    );

    setView('results');
  }, [eligibleExercises, selectedIds]);

  const handleClose = useCallback(() => {
    // Clean up blob URLs
    if (processingState?.results) {
      cleanupTrimResults(processingState.results);
    }
    setView('selection');
    setSelectedIds(new Set());
    setProcessingState(null);
    onClose();
  }, [onClose, processingState]);

  const handleDownload = useCallback((result: TrimResult) => {
    downloadTrimmedVideo(result);
  }, []);

  if (!isOpen) return null;

  const successCount = processingState?.results.filter((r) => r.success).length ?? 0;
  const failedCount = processingState?.results.filter((r) => !r.success).length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-2xl bg-white shadow-xl overflow-hidden">
        {/* Header */}
        <div className="border-b px-6 py-4 flex items-center justify-between flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">
            {view === 'selection' && 'Auto-Trim to Single Rep'}
            {view === 'processing' && 'Processing...'}
            {view === 'results' && 'Trim Results'}
          </h2>
          <button
            onClick={handleClose}
            className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Selection View */}
          {view === 'selection' && (
            <div className="px-6 py-4">
              {eligibleExercises.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <p>No eligible exercises found.</p>
                  <p className="text-sm mt-1">
                    Only reviewed (green checkmark) exercises can be trimmed.
                  </p>
                </div>
              ) : (
                <>
                  {/* Select All / Deselect All */}
                  <div className="flex gap-2 mb-4">
                    <button
                      onClick={handleSelectAll}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      Select All
                    </button>
                    <span className="text-gray-300">|</span>
                    <button
                      onClick={handleDeselectAll}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      Deselect All
                    </button>
                  </div>

                  {/* Exercise List */}
                  <div className="space-y-2">
                    {eligibleExercises.map((exercise) => (
                      <label
                        key={exercise.id}
                        className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.has(exercise.id)}
                          onChange={() => handleToggleSelect(exercise.id)}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {exercise.exerciseName}
                          </p>
                          <p className="text-xs text-gray-500">
                            {exercise.equipmentType} • {exercise.positionName}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Processing View */}
          {view === 'processing' && processingState && (
            <div className="px-6 py-8">
              {/* Progress bar */}
              <div className="mb-6">
                <div className="flex justify-between text-sm text-gray-600 mb-2">
                  <span>
                    {processingState.currentIndex + 1} of {processingState.total}
                  </span>
                  <span>
                    {Math.round(
                      ((processingState.currentIndex +
                        processingState.currentProgress.percent / 100) /
                        processingState.total) *
                        100
                    )}
                    %
                  </span>
                </div>
                <div className="h-3 w-full rounded-full bg-gray-200 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all duration-300"
                    style={{
                      width: `${
                        ((processingState.currentIndex +
                          processingState.currentProgress.percent / 100) /
                          processingState.total) *
                        100
                      }%`,
                    }}
                  />
                </div>
              </div>

              {/* Current item */}
              {processingState.currentIndex < processingState.total && (
                <div className="rounded-lg bg-gray-50 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                    <span className="text-sm font-medium text-gray-700">
                      {eligibleExercises.find(
                        (e) =>
                          e.id ===
                          Array.from(selectedIds)[processingState.currentIndex]
                      )?.exerciseName ?? 'Processing...'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 mt-1 pl-6">
                    {processingState.currentProgress.message ||
                      processingState.currentProgress.stage}
                  </p>
                </div>
              )}

              {/* Completed items summary */}
              {processingState.results.length > 0 && (
                <div className="mt-4 flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-1.5">
                    <div className="h-4 w-4 rounded-full bg-green-100 flex items-center justify-center">
                      <svg
                        className="h-2.5 w-2.5 text-green-600"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    </div>
                    <span className="text-gray-600">
                      {processingState.results.filter((r) => r.success).length}{' '}
                      complete
                    </span>
                  </div>
                  {processingState.results.filter((r) => !r.success).length >
                    0 && (
                    <div className="flex items-center gap-1.5">
                      <div className="h-4 w-4 rounded-full bg-red-100 flex items-center justify-center">
                        <span className="text-[10px] font-bold text-red-600">
                          !
                        </span>
                      </div>
                      <span className="text-gray-600">
                        {
                          processingState.results.filter((r) => !r.success)
                            .length
                        }{' '}
                        failed
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Results View */}
          {view === 'results' && processingState && (
            <div className="px-6 py-4 space-y-4">
              {processingState.results.map((result) => (
                <div
                  key={result.exerciseId}
                  className={`rounded-lg border p-4 ${
                    result.success
                      ? 'border-green-200 bg-green-50'
                      : 'border-red-200 bg-red-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {result.success ? (
                          <div className="h-5 w-5 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                            <svg
                              className="h-3 w-3 text-green-600"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={3}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                          </div>
                        ) : (
                          <div className="h-5 w-5 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                            <span className="text-xs font-bold text-red-600">
                              !
                            </span>
                          </div>
                        )}
                        <span className="font-medium text-gray-900 truncate">
                          {result.exerciseName}
                        </span>
                      </div>

                      {result.success ? (
                        <p className="text-sm text-gray-600 mt-1 ml-7">
                          Trimmed: {result.startTime?.toFixed(1)}s →{' '}
                          {result.endTime?.toFixed(1)}s ({result.duration?.toFixed(1)}s
                          duration)
                          {result.confidence !== undefined && (
                            <span className="text-gray-400 ml-2">
                              • {Math.round(result.confidence * 100)}% confidence
                            </span>
                          )}
                        </p>
                      ) : (
                        <p className="text-sm text-red-600 mt-1 ml-7">
                          {result.error}
                        </p>
                      )}
                    </div>

                    {result.success && (
                      <button
                        onClick={() => handleDownload(result)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors flex-shrink-0"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                          />
                        </svg>
                        Download
                      </button>
                    )}
                  </div>

                  {/* Video preview */}
                  {result.success && result.trimmedBlobUrl && (
                    <div className="mt-3 ml-7">
                      <video
                        src={result.trimmedBlobUrl}
                        controls
                        loop
                        className="w-full max-w-md rounded-lg bg-black"
                        style={{ maxHeight: '200px' }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-4 flex items-center justify-between flex-shrink-0">
          {view === 'selection' && (
            <>
              <span className="text-sm text-gray-600">
                {selectedIds.size} selected
              </span>
              <button
                onClick={handleStartTrim}
                disabled={selectedIds.size === 0}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                Trim All ({selectedIds.size})
              </button>
            </>
          )}

          {view === 'processing' && (
            <div className="w-full text-center text-sm text-gray-500">
              Processing... Please keep this window open.
            </div>
          )}

          {view === 'results' && (
            <>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-green-600">✓ {successCount} complete</span>
                {failedCount > 0 && (
                  <span className="text-red-600">⚠ {failedCount} failed</span>
                )}
              </div>
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                Close
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
