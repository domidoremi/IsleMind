export const USAGE_RECORD_SCHEMA = 'islemind.usage-record.v1' as const
export const USAGE_PORTABLE_SNAPSHOT_SCHEMA = 'islemind.usage-portable-snapshot.v1' as const

export type UsageOperationSource =
  | 'chat'
  | 'agent'
  | 'tavern'
  | 'tool-continuation'
  | 'memory'
  | 'context'
  | 'knowledge'
  | 'embedding'
  | 'transcription'
  | 'speech'
  | 'media'
  | 'other'

export type UsageDataSource = 'live-provider' | 'estimated' | 'legacy-message'
export type UsageMeasurementSource = 'provider' | 'estimated' | 'unavailable'
export type UsageCostProvenance = 'supplier-known' | 'price-table-estimate' | 'unavailable'
export type UsageRecordStatus = 'success' | 'failed' | 'cancelled' | 'limited' | 'partial'
export type UsageAttemptReason = 'initial' | 'retry' | 'rectification' | 'fallback'

export interface UsageTokenCounts {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
  cachedInputTokens?: number
  reasoningTokens?: number
}

export interface UsagePricingRates {
  inputNanodollarsPerMillionTokens: number
  outputNanodollarsPerMillionTokens: number
  cacheReadNanodollarsPerMillionTokens?: number
  cacheCreationNanodollarsPerMillionTokens?: number
  reasoningNanodollarsPerMillionTokens?: number
  /** Whether reasoning tokens are included in, separate from, or additional to outputTokens. */
  reasoningBilling: 'included-in-output' | 'separate' | 'additional-to-output'
}

export interface UsagePricingEntry {
  id: string
  providerType?: string
  providerId?: string
  modelPattern: string
  displayName: string
  version: string
  effectiveFrom: number
  source: 'built-in' | 'manual'
  rates: UsagePricingRates
}

export interface UsagePricingSnapshot {
  entryId: string
  version: string
  source: UsagePricingEntry['source']
  rates: UsagePricingRates
}

export interface UsageRecord {
  schema: typeof USAGE_RECORD_SCHEMA
  id: string
  occurredAt: number
  completedAt: number
  providerId: string
  providerType?: string
  providerName: string
  credentialGroupId?: string
  requestedModel: string
  upstreamModel: string
  /** Optional route attribution added after the v1 record shape was introduced. */
  originalProviderId?: string
  originalModel?: string
  actualProviderId?: string
  actualModel?: string
  retryCount?: number
  failoverCount?: number
  attemptIdentity?: string
  pricingModel?: string
  operationSource: UsageOperationSource
  dataSource: UsageDataSource
  measurementSource: UsageMeasurementSource
  status: UsageRecordStatus
  statusCode?: number
  errorCode?: string
  isStreaming?: boolean
  durationMs: number
  firstTokenMs?: number
  attempt: number
  attemptReason: UsageAttemptReason
  correlationId?: string
  conversationId?: string
  runId?: string
  tokens: UsageTokenCounts
  totalCostNanodollars?: number
  costProvenance: UsageCostProvenance
  pricing?: UsagePricingSnapshot
}

export interface UsageRecordFilter {
  startAt?: number
  endAt?: number
  providerIds?: readonly string[]
  models?: readonly string[]
  statuses?: readonly UsageRecordStatus[]
  operationSources?: readonly UsageOperationSource[]
  dataSources?: readonly UsageDataSource[]
  includeEstimated?: boolean
  search?: string
}

export interface UsageRecordPageRequest {
  filter?: UsageRecordFilter
  limit?: number
  offset?: number
}

export interface UsageRecordPage {
  records: readonly UsageRecord[]
  total: number
  hasMore: boolean
}

export interface UsageDailyRollup {
  dayStart: number
  providerId: string
  providerName: string
  upstreamModel: string
  operationSource: UsageOperationSource
  dataSource: UsageDataSource
  measurementSource: UsageMeasurementSource
  status: UsageRecordStatus
  requestCount: number
  retryCount?: number
  failoverCount?: number
  successCount: number
  failedCount: number
  cancelledCount: number
  limitedCount: number
  partialCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  cachedInputTokens: number
  reasoningTokens: number
  totalCostNanodollars: number
  costSampleCount: number
  durationMsTotal: number
  durationSampleCount: number
  firstTokenMsTotal: number
  firstTokenSampleCount: number
}

export interface UsageStatisticsSummary extends UsageTokenCounts {
  requestCount: number
  successCount: number
  failedCount: number
  estimatedCount: number
  /** Counts are attempt-level; a fallback can therefore count more than once. */
  retryCount: number
  failoverCount: number
  totalCostNanodollars?: number
  averageDurationMs?: number
  averageFirstTokenMs?: number
  cacheHitRate?: number
}

export interface UsageTrendPoint extends UsageStatisticsSummary {
  bucketStart: number
}

export interface UsageGroupSummary extends UsageStatisticsSummary {
  key: string
  label: string
}

export interface UsageStatisticsSnapshot {
  summary: UsageStatisticsSummary
  trends: readonly UsageTrendPoint[]
  providers: readonly UsageGroupSummary[]
  models: readonly UsageGroupSummary[]
  records: UsageRecordPage
}

export interface UsageRecordRepository {
  append(record: UsageRecord): Promise<boolean>
  importOnce(markerId: string, records: readonly UsageRecord[]): Promise<boolean>
  list(request?: UsageRecordPageRequest): Promise<UsageRecordPage>
  listAll(filter?: UsageRecordFilter): Promise<readonly UsageRecord[]>
  listRollups(filter?: UsageRecordFilter): Promise<readonly UsageDailyRollup[]>
  listPricingEntries(): Promise<readonly UsagePricingEntry[]>
  savePricingEntry(entry: UsagePricingEntry): Promise<void>
  deletePricingEntry(id: string): Promise<void>
  compactBefore(cutoff: number): Promise<void>
  clear(): Promise<void>
}

export interface UsagePortableSnapshot {
  schema: typeof USAGE_PORTABLE_SNAPSHOT_SCHEMA
  records: readonly UsageRecord[]
  dailyRollups: readonly UsageDailyRollup[]
  pricingEntries: readonly UsagePricingEntry[]
}

export interface UsagePortableSnapshotRepository {
  load(options?: { signal?: AbortSignal }): Promise<UsagePortableSnapshot>
  replace(
    snapshot: UsagePortableSnapshot,
    options?: { signal?: AbortSignal },
  ): Promise<void>
}

export interface UsageStatisticsService {
  record(record: UsageRecord): Promise<boolean>
  snapshot(request?: UsageRecordPageRequest): Promise<UsageStatisticsSnapshot>
  listPricingEntries(): Promise<readonly UsagePricingEntry[]>
  savePricingEntry(entry: UsagePricingEntry): Promise<void>
  deletePricingEntry(id: string): Promise<void>
  export(filter: UsageRecordFilter | undefined, format: 'csv' | 'json'): Promise<string>
  runRetention(now?: number): Promise<void>
  clear(): Promise<void>
}
