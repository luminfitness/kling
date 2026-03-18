import { supabase } from '@/lib/supabase';
import type { QueuedTask, ForceType, MechanicType, LimbType, BodyType, DifficultyType } from '@/types';

// snake_case → camelCase mapping for reading from Supabase
function mapRow(row: Record<string, unknown>): QueuedTask {
  return {
    taskId: row.task_id as string,
    klingTaskId: (row.kling_task_id as string) || undefined,
    status: row.status as QueuedTask['status'],
    videoUrl: (row.video_url as string) || undefined,
    positionId: row.position_id as string,
    positionName: row.position_name as string,
    mode: row.mode as 'std' | 'pro',
    exerciseName: row.exercise_name as string,
    equipmentType: row.equipment_type as string,
    customPrompt: (row.custom_prompt as string) || undefined,
    force: (row.force as ForceType) || undefined,
    mechanic: (row.mechanic as MechanicType[]) || undefined,
    limbs: (row.limbs as LimbType) || undefined,
    body: (row.body as BodyType) || undefined,
    difficulty: (row.difficulty as DifficultyType) || undefined,
    musclesTargeted: (row.muscles_targeted as string[]) || undefined,
    startedAt: row.started_at as string,
    outputVideoUrl: (row.output_video_url as string) || undefined,
    videoDurationSec: (row.video_duration_sec as number) || undefined,
    autoSaved: (row.auto_saved as boolean) || undefined,
    templateId: (row.template_id as string) || undefined,
    batchId: (row.batch_id as string) || undefined,
    batchPosition: (row.batch_position as number) || undefined,
    batchTotal: (row.batch_total as number) || undefined,
    // Source info for resuming downloads
    sourceYoutubeUrl: (row.source_youtube_url as string) || undefined,
    sourceStartTime: (row.source_start_time as number) || undefined,
    sourceEndTime: (row.source_end_time as number) || undefined,
    sourceInputUrl: (row.source_input_url as string) || undefined,
    // Error tracking
    errorMessage: (row.error_message as string) || undefined,
  };
}

export async function addTask(task: QueuedTask): Promise<void> {
  // Validate UUID for database columns that require UUID type
  const isValidUuid = task.positionId &&
    task.positionId !== 'custom' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(task.positionId);
  const positionUuid = isValidUuid ? task.positionId : null;

  const { error } = await supabase.from('task_queue').insert({
    task_id: task.taskId,
    kling_task_id: task.klingTaskId || null,
    status: task.status,
    video_url: task.videoUrl || null,
    // Legacy columns - use valid UUID or null
    avatar_id: positionUuid,
    avatar_name: task.positionName,
    avatar_angle: 'front', // Legacy - no longer used but DB requires it
    // Current columns
    position_id: positionUuid,
    position_name: task.positionName,
    mode: task.mode,
    exercise_name: task.exerciseName,
    equipment_type: task.equipmentType,
    custom_prompt: task.customPrompt || null,
    force: task.force || null,
    mechanic: task.mechanic || null,
    limbs: task.limbs || null,
    body: task.body || null,
    difficulty: task.difficulty || null,
    muscles_targeted: task.musclesTargeted || null,
    started_at: task.startedAt,
    output_video_url: task.outputVideoUrl || null,
    video_duration_sec: task.videoDurationSec ?? null,
    auto_saved: task.autoSaved || false,
    template_id: task.templateId || null,
    batch_id: task.batchId || null,
    batch_position: task.batchPosition ?? null,
    batch_total: task.batchTotal ?? null,
    // Source info for resuming downloads
    source_youtube_url: task.sourceYoutubeUrl || null,
    source_start_time: task.sourceStartTime ?? null,
    source_end_time: task.sourceEndTime ?? null,
    source_input_url: task.sourceInputUrl || null,
    // Error tracking
    error_message: task.errorMessage || null,
  });

  if (error) {
    console.error('[addTask] ❌ Failed to add task:', error);
    console.error('[addTask] Error details:', JSON.stringify(error, null, 2));
    throw new Error(`Failed to add task: ${error.message}`);
  }

  // Verify the insert worked
  const { data: verifyRow, error: verifyError } = await supabase
    .from('task_queue')
    .select('task_id')
    .eq('task_id', task.taskId)
    .single();

  if (verifyError || !verifyRow) {
    console.error('[addTask] ❌ Insert verification failed - row not found after insert!');
    console.error('[addTask] Verify error:', verifyError);
    throw new Error('Task insert failed silently - row not found after insert');
  }

  console.log('[addTask] ✅ Task successfully inserted and verified:', task.taskId);
}

