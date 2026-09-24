/** Bounded, content-free session calibration. Usage remains billing truth, never this coefficient. */
export function createProviderTokenCalibration() {
  const factors = new Map<string, number>()
  const attempts = new Set<string>()
  return {
    factor(key: string): number { return factors.get(key) ?? 1 },
    observe(input: { key: string; attemptId: string; rawInputTokens: number; actualInputTokens: number }) {
      if (attempts.has(input.attemptId) || !Number.isFinite(input.rawInputTokens) || input.rawInputTokens <= 0
        || !Number.isSafeInteger(input.actualInputTokens) || input.actualInputTokens <= 0) return
      attempts.add(input.attemptId)
      if (attempts.size > 512) attempts.delete(attempts.values().next().value!)
      // Never make the safety gate less conservative after one cheap sample.
      // Extreme/corrupt measurements are bounded; headroom is not a guarantee.
      const factor = Math.max(factors.get(input.key) ?? 1, Math.min(8, input.actualInputTokens / input.rawInputTokens))
      factors.delete(input.key); factors.set(input.key, factor)
      if (factors.size > 128) factors.delete(factors.keys().next().value!)
    },
  }
}
