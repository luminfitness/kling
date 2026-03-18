/**
 * Simple Batch Processing - Helper Functions
 *
 * Local-first approach: No task_queue database interactions.
 * All state lives in React component memory.
 */

import { supabase } from './supabase';
import { getActivePrompt } from './promptConfig';
import { downloadVideo } from './videoDownload';
import { uploadToStorage } from './supabaseStorage';
import { trimVideo } from './videoTrimmer';
import { v4 as uuidv4 } from 'uuid';
import type { ExerciseTemplate, ExerciseEntry } from '@/types';

export interface BatchResult {
  template: ExerciseTemplate;
  status: 'completed' | 'failed';
  outputVideoUrl?: string;
  inputVideoUrl?: string;
  videoDurationSec?: number;
  error?: string;
}

export type ProcessingStep =
  | 'downloading'
  | 'trimming'
  | 'uploading'
  | 'submitting'
  | 'processing'
  | 'downloading-output'
  | 'complete'
  | 'failed';

/**
 * Convert technical error messages to human-readable descriptions
 */
export function getHumanReadableError(error: string): string {
  // Try to extract Kling's actual error message from nested JSON
  // e.g. 'Kling API error: 400 - {"code":1201,"message":"The video width should not be less than 340px..."}'
  const jsonMatch = error.match(/\{[^{}]*"message"\s*:\s*"([^"]+)"[^{}]*\}/);
  if (jsonMatch) {
    return jsonMatch[1];
  }

  const errorLower = error.toLowerCase();

  if (errorLower.includes('youtube') && errorLower.includes('download')) {
    return 'YouTube video could not be downloaded. The video may be private, age-restricted, or unavailable.';
  }
  if (errorLower.includes('trim') || errorLower.includes('ffmpeg')) {
    return 'Video trimming failed. The video format may not be supported.';
  }
  if (errorLower.includes('upload') && errorLower.includes('failed')) {
    return 'Failed to upload video to server. Please try again.';
  }
  if (errorLower.includes('no video source')) {
    return 'No video was provided for this exercise.';
  }
  if (errorLower.includes('no position image')) {
    return 'No position/avatar image selected for this exercise.';
  }
  if (errorLower.includes('kling') && errorLower.includes('submission')) {
    return 'Failed to submit to Kling AI. The service may be temporarily unavailable.';
  }
  if (errorLower.includes('kling') && errorLower.includes('processing failed')) {
    return 'Kling AI could not process this video. Try a different video or position image.';
  }
  if (errorLower.includes('timeout') || errorLower.includes('timed out')) {
    return 'Processing took too long and was cancelled. Try a shorter video clip.';
  }
  if (errorLower.includes('poll') || errorLower.includes('status')) {
    return 'Lost connection while checking processing status. The video may still complete.';
  }

  // If no specific match, return a cleaned-up version
  return error.length > 150 ? error.substring(0, 150) + '...' : error;
}

/**
 * Check if a URL is a Vercel Blob URL (safe for processing)
 */
function isUploadedUrl(url: string): boolean {
  return url.includes('blob.vercel-storage.com') || url.includes('supabase.co/storage');
}

/**
 * Download an external video and re-upload to Vercel Blob
 * This ensures all videos go through Blob for reliable processing
 */
