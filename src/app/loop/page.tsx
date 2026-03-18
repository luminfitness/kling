'use client';

import { useState, useRef, useCallback } from 'react';
import { findLoopPoints, findLoopPointsMADOnly, type LoopCandidate, type FrameExtractionProgress } from '@/lib/loopFinder';
import { trimVideoWithCrossfade } from '@/lib/videoTrimmer';
import { trimVideoWithFlowBlend } from '@/lib/flowBlend';
import { supabase } from '@/lib/supabase';
import { uploadToStorage } from '@/lib/supabaseStorage';
import { useLoopResults } from '@/hooks/useLoopResults';
import BatchProcessingModal from '@/components/BatchProcessingModal';
import BatchReviewCarousel from '@/components/BatchReviewCarousel';
import LoopUploadModal from '@/components/LoopUploadModal';
import LoopResultsTable from '@/components/LoopResultsTable';
import type { LoopExerciseSummary } from '@/types';

// ─── Batch Types ─────────────────────────────────────────────────────────────

type BatchStage = 'idle' | 'processing' | 'review';

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

// ─── Single-Video Types ──────────────────────────────────────────────────────

type Stage = 'idle' | 'analyzing' | 'results' | 'error';
type RatingCategory = 'loop_point' | 'crossfade' | 'flow';

const CROSSFADE_FRAMES = [1, 2, 3] as const;
const MORPH_FRAMES = [1, 2] as const;
const FPS = 30;

