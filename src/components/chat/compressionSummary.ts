import type { TFunction } from 'i18next'

import type { PackedCompressionMetadata } from '@/modules/assistant-runtime'
import type { Conversation } from '@/types/chatContracts'

import { collectMessageTraces } from './tracePresentation'

export interface CompressionSummary {
  titleKey: string
  messageKey: string
  messageParams?: Record<string, string | number | undefined>
  mode: 'local' | 'remote' | 'application'
  ratio: number
  savedTokens: number
  metadata: PackedCompressionMetadata | null
  reasonKey?: string
}

export function findLatestCompressionSummary(messages: Conversation['messages']): CompressionSummary | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    const summary = findCompressionSummaryFromMessage(message)
    if (summary) return summary
  }
  return null
}

export function renderCompressionMessage(summary: CompressionSummary, t: TFunction): string {
  const params = summary.messageParams
  if (!params) return ''
  const resolved = Object.fromEntries(Object.entries(params).map(([key, value]) => {
    if (typeof value === 'string' && value.startsWith('chat.')) return [key, t(value)]
    return [key, value]
  }))
  return t(summary.messageKey, resolved)
}

function findCompressionSummaryFromMessage(message: Conversation['messages'][number]): CompressionSummary | null {
  const traces = collectMessageTraces(message).filter((trace) => trace.type === 'system' && trace.metadata)
  const compressionTrace = traces.find((trace) => trace.metadata?.compressionTriggered === true)
  const compactTrace = traces.find((trace) => typeof trace.metadata?.compactMode === 'string' && trace.metadata.compactMode !== 'off')
  const metadata = (compressionTrace?.metadata ?? compactTrace?.metadata) as Record<string, unknown> | undefined
  if (!metadata) return null
  const remote = metadata.compactMode === 'remote'
  const application =
    metadata.compactMode === 'application'
    || metadata.applicationSummaryApplied === true
    || metadata.strategy === 'application-model-summary'
    || metadata.compressionStrategy === 'application-model-summary'
  const applicationFallback = metadata.applicationSummaryFailed === true || Boolean(metadata.applicationSummaryFailure)
  const ratio = finiteNumber(metadata.compressionRatio) ?? finiteNumber(metadata.remoteCompactRatio) ?? finiteNumber(metadata.pressureRatio) ?? 0
  const savedTokens = finiteNumber(metadata.compressionEstimatedSavedTokens) ?? finiteNumber(metadata.localEstimatedSavedTokens) ?? finiteNumber(metadata.estimatedSavedTokens) ?? finiteNumber(metadata.compressionSourceTokens) ?? 0
  const sourceCount = finiteNumber(metadata.summarySourceMessageCount) ?? finiteNumber(metadata.localSourceMessageCount) ?? finiteNumber(metadata.olderMessageCount) ?? 0
  const keptCount = finiteNumber(metadata.summaryKeptMessageCount) ?? finiteNumber(metadata.localKeptMessageCount) ?? finiteNumber(metadata.recentMessageCount) ?? 0
  const strategy = normalizeCompressionStrategy(metadata.compressionStrategy ?? metadata.localCompressionStrategy ?? metadata.strategy)
  const reasonKey = compressionReasonKey(metadata.reason, { application, applicationFallback })
  const titleKey = remote
    ? 'chat.compressionBannerRemoteTitle'
    : application && !applicationFallback
      ? 'chat.compressionBannerApplicationTitle'
      : strategy === 'single-message-truncation'
        ? 'chat.compressionBannerSingleTitle'
        : 'chat.compressionBannerLocalTitle'
  const messageKey = remote
    ? 'chat.compressionBannerRemoteMessage'
    : application && !applicationFallback
      ? 'chat.compressionBannerApplicationMessage'
      : strategy === 'single-message-truncation'
        ? 'chat.compressionBannerSingleMessage'
        : 'chat.compressionBannerLocalMessage'
  let messageParams: Record<string, string | number>
  if (remote) {
    messageParams = {
      mode: stringValue(metadata.remoteCompactMode) === 'required' ? 'chat.compressionModeRequired' : 'chat.compressionModeAuto',
      ratio: Math.max(0, Math.round(ratio * 100)),
      reason: reasonKey ?? 'chat.compressionReasonRemote',
    }
  } else if (strategy === 'single-message-truncation') {
    messageParams = {
      ratio: Math.max(0, Math.round(ratio * 100)),
      reason: reasonKey ?? 'chat.compressionReasonSingleMessage',
    }
  } else {
    messageParams = {
      kept: keptCount,
      total: Math.max(keptCount + sourceCount, 1),
      reason: reasonKey
        ?? (application && !applicationFallback
          ? 'chat.compressionReasonApplicationSummary'
          : applicationFallback
            ? 'chat.compressionReasonApplicationSummaryFallback'
            : 'chat.compressionReasonLocalSummary'),
    }
  }
  return {
    titleKey,
    messageKey,
    messageParams,
    mode: remote ? 'remote' : application && !applicationFallback ? 'application' : 'local',
    ratio,
    savedTokens,
    reasonKey,
    metadata: {
      schemaVersion: 2,
      strategy,
      triggerReason: normalizeCompressionTriggerReason(metadata.compressionTriggerReason ?? metadata.localCompressionTriggerReason),
      sourceMessageCount: sourceCount,
      keptMessageCount: keptCount,
      sourceRoleCounts: normalizeCompressionRoleCounts(metadata.summarySourceRoleCounts ?? metadata.localSourceRoleCounts),
      keptRoleCounts: normalizeCompressionRoleCounts(metadata.summaryKeptRoleCounts ?? metadata.localKeptRoleCounts),
      sourceTokens: finiteNumber(metadata.compressionSourceTokens) ?? finiteNumber(metadata.localSourceTokens) ?? 0,
      compressedTokens: finiteNumber(metadata.compressionCompressedTokens) ?? finiteNumber(metadata.localCompressedTokens) ?? 0,
      estimatedSavedTokens: savedTokens,
      compressionRatio: ratio,
      summaryTokenBudget: finiteNumber(metadata.summaryTokenBudget) ?? finiteNumber(metadata.localSummaryTokenBudget) ?? 0,
      summaryTokens: finiteNumber(metadata.summaryTokens) ?? finiteNumber(metadata.localSummaryTokens) ?? 0,
      summarySectionCount: finiteNumber(metadata.summarySectionCount) ?? finiteNumber(metadata.localSummarySectionCount) ?? 0,
      summaryItemCount: finiteNumber(metadata.summaryItemCount) ?? finiteNumber(metadata.localSummaryItemCount) ?? 0,
      summarySections: Array.isArray(metadata.summarySections) ? metadata.summarySections as PackedCompressionMetadata['summarySections'] : [],
    },
  }
}

