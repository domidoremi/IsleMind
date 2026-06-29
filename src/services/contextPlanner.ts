import type { AIModel, AIProvider, Message, ProviderType, ReasoningEffort, RetrievalSource, Settings } from '@/types'
import { decideRemoteCompact, type RemoteCompactDecision } from '@/services/ai/compact/remoteCompact'
import { packChatMessages, type PackedChatMessages, type PackChatMessagesInput } from '@/services/contextPacker'
import { estimateTextTokens } from '@/services/tokenUsage'
import { emitRuntimeEvent } from '@/services/runtimeEvents'

export type ContextFragmentType =
  | 'system'
  | 'retrieved_context'
  | 'memory'
  | 'history_summary'
  | 'recent_messages'
  | 'attachments'
  | 'tool_outputs'
  | 'remote_compact_state'

export type ContextFragmentPriority = 'critical' | 'high' | 'normal' | 'low'
export type ContextFragmentExclusionReason = 'empty' | 'token_cap_exceeded'
  | 'unbounded_fragment_blocked'
export type ContextFragmentReuseHint =
  | 'stable_source_hash'
  | 'source_hash_reused'
  | 'source_hash_changed'
  | 'fragment_id_changed'
  | 'empty_source'
  | 'unbounded_fragment_blocked'
export type ContextCacheDiagnosticKind =
  | 'source_hash_changed'
  | 'fragment_id_changed_same_source_hash'
  | 'full_context_rewrite_detected'
  | 'unbounded_fragment_blocked'
export type ContextManifestAuthority =
  | 'system'
  | 'user-private'
  | 'external-public'
  | 'permissioned-tool'
  | 'conversation'
  | 'local-state'
  | 'unknown'
export type ContextManifestDecision = 'included' | 'capped' | 'excluded'
export type ContextManifestReliability =
  | 'bounded_source_hash'
  | 'bounded_capped_source'
  | 'stable_reused_hash'
  | 'excluded_empty'
  | 'blocked_unbounded'
  | 'derived_runtime_state'
export type ContextManifestFailureCode =
  | 'context_source_empty'
  | 'context_source_unbounded'
  | 'context_source_token_cap_exceeded'
  | 'context_source_missing_hash'
  | 'context_budget_overrun'
  | 'context_source_hash_changed'
  | 'context_fragment_id_churn'
  | 'context_full_rewrite_detected'

export const CONTEXT_FRAGMENT_SCHEMA = 'islemind.context-fragment.v2'
export const CONTEXT_ASSEMBLY_MANIFEST_SCHEMA = 'islemind.context-assembly-manifest.v1'

export interface ContextFragment {
  schema: typeof CONTEXT_FRAGMENT_SCHEMA
  id: string
  type: ContextFragmentType
  priority: ContextFragmentPriority
  sourceId: string
  sourceHash?: string
  sourceVersion: 2
  tokenCap: number
  estimatedTokens: number
  originalEstimatedTokens: number
  included: boolean
  capped: boolean
  exclusionReason?: ContextFragmentExclusionReason
  cache: {
    reuseHint: ContextFragmentReuseHint
    sourceHash?: string
  }
  trace: Record<string, unknown>
}

export interface ContextCacheDiagnostic {
  kind: ContextCacheDiagnosticKind
  id?: string
  sourceId?: string
  sourceHash?: string
  previousId?: string
  previousSourceId?: string
  previousSourceHash?: string
  affectedCount?: number
  checkedCount?: number
}

export interface ContextAssemblyManifestFragment {
  fragmentId: string
  type: ContextFragmentType
  priority: ContextFragmentPriority
  sourceId: string
  sourceHash?: string
  sourceVersion: 2
  authority: ContextManifestAuthority
  decision: ContextManifestDecision
  reliability: ContextManifestReliability
  tokenCap: number
  estimatedTokens: number
  originalEstimatedTokens: number
  budgetShare: number
  sourceCount?: number
  reason?: ContextFragmentExclusionReason | 'included' | 'capped'
  cacheReuseHint: ContextFragmentReuseHint
  traceSource?: string
}

export interface ContextAssemblyManifest {
  schema: typeof CONTEXT_ASSEMBLY_MANIFEST_SCHEMA
  id: string
  planner: 'context-planner'
  providerId: string
  model: string
  budget: {
    modelContextWindow: number
    maxOutputTokens: number
    requestBudgetTokens: number
    contextPromptTokens: number
    estimatedInputTokens: number
    fixedTokens: number
    messageTokens: number
    includedFragmentTokens: number
    originalFragmentTokens: number
    totalTokenCap: number
    activeContextTokens: number
    tokensUntilCompaction: number
  }
  counts: {
    totalFragments: number
    includedFragments: number
    excludedFragments: number
    cappedFragments: number
    modelVisibleFragments: number
    retrievedContextFragments: number
    memoryFragments: number
    toolOutputFragments: number
    authorities: Record<ContextManifestAuthority, number>
  }
  guardrails: {
    rawTextSerialized: false
    networkCallsAllowed: false
    modelVisibleContextRequiresFiniteCap: boolean
    modelVisibleSourcesRequireHash: boolean
    excludedSourcesRequireReason: boolean
  }
  failureCodes: ContextManifestFailureCode[]
  fragments: ContextAssemblyManifestFragment[]
  cacheDiagnostics: ContextCacheDiagnostic[]
}

export interface PreviousContextFragmentIdentity {
  id: string
  sourceId: string
  sourceHash?: string
  included?: boolean
}

export interface ContextWindowState {
  activeContextTokens: number
  autoCompactScopeTokens: number
  prefillInputTokens: number
  tokensUntilCompaction: number
  previousResponseId?: string
  lastCompactSummary?: string
  compactFailureState?: {
    code: string
    fallback: 'local-structured-v2' | 'blocked'
  }
}

