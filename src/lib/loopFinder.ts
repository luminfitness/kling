/**
 * Client-side video loop finder
 * Two algorithms inspired by BBC video-loop-finder (MAD) and LoopyCut (SSIM + Histogram)
 */

export interface LoopCandidate {
  rank: number;           // 1-3
  startTime: number;
  endTime: number;
  duration: number;
  score: number;          // 0-1, higher = better match
  startFrameUrl: string;  // data URL of the start frame
  endFrameUrl: string;    // data URL of the end frame
}

export interface FrameExtractionProgress {
  stage: 'extracting' | 'analyzing-mad' | 'analyzing-ssim' | 'done';
  current: number;
  total: number;
}

interface FrameData {
  time: number;
  grayscale: Float32Array;
  imageData: ImageData;
}

interface RawCandidate {
  startIdx: number;
  endIdx: number;
  score: number;
}

const FRAME_WIDTH = 160;
const FRAME_HEIGHT = 120;
const PIXEL_COUNT = FRAME_WIDTH * FRAME_HEIGHT;
const MAX_FRAMES = 300;
const FRAME_INTERVAL = 0.1; // seconds between frames
const SEEK_TIMEOUT_MS = 5000; // max wait for a single seek operation
const MIN_LOOP_DURATION = 2.5; // seconds — exercise reps are never shorter than this
const IDEAL_MIN = 3; // sweet spot lower bound
const IDEAL_MAX = 7; // sweet spot upper bound
const TOP_KEEP = 30; // track top N during scan
const DEDUP_THRESHOLD = 0.5; // seconds — discard if both start & end within this of a better candidate
const TOP_CANDIDATES = 3;

/**
 * Duration bonus: 1.0 inside the 3-7s sweet spot, tapers to 0.85 outside it.
 */
function durationBonus(durationSec: number): number {
  if (durationSec >= IDEAL_MIN && durationSec <= IDEAL_MAX) return 1.0;
  if (durationSec < IDEAL_MIN) {
    return 0.85 + 0.15 * ((durationSec - MIN_LOOP_DURATION) / (IDEAL_MIN - MIN_LOOP_DURATION));
  }
  const overshoot = durationSec - IDEAL_MAX;
  return Math.max(0.85, 1.0 - overshoot * 0.01);
}

/**
 * Insert into a sorted-descending top-N list
 */
function insertCandidate(list: RawCandidate[], candidate: RawCandidate, maxSize: number) {
  // Find insertion point
  let i = list.length;
  while (i > 0 && list[i - 1].score < candidate.score) i--;
  if (i >= maxSize) return; // worse than all tracked
  list.splice(i, 0, candidate);
  if (list.length > maxSize) list.pop();
}

/**
 * De-duplicate: discard any candidate whose start AND end are both within
 * DEDUP_THRESHOLD seconds of a higher-ranked candidate.
 */
function deduplicateCandidates(candidates: RawCandidate[], frames: FrameData[]): RawCandidate[] {
  const kept: RawCandidate[] = [];
  for (const c of candidates) {
    const startTime = frames[c.startIdx].time;
    const endTime = frames[c.endIdx].time;
    const tooClose = kept.some((k) => {
      const ks = frames[k.startIdx].time;
      const ke = frames[k.endIdx].time;
      return Math.abs(startTime - ks) < DEDUP_THRESHOLD && Math.abs(endTime - ke) < DEDUP_THRESHOLD;
    });
    if (!tooClose) kept.push(c);
    if (kept.length >= TOP_CANDIDATES) break;
  }
  return kept;
}

/**
 * Convert raw candidates to LoopCandidate[] (without frame URLs — filled later)
 */
function toLoopCandidates(raw: RawCandidate[], frames: FrameData[]): LoopCandidate[] {
  return raw.map((c, i) => ({
    rank: i + 1,
    startTime: parseFloat(frames[c.startIdx].time.toFixed(2)),
    endTime: parseFloat(frames[c.endIdx].time.toFixed(2)),
    duration: parseFloat((frames[c.endIdx].time - frames[c.startIdx].time).toFixed(2)),
    score: parseFloat(c.score.toFixed(4)),
    startFrameUrl: '',
    endFrameUrl: '',
  }));
}

/**
 * Extract frames from a video as ImageData at low resolution
 */
