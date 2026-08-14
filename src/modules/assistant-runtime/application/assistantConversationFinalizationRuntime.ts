import type { AssistantConversationDetachedWorkLease } from './assistantConversationDetachedWorkRegistry'
import type { AssistantConversationWorkspaceWritebackHandoff } from './assistantConversationWorkspaceWritebackHandoffRuntime'

export interface AssistantConversationFinalizationCitationLike {
  readonly type: string
}

export interface AssistantConversationFinalizationUsageLike {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly source?: string
}

export interface AssistantConversationFinalizationMessageLike<TCitation> {
  readonly id: string
  readonly status: string
  readonly content: string
  readonly startedAt?: number
  readonly citations?: TCitation[]
}

export interface AssistantConversationFinalizationConversationLike<TCitation> {
  readonly title: string
  readonly model: string
  readonly messages: readonly AssistantConversationFinalizationMessageLike<TCitation>[]
}

export interface AssistantConversationFinalizationProviderLike {
  readonly id: string
}

export interface AssistantConversationFinalizationContextLike<TSource, TPlan, TQuality> {
  readonly sources: readonly TSource[]
  readonly plan?: TPlan
  readonly quality?: TQuality
}

export interface AssistantConversationFinalizationProviderResult<
  TCitation,
  TUsage,
  TProviderToolCall,
> {
  readonly text: string
  readonly citations?: TCitation[]
  readonly usage?: TUsage
  readonly traces?: readonly unknown[]
  readonly providerToolCalls?: readonly TProviderToolCall[]
  readonly reasoningContent?: string
  readonly responseItems?: readonly unknown[]
  readonly providerContentBlocks?: readonly unknown[]
  readonly credentialGroupId?: string
  readonly responseId?: string
  readonly remoteCompactFallbackUsed?: boolean
  readonly remoteCompactFallbackReason?: string
}

export interface AssistantConversationFinalizationRevision<TUsage> {
  readonly text: string
  readonly usage?: TUsage
}

export type AssistantConversationFinalizationSupplementalEvidence<
  TCitation,
  TSource,
> =
  | {
      readonly status: 'completed'
      readonly sources: TSource[]
      readonly citations: TCitation[]
      readonly evidenceAttached: boolean
    }
  | {
      readonly status: 'skipped'
      readonly sources: TSource[]
      readonly citations: TCitation[]
      readonly reason: string
    }
  | {
      readonly status: 'failed'
      readonly sources: TSource[]
      readonly citations: TCitation[]
      readonly error: unknown
    }

export interface AssistantConversationFinalizationSuccessPlan<TUsage> {
  readonly kind: 'project'
  readonly messagePatch: { readonly usage: TUsage }
}

export interface AssistantConversationFinalizationSkippedPlan {
  readonly kind: 'skip'
}

export interface AssistantConversationFinalizationTraceStateLike {
  readonly retrievalTrace?: readonly {
    readonly id: string
    readonly startedAt?: number
  }[]
}

export interface AssistantConversationFinalizationTraceInput {
  readonly id: string
  readonly type: 'system' | 'search'
  readonly title: string
  readonly content: string
  readonly status: 'done' | 'error' | 'skipped'
  readonly startedAt: number
  readonly metadata: Readonly<Record<string, unknown>>
}

export type AssistantConversationFinalizationTextKey =
  | 'chatRunner.trace.modelRequestTitle'
  | 'chatRunner.trace.modelReturnedText'
  | 'chatRunner.trace.modelNoFinalText'
  | 'chatRunner.trace.nativeSearchTitle'
  | 'chatRunner.trace.nativeSearchSourceCount'
  | 'chatRunner.trace.nativeSearchNoSources'
  | 'chatRunner.trace.stepCompletedWithModel'
  | 'chatRunner.trace.stepStoppedNoText'

export interface AssistantConversationWorkspaceWritebackFinalizationInput {
  readonly handoff: AssistantConversationWorkspaceWritebackHandoff
  readonly finalOutput: string
  readonly signal: AbortSignal
}

export interface AssistantConversationWorkspaceWritebackFinalizationOutcome {
  readonly status:
    | 'applied'
    | 'replayed'
    | 'no_changes'
    | 'conflict'
    | 'cancelled'
    | 'unavailable'
    | 'failed'
}

export type AssistantConversationWorkspaceWritebackProjectionStatus =
  | AssistantConversationWorkspaceWritebackFinalizationOutcome['status']
  | 'unknown'

