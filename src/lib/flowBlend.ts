/**
 * Motion-compensated frame blending for seamless video loops.
 * Uses block matching to compute displacement vectors between end/start frames,
 * then warps and blends transition frames to reduce ghosting vs. simple crossfade.
 */

import { fetchFile } from '@ffmpeg/util';
import { getFFmpeg } from './videoTrimmer';

const BLOCK_SIZE = 16;
const SEARCH_RANGE = 8; // ±8 pixels
const FADE_DURATION = 0.5; // seconds
const FPS = 30;

interface MotionVector {
  dx: number;
  dy: number;
}

/**
 * Extract all frames from a video as ImageData arrays using FFmpeg + Canvas
 */
async function extractFrames(
  videoUrl: string
): Promise<{ frames: ImageData[]; width: number; height: number }> {
  // Use a video element to get dimensions and decode frames
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.preload = 'auto';

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('Failed to load video'));
    video.src = videoUrl;
  });

  await new Promise<void>((resolve) => {
    if (video.readyState >= 3) { resolve(); return; }
    video.oncanplaythrough = () => resolve();
    video.load();
  });

  const duration = video.duration;
  // Use original resolution for best quality
  const width = video.videoWidth;
  const height = video.videoHeight;
  const totalFrames = Math.round(duration * FPS);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  const frames: ImageData[] = [];

  for (let i = 0; i < totalFrames; i++) {
    const time = i / FPS;
    video.currentTime = time;
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
    });

    ctx.drawImage(video, 0, 0, width, height);
    frames.push(ctx.getImageData(0, 0, width, height));
  }

  video.src = '';
  video.load();

  return { frames, width, height };
}

/**
 * Convert ImageData to grayscale array for block matching
 */
function toGrayscale(img: ImageData): Float32Array {
  const gray = new Float32Array(img.width * img.height);
  for (let i = 0; i < gray.length; i++) {
    const idx = i * 4;
    gray[i] = 0.299 * img.data[idx] + 0.587 * img.data[idx + 1] + 0.114 * img.data[idx + 2];
  }
  return gray;
}

/**
 * Block matching: for each block in frameA, find the best matching block in frameB
 * within ±SEARCH_RANGE pixels. Returns a grid of motion vectors.
 */
function computeMotionField(
  frameA: ImageData,
  frameB: ImageData,
  width: number,
  height: number
): MotionVector[][] {
  const grayA = toGrayscale(frameA);
  const grayB = toGrayscale(frameB);

  const blocksX = Math.floor(width / BLOCK_SIZE);
  const blocksY = Math.floor(height / BLOCK_SIZE);
  const field: MotionVector[][] = [];

  for (let by = 0; by < blocksY; by++) {
    const row: MotionVector[] = [];
    for (let bx = 0; bx < blocksX; bx++) {
      const originX = bx * BLOCK_SIZE;
      const originY = by * BLOCK_SIZE;

      let bestSAD = Infinity;
      let bestDx = 0;
      let bestDy = 0;

      // Search in ±SEARCH_RANGE
      for (let dy = -SEARCH_RANGE; dy <= SEARCH_RANGE; dy++) {
        for (let dx = -SEARCH_RANGE; dx <= SEARCH_RANGE; dx++) {
          const refX = originX + dx;
          const refY = originY + dy;

          // Bounds check
          if (refX < 0 || refY < 0 || refX + BLOCK_SIZE > width || refY + BLOCK_SIZE > height) continue;

          // Compute SAD (Sum of Absolute Differences)
          let sad = 0;
          for (let py = 0; py < BLOCK_SIZE; py++) {
            for (let px = 0; px < BLOCK_SIZE; px++) {
              const idxA = (originY + py) * width + (originX + px);
              const idxB = (refY + py) * width + (refX + px);
              sad += Math.abs(grayA[idxA] - grayB[idxB]);
            }
          }

          if (sad < bestSAD) {
            bestSAD = sad;
            bestDx = dx;
            bestDy = dy;
          }
        }
      }

      row.push({ dx: bestDx, dy: bestDy });
    }
    field.push(row);
  }

  return field;
}

