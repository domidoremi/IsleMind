import { snapshotPlainData, type StreamEvent } from '@/core'
import type { ProviderContinuationAdmission, ProviderExecutionTargetObserver } from '@/modules/providers'
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
  readonly onStreamEvent?: (event: StreamEvent) => void
  readonly onExecutionTarget?: ProviderExecutionTargetObserver
  readonly providerContinuation?: ProviderContinuationAdmission
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
  TSettings = unknown,
> {
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly context: TContext
  readonly runtimeConversation: TConversation
  readonly provider: TProvider
  readonly settings?: TSettings
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
  TSettings = unknown,
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
    TContextFragment,
    TSettings
  > {
  readonly result: TCompletionResult
  readonly requestController: AbortController
  readonly chunkFlush: () => void
  readonly onStreamEvent?: (event: StreamEvent) => void
  readonly onExecutionTarget?: ProviderExecutionTargetObserver
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
  TFinalizationResult = void,
> {
  readonly complete: (
    result: TCompletionResult,
    lifecycle: AssistantConversationStreamLifecycleCompletionContext,
  ) => Promise<TFinalizationResult>
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
  TFinalizationResult = unknown,
  TSettings = unknown,
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
    TContextFragment,
    TSettings
  >): Promise<TFinalizationResult>
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
  TFinalizationResult = unknown,
  TSettings = unknown,
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
    TContextFragment,
    TFinalizationResult,
    TSettings
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
    TContextFragment,
    TSettings
  >

  function build(
    input: Capture,
  ): AssistantConversationStreamLifecycle<
    TCompletionResult,
    TProviderError,
    TFinalizationResult
  > {
    input = {
      ...input,
      settings: snapshotPlainData(input.settings),
      provider: snapshotPlainData(input.provider),
      runtimeConversation: snapshotPlainData(input.runtimeConversation),
      context: snapshotPlainData(input.context),
      providerTools: snapshotPlainData(input.providerTools),
      packedMessages: snapshotPlainData(input.packedMessages),
      mcpTools: snapshotPlainData(input.mcpTools),
      workspaceWritebackHandoff: snapshotPlainData(input.workspaceWritebackHandoff),
      contextWindowState: snapshotPlainData(input.contextWindowState),
      contextFragments: snapshotPlainData(input.contextFragments),
    }
    return {
      async complete(result, lifecycle) {
        return dependencies.finalize({
          conversationId: input.conversationId,
          assistantMessageId: input.assistantMessageId,
          result,
          context: input.context,
          runtimeConversation: input.runtimeConversation,
          provider: input.provider,
          ...(input.settings === undefined ? {} : { settings: input.settings }),
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
          ...(lifecycle.onStreamEvent ? { onStreamEvent: lifecycle.onStreamEvent } : {}),
          ...(lifecycle.onExecutionTarget ? { onExecutionTarget: lifecycle.onExecutionTarget } : {}),
          ...(lifecycle.providerContinuation ? { providerContinuation: lifecycle.providerContinuation } : {}),
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
