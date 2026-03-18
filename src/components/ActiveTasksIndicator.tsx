'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useBatchSubmission } from '@/contexts/BatchSubmissionContext';

interface ActiveTask {
  taskId: string;
  exerciseName: string;
  status: string;
  klingTaskId: string;
}

/**
 * Shows a persistent indicator in the bottom-right when there are tasks
 * actively processing on Kling. Appears on page load and updates every 10s.
 *
 * Hides when BatchProgressPanel is visible (during active batch submission).
 * Also polls Kling to update task status and mark completed tasks.
 */
export default function ActiveTasksIndicator() {
  const [activeTasks, setActiveTasks] = useState<ActiveTask[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const { items: batchItems, isSubmitting } = useBatchSubmission();

  // Poll Kling for each task and update Supabase if completed
  const pollAndUpdateTasks = useCallback(async (tasks: ActiveTask[]) => {
    for (const task of tasks) {
      if (!task.klingTaskId) continue;

      try {
        const res = await fetch(`/api/process/${task.klingTaskId}`);
        if (!res.ok) continue;

        const data = await res.json();

        if (data.status === 'succeed' || data.status === 'completed') {
          console.log(`[ActiveTasks] 🎉 Task "${task.exerciseName}" completed!`);
          await supabase.from('task_queue').update({
            status: 'completed',
            output_video_url: data.videos?.[0]?.url || null,
            video_duration_sec: data.videos?.[0]?.duration ? parseFloat(data.videos[0].duration) : null,
          }).eq('kling_task_id', task.klingTaskId);
        } else if (data.status === 'failed') {
          console.log(`[ActiveTasks] ❌ Task "${task.exerciseName}" failed`);
          await supabase.from('task_queue').update({ status: 'failed' }).eq('kling_task_id', task.klingTaskId);
        }
      } catch (e) {
        console.error(`[ActiveTasks] Error polling ${task.exerciseName}:`, e);
      }
    }
  }, []);

  const fetchActiveTasks = useCallback(async () => {
    const { data, error } = await supabase
      .from('task_queue')
      .select('task_id, exercise_name, status, kling_task_id')
      .in('status', ['submitted', 'processing']);

    if (error) {
      console.error('[ActiveTasks] Error fetching:', error);
      return;
    }

    const tasks = (data || []).map((t) => ({
      taskId: t.task_id,
      exerciseName: t.exercise_name,
      status: t.status,
      klingTaskId: t.kling_task_id,
    }));

    // Poll Kling to update status of any active tasks
    if (tasks.length > 0) {
      await pollAndUpdateTasks(tasks);
      // Re-fetch after polling to get updated statuses
      const { data: updated } = await supabase
        .from('task_queue')
        .select('task_id, exercise_name, status, kling_task_id')
        .in('status', ['submitted', 'processing']);

      setActiveTasks(
        (updated || []).map((t) => ({
          taskId: t.task_id,
          exerciseName: t.exercise_name,
          status: t.status,
          klingTaskId: t.kling_task_id,
        }))
      );
    } else {
      setActiveTasks([]);
    }
  }, [pollAndUpdateTasks]);

  // Poll for active tasks on mount and every 10 seconds
  useEffect(() => {
    fetchActiveTasks();
    const interval = setInterval(fetchActiveTasks, 10000);
    return () => clearInterval(interval);
  }, [fetchActiveTasks]);

  // Don't show if no active tasks
  if (activeTasks.length === 0) {
    return null;
  }

  // Hide when BatchProgressPanel is visible (during batch submission)
  if (isSubmitting || batchItems.length > 0) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-40">
      {isExpanded ? (
        // Expanded view - show list of tasks
        <div className="w-72 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 bg-blue-50 border-b border-blue-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              <span className="font-medium text-blue-900 text-sm">
                {activeTasks.length} task{activeTasks.length !== 1 ? 's' : ''} processing
              </span>
            </div>
            <button
              onClick={() => setIsExpanded(false)}
              className="text-blue-400 hover:text-blue-600 transition-colors"
              title="Collapse"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          {/* Task list */}
          <div className="max-h-48 overflow-y-auto">
            {activeTasks.map((task) => (
              <div
                key={task.taskId}
                className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-100 last:border-b-0"
              >
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse flex-shrink-0" />
                <span className="text-sm text-gray-700 truncate flex-1">
                  {task.exerciseName}
                </span>
                <span className="text-xs text-gray-400 capitalize">
                  {task.status}
                </span>
              </div>
            ))}
          </div>

          {/* Footer hint */}
          <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
            <p className="text-xs text-gray-500">
              Tasks auto-save when complete
            </p>
          </div>
        </div>
      ) : (
        // Collapsed view - just a small indicator
        <button
          onClick={() => setIsExpanded(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-white rounded-lg shadow-lg border border-gray-200 hover:bg-gray-50 transition-colors"
        >
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
          <span className="text-sm font-medium text-gray-700">
            {activeTasks.length} processing on Kling
          </span>
          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </button>
      )}
    </div>
  );
}
