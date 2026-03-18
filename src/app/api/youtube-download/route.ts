import { NextRequest, NextResponse } from 'next/server';
import { uploadToStorage } from '@/lib/supabaseStorage';

// Increase function timeout for video download/upload
export const maxDuration = 60; // seconds

/**
 * Extract YouTube video ID from various URL formats
 * Supports: youtube.com/watch, youtu.be, youtube.com/shorts, m.youtube.com
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

export async function POST(req: NextRequest) {
  try {
    // 1. Extract YouTube URL from request
    const body = await req.json();
    const { url: youtubeUrl } = body;

    console.log('[YouTube] Request received:', youtubeUrl);

    if (!youtubeUrl || typeof youtubeUrl !== 'string') {
      return NextResponse.json(
        { error: 'YouTube URL is required' },
        { status: 400 }
      );
    }

    // 2. Extract video ID
    const videoId = extractVideoId(youtubeUrl.trim());
    if (!videoId) {
      console.error('[YouTube] Invalid URL format:', youtubeUrl);
      return NextResponse.json(
        { error: 'Invalid YouTube URL. Please check the link and try again.' },
        { status: 400 }
      );
    }

    console.log('[YouTube] Extracted video ID:', videoId);

    // 3. Check for RapidAPI key
    const rapidApiKey = process.env.RAPIDAPI_KEY?.trim();
    if (!rapidApiKey) {
      console.error('[YouTube] RAPIDAPI_KEY not configured');
      return NextResponse.json(
        { error: 'YouTube download service not configured. Please contact support.' },
        { status: 500 }
      );
    }

    console.log('[YouTube] API key configured, original length:', process.env.RAPIDAPI_KEY?.length, 'trimmed:', rapidApiKey.length);

    // 4. Call RapidAPI YTStream to get download link
    const rapidApiUrl = `https://ytstream-download-youtube-videos.p.rapidapi.com/dl?id=${videoId}`;

    console.log('[YouTube] Calling RapidAPI:', rapidApiUrl);

    const rapidApiResponse = await fetch(rapidApiUrl, {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': rapidApiKey,
        'X-RapidAPI-Host': 'ytstream-download-youtube-videos.p.rapidapi.com',
      },
    });

    console.log('[YouTube] RapidAPI response status:', rapidApiResponse.status);

    if (!rapidApiResponse.ok) {
      // Handle specific error cases
      if (rapidApiResponse.status === 429) {
        return NextResponse.json(
          { error: 'YouTube download quota reached. Please try again later or upload a file directly.' },
          { status: 429 }
        );
      }

      if (rapidApiResponse.status === 404) {
        return NextResponse.json(
          { error: 'Video not found or is unavailable (private, deleted, or region-restricted).' },
          { status: 404 }
        );
      }

      const errorData = await rapidApiResponse.json().catch(() => ({}));
      console.error('RapidAPI error:', {
        status: rapidApiResponse.status,
        videoId,
        error: errorData,
      });

      return NextResponse.json(
        { error: errorData.message || 'Failed to fetch video information from YouTube.' },
        { status: rapidApiResponse.status }
      );
    }

    const videoData = await rapidApiResponse.json();

    console.log('[YouTube] API response received, expires in:', videoData.expiresInSeconds, 'seconds');

    // 5. Find MP4 format from formats (combined video+audio)
    // Use 'formats' instead of 'adaptiveFormats' because formats include both video and audio
    const formats = videoData.formats || [];
    const mp4Formats = formats.filter(
      (format: any) =>
        format.mimeType?.includes('video/mp4') &&
        format.url &&
        format.qualityLabel
    );

    console.log('[YouTube] Found', mp4Formats.length, 'MP4 formats with video+audio');

    // Sort by quality and select highest
    mp4Formats.sort((a: any, b: any) => {
      const qualityA = parseInt(a.qualityLabel) || 0;
      const qualityB = parseInt(b.qualityLabel) || 0;
      return qualityB - qualityA;
    });

    const selectedFormat = mp4Formats[0];

    if (!selectedFormat || !selectedFormat.url) {
      console.error('[YouTube] No suitable MP4 format found, available formats:', mp4Formats.length);
      console.error('[YouTube] Total formats:', formats.length);
      return NextResponse.json(
        { error: 'No downloadable MP4 format available for this video.' },
        { status: 500 }
      );
    }

    const downloadLink = selectedFormat.url;
    const videoQuality = selectedFormat.qualityLabel || 'unknown quality';

    console.log(`[YouTube] Selected format: ${videoQuality} MP4, size: ${selectedFormat.contentLength || 'unknown'}`);

    // 6. Download video from YouTube
    console.log('[YouTube] Starting video download from CDN...');
    // Don't add extra headers - the URL from formats array should work as-is with ratebypass
    const videoResponse = await fetch(downloadLink);

    console.log('[YouTube] Video download response status:', videoResponse.status);

    if (!videoResponse.ok) {
      console.error('[YouTube] Failed to download video from CDN:', {
        status: videoResponse.status,
        statusText: videoResponse.statusText,
        videoId,
      });
      return NextResponse.json(
        { error: `Failed to download video (${videoResponse.status}). Please try again.` },
        { status: 500 }
      );
    }

    // 7. Check file size before downloading (prevent exceeding 100MB limit)
    const contentLength = videoResponse.headers.get('content-length');
    const maxSize = 100 * 1024 * 1024; // 100MB

    console.log('[YouTube] Content length:', contentLength ? `${(parseInt(contentLength) / 1024 / 1024).toFixed(2)}MB` : 'unknown');

    if (contentLength && parseInt(contentLength) > maxSize) {
      return NextResponse.json(
        { error: 'Video exceeds 100MB size limit. Please choose a shorter video or upload directly.' },
        { status: 413 }
      );
    }

    // 8. Convert to Blob
    console.log('[YouTube] Converting response to blob...');
    const videoBlob = await videoResponse.blob();

    console.log('[YouTube] Blob size:', `${(videoBlob.size / 1024 / 1024).toFixed(2)}MB`);

    // Double-check blob size
    if (videoBlob.size > maxSize) {
      return NextResponse.json(
        { error: 'Video exceeds 100MB size limit.' },
        { status: 413 }
      );
    }

    // 9. Upload to Supabase Storage
    const filename = `youtube/youtube-${videoId}-${Date.now()}.mp4`;

    console.log('[YouTube] Uploading to Supabase Storage...');
    const publicUrl = await uploadToStorage('videos', filename, videoBlob, 'video/mp4');

    console.log('[YouTube] Upload successful:', publicUrl);

    // 10. Return same format as /api/upload for consistency
    return NextResponse.json({
      url: publicUrl,
      filename: filename.split('/').pop() || filename,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : 'N/A';

    console.error('[YouTube] Unexpected error:', errorMessage);
    console.error('[YouTube] Error stack:', errorStack);

    // Return more detailed error in response (will help with debugging)
    return NextResponse.json(
      {
        error: 'Failed to download video from YouTube. Please try again.',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
      },
      { status: 500 }
    );
  }
}
