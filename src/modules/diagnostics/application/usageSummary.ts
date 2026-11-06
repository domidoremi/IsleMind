import type { UsageDailyRollup, UsageRecord, UsageStatisticsSummary, UsageTokenCounts } from '../contracts'

export function deduplicateUsageAttempts(records: readonly UsageRecord[]): UsageRecord[] {
  const unique = new Map<string, UsageRecord>()
  for (const record of records) {
    const key = record.attemptIdentity ? `attempt:${record.attemptIdentity}` : `record:${record.id}`
    const previous = unique.get(key)
    if (!previous || record.completedAt > previous.completedAt) unique.set(key, record)
  }
  return [...unique.values()]
}

/** Missing measurements stay missing. Cache and reasoning are never added to total twice. */
export function knownUsageTotal(tokens: UsageTokenCounts): number | undefined {
  if (tokens.totalTokens !== undefined) return Number.isSafeInteger(tokens.totalTokens) && tokens.totalTokens >= 0 ? tokens.totalTokens : undefined
  if (tokens.inputTokens === undefined || tokens.outputTokens === undefined) return undefined
  if (!Number.isSafeInteger(tokens.inputTokens) || tokens.inputTokens < 0
    || !Number.isSafeInteger(tokens.outputTokens) || tokens.outputTokens < 0) return undefined
  const total = tokens.inputTokens + tokens.outputTokens
  return Number.isSafeInteger(total) ? total : undefined
}

export function summarizeUsageRecords(
  input: readonly UsageRecord[],
  rollups: readonly UsageDailyRollup[] = [],
): UsageStatisticsSummary {
  const records = deduplicateUsageAttempts(input)
  const archivedCount = sumCounts(rollups.map(value => value.requestCount))
  const attemptCount = sumCounts([records.length, archivedCount])
  const totals: UsageTokenCounts = {}
  let totalsOverflowed = false
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'cacheCreationInputTokens', 'cacheReadInputTokens', 'cachedInputTokens', 'reasoningTokens'] as const) {
    const values = [
      ...records.map(record => key === 'totalTokens' ? knownUsageTotal(record.tokens)
        : key === 'cacheReadInputTokens' ? cacheReadTokens(record.tokens)
          : key === 'cachedInputTokens' ? cachedTokens(record.tokens) : record.tokens[key]),
      // Old rollups wrote missing fields as zero; their field coverage cannot be recovered.
      ...rollups.map(rollup => rollup.measurements?.tokens[key]),
    ]
    const total = sum(values)
    if (total !== undefined) totals[key] = total
    else if (values.some(value => value !== undefined)) totalsOverflowed = true
  }
  const costs = [...records.map(value => value.totalCostNanodollars),
    ...rollups.map(value => value.costSampleCount ? value.totalCostNanodollars : undefined)]
  const totalCostNanodollars = sum(costs)
  const costTotalOverflowed = totalCostNanodollars === undefined && costs.some(value => value !== undefined)
  if (costTotalOverflowed) totalsOverflowed = true
  const costSampleCount = sumCounts([records.filter(value => value.totalCostNanodollars !== undefined).length,
    ...rollups.map(value => value.costSampleCount)])
  const durations = records.map(value => value.durationMs).filter(Number.isFinite)
  const firstTokens = records.flatMap(value => value.firstTokenMs === undefined ? [] : [value.firstTokenMs])
  const durationCount = sumCounts([durations.length, ...rollups.map(value => value.durationSampleCount)])
  const firstTokenSampleCount = sumCounts([firstTokens.length, ...rollups.map(value => value.firstTokenSampleCount)])
  const durationTotal = durations.reduce((total, value) => total + value, 0)
    + rollups.reduce((total, value) => total + value.durationMsTotal, 0)
  const firstTokenTotal = firstTokens.reduce((total, value) => total + value, 0)
    + rollups.reduce((total, value) => total + value.firstTokenMsTotal, 0)
  const logicalRequestCount = new Set(records.flatMap(value =>
    value.execution ? [value.execution.logicalRequestId] : [])).size
  const costSources = {
    supplierCostNanodollars: sum([...records.filter(value => value.costProvenance === 'supplier-known').map(value => value.totalCostNanodollars),
      ...rollups.map(value => value.measurements?.supplierCostNanodollars)]),
    estimatedCostNanodollars: sum([...records.filter(value => value.costProvenance === 'price-table-estimate').map(value => value.totalCostNanodollars),
      ...rollups.map(value => value.measurements?.estimatedCostNanodollars)]),
    unclassifiedCostNanodollars: sum([...records.filter(value => value.costProvenance === 'unavailable').map(value => value.totalCostNanodollars),
      ...rollups.map(value => value.measurements ? value.measurements.unclassifiedCostNanodollars
        : value.costSampleCount ? value.totalCostNanodollars : undefined)]),
  }
  return {
    requestCount: attemptCount,
    logicalRequestCount,
    legacyAttemptCount: sumCounts([records.filter(value => !value.execution).length, archivedCount]),
    archivedAttemptCount: archivedCount,
    successCount: sumCounts([records.filter(value => value.status === 'success').length, ...rollups.map(value => value.successCount)]),
    failedCount: sumCounts([records.filter(value => value.status === 'failed').length, ...rollups.map(value => value.failedCount)]),
    estimatedCount: sumCounts([records.filter(value => value.measurementSource === 'estimated').length,
      ...rollups.map(value => value.measurementSource === 'estimated' ? value.requestCount : 0)]),
    retryCount: sumCounts([records.filter(value => value.attemptReason === 'retry' || value.attemptReason === 'rectification').length,
      ...rollups.map(value => value.retryCount ?? 0)]),
    failoverCount: sumCounts([countUsageRouteSwitches(records), ...rollups.map(value => value.failoverCount ?? 0)]),
    costSampleCount,
    unknownCostCount: Math.max(0, attemptCount - costSampleCount),
    tokenSampleCount: sumCounts([records.filter(value => knownUsageTotal(value.tokens) !== undefined).length,
      ...rollups.map(value => value.measurements?.tokenSampleCounts.totalTokens ?? 0)]),
    firstTokenSampleCount,
    ...totals,
    ...costSources,
    ...(totalCostNanodollars === undefined ? {} : { totalCostNanodollars }),
    ...(durationCount && Number.isFinite(durationTotal) ? { averageDurationMs: durationTotal / durationCount } : {}),
    ...(firstTokenSampleCount && Number.isFinite(firstTokenTotal) ? { averageFirstTokenMs: firstTokenTotal / firstTokenSampleCount } : {}),
    ...(totals.inputTokens && totals.cacheReadInputTokens !== undefined ? { cacheHitRate: totals.cacheReadInputTokens / totals.inputTokens } : {}),
    ...(totalsOverflowed ? { totalsOverflowed: true } : {}),
    ...(costTotalOverflowed ? { costTotalOverflowed: true } : {}),
  }
}

