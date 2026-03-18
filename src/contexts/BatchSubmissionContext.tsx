'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { usePositions } from '@/hooks/usePositions';
import { addTask } from '@/lib/taskQueue';
import { supabase } from '@/lib/supabase';
import { trimVideo } from '@/lib/videoTrimmer';
import { autoSaveCompletedTask } from '@/lib/autoSave';
import type { ExerciseTemplate, QueuedTask } from '@/types';

// ============================================
// CONCURRENT PROCESSING: Up to 3 tasks at once
// ============================================
const MAX_CONCURRENT_TASKS = 3;

export interface SubmissionItem {
  template: ExerciseTemplate;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  klingTaskId?: string;
  batchId: string;
  batchPosition: number;
  batchTotal: number;
}

interface ProcessingProgress {
  current: number;
  total: number;
  currentExercise: string;
  stage: 'downloading' | 'trimming' | 'submitting' | 'waiting';
}

interface BatchSubmissionContextValue {
  items: SubmissionItem[];
  isSubmitting: boolean;
  reloadTrigger: number;
  processingProgress: ProcessingProgress | null;
  addBatch: (templates: ExerciseTemplate[]) => void;
  retryFailed: (templateId: string) => void;
  dismissItem: (templateId: string) => void;
}

const BatchSubmissionContext = createContext<BatchSubmissionContextValue | null>(null);

// Check how many tasks are currently active on Kling
async function getActiveKlingTaskCount(): Promise<number> {
  const { data, error } = await supabase
    .from('task_queue')
    .select('task_id, status, exercise_name')
    .in('status', ['submitted', 'processing']);

  if (error) {
    console.error('[CONCURRENT] Error checking active tasks:', error);
    return 0;
  }

  const count = data?.length ?? 0;
  if (count > 0) {
    console.log(`[CONCURRENT] Active tasks (${count}):`, data?.map(t => `${t.exercise_name} (${t.status})`).join(', '));
  }
  return count;
}

