import { NextRequest, NextResponse } from 'next/server';
import { createMotionControlTask, queryTaskStatus } from '@/lib/kling';
import { supabase } from '@/lib/supabase';

// Vercel cron jobs need to be authenticated
const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  // Verify cron secret (Vercel sends this header for cron jobs)
  const authHeader = req.headers.get('authorization');
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('[CRON] Starting queue processing...');

    // Step 1: Check for any active task (submitted or processing)
    const { data: activeTasks, error: activeError } = await supabase
      .from('task_queue')
      .select('*')
      .or('status.eq.submitted,status.eq.processing')
      .order('started_at', { ascending: true })
      .limit(1);

    if (activeError) {
      console.error('[CRON] Error fetching active tasks:', activeError);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    // If there's an active task, poll its status
    if (activeTasks && activeTasks.length > 0) {
      const activeTask = activeTasks[0];
      console.log(`[CRON] Found active task: ${activeTask.task_id} (${activeTask.status})`);

      try {
        const klingStatus = await queryTaskStatus(activeTask.task_id);
        console.log(`[CRON] Kling status: ${klingStatus.status}`);

        // Update task status
        const updates: Record<string, unknown> = {
          status: klingStatus.status,
        };

        // If completed, save the output video URL and duration
        if (klingStatus.status === 'succeed' && klingStatus.videos.length > 0) {
          updates.output_video_url = klingStatus.videos[0].url;
          updates.video_duration_sec = parseFloat(klingStatus.videos[0].duration) || null;
        }

        await supabase
          .from('task_queue')
          .update(updates)
          .eq('task_id', activeTask.task_id);

        return NextResponse.json({
          action: 'polled',
          taskId: activeTask.task_id,
          status: klingStatus.status,
        });
      } catch (pollErr) {
        console.error('[CRON] Error polling Kling:', pollErr);
        return NextResponse.json({
          action: 'poll_error',
          taskId: activeTask.task_id,
          error: pollErr instanceof Error ? pollErr.message : 'Poll failed',
        });
      }
    }

    // Step 2: No active task - check for queued tasks
    const { data: queuedTasks, error: queuedError } = await supabase
      .from('task_queue')
      .select('*')
      .eq('status', 'queued')
      .order('started_at', { ascending: true })
      .limit(1);

    if (queuedError) {
      console.error('[CRON] Error fetching queued tasks:', queuedError);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    if (!queuedTasks || queuedTasks.length === 0) {
      console.log('[CRON] No queued tasks to process');
      return NextResponse.json({ action: 'idle', message: 'No tasks in queue' });
    }

    const task = queuedTasks[0];
    console.log(`[CRON] Processing queued task: ${task.exercise_name}`);

    // Step 3: Get position image URL
    const { data: position, error: posError } = await supabase
      .from('positions')
      .select('public_url')
      .eq('id', task.position_id)
      .single();

    if (posError || !position?.public_url) {
      console.error('[CRON] Position not found:', task.position_id);
      // Mark task as failed
      await supabase
        .from('task_queue')
        .update({ status: 'failed' })
        .eq('id', task.id);
      return NextResponse.json({
        action: 'failed',
        error: 'Position image not found',
      });
    }

    // Step 4: Submit to Kling
    console.log('[CRON] Submitting to Kling...');
    try {
      const result = await createMotionControlTask({
        imageUrl: position.public_url,
        videoUrl: task.video_url,
        characterOrientation: 'video',
        mode: task.mode || 'std',
        keepOriginalSound: 'no',
        prompt: task.custom_prompt || undefined,
      });

      console.log(`[CRON] Kling accepted! Task ID: ${result.taskId}`);

      // Step 5: Update task with Kling task ID
      await supabase
        .from('task_queue')
        .update({
          task_id: result.taskId,
          status: 'submitted',
        })
        .eq('id', task.id);

      return NextResponse.json({
        action: 'submitted',
        taskId: result.taskId,
        exerciseName: task.exercise_name,
      });
    } catch (klingErr) {
      console.error('[CRON] Kling submission error:', klingErr);

      // Mark as failed
      await supabase
        .from('task_queue')
        .update({ status: 'failed' })
        .eq('id', task.id);

      return NextResponse.json({
        action: 'failed',
        exerciseName: task.exercise_name,
        error: klingErr instanceof Error ? klingErr.message : 'Kling submission failed',
      });
    }
  } catch (error) {
    console.error('[CRON] Unexpected error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
