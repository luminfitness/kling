import { NextRequest, NextResponse } from 'next/server';

/**
 * Proxy route for downloading files from external URLs (like Kling CDN)
 * This avoids CORS issues when triggering browser downloads
 */
export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl.searchParams.get('url');
    const filename = req.nextUrl.searchParams.get('filename') || 'video.mp4';

    if (!url) {
      return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
    }

    // Block requests to private/internal networks
    const parsedUrl = new URL(url);
    const blockedPatterns = ['localhost', '127.0.0.1', '0.0.0.0', '10.', '192.168.', '172.16.'];
    const isBlocked = blockedPatterns.some(p => parsedUrl.hostname.startsWith(p));
    if (isBlocked) {
      return NextResponse.json({ error: 'Internal URLs not allowed' }, { status: 403 });
    }

    console.log(`[download-proxy] Proxying: ${parsedUrl.hostname}${parsedUrl.pathname.substring(0, 50)}`);

    // Fetch the file with browser-like headers to avoid hotlink protection
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': parsedUrl.origin + '/',
      },
    });

    if (!response.ok) {
      const cfMitigated = response.headers.get('cf-mitigated');
      if (cfMitigated === 'challenge' || (response.status === 403 && response.headers.get('server')?.includes('cloudflare'))) {
        return NextResponse.json(
          { error: 'Cloudflare-protected — download manually and upload' },
          { status: 403 }
        );
      }
      return NextResponse.json(
        { error: `Failed to fetch: ${response.status}` },
        { status: response.status }
      );
    }

    // Get content type
    const contentType = response.headers.get('content-type') || 'video/mp4';

    // Stream the response
    const blob = await response.blob();

    return new NextResponse(blob, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': blob.size.toString(),
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[download-proxy] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
