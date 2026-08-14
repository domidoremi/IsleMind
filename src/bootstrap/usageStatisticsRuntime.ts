import {
  DEFAULT_USAGE_PRICING_ENTRIES,
  USAGE_RECORD_SCHEMA,
  createSqliteUsageRecordRepository,
  createUsageStatisticsService,
  type UsageAttemptReason,
  type UsageOperationSource,
  type UsagePricingEntry,
  type UsageRecordFilter,
  type UsageRecordPageRequest,
  type UsageRecord,
  type UsageRecordStatus,
  type UsageStatisticsSnapshot,
} from '@/modules/diagnostics'
import { createExpoSqliteDatabaseProvider } from '@/platform/storage'
import type { MessageUsage } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import { conversationPersistence } from '@/bootstrap/conversationPersistence'

const usageRecordRepository = createSqliteUsageRecordRepository(createExpoSqliteDatabaseProvider())
export const usageStatisticsService = createUsageStatisticsService(usageRecordRepository, {
  builtInPricing: DEFAULT_USAGE_PRICING_ENTRIES,
})

let recordSequence = 0
let legacyImportPromise: Promise<void> | undefined
let lastRetentionAt = 0

export interface ProviderUsageAttemptInput {
  provider: Pick<AIProvider, 'id' | 'name'>
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
}

export async function recordProviderUsageAttempt(input: ProviderUsageAttemptInput): Promise<boolean> {
  const completedAt = input.completedAt ?? Date.now()
  const usage = input.usage
  try {
    return await usageStatisticsService.record({
      schema: USAGE_RECORD_SCHEMA,
      id: nextUsageRecordId(input.provider.id, input.startedAt),
      occurredAt: input.startedAt,
      completedAt,
      providerId: bounded(input.provider.id, 120),
      providerName: bounded(input.provider.name, 120),
      ...(input.credentialGroupId ? { credentialGroupId: bounded(input.credentialGroupId, 120) } : {}),
      requestedModel: bounded(input.requestedModel ?? input.upstreamModel, 240),
      upstreamModel: bounded(input.upstreamModel, 240),
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
    })
  } catch {
    return false
  }
}

export async function loadUsageStatistics(
  request: UsageRecordPageRequest = {},
): Promise<UsageStatisticsSnapshot> {
  await ensureLegacyUsageImported()
  await runUsageRetentionIfDue()
  return usageStatisticsService.snapshot(request)
}

export function exportUsageStatistics(filter: UsageRecordFilter | undefined, format: 'csv' | 'json'): Promise<string> {
  return usageStatisticsService.export(filter, format)
}

export function listUsagePricingEntries() {
  return usageStatisticsService.listPricingEntries()
}

export function saveUsagePricingEntry(entry: UsagePricingEntry): Promise<void> {
  return usageStatisticsService.savePricingEntry(entry)
}

export function deleteUsagePricingEntry(id: string): Promise<void> {
  return usageStatisticsService.deletePricingEntry(id)
}

export function clearUsageStatistics(): Promise<void> {
  legacyImportPromise = Promise.resolve()
  return usageStatisticsService.clear()
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
      if (message.role !== 'assistant' || (!message.usage && message.durationMs === undefined)) continue
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
        providerId: bounded(conversation.providerId, 120),
        providerName: bounded(conversation.providerId, 120),
        requestedModel: bounded(conversation.model, 240),
        upstreamModel: bounded(conversation.model, 240),
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
