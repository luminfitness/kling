'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { findLoopPoints, findLoopPointsMADOnly, type LoopCandidate, type FrameExtractionProgress } from '@/lib/loopFinder';
import { trimVideoWithCrossfade } from '@/lib/videoTrimmer';
import { trimVideoWithFlowBlend } from '@/lib/flowBlend';
import { supabase } from '@/lib/supabase';
import BatchProcessingModal from '@/components/BatchProcessingModal';
import BatchReviewCarousel from '@/components/BatchReviewCarousel';

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
  const batchFileInputRef = useRef<HTMLInputElement>(null);

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

    // Deduplicate names
    const nameCounts = new Map<string, number>();
    const exercises: BatchExercise[] = videoFiles.map((file) => {
      const baseName = file.name.replace(/\.[^.]+$/, '');
      const count = (nameCounts.get(baseName) || 0) + 1;
      nameCounts.set(baseName, count);
      const name = count > 1 ? `${baseName}_${count}` : baseName;
      return {
        name,
        file,
        status: 'pending' as const,
        candidates: [],
        flagged: false,
      };
    });

    // Second pass: fix first occurrence if there were duplicates
    const finalExercises = exercises.map((e) => {
      const baseName = e.file.name.replace(/\.[^.]+$/, '');
      if ((nameCounts.get(baseName) || 0) > 1 && !e.name.includes('_')) {
        return { ...e, name: `${baseName}_1` };
      }
      return e;
    });

    setBatchExercises(finalExercises);
  }, []);

  // ─── Batch: Process all videos ───────────────────────────────────────────

  const processBatch = async () => {
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
        // Find loop points (MAD only)
        const candidates = await findLoopPointsMADOnly(sourceUrl, () => {});

        // Generate crossfade variants for each candidate
        const batchCandidates: BatchCandidate[] = [];

        for (const c of candidates) {
          let url1f: string | null = null;
          let url3f: string | null = null;

          try {
            const blob1f = await trimVideoWithCrossfade(sourceUrl, c.startTime, c.endTime, 1 / FPS);
            url1f = URL.createObjectURL(blob1f);
          } catch (err) {
            console.error(`1f crossfade failed for ${updated[i].name} #${c.rank}:`, err);
          }

          try {
            const blob3f = await trimVideoWithCrossfade(sourceUrl, c.startTime, c.endTime, 3 / FPS);
            url3f = URL.createObjectURL(blob3f);
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

        updated[i] = { ...updated[i], status: 'done', candidates: batchCandidates };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        updated[i] = { ...updated[i], status: 'error', error: msg };
        errorCount++;
        setBatchErrorCount(errorCount);
      }

      // Revoke source URL (keep output blob URLs)
      URL.revokeObjectURL(sourceUrl);
      setBatchExercises([...updated]);
    }

    setBatchElapsedMs(Date.now() - startTime);
    setBatchStage('review');
  };

  const resetBatch = () => {
    // Revoke all blob URLs
    for (const ex of batchExercises) {
      for (const c of ex.candidates) {
        if (c.url1f) URL.revokeObjectURL(c.url1f);
        if (c.url3f) URL.revokeObjectURL(c.url3f);
      }
    }
    setBatchExercises([]);
    setBatchStage('idle');
    setBatchCurrentIdx(0);
    setBatchErrorCount(0);
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

  return (
    <div className="max-w-6xl mx-auto px-4 py-12 space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-gray-900 mb-1">Video Loop Finder</h1>
        <p className="text-sm text-gray-500">
          Batch process exercise videos to find loop points and generate crossfade variants.
        </p>
      </div>

      {/* ─── Batch Mode ─── */}

      {batchStage === 'idle' && (
        <div className="space-y-4">
          {/* Batch upload area */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files.length > 0) handleBatchFiles(e.dataTransfer.files);
            }}
            onClick={() => batchFileInputRef.current?.click()}
            className="border-2 border-dashed border-gray-300 rounded-xl p-12 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 mx-auto text-gray-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-sm text-gray-600 font-medium">Drop exercise videos here or click to browse</p>
            <p className="text-xs text-gray-400 mt-1">Select multiple MP4/MOV files for batch processing</p>
            <input
              ref={batchFileInputRef}
              type="file"
              accept="video/*"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && e.target.files.length > 0 && handleBatchFiles(e.target.files)}
            />
          </div>

          {/* Selected files list */}
          {batchExercises.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-700">
                  {batchExercises.length} video{batchExercises.length > 1 ? 's' : ''} selected
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={resetBatch}
                    className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    Clear
                  </button>
                  <button
                    onClick={processBatch}
                    className="px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Process All
                  </button>
                </div>
              </div>
              <div className="max-h-60 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                {batchExercises.map((ex, i) => (
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
        </div>
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

      {/* Batch review carousel */}
      {batchStage === 'review' && (
        <BatchReviewCarousel
          exercises={batchExercises}
          onUpdateExercises={setBatchExercises}
          onBack={resetBatch}
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

          {/* Processed Results (from Python pipeline) */}
          <ProcessedResultsSection />
        </div>
      </details>
    </div>
  );
}

// ─── Processed Results Viewer ─────────────────────────────────────────────────

interface LoopResult {
  id: string;
  exercise_name: string;
  method: string;
  rank: number;
  score: number;
  start_time: number;
  end_time: number;
  loop_duration: number;
  algorithm: string;
  fade_frames: number;
  video_url: string;
  rating: string | null;
  source_video_url: string | null;
  created_at: string;
}

function extractFrameFromVideo(videoUrl: string, time: number): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'auto';

    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      video.src = '';
      video.load();
    };

    const onSeeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          cleanup();
          resolve(dataUrl);
        } else {
          cleanup();
          resolve(null);
        }
      } catch {
        cleanup();
        resolve(null);
      }
    };

    const onError = () => {
      cleanup();
      resolve(null);
    };

    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.src = videoUrl;
    video.load();
    video.addEventListener('loadedmetadata', () => {
      video.currentTime = time;
    }, { once: true });
  });
}