export interface RemoteCompactLocalFallbackPlan {
  messages: PackedChatMessages['messages']
  contextPrompt: string
  trace: Record<string, unknown>
}

export interface ContextPlannerSource {
  id: string
  type: 'retrieved_context' | 'memory' | 'tool_outputs'
  text?: string
  sourceCount?: number
  trace?: Record<string, unknown>
}

export interface ContextPlan {
  contextPrompt: string
  messages: PackedChatMessages['messages']
  packed: PackedChatMessages
  remoteCompactProbe: PackedChatMessages
  localFallback: PackedChatMessages
  remoteCompactFallback?: RemoteCompactLocalFallbackPlan
  compactDecision: RemoteCompactDecision
  fragments: ContextFragment[]
  manifest: ContextAssemblyManifest
  cacheDiagnostics: ContextCacheDiagnostic[]
  windowState: ContextWindowState
  trace: Record<string, unknown>
}

export interface ContextPlannerInput {
  messages: PackChatMessagesInput['messages']
  draft?: {
    text?: string
    requestedOutput?: string
  }
  baseContextPrompt?: string
  contextSources?: ContextPlannerSource[]
  modelContextWindow: number
  maxOutputTokens: number
  modelManifest?: AIModel
  systemPrompt?: string
  reasoningEffort?: ReasoningEffort
  provider: AIProvider
  providerType?: ProviderType
  model: string
  settings?: Pick<Settings, 'remoteCompactMode' | 'remoteCompactThreshold' | 'runtimeLogEnabled' | 'runtimeLogMaxBytes'>
  retrievalSources?: RetrievalSource[]
  memorySourceCount?: number
  attachmentCount?: number
  toolOutputCount?: number
  previousResponseId?: string
  previousFragments?: PreviousContextFragmentIdentity[]
}

interface PlannedContextSource extends ContextPlannerSource {
  text: string
  originalText: string
  sourceHash: string
  tokenCap: number
  estimatedTokens: number
  originalEstimatedTokens: number
  included: boolean
  capped: boolean
  exclusionReason?: ContextFragmentExclusionReason
}

export function planChatContext(input: ContextPlannerInput): ContextPlan {
  const plannedContextSources = planContextSources(input)
  const contextPrompt = buildPromptFromPlannedSources(plannedContextSources)
  const plannerInput = { ...input, baseContextPrompt: contextPrompt }
  const remoteCompactProbe = pack(plannerInput, false)
  const compactDecision = decideRemoteCompact({
    provider: input.provider,
    model: input.model,
    contextPrompt: remoteCompactProbe.contextPrompt,
    messages: remoteCompactProbe.messages,
    budgetTokens: remoteCompactProbe.budgetTokens,
    estimatedInputTokens: remoteCompactProbe.estimatedInputTokens,
    settings: input.settings,
  })
  const localFallback = pack(plannerInput, true)
  const blocksForMissingRequiredRemote = compactDecision.required && !compactDecision.supported
  const packed = compactDecision.enabled || blocksForMissingRequiredRemote
    ? remoteCompactProbe
    : localFallback
  const remoteCompactFallback = compactDecision.enabled
    ? buildRemoteCompactFallback(localFallback)
    : undefined
  const windowState = buildContextWindowState({
    packed,
    remoteCompactProbe,
    compactDecision,
    previousResponseId: input.previousResponseId,
  })
  const baseFragments = buildFragments(plannerInput, packed, compactDecision, windowState, plannedContextSources)
  const cacheDiagnostics = buildContextCacheDiagnostics(baseFragments, input.previousFragments)
  const fragments = annotateContextFragmentCache(baseFragments, input.previousFragments)
  const manifest = buildContextAssemblyManifest(input, {
    packed,
    contextPrompt: packed.contextPrompt,
    fragments,
    cacheDiagnostics,
    windowState,
  })
  emitContextPlannerEvents(input, {
    contextPrompt: packed.contextPrompt,
    messages: packed.messages,
    compactDecision,
    fragments,
    manifest,
    cacheDiagnostics,
    windowState,
    plannedContextSources,
  })

  return {
    contextPrompt: packed.contextPrompt,
    messages: packed.messages,
    packed,
    remoteCompactProbe,
    localFallback,
    remoteCompactFallback,
    compactDecision,
    fragments,
    manifest,
    cacheDiagnostics,
    windowState,
    trace: {
      source: 'context-planner',
      fragmentCount: fragments.length,
      contextSourceCount: plannedContextSources.length,
      includedContextSourceCount: plannedContextSources.filter((source) => source.included).length,
      cappedContextSourceCount: plannedContextSources.filter((source) => source.capped).length,
      excludedContextSourceCount: plannedContextSources.filter((source) => !source.included).length,
      cacheDiagnosticCount: cacheDiagnostics.length,
      cacheDiagnostics,
      contextManifest: summarizeContextAssemblyManifest(manifest),
      draftTokens: input.draft?.text ? estimateTextTokens(input.draft.text) : undefined,
      requestedOutput: input.draft?.requestedOutput,
      modelManifest: input.modelManifest
        ? {
          id: input.modelManifest.id,
          provider: input.modelManifest.provider,
          source: input.modelManifest.source,
          contextWindow: input.modelManifest.contextWindow,
          maxOutputTokens: input.modelManifest.maxOutputTokens,
          preferredEndpoint: input.modelManifest.preferredEndpoint,
        }
        : undefined,
      activeContextTokens: windowState.activeContextTokens,
      autoCompactScopeTokens: windowState.autoCompactScopeTokens,
      prefillInputTokens: windowState.prefillInputTokens,
      tokensUntilCompaction: windowState.tokensUntilCompaction,
      remoteCompactEnabled: compactDecision.enabled,
      remoteCompactReason: compactDecision.reason,
      localCompressionTriggered: packed.compressionTriggered,
      localCompressionStrategy: packed.compressionMetadata.strategy,
      localCompressionTriggerReason: packed.compressionMetadata.triggerReason,
      localEstimatedSavedTokens: packed.compressionMetadata.estimatedSavedTokens,
    },
  }
}