/**
 * Get interpolated motion vector at a pixel position using bilinear interpolation
 * between block centers.
 */
function getMotionAt(
  field: MotionVector[][],
  x: number,
  y: number
): { dx: number; dy: number } {
  const blocksY = field.length;
  const blocksX = field[0].length;

  // Map pixel to block-center coordinates
  const bx = (x / BLOCK_SIZE) - 0.5;
  const by = (y / BLOCK_SIZE) - 0.5;

  const bx0 = Math.max(0, Math.min(blocksX - 1, Math.floor(bx)));
  const by0 = Math.max(0, Math.min(blocksY - 1, Math.floor(by)));
  const bx1 = Math.min(blocksX - 1, bx0 + 1);
  const by1 = Math.min(blocksY - 1, by0 + 1);

  const fx = bx - bx0;
  const fy = by - by0;

  const v00 = field[by0][bx0];
  const v10 = field[by0][bx1];
  const v01 = field[by1][bx0];
  const v11 = field[by1][bx1];

  return {
    dx: (1 - fy) * ((1 - fx) * v00.dx + fx * v10.dx) + fy * ((1 - fx) * v01.dx + fx * v11.dx),
    dy: (1 - fy) * ((1 - fx) * v00.dy + fx * v10.dy) + fy * ((1 - fx) * v01.dy + fx * v11.dy),
  };
}

/**
 * Sample a pixel from ImageData with bilinear interpolation, clamped to bounds
 */
function sampleBilinear(img: ImageData, x: number, y: number): [number, number, number] {
  const w = img.width;
  const h = img.height;

  const x0 = Math.max(0, Math.min(w - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(y)));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);

  const fx = x - x0;
  const fy = y - y0;

  const d = img.data;
  const i00 = (y0 * w + x0) * 4;
  const i10 = (y0 * w + x1) * 4;
  const i01 = (y1 * w + x0) * 4;
  const i11 = (y1 * w + x1) * 4;

  const r = (1 - fy) * ((1 - fx) * d[i00] + fx * d[i10]) + fy * ((1 - fx) * d[i01] + fx * d[i11]);
  const g = (1 - fy) * ((1 - fx) * d[i00 + 1] + fx * d[i10 + 1]) + fy * ((1 - fx) * d[i01 + 1] + fx * d[i11 + 1]);
  const b = (1 - fy) * ((1 - fx) * d[i00 + 2] + fx * d[i10 + 2]) + fy * ((1 - fx) * d[i01 + 2] + fx * d[i11 + 2]);

  return [r, g, b];
}

/**
 * Generate a motion-compensated blend between endFrame and startFrame.
 * Instead of simple alpha blend (which ghosts), this warps both frames
 * toward an intermediate position using the motion field.
 */
function motionBlendFrame(
  endFrame: ImageData,
  startFrame: ImageData,
  motionField: MotionVector[][],
  t: number, // 0 = pure end, 1 = pure start
  width: number,
  height: number
): ImageData {
  const output = new ImageData(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const mv = getMotionAt(motionField, x, y);

      // Warp end frame forward by t * motion
      const [er, eg, eb] = sampleBilinear(endFrame, x + t * mv.dx, y + t * mv.dy);
      // Warp start frame backward by (1-t) * motion
      const [sr, sg, sb] = sampleBilinear(startFrame, x - (1 - t) * mv.dx, y - (1 - t) * mv.dy);

      // Blend
      const idx = (y * width + x) * 4;
      output.data[idx] = Math.round((1 - t) * er + t * sr);
      output.data[idx + 1] = Math.round((1 - t) * eg + t * sg);
      output.data[idx + 2] = Math.round((1 - t) * eb + t * sb);
      output.data[idx + 3] = 255;
    }
  }

  return output;
}

/**
 * Encode processed frames back to MP4 using FFmpeg.wasm
 */