function compressionReasonKey(
  value: unknown,
  flags?: { application?: boolean; applicationFallback?: boolean },
): string | undefined {
  switch (value) {
    case 'below_threshold':
      return 'chat.compressionReasonBelowThreshold'
    case 'provider_capability_missing':
      return 'chat.compressionReasonProviderCapabilityMissing'
    case 'disabled':
      return 'chat.compressionReasonDisabled'
    case 'supported':
    case 'native_openai_responses':
    case 'native_anthropic_messages':
      return 'chat.compressionReasonRemote'
    case 'application_model_summary':
      return flags?.applicationFallback
        ? 'chat.compressionReasonApplicationSummaryFallback'
        : 'chat.compressionReasonApplicationSummary'
    default:
      if (flags?.applicationFallback) return 'chat.compressionReasonApplicationSummaryFallback'
      if (flags?.application) return 'chat.compressionReasonApplicationSummary'
      return undefined
  }
}

function normalizeCompressionRoleCounts(value: unknown): PackedCompressionMetadata['sourceRoleCounts'] {
  const counts = value as Partial<PackedCompressionMetadata['sourceRoleCounts']> | undefined
  return {
    user: finiteNumber(counts?.user) ?? 0,
    assistant: finiteNumber(counts?.assistant) ?? 0,
  }
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function normalizeCompressionTriggerReason(value: unknown): PackedCompressionMetadata['triggerReason'] {
  if (value === 'single_message_budget_exceeded') return 'single_message_budget_exceeded'
  if (value === 'disabled_or_unneeded') return 'disabled_or_unneeded'
  return 'message_budget_exceeded'
}

function normalizeCompressionStrategy(value: unknown): PackedCompressionMetadata['strategy'] {
  if (value === 'none') return 'none'
  if (value === 'single-message-truncation') return 'single-message-truncation'
  if (value === 'application-model-summary') return 'application-model-summary'
  return 'structured-v2'
}