export function buildContextPlannerPrompt(input: Pick<ContextPlannerInput, 'baseContextPrompt' | 'contextSources'>): string | undefined {
  const sources = input.contextSources?.length
    ? input.contextSources
    : input.baseContextPrompt
      ? [{ id: 'base-context', type: 'retrieved_context' as const, text: input.baseContextPrompt }]
      : []
  const text = sources
    .map((source) => source.text?.trim() ?? '')
    .filter(Boolean)
    .join('\n\n')
  return text || undefined
}

function pack(input: ContextPlannerInput, localCompression: boolean): PackedChatMessages {
  return packChatMessages({
    messages: input.messages,
    contextPrompt: input.baseContextPrompt,
    modelContextWindow: input.modelContextWindow,
    maxOutputTokens: input.maxOutputTokens,
    systemPrompt: input.systemPrompt,
    reasoningEffort: input.reasoningEffort,
    provider: input.provider,
    providerType: input.providerType ?? input.provider.type,
    model: input.model,
    localCompression,
  })
}

function buildRemoteCompactFallback(localFallback: PackedChatMessages): RemoteCompactLocalFallbackPlan {
  return {
    messages: localFallback.messages,
    contextPrompt: localFallback.contextPrompt,
    trace: {
      source: 'context-planner',
      fallback: 'local-structured-v2',
      compressionTriggered: localFallback.compressionTriggered,
      compressionStrategy: localFallback.compressionMetadata.strategy,
      compressionTriggerReason: localFallback.compressionMetadata.triggerReason,
      estimatedSavedTokens: localFallback.compressionMetadata.estimatedSavedTokens,
      sourceTokens: localFallback.compressionMetadata.sourceTokens,
      compressedTokens: localFallback.compressionMetadata.compressedTokens,
    },
  }
}

function buildContextWindowState(input: {
  packed: PackedChatMessages
  remoteCompactProbe: PackedChatMessages
  compactDecision: RemoteCompactDecision
  previousResponseId?: string
}): ContextWindowState {
  const activeContextTokens = estimatePackedInputTokens(input.packed)
  const autoCompactScopeTokens = estimatePackedInputTokens(input.remoteCompactProbe)
  const tokensUntilCompaction = Math.max(0, input.packed.budgetTokens - input.packed.estimatedInputTokens)
  return {
    activeContextTokens,
    autoCompactScopeTokens,
    prefillInputTokens: activeContextTokens,
    tokensUntilCompaction,
    previousResponseId: input.previousResponseId,
    lastCompactSummary: input.packed.compressionTriggered ? input.packed.contextPrompt : undefined,
    compactFailureState: input.compactDecision.required && !input.compactDecision.supported
      ? { code: 'provider_capability_missing', fallback: 'blocked' }
      : undefined,
  }
}

function buildFragments(
  input: ContextPlannerInput,
  packed: PackedChatMessages,
  compactDecision: RemoteCompactDecision,
  windowState: ContextWindowState,
  plannedContextSources: PlannedContextSource[],
): ContextFragment[] {
  const fragments: ContextFragment[] = []
  if (input.systemPrompt) {
    fragments.push(fragment({
      id: 'system',
      type: 'system',
      priority: 'critical',
      sourceId: 'system_prompt',
      text: input.systemPrompt,
      tokenCap: packed.fixedTokens,
      estimatedTokens: estimateTextTokens(input.systemPrompt),
      originalEstimatedTokens: estimateTextTokens(input.systemPrompt),
      included: true,
      capped: false,
      trace: {
        source: 'system_prompt',
      },
    }))
  }
  for (const source of plannedContextSources) {
    fragments.push(fragment({
      id: source.id,
      type: source.type,
      priority: source.type === 'tool_outputs' ? 'normal' : 'high',
      sourceId: source.id,
      sourceHash: source.sourceHash,
      text: source.text,
      tokenCap: source.tokenCap,
      estimatedTokens: source.estimatedTokens,
      originalEstimatedTokens: source.originalEstimatedTokens,
      included: source.included,
      capped: source.capped,
      exclusionReason: source.exclusionReason,
      trace: {
        sourceCount: source.sourceCount ?? (source.type === 'retrieved_context' ? input.retrievalSources?.length ?? 0 : undefined),
        capped: source.capped,
        originalEstimatedTokens: source.originalEstimatedTokens,
        ...source.trace,
      },
    }))
  }
  if ((input.memorySourceCount ?? 0) > 0) {
    fragments.push(fragment({
      id: 'memory',
      type: 'memory',
      priority: 'high',
      sourceId: 'memory',
      tokenCap: contextFragmentTokenCap('memory', input),
      estimatedTokens: 0,
      originalEstimatedTokens: 0,
      included: true,
      capped: false,
      trace: {
        sourceCount: input.memorySourceCount,
      },
    }))
  }
  if (packed.compressionTriggered) {
    fragments.push(fragment({
      id: 'history-summary',
      type: 'history_summary',
      priority: 'high',
      sourceId: 'local-compression',
      tokenCap: packed.compressionMetadata.summaryTokenBudget,
      estimatedTokens: packed.compressionMetadata.summaryTokens,
      originalEstimatedTokens: packed.compressionMetadata.sourceTokens,
      included: true,
      capped: false,
      trace: {
        strategy: packed.compressionMetadata.strategy,
        triggerReason: packed.compressionMetadata.triggerReason,
        sourceMessageCount: packed.compressionMetadata.sourceMessageCount,
        estimatedSavedTokens: packed.compressionMetadata.estimatedSavedTokens,
        sections: packed.compressionMetadata.summarySections,
      },
    }))
  }
  fragments.push(fragment({
    id: 'recent-messages',
    type: 'recent_messages',
    priority: 'critical',
    sourceId: 'conversation-messages',
    tokenCap: packed.budgetTokens,
    estimatedTokens: packed.messageTokens,
    originalEstimatedTokens: packed.messageTokens + packed.compressionMetadata.sourceTokens,
    included: true,
    capped: packed.truncatedSingleMessage,
    exclusionReason: packed.truncatedSingleMessage ? 'token_cap_exceeded' : undefined,
    trace: {
      messageCount: packed.messages.length,
      trimmedCount: packed.trimmedCount,
    },
  }))
  if ((input.attachmentCount ?? 0) > 0) {
    fragments.push(fragment({
      id: 'attachments',
      type: 'attachments',
      priority: 'high',
      sourceId: 'attachments',
      tokenCap: contextFragmentTokenCap('attachments', input),
      estimatedTokens: 0,
      originalEstimatedTokens: 0,
      included: true,
      capped: false,
      trace: {
        attachmentCount: input.attachmentCount,
      },
    }))
  }
  if ((input.toolOutputCount ?? 0) > 0) {
    fragments.push(fragment({
      id: 'tool-outputs',
      type: 'tool_outputs',
      priority: 'normal',
      sourceId: 'tool-outputs',
      tokenCap: contextFragmentTokenCap('tool_outputs', input),
      estimatedTokens: 0,
      originalEstimatedTokens: 0,
      included: true,
      capped: false,
      trace: {
        toolOutputCount: input.toolOutputCount,
      },
    }))
  }
  if (compactDecision.enabled || input.previousResponseId || windowState.compactFailureState) {
    fragments.push(fragment({
      id: 'remote-compact-state',
      type: 'remote_compact_state',
      priority: 'normal',
      sourceId: 'remote-compact-state',
      tokenCap: contextFragmentTokenCap('remote_compact_state', input),
      estimatedTokens: estimateTextTokens([input.previousResponseId, windowState.lastCompactSummary].filter(Boolean).join('\n')),
      originalEstimatedTokens: estimateTextTokens([input.previousResponseId, windowState.lastCompactSummary].filter(Boolean).join('\n')),
      included: true,
      capped: false,
      trace: {
        enabled: compactDecision.enabled,
        mode: compactDecision.mode,
        reason: compactDecision.reason,
        previousResponseId: input.previousResponseId,
        failureState: windowState.compactFailureState,
      },
    }))
  }
  return fragments
}

