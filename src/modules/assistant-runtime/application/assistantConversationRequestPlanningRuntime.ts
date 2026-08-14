export interface AssistantConversationRequestPlanningProviderLike {
  readonly id: string
  readonly type: unknown
}

export interface AssistantConversationRequestPlanningModelLike {
  readonly contextWindow: number
}

export interface AssistantConversationRequestPlanningConversationLike {
  readonly model: string
  readonly systemPrompt: string
  readonly maxTokens: number
  readonly reasoningEffort?: unknown
  readonly skillSnapshot?: {
    readonly expectedReplyFormat?: string
  }
}

export interface AssistantConversationRequestPlanningSettingsLike {
  readonly language: unknown
  readonly runtimeLogEnabled?: boolean
  readonly runtimeLogMaxBytes?: number
}

export interface AssistantConversationContextRuntimeLike<
  TRetrievalSources,
  TContextSources,
> {
  readonly retrievalSources: TRetrievalSources
  readonly contextSources: TContextSources
  readonly counts: {
    readonly memory: number
    readonly knowledge: number
    readonly web: number
    readonly tools: number
  }
  readonly trace: unknown
}

export interface AssistantConversationNativeSearchAdmissionLike<
  TRequestedMode,
  TWebSearchMode,
> {
  readonly kind: 'admitted' | 'skipped'
  readonly webSearchMode: TWebSearchMode
  readonly requestedMode: TRequestedMode
  readonly nativeSearchSupported: boolean
  readonly displayState: 'requested' | 'attachments_blocked' | 'disabled'
  readonly reason?: string
}

export interface AssistantConversationCompactDecisionLike<TCompactMode> {
  readonly mode: TCompactMode
  readonly enabled: boolean
  readonly required: boolean
  readonly supported: boolean
  readonly reason: AssistantConversationCompactDecisionReason
  readonly pressureRatio: number
  readonly strategy?: AssistantConversationContextManagementStrategy
  readonly nativeServerCompact?: boolean
}

export type AssistantConversationContextManagementStrategy =
  | 'native-openai-responses'
  | 'native-anthropic-messages'
  | 'application-model-summary'
  | 'local-structured-v2'
  | 'none'

export type AssistantConversationCompactDecisionReason =
  | 'disabled'
  | 'supported'
  | 'below_threshold'
  | 'provider_capability_missing'
  | 'application_model_summary'
  | 'native_openai_responses'
  | 'native_anthropic_messages'

export type AssistantConversationCompressionStrategy =
  | 'none'
  | 'structured-v2'
  | 'single-message-truncation'
  | 'application-model-summary'

export type AssistantConversationCompressionTriggerReason =
  | 'message_budget_exceeded'
  | 'single_message_budget_exceeded'
  | 'disabled_or_unneeded'

export interface AssistantConversationCompressionRoleCounts {
  readonly user: number
  readonly assistant: number
}

export interface AssistantConversationCompressionSectionMetadata {
  readonly id: 'constraints' | 'decisions' | 'failures' | 'actions' | 'references' | 'recent'
  readonly title: string
  readonly itemCount: number
}

export interface AssistantConversationCompressionMetadataLike {
  readonly schemaVersion: 2
  readonly strategy: AssistantConversationCompressionStrategy
  readonly triggerReason: AssistantConversationCompressionTriggerReason
  readonly sourceMessageCount: number
  readonly keptMessageCount: number
  readonly sourceRoleCounts: AssistantConversationCompressionRoleCounts
  readonly keptRoleCounts: AssistantConversationCompressionRoleCounts
  readonly sourceTokens: number
  readonly compressedTokens: number
  readonly estimatedSavedTokens: number
  readonly compressionRatio: number
  readonly summaryTokenBudget: number
  readonly summaryTokens: number
  readonly summarySectionCount: number
  readonly summaryItemCount: number
  readonly summarySections: AssistantConversationCompressionSectionMetadata[]
}

export interface AssistantConversationActivePromptLike<TPromptMessage> {
  readonly messages: readonly TPromptMessage[]
  readonly contextPrompt: string
  readonly estimatedInputTokens: number
  readonly budgetTokens: number
  readonly trimmedCount: number
  readonly fixedTokens: number
  readonly messageTokens: number
  readonly modelBudgetTokens: number
  readonly reservedOutputTokens: number
  readonly reasoningReserveTokens: number
  readonly compressionTriggered: boolean
  readonly truncatedSingleMessage: boolean
  readonly compressionMetadata: AssistantConversationCompressionMetadataLike
}

export interface AssistantConversationRemoteCompactProbeLike {
  readonly estimatedInputTokens: number
  readonly messages: readonly { readonly role: string; readonly content: string }[]
  readonly contextPrompt: string
}

export interface AssistantConversationContextFragmentLike {
  readonly schema: unknown
  readonly id: unknown
  readonly type: unknown
  readonly priority: unknown
  readonly sourceId: unknown
  readonly sourceHash?: unknown
  readonly sourceVersion: unknown
  readonly tokenCap: unknown
  readonly estimatedTokens: unknown
  readonly originalEstimatedTokens: unknown
  readonly included: unknown
  readonly capped: unknown
  readonly exclusionReason?: unknown
  readonly cache: unknown
  readonly trace: unknown
}

export interface AssistantConversationContextPlanLike<
  TActivePrompt,
  TRemoteCompactProbe,
  TCompactDecision,
  TContextFragment extends AssistantConversationContextFragmentLike,
