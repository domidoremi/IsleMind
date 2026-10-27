import {
  executeHttpSseChat, executeProviderRuntimeChat, resolveRuntimeFallbackPlan,
  type HttpSseExecutionInput, type ProviderRuntimeChatExecutionInput,
} from './providerRuntimeExecutor'
import { recordProviderRuntimeFailure, recordProviderRuntimeSuccess } from './providerRuntimeHealth'
import { executionResources } from './executionResources'
import { providerRequestSerializer } from './providerRequestBinding'
import { buildProviderFallbackCandidates } from './providerFallbackCandidates'
import { acquireProviderSessionLease } from './providerSessionLeasePool'
import {
  assertProviderConfiguration, classifyProviderFailure, createProviderChatResolutionRuntime, createProviderRouteAssemblyPolicy,
  providerCompatibilityCapabilityCanBeSentForProvider, resolveLocalProviderRoute,
  type ProviderChatExecutionConstraint, type ProviderChatFallbackInput,
  type ProviderChatResolutionInput, type ProviderExecutionTarget, type ProviderRuntimeChatRequest,
} from '@/modules/providers'
import type { AIProvider } from '@/types/providerContracts'

const mockFallback = jest.fn()
const mockRevalidate = jest.fn()
const mockAvailability = jest.fn()
const mockCaptureConfiguration = jest.fn()
jest.mock('./providerChatResolutionRuntime', () => ({
  providerChatResolutionRuntime: {
    resolveFallback: (...args: unknown[]) => mockFallback(...args),
    revalidate: (...args: unknown[]) => mockRevalidate(...args),
  },
  chatFallbackConfirmation: () => undefined,
}))
jest.mock('./providerModelAvailabilityRuntime', () => ({
  providerModelAvailabilityRuntime: { getAvailability: (...args: unknown[]) => mockAvailability(...args),
    captureConfiguration: (...args: unknown[]) => mockCaptureConfiguration(...args) },
}))
jest.mock('./providerSessionLeasePool', () => ({ acquireProviderSessionLease: jest.fn() }))
jest.mock('./assistantRunGovernance', () => ({ assistantRunBudgetStore: { settle: jest.fn(async () => undefined) } }))
jest.mock('./usageStatisticsRuntime', () => ({ recordProviderUsageAttempt: jest.fn(async () => undefined) }))
jest.mock('./providerHealthRepository', () => ({ loadProviderHealthSnapshot: async () => ({ records: [] }) }))
jest.mock('./providerRuntimeHealth', () => ({
  ...jest.requireActual('./providerRuntimeHealth'),
  resolveProviderRuntimeHealthView: async () => undefined,
  recordProviderRuntimeSuccess: jest.fn(),
  recordProviderRuntimeFailure: jest.fn(),
}))
jest.mock('./providerRemoteCompactLifecycle', () => ({
  providerRemoteCompactLifecycle: { getCompactionGuardState: () => ({ autoDisabled: false }) },
}))
jest.mock('@/platform/native/runtimeLog', () => ({ appendRuntimeLog: jest.fn() }))
jest.mock('@/services/runtimeEvents', () => ({ emitRuntimeEvent: jest.fn() }))
jest.mock('./providerRetryRuntime', () => ({
  ...jest.requireActual('./providerRetryRuntime'), delayProviderRetry: async () => undefined,
}))
jest.mock('./providerResponsePolicies', () => ({
  ...jest.requireActual('./providerResponsePolicies'),
  parseProviderNonStreamingResponse: async () => ({
    text: 'fixture answer', traces: [], usage: { source: 'provider', inputTokens: 2, outputTokens: 1, totalTokens: 3 },
  }),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((finish, fail) => { resolve = finish; reject = fail })
  return { promise, resolve, reject }
}
const tick = async () => { for (let index = 0; index < 16; index++) await Promise.resolve() }
const metadata = (id: string): AIProvider => ({
  id, name: id, type: 'openai', enabled: true, models: ['gpt-4o'],
  apiKey: '', apiKeySource: { kind: 'none' },
})
const hydrated = (id: string): AIProvider => ({
  ...metadata(id), apiKey: `secure-fixture-${id}`, apiKeySource: { kind: 'primary' },
})
function constraint(catalog: readonly AIProvider[], id = 'a'):
ProviderChatExecutionConstraint & { providerCatalog: readonly AIProvider[] } {
  return { identity: { providerId: id, model: 'gpt-4o', credentialSource: { kind: 'primary' },
    protocolAdapterId: 'openai-chat', endpointVariant: 'direct' },
  scope: { scopeId: 'scope', epoch: 'epoch' }, fallbackUsed: false, providerCatalog: catalog }
}
function blockedFallback(input: ProviderChatFallbackInput) {
  return { decision: resolveLocalProviderRoute({ original: input.original, trigger: input.trigger,
    candidates: [], policy: { mode: 'off' } }).decision,
  candidates: { schema: 'provider-fallback-candidates.v1', candidates: [], rejectedCandidates: [],
    evidence: { providerCount: 0, modelCount: 0, credentialGroupCount: 0, requiredCapabilities: ['text'] } } }
}
function fixture() {
  const controller = new AbortController()
  const catalog = [metadata('a'), metadata('b')]
  const onExecutionTarget = jest.fn(async (_target: ProviderExecutionTarget) => undefined)
  const req: ProviderRuntimeChatRequest = {
    provider: hydrated('a'), model: 'gpt-4o', requestedModel: 'gpt-4o',
    messages: [{ role: 'user', content: 'original request' }], generationParameterSources: { maxTokens: 'explicit' },
    maxTokens: 100, signal: controller.signal,
    settings: { upstreamMaxRetries: 0, upstreamCircuitBreakerEnabled: false, modelBlocklist: [] },
    fallbackProviders: [hydrated('a'), hydrated('b')], executionConstraint: constraint(catalog), onExecutionTarget,
  }
  const wire = jest.fn(async () => new Response('{}', { status: 200 }))
  const fallbackWire = jest.fn(async () => new Response('{}', { status: 200 }))
  const routes = createProviderRouteAssemblyPolicy({ compatibilityCapabilityCanBeSent: providerCompatibilityCapabilityCanBeSentForProvider })
  const input: HttpSseExecutionInput = {
    req, controller, url: 'https://example.invalid/chat/completions', headers: {},
    body: JSON.stringify({ messages: req.messages, max_tokens: 100 }), stream: false,
    resolveRoute: providerRequestSerializer.serialize, buildFallbackCandidates: buildProviderFallbackCandidates,
    onChunk: jest.fn(), onDone: jest.fn(), onError: jest.fn(),
    transport: { assembleRoute: routes.assemble, resolveEndpoint: routes.resolveEndpoint, endpointHost: () => 'example.invalid',
      toWebSocketUrl: (url) => url.replace('https:', 'wss:'), requestStream: wire, request: fallbackWire,
      readResponseText: async (response) => response.text() },
    fallbackEffects: { logDecision: jest.fn(async () => undefined),
      recordRouteFailure: jest.fn(async () => undefined), recordRouteSuccess: jest.fn(async () => undefined) },
  }
  return { controller, catalog, req, input, wire, fallbackWire, onExecutionTarget }
}
beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(recordProviderRuntimeFailure).mockImplementation(async (input) =>
    classifyProviderFailure({ status: input.status, errorMessage: input.responseText }))
  mockFallback.mockImplementation(async (input: ProviderChatFallbackInput) => blockedFallback(input))
  mockRevalidate.mockImplementation(async (fence: ProviderChatExecutionConstraint) =>
    ({ provider: hydrated(fence.identity.providerId), model: fence.identity.model, constraint: fence }))
  mockAvailability.mockImplementation(async () => ({ scope: { scopeId: 'scope', epoch: 'epoch' }, availability: 'unknown' }))
  mockCaptureConfiguration.mockImplementation(() => () => undefined)
  jest.mocked(acquireProviderSessionLease).mockImplementation(async () =>
    ({ key: 'fixture-lease', release: jest.fn() } as Awaited<ReturnType<typeof acquireProviderSessionLease>>))
})
afterEach(() => expect(executionResources.retainedTextBytes).toBe(0))

