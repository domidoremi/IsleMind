import type { RemoteCompactMode } from '@/types'
import type { CompactUsageInput, CompactUsageRecord } from '@/services/ai/compact/compactUsage'
import type { CompactStateRecord } from '@/services/ai/compact/compactStateStore'
import type { PreviousContextFragmentIdentity } from '@/services/contextPlanner'
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
  activeContextTokens?: number
  autoCompactScopeTokens?: number
  prefillInputTokens?: number
  tokensUntilCompaction?: number
  lastCompactSummary?: string
  contextFragmentIdentities?: PreviousContextFragmentIdentity[]
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
    ...compactWindowUsageFields(input),
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
    activeContextTokens: input.record.activeContextTokens,
    autoCompactScopeTokens: input.record.autoCompactScopeTokens,
    prefillInputTokens: input.record.prefillInputTokens,
    tokensUntilCompaction: input.record.tokensUntilCompaction,
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
  contextFragmentIdentities?: PreviousContextFragmentIdentity[]
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
    activeContextTokens: input.record.activeContextTokens,
    autoCompactScopeTokens: input.record.autoCompactScopeTokens,
    prefillInputTokens: input.record.prefillInputTokens,
    tokensUntilCompaction: input.record.tokensUntilCompaction,
    previousResponseId: input.previousResponseId,
    lastCompactSummary: input.record.lastCompactSummary,
    contextFragmentIdentitiesJson: serializeContextFragmentIdentities(input.contextFragmentIdentities),
    status: 'active',
    createdAt: input.now,
    updatedAt: input.now,
  }
}

export interface FailedRemoteCompactInput extends CompletedRemoteCompactInput {
  failureCode: string
  fallbackLocal?: boolean
}

export function buildFailedRemoteCompactUsageInput(input: FailedRemoteCompactInput): CompactUsageInput {
  return {
    mode: input.mode,
    providerId: input.providerId,
    model: input.model,
    upstreamModel: input.upstreamModel ?? input.model,
    inputTokens: input.inputTokens,
    failureCode: input.failureCode,
    fallbackLocal: input.fallbackLocal,
    ...compactWindowUsageFields(input),
  }
}

export function buildFailedRemoteCompactRuntimeLogPayload(input: {
  conversationId: string
  record: CompactUsageRecord
  previousResponseId?: string
}): Record<string, unknown> {
  return {
    conversationId: input.conversationId,
    providerId: input.record.providerId,
    model: input.record.model,
    upstreamModel: input.record.upstreamModel,
    mode: input.record.mode,
    inputTokens: input.record.inputTokens,
    failureCode: input.record.failureCode,
    fallbackLocal: input.record.fallbackLocal,
    activeContextTokens: input.record.activeContextTokens,
    autoCompactScopeTokens: input.record.autoCompactScopeTokens,
    prefillInputTokens: input.record.prefillInputTokens,
    tokensUntilCompaction: input.record.tokensUntilCompaction,
    previousResponseId: input.previousResponseId,
    status: 'failed',
  }
}

export function buildFailedRemoteCompactStateRecord(input: {
  conversationId: string
  record: CompactUsageRecord
  previousResponseId?: string
  messageCount: number
  now: number
  contextFragmentIdentities?: PreviousContextFragmentIdentity[]
}): CompactStateRecord {
  const failureCode = input.record.failureCode ?? 'remote_compact_failed'
  return {
    id: `compact-state-failed-${input.now}`,
    conversationId: input.conversationId,
    providerId: input.record.providerId,
    model: input.record.model,
    responseId: undefined,
    sessionId: input.conversationId,
    compactItemJson: JSON.stringify({
      type: 'responses_context_management',
      previousResponseId: input.previousResponseId,
      failureCode,
      fallbackLocal: input.record.fallbackLocal,
      recordedAt: input.now,
    }),
    sourceMessageStartIndex: 0,
    sourceMessageEndIndex: Math.max(0, input.messageCount - 1),
    inputTokens: input.record.inputTokens,
    outputTokens: input.record.outputTokens,
    estimatedSavedTokens: input.record.estimatedSavedTokens,
    activeContextTokens: input.record.activeContextTokens,
    autoCompactScopeTokens: input.record.autoCompactScopeTokens,
    prefillInputTokens: input.record.prefillInputTokens,
    tokensUntilCompaction: input.record.tokensUntilCompaction,
    previousResponseId: input.previousResponseId,
    lastCompactSummary: input.record.lastCompactSummary,
    compactFailureState: failureCode,
    contextFragmentIdentitiesJson: serializeContextFragmentIdentities(input.contextFragmentIdentities),
    status: 'failed',
    failureCode,
    createdAt: input.now,
    updatedAt: input.now,
  }
}

function serializeContextFragmentIdentities(identities: PreviousContextFragmentIdentity[] | undefined): string | undefined {
  if (!identities?.length) return undefined
  return JSON.stringify(identities.slice(0, 32).map((fragment) => ({
    id: fragment.id,
    sourceId: fragment.sourceId,
    sourceHash: fragment.sourceHash,
    included: fragment.included,
  })))
}

function compactWindowUsageFields(input: {
  activeContextTokens?: number
  autoCompactScopeTokens?: number
  prefillInputTokens?: number
  tokensUntilCompaction?: number
  lastCompactSummary?: string
}): Partial<CompactUsageInput> {
  return {
    ...(input.activeContextTokens !== undefined ? { activeContextTokens: input.activeContextTokens } : {}),
    ...(input.autoCompactScopeTokens !== undefined ? { autoCompactScopeTokens: input.autoCompactScopeTokens } : {}),
    ...(input.prefillInputTokens !== undefined ? { prefillInputTokens: input.prefillInputTokens } : {}),
    ...(input.tokensUntilCompaction !== undefined ? { tokensUntilCompaction: input.tokensUntilCompaction } : {}),
    ...(input.lastCompactSummary !== undefined ? { lastCompactSummary: input.lastCompactSummary } : {}),
  }
}
