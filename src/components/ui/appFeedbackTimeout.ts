export interface AppFeedbackTimeoutAccessibilityInfo {
  getRecommendedTimeoutMillis?: (originalTimeout: number) => number | PromiseLike<number>
}

const RECOMMENDED_TIMEOUT_LOOKUP_LIMIT_MS = 250

function isValidRecommendedTimeout(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export async function resolveAppFeedbackTimeout(
  durationMs: number,
  accessibilityInfo?: AppFeedbackTimeoutAccessibilityInfo | null,
  lookupLimitMs = RECOMMENDED_TIMEOUT_LOOKUP_LIMIT_MS,
): Promise<number> {
  try {
    const resolveRecommendedTimeout = accessibilityInfo?.getRecommendedTimeoutMillis
    if (typeof resolveRecommendedTimeout !== 'function') return durationMs

    const recommendedTimeout = await Promise.race([
      Promise.resolve(resolveRecommendedTimeout.call(accessibilityInfo, durationMs)),
      new Promise<number>((resolve) => setTimeout(() => resolve(durationMs), lookupLimitMs)),
    ])
    return isValidRecommendedTimeout(recommendedTimeout) ? recommendedTimeout : durationMs
  } catch {
    return durationMs
  }
}
