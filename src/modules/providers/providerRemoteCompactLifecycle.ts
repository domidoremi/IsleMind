import type { CompactStateRecord } from './providerCompactStateRepository'
import {
  sanitizeCompactUsageSummary,
  type CompactUsageInput,
  type CompactUsageRecord,
} from './providerCompactUsageStore'
import {
  admitProviderLocalCompression,
  type ProviderContextManagementCapabilityKind,
  type ProviderContextManagementStrategy,
  type ProviderLocalCompressionAdmissionReason,
  type ProviderLocalCompressionPrivacySettings,
  type ProviderRemoteCompactClassification,
} from './providerContextManagementPolicy'
import { estimateRemoteCompactSavedTokens } from './providerRemoteCompactPolicy'

export type ProviderRemoteCompactMode = 'off' | 'auto' | 'required'

export interface ProviderRemoteCompactSettings extends ProviderLocalCompressionPrivacySettings {
  readonly remoteCompactMode?: ProviderRemoteCompactMode
  readonly runtimeLogEnabled?: boolean
  readonly runtimeLogMaxBytes?: number
}

export interface ProviderRemoteCompactFragment {
  readonly id: unknown
  readonly sourceId: unknown
  readonly sourceHash?: unknown
  readonly included?: unknown
}

export interface ProviderRemoteCompactFragmentIdentity {
  readonly id: string
  readonly sourceId: string
  readonly sourceHash?: string
  readonly included?: boolean
}

export interface ProviderRemoteCompactWindowState {
  readonly activeContextTokens?: number
  readonly autoCompactScopeTokens?: number
  readonly prefillInputTokens?: number
  readonly tokensUntilCompaction?: number
  readonly lastCompactSummary?: string
}

export interface ProviderRemoteCompactStoredState {
  readonly id: string
  readonly conversationId?: string
  readonly providerId?: string
  readonly model?: string
  readonly responseId?: string
  readonly compactItemJson?: string
  readonly contextFragmentIdentitiesJson?: string
  readonly status?: string
}

export interface ProviderRemoteCompactRuntimeEventInput {
  readonly event: 'context.compact.decided' | 'context.compact.completed'
  readonly conversationId: string
  readonly providerId: string
  readonly model: string
  readonly data: Record<string, unknown>
  readonly legacyEvent: 'compact.request' | 'compact.usage'
  readonly legacyData: Record<string, unknown>
  readonly options: {
    readonly enabled?: boolean
    readonly maxBytes?: number
  }
}

export interface ProviderRemoteCompactLifecycleDependencies {
  recordCompactUsage(input: CompactUsageInput): CompactUsageRecord
  listActiveCompactStates(
    conversationId: string,
    providerId: string,
    model: string,
  ): Promise<readonly ProviderRemoteCompactStoredState[]>
  saveCompactState(record: CompactStateRecord): Promise<void>
  emitRuntimeEvent(input: ProviderRemoteCompactRuntimeEventInput): Promise<unknown>
  now(): number
}

export interface ResolveProviderRemoteCompactPreviousStateInput {
  readonly conversationId: string
  readonly providerId: string
  readonly model: string
  readonly settings: ProviderRemoteCompactSettings
  readonly signal?: AbortSignal
  readonly strategy: ProviderContextManagementStrategy
  readonly capabilityKind: ProviderContextManagementCapabilityKind
  readonly remoteClassification: ProviderRemoteCompactClassification
}

export interface ProviderRemoteCompactPreviousState {
  readonly previousResponseId?: string
  readonly previousFragments?: ProviderRemoteCompactFragmentIdentity[]
}

interface ProviderRemoteCompactRecordBaseInput {
  readonly conversationId: string
  readonly providerId: string
  readonly model: string
  readonly upstreamModel?: string
  readonly mode: ProviderRemoteCompactMode
  readonly inputTokens?: number
  readonly messageCount: number
  readonly settings: ProviderRemoteCompactSettings
  readonly previousResponseId?: string
  readonly contextWindowState?: ProviderRemoteCompactWindowState
  readonly contextFragments?: readonly ProviderRemoteCompactFragment[]
  readonly signal?: AbortSignal
  readonly strategy: ProviderContextManagementStrategy
  readonly capabilityKind: ProviderContextManagementCapabilityKind
  readonly remoteClassification: ProviderRemoteCompactClassification
  readonly localFallbackAllowed?: boolean
  readonly localFallbackReason?: ProviderLocalCompressionAdmissionReason
}