> {
  readonly packed: TActivePrompt
  readonly remoteCompactProbe: TRemoteCompactProbe
  readonly compactDecision: TCompactDecision
  readonly fragments: readonly TContextFragment[]
  readonly trace: unknown
}

export interface AssistantConversationPreviousCompactStateLike<TPreviousFragment> {
  readonly previousResponseId?: string
  readonly previousFragments?: readonly TPreviousFragment[]
}

export interface AssistantConversationCompactUsageInput<TCompactMode> {
  readonly mode: TCompactMode
  readonly providerId: string
  readonly model: string
  readonly upstreamModel: string
  readonly decisionReason: AssistantConversationCompactDecisionReason
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly estimatedSavedTokens?: number
  readonly localSourceTokens?: number
  readonly localCompressedTokens?: number
  readonly localEstimatedSavedTokens?: number
  readonly localCompressionRatio?: number
  readonly localCompressionSchemaVersion?: 2
  readonly localCompressionStrategy?: AssistantConversationCompressionStrategy
  readonly localCompressionTriggerReason?: AssistantConversationCompressionTriggerReason
  readonly localSourceMessageCount?: number
  readonly localKeptMessageCount?: number
  readonly localSourceRoleCounts?: AssistantConversationCompressionRoleCounts
  readonly localKeptRoleCounts?: AssistantConversationCompressionRoleCounts
  readonly localSummaryTokenBudget?: number
  readonly localSummaryTokens?: number
  readonly localSummarySectionCount?: number
  readonly localSummaryItemCount?: number
  readonly localSummarySections?: AssistantConversationCompressionSectionMetadata[]
  readonly failureCode?: string
  readonly fallbackLocal: boolean
  readonly lastCompactSummary?: string
}

export interface AssistantConversationCompactUsageRecordLike<TCompactMode> {
  readonly mode: TCompactMode
  readonly decisionReason?: string
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly estimatedSavedTokens?: number
  readonly localSourceTokens?: number
  readonly localCompressedTokens?: number
  readonly localEstimatedSavedTokens?: number
  readonly localCompressionRatio?: number
  readonly localCompressionSchemaVersion?: unknown
  readonly localCompressionStrategy?: unknown
  readonly localCompressionTriggerReason?: unknown
  readonly localSourceMessageCount?: number
  readonly localKeptMessageCount?: number
  readonly localSourceRoleCounts?: unknown
  readonly localKeptRoleCounts?: unknown
  readonly localSummaryTokenBudget?: number
  readonly localSummaryTokens?: number
  readonly localSummarySectionCount?: number
  readonly localSummaryItemCount?: number
  readonly localSummarySections?: unknown
  readonly failureCode?: string
  readonly fallbackLocal?: boolean
}

export interface AssistantConversationRequestPlanningTraceInput {
  readonly id: string
  readonly type: 'search' | 'system'
  readonly title: string
  readonly content: string
  readonly status: 'running' | 'skipped' | 'done' | 'error'
  readonly startedAt: number
  readonly metadata: Readonly<Record<string, unknown>>
}

export type AssistantConversationRequestPlanningTextKey =
  | 'chatRunner.trace.nativeSearchTitle'
  | 'chatRunner.trace.nativeSearchRequested'
  | 'chatRunner.trace.nativeSearchSkippedForAttachments'
  | 'chatRunner.trace.nativeSearchDisabled'
  | 'chatRunner.trace.compactPolicyTitle'
  | 'chatRunner.trace.compactRemoteEligible'
  | 'chatRunner.trace.compactApplicationSummaryApplied'
  | 'chatRunner.trace.compactApplicationSummaryFallback'
  | 'chatRunner.error.remoteCompactRequiredFailed'
  | 'chatRunner.trace.contextPackTitle'
  | 'chatRunner.trace.contextPackContent'

export interface AssistantConversationRequestPlanningInput<
  TRetrievedContext,
  TWebSources,
  TWorkspaceContext,
  TProvider,
  TModel,
  TRequestedSearchMode,
  TAttachment,
  TConversation,
  TSettings,
  TSourceMessage,
> {
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly retrievedContext: TRetrievedContext
  readonly webSources: TWebSources
  readonly mcpPrompt: string
  readonly mcpToolCount: number
  readonly workspaceContext?: TWorkspaceContext
  readonly provider: TProvider
  readonly modelConfig: TModel
  readonly requestedSearchMode: TRequestedSearchMode
  readonly sendableAttachments: readonly TAttachment[]
  readonly runtimeConversation: TConversation
  readonly settings: TSettings
  readonly sourceMessages: readonly TSourceMessage[]
  readonly lastUserMessage?: { readonly content?: string }
  readonly providerToolCount: number
  readonly upstreamModel: string
}

export interface AssistantConversationRequestPlanningRuntimeEvent {
  readonly event: 'context.compact.decided' | 'context.compact.completed'
  readonly conversationId: string
  readonly providerId: string
  readonly model: string
  readonly data: Readonly<Record<string, unknown>>
  readonly legacyEvent: 'compact.request' | 'compact.usage'
  readonly legacyData: Readonly<Record<string, unknown>>
  readonly options: {
    readonly enabled?: boolean
    readonly maxBytes?: number
  }
}