export async function reuploadExternalVideo(externalUrl: string): Promise<string> {
  console.log('[SimpleBatch] 📥 Re-uploading external video to Blob...');

  // Fetch the video
  const response = await fetch(externalUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch external video: ${response.status}`);
  }

  const blob = await response.blob();

  // Upload to Supabase Storage directly
  const url = await uploadToSupabase(blob, 'external-video.mp4');
  console.log('[SimpleBatch] ✅ External video re-uploaded to storage');
  return url;
}

/**
 * Download video from any source (YouTube, HLS, direct MP4) with retry logic
 */
export async function downloadVideoWithRetry(sourceUrl: string): Promise<string> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`[SimpleBatch] 📥 Downloading video (attempt ${attempt}/${maxAttempts})...`);

    try {
      const url = await downloadVideo(sourceUrl);
      console.log('[SimpleBatch] ✅ Video downloaded');
      return url;
    } catch (error) {
      console.error(`[SimpleBatch] ❌ Download attempt ${attempt} failed:`, error instanceof Error ? error.message : error);
      if (attempt === maxAttempts) {
        throw error;
      }
      console.log(`[SimpleBatch] ⏳ Waiting 3s before retry...`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  throw new Error('Video download failed after all retries');
}

/**
 * Upload a blob directly to Supabase Storage (bypasses Vercel 4.5MB body limit)
 */
async function uploadToSupabase(blob: Blob, filename: string): Promise<string> {
  const ext = filename.split('.').pop() || 'mp4';
  const path = `videos/${uuidv4()}.${ext}`;
  return uploadToStorage('videos', path, blob, blob.type || 'video/mp4');
}

/**
 * Resize a position image to fit within Kling's size limits.
 * Position images are 1620×2880px which Kling rejects as "too large".
 * Resizes to max 1280px on the longest dimension and re-uploads.
 */
async function resizePositionImageForKling(url: string): Promise<string> {
  const MAX_DIM = 1280;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch position image: ${response.status}`);
  const blob = await response.blob();

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = URL.createObjectURL(blob);
  });

  const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
  if (scale === 1) {
    // Already small enough — use original
    URL.revokeObjectURL(img.src);
    return url;
  }

  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(img.src);

  const resizedBlob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.92)
  );

  const path = `images/${uuidv4()}.jpg`;
  console.log(`[SimpleBatch] 🔄 Resized position image ${img.width}×${img.height} → ${w}×${h}`);
  return uploadToStorage('videos', path, resizedBlob, 'image/jpeg');
}



/**
 * Get position image URL from positions table
 */
export async function getPositionImageUrl(positionId: string): Promise<string | null> {
  if (!positionId || positionId === 'custom') return null;

  const { data, error } = await supabase
    .from('positions')
    .select('public_url')
    .eq('id', positionId)
    .single();

  if (error || !data) return null;
  return data.public_url;
}

/**
 * Submit video to Kling API
 */
export async function submitToKling(params: {
  imageUrl: string;
  videoUrl: string;
  mode: 'std' | 'pro';
  customPrompt?: string;
  characterOrientation?: 'image' | 'video';
}): Promise<string> {
  console.log('[SimpleBatch] 🚀 Submitting to Kling AI...');

  const response = await fetch('/api/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageUrl: params.imageUrl,
      videoUrl: params.videoUrl,
      mode: params.mode,
      characterOrientation: params.characterOrientation || 'video',
      keepOriginalSound: 'no',
      prompt: params.customPrompt || getActivePrompt(),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('[SimpleBatch] ❌ Kling submission failed:', text);
    throw new Error(`Kling submission failed: ${text}`);
  }

  const data = await response.json();
  console.log('[SimpleBatch] ✅ Submitted to Kling');
  return data.taskId;
}

/**
 * Poll Kling API for task status
 */
export async function pollKlingStatus(taskId: string, logStatus: boolean = false): Promise<{
  status: string;
  statusMessage?: string;
  outputVideoUrl?: string;
  videoDurationSec?: number;
}> {
  const response = await fetch(`/api/process/${taskId}`);

  if (!response.ok) {
    throw new Error(`Failed to poll task status: ${response.status}`);
  }

  const data = await response.json();

  if (logStatus) {
    console.log(`[SimpleBatch] 🔄 Kling status: ${data.status}${data.statusMessage ? ` — ${data.statusMessage}` : ''}`);
  }

  return {
    status: data.status,
    statusMessage: data.statusMessage,
    outputVideoUrl: data.videos?.[0]?.url,
    videoDurationSec: data.videos?.[0]?.duration
      ? parseFloat(data.videos[0].duration)
      : undefined,
  };
}

/**
 * Trigger browser download of a file
 * Uses proxy route to avoid CORS issues with external URLs
 */