export interface AssistantConversationWorkspaceWritebackOutcomeProjection {
  readonly assistantRunId: AssistantConversationWorkspaceWritebackHandoff['assistantRunId']
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly workspaceId: string
  readonly repositoryAuthorityRevision: number
  readonly idempotencyKey: string
  readonly status: AssistantConversationWorkspaceWritebackProjectionStatus
  readonly origin: 'returned' | 'thrown' | 'recovered'
  readonly code?: string
  readonly authorityRevision?: number
  readonly actualAuthorityRevision?: number
  readonly occurredAt?: number
}

export interface AssistantConversationRemoteCompactRecordBase<
  TSettings,
  TRemoteCompactMode,
  TContextWindowState,
  TContextFragment,
  TRemoteCompactStrategy,
  TRemoteCompactCapabilityKind,
  TRemoteCompactClassification,
> {
  readonly conversationId: string
  readonly providerId: string
  readonly model: string
  readonly upstreamModel: string
  readonly mode: TRemoteCompactMode | 'auto'
  readonly strategy: TRemoteCompactStrategy
  readonly capabilityKind: TRemoteCompactCapabilityKind
  readonly remoteClassification: TRemoteCompactClassification
  readonly inputTokens?: number
  readonly messageCount: number
  readonly settings: TSettings
  readonly previousResponseId?: string
  readonly contextWindowState?: TContextWindowState
  readonly contextFragments?: readonly TContextFragment[]
}

export interface AssistantConversationProviderToolRevisionInput<
  TConversation,
  TProvider,
  TPackedMessage,
  TProviderTools,
  TProviderToolCall,
  TContext,
  TSettings,
> {
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly provider: TProvider
  readonly conversation: TConversation
  readonly systemPrompt: string
  readonly messages: readonly TPackedMessage[]
  readonly baseContextPrompt: string
  readonly firstOutput: string
  readonly firstReasoningContent?: string
  readonly firstResponseItems?: readonly unknown[]
  readonly firstProviderContentBlocks?: readonly unknown[]
  readonly providerTools?: TProviderTools
  readonly calls: readonly TProviderToolCall[]
  readonly context: TContext
  readonly settings: TSettings
  readonly signal: AbortSignal
}

export interface AssistantConversationMcpRevisionInput<
  TConversation,
  TProvider,
  TPackedMessage,
  TMcpTool,
  TProviderTools,
> {
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly provider: TProvider
  readonly conversation: TConversation
  readonly systemPrompt: string
  readonly messages: readonly TPackedMessage[]
  readonly baseContextPrompt: string
  readonly firstOutput: string
  readonly tools: readonly TMcpTool[]
  readonly providerTools?: TProviderTools
  readonly signal: AbortSignal
}

export interface AssistantConversationFinalizationRuntimeInput<
  TCitation,
  TSource,
  TUsage,
  TProviderToolCall,
  TConversation,
  TContext,
  TProvider,
  TPackedMessage,
  TMcpTool,
  TProviderTools,
  TRemoteCompactMode,
  TContextWindowState,
  TContextFragment,
  TRemoteCompactStrategy,
  TRemoteCompactCapabilityKind,
  TRemoteCompactClassification,
> {
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly result: AssistantConversationFinalizationProviderResult<
    TCitation,
    TUsage,
    TProviderToolCall
  >
  readonly context: TContext
  readonly runtimeConversation: TConversation
  readonly provider: TProvider
  readonly modelTraceId: string
  readonly nativeSearchTraceId: string
  readonly providerWebSearchMode: 'native' | 'off'
  readonly systemPrompt: string
  readonly packedMessages: readonly TPackedMessage[]
  readonly baseContextPrompt: string
  readonly mcpTools: readonly TMcpTool[]
  readonly providerTools?: TProviderTools
  readonly workspaceWritebackHandoff?: AssistantConversationWorkspaceWritebackHandoff
  readonly requestController: AbortController
  readonly chunkFlush: () => void
  readonly upstreamModel: string
  readonly remoteCompactEligible?: boolean
  readonly remoteCompactMode?: TRemoteCompactMode
  readonly remoteCompactStrategy: TRemoteCompactStrategy
  readonly remoteCompactCapabilityKind: TRemoteCompactCapabilityKind
  readonly remoteCompactClassification: TRemoteCompactClassification
  readonly remoteCompactInputTokens?: number
  readonly previousResponseId?: string
  readonly contextWindowState?: TContextWindowState
  readonly contextFragments?: readonly TContextFragment[]
}

