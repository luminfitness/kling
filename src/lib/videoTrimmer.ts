/**
 * Client-side video trimming using FFmpeg.wasm
 * Used to trim YouTube videos to specific timestamps before sending to Kling API
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

let ffmpegInstance: FFmpeg | null = null;
let loadingPromise: Promise<FFmpeg> | null = null;

// Store last FFmpeg error for debugging
let lastFFmpegError: string | null = null;

/**
 * Get a shared FFmpeg instance, loading it if necessary
 */
export async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;

  // Prevent multiple simultaneous load attempts
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const ffmpeg = new FFmpeg();

    // Only log errors, not the verbose progress output
    ffmpeg.on('log', ({ message }) => {
      // Store errors for debugging
      if (message.toLowerCase().includes('error') || message.toLowerCase().includes('failed')) {
        lastFFmpegError = message;
        console.error('[FFmpeg] Error:', message);
      }
      // Silently ignore all other verbose FFmpeg output
    });

    // Load FFmpeg WASM from jsdelivr CDN (same as AlphaChannelModal)
    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';
    await ffmpeg.load({
      coreURL: `${baseURL}/ffmpeg-core.js`,
      wasmURL: `${baseURL}/ffmpeg-core.wasm`,
    });

    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  return loadingPromise;
}

export interface TrimProgress {
  stage: 'loading' | 'downloading' | 'trimming' | 'done';
  percent: number;
}

/**
 * Trim a video to the specified start and end times
 * @param videoUrl - URL of the video to trim
 * @param startTime - Start time in seconds
 * @param endTime - End time in seconds
 * @param onProgress - Optional callback for progress updates
 * @returns Blob of the trimmed video
 */
export async function trimVideo(
  videoUrl: string,
  startTime: number,
  endTime: number,
  onProgress?: (progress: TrimProgress) => void
): Promise<Blob> {
  const duration = endTime - startTime;
  console.log(`[SimpleBatch] ✂️ Trimming video (${startTime}s - ${endTime}s = ${duration}s)...`);

  // Reset error state
  lastFFmpegError = null;

  onProgress?.({ stage: 'loading', percent: 0 });
  const ffmpeg = await getFFmpeg();

  onProgress?.({ stage: 'downloading', percent: 10 });

  // Fetch the video file
  const videoData = await fetchFile(videoUrl);
  await ffmpeg.writeFile('input.mp4', videoData);

  onProgress?.({ stage: 'trimming', percent: 30 });

  // Re-encode for frame-accurate trimming (stream copy cuts on keyframes, off by 2-4s)
  // -ss after -i for accurate decode-based seeking
  // Re-encoding short clips (5-10s) is fast even in WASM
  const exitCode = await ffmpeg.exec([
    '-i', 'input.mp4',
    '-ss', startTime.toString(),
    '-t', duration.toString(),
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '18',
    '-c:a', 'aac',
    '-avoid_negative_ts', 'make_zero',
    '-movflags', '+faststart',
    '-y',
    'output.mp4',
  ]);

  if (exitCode !== 0) {
    const errorDetail = lastFFmpegError ? `: ${lastFFmpegError}` : '';
    throw new Error(`Video trimming failed${errorDetail}`);
  }

  onProgress?.({ stage: 'done', percent: 90 });

  // Read the output file
  const data = await ffmpeg.readFile('output.mp4');

  if (!(data instanceof Uint8Array) || data.length === 0) {
    throw new Error('Trimmed video is empty - check video format');
  }

  console.log(`[SimpleBatch] ✅ Trim complete (${(data.length / 1024 / 1024).toFixed(2)} MB)`);

  // Clean up input file to free memory
  await ffmpeg.deleteFile('input.mp4').catch(() => {});
  await ffmpeg.deleteFile('output.mp4').catch(() => {});

  onProgress?.({ stage: 'done', percent: 100 });

  // Convert to ArrayBuffer to satisfy TypeScript
  const binaryData = new Uint8Array(data).buffer;
  return new Blob([binaryData], { type: 'video/mp4' });
}