export interface RecordCompletedProviderRemoteCompactInput extends ProviderRemoteCompactRecordBaseInput {
  readonly responseId?: string
  readonly outputTokens?: number
}

export interface RecordFailedProviderRemoteCompactInput extends ProviderRemoteCompactRecordBaseInput {
  readonly failureCode: string
  readonly fallbackLocal?: boolean
}

export function createProviderRemoteCompactLifecycle(
  dependencies: ProviderRemoteCompactLifecycleDependencies,
) {
  async function resolvePreviousState(
    input: ResolveProviderRemoteCompactPreviousStateInput,
  ): Promise<ProviderRemoteCompactPreviousState> {
    if ((input.settings.remoteCompactMode ?? 'auto') === 'off' || input.signal?.aborted) return {}
    if (!allowsPreviousStateReuse(input)) return {}

    try {
      const states = await dependencies.listActiveCompactStates(
        input.conversationId,
        input.providerId,
        input.model,
      )
      if (input.signal?.aborted) return {}
      const state = states.find((candidate) => compactStateMatchesInput(candidate, input))
      if (!state?.responseId) return {}

      const previousFragments = parseFragmentIdentities(state.contextFragmentIdentitiesJson)
      const data = {
        conversationId: input.conversationId,
        providerId: input.providerId,
        model: input.model,
        previousResponseId: state.responseId,
        compactStateId: state.id,
        previousFragmentCount: previousFragments?.length ?? 0,
        status: 'state_reused',
      }
      void dependencies.emitRuntimeEvent({
        event: 'context.compact.decided',
        conversationId: input.conversationId,
        providerId: input.providerId,
        model: input.model,
        data,
        legacyEvent: 'compact.request',
        legacyData: data,
        options: runtimeLogOptions(input.settings),
      }).catch(() => undefined)
      return { previousResponseId: state.responseId, previousFragments }
    } catch {
      return {}
    }
  }

  function recordCompleted(input: RecordCompletedProviderRemoteCompactInput): void {
    if (input.signal?.aborted) return
    const record = dependencies.recordCompactUsage(buildCompletedUsageInput(input))
    const data = buildCompletedLogPayload(input, record)
    void dependencies.emitRuntimeEvent({
      event: 'context.compact.completed',
      conversationId: input.conversationId,
      providerId: input.providerId,
      model: input.model,
      data,
      legacyEvent: 'compact.usage',
      legacyData: data,
      options: runtimeLogOptions(input.settings),
    }).catch(() => undefined)

    if (input.signal?.aborted) return
    const state = buildCompletedState(input, record, dependencies.now())
    if (state) void dependencies.saveCompactState(state).catch(() => undefined)
  }

  function recordFailed(input: RecordFailedProviderRemoteCompactInput): void {
    if (input.signal?.aborted) return
    const record = dependencies.recordCompactUsage(buildFailedUsageInput(input))
    const data = buildFailedLogPayload(input, record)
    void dependencies.emitRuntimeEvent({
      event: 'context.compact.completed',
      conversationId: input.conversationId,
      providerId: input.providerId,
      model: input.model,
      data,
      legacyEvent: 'compact.usage',
      legacyData: data,
      options: runtimeLogOptions(input.settings),
    }).catch(() => undefined)

    if (input.signal?.aborted) return
    const state = buildFailedState(input, record, dependencies.now())
    void dependencies.saveCompactState(state).catch(() => undefined)
  }

  return { resolvePreviousState, recordCompleted, recordFailed }
}

function buildCompletedUsageInput(
  input: RecordCompletedProviderRemoteCompactInput,
): CompactUsageInput {
  const metadata = resolveCompletedLifecycleMetadata(input)
  return {
    mode: input.mode,
    providerId: input.providerId,
    model: input.model,
    upstreamModel: input.upstreamModel ?? input.model,
    capabilityKind: metadata.capabilityKind,
    remoteClassification: metadata.remoteClassification,
    localFallbackAllowed: metadata.localFallbackAllowed,
    privacyAllowsLocalCompression: metadata.privacyAllowsLocalCompression,
    localFallbackReason: metadata.localFallbackReason,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    estimatedSavedTokens: estimateRemoteCompactSavedTokens(input.inputTokens, input.outputTokens),
    ...compactWindowUsageFields(input.contextWindowState),
  }
}