export default function LoopFinderPage() {
  // ─── Batch State ─────────────────────────────────────────────────────────
  const [batchStage, setBatchStage] = useState<BatchStage>('idle');
  const [batchExercises, setBatchExercises] = useState<BatchExercise[]>([]);
  const [batchCurrentIdx, setBatchCurrentIdx] = useState(0);
  const [batchErrorCount, setBatchErrorCount] = useState(0);
  const [batchStartTime, setBatchStartTime] = useState(0);
  const [batchElapsedMs, setBatchElapsedMs] = useState(0);

  // ─── Upload Modal State ────────────────────────────────────────────────
  const [showUploadModal, setShowUploadModal] = useState(false);

  // ─── Review State ──────────────────────────────────────────────────────
  const [reviewMode, setReviewMode] = useState<'none' | 'single' | 'batch'>('none');
  const [reviewExerciseName, setReviewExerciseName] = useState<string | null>(null);

  // ─── Supabase Results Hook ─────────────────────────────────────────────
  const loopResults = useLoopResults();

  // ─── Single-Video State ──────────────────────────────────────────────────
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState('');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [progress, setProgress] = useState<FrameExtractionProgress | null>(null);
  const [madCandidates, setMadCandidates] = useState<LoopCandidate[]>([]);
  const [ssimCandidates, setSsimCandidates] = useState<LoopCandidate[]>([]);
  const [blobCache, setBlobCache] = useState<Record<string, string>>({});
  const [ratings, setRatings] = useState<Record<string, 'good' | 'bad'>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Batch: Handle file selection ────────────────────────────────────────

  const handleBatchFiles = useCallback((files: FileList) => {
    const videoFiles = Array.from(files).filter((f) => f.type.startsWith('video/'));
    if (videoFiles.length === 0) return;

    const nameCounts = new Map<string, number>();
    const exercises: BatchExercise[] = videoFiles.map((file) => {
      const baseName = file.name.replace(/\.[^.]+$/, '');
      const count = (nameCounts.get(baseName) || 0) + 1;
      nameCounts.set(baseName, count);
      const name = count > 1 ? `${baseName}_${count}` : baseName;
      return { name, file, status: 'pending' as const, candidates: [], flagged: false };
    });

    const finalExercises = exercises.map((e) => {
      const baseName = e.file.name.replace(/\.[^.]+$/, '');
      if ((nameCounts.get(baseName) || 0) > 1 && !e.name.includes('_')) {
        return { ...e, name: `${baseName}_1` };
      }
      return e;
    });

    setBatchExercises(finalExercises);
  }, []);

  // ─── Batch: Process all videos with Supabase persistence ───────────────

  const processBatch = async () => {
    setShowUploadModal(false);
    setBatchStage('processing');
    setBatchCurrentIdx(0);
    setBatchErrorCount(0);
    const startTime = Date.now();
    setBatchStartTime(startTime);
    setBatchElapsedMs(0);

    const updated = [...batchExercises];
    let errorCount = 0;

    for (let i = 0; i < updated.length; i++) {
      setBatchCurrentIdx(i);
      setBatchElapsedMs(Date.now() - startTime);
      updated[i] = { ...updated[i], status: 'processing' };
      setBatchExercises([...updated]);

      const sourceUrl = URL.createObjectURL(updated[i].file);

      try {
        console.log(`[Batch] Processing ${updated[i].name} (${i + 1}/${updated.length})...`);
        const candidates = await findLoopPointsMADOnly(sourceUrl, (p) => {
          if (p.stage === 'extracting' && p.current % 20 === 0) {
            console.log(`[Batch] ${updated[i].name}: extracting frame ${p.current}/${p.total}`);
          }
        });

        const batchCandidates: BatchCandidate[] = [];
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

        for (const c of candidates) {
          let url1f: string | null = null;
          let url3f: string | null = null;

          // Generate 1f crossfade
          try {
            const blob1f = await trimVideoWithCrossfade(sourceUrl, c.startTime, c.endTime, 1 / FPS);
            // Upload to Supabase Storage
            const storagePath = `loop-results/${updated[i].name}/${timestamp}/rank${c.rank}_1f.mp4`;
            const publicUrl = await uploadToStorage('loop-results', storagePath, blob1f, 'video/mp4');
            url1f = publicUrl;

            // Insert row into loop_results_v2
            await supabase.from('loop_results_v2').insert({
              exercise_name: updated[i].name,
              method: 'MAD',
              rank: c.rank,
              score: c.score,
              start_time: c.startTime,
              end_time: c.endTime,
              loop_duration: c.duration,
              algorithm: 'crossfade',
              fade_frames: 1,
              video_url: publicUrl,
              rating: null,
              reviewed: false,
              flagged: false,
              keeper: false,
              downloaded: false,
            });
            console.log(`[Batch] ${updated[i].name} #${c.rank} 1f uploaded`);
          } catch (err) {
            console.error(`1f crossfade failed for ${updated[i].name} #${c.rank}:`, err);
          }

          // Generate 3f crossfade
          try {
            const blob3f = await trimVideoWithCrossfade(sourceUrl, c.startTime, c.endTime, 3 / FPS);
            const storagePath = `loop-results/${updated[i].name}/${timestamp}/rank${c.rank}_3f.mp4`;
            const publicUrl = await uploadToStorage('loop-results', storagePath, blob3f, 'video/mp4');
            url3f = publicUrl;

            await supabase.from('loop_results_v2').insert({
              exercise_name: updated[i].name,
              method: 'MAD',
              rank: c.rank,
              score: c.score,
              start_time: c.startTime,
              end_time: c.endTime,
              loop_duration: c.duration,
              algorithm: 'crossfade',
              fade_frames: 3,
              video_url: publicUrl,
              rating: null,
              reviewed: false,
              flagged: false,
              keeper: false,
              downloaded: false,
            });
            console.log(`[Batch] ${updated[i].name} #${c.rank} 3f uploaded`);
          } catch (err) {
            console.error(`3f crossfade failed for ${updated[i].name} #${c.rank}:`, err);
          }

          batchCandidates.push({
            rank: c.rank,
            startTime: c.startTime,
            endTime: c.endTime,
            duration: c.duration,
            score: c.score,
            url1f,
            url3f,
          });
        }

        console.log(`[Batch] ${updated[i].name}: done — ${batchCandidates.length} candidates, all persisted to Supabase`);
        updated[i] = { ...updated[i], status: 'done', candidates: batchCandidates };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[Batch] ${updated[i].name}: FAILED —`, msg);
        updated[i] = { ...updated[i], status: 'error', error: msg };
        errorCount++;
        setBatchErrorCount(errorCount);
      }

      URL.revokeObjectURL(sourceUrl);
      setBatchExercises([...updated]);
    }

    setBatchElapsedMs(Date.now() - startTime);
    // Refresh results from Supabase, then go to review
    await loopResults.refresh();
    setBatchStage('review');
  };

  const resetBatch = () => {
    setBatchExercises([]);
    setBatchStage('idle');
    setBatchCurrentIdx(0);
    setBatchErrorCount(0);
    setReviewMode('none');
    setReviewExercises([]);
  };

  // ─── Review handlers ───────────────────────────────────────────────────

  const handleReviewExercise = (exerciseName: string) => {
    setReviewExerciseName(exerciseName);
    setReviewMode('single');
  };

  const handleBatchReview = () => {
    setReviewMode('batch');
  };

  const handleDownloadExercise = (exercise: LoopExerciseSummary) => {
    // Download keeper if exists, otherwise download all
    const toDownload = exercise.hasKeeper
      ? exercise.rows.filter((r) => r.keeper)
      : exercise.rows;

    for (const row of toDownload) {
      const a = document.createElement('a');
      a.href = row.video_url;
      a.download = `${exercise.exerciseName}_rank${row.rank}_${row.fade_frames}f.mp4`;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const handleReviewBack = () => {
    setReviewMode('none');
    setReviewExerciseName(null);
    loopResults.refresh();
  };

  // After batch processing completes → go to review via Supabase data
  const handleBatchProcessingReview = () => {
    resetBatch();
    // The table will show results from the hook
  };

  // ─── Single-Video Handlers (unchanged) ───────────────────────────────────

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('video/')) {
      setError('Please select a video file');
      return;
    }
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    Object.values(blobCache).forEach((url) => URL.revokeObjectURL(url));

    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setFileName(file.name);
    setStage('idle');
    setError('');
    setMadCandidates([]);
    setSsimCandidates([]);
    setBlobCache({});
    setRatings({});
    setVideoDuration(null);

    const vid = document.createElement('video');
    vid.onloadedmetadata = () => {
      setVideoDuration(vid.duration);
      vid.src = '';
    };
    vid.src = url;
  }, [videoUrl, blobCache]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleAnalyze = async () => {
    if (!videoUrl) return;
    setStage('analyzing');
    setError('');
    setMadCandidates([]);
    setSsimCandidates([]);
    Object.values(blobCache).forEach((url) => URL.revokeObjectURL(url));
    setBlobCache({});
    setRatings({});

    try {
      const { mad, ssim } = await findLoopPoints(videoUrl, setProgress);
      setMadCandidates(mad);
      setSsimCandidates(ssim);

      setStage('results');
      const cache: Record<string, string> = {};

      const allCandidates: { key: string; c: LoopCandidate }[] = [
        ...mad.map((c, i) => ({ key: `mad-${i}`, c })),
        ...ssim.map((c, i) => ({ key: `ssim-${i}`, c })),
      ];

      for (const { key, c } of allCandidates) {
        for (const frames of CROSSFADE_FRAMES) {
          const fadeDuration = frames / FPS;
          try {
            const blob = await trimVideoWithCrossfade(videoUrl, c.startTime, c.endTime, fadeDuration);
            cache[`${key}-xf${frames}`] = URL.createObjectURL(blob);
            setBlobCache({ ...cache });
          } catch (err) {
            console.error(`Crossfade ${frames}f failed for ${key}:`, err);
          }
        }
      }

      for (const { key, c } of allCandidates) {
        for (const frames of MORPH_FRAMES) {
          const fadeDuration = frames / FPS;
          try {
            const blob = await trimVideoWithFlowBlend(videoUrl, c.startTime, c.endTime, fadeDuration);
            cache[`${key}-mc${frames}`] = URL.createObjectURL(blob);
            setBlobCache({ ...cache });
          } catch (err) {
            console.error(`Morph cut ${frames}f failed for ${key}:`, err);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
      setStage('error');
    }
  };

  const handleRate = async (
    method: 'MAD' | 'SSIM+Histogram',
    methodKey: string,
    idx: number,
    category: RatingCategory,
    rating: 'good' | 'bad'
  ) => {
    const key = `${methodKey}-${idx}-${category}`;
    const candidates = methodKey === 'mad' ? madCandidates : ssimCandidates;
    const c = candidates[idx];
    if (!c) return;

    if (ratings[key] === rating) {
      setRatings((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      await supabase
        .from('loop_ratings')
        .delete()
        .eq('file_name', fileName)
        .eq('method', method)
        .eq('rank', c.rank)
        .eq('blend_type', category);
      return;
    }

    setRatings((prev) => ({ ...prev, [key]: rating }));

    await supabase
      .from('loop_ratings')
      .delete()
      .eq('file_name', fileName)
      .eq('method', method)
      .eq('rank', c.rank)
      .eq('blend_type', category);

    const { error } = await supabase.from('loop_ratings').insert({
      file_name: fileName,
      video_duration_sec: videoDuration,
      method,
      rank: c.rank,
      score: c.score,
      start_time: c.startTime,
      end_time: c.endTime,
      loop_duration: c.duration,
      rating,
      blend_type: category,
    });

    if (error) console.error('Failed to save rating:', error);
  };

  const handleReset = () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    Object.values(blobCache).forEach((url) => URL.revokeObjectURL(url));
    setVideoUrl(null);
    setFileName('');
    setVideoDuration(null);
    setStage('idle');
    setError('');
    setProgress(null);
    setMadCandidates([]);
    setSsimCandidates([]);
    setBlobCache({});
    setRatings({});
  };

  const progressLabel = progress
    ? progress.stage === 'extracting'
      ? `Extracting frames (${progress.current}/${progress.total})...`
      : progress.stage === 'analyzing-mad'
      ? 'Running MAD analysis...'
      : progress.stage === 'analyzing-ssim'
      ? 'Running SSIM + Histogram analysis...'
      : 'Done'
    : '';

  const ratedCount = Object.keys(ratings).length;

  // ─── Derive review exercises from hook data ─────────────────────────────
  const derivedReviewExercises = reviewMode === 'single' && reviewExerciseName
    ? loopResults.exercises.filter((e) => e.exerciseName === reviewExerciseName)
    : reviewMode === 'batch'
    ? loopResults.exercises.filter((e) => !e.reviewed || e.flagged)
    : [];

  // ─── Review Mode (full page) ──────────────────────────────────────────
  if (reviewMode !== 'none') {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12 space-y-4">
        <BatchReviewCarousel
          exercises={derivedReviewExercises}
          onSetKeeper={loopResults.setKeeper}
          onClearKeeper={loopResults.clearKeeper}
          onToggleFlag={loopResults.toggleFlag}
          onMarkReviewed={loopResults.markReviewed}
          onMarkDownloaded={loopResults.markDownloaded}
          onUpdateRating={loopResults.updateRating}
          onUpdate={() => loopResults.refresh()}
          onBack={handleReviewBack}
        />
      </div>
    );
  }

  // ─── Batch processing review (after processing completes, show results from Supabase) ──
  if (batchStage === 'review') {
    // Use the Supabase-backed results for review
    const processedNames = new Set(batchExercises.filter((e) => e.status === 'done').map((e) => e.name));
    const justProcessed = loopResults.exercises.filter((e) => processedNames.has(e.exerciseName));

    return (
      <div className="max-w-6xl mx-auto px-4 py-12 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 mb-1">Processing Complete</h1>
            <p className="text-sm text-gray-500">
              {batchExercises.filter((e) => e.status === 'done').length} videos processed,{' '}
              {batchErrorCount} error{batchErrorCount !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={handleBatchProcessingReview}
            className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            Back to Results
          </button>
        </div>

        {justProcessed.length > 0 && (
          <BatchReviewCarousel
            exercises={justProcessed}
            onSetKeeper={loopResults.setKeeper}
            onClearKeeper={loopResults.clearKeeper}
            onToggleFlag={loopResults.toggleFlag}
            onMarkReviewed={loopResults.markReviewed}
            onMarkDownloaded={loopResults.markDownloaded}
            onUpdateRating={loopResults.updateRating}
            onUpdate={() => loopResults.refresh()}
            onBack={handleBatchProcessingReview}
          />
        )}
      </div>
    );
  }

  // ─── Main Page Layout ──────────────────────────────────────────────────
  return (
    <div className="max-w-6xl mx-auto px-4 py-12 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 mb-1">Video Loop Finder</h1>
          <p className="text-sm text-gray-500">
            Batch process and review exercise loop videos
          </p>
        </div>
        <button
          onClick={() => setShowUploadModal(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          Upload
        </button>
      </div>

      {/* Results Table */}
      <LoopResultsTable
        exercises={loopResults.exercises}
        loading={loopResults.loading}
        onReview={handleReviewExercise}
        onBatchReview={handleBatchReview}
        onDownload={handleDownloadExercise}
      />

      {/* Upload Modal */}
      {showUploadModal && (
        <LoopUploadModal
          onClose={() => { setShowUploadModal(false); setBatchExercises([]); }}
          onFilesSelected={handleBatchFiles}
          onProcess={processBatch}
          exercises={batchExercises}
          onClear={() => setBatchExercises([])}
        />
      )}

      {/* Batch processing modal */}
      {batchStage === 'processing' && (
        <BatchProcessingModal
          currentIndex={batchCurrentIdx}
          total={batchExercises.length}
          currentName={batchExercises[batchCurrentIdx]?.name || ''}
          errorCount={batchErrorCount}
          elapsedMs={batchElapsedMs}
        />
      )}

      {/* ─── Single Video Mode (collapsible) ─── */}
      <details className="border border-gray-200 rounded-xl">
        <summary className="px-4 py-3 text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-50 rounded-xl">
          Single Video Mode
        </summary>
        <div className="px-4 pb-4 pt-2 space-y-6">
          {/* Upload / Drop Zone */}
          {!videoUrl && (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-gray-300 rounded-xl p-12 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 mx-auto text-gray-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-sm text-gray-600 font-medium">Drop a video here or click to browse</p>
              <p className="text-xs text-gray-400 mt-1">MP4 or MOV</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
            </div>
          )}

          {/* Video Preview + Analyze Button */}
          {videoUrl && stage !== 'results' && (
            <div className="inline-flex flex-col items-start gap-2">
              <video src={videoUrl} controls className="rounded-xl max-h-[300px] aspect-[9/16]" />
              <span className="text-sm text-gray-500 truncate max-w-[200px]">{fileName}</span>
              <div className="flex gap-2">
                <button
                  onClick={handleReset}
                  className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Change
                </button>
                <button
                  onClick={handleAnalyze}
                  disabled={stage === 'analyzing'}
                  className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 transition-colors"
                >
                  {stage === 'analyzing' ? (
                    <>
                      <Spinner />
                      {progressLabel}
                    </>
                  ) : (
                    'Loop'
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <svg className="h-4 w-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
            </div>
          )}

          {/* Results */}
          {stage === 'results' && madCandidates.length > 0 && ssimCandidates.length > 0 && (
            <div className="space-y-8">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Results</h2>
                  <p className="text-xs text-gray-400 mt-0.5">{ratedCount} rated</p>
                </div>
                <button
                  onClick={handleReset}
                  className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Try Another Video
                </button>
              </div>

              <AlgorithmSection
                method="MAD"
                methodKey="mad"
                candidates={madCandidates}
                blobCache={blobCache}
                ratings={ratings}
                fileName={fileName}
                onRate={(idx, rating) => handleRate('MAD', 'mad', idx, 'loop_point', rating)}
              />

              <AlgorithmSection
                method="SSIM+Histogram"
                methodKey="ssim"
                candidates={ssimCandidates}
                blobCache={blobCache}
                ratings={ratings}
                fileName={fileName}
                onRate={(idx, rating) => handleRate('SSIM+Histogram', 'ssim', idx, 'loop_point', rating)}
              />
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

function AlgorithmSection({
  method,
  methodKey,
  candidates,
  blobCache,
  ratings,
  fileName,
  onRate,
}: {
  method: string;
  methodKey: string;
  candidates: LoopCandidate[];
  blobCache: Record<string, string>;
  ratings: Record<string, 'good' | 'bad'>;
  fileName: string;
  onRate: (idx: number, rating: 'good' | 'bad') => void;
}) {
  const bestScore = candidates[0]?.score ?? 0;

  const scoreColor = (score: number) =>
    score >= 0.9
      ? 'bg-green-100 text-green-800'
      : score >= 0.8
      ? 'bg-yellow-100 text-yellow-800'
      : 'bg-red-100 text-red-800';

  const handleDownload = (blobUrl: string, label: string, rank: number) => {
    const a = document.createElement('a');
    a.href = blobUrl;
    const baseName = fileName.replace(/\.[^.]+$/, '');
    a.download = `${baseName}-loop-${methodKey}-${rank}-${label}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <h3 className="font-semibold text-gray-900">{method}</h3>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${scoreColor(bestScore)}`}>
          Best: {(bestScore * 100).toFixed(1)}%
        </span>
      </div>

      <div className="space-y-2">
        {candidates.map((c, idx) => {
          const baseKey = `${methodKey}-${idx}`;
          const loopRating = ratings[`${baseKey}-loop_point`];

          return (
            <div
              key={idx}
              className={`border rounded-xl p-2 transition-colors ${
                loopRating === 'good'
                  ? 'border-green-300 bg-green-50/30'
                  : loopRating === 'bad'
                  ? 'border-red-200 bg-red-50/20'
                  : 'border-gray-200'
              }`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-semibold text-gray-500">#{c.rank}</span>
                <span className="text-xs font-mono text-gray-600">
                  {c.startTime}s&rarr;{c.endTime}s ({c.duration}s)
                </span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${scoreColor(c.score)}`}>
                  {(c.score * 100).toFixed(1)}%
                </span>
                <div className="flex-1" />
                <div className="flex gap-1">
                  <button
                    onClick={() => onRate(idx, 'good')}
                    className={`p-1 rounded transition-colors ${
                      loopRating === 'good'
                        ? 'bg-green-200 text-green-800'
                        : 'hover:bg-green-50 text-gray-300 hover:text-green-600'
                    }`}
                    title="Good loop points"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                    </svg>
                  </button>
                  <button
                    onClick={() => onRate(idx, 'bad')}
                    className={`p-1 rounded transition-colors ${
                      loopRating === 'bad'
                        ? 'bg-red-200 text-red-800'
                        : 'hover:bg-red-50 text-gray-300 hover:text-red-600'
                    }`}
                    title="Bad loop points"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018c.163 0 .326.02.485.06L17 4m-7 10v2a3.5 3.5 0 003.5 3.5h.792c.458 0 .828-.37.828-.828 0-.714.211-1.412.608-2.006L17 13V4m-7 10h2m5-6h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-2">
                <div>
                  <p className="text-[10px] font-medium text-gray-400 text-center mb-0.5">Start Frame</p>
                  {c.startFrameUrl ? (
                    <img src={c.startFrameUrl} alt="Start frame" className="w-full rounded border border-gray-200 aspect-[9/16] object-contain bg-black" />
                  ) : (
                    <div className="w-full rounded bg-gray-100 aspect-[9/16]" />
                  )}
                  <p className="text-[10px] text-gray-400 mt-0.5 text-center">{c.startTime}s</p>
                </div>

                <div>
                  <p className="text-[10px] font-medium text-gray-400 text-center mb-0.5">End Frame</p>
                  {c.endFrameUrl ? (
                    <img src={c.endFrameUrl} alt="End frame" className="w-full rounded border border-gray-200 aspect-[9/16] object-contain bg-black" />
                  ) : (
                    <div className="w-full rounded bg-gray-100 aspect-[9/16]" />
                  )}
                  <p className="text-[10px] text-gray-400 mt-0.5 text-center">{c.endTime}s</p>
                </div>

                <div>
                  <p className="text-[10px] font-medium text-gray-400 text-center mb-0.5">Crossfades</p>
                  <div className="grid grid-cols-3 gap-1">
                    {CROSSFADE_FRAMES.map((frames) => {
                      const cacheKey = `${baseKey}-xf${frames}`;
                      const url = blobCache[cacheKey];
                      const ms = Math.round((frames / FPS) * 1000);
                      return (
                        <div key={frames}>
                          {url ? (
                            <video key={url} src={url} loop autoPlay muted playsInline className="w-full rounded aspect-[9/16] object-contain bg-black" />
                          ) : (
                            <div className="w-full rounded bg-gray-100 aspect-[9/16] flex items-center justify-center">
                              <Spinner />
                            </div>
                          )}
                          <div className="flex items-center justify-center gap-0.5 mt-0.5">
                            <p className="text-[9px] text-gray-400">{frames}f / {ms}ms</p>
                            {url && (
                              <button
                                onClick={() => handleDownload(url, `xf${frames}f`, c.rank)}
                                className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                                title="Download"
                              >
                                <DownloadIcon />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-medium text-gray-400 text-center mb-0.5">Morph Cut</p>
                  <div className="grid grid-cols-2 gap-1">
                    {MORPH_FRAMES.map((frames) => {
                      const cacheKey = `${baseKey}-mc${frames}`;
                      const url = blobCache[cacheKey];
                      const ms = Math.round((frames / FPS) * 1000);
                      return (
                        <div key={frames}>
                          {url ? (
                            <video key={url} src={url} loop autoPlay muted playsInline className="w-full rounded aspect-[9/16] object-contain bg-black" />
                          ) : (
                            <div className="w-full rounded bg-gray-100 aspect-[9/16] flex items-center justify-center">
                              <Spinner />
                            </div>
                          )}
                          <div className="flex items-center justify-center gap-0.5 mt-0.5">
                            <p className="text-[9px] text-gray-400">{frames}f / {ms}ms</p>
                            {url && (
                              <button
                                onClick={() => handleDownload(url, `mc${frames}f`, c.rank)}
                                className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                                title="Download"
                              >
                                <DownloadIcon />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}
