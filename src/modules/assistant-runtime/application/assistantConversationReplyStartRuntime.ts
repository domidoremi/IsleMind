import type { AssistantRunId } from '@/core'
import type { AssistantContextPlanReceipt, AssistantModelOperationSession } from '../contracts'
import { buildAssistantContextPlanReceipt } from './contextPlanReceipt'

import type {
  AssistantConversationWorkspaceWritebackBindOutcome,
  AssistantConversationWorkspaceWritebackAdmissionInput,
  AssistantConversationWorkspaceWritebackAdmissionOutcome,
  AssistantConversationWorkspaceWritebackHandoffRuntime,
} from './assistantConversationWorkspaceWritebackHandoffRuntime'
import type { AssistantConversationWorkspaceWritebackHandoff } from '../workspaceWritebackContracts'

export interface AssistantConversationReplyStartMessageLike<
  TAttachmentInput,
> {
  readonly id: string
  readonly role: string
  readonly content?: string
  readonly attachments?: TAttachmentInput
}

export interface AssistantConversationReplyStartConversationLike<TMessage> {
  readonly messages: readonly TMessage[]
}

export interface AssistantConversationReplyStartRuntimeConversationLike {
  readonly model: string
  readonly enabledTools?: readonly string[]
}

export interface AssistantConversationReplyStartProviderLike {
  readonly id: string
}

export interface AssistantConversationReplyStartMcpContextLike<TMcpTools> {
  readonly prompt: string
  readonly tools: TMcpTools
}

export interface AssistantConversationReplyStartProviderToolContextLike<
  TProviderToolDeclarations,
> {
  readonly adapter: {
    readonly tools: TProviderToolDeclarations
  }
}

export interface AssistantConversationReplyStartActivePromptLike<
  TPackedMessages,
> {
  readonly messages: TPackedMessages
  readonly contextPrompt: string
}

export interface AssistantConversationReplyStartContextPlanLike<
  TRemoteCompactFallback,
  TContextWindowState,
  TContextFragments,
> {
  readonly remoteCompactFallback?: TRemoteCompactFallback
  readonly windowState: TContextWindowState
  readonly fragments: TContextFragments
}

export interface AssistantConversationReplyStartSessionMissing {
  readonly kind: 'missing'
}

export interface AssistantConversationReplyStartSessionReady<
  TConversation,
> {
  readonly kind: 'ready'
  readonly conversation: TConversation
  readonly message: {
    readonly id: string
  }
  readonly requestController: AbortController
}

export type AssistantConversationReplyStartSessionOutcome<
  TConversation,
> =
  | AssistantConversationReplyStartSessionMissing
  | AssistantConversationReplyStartSessionReady<TConversation>

export type AssistantConversationReplyStartProviderAdmissionTerminal =
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'projected_failure' }

export interface AssistantConversationReplyStartProviderAdmissionReady<
  TRuntimeConversation,
  TProvider extends AssistantConversationReplyStartProviderLike,
  TModelConfig,
> {
  readonly kind: 'ready'
  readonly conversation: TRuntimeConversation
  readonly provider: TProvider
  readonly upstreamModel: string
  readonly modelConfig: TModelConfig
}

export type AssistantConversationReplyStartProviderAdmissionOutcome<
  TRuntimeConversation,
  TProvider extends AssistantConversationReplyStartProviderLike,
  TModelConfig,
> =
  | AssistantConversationReplyStartProviderAdmissionTerminal
  | AssistantConversationReplyStartProviderAdmissionReady<
      TRuntimeConversation,
      TProvider,
      TModelConfig
    >

