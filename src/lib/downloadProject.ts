import JSZip from 'jszip';
import { autoTrimExercise, cleanupTrimResults, type TrimResult, type TrimProgressUpdate } from './trimmerService';
import type { ExerciseEntry } from '@/types';

/**
 * Sanitize a string for use as a filename
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '') // Remove invalid characters
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .trim();
}

export interface TrimmedDownloadProgress {
  stage: 'trimming' | 'zipping';
  exerciseIndex: number;
  exerciseTotal: number;
  exerciseName: string;
  trimProgress?: TrimProgressUpdate;
  completedResults: TrimResult[];
}

/**
 * Download all exercises as a zip file organized by equipment type
 *
 * Structure:
 * ProjectName/
 *   Barbell/
 *     Deadlift_Barbell.mp4
 *     Squat_Barbell.mp4
 *   Dumbbell/
 *     Curl_Dumbbell.mp4
 *   ...
 */
export async function downloadProjectAsZip(
  projectName: string,
  exercises: ExerciseEntry[],
  onProgress?: (current: number, total: number, currentName: string) => void
): Promise<void> {
  const zip = new JSZip();
  const rootFolder = zip.folder(sanitizeFilename(projectName));

  if (!rootFolder) {
    throw new Error('Failed to create zip folder');
  }

  // Group exercises by equipment type
  const byEquipment: Record<string, ExerciseEntry[]> = {};
  for (const exercise of exercises) {
    const equipment = exercise.equipmentType || 'Other';
    if (!byEquipment[equipment]) {
      byEquipment[equipment] = [];
    }
    byEquipment[equipment].push(exercise);
  }

  // Download and add each video to the zip
  let processed = 0;
  const total = exercises.filter(e => e.outputVideoUrl).length;

  for (const [equipment, exerciseList] of Object.entries(byEquipment)) {
    const equipmentFolder = rootFolder.folder(sanitizeFilename(equipment));
    if (!equipmentFolder) continue;

    for (const exercise of exerciseList) {
      if (!exercise.outputVideoUrl) continue;

      const exerciseName = exercise.exerciseName || 'Untitled';
      onProgress?.(processed, total, exerciseName);

      try {
        // Fetch the video blob
        const response = await fetch(exercise.outputVideoUrl);
        if (!response.ok) {
          console.warn(`Failed to fetch ${exerciseName}: ${response.status}`);
          continue;
        }

        const blob = await response.blob();

        // Create filename: ExerciseName_Equipment.mp4
        const filename = `${sanitizeFilename(exerciseName)}_${sanitizeFilename(equipment)}.mp4`;

        // Add to zip
        equipmentFolder.file(filename, blob);
        processed++;
      } catch (error) {
        console.error(`Error downloading ${exerciseName}:`, error);
      }
    }
  }

  onProgress?.(total, total, 'Creating zip file...');

  // Generate the zip file
  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 1 } // Fast compression since videos are already compressed
  });

  // Trigger download
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitizeFilename(projectName)}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Download all exercises as trimmed videos in a zip file organized by equipment type.
 * Each video is auto-trimmed to a single repetition using AI analysis.
 *
 * Structure:
 * ProjectName_Trimmed/
 *   Barbell/
 *     Deadlift_Barbell.mp4
 *     Squat_Barbell.mp4
 *   Dumbbell/
 *     Curl_Dumbbell.mp4
 *   ...
 */
export async function downloadProjectTrimmedAsZip(
  projectName: string,
  exercises: ExerciseEntry[],
  onProgress: (progress: TrimmedDownloadProgress) => void
): Promise<{ successCount: number; failedCount: number; failedNames: string[] }> {
  const exercisesWithVideos = exercises.filter(e => e.outputVideoUrl);
  const total = exercisesWithVideos.length;
  const results: TrimResult[] = [];

  // Stage 1: Trim all videos
  for (let i = 0; i < exercisesWithVideos.length; i++) {
    const exercise = exercisesWithVideos[i];

    onProgress({
      stage: 'trimming',
      exerciseIndex: i,
      exerciseTotal: total,
      exerciseName: exercise.exerciseName || 'Untitled',
      trimProgress: { stage: 'extracting', percent: 0, message: 'Starting...' },
      completedResults: [...results],
    });

    const result = await autoTrimExercise(exercise, (trimProgress) => {
      onProgress({
        stage: 'trimming',
        exerciseIndex: i,
        exerciseTotal: total,
        exerciseName: exercise.exerciseName || 'Untitled',
        trimProgress,
        completedResults: [...results],
      });
    });

    results.push(result);
  }

  // Stage 2: Create zip file
  onProgress({
    stage: 'zipping',
    exerciseIndex: total,
    exerciseTotal: total,
    exerciseName: 'Creating ZIP file...',
    completedResults: results,
  });

  const zip = new JSZip();
  const rootFolder = zip.folder(`${sanitizeFilename(projectName)}_Trimmed`);

  if (!rootFolder) {
    cleanupTrimResults(results);
    throw new Error('Failed to create zip folder');
  }

  // Group successful results by equipment type
  const successfulResults = results.filter(r => r.success && r.trimmedBlob);
  const byEquipment: Record<string, TrimResult[]> = {};

  for (const result of successfulResults) {
    const exercise = exercisesWithVideos.find(e => e.id === result.exerciseId);
    const equipment = exercise?.equipmentType || 'Other';
    if (!byEquipment[equipment]) {
      byEquipment[equipment] = [];
    }
    byEquipment[equipment].push(result);
  }

  // Add trimmed videos to zip
  for (const [equipment, resultList] of Object.entries(byEquipment)) {
    const equipmentFolder = rootFolder.folder(sanitizeFilename(equipment));
    if (!equipmentFolder) continue;

    for (const result of resultList) {
      if (!result.trimmedBlob) continue;

      const exerciseName = result.exerciseName || 'Untitled';
      const filename = `${sanitizeFilename(exerciseName)}_${sanitizeFilename(equipment)}.mp4`;
      equipmentFolder.file(filename, result.trimmedBlob);
    }
  }

  // Generate the zip file
  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 1 }
  });

  // Cleanup blob URLs
  cleanupTrimResults(results);

  // Trigger download
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitizeFilename(projectName)}_Trimmed.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  const failedResults = results.filter(r => !r.success);
  return {
    successCount: successfulResults.length,
    failedCount: failedResults.length,
    failedNames: failedResults.map(r => r.exerciseName),
  };
}

