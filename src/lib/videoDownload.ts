/**
 * Unified video download library
 * Handles YouTube, direct MP4, and HLS m3u8 URLs
 * Used by ImportTemplatesModal (bulk import), TemplateTable (per-row retry), and simpleBatch
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { uploadToStorage } from '@/lib/supabaseStorage';
import { v4 as uuidv4 } from 'uuid';

// ─── URL Classification ───────────────────────────────────────────

export type VideoUrlType = 'youtube' | 'direct' | 'hls' | 'unknown';

export function classifyVideoUrl(url: string): VideoUrlType {
  const clean = url.trim().toLowerCase();
  if (clean.includes('youtube.com') || clean.includes('youtu.be')) return 'youtube';
  if (clean.endsWith('.m3u8') || clean.includes('.m3u8?') || clean.includes('.m3u8#')) return 'hls';
  if (/\.(mp4|webm|mov|avi|mkv)(\?|#|$)/i.test(clean)) return 'direct';
  return 'unknown';
}

export function getUrlTypeLabel(url: string): string {
  const type = classifyVideoUrl(url);
  switch (type) {
    case 'youtube': return 'YT';
    case 'hls': return 'HLS';
    case 'direct': return 'MP4';
    default: return 'Link';
  }
}

// ─── Upload Helper ────────────────────────────────────────────────

export async function uploadVideoBlob(blob: Blob, filename = 'video.mp4'): Promise<string> {
  // Upload directly to Supabase Storage (bypasses Vercel's 4.5MB body limit)
  const ext = filename.split('.').pop() || 'mp4';
  const path = `videos/${uuidv4()}.${ext}`;
  return uploadToStorage('videos', path, blob, blob.type || 'video/mp4');
}

// Keep old name as alias for backwards compatibility
export const uploadTrimmedVideo = uploadVideoBlob;

// ─── YouTube Download ─────────────────────────────────────────────

export async function downloadYouTubeVideoOnce(youtubeUrl: string): Promise<string> {
  const cleanUrl = youtubeUrl.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '').trim();
  console.log('[VideoDL] YouTube:', JSON.stringify(cleanUrl));
  const response = await fetch('/api/youtube-download-v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: cleanUrl }),
  });
  if (!response.ok) {
    const text = await response.text();
    console.error('[VideoDL] YouTube failed:', response.status, text);
    throw new Error(`YouTube download failed (${response.status}): ${text}`);
  }
  const data = await response.json();
  return data.url;
}

// ─── Direct MP4 Download ─────────────────────────────────────────

async function downloadDirectVideo(url: string): Promise<string> {
  console.log('[VideoDL] Direct MP4:', url);
  // Use server-side proxy to avoid CORS issues with external video hosts
  const proxyUrl = `/api/download-proxy?url=${encodeURIComponent(url)}&filename=direct-video.mp4`;
  const response = await fetch(proxyUrl);
  if (!response.ok) {
    let errMsg: string;
    try {
      const data = await response.json();
      errMsg = data.error || `HTTP ${response.status}`;
    } catch {
      errMsg = `HTTP ${response.status}`;
    }
    throw new Error(errMsg);
  }
  const blob = await response.blob();
  if (blob.size < 1000) {
    throw new Error(`Downloaded file too small (${blob.size} bytes)`);
  }
  console.log(`[VideoDL] Direct MP4 downloaded: ${(blob.size / 1024 / 1024).toFixed(1)} MB`);
  return uploadVideoBlob(blob, 'direct-video.mp4');
}

// ─── HLS m3u8 Download ───────────────────────────────────────────

/**
 * Parse an m3u8 playlist and resolve segment/variant URLs
 */
function parseM3u8(content: string, baseUrl: string): { variants: string[]; segments: string[] } {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const variants: string[] = [];
  const segments: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#')) {
      // Check for variant stream (master playlist)
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        // Next non-comment line is the variant URL
        for (let j = i + 1; j < lines.length; j++) {
          if (!lines[j].startsWith('#')) {
            variants.push(resolveUrl(lines[j], baseUrl));
            break;
          }
        }
      }
      continue;
    }
    // Non-comment, non-empty line = segment URL
    if (!line.startsWith('#')) {
      segments.push(resolveUrl(line, baseUrl));
    }
  }

  return { variants, segments };
}

function resolveUrl(relative: string, base: string): string {
  if (relative.startsWith('http://') || relative.startsWith('https://')) return relative;
  try {
    return new URL(relative, base).href;
  } catch {
    // Fallback: join with base directory
    const baseDir = base.substring(0, base.lastIndexOf('/') + 1);
    return baseDir + relative;
  }
}

