import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/**
 * DELETE /api/blob-cleanup
 * Deletes old unreferenced files from Supabase Storage 'videos' bucket.
 *
 * Query params:
 *   maxAgeDays - max age in days (default: 1)
 *   dryRun - if "true", just counts without deleting
 *   includeImages - if "true", also cleans up unreferenced images
 */
export async function DELETE(req: NextRequest) {
  try {
    const maxAgeDays = parseInt(req.nextUrl.searchParams.get('maxAgeDays') || '1', 10);
    const dryRun = req.nextUrl.searchParams.get('dryRun') === 'true';
    const includeImages = req.nextUrl.searchParams.get('includeImages') === 'true';

    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
    let scanned = 0;

    // Get all referenced URLs from Supabase DB
    const referencedUrls = new Set<string>();

    const { data: exercises } = await supabase
      .from('exercise_entries')
      .select('input_video_url, output_video_url');
    for (const e of exercises || []) {
      if (e.input_video_url) referencedUrls.add(e.input_video_url);
      if (e.output_video_url) referencedUrls.add(e.output_video_url);
    }

    const { data: templates } = await supabase
      .from('exercise_templates')
      .select('input_video_url');
    for (const t of templates || []) {
      if (t.input_video_url) referencedUrls.add(t.input_video_url);
    }

    console.log(`[cleanup] Found ${referencedUrls.size} referenced URLs`);

    // List files from Supabase Storage folders
    const folders = includeImages
      ? ['youtube', 'uploads', 'videos', 'images']
      : ['youtube', 'uploads', 'videos'];

    const toDelete: string[] = [];

    for (const folder of folders) {
      const { data: files, error } = await supabase.storage
        .from('videos')
        .list(folder, { limit: 1000 });

      if (error || !files) continue;

      for (const file of files) {
        scanned++;
        const filePath = `${folder}/${file.name}`;
        const { data: urlData } = supabase.storage.from('videos').getPublicUrl(filePath);
        const publicUrl = urlData.publicUrl;

        const isReferenced = referencedUrls.has(publicUrl);
        const createdAt = file.created_at ? new Date(file.created_at) : new Date();
        const isOldEnough = createdAt < cutoff;

        if (!isReferenced && isOldEnough) {
          toDelete.push(filePath);
        }
      }
    }

    let deleted = 0;
    if (!dryRun && toDelete.length > 0) {
      const { error } = await supabase.storage.from('videos').remove(toDelete);
      if (error) throw error;
      deleted = toDelete.length;
    } else {
      deleted = toDelete.length;
    }

    return NextResponse.json({
      dryRun,
      scanned,
      deleted,
      referencedCount: referencedUrls.size,
      cutoffDate: cutoff.toISOString(),
    });
  } catch (error) {
    console.error('Cleanup error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Cleanup failed' },
      { status: 500 }
    );
  }
}
