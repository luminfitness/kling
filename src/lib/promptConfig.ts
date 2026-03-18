/**
 * Kling API Prompt Configuration
 *
 * This file contains developer-configurable prompts used to guide the Kling AI
 * video generation. These prompts are NOT user-editable but are visible in the UI
 * for debugging and testing purposes.
 */

export const KLING_PROMPTS = {
  /**
   * Default prompt used for all video transformations
   * Focuses on: single rep, looping, exact pose, neutral expression
   */
  default: "The subject's entire body is fully visible and centered in the frame from head to feet at all times. The subject maintains a neutral, straight face with no speaking or mouth movement. The subject has exactly two arms and two legs - do not duplicate or add extra limbs. Maintain exact pose and body positioning from reference video.",

  /**
   * Experimental prompts for testing different approaches
   * Uncomment and set activePrompt to test variations
   */
  // experimental: "Follow the exact movements in the reference video. Keep the same camera angle and body orientation throughout.",
  // withNegatives: "Maintain exact pose from reference video. Do not alter body positioning. Do not rotate the character. Do not change the viewing angle.",
} as const;

/**
 * The active prompt key to use
 * Change this to switch between different prompt configurations
 */
export const ACTIVE_PROMPT_KEY: keyof typeof KLING_PROMPTS = 'default';

/**
 * Get the currently active prompt
 */
export function getActivePrompt(): string {
  return KLING_PROMPTS[ACTIVE_PROMPT_KEY];
}

/**
 * Get all available prompts (for debugging/display)
 */
export function getAllPrompts() {
  return KLING_PROMPTS;
}
