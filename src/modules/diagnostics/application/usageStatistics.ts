import type {
  UsageGroupSummary,
  UsageDailyRollup,
  UsageRecord,
  UsageRecordFilter,
  UsageRecordPageRequest,
  UsageStatisticsService,
  UsageStatisticsSummary,
  UsageTrendPoint,
  UsagePricingEntry,
} from '../contracts'
import { calculateUsageCost, resolveUsagePricingEntry } from './usagePricing'

export const DEFAULT_USAGE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000

export function createUsageStatisticsService(
  repository: Parameters<typeof repositoryIdentity>[0],
  options: { retentionMs?: number; builtInPricing?: readonly UsagePricingEntry[] } = {},
): UsageStatisticsService {
  const retentionMs = options.retentionMs ?? DEFAULT_USAGE_RETENTION_MS
  const builtInPricing = options.builtInPricing ?? []
  return {
    async record(record) {
      if (record.costProvenance !== 'unavailable' || record.dataSource === 'legacy-message') {
        return repository.append(record)
      }
      const manualPricing = await repository.listPricingEntries()
      const pricing = resolveUsagePricingEntry(
        [...builtInPricing, ...manualPricing],
        record.providerId,
        record.pricingModel ?? record.upstreamModel,
        record.occurredAt,
      )
      const cost = calculateUsageCost(record.tokens, pricing)
      return repository.append({
        ...record,
        ...(cost.totalCostNanodollars === undefined ? {} : { totalCostNanodollars: cost.totalCostNanodollars }),
        costProvenance: cost.provenance,
        ...(cost.pricing ? { pricing: cost.pricing } : {}),
      })
    },
    async snapshot(request = {}) {
      const filter = request.filter
      const [records, rollups, page] = await Promise.all([
        repository.listAll(filter),
        repository.listRollups(filter),
        repository.list(request),
      ])
      return {
        summary: summarizeUsageRecords(records, rollups),
        trends: groupUsageTrends(records, rollups, filter),
        providers: groupUsageRecords(records, rollups, (value) => [value.providerId, value.providerName]),
        models: groupUsageRecords(records, rollups, (value) => [value.upstreamModel, value.upstreamModel]),
        records: page,
      }
    },
    async listPricingEntries() {
      return [...builtInPricing, ...await repository.listPricingEntries()]
    },
    savePricingEntry: (entry) => repository.savePricingEntry(entry),
    deletePricingEntry: (id) => repository.deletePricingEntry(id),
    async export(filter, format) {
      const [records, rollups] = await Promise.all([
        repository.listAll(filter),
        repository.listRollups(filter),
      ])
      return format === 'json'
        ? JSON.stringify({
            schema: 'islemind.usage-statistics-export.v1',
            records,
            dailyRollups: rollups,
          }, null, 2)
        : usageRecordsToCsv(records, rollups)
    },
    runRetention: (now = Date.now()) => repository.compactBefore(now - retentionMs),
    clear: () => repository.clear(),
  }
}

function repositoryIdentity(repository: import('../contracts').UsageRecordRepository) {
  return repository
}

