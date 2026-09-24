import {
  createAssistantConversationProviderStreamingRuntime,
  type AssistantConversationActiveProviderStream,
  type AssistantConversationProviderStreamingRuntimeDependencies,
  type AssistantConversationProviderStreamingRuntimeInput,
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

type StreamingDependencies = AssistantConversationProviderStreamingRuntimeDependencies<
  { signal: AbortSignal }, { text: string }, Error, string[], string
>
type StreamingInput = AssistantConversationProviderStreamingRuntimeInput<
  { signal: AbortSignal }, { text: string }, Error, string[], string
>

function createStreamingHarness() {
  const requestController = new AbortController()
  const providerController = new AbortController()
  let resolveDone!: () => void
  let rejectDone!: (error: Error) => void
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve
    rejectDone = reject
  })
  const handle = { controller: providerController, done }
  let callbacks!: {
    text: Parameters<StreamingDependencies['dispatch']>[1]
    complete: Parameters<StreamingDependencies['dispatch']>[2]
    error: Parameters<StreamingDependencies['dispatch']>[3]
    citations: Parameters<StreamingDependencies['dispatch']>[4]
    trace: Parameters<StreamingDependencies['dispatch']>[5]
  }
  const state: { active?: AssistantConversationActiveProviderStream; cancelled: boolean } = {
    cancelled: false,
  }
  const projection = { pushText: jest.fn(), pushTrace: jest.fn(), flush: jest.fn() }
  const dependencies: StreamingDependencies = {
    createProjection: jest.fn(() => projection),
    dispatch: jest.fn(async (_request, text, complete, error, citations, trace) => {
      callbacks = { text, complete, error, citations, trace }
      return handle
    }),
    getActiveStream: () => state.active,
    setActiveStream: jest.fn((_conversationId, active) => { state.active = active }),
    clearActiveStream: jest.fn(() => { state.active = undefined }),
    isMessageCancelled: () => state.cancelled,
  }
  const input: StreamingInput = {
    conversationId: 'stream-conversation',
    assistantMessageId: 'stream-message',
    request: { signal: requestController.signal },
    requestController,
    onTextDelta: jest.fn(),
    onTrace: jest.fn(),
    complete: jest.fn(async () => undefined),
    completionFailed: jest.fn(),
    providerFailed: jest.fn(),
    citations: jest.fn(),
    startFailed: jest.fn(),
  }
  return {
    runtime: createAssistantConversationProviderStreamingRuntime(dependencies),
    dependencies, input, projection, state, handle, resolveDone, rejectDone,
    get callbacks() { return callbacks },
  }
}

function expectNoProviderEffects(harness: ReturnType<typeof createStreamingHarness>) {
  expect(harness.projection.pushText).not.toHaveBeenCalled()
  expect(harness.projection.pushTrace).not.toHaveBeenCalled()
  expect(harness.input.onTextDelta).not.toHaveBeenCalled()
  expect(harness.input.onTrace).not.toHaveBeenCalled()
  expect(harness.input.citations).not.toHaveBeenCalled()
  expect(harness.input.complete).not.toHaveBeenCalled()
  expect(harness.input.providerFailed).not.toHaveBeenCalled()
  expect(harness.input.completionFailed).not.toHaveBeenCalled()
  expect(harness.input.startFailed).not.toHaveBeenCalled()
}

