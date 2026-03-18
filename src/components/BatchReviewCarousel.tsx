'use client';

import { useState, useEffect, useCallback } from 'react';
import type { LoopExerciseSummary } from '@/types';

interface BatchReviewCarouselProps {
  exercises: LoopExerciseSummary[];
  onSetKeeper: (rowId: string) => Promise<void>;
  onClearKeeper: (exerciseName: string) => Promise<void>;
  onToggleFlag: (exerciseName: string) => Promise<void>;
  onMarkReviewed: (exerciseName: string) => Promise<void>;
  onMarkDownloaded: (rowId: string) => Promise<void>;
  onUpdateRating: (rowId: string, rating: string | null) => Promise<void>;
  onUpdate: () => void;
  onBack: () => void;
}

export default function BatchReviewCarousel({
  exercises,
  onSetKeeper,
  onClearKeeper,
  onToggleFlag,
  onMarkReviewed,
  onMarkDownloaded,
  onUpdate,
  onBack,
}: BatchReviewCarouselProps) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [showExitSummary, setShowExitSummary] = useState(false);

  const current = exercises[currentIdx];
  const flaggedCount = exercises.filter((e) => e.flagged).length;
  const progressPct = exercises.length > 0 ? ((currentIdx + 1) / exercises.length) * 100 : 0;

  // Auto-mark reviewed when navigating away
  const markCurrentReviewed = useCallback(async () => {
    if (current && !current.reviewed) {
      await onMarkReviewed(current.exerciseName);
    }
  }, [current, onMarkReviewed]);

  const goNext = useCallback(async () => {
    await markCurrentReviewed();
    setCurrentIdx((i) => Math.min(i + 1, exercises.length - 1));
  }, [exercises.length, markCurrentReviewed]);

  const goPrev = useCallback(async () => {
    await markCurrentReviewed();
    setCurrentIdx((i) => Math.max(i - 1, 0));
  }, [markCurrentReviewed]);

  const skipToNextFlagged = useCallback(async () => {
    await markCurrentReviewed();
    for (let i = currentIdx + 1; i < exercises.length; i++) {
      if (exercises[i].flagged) { setCurrentIdx(i); return; }
    }
    for (let i = 0; i < currentIdx; i++) {
      if (exercises[i].flagged) { setCurrentIdx(i); return; }
    }
  }, [currentIdx, exercises, markCurrentReviewed]);

  const goToUnreviewed = useCallback(() => {
    for (let i = 0; i < exercises.length; i++) {
      if (!exercises[i].reviewed && !exercises[i].flagged) {
        setCurrentIdx(i);
        setShowExitSummary(false);
        return;
      }
    }
    for (let i = 0; i < exercises.length; i++) {
      if (exercises[i].flagged) {
        setCurrentIdx(i);
        setShowExitSummary(false);
        return;
      }
    }
  }, [exercises]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (showExitSummary) return;
      if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goNext, goPrev, showExitSummary]);

  const handleToggleFlag = async () => {
    if (!current) return;
    await onToggleFlag(current.exerciseName);
    onUpdate();
  };

  const handleDownload = async (videoUrl: string, exerciseName: string, suffix: string, rowId: string) => {
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = `${exerciseName}_${suffix}.mp4`;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    await onMarkDownloaded(rowId);
  };

  const handleSetKeeper = async (rowId: string) => {
    // If this row is already the keeper, clear it
    const row = current?.rows.find((r) => r.id === rowId);
    if (row?.keeper) {
      await onClearKeeper(current.exerciseName);
    } else {
      await onSetKeeper(rowId);
    }
    onUpdate();
  };

  const handleDone = async () => {
    await markCurrentReviewed();
    setShowExitSummary(true);
  };

  const handleExit = async () => {
    await markCurrentReviewed();
    onBack();
  };

  if (exercises.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p>No exercises to review.</p>
        <button onClick={onBack} className="mt-4 px-4 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200">
          Back
        </button>
      </div>
    );
  }

  // Summary stats
  const reviewedCount = exercises.filter((e) => e.reviewed).length;
  const unreviewedCount = exercises.filter((e) => !e.reviewed && !e.flagged).length;

  // ─── Exit Summary Modal ──────────────────────────────────────────────────
  if (showExitSummary) {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-xl max-w-md w-full mx-4 p-6 space-y-5">
          <h2 className="text-lg font-semibold text-gray-900">Review Summary</h2>

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                <svg className="h-4 w-4 text-green-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-900">{reviewedCount} reviewed</p>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center">
                <FlagIcon className="text-orange-600 h-4 w-4" />
              </div>
              <p className="text-sm font-medium text-gray-900">{flaggedCount} flagged</p>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                <svg className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-900">{unreviewedCount} not reviewed</p>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            {(flaggedCount > 0 || unreviewedCount > 0) && (
              <button
                onClick={goToUnreviewed}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
              >
                Review remaining
              </button>
            )}
            <button
              onClick={onBack}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Exit
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!current) return null;

  // Group rows by rank for display
  const rowsByRank = new Map<number, typeof current.rows>();
  for (const row of current.rows) {
    const existing = rowsByRank.get(row.rank);
    if (existing) {
      existing.push(row);
    } else {
      rowsByRank.set(row.rank, [row]);
    }
  }
  const sortedRanks = Array.from(rowsByRank.entries()).sort(([a], [b]) => a - b);

  // ─── Main Review UI ──────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-600 rounded-full transition-all duration-300"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={goPrev}
          disabled={currentIdx === 0}
          className="px-4 py-2 text-sm font-medium bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          &larr; Back
        </button>

        <div className="text-center">
          <h2 className="text-lg font-semibold text-gray-900">
            {current.exerciseName.replace(/\.[^.]+$/, '')}
          </h2>
          <p className="text-sm text-gray-500 font-medium">
            {currentIdx + 1} of {exercises.length}
            {flaggedCount > 0 && (
              <button
                onClick={skipToNextFlagged}
                className="ml-2 text-orange-500 hover:text-orange-700 transition-colors"
              >
                ({flaggedCount} flagged)
              </button>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleToggleFlag}
            className={`p-2 rounded-lg border transition-colors ${
              current.flagged
                ? 'text-orange-600 bg-orange-100 border-orange-300'
                : 'text-gray-400 bg-white border-gray-200 hover:border-orange-300 hover:text-orange-500'
            }`}
            title={current.flagged ? 'Unflag' : 'Flag for later'}
          >
            <FlagIcon className="h-5 w-5" />
          </button>
          {currentIdx >= exercises.length - 1 ? (
            <button
              onClick={handleDone}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Done
            </button>
          ) : (
            <button
              onClick={goNext}
              className="px-4 py-2 text-sm font-medium bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Next &rarr;
            </button>
          )}
        </div>
      </div>

      {/* Candidates by rank */}
      {sortedRanks.length > 0 ? (
        <div className={`grid gap-4 ${sortedRanks.length === 1 ? 'grid-cols-1 max-w-sm mx-auto' : sortedRanks.length === 2 ? 'grid-cols-2 max-w-2xl mx-auto' : 'grid-cols-3'}`}>
          {sortedRanks.map(([rank, rows]) => {
            const first = rows[0];
            const row1f = rows.find((r) => r.fade_frames === 1);
            const row3f = rows.find((r) => r.fade_frames === 3);

            return (
              <div key={rank} className="border border-gray-200 rounded-xl p-3 space-y-3">
                {/* Candidate header */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-600">#{rank}</span>
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                    first.score >= 0.9 ? 'bg-green-100 text-green-800' :
                    first.score >= 0.8 ? 'bg-yellow-100 text-yellow-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    {(first.score * 100).toFixed(1)}%
                  </span>
                  <span className="text-xs font-mono text-gray-400">
                    {first.start_time}s&rarr;{first.end_time}s
                  </span>
                </div>

                {/* 1f and 3f side by side */}
                <div className="grid grid-cols-2 gap-2">
                  {/* 1f */}
                  <div>
                    <p className="text-xs font-medium text-gray-500 text-center mb-1">1f crossfade</p>
                    {row1f?.video_url ? (
                      <video src={row1f.video_url} loop autoPlay muted playsInline className="w-full rounded-lg aspect-[9/16] object-contain bg-black" />
                    ) : (
                      <div className="w-full rounded-lg bg-gray-100 aspect-[9/16] flex items-center justify-center text-xs text-gray-400">N/A</div>
                    )}
                    {row1f && (
                      <div className="flex items-center justify-center gap-1.5 mt-2">
                        <button
                          onClick={() => handleSetKeeper(row1f.id)}
                          className={`p-1.5 rounded-lg border transition-colors ${
                            row1f.keeper
                              ? 'bg-amber-100 border-amber-300 text-amber-700'
                              : 'bg-white border-gray-200 text-gray-400 hover:border-amber-300 hover:text-amber-600'
                          }`}
                          title={row1f.keeper ? 'Remove as keeper' : 'Keep this one'}
                        >
                          <StarIcon />
                        </button>
                        {row1f.video_url && (
                          <button
                            onClick={() => handleDownload(row1f.video_url, current.exerciseName, `rank${rank}_1f`, row1f.id)}
                            className="p-1.5 rounded-lg border bg-white border-gray-200 text-gray-400 hover:border-blue-300 hover:text-blue-600 transition-colors"
                            title="Download"
                          >
                            <DownloadIconMd />
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 3f */}
                  <div>
                    <p className="text-xs font-medium text-gray-500 text-center mb-1">3f crossfade</p>
                    {row3f?.video_url ? (
                      <video src={row3f.video_url} loop autoPlay muted playsInline className="w-full rounded-lg aspect-[9/16] object-contain bg-black" />
                    ) : (
                      <div className="w-full rounded-lg bg-gray-100 aspect-[9/16] flex items-center justify-center text-xs text-gray-400">N/A</div>
                    )}
                    {row3f && (
                      <div className="flex items-center justify-center gap-1.5 mt-2">
                        <button
                          onClick={() => handleSetKeeper(row3f.id)}
                          className={`p-1.5 rounded-lg border transition-colors ${
                            row3f.keeper
                              ? 'bg-amber-100 border-amber-300 text-amber-700'
                              : 'bg-white border-gray-200 text-gray-400 hover:border-amber-300 hover:text-amber-600'
                          }`}
                          title={row3f.keeper ? 'Remove as keeper' : 'Keep this one'}
                        >
                          <StarIcon />
                        </button>
                        {row3f.video_url && (
                          <button
                            onClick={() => handleDownload(row3f.video_url, current.exerciseName, `rank${rank}_3f`, row3f.id)}
                            className="p-1.5 rounded-lg border bg-white border-gray-200 text-gray-400 hover:border-blue-300 hover:text-blue-600 transition-colors"
                            title="Download"
                          >
                            <DownloadIconMd />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-gray-400">No loop candidates found for this exercise.</p>
      )}
    </div>
  );
}

function FlagIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className || 'h-5 w-5'} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2z" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

function DownloadIconMd() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  );
}