export function summarizeUsageRecords(
  records: readonly UsageRecord[],
  rollups: readonly UsageDailyRollup[] = [],
): UsageStatisticsSummary {
  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0
  let cacheCreationInputTokens = 0
  let cacheReadInputTokens = 0
  let cachedInputTokens = 0
  let reasoningTokens = 0
  let totalCostNanodollars = 0
  let costCount = 0
  let durationTotal = 0
  let durationCount = 0
  let firstTokenTotal = 0
  let firstTokenCount = 0
  let successCount = 0
  let failedCount = 0
  let estimatedCount = 0

  for (const record of records) {
    if (record.status === 'success') successCount += 1
    if (record.status === 'failed') failedCount += 1
    if (record.measurementSource === 'estimated') estimatedCount += 1
    inputTokens += count(record.tokens.inputTokens)
    outputTokens += count(record.tokens.outputTokens)
    totalTokens += count(record.tokens.totalTokens ?? inferredTotal(record))
    const cacheCreation = count(record.tokens.cacheCreationInputTokens)
    const compatibilityCached = count(record.tokens.cachedInputTokens)
    const cacheRead = record.tokens.cacheReadInputTokens === undefined
      ? Math.max(0, compatibilityCached - cacheCreation)
      : count(record.tokens.cacheReadInputTokens)
    cacheCreationInputTokens += cacheCreation
    cacheReadInputTokens += cacheRead
    cachedInputTokens += record.tokens.cachedInputTokens === undefined
      ? cacheCreation + cacheRead
      : compatibilityCached
    reasoningTokens += count(record.tokens.reasoningTokens)
    if (typeof record.totalCostNanodollars === 'number') {
      totalCostNanodollars += record.totalCostNanodollars
      costCount += 1
    }
    if (Number.isFinite(record.durationMs)) {
      durationTotal += record.durationMs
      durationCount += 1
    }
    if (typeof record.firstTokenMs === 'number' && Number.isFinite(record.firstTokenMs)) {
      firstTokenTotal += record.firstTokenMs
      firstTokenCount += 1
    }
  }

  let rollupRequestCount = 0
  for (const rollup of rollups) {
    rollupRequestCount += count(rollup.requestCount)
    successCount += count(rollup.successCount)
    failedCount += count(rollup.failedCount)
    if (rollup.measurementSource === 'estimated') estimatedCount += count(rollup.requestCount)
    inputTokens += count(rollup.inputTokens)
    outputTokens += count(rollup.outputTokens)
    totalTokens += count(rollup.totalTokens)
    cacheCreationInputTokens += count(rollup.cacheCreationInputTokens)
    cacheReadInputTokens += count(rollup.cacheReadInputTokens)
    cachedInputTokens += count(rollup.cachedInputTokens)
    reasoningTokens += count(rollup.reasoningTokens)
    if (rollup.costSampleCount > 0) {
      totalCostNanodollars += count(rollup.totalCostNanodollars)
      costCount += count(rollup.costSampleCount)
    }
    durationTotal += count(rollup.durationMsTotal)
    durationCount += count(rollup.durationSampleCount)
    firstTokenTotal += count(rollup.firstTokenMsTotal)
    firstTokenCount += count(rollup.firstTokenSampleCount)
  }

  const cacheableInput = Math.max(0, inputTokens)
  return {
    requestCount: records.length + rollupRequestCount,
    successCount,
    failedCount,
    estimatedCount,
    inputTokens,
    outputTokens,
    totalTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    cachedInputTokens,
    reasoningTokens,
    ...(costCount ? { totalCostNanodollars } : {}),
    ...(durationCount ? { averageDurationMs: durationTotal / durationCount } : {}),
    ...(firstTokenCount ? { averageFirstTokenMs: firstTokenTotal / firstTokenCount } : {}),
    ...(cacheableInput ? { cacheHitRate: cacheReadInputTokens / cacheableInput } : {}),
  }
}

function groupUsageRecords(
  records: readonly UsageRecord[],
  rollups: readonly UsageDailyRollup[],
  keyFor: (value: UsageRecord | UsageDailyRollup) => readonly [string, string],
): UsageGroupSummary[] {
  const grouped = new Map<string, { label: string; records: UsageRecord[]; rollups: UsageDailyRollup[] }>()
  for (const record of records) {
    const [key, label] = keyFor(record)
    const group = grouped.get(key) ?? { label, records: [], rollups: [] }
    group.records.push(record)
    grouped.set(key, group)
  }
  for (const rollup of rollups) {
    const [key, label] = keyFor(rollup)
    const group = grouped.get(key) ?? { label, records: [], rollups: [] }
    group.rollups.push(rollup)
    grouped.set(key, group)
  }
  return [...grouped.entries()]
    .map(([key, group]) => ({ key, label: group.label, ...summarizeUsageRecords(group.records, group.rollups) }))
    .sort((left, right) => right.requestCount - left.requestCount || left.label.localeCompare(right.label))
}

