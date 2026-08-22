import {
  resolveGenerationParameterSources,
  type GenerationParameterKey,
  type GenerationParameterSources,
  type StreamEvent,
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
  readonly onTextDelta?: (chunk: string) => void
  readonly onStreamEvent?: (event: StreamEvent) => void
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
    readonly onTextDelta?: (chunk: string) => void
    readonly onStreamEvent?: (event: StreamEvent) => void
  } & TStreamLifecycle): Promise<TStreamingOutcome>
}

export interface AssistantConversationProviderDispatched<TStreamingOutcome> {
  readonly kind: 'dispatched'
  readonly streamingOutcome: TStreamingOutcome
}

export interface AssistantConversationProviderPreparedDispatch<TProviderRequest> {
  readonly request: TProviderRequest
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

  type DispatchInput = AssistantConversationProviderDispatchInput<
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
  >

  function prepare(
    input: DispatchInput,
  ): AssistantConversationProviderPreparedDispatch<ProviderRequest> {
    const snapshots = new WeakMap<object, unknown>()
    const request: ProviderRequest = Object.freeze({
      provider: snapshotPreparedValue(input.provider, snapshots),
      model: input.runtimeConversation.model,
      requestedModel: input.runtimeConversation.model,
      systemPrompt: input.systemPrompt,
      temperature: input.runtimeConversation.temperature,
      topP: input.runtimeConversation.topP,
      topK: input.runtimeConversation.topK,
      reasoningEffort: input.runtimeConversation.reasoningEffort,
      maxTokens: input.runtimeConversation.maxTokens,
      generationParameterSources: snapshotPreparedValue(
        resolveGenerationParameterSources({
          values: input.runtimeConversation,
          overrides: input.runtimeConversation.generationParameterOverrides,
        }),
        snapshots,
      ),
      attachments: snapshotPreparedValue(input.attachments, snapshots),
      messages: snapshotPreparedValue(input.messages, snapshots),
      contextPrompt: input.contextPrompt,
      retrievalSources: snapshotPreparedValue(input.retrievalSources, snapshots),
      webSearchMode: input.webSearchMode,
      signal: input.requestController.signal,
      conversationId: input.conversationId,
      sessionId: input.conversationId,
      settings: snapshotPreparedValue(input.settings, snapshots),
      fallbackProviders: snapshotPreparedValue(input.fallbackProviders, snapshots),
      remoteCompactEligible: input.remoteCompactEligible,
      remoteCompactFallback: snapshotPreparedValue(input.remoteCompactFallback, snapshots),
      previousResponseId: input.previousResponseId,
      providerToolDeclarations: snapshotPreparedValue(
        input.providerToolDeclarations,
        snapshots,
      ),
    })
    return Object.freeze({ request })
  }

  async function dispatchPrepared(
    input: DispatchInput,
    prepared: AssistantConversationProviderPreparedDispatch<ProviderRequest>,
  ): Promise<AssistantConversationProviderDispatched<TStreamingOutcome>> {
    const { request } = prepared
    if (
      request.conversationId !== input.conversationId
      || request.provider.id !== input.provider.id
      || request.model !== input.runtimeConversation.model
      || request.signal !== input.requestController.signal
    ) {
      throw new Error('The prepared provider request does not match the admitted Chat dispatch.')
    }
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
      ...(input.onTextDelta ? { onTextDelta: input.onTextDelta } : {}),
      ...(input.onStreamEvent ? { onStreamEvent: input.onStreamEvent } : {}),
    })
    return {
      kind: 'dispatched',
      streamingOutcome,
    }
  }

  async function dispatch(
    input: DispatchInput,
  ): Promise<AssistantConversationProviderDispatched<TStreamingOutcome>> {
    return dispatchPrepared(input, prepare(input))
  }

  return { prepare, dispatchPrepared, dispatch }
}

function snapshotPreparedValue<Value>(
  value: Value,
  snapshots: WeakMap<object, unknown>,
): Value {
  if (value === null || typeof value !== 'object') return value

  const source = value as object
  const existing = snapshots.get(source)
  if (existing !== undefined) return existing as Value

  if (Array.isArray(value)) {
    const snapshot: unknown[] = []
    snapshots.set(source, snapshot)
    for (const child of value) {
      snapshot.push(snapshotPreparedValue(child, snapshots))
    }
    return Object.freeze(snapshot) as Value
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('Prepared provider request data must use plain objects and arrays.')
  }

  const snapshot = Object.create(prototype) as Record<string, unknown>
  snapshots.set(source, snapshot)
  for (const [key, child] of Object.entries(value)) {
    snapshot[key] = snapshotPreparedValue(child, snapshots)
  }
  return Object.freeze(snapshot) as Value
}