export interface AssistantConversationProviderFailureInput<TError> {
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly providerId: string
  readonly modelTraceId: string
  readonly nativeSearchTraceId: string
  readonly providerWebSearchMode: 'native' | 'off'
  readonly credentialGroupId?: string
  readonly error: TError
}

export interface AssistantConversationFinalizationRuntimeDependencies<
  TCitation extends AssistantConversationFinalizationCitationLike,
  TSource,
  TUsage extends AssistantConversationFinalizationUsageLike,
  TProviderToolCall,
  TConversation extends AssistantConversationFinalizationConversationLike<TCitation>,
  TContext extends AssistantConversationFinalizationContextLike<TSource, TPlan, TQuality>,
  TProvider extends AssistantConversationFinalizationProviderLike,
  TPackedMessage,
  TMcpTool,
  TProviderTools,
  TRemoteCompactMode,
  TContextWindowState,
  TContextFragment,
  TPlan,
  TQuality,
  TVerification,
  TSettings,
  TTerminalUsage extends AssistantConversationFinalizationUsageLike,
  TSuccessPlan extends AssistantConversationFinalizationSuccessPlan<TTerminalUsage>,
  TSkipPlan extends AssistantConversationFinalizationSkippedPlan,
  TTrace,
  TProviderError,
  TRemoteCompactStrategy,
  TRemoteCompactCapabilityKind,
  TRemoteCompactClassification,
> {
  /** Acquires the app-owned signal for post-reply work. */
  acquireDetachedWork: (input: {
    readonly conversationId: string
    readonly workId: string
  }) => AssistantConversationDetachedWorkLease
  flushStreamingMessage(conversationId: string, assistantMessageId: string): Promise<void>
  getActiveStream(conversationId: string): { readonly messageId: string } | undefined
  clearActiveStream(conversationId: string): void
  getMessage(
    conversationId: string,
    assistantMessageId: string,
  ): AssistantConversationFinalizationMessageLike<TCitation> | null
  getConversation(conversationId: string): TConversation | undefined
  getSettings(): TSettings
  mergeUsage(base: TUsage | undefined, extra: TUsage | undefined): TUsage | undefined
  verifyInitialGeneration(input: {
    readonly conversationId: string
    readonly assistantMessageId: string
    readonly answer: string
    readonly query: string
    readonly citations: TCitation[]
    readonly quality?: TQuality
  }): TVerification
  hasTaggedToolRequest?(output: string): boolean
  reviseWithProviderTools(input: AssistantConversationProviderToolRevisionInput<
    TConversation,
    TProvider,
    TPackedMessage,
    TProviderTools,
    TProviderToolCall,
    TContext,
    TSettings
  >): Promise<AssistantConversationFinalizationRevision<TUsage> | null | undefined>
  reviseWithMcpTools(input: AssistantConversationMcpRevisionInput<
    TConversation,
    TProvider,
    TPackedMessage,
    TMcpTool,
    TProviderTools
  >): Promise<AssistantConversationFinalizationRevision<TUsage> | null | undefined>
  resolveSupplementalEvidence(input: {
    readonly conversationId: string
    readonly assistantMessageId: string
    readonly conversation: TConversation
    readonly plan?: TPlan
    readonly contextSources: readonly TSource[]
    readonly citations: TCitation[]
    readonly verification: TVerification
    readonly signal: AbortSignal
  }): Promise<AssistantConversationFinalizationSupplementalEvidence<TCitation, TSource>>
  now(): number
  buildSuccessPlan(input: {
    readonly conversation?: TConversation
    readonly message?: TConversation['messages'][number]
    readonly outputText: string
    readonly citations: TCitation[]
    readonly providerUsage?: TUsage
    readonly providerId: string
    readonly model: string
    readonly completedAt: number
  }): TSuccessPlan | TSkipPlan
  recordRemoteCompactCompleted(input: AssistantConversationRemoteCompactRecordBase<
    TSettings,
    TRemoteCompactMode,
    TContextWindowState,
    TContextFragment,
    TRemoteCompactStrategy,
    TRemoteCompactCapabilityKind,
    TRemoteCompactClassification
  > & {
    readonly responseId?: string
    readonly outputTokens?: number
  }): void
  recordRemoteCompactFailed(input: AssistantConversationRemoteCompactRecordBase<
    TSettings,
    TRemoteCompactMode,
    TContextWindowState,
    TContextFragment,
    TRemoteCompactStrategy,
    TRemoteCompactCapabilityKind,
    TRemoteCompactClassification
  > & {
    readonly failureCode: string
    readonly fallbackLocal: true
  }): void
  commitSuccess(input: {
    readonly conversationId: string
    readonly assistantMessageId: string
    readonly projection: TSuccessPlan
  }): void
  finalizeWorkspaceWriteback?(
    input: AssistantConversationWorkspaceWritebackFinalizationInput,
  ): Promise<AssistantConversationWorkspaceWritebackFinalizationOutcome>
  projectWorkspaceWritebackOutcome?(
    projection: AssistantConversationWorkspaceWritebackOutcomeProjection,
  ): void | Promise<void>
  updateProviderCredentialGroupHealth(
    providerId: string,
    credentialGroupId: string | undefined,
    healthy: boolean,
  ): Promise<void>
  recordRagEvaluation(input: {
    readonly conversationId: string
    readonly assistantMessageId: string
    readonly conversationTitle: string
    readonly plan?: TPlan
    readonly quality?: TQuality
    readonly initialSourceCount: number
    readonly finalCitations: readonly TCitation[]
    readonly supplementalSources: readonly TSource[]
    readonly verification: TVerification
  }): void
  buildTrace(input: AssistantConversationFinalizationTraceInput): TTrace
  completeTrace(trace: TTrace): TTrace
  recordTrace(input: {
    readonly conversationId: string
    readonly assistantMessageId: string
    readonly trace: TTrace
  }): void
  getMessageWithStreamingTraceState(
    conversationId: string,
    assistantMessageId: string,
  ): AssistantConversationFinalizationTraceStateLike | null
  settleRunningTraces(input: {
    readonly conversationId: string
    readonly assistantMessageId: string
    readonly fallbackStatus: 'done' | 'skipped'
    readonly fallbackContent: string
  }): void
  translate(
    key: AssistantConversationFinalizationTextKey,
    parameters?: Readonly<Record<string, unknown>>,
  ): string
  extractMemory(input: {
    readonly conversationId: string
    readonly assistantMessageId: string
    readonly messages: TConversation['messages']
    readonly provider: TProvider
    readonly model: string
    readonly signal: AbortSignal
    readonly recordTrace: (trace: TTrace) => void
  }): Promise<unknown>
  projectProviderModelFailure(input: AssistantConversationProviderFailureInput<TProviderError>): void
  projectProviderNativeSearchFailure(input: AssistantConversationProviderFailureInput<TProviderError>): void
  projectProviderTerminalFailure(input: AssistantConversationProviderFailureInput<TProviderError>): void
}

