import type { UsageTokenCounts } from '@/modules/diagnostics'

export function reportedTotalTokens(tokens: UsageTokenCounts): number | undefined {
  if (tokens.totalTokens !== undefined) return tokens.totalTokens
  // Reasoning is an output breakdown, not an extra count to add again.
  return tokens.inputTokens !== undefined && tokens.outputTokens !== undefined
    ? tokens.inputTokens + tokens.outputTokens : undefined
}

export function reportedCacheTokens(tokens: UsageTokenCounts): number | undefined {
  if (tokens.cachedInputTokens !== undefined) return tokens.cachedInputTokens
  if (tokens.cacheReadInputTokens === undefined && tokens.cacheCreationInputTokens === undefined) return undefined
  return (tokens.cacheReadInputTokens ?? 0) + (tokens.cacheCreationInputTokens ?? 0)
}

export function formatReportedTokens(value: number | undefined): string {
  return value === undefined ? '—' : value.toLocaleString()
}