export type AssistantConversationReplyStartPlainChatHandoffOutcome =
  | { readonly kind: 'continue' }
  | { readonly kind: 'started' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed' }

export type AssistantConversationReplyStartContextAcquisitionTerminal =
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed' }

export interface AssistantConversationReplyStartContextAcquisitionReady<
  TFallbackProviders,
  TContext,
  TWorkspaceContext,
  TSearchMode,
  TWebSources,
  TMcpContext,
> {
  readonly kind: 'ready'
  readonly fallbackProviders: TFallbackProviders
  readonly context: TContext
  readonly workspaceContext?: TWorkspaceContext
  readonly searchMode: TSearchMode
  readonly webSources: TWebSources
  readonly mcpContext: TMcpContext
}

export type AssistantConversationReplyStartContextAcquisitionOutcome<
  TFallbackProviders,
  TContext,
  TWorkspaceContext,
  TSearchMode,
  TWebSources,
  TMcpContext,
> =
  | AssistantConversationReplyStartContextAcquisitionTerminal
  | AssistantConversationReplyStartContextAcquisitionReady<
      TFallbackProviders,
      TContext,
      TWorkspaceContext,
      TSearchMode,
      TWebSources,
      TMcpContext
    >

export interface AssistantConversationReplyStartProviderToolAdmissionOutcome<
  TProviderToolContext,
> {
  readonly kind: 'ready'
  readonly providerToolContext?: TProviderToolContext
}

export interface AssistantConversationReplyStartRequestPlanningFailed {
  readonly kind: 'failed'
}

export interface AssistantConversationReplyStartRequestPlanned<
  TRetrievalSources,
  TProviderWebSearchMode,
  TPackedMessages,
  TRemoteCompactFallback,
  TCompactMode,
  TRemoteCompactStrategy,
  TRemoteCompactCapabilityKind,
  TRemoteCompactClassification,
  TRemoteCompactProbe,
  TContextWindowState,
  TContextFragments,
> {
  readonly kind: 'planned'
  readonly retrievalSources: TRetrievalSources
  readonly providerWebSearchMode: TProviderWebSearchMode
  readonly nativeSearchTraceId: string
  readonly systemPrompt: string
  readonly activePrompt: AssistantConversationReplyStartActivePromptLike<
    TPackedMessages
  >
  readonly contextPlan: AssistantConversationReplyStartContextPlanLike<
    TRemoteCompactFallback,
    TContextWindowState,
    TContextFragments
  >
  readonly compactDecision: {
    readonly enabled: boolean
    readonly mode: TCompactMode
    /** True only for native vendor server-side compaction paths. */
    readonly nativeServerCompact?: boolean
    readonly strategy: TRemoteCompactStrategy
    readonly capabilityKind: TRemoteCompactCapabilityKind
    readonly remoteClassification: TRemoteCompactClassification
  }
  readonly remoteCompactProbe: TRemoteCompactProbe
  readonly previousResponseId?: string
}

export type AssistantConversationReplyStartRequestPlanningOutcome<
  TRetrievalSources,
  TProviderWebSearchMode,
  TPackedMessages,
  TRemoteCompactFallback,
  TCompactMode,
  TRemoteCompactStrategy,
  TRemoteCompactCapabilityKind,
  TRemoteCompactClassification,
  TRemoteCompactProbe,
  TContextWindowState,
  TContextFragments,
> =
  | AssistantConversationReplyStartRequestPlanningFailed
  | AssistantConversationReplyStartRequestPlanned<
      TRetrievalSources,
      TProviderWebSearchMode,
      TPackedMessages,
      TRemoteCompactFallback,
      TCompactMode,
      TRemoteCompactStrategy,
      TRemoteCompactCapabilityKind,
      TRemoteCompactClassification,
      TRemoteCompactProbe,
      TContextWindowState,
      TContextFragments
    >

export type AssistantConversationReplyStartStreamingOutcome =
  | { readonly kind: 'started' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed' }

export type AssistantConversationReplyStartWorkspaceWritebackHandoffTerminal =
  | {
      readonly kind: 'cancelled'
      readonly phase: 'resolve' | 'admission' | 'bind'
      readonly code?: string
    }
  | {
      readonly kind: 'failed'
      readonly phase: 'dependencies'
      readonly reason: 'missing_dependencies'
    }
  | {
      readonly kind: 'failed'
      readonly phase: 'admission' | 'bind'
      readonly reason: 'failed' | 'invalid_outcome'
      readonly outcome: unknown
    }
  | {
      readonly kind: 'failed'
      readonly phase: 'resolve' | 'admission' | 'run_allocation' | 'bind'
      readonly reason: 'threw'
      readonly error: unknown
    }

export interface AssistantConversationReplyStartProviderDispatchOutcome<
  TStreamingOutcome extends AssistantConversationReplyStartStreamingOutcome,
> {
  readonly kind: 'dispatched'
  readonly streamingOutcome: TStreamingOutcome
}

export type AssistantConversationReplyStartDurableDispatchOutcome<
  TStreamingOutcome extends AssistantConversationReplyStartStreamingOutcome,
> =
  | {
      readonly kind: 'terminal'
      readonly outcome:
        | { readonly kind: 'cancelled' }
        | { readonly kind: 'failed'; readonly error: unknown }
    }
  | {
      readonly kind: 'dispatched'
      readonly providerDispatchOutcome:
        AssistantConversationReplyStartProviderDispatchOutcome<TStreamingOutcome>
    }

export interface AssistantConversationReplyStartInput {
  readonly conversationId: string
}

export type AssistantConversationReplyStartTerminalStage =
  | 'reply_session'
  | 'provider_admission'
  | 'plain_chat_handoff'
  | 'context_acquisition'
  | 'workspace_writeback_handoff'
  | 'request_planning'
  | 'durable_execution'
  | 'provider_streaming'

export type AssistantConversationReplyStartTerminalOutcome =
  | AssistantConversationReplyStartSessionMissing
  | AssistantConversationReplyStartProviderAdmissionTerminal
  | Exclude<
      AssistantConversationReplyStartPlainChatHandoffOutcome,
      { readonly kind: 'continue' }
    >
  | AssistantConversationReplyStartContextAcquisitionTerminal
  | AssistantConversationReplyStartWorkspaceWritebackHandoffTerminal
  | AssistantConversationReplyStartRequestPlanningFailed
  | Exclude<
      AssistantConversationReplyStartDurableDispatchOutcome<
        AssistantConversationReplyStartStreamingOutcome
      >,
      { readonly kind: 'dispatched' }
    >['outcome']
  | Exclude<
      AssistantConversationReplyStartStreamingOutcome,
      { readonly kind: 'started' }
    >

export type AssistantConversationReplyStartOutcome =
  | {
      readonly kind: 'terminal'
      readonly stage: AssistantConversationReplyStartTerminalStage
      readonly outcome: AssistantConversationReplyStartTerminalOutcome
    }
  | {
      readonly kind: 'completed'
      readonly outcome: { readonly kind: 'started' }
      readonly providerDispatchOutcome:
        AssistantConversationReplyStartProviderDispatchOutcome<
          AssistantConversationReplyStartStreamingOutcome
        >
    }

export interface AssistantConversationReplyStartRuntimeDependencies<
  TAttachmentInput,
  TSendableAttachments extends readonly unknown[],
  TMessage extends AssistantConversationReplyStartMessageLike<
    TAttachmentInput
  >,
  TConversation extends AssistantConversationReplyStartConversationLike<TMessage>,
  TRuntimeConversation extends AssistantConversationReplyStartRuntimeConversationLike,
  TProvider extends AssistantConversationReplyStartProviderLike,
  TProviders,
  TSettings,
  TModelConfig,
  TFallbackProviders,
  TContext,
  TWorkspaceContext,
  TSearchMode,
  TWebSources,
  TMcpTools extends readonly unknown[],
  TMcpContext extends AssistantConversationReplyStartMcpContextLike<TMcpTools>,
  TProviderToolDeclarations extends readonly unknown[],
  TProviderToolContext extends AssistantConversationReplyStartProviderToolContextLike<
    TProviderToolDeclarations
  >,
  TRetrievalSources extends readonly unknown[],
  TProviderWebSearchMode,
  TPackedMessages extends readonly unknown[],
  TRemoteCompactFallback,
  TCompactMode,
  TRemoteCompactStrategy,
  TRemoteCompactCapabilityKind,
  TRemoteCompactClassification,
  TRemoteCompactProbe extends { readonly estimatedInputTokens: number },
  TContextWindowState,
  TContextFragments extends readonly unknown[],
  TStreamLifecycle,
> {
  readonly allocateAssistantRunId?: () => AssistantRunId
  readonly workspaceSourceRuntime: {
    resolve(
      input: AssistantConversationWorkspaceWritebackAdmissionInput,
      options: { readonly signal: AbortSignal },
    ): Promise<unknown>
  }
  readonly workspaceWritebackHandoffRuntime:
    AssistantConversationWorkspaceWritebackHandoffRuntime<TWorkspaceContext>
  readonly projectWorkspaceWritebackHandoffTerminal: (input: {
    readonly conversationId: string
    readonly assistantMessageId: string
    readonly providerId: string
    readonly outcome: AssistantConversationReplyStartWorkspaceWritebackHandoffTerminal
  }) => void
  readonly replySessionRuntime: {
    start(
      input: AssistantConversationReplyStartInput,
    ): Promise<AssistantConversationReplyStartSessionOutcome<TConversation>>
  }
  readonly providerAdmissionRuntime: {
    admit(input: {
      readonly conversationId: string
      readonly assistantMessageId: string
      readonly conversation: TConversation
      readonly providers: TProviders
      readonly settings: TSettings
      readonly signal: AbortSignal
    }): Promise<AssistantConversationReplyStartProviderAdmissionOutcome<
      TRuntimeConversation,
      TProvider,
      TModelConfig
    >>
  }
  readonly plainChatHandoffRuntime: {
    handoff(input: {
      readonly conversationId: string
      readonly assistantMessageId: string
      readonly runtimeConversation: TRuntimeConversation
      readonly provider: TProvider
      readonly settings: TSettings
      readonly hasAttachments: boolean
      readonly requestController: AbortController
    }): Promise<AssistantConversationReplyStartPlainChatHandoffOutcome>
  }
  readonly contextAcquisitionRuntime: {
    acquire(input: {
      readonly conversationId: string
      readonly assistantMessageId: string
      readonly provider: TProvider
      readonly runtimeConversation: TRuntimeConversation
      readonly lastUserMessage?: TMessage
      readonly workspaceContext?: TWorkspaceContext
      readonly settings: TSettings
      readonly signal: AbortSignal
    }): Promise<AssistantConversationReplyStartContextAcquisitionOutcome<
      TFallbackProviders,
      TContext,
      TWorkspaceContext,
      TSearchMode,
      TWebSources,
      TMcpContext
    >>
  }
  readonly providerToolAdmissionRuntime: {
    admit(input: {
      readonly conversationId: string
      readonly assistantMessageId: string
      readonly provider: TProvider
      readonly modelConfig: TModelConfig
      readonly upstreamModel: string
      readonly requestedModel: string
      readonly settings: TSettings
      readonly mcpContext: TMcpContext
    }): Promise<AssistantConversationReplyStartProviderToolAdmissionOutcome<
      TProviderToolContext
    >>
  }
  readonly requestPlanningRuntime: {
    plan(input: {
      readonly conversationId: string
      readonly assistantMessageId: string
      readonly retrievedContext: TContext
      readonly webSources: TWebSources
      readonly mcpPrompt: string
      readonly mcpToolCount: number
      readonly workspaceContext?: TWorkspaceContext
      readonly provider: TProvider
      readonly modelConfig: TModelConfig
      readonly requestedSearchMode: TSearchMode
      readonly sendableAttachments: TSendableAttachments
      readonly runtimeConversation: TRuntimeConversation
      readonly settings: TSettings
      readonly sourceMessages: readonly TMessage[]
      readonly lastUserMessage?: TMessage
      readonly providerToolCount: number
      readonly upstreamModel: string
      readonly signal: AbortSignal
    }): Promise<AssistantConversationReplyStartRequestPlanningOutcome<
      TRetrievalSources,
      TProviderWebSearchMode,
      TPackedMessages,
      TRemoteCompactFallback,
      TCompactMode,
      TRemoteCompactStrategy,
      TRemoteCompactCapabilityKind,
      TRemoteCompactClassification,
      TRemoteCompactProbe,
      TContextWindowState,
      TContextFragments
    >>
  }
  readonly streamLifecycleRuntime: {
    build(input: {
      readonly conversationId: string
      readonly assistantMessageId: string
      readonly context: TContext
      readonly runtimeConversation: TRuntimeConversation
      readonly provider: TProvider
      readonly modelTraceId: string
      readonly nativeSearchTraceId: string
      readonly providerWebSearchMode: TProviderWebSearchMode
      readonly systemPrompt: string
      readonly packedMessages: TPackedMessages
      readonly baseContextPrompt: string
      readonly mcpTools: TMcpTools
      readonly providerTools?: TProviderToolContext
      readonly workspaceWritebackHandoff?: AssistantConversationWorkspaceWritebackHandoff
      readonly upstreamModel: string
      readonly remoteCompactEligible: boolean
      readonly remoteCompactMode: TCompactMode
      readonly remoteCompactStrategy: TRemoteCompactStrategy
      readonly remoteCompactCapabilityKind: TRemoteCompactCapabilityKind
      readonly remoteCompactClassification: TRemoteCompactClassification
      readonly remoteCompactInputTokens?: number
      readonly previousResponseId?: string
      readonly contextWindowState: TContextWindowState
      readonly contextFragments: TContextFragments
    }): TStreamLifecycle
  }
  readonly durableDispatchRuntime: {
    dispatch(input: {
      readonly runId?: AssistantRunId
      readonly conversationId: string
      readonly assistantMessageId: string
      readonly requestController: AbortController
      readonly runtimeConversation: TRuntimeConversation
      readonly provider: TProvider
      readonly upstreamModel: string
      readonly systemPrompt: string
      readonly settings: TSettings
      readonly attachments: TSendableAttachments
      readonly messages: TPackedMessages
      readonly contextPrompt: string
      readonly retrievalSources: TRetrievalSources
      readonly webSearchMode: TProviderWebSearchMode
      readonly fallbackProviders: TFallbackProviders
      readonly remoteCompactEligible: boolean
      readonly remoteCompactFallback: TRemoteCompactFallback | undefined
      readonly previousResponseId?: string
      readonly providerToolDeclarations?: TProviderToolDeclarations
      readonly modelOperationSession?: AssistantModelOperationSession
      readonly sourceMessages: readonly TMessage[]
      readonly requestMessageId?: string
      readonly requestText: string
      readonly approvedToolContextIds: readonly string[]
      readonly contextReceipt?: AssistantContextPlanReceipt
      readonly workspaceWritebackHandoff?: AssistantConversationWorkspaceWritebackHandoff
      readonly buildStreamLifecycle: (input: {
        readonly modelTraceId: string
      }) => TStreamLifecycle
    }): Promise<AssistantConversationReplyStartDurableDispatchOutcome<
      AssistantConversationReplyStartStreamingOutcome
    >>
  }
  getProviderSettingsState(): {
    readonly providers: TProviders
    readonly settings: TSettings
  }
  getLatestConversation(conversationId: string): TConversation | undefined
  getSettings(): TSettings
  createModelOperationSession?(input: {
    readonly conversation: TRuntimeConversation
    readonly provider: TProvider
    readonly settings: TSettings
  }): Promise<AssistantModelOperationSession | undefined>
  filterSendableAttachments(
    attachments: TAttachmentInput | undefined,
  ): TSendableAttachments
}

/**
 * Sequences one ordinary conversation reply after presentation has already
 * projected the selected history. All stores, adapters, runtime instances,
 * attachment policy, and terminal effects remain composition-root concerns.
 */
export function createAssistantConversationReplyStartRuntime<
  TAttachmentInput,
  TSendableAttachments extends readonly unknown[],
  TMessage extends AssistantConversationReplyStartMessageLike<
    TAttachmentInput
  >,
  TConversation extends AssistantConversationReplyStartConversationLike<TMessage>,
  TRuntimeConversation extends AssistantConversationReplyStartRuntimeConversationLike,
  TProvider extends AssistantConversationReplyStartProviderLike,
  TProviders,
  TSettings,
  TModelConfig,
  TFallbackProviders,
  TContext,
  TWorkspaceContext,
  TSearchMode,
  TWebSources,
  TMcpTools extends readonly unknown[],
  TMcpContext extends AssistantConversationReplyStartMcpContextLike<TMcpTools>,
  TProviderToolDeclarations extends readonly unknown[],
  TProviderToolContext extends AssistantConversationReplyStartProviderToolContextLike<
    TProviderToolDeclarations
  >,
  TRetrievalSources extends readonly unknown[],
  TProviderWebSearchMode,
  TPackedMessages extends readonly unknown[],
  TRemoteCompactFallback,
  TCompactMode,
  TRemoteCompactStrategy,
  TRemoteCompactCapabilityKind,
  TRemoteCompactClassification,
  TRemoteCompactProbe extends { readonly estimatedInputTokens: number },
  TContextWindowState,
  TContextFragments extends readonly unknown[],
  TStreamLifecycle,
>(
  dependencies: AssistantConversationReplyStartRuntimeDependencies<
    TAttachmentInput,
    TSendableAttachments,
    TMessage,
    TConversation,
    TRuntimeConversation,
    TProvider,
    TProviders,
    TSettings,
    TModelConfig,
    TFallbackProviders,
    TContext,
    TWorkspaceContext,
    TSearchMode,
    TWebSources,
    TMcpTools,
    TMcpContext,
    TProviderToolDeclarations,
    TProviderToolContext,
    TRetrievalSources,
    TProviderWebSearchMode,
    TPackedMessages,
    TRemoteCompactFallback,
    TCompactMode,
    TRemoteCompactStrategy,
    TRemoteCompactCapabilityKind,
    TRemoteCompactClassification,
    TRemoteCompactProbe,
    TContextWindowState,
    TContextFragments,
    TStreamLifecycle
  >,
) {
  async function start(
    input: AssistantConversationReplyStartInput,
  ): Promise<AssistantConversationReplyStartOutcome> {
    const session = await dependencies.replySessionRuntime.start(input)
    if (session.kind === 'missing') {
      return { kind: 'terminal', stage: 'reply_session', outcome: session }
    }

    const {
      conversation,
      message: assistantMessage,
      requestController,
    } = session
    const settingsState = dependencies.getProviderSettingsState()
    const admission = await dependencies.providerAdmissionRuntime.admit({
      conversationId: input.conversationId,
      assistantMessageId: assistantMessage.id,
      conversation,
      providers: settingsState.providers,
      settings: settingsState.settings,
      signal: requestController.signal,
    })
    if (admission.kind !== 'ready') {
      return { kind: 'terminal', stage: 'provider_admission', outcome: admission }
    }

    const {
      conversation: runtimeConversation,
      provider,
      upstreamModel,
      modelConfig,
    } = admission
    const latestConversation = dependencies.getLatestConversation(
      input.conversationId,
    )
    const lastUserMessage = findLastUserMessage(latestConversation?.messages)
    const sendableAttachments = dependencies.filterSendableAttachments(
      lastUserMessage?.attachments,
    )
    const settings = dependencies.getSettings()
    const terminateWorkspaceWritebackHandoff = (
      outcome: AssistantConversationReplyStartWorkspaceWritebackHandoffTerminal,
    ): AssistantConversationReplyStartOutcome => {
      if (outcome.kind === 'failed') {
        dependencies.projectWorkspaceWritebackHandoffTerminal({
          conversationId: input.conversationId,
          assistantMessageId: assistantMessage.id,
          providerId: provider.id,
          outcome,
        })
      }
      return {
        kind: 'terminal',
        stage: 'workspace_writeback_handoff',
        outcome,
      }
    }

    const workspaceSourceInput: AssistantConversationWorkspaceWritebackAdmissionInput = {
      conversationId: input.conversationId,
      assistantMessageId: assistantMessage.id,
      latestUserInput: lastUserMessage?.content ?? '',
    }
    let resolvedWorkspaceSource: unknown
    try {
      resolvedWorkspaceSource = await dependencies.workspaceSourceRuntime.resolve(
        workspaceSourceInput,
        { signal: requestController.signal },
      )
    } catch (error) {
      return terminateWorkspaceWritebackHandoff({
        kind: 'failed',
        phase: 'resolve',
        reason: 'threw',
        error,
      })
    }

    let workspaceSourceAdmission: unknown
    try {
      workspaceSourceAdmission =
        dependencies.workspaceWritebackHandoffRuntime.admitResolvedSource(
          workspaceSourceInput,
          resolvedWorkspaceSource,
        )
    } catch (error) {
      return terminateWorkspaceWritebackHandoff({
        kind: 'failed',
        phase: 'admission',
        reason: 'threw',
        error,
      })
    }
    if (getWorkspaceWritebackHandoffStatus(workspaceSourceAdmission) === 'cancelled') {
      return terminateWorkspaceWritebackHandoff({
        kind: 'cancelled',
        phase: 'admission',
      })
    }
    if (!isWorkspaceWritebackAdmissionReadyOrNone(workspaceSourceAdmission)) {
      return terminateWorkspaceWritebackHandoff(
        toWorkspaceWritebackHandoffTerminal('admission', workspaceSourceAdmission),
      )
    }

    if (workspaceSourceAdmission.status === 'none') {
      const plainChatHandoff = await dependencies.plainChatHandoffRuntime.handoff({
        conversationId: input.conversationId,
        assistantMessageId: assistantMessage.id,
        runtimeConversation,
        provider,
        settings,
        hasAttachments: sendableAttachments.length > 0,
        requestController,
      })
      if (plainChatHandoff.kind !== 'continue') {
        return {
          kind: 'terminal',
          stage: 'plain_chat_handoff',
          outcome: plainChatHandoff,
        }
      }
    }

    const contextAcquisitionOutcome =
      await dependencies.contextAcquisitionRuntime.acquire({
        conversationId: input.conversationId,
        assistantMessageId: assistantMessage.id,
        provider,
        runtimeConversation,
        lastUserMessage,
        workspaceContext: workspaceSourceAdmission.status === 'ready'
          ? workspaceSourceAdmission.workspaceContext
          : undefined,
        settings,
        signal: requestController.signal,
      })
    if (contextAcquisitionOutcome.kind !== 'ready') {
      return {
        kind: 'terminal',
        stage: 'context_acquisition',
        outcome: contextAcquisitionOutcome,
      }
    }

    const {
      fallbackProviders,
      context,
      searchMode: searchProvider,
      webSources,
      mcpContext,
    } = contextAcquisitionOutcome
    const workspaceContext = workspaceSourceAdmission.status === 'ready'
      ? workspaceSourceAdmission.workspaceContext
      : undefined
    let runId: AssistantRunId | undefined
    let workspaceWritebackHandoff:
      | AssistantConversationWorkspaceWritebackHandoff
      | undefined
    if (workspaceSourceAdmission.status === 'ready') {
      const allocateAssistantRunId = dependencies.allocateAssistantRunId
      if (!allocateAssistantRunId) {
        return terminateWorkspaceWritebackHandoff({
          kind: 'failed',
          phase: 'dependencies',
          reason: 'missing_dependencies',
        })
      }

      let allocatedRunId: AssistantRunId
      try {
        allocatedRunId = allocateAssistantRunId()
      } catch (error) {
        return terminateWorkspaceWritebackHandoff({
          kind: 'failed',
          phase: 'run_allocation',
          reason: 'threw',
          error,
        })
      }

      let bindOutcome: unknown
      try {
        bindOutcome = await dependencies.workspaceWritebackHandoffRuntime.bindRun(
          {
            assistantRunId: allocatedRunId,
            capture: workspaceSourceAdmission.capture,
          },
          { signal: requestController.signal },
        )
      } catch (error) {
        return terminateWorkspaceWritebackHandoff({
          kind: 'failed',
          phase: 'bind',
          reason: 'threw',
          error,
        })
      }
      if (!isWorkspaceWritebackBindReady(bindOutcome)) {
        return terminateWorkspaceWritebackHandoff(
          toWorkspaceWritebackHandoffTerminal('bind', bindOutcome),
        )
      }

      runId = allocatedRunId
      workspaceWritebackHandoff = bindOutcome.handoff
    }
    const providerToolAdmissionOutcome =
      await dependencies.providerToolAdmissionRuntime.admit({
        conversationId: input.conversationId,
        assistantMessageId: assistantMessage.id,
        provider,
        modelConfig,
        upstreamModel,
        requestedModel: runtimeConversation.model,
        settings,
        mcpContext,
      })
    const { providerToolContext } = providerToolAdmissionOutcome
    const modelOperationSession = dependencies.createModelOperationSession
      ? await dependencies.createModelOperationSession({
          conversation: runtimeConversation,
          provider,
          settings,
        })
      : undefined
    const sourceMessages =
      latestConversation?.messages.filter(
        (message) => message.id !== assistantMessage.id,
      ) ?? []

    const requestPlanningOutcome =
      await dependencies.requestPlanningRuntime.plan({
        conversationId: input.conversationId,
        assistantMessageId: assistantMessage.id,
        retrievedContext: context,
        webSources,
        mcpPrompt: mcpContext.prompt,
        mcpToolCount: mcpContext.tools.length,
        workspaceContext,
        provider,
        modelConfig,
        requestedSearchMode: searchProvider,
        sendableAttachments,
        runtimeConversation,
        settings,
        sourceMessages,
        lastUserMessage,
        providerToolCount: providerToolContext?.adapter.tools.length ?? 0,
        upstreamModel,
        signal: requestController.signal,
      })
    if (requestPlanningOutcome.kind === 'failed') {
      return {
        kind: 'terminal',
        stage: 'request_planning',
        outcome: requestPlanningOutcome,
      }
    }

    const {
      retrievalSources,
      providerWebSearchMode,
      nativeSearchTraceId,
      systemPrompt,
      activePrompt,
      contextPlan,
      compactDecision,
      remoteCompactProbe,
      previousResponseId,
    } = requestPlanningOutcome
    const contextReceipt = buildAssistantContextPlanReceipt({
      providerId: provider.id,
      model: upstreamModel,
      plan: contextPlan,
      activePrompt,
    })
    const durableDispatchOutcome =
      await dependencies.durableDispatchRuntime.dispatch({
        runId,
        conversationId: input.conversationId,
        assistantMessageId: assistantMessage.id,
        requestController,
        runtimeConversation,
        provider,
        upstreamModel,
        systemPrompt,
        settings,
        attachments: sendableAttachments,
        messages: activePrompt.messages,
        contextPrompt: activePrompt.contextPrompt,
        retrievalSources,
        webSearchMode: providerWebSearchMode,
        fallbackProviders,
        // Only native vendor compact must mark eligible (server-side fields/headers).
        remoteCompactEligible: Boolean(compactDecision.enabled && compactDecision.nativeServerCompact),
        remoteCompactFallback: contextPlan.remoteCompactFallback,
        previousResponseId: compactDecision.nativeServerCompact
          ? previousResponseId
          : undefined,
        providerToolDeclarations: providerToolContext?.adapter.tools,
        modelOperationSession,
        sourceMessages,
        requestMessageId: lastUserMessage?.id,
        requestText: lastUserMessage?.content ?? '',
        approvedToolContextIds: runtimeConversation.enabledTools ?? [],
        contextReceipt,
        workspaceWritebackHandoff,
        buildStreamLifecycle({ modelTraceId }) {
          return dependencies.streamLifecycleRuntime.build({
            conversationId: input.conversationId,
            assistantMessageId: assistantMessage.id,
            context,
            runtimeConversation,
            provider,
            modelTraceId,
            nativeSearchTraceId,
            providerWebSearchMode,
            systemPrompt,
            packedMessages: activePrompt.messages,
            baseContextPrompt: activePrompt.contextPrompt,
            mcpTools: mcpContext.tools,
            providerTools: providerToolContext,
            workspaceWritebackHandoff,
            upstreamModel,
            remoteCompactEligible: Boolean(compactDecision.enabled && compactDecision.nativeServerCompact),
            remoteCompactMode: compactDecision.mode,
            remoteCompactStrategy: compactDecision.strategy,
            remoteCompactCapabilityKind: compactDecision.capabilityKind,
            remoteCompactClassification: compactDecision.remoteClassification,
            remoteCompactInputTokens: compactDecision.enabled
              ? remoteCompactProbe.estimatedInputTokens
              : undefined,
            previousResponseId,
            contextWindowState: contextPlan.windowState,
            contextFragments: contextPlan.fragments,
          })
        },
      })
    if (durableDispatchOutcome.kind === 'terminal') {
      return {
        kind: 'terminal',
        stage: 'durable_execution',
        outcome: durableDispatchOutcome.outcome,
      }
    }
    const providerDispatchOutcome =
      durableDispatchOutcome.providerDispatchOutcome
    const providerStreamingOutcome = providerDispatchOutcome.streamingOutcome
    if (
      providerStreamingOutcome.kind === 'cancelled' ||
      providerStreamingOutcome.kind === 'failed'
    ) {
      return {
        kind: 'terminal',
        stage: 'provider_streaming',
        outcome: providerStreamingOutcome,
      }
    }

    return {
      kind: 'completed',
      outcome: providerStreamingOutcome,
      providerDispatchOutcome,
    }
  }

  function findLastUserMessage(
    messages: readonly TMessage[] | undefined,
  ): TMessage | undefined {
    if (!messages) return undefined
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message?.role === 'user') return message
    }
    return undefined
  }

  function getWorkspaceWritebackHandoffStatus(
    outcome: unknown,
  ): unknown {
    return typeof outcome === 'object' && outcome !== null
      ? (outcome as Readonly<Record<string, unknown>>).status
      : undefined
  }

  function isWorkspaceWritebackAdmissionReadyOrNone(
    outcome: unknown,
  ): outcome is Extract<
    AssistantConversationWorkspaceWritebackAdmissionOutcome<TWorkspaceContext>,
    { readonly status: 'ready' | 'none' }
  > {
    const status = getWorkspaceWritebackHandoffStatus(outcome)
    return status === 'ready' || status === 'none'
  }

  function isWorkspaceWritebackBindReady(
    outcome: unknown,
  ): outcome is Extract<
    AssistantConversationWorkspaceWritebackBindOutcome,
    { readonly status: 'ready' }
  > {
    return getWorkspaceWritebackHandoffStatus(outcome) === 'ready'
  }

  function toWorkspaceWritebackHandoffTerminal(
    phase: 'admission' | 'bind',
    outcome: unknown,
  ): AssistantConversationReplyStartWorkspaceWritebackHandoffTerminal {
    const status = getWorkspaceWritebackHandoffStatus(outcome)
    if (status === 'cancelled') {
      const code = typeof outcome === 'object' && outcome !== null
        ? (outcome as Readonly<Record<string, unknown>>).code
        : undefined
      return {
        kind: 'cancelled',
        phase,
        ...(typeof code === 'string' ? { code } : {}),
      }
    }
    return {
      kind: 'failed',
      phase,
      reason: status === 'failed'
        ? 'failed'
        : 'invalid_outcome',
      outcome,
    }
  }

  return { start }
}