// Poll Kling for task status and update Supabase
async function pollAndUpdateTask(taskId: string, exerciseName: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/process/${taskId}`);
    if (!res.ok) return false;

    const data = await res.json();
    const status = data.status;

    if (status === 'completed' || status === 'succeed') {
      console.log(`[CONCURRENT] 🎉 Task "${exerciseName}" completed on Kling!`);
      // Update Supabase to mark as completed
      await supabase.from('task_queue').update({
        status: 'completed',
        output_video_url: data.videos?.[0]?.url || null,
        video_duration_sec: data.videos?.[0]?.duration ? parseFloat(data.videos[0].duration) : null
      }).eq('kling_task_id', taskId);
      return true;
    } else if (status === 'failed') {
      console.log(`[CONCURRENT] ❌ Task "${exerciseName}" failed on Kling`);
      await supabase.from('task_queue').update({ status: 'failed' }).eq('kling_task_id', taskId);
      return true;
    }
    return false;
  } catch (e) {
    console.error(`[CONCURRENT] Error polling task ${taskId}:`, e);
    return false;
  }
}

// Wait until there's a free slot (Kling limits concurrent tasks)
async function waitForKlingSlot(maxActive = MAX_CONCURRENT_TASKS): Promise<void> {
  let waitCount = 0;
  while (true) {
    // First, poll active tasks to update their status
    const { data: activeTasks } = await supabase
      .from('task_queue')
      .select('kling_task_id, exercise_name')
      .in('status', ['submitted', 'processing']);

    if (activeTasks && activeTasks.length > 0) {
      // Poll each active task to see if it's done
      for (const task of activeTasks) {
        if (task.kling_task_id) {
          await pollAndUpdateTask(task.kling_task_id, task.exercise_name);
        }
      }
    }

    // Now check the count
    const activeCount = await getActiveKlingTaskCount();
    if (activeCount < maxActive) {
      console.log(`[CONCURRENT] ✅ Slot available! ${activeCount}/${maxActive} active tasks`);
      return;
    }
    waitCount++;
    console.log(`[CONCURRENT] ⏳ All ${maxActive} slots full (${activeCount} active), waiting... (attempt ${waitCount})`);
    await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10s
  }
}

// Submit to Kling with retry for error 1303 (over-limit)
async function submitToKlingWithRetry(
  payload: Record<string, unknown>,
  exerciseName: string,
  maxRetries = 3
): Promise<{ taskId: string }> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    console.log(`[CONCURRENT] 📤 Submitting "${exerciseName}" to Kling (attempt ${attempt + 1}/${maxRetries})`);

    const processRes = await fetch('/api/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const processData = await processRes.json();

    if (processRes.ok) {
      console.log(`[CONCURRENT] ✅ Kling accepted "${exerciseName}"! Task ID: ${processData.taskId}`);
      return { taskId: processData.taskId };
    }

    // Check for error 1303 (parallel task over limit)
    const errorCode = processData.code || processData.error_code;
    if (errorCode === 1303 || processData.error?.includes('1303') || processData.error?.includes('over resource pack limit')) {
      const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
      console.log(`[CONCURRENT] ⚠️ Error 1303 (over limit) for "${exerciseName}", retrying in ${delay/1000}s...`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }

    // Other errors - fail immediately
    throw new Error(processData.error || 'Kling API submission failed');
  }

  throw new Error(`Max retries (${maxRetries}) exceeded for Kling submission`);
}

export function BatchSubmissionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ items: SubmissionItem[]; isSubmitting: boolean }>({
    items: [],
    isSubmitting: false,
  });
  const [reloadTrigger, setReloadTrigger] = useState(0);
  const [processingProgress, setProcessingProgress] = useState<ProcessingProgress | null>(null);

  const itemsRef = useRef<SubmissionItem[]>([]);
  const isProcessingRef = useRef(false);
  const { getPositionImageUrl } = usePositions();
  const getPositionImageUrlRef = useRef(getPositionImageUrl);
  getPositionImageUrlRef.current = getPositionImageUrl;

  const updateItems = useCallback(
    (updater: (items: SubmissionItem[]) => SubmissionItem[]) => {
      const newItems = updater(itemsRef.current);
      itemsRef.current = newItems;
      setState((prev) => ({ ...prev, items: newItems }));
    },
    []
  );

  const addBatch = useCallback(
    async (templates: ExerciseTemplate[]) => {
      if (templates.length === 0) return;
      if (isProcessingRef.current) {
        console.log('Already processing, ignoring new batch');
        return;
      }

      isProcessingRef.current = true;
      setState((prev) => ({ ...prev, isSubmitting: true }));

      const batchId = `batch-${Date.now()}`;
      const newItems: SubmissionItem[] = templates.map((t, i) => ({
        template: t,
        status: 'pending' as const,
        batchId,
        batchPosition: i + 1,
        batchTotal: templates.length,
      }));

      updateItems((items) => [...items, ...newItems]);

      // ============================================
      // CONCURRENT PROCESSING: Download → Submit → Move to next (no waiting!)
      // Up to 3 tasks can be active on Kling simultaneously
      // ============================================
      console.log(`[CONCURRENT] 🚀 Starting batch of ${templates.length} exercises (max ${MAX_CONCURRENT_TASKS} concurrent)`);

      for (let i = 0; i < templates.length; i++) {
        const template = templates[i];
        const item = itemsRef.current.find((it) => it.template.id === template.id);
        if (!item) continue;

        setProcessingProgress({
          current: i + 1,
          total: templates.length,
          currentExercise: template.exerciseName,
          stage: 'downloading',
        });

        // Step 1: Download the video
        let videoUrl: string | null = null;
        console.log(`[CONCURRENT] [${i + 1}/${templates.length}] 📥 Downloading: ${template.exerciseName}`);

        try {
          if (template.youtubeUrl) {
            // Step 1a: Download from YouTube (without trimming - server FFmpeg doesn't work on Vercel)
            const ytBody: Record<string, unknown> = { url: template.youtubeUrl };
            // Note: Don't send startTime/endTime to server - we'll trim client-side

            const ytRes = await fetch('/api/youtube-download-v2', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(ytBody),
            });
            const ytData = await ytRes.json();
            if (ytRes.ok) {
              videoUrl = ytData.url;
              console.log(`[CONCURRENT] ✅ Downloaded: ${template.exerciseName}`);

              // Step 1b: Trim client-side if start/end time is specified
              if (videoUrl && (template.startTime !== undefined || template.endTime !== undefined)) {
                const startTime = template.startTime ?? 0;
                const endTime = template.endTime ?? startTime + 5; // Default 5 seconds if no end time

                setProcessingProgress((prev) => prev ? { ...prev, stage: 'trimming' } : null);
                console.log(`[CONCURRENT] ✂️ Trimming ${template.exerciseName} (${startTime}s - ${endTime}s)`);

                try {
                  const trimmedBlob = await trimVideo(videoUrl, startTime, endTime);
                  console.log(`[CONCURRENT] ✅ Trimmed to ${(trimmedBlob.size / 1024 / 1024).toFixed(2)} MB`);

                  // Upload trimmed video to Vercel Blob
                  const formData = new FormData();
                  formData.append('file', trimmedBlob, `trimmed-${template.id}.mp4`);
                  formData.append('type', 'video');

                  const uploadRes = await fetch('/api/upload', {
                    method: 'POST',
                    body: formData,
                  });

                  if (uploadRes.ok) {
                    const uploadData = await uploadRes.json();
                    videoUrl = uploadData.url;
                    console.log(`[CONCURRENT] ✅ Uploaded trimmed video: ${template.exerciseName}`);
                  } else {
                    console.error(`[CONCURRENT] ❌ Failed to upload trimmed video`);
                    // Fall back to untrimmed video
                  }
                } catch (trimError) {
                  console.error(`[CONCURRENT] ❌ Trim failed, using full video:`, trimError);
                  // Continue with untrimmed video if trim fails
                }
              }
            } else {
              console.error(`[CONCURRENT] ❌ Download failed: ${template.exerciseName}`, ytData.error);
            }
          } else if (template.inputVideoUrl) {
            videoUrl = template.inputVideoUrl;
          }
        } catch (err) {
          console.error(`[CONCURRENT] ❌ Download error: ${template.exerciseName}`, err);
        }

        // Skip if download failed
        if (!videoUrl) {
          console.error(`[CONCURRENT] ⏭️ Skipping ${template.exerciseName} - download failed`);
          updateItems((items) =>
            items.map((it) =>
              it.template.id === template.id
                ? { ...it, status: 'failed' as const, error: 'Download failed' }
                : it
            )
          );
          continue;
        }

        try {
          // Get position image URL
          const positionImageUrl = getPositionImageUrlRef.current(template.positionId);
          if (!positionImageUrl) {
            throw new Error(`No image found for position "${template.positionName}"`);
          }

          // Wait for a free slot on Kling before submitting (allows up to 3 concurrent)
          setProcessingProgress((prev) => prev ? { ...prev, stage: 'waiting' } : null);
          console.log(`[CONCURRENT] [${i + 1}/${templates.length}] Checking for available Kling slot...`);
          await waitForKlingSlot(); // Uses MAX_CONCURRENT_TASKS (3)

          // Got a slot, now submitting
          setProcessingProgress((prev) => prev ? { ...prev, stage: 'submitting' } : null);

          // Submit to Kling with retry for error 1303
          const { taskId } = await submitToKlingWithRetry(
            {
              imageUrl: positionImageUrl,
              videoUrl,
              characterOrientation: 'video',
              mode: 'std',
              keepOriginalSound: 'no',
              prompt: template.customPrompt,
            },
            template.exerciseName
          );

          // Save to task queue
          console.log(`[CONCURRENT] 💾 Saving task ${taskId} to queue...`);
          await addTask({
            taskId,
            status: 'submitted',
            videoUrl,
            positionId: template.positionId || 'unknown',
            positionName: template.positionName || 'Unknown',
            mode: 'std',
            exerciseName: template.exerciseName,
            equipmentType: template.equipmentType,
            customPrompt: template.customPrompt,
            force: template.force,
            mechanic: template.mechanic,
            limbs: template.limbs,
            body: template.body,
            difficulty: template.difficulty,
            musclesTargeted: template.musclesTargeted,
            startedAt: new Date().toISOString(),
            templateId: template.id,
            batchId: item.batchId,
            batchPosition: item.batchPosition,
            batchTotal: item.batchTotal,
          });

          // Delete template
          await supabase.from('exercise_templates').delete().eq('id', template.id);

          // Mark as processing (submitted to Kling, waiting for completion)
          updateItems((items) =>
            items.map((it) =>
              it.template.id === template.id
                ? { ...it, status: 'processing' as const, klingTaskId: taskId }
                : it
            )
          );

          setReloadTrigger((prev) => prev + 1);

          // ============================================
          // Immediately proceed to next template
          // We'll poll for completion after all submissions
          // ============================================
          console.log(`[CONCURRENT] ⏭️ Task ${taskId} submitted to Kling, moving to next template...`);

        } catch (err) {
          const errMsg = err instanceof Error ? err.message : 'Submission failed';
          console.error(`[CONCURRENT] ❌ FAILED: ${template.exerciseName} - ${errMsg}`);
          updateItems((items) =>
            items.map((it) =>
              it.template.id === template.id
                ? { ...it, status: 'failed' as const, error: errMsg }
                : it
            )
          );
        }
      }

      // ============================================
      // ALL SUBMISSIONS COMPLETE - now poll until all tasks finish on Kling
      // ============================================
      const processingItems = itemsRef.current.filter(it =>
        templates.some(t => t.id === it.template.id) && it.status === 'processing'
      );
      const failedDuringSubmission = itemsRef.current.filter(it =>
        templates.some(t => t.id === it.template.id) && it.status === 'failed'
      ).length;

      console.log(`[CONCURRENT] 📤 All submissions done: ${processingItems.length} processing on Kling, ${failedDuringSubmission} failed`);

      // Poll processing items until they all complete
      if (processingItems.length > 0) {
        console.log(`[CONCURRENT] 🔄 Starting to poll ${processingItems.length} tasks until completion...`);
        setProcessingProgress({
          current: templates.length - processingItems.length,
          total: templates.length,
          currentExercise: 'Waiting for Kling...',
          stage: 'waiting',
        });

        // Poll every 10 seconds until all done
        while (true) {
          await new Promise(resolve => setTimeout(resolve, 10000));

          const processingItemsList = itemsRef.current.filter(it => it.status === 'processing');
          console.log(`[CONCURRENT] 🔄 Polling ${processingItemsList.length} items...`);

          // Check each processing item
          for (const item of processingItemsList) {
            if (!item.klingTaskId) continue;

            try {
              console.log(`[CONCURRENT] 📡 Checking ${item.template.exerciseName} (${item.klingTaskId})...`);
              const res = await fetch(`/api/process/${item.klingTaskId}`);
              if (!res.ok) {
                console.log(`[CONCURRENT] ❌ API returned ${res.status} for ${item.template.exerciseName}`);
                continue;
              }

              const data = await res.json();
              const status = data.status;
              console.log(`[CONCURRENT] 📊 ${item.template.exerciseName}: status="${status}"`);

              if (status === 'completed' || status === 'succeed') {
                console.log(`[CONCURRENT] ✅ ${item.template.exerciseName} completed!`);

                const outputVideoUrl = data.videos?.[0]?.url || null;
                const videoDurationSec = data.videos?.[0]?.duration ? parseFloat(data.videos[0].duration) : null;

                // Try to get task data from task_queue, but fall back to template data
                const { data: taskRow, error: taskError } = await supabase
                  .from('task_queue')
                  .select('*')
                  .eq('kling_task_id', item.klingTaskId)
                  .single();

                if (taskError) {
                  console.log(`[CONCURRENT] ⚠️ Task not found in queue (using template data): ${taskError.message}`);
                }

                // Build QueuedTask object - use taskRow if available, otherwise use template data
                const template = item.template;
                const queuedTask: QueuedTask = {
                  taskId: taskRow?.task_id || crypto.randomUUID(),
                  klingTaskId: item.klingTaskId,
                  status: 'succeed',
                  videoUrl: taskRow?.video_url || template.inputVideoUrl,
                  outputVideoUrl: outputVideoUrl || '',
                  positionId: taskRow?.position_id || template.positionId,
                  positionName: taskRow?.position_name || template.positionName,
                  mode: (taskRow?.mode || 'std') as 'std' | 'pro',
                  exerciseName: taskRow?.exercise_name || template.exerciseName,
                  equipmentType: taskRow?.equipment_type || template.equipmentType,
                  customPrompt: taskRow?.custom_prompt || template.customPrompt,
                  videoDurationSec: videoDurationSec ?? undefined,
                  startedAt: taskRow?.started_at || new Date().toISOString(),
                  force: taskRow?.force || template.force,
                  mechanic: taskRow?.mechanic || template.mechanic,
                  limbs: taskRow?.limbs || template.limbs,
                  body: taskRow?.body || template.body,
                  difficulty: taskRow?.difficulty || template.difficulty,
                  musclesTargeted: taskRow?.muscles_targeted || template.musclesTargeted,
                };

                // Save to exercise_entries (completed table)
                console.log(`[CONCURRENT] 💾 Saving ${item.template.exerciseName} to exercise library...`);
                let saveSucceeded = false;
                try {
                  await autoSaveCompletedTask(queuedTask);
                  saveSucceeded = true;
                  console.log(`[CONCURRENT] ✅ ${item.template.exerciseName} saved to library!`);
                } catch (saveError) {
                  console.error(`[CONCURRENT] ❌ Failed to save ${item.template.exerciseName} to library:`, saveError);
                }

                // ALWAYS clean up task_queue after save attempt
                // The task_id in the database IS the kling_task_id (we use Kling's ID as our task_id)
                try {
                  if (saveSucceeded) {
                    // Delete by task_id (which equals kling_task_id)
                    console.log(`[CONCURRENT] 🗑️ Deleting task_queue row with task_id=${item.klingTaskId}...`);
                    const { error: deleteError, count } = await supabase
                      .from('task_queue')
                      .delete()
                      .eq('task_id', item.klingTaskId);

                    if (deleteError) {
                      console.error(`[CONCURRENT] ❌ Delete failed:`, deleteError);
                      // Try by kling_task_id as fallback
                      const { error: deleteError2 } = await supabase
                        .from('task_queue')
                        .delete()
                        .eq('kling_task_id', item.klingTaskId);
                      if (deleteError2) {
                        console.error(`[CONCURRENT] ❌ Fallback delete also failed:`, deleteError2);
                      } else {
                        console.log(`[CONCURRENT] 🧹 Cleaned up via kling_task_id fallback`);
                      }
                    } else {
                      console.log(`[CONCURRENT] 🧹 Cleaned up task_queue for ${item.template.exerciseName}`);
                    }
                  } else if (taskRow) {
                    // Save failed - mark as completed so it doesn't get stuck
                    await supabase.from('task_queue').update({
                      status: 'succeed',
                      output_video_url: outputVideoUrl,
                      video_duration_sec: videoDurationSec
                    }).eq('task_id', item.klingTaskId);
                  }
                } catch (cleanupError) {
                  console.error(`[CONCURRENT] ⚠️ Cleanup error for ${item.template.exerciseName}:`, cleanupError);
                }

                // Update item status
                updateItems((items) =>
                  items.map((it) =>
                    it.template.id === item.template.id
                      ? { ...it, status: 'completed' as const }
                      : it
                  )
                );
                setReloadTrigger((prev) => prev + 1);
              } else if (status === 'failed') {
                console.log(`[CONCURRENT] ❌ ${item.template.exerciseName} failed on Kling`);
                await supabase.from('task_queue').update({ status: 'failed' }).eq('kling_task_id', item.klingTaskId);
                updateItems((items) =>
                  items.map((it) =>
                    it.template.id === item.template.id
                      ? { ...it, status: 'failed' as const, error: 'Kling processing failed' }
                      : it
                  )
                );
              }
            } catch (e) {
              console.error(`[CONCURRENT] Error polling ${item.template.exerciseName}:`, e);
            }
          }

          // Check if all done
          const stillProcessing = itemsRef.current.filter(it =>
            templates.some(t => t.id === it.template.id) && it.status === 'processing'
          );

          if (stillProcessing.length === 0) {
            console.log(`[CONCURRENT] 🎉 All tasks completed!`);
            break;
          }

          // Update progress
          const completed = itemsRef.current.filter(it =>
            templates.some(t => t.id === it.template.id) && it.status === 'completed'
          ).length;
          setProcessingProgress({
            current: completed,
            total: templates.length,
            currentExercise: stillProcessing[0]?.template.exerciseName || 'Processing...',
            stage: 'waiting',
          });
          console.log(`[CONCURRENT] 🔄 ${stillProcessing.length} still processing...`);
        }
      }

      // All done!
      const finalCompleted = itemsRef.current.filter(it =>
        templates.some(t => t.id === it.template.id) && it.status === 'completed'
      ).length;
      const finalFailed = itemsRef.current.filter(it =>
        templates.some(t => t.id === it.template.id) && it.status === 'failed'
      ).length;

      console.log(`[CONCURRENT] ✅ Batch complete: ${finalCompleted} completed, ${finalFailed} failed`);
      isProcessingRef.current = false;
      setState((prev) => ({ ...prev, isSubmitting: false }));
      setProcessingProgress(null);
    },
    [updateItems]
  );

  const retryFailed = useCallback(
    (templateId: string) => {
      const item = itemsRef.current.find((it) => it.template.id === templateId);
      if (!item || item.status !== 'failed') return;

      updateItems((items) =>
        items.map((it) =>
          it.template.id === templateId
            ? { ...it, status: 'pending' as const, error: undefined }
            : it
        )
      );

      addBatch([item.template]);
    },
    [updateItems, addBatch]
  );

  const dismissItem = useCallback(
    (templateId: string) => {
      updateItems((items) => items.filter((it) => it.template.id !== templateId));
    },
    [updateItems]
  );

  return (
    <BatchSubmissionContext.Provider
      value={{
        items: state.items,
        isSubmitting: state.isSubmitting,
        reloadTrigger,
        processingProgress,
        addBatch,
        retryFailed,
        dismissItem,
      }}
    >
      {children}
    </BatchSubmissionContext.Provider>
  );
}

export function useBatchSubmission() {
  const context = useContext(BatchSubmissionContext);
  if (!context) {
    throw new Error('useBatchSubmission must be used within BatchSubmissionProvider');
  }
  return context;
}
