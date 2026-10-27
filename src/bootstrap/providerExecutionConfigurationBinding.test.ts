import { streamProviderChat, toRuntimeChatRequest } from './providerRuntime'
import type {
  ProviderChatExecutionConstraint, ProviderChatResolutionInput, ProviderChatSelection,
  ProviderExecutionTarget, ProviderRuntimeChatCallbacks, ProviderRuntimeChatRequest,
} from '@/modules/providers'
import type { AIProvider } from '@/types/providerContracts'
import type { ChatRequest } from '@/core'

const mockRevalidate = jest.fn()
const mockStart = jest.fn()
const mockBegin = jest.fn()
const mockSettle = jest.fn()
jest.mock('@/modules/providers', () => ({
  ...jest.requireActual('@/modules/providers'),
  createResponsesWebSocketTransport: () => ({}),
  createProviderStreamRuntime: () => ({ start: (...args: unknown[]) => mockStart(...args) }),
}))
jest.mock('./providerChatResolutionRuntime', () => ({
  providerChatResolutionRuntime: { revalidate: (...args: unknown[]) => mockRevalidate(...args) },
  chatFallbackConfirmation: () => undefined,
}))
jest.mock('./providerModelAvailabilityRuntime', () => ({
  bindProviderModelAvailabilityOperations: jest.fn(),
  providerModelAvailabilityRuntime: {
    beginExecution: (...args: unknown[]) => mockBegin(...args),
    settleExecution: (...args: unknown[]) => mockSettle(...args),
  },
}))
jest.mock('./providerRequestBinding', () => ({}))
jest.mock('./providerRuntimeExecutor', () => ({}))
jest.mock('./providerRuntimeGateway', () => ({}))
jest.mock('./providerRuntimePipeline', () => ({}))
jest.mock('./providerTransport', () => ({}))
jest.mock('./providerFallbackCandidates', () => ({}))
jest.mock('./providerRuntimeFallbackEffects', () => ({}))
jest.mock('./providerResponsePolicies', () => ({}))
jest.mock('./providerNativeToolDeclarations', () => ({
  buildProviderNativeToolDeclarations: () => [], resolveProviderNativeToolDeclarationTarget: () => ({}),
}))
jest.mock('./usageStatisticsRuntime', () => ({}))
jest.mock('@/i18n/service', () => ({ st: (key: string) => key }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((finish, fail) => { resolve = finish; reject = fail })
  return { promise, resolve, reject }
}
const tick = async () => { for (let index = 0; index < 16; index++) await Promise.resolve() }
const metadata = (id: string): AIProvider => ({
  id, name: id, type: 'openai', enabled: true, apiKey: '', apiKeySource: { kind: 'none' }, models: ['gpt-4o'],
})
const hydrated = (id: string): AIProvider => ({ ...metadata(id),
  apiKey: `secure-fixture-${id}`, apiKeySource: { kind: 'primary' } })
function fixture() {
  const controller = new AbortController()
  const catalog = [metadata('a'), metadata('b')]
  const constraint: ProviderChatExecutionConstraint & { providerCatalog: readonly AIProvider[] } = {
    identity: { providerId: 'a', model: 'gpt-4o', credentialSource: { kind: 'primary' },
      protocolAdapterId: 'openai-chat', endpointVariant: 'native' },
    scope: { scopeId: 'scope', epoch: 'epoch' }, fallbackUsed: false, providerCatalog: catalog,
  }
  const onExecutionTarget = jest.fn(async () => undefined)
  const onExecutionFailure = jest.fn()
  const request: ProviderRuntimeChatRequest = {
    provider: hydrated('a'), model: 'gpt-4o', requestedModel: 'gpt-4o', signal: controller.signal,
    messages: [{ role: 'user', content: 'original request' }], generationParameterSources: { maxTokens: 'explicit' },
    maxTokens: 100, settings: { modelBlocklist: [], upstreamMaxRetries: 2 },
    fallbackProviders: [hydrated('a'), hydrated('b')], executionConstraint: constraint,
    onExecutionTarget, onExecutionFailure,
  }
  return { controller, catalog, constraint, request, onExecutionTarget, onExecutionFailure }
}
beforeEach(() => {
  jest.clearAllMocks()
  mockRevalidate.mockImplementation(async (constraint: ProviderChatExecutionConstraint) => ({
    provider: hydrated(constraint.identity.providerId), model: constraint.identity.model, constraint,
  }))
  mockStart.mockImplementation(async () => ({ controller: new AbortController(), done: Promise.resolve() }))
  mockBegin.mockImplementation(async (_target: ProviderExecutionTarget, operationId: string) =>
    ({ operationId, scopeId: 'scope', epoch: 'epoch' }))
  mockSettle.mockImplementation(async () => undefined)
})

it('captures runtime request data, original signal and metadata before dynamic import admission', async () => {
  const f = fixture()
  const pending = streamProviderChat(f.request, jest.fn(), jest.fn(), jest.fn())
  f.request.provider.name = 'later provider name'
  f.request.model = 'later model'
  f.request.requestedModel = 'later requested model'
  f.request.messages[0].content = 'later request'
  f.request.settings!.upstreamMaxRetries = 99
  f.request.signal = new AbortController().signal
  f.catalog.push(metadata('later'))
  f.request.fallbackProviders![0].apiKey = 'later runtime key'
  const handle = await pending
  await handle.done
  expect(mockRevalidate).toHaveBeenCalledWith(expect.objectContaining({
    providerCatalog: [metadata('a'), metadata('b')],
  }), expect.objectContaining({
    preferred: { providerId: 'a', model: 'gpt-4o' }, signal: f.controller.signal,
    providers: [metadata('a'), metadata('b')], settings: { modelBlocklist: [], upstreamMaxRetries: 2 },
  }))
  const [request] = mockStart.mock.calls[0] as [ProviderRuntimeChatRequest]
  expect(request.messages[0].content).toBe('original request')
  expect(request.fallbackProviders![0].apiKey).toBe('secure-fixture-a')
  expect(request.signal).toBe(f.controller.signal)
})

it('never substitutes hydrated fallback providers for metadata catalog equality checks', async () => {
  const f = fixture()
  await (await streamProviderChat(f.request, jest.fn(), jest.fn(), jest.fn())).done
  const [, input] = mockRevalidate.mock.calls[0] as [ProviderChatExecutionConstraint, ProviderChatResolutionInput]
  expect(input.providers).toEqual(f.catalog)
  expect(input.providers!.every((provider) => provider.apiKey === '')).toBe(true)
  expect(input.providers).not.toBe(f.request.fallbackProviders)
})

it.each(['success', 'rejection'] as const)(
  'settles pending stream admission %s on the original cancelled signal without starting another runtime',
  async (mode) => {
    const f = fixture()
    const gate = deferred<ProviderChatSelection>()
    mockRevalidate.mockImplementationOnce(() => gate.promise)
    let settled = false
    const pending = streamProviderChat(f.request, jest.fn(), jest.fn(), jest.fn())
      .finally(() => { settled = true })
    await tick()
    f.request.signal = new AbortController().signal
    f.controller.abort()
    await tick()
    expect(settled).toBe(false)
    if (mode === 'success') gate.resolve({ provider: hydrated('a'), model: 'gpt-4o', constraint: f.constraint })
    else gate.reject(new Error('late admission failure'))
    const handle = await pending
    await handle.done
    expect(mockStart).not.toHaveBeenCalled()
  },
)

it('retains original execution observer ports while request data is detached', async () => {
  const f = fixture()
  const laterTarget = jest.fn(async () => undefined)
  const laterFailure = jest.fn()
  mockStart.mockImplementationOnce(async (request: ProviderRuntimeChatRequest, callbacks: ProviderRuntimeChatCallbacks) => ({
    controller: new AbortController(), done: Promise.resolve().then(async () => {
      await request.onExecutionTarget!({ ...f.constraint.identity, attemptId: 'attempt' })
      request.onExecutionFailure!('upstream_error')
      callbacks.onDone({ text: 'answer', traces: [] })
    }),
  }))
  const pending = streamProviderChat(f.request, jest.fn(), jest.fn(), jest.fn())
  f.request.onExecutionTarget = laterTarget
  f.request.onExecutionFailure = laterFailure
  await (await pending).done
  expect(f.onExecutionTarget).toHaveBeenCalledTimes(1)
  expect(f.onExecutionFailure).toHaveBeenCalledWith('upstream_error')
  expect(laterTarget).not.toHaveBeenCalled()
  expect(laterFailure).not.toHaveBeenCalled()
  expect(mockSettle).toHaveBeenCalledWith(expect.anything(), 'gpt-4o',
    { kind: 'operational', reason: 'server_error' })
})

it('preserves a live caller access revocation without allowing settings drift to expand selection', async () => {
  const f = fixture()
  const gate = deferred<void>()
  mockRevalidate.mockImplementationOnce(async (constraint: ProviderChatExecutionConstraint,
    input: ProviderChatResolutionInput & { readCurrentAccessSettings?: () => ProviderRuntimeChatRequest['settings'] }) => {
    await gate.promise
    const current = input.readCurrentAccessSettings?.() ?? input.settings
    return current?.modelBlocklist?.includes('gpt-4o') ? undefined
      : { provider: hydrated('a'), model: 'gpt-4o', constraint }
  })
  const pending = streamProviderChat(f.request, jest.fn(), jest.fn(), jest.fn())
  await tick()
  f.request.settings = { modelBlocklist: ['gpt-4o'], upstreamMaxRetries: 99 }
  gate.resolve()
  await expect(pending).rejects.toThrow('admitted model route changed')
  expect(mockStart).not.toHaveBeenCalled()
})

it('pre-aborted constrained streams admit no resolver, runtime or availability operation', async () => {
  const f = fixture()
  f.controller.abort()
  await (await streamProviderChat(f.request, jest.fn(), jest.fn(), jest.fn())).done
  expect(mockRevalidate).not.toHaveBeenCalled()
  expect(mockStart).not.toHaveBeenCalled()
  expect(mockBegin).not.toHaveBeenCalled()
})

it('keeps the metadata fence on canonical first dispatch but never adds a new route loop to bound continuation', () => {
  const f = fixture()
  const request = { conversationId: 'conversation', providerId: 'a', model: 'gpt-4o',
    messages: [{ id: 'user', role: 'user', text: 'request' }], generationParameterSources: {} } as unknown as ChatRequest
  const first = toRuntimeChatRequest({ provider: f.request.provider, executionConstraint: f.constraint }, request)
  expect(first.executionConstraint).toBe(f.constraint)
  const continuation = toRuntimeChatRequest({ provider: f.request.provider, executionConstraint: f.constraint },
    { ...request, providerStateBinding: { providerId: 'a' } } as unknown as ChatRequest)
  expect(continuation.executionConstraint).toBeUndefined()
  expect(continuation.allowFallback).toBe(false)
})

it('waits for pending availability begin settlement and blocks later observer admission after cancellation', async () => {
  const f = fixture()
  const entered = deferred<void>()
  const operation = deferred<{ operationId: string; scopeId: string; epoch: string }>()
  mockBegin.mockImplementationOnce(() => { entered.resolve(); return operation.promise })
  mockStart.mockImplementationOnce(async (request: ProviderRuntimeChatRequest) => ({
    controller: new AbortController(), done: request.onExecutionTarget!({ ...f.constraint.identity, attemptId: 'pending' }),
  }))
  const handle = await streamProviderChat(f.request, jest.fn(), jest.fn(), jest.fn())
  let settled = false
  const completion = handle.done.then(() => ({ error: undefined }), (error: unknown) => ({ error }))
    .finally(() => { settled = true })
  await entered.promise
  f.controller.abort()
  await tick()
  expect(settled).toBe(false)
  operation.resolve({ operationId: 'pending', scopeId: 'scope', epoch: 'epoch' })
  expect((await completion).error).toBeDefined()
  expect(f.onExecutionTarget).not.toHaveBeenCalled()
  expect(mockSettle).toHaveBeenCalledTimes(1)
  expect(mockSettle).toHaveBeenCalledWith(expect.objectContaining({ operationId: 'pending' }), 'gpt-4o',
    { kind: 'operational', reason: 'cancelled' })
})

it('settles the prior attempt but does not begin a later target after cancellation during settlement', async () => {
  const f = fixture()
  const entered = deferred<void>()
  const settlement = deferred<void>()
  mockSettle.mockImplementationOnce(() => { entered.resolve(); return settlement.promise })
  mockStart.mockImplementationOnce(async (request: ProviderRuntimeChatRequest) => ({
    controller: new AbortController(), done: Promise.resolve().then(async () => {
      await request.onExecutionTarget!({ ...f.constraint.identity, attemptId: 'first' })
      request.onExecutionFailure!('upstream_error')
      await request.onExecutionTarget!({ ...f.constraint.identity, attemptId: 'later' })
    }),
  }))
  const handle = await streamProviderChat(f.request, jest.fn(), jest.fn(), jest.fn())
  const completion = handle.done.then(() => ({ error: undefined }), (error: unknown) => ({ error }))
  await entered.promise
  f.controller.abort()
  settlement.resolve()
  expect((await completion).error).toBeDefined()
  expect(mockBegin).toHaveBeenCalledTimes(1)
  expect(f.onExecutionTarget).toHaveBeenCalledTimes(1)
  expect(mockSettle).toHaveBeenCalledTimes(1)
})