async function encodeFrames(
  frames: ImageData[],
  width: number,
  height: number
): Promise<Blob> {
  const ffmpeg = await getFFmpeg();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Write each frame as JPEG to FFmpeg's FS
  for (let i = 0; i < frames.length; i++) {
    ctx.putImageData(frames[i], 0, 0);
    const blob: Blob = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.92)
    );
    const buf = await blob.arrayBuffer();
    const name = `flow_frame_${String(i + 1).padStart(5, '0')}.jpg`;
    await ffmpeg.writeFile(name, new Uint8Array(buf));
  }

  // Encode frames to MP4
  const exitCode = await ffmpeg.exec([
    '-framerate', FPS.toString(),
    '-i', 'flow_frame_%05d.jpg',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-an',
    '-y', 'flow_output.mp4',
  ]);

  if (exitCode !== 0) {
    throw new Error('Flow blend encoding failed');
  }

  const data = await ffmpeg.readFile('flow_output.mp4');
  if (!(data instanceof Uint8Array) || data.length === 0) {
    throw new Error('Flow blend output is empty');
  }

  // Cleanup frame files
  for (let i = 0; i < frames.length; i++) {
    const name = `flow_frame_${String(i + 1).padStart(5, '0')}.jpg`;
    await ffmpeg.deleteFile(name).catch(() => {});
  }
  await ffmpeg.deleteFile('flow_output.mp4').catch(() => {});

  return new Blob([new Uint8Array(data).buffer], { type: 'video/mp4' });
}

/**
 * Trim a video and apply motion-compensated blending for seamless looping.
 * Better than crossfade: warps frames along motion vectors to reduce ghosting.
 */
export async function trimVideoWithFlowBlend(
  videoUrl: string,
  startTime: number,
  endTime: number,
  fadeDuration: number = 0.5
): Promise<Blob> {
  const duration = endTime - startTime;
  const ffmpeg = await getFFmpeg();

  // Step 1: Trim the video using FFmpeg
  const videoData = await fetchFile(videoUrl);
  await ffmpeg.writeFile('flow_input.mp4', videoData);

  const exitCode = await ffmpeg.exec([
    '-i', 'flow_input.mp4',
    '-ss', startTime.toString(),
    '-t', duration.toString(),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18',
    '-an',
    '-avoid_negative_ts', 'make_zero',
    '-y', 'flow_trimmed.mp4',
  ]);

  if (exitCode !== 0) {
    throw new Error('Flow blend trim step failed');
  }

  // Read trimmed video and create a blob URL for frame extraction
  const trimmedData = await ffmpeg.readFile('flow_trimmed.mp4');
  await ffmpeg.deleteFile('flow_input.mp4').catch(() => {});
  await ffmpeg.deleteFile('flow_trimmed.mp4').catch(() => {});

  const trimmedBlob = new Blob([new Uint8Array(trimmedData as Uint8Array).buffer], { type: 'video/mp4' });
  const trimmedUrl = URL.createObjectURL(trimmedBlob);

  try {
    // Step 2: Extract all frames
    const { frames, width, height } = await extractFrames(trimmedUrl);

    if (frames.length < 10) {
      throw new Error('Too few frames for flow blend');
    }

    const fadeFrames = Math.max(1, Math.min(Math.round(fadeDuration * FPS), Math.floor(frames.length / 3)));

    // Step 3: Compute motion field between last frame and first frame
    const lastFrame = frames[frames.length - 1];
    const firstFrame = frames[0];
    const motionField = computeMotionField(lastFrame, firstFrame, width, height);

    // Step 4: Generate blended transition frames
    // Replace the last fadeFrames with motion-compensated blends
    for (let i = 0; i < fadeFrames; i++) {
      const t = (i + 1) / (fadeFrames + 1); // 0→1 excluding endpoints
      const endIdx = frames.length - fadeFrames + i;
      frames[endIdx] = motionBlendFrame(
        frames[endIdx],  // original end frame
        frames[i],       // corresponding start frame
        motionField,
        t,
        width,
        height
      );
    }

    // Step 5: Remove the first fadeFrames (they've been blended into the end)
    const outputFrames = frames.slice(fadeFrames);

    // Step 6: Encode back to MP4
    return await encodeFrames(outputFrames, width, height);
  } finally {
    URL.revokeObjectURL(trimmedUrl);
  }
}
