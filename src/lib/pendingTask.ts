import type { PendingTaskMeta } from '@/types';

const PENDING_KEY = 'pendingTasks';

function getPendingTasks(): Record<string, PendingTaskMeta> {
  if (typeof window === 'undefined') return {};
  const raw = localStorage.getItem(PENDING_KEY);
  return raw ? JSON.parse(raw) : {};
}

export function savePendingTask(meta: PendingTaskMeta): void {
  const existing = getPendingTasks();
  existing[meta.taskId] = meta;
  localStorage.setItem(PENDING_KEY, JSON.stringify(existing));
}

export function getPendingTask(taskId: string): PendingTaskMeta | null {
  const all = getPendingTasks();
  return all[taskId] || null;
}

export function removePendingTask(taskId: string): void {
  const all = getPendingTasks();
  delete all[taskId];
  localStorage.setItem(PENDING_KEY, JSON.stringify(all));
}