function buildFailedUsageInput(
  input: RecordFailedProviderRemoteCompactInput,
): CompactUsageInput {
  const metadata = resolveFailedLifecycleMetadata(input)
  return {
    mode: input.mode,
    providerId: input.providerId,
    model: input.model,
    upstreamModel: input.upstreamModel ?? input.model,
    capabilityKind: metadata.capabilityKind,
    remoteClassification: metadata.remoteClassification,
    localFallbackAllowed: metadata.localFallbackAllowed,
    privacyAllowsLocalCompression: metadata.privacyAllowsLocalCompression,
    localFallbackReason: metadata.localFallbackReason,
    inputTokens: input.inputTokens,
    failureCode: input.failureCode,
    fallbackLocal: input.fallbackLocal === true && metadata.localFallbackAllowed,
    ...compactWindowUsageFields(input.contextWindowState),
  }
}

function buildCompletedLogPayload(
  input: RecordCompletedProviderRemoteCompactInput,
  record: CompactUsageRecord,
): Record<string, unknown> {
  return {
    conversationId: input.conversationId,
    providerId: record.providerId,
    model: record.model,
    upstreamModel: record.upstreamModel,
    mode: record.mode,
    strategy: input.strategy,
    capabilityKind: record.capabilityKind,
    remoteClassification: record.remoteClassification,
    localFallbackAllowed: record.localFallbackAllowed,
    privacyAllowsLocalCompression: record.privacyAllowsLocalCompression,
    localFallbackReason: record.localFallbackReason,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    estimatedSavedTokens: record.estimatedSavedTokens,
    activeContextTokens: record.activeContextTokens,
    autoCompactScopeTokens: record.autoCompactScopeTokens,
    prefillInputTokens: record.prefillInputTokens,
    tokensUntilCompaction: record.tokensUntilCompaction,
    responseId: input.responseId,
    previousResponseId: input.previousResponseId,
    status: 'completed',
  }
}

function buildFailedLogPayload(
  input: RecordFailedProviderRemoteCompactInput,
  record: CompactUsageRecord,
): Record<string, unknown> {
  return {
    conversationId: input.conversationId,
    providerId: record.providerId,
    model: record.model,
    upstreamModel: record.upstreamModel,
    mode: record.mode,
    strategy: input.strategy,
    capabilityKind: record.capabilityKind,
    remoteClassification: record.remoteClassification,
    localFallbackAllowed: record.localFallbackAllowed,
    privacyAllowsLocalCompression: record.privacyAllowsLocalCompression,
    localFallbackReason: record.localFallbackReason,
    inputTokens: record.inputTokens,
    failureCode: record.failureCode,
    fallbackLocal: record.fallbackLocal,
    activeContextTokens: record.activeContextTokens,
    autoCompactScopeTokens: record.autoCompactScopeTokens,
    prefillInputTokens: record.prefillInputTokens,
    tokensUntilCompaction: record.tokensUntilCompaction,
    previousResponseId: input.previousResponseId,
    status: 'failed',
  }
}

