import type {
  UsageCostProvenance,
  UsagePricingEntry,
  UsagePricingSnapshot,
  UsageTokenCounts,
} from '../contracts'

export interface UsageCostResult {
  totalCostNanodollars?: number
  provenance: UsageCostProvenance
  pricing?: UsagePricingSnapshot
}

export function normalizeUsagePricingModel(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .split('/').at(-1)!
    .split(':')[0]!
    .replaceAll('@', '-')
    .replace(/-(?:19|20)\d{2}-?\d{2}-?\d{2}$/u, '')
    .replace(/-v\d+(?:\.\d+)?$/u, '')
}

export function resolveUsagePricingEntry(
  entries: readonly UsagePricingEntry[],
  providerId: string,
  model: string,
  occurredAt: number,
  providerType?: string,
): UsagePricingEntry | undefined {
  const normalizedModel = normalizeUsagePricingModel(model)
  return [...entries]
    .filter((entry) =>
      (!entry.providerId || entry.providerId === providerId) &&
      (!entry.providerType || entry.providerType === providerType) &&
      entry.effectiveFrom <= occurredAt &&
      modelPatternMatches(entry.modelPattern, normalizedModel),
    )
    .sort((left, right) => {
      const providerSpecificity = Number(Boolean(right.providerId)) - Number(Boolean(left.providerId))
      if (providerSpecificity) return providerSpecificity
      const providerTypeSpecificity = Number(Boolean(right.providerType)) - Number(Boolean(left.providerType))
      if (providerTypeSpecificity) return providerTypeSpecificity
      const sourceSpecificity = Number(right.source === 'manual') - Number(left.source === 'manual')
      if (sourceSpecificity) return sourceSpecificity
      const patternSpecificity = right.modelPattern.length - left.modelPattern.length
      if (patternSpecificity) return patternSpecificity
      return right.effectiveFrom - left.effectiveFrom
    })[0]
}

export function calculateUsageCost(
  tokens: UsageTokenCounts,
  pricing: UsagePricingEntry | undefined,
): UsageCostResult {
  if (!pricing) return { provenance: 'unavailable' }
  const input = finiteTokenCount(tokens.inputTokens)
  const output = finiteTokenCount(tokens.outputTokens)
  const cacheCreation = finiteTokenCount(tokens.cacheCreationInputTokens)
  const compatibilityCached = finiteTokenCount(tokens.cachedInputTokens)
  const cacheRead = tokens.cacheReadInputTokens === undefined
    ? Math.max(0, compatibilityCached - cacheCreation)
    : finiteTokenCount(tokens.cacheReadInputTokens)
  const reasoning = finiteTokenCount(tokens.reasoningTokens)
  if (![input, output, cacheRead, cacheCreation, reasoning].some((value) => value > 0)) {
    return { provenance: 'unavailable' }
  }

  const uncachedInput = Math.max(0, input - cacheRead - cacheCreation)
  const rates = pricing.rates
  const inputRate = rates.inputNanodollarsPerMillionTokens
  const outputRate = rates.outputNanodollarsPerMillionTokens
  const cacheReadRate = rates.cacheReadNanodollarsPerMillionTokens ?? inputRate
  const cacheCreationRate = rates.cacheCreationNanodollarsPerMillionTokens ?? inputRate
  const reasoningRate = rates.reasoningNanodollarsPerMillionTokens ?? outputRate
  if (![inputRate, outputRate, cacheReadRate, cacheCreationRate, reasoningRate].every(isSafeRate)) {
    return { provenance: 'unavailable' }
  }
  const billedOutput = rates.reasoningBilling === 'separate'
    ? Math.max(0, output - reasoning)
    : output
  const billedReasoning = rates.reasoningBilling === 'included-in-output' ? 0 : reasoning
  const numerator =
    multiplyExact(uncachedInput, inputRate) +
    multiplyExact(billedOutput, outputRate) +
    multiplyExact(cacheRead, cacheReadRate) +
    multiplyExact(cacheCreation, cacheCreationRate) +
    multiplyExact(billedReasoning, reasoningRate)
  const rounded = (numerator + 500_000n) / 1_000_000n
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) return { provenance: 'unavailable' }

  return {
    totalCostNanodollars: Number(rounded),
    provenance: 'price-table-estimate',
    pricing: {
      entryId: pricing.id,
      version: pricing.version,
      source: pricing.source,
      rates: { ...pricing.rates },
    },
  }
}

function modelPatternMatches(pattern: string, model: string): boolean {
  const normalizedPattern = normalizeUsagePricingModel(pattern)
  if (!normalizedPattern.includes('*')) return normalizedPattern === model
  const escaped = normalizedPattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
    .join('.*')
  return new RegExp(`^${escaped}$`, 'u').test(model)
}

function finiteTokenCount(value: number | undefined): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? Math.floor(value)
    : 0
}

function multiplyExact(tokens: number, rate: number): bigint {
  return BigInt(tokens) * BigInt(rate)
}

function isSafeRate(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}