function fragment(input: {
  id: string
  type: ContextFragmentType
  priority: ContextFragmentPriority
  sourceId: string
  sourceHash?: string
  text?: string
  tokenCap: number
  estimatedTokens: number
  originalEstimatedTokens: number
  included: boolean
  capped: boolean
  exclusionReason?: ContextFragmentExclusionReason
  trace: Record<string, unknown>
}): ContextFragment {
  const sourceHash = input.sourceHash ?? stableContextSourceHash(`${input.type}:${input.sourceId}:${input.text ?? ''}`)
  return {
    schema: CONTEXT_FRAGMENT_SCHEMA,
    id: input.id,
    type: input.type,
    priority: input.priority,
    sourceId: input.sourceId,
    sourceHash,
    sourceVersion: 2,
    tokenCap: Math.max(0, Math.floor(input.tokenCap)),
    estimatedTokens: Math.max(0, Math.floor(input.estimatedTokens)),
    originalEstimatedTokens: Math.max(0, Math.floor(input.originalEstimatedTokens)),
    included: input.included,
    capped: input.capped,
    exclusionReason: input.exclusionReason,
    cache: {
      reuseHint: input.included ? 'stable_source_hash' : 'empty_source',
      sourceHash,
    },
    trace: input.trace,
  }
}

function estimatePackedInputTokens(packed: PackedChatMessages): number {
  return Math.max(0, packed.estimatedInputTokens + packed.fixedTokens)
}

