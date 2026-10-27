import { createConversationMemoryExtractionRuntime } from './conversationMemoryExtractionRuntime'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((finish, fail) => { resolve = finish; reject = fail })
  return { promise, resolve, reject }
}

function fixture() {
  const controller = new AbortController()
  const barrier = deferred<readonly string[]>()
  const extract = jest.fn(() => barrier.promise)
  const projectTransition = jest.fn()
  const input = {
    conversationId: 'conversation', assistantMessageId: 'response',
    messages: [{ id: 'user', content: 'admitted request' }],
    provider: { id: 'provider', apiKey: 'fixture-key' }, model: 'admitted-model',
    settings: { memoryEnabled: true, nested: { extractionLimit: 3 } },
    memoryEnabled: true, signal: controller.signal,
  }
  const runtime = createConversationMemoryExtractionRuntime({
    extractor: { extract }, projectTransition, nonErrorFailureMessage: 'failed',
    cancellationMessage: 'stopped',
  })
  return { controller, barrier, extract, projectTransition, input, runtime }
}

it('hands detached settings, provider and message provenance to the six-argument extractor', async () => {
  const f = fixture()
  const run = f.runtime.run(f.input)
  f.input.settings.nested.extractionLimit = 99
  f.input.messages[0].content = 'later request'
  f.input.provider.apiKey = 'later-key'
  f.input.model = 'later-model'
  f.barrier.resolve(['saved'])
  await expect(run).resolves.toEqual({ status: 'completed', addedCount: 1, items: ['saved'] })
  expect(f.extract).toHaveBeenCalledWith(
    'conversation', [{ id: 'user', content: 'admitted request' }],
    { id: 'provider', apiKey: 'fixture-key' }, 'admitted-model', f.controller.signal,
    { settings: { memoryEnabled: true, nested: { extractionLimit: 3 } } },
  )
})

it('does not admit extraction on a pre-aborted signal', async () => {
  const f = fixture()
  f.barrier.resolve([])
  f.controller.abort()
  await expect(f.runtime.run(f.input)).resolves.toEqual({ status: 'cancelled', message: 'stopped' })
  expect(f.extract).not.toHaveBeenCalled()
  expect(f.projectTransition.mock.calls.map(([value]) => value.transition.status)).toEqual(['cancelled'])
})

it('checks cancellation caused by the running projection before extraction admission', async () => {
  const f = fixture()
  f.barrier.resolve([])
  f.projectTransition.mockImplementation(() => f.controller.abort())
  await expect(f.runtime.run(f.input)).resolves.toEqual({ status: 'cancelled', message: 'stopped' })
  expect(f.extract).not.toHaveBeenCalled()
})

it.each(['success', 'rejection'] as const)('awaits admitted %s but never projects late completion or ordinary failure after cancellation', async mode => {
  const f = fixture()
  let settled = false
  const run = f.runtime.run(f.input).finally(() => { settled = true })
  f.input.signal = new AbortController().signal
  f.input.conversationId = 'replacement'
  f.controller.abort()
  await Promise.resolve()
  expect(settled).toBe(false)
  if (mode === 'success') f.barrier.resolve(['effect-may-remain'])
  else f.barrier.reject(new Error('late failure'))
  await expect(run).resolves.toEqual({ status: 'cancelled', message: 'stopped' })
  expect(f.projectTransition.mock.calls.map(([value]) => [value.conversationId, value.transition.status]))
    .toEqual([['conversation', 'running'], ['conversation', 'cancelled']])
})

it('keeps disabled extraction side-effect free and retains ordinary failure classification', async () => {
  const f = fixture()
  f.input.memoryEnabled = false
  await expect(f.runtime.run(f.input)).resolves.toEqual({ status: 'skipped', reason: 'memory_disabled' })
  expect(f.extract).not.toHaveBeenCalled()
  const failure = fixture()
  const run = failure.runtime.run(failure.input)
  failure.barrier.reject(new Error('extract failed'))
  await expect(run).resolves.toEqual({ status: 'failed', message: 'extract failed' })
})

it('classifies AbortError as cancellation even if the signal has not fired', async () => {
  const f = fixture()
  const run = f.runtime.run(f.input)
  f.barrier.reject(Object.assign(new Error('adapter cancelled'), { name: 'AbortError' }))
  await expect(run).resolves.toEqual({ status: 'cancelled', message: 'adapter cancelled' })
})
