'use client';

import { useState, useCallback, useRef } from 'react';
import { usePositions } from '@/hooks/usePositions';
import { supabase } from '@/lib/supabase';
import { trimVideo, getVideoDuration } from '@/lib/videoTrimmer';
import { autoSaveCompletedTask } from '@/lib/autoSave';
import { getHumanReadableError } from '@/lib/simpleBatch';
import type { QueuedTask, ExerciseTemplate } from '@/types';

// ============================================
// CONCURRENT PROCESSING: Up to 3 tasks at once
// MODAL-BASED: No queue table, just a progress modal
// ============================================
const MAX_CONCURRENT_TASKS = 3;
const POLL_INTERVAL_MS = 10000; // 10 seconds

export interface ActiveItem {
  name: string;
  stage: string;
}

export interface ModalState {
  total: number;
  completed: number;
  failed: number;
  activeItems: ActiveItem[];  // Now tracks multiple concurrent items
  isDone: boolean;
}

const INITIAL_MODAL_STATE: ModalState = {
  total: 0,
  completed: 0,
  failed: 0,
  activeItems: [],
  isDone: false,
};

export function useQueueProcessor() {
  // ============================================
  // MODAL STATE
  // ============================================
  const [isProcessing, setIsProcessing] = useState(false);
  const [modalState, setModalState] = useState<ModalState>(INITIAL_MODAL_STATE);

  // Trigger for reloading exercises after auto-save
  const [exerciseSavedTrigger, setExerciseSavedTrigger] = useState(0);
  // Trigger for reloading templates after failure marks them
  const [templateDeletedTrigger, setTemplateDeletedTrigger] = useState(0);

  // Refs for async processing
  const cancelledRef = useRef(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeTasksRef = useRef<Map<string, QueuedTask>>(new Map());

  // Use refs for counts to avoid stale closures
  const completedCountRef = useRef(0);
  const failedCountRef = useRef(0);

  const { getPositionImageUrl } = usePositions();
  const getPositionImageUrlRef = useRef(getPositionImageUrl);
  getPositionImageUrlRef.current = getPositionImageUrl;

  // ============================================
  // HELPER: Add item to active items in modal
  // ============================================
  const addActiveItem = useCallback((name: string, stage: string) => {
    setModalState(prev => ({
      ...prev,
      activeItems: [...prev.activeItems.filter(i => i.name !== name), { name, stage }]
    }));
  }, []);

  // ============================================
  // HELPER: Update stage for an active item
  // ============================================
  const updateActiveItemStage = useCallback((name: string, stage: string) => {
    setModalState(prev => ({
      ...prev,
      activeItems: prev.activeItems.map(i => i.name === name ? { ...i, stage } : i)
    }));
  }, []);

  // ============================================
  // HELPER: Remove item from active items
  // ============================================
  const removeActiveItem = useCallback((name: string) => {
    setModalState(prev => ({
      ...prev,
      activeItems: prev.activeItems.filter(i => i.name !== name)
    }));
  }, []);

  // ============================================
  // HELPER: Mark template as failed in Supabase
  // ============================================
  const markTemplateFailed = useCallback(async (templateId: string, errorMessage: string) => {
    const humanError = getHumanReadableError(errorMessage);
    console.log(`[PROCESSOR] Marking template ${templateId} as failed: ${humanError}`);
    const { error } = await supabase
      .from('exercise_templates')
      .update({
        had_issue: true,
        error_message: humanError
      })
      .eq('id', templateId);

    if (error) {
      console.error('[PROCESSOR] Failed to mark template as failed:', error);
    }

    setTemplateDeletedTrigger(prev => prev + 1);
  }, []);

  // ============================================
  // HELPER: Delete template from Supabase (on success)
  // ============================================
  const deleteTemplate = useCallback(async (templateId: string) => {
    const { error } = await supabase
      .from('exercise_templates')
      .delete()
      .eq('id', templateId);

    if (error) {
      console.error('[PROCESSOR] Failed to delete template:', error);
    }

    setTemplateDeletedTrigger(prev => prev + 1);
  }, []);

  // ============================================
  // HELPER: Update active items in modal from activeTasksRef
  // ============================================
  const syncActiveItemsToModal = useCallback(() => {
    const items: ActiveItem[] = [];
    activeTasksRef.current.forEach((task) => {
      let stage = 'processing';
      if (task.status === 'submitted') stage = 'polling';
      else if (task.status === 'processing') stage = 'polling';
      items.push({ name: task.exerciseName, stage });
    });
    setModalState(prev => ({ ...prev, activeItems: items }));
  }, []);

  // ============================================
  // KLING POLLING
  // ============================================
  const pollKlingStatus = useCallback(async (): Promise<void> => {
    const activeTasks = Array.from(activeTasksRef.current.values()).filter(
      t => (t.status === 'submitted' || t.status === 'processing') && t.klingTaskId
    );

    if (activeTasks.length === 0) return;

    console.log(`[POLL] Checking ${activeTasks.length} active tasks...`);

    const results = await Promise.allSettled(
      activeTasks.map(async (task) => {
        const res = await fetch(`/api/process/${task.klingTaskId}`);
        if (!res.ok) return null;
        return { task, data: await res.json() };
      })
    );

    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value) continue;
      const { task, data } = result.value;

      if (data.status !== task.status) {
        console.log(`[POLL] Task ${task.exerciseName}: ${task.status} -> ${data.status}`);

        // Update task in map
        const updatedTask = { ...task, status: data.status };

        if (data.status === 'succeed' && data.videos?.length > 0) {
          updatedTask.outputVideoUrl = data.videos[0].url;
          const dur = parseFloat(data.videos[0].duration);
          if (!isNaN(dur)) updatedTask.videoDurationSec = dur;

          // Auto-save to library
          try {
            console.log(`[POLL] Saving ${task.exerciseName} to library...`);
            await autoSaveCompletedTask(updatedTask);

            // Clear rerunning flag on source exercise if this was a rerun
            if (task.sourceExerciseId) {
              console.log(`[POLL] Clearing rerunning flag on ${task.sourceExerciseId}`);
              await supabase
                .from('exercise_entries')
                .update({ rerunning: false })
                .eq('id', task.sourceExerciseId);
            }

            // Delete template from pending
            if (task.templateId) {
              await deleteTemplate(task.templateId);
            }

            // Remove from active tasks
            activeTasksRef.current.delete(task.taskId);

            // Update modal using refs + functional update to avoid stale closure
            completedCountRef.current += 1;
            setModalState(prev => ({ ...prev, completed: completedCountRef.current }));
            setExerciseSavedTrigger(prev => prev + 1);
            console.log(`[POLL] ${task.exerciseName} saved successfully`);
          } catch (err) {
            console.error('[POLL] Auto-save failed:', err);
            // Mark as failed
            if (task.templateId) {
              await markTemplateFailed(task.templateId, 'Failed to save to library');
            }
            activeTasksRef.current.delete(task.taskId);
            failedCountRef.current += 1;
            setModalState(prev => ({ ...prev, failed: failedCountRef.current }));
          }
        } else if (data.status === 'failed') {
          // Mark template as failed
          if (task.templateId) {
            await markTemplateFailed(task.templateId, data.statusMessage || 'Kling processing failed');
          }
          activeTasksRef.current.delete(task.taskId);
          failedCountRef.current += 1;
          setModalState(prev => ({ ...prev, failed: failedCountRef.current }));
        } else {
          // Still processing, update in map
          activeTasksRef.current.set(task.taskId, updatedTask);
        }
      }
    }

    // Sync active items to modal after each poll
    syncActiveItemsToModal();
  }, [deleteTemplate, markTemplateFailed, syncActiveItemsToModal]);

  // ============================================
  // PROCESS TEMPLATES (main entry point)
  // ============================================
  const processTemplates = useCallback(async (templates: ExerciseTemplate[]) => {
    if (templates.length === 0) return;

    console.log(`[PROCESSOR] Starting batch of ${templates.length} templates`);

    // Reset state and refs
    cancelledRef.current = false;
    activeTasksRef.current.clear();
    completedCountRef.current = 0;
    failedCountRef.current = 0;
    setIsProcessing(true);
    setModalState({
      total: templates.length,
      completed: 0,
      failed: 0,
      activeItems: [],
      isDone: false,
    });

    const batchId = `batch-${Date.now()}`;
    const startedAt = new Date().toISOString();

    // Create task objects (but don't add to Supabase queue)
    const tasks: QueuedTask[] = templates.map((template, i) => ({
      taskId: crypto.randomUUID(),
      status: 'queued' as const,
      positionId: template.positionId,
      positionName: template.positionName,
      mode: 'std' as const,
      exerciseName: template.exerciseName,
      equipmentType: template.equipmentType,
      customPrompt: template.customPrompt,
      force: template.force,
      mechanic: template.mechanic,
      limbs: template.limbs,
      body: template.body,
      difficulty: template.difficulty,
      musclesTargeted: template.musclesTargeted,
      startedAt,
      templateId: template.id,
      batchId,
      batchPosition: i + 1,
      batchTotal: templates.length,
      sourceYoutubeUrl: template.youtubeUrl,
      sourceStartTime: template.startTime,
      sourceEndTime: template.endTime,
      sourceInputUrl: template.inputVideoUrl,
      sourceExerciseId: template.sourceExerciseId,
    }));

    // Start polling for Kling status
    pollIntervalRef.current = setInterval(async () => {
      await pollKlingStatus();

      // Check if all done
      const activeCount = activeTasksRef.current.size;
      const processed = completedCountRef.current + failedCountRef.current;

      if (activeCount === 0 && processed >= templates.length) {
        console.log('[PROCESSOR] All tasks complete, stopping poll');
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        setModalState(prev => ({ ...prev, isDone: true, activeItems: [] }));
      }
    }, POLL_INTERVAL_MS);

    // Process tasks concurrently
    let taskIndex = 0;

    const processNextTask = async (): Promise<void> => {
      while (taskIndex < tasks.length && !cancelledRef.current) {
        // Wait for a slot
        while (activeTasksRef.current.size >= MAX_CONCURRENT_TASKS) {
          await new Promise(r => setTimeout(r, 1000));
          if (cancelledRef.current) return;
        }

        const task = tasks[taskIndex++];
        if (!task) break;

        console.log(`[PROCESSOR] [${activeTasksRef.current.size + 1}/${MAX_CONCURRENT_TASKS}] Processing: ${task.exerciseName}`);

        // Add to active items in modal
        addActiveItem(task.exerciseName, 'downloading');

        // Step 1: Download/trim video
        let videoUrl = task.videoUrl;
        if (!videoUrl) {
          const downloadResult = await downloadVideo(task, (stage) => {
            updateActiveItemStage(task.exerciseName, stage);
          });

          if (!downloadResult.success || !downloadResult.videoUrl) {
            console.error(`[PROCESSOR] Download failed: ${downloadResult.error}`);
            if (task.templateId) {
              await markTemplateFailed(task.templateId, downloadResult.error || 'Video download failed');
            }
            failedCountRef.current += 1;
            removeActiveItem(task.exerciseName);
            setModalState(prev => ({ ...prev, failed: failedCountRef.current }));
            continue;
          }
          videoUrl = downloadResult.videoUrl;
        }

        // Step 2: Submit to Kling
        updateActiveItemStage(task.exerciseName, 'submitting');

        const positionImageUrl = getPositionImageUrlRef.current(task.positionId);
        if (!positionImageUrl) {
          console.error(`[PROCESSOR] No position image for ${task.positionName}`);
          if (task.templateId) {
            await markTemplateFailed(task.templateId, `Position "${task.positionName}" not found`);
          }
          failedCountRef.current += 1;
          removeActiveItem(task.exerciseName);
          setModalState(prev => ({ ...prev, failed: failedCountRef.current }));
          continue;
        }

        try {
          const klingTaskId = await submitToKlingWithRetry(
            {
              imageUrl: positionImageUrl,
              videoUrl,
              characterOrientation: 'video',
              mode: 'std',
              keepOriginalSound: 'no',
              prompt: task.customPrompt,
            },
            task.exerciseName
          );

          console.log(`[PROCESSOR] Kling accepted: ${task.exerciseName} (${klingTaskId})`);

          // Add to active tasks for polling
          const submittedTask: QueuedTask = {
            ...task,
            klingTaskId,
            status: 'submitted',
            videoUrl,
          };
          activeTasksRef.current.set(task.taskId, submittedTask);

          updateActiveItemStage(task.exerciseName, 'polling');
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Unknown Kling API error';
          console.error(`[PROCESSOR] Kling submission failed:`, err);
          if (task.templateId) {
            await markTemplateFailed(task.templateId, `Kling API error: ${errorMsg}`);
          }
          failedCountRef.current += 1;
          removeActiveItem(task.exerciseName);
          setModalState(prev => ({ ...prev, failed: failedCountRef.current }));
        }
      }
    };

    // Wait for processing to complete
    await processNextTask();

    // Wait for all active tasks to complete
    while (activeTasksRef.current.size > 0 && !cancelledRef.current) {
      await new Promise(r => setTimeout(r, 2000));
      await pollKlingStatus();
    }

    // Cleanup
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    console.log(`[PROCESSOR] Batch complete: ${completedCountRef.current} completed, ${failedCountRef.current} failed`);
    setModalState(prev => ({
      ...prev,
      isDone: true,
      activeItems: [],
      completed: completedCountRef.current,
      failed: failedCountRef.current,
    }));
  }, [pollKlingStatus, markTemplateFailed, addActiveItem, updateActiveItemStage, removeActiveItem]);

  // ============================================
  // CANCEL PROCESSING
  // ============================================
  const cancelProcessing = useCallback(() => {
    console.log('[PROCESSOR] Cancelling remaining tasks');
    cancelledRef.current = true;

    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    // Mark remaining active tasks as failed
    activeTasksRef.current.forEach(async (task) => {
      if (task.templateId) {
        await markTemplateFailed(task.templateId, 'Processing cancelled by user');
      }
    });
    activeTasksRef.current.clear();

    setModalState(prev => ({
      ...prev,
      isDone: true,
      activeItems: [],
    }));
  }, [markTemplateFailed]);

  // ============================================
  // RESET MODAL
  // ============================================
  const resetModal = useCallback(() => {
    setIsProcessing(false);
    setModalState(INITIAL_MODAL_STATE);
    cancelledRef.current = false;
    activeTasksRef.current.clear();
  }, []);

  // ============================================
  // HELPER: Submit to Kling with retry
  // ============================================
  async function submitToKlingWithRetry(
    payload: Record<string, unknown>,
    exerciseName: string,
    maxRetries = 3
  ): Promise<string> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const processRes = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const processData = await processRes.json();

      if (processRes.ok) {
        return processData.taskId;
      }

      const errorCode = processData.code || processData.error_code;
      if (errorCode === 1303 || processData.error?.includes('1303') || processData.error?.includes('over resource pack limit')) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`[PROCESSOR] Error 1303 for "${exerciseName}", retrying in ${delay/1000}s...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      throw new Error(processData.error || 'Kling API submission failed');
    }

    throw new Error(`Max retries exceeded for Kling submission`);
  }

  // ============================================
  // HELPER: Download video
  // ============================================
  interface DownloadResult {
    success: boolean;
    videoUrl?: string;
    error?: string;
  }

  async function downloadVideo(
    task: QueuedTask,
    onStageChange?: (stage: 'downloading' | 'trimming') => void
  ): Promise<DownloadResult> {
    try {
      let videoUrl: string | undefined;

      // Log trim times for debugging
      console.log(`[PROCESSOR] ${task.exerciseName} - startTime: ${task.sourceStartTime}, endTime: ${task.sourceEndTime}`);

      // Rerun with existing blob URL - only skip if NO trim times specified
      const hasTrimTimes = task.sourceStartTime !== undefined || task.sourceEndTime !== undefined;
      console.log(`[PROCESSOR] ${task.exerciseName} - hasTrimTimes: ${hasTrimTimes}, isBlob: ${task.sourceInputUrl?.includes('blob.vercel-storage.com')}`);

      if (task.sourceInputUrl?.includes('blob.vercel-storage.com') && !hasTrimTimes) {
        console.log(`[PROCESSOR] Rerun detected, using existing blob URL (no trim times)`);
        return { success: true, videoUrl: task.sourceInputUrl };
      }

      if (task.sourceYoutubeUrl) {
        const res = await fetch('/api/youtube-download-v2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: task.sourceYoutubeUrl }),
        });
        const data = await res.json();

        if (res.ok) {
          videoUrl = data.url;
        } else {
          return { success: false, error: `YouTube download failed: ${data.error || 'Unknown error'}` };
        }
      } else if (task.sourceInputUrl) {
        videoUrl = task.sourceInputUrl;
      }

      if (!videoUrl) {
        return { success: false, error: 'No video source provided' };
      }

      // Client-side trimming
      console.log(`[PROCESSOR] ${task.exerciseName} - Checking trim condition: startTime=${task.sourceStartTime}, endTime=${task.sourceEndTime}`);
      if (task.sourceStartTime !== undefined || task.sourceEndTime !== undefined) {
        const startTime = task.sourceStartTime ?? 0;
        let endTime = task.sourceEndTime ?? startTime + 5;
        console.log(`[PROCESSOR] ${task.exerciseName} - WILL TRIM from ${startTime}s to ${endTime}s`);

        const sourceDuration = await getVideoDuration(videoUrl);
        if (sourceDuration !== undefined) {
          if (sourceDuration < 3) {
            return {
              success: false,
              error: `Source video is only ${sourceDuration.toFixed(1)} seconds. Kling requires at least 3 seconds.`
            };
          }
          if (endTime > sourceDuration) {
            endTime = sourceDuration;
          }
        }

        const duration = endTime - startTime;
        if (duration < 3) {
          return {
            success: false,
            error: `Trimmed video would be ${duration.toFixed(1)} seconds. Kling requires at least 3 seconds.`
          };
        }

        onStageChange?.('trimming');
        console.log(`[PROCESSOR] Trimming (${startTime}s - ${endTime}s)`);

        try {
          const trimmedBlob = await trimVideo(videoUrl, startTime, endTime);
          console.log(`[PROCESSOR] Trimmed to ${(trimmedBlob.size / 1024 / 1024).toFixed(2)} MB`);

          const formData = new FormData();
          formData.append('file', trimmedBlob, `trimmed-${task.taskId}.mp4`);
          formData.append('type', 'video');

          const uploadRes = await fetch('/api/upload', {
            method: 'POST',
            body: formData,
          });

          if (uploadRes.ok) {
            const uploadData = await uploadRes.json();
            videoUrl = uploadData.url;
          } else {
            const uploadError = await uploadRes.text();
            return { success: false, error: `Failed to upload trimmed video: ${uploadError}` };
          }
        } catch (trimError) {
          return { success: false, error: `Video trimming failed: ${trimError instanceof Error ? trimError.message : 'Unknown error'}` };
        }
      } else {
        console.log(`[PROCESSOR] ${task.exerciseName} - NO TRIM: startTime and endTime are both undefined`);
      }

      return { success: true, videoUrl };
    } catch (err) {
      return { success: false, error: `Download error: ${err instanceof Error ? err.message : 'Unknown error'}` };
    }
  }

  return {
    // Modal state
    isProcessing,
    modalState,

    // Actions
    processTemplates,
    cancelProcessing,
    resetModal,

    // Triggers
    exerciseSavedTrigger,
    templateDeletedTrigger,
  };
}
