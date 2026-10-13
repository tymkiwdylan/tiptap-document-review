/**
 * Configuration constants for the diff engine and edit algorithms.
 * Centralizes magic numbers for easier tuning and maintenance.
 */

export const DIFF_CONFIG = {
  /**
   * Minimum text length to trigger granular character-level diffing.
   * Below this threshold, simple text replacement is used.
   */
  TEXT_DIFF_MIN_LENGTH: 60,

  /**
   * Default context window size (in characters) for text matching.
   * Used to verify matches by checking surrounding text.
   */
  CONTEXT_WINDOW_DEFAULT: 150,

  /**
   * Extended context window for legal documents with longer sections.
   */
  CONTEXT_WINDOW_LEGAL: 200,

  /**
   * Length of head/tail segments used in fuzzy block matching.
   * When exact match fails for large blocks, we match by these segments.
   */
  FUZZY_HEAD_TAIL_LENGTH: 60,

  /**
   * Minimum query length to trigger fuzzy block matching.
   * Smaller queries use exact matching only.
   */
  FUZZY_MIN_QUERY_LENGTH: 100,

  /**
   * Maximum length variation allowed in fuzzy block matching.
   * Allows for content edits in the middle of matched blocks.
   * 0.3 = 30% length difference tolerance.
   */
  FUZZY_TOLERANCE_PERCENT: 0.3,

  /**
   * Maximum word length to consider for whole-word matching.
   * Longer strings likely contain spaces and shouldn't use whole-word mode.
   */
  WHOLE_WORD_MAX_LENGTH: 20,

  /**
   * Minimum text length for jsondiffpatch to use diff-match-patch.
   * Shorter texts use simple replacement.
   */
  JSON_DIFF_TEXT_MIN_LENGTH: 10,

  /**
   * Similarity ratio threshold for adaptive text diffing.
   * Above this ratio, use granular diffing regardless of length.
   */
  SIMILARITY_THRESHOLD_FOR_DIFF: 0.7,
} as const;

/**
 * Debug configuration for diff operations.
 */
export const DEBUG_CONFIG = {
  /**
   * Enable verbose logging for diff operations.
   * Should be false in production.
   */
  ENABLE_DIFF_LOGGING: false,

  /**
   * Enable verbose logging for search/match operations.
   */
  ENABLE_SEARCH_LOGGING: false,

  /**
   * Maximum length of text to log (prevents huge log outputs).
   */
  MAX_LOG_TEXT_LENGTH: 100,
} as const;

/**
 * Helper to truncate text for logging.
 */
export function truncateForLog(text: string, maxLength = DEBUG_CONFIG.MAX_LOG_TEXT_LENGTH): string {
  if (text.length <= maxLength) return text;
  return `${text.substring(0, maxLength)}...`;
}

/**
 * Conditional logger that respects debug settings.
 */
export function diffLog(message: string, ...args: any[]): void {
  if (DEBUG_CONFIG.ENABLE_DIFF_LOGGING) {
    console.log(message, ...args);
  }
}

/**
 * Conditional logger for search operations.
 */
export function searchLog(message: string, ...args: any[]): void {
  if (DEBUG_CONFIG.ENABLE_SEARCH_LOGGING) {
    console.log(message, ...args);
  }
}
