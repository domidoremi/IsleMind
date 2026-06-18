import type { RemoteCompactMode } from '@/types'
import type { CompactUsageInput, CompactUsageRecord } from '@/services/ai/compact/compactUsage'
import type { CompactStateRecord } from '@/services/ai/compact/compactStateStore'
import { estimateRemoteCompactSavedTokens } from '@/services/ai/compact/remoteCompact'

export interface CompletedRemoteCompactInput {
  conversationId: string
  providerId: string
  model: string
  upstreamModel?: string
  mode: RemoteCompactMode
  responseId?: string
  inputTokens?: number
  outputTokens?: number
  messageCount: number
  previousResponseId?: string
}

export function buildCompletedRemoteCompactUsageInput(input: CompletedRemoteCompactInput): CompactUsageInput {
  return {
    mode: input.mode,
    providerId: input.providerId,
    model: input.model,
    upstreamModel: input.upstreamModel ?? input.model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    estimatedSavedTokens: estimateRemoteCompactSavedTokens(input.inputTokens, input.outputTokens),
  }
}

export function buildCompletedRemoteCompactRuntimeLogPayload(input: {
  conversationId: string
  record: CompactUsageRecord
  responseId?: string
  previousResponseId?: string
}): Record<string, unknown> {
  return {
    conversationId: input.conversationId,
    providerId: input.record.providerId,
    model: input.record.model,
    upstreamModel: input.record.upstreamModel,
    mode: input.record.mode,
    inputTokens: input.record.inputTokens,
    outputTokens: input.record.outputTokens,
    estimatedSavedTokens: input.record.estimatedSavedTokens,
    responseId: input.responseId,
    previousResponseId: input.previousResponseId,
    status: 'completed',
  }
}

export function buildCompletedRemoteCompactStateRecord(input: {
  conversationId: string
  record: CompactUsageRecord
  responseId?: string
  previousResponseId?: string
  messageCount: number
  now: number
}): CompactStateRecord | undefined {
  if (!input.responseId) return undefined
  return {
    id: `compact-state-${input.responseId}`,
    conversationId: input.conversationId,
    providerId: input.record.providerId,
    model: input.record.model,
    responseId: input.responseId,
    sessionId: input.conversationId,
    compactItemJson: JSON.stringify({
      type: 'responses_context_management',
      responseId: input.responseId,
      previousResponseId: input.previousResponseId,
      recordedAt: input.now,
    }),
    sourceMessageStartIndex: 0,
    sourceMessageEndIndex: Math.max(0, input.messageCount - 1),
    inputTokens: input.record.inputTokens,
    outputTokens: input.record.outputTokens,
    estimatedSavedTokens: input.record.estimatedSavedTokens,
    status: 'active',
    createdAt: input.now,
    updatedAt: input.now,
  }
}