it('captures failure-plan configuration, metadata and signal before the admitted health write', async () => {
  const f = fixture()
  const gate = deferred<ReturnType<typeof classifyProviderFailure>>()
  jest.mocked(recordProviderRuntimeFailure).mockImplementationOnce(() => gate.promise)
  const pending = resolveRuntimeFallbackPlan({ req: f.req, status: 503, buildFallbackCandidates: buildProviderFallbackCandidates })
  f.req.provider.id = 'later provider'
  f.req.model = 'later model'
  f.req.requestedModel = 'later requested model'
  f.req.settings!.upstreamMaxRetries = 99
  f.req.signal = new AbortController().signal
  f.catalog.push(metadata('later'))
  f.req.fallbackProviders![0].apiKey = 'later hydrated key'
  gate.resolve(classifyProviderFailure({ status: 503 }))
  await pending
  expect(mockFallback).toHaveBeenCalledWith(expect.objectContaining({
    preferred: { providerId: 'a', model: 'gpt-4o' }, signal: f.controller.signal,
    providers: [metadata('a'), metadata('b')],
    settings: { upstreamMaxRetries: 0, upstreamCircuitBreakerEnabled: false, modelBlocklist: [] },
  }))
  const [record] = jest.mocked(recordProviderRuntimeFailure).mock.calls[0]
  expect(record.req.provider.id).toBe('a')
  expect((record.req as ProviderRuntimeChatRequest).settings!.upstreamMaxRetries).toBe(0)
})

