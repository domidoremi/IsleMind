export interface AppFeedbackTimeoutAccessibilityInfo {
  getRecommendedTimeoutMillis?: (originalTimeout: number) => number | PromiseLike<number>
}

function isValidRecommendedTimeout(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export async function resolveAppFeedbackTimeout(
  durationMs: number,
  accessibilityInfo?: AppFeedbackTimeoutAccessibilityInfo | null,
): Promise<number> {
  try {
    const resolveRecommendedTimeout = accessibilityInfo?.getRecommendedTimeoutMillis
    if (typeof resolveRecommendedTimeout !== 'function') return durationMs

    const recommendedTimeout = await resolveRecommendedTimeout.call(accessibilityInfo, durationMs)
    return isValidRecommendedTimeout(recommendedTimeout) ? recommendedTimeout : durationMs
  } catch {
    return durationMs
  }
}
