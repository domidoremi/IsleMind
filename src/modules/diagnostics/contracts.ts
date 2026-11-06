import type { ReportedProviderExecution, UsageExecutionReference } from '@/core'

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
  sourceUrl?: string
  verifiedAt?: string
  billingConditions?: string
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
  execution?: UsageExecutionReference
  reportedExecution?: ReportedProviderExecution
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
  conversationIds?: readonly string[]
  logicalRequestIds?: readonly string[]
  /** Latest recorded result of the complete logical call; historical attempts use their own result. */
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
  measurements?: UsageRollupMeasurements
}

export interface UsageRollupMeasurements {
  schema: 'islemind.usage-rollup-measurements.v1'
  /** Known portions only. Old rollups cannot recover which token fields were missing. */
  tokens: UsageTokenCounts
  tokenSampleCounts: UsageTokenCounts
  supplierCostNanodollars?: number
  estimatedCostNanodollars?: number
  unclassifiedCostNanodollars?: number
  supplierCostSampleCount: number
  estimatedCostSampleCount: number
  unclassifiedCostSampleCount: number
}

export interface UsageStatisticsSummary extends UsageTokenCounts {
  /** Compatibility field: network attempts, including archived rollups. */
  requestCount: number
  logicalRequestCount: number
  legacyAttemptCount: number
  costSampleCount: number
  unknownCostCount: number
  tokenSampleCount: number
  firstTokenSampleCount: number
  totalsOverflowed?: boolean
  costTotalOverflowed?: boolean
  archivedAttemptCount?: number
  supplierCostNanodollars?: number
  estimatedCostNanodollars?: number
  unclassifiedCostNanodollars?: number
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
  requestOutcomes?: UsageRequestOutcomes
  trends: readonly UsageTrendPoint[]
  providers: readonly UsageGroupSummary[]
  models: readonly UsageGroupSummary[]
  records: UsageRecordPage
  requests: UsageRequestPage
  conversations: readonly UsageConversationSummary[]
}

export interface UsageRequestOutcomes {
  requestCount: number
  successCount: number
  failedCount: number
  cancelledCount: number
  limitedCount: number
  partialCount: number
}

export type UsageDetailReference = Readonly<{ kind: 'request' | 'attempt' | 'response'; id: string }>

export interface UsageRequestSummary {
  reference: UsageDetailReference
  occurredAt: number
  completedAt: number
  conversationId?: string
  messageId?: string
  responseExecutionId?: string
  parentRequestId?: string
  originalProviderId: string
  originalModel: string
  providerId: string
  providerName: string
  requestedModel: string
  reportedExecution?: ReportedProviderExecution
  status: UsageRecordStatus
  operationSource: UsageOperationSource
  attemptCount: number
  retryCount: number
  failoverCount: number
  /** Whole logical request; absent for historical attempts. */
  durationMs?: number
  /** Logical request start to the first visible text observed by the application. */
  firstVisibleTextMs?: number
  summary: UsageStatisticsSummary
}

export interface UsageRequestPage {
  requests: readonly UsageRequestSummary[]
  total: number
  hasMore: boolean
}

export interface UsageConversationSummary extends UsageStatisticsSummary {
  conversationId: string
  lastOccurredAt: number
}

export interface UsageExecutionDetail {
  reference: UsageDetailReference
  requests: readonly UsageRequestSummary[]
  /** Redacted structured ledger, never raw transport data. */
  attempts: readonly UsageRecord[]
  summary: UsageStatisticsSummary
  truncated: boolean
}

export const USAGE_PRICING_CONFLICT = 'usage_pricing_conflict'

export interface UsageRecordRepository {
  append(record: UsageRecord): Promise<boolean>
  importOnce(markerId: string, records: readonly UsageRecord[]): Promise<boolean>
  list(request?: UsageRecordPageRequest): Promise<UsageRecordPage>
  listAll(filter?: UsageRecordFilter): Promise<readonly UsageRecord[]>
  listRollups(filter?: UsageRecordFilter): Promise<readonly UsageDailyRollup[]>
  findExecution(reference: UsageDetailReference): Promise<{ records: readonly UsageRecord[]; truncated: boolean }>
  /** Bounded diagnostic records for one exact run and connection; never a latest-record guess. */
  findRunAttempts(runId: string, providerId: string): Promise<{ records: readonly UsageRecord[]; truncated: boolean }>
  latestByProvider(providerIds: readonly string[]): Promise<readonly UsageRecord[]>
  latestByRequest(logicalRequestIds: readonly string[]): Promise<readonly UsageRecord[]>
  listPricingEntries(): Promise<readonly UsagePricingEntry[]>
  savePricingEntry(entry: UsagePricingEntry, expectedRevision?: string): Promise<void>
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
  record(record: UsageRecord, pricingPolicy?: { allowBuiltInPricing?: boolean }): Promise<boolean>
  snapshot(request?: UsageRecordPageRequest): Promise<UsageStatisticsSnapshot>
  detail(reference: UsageDetailReference): Promise<UsageExecutionDetail | undefined>
  runAttempts(runId: string, providerId: string): Promise<{ records: readonly UsageRecord[]; truncated: boolean }>
  recentProviders(providerIds: readonly string[]): Promise<readonly UsageRecord[]>
  listPricingEntries(): Promise<readonly UsagePricingEntry[]>
  savePricingEntry(entry: UsagePricingEntry, expectedRevision?: string): Promise<void>
  deletePricingEntry(id: string): Promise<void>
  export(filter: UsageRecordFilter | undefined, format: 'csv' | 'json'): Promise<string>
  runRetention(now?: number): Promise<void>
  clear(): Promise<void>
}
