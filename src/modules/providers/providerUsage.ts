export interface ProviderUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
  /** Compatibility aggregate of cache reads plus cache creation. */
  cachedInputTokens?: number
  reasoningTokens?: number
  source: 'provider' | 'estimated'
}

export interface ProviderUsageExtractionOptions {
  includeReasoning?: boolean
}

export function extractUsage(
  json: Record<string, unknown>,
  providerType: string,
  options: ProviderUsageExtractionOptions = {},
): ProviderUsage | undefined {
  const includeReasoning = options.includeReasoning !== false
  if (providerType === 'anthropic') {
    const usage = json.usage as Record<string, unknown> | undefined
    const uncachedInputTokens = numberValue(usage?.input_tokens)
    const outputTokens = numberValue(usage?.output_tokens)
    const cacheReadInputTokens = numberValue(usage?.cache_read_input_tokens)
    const cacheCreationInputTokens = numberValue(usage?.cache_creation_input_tokens)
    const cachedInputTokens = sumOptional(cacheReadInputTokens, cacheCreationInputTokens)
    const inputTokens = sumOptional(uncachedInputTokens, cacheReadInputTokens, cacheCreationInputTokens)
    if (inputTokens === undefined && outputTokens === undefined) return undefined
    return {
      inputTokens,
      outputTokens,
      ...(cacheReadInputTokens !== undefined ? { cacheReadInputTokens } : {}),
      ...(cacheCreationInputTokens !== undefined ? { cacheCreationInputTokens } : {}),
      ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
      totalTokens: sumOptional(inputTokens, outputTokens),
      source: 'provider',
    }
  }

  if (providerType === 'google') {
    const usage = json.usageMetadata as Record<string, unknown> | undefined
    const inputTokens = numberValue(usage?.promptTokenCount)
    const outputTokens = numberValue(usage?.candidatesTokenCount)
    const cachedInputTokens = numberValue(usage?.cachedContentTokenCount) ?? numberValue(usage?.cacheTokenCount)
    const reasoningTokens = includeReasoning ? numberValue(usage?.thoughtsTokenCount) : undefined
    const totalTokens = numberValue(usage?.totalTokenCount) ?? sumOptional(inputTokens, outputTokens, reasoningTokens)
    if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) return undefined
    return {
      inputTokens,
      outputTokens,
      ...(cachedInputTokens !== undefined ? { cacheReadInputTokens: cachedInputTokens } : {}),
      ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
      totalTokens,
      ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
      source: 'provider',
    }
  }

  const usage = json.usage as Record<string, unknown> | undefined
  const inputTokens = aliasCount(usage?.input_tokens, usage?.prompt_tokens)
  const outputTokens = aliasCount(usage?.output_tokens, usage?.completion_tokens)
  const totalTokens = numberValue(usage?.total_tokens) ?? sumOptional(inputTokens, outputTokens)
  const inputDetails = usage?.input_tokens_details as Record<string, unknown> | undefined
  const promptDetails = usage?.prompt_tokens_details as Record<string, unknown> | undefined
  const outputDetails = usage?.output_tokens_details as Record<string, unknown> | undefined
  const completionDetails = usage?.completion_tokens_details as Record<string, unknown> | undefined
  const cachedInputTokens = aliasCount(inputDetails?.cached_tokens, promptDetails?.cached_tokens)
  const reasoningTokens = includeReasoning ? aliasCount(outputDetails?.reasoning_tokens, completionDetails?.reasoning_tokens) : undefined
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) return undefined
  return {
    inputTokens,
    outputTokens,
    ...(cachedInputTokens !== undefined ? { cacheReadInputTokens: cachedInputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    totalTokens,
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    source: 'provider',
  }
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined
}

/** Compatible gateways may emit both protocols with zero-filled placeholders.
 * Aliases overlap: retain the larger observed count, never sum or erase it.
 */
function aliasCount(first: unknown, second: unknown): number | undefined {
  const a = numberValue(first)
  const b = numberValue(second)
  return a === undefined ? b : b === undefined ? a : Math.max(a, b)
}

function sumOptional(...values: (number | undefined)[]): number | undefined {
  const known = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return known.length ? known.reduce((sum, value) => sum + value, 0) : undefined
}