function emitContextPlannerEvents(
  input: ContextPlannerInput,
  plan: {
    contextPrompt: string
    messages: PackedChatMessages['messages']
    compactDecision: RemoteCompactDecision
    fragments: ContextFragment[]
    manifest: ContextAssemblyManifest
    cacheDiagnostics: ContextCacheDiagnostic[]
    windowState: ContextWindowState
    plannedContextSources: PlannedContextSource[]
  },
): void {
  const options = runtimeLogOptionsForContextPlanner(input)
  if (!options.enabled) return
  const includedFragments = plan.fragments.filter((fragment) => fragment.included)
  const excludedFragments = plan.fragments.filter((fragment) => !fragment.included)
  void emitRuntimeEvent({
    event: 'context.planned',
    providerId: input.provider.id,
    model: input.model,
    data: {
      fragmentSchema: CONTEXT_FRAGMENT_SCHEMA,
      fragmentCount: plan.fragments.length,
      includedFragmentCount: includedFragments.length,
      excludedFragmentCount: excludedFragments.length,
      cappedFragmentCount: plan.fragments.filter((fragment) => fragment.capped).length,
      contextSourceCount: plan.plannedContextSources.length,
      messageCount: plan.messages.length,
      contextPromptTokens: estimateTextTokens(plan.contextPrompt),
      activeContextTokens: plan.windowState.activeContextTokens,
      tokensUntilCompaction: plan.windowState.tokensUntilCompaction,
      contextManifestSchema: plan.manifest.schema,
      contextManifestId: plan.manifest.id,
      contextManifestFailureCodes: plan.manifest.failureCodes,
      contextManifest: summarizeContextAssemblyManifest(plan.manifest),
      remoteCompactEnabled: plan.compactDecision.enabled,
      remoteCompactReason: plan.compactDecision.reason,
      cacheDiagnosticCount: plan.cacheDiagnostics.length,
      cacheDiagnostics: summarizeContextCacheDiagnostics(plan.cacheDiagnostics),
      fragments: summarizeContextFragments(plan.fragments),
    },
    legacyData: {
      providerId: input.provider.id,
      model: input.model,
      operation: 'planned',
      fragmentSchema: CONTEXT_FRAGMENT_SCHEMA,
      fragmentCount: plan.fragments.length,
      includedFragmentCount: includedFragments.length,
      excludedFragmentCount: excludedFragments.length,
      cappedFragmentCount: plan.fragments.filter((fragment) => fragment.capped).length,
      activeContextTokens: plan.windowState.activeContextTokens,
      contextManifestSchema: plan.manifest.schema,
      contextManifestId: plan.manifest.id,
      contextManifestFailureCodes: plan.manifest.failureCodes,
      cacheDiagnosticCount: plan.cacheDiagnostics.length,
      cacheDiagnostics: summarizeContextCacheDiagnostics(plan.cacheDiagnostics),
    },
    options,
  })
  void emitRuntimeEvent({
    event: 'context.compact.decided',
    providerId: input.provider.id,
    model: input.model,
    data: {
      mode: plan.compactDecision.mode,
      enabled: plan.compactDecision.enabled,
      required: plan.compactDecision.required,
      supported: plan.compactDecision.supported,
      reason: plan.compactDecision.reason,
      pressureRatio: plan.compactDecision.pressureRatio,
      activeContextTokens: plan.windowState.activeContextTokens,
      autoCompactScopeTokens: plan.windowState.autoCompactScopeTokens,
      prefillInputTokens: plan.windowState.prefillInputTokens,
      tokensUntilCompaction: plan.windowState.tokensUntilCompaction,
      compactFailureState: plan.windowState.compactFailureState,
    },
    legacyData: {
      providerId: input.provider.id,
      model: input.model,
      mode: plan.compactDecision.mode,
      enabled: plan.compactDecision.enabled,
      required: plan.compactDecision.required,
      supported: plan.compactDecision.supported,
      reason: plan.compactDecision.reason,
      pressureRatio: plan.compactDecision.pressureRatio,
      tokensUntilCompaction: plan.windowState.tokensUntilCompaction,
      failureCode: plan.windowState.compactFailureState?.code,
    },
    options,
  })
  if (includedFragments.length) {
    void emitRuntimeEvent({
      event: 'context.fragment.included',
      providerId: input.provider.id,
      model: input.model,
      data: {
        fragmentSchema: CONTEXT_FRAGMENT_SCHEMA,
        count: includedFragments.length,
        fragments: summarizeContextFragments(includedFragments),
      },
      legacyData: {
        providerId: input.provider.id,
        model: input.model,
        operation: 'fragment.included',
        count: includedFragments.length,
        fragments: summarizeContextFragments(includedFragments),
      },
      options,
    })
  }
  if (excludedFragments.length) {
    void emitRuntimeEvent({
      event: 'context.fragment.excluded',
      providerId: input.provider.id,
      model: input.model,
      data: {
        fragmentSchema: CONTEXT_FRAGMENT_SCHEMA,
        count: excludedFragments.length,
        fragments: summarizeContextFragments(excludedFragments),
      },
      legacyData: {
        providerId: input.provider.id,
        model: input.model,
        operation: 'fragment.excluded',
        count: excludedFragments.length,
        fragments: summarizeContextFragments(excludedFragments),
      },
      options,
    })
  }
}

function buildContextCacheDiagnostics(
  fragments: ContextFragment[],
  previousFragments: PreviousContextFragmentIdentity[] | undefined,
): ContextCacheDiagnostic[] {
  const diagnostics: ContextCacheDiagnostic[] = []
  const includedFragments = fragments.filter((fragment) => fragment.included)
  for (const fragment of fragments) {
    if (!Number.isFinite(fragment.tokenCap) || fragment.tokenCap <= 0) {
      diagnostics.push({
        kind: 'unbounded_fragment_blocked',
        id: fragment.id,
        sourceId: fragment.sourceId,
        sourceHash: fragment.sourceHash,
      })
    }
  }
  const previousIncluded = (previousFragments ?? []).filter((fragment) => fragment.included !== false)
  if (!previousIncluded.length) return diagnostics

  const previousBySourceId = new Map(previousIncluded.map((fragment) => [fragment.sourceId, fragment]))
  const previousBySourceHash = new Map(previousIncluded.filter((fragment) => fragment.sourceHash).map((fragment) => [fragment.sourceHash!, fragment]))
  let checkedCount = 0
  let changedCount = 0
  for (const fragment of includedFragments) {
    const previousBySource = previousBySourceId.get(fragment.sourceId)
    if (previousBySource?.sourceHash && fragment.sourceHash && previousBySource.sourceHash !== fragment.sourceHash) {
      checkedCount += 1
      changedCount += 1
      diagnostics.push({
        kind: 'source_hash_changed',
        id: fragment.id,
        sourceId: fragment.sourceId,
        sourceHash: fragment.sourceHash,
        previousId: previousBySource.id,
        previousSourceId: previousBySource.sourceId,
        previousSourceHash: previousBySource.sourceHash,
      })
    } else if (previousBySource?.sourceHash && fragment.sourceHash) {
      checkedCount += 1
    }
    const previousByHash = fragment.sourceHash ? previousBySourceHash.get(fragment.sourceHash) : undefined
    if (previousByHash && (previousByHash.id !== fragment.id || previousByHash.sourceId !== fragment.sourceId)) {
      diagnostics.push({
        kind: 'fragment_id_changed_same_source_hash',
        id: fragment.id,
        sourceId: fragment.sourceId,
        sourceHash: fragment.sourceHash,
        previousId: previousByHash.id,
        previousSourceId: previousByHash.sourceId,
        previousSourceHash: previousByHash.sourceHash,
      })
    }
  }
  const fullRewriteThreshold = Math.max(3, Math.ceil(checkedCount * 0.6))
  if (checkedCount >= 3 && changedCount >= fullRewriteThreshold) {
    diagnostics.push({
      kind: 'full_context_rewrite_detected',
      affectedCount: changedCount,
      checkedCount,
    })
  }
  return diagnostics.slice(0, 12)
}

