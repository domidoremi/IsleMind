import {
  DEFAULT_USAGE_PRICING_ENTRIES,
  USAGE_RECORD_SCHEMA,
  createSqliteUsagePortableSnapshotRepository,
  createSqliteUsageRecordRepository,
  createUsageStatisticsService,
  isBuiltInUsagePricingEndpoint,
  resolveUsageRouteAttribution,
  type UsageAttemptReason,
  type UsageOperationSource,
  type UsagePricingEntry,
  type UsageRecordFilter,
  type UsageRecordPageRequest,
  type UsageRecord,
  type UsageRecordStatus,
  type UsageStatisticsSnapshot,
  type UsageDetailReference,
} from '@/modules/diagnostics'
import type { ReportedProviderExecution, UsageExecutionReference } from '@/core'
import { createExpoSqliteDatabaseProvider } from '@/platform/storage'
import type { MessageUsage } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import { getProviderEffectiveBaseUrl } from '@/types/providerBaseUrls'
import { conversationPersistence } from '@/bootstrap/conversationPersistence'
import { responseUsageReceipts } from './responseUsageReceipts'

const usageRecordRepository = createSqliteUsageRecordRepository(createExpoSqliteDatabaseProvider())
export const usagePortableSnapshotRepository = createSqliteUsagePortableSnapshotRepository(
  createExpoSqliteDatabaseProvider(),
)
export const usageStatisticsService = createUsageStatisticsService(usageRecordRepository, {
  builtInPricing: DEFAULT_USAGE_PRICING_ENTRIES,
  recorded: responseUsageReceipts.record,
})

let recordSequence = 0
let legacyImportPromise: Promise<void> | undefined
let lastRetentionAt = 0
const pendingUsageWrites = new Set<Promise<boolean>>()

export interface ProviderUsageAttemptInput {
  provider: Pick<AIProvider, 'id' | 'name' | 'type' | 'baseUrl' | 'credentialMode' | 'tokenPlanRegion' | 'wireProtocol'>
  credentialGroupId?: string
  requestedModel?: string
  upstreamModel: string
  pricingModel?: string
  operationSource: UsageOperationSource
  status: UsageRecordStatus
  statusCode?: number
  errorCode?: string
  isStreaming?: boolean
  startedAt: number
  completedAt?: number
  firstTokenAt?: number
  attempt: number
  attemptReason: UsageAttemptReason
  correlationId?: string
  conversationId?: string
  runId?: string
  usage?: MessageUsage
  /** Original route before a retry/fallback; omitted for the ordinary path. */
  originalProviderId?: string
  originalModel?: string
  retryCount?: number
  failoverCount?: number
  attemptIdentity?: string
  execution?: UsageExecutionReference
  reportedExecution?: ReportedProviderExecution
}

export function recordProviderUsageAttempt(input: ProviderUsageAttemptInput): Promise<boolean> {
  const write = persistProviderUsageAttempt(input)
  pendingUsageWrites.add(write)
  void write.finally(() => pendingUsageWrites.delete(write))
  return write
}