describe('provider stream cancellation boundaries', () => {
  it.each(['request', 'message'] as const)('does not dispatch a pre-cancelled %s', async (source) => {
    const harness = createStreamingHarness()
    if (source === 'request') harness.input.requestController.abort()
    else harness.state.cancelled = true

    expect(await harness.runtime.start(harness.input)).toEqual({ kind: 'cancelled' })
    expect(harness.dependencies.dispatch).not.toHaveBeenCalled()
    expect(harness.dependencies.createProjection).not.toHaveBeenCalled()
    expect(harness.dependencies.setActiveStream).not.toHaveBeenCalled()
  })

  it('forwards accepted text, traces, citations and completion unchanged', async () => {
    const harness = createStreamingHarness()
    expect(await harness.runtime.start(harness.input)).toEqual({ kind: 'started', handle: harness.handle })
    harness.callbacks.text('partial answer')
    harness.callbacks.trace('working')
    harness.callbacks.citations(['source'])
    harness.callbacks.complete({ text: 'answer' })
    harness.resolveDone()
    await harness.handle.done

    expect(harness.projection.pushText).toHaveBeenCalledWith('partial answer')
    expect(harness.input.onTextDelta).toHaveBeenCalledWith('partial answer')
    expect(harness.projection.pushTrace).toHaveBeenCalledWith('working')
    expect(harness.input.onTrace).toHaveBeenCalledWith('working')
    expect(harness.input.citations).toHaveBeenCalledWith(['source'])
    expect(harness.input.complete).toHaveBeenCalledWith({ text: 'answer' }, expect.objectContaining({
      requestController: harness.input.requestController,
      flush: harness.projection.flush,
    }))
    expect(harness.projection.flush).toHaveBeenCalled()
    expect(harness.state.active).toBeUndefined()
  })

  it.each(['request', 'provider', 'message'] as const)(
    'ignores late output and completion after %s cancellation',
    async (source) => {
      const harness = createStreamingHarness()
      await harness.runtime.start(harness.input)
      if (source === 'request') harness.input.requestController.abort()
      else if (source === 'provider') harness.handle.controller.abort()
      else harness.state.cancelled = true

      harness.callbacks.text('must not reappear')
      harness.callbacks.trace('must not restart a stopped trace')
      harness.callbacks.citations(['late source'])
      harness.callbacks.complete({ text: 'must not finalize a stopped reply' })
      harness.callbacks.error(new Error('late abort error'))
      harness.resolveDone()
      await harness.handle.done

      expectNoProviderEffects(harness)
      expect(harness.projection.flush).toHaveBeenCalled()
      expect(harness.state.active).toBeUndefined()
    },
  )

  it('ignores callbacks during cancellation before dispatch returns its handle', async () => {
    const harness = createStreamingHarness()
    let returnHandle!: () => void
    const pending = new Promise<void>((resolve) => { returnHandle = resolve })
    const dispatch = harness.dependencies.dispatch
    harness.dependencies.dispatch = async (...args) => {
      const handle = await dispatch(...args)
      await pending
      return handle
    }
    const start = harness.runtime.start(harness.input)
    harness.input.requestController.abort()
    const replacement = { controller: new AbortController(), messageId: 'new-reply' }
    harness.state.active = replacement
    harness.callbacks.text('late output')
    harness.callbacks.trace('late trace')
    harness.callbacks.citations(['late source'])
    harness.callbacks.complete({ text: 'late completion' })
    returnHandle()

    expect(await start).toEqual({ kind: 'cancelled' })
    expect(harness.handle.controller.signal.aborted).toBe(true)
    expect(harness.state.active).toBe(replacement)
    expectNoProviderEffects(harness)
    harness.resolveDone()
  })

  it.each(['complete', 'error', 'settled'] as const)(
    'does not accept data after the %s terminal boundary',
    async (terminal) => {
      const harness = createStreamingHarness()
      await harness.runtime.start(harness.input)
      if (terminal === 'complete') harness.callbacks.complete({ text: 'finished' })
      else if (terminal === 'error') harness.callbacks.error(new Error('failed'))
      else {
        harness.resolveDone()
        await harness.handle.done
      }
      harness.callbacks.text('late data')
      harness.callbacks.trace('late trace')
      harness.callbacks.citations(['late source'])
      expect(harness.projection.pushText).not.toHaveBeenCalled()
      expect(harness.projection.pushTrace).not.toHaveBeenCalled()
      expect(harness.input.citations).not.toHaveBeenCalled()
      harness.resolveDone()
    },
  )

  it('clears an aborted dispatch handle without projecting a failure', async () => {
    const harness = createStreamingHarness()
    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' })
    harness.dependencies.dispatch = jest.fn(async () => { throw aborted })
    expect(await harness.runtime.start(harness.input)).toEqual({ kind: 'cancelled' })
    expect(harness.state.active).toBeUndefined()
    expectNoProviderEffects(harness)
  })

  it('releases a failed dispatch before reporting the failure', async () => {
    const harness = createStreamingHarness()
    const error = new Error('offline')
    harness.dependencies.dispatch = jest.fn(async () => { throw error })
    expect(await harness.runtime.start(harness.input)).toEqual({ kind: 'failed', error })
    expect(harness.state.active).toBeUndefined()
    expect(harness.input.startFailed).toHaveBeenCalledWith(error)
    expect(harness.projection.flush).toHaveBeenCalled()
  })

  it('reports rejected continuation completion once and releases the matching stream', async () => {
    const harness = createStreamingHarness()
    const error = new Error('Provider continuation state exceeds the supported size limit.')
    jest.mocked(harness.input.complete).mockRejectedValueOnce(error)
    await harness.runtime.start(harness.input)
    harness.callbacks.complete({ text: 'answer' })
    await Promise.resolve()

    expect(harness.input.completionFailed).toHaveBeenCalledTimes(1)
    expect(harness.input.completionFailed).toHaveBeenCalledWith(error)
    expect(harness.state.active).toBeUndefined()
    expect(harness.projection.flush).toHaveBeenCalled()
    harness.callbacks.complete({ text: 'late answer' })
    harness.callbacks.text('late text')
    expect(harness.input.complete).toHaveBeenCalledTimes(1)
    expect(harness.projection.pushText).not.toHaveBeenCalled()
    harness.resolveDone()
  })
})
