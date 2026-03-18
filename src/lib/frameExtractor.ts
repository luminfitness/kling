/**
 * Frame Extractor - Extracts frames from video using Canvas API
 * Used for Claude Vision analysis to detect exercise repetitions
 */

export interface ExtractedFrame {
  time: number;      // Timestamp in seconds
  dataUrl: string;   // Base64 JPEG data URL
}

export interface ExtractionProgress {
  current: number;
  total: number;
  stage: 'loading' | 'extracting';
}

/**
 * Extract frames from a video URL at specified intervals
 * @param videoUrl URL of the video to extract frames from
 * @param intervalSeconds Seconds between each frame (default 0.5)
 * @param maxFrames Maximum number of frames to extract (default 40)
 * @param onProgress Optional progress callback
 * @returns Array of extracted frames with timestamps
 */
export async function extractFrames(
  videoUrl: string,
  intervalSeconds: number = 0.5,
  maxFrames: number = 40,
  onProgress?: (progress: ExtractionProgress) => void
): Promise<ExtractedFrame[]> {
  // Fetch video as blob first to avoid CORS issues with the video element.
  // Vercel Blob URLs support fetch CORS but the video element's crossOrigin
  // attribute can fail depending on redirect behavior and headers.
  let objectUrl: string | null = null;

  try {
    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch video: ${response.status}`);
    }
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('video/')) {
      console.warn(`[FrameExtractor] Unexpected content-type: ${contentType}`);
    }
    const blob = await response.blob();
    objectUrl = URL.createObjectURL(blob);
  } catch (fetchErr: any) {
    throw new Error(`Video fetch failed: ${fetchErr.message}`);
  }

  const localUrl = objectUrl;

  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;

    let loadTimeout: ReturnType<typeof setTimeout>;

    const cleanup = () => {
      clearTimeout(loadTimeout);
      video.remove();
      if (localUrl) URL.revokeObjectURL(localUrl);
    };

    // Timeout for loading
    loadTimeout = setTimeout(() => {
      cleanup();
      reject(new Error('Video load timeout - video may be inaccessible'));
    }, 30000);

    video.onloadedmetadata = async () => {
      clearTimeout(loadTimeout);

      try {
        const duration = video.duration;
        if (!duration || duration === Infinity) {
          cleanup();
          reject(new Error('Could not determine video duration'));
          return;
        }

        // Calculate how many frames we need
        const frameCount = Math.min(
          Math.floor(duration / intervalSeconds),
          maxFrames
        );

        if (frameCount < 1) {
          cleanup();
          reject(new Error('Video too short for frame extraction'));
          return;
        }

        onProgress?.({ current: 0, total: frameCount, stage: 'loading' });

        // Create canvas for frame capture
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          cleanup();
          reject(new Error('Could not create canvas context'));
          return;
        }

        // Scale down for API efficiency (max 720p height)
        const scale = Math.min(1, 720 / video.videoHeight);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);

        const frames: ExtractedFrame[] = [];

        // Extract frames sequentially
        for (let i = 0; i < frameCount; i++) {
          const time = i * intervalSeconds;

          // Seek to time
          video.currentTime = time;

          // Wait for seek to complete
          await new Promise<void>((seekResolve, seekReject) => {
            const seekTimeout = setTimeout(() => {
              seekReject(new Error(`Seek timeout at ${time}s`));
            }, 5000);

            video.onseeked = () => {
              clearTimeout(seekTimeout);
              seekResolve();
            };

            video.onerror = () => {
              clearTimeout(seekTimeout);
              seekReject(new Error(`Video error at ${time}s`));
            };
          });

          // Draw frame to canvas
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          // Convert to JPEG data URL (0.7 quality for size/clarity balance)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);

          frames.push({ time, dataUrl });

          onProgress?.({ current: i + 1, total: frameCount, stage: 'extracting' });
        }

        cleanup();
        resolve(frames);
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    video.onerror = () => {
      const code = video.error?.code;
      const msg = video.error?.message || 'unknown';
      cleanup();
      reject(new Error(`Failed to load video (code=${code}: ${msg})`));
    };

    // Load from local blob URL (no CORS issues)
    video.src = localUrl;
  });
}

/**
 * Get video duration without extracting frames
 */
export async function getVideoDurationFromUrl(videoUrl: string): Promise<number> {
  // Fetch as blob to avoid CORS issues with video element
  const response = await fetch(videoUrl);
  if (!response.ok) throw new Error(`Failed to fetch video: ${response.status}`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';

    const timeout = setTimeout(() => {
      video.remove();
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Duration check timeout'));
    }, 10000);

    video.onloadedmetadata = () => {
      clearTimeout(timeout);
      const duration = video.duration;
      video.remove();
      URL.revokeObjectURL(objectUrl);
      if (!duration || duration === Infinity) {
        reject(new Error('Could not determine duration'));
      } else {
        resolve(duration);
      }
    };

    video.onerror = () => {
      clearTimeout(timeout);
      video.remove();
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load video'));
    };

    video.src = objectUrl;
  });
}