it.each(['success', 'rejection'] as const)(
  'settles an admitted health-write %s before original cancellation stops fallback admission',
  async (mode) => {
    const f = fixture()
    const gate = deferred<ReturnType<typeof classifyProviderFailure>>()
    jest.mocked(recordProviderRuntimeFailure).mockImplementationOnce(() => gate.promise)
    let settled = false
    const pending = resolveRuntimeFallbackPlan({ req: f.req, status: 503, buildFallbackCandidates: buildProviderFallbackCandidates })
      .finally(() => { settled = true })
    await tick()
    f.req.signal = new AbortController().signal
    f.controller.abort()
    await tick()
    expect(settled).toBe(false)
    if (mode === 'success') gate.resolve(classifyProviderFailure({ status: 503 }))
    else gate.reject(new Error('late health write failure'))
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockFallback).not.toHaveBeenCalled()
  },
)

it('forwards only original metadata to actual execution-target revalidation', async () => {
  const f = fixture()
  await executeHttpSseChat(f.input)
  const [fence, input] = mockRevalidate.mock.calls[0] as [ProviderChatExecutionConstraint, ProviderChatResolutionInput]
  expect((fence as ReturnType<typeof constraint>).providerCatalog).toEqual(f.catalog)
  expect(input.providers).toEqual(f.catalog)
  expect(input.providers!.every((provider) => provider.apiKey === '')).toBe(true)
  expect(f.wire).toHaveBeenCalledTimes(1)
  expect(f.onExecutionTarget).toHaveBeenCalledTimes(1)
})

it('keeps the wire identity, metadata fence and original observer through deferred scope reads', async () => {
  const f = fixture()
  const gate = deferred<Awaited<ReturnType<typeof mockAvailability>>>()
  mockAvailability.mockImplementationOnce(() => gate.promise)
  const pending = executeHttpSseChat(f.input)
  const settlement = pending.then(() => ({ error: undefined }), (error: unknown) => ({ error }))
  await tick()
  f.req.provider.id = 'later provider'
  f.req.settings!.upstreamMaxRetries = 99
  f.req.executionConstraint!.scope.epoch = 'later epoch'
  f.catalog.push(metadata('later'))
  const laterObserver = jest.fn(async () => undefined)
  f.req.onExecutionTarget = laterObserver
  gate.resolve({ scope: { scopeId: 'scope', epoch: 'epoch' }, availability: 'unknown' })
  const result = await settlement
  if (result.error) throw result.error
  expect(f.onExecutionTarget).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'a',
    scope: { scopeId: 'scope', epoch: 'epoch' } }))
  expect(laterObserver).not.toHaveBeenCalled()
  const [, input] = mockRevalidate.mock.calls[0] as [ProviderChatExecutionConstraint, ProviderChatResolutionInput]
  expect(input.providers).toEqual([metadata('a'), metadata('b')])
  expect(f.wire).toHaveBeenCalledTimes(1)
})