async function persistProviderUsageAttempt(input: ProviderUsageAttemptInput): Promise<boolean> {
  const completedAt = input.completedAt ?? Date.now()
  const usage = input.usage
  try {
    const recordId = nextUsageRecordId(input.provider.id, input.startedAt)
    const providerId = bounded(input.provider.id, 120) || 'unknown-provider'
    const upstreamModel = bounded(input.upstreamModel, 240) || 'unknown-model'
    const plan = input.execution?.routingPlan
    const usedBackup = plan && (plan.primaryProviderId !== providerId || plan.primaryModel !== (input.requestedModel ?? upstreamModel))
    const attribution = resolveUsageRouteAttribution({
      actualProviderId: providerId,
      actualModel: upstreamModel,
      originalProviderId: plan?.primaryProviderId ?? input.originalProviderId,
      originalModel: plan?.primaryModel ?? input.originalModel,
      attempt: input.attempt,
      attemptReason: input.attemptReason,
      retryCount: input.retryCount,
      failoverCount: input.failoverCount ?? (usedBackup ? 1 : undefined),
      attemptIdentity: input.attemptIdentity ?? recordId,
    })
    return await usageStatisticsService.record({
      schema: USAGE_RECORD_SCHEMA,
      id: recordId,
      occurredAt: input.startedAt,
      completedAt,
      providerId,
      providerType: bounded(input.provider.type, 64),
      providerName: bounded(input.provider.name, 120),
      ...(input.credentialGroupId ? { credentialGroupId: bounded(input.credentialGroupId, 120) } : {}),
      requestedModel: bounded(input.requestedModel ?? upstreamModel, 240) || upstreamModel,
      upstreamModel,
      originalProviderId: attribution.originalProviderId,
      originalModel: attribution.originalModel,
      actualProviderId: attribution.actualProviderId,
      actualModel: attribution.actualModel,
      retryCount: attribution.retryCount,
      failoverCount: attribution.failoverCount,
      attemptIdentity: attribution.attemptIdentity,
      ...(input.execution ? { execution: input.execution } : {}),
      ...(input.reportedExecution ? { reportedExecution: input.reportedExecution } : {}),
      ...(input.pricingModel ? { pricingModel: bounded(input.pricingModel, 240) } : {}),
      operationSource: input.operationSource,
      dataSource: usage?.source === 'estimated' ? 'estimated' : 'live-provider',
      measurementSource: usage?.source ?? 'unavailable',
      status: input.status,
      ...(input.statusCode === undefined ? {} : { statusCode: input.statusCode }),
      ...(input.errorCode ? { errorCode: sanitizeErrorCode(input.errorCode) } : {}),
      ...(input.isStreaming === undefined ? {} : { isStreaming: input.isStreaming }),
      durationMs: Math.max(0, completedAt - input.startedAt),
      ...(input.firstTokenAt === undefined ? {} : { firstTokenMs: Math.max(0, input.firstTokenAt - input.startedAt) }),
      attempt: Math.max(0, Math.floor(input.attempt)),
      attemptReason: input.attemptReason,
      ...(input.correlationId ? { correlationId: bounded(input.correlationId, 160) } : {}),
      ...(input.conversationId ? { conversationId: bounded(input.conversationId, 160) } : {}),
      ...(input.runId ? { runId: bounded(input.runId, 160) } : {}),
      tokens: usage ? {
        ...(finiteCount(usage.inputTokens) === undefined ? {} : { inputTokens: finiteCount(usage.inputTokens) }),
        ...(finiteCount(usage.outputTokens) === undefined ? {} : { outputTokens: finiteCount(usage.outputTokens) }),
        ...(finiteCount(usage.totalTokens) === undefined ? {} : { totalTokens: finiteCount(usage.totalTokens) }),
        ...(finiteCount(usage.cacheCreationInputTokens) === undefined ? {} : { cacheCreationInputTokens: finiteCount(usage.cacheCreationInputTokens) }),
        ...(finiteCount(usage.cacheReadInputTokens) === undefined ? {} : { cacheReadInputTokens: finiteCount(usage.cacheReadInputTokens) }),
        ...(finiteCount(usage.cachedInputTokens) === undefined ? {} : { cachedInputTokens: finiteCount(usage.cachedInputTokens) }),
        ...(finiteCount(usage.reasoningTokens) === undefined ? {} : { reasoningTokens: finiteCount(usage.reasoningTokens) }),
      } : {},
      costProvenance: 'unavailable',
    }, {
      allowBuiltInPricing: isBuiltInUsagePricingEndpoint(input.provider.type, getProviderEffectiveBaseUrl(input.provider)),
    })
  } catch {
    return false
  }
}

export async function loadUsageStatistics(
  request: UsageRecordPageRequest = {},
): Promise<UsageStatisticsSnapshot> {
  await ensureLegacyUsageImported()
  await Promise.allSettled([...pendingUsageWrites])
  await runUsageRetentionIfDue()
  return usageStatisticsService.snapshot(request)
}

export async function loadUsageExecutionDetail(reference: UsageDetailReference) {
  await ensureLegacyUsageImported()
  await Promise.allSettled([...pendingUsageWrites])
  return usageStatisticsService.detail(reference)
}

export async function loadAssistantRunUsageAttempts(runId: string, providerId: string) {
  await Promise.allSettled([...pendingUsageWrites])
  return usageStatisticsService.runAttempts(runId, providerId)
}

export async function loadRecentProviderUsage(providerIds: readonly string[]): Promise<readonly UsageRecord[]> {
  await Promise.allSettled([...pendingUsageWrites])
  const records: UsageRecord[] = []
  for (let offset = 0; offset < providerIds.length; offset += 100) {
    records.push(...await usageStatisticsService.recentProviders(providerIds.slice(offset, offset + 100)))
  }
  return records
}

export function exportUsageStatistics(filter: UsageRecordFilter | undefined, format: 'csv' | 'json'): Promise<string> {
  return usageStatisticsService.export(filter, format)
}

