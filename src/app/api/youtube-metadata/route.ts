import { NextRequest, NextResponse } from 'next/server';

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
 * Get YouTube video metadata and PROXIED download URL from RapidAPI
 * Uses YouTube Video FAST Downloader 24/7 by nikzeferis
 * This API provides truly proxied URLs hosted on their servers
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url: youtubeUrl } = body;

    if (!youtubeUrl || typeof youtubeUrl !== 'string') {
      return NextResponse.json(
        { error: 'YouTube URL is required' },
        { status: 400 }
      );
    }

    // Extract video ID
    const videoId = extractVideoId(youtubeUrl.trim());
    if (!videoId) {
      return NextResponse.json(
        { error: 'Invalid YouTube URL. Please check the link and try again.' },
        { status: 400 }
      );
    }

    // Check for RapidAPI key
    const rapidApiKey = process.env.RAPIDAPI_KEY?.trim();
    if (!rapidApiKey) {
      console.error('[YouTube Metadata] RAPIDAPI_KEY not configured');
      return NextResponse.json(
        { error: 'YouTube download service not configured.' },
        { status: 500 }
      );
    }

    console.log('[YouTube Metadata] Fetching qualities for video:', videoId);

    // Step 1: Get available qualities
    const qualitiesUrl = `https://youtube-video-fast-downloader-24-7.p.rapidapi.com/get_available_quality/${videoId}`;

    const qualitiesResponse = await fetch(qualitiesUrl, {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': rapidApiKey,
        'X-RapidAPI-Host': 'youtube-video-fast-downloader-24-7.p.rapidapi.com',
      },
    });

    console.log('[YouTube Metadata] Qualities API response status:', qualitiesResponse.status);

    if (!qualitiesResponse.ok) {
      if (qualitiesResponse.status === 429) {
        return NextResponse.json(
          { error: 'YouTube download quota reached. Please try again later.' },
          { status: 429 }
        );
      }

      if (qualitiesResponse.status === 404) {
        return NextResponse.json(
          { error: 'Video not found or is unavailable.' },
          { status: 404 }
        );
      }

      const errorText = await qualitiesResponse.text();
      console.error('[YouTube Metadata] Qualities API error:', errorText);

      return NextResponse.json(
        { error: 'Failed to fetch video information from YouTube.' },
        { status: qualitiesResponse.status }
      );
    }

    const qualitiesData = await qualitiesResponse.json();
    console.log('[YouTube Metadata] Received qualities:', qualitiesData);

    // The API returns an array directly (not wrapped in an object)
    const allFormats = Array.isArray(qualitiesData) ? qualitiesData : [];

    // Filter for video formats only (not audio)
    const qualities = allFormats.filter((format: any) => format.type === 'video');

    if (!qualities || qualities.length === 0) {
      console.error('[YouTube Metadata] No video qualities available');
      return NextResponse.json(
        { error: 'No downloadable formats available for this video.' },
        { status: 500 }
      );
    }

    // Sort qualities - prefer 480p, then 360p, then 720p (avoid high quality to stay under 50MB)
    const preferredResolutions = ['480p', '360p', '720p', '240p', '1080p'];
    qualities.sort((a: any, b: any) => {
      const indexA = preferredResolutions.indexOf(a.quality);
      const indexB = preferredResolutions.indexOf(b.quality);

      if (indexA >= 0 && indexB >= 0) return indexA - indexB;
      if (indexA >= 0) return -1;
      if (indexB >= 0) return 1;
      return 0;
    });

    const selectedQuality = qualities[0];
    console.log('[YouTube Metadata] Selected quality:', selectedQuality.quality, 'ID:', selectedQuality.id);

    // Step 2: Request download URL
    const downloadUrl = `https://youtube-video-fast-downloader-24-7.p.rapidapi.com/download_video/${videoId}?quality=${selectedQuality.id}`;

    const downloadResponse = await fetch(downloadUrl, {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': rapidApiKey,
        'X-RapidAPI-Host': 'youtube-video-fast-downloader-24-7.p.rapidapi.com',
      },
    });

    if (!downloadResponse.ok) {
      const errorText = await downloadResponse.text();
      console.error('[YouTube Metadata] Download API error:', errorText);
      return NextResponse.json(
        { error: 'Failed to request download URL.' },
        { status: downloadResponse.status }
      );
    }

    const downloadData = await downloadResponse.json();
    console.log('[YouTube Metadata] Download data:', downloadData);

    // The API returns a proxied URL that may need 15-30s to prepare
    // Client will poll this URL until it's ready
    const proxiedUrl = downloadData.file || downloadData.reserved_file || downloadData.download_url;

    if (!proxiedUrl) {
      console.error('[YouTube Metadata] No download URL in response');
      return NextResponse.json(
        { error: 'Failed to get download URL.' },
        { status: 500 }
      );
    }

    console.log('[YouTube Metadata] Proxied URL:', proxiedUrl);

    // Return metadata with PROXIED download URL
    return NextResponse.json({
      videoId,
      title: downloadData.title || `YouTube Video ${videoId}`,
      downloadUrl: proxiedUrl, // Proxied URL like https://url.for.down/dl-*.mp4
      quality: selectedQuality.quality,
      size: selectedQuality.size || null, // Size is available in the quality object
      duration: null, // Duration not provided by this API
      needsPolling: true, // Signal to client that URL needs polling
    });
  } catch (error) {
    console.error('[YouTube Metadata] Error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}