function annotateContextFragmentCache(
  fragments: ContextFragment[],
  previousFragments: PreviousContextFragmentIdentity[] | undefined,
): ContextFragment[] {
  const previousIncluded = (previousFragments ?? []).filter((fragment) => fragment.included !== false)
  const previousBySourceId = new Map(previousIncluded.map((fragment) => [fragment.sourceId, fragment]))
  const previousBySourceHash = new Map(previousIncluded.filter((fragment) => fragment.sourceHash).map((fragment) => [fragment.sourceHash!, fragment]))
  return fragments.map((fragment) => {
    const previousBySource = previousBySourceId.get(fragment.sourceId)
    const previousByHash = fragment.sourceHash ? previousBySourceHash.get(fragment.sourceHash) : undefined
    const reuseHint = contextFragmentReuseHint(fragment, previousBySource, previousByHash)
    return {
      ...fragment,
      cache: {
        ...fragment.cache,
        reuseHint,
      },
    }
  })
}

function contextFragmentReuseHint(
  fragment: ContextFragment,
  previousBySource: PreviousContextFragmentIdentity | undefined,
  previousByHash: PreviousContextFragmentIdentity | undefined,
): ContextFragmentReuseHint {
  if (!Number.isFinite(fragment.tokenCap) || fragment.tokenCap <= 0) return 'unbounded_fragment_blocked'
  if (!fragment.included) return 'empty_source'
  if (previousBySource?.sourceHash && fragment.sourceHash && previousBySource.sourceHash === fragment.sourceHash) return 'source_hash_reused'
  if (previousBySource?.sourceHash && fragment.sourceHash && previousBySource.sourceHash !== fragment.sourceHash) return 'source_hash_changed'
  if (previousByHash && (previousByHash.id !== fragment.id || previousByHash.sourceId !== fragment.sourceId)) return 'fragment_id_changed'
  return 'stable_source_hash'
}

function summarizeContextCacheDiagnostics(diagnostics: ContextCacheDiagnostic[]): ContextCacheDiagnostic[] {
  return diagnostics.slice(0, 8)
}

function summarizeContextFragments(fragments: ContextFragment[]): Array<{
  id: string
  type: ContextFragmentType
  sourceId: string
  sourceHash?: string
  tokenCap: number
  estimatedTokens: number
  originalEstimatedTokens: number
  included: boolean
  capped: boolean
  exclusionReason?: ContextFragmentExclusionReason
  reuseHint: ContextFragmentReuseHint
}> {
  return fragments.slice(0, 8).map((fragment) => ({
    id: fragment.id,
    type: fragment.type,
    sourceId: fragment.sourceId,
    sourceHash: fragment.sourceHash,
    tokenCap: fragment.tokenCap,
    estimatedTokens: fragment.estimatedTokens,
    originalEstimatedTokens: fragment.originalEstimatedTokens,
    included: fragment.included,
    capped: fragment.capped,
    exclusionReason: fragment.exclusionReason,
    reuseHint: fragment.cache.reuseHint,
  }))
}

function buildContextAssemblyManifest(
  input: ContextPlannerInput,
  plan: {
    packed: PackedChatMessages
    contextPrompt: string
    fragments: ContextFragment[]
    cacheDiagnostics: ContextCacheDiagnostic[]
    windowState: ContextWindowState
  },
): ContextAssemblyManifest {
  const manifestFragments = plan.fragments.map((fragment) => buildContextManifestFragment(fragment, plan.packed.budgetTokens))
  const failureCodes = contextManifestFailureCodes(plan.fragments, plan.cacheDiagnostics, plan.windowState, input)
  const includedFragments = plan.fragments.filter((fragment) => fragment.included)
  const excludedFragments = plan.fragments.filter((fragment) => !fragment.included)
  const cappedFragments = plan.fragments.filter((fragment) => fragment.capped)
  const totalTokenCap = plan.fragments.reduce((sum, fragment) => sum + fragment.tokenCap, 0)
  const originalFragmentTokens = plan.fragments.reduce((sum, fragment) => sum + fragment.originalEstimatedTokens, 0)
  const includedFragmentTokens = includedFragments.reduce((sum, fragment) => sum + fragment.estimatedTokens, 0)
  const authorities = emptyContextManifestAuthorityCounts()
  for (const fragment of manifestFragments) {
    authorities[fragment.authority] += 1
  }

  return {
    schema: CONTEXT_ASSEMBLY_MANIFEST_SCHEMA,
    id: buildContextManifestId(input, plan.fragments, failureCodes),
    planner: 'context-planner',
    providerId: input.provider.id,
    model: input.model,
    budget: {
      modelContextWindow: finiteNumberOrZero(input.modelContextWindow),
      maxOutputTokens: finiteNumberOrZero(input.maxOutputTokens),
      requestBudgetTokens: plan.packed.budgetTokens,
      contextPromptTokens: estimateTextTokens(plan.contextPrompt),
      estimatedInputTokens: plan.packed.estimatedInputTokens,
      fixedTokens: plan.packed.fixedTokens,
      messageTokens: plan.packed.messageTokens,
      includedFragmentTokens,
      originalFragmentTokens,
      totalTokenCap,
      activeContextTokens: plan.windowState.activeContextTokens,
      tokensUntilCompaction: plan.windowState.tokensUntilCompaction,
    },
    counts: {
      totalFragments: plan.fragments.length,
      includedFragments: includedFragments.length,
      excludedFragments: excludedFragments.length,
      cappedFragments: cappedFragments.length,
      modelVisibleFragments: includedFragments.length,
      retrievedContextFragments: plan.fragments.filter((fragment) => fragment.type === 'retrieved_context').length,
      memoryFragments: plan.fragments.filter((fragment) => fragment.type === 'memory').length,
      toolOutputFragments: plan.fragments.filter((fragment) => fragment.type === 'tool_outputs').length,
      authorities,
    },
    guardrails: {
      rawTextSerialized: false,
      networkCallsAllowed: false,
      modelVisibleContextRequiresFiniteCap: includedFragments.every((fragment) => Number.isFinite(fragment.tokenCap) && fragment.tokenCap > 0),
      modelVisibleSourcesRequireHash: includedFragments.every((fragment) => Boolean(fragment.sourceHash)),
      excludedSourcesRequireReason: excludedFragments.every((fragment) => Boolean(fragment.exclusionReason)),
    },
    failureCodes,
    fragments: manifestFragments,
    cacheDiagnostics: summarizeContextCacheDiagnostics(plan.cacheDiagnostics),
  }
}

