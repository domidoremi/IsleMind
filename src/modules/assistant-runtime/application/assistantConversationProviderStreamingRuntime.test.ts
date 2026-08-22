import {
  createAssistantConversationProviderStreamingRuntime,
  type AssistantConversationActiveProviderStream,
} from '@/modules/assistant-runtime'

describe('assistant provider streaming runtime', () => {
  it('admits only the first terminal callback', async () => {
    const requestController = new AbortController()
    const providerController = new AbortController()
    const providerDone = new Promise<void>(() => undefined)
    const result = { text: 'completed' }
    const providerError = new Error('late provider failure')
    let callbacks: {
      onDone: (value: typeof result) => void
      onError: (error: Error) => void
    } | undefined
    let activeStream: AssistantConversationActiveProviderStream | undefined
    let completionCalls = 0
    let providerFailureCalls = 0
    let clearCalls = 0

    const runtime = createAssistantConversationProviderStreamingRuntime<
      { readonly signal: AbortSignal },
      typeof result,
      Error,
      readonly unknown[],
      unknown
    >({
      createProjection() {
        return { pushText() {}, pushTrace() {}, flush() {} }
      },
      async dispatch(_request, _onChunk, onDone, onError) {
        callbacks = { onDone, onError }
        return { controller: providerController, done: providerDone }
      },
      getActiveStream() {
        return activeStream
      },
      setActiveStream(_conversationId, handle) {
        activeStream = handle
      },
      clearActiveStream() {
        clearCalls += 1
        activeStream = undefined
      },
      isMessageCancelled() {
        return false
      },
    })

    const started = await runtime.start({
      conversationId: 'conversation-stream-duplicate-terminal',
      assistantMessageId: 'assistant-stream-duplicate-terminal',
      request: { signal: requestController.signal },
      requestController,
      async complete() {
        completionCalls += 1
      },
      completionFailed() {
        throw new Error('completion failure must not be projected')
      },
      providerFailed() {
        providerFailureCalls += 1
      },
      citations() {},
      startFailed(error) {
        throw error
      },
    })

    expect(started.kind).toBe('started')
    callbacks?.onDone(result)
    callbacks?.onDone(result)
    callbacks?.onError(providerError)
    await Promise.resolve()

    expect(completionCalls).toBe(1)
    expect(providerFailureCalls).toBe(0)
    expect(clearCalls).toBe(0)
    expect(activeStream?.messageId).toBe('assistant-stream-duplicate-terminal')
  })

  it('does not project a second provider failure callback', async () => {
    const requestController = new AbortController()
    const providerController = new AbortController()
    const providerDone = new Promise<void>(() => undefined)
    const providerError = new Error('provider failed')
    let callbacks: { onError: (error: Error) => void } | undefined
    let providerFailureCalls = 0
    let clearCalls = 0

    const runtime = createAssistantConversationProviderStreamingRuntime<
      { readonly signal: AbortSignal },
      { readonly text: string },
      Error,
      readonly unknown[],
      unknown
    >({
      createProjection() {
        return { pushText() {}, pushTrace() {}, flush() {} }
      },
      async dispatch(_request, _onChunk, _onDone, onError) {
        callbacks = { onError }
        return { controller: providerController, done: providerDone }
      },
      getActiveStream() {
        return {
          controller: providerController,
          messageId: 'assistant-stream-duplicate-failure',
        }
      },
      setActiveStream() {},
      clearActiveStream() {
        clearCalls += 1
      },
      isMessageCancelled() {
        return false
      },
    })

    const started = await runtime.start({
      conversationId: 'conversation-stream-duplicate-failure',
      assistantMessageId: 'assistant-stream-duplicate-failure',
      request: { signal: requestController.signal },
      requestController,
      async complete() {},
      completionFailed() {
        throw new Error('completion failure must not be projected')
      },
      providerFailed(error) {
        providerFailureCalls += 1
        expect(error).toBe(providerError)
      },
      citations() {},
      startFailed(error) {
        throw error
      },
    })

    expect(started.kind).toBe('started')
    callbacks?.onError(providerError)
    callbacks?.onError(providerError)

    expect(providerFailureCalls).toBe(1)
    expect(clearCalls).toBe(1)
  })
})
