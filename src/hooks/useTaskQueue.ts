'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getTasks, updateTask, removeTask } from '@/lib/taskQueue';
import { autoSaveCompletedTask } from '@/lib/autoSave';
import { supabase } from '@/lib/supabase';
import type { QueuedTask } from '@/types';

export function useTaskQueue(pollIntervalMs: number = 10000, reloadTrigger?: number) {
  const [tasks, setTasks] = useState<QueuedTask[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const savingTaskIds = useRef<Set<string>>(new Set());

  const reload = useCallback(async () => {
    const loaded = await getTasks();
    setTasks(loaded);
  }, []);

  // Clean up orphaned tasks - tasks in queue whose output already exists in library
  const cleanupOrphanedTasks = useCallback(async (tasksToCheck: QueuedTask[]) => {
    for (const task of tasksToCheck) {
      if (!task.outputVideoUrl) continue;

      // Check if this output already exists in exercise_entries
      const { data: existing } = await supabase
        .from('exercise_entries')
        .select('id')
        .eq('output_video_url', task.outputVideoUrl)
        .limit(1);

      if (existing && existing.length > 0) {
        console.log(`[useTaskQueue] Cleaning up orphaned task: ${task.exerciseName} (already in library)`);
        await removeTask(task.taskId).catch(() => {});
      }
    }
  }, []);

  const pollActive = useCallback(async () => {
    const current = await getTasks();
    console.log(`[useTaskQueue] 🔍 Found ${current.length} tasks in queue`);

    // First, clean up any orphaned tasks (status is succeed but still in queue)
    const orphaned = current.filter(t => t.status === 'succeed' && t.outputVideoUrl);
    if (orphaned.length > 0) {
      await cleanupOrphanedTasks(orphaned);
    }

    // Only poll tasks that have been submitted to Kling (have a klingTaskId)
    const active = current.filter(
      (t) => t.status !== 'succeed' && t.status !== 'failed' && t.status !== 'queued' && t.klingTaskId
    );

    console.log(`[useTaskQueue] 📡 Polling ${active.length} active tasks...`);
    if (active.length === 0) {
      // Still reload if we cleaned up orphans
      if (orphaned.length > 0) await reload();
      return;
    }

    const results = await Promise.allSettled(
      active.map(async (task) => {
        // Use klingTaskId (Kling API ID), not taskId (our internal UUID)
        console.log(`[useTaskQueue] 🔄 Checking ${task.exerciseName} (${task.klingTaskId})...`);
        const res = await fetch(`/api/process/${task.klingTaskId}`);
        if (!res.ok) {
          console.log(`[useTaskQueue] ❌ API returned ${res.status} for ${task.exerciseName}`);
          return null;
        }
        const data = await res.json();
        console.log(`[useTaskQueue] 📊 ${task.exerciseName}: status="${data.status}"`);
        return data;
      })
    );

    let changed = false;
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status !== 'fulfilled' || !result.value) continue;
      const data = result.value;
      const task = active[i];

      if (data.status !== task.status) {
        const updates: Partial<QueuedTask> = { status: data.status };
        if (data.status === 'succeed' && data.videos?.length > 0) {
          updates.outputVideoUrl = data.videos[0].url;
          const dur = parseFloat(data.videos[0].duration);
          if (!isNaN(dur)) updates.videoDurationSec = dur;
        }
        await updateTask(task.taskId, updates);

        // Auto-save to library when task succeeds
        if (data.status === 'succeed' && !task.autoSaved && !savingTaskIds.current.has(task.taskId)) {
          savingTaskIds.current.add(task.taskId);
          const completedTask = { ...task, ...updates };
          let saveSucceeded = false;
          try {
            await updateTask(task.taskId, { autoSaved: true });
            await autoSaveCompletedTask(completedTask as QueuedTask);
            saveSucceeded = true;
          } catch (err) {
            console.error('Auto-save failed for task', task.taskId, err);
            savingTaskIds.current.delete(task.taskId);
            await updateTask(task.taskId, { autoSaved: false }).catch(() => {});
          }

          // Always try to remove after save attempt (cleanup)
          // autoSaveCompletedTask handles deduplication, so this is safe
          if (saveSucceeded) {
            try {
              await removeTask(task.taskId);
              console.log(`[useTaskQueue] ✅ Removed task from queue: ${task.exerciseName}`);
            } catch (removeErr) {
              console.error('Failed to remove task from queue', task.taskId, removeErr);
            }
          }
        }

        changed = true;
      }
    }

    if (changed) await reload();
  }, [reload, cleanupOrphanedTasks]);

  useEffect(() => {
    reload();
    pollActive();
    intervalRef.current = setInterval(pollActive, pollIntervalMs);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [reload, pollActive, pollIntervalMs]);

  // Reload when trigger changes (from batch submission context)
  useEffect(() => {
    if (reloadTrigger !== undefined && reloadTrigger > 0) {
      reload();
    }
  }, [reloadTrigger, reload]);

  const activeTasks = tasks.filter(
    (t) => t.status !== 'succeed' && t.status !== 'failed'
  );
  const completedTasks = tasks.filter((t) => t.status === 'succeed');
  const failedTasks = tasks.filter((t) => t.status === 'failed');

  return { tasks, activeTasks, completedTasks, failedTasks, reload };
}