it('waits for a cancelled scope read and suppresses later target observers and wire dispatch', async () => {
  const f = fixture()
  const gate = deferred<Awaited<ReturnType<typeof mockAvailability>>>()
  mockAvailability.mockImplementationOnce(() => gate.promise)
  let settled = false
  const pending = executeHttpSseChat(f.input).finally(() => { settled = true })
  const settlement = pending.then(() => ({ error: undefined }), (error: unknown) => ({ error }))
  await tick()
  f.controller.abort()
  await tick()
  expect(settled).toBe(false)
  expect(executionResources.retainedTextBytes).toBeGreaterThan(0)
  gate.resolve({ scope: { scopeId: 'scope', epoch: 'epoch' }, availability: 'unknown' })
  expect((await settlement).error).toMatchObject({ name: 'AbortError' })
  expect(f.onExecutionTarget).not.toHaveBeenCalled()
  expect(f.wire).not.toHaveBeenCalled()
})

it.each(['scope', 'identity', 'credential'] as const)('retains the final %s mismatch fence before wire dispatch', async (kind) => {
  const f = fixture()
  if (kind === 'scope') mockAvailability.mockImplementationOnce(async () =>
    ({ scope: { scopeId: 'scope', epoch: 'changed' }, availability: 'unknown' }))
  else if (kind === 'identity') mockRevalidate.mockImplementationOnce(async (fence: ProviderChatExecutionConstraint) =>
    ({ provider: hydrated('b'), model: 'gpt-4o', constraint: { ...fence, identity: { ...fence.identity, providerId: 'b' } } }))
  else mockRevalidate.mockImplementationOnce(async (fence: ProviderChatExecutionConstraint) =>
    ({ provider: { ...hydrated('a'), apiKey: 'rotated-nonempty-fixture' }, model: 'gpt-4o', constraint: fence }))
  await expect(executeHttpSseChat(f.input)).rejects.toThrow('Could not record')
  expect(f.wire).not.toHaveBeenCalled()
  expect(f.onExecutionTarget).not.toHaveBeenCalled()
})

it('captures the complete HTTP execution input before waiting for the first response', async () => {
  const f = fixture()
  const entered = deferred<void>()
  const response = deferred<Response>()
  f.wire.mockImplementationOnce(() => { entered.resolve(); return response.promise })
  const originalDone = f.input.onDone as jest.Mock
  const laterDone = jest.fn()
  const pending = executeHttpSseChat(f.input)
  await entered.promise
  f.req.messages[0].content = 'later request'
  f.req.provider.name = 'later name'
  f.req.settings!.upstreamMaxRetries = 99
  f.input.onDone = laterDone
  response.resolve(new Response('{}', { status: 200 }))
  await pending
  expect(originalDone).toHaveBeenCalledTimes(1)
  expect(laterDone).not.toHaveBeenCalled()
  const [success] = jest.mocked(recordProviderRuntimeSuccess).mock.calls[0]
  expect((success.req as ProviderRuntimeChatRequest).messages[0].content).toBe('original request')
  expect((success.req as ProviderRuntimeChatRequest).settings!.upstreamMaxRetries).toBe(0)
})