function buildContextManifestFragment(fragment: ContextFragment, requestBudgetTokens: number): ContextAssemblyManifestFragment {
  return {
    fragmentId: fragment.id,
    type: fragment.type,
    priority: fragment.priority,
    sourceId: fragment.sourceId,
    sourceHash: fragment.sourceHash,
    sourceVersion: fragment.sourceVersion,
    authority: contextManifestAuthority(fragment),
    decision: contextManifestDecision(fragment),
    reliability: contextManifestReliability(fragment),
    tokenCap: fragment.tokenCap,
    estimatedTokens: fragment.estimatedTokens,
    originalEstimatedTokens: fragment.originalEstimatedTokens,
    budgetShare: roundContextManifestRatio(fragment.estimatedTokens, requestBudgetTokens),
    sourceCount: contextManifestSourceCount(fragment),
    reason: fragment.exclusionReason ?? (fragment.capped ? 'capped' : 'included'),
    cacheReuseHint: fragment.cache.reuseHint,
    traceSource: contextManifestTraceSource(fragment),
  }
}

function summarizeContextAssemblyManifest(manifest: ContextAssemblyManifest): Pick<
  ContextAssemblyManifest,
  'schema' | 'id' | 'budget' | 'counts' | 'guardrails' | 'failureCodes'
> {
  return {
    schema: manifest.schema,
    id: manifest.id,
    budget: manifest.budget,
    counts: manifest.counts,
    guardrails: manifest.guardrails,
    failureCodes: manifest.failureCodes,
  }
}

function contextManifestFailureCodes(
  fragments: ContextFragment[],
  cacheDiagnostics: ContextCacheDiagnostic[],
  windowState: ContextWindowState,
  input: ContextPlannerInput,
): ContextManifestFailureCode[] {
  const codes = new Set<ContextManifestFailureCode>()
  for (const fragment of fragments) {
    if (fragment.exclusionReason === 'empty') codes.add('context_source_empty')
    if (fragment.exclusionReason === 'unbounded_fragment_blocked') codes.add('context_source_unbounded')
    if (fragment.capped || fragment.exclusionReason === 'token_cap_exceeded') codes.add('context_source_token_cap_exceeded')
    if (fragment.included && !fragment.sourceHash) codes.add('context_source_missing_hash')
    if (fragment.included && (!Number.isFinite(fragment.tokenCap) || fragment.tokenCap <= 0 || fragment.estimatedTokens > fragment.tokenCap)) {
      codes.add('context_budget_overrun')
    }
  }
  if (Number.isFinite(input.modelContextWindow) && windowState.activeContextTokens > input.modelContextWindow) {
    codes.add('context_budget_overrun')
  }
  for (const diagnostic of cacheDiagnostics) {
    if (diagnostic.kind === 'source_hash_changed') codes.add('context_source_hash_changed')
    if (diagnostic.kind === 'fragment_id_changed_same_source_hash') codes.add('context_fragment_id_churn')
    if (diagnostic.kind === 'full_context_rewrite_detected') codes.add('context_full_rewrite_detected')
    if (diagnostic.kind === 'unbounded_fragment_blocked') codes.add('context_source_unbounded')
  }
  return Array.from(codes)
}

function buildContextManifestId(
  input: ContextPlannerInput,
  fragments: ContextFragment[],
  failureCodes: ContextManifestFailureCode[],
): string {
  const identity = [
    CONTEXT_ASSEMBLY_MANIFEST_SCHEMA,
    input.provider.id,
    input.model,
    finiteNumberOrZero(input.modelContextWindow),
    finiteNumberOrZero(input.maxOutputTokens),
    ...fragments.map((fragment) => [
      fragment.id,
      fragment.type,
      fragment.sourceId,
      fragment.sourceHash,
      fragment.included ? 'included' : 'excluded',
      fragment.capped ? 'capped' : 'uncapped',
      fragment.exclusionReason ?? '',
      fragment.cache.reuseHint,
    ].join(':')),
    ...failureCodes,
  ].join('|')
  return `context-manifest-${stableContextSourceHash(identity)}`
}

function contextManifestAuthority(fragment: ContextFragment): ContextManifestAuthority {
  const runtime = fragment.trace.contextRuntime
  if (runtime && typeof runtime === 'object' && !Array.isArray(runtime)) {
    const authority = (runtime as { authority?: unknown }).authority
    if (authority === 'user-private' || authority === 'external-public' || authority === 'permissioned-tool') {
      return authority
    }
  }
  if (fragment.type === 'system') return 'system'
  if (fragment.type === 'retrieved_context' || fragment.type === 'memory' || fragment.type === 'attachments') return 'user-private'
  if (fragment.type === 'tool_outputs') return 'permissioned-tool'
  if (fragment.type === 'history_summary' || fragment.type === 'recent_messages') return 'conversation'
  if (fragment.type === 'remote_compact_state') return 'local-state'
  return 'unknown'
}

