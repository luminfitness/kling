/**
 * Prompt History - localStorage helpers for Image Gen page
 */

const STORAGE_KEY = 'imageGenPromptHistory';
const MAX_HISTORY = 20;

/**
 * Get prompt history from localStorage
 */
export function getPromptHistory(): string[] {
  if (typeof window === 'undefined') return [];

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    return JSON.parse(stored) as string[];
  } catch {
    return [];
  }
}

/**
 * Save a prompt to history (most recent first, deduped)
 */
export function savePromptToHistory(prompt: string): void {
  if (typeof window === 'undefined') return;
  if (!prompt.trim()) return;

  try {
    const history = getPromptHistory();

    // Remove if already exists (will re-add at front)
    const filtered = history.filter(p => p !== prompt);

    // Add to front
    const updated = [prompt, ...filtered].slice(0, MAX_HISTORY);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Ignore localStorage errors
  }
}

/**
 * Clear all prompt history
 */
export function clearPromptHistory(): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore localStorage errors
  }
}

/**
 * Delete a specific prompt from history
 */
export function deletePromptFromHistory(prompt: string): void {
  if (typeof window === 'undefined') return;

  try {
    const history = getPromptHistory();
    const updated = history.filter(p => p !== prompt);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Ignore localStorage errors
  }
}