export function listUsagePricingEntries() {
  return usageStatisticsService.listPricingEntries()
}

export function saveUsagePricingEntry(entry: UsagePricingEntry, expectedRevision?: string): Promise<void> {
  return usageStatisticsService.savePricingEntry(entry, expectedRevision)
}

export function deleteUsagePricingEntry(id: string): Promise<void> {
  return usageStatisticsService.deletePricingEntry(id)
}

export async function clearUsageStatistics(): Promise<void> {
  legacyImportPromise = Promise.resolve()
  await Promise.allSettled([...pendingUsageWrites])
  await usageStatisticsService.clear()
  responseUsageReceipts.clear()
}

async function ensureLegacyUsageImported(): Promise<void> {
  legacyImportPromise ??= importLegacyUsage().catch(() => undefined)
  return legacyImportPromise
}

async function importLegacyUsage(): Promise<void> {
  const conversations = await conversationPersistence.loadAll()
  const records: UsageRecord[] = []
  for (const conversation of conversations) {
    for (const message of conversation.messages ?? []) {
      if (message.role !== 'assistant' || message.usageExecution || (!message.usage && message.durationMs === undefined)) continue
      const completedAt = message.completedAt ?? message.timestamp
      const startedAt = message.startedAt ?? Math.max(message.timestamp, completedAt - (message.durationMs ?? 0))
      const status: UsageRecordStatus = message.status === 'done'
        ? 'success'
        : message.status === 'cancelled'
          ? 'cancelled'
            : message.status === 'error'
              ? 'failed'
              : 'partial'
      const legacyTokens = message.usage ? {
        ...(finiteCount(message.usage.inputTokens) === undefined ? {} : { inputTokens: finiteCount(message.usage.inputTokens) }),
        ...(finiteCount(message.usage.outputTokens) === undefined ? {} : { outputTokens: finiteCount(message.usage.outputTokens) }),
        ...(finiteCount(message.usage.totalTokens) === undefined ? {} : { totalTokens: finiteCount(message.usage.totalTokens) }),
        ...(finiteCount(message.usage.cacheCreationInputTokens) === undefined ? {} : { cacheCreationInputTokens: finiteCount(message.usage.cacheCreationInputTokens) }),
        ...(finiteCount(message.usage.cacheReadInputTokens) === undefined ? {} : { cacheReadInputTokens: finiteCount(message.usage.cacheReadInputTokens) }),
        ...(finiteCount(message.usage.cachedInputTokens) === undefined ? {} : { cachedInputTokens: finiteCount(message.usage.cachedInputTokens) }),
        ...(finiteCount(message.usage.reasoningTokens) === undefined ? {} : { reasoningTokens: finiteCount(message.usage.reasoningTokens) }),
      } : {}
      records.push({
        schema: USAGE_RECORD_SCHEMA,
        id: `legacy-message:${bounded(conversation.id, 160)}:${bounded(message.id, 160)}`,
        occurredAt: startedAt,
        completedAt,
        providerId: bounded(message.providerId ?? 'unknown', 120),
        providerName: bounded(message.providerId ?? 'unknown', 120),
        requestedModel: bounded(message.model ?? 'unknown', 240),
        upstreamModel: bounded(message.model ?? 'unknown', 240),
        operationSource: 'chat' as const,
        dataSource: 'legacy-message',
        measurementSource: message.usage?.source ?? 'unavailable',
        status,
        ...(message.errorCode ? { errorCode: sanitizeErrorCode(message.errorCode) } : {}),
        durationMs: Math.max(0, completedAt - startedAt),
        attempt: 0,
        attemptReason: 'initial',
        conversationId: bounded(conversation.id, 160),
        tokens: legacyTokens,
        costProvenance: 'unavailable',
      })
    }
  }
  await usageRecordRepository.importOnce('legacy-conversation-messages:v1', records)
}

async function runUsageRetentionIfDue(now = Date.now()): Promise<void> {
  if (now - lastRetentionAt < 24 * 60 * 60 * 1000) return
  await usageStatisticsService.runRetention(now)
  lastRetentionAt = now
}

function nextUsageRecordId(providerId: string, startedAt: number): string {
  recordSequence = (recordSequence + 1) % Number.MAX_SAFE_INTEGER
  return `provider-call:${bounded(providerId, 80)}:${startedAt}:${recordSequence}`
}

function finiteCount(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined
}

function bounded(value: string, limit: number): string {
  return value.trim().slice(0, limit)
}

function sanitizeErrorCode(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/gu, '_').slice(0, 80) || 'unknown'
}
