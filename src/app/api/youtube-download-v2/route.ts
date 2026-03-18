import { NextRequest, NextResponse } from 'next/server';
import { uploadToStorage } from '@/lib/supabaseStorage';

// Increase timeout for this serverless function to 60s
export const maxDuration = 60;

/**
 * Extract YouTube video ID from various URL formats
 */
function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([^&?\/\s]{11})/,
    /youtube\.com\/embed\/([^&?\/\s]{11})/,
    /^([^&?\/\s]{11})$/, // Direct video ID
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) return match[1];
  }

  return null;
}

/**
 * Strategy A: YouTube Video FAST Downloader 24/7 (original, polling-based)
 * Returns proxied URLs — no IP-lock issues when working
 */
async function downloadViaFastDownloader(videoId: string, rapidApiKey: string): Promise<ArrayBuffer> {
  const infoUrl = `https://youtube-video-fast-downloader-24-7.p.rapidapi.com/get-video-info/${videoId}?return_available_quality=true&response_mode=default`;

  const infoResponse = await fetch(infoUrl, {
    method: 'GET',
    headers: {
      'X-RapidAPI-Key': rapidApiKey,
      'X-RapidAPI-Host': 'youtube-video-fast-downloader-24-7.p.rapidapi.com',
    },
  });

  if (!infoResponse.ok) {
    const errorBody = await infoResponse.text();
    throw new Error(`FastDL info (${infoResponse.status}): ${errorBody.slice(0, 200)}`);
  }

  const videoInfo = await infoResponse.json();
  const allFormats = Array.isArray(videoInfo.availableQuality) ? videoInfo.availableQuality : [];
  const qualities = allFormats.filter((format: any) => format.type === 'video');

  if (!qualities || qualities.length === 0) {
    throw new Error('FastDL: No video qualities');
  }

  // Sort qualities - prefer 480p, then 360p
  const preferred = ['480p', '360p', '720p', '240p'];
  qualities.sort((a: any, b: any) => {
    const iA = preferred.indexOf(a.quality);
    const iB = preferred.indexOf(b.quality);
    if (iA >= 0 && iB >= 0) return iA - iB;
    if (iA >= 0) return -1;
    if (iB >= 0) return 1;
    return 0;
  });

  const selectedQuality = qualities[0];
  console.log('[FastDL] Quality:', selectedQuality.quality);

  if (selectedQuality.size && selectedQuality.size > 50 * 1024 * 1024) {
    throw new Error('Video exceeds 50MB');
  }

  // Request download URL
  const dlUrl = `https://youtube-video-fast-downloader-24-7.p.rapidapi.com/download_video/${videoId}?quality=${selectedQuality.id}`;
  const dlResponse = await fetch(dlUrl, {
    method: 'GET',
    headers: {
      'X-RapidAPI-Key': rapidApiKey,
      'X-RapidAPI-Host': 'youtube-video-fast-downloader-24-7.p.rapidapi.com',
    },
  });

  if (!dlResponse.ok) {
    throw new Error(`FastDL download (${dlResponse.status})`);
  }

  const dlData = await dlResponse.json();
  const proxiedUrl = dlData.file || dlData.reserved_file;
  if (!proxiedUrl) throw new Error('FastDL: No download URL');

  // Poll proxied URL until ready
  for (let attempt = 0; attempt < 10; attempt++) {
    console.log(`[FastDL] Poll ${attempt + 1}/10`);
    const videoResponse = await fetch(proxiedUrl);

    if (videoResponse.ok) {
      const buffer = await videoResponse.arrayBuffer();
      console.log(`[FastDL] Downloaded ${buffer.byteLength} bytes`);
      return buffer;
    } else if (videoResponse.status === 404) {
      await new Promise(r => setTimeout(r, 5000));
    } else {
      throw new Error(`FastDL poll: status ${videoResponse.status}`);
    }
  }

  throw new Error('FastDL: Timed out');
}

/**
 * Strategy B: YouTube Media Downloader by DataFanatic
 * Returns video details with download URLs, supports proxy URLs
 */