async function extractFrames(
  videoUrl: string,
  onProgress: (current: number, total: number) => void
): Promise<FrameData[]> {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.preload = 'auto';

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('Failed to load video'));
    video.src = videoUrl;
  });

  await new Promise<void>((resolve, reject) => {
    if (video.readyState >= 3) { resolve(); return; }
    const timer = setTimeout(() => {
      video.oncanplaythrough = null;
      reject(new Error('Video failed to load — timed out waiting for canplaythrough'));
    }, 15000);
    video.oncanplaythrough = () => {
      clearTimeout(timer);
      resolve();
    };
    video.load();
  });

  const duration = video.duration;
  const totalFrames = Math.min(Math.floor(duration / FRAME_INTERVAL), MAX_FRAMES);

  const canvas = document.createElement('canvas');
  canvas.width = FRAME_WIDTH;
  canvas.height = FRAME_HEIGHT;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  const frames: FrameData[] = [];

  for (let i = 0; i < totalFrames; i++) {
    const time = i * FRAME_INTERVAL;
    onProgress(i + 1, totalFrames);

    video.currentTime = time;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        video.onseeked = null;
        reject(new Error(`Seek timed out at ${time.toFixed(2)}s (frame ${i + 1}/${totalFrames})`));
      }, SEEK_TIMEOUT_MS);
      video.onseeked = () => {
        clearTimeout(timer);
        resolve();
      };
    });

    ctx.drawImage(video, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
    const imageData = ctx.getImageData(0, 0, FRAME_WIDTH, FRAME_HEIGHT);

    const grayscale = new Float32Array(PIXEL_COUNT);
    for (let p = 0; p < PIXEL_COUNT; p++) {
      const idx = p * 4;
      grayscale[p] = 0.299 * imageData.data[idx] + 0.587 * imageData.data[idx + 1] + 0.114 * imageData.data[idx + 2];
    }

    frames.push({ time, grayscale, imageData });
  }

  video.src = '';
  video.load();

  return frames;
}

/**
 * Method A: Mean Absolute Difference (BBC video-loop-finder inspired)
 * Lower MAD = more similar frames. Score = 1 - (MAD/255)
 */
function findLoopMAD(frames: FrameData[]): LoopCandidate[] {
  const n = frames.length;
  const startLimit = Math.floor(n * 0.3);
  const minGapFrames = Math.ceil(MIN_LOOP_DURATION / FRAME_INTERVAL);

  const topList: RawCandidate[] = [];

  for (let si = 0; si < startLimit; si++) {
    const startGray = frames[si].grayscale;
    for (let ei = si + minGapFrames; ei < n; ei++) {
      const endGray = frames[ei].grayscale;

      let sum = 0;
      for (let p = 0; p < PIXEL_COUNT; p++) {
        sum += Math.abs(startGray[p] - endGray[p]);
      }
      const mad = sum / PIXEL_COUNT;
      const rawScore = 1 - mad / 255;
      const dur = frames[ei].time - frames[si].time;
      const score = rawScore * durationBonus(dur);

      insertCandidate(topList, { startIdx: si, endIdx: ei, score }, TOP_KEEP);
    }
  }

  const deduped = deduplicateCandidates(topList, frames);
  return toLoopCandidates(deduped, frames);
}

/**
 * Compute SSIM between two grayscale arrays
 */
function computeSSIM(a: Float32Array, b: Float32Array): number {
  const n = a.length;
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;

  let sumA = 0, sumB = 0, sumA2 = 0, sumB2 = 0, sumAB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i];
    sumB += b[i];
    sumA2 += a[i] * a[i];
    sumB2 += b[i] * b[i];
    sumAB += a[i] * b[i];
  }

  const meanA = sumA / n;
  const meanB = sumB / n;
  const varA = sumA2 / n - meanA * meanA;
  const varB = sumB2 / n - meanB * meanB;
  const covAB = sumAB / n - meanA * meanB;

  const numerator = (2 * meanA * meanB + C1) * (2 * covAB + C2);
  const denominator = (meanA * meanA + meanB * meanB + C1) * (varA + varB + C2);

  return numerator / denominator;
}

/**
 * Compute histogram correlation between two ImageData
 */
function computeHistogramCorrelation(a: ImageData, b: ImageData): number {
  let totalCorr = 0;

  for (let ch = 0; ch < 3; ch++) {
    const histA = new Float64Array(256);
    const histB = new Float64Array(256);

    for (let p = 0; p < PIXEL_COUNT; p++) {
      histA[a.data[p * 4 + ch]]++;
      histB[b.data[p * 4 + ch]]++;
    }

    for (let i = 0; i < 256; i++) {
      histA[i] /= PIXEL_COUNT;
      histB[i] /= PIXEL_COUNT;
    }

    let meanA = 0, meanB = 0;
    for (let i = 0; i < 256; i++) { meanA += histA[i]; meanB += histB[i]; }
    meanA /= 256; meanB /= 256;

    let num = 0, denA = 0, denB = 0;
    for (let i = 0; i < 256; i++) {
      const da = histA[i] - meanA;
      const db = histB[i] - meanB;
      num += da * db;
      denA += da * da;
      denB += db * db;
    }
    const den = Math.sqrt(denA * denB);
    totalCorr += den > 0 ? num / den : 0;
  }

  return totalCorr / 3;
}

/**
 * Method B: SSIM + Histogram Correlation (LoopyCut inspired)
 * Combined score = 0.6 * SSIM + 0.4 * histCorrelation
 */
