import {
  resolveGenerationParameterSources,
  type GenerationParameterKey,
  type GenerationParameterSources,
} from '@/core'

export interface AssistantConversationProviderDispatchProviderLike {
  readonly id: string
  readonly name: string
}

export interface AssistantConversationProviderDispatchConversationLike<
  TReasoningEffort,
> {
  readonly model: string
  readonly temperature: number
  readonly topP?: number
  readonly topK?: number
  readonly reasoningEffort?: TReasoningEffort
  readonly maxTokens: number
  readonly generationParameterOverrides?: Partial<Readonly<Record<GenerationParameterKey, boolean>>>
}

export interface AssistantConversationProviderDispatchTrace {
  readonly id: string
  readonly type: 'system'
  readonly title: string
  readonly content: string
  readonly status: 'running'
  readonly startedAt: number
  readonly metadata: {
    readonly providerId: string
    readonly model: string
    readonly upstreamModel: string
    readonly maxTokens: number
    readonly temperature: number
  }
}

export interface AssistantConversationProviderDispatchRequest<
  TProvider,
  TSettings,
  TAttachment,
  TMessage,
  TRetrievalSource,
  TWebSearchMode,
  TFallbackProviders,
  TRemoteCompactFallback,
  TProviderToolDeclarations,
  TReasoningEffort,
> {
  readonly provider: TProvider
  readonly model: string
  readonly requestedModel: string
  readonly systemPrompt: string
  readonly temperature: number
  readonly topP: number | undefined
  readonly topK: number | undefined
  readonly reasoningEffort: TReasoningEffort | undefined
  readonly maxTokens: number
  readonly generationParameterSources: GenerationParameterSources
  readonly attachments: TAttachment[]
  readonly messages: TMessage[]
  readonly contextPrompt: string
  readonly retrievalSources: TRetrievalSource[]
  readonly webSearchMode: TWebSearchMode
  readonly signal: AbortSignal
  readonly conversationId: string
  readonly sessionId: string
  readonly settings: TSettings
  readonly fallbackProviders: TFallbackProviders
  readonly remoteCompactEligible: boolean
  readonly remoteCompactFallback: TRemoteCompactFallback
  readonly previousResponseId: string | undefined
  readonly providerToolDeclarations: TProviderToolDeclarations | undefined
}

export interface AssistantConversationProviderDispatchInput<
  TConversation,
  TProvider,
  TSettings,
  TAttachment,
  TMessage,
  TRetrievalSource,
  TWebSearchMode,
  TFallbackProviders,
  TRemoteCompactFallback,
  TProviderToolDeclarations,
  TReasoningEffort,
  TStreamLifecycle,
> {
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly requestController: AbortController
  readonly runtimeConversation: TConversation
  readonly provider: TProvider
  readonly upstreamModel: string
  readonly systemPrompt: string
  readonly settings: TSettings
  readonly attachments: TAttachment[]
  readonly messages: TMessage[]
  readonly contextPrompt: string
  readonly retrievalSources: TRetrievalSource[]
  readonly webSearchMode: TWebSearchMode
  readonly fallbackProviders: TFallbackProviders
  readonly remoteCompactEligible: boolean
  readonly remoteCompactFallback: TRemoteCompactFallback
  readonly previousResponseId: string | undefined
  readonly providerToolDeclarations: TProviderToolDeclarations | undefined
  readonly buildStreamLifecycle: (input: {
    readonly modelTraceId: string
    readonly request: AssistantConversationProviderDispatchRequest<
      TProvider,
      TSettings,
      TAttachment,
      TMessage,
      TRetrievalSource,
      TWebSearchMode,
      TFallbackProviders,
      TRemoteCompactFallback,
      TProviderToolDeclarations,
      TReasoningEffort
    >
  }) => TStreamLifecycle
}

export interface AssistantConversationProviderDispatchRuntimeDependencies<
  TProvider,
  TSettings,
  TAttachment,
  TMessage,
  TRetrievalSource,
  TWebSearchMode,
  TFallbackProviders,
  TRemoteCompactFallback,
  TProviderToolDeclarations,
  TReasoningEffort,
  TStreamLifecycle extends object,
  TStreamingOutcome,
> {
  generateTraceId(prefix: 'model'): string
  now(): number
  modelRequestTitle(): string
  recordTrace(input: {
    readonly conversationId: string
    readonly assistantMessageId: string
    readonly trace: AssistantConversationProviderDispatchTrace
  }): void
  startStreaming(input: {
    readonly conversationId: string
    readonly assistantMessageId: string
    readonly requestController: AbortController
    readonly request: AssistantConversationProviderDispatchRequest<
      TProvider,
      TSettings,
      TAttachment,
      TMessage,
      TRetrievalSource,
      TWebSearchMode,
      TFallbackProviders,
      TRemoteCompactFallback,
      TProviderToolDeclarations,
      TReasoningEffort
    >
  } & TStreamLifecycle): Promise<TStreamingOutcome>
}

