import type { MessageUsage } from '@/types/chatContracts'
import type { RemoteCompactMode } from '@/types/settingsContracts'
import type {
  ProviderContextManagementCapabilityKind,
  ProviderLocalCompressionAdmissionReason,
  ProviderRemoteCompactClassification,
} from './providerContextManagementPolicy'

export type CompactUsageLocalCompressionStrategy =
  | 'none'
  | 'structured-v2'
  | 'single-message-truncation'
  | 'application-model-summary'
export type CompactUsageLocalCompressionTriggerReason =
  | 'message_budget_exceeded'
  | 'single_message_budget_exceeded'
  | 'disabled_or_unneeded'
export type CompactUsageSummarySectionId = 'constraints' | 'decisions' | 'failures' | 'actions' | 'references' | 'recent'

export interface CompactUsageRoleCounts {
  user: number
  assistant: number
}

export interface CompactUsageSectionMetadata {
  id: CompactUsageSummarySectionId
  title: string
  itemCount: number
}

export interface CompactUsageInput {
  mode: RemoteCompactMode
  providerId: string
  model: string
  upstreamModel?: string
  capabilityKind?: ProviderContextManagementCapabilityKind
  remoteClassification?: ProviderRemoteCompactClassification
  localFallbackAllowed?: boolean
  privacyAllowsLocalCompression?: boolean
  localFallbackReason?: ProviderLocalCompressionAdmissionReason
  decisionReason?:
    | 'disabled'
    | 'supported'
    | 'below_threshold'
    | 'provider_capability_missing'
    | 'application_model_summary'
    | 'native_openai_responses'
    | 'native_anthropic_messages'
  inputTokens?: number
  outputTokens?: number
  estimatedSavedTokens?: number
  localSourceTokens?: number
  localCompressedTokens?: number
  localEstimatedSavedTokens?: number
  localCompressionRatio?: number
  localCompressionSchemaVersion?: 2
  localCompressionStrategy?: CompactUsageLocalCompressionStrategy
  localCompressionTriggerReason?: CompactUsageLocalCompressionTriggerReason
  localSourceMessageCount?: number
  localKeptMessageCount?: number
  localSourceRoleCounts?: CompactUsageRoleCounts
  localKeptRoleCounts?: CompactUsageRoleCounts
  localSummaryTokenBudget?: number
  localSummaryTokens?: number
  localSummarySectionCount?: number
  localSummaryItemCount?: number
  localSummarySections?: CompactUsageSectionMetadata[]
  activeContextTokens?: number
  autoCompactScopeTokens?: number
  prefillInputTokens?: number
  tokensUntilCompaction?: number
  lastCompactSummary?: string
  failureCode?: string
  fallbackLocal?: boolean
}

export interface CompactUsageRecord extends CompactUsageInput {
  id: string
  createdAt: number
}

export interface ProviderCompactUsageStoreDependencies {
  now(): number
  random(): number
}

export interface ProviderCompactUsageStore {
  recordCompactUsage(input: CompactUsageInput): CompactUsageRecord
  listCompactUsageRecords(): CompactUsageRecord[]
  clearCompactUsageRecords(): void
}

export function createProviderCompactUsageStore(
  dependencies: Partial<ProviderCompactUsageStoreDependencies> = {},
): ProviderCompactUsageStore {
  const now = dependencies.now ?? Date.now
  const random = dependencies.random ?? Math.random
  const usageRecords: CompactUsageRecord[] = []

  function recordCompactUsage(input: CompactUsageInput): CompactUsageRecord {
    const record: CompactUsageRecord = {
      id: `compact-usage-${now()}-${random().toString(36).slice(2, 8)}`,
      createdAt: now(),
      ...input,
      ...(input.lastCompactSummary !== undefined
        ? { lastCompactSummary: sanitizeCompactUsageSummary(input.lastCompactSummary) }
        : {}),
    }
    usageRecords.push(record)
    return record
  }

  function listCompactUsageRecords(): CompactUsageRecord[] {
    return [...usageRecords]
  }

  function clearCompactUsageRecords(): void {
    usageRecords.splice(0, usageRecords.length)
  }

  return {
    recordCompactUsage,
    listCompactUsageRecords,
    clearCompactUsageRecords,
  }
}

const MAX_COMPACT_USAGE_SUMMARY_CHARS = 240

export function sanitizeCompactUsageSummary(value: string): string {
  const redacted = String(value ?? '')
    .trim()
    .replace(/\b(?:sk|rk|pk|api)[-_][a-z0-9_-]{12,}\b/gi, '[redacted]')
    .replace(/\b((?:bearer|basic))\s+[a-z0-9._~+/=-]{12,}\b/gi, '$1 [redacted]')
    .replace(/\b((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password))\s*[:=]\s*\S+/gi, '$1=[redacted]')
  if (redacted.length <= MAX_COMPACT_USAGE_SUMMARY_CHARS) return redacted
  return `${redacted.slice(0, MAX_COMPACT_USAGE_SUMMARY_CHARS - 1)}…`
}

export function compactUsageToMessageUsage(record: CompactUsageRecord): MessageUsage | undefined {
  if (!record.inputTokens && !record.outputTokens) return undefined
  const inputTokens = record.inputTokens ?? 0
  const outputTokens = record.outputTokens ?? 0
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    source: 'provider',
  }
}
