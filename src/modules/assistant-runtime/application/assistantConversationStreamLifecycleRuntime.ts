import type { AssistantConversationWorkspaceWritebackHandoff } from './assistantConversationWorkspaceWritebackHandoffRuntime'

export interface AssistantConversationStreamLifecycleProviderLike {
  readonly id: string
}

export interface AssistantConversationStreamLifecycleProviderErrorLike {
  readonly credentialGroupId?: string
}

export interface AssistantConversationStreamLifecycleCompletionContext {
  readonly requestController: AbortController
  readonly flush: () => void
}

export interface AssistantConversationStreamLifecycleCapture<
  TContext,
  TConversation,
  TProvider,
  TPackedMessage,
  TMcpTool,
  TProviderTools,
  TProviderSearchMode,
  TRemoteCompactMode,
  TRemoteCompactStrategy,
  TRemoteCompactCapabilityKind,
  TRemoteCompactClassification,
  TContextWindowState,
  TContextFragment,
> {
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly context: TContext
  readonly runtimeConversation: TConversation
  readonly provider: TProvider
  readonly modelTraceId: string
  readonly nativeSearchTraceId: string
  readonly providerWebSearchMode: TProviderSearchMode
  readonly systemPrompt: string
  readonly packedMessages: readonly TPackedMessage[]
  readonly baseContextPrompt: string
  readonly mcpTools: readonly TMcpTool[]
  readonly providerTools?: TProviderTools
  readonly workspaceWritebackHandoff?: AssistantConversationWorkspaceWritebackHandoff
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

export interface AssistantConversationStreamLifecycleFinalizationInput<
  TCompletionResult,
  TContext,
  TConversation,
  TProvider,
  TPackedMessage,
  TMcpTool,
  TProviderTools,
  TProviderSearchMode,
  TRemoteCompactMode,
  TRemoteCompactStrategy,
  TRemoteCompactCapabilityKind,
  TRemoteCompactClassification,
  TContextWindowState,
  TContextFragment,
> extends AssistantConversationStreamLifecycleCapture<
    TContext,
    TConversation,
    TProvider,
    TPackedMessage,
    TMcpTool,
    TProviderTools,
    TProviderSearchMode,
    TRemoteCompactMode,
    TRemoteCompactStrategy,
    TRemoteCompactCapabilityKind,
    TRemoteCompactClassification,
    TContextWindowState,
    TContextFragment
  > {
  readonly result: TCompletionResult
  readonly requestController: AbortController
  readonly chunkFlush: () => void
}

export interface AssistantConversationStreamLifecycleFailureInput {
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly error: unknown
  readonly providerId: string
}

export interface AssistantConversationStreamLifecycleStartFailureInput
  extends AssistantConversationStreamLifecycleFailureInput {
  readonly modelTraceId: string
}

export interface AssistantConversationStreamLifecycleProviderFailureInput<
  TProviderError,
  TProviderSearchMode,
> {
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly providerId: string
  readonly modelTraceId: string
  readonly nativeSearchTraceId: string
  readonly providerWebSearchMode: TProviderSearchMode
  readonly credentialGroupId?: string
  readonly error: TProviderError
}

export interface AssistantConversationStreamLifecycle<
  TCompletionResult,
  TProviderError,
> {
  readonly complete: (
    result: TCompletionResult,
    lifecycle: AssistantConversationStreamLifecycleCompletionContext,
  ) => Promise<void>
  readonly completionFailed: (error: unknown) => void
  readonly providerFailed: (error: TProviderError) => void
  readonly startFailed: (error: unknown) => void
}

export interface AssistantConversationStreamLifecycleRuntimeDependencies<
  TCompletionResult,
  TProviderError,
  TContext,
  TConversation,
  TProvider,
  TPackedMessage,
  TMcpTool,
  TProviderTools,
  TProviderSearchMode,
  TRemoteCompactMode,
  TRemoteCompactStrategy,
  TRemoteCompactCapabilityKind,
  TRemoteCompactClassification,
  TContextWindowState,
  TContextFragment,
> {
  finalize(input: AssistantConversationStreamLifecycleFinalizationInput<
    TCompletionResult,
    TContext,
    TConversation,
    TProvider,
    TPackedMessage,
    TMcpTool,
    TProviderTools,
    TProviderSearchMode,
    TRemoteCompactMode,
    TRemoteCompactStrategy,
    TRemoteCompactCapabilityKind,
    TRemoteCompactClassification,
    TContextWindowState,
    TContextFragment
  >): Promise<unknown>
  failProvider(input: AssistantConversationStreamLifecycleProviderFailureInput<
    TProviderError,
    TProviderSearchMode
  >): void
  projectCompletionFailure(
    input: AssistantConversationStreamLifecycleFailureInput,
  ): void
  projectStartFailure(
    input: AssistantConversationStreamLifecycleStartFailureInput,
  ): void
}

/**
 * Captures one ordinary conversation provider turn and constructs the stream
 * lifecycle callbacks without owning provider, store, or projection adapters.
 */
export function createAssistantConversationStreamLifecycleRuntime<
  TCompletionResult,
  TProviderError extends AssistantConversationStreamLifecycleProviderErrorLike,
  TContext,
  TConversation,
  TProvider extends AssistantConversationStreamLifecycleProviderLike,
  TPackedMessage,
  TMcpTool,
  TProviderTools,
  TProviderSearchMode,
  TRemoteCompactMode,
  TRemoteCompactStrategy,
  TRemoteCompactCapabilityKind,
  TRemoteCompactClassification,
  TContextWindowState,
  TContextFragment,
>(
  dependencies: AssistantConversationStreamLifecycleRuntimeDependencies<
    TCompletionResult,
    TProviderError,
    TContext,
    TConversation,
    TProvider,
    TPackedMessage,
    TMcpTool,
    TProviderTools,
    TProviderSearchMode,
    TRemoteCompactMode,
    TRemoteCompactStrategy,
    TRemoteCompactCapabilityKind,
    TRemoteCompactClassification,
    TContextWindowState,
    TContextFragment
  >,
) {
  type Capture = AssistantConversationStreamLifecycleCapture<
    TContext,
    TConversation,
    TProvider,
    TPackedMessage,
    TMcpTool,
    TProviderTools,
    TProviderSearchMode,
    TRemoteCompactMode,
    TRemoteCompactStrategy,
    TRemoteCompactCapabilityKind,
    TRemoteCompactClassification,
    TContextWindowState,
    TContextFragment
  >

  function build(
    input: Capture,
  ): AssistantConversationStreamLifecycle<TCompletionResult, TProviderError> {
    return {
      async complete(result, lifecycle) {
        await dependencies.finalize({
          conversationId: input.conversationId,
          assistantMessageId: input.assistantMessageId,
          result,
          context: input.context,
          runtimeConversation: input.runtimeConversation,
          provider: input.provider,
          modelTraceId: input.modelTraceId,
          nativeSearchTraceId: input.nativeSearchTraceId,
          providerWebSearchMode: input.providerWebSearchMode,
          systemPrompt: input.systemPrompt,
          packedMessages: input.packedMessages,
          baseContextPrompt: input.baseContextPrompt,
          mcpTools: input.mcpTools,
          providerTools: input.providerTools,
          workspaceWritebackHandoff: input.workspaceWritebackHandoff,
          requestController: lifecycle.requestController,
          chunkFlush: lifecycle.flush,
          upstreamModel: input.upstreamModel,
          remoteCompactEligible: input.remoteCompactEligible,
          remoteCompactMode: input.remoteCompactMode,
          remoteCompactStrategy: input.remoteCompactStrategy,
          remoteCompactCapabilityKind: input.remoteCompactCapabilityKind,
          remoteCompactClassification: input.remoteCompactClassification,
          remoteCompactInputTokens: input.remoteCompactInputTokens,
          previousResponseId: input.previousResponseId,
          contextWindowState: input.contextWindowState,
          contextFragments: input.contextFragments,
        })
      },
      completionFailed(error) {
        dependencies.projectCompletionFailure({
          conversationId: input.conversationId,
          assistantMessageId: input.assistantMessageId,
          error,
          providerId: input.provider.id,
        })
      },
      providerFailed(error) {
        dependencies.failProvider({
          conversationId: input.conversationId,
          assistantMessageId: input.assistantMessageId,
          providerId: input.provider.id,
          modelTraceId: input.modelTraceId,
          nativeSearchTraceId: input.nativeSearchTraceId,
          providerWebSearchMode: input.providerWebSearchMode,
          credentialGroupId: error.credentialGroupId,
          error,
        })
      },
      startFailed(error) {
        dependencies.projectStartFailure({
          conversationId: input.conversationId,
          assistantMessageId: input.assistantMessageId,
          modelTraceId: input.modelTraceId,
          error,
          providerId: input.provider.id,
        })
      },
    }
  }

  return { build }
}