export interface AssistantConversationProviderDispatched<TStreamingOutcome> {
  readonly kind: 'dispatched'
  readonly streamingOutcome: TStreamingOutcome
}

/**
 * Opens the provider model trace, assembles the provider-neutral request, and
 * dispatches it through the injected stream runtime. Provider serialization,
 * projection, and finalization remain behind their existing target ports.
 */
export function createAssistantConversationProviderDispatchRuntime<
  TConversation extends AssistantConversationProviderDispatchConversationLike<
    TReasoningEffort
  >,
  TProvider extends AssistantConversationProviderDispatchProviderLike,
  TSettings,
  TAttachment,
  TMessage,
  TRetrievalSource,
  TWebSearchMode,
  TFallbackProviders,
  TRemoteCompactFallback,
  TProviderToolDeclarations,
  TReasoningEffort,
  TStreamLifecycle extends object,
  TStreamingOutcome,
>(
  dependencies: AssistantConversationProviderDispatchRuntimeDependencies<
    TProvider,
    TSettings,
    TAttachment,
    TMessage,
    TRetrievalSource,
    TWebSearchMode,
    TFallbackProviders,
    TRemoteCompactFallback,
    TProviderToolDeclarations,
    TReasoningEffort,
    TStreamLifecycle,
    TStreamingOutcome
  >,
) {
  type ProviderRequest = AssistantConversationProviderDispatchRequest<
    TProvider,
    TSettings,
    TAttachment,
    TMessage,
    TRetrievalSource,
    TWebSearchMode,
    TFallbackProviders,
    TRemoteCompactFallback,
    TProviderToolDeclarations,
    TReasoningEffort
  >

  async function dispatch(
    input: AssistantConversationProviderDispatchInput<
      TConversation,
      TProvider,
      TSettings,
      TAttachment,
      TMessage,
      TRetrievalSource,
      TWebSearchMode,
      TFallbackProviders,
      TRemoteCompactFallback,
      TProviderToolDeclarations,
      TReasoningEffort,
      TStreamLifecycle
    >,
  ): Promise<AssistantConversationProviderDispatched<TStreamingOutcome>> {
    const modelTraceId = dependencies.generateTraceId('model')
    dependencies.recordTrace({
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      trace: {
        id: modelTraceId,
        type: 'system',
        title: dependencies.modelRequestTitle(),
        content: `${input.provider.name} · ${input.runtimeConversation.model}`,
        status: 'running',
        startedAt: dependencies.now(),
        metadata: {
          providerId: input.provider.id,
          model: input.runtimeConversation.model,
          upstreamModel: input.upstreamModel,
          maxTokens: input.runtimeConversation.maxTokens,
          temperature: input.runtimeConversation.temperature,
        },
      },
    })

    const request: ProviderRequest = {
      provider: input.provider,
      model: input.runtimeConversation.model,
      requestedModel: input.runtimeConversation.model,
      systemPrompt: input.systemPrompt,
      temperature: input.runtimeConversation.temperature,
      topP: input.runtimeConversation.topP,
      topK: input.runtimeConversation.topK,
      reasoningEffort: input.runtimeConversation.reasoningEffort,
      maxTokens: input.runtimeConversation.maxTokens,
      generationParameterSources: resolveGenerationParameterSources({
        values: input.runtimeConversation,
        overrides: input.runtimeConversation.generationParameterOverrides,
      }),
      attachments: input.attachments,
      messages: input.messages,
      contextPrompt: input.contextPrompt,
      retrievalSources: input.retrievalSources,
      webSearchMode: input.webSearchMode,
      signal: input.requestController.signal,
      conversationId: input.conversationId,
      sessionId: input.conversationId,
      settings: input.settings,
      fallbackProviders: input.fallbackProviders,
      remoteCompactEligible: input.remoteCompactEligible,
      remoteCompactFallback: input.remoteCompactFallback,
      previousResponseId: input.previousResponseId,
      providerToolDeclarations: input.providerToolDeclarations,
    }
    const streamLifecycle = input.buildStreamLifecycle({
      modelTraceId,
      request,
    })
    const streamingOutcome = await dependencies.startStreaming({
      ...streamLifecycle,
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      requestController: input.requestController,
      request,
    })
    return {
      kind: 'dispatched',
      streamingOutcome,
    }
  }

  return { dispatch }
}
