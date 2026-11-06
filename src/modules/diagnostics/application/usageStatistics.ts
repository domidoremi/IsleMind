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
import { deduplicateUsageAttempts, knownUsageTotal, summarizeUsageRecords } from './usageSummary'
import { projectUsageConversations, projectUsageRequests } from './usageRequests'

export const DEFAULT_USAGE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000

export function createUsageStatisticsService(
  repository: Parameters<typeof repositoryIdentity>[0],
  options: { retentionMs?: number; builtInPricing?: readonly UsagePricingEntry[]; recorded?: (record: UsageRecord) => void } = {},
): UsageStatisticsService {
  const retentionMs = options.retentionMs ?? DEFAULT_USAGE_RETENTION_MS
  const builtInPricing = options.builtInPricing ?? []
  async function append(record: UsageRecord): Promise<boolean> {
    const inserted = await repository.append(record)
    if (inserted) options.recorded?.(record)
    return inserted
  }
  return {
    async record(record, pricingPolicy = {}) {
      if (record.costProvenance !== 'unavailable' || record.dataSource === 'legacy-message') {
        return append(record)
      }
      const manualPricing = await repository.listPricingEntries()
      const pricing = resolveUsagePricingEntry(
        [...(pricingPolicy.allowBuiltInPricing === false ? [] : builtInPricing), ...manualPricing],
        record.providerId,
        record.pricingModel ?? record.upstreamModel,
        record.occurredAt,
        record.providerType,
      )
      const cost = calculateUsageCost(record.tokens, pricing)
      return append({
        ...record,
        ...(cost.totalCostNanodollars === undefined ? {} : { totalCostNanodollars: cost.totalCostNanodollars }),
        costProvenance: cost.provenance,
        ...(cost.pricing ? { pricing: cost.pricing } : {}),
      })
    },
    async snapshot(request = {}) {
      const filter = request.filter
      const [rawRecords, rollups, page] = await Promise.all([
        repository.listAll(filter),
        repository.listRollups(filter),
        repository.list(request),
      ])
      const records = deduplicateUsageAttempts(rawRecords)
      const requests = projectUsageRequests(records)
      const allRequestIds = requests.flatMap(value => value.reference.kind === 'request' ? [value.reference.id] : [])
      const latest: UsageRecord[] = []
      for (let index = 0; index < allRequestIds.length; index += 100) {
        latest.push(...await repository.latestByRequest(allRequestIds.slice(index, index + 100)))
      }
      const limit = Math.max(1, Math.min(100, Math.floor(request.limit ?? 50)))
      const offset = Math.max(0, Math.floor(request.offset ?? 0))
      const requestPage = requests.slice(offset, offset + limit)
      // The row retains costs from the matching attempts but reports the complete route/outcome.
      const requestIds = requestPage.flatMap(value => value.reference.kind === 'request' ? [value.reference.id] : [])
      const complete = requestIds.length
        ? new Map(projectUsageRequests(await repository.listAll({ logicalRequestIds: requestIds, includeEstimated: true }))
          .map(value => [value.reference.id, value]))
        : new Map()
      return {
        summary: summarizeUsageRecords(records, rollups),
        requestOutcomes: {
          requestCount: latest.length,
          successCount: latest.filter(value => value.status === 'success').length,
          failedCount: latest.filter(value => value.status === 'failed').length,
          cancelledCount: latest.filter(value => value.status === 'cancelled').length,
          limitedCount: latest.filter(value => value.status === 'limited').length,
          partialCount: latest.filter(value => value.status === 'partial').length,
        },
        trends: groupUsageTrends(records, rollups, filter),
        providers: groupUsageRecords(records, rollups, (value) => [value.providerId, value.providerName]),
        models: groupUsageRecords(records, rollups, (value) => [value.upstreamModel, value.upstreamModel]),
        records: page,
        requests: {
          requests: requestPage.map(value => {
            const full = complete.get(value.reference.id)
            return full ? { ...full, summary: value.summary } : value
          }),
          total: requests.length,
          hasMore: offset + requestPage.length < requests.length,
        },
        conversations: projectUsageConversations(records),
      }
    },
    async detail(reference) {
      const result = await repository.findExecution(reference)
      if (!result.records.length) return undefined
      return {
        reference,
        requests: projectUsageRequests(result.records),
        attempts: deduplicateUsageAttempts(result.records),
        summary: summarizeUsageRecords(result.records),
        truncated: result.truncated,
      }
    },
    runAttempts: (runId, providerId) => repository.findRunAttempts(runId, providerId),
    recentProviders: ids => repository.latestByProvider(ids),
    async listPricingEntries() {
      return [...builtInPricing, ...await repository.listPricingEntries()]
    },
    savePricingEntry: (entry, expectedRevision) => repository.savePricingEntry(entry, expectedRevision),
    deletePricingEntry: (id) => repository.deletePricingEntry(id),
    async export(filter, format) {
      const [rawRecords, rollups] = await Promise.all([
        repository.listAll(filter),
        repository.listRollups(filter),
      ])
      const records = deduplicateUsageAttempts(rawRecords)
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

export { summarizeUsageRecords } from './usageSummary'

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
    const bucketStart = Math.floor((record.execution?.requestStartedAt ?? record.occurredAt) / bucketMs) * bucketMs
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
    'status', 'status_code', 'source', 'data_source', 'original_provider', 'original_model',
    'actual_provider', 'actual_model', 'retry_count', 'failover_count', 'attempt_identity', 'attempt_reason',
    'logical_request_id', 'response_execution_id', 'parent_request_id', 'conversation_id', 'message_id',
    'reported_model', 'reported_model_source', 'cost_provenance', 'pricing_version',
    'total_tokens', 'measurement_source', 'token_samples', 'cost_samples', 'unknown_cost_count',
    'supplier_cost_usd', 'price_table_cost_usd', 'unclassified_cost_usd',
  ]
  const rows = records.map((record) => [
    'attempt',
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
    record.originalProviderId ?? record.providerId,
    record.originalModel ?? record.requestedModel,
    record.actualProviderId ?? record.providerId,
    record.actualModel ?? record.upstreamModel,
    record.retryCount ?? (record.attemptReason === 'retry' || record.attemptReason === 'rectification' ? record.attempt : 0),
    record.failoverCount ?? (record.attemptReason === 'fallback' ? 1 : 0),
    record.attemptIdentity,
    record.attemptReason,
    record.execution?.logicalRequestId,
    record.execution?.responseExecutionId,
    record.execution?.parentRequestId,
    record.conversationId,
    record.execution?.messageId,
    record.reportedExecution?.model,
    record.reportedExecution?.source,
    record.costProvenance,
    record.pricing?.version,
    knownUsageTotal(record.tokens),
    record.measurementSource,
    Number(knownUsageTotal(record.tokens) !== undefined),
    Number(record.totalCostNanodollars !== undefined),
    Number(record.totalCostNanodollars === undefined),
    record.costProvenance === 'supplier-known' && record.totalCostNanodollars !== undefined ? record.totalCostNanodollars / 1_000_000_000 : undefined,
    record.costProvenance === 'price-table-estimate' && record.totalCostNanodollars !== undefined ? record.totalCostNanodollars / 1_000_000_000 : undefined,
    record.costProvenance === 'unavailable' && record.totalCostNanodollars !== undefined ? record.totalCostNanodollars / 1_000_000_000 : undefined,
  ].map(csvCell).join(','))
  const rollupRows = rollups.map((rollup) => [
    'daily_rollup',
    rollup.requestCount,
    new Date(rollup.dayStart).toISOString(),
    rollup.providerName,
    rollup.upstreamModel,
    rollup.measurements?.tokens.inputTokens,
    rollup.measurements?.tokens.outputTokens,
    rollup.measurements?.tokens.cacheCreationInputTokens,
    rollup.measurements?.tokens.cacheReadInputTokens,
    rollup.measurements?.tokens.reasoningTokens,
    rollup.durationSampleCount ? rollup.durationMsTotal / rollup.durationSampleCount : undefined,
    rollup.firstTokenSampleCount ? rollup.firstTokenMsTotal / rollup.firstTokenSampleCount : undefined,
    rollup.costSampleCount ? rollup.totalCostNanodollars / 1_000_000_000 : undefined,
    rollup.status,
    undefined,
    rollup.operationSource,
    rollup.dataSource,
    undefined,
    undefined,
    rollup.providerId,
    rollup.upstreamModel,
    rollup.retryCount,
    rollup.failoverCount,
    undefined,
    undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    rollup.measurements?.tokens.totalTokens,
    rollup.measurementSource,
    rollup.measurements?.tokenSampleCounts.totalTokens,
    rollup.costSampleCount,
    Math.max(0, rollup.requestCount - rollup.costSampleCount),
    rollup.measurements?.supplierCostNanodollars === undefined ? undefined : rollup.measurements.supplierCostNanodollars / 1_000_000_000,
    rollup.measurements?.estimatedCostNanodollars === undefined ? undefined : rollup.measurements.estimatedCostNanodollars / 1_000_000_000,
    rollup.measurements ? rollup.measurements.unclassifiedCostNanodollars === undefined ? undefined : rollup.measurements.unclassifiedCostNanodollars / 1_000_000_000
      : rollup.costSampleCount ? rollup.totalCostNanodollars / 1_000_000_000 : undefined,
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
  // A spreadsheet must treat provider/model names as text, including formula-like names.
  const raw = String(value)
  const text = typeof value === 'string' && /^[\s]*[=+\-@]/u.test(raw) ? `'${raw}` : raw
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}