function buildCompletedState(
  input: RecordCompletedProviderRemoteCompactInput,
  record: CompactUsageRecord,
  now: number,
): CompactStateRecord | undefined {
  if (!input.responseId || !allowsCompletedStateReuse(input, record)) return undefined
  return {
    id: `compact-state-${input.responseId}`,
    conversationId: input.conversationId,
    providerId: record.providerId,
    model: record.model,
    responseId: input.responseId,
    sessionId: input.conversationId,
    compactItemJson: JSON.stringify({
      type: 'responses_context_management',
      responseId: input.responseId,
      previousResponseId: input.previousResponseId,
      strategy: input.strategy,
      capabilityKind: record.capabilityKind,
      remoteClassification: record.remoteClassification,
      localFallbackAllowed: record.localFallbackAllowed,
      privacyAllowsLocalCompression: record.privacyAllowsLocalCompression,
      localFallbackReason: record.localFallbackReason,
      recordedAt: now,
    }),
    sourceMessageStartIndex: 0,
    sourceMessageEndIndex: Math.max(0, input.messageCount - 1),
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    estimatedSavedTokens: record.estimatedSavedTokens,
    activeContextTokens: record.activeContextTokens,
    autoCompactScopeTokens: record.autoCompactScopeTokens,
    prefillInputTokens: record.prefillInputTokens,
    tokensUntilCompaction: record.tokensUntilCompaction,
    previousResponseId: input.previousResponseId,
    lastCompactSummary: sanitizeOptionalCompactSummary(record.lastCompactSummary),
    contextFragmentIdentitiesJson: serializeFragmentIdentities(input.contextFragments),
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
}

function buildFailedState(
  input: RecordFailedProviderRemoteCompactInput,
  record: CompactUsageRecord,
  now: number,
): CompactStateRecord {
  const failureCode = record.failureCode ?? 'remote_compact_failed'
  return {
    id: `compact-state-failed-${now}`,
    conversationId: input.conversationId,
    providerId: record.providerId,
    model: record.model,
    responseId: undefined,
    sessionId: input.conversationId,
    compactItemJson: JSON.stringify({
      type: 'responses_context_management',
      previousResponseId: input.previousResponseId,
      failureCode,
      fallbackLocal: record.fallbackLocal,
      strategy: input.strategy,
      capabilityKind: record.capabilityKind,
      remoteClassification: record.remoteClassification,
      localFallbackAllowed: record.localFallbackAllowed,
      privacyAllowsLocalCompression: record.privacyAllowsLocalCompression,
      localFallbackReason: record.localFallbackReason,
      recordedAt: now,
    }),
    sourceMessageStartIndex: 0,
    sourceMessageEndIndex: Math.max(0, input.messageCount - 1),
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    estimatedSavedTokens: record.estimatedSavedTokens,
    activeContextTokens: record.activeContextTokens,
    autoCompactScopeTokens: record.autoCompactScopeTokens,
    prefillInputTokens: record.prefillInputTokens,
    tokensUntilCompaction: record.tokensUntilCompaction,
    previousResponseId: input.previousResponseId,
    lastCompactSummary: sanitizeOptionalCompactSummary(record.lastCompactSummary),
    compactFailureState: failureCode,
    contextFragmentIdentitiesJson: serializeFragmentIdentities(input.contextFragments),
    status: 'failed',
    failureCode,
    createdAt: now,
    updatedAt: now,
  }
}

function compactWindowUsageFields(
  state: ProviderRemoteCompactWindowState | undefined,
): Partial<CompactUsageInput> {
  if (!state) return {}
  return {
    ...(state.activeContextTokens !== undefined ? { activeContextTokens: state.activeContextTokens } : {}),
    ...(state.autoCompactScopeTokens !== undefined ? { autoCompactScopeTokens: state.autoCompactScopeTokens } : {}),
    ...(state.prefillInputTokens !== undefined ? { prefillInputTokens: state.prefillInputTokens } : {}),
    ...(state.tokensUntilCompaction !== undefined ? { tokensUntilCompaction: state.tokensUntilCompaction } : {}),
    ...(state.lastCompactSummary !== undefined
      ? { lastCompactSummary: sanitizeCompactUsageSummary(state.lastCompactSummary) }
      : {}),
  }
}

interface ProviderRemoteCompactLifecycleMetadata {
  readonly capabilityKind: ProviderContextManagementCapabilityKind
  readonly remoteClassification: ProviderRemoteCompactClassification
  readonly localFallbackAllowed: boolean
  readonly privacyAllowsLocalCompression: boolean
  readonly localFallbackReason: ProviderLocalCompressionAdmissionReason
}

function resolveCompletedLifecycleMetadata(
  input: RecordCompletedProviderRemoteCompactInput,
): ProviderRemoteCompactLifecycleMetadata {
  const remoteClassification = input.remoteClassification
  const admission = admitProviderLocalCompression({
    classification: remoteClassification,
    settings: input.settings,
  })
  return {
    capabilityKind: input.capabilityKind,
    remoteClassification,
    localFallbackAllowed:
      remoteClassification !== 'remote-available' &&
      input.localFallbackAllowed === true &&
      admission.allowed,
    privacyAllowsLocalCompression: admission.privacyAllowed,
    localFallbackReason:
      remoteClassification === 'remote-available' ? 'remote-not-classified' : admission.reason,
  }
}

function resolveFailedLifecycleMetadata(
  input: RecordFailedProviderRemoteCompactInput,
): ProviderRemoteCompactLifecycleMetadata {
  const remoteClassification: ProviderRemoteCompactClassification =
    input.remoteClassification === 'remote-unavailable' ? 'remote-unavailable' : 'remote-failed'
  const admission = admitProviderLocalCompression({
    classification: remoteClassification,
    settings: input.settings,
  })
  return {
    capabilityKind: input.capabilityKind,
    remoteClassification,
    localFallbackAllowed: admission.allowed,
    privacyAllowsLocalCompression: admission.privacyAllowed,
    localFallbackReason: admission.reason,
  }
}

function allowsPreviousStateReuse(input: ResolveProviderRemoteCompactPreviousStateInput): boolean {
  if (input.signal?.aborted) return false
  return input.strategy === 'native-openai-responses'
    && input.capabilityKind === 'native-compaction'
    && input.remoteClassification === 'remote-available'
}

function allowsCompletedStateReuse(
  input: RecordCompletedProviderRemoteCompactInput,
  record: CompactUsageRecord,
): boolean {
  return input.strategy === 'native-openai-responses'
    && input.capabilityKind === 'native-compaction'
    && input.remoteClassification === 'remote-available'
    && record.capabilityKind === 'native-compaction'
    && record.remoteClassification === 'remote-available'
}

function compactStateMatchesInput(
  state: ProviderRemoteCompactStoredState,
  input: ResolveProviderRemoteCompactPreviousStateInput,
): boolean {
  if (input.signal?.aborted) return false
  if (state.status !== undefined && state.status !== 'active') return false
  if (state.conversationId !== undefined && state.conversationId !== input.conversationId) return false
  if (state.providerId !== undefined && state.providerId !== input.providerId) return false
  if (state.model !== undefined && state.model !== input.model) return false
  if (state.compactItemJson === undefined) return false

  const item = parseCompactStateItem(state.compactItemJson)
  if (!item) return false
  if (item.type !== 'responses_context_management') return false
  if (item.strategy !== 'native-openai-responses') return false
  if (item.capabilityKind !== 'native-compaction') return false
  if (item.remoteClassification !== 'remote-available') return false
  if (item.localFallbackAllowed === true || item.fallbackLocal === true) return false
  return item.strategy === input.strategy
    && item.capabilityKind === input.capabilityKind
    && item.remoteClassification === input.remoteClassification
}

function parseCompactStateItem(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function sanitizeOptionalCompactSummary(value: string | undefined): string | undefined {
  return value === undefined ? undefined : sanitizeCompactUsageSummary(value)
}

function serializeFragmentIdentities(
  fragments: readonly ProviderRemoteCompactFragment[] | undefined,
): string | undefined {
  const identities = normalizeFragmentIdentities(fragments)
  return identities?.length ? JSON.stringify(identities) : undefined
}

function parseFragmentIdentities(
  value: string | undefined,
): ProviderRemoteCompactFragmentIdentity[] | undefined {
  if (value === undefined) return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? normalizeFragmentIdentities(parsed) : undefined
  } catch {
    return undefined
  }
}

function normalizeFragmentIdentities(
  fragments: readonly unknown[] | undefined,
): ProviderRemoteCompactFragmentIdentity[] | undefined {
  if (!fragments?.length) return undefined
  const identities = fragments
    .map((item): ProviderRemoteCompactFragmentIdentity | undefined => {
      if (!item || typeof item !== 'object') return undefined
      const fragment = item as Record<string, unknown>
      if (typeof fragment.id !== 'string' || typeof fragment.sourceId !== 'string') return undefined
      return {
        id: fragment.id,
        sourceId: fragment.sourceId,
        sourceHash: typeof fragment.sourceHash === 'string' ? fragment.sourceHash : undefined,
        included: typeof fragment.included === 'boolean' ? fragment.included : undefined,
      }
    })
    .filter((item): item is ProviderRemoteCompactFragmentIdentity => item !== undefined)
    .slice(0, 32)
  return identities.length ? identities : undefined
}

function runtimeLogOptions(settings: ProviderRemoteCompactSettings): {
  enabled?: boolean
  maxBytes?: number
} {
  return {
    enabled: settings.runtimeLogEnabled,
    maxBytes: settings.runtimeLogMaxBytes,
  }
}
