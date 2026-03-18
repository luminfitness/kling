import { NextResponse } from 'next/server';
import { Dropbox } from 'dropbox';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client with service role for server-side operations
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface DropboxFileEntry {
  '.tag': string;
  name: string;
  path_lower: string;
  path_display: string;
  size?: number;
}

/**
 * GET /api/dropbox/sync
 * Syncs videos from Dropbox folder to Supabase database
 * Returns list of all videos (both new and existing)
 */
export async function GET() {
  const accessToken = process.env.DROPBOX_ACCESS_TOKEN;
  const folderPath = process.env.DROPBOX_FOLDER_PATH || '';

  if (!accessToken) {
    return NextResponse.json(
      { error: 'DROPBOX_ACCESS_TOKEN not configured' },
      { status: 500 }
    );
  }

  try {
    const dbx = new Dropbox({ accessToken });

    // List all files with pagination
    let allVideos: DropboxFileEntry[] = [];
    let response = await dbx.filesListFolder({
      path: folderPath,
      recursive: true,
    });

    // Filter for .mp4 files
    const filterMp4 = (entries: unknown[]) =>
      (entries as DropboxFileEntry[]).filter(
        (f) => f['.tag'] === 'file' && f.name.toLowerCase().endsWith('.mp4')
      );

    allVideos = filterMp4(response.result.entries);

    // Handle pagination for large folders
    while (response.result.has_more) {
      response = await dbx.filesListFolderContinue({
        cursor: response.result.cursor,
      });
      allVideos = allVideos.concat(filterMp4(response.result.entries));
    }

    console.log(`[DROPBOX_SYNC] Found ${allVideos.length} .mp4 files in Dropbox`);

    // Prepare records for upsert
    const records = allVideos.map((video) => ({
      filename: video.name,
      exercise_name: video.name.replace(/\.mp4$/i, ''), // Remove .mp4 extension
      dropbox_path: video.path_lower,
      status: 'synced',
    }));

    // Upsert to Supabase (insert or update if exists based on dropbox_path)
    const { data, error } = await supabase
      .from('dropbox_videos')
      .upsert(records, {
        onConflict: 'dropbox_path',
        ignoreDuplicates: false,
      })
      .select();

    if (error) {
      console.error('[DROPBOX_SYNC] Supabase error:', error);
      return NextResponse.json(
        { error: `Database error: ${error.message}` },
        { status: 500 }
      );
    }

    // Fetch all videos from database (including previously synced ones)
    const { data: allDbVideos, error: fetchError } = await supabase
      .from('dropbox_videos')
      .select('*')
      .order('exercise_name', { ascending: true });

    if (fetchError) {
      console.error('[DROPBOX_SYNC] Fetch error:', fetchError);
      return NextResponse.json(
        { error: `Fetch error: ${fetchError.message}` },
        { status: 500 }
      );
    }

    console.log(`[DROPBOX_SYNC] Synced ${data?.length || 0} videos, total in DB: ${allDbVideos?.length || 0}`);

    return NextResponse.json({
      synced: data?.length || 0,
      total: allDbVideos?.length || 0,
      videos: allDbVideos,
    });
  } catch (err) {
    console.error('[DROPBOX_SYNC] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to sync from Dropbox' },
      { status: 500 }
    );
  }
}