export interface AssistantConversationRequestPlanningRuntimeDependencies<
  TRetrievedContext,
  TWebSources,
  TWorkspaceContext,
  TProvider extends AssistantConversationRequestPlanningProviderLike,
  TModel extends AssistantConversationRequestPlanningModelLike,
  TRequestedSearchMode,
  TWebSearchMode,
  TAttachment,
  TConversation extends AssistantConversationRequestPlanningConversationLike,
  TSettings extends AssistantConversationRequestPlanningSettingsLike,
  TSourceMessage,
  TRetrievalSources,
  TContextSources,
  TContextRuntime extends AssistantConversationContextRuntimeLike<
    TRetrievalSources,
    TContextSources
  >,
  TNativeSearchAdmission extends AssistantConversationNativeSearchAdmissionLike<
    TRequestedSearchMode,
    TWebSearchMode
  >,
  TPreviousFragment,
  TPreviousState extends AssistantConversationPreviousCompactStateLike<TPreviousFragment>,
  TPromptMessage,
  TActivePrompt extends AssistantConversationActivePromptLike<TPromptMessage>,
  TRemoteCompactProbe extends AssistantConversationRemoteCompactProbeLike,
  TCompactMode,
  TCompactDecision extends AssistantConversationCompactDecisionLike<TCompactMode>,
  TContextFragment extends AssistantConversationContextFragmentLike,
  TContextPlan extends AssistantConversationContextPlanLike<
    TActivePrompt,
    TRemoteCompactProbe,
    TCompactDecision,
    TContextFragment
  >,
  TCompactRecord extends AssistantConversationCompactUsageRecordLike<TCompactMode>,
  TTrace,
> {
  assembleContext(input: {
    readonly retrievedContext: TRetrievedContext
    readonly webSources: TWebSources
    readonly mcpPrompt: string
    readonly mcpToolCount: number
    readonly workspaceContext?: TWorkspaceContext
  }): TContextRuntime
  admitNativeSearch(input: {
    readonly provider: TProvider
    readonly modelConfig: TModel
    readonly requestedMode: TRequestedSearchMode
    readonly hasAttachments: boolean
  }): TNativeSearchAdmission
  resolveUsesOpenAIResponses?(input: {
    readonly provider: TProvider
    readonly model: string
    readonly webSearchMode: TWebSearchMode
    readonly attachments: readonly TAttachment[]
  }): boolean
  buildSystemPrompt(input: {
    readonly baseSystemPrompt: string
    readonly expectedReplyFormat?: string
    readonly language: TSettings['language']
    readonly modelConfig: TModel
    readonly provider: TProvider
    readonly hasMemory: boolean
    readonly hasKnowledge: boolean
    readonly hasWeb: boolean
    readonly retrievalSources: TRetrievalSources
  }): string
  resolvePreviousCompactState(input: {
    readonly conversationId: string
    readonly providerId: string
    readonly provider: TProvider
    readonly model: string
    readonly usesOpenAIResponses?: boolean
    readonly settings: TSettings
  }): Promise<TPreviousState>
  planContext(input: {
    readonly messages: readonly TSourceMessage[]
    readonly contextSources: TContextSources
    readonly draft: {
      readonly text?: string
      readonly requestedOutput?: string
    }
    readonly modelContextWindow: number
    readonly maxOutputTokens: number
    readonly modelManifest: TModel
    readonly systemPrompt: string
    readonly reasoningEffort?: unknown
    readonly provider: TProvider
    readonly providerType: TProvider['type']
    readonly model: string
    readonly usesOpenAIResponses?: boolean
    readonly settings: TSettings
    readonly retrievalSources: TRetrievalSources
    readonly memorySourceCount: number
    readonly attachmentCount: number
    readonly toolOutputCount: number
    readonly previousResponseId?: string
    readonly previousFragments?: readonly TPreviousFragment[]
  }): TContextPlan
  /**
   * Optional: selected-model application summary for non-native providers.
   * On failure return ok:false; planning keeps structured-v2 packed messages.
   */
  runApplicationContextSummary?(input: {
    readonly provider: TProvider
    readonly model: string
    readonly messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>
    readonly contextPrompt?: string
    readonly settings: TSettings
    readonly signal?: AbortSignal
    readonly conversationId: string
  }): Promise<{
    readonly ok: boolean
    readonly summary: string
    readonly contextPrompt: string
    readonly recentMessages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>
    readonly olderMessageCount: number
    readonly failureReason?: string
    readonly failureCode?: string
    readonly durationMs?: number
    readonly timeoutMs?: number
    readonly estimatedInputChars?: number
    readonly summaryChars?: number
    readonly estimatedSavedChars?: number
  }>
  emitRuntimeEvent(input: AssistantConversationRequestPlanningRuntimeEvent): Promise<unknown>
  recordCompactUsage(input: AssistantConversationCompactUsageInput<TCompactMode>): TCompactRecord
  traceId(prefix: 'native-search' | 'compact' | 'context-pack'): string
  now(): number
  translate(
    key: AssistantConversationRequestPlanningTextKey,
    parameters?: Readonly<Record<string, unknown>>,
  ): string
  buildTrace(input: AssistantConversationRequestPlanningTraceInput): TTrace
  completeTrace(trace: TTrace): TTrace
  recordTrace(input: {
    readonly conversationId: string
    readonly assistantMessageId: string
    readonly trace: TTrace
  }): void
  projectTerminalFailure(input: {
    readonly conversationId: string
    readonly assistantMessageId: string
    readonly content: string
    readonly errorCode: 'unknown'
    readonly providerId: string
  }): void
}

export type AssistantConversationRequestPlanningOutcome<
  TRetrievalSources,
  TWebSearchMode,
  TPreviousState,
  TCompactDecision,
  TRemoteCompactProbe,
  TCompactRecord,
  TContextPlan,
  TContextRuntime,
  TActivePrompt,