export async function getTasks(): Promise<QueuedTask[]> {
  const { data, error } = await supabase
    .from('task_queue')
    .select('*')
    .order('started_at', { ascending: false });

  if (error) {
    console.error('Failed to get tasks:', error);
    return [];
  }

  return (data || []).map(mapRow);
}

// Get only queued tasks (for auto-resume)
export async function getQueuedTasks(): Promise<QueuedTask[]> {
  const { data, error } = await supabase
    .from('task_queue')
    .select('*')
    .eq('status', 'queued')
    .order('batch_position', { ascending: true })
    .order('started_at', { ascending: true });

  if (error) {
    console.error('Failed to get queued tasks:', error);
    return [];
  }

  return (data || []).map(mapRow);
}

// Get tasks that are actively being processed on Kling
export async function getActiveTasks(): Promise<QueuedTask[]> {
  const { data, error } = await supabase
    .from('task_queue')
    .select('*')
    .in('status', ['submitted', 'processing']);

  if (error) {
    console.error('Failed to get active tasks:', error);
    return [];
  }

  return (data || []).map(mapRow);
}

export async function updateTask(
  taskId: string,
  updates: Partial<QueuedTask>
): Promise<void> {
  const dbUpdates: Record<string, unknown> = {};
  if (updates.status !== undefined) dbUpdates.status = updates.status;
  if (updates.klingTaskId !== undefined) dbUpdates.kling_task_id = updates.klingTaskId;
  if (updates.videoUrl !== undefined) dbUpdates.video_url = updates.videoUrl;
  if (updates.outputVideoUrl !== undefined) dbUpdates.output_video_url = updates.outputVideoUrl;
  if (updates.videoDurationSec !== undefined) dbUpdates.video_duration_sec = updates.videoDurationSec;
  if (updates.autoSaved !== undefined) dbUpdates.auto_saved = updates.autoSaved;
  // Editable fields
  if (updates.exerciseName !== undefined) dbUpdates.exercise_name = updates.exerciseName;
  if (updates.equipmentType !== undefined) dbUpdates.equipment_type = updates.equipmentType;
  if (updates.positionId !== undefined) {
    // Validate UUID for database columns
    const isValidUuid = updates.positionId &&
      updates.positionId !== 'custom' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(updates.positionId);
    const positionUuid = isValidUuid ? updates.positionId : null;
    dbUpdates.position_id = positionUuid;
    dbUpdates.avatar_id = positionUuid; // Legacy column
  }
  if (updates.positionName !== undefined) {
    dbUpdates.position_name = updates.positionName;
    dbUpdates.avatar_name = updates.positionName; // Legacy column
  }
  if (updates.sourceYoutubeUrl !== undefined) dbUpdates.source_youtube_url = updates.sourceYoutubeUrl || null;
  if (updates.sourceStartTime !== undefined) dbUpdates.source_start_time = updates.sourceStartTime ?? null;
  if (updates.sourceEndTime !== undefined) dbUpdates.source_end_time = updates.sourceEndTime ?? null;
  if (updates.sourceInputUrl !== undefined) dbUpdates.source_input_url = updates.sourceInputUrl || null;
  if (updates.customPrompt !== undefined) dbUpdates.custom_prompt = updates.customPrompt || null;
  if (updates.errorMessage !== undefined) dbUpdates.error_message = updates.errorMessage || null;

  const { error } = await supabase
    .from('task_queue')
    .update(dbUpdates)
    .eq('task_id', taskId);

  if (error) {
    console.error('Failed to update task:', error);
  }
}

export async function removeTask(taskId: string): Promise<void> {
  const { error } = await supabase
    .from('task_queue')
    .delete()
    .eq('task_id', taskId);

  if (error) {
    console.error('Failed to remove task:', error);
    throw error;
  }
}