/**
 * Check if FFmpeg is already loaded
 */
export function isFFmpegLoaded(): boolean {
  return ffmpegInstance !== null;
}

/**
 * Get the duration of a video from a URL
 * Uses a video element to probe the metadata
 * @param videoUrl - URL of the video
 * @returns Duration in seconds, or undefined if it couldn't be determined
 */
export async function getVideoDuration(videoUrl: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';

    const cleanup = () => {
      video.src = '';
      video.load();
    };

    video.onloadedmetadata = () => {
      const duration = video.duration;
      cleanup();
      resolve(isFinite(duration) ? duration : undefined);
    };

    video.onerror = () => {
      cleanup();
      resolve(undefined);
    };

    // Timeout after 10 seconds
    const timeout = setTimeout(() => {
      cleanup();
      resolve(undefined);
    }, 10000);

    video.onloadedmetadata = () => {
      clearTimeout(timeout);
      const duration = video.duration;
      cleanup();
      resolve(isFinite(duration) ? duration : undefined);
    };

    video.src = videoUrl;
  });
}

/**
 * Pre-load FFmpeg (call this early to speed up first trim)
 */
export async function preloadFFmpeg(): Promise<void> {
  await getFFmpeg();
}

/**
 * Trim a video and apply a crossfade for seamless looping.
 * Overlays the first FADE seconds (with alpha ramp) on the last FADE seconds.
 * The output is shorter by FADE seconds but loops without a hard cut.
 */
export async function trimVideoWithCrossfade(
  videoUrl: string,
  startTime: number,
  endTime: number,
  fadeDuration: number = 0.5
): Promise<Blob> {
  const duration = endTime - startTime;
  lastFFmpegError = null;

  const ffmpeg = await getFFmpeg();
  const videoData = await fetchFile(videoUrl);
  await ffmpeg.writeFile('xfade_input.mp4', videoData);

  // Step 1: Trim
  let exitCode = await ffmpeg.exec([
    '-i', 'xfade_input.mp4',
    '-ss', startTime.toString(),
    '-t', duration.toString(),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18',
    '-an',
    '-avoid_negative_ts', 'make_zero',
    '-y', 'xfade_trimmed.mp4',
  ]);

  if (exitCode !== 0) {
    throw new Error(`Crossfade trim failed${lastFFmpegError ? `: ${lastFFmpegError}` : ''}`);
  }

  // Step 2: Apply crossfade loop filter
  // Split video: body starts after fade, pre is the first fade-duration seconds
  // Pre gets alpha ramp (transparent→opaque) and is overlaid on the end of body
  const fadeStr = fadeDuration.toFixed(2);
  const shiftPts = (duration - fadeDuration).toFixed(2);

  exitCode = await ffmpeg.exec([
    '-i', 'xfade_trimmed.mp4',
    '-filter_complex',
    `[0]split[body][pre];` +
    `[pre]trim=duration=${fadeStr},format=yuva420p,fade=d=${fadeStr}:alpha=1,setpts=PTS+(${shiftPts})/TB[jt];` +
    `[body]trim=${fadeStr},setpts=PTS-STARTPTS[main];` +
    `[main][jt]overlay`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18',
    '-an',
    '-y', 'xfade_output.mp4',
  ]);

  if (exitCode !== 0) {
    throw new Error(`Crossfade filter failed${lastFFmpegError ? `: ${lastFFmpegError}` : ''}`);
  }

  const data = await ffmpeg.readFile('xfade_output.mp4');
  if (!(data instanceof Uint8Array) || data.length === 0) {
    throw new Error('Crossfade output is empty');
  }

  // Cleanup
  await ffmpeg.deleteFile('xfade_input.mp4').catch(() => {});
  await ffmpeg.deleteFile('xfade_trimmed.mp4').catch(() => {});
  await ffmpeg.deleteFile('xfade_output.mp4').catch(() => {});

  return new Blob([new Uint8Array(data).buffer], { type: 'video/mp4' });
}