> =
  | {
      readonly kind: 'failed'
      readonly reason: 'remote_compact_required_unsupported'
      readonly nativeSearchTraceId: string
      readonly providerWebSearchMode: TWebSearchMode
    }
  | {
      readonly kind: 'planned'
      readonly systemPrompt: string
      readonly activePrompt: TActivePrompt
      readonly retrievalSources: TRetrievalSources
      readonly providerWebSearchMode: TWebSearchMode
      readonly nativeSearchTraceId: string
      readonly previousCompactState: TPreviousState
      readonly previousResponseId?: string
      readonly compactDecision: TCompactDecision
      readonly remoteCompactProbe: TRemoteCompactProbe
      readonly compactRecord: TCompactRecord
      readonly contextPlan: TContextPlan
      readonly contextRuntime: TContextRuntime
    }

/**
 * Owns ordinary conversation context contribution assembly, native-search
 * admission, compact policy accounting, and request-plan projection while all
 * concrete builders and effects remain injected by bootstrap.
 */
export function createAssistantConversationRequestPlanningRuntime<
  TRetrievedContext,
  TWebSources,
  TWorkspaceContext,
  TProvider extends AssistantConversationRequestPlanningProviderLike,
  TModel extends AssistantConversationRequestPlanningModelLike,
  TRequestedSearchMode,
  TWebSearchMode,
  TAttachment,
  TConversation extends AssistantConversationRequestPlanningConversationLike,
  TSettings extends AssistantConversationRequestPlanningSettingsLike,
  TSourceMessage,
  TRetrievalSources,
  TContextSources,
  TContextRuntime extends AssistantConversationContextRuntimeLike<
    TRetrievalSources,
    TContextSources
  >,
  TNativeSearchAdmission extends AssistantConversationNativeSearchAdmissionLike<
    TRequestedSearchMode,
    TWebSearchMode
  >,
  TPreviousFragment,
  TPreviousState extends AssistantConversationPreviousCompactStateLike<TPreviousFragment>,
  TPromptMessage,
  TActivePrompt extends AssistantConversationActivePromptLike<TPromptMessage>,
  TRemoteCompactProbe extends AssistantConversationRemoteCompactProbeLike,
  TCompactMode,
  TCompactDecision extends AssistantConversationCompactDecisionLike<TCompactMode>,
  TContextFragment extends AssistantConversationContextFragmentLike,
  TContextPlan extends AssistantConversationContextPlanLike<
    TActivePrompt,
    TRemoteCompactProbe,
    TCompactDecision,
    TContextFragment
  >,
  TCompactRecord extends AssistantConversationCompactUsageRecordLike<TCompactMode>,
  TTrace,