async function downloadViaMediaDownloader(videoId: string, rapidApiKey: string): Promise<ArrayBuffer> {
  console.log('[MediaDL] Fetching video details...');

  const detailsUrl = `https://youtube-media-downloader.p.rapidapi.com/v2/video/details?videoId=${videoId}`;

  const detailsResponse = await fetch(detailsUrl, {
    method: 'GET',
    headers: {
      'X-RapidAPI-Key': rapidApiKey,
      'X-RapidAPI-Host': 'youtube-media-downloader.p.rapidapi.com',
    },
  });

  if (!detailsResponse.ok) {
    const errorBody = await detailsResponse.text();
    throw new Error(`MediaDL (${detailsResponse.status}): ${errorBody.slice(0, 200)}`);
  }

  const data = await detailsResponse.json();
  console.log('[MediaDL] Response keys:', Object.keys(data));

  // Find video download URLs — the API returns various formats
  // Look in videos.items array for MP4 formats with download URLs
  const videoItems = data?.videos?.items || data?.items || [];

  // Also check for a direct download URL format
  const formats = Array.isArray(videoItems) ? videoItems : [];

  console.log(`[MediaDL] Found ${formats.length} video items`);

  if (formats.length === 0) {
    // Log the full response structure to help debug
    console.log('[MediaDL] Full response structure:', JSON.stringify(data).slice(0, 500));
    throw new Error('MediaDL: No video formats found in response');
  }

  // Sort formats - prefer 480p, then 360p, then 720p
  const preferred = [480, 360, 720, 240];
  const sortedFormats = [...formats].sort((a: any, b: any) => {
    const qualA = parseInt(a.quality || a.qualityLabel || a.height || '0');
    const qualB = parseInt(b.quality || b.qualityLabel || b.height || '0');
    const iA = preferred.indexOf(qualA);
    const iB = preferred.indexOf(qualB);
    if (iA >= 0 && iB >= 0) return iA - iB;
    if (iA >= 0) return -1;
    if (iB >= 0) return 1;
    return qualA - qualB;
  });

  // Try each format until one downloads successfully
  for (const format of sortedFormats.slice(0, 3)) {
    const downloadUrl = format.url || format.downloadUrl || format.link;
    if (!downloadUrl) continue;

    const quality = format.quality || format.qualityLabel || format.height || 'unknown';
    console.log(`[MediaDL] Trying ${quality}...`);

    try {
      const videoResponse = await fetch(downloadUrl);

      if (videoResponse.ok || videoResponse.status === 206) {
        const buffer = await videoResponse.arrayBuffer();
        if (buffer.byteLength > 10000) {
          console.log(`[MediaDL] Downloaded ${buffer.byteLength} bytes at ${quality}`);
          return buffer;
        }
        console.warn(`[MediaDL] ${quality} too small: ${buffer.byteLength}`);
      } else {
        console.warn(`[MediaDL] ${quality} failed: ${videoResponse.status}`);
      }
    } catch (err: any) {
      console.warn(`[MediaDL] ${quality} error: ${err.message}`);
    }
  }

  throw new Error('MediaDL: All download URLs failed');
}

/**
 * Download YouTube video via RapidAPI and upload to Vercel Blob
 * Tries two APIs:
 *   1. YouTube Video FAST Downloader 24/7 (original, works when their service is up)
 *   2. YouTube Media Downloader by DataFanatic (fallback, proxy URL support)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url: youtubeUrl } = body;

    if (!youtubeUrl || typeof youtubeUrl !== 'string') {
      return NextResponse.json({ error: 'YouTube URL is required' }, { status: 400 });
    }

    const videoId = extractVideoId(youtubeUrl.trim());
    if (!videoId) {
      return NextResponse.json({ error: 'Invalid YouTube URL.' }, { status: 400 });
    }

    const rapidApiKey = process.env.RAPIDAPI_KEY?.trim();
    if (!rapidApiKey) {
      return NextResponse.json({ error: 'YouTube download service not configured.' }, { status: 500 });
    }

    console.log('[YouTube DL] Processing:', videoId);

    const errors: string[] = [];

    // Strategy 1: YouTube Media Downloader (primary — currently working)
    try {
      console.log('[YouTube DL] Trying MediaDownloader...');
      const buffer = await downloadViaMediaDownloader(videoId, rapidApiKey);
      const publicUrl = await uploadToStorage('videos', `youtube/${videoId}-${Date.now()}.mp4`, buffer, 'video/mp4');
      console.log('[YouTube DL] SUCCESS via MediaDownloader:', publicUrl);
      return NextResponse.json({ url: publicUrl, videoId, source: 'media-downloader' });
    } catch (err: any) {
      errors.push(`MediaDL: ${err.message}`);
      console.warn('[YouTube DL] MediaDownloader failed:', err.message);
    }

    // Strategy 2: FastDownloader (fallback — has outages)
    try {
      console.log('[YouTube DL] Trying FastDownloader...');
      const buffer = await downloadViaFastDownloader(videoId, rapidApiKey);
      const publicUrl = await uploadToStorage('videos', `youtube/${videoId}-${Date.now()}.mp4`, buffer, 'video/mp4');
      console.log('[YouTube DL] SUCCESS via FastDownloader:', publicUrl);
      return NextResponse.json({ url: publicUrl, videoId, source: 'fast-downloader' });
    } catch (err: any) {
      errors.push(`FastDL: ${err.message}`);
      console.warn('[YouTube DL] FastDownloader failed:', err.message);
    }

    console.error('[YouTube DL] All strategies failed:', errors);
    return NextResponse.json(
      { error: `YouTube download failed: ${errors.join(' | ')}` },
      { status: 500 }
    );
  } catch (error: any) {
    console.error('[YouTube DL] Error:', error);
    return NextResponse.json(
      { error: error.message || 'An unexpected error occurred.' },
      { status: 500 }
    );
  }
}