function bindRealResolution(f: ReturnType<typeof fixture>) {
  let selectedKey = 'secure-fixture-b'
  let liveSettings: ProviderRuntimeChatRequest['settings'] = { modelBlocklist: [] }
  let epoch = 'epoch'
  let configuration = 0
  const confirm = jest.fn(async () => true)
  const readProviders = jest.fn(async (_signal: AbortSignal, options?: { providers?: readonly AIProvider[] }) => {
    const catalog = options?.providers ?? f.catalog
    return catalog.map((expected) => {
      assertProviderConfiguration(f.catalog.find((provider) => provider.id === expected.id), expected)
      return { ...expected, apiKey: expected.id === 'b' ? selectedKey : `secure-fixture-${expected.id}`,
        apiKeySource: { kind: 'primary' as const } }
    })
  })
  const runtime = createProviderChatResolutionRuntime({
    readProviders, isOnline: async () => true, buildCandidates: buildProviderFallbackCandidates,
    loadHealthRecords: async () => ({}), configurationValid: (provider) => Boolean(provider.apiKey),
    accessAllowed: (_provider, model, settings) =>
      !settings?.modelBlocklist?.includes(model) && !liveSettings?.modelBlocklist?.includes(model),
    getAvailability: async () => ({ scope: { scopeId: 'scope', epoch }, availability: 'unknown' }),
    healthAllows: async () => true,
    resolveIdentity: (provider, model, credentialSource) =>
      ({ providerId: provider.id, model, credentialSource, protocolAdapterId: 'openai-chat', endpointVariant: 'direct' }),
  })
  mockRevalidate.mockImplementation(runtime.revalidate)
  mockFallback.mockImplementation(runtime.resolveFallback)
  mockAvailability.mockImplementation(async () =>
    ({ scope: { scopeId: 'scope', epoch }, availability: 'unknown' }))
  mockCaptureConfiguration.mockImplementation(() => {
    const captured = configuration
    const metadata = JSON.stringify(f.catalog)
    return () => {
      if (configuration !== captured || JSON.stringify(f.catalog) !== metadata) throw new Error('configuration changed')
    }
  })
  f.req.confirmFallback = confirm
  return { readProviders, confirm, rotateKey: () => { selectedKey = 'rotated-nonempty-fixture'; configuration++ },
    revokeAccess: () => { liveSettings = { modelBlocklist: ['gpt-4o'] } },
    changeEpoch: () => { epoch = 'changed'; configuration++ } }
}

it('uses one consented full-pipeline failure fallback and keeps original metadata through final wire admission', async () => {
  const f = fixture()
  const resolution = bindRealResolution(f)
  f.wire.mockResolvedValueOnce(new Response('temporarily unavailable', { status: 503 }))
  await executeHttpSseChat(f.input)
  expect(f.wire).toHaveBeenCalledTimes(1)
  expect(f.fallbackWire).toHaveBeenCalledTimes(1)
  expect(resolution.confirm).toHaveBeenCalledTimes(1)
  expect(f.onExecutionTarget.mock.calls.map(([target]) => target.providerId)).toEqual(['a', 'b'])
  expect(mockFallback.mock.calls[0][0].providers).toEqual(f.catalog)
  expect(mockRevalidate.mock.calls[1][1].providers).toEqual(f.catalog)
  expect((mockRevalidate.mock.calls[1][0] as ReturnType<typeof constraint>).providerCatalog).toEqual(f.catalog)
  expect(resolution.readProviders.mock.calls.every(([, options]) =>
    options?.providers?.every((provider) => provider.apiKey === ''))).toBe(true)
  const wireCalls = f.fallbackWire.mock.calls as unknown as [string, RequestInit][]
  const body = JSON.parse(wireCalls[0][1].body as string)
  expect(body.model).toBe('gpt-4o')
  expect(body.stream).toBe(false)
  expect(f.input.onDone).toHaveBeenCalledTimes(1)
})