export type AssistantConversationFinalizationOutcome<
  TCitation,
  TSource,
  TUsage,
  TProviderToolCall,
  TVerification,
  TSuccessPlan,
  TSkipPlan,
> =
  | {
      readonly kind: 'completed'
      readonly output: string
      readonly citations: TCitation[]
      readonly result: AssistantConversationFinalizationProviderResult<
        TCitation,
        TUsage,
        TProviderToolCall
      >
      readonly supplementalSources: TSource[]
      readonly verification: TVerification
      readonly projection: TSuccessPlan
    }
  | {
      readonly kind: 'skipped'
      readonly stage: 'initial-message'
      readonly reason: 'message_missing' | 'message_not_streaming'
    }
  | {
      readonly kind: 'skipped'
      readonly stage: 'terminal-projection'
      readonly projection: TSkipPlan
    }

/**
 * Owns success finalization sequencing for an ordinary conversation provider
 * turn. All persistence, tool execution, localization, and product projections
 * remain injected at the composition root.
 */
export function createAssistantConversationFinalizationRuntime<
  TCitation extends AssistantConversationFinalizationCitationLike,
  TSource,
  TUsage extends AssistantConversationFinalizationUsageLike,
  TProviderToolCall,
  TConversation extends AssistantConversationFinalizationConversationLike<TCitation>,
  TContext extends AssistantConversationFinalizationContextLike<TSource, TPlan, TQuality>,
  TProvider extends AssistantConversationFinalizationProviderLike,
  TPackedMessage,
  TMcpTool,
  TProviderTools,
  TRemoteCompactMode,
  TContextWindowState,
  TContextFragment,
  TPlan,
  TQuality,
  TVerification,
  TSettings,
  TTerminalUsage extends AssistantConversationFinalizationUsageLike,
  TSuccessPlan extends AssistantConversationFinalizationSuccessPlan<TTerminalUsage>,
  TSkipPlan extends AssistantConversationFinalizationSkippedPlan,
  TTrace,
  TProviderError,
  TRemoteCompactStrategy,
  TRemoteCompactCapabilityKind,
  TRemoteCompactClassification,
