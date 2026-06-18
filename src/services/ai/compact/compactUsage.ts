import type { MessageUsage, RemoteCompactMode } from '@/types'
import type { LocalCompressionStrategy, PackedCompressionRoleCounts, PackedCompressionSectionMetadata, PackedCompressionMetadata } from '@/services/contextPacker'

export interface CompactUsageInput {
  mode: RemoteCompactMode
  providerId: string
  model: string
  upstreamModel?: string
  decisionReason?: 'disabled' | 'supported' | 'below_threshold' | 'provider_capability_missing'
  inputTokens?: number
  outputTokens?: number
  estimatedSavedTokens?: number
  localSourceTokens?: number
  localCompressedTokens?: number
  localEstimatedSavedTokens?: number
  localCompressionRatio?: number
  localCompressionSchemaVersion?: PackedCompressionMetadata['schemaVersion']
  localCompressionStrategy?: LocalCompressionStrategy
  localCompressionTriggerReason?: PackedCompressionMetadata['triggerReason']
  localSourceMessageCount?: number
  localKeptMessageCount?: number
  localSourceRoleCounts?: PackedCompressionRoleCounts
  localKeptRoleCounts?: PackedCompressionRoleCounts
  localSummaryTokenBudget?: number
  localSummaryTokens?: number
  localSummarySectionCount?: number
  localSummaryItemCount?: number
  localSummarySections?: PackedCompressionSectionMetadata[]
  failureCode?: string
  fallbackLocal?: boolean
}

export interface CompactUsageRecord extends CompactUsageInput {
  id: string
  createdAt: number
}

const usageRecords: CompactUsageRecord[] = []

export function recordCompactUsage(input: CompactUsageInput): CompactUsageRecord {
  const record: CompactUsageRecord = {
    id: `compact-usage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    ...input,
  }
  usageRecords.push(record)
  return record
}

export function listCompactUsageRecords(): CompactUsageRecord[] {
  return [...usageRecords]
}

export function clearCompactUsageRecords(): void {
  usageRecords.splice(0, usageRecords.length)
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
