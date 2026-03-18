/**
 * Position Image Generation Utilities
 * Shared by ImportTemplatesModal (auto-generation) and image-gen page
 */

import { extractFrames } from './frameExtractor';
import type { Position } from '@/types';

// The canonical "Standing / Bodyweight" reference position used for Gemini generation
const STANDING_POSITION_ID = '2394f11a-d011-4739-96a2-46384c3ab46f';

/**
 * Find the standing reference position for Gemini position generation.
 * Uses the hardcoded "Standing / Bodyweight" position ID.
 */
export function findReferencePosition(positions: Position[]): Position | null {
  const ref = positions.find(p => p.id === STANDING_POSITION_ID);
  if (!ref) {
    console.warn(`[PositionGen] Standing reference position (${STANDING_POSITION_ID}) not found in positions list.`);
    return null;
  }
  return ref;
}

// Canvas dimensions from Photoshop template
const CANVAS_W = 1620;
const CANVAS_H = 2880;
const HEAD_LINE = 619;
const FEET_LINE = 2724;
const TARGET_H = FEET_LINE - HEAD_LINE; // 2105px

/**
 * Remove green (#1be300) background from an image, returning transparent PNG
 */
export function removeGreenBackground(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const tR = 27, tG = 227, tB = 0;
      const tolerance = 80;
      for (let i = 0; i < data.length; i += 4) {
        const dr = data[i] - tR;
        const dg = data[i + 1] - tG;
        const db = data[i + 2] - tB;
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);
        if (dist < tolerance) {
          data[i + 3] = 0;
        }
      }
      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.src = dataUrl;
  });
}

/**
 * Frame a transparent-background image onto the 1620x2880 green canvas
 * Detects subject bounds, scales to fit, centers horizontally, aligns feet to guide
 */
export function frameOnCanvas(transparentDataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      // Detect subject bounding box
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = img.width;
      tmpCanvas.height = img.height;
      const tmpCtx = tmpCanvas.getContext('2d')!;
      tmpCtx.drawImage(img, 0, 0);
      const pixels = tmpCtx.getImageData(0, 0, img.width, img.height).data;

      let minX = img.width, maxX = 0, minY = img.height, maxY = 0;
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const alpha = pixels[(y * img.width + x) * 4 + 3];
          if (alpha > 10) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      const subjectW = maxX - minX + 1;
      const subjectH = maxY - minY + 1;

      // Scale to fit target height, clamp to canvas width
      let scale = TARGET_H / subjectH;
      if (subjectW * scale > CANVAS_W) {
        scale = CANVAS_W / subjectW;
      }

      const drawW = Math.round(subjectW * scale);
      const drawH = Math.round(subjectH * scale);
      const drawX = Math.round((CANVAS_W - drawW) / 2);
      const drawY = FEET_LINE - drawH;

      // Final canvas
      const canvas = document.createElement('canvas');
      canvas.width = CANVAS_W;
      canvas.height = CANVAS_H;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#1be300';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.drawImage(img, minX, minY, subjectW, subjectH, drawX, drawY, drawW, drawH);
      resolve(canvas.toDataURL('image/png'));
    };
    img.src = transparentDataUrl;
  });
}

/**
 * Extract a single still frame from a video URL (at ~0.5s to avoid black frames)
 */
export async function extractStillFrame(videoUrl: string): Promise<string> {
  const frames = await extractFrames(videoUrl, 0.5, 1);
  if (!frames || frames.length === 0) {
    throw new Error('Could not extract frame from video');
  }
  return frames[0].dataUrl;
}

// Default prompt for two-pass auto-generation (Pass 1)
const AUTO_GEN_PROMPT = 'Make the character in the 1st reference image be in the same pose as the second photo and using the machine the same way. Keep the original background of the first reference image.';

/**
 * Call the Gemini API to generate a position image from reference images.
 * When twoPass=true, the server does both passes in a single request
 * (Pass 1: pose generation, Pass 2: remove branding + black equipment).
 * Returns a data URL of the generated image.
 */
export async function generatePositionImage(
  characterImageUrl: string,
  poseImageDataUrl: string | null,
  prompt: string,
  twoPass: boolean = false
): Promise<string> {
  const response = await fetch('/api/generate-position-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      referenceImage1: characterImageUrl,
      referenceImage2: poseImageDataUrl,
      prompt,
      twoPass,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Position generation failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  if (!data.imageUrl) {
    throw new Error('No image returned from generation API');
  }
  return data.imageUrl;
}

/**
 * Convert a data URL to a File object
 */
function dataUrlToFile(dataUrl: string, filename: string): File {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
  const bstr = atob(arr[1]);
  const u8arr = new Uint8Array(bstr.length);
  for (let i = 0; i < bstr.length; i++) {
    u8arr[i] = bstr.charCodeAt(i);
  }
  return new File([u8arr], filename, { type: mime });
}

/**
 * Full pipeline (two-pass): extract frame → generate pose + refine (server-side) → remove bg → frame on canvas → File
 */
export async function autoGeneratePosition(
  videoUrl: string,
  standingPositionUrl: string,
  exerciseName: string,
): Promise<File> {
  console.log(`[PositionGen] Starting for: ${exerciseName}`);

  // 1. Extract first still frame from video
  console.log('[PositionGen] Extracting frame...');
  const frameDataUrl = await extractStillFrame(videoUrl);

  // 2. Two-pass Gemini call (server-side: pose gen + branding/color refinement)
  console.log('[PositionGen] Generating with Gemini (two-pass)...');
  const generatedDataUrl = await generatePositionImage(
    standingPositionUrl,
    frameDataUrl,
    AUTO_GEN_PROMPT,
    true // twoPass: both passes happen server-side
  );

  // 3. Remove green background
  console.log('[PositionGen] Removing background...');
  const transparentDataUrl = await removeGreenBackground(generatedDataUrl);

  // 4. Frame on 1620x2880 canvas
  console.log('[PositionGen] Framing on canvas...');
  const framedDataUrl = await frameOnCanvas(transparentDataUrl);

  // 5. Convert to File
  const safeName = exerciseName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  const file = dataUrlToFile(framedDataUrl, `position-${safeName}.png`);
  console.log(`[PositionGen] Done: ${(file.size / 1024).toFixed(0)} KB`);

  return file;
}
