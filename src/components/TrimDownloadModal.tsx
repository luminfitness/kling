'use client';

import { useState, useEffect } from 'react';
import { downloadProjectTrimmedAsZip, type TrimmedDownloadProgress } from '@/lib/downloadProject';
import type { ExerciseEntry } from '@/types';

interface TrimDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectName: string;
  exercises: ExerciseEntry[];
}

type ModalStage = 'processing' | 'complete' | 'error';

export default function TrimDownloadModal({
  isOpen,
  onClose,
  projectName,
  exercises,
}: TrimDownloadModalProps) {
  const [stage, setStage] = useState<ModalStage>('processing');
  const [progress, setProgress] = useState<TrimmedDownloadProgress | null>(null);
  const [result, setResult] = useState<{ successCount: number; failedCount: number; failedNames: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Start processing when modal opens
  useEffect(() => {
    if (!isOpen) return;

    // Reset state
    setStage('processing');
    setProgress(null);
    setResult(null);
    setError(null);

    const exercisesWithVideos = exercises.filter(e => e.outputVideoUrl);
    if (exercisesWithVideos.length === 0) {
      setError('No videos to process');
      setStage('error');
      return;
    }

    // Start the download process
    downloadProjectTrimmedAsZip(projectName, exercisesWithVideos, setProgress)
      .then((result) => {
        setResult(result);
        setStage('complete');
      })
      .catch((err) => {
        console.error('Trim download failed:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        setStage('error');
      });
  }, [isOpen, projectName, exercises]);

  if (!isOpen) return null;

  const successCount = progress?.completedResults.filter(r => r.success).length ?? 0;
  const failedCount = progress?.completedResults.filter(r => !r.success).length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl overflow-hidden">
        {/* Header */}
        <div className="border-b px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            {stage === 'processing' && 'Trimming Videos...'}
            {stage === 'complete' && 'Download Complete'}
            {stage === 'error' && 'Error'}
          </h2>
          {stage !== 'processing' && (
            <button
              onClick={onClose}
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
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Content */}
        <div className="px-6 py-6">
          {/* Processing View */}
          {stage === 'processing' && progress && (
            <div>
              {/* Overall progress bar */}
              <div className="mb-4">
                <div className="flex justify-between text-sm text-gray-600 mb-2">
                  <span>
                    {progress.stage === 'zipping'
                      ? 'Creating ZIP file...'
                      : `Exercise ${progress.exerciseIndex + 1} of ${progress.exerciseTotal}`}
                  </span>
                  <span>
                    {Math.round(
                      progress.stage === 'zipping'
                        ? 95
                        : ((progress.exerciseIndex + (progress.trimProgress?.percent ?? 0) / 100) /
                            progress.exerciseTotal) *
                            90
                    )}%
                  </span>
                </div>
                <div className="h-3 w-full rounded-full bg-gray-200 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all duration-300"
                    style={{
                      width: `${
                        progress.stage === 'zipping'
                          ? 95
                          : ((progress.exerciseIndex + (progress.trimProgress?.percent ?? 0) / 100) /
                              progress.exerciseTotal) *
                            90
                      }%`,
                    }}
                  />
                </div>
              </div>

              {/* Current exercise */}
              {progress.stage === 'trimming' && (
                <div className="rounded-lg bg-gray-50 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                    <span className="text-sm font-medium text-gray-700 truncate">
                      {progress.exerciseName}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 mt-1 pl-6">
                    {progress.trimProgress?.message || progress.trimProgress?.stage || 'Processing...'}
                  </p>
                </div>
              )}

              {/* Completed items summary */}
              {progress.completedResults.length > 0 && (
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
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <span className="text-gray-600">{successCount} trimmed</span>
                  </div>
                  {failedCount > 0 && (
                    <div className="flex items-center gap-1.5">
                      <div className="h-4 w-4 rounded-full bg-red-100 flex items-center justify-center">
                        <span className="text-[10px] font-bold text-red-600">!</span>
                      </div>
                      <span className="text-gray-600">{failedCount} failed</span>
                    </div>
                  )}
                </div>
              )}

              <p className="text-xs text-gray-400 mt-4 text-center">
                Please keep this window open while processing...
              </p>
            </div>
          )}

          {/* Complete View */}
          {stage === 'complete' && result && (
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                <svg
                  className="h-8 w-8 text-green-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Download Started!
              </h3>
              <p className="text-sm text-gray-600 mb-2">
                {result.successCount} video{result.successCount !== 1 ? 's' : ''} trimmed and packaged.
              </p>
              {result.failedCount > 0 && result.failedNames.length > 0 && (
                <div className="mt-3 mb-4 text-left bg-orange-50 border border-orange-200 rounded-lg p-3">
                  <p className="text-sm font-medium text-orange-700 mb-2">
                    {result.failedCount} video{result.failedCount !== 1 ? 's' : ''} failed to trim:
                  </p>
                  <ul className="text-xs text-orange-600 space-y-1 max-h-32 overflow-y-auto">
                    {result.failedNames.map((name, idx) => (
                      <li key={idx} className="flex items-center gap-1.5">
                        <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-orange-400" />
                        <span className="truncate">{name}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-xs text-gray-500">
                Check your Downloads folder for {projectName}_Trimmed.zip
              </p>
            </div>
          )}

          {/* Error View */}
          {stage === 'error' && (
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <svg
                  className="h-8 w-8 text-red-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Something went wrong
              </h3>
              <p className="text-sm text-red-600">
                {error || 'Unknown error occurred'}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-4 flex justify-end">
          {stage === 'processing' ? (
            <p className="text-sm text-gray-500 w-full text-center">
              Trimming videos using AI analysis...
            </p>
          ) : (
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