it.each(['metadata', 'credential', 'access', 'caller-access', 'policy', 'scope'] as const)(
  'live %s revocation after fallback planning prevents any selected wire attempt',
  async (kind) => {
    const f = fixture()
    const resolution = bindRealResolution(f)
    const entered = deferred<void>()
    const release = deferred<void>()
    f.wire.mockResolvedValueOnce(new Response('temporarily unavailable', { status: 503 }))
    f.input.fallbackEffects.logDecision = jest.fn(async () => { entered.resolve(); await release.promise })
    const pending = executeHttpSseChat(f.input)
    const settlement = pending.then(() => ({ error: undefined }), (error: unknown) => ({ error }))
    await entered.promise
    if (kind === 'metadata') f.catalog[1].name = 'changed catalog entry'
    else if (kind === 'credential') resolution.rotateKey()
    else if (kind === 'access') resolution.revokeAccess()
    else if (kind === 'caller-access') f.req.settings = { modelBlocklist: ['gpt-4o'] }
    else if (kind === 'policy') f.req.failoverPolicy = { mode: 'off' }
    else resolution.changeEpoch()
    release.resolve()
    expect((await settlement).error).toBeDefined()
    expect(f.wire).toHaveBeenCalledTimes(1)
    expect(f.fallbackWire).not.toHaveBeenCalled()
    expect(f.onExecutionTarget).toHaveBeenCalledTimes(1)
    expect(resolution.confirm).toHaveBeenCalledTimes(1)
    expect(f.input.onDone).not.toHaveBeenCalled()
  },
)

it('legacy fallback planning keeps hydrated candidates distinct while capturing them before a health write', async () => {
  const f = fixture()
  f.req.executionConstraint = undefined
  const buildCandidates = jest.fn(buildProviderFallbackCandidates)
  const gate = deferred<ReturnType<typeof classifyProviderFailure>>()
  jest.mocked(recordProviderRuntimeFailure).mockImplementationOnce(() => gate.promise)
  const pending = resolveRuntimeFallbackPlan({ req: f.req, status: 503, buildFallbackCandidates: buildCandidates })
  f.req.fallbackProviders![0].name = 'later runtime provider'
  f.req.fallbackProviders!.push(hydrated('later'))
  gate.resolve(classifyProviderFailure({ status: 503 }))
  await pending
  expect(buildCandidates.mock.calls[0][0].providers).toEqual([hydrated('a'), hydrated('b')])
  expect(mockFallback).not.toHaveBeenCalled()
  expect(mockRevalidate).not.toHaveBeenCalled()
})

it('legacy fallback planning cannot use captured permission after live policy revocation during a health write', async () => {
  const f = fixture()
  f.req.executionConstraint = undefined
  f.req.failoverPolicy = { mode: 'approved-providers', approvedProviderIds: ['b'], maxCostTier: 'unknown' }
  const gate = deferred<ReturnType<typeof classifyProviderFailure>>()
  jest.mocked(recordProviderRuntimeFailure).mockImplementationOnce(() => gate.promise)
  const pending = resolveRuntimeFallbackPlan({ req: f.req, status: 503, buildFallbackCandidates: buildProviderFallbackCandidates })
  f.req.failoverPolicy = { mode: 'off' }
  gate.resolve(classifyProviderFailure({ status: 503 }))
  const result = await pending
  expect(result.decision.eligible).toBe(false)
  expect(result.decision.selected).toBeUndefined()
})

it('legacy fallback execution respects live policy revocation after an admitted decision log', async () => {
  const f = fixture()
  f.req.executionConstraint = undefined
  f.req.failoverPolicy = { mode: 'approved-providers', approvedProviderIds: ['b'], maxCostTier: 'unknown' }
  const entered = deferred<void>()
  const release = deferred<void>()
  f.wire.mockResolvedValueOnce(new Response('temporarily unavailable', { status: 503 }))
  f.input.fallbackEffects.logDecision = jest.fn(async () => { entered.resolve(); await release.promise })
  const pending = executeHttpSseChat(f.input)
  const settlement = pending.then(() => undefined, () => undefined)
  await entered.promise
  f.req.failoverPolicy = { mode: 'off' }
  release.resolve()
  await settlement
  expect(f.wire).toHaveBeenCalledTimes(1)
  expect(f.fallbackWire).not.toHaveBeenCalled()
  expect(f.input.onDone).not.toHaveBeenCalled()
})