function contextManifestDecision(fragment: ContextFragment): ContextManifestDecision {
  if (!fragment.included) return 'excluded'
  return fragment.capped ? 'capped' : 'included'
}

function contextManifestReliability(fragment: ContextFragment): ContextManifestReliability {
  if (fragment.exclusionReason === 'unbounded_fragment_blocked') return 'blocked_unbounded'
  if (!fragment.included) return 'excluded_empty'
  if (fragment.type === 'history_summary' || fragment.type === 'recent_messages' || fragment.type === 'remote_compact_state') {
    return 'derived_runtime_state'
  }
  if (fragment.cache.reuseHint === 'source_hash_reused') return 'stable_reused_hash'
  if (fragment.capped) return 'bounded_capped_source'
  return 'bounded_source_hash'
}

function contextManifestSourceCount(fragment: ContextFragment): number | undefined {
  const sourceCount = fragment.trace.sourceCount
  return typeof sourceCount === 'number' && Number.isFinite(sourceCount) ? sourceCount : undefined
}

function contextManifestTraceSource(fragment: ContextFragment): string | undefined {
  const source = fragment.trace.source
  return typeof source === 'string' && source.trim() ? source : undefined
}

function emptyContextManifestAuthorityCounts(): Record<ContextManifestAuthority, number> {
  return {
    system: 0,
    'user-private': 0,
    'external-public': 0,
    'permissioned-tool': 0,
    conversation: 0,
    'local-state': 0,
    unknown: 0,
  }
}

function roundContextManifestRatio(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0
  return Math.round((value / total) * 1000) / 1000
}

function finiteNumberOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function runtimeLogOptionsForContextPlanner(input: ContextPlannerInput): { enabled?: boolean; maxBytes?: number } {
  return {
    enabled: input.settings?.runtimeLogEnabled === true,
    maxBytes: input.settings?.runtimeLogMaxBytes,
  }
}

function planContextSources(input: ContextPlannerInput): PlannedContextSource[] {
  const sources = input.contextSources?.length
    ? input.contextSources
    : input.baseContextPrompt
      ? [{ id: 'base-context', type: 'retrieved_context' as const, text: input.baseContextPrompt }]
      : []
  return sources.map((source) => {
    const originalText = source.text?.trim() ?? ''
    const sourceHash = stableContextSourceHash(`${source.type}:${originalText}`)
    const originalEstimatedTokens = estimateTextTokens(originalText)
    const tokenCap = contextFragmentTokenCap(source.type, input)
    if (!Number.isFinite(tokenCap) || tokenCap <= 0) {
      return {
        ...source,
        text: '',
        originalText,
        sourceHash,
        tokenCap: 0,
        estimatedTokens: 0,
        originalEstimatedTokens,
        included: false,
        capped: false,
        exclusionReason: 'unbounded_fragment_blocked',
      }
    }
    if (!originalText) {
      return {
        ...source,
        text: '',
        originalText,
        sourceHash,
        tokenCap,
        estimatedTokens: 0,
        originalEstimatedTokens,
        included: false,
        capped: false,
        exclusionReason: 'empty',
      }
    }
    const cappedText = originalEstimatedTokens > tokenCap
      ? clampContextSourceText(originalText, tokenCap)
      : originalText
    const estimatedTokens = estimateTextTokens(cappedText)
    return {
      ...source,
      text: cappedText,
      originalText,
      sourceHash,
      tokenCap,
      estimatedTokens,
      originalEstimatedTokens,
      included: Boolean(cappedText.trim()),
      capped: cappedText !== originalText,
      exclusionReason: cappedText !== originalText ? 'token_cap_exceeded' : undefined,
    }
  })
}

function buildPromptFromPlannedSources(sources: PlannedContextSource[]): string | undefined {
  const text = sources
    .filter((source) => source.included)
    .map((source) => source.text.trim())
    .filter(Boolean)
    .join('\n\n')
  return text || undefined
}

function contextFragmentTokenCap(type: ContextFragmentType, input: Pick<ContextPlannerInput, 'modelContextWindow' | 'maxOutputTokens'>): number {
  if (!Number.isFinite(input.modelContextWindow) || !Number.isFinite(input.maxOutputTokens)) return 0
  const usableWindow = Math.max(256, input.modelContextWindow - input.maxOutputTokens)
  const ratio = type === 'tool_outputs'
    ? 0.14
    : type === 'memory'
      ? 0.1
      : type === 'attachments'
        ? 0.12
        : type === 'remote_compact_state'
          ? 0.08
          : type === 'retrieved_context'
            ? 0.2
            : 0.35
  return Math.max(96, Math.floor(usableWindow * ratio))
}

function clampContextSourceText(text: string, tokenCap: number): string {
  const prefix = '[context fragment capped]\n'
  let next = text.trim()
  while (estimateTextTokens(next) > tokenCap && next.length > 180) {
    next = preserveContextHeadTail(next, Math.max(120, Math.floor(next.length * 0.72)))
  }
  let withPrefix = `${prefix}${next}`
  while (estimateTextTokens(withPrefix) > tokenCap && next.length > 120) {
    next = preserveContextHeadTail(next, Math.max(96, Math.floor(next.length * 0.84)))
    withPrefix = `${prefix}${next}`
  }
  return estimateTextTokens(withPrefix) <= tokenCap ? withPrefix : next
}

function preserveContextHeadTail(text: string, keepChars: number): string {
  const source = text.trim()
  if (source.length <= keepChars) return source
  const ellipsis = '\n...\n'
  const available = Math.max(48, keepChars - ellipsis.length)
  const headLength = Math.max(24, Math.ceil(available * 0.45))
  const tailLength = Math.max(24, available - headLength)
  return `${source.slice(0, headLength).trimEnd()}${ellipsis}${source.slice(Math.max(headLength, source.length - tailLength)).trimStart()}`
}

function stableContextSourceHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, '0')}`
}