/**
 * Extract bandwidth from #EXT-X-STREAM-INF line
 */
function extractBandwidth(lines: string[], variantUrl: string, baseUrl: string): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      // Check if next line resolves to this variant
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j].trim();
        if (!nextLine.startsWith('#') && nextLine.length > 0) {
          if (resolveUrl(nextLine, baseUrl) === variantUrl) {
            const match = line.match(/BANDWIDTH=(\d+)/);
            return match ? parseInt(match[1]) : 0;
          }
          break;
        }
      }
    }
  }
  return 0;
}

/** Fetch via server proxy to avoid CORS */
async function proxyFetch(url: string): Promise<Response> {
  const proxyUrl = `/api/download-proxy?url=${encodeURIComponent(url)}`;
  return fetch(proxyUrl);
}

async function downloadHlsVideo(url: string): Promise<string> {
  console.log('[VideoDL] HLS:', url);

  // Use the server-side download-hls route which fetches segments directly
  // (avoids the empty-response issue when proxying segments individually)
  console.log('[VideoDL] HLS: fetching via server-side download-hls...');
  const hlsResp = await fetch(`/api/download-hls?url=${encodeURIComponent(url)}`);
  if (!hlsResp.ok) {
    const errData = await hlsResp.json().catch(() => ({ error: `HLS download failed (${hlsResp.status})` }));
    throw new Error(errData.error || `HLS download failed (${hlsResp.status})`);
  }

  const tsData = new Uint8Array(await hlsResp.arrayBuffer());
  const totalBytes = tsData.length;

  if (totalBytes < 1000) {
    throw new Error('HLS: Downloaded data too small');
  }

  console.log(`[VideoDL] HLS: downloaded ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);

  // Try client-side remux TS → MP4 via FFmpeg.wasm, fall back to uploading raw TS
  try {
    console.log('[VideoDL] HLS: remuxing TS → MP4 via FFmpeg.wasm...');
    const ffmpeg = new FFmpeg();
    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';
    await ffmpeg.load({
      coreURL: `${baseURL}/ffmpeg-core.js`,
      wasmURL: `${baseURL}/ffmpeg-core.wasm`,
    });

    await ffmpeg.writeFile('input.ts', tsData);
    const exitCode = await ffmpeg.exec([
      '-i', 'input.ts',
      '-c', 'copy',
      '-movflags', '+faststart',
      '-y',
      'output.mp4',
    ]);

    if (exitCode !== 0) throw new Error('FFmpeg remux failed');

    const outputData = await ffmpeg.readFile('output.mp4');
    await ffmpeg.deleteFile('input.ts').catch(() => {});
    await ffmpeg.deleteFile('output.mp4').catch(() => {});

    if (!(outputData instanceof Uint8Array) || outputData.length === 0) {
      throw new Error('Remuxed output is empty');
    }

    console.log(`[VideoDL] HLS: remuxed to ${(outputData.length / 1024 / 1024).toFixed(1)} MB MP4`);
    const blob = new Blob([new Uint8Array(outputData)], { type: 'video/mp4' });
    return uploadVideoBlob(blob, 'hls-video.mp4');
  } catch (remuxErr) {
    // FFmpeg.wasm can fail (SharedArrayBuffer, memory, CORS) — upload raw TS as .mp4
    console.warn('[VideoDL] HLS: FFmpeg remux failed, uploading raw TS:', remuxErr);
    const blob = new Blob([tsData], { type: 'video/mp4' });
    return uploadVideoBlob(blob, 'hls-video.mp4');
  }
}

// ─── Unified Download Entrypoint ──────────────────────────────────

/**
 * Download a video from any supported URL type and upload to storage.
 * Returns the storage URL.
 */
export async function downloadVideo(url: string): Promise<string> {
  const cleanUrl = url.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '').trim();
  const type = classifyVideoUrl(cleanUrl);
  console.log(`[VideoDL] Type: ${type}, URL: ${cleanUrl.substring(0, 80)}...`);

  switch (type) {
    case 'youtube':
      return downloadYouTubeVideoOnce(cleanUrl);
    case 'hls':
      return downloadHlsVideo(cleanUrl);
    case 'direct':
      return downloadDirectVideo(cleanUrl);
    case 'unknown':
      // Try direct download as fallback
      console.warn('[VideoDL] Unknown URL type, attempting direct download');
      return downloadDirectVideo(cleanUrl);
  }
}
