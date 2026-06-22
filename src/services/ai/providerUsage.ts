import type { MessageUsage, ProviderType } from '@/types'

export interface ProviderUsageExtractionOptions {
  includeReasoning?: boolean
}

export function extractUsage(json: Record<string, unknown>, providerType: ProviderType, options: ProviderUsageExtractionOptions = {}): MessageUsage | undefined {
  const includeReasoning = options.includeReasoning !== false
  if (providerType === 'anthropic') {
    const usage = json.usage as Record<string, unknown> | undefined
    const inputTokens = numberValue(usage?.input_tokens)
    const outputTokens = numberValue(usage?.output_tokens)
    if (!inputTokens && !outputTokens) return undefined
    return {
      inputTokens,
      outputTokens,
      totalTokens: sumOptional(inputTokens, outputTokens),
      source: 'provider',
    }
  }

  if (providerType === 'google') {
    const usage = json.usageMetadata as Record<string, unknown> | undefined
    const inputTokens = numberValue(usage?.promptTokenCount)
    const outputTokens = numberValue(usage?.candidatesTokenCount)
    const reasoningTokens = includeReasoning ? numberValue(usage?.thoughtsTokenCount) : undefined
    const totalTokens = numberValue(usage?.totalTokenCount) ?? sumOptional(inputTokens, outputTokens, reasoningTokens)
    if (!inputTokens && !outputTokens && !totalTokens) return undefined
    return { inputTokens, outputTokens, totalTokens, reasoningTokens, source: 'provider' }
  }

  const usage = json.usage as Record<string, unknown> | undefined
  const inputTokens = numberValue(usage?.input_tokens) ?? numberValue(usage?.prompt_tokens)
  const outputTokens = numberValue(usage?.output_tokens) ?? numberValue(usage?.completion_tokens)
  const totalTokens = numberValue(usage?.total_tokens) ?? sumOptional(inputTokens, outputTokens)
  const outputDetails = usage?.output_tokens_details as Record<string, unknown> | undefined
  const completionDetails = usage?.completion_tokens_details as Record<string, unknown> | undefined
  const reasoningTokens = includeReasoning ? numberValue(outputDetails?.reasoning_tokens) ?? numberValue(completionDetails?.reasoning_tokens) : undefined
  if (!inputTokens && !outputTokens && !totalTokens) return undefined
  return { inputTokens, outputTokens, totalTokens, reasoningTokens, source: 'provider' }
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function sumOptional(...values: (number | undefined)[]): number | undefined {
  const known = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return known.length ? known.reduce((sum, value) => sum + value, 0) : undefined
}