>(
  dependencies: AssistantConversationFinalizationRuntimeDependencies<
    TCitation,
    TSource,
    TUsage,
    TProviderToolCall,
    TConversation,
    TContext,
    TProvider,
    TPackedMessage,
    TMcpTool,
    TProviderTools,
    TRemoteCompactMode,
    TContextWindowState,
    TContextFragment,
    TPlan,
    TQuality,
    TVerification,
    TSettings,
    TTerminalUsage,
    TSuccessPlan,
    TSkipPlan,
    TTrace,
    TProviderError,
    TRemoteCompactStrategy,
    TRemoteCompactCapabilityKind,
    TRemoteCompactClassification
  >,
) {
  async function finalize(
    input: AssistantConversationFinalizationRuntimeInput<
      TCitation,
      TSource,
      TUsage,
      TProviderToolCall,
      TConversation,
      TContext,
      TProvider,
      TPackedMessage,
      TMcpTool,
      TProviderTools,
      TRemoteCompactMode,
      TContextWindowState,
      TContextFragment,
      TRemoteCompactStrategy,
      TRemoteCompactCapabilityKind,
      TRemoteCompactClassification
    >,
  ): Promise<AssistantConversationFinalizationOutcome<
    TCitation,
    TSource,
    TUsage,
    TProviderToolCall,
    TVerification,
    TSuccessPlan,
    TSkipPlan
  >> {
    input.chunkFlush()
    await dependencies.flushStreamingMessage(input.conversationId, input.assistantMessageId)
    clearMatchingActiveStream(input.conversationId, input.assistantMessageId)

    const current = dependencies.getMessage(input.conversationId, input.assistantMessageId)
    if (!current) {
      return { kind: 'skipped', stage: 'initial-message', reason: 'message_missing' }
    }
    if (current.status !== 'streaming') {
      return { kind: 'skipped', stage: 'initial-message', reason: 'message_not_streaming' }
    }

    const firstOutput = input.result.text || current.content
    const firstCitations = input.result.citations?.length
      ? input.result.citations
      : current.citations ?? []
    const verification = dependencies.verifyInitialGeneration({
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      answer: firstOutput,
      query: input.runtimeConversation.messages.at(-1)?.content
        ?? input.runtimeConversation.title,
      citations: firstCitations,
      quality: input.context.quality,
    })

    let finalResult = input.result
    let finalOutput = firstOutput
    let finalCitations = firstCitations
    let supplementalSources: TSource[] = []

    const providerToolCalls = input.result.providerToolCalls
    if (providerToolCalls?.length && !input.requestController.signal.aborted) {
      const revision = await dependencies.reviseWithProviderTools({
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        provider: input.provider,
        conversation: input.runtimeConversation,
        systemPrompt: input.systemPrompt,
        messages: input.packedMessages,
        baseContextPrompt: input.baseContextPrompt,
        firstOutput: finalOutput,
        firstReasoningContent: input.result.reasoningContent,
        firstResponseItems: input.result.responseItems,
        firstProviderContentBlocks: input.result.providerContentBlocks,
        providerTools: input.providerTools,
        calls: providerToolCalls,
        context: input.context,
        settings: dependencies.getSettings(),
        signal: input.requestController.signal,
      })
      if (revision?.text.trim()) {
        finalOutput = revision.text
        finalResult = {
          ...finalResult,
          text: revision.text,
          usage: dependencies.mergeUsage(finalResult.usage, revision.usage),
        }
      }
    }

    const hasTaggedToolFallback = input.mcpTools.length > 0
      || (input.providerTools !== undefined && dependencies.hasTaggedToolRequest?.(finalOutput) === true)
    if (hasTaggedToolFallback && !input.requestController.signal.aborted) {
      const revision = await dependencies.reviseWithMcpTools({
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        provider: input.provider,
        conversation: input.runtimeConversation,
        systemPrompt: input.systemPrompt,
        messages: input.packedMessages,
        baseContextPrompt: input.baseContextPrompt,
        firstOutput: finalOutput,
        tools: input.mcpTools,
        providerTools: input.providerTools,
        signal: input.requestController.signal,
      })
      if (revision?.text.trim()) {
        finalOutput = revision.text
        finalResult = {
          ...finalResult,
          text: revision.text,
          usage: dependencies.mergeUsage(finalResult.usage, revision.usage),
        }
      }
    }

    const supplementalEvidence = await dependencies.resolveSupplementalEvidence({
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      conversation: input.runtimeConversation,
      plan: input.context.plan,
      contextSources: input.context.sources,
      citations: finalCitations,
      verification,
      signal: input.requestController.signal,
    })
    if (supplementalEvidence.status === 'completed') {
      supplementalSources = supplementalEvidence.sources
      finalCitations = supplementalEvidence.citations
      if (supplementalEvidence.evidenceAttached) {
        finalResult = { ...finalResult, citations: finalCitations }
      }
    }

    await dependencies.flushStreamingMessage(input.conversationId, input.assistantMessageId)
    const completedAt = dependencies.now()
    const latest = dependencies.getConversation(input.conversationId)
    const latestAssistantMessage = latest?.messages.find(
      (message) => message.id === input.assistantMessageId,
    )
    const terminalProjection = dependencies.buildSuccessPlan({
      conversation: latest,
      message: latestAssistantMessage
        ? {
            ...latestAssistantMessage,
            citations: current.citations,
            startedAt: current.startedAt,
          }
        : undefined,
      outputText: finalOutput,
      citations: finalCitations,
      providerUsage: finalResult.usage,
      providerId: input.provider.id,
      model: input.runtimeConversation.model,
      completedAt,
    })
    if (terminalProjection.kind === 'skip') {
      return {
        kind: 'skipped',
        stage: 'terminal-projection',
        projection: terminalProjection,
      }
    }

    const terminalUsage = terminalProjection.messagePatch.usage
    if (input.remoteCompactEligible) {
      const messageCount = latest?.messages.filter(
        (message) => message.id !== input.assistantMessageId && message.status !== 'error',
      ).length ?? 0
      const compactRecordBase: AssistantConversationRemoteCompactRecordBase<
        TSettings,
        TRemoteCompactMode,
        TContextWindowState,
        TContextFragment,
        TRemoteCompactStrategy,
        TRemoteCompactCapabilityKind,
        TRemoteCompactClassification
      > = {
        conversationId: input.conversationId,
        providerId: input.provider.id,
        model: input.runtimeConversation.model,
        upstreamModel: input.upstreamModel,
        mode: input.remoteCompactMode ?? 'auto',
        strategy: input.remoteCompactStrategy,
        capabilityKind: input.remoteCompactCapabilityKind,
        remoteClassification: input.remoteCompactClassification,
        inputTokens: input.remoteCompactInputTokens ?? terminalUsage.inputTokens,
        messageCount,
        settings: dependencies.getSettings(),
        previousResponseId: input.previousResponseId,
        contextWindowState: input.contextWindowState,
        contextFragments: input.contextFragments,
      }
      if (finalResult.remoteCompactFallbackUsed) {
        dependencies.recordRemoteCompactFailed({
          ...compactRecordBase,
          failureCode: finalResult.remoteCompactFallbackReason
            ?? 'remote_compact_local_fallback',
          fallbackLocal: true,
        })
      } else {
        dependencies.recordRemoteCompactCompleted({
          ...compactRecordBase,
          responseId: finalResult.responseId,
          outputTokens: finalResult.usage?.outputTokens,
        })
      }
    }

    dependencies.commitSuccess({
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      projection: terminalProjection,
    })
    if (input.workspaceWritebackHandoff && dependencies.finalizeWorkspaceWriteback) {
      let workspaceWritebackProjection: AssistantConversationWorkspaceWritebackOutcomeProjection
      try {
        const workspaceWritebackOutcome = await dependencies.finalizeWorkspaceWriteback({
          handoff: input.workspaceWritebackHandoff,
          finalOutput,
          signal: input.requestController.signal,
        })
        workspaceWritebackProjection = normalizeWorkspaceWritebackOutcome(
          input.workspaceWritebackHandoff,
          workspaceWritebackOutcome,
        )
      } catch {
        // An effect may have committed before the finalizer threw. Preserve an
        // authoritative failed projection without retrying the effect.
        workspaceWritebackProjection = createWorkspaceWritebackProjection(
          input.workspaceWritebackHandoff,
          'failed',
          'thrown',
          { code: 'finalizer_threw' },
        )
      }
      if (dependencies.projectWorkspaceWritebackOutcome) {
        try {
          await dependencies.projectWorkspaceWritebackOutcome(workspaceWritebackProjection)
        } catch {
          // Projection is observational and cannot change writeback authority.
        }
      }
    }
    void dependencies.updateProviderCredentialGroupHealth(
      input.provider.id,
      finalResult.credentialGroupId,
      true,
    ).catch(() => undefined)
    dependencies.recordRagEvaluation({
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      conversationTitle: input.runtimeConversation.title,
      plan: input.context.plan,
      quality: input.context.quality,
      initialSourceCount: input.context.sources.length,
      finalCitations,
      supplementalSources,
      verification,
    })

    const hasFinalOutput = Boolean(finalOutput.trim())
    recordCompleted(input, {
      id: input.modelTraceId,
      type: 'system',
      title: dependencies.translate('chatRunner.trace.modelRequestTitle'),
      content: dependencies.translate(
        hasFinalOutput
          ? 'chatRunner.trace.modelReturnedText'
          : 'chatRunner.trace.modelNoFinalText',
      ),
      status: hasFinalOutput || finalResult.traces?.length ? 'done' : 'error',
      startedAt: current.startedAt ?? dependencies.now(),
      metadata: {
        textLength: finalOutput.length,
        providerUsage: finalResult.usage?.source === 'provider',
      },
    })
    if (input.providerWebSearchMode === 'native') {
      const providerCitationCount = finalCitations.filter(
        (citation) => citation.type === 'web',
      ).length
      const hasProviderSources = providerCitationCount > 0
      recordCompleted(input, {
        id: input.nativeSearchTraceId,
        type: 'search',
        title: dependencies.translate('chatRunner.trace.nativeSearchTitle'),
        content: hasProviderSources
          ? dependencies.translate('chatRunner.trace.nativeSearchSourceCount', {
              count: providerCitationCount,
            })
          : dependencies.translate('chatRunner.trace.nativeSearchNoSources'),
        status: hasProviderSources ? 'done' : 'skipped',
        startedAt: dependencies.getMessageWithStreamingTraceState(
          input.conversationId,
          input.assistantMessageId,
        )?.retrievalTrace?.find((trace) => trace.id === input.nativeSearchTraceId)?.startedAt
          ?? current.startedAt
          ?? dependencies.now(),
        metadata: {
          mode: input.providerWebSearchMode,
          providerCitationCount,
          sourceVerified: hasProviderSources,
        },
      })
    }
    dependencies.settleRunningTraces({
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      fallbackStatus: hasFinalOutput ? 'done' : 'skipped',
      fallbackContent: dependencies.translate(
        hasFinalOutput
          ? 'chatRunner.trace.stepCompletedWithModel'
          : 'chatRunner.trace.stepStoppedNoText',
      ),
    })

    const committedConversation = dependencies.getConversation(input.conversationId)
    if (committedConversation) {
      const detachedWork = dependencies.acquireDetachedWork({
        conversationId: input.conversationId,
        workId: `memory-extraction:${input.assistantMessageId}`,
      })
      const extractionInput = {
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        messages: committedConversation.messages,
        provider: input.provider,
        model: input.upstreamModel,
        signal: detachedWork.signal,
        recordTrace(trace: TTrace) {
          dependencies.recordTrace({
            conversationId: input.conversationId,
            assistantMessageId: input.assistantMessageId,
            trace,
          })
        },
      }

      // Memory extraction is deliberately fire-and-forget. Promise.resolve
      // observes both promise rejection and non-Promise/thenable returns;
      // the synchronous branch covers an extractor that throws before it
      // returns a promise. Either path settles this exact lease once.
      try {
        const extraction = dependencies.extractMemory(extractionInput)
        void Promise.resolve(extraction).then(
          () => detachedWork.release(),
          () => detachedWork.release(),
        )
      } catch {
        detachedWork.release()
      }
    }

    return {
      kind: 'completed',
      output: finalOutput,
      citations: finalCitations,
      result: finalResult,
      supplementalSources,
      verification,
      projection: terminalProjection,
    }
  }

  function failProvider(input: AssistantConversationProviderFailureInput<TProviderError>): void {
    dependencies.projectProviderModelFailure(input)
    if (input.providerWebSearchMode === 'native') {
      dependencies.projectProviderNativeSearchFailure(input)
    }
    dependencies.projectProviderTerminalFailure(input)
    void dependencies.updateProviderCredentialGroupHealth(
      input.providerId,
      input.credentialGroupId,
      false,
    ).catch(() => undefined)
  }

  function clearMatchingActiveStream(conversationId: string, assistantMessageId: string): void {
    if (dependencies.getActiveStream(conversationId)?.messageId === assistantMessageId) {
      dependencies.clearActiveStream(conversationId)
    }
  }

  function recordCompleted(
    input: { readonly conversationId: string; readonly assistantMessageId: string },
    trace: AssistantConversationFinalizationTraceInput,
  ): void {
    dependencies.recordTrace({
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      trace: dependencies.completeTrace(dependencies.buildTrace(trace)),
    })
  }

  return { finalize, failProvider }
}

