'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

interface BatchCandidate {
  rank: number;
  startTime: number;
  endTime: number;
  duration: number;
  score: number;
  url1f: string | null;
  url3f: string | null;
}

interface BatchExercise {
  name: string;
  file: File;
  status: 'pending' | 'processing' | 'done' | 'error';
  error?: string;
  candidates: BatchCandidate[];
  flagged: boolean;
}

interface VideoRating {
  [key: string]: 'good' | 'bad';
}

interface BatchReviewCarouselProps {
  exercises: BatchExercise[];
  onUpdateExercises: (exercises: BatchExercise[]) => void;
  onBack: () => void;
}

export default function BatchReviewCarousel({
  exercises,
  onUpdateExercises,
  onBack,
}: BatchReviewCarouselProps) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [ratings, setRatings] = useState<VideoRating>({});
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());
  const [showExitSummary, setShowExitSummary] = useState(false);

  const completed = exercises.filter((e) => e.status === 'done' || e.status === 'error');
  const current = completed[currentIdx];
  const flaggedCount = exercises.filter((e) => e.flagged).length;
  const progressPct = completed.length > 0 ? ((currentIdx + 1) / completed.length) * 100 : 0;

  const goNext = useCallback(() => {
    setCurrentIdx((i) => Math.min(i + 1, completed.length - 1));
  }, [completed.length]);

  const goPrev = useCallback(() => {
    setCurrentIdx((i) => Math.max(i - 1, 0));
  }, []);

  const skipToNextFlagged = useCallback(() => {
    for (let i = currentIdx + 1; i < completed.length; i++) {
      if (completed[i].flagged) { setCurrentIdx(i); return; }
    }
    for (let i = 0; i < currentIdx; i++) {
      if (completed[i].flagged) { setCurrentIdx(i); return; }
    }
  }, [currentIdx, completed]);

  // Filter to unreviewed (not downloaded, not flagged)
  const goToUnreviewed = useCallback(() => {
    for (let i = 0; i < completed.length; i++) {
      if (!downloaded.has(completed[i].name) && !completed[i].flagged) {
        setCurrentIdx(i);
        setShowExitSummary(false);
        return;
      }
    }
    // If all reviewed, go to flagged
    for (let i = 0; i < completed.length; i++) {
      if (completed[i].flagged) {
        setCurrentIdx(i);
        setShowExitSummary(false);
        return;
      }
    }
  }, [completed, downloaded]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (showExitSummary) return;
      if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goNext, goPrev, showExitSummary]);

  const toggleFlag = () => {
    const updated = [...exercises];
    const globalIdx = exercises.findIndex((e) => e.name === current.name);
    if (globalIdx >= 0) {
      updated[globalIdx] = { ...updated[globalIdx], flagged: !updated[globalIdx].flagged };
      onUpdateExercises(updated);
    }
  };

  const handleRate = async (key: string, rating: 'good' | 'bad', candidate: BatchCandidate, exerciseName: string, blendType: string) => {
    const isToggleOff = ratings[key] === rating;

    setRatings((prev) => {
      const next = { ...prev };
      if (isToggleOff) { delete next[key]; } else { next[key] = rating; }
      return next;
    });

    await supabase
      .from('loop_ratings')
      .delete()
      .eq('file_name', exerciseName)
      .eq('method', 'MAD')
      .eq('rank', candidate.rank)
      .eq('blend_type', blendType);

    if (!isToggleOff) {
      const { error } = await supabase.from('loop_ratings').insert({
        file_name: exerciseName,
        method: 'MAD',
        rank: candidate.rank,
        score: candidate.score,
        start_time: candidate.startTime,
        end_time: candidate.endTime,
        loop_duration: candidate.duration,
        rating,
        blend_type: blendType,
      });
      if (error) console.error('Failed to save rating:', error);
    }
  };

  const handleDownload = (blobUrl: string, exerciseName: string, suffix: string) => {
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${exerciseName}_${suffix}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setDownloaded((prev) => new Set(prev).add(exerciseName));
  };

  // Summary stats
  const downloadedNames = completed.filter((e) => downloaded.has(e.name));
  const flaggedNames = completed.filter((e) => e.flagged);
  const unreviewedNames = completed.filter((e) => !downloaded.has(e.name) && !e.flagged);

  if (completed.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p>No exercises to review.</p>
        <button onClick={onBack} className="mt-4 px-4 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200">
          Back
        </button>
      </div>
    );
  }

  // ─── Exit Summary Modal ──────────────────────────────────────────────────
  if (showExitSummary) {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-xl max-w-md w-full mx-4 p-6 space-y-5">
          <h2 className="text-lg font-semibold text-gray-900">Review Summary</h2>

          <div className="space-y-3">
            {/* Downloaded */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                <DownloadIconMd className="text-green-700" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{downloadedNames.length} downloaded</p>
              </div>
            </div>

            {/* Flagged */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center">
                <FlagIcon className="text-orange-600 h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{flaggedNames.length} flagged</p>
              </div>
            </div>

            {/* Unreviewed */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                <svg className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{unreviewedNames.length} not reviewed</p>
              </div>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            {(flaggedNames.length > 0 || unreviewedNames.length > 0) && (
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

      {/* Header: Back (left) | Name + progress (center) | Flag + Next (right) */}
      <div className="flex items-center justify-between">
        {/* Left: Back */}
        <button
          onClick={goPrev}
          disabled={currentIdx === 0}
          className="px-4 py-2 text-sm font-medium bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          &larr; Back
        </button>

        {/* Center: Exercise name + counter */}
        <div className="text-center">
          <h2 className="text-lg font-semibold text-gray-900">{current.name}</h2>
          <p className="text-sm text-gray-500 font-medium">
            {currentIdx + 1} of {completed.length}
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

        {/* Right: Flag icon + Next/Done */}
        <div className="flex items-center gap-2">
          <button
            onClick={toggleFlag}
            className={`p-2 rounded-lg border transition-colors ${
              current.flagged
                ? 'text-orange-600 bg-orange-100 border-orange-300'
                : 'text-gray-400 bg-white border-gray-200 hover:border-orange-300 hover:text-orange-500'
            }`}
            title={current.flagged ? 'Unflag' : 'Flag for later'}
          >
            <FlagIcon className="h-5 w-5" />
          </button>
          {currentIdx >= completed.length - 1 ? (
            <button
              onClick={() => setShowExitSummary(true)}
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

      {/* Error state */}
      {current.status === 'error' && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          Error: {current.error || 'Unknown error'}
        </div>
      )}

      {/* Candidates */}
      {current.status === 'done' && current.candidates.length > 0 && (
        <div className={`grid gap-4 ${current.candidates.length === 1 ? 'grid-cols-1 max-w-sm mx-auto' : current.candidates.length === 2 ? 'grid-cols-2 max-w-2xl mx-auto' : 'grid-cols-3'}`}>
          {current.candidates.map((c, cIdx) => {
            const key1f = `${current.name}-${c.rank}-1f`;
            const key3f = `${current.name}-${c.rank}-3f`;

            return (
              <div key={cIdx} className="border border-gray-200 rounded-xl p-3 space-y-3">
                {/* Candidate header */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-600">#{c.rank}</span>
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                    c.score >= 0.9 ? 'bg-green-100 text-green-800' :
                    c.score >= 0.8 ? 'bg-yellow-100 text-yellow-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    {(c.score * 100).toFixed(1)}%
                  </span>
                  <span className="text-xs font-mono text-gray-400">
                    {c.startTime}s&rarr;{c.endTime}s
                  </span>
                </div>

                {/* 1f and 3f side by side */}
                <div className="grid grid-cols-2 gap-2">
                  {/* 1f */}
                  <div>
                    <p className="text-xs font-medium text-gray-500 text-center mb-1">1f crossfade</p>
                    {c.url1f ? (
                      <video src={c.url1f} loop autoPlay muted playsInline className="w-full rounded-lg aspect-[9/16] object-contain bg-black" />
                    ) : (
                      <div className="w-full rounded-lg bg-gray-100 aspect-[9/16] flex items-center justify-center text-xs text-gray-400">Failed</div>
                    )}
                    <div className="flex items-center justify-center gap-2 mt-2">
                      <button
                        onClick={() => handleRate(key1f, 'good', c, current.name, 'crossfade_1f')}
                        className={`p-2 rounded-lg border transition-colors ${
                          ratings[key1f] === 'good'
                            ? 'bg-green-100 border-green-300 text-green-700'
                            : 'bg-white border-gray-200 text-gray-400 hover:border-green-300 hover:text-green-600'
                        }`}
                      >
                        <ThumbsUp />
                      </button>
                      <button
                        onClick={() => handleRate(key1f, 'bad', c, current.name, 'crossfade_1f')}
                        className={`p-2 rounded-lg border transition-colors ${
                          ratings[key1f] === 'bad'
                            ? 'bg-red-100 border-red-300 text-red-700'
                            : 'bg-white border-gray-200 text-gray-400 hover:border-red-300 hover:text-red-600'
                        }`}
                      >
                        <ThumbsDown />
                      </button>
                      {c.url1f && (
                        <button
                          onClick={() => handleDownload(c.url1f!, current.name, '1f')}
                          className={`p-2 rounded-lg border transition-colors ${
                            downloaded.has(current.name)
                              ? 'bg-blue-50 border-blue-200 text-blue-600'
                              : 'bg-white border-gray-200 text-gray-400 hover:border-blue-300 hover:text-blue-600'
                          }`}
                          title="Download"
                        >
                          <DownloadIconMd />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 3f */}
                  <div>
                    <p className="text-xs font-medium text-gray-500 text-center mb-1">3f crossfade</p>
                    {c.url3f ? (
                      <video src={c.url3f} loop autoPlay muted playsInline className="w-full rounded-lg aspect-[9/16] object-contain bg-black" />
                    ) : (
                      <div className="w-full rounded-lg bg-gray-100 aspect-[9/16] flex items-center justify-center text-xs text-gray-400">Failed</div>
                    )}
                    <div className="flex items-center justify-center gap-2 mt-2">
                      <button
                        onClick={() => handleRate(key3f, 'good', c, current.name, 'crossfade_3f')}
                        className={`p-2 rounded-lg border transition-colors ${
                          ratings[key3f] === 'good'
                            ? 'bg-green-100 border-green-300 text-green-700'
                            : 'bg-white border-gray-200 text-gray-400 hover:border-green-300 hover:text-green-600'
                        }`}
                      >
                        <ThumbsUp />
                      </button>
                      <button
                        onClick={() => handleRate(key3f, 'bad', c, current.name, 'crossfade_3f')}
                        className={`p-2 rounded-lg border transition-colors ${
                          ratings[key3f] === 'bad'
                            ? 'bg-red-100 border-red-300 text-red-700'
                            : 'bg-white border-gray-200 text-gray-400 hover:border-red-300 hover:text-red-600'
                        }`}
                      >
                        <ThumbsDown />
                      </button>
                      {c.url3f && (
                        <button
                          onClick={() => handleDownload(c.url3f!, current.name, '3f')}
                          className={`p-2 rounded-lg border transition-colors ${
                            downloaded.has(current.name)
                              ? 'bg-blue-50 border-blue-200 text-blue-600'
                              : 'bg-white border-gray-200 text-gray-400 hover:border-blue-300 hover:text-blue-600'
                          }`}
                          title="Download"
                        >
                          <DownloadIconMd />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {current.status === 'done' && current.candidates.length === 0 && (
        <p className="text-sm text-gray-400">No loop candidates found for this video.</p>
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

function ThumbsUp() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
    </svg>
  );
}

function ThumbsDown() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018c.163 0 .326.02.485.06L17 4m-7 10v2a3.5 3.5 0 003.5 3.5h.792c.458 0 .828-.37.828-.828 0-.714.211-1.412.608-2.006L17 13V4m-7 10h2m5-6h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5" />
    </svg>
  );
}

function DownloadIconMd({ className = '' }: { className?: string }) {
  return (
    <svg className={className || 'h-5 w-5'} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  );
}