function groupUsageTrends(
  records: readonly UsageRecord[],
  rollups: readonly UsageDailyRollup[],
  filter: UsageRecordFilter | undefined,
): UsageTrendPoint[] {
  const duration = Math.max(0, (filter?.endAt ?? Date.now()) - (filter?.startAt ?? Date.now() - 24 * 60 * 60 * 1000))
  const bucketMs = rollups.length || duration > 48 * 60 * 60 * 1000
    ? 24 * 60 * 60 * 1000
    : 60 * 60 * 1000
  const grouped = new Map<number, { records: UsageRecord[]; rollups: UsageDailyRollup[] }>()
  for (const record of records) {
    const bucketStart = Math.floor(record.occurredAt / bucketMs) * bucketMs
    const group = grouped.get(bucketStart) ?? { records: [], rollups: [] }
    group.records.push(record)
    grouped.set(bucketStart, group)
  }
  for (const rollup of rollups) {
    const bucketStart = Math.floor(rollup.dayStart / bucketMs) * bucketMs
    const group = grouped.get(bucketStart) ?? { records: [], rollups: [] }
    group.rollups.push(rollup)
    grouped.set(bucketStart, group)
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([bucketStart, group]) => ({ bucketStart, ...summarizeUsageRecords(group.records, group.rollups) }))
}

function usageRecordsToCsv(records: readonly UsageRecord[], rollups: readonly UsageDailyRollup[]): string {
  const headers = [
    'record_type', 'request_count', 'time', 'provider', 'model', 'input_tokens', 'output_tokens', 'cache_creation_tokens',
    'cache_read_tokens', 'reasoning_tokens', 'duration_ms', 'first_token_ms', 'cost_usd',
    'status', 'status_code', 'source', 'data_source',
  ]
  const rows = records.map((record) => [
    'request',
    1,
    new Date(record.occurredAt).toISOString(),
    record.providerName,
    record.upstreamModel,
    record.tokens.inputTokens,
    record.tokens.outputTokens,
    record.tokens.cacheCreationInputTokens,
    cacheReadTokens(record),
    record.tokens.reasoningTokens,
    record.durationMs,
    record.firstTokenMs,
    typeof record.totalCostNanodollars === 'number' ? record.totalCostNanodollars / 1_000_000_000 : undefined,
    record.status,
    record.statusCode,
    record.operationSource,
    record.dataSource,
  ].map(csvCell).join(','))
  const rollupRows = rollups.map((rollup) => [
    'daily_rollup',
    rollup.requestCount,
    new Date(rollup.dayStart).toISOString(),
    rollup.providerName,
    rollup.upstreamModel,
    rollup.inputTokens,
    rollup.outputTokens,
    rollup.cacheCreationInputTokens,
    rollup.cacheReadInputTokens ?? rollup.cachedInputTokens,
    rollup.reasoningTokens,
    rollup.durationSampleCount ? rollup.durationMsTotal / rollup.durationSampleCount : undefined,
    rollup.firstTokenSampleCount ? rollup.firstTokenMsTotal / rollup.firstTokenSampleCount : undefined,
    rollup.costSampleCount ? rollup.totalCostNanodollars / 1_000_000_000 : undefined,
    rollup.status,
    undefined,
    rollup.operationSource,
    rollup.dataSource,
  ].map(csvCell).join(','))
  return [headers.join(','), ...rows, ...rollupRows].join('\n')
}

function cacheReadTokens(record: UsageRecord): number | undefined {
  if (record.tokens.cacheReadInputTokens !== undefined) return record.tokens.cacheReadInputTokens
  if (record.tokens.cachedInputTokens === undefined) return undefined
  return Math.max(
    0,
    record.tokens.cachedInputTokens - (record.tokens.cacheCreationInputTokens ?? 0),
  )
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return ''
  const text = String(value)
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function count(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function inferredTotal(record: UsageRecord): number {
  return count(record.tokens.inputTokens) + count(record.tokens.outputTokens)
}