const WORKSPACE_WRITEBACK_PROJECTION_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/

function normalizeWorkspaceWritebackOutcome(
  handoff: AssistantConversationWorkspaceWritebackHandoff,
  candidate: unknown,
): AssistantConversationWorkspaceWritebackOutcomeProjection {
  const status = readWorkspaceWritebackStatus(candidate)
  if (!status) {
    return createWorkspaceWritebackProjection(
      handoff,
      'unknown',
      'returned',
      { code: 'invalid_outcome' },
    )
  }

  const code = readSafeProjectionCode(candidate)
  const receipt = readRecordProperty(candidate, 'receipt')
  const authorityRevision = status === 'applied'
    || status === 'replayed'
    || status === 'no_changes'
    ? readSafeRevision(candidate, receipt, 'authorityRevision')
    : undefined
  const actualAuthorityRevision = status === 'conflict'
    ? readSafeRevision(candidate, receipt, 'actualAuthorityRevision')
    : undefined

  return createWorkspaceWritebackProjection(handoff, status, 'returned', {
    ...(code ? { code } : {}),
    ...(authorityRevision !== undefined ? { authorityRevision } : {}),
    ...(actualAuthorityRevision !== undefined ? { actualAuthorityRevision } : {}),
  })
}

function createWorkspaceWritebackProjection(
  handoff: AssistantConversationWorkspaceWritebackHandoff,
  status: AssistantConversationWorkspaceWritebackProjectionStatus,
  origin: AssistantConversationWorkspaceWritebackOutcomeProjection['origin'],
  metadata: Pick<
    AssistantConversationWorkspaceWritebackOutcomeProjection,
    'code' | 'authorityRevision' | 'actualAuthorityRevision'
  > = {},
): AssistantConversationWorkspaceWritebackOutcomeProjection {
  return Object.freeze({
    assistantRunId: handoff.assistantRunId,
    conversationId: handoff.conversationId,
    assistantMessageId: handoff.assistantMessageId,
    workspaceId: handoff.workspaceId,
    repositoryAuthorityRevision: handoff.repositoryAuthorityRevision,
    idempotencyKey: handoff.idempotencyKey,
    status,
    origin,
    ...metadata,
  })
}

