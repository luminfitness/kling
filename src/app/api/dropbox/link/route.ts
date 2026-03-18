import { NextResponse } from 'next/server';
import { Dropbox } from 'dropbox';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/**
 * POST /api/dropbox/link
 * Gets a temporary download link for a video file
 * Links expire after 4 hours
 *
 * Body: { dropboxPath: string, videoId?: string }
 * Returns: { url: string, expiresAt: string }
 */
export async function POST(req: Request) {
  const accessToken = process.env.DROPBOX_ACCESS_TOKEN;

  if (!accessToken) {
    return NextResponse.json(
      { error: 'DROPBOX_ACCESS_TOKEN not configured' },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();
    const { dropboxPath, videoId } = body;

    if (!dropboxPath) {
      return NextResponse.json(
        { error: 'dropboxPath is required' },
        { status: 400 }
      );
    }

    const dbx = new Dropbox({ accessToken });

    // Get temporary link (valid for 4 hours)
    const response = await dbx.filesGetTemporaryLink({
      path: dropboxPath,
    });

    const tempLink = response.result.link;
    // Dropbox temporary links expire after 4 hours
    const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();

    console.log(`[DROPBOX_LINK] Generated link for ${dropboxPath}, expires at ${expiresAt}`);

    // If videoId provided, update the database record
    if (videoId) {
      const { error: updateError } = await supabase
        .from('dropbox_videos')
        .update({
          temp_link: tempLink,
          temp_link_expires_at: expiresAt,
        })
        .eq('id', videoId);

      if (updateError) {
        console.error('[DROPBOX_LINK] Failed to update DB:', updateError);
        // Don't fail the request, just log the error
      }
    }

    return NextResponse.json({
      url: tempLink,
      expiresAt,
    });
  } catch (err) {
    console.error('[DROPBOX_LINK] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get Dropbox link' },
      { status: 500 }
    );
  }
}