>(
  dependencies: AssistantConversationRequestPlanningRuntimeDependencies<
    TRetrievedContext,
    TWebSources,
    TWorkspaceContext,
    TProvider,
    TModel,
    TRequestedSearchMode,
    TWebSearchMode,
    TAttachment,
    TConversation,
    TSettings,
    TSourceMessage,
    TRetrievalSources,
    TContextSources,
    TContextRuntime,
    TNativeSearchAdmission,
    TPreviousFragment,
    TPreviousState,
    TPromptMessage,
    TActivePrompt,
    TRemoteCompactProbe,
    TCompactMode,
    TCompactDecision,
    TContextFragment,
    TContextPlan,
    TCompactRecord,
    TTrace
  >,
) {
  async function plan(
    input: AssistantConversationRequestPlanningInput<
      TRetrievedContext,
      TWebSources,
      TWorkspaceContext,
      TProvider,
      TModel,
      TRequestedSearchMode,
      TAttachment,
      TConversation,
      TSettings,
      TSourceMessage
    >,
  ): Promise<AssistantConversationRequestPlanningOutcome<
    TRetrievalSources,
    TWebSearchMode,
    TPreviousState,
    TCompactDecision,
    TRemoteCompactProbe,
    TCompactRecord,
    TContextPlan,
    TContextRuntime,
    TActivePrompt
  >> {
    const contextRuntime = dependencies.assembleContext({
      retrievedContext: input.retrievedContext,
      webSources: input.webSources,
      mcpPrompt: input.mcpPrompt,
      mcpToolCount: input.mcpToolCount,
      workspaceContext: input.workspaceContext,
    })
    const retrievalSources = contextRuntime.retrievalSources
    const nativeSearchAdmission = dependencies.admitNativeSearch({
      provider: input.provider,
      modelConfig: input.modelConfig,
      requestedMode: input.requestedSearchMode,
      hasAttachments: input.sendableAttachments.length > 0,
    })
    const providerWebSearchMode = nativeSearchAdmission.webSearchMode
    const usesOpenAIResponses = dependencies.resolveUsesOpenAIResponses?.({
      provider: input.provider,
      model: input.upstreamModel,
      webSearchMode: providerWebSearchMode,
      attachments: input.sendableAttachments,
    })
    const nativeSearchTraceId = dependencies.traceId('native-search')
    recordCompleted(input, {
      id: nativeSearchTraceId,
      type: 'search',
      title: dependencies.translate('chatRunner.trace.nativeSearchTitle'),
      content: nativeSearchAdmission.displayState === 'requested'
        ? dependencies.translate('chatRunner.trace.nativeSearchRequested')
        : nativeSearchAdmission.displayState === 'attachments_blocked'
          ? dependencies.translate('chatRunner.trace.nativeSearchSkippedForAttachments')
          : dependencies.translate('chatRunner.trace.nativeSearchDisabled'),
      status: nativeSearchAdmission.kind === 'admitted' ? 'running' : 'skipped',
      startedAt: dependencies.now(),
      metadata: {
        mode: providerWebSearchMode,
        requestedMode: nativeSearchAdmission.requestedMode,
        nativeSearchSupported: nativeSearchAdmission.nativeSearchSupported,
        ...(nativeSearchAdmission.reason ? { reason: nativeSearchAdmission.reason } : {}),
      },
    })

    const systemPrompt = dependencies.buildSystemPrompt({
      baseSystemPrompt: input.runtimeConversation.systemPrompt,
      expectedReplyFormat: input.runtimeConversation.skillSnapshot?.expectedReplyFormat,
      language: input.settings.language,
      modelConfig: input.modelConfig,
      provider: input.provider,
      hasMemory: contextRuntime.counts.memory > 0,
      hasKnowledge: contextRuntime.counts.knowledge > 0,
      hasWeb: contextRuntime.counts.web > 0 || providerWebSearchMode === 'native',
      retrievalSources,
    })
    const previousCompactState = await dependencies.resolvePreviousCompactState({
      conversationId: input.conversationId,
      providerId: input.provider.id,
      provider: input.provider,
      model: input.runtimeConversation.model,
      ...(usesOpenAIResponses === undefined ? {} : { usesOpenAIResponses }),
      settings: input.settings,
    })
    const contextPlan = dependencies.planContext({
      messages: input.sourceMessages,
      contextSources: contextRuntime.contextSources,
      draft: {
        text: input.lastUserMessage?.content,
        requestedOutput: input.runtimeConversation.skillSnapshot?.expectedReplyFormat,
      },
      modelContextWindow: input.modelConfig.contextWindow,
      maxOutputTokens: input.runtimeConversation.maxTokens,
      modelManifest: input.modelConfig,
      systemPrompt,
      reasoningEffort: input.runtimeConversation.reasoningEffort,
      provider: input.provider,
      providerType: input.provider.type,
      model: input.upstreamModel,
      ...(usesOpenAIResponses === undefined ? {} : { usesOpenAIResponses }),
      settings: input.settings,
      retrievalSources,
      memorySourceCount: contextRuntime.counts.memory,
      attachmentCount: input.sendableAttachments.length,
      toolOutputCount: contextRuntime.counts.tools + input.providerToolCount,
      previousResponseId: previousCompactState.previousResponseId,
      previousFragments: previousCompactState.previousFragments,
    })
    const remoteCompactProbe = contextPlan.remoteCompactProbe
    const compactDecision = contextPlan.compactDecision
    let activePrompt = contextPlan.packed
    let applicationSummaryApplied = false
    let applicationSummaryFailure: string | undefined
    let applicationSummaryFailureCode: string | undefined
    let applicationSummaryDurationMs: number | undefined
    let applicationSummaryTimeoutMs: number | undefined
    let applicationSummaryChars: number | undefined
    let applicationSummaryInputChars: number | undefined

    if (
      compactDecision.enabled
      && compactDecision.strategy === 'application-model-summary'
      && !compactDecision.nativeServerCompact
      && dependencies.runApplicationContextSummary
    ) {
      const summaryTraceId = dependencies.traceId('compact')
      const summaryStartedAt = dependencies.now()
      recordCompleted(input, {
        id: summaryTraceId,
        type: 'system',
        title: dependencies.translate('chatRunner.trace.compactPolicyTitle'),
        content: 'application-model-summary',
        status: 'running',
        startedAt: summaryStartedAt,
        metadata: {
          compactMode: 'application',
          strategy: 'application-model-summary',
          pressureRatio: compactDecision.pressureRatio,
        },
      })

      const transcript = toApplicationSummaryMessages(remoteCompactProbe.messages)
      const summaryResult = await dependencies.runApplicationContextSummary({
        provider: input.provider,
        model: input.upstreamModel,
        messages: transcript,
        contextPrompt: remoteCompactProbe.contextPrompt,
        settings: input.settings,
        conversationId: input.conversationId,
      })
      applicationSummaryDurationMs = summaryResult.durationMs
      applicationSummaryTimeoutMs = summaryResult.timeoutMs
      applicationSummaryInputChars = summaryResult.estimatedInputChars
      applicationSummaryChars = summaryResult.summaryChars

      if (summaryResult.ok && summaryResult.summary) {
        applicationSummaryApplied = true
        const estimatedInputTokens = estimatePromptTokens(summaryResult)
        const summaryTokens = Math.ceil((summaryResult.summaryChars ?? summaryResult.summary.length) / 4)
        activePrompt = {
          ...activePrompt,
          messages: summaryResult.recentMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })) as unknown as TActivePrompt['messages'],
          contextPrompt: summaryResult.contextPrompt,
          estimatedInputTokens,
          compressionTriggered: true,
          compressionMetadata: {
            ...activePrompt.compressionMetadata,
            strategy: 'application-model-summary',
            triggerReason: 'message_budget_exceeded',
            sourceMessageCount: summaryResult.olderMessageCount + summaryResult.recentMessages.length,
            keptMessageCount: summaryResult.recentMessages.length,
            sourceTokens: remoteCompactProbe.estimatedInputTokens,
            compressedTokens: estimatedInputTokens,
            estimatedSavedTokens: Math.max(
              0,
              remoteCompactProbe.estimatedInputTokens - estimatedInputTokens,
            ),
            compressionRatio:
              remoteCompactProbe.estimatedInputTokens > 0
                ? estimatedInputTokens / remoteCompactProbe.estimatedInputTokens
                : 0,
            summaryTokens,
            summaryTokenBudget: summaryTokens,
            summarySectionCount: 1,
            summaryItemCount: 1,
          },
        } as TActivePrompt
        recordCompleted(input, {
          id: `${summaryTraceId}-done`,
          type: 'system',
          title: dependencies.translate('chatRunner.trace.compactPolicyTitle'),
          content: dependencies.translate('chatRunner.trace.compactApplicationSummaryApplied'),
          status: 'done',
          startedAt: summaryStartedAt,
          metadata: {
            compactMode: 'application',
            strategy: 'application-model-summary',
            durationMs: summaryResult.durationMs,
            timeoutMs: summaryResult.timeoutMs,
            olderMessageCount: summaryResult.olderMessageCount,
            recentMessageCount: summaryResult.recentMessages.length,
            summaryChars: summaryResult.summaryChars,
            estimatedInputChars: summaryResult.estimatedInputChars,
            estimatedSavedChars: summaryResult.estimatedSavedChars,
            estimatedSavedTokens: activePrompt.compressionMetadata.estimatedSavedTokens,
          },
        })
      } else {
        applicationSummaryFailure = summaryResult.failureReason ?? 'application_summary_failed'
        applicationSummaryFailureCode = summaryResult.failureCode ?? 'provider_error'
        // Keep structured-v2 packed activePrompt from contextPlan.
        recordCompleted(input, {
          id: `${summaryTraceId}-fallback`,
          type: 'system',
          title: dependencies.translate('chatRunner.trace.compactPolicyTitle'),
          content: dependencies.translate('chatRunner.trace.compactApplicationSummaryFallback'),
          status: 'done',
          startedAt: summaryStartedAt,
          metadata: {
            compactMode: 'local',
            strategy: 'structured-v2',
            applicationSummaryFailed: true,
            failureCode: applicationSummaryFailureCode,
            failureReason: applicationSummaryFailure,
            durationMs: summaryResult.durationMs,
            timeoutMs: summaryResult.timeoutMs,
            fallbackLocal: true,
          },
        })
      }
    }

    const compactRequestLogData = {
      conversationId: input.conversationId,
      providerId: input.provider.id,
      model: input.runtimeConversation.model,
      upstreamModel: input.upstreamModel,
      mode: compactDecision.mode,
      enabled: compactDecision.enabled,
      required: compactDecision.required,
      supported: compactDecision.supported,
      reason: compactDecision.reason,
      pressureRatio: compactDecision.pressureRatio,
      strategy: compactDecision.strategy,
      nativeServerCompact: compactDecision.nativeServerCompact === true,
      applicationSummaryApplied,
      ...(applicationSummaryFailure ? { applicationSummaryFailure } : {}),
      ...(applicationSummaryFailureCode ? { applicationSummaryFailureCode } : {}),
      ...(applicationSummaryDurationMs !== undefined ? { applicationSummaryDurationMs } : {}),
      ...(applicationSummaryTimeoutMs !== undefined ? { applicationSummaryTimeoutMs } : {}),
    }
    observeEvent({
      event: 'context.compact.decided',
      conversationId: input.conversationId,
      providerId: input.provider.id,
      model: input.runtimeConversation.model,
      data: compactRequestLogData,
      legacyEvent: 'compact.request',
      legacyData: compactRequestLogData,
      options: runtimeLogOptions(input.settings),
    })

    const compression = activePrompt.compressionMetadata
    const compactRecord = dependencies.recordCompactUsage({
      mode: compactDecision.mode,
      providerId: input.provider.id,
      model: input.runtimeConversation.model,
      upstreamModel: input.upstreamModel,
      decisionReason: compactDecision.reason,
      inputTokens: compactDecision.enabled ? remoteCompactProbe.estimatedInputTokens : undefined,
      outputTokens: applicationSummaryApplied
        ? Math.ceil((applicationSummaryChars ?? 0) / 4)
        : undefined,
      estimatedSavedTokens: activePrompt.compressionTriggered
        ? compression.estimatedSavedTokens
        : undefined,
      localSourceTokens: activePrompt.compressionTriggered ? compression.sourceTokens : undefined,
      localCompressedTokens: activePrompt.compressionTriggered ? compression.compressedTokens : undefined,
      localEstimatedSavedTokens: activePrompt.compressionTriggered
        ? compression.estimatedSavedTokens
        : undefined,
      localCompressionRatio: activePrompt.compressionTriggered
        ? compression.compressionRatio
        : undefined,
      localCompressionSchemaVersion: activePrompt.compressionTriggered
        ? compression.schemaVersion
        : undefined,
      localCompressionStrategy: activePrompt.compressionTriggered
        ? compression.strategy
        : undefined,
      localCompressionTriggerReason: activePrompt.compressionTriggered
        ? compression.triggerReason
        : undefined,
      localSourceMessageCount: activePrompt.compressionTriggered
        ? compression.sourceMessageCount
        : undefined,
      localKeptMessageCount: activePrompt.compressionTriggered
        ? compression.keptMessageCount
        : undefined,
      localSourceRoleCounts: activePrompt.compressionTriggered
        ? compression.sourceRoleCounts
        : undefined,
      localKeptRoleCounts: activePrompt.compressionTriggered
        ? compression.keptRoleCounts
        : undefined,
      localSummaryTokenBudget: activePrompt.compressionTriggered
        ? compression.summaryTokenBudget
        : undefined,
      localSummaryTokens: activePrompt.compressionTriggered
        ? compression.summaryTokens
        : undefined,
      localSummarySectionCount: activePrompt.compressionTriggered
        ? compression.summarySectionCount
        : undefined,
      localSummaryItemCount: activePrompt.compressionTriggered
        ? compression.summaryItemCount
        : undefined,
      localSummarySections: activePrompt.compressionTriggered
        ? compression.summarySections
        : undefined,
      lastCompactSummary: applicationSummaryApplied
        ? `application-model-summary chars=${applicationSummaryChars ?? 0}`
        : undefined,
      failureCode: compactDecision.required && !compactDecision.supported
        ? 'provider_capability_missing'
        : applicationSummaryFailureCode,
      fallbackLocal: Boolean(
        (compactDecision.mode === 'auto' && !compactDecision.enabled && activePrompt.compressionTriggered)
        || (applicationSummaryFailure && activePrompt.compressionTriggered),
      ),
    })
    const compactUsageLogData = {
      ...compactUsageLog(input, compactRecord),
      strategy: compactDecision.strategy,
      nativeServerCompact: compactDecision.nativeServerCompact === true,
      applicationSummaryApplied,
      applicationSummaryDurationMs,
      applicationSummaryTimeoutMs,
      applicationSummaryChars,
      applicationSummaryInputChars,
      ...(applicationSummaryFailureCode ? { applicationSummaryFailureCode } : {}),
    }
    observeEvent({
      event: 'context.compact.completed',
      conversationId: input.conversationId,
      providerId: input.provider.id,
      model: input.runtimeConversation.model,
      data: compactUsageLogData,
      legacyEvent: 'compact.usage',
      legacyData: compactUsageLogData,
      options: runtimeLogOptions(input.settings),
    })

    const compactModeLabel = compactDecision.enabled && compactDecision.nativeServerCompact
      ? 'remote'
      : applicationSummaryApplied
        ? 'application'
        : activePrompt.compressionTriggered
          ? 'local'
          : 'off'
    const compactContent = compactDecision.enabled && compactDecision.nativeServerCompact
      ? dependencies.translate('chatRunner.trace.compactRemoteEligible')
      : applicationSummaryApplied
        ? dependencies.translate('chatRunner.trace.compactApplicationSummaryApplied')
        : applicationSummaryFailure
          ? dependencies.translate('chatRunner.trace.compactApplicationSummaryFallback')
          : compactDecision.reason

    recordCompleted(input, {
      id: dependencies.traceId('compact'),
      type: 'system',
      title: dependencies.translate('chatRunner.trace.compactPolicyTitle'),
      content: compactContent,
      status: compactDecision.required && !compactDecision.supported ? 'error' : 'done',
      startedAt: dependencies.now(),
      metadata: {
        compactMode: compactModeLabel,
        remoteCompactMode: compactDecision.mode,
        strategy: compactDecision.strategy,
        nativeServerCompact: compactDecision.nativeServerCompact === true,
        supported: compactDecision.supported,
        reason: compactDecision.reason,
        pressureRatio: compactDecision.pressureRatio,
        inputTokens: compactRecord.inputTokens,
        outputTokens: compactRecord.outputTokens,
        estimatedSavedTokens: compactRecord.estimatedSavedTokens ?? compactRecord.localEstimatedSavedTokens,
        failureCode: compactRecord.failureCode,
        fallbackLocal: compactRecord.fallbackLocal,
        applicationSummaryApplied,
        applicationSummaryDurationMs,
        applicationSummaryTimeoutMs,
        applicationSummaryChars,
        applicationSummaryInputChars,
        ...(applicationSummaryFailure ? { applicationSummaryFailure } : {}),
        contextRuntime: contextRuntime.trace,
        contextPlanner: contextPlan.trace,
        contextFragments: contextPlan.fragments.map(projectContextFragment),
      },
    })
    if (compactDecision.required && !compactDecision.supported) {
      dependencies.projectTerminalFailure({
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        content: dependencies.translate('chatRunner.error.remoteCompactRequiredFailed'),
        errorCode: 'unknown',
        providerId: input.provider.id,
      })
      return {
        kind: 'failed',
        reason: 'remote_compact_required_unsupported',
        nativeSearchTraceId,
        providerWebSearchMode,
      }
    }

    const previousResponseId = compactDecision.enabled
      ? previousCompactState.previousResponseId
      : undefined
    if (activePrompt.compressionTriggered) {
      recordCompleted(input, {
        id: dependencies.traceId('context-pack'),
        type: 'system',
        title: dependencies.translate('chatRunner.trace.contextPackTitle'),
        content: dependencies.translate('chatRunner.trace.contextPackContent', {
          kept: activePrompt.messages.length,
          trimmed: activePrompt.trimmedCount,
          estimated: activePrompt.estimatedInputTokens,
          budget: activePrompt.budgetTokens,
        }),
        status: 'done',
        startedAt: dependencies.now(),
        metadata: {
          trimmedCount: activePrompt.trimmedCount,
          estimatedInputTokens: activePrompt.estimatedInputTokens,
          budgetTokens: activePrompt.budgetTokens,
          fixedTokens: activePrompt.fixedTokens,
          messageTokens: activePrompt.messageTokens,
          modelBudgetTokens: activePrompt.modelBudgetTokens,
          reservedOutputTokens: activePrompt.reservedOutputTokens,
          reasoningReserveTokens: activePrompt.reasoningReserveTokens,
          compressionTriggered: activePrompt.compressionTriggered,
          truncatedSingleMessage: activePrompt.truncatedSingleMessage,
          compressionSchemaVersion: compression.schemaVersion,
          compressionStrategy: compression.strategy,
          compressionTriggerReason: compression.triggerReason,
          summarySourceMessageCount: compression.sourceMessageCount,
          summaryKeptMessageCount: compression.keptMessageCount,
          summarySourceRoleCounts: compression.sourceRoleCounts,
          summaryKeptRoleCounts: compression.keptRoleCounts,
          compressionSourceTokens: compression.sourceTokens,
          compressionCompressedTokens: compression.compressedTokens,
          compressionEstimatedSavedTokens: compression.estimatedSavedTokens,
          compressionRatio: compression.compressionRatio,
          summaryTokenBudget: compression.summaryTokenBudget,
          summaryTokens: compression.summaryTokens,
          summarySectionCount: compression.summarySectionCount,
          summaryItemCount: compression.summaryItemCount,
          summarySections: compression.summarySections,
        },
      })
    }

    return {
      kind: 'planned',
      systemPrompt,
      activePrompt,
      retrievalSources,
      providerWebSearchMode,
      nativeSearchTraceId,
      previousCompactState,
      previousResponseId,
      compactDecision,
      remoteCompactProbe,
      compactRecord,
      contextPlan,
      contextRuntime,
    }
  }

  function observeEvent(input: AssistantConversationRequestPlanningRuntimeEvent): void {
    void dependencies.emitRuntimeEvent(input).catch(() => undefined)
  }

  function toApplicationSummaryMessages(
    messages: ReadonlyArray<{ role: string; content: string }>,
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    const out: Array<{ role: 'user' | 'assistant'; content: string }> = []
    for (const message of messages) {
      if (message.role !== 'user' && message.role !== 'assistant') continue
      const content = String(message.content ?? '').trim()
      if (!content) continue
      out.push({ role: message.role, content })
    }
    return out
  }

  function estimatePromptTokens(result: {
    readonly summary: string
    readonly contextPrompt: string
    readonly recentMessages: ReadonlyArray<{ content: string }>
  }): number {
    const text = [
      result.contextPrompt,
      ...result.recentMessages.map((message) => message.content),
    ].join('\n')
    return Math.ceil(text.length / 4)
  }

  function recordCompleted(
    input: { readonly conversationId: string; readonly assistantMessageId: string },
    trace: AssistantConversationRequestPlanningTraceInput,
  ): void {
    dependencies.recordTrace({
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      trace: dependencies.completeTrace(dependencies.buildTrace(trace)),
    })
  }

  function compactUsageLog(
    input: AssistantConversationRequestPlanningInput<
      TRetrievedContext,
      TWebSources,
      TWorkspaceContext,
      TProvider,
      TModel,
      TRequestedSearchMode,
      TAttachment,
      TConversation,
      TSettings,
      TSourceMessage
    >,
    record: TCompactRecord,
  ): Readonly<Record<string, unknown>> {
    return {
      conversationId: input.conversationId,
      providerId: input.provider.id,
      model: input.runtimeConversation.model,
      upstreamModel: input.upstreamModel,
      mode: record.mode,
      decisionReason: record.decisionReason,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      estimatedSavedTokens: record.estimatedSavedTokens,
      localSourceTokens: record.localSourceTokens,
      localCompressedTokens: record.localCompressedTokens,
      localEstimatedSavedTokens: record.localEstimatedSavedTokens,
      localCompressionRatio: record.localCompressionRatio,
      localCompressionSchemaVersion: record.localCompressionSchemaVersion,
      localCompressionStrategy: record.localCompressionStrategy,
      localCompressionTriggerReason: record.localCompressionTriggerReason,
      localSourceMessageCount: record.localSourceMessageCount,
      localKeptMessageCount: record.localKeptMessageCount,
      localSourceRoleCounts: record.localSourceRoleCounts,
      localKeptRoleCounts: record.localKeptRoleCounts,
      localSummaryTokenBudget: record.localSummaryTokenBudget,
      localSummaryTokens: record.localSummaryTokens,
      localSummarySectionCount: record.localSummarySectionCount,
      localSummaryItemCount: record.localSummaryItemCount,
      localSummarySections: record.localSummarySections,
      failureCode: record.failureCode,
      fallbackLocal: record.fallbackLocal,
    }
  }

  return { plan }
}

function runtimeLogOptions(
  settings: AssistantConversationRequestPlanningSettingsLike,
): { readonly enabled?: boolean; readonly maxBytes?: number } {
  return {
    enabled: settings.runtimeLogEnabled,
    maxBytes: settings.runtimeLogMaxBytes,
  }
}

function projectContextFragment(
  fragment: AssistantConversationContextFragmentLike,
): Readonly<Record<string, unknown>> {
  return {
    schema: fragment.schema,
    id: fragment.id,
    type: fragment.type,
    priority: fragment.priority,
    sourceId: fragment.sourceId,
    sourceHash: fragment.sourceHash,
    sourceVersion: fragment.sourceVersion,
    tokenCap: fragment.tokenCap,
    estimatedTokens: fragment.estimatedTokens,
    originalEstimatedTokens: fragment.originalEstimatedTokens,
    included: fragment.included,
    capped: fragment.capped,
    exclusionReason: fragment.exclusionReason,
    cache: fragment.cache,
    trace: fragment.trace,
  }
}
