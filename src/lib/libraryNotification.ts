import type { ExerciseEntry } from '@/types';

const KEY = 'lastLibraryViewedAt';

export function getLastLibraryViewedAt(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(KEY);
}

export function setLastLibraryViewedAt(timestamp: string): void {
  localStorage.setItem(KEY, timestamp);
}

/**
 * Returns true if there are exercises saved AFTER the last time
 * the user visited the library page.
 */
export function hasNewExercises(exercises: ExerciseEntry[]): boolean {
  const lastViewed = getLastLibraryViewedAt();
  if (!lastViewed) {
    // Never viewed library — any exercises count as new
    return exercises.length > 0;
  }
  return exercises.some((e) => e.savedAt > lastViewed);
}
