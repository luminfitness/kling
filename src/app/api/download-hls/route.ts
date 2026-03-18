import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'url required' }, { status: 400 });
  }

  try {
    const segments = await resolveSegments(url);

    if (segments.length === 0) {
      return NextResponse.json({ error: 'No video segments found in playlist' }, { status: 502 });
    }

    // Fetch all segments sequentially and concatenate
    const buffers: ArrayBuffer[] = [];
    for (const segUrl of segments) {
      const res = await fetch(segUrl);
      if (res.ok) {
        buffers.push(await res.arrayBuffer());
      }
    }

    if (buffers.length === 0) {
      return NextResponse.json({ error: 'Failed to download any segments' }, { status: 502 });
    }

    const total = buffers.reduce((s, b) => s + b.byteLength, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const buf of buffers) {
      out.set(new Uint8Array(buf), pos);
      pos += buf.byteLength;
    }

    // Extract a filename from the URL path (e.g. the hash segment like "a34bf96b62")
    const match = url.match(/\/([a-f0-9]{8,})\//);
    const name = match ? match[1] : 'video';

    return new NextResponse(out, {
      headers: {
        'Content-Type': 'video/mp2t',
        'Content-Disposition': `attachment; filename="${name}.mp4"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Download failed' },
      { status: 500 }
    );
  }
}

// Resolves a .m3u8 URL to a flat list of segment URLs.
// Handles both master playlists (quality variants) and media playlists (segments).
async function resolveSegments(url: string): Promise<string[]> {
  const base = url.substring(0, url.lastIndexOf('/') + 1);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch playlist (${res.status})`);
  const text = await res.text();

  // Master playlist — pick the first quality variant and recurse
  if (text.includes('#EXT-X-STREAM-INF')) {
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (t && !t.startsWith('#')) {
        const mediaUrl = t.startsWith('http') ? t : base + t;
        return resolveSegments(mediaUrl);
      }
    }
    return [];
  }

  // Media playlist — collect segment URLs
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => (l.startsWith('http') ? l : base + l));
}