function readWorkspaceWritebackStatus(
  candidate: unknown,
): AssistantConversationWorkspaceWritebackFinalizationOutcome['status'] | undefined {
  const status = readRecordProperty(candidate, 'status')
  switch (status) {
    case 'applied':
    case 'replayed':
    case 'no_changes':
    case 'conflict':
    case 'cancelled':
    case 'unavailable':
    case 'failed':
      return status
    default:
      return undefined
  }
}

function readSafeProjectionCode(candidate: unknown): string | undefined {
  const code = readRecordProperty(candidate, 'code')
  return typeof code === 'string' && WORKSPACE_WRITEBACK_PROJECTION_CODE_PATTERN.test(code)
    ? code
    : undefined
}

function readSafeRevision(
  candidate: unknown,
  receipt: unknown,
  key: 'authorityRevision' | 'actualAuthorityRevision',
): number | undefined {
  const direct = readRecordProperty(candidate, key)
  if (isNonNegativeSafeInteger(direct)) return direct
  const nested = readRecordProperty(receipt, key)
  return isNonNegativeSafeInteger(nested) ? nested : undefined
}

function readRecordProperty(candidate: unknown, key: string): unknown {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return undefined
  }
  try {
    return (candidate as Readonly<Record<string, unknown>>)[key]
  } catch {
    return undefined
  }
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