function findLoopSSIM(frames: FrameData[]): LoopCandidate[] {
  const n = frames.length;
  const startLimit = Math.floor(n * 0.3);
  const minGapFrames = Math.ceil(MIN_LOOP_DURATION / FRAME_INTERVAL);

  const topList: RawCandidate[] = [];

  for (let si = 0; si < startLimit; si++) {
    for (let ei = si + minGapFrames; ei < n; ei++) {
      const ssim = computeSSIM(frames[si].grayscale, frames[ei].grayscale);
      const histCorr = computeHistogramCorrelation(frames[si].imageData, frames[ei].imageData);
      const rawScore = 0.6 * ssim + 0.4 * histCorr;
      const dur = frames[ei].time - frames[si].time;
      const score = rawScore * durationBonus(dur);

      insertCandidate(topList, { startIdx: si, endIdx: ei, score }, TOP_KEEP);
    }
  }

  const deduped = deduplicateCandidates(topList, frames);
  // Normalize scores to 0-1 range
  return toLoopCandidates(deduped, frames).map((c) => ({
    ...c,
    score: parseFloat(Math.max(0, Math.min(1, c.score)).toFixed(4)),
  }));
}

/**
 * Capture a higher-res frame from a video at a specific time
 */
async function captureFrameAtTime(videoUrl: string, time: number): Promise<string> {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.preload = 'auto';

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('Failed to load video'));
    video.src = videoUrl;
  });

  await new Promise<void>((resolve, reject) => {
    if (video.readyState >= 3) { resolve(); return; }
    const timer = setTimeout(() => {
      video.oncanplaythrough = null;
      reject(new Error('Video failed to load — timed out waiting for canplaythrough'));
    }, 15000);
    video.oncanplaythrough = () => {
      clearTimeout(timer);
      resolve();
    };
    video.load();
  });

  video.currentTime = time;
  await new Promise<void>((resolve) => {
    video.onseeked = () => resolve();
  });

  const scale = Math.min(1, 480 / video.videoWidth);
  const w = Math.round(video.videoWidth * scale);
  const h = Math.round(video.videoHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(video, 0, 0, w, h);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

  video.src = '';
  video.load();

  return dataUrl;
}

/**
 * Run both loop-finding algorithms on a video
 */
/**
 * MAD-only loop finding (for batch processing — skips SSIM + frame capture)
 * Returns 1-3 candidates based on natural dedup (0.5s threshold).
 */
export async function findLoopPointsMADOnly(
  videoUrl: string,
  onProgress: (progress: FrameExtractionProgress) => void
): Promise<LoopCandidate[]> {
  const frames = await extractFrames(videoUrl, (current, total) => {
    onProgress({ stage: 'extracting', current, total });
  });

  if (frames.length < 10) {
    throw new Error('Video too short — need at least 1 second');
  }

  onProgress({ stage: 'analyzing-mad', current: 0, total: 1 });
  const mad = findLoopMAD(frames);
  onProgress({ stage: 'analyzing-mad', current: 1, total: 1 });
  onProgress({ stage: 'done', current: 1, total: 1 });

  return mad;
}

/**
 * Run both loop-finding algorithms on a video
 */
export async function findLoopPoints(
  videoUrl: string,
  onProgress: (progress: FrameExtractionProgress) => void
): Promise<{ mad: LoopCandidate[]; ssim: LoopCandidate[] }> {
  // Step 1: Extract frames
  const frames = await extractFrames(videoUrl, (current, total) => {
    onProgress({ stage: 'extracting', current, total });
  });

  if (frames.length < 10) {
    throw new Error('Video too short — need at least 1 second');
  }

  // Step 2: Run MAD
  onProgress({ stage: 'analyzing-mad', current: 0, total: 1 });
  const mad = findLoopMAD(frames);
  onProgress({ stage: 'analyzing-mad', current: 1, total: 1 });

  // Step 3: Run SSIM + Histogram
  onProgress({ stage: 'analyzing-ssim', current: 0, total: 1 });
  const ssim = findLoopSSIM(frames);
  onProgress({ stage: 'analyzing-ssim', current: 1, total: 1 });

  // Step 4: Capture higher-res frames for all unique times across both sets
  const allTimes: number[] = [];
  for (const c of [...mad, ...ssim]) {
    allTimes.push(c.startTime, c.endTime);
  }
  const uniqueTimes = allTimes.filter((t, i) => allTimes.indexOf(t) === i);
  const frameCache = new Map<number, string>();
  for (let i = 0; i < uniqueTimes.length; i++) {
    frameCache.set(uniqueTimes[i], await captureFrameAtTime(videoUrl, uniqueTimes[i]));
  }

  for (const c of mad) {
    c.startFrameUrl = frameCache.get(c.startTime)!;
    c.endFrameUrl = frameCache.get(c.endTime)!;
  }
  for (const c of ssim) {
    c.startFrameUrl = frameCache.get(c.startTime)!;
    c.endFrameUrl = frameCache.get(c.endTime)!;
  }

  onProgress({ stage: 'done', current: 1, total: 1 });

  return { mad, ssim };
}
