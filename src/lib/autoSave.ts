import { supabase } from '@/lib/supabase';
import type { QueuedTask, ExerciseEntry } from '@/types';

const COST_PER_SEC: Record<string, number> = {
  std: 0.07,
  pro: 0.112,
};

/**
 * Auto-save a completed task to the exercise library in Supabase.
 * Called from useTaskQueue when a task transitions to 'succeed'.
 * Includes deduplication check to prevent duplicate entries from race conditions.
 */
export async function autoSaveCompletedTask(task: QueuedTask): Promise<ExerciseEntry> {
  // Deduplication check: see if an entry with this output URL already exists
  // This prevents duplicates from race conditions (component remount, concurrent polls)
  if (task.outputVideoUrl) {
    const { data: existing } = await supabase
      .from('exercise_entries')
      .select('id')
      .eq('output_video_url', task.outputVideoUrl)
      .limit(1);

    if (existing && existing.length > 0) {
      console.log(`[autoSave] Entry already exists for output URL, skipping: ${task.exerciseName}`);
      // Return a fake entry with the existing ID so the caller knows it "succeeded"
      return {
        id: existing[0].id,
        exerciseName: task.exerciseName,
        equipmentType: task.equipmentType,
        outputVideoUrl: task.outputVideoUrl,
        inputVideoUrl: task.videoUrl || '',
        positionId: task.positionId,
        positionName: task.positionName,
        mode: task.mode,
        costUsd: 0,
        savedAt: new Date().toISOString(),
      };
    }
  }
  const costUsd =
    task.videoDurationSec && !isNaN(task.videoDurationSec)
      ? task.videoDurationSec * (COST_PER_SEC[task.mode] || 0)
      : 0;

  const id = crypto.randomUUID();
  const savedAt = new Date().toISOString();

  // Calculate processing duration from submission to completion
  const processingDurationSec = task.startedAt
    ? Math.round((Date.now() - Date.parse(task.startedAt)) / 1000)
    : undefined;

  // Check if positionId is a valid UUID (database columns require UUID type)
  const isValidUuid = task.positionId &&
    task.positionId !== 'custom' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(task.positionId);
  const positionUuid = isValidUuid ? task.positionId : null;

  const entry: ExerciseEntry = {
    id,
    exerciseName: task.exerciseName,
    equipmentType: task.equipmentType,
    outputVideoUrl: task.outputVideoUrl || '',
    inputVideoUrl: task.videoUrl || '',
    positionId: task.positionId,
    positionName: task.positionName,
    mode: task.mode,
    costUsd,
    customPrompt: task.customPrompt,
    processingDurationSec,
    videoDurationSec: task.videoDurationSec,
    force: task.force,
    mechanic: task.mechanic,
    limbs: task.limbs,
    body: task.body,
    difficulty: task.difficulty,
    musclesTargeted: task.musclesTargeted,
    savedAt,
  };

  const row: Record<string, unknown> = {
    id,
    exercise_name: task.exerciseName,
    equipment_type: task.equipmentType,
    output_video_url: task.outputVideoUrl || '',
    input_video_url: task.videoUrl || '',
    // Legacy columns - use valid UUID or null
    avatar_id: positionUuid,
    avatar_name: task.positionName,
    avatar_angle: 'front',
    // Current columns
    position_id: positionUuid,
    position_name: task.positionName,
    mode: task.mode,
    cost_usd: costUsd,
    custom_prompt: task.customPrompt || null,
    processing_duration_sec: processingDurationSec ?? null,
    video_duration_sec: task.videoDurationSec ?? null,
    force: task.force || null,
    mechanic: task.mechanic || null,
    limbs: task.limbs || null,
    body: task.body || null,
    difficulty: task.difficulty || null,
    muscles_targeted: task.musclesTargeted || null,
    saved_at: savedAt,
  };

  let { error } = await supabase.from('exercise_entries').insert(row);

  // If the column doesn't exist yet, retry without it
  if (error?.code === '42703' && error?.message?.includes('processing_duration_sec')) {
    console.warn('processing_duration_sec column not found, inserting without it');
    delete row.processing_duration_sec;
    ({ error } = await supabase.from('exercise_entries').insert(row));
  }

  if (error) {
    console.error('Auto-save to Supabase failed:', error);
    throw error;
  }

  return entry;
}
