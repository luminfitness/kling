/**
 * Trimmer Service - Orchestrates auto-trim workflow for exercise videos
 * 1. Extract frames from video
 * 2. Send to Claude Vision to detect one clean rep
 * 3. Trim video using FFmpeg.wasm
 * 4. Return blob URL for preview/download (no database changes)
 */

import { extractFrames, type ExtractionProgress } from './frameExtractor';
import { trimVideo, type TrimProgress } from './videoTrimmer';
import type { ExerciseEntry } from '@/types';

export type TrimStage =
  | 'extracting'
  | 'analyzing'
  | 'trimming'
  | 'complete'
  | 'failed';

export interface TrimProgressUpdate {
  stage: TrimStage;
  percent: number;
  message?: string;
}

export interface TrimResult {
  success: boolean;
  exerciseId: string;
  exerciseName: string;
  trimmedBlobUrl?: string;   // Object URL for preview/playback
  trimmedBlob?: Blob;        // Raw blob for download
  startTime?: number;        // Detected start time
  endTime?: number;          // Detected end time
  duration?: number;         // Duration of trimmed clip
  confidence?: number;       // Claude's confidence score
  reasoning?: string;        // Claude's explanation
  error?: string;            // Error message if failed
}

/**
 * Auto-trim a single exercise video to one clean repetition
 */
export async function autoTrimExercise(
  exercise: ExerciseEntry,
  onProgress: (progress: TrimProgressUpdate) => void
): Promise<TrimResult> {
  const baseResult = {
    exerciseId: exercise.id,
    exerciseName: exercise.exerciseName,
  };

  try {
    // === Stage 1: Extract frames ===
    onProgress({ stage: 'extracting', percent: 5, message: 'Extracting frames...' });

    const frames = await extractFrames(
      exercise.outputVideoUrl,
      0.5,  // 0.5 second intervals
      40,   // Max 40 frames
      (extractProgress: ExtractionProgress) => {
        const percent = 5 + (extractProgress.current / extractProgress.total) * 25;
        onProgress({
          stage: 'extracting',
          percent,
          message: `Extracting frame ${extractProgress.current}/${extractProgress.total}...`,
        });
      }
    );

    if (frames.length < 4) {
      return {
        ...baseResult,
        success: false,
        error: 'Video too short - need at least 2 seconds of content',
      };
    }

    // === Stage 2: Analyze with Claude Vision ===
    onProgress({ stage: 'analyzing', percent: 30, message: 'Analyzing motion...' });

    const analyzeResponse = await fetch('/api/analyze-rep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        frames: frames.map((f) => f.dataUrl),
        frameInterval: 0.5,
        exerciseName: exercise.exerciseName,
      }),
    });

    if (!analyzeResponse.ok) {
      const errorData = await analyzeResponse.json().catch(() => ({}));
      return {
        ...baseResult,
        success: false,
        error: errorData.error || `Analysis failed (${analyzeResponse.status})`,
      };
    }

    const analysis = await analyzeResponse.json();
    const { start_time, end_time, confidence, reasoning } = analysis;

    onProgress({
      stage: 'analyzing',
      percent: 50,
      message: `Found rep: ${start_time.toFixed(1)}s → ${end_time.toFixed(1)}s`,
    });

    // Validate the timestamps
    const duration = end_time - start_time;
    if (duration < 1) {
      return {
        ...baseResult,
        success: false,
        error: 'Detected rep is too short (< 1 second)',
        startTime: start_time,
        endTime: end_time,
      };
    }

    if (duration > 15) {
      return {
        ...baseResult,
        success: false,
        error: 'Detected rep is too long (> 15 seconds) - may not be a single rep',
        startTime: start_time,
        endTime: end_time,
      };
    }

    // === Stage 3: Trim video ===
    onProgress({ stage: 'trimming', percent: 55, message: 'Trimming video...' });

    const trimmedBlob = await trimVideo(
      exercise.outputVideoUrl,
      start_time,
      end_time,
      (trimProgress: TrimProgress) => {
        const percent = 55 + (trimProgress.percent / 100) * 40;
        onProgress({
          stage: 'trimming',
          percent,
          message: trimProgress.stage === 'loading' ? 'Loading FFmpeg...' :
                   trimProgress.stage === 'downloading' ? 'Downloading video...' :
                   trimProgress.stage === 'trimming' ? 'Trimming...' : 'Finishing...',
        });
      }
    );

    // Create object URL for preview
    const trimmedBlobUrl = URL.createObjectURL(trimmedBlob);

    onProgress({ stage: 'complete', percent: 100, message: 'Complete!' });

    return {
      ...baseResult,
      success: true,
      trimmedBlobUrl,
      trimmedBlob,
      startTime: start_time,
      endTime: end_time,
      duration,
      confidence,
      reasoning,
    };
  } catch (error) {
    console.error(`[TrimmerService] Error processing ${exercise.exerciseName}:`, error);
    return {
      ...baseResult,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during trimming',
    };
  }
}

/**
 * Batch process multiple exercises
 * Processes sequentially to avoid overloading FFmpeg
 */
export async function batchAutoTrim(
  exercises: ExerciseEntry[],
  onExerciseProgress: (
    exerciseIndex: number,
    progress: TrimProgressUpdate
  ) => void,
  onExerciseComplete: (
    exerciseIndex: number,
    result: TrimResult
  ) => void
): Promise<TrimResult[]> {
  const results: TrimResult[] = [];

  for (let i = 0; i < exercises.length; i++) {
    const exercise = exercises[i];

    const result = await autoTrimExercise(exercise, (progress) => {
      onExerciseProgress(i, progress);
    });

    results.push(result);
    onExerciseComplete(i, result);
  }

  return results;
}

/**
 * Clean up blob URLs when done
 */
export function cleanupTrimResults(results: TrimResult[]): void {
  for (const result of results) {
    if (result.trimmedBlobUrl) {
      URL.revokeObjectURL(result.trimmedBlobUrl);
    }
  }
}

/**
 * Download a trimmed video
 */
export function downloadTrimmedVideo(result: TrimResult): void {
  if (!result.trimmedBlob) return;

  const a = document.createElement('a');
  a.href = URL.createObjectURL(result.trimmedBlob);
  a.download = `${result.exerciseName.replace(/[^a-z0-9]/gi, '_')}_trimmed.mp4`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

