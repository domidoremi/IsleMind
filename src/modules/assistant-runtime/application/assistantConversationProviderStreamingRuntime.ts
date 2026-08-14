export interface AssistantConversationProviderStreamHandle {
  readonly controller: AbortController
  readonly done: Promise<void>
}

export interface AssistantConversationActiveProviderStream {
  readonly controller: AbortController
  readonly messageId: string
  readonly flush?: () => void
  readonly done?: Promise<void>
}

export interface AssistantConversationProviderStreamProjection<TTrace> {
  pushText(chunk: string): void
  pushTrace(trace: TTrace): void
  flush(): void
}

export interface AssistantConversationProviderStreamingRuntimeDependencies<
  TRequest,
  TCompletion,
  TProviderError,
  TCitations,
  TTrace,
> {
  createProjection(input: {
    readonly conversationId: string
    readonly responseMessageId: string
  }): AssistantConversationProviderStreamProjection<TTrace>
  dispatch(
    request: TRequest,
    onChunk: (chunk: string) => void,
    onDone: (result: TCompletion) => void,
    onError: (error: TProviderError) => void,
    onCitations: (citations: TCitations) => void,
    onTrace: (trace: TTrace) => void,
  ): Promise<AssistantConversationProviderStreamHandle>
  getActiveStream(conversationId: string): AssistantConversationActiveProviderStream | undefined
  setActiveStream(
    conversationId: string,
    handle: AssistantConversationActiveProviderStream,
  ): void
  clearActiveStream(conversationId: string): void
  isMessageCancelled(input: {
    readonly conversationId: string
    readonly assistantMessageId: string
  }): boolean
}

export interface AssistantConversationProviderStreamingRuntimeInput<
  TRequest,
  TCompletion,
  TProviderError,
  TCitations,
> {
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly request: TRequest
  readonly requestController: AbortController
  readonly complete: (
    result: TCompletion,
    lifecycle: {
      readonly requestController: AbortController
      readonly flush: () => void
    },
  ) => Promise<void>
  readonly completionFailed: (error: unknown) => void
  readonly providerFailed: (error: TProviderError) => void
  readonly citations: (citations: TCitations) => void
  readonly startFailed: (error: unknown) => void
}

export interface AssistantConversationProviderStreamingStarted {
  readonly kind: 'started'
  readonly handle: AssistantConversationProviderStreamHandle
}

export interface AssistantConversationProviderStreamingCancelled {
  readonly kind: 'cancelled'
}

export interface AssistantConversationProviderStreamingFailed {
  readonly kind: 'failed'
  readonly error: unknown
}

export type AssistantConversationProviderStreamingOutcome =
  | AssistantConversationProviderStreamingStarted
  | AssistantConversationProviderStreamingCancelled
  | AssistantConversationProviderStreamingFailed

/**
 * Owns the provider stream projection, callback bridge, active-handle
 * replacement, and settlement lifecycle. Concrete provider dispatch, message
 * state, and terminal projections remain injected by bootstrap.
 */
export function createAssistantConversationProviderStreamingRuntime<
  TRequest,
  TCompletion,
  TProviderError,
  TCitations,
  TTrace,
>(
  dependencies: AssistantConversationProviderStreamingRuntimeDependencies<
    TRequest,
    TCompletion,
    TProviderError,
    TCitations,
    TTrace
  >,
) {
  async function start(
    input: AssistantConversationProviderStreamingRuntimeInput<
      TRequest,
      TCompletion,
      TProviderError,
      TCitations
    >,
  ): Promise<AssistantConversationProviderStreamingOutcome> {
    const projection = dependencies.createProjection({
      conversationId: input.conversationId,
      responseMessageId: input.assistantMessageId,
    })
    const flush = projection.flush

    dependencies.setActiveStream(input.conversationId, {
      controller: input.requestController,
      messageId: input.assistantMessageId,
      flush,
    })

    let terminalCallbackStarted = false
    let providerController: AbortController | undefined
    let handle: AssistantConversationProviderStreamHandle
    try {
      handle = await dependencies.dispatch(
        input.request,
        (chunk) => {
          projection.pushText(chunk)
        },
        (result) => {
          terminalCallbackStarted = true
          void input.complete(result, {
            requestController: input.requestController,
            flush,
          }).catch((error) => {
            flush()
            clearMatchingActiveStream(input.conversationId, input.assistantMessageId)
            if (!isCancelled(input, providerController)) input.completionFailed(error)
          })
        },
        (error) => {
          terminalCallbackStarted = true
          flush()
          clearMatchingActiveStream(input.conversationId, input.assistantMessageId)
          if (!isCancelled(input, providerController)) input.providerFailed(error)
        },
        (citations) => {
          input.citations(citations)
        },
        (trace) => {
          projection.pushTrace(trace)
        },
      )
      providerController = handle.controller

      if (
        isCancelled(input, providerController)
      ) {
        handle.controller.abort()
        void handle.done.catch(() => undefined)
        return { kind: 'cancelled' }
      }

      if (terminalCallbackStarted) {
        void handle.done.catch(() => undefined)
        return { kind: 'started', handle }
      }

      dependencies.setActiveStream(input.conversationId, {
        controller: handle.controller,
        messageId: input.assistantMessageId,
        flush,
        done: handle.done,
      })
      const settle = () => {
        flush()
        clearMatchingActiveStream(input.conversationId, input.assistantMessageId)
      }
      void handle.done.then(settle, settle)
      return { kind: 'started', handle }
    } catch (error) {
      flush()
      if (error instanceof Error && error.name === 'AbortError') {
        return { kind: 'cancelled' }
      }
      if (isCancelled(input, providerController)) {
        return { kind: 'cancelled' }
      }
      if (terminalCallbackStarted) {
        return { kind: 'failed', error }
      }
      input.startFailed(error)
      return { kind: 'failed', error }
    }
  }

  function clearMatchingActiveStream(conversationId: string, assistantMessageId: string): void {
    if (dependencies.getActiveStream(conversationId)?.messageId === assistantMessageId) {
      dependencies.clearActiveStream(conversationId)
    }
  }

  function isCancelled(
    input: Pick<
      AssistantConversationProviderStreamingRuntimeInput<
        TRequest,
        TCompletion,
        TProviderError,
        TCitations
      >,
      'conversationId' | 'assistantMessageId' | 'requestController'
    >,
    providerController?: AbortController,
  ): boolean {
    return input.requestController.signal.aborted || providerController?.signal.aborted === true || dependencies.isMessageCancelled({
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
    })
  }

  return { start }
}