function sum(values: readonly (number | undefined)[]): number | undefined {
  let total: number | undefined
  for (const value of values) {
    if (value === undefined) continue
    if (!Number.isSafeInteger(value) || value < 0) return undefined
    total = (total ?? 0) + value
    if (!Number.isSafeInteger(total)) return undefined
  }
  return total
}

function sumCounts(values: readonly number[]): number {
  const total = sum(values)
  if (values.length && total === undefined) throw new Error('Usage counts exceed the supported integer range.')
  return total ?? 0
}

/** Count recorded target changes once, including a scoped fallback's explicit original target. */
export function usageRouteSwitchAttempts(records: readonly UsageRecord[]): UsageRecord[] {
  const previous = new Map<string, string>()
  const switches: UsageRecord[] = []
  for (const record of [...records].sort((left, right) => left.occurredAt - right.occurredAt
    || left.completedAt - right.completedAt || left.id.localeCompare(right.id))) {
    const key = record.execution?.logicalRequestId ?? `historical:${record.id}`
    const target = JSON.stringify([record.providerId, record.requestedModel])
    const earlier = previous.get(key)
    const original = JSON.stringify([record.originalProviderId ?? record.providerId, record.originalModel ?? record.requestedModel])
    if ((earlier !== undefined && earlier !== target)
      || (earlier === undefined && record.attemptReason === 'fallback' && original !== target)) switches.push(record)
    previous.set(key, target)
  }
  return switches
}

function countUsageRouteSwitches(records: readonly UsageRecord[]): number {
  return usageRouteSwitchAttempts(records).length
}

function cacheReadTokens(tokens: UsageTokenCounts): number | undefined {
  return tokens.cacheReadInputTokens ?? (tokens.cachedInputTokens === undefined ? undefined
    : Math.max(0, tokens.cachedInputTokens - (tokens.cacheCreationInputTokens ?? 0)))
}

function cachedTokens(tokens: UsageTokenCounts): number | undefined {
  if (tokens.cachedInputTokens !== undefined) return tokens.cachedInputTokens
  if (tokens.cacheReadInputTokens === undefined && tokens.cacheCreationInputTokens === undefined) return undefined
  return (tokens.cacheReadInputTokens ?? 0) + (tokens.cacheCreationInputTokens ?? 0)
}