export async function triggerDownload(url: string, filename: string): Promise<void> {
  // Use our proxy to fetch the file (avoids CORS issues with Kling CDN)
  const proxyUrl = `/api/download-proxy?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;

  const a = document.createElement('a');
  a.href = proxyUrl;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Save completed results to exercise_entries table
 */
export async function saveResultsToLibrary(results: BatchResult[]): Promise<void> {
  const completed = results.filter((r) => r.status === 'completed' && r.outputVideoUrl);

  for (const result of completed) {
    const template = result.template;
    const id = crypto.randomUUID();
    const savedAt = new Date().toISOString();

    // Calculate cost: std = $0.07/sec, pro = $0.112/sec
    const costPerSec = 0.112; // Pro mode for 1080p output
    const costUsd = result.videoDurationSec
      ? parseFloat((result.videoDurationSec * costPerSec).toFixed(2))
      : 0;

    // Check if positionId is a valid UUID
    const isValidUuid =
      template.positionId &&
      template.positionId !== 'custom' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        template.positionId
      );
    const positionUuid = isValidUuid ? template.positionId : null;

    const { error } = await supabase.from('exercise_entries').insert({
      id,
      exercise_name: template.exerciseName,
      equipment_type: template.equipmentType,
      output_video_url: result.outputVideoUrl,
      input_video_url: result.inputVideoUrl || '',
      avatar_id: positionUuid,
      avatar_name: template.positionName,
      avatar_angle: 'front',
      position_id: positionUuid,
      position_name: template.positionName,
      mode: 'pro',
      cost_usd: costUsd,
      custom_prompt: template.customPrompt || null,
      video_duration_sec: result.videoDurationSec ?? null,
      force: template.force || null,
      mechanic: template.mechanic || null,
      limbs: template.limbs || null,
      body: template.body || null,
      difficulty: template.difficulty || null,
      muscles_targeted: template.musclesTargeted || null,
      saved_at: savedAt,
    });

    if (error) {
      console.error(`Failed to save ${template.exerciseName} to library:`, error);
    }
  }
}

/**
 * Delete processed templates from exercise_templates table
 * Only deletes templates that completed successfully — failed ones stay in pending
 */
export async function deleteProcessedTemplates(results: BatchResult[]): Promise<void> {
  for (const result of results) {
    if (result.status !== 'completed') continue;

    const { error } = await supabase
      .from('exercise_templates')
      .delete()
      .eq('id', result.template.id);

    if (error) {
      console.error(`Failed to delete template ${result.template.id}:`, error);
    }
  }

  // Mark failed templates with error info so they show the issue in the pending table
  for (const result of results) {
    if (result.status !== 'failed') continue;

    const { error } = await supabase
      .from('exercise_templates')
      .update({
        had_issue: true,
        error_message: getHumanReadableError(result.error || 'Unknown error'),
      })
      .eq('id', result.template.id);

    if (error) {
      console.error(`Failed to mark template ${result.template.id} as failed:`, error);
    }
  }
}

/**
 * Process a single template through the entire pipeline
 * Returns updates via callback for UI progress
 * @param promptOverride - Optional batch-wide prompt that overrides template.customPrompt
 */
export async function processSingleTemplate(
  template: ExerciseTemplate,
  onStepChange: (step: ProcessingStep, detail?: string) => void,
  promptOverride?: string
): Promise<BatchResult> {
  let inputVideoUrl: string | undefined;

  console.log(`[SimpleBatch] ═══════════════════════════════════════`);
  console.log(`[SimpleBatch] 🎬 Starting: ${template.exerciseName}`);
  console.log(`[SimpleBatch] ═══════════════════════════════════════`);

  try {
    // Step 1: Get video URL
    onStepChange('downloading');

    if (template.inputVideoUrl && isUploadedUrl(template.inputVideoUrl)) {
      // Already uploaded to our storage — use directly (skip re-downloading from source)
      console.log('[SimpleBatch] 📁 Using already-uploaded video from storage');
      inputVideoUrl = template.inputVideoUrl;
    } else if (template.youtubeUrl) {
      // Download video from source (YouTube, HLS, or direct MP4)
      inputVideoUrl = await downloadVideoWithRetry(template.youtubeUrl);
    } else if (template.inputVideoUrl) {
      // External URL → re-upload to Blob for reliable processing
      console.log('[SimpleBatch] 🔄 External URL detected, re-uploading to Blob...');
      inputVideoUrl = await reuploadExternalVideo(template.inputVideoUrl);
    } else {
      throw new Error('No video source provided');
    }

    // Step 2: Get position image URL
    console.log(`[SimpleBatch] 🖼️ Getting position image...`);
    console.log(`[SimpleBatch]    Position ID: ${template.positionId || 'none'}`);
    console.log(`[SimpleBatch]    Position Name: ${template.positionName || 'none'}`);

    let imageUrl: string | undefined;

    if (template.positionId) {
      const positionUrl = await getPositionImageUrl(template.positionId);
      if (positionUrl) imageUrl = positionUrl;
      console.log(`[SimpleBatch]    Fetched from DB: ${positionUrl ? positionUrl.substring(0, 80) + '...' : 'null'}`);
    }

    if (!imageUrl) {
      throw new Error('No position image available');
    }

    // Resize position image to fit Kling's size limits (1620×2880 is too large)
    imageUrl = await resizePositionImageForKling(imageUrl);
    console.log(`[SimpleBatch] ✅ Using position image: ${imageUrl.substring(0, 80)}...`);

    // Step 3: Trim video if start/end times are set
    if (
      template.startTime !== undefined &&
      template.endTime !== undefined &&
      !template.isTrimmed
    ) {
      onStepChange('trimming');
      console.log(`[SimpleBatch] ✂️ Trimming video: ${template.startTime}s → ${template.endTime}s`);
      const trimmedBlob = await trimVideo(inputVideoUrl, template.startTime, template.endTime);
      inputVideoUrl = await uploadToSupabase(trimmedBlob, 'trimmed.mp4');
      console.log('[SimpleBatch] ✅ Trimmed video uploaded');
    }

    // Step 4: Submit to Kling
    onStepChange('submitting');
    console.log(`[SimpleBatch] 📤 Submitting to Kling:`);
    console.log(`[SimpleBatch]    Image URL: ${imageUrl.substring(0, 80)}...`);
    console.log(`[SimpleBatch]    Video URL: ${inputVideoUrl.substring(0, 80)}...`);
    console.log(`[SimpleBatch]    Mode: pro (1080p)`);
    console.log(`[SimpleBatch]    Char Orientation: ${template.characterOrientation || 'video'}`);
    // Priority: promptOverride > template.customPrompt > default
    const effectivePrompt = promptOverride || template.customPrompt;
    const taskId = await submitToKling({
      imageUrl,
      videoUrl: inputVideoUrl,
      mode: 'pro', // Pro mode = 1080p output (std = 720p)
      customPrompt: effectivePrompt,
      characterOrientation: template.characterOrientation,
    });

    // Step 5: Poll until complete
    onStepChange('processing');
    console.log('[SimpleBatch] ⏳ Waiting for Kling to process...');
    let pollResult = await pollKlingStatus(taskId, true);
    let pollCount = 0;
    const maxPolls = 180; // 30 minutes max (10s intervals)

    while (
      pollResult.status !== 'succeed' &&
      pollResult.status !== 'failed' &&
      pollCount < maxPolls
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10000)); // 10 seconds
      pollCount++;
      // Log every minute (6 polls)
      const shouldLog = pollCount % 6 === 0;
      pollResult = await pollKlingStatus(taskId, shouldLog);
      onStepChange('processing', `${Math.floor((pollCount * 10) / 60)}m elapsed`);
    }

    if (pollResult.status === 'failed') {
      const detail = pollResult.statusMessage ? ` — ${pollResult.statusMessage}` : '';
      console.error(`[SimpleBatch] ❌ Kling rejected task${detail}`);
      throw new Error(`Kling processing failed${detail}`);
    }

    if (pollCount >= maxPolls) {
      throw new Error('Kling processing timed out after 30 minutes');
    }

    // Step 6: Download output
    onStepChange('downloading-output');
    console.log('[SimpleBatch] 📥 Downloading output video...');
    if (pollResult.outputVideoUrl) {
      const safeFilename = template.exerciseName.replace(/[^a-zA-Z0-9\s_-]/g, '') + '.mp4';
      await triggerDownload(pollResult.outputVideoUrl, safeFilename);
    }

    console.log(`[SimpleBatch] ✅ COMPLETE: ${template.exerciseName}`);
    onStepChange('complete');
    return {
      template,
      status: 'completed',
      outputVideoUrl: pollResult.outputVideoUrl,
      inputVideoUrl,
      videoDurationSec: pollResult.videoDurationSec,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[SimpleBatch] ❌ FAILED: ${template.exerciseName} - ${errorMessage}`);
    onStepChange('failed', errorMessage);
    return {
      template,
      status: 'failed',
      inputVideoUrl,
      error: errorMessage,
    };
  }
}
