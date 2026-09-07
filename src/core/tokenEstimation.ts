/**
 * Deliberately shared estimator for every context-producing path. Include
 * CJK punctuation so retrieval and request planning use the same units.
 * These are heuristic units, not exact provider token counts.
 */
export const TOKEN_ESTIMATOR_VERSION = 'heuristic-v2'
const CJK_RE = /[\u3000-\u303f\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g
const WORD_RE = /[A-Za-z0-9_]+(?:[-'][A-Za-z0-9_]+)*/g

export function estimateTextTokens(text: string): number {
  const value = text.trim()
  if (!value) return 0
  const cjkCount = value.match(CJK_RE)?.length ?? 0
  const latinWords = value.match(WORD_RE)?.length ?? 0
  const nonCjkChars = Math.max(0, value.replace(CJK_RE, '').length)
  return Math.max(1, Math.ceil(cjkCount * 0.85 + latinWords * 1.25 + nonCjkChars / 12))
}

/** Estimate a JSON payload with the same accounting used for plain text. */
export function estimateJsonTokens(value: unknown): number {
  try {
    return estimateTextTokens(typeof value === 'string' ? value : JSON.stringify(value))
  } catch {
    return 0
  }
}