function ProcessedResultsSection() {
  const [exerciseNames, setExerciseNames] = useState<string[]>([]);
  const [selectedExercise, setSelectedExercise] = useState<string>('');
  const [results, setResults] = useState<LoopResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [frameCache, setFrameCache] = useState<Record<string, string | null>>({});

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('loop_results_v2')
        .select('exercise_name')
        .order('created_at', { ascending: false });
      if (data) {
        const unique = Array.from(new Set(data.map((r: { exercise_name: string }) => r.exercise_name)));
        setExerciseNames(unique);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedExercise) {
      setResults([]);
      setFrameCache({});
      return;
    }
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('loop_results_v2')
        .select('*')
        .eq('exercise_name', selectedExercise)
        .order('method')
        .order('rank')
        .order('algorithm')
        .order('fade_frames');
      setResults(data || []);
      setLoading(false);
    })();
  }, [selectedExercise]);

  useEffect(() => {
    if (results.length === 0) return;

    const seen = new Set<string>();
    const toExtract: { key: string; url: string; time: number }[] = [];

    for (const r of results) {
      if (!r.source_video_url) continue;
      const startKey = `${r.method}-${r.rank}-start`;
      const endKey = `${r.method}-${r.rank}-end`;
      if (!seen.has(startKey)) {
        seen.add(startKey);
        toExtract.push({ key: startKey, url: r.source_video_url, time: r.start_time });
      }
      if (!seen.has(endKey)) {
        seen.add(endKey);
        toExtract.push({ key: endKey, url: r.source_video_url, time: r.end_time });
      }
    }

    (async () => {
      for (const { key, url, time } of toExtract) {
        if (frameCache[key] !== undefined) continue;
        const dataUrl = await extractFrameFromVideo(url, time);
        setFrameCache((prev) => ({ ...prev, [key]: dataUrl }));
      }
    })();
  }, [results]); // eslint-disable-line react-hooks/exhaustive-deps

  const deduped = (() => {
    const seen = new Map<string, LoopResult>();
    for (const r of results) {
      const key = `${r.method}-${r.rank}-${r.algorithm}-${r.fade_frames}`;
      const existing = seen.get(key);
      if (!existing || r.created_at > existing.created_at) {
        seen.set(key, r);
      }
    }
    return Array.from(seen.values());
  })();

  const filtered = deduped.filter((r) => !(r.algorithm === 'crossfade' && r.fade_frames === 2));

  const grouped = filtered.reduce<Record<string, Record<number, LoopResult[]>>>((acc, r) => {
    const key = `${r.method}`;
    if (!acc[key]) acc[key] = {};
    if (!acc[key][r.rank]) acc[key][r.rank] = [];
    acc[key][r.rank].push(r);
    return acc;
  }, {});

  const [candidateRatings, setCandidateRatings] = useState<Record<string, 'good' | 'bad'>>({});

  useEffect(() => {
    const stored = localStorage.getItem('loop_candidate_ratings');
    if (stored) setCandidateRatings(JSON.parse(stored));
  }, []);

  const handleCandidateRate = (key: string, rating: 'good' | 'bad') => {
    setCandidateRatings((prev) => {
      const next = { ...prev };
      if (next[key] === rating) {
        delete next[key];
      } else {
        next[key] = rating;
      }
      localStorage.setItem('loop_candidate_ratings', JSON.stringify(next));
      return next;
    });
  };

  const handleRate = async (id: string, rating: 'good' | 'bad') => {
    const current = results.find((r) => r.id === id);
    const newRating = current?.rating === rating ? null : rating;
    await supabase.from('loop_results_v2').update({ rating: newRating }).eq('id', id);
    setResults((prev) => prev.map((r) => r.id === id ? { ...r, rating: newRating } : r));
  };

  if (exerciseNames.length === 0) return null;

  return (
    <div className="border-t border-gray-200 pt-8 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Processed Results</h2>
        <p className="text-sm text-gray-500">Results from the Python morph cut pipeline</p>
      </div>

      <select
        value={selectedExercise}
        onChange={(e) => setSelectedExercise(e.target.value)}
        className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      >
        <option value="">Select an exercise...</option>
        {exerciseNames.map((name) => (
          <option key={name} value={name}>{name}</option>
        ))}
      </select>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Spinner /> Loading results...
        </div>
      )}

      {selectedExercise && !loading && filtered.length > 0 && (
        <div className="space-y-6">
          {Object.entries(grouped).map(([method, ranks]) => (
            <div key={method} className="space-y-3">
              <h3 className="font-semibold text-gray-900">{method}</h3>
              {Object.entries(ranks).map(([rank, items]) => {
                const first = items[0];
                const startFrameKey = `${method}-${rank}-start`;
                const endFrameKey = `${method}-${rank}-end`;
                const startFrame = frameCache[startFrameKey];
                const endFrame = frameCache[endFrameKey];
                const candidateKey = `${selectedExercise}-${method}-${rank}`;
                const candidateRating = candidateRatings[candidateKey];

                return (
                  <div key={rank} className="border border-gray-200 rounded-xl p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-gray-500">#{rank}</span>
                      <span className="text-xs font-mono text-gray-600">
                        {first.start_time}s&rarr;{first.end_time}s ({first.loop_duration}s)
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-800">
                        {(first.score * 100).toFixed(1)}%
                      </span>
                    </div>

                    <div className="flex gap-3">
                      <div className="shrink-0" style={{ width: '16%' }}>
                        <p className="text-[10px] font-medium text-gray-500 text-center mb-0.5">Start</p>
                        {startFrame ? (
                          <img src={startFrame} alt="Start" className="w-full rounded-lg border border-gray-200 aspect-[9/16] object-cover bg-black" />
                        ) : startFrame === null ? (
                          <div className="w-full rounded-lg bg-gray-100 aspect-[9/16] flex items-center justify-center text-xs text-gray-400">N/A</div>
                        ) : (
                          <div className="w-full rounded-lg bg-gray-100 aspect-[9/16] flex items-center justify-center"><Spinner /></div>
                        )}
                        <div className="flex items-center justify-center gap-1 mt-0.5">
                          <p className="text-[9px] text-gray-400">{first.start_time}s</p>
                          <button
                            onClick={() => handleCandidateRate(candidateKey, 'good')}
                            className={`p-0.5 rounded transition-colors ${
                              candidateRating === 'good' ? 'bg-green-200 text-green-800' : 'text-gray-300 hover:text-green-600'
                            }`}
                          >
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleCandidateRate(candidateKey, 'bad')}
                            className={`p-0.5 rounded transition-colors ${
                              candidateRating === 'bad' ? 'bg-red-200 text-red-800' : 'text-gray-300 hover:text-red-600'
                            }`}
                          >
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018c.163 0 .326.02.485.06L17 4m-7 10v2a3.5 3.5 0 003.5 3.5h.792c.458 0 .828-.37.828-.828 0-.714.211-1.412.608-2.006L17 13V4m-7 10h2m5-6h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5" />
                            </svg>
                          </button>
                        </div>
                      </div>

                      <div className="shrink-0" style={{ width: '16%' }}>
                        <p className="text-[10px] font-medium text-gray-500 text-center mb-0.5">End</p>
                        {endFrame ? (
                          <img src={endFrame} alt="End" className="w-full rounded-lg border border-gray-200 aspect-[9/16] object-cover bg-black" />
                        ) : endFrame === null ? (
                          <div className="w-full rounded-lg bg-gray-100 aspect-[9/16] flex items-center justify-center text-xs text-gray-400">N/A</div>
                        ) : (
                          <div className="w-full rounded-lg bg-gray-100 aspect-[9/16] flex items-center justify-center"><Spinner /></div>
                        )}
                        <p className="text-[9px] text-gray-400 mt-0.5 text-center">{first.end_time}s</p>
                      </div>

                      <div className="flex-1 grid grid-cols-4 gap-1.5">
                        {items.slice(0, 8).map((r) => (
                          <div key={r.id}>
                            <video
                              src={r.video_url}
                              loop
                              autoPlay
                              muted
                              playsInline
                              className="w-full rounded aspect-[9/16] object-contain bg-black"
                            />
                            <p className="text-[8px] font-medium text-gray-600 text-center">{r.algorithm} {r.fade_frames}f</p>
                            <div className="flex justify-center gap-0.5">
                              <button
                                onClick={() => handleRate(r.id, 'good')}
                                className={`p-0.5 rounded transition-colors ${
                                  r.rating === 'good' ? 'bg-green-200 text-green-800' : 'text-gray-300 hover:text-green-600'
                                }`}
                              >
                                <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                                </svg>
                              </button>
                              <button
                                onClick={() => handleRate(r.id, 'bad')}
                                className={`p-0.5 rounded transition-colors ${
                                  r.rating === 'bad' ? 'bg-red-200 text-red-800' : 'text-gray-300 hover:text-red-600'
                                }`}
                              >
                                <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018c.163 0 .326.02.485.06L17 4m-7 10v2a3.5 3.5 0 003.5 3.5h.792c.458 0 .828-.37.828-.828 0-.714.211-1.412.608-2.006L17 13V4m-7 10h2m5-6h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5" />
                                </svg>
                              </button>
                              <a
                                href={r.video_url}
                                download
                                className="p-0.5 rounded text-gray-300 hover:text-gray-600 transition-colors"
                                title="Download"
                              >
                                <DownloadIcon />
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {selectedExercise && !loading && filtered.length === 0 && (
        <p className="text-sm text-gray-400">No results found for this exercise.</p>
      )}
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