it.each(['constrained', 'legacy'] as const)(
  'final caller access revocation during a %s target observer suppresses the first wire attempt',
  async (kind) => {
    const f = fixture()
    if (kind === 'legacy') f.req.executionConstraint = undefined
    const entered = deferred<void>()
    const release = deferred<void>()
    f.req.onExecutionTarget = jest.fn(async () => { entered.resolve(); await release.promise })
    const pending = executeHttpSseChat(f.input)
    const settlement = pending.then(() => ({ error: undefined }), (error: unknown) => ({ error }))
    await entered.promise
    f.req.settings = { modelBlocklist: ['gpt-4o'] }
    release.resolve()
    expect((await settlement).error).toBeDefined()
    expect(f.wire).not.toHaveBeenCalled()
    expect(f.fallbackWire).not.toHaveBeenCalled()
    expect(f.input.onDone).not.toHaveBeenCalled()
  },
)

it.each(['metadata', 'credential', 'scope'] as const)(
  'final configuration %s revocation during an admitted target observer prevents wire dispatch',
  async (kind) => {
    const f = fixture()
    const resolution = bindRealResolution(f)
    const entered = deferred<void>()
    const release = deferred<void>()
    f.req.onExecutionTarget = jest.fn(async () => { entered.resolve(); await release.promise })
    const pending = executeHttpSseChat(f.input)
    const settlement = pending.then(() => ({ error: undefined }), (error: unknown) => ({ error }))
    await entered.promise
    if (kind === 'metadata') f.catalog[0].name = 'changed metadata'
    else if (kind === 'credential') resolution.rotateKey()
    else resolution.changeEpoch()
    release.resolve()
    expect((await settlement).error).toBeDefined()
    expect(f.wire).not.toHaveBeenCalled()
    expect(f.fallbackWire).not.toHaveBeenCalled()
    expect(f.input.onDone).not.toHaveBeenCalled()
  },
)

it('captures WebSocket routing data before its lease wait while retaining exact lease and transport ports', async () => {
  const f = fixture()
  const entered = deferred<void>()
  const lease = deferred<Awaited<ReturnType<typeof acquireProviderSessionLease>>>()
  const release = jest.fn()
  jest.mocked(acquireProviderSessionLease).mockImplementationOnce(() => { entered.resolve(); return lease.promise })
  const run = jest.fn(async () => undefined)
  const rawBody = { input: [{ role: 'user', content: 'original socket request' }], max_output_tokens: 100, stream: true }
  const input = { ...f.input, pipeline: { runtimeReq: f.req, effectiveReq: f.req, stream: true,
    transportSelection: { transport: 'responses_websocket' }, headers: { 'X-Fixture': 'original' }, rawBody,
    proxyPolicy: { effectiveUrl: 'https://socket.example.invalid/responses' },
    preparedHttpRequest: { url: f.input.url, headers: {}, body: JSON.stringify(rawBody) } },
  responsesWebSocketTransport: { run } } as unknown as ProviderRuntimeChatExecutionInput
  const pending = executeProviderRuntimeChat(input)
  await entered.promise
  input.pipeline.proxyPolicy.effectiveUrl = 'https://later.example.invalid/responses'
  input.pipeline.headers['X-Fixture'] = 'later'
  rawBody.input[0].content = 'later socket request'
  f.req.settings!.upstreamMaxRetries = 99
  lease.resolve({ key: 'fixture-lease', release } as Awaited<ReturnType<typeof acquireProviderSessionLease>>)
  await pending
  expect(run).toHaveBeenCalledWith(expect.objectContaining({
    url: 'wss://socket.example.invalid/responses', headers: { 'X-Fixture': 'original' },
    body: expect.objectContaining({ input: [{ role: 'user', content: 'original socket request' }] }),
    signal: f.controller.signal,
  }))
  const calls = run.mock.calls as unknown as [{ req: ProviderRuntimeChatRequest }][]
  expect(calls[0][0].req.settings!.upstreamMaxRetries).toBe(0)
  expect(release).toHaveBeenCalledTimes(1)
  expect(f.wire).not.toHaveBeenCalled()
})
