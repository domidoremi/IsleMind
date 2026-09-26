import { checkFinalProviderRequestCapacity, isProviderContextOverflow, prepareFinalProviderRequestCapacity } from './providerContextCapacity'
import { executeHttpSseChat, executeProviderRuntimeChat, type HttpSseExecutionInput, type ProviderRuntimeChatExecutionInput, type RuntimeFallbackPlan } from './providerRuntimeExecutor'
import { assistantRunBudgetStore } from './assistantRunGovernance'
import { executionResources } from './executionResources'
import { providerRemoteCompactLifecycle } from './providerRemoteCompactLifecycle'
import { recordProviderRuntimeFailure } from './providerRuntimeHealth'
import { providerRequestSerializer } from './providerRequestBinding'
import { buildProviderFallbackCandidates } from './providerFallbackCandidates'
import { getModelConfig, mergeModelConfig } from '@/types/modelCatalog'
import type { AIProvider } from '@/types/providerContracts'
import { createProviderRouteAssemblyPolicy, mapOpenAICompatibleModels, providerCompatibilityCapabilityCanBeSentForProvider,
  type ProviderExecutionTarget, type ProviderRuntimeChatRequest } from '@/modules/providers'
import * as packing from '@/modules/assistant-runtime'

// Public-barrel re-exports are getters. Preserve the real implementation while
// exposing configurable properties for the compression call-count assertions.
jest.mock('@/modules/assistant-runtime', () => {
  const actual = jest.requireActual('@/modules/assistant-runtime')
  return { ...actual, summarizeContextPackingHistory: jest.fn(actual.summarizeContextPackingHistory) }
})
import { parseProviderChatCompletionJson } from './providerResponsePolicies'

jest.mock('./assistantRunGovernance', () => ({ assistantRunBudgetStore: { settle: jest.fn(async () => undefined) } }))
jest.mock('./usageStatisticsRuntime', () => ({ recordProviderUsageAttempt: jest.fn(async () => undefined) }))
jest.mock('./providerHealthRepository', () => ({ loadProviderHealthSnapshot: async () => ({ records: [] }) }))
jest.mock('./providerRuntimeHealth', () => ({
  ...jest.requireActual('./providerRuntimeHealth'),
  resolveProviderRuntimeHealthView: async () => undefined,
  recordProviderRuntimeSuccess: jest.fn(),
  recordProviderRuntimeFailure: jest.fn(async (input) => ({ trigger: input.status === 503 ? 'server_error' : 'unknown', retryable: false, source: 'status', evidence: {} })),
}))
jest.mock('./providerRemoteCompactLifecycle', () => ({ providerRemoteCompactLifecycle: { getCompactionGuardState: jest.fn(() => ({ autoDisabled: false })) } }))
jest.mock('@/platform/native/runtimeLog', () => ({ appendRuntimeLog: jest.fn() }))
jest.mock('@/services/runtimeEvents', () => ({ emitRuntimeEvent: jest.fn() }))
jest.mock('./providerRetryRuntime', () => ({ ...jest.requireActual('./providerRetryRuntime'), delayProviderRetry: async () => undefined }))
jest.mock('./providerResponsePolicies', () => ({ ...jest.requireActual('./providerResponsePolicies'),
  parseProviderNonStreamingResponse: async () => ({ text: 'answer', traces: [], usage: { source: 'provider', inputTokens: 20, outputTokens: 10, totalTokens: 30 } }),
}))

const routes = createProviderRouteAssemblyPolicy({ compatibilityCapabilityCanBeSent: providerCompatibilityCapabilityCanBeSentForProvider })
let nextProvider = 0
function provider(window = 6000): AIProvider {
  return { id: `capacity-test-${nextProvider++}`, name: 'Capacity', type: 'openai-compatible', enabled: true,
    baseUrl: 'https://example.invalid/v1', apiKey: 'test-only', apiKeySource: { kind: 'primary' }, models: ['capacity-model'],
    modelConfigs: mapOpenAICompatibleModels({ data: [{ id: 'capacity-model', context_window: window,
      max_output_tokens: 512, supported_parameters: ['tools'] }] }, 'openai-compatible'),
  }
}
function history() {
  return [
    ...Array.from({ length: 12 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const,
      content: `Older fact ${index}; must retain the confirmed project constraint. ${'older details '.repeat(350)}` })),
    ...Array.from({ length: 8 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, content: `Recent note ${index}` })),
    { role: 'user' as const, content: '  Current task: preserve this exact user request.\n' },
  ]
}
function request(window = 6000): ProviderRuntimeChatRequest {
  return { provider: provider(window), model: 'capacity-model', messages: history(), generationParameterSources: {}, maxTokens: 100 }
}
function body(req: ProviderRuntimeChatRequest) { return { messages: [{ role: 'system', content: 'Authoritative instructions' }, ...req.messages], max_tokens: 100 } }
function fixture(window = 6000) {
  const req = request(window)
  const targets: ProviderExecutionTarget[] = []
  req.onExecutionTarget = async (target) => { targets.push(target) }
  req.settings = { upstreamMaxRetries: 0 }
  const wire = jest.fn(async () => new Response('{}', { status: 200 }))
  const fallbackWire = jest.fn(async () => new Response('{}', { status: 200 }))
  const onDone = jest.fn()
  const onError = jest.fn()
  const decisions: RuntimeFallbackPlan[] = []
  const input: HttpSseExecutionInput = { req, url: 'https://example.invalid/v1/chat/completions', headers: {},
    body: JSON.stringify(body(req)), stream: false, controller: new AbortController(),
    resolveRoute: providerRequestSerializer.serialize, onChunk: jest.fn(), onDone, onError, onTrace: jest.fn(),
    transport: { assembleRoute: routes.assemble, resolveEndpoint: routes.resolveEndpoint, endpointHost: () => 'example.invalid',
      toWebSocketUrl: (url) => url.replace('https:', 'wss:'), requestStream: wire, request: fallbackWire, readResponseText: async (response) => response.text() },
    buildFallbackCandidates: buildProviderFallbackCandidates, fallbackEffects: { logDecision: async (_req, plan) => { decisions.push(plan) }, recordRouteFailure: async () => undefined, recordRouteSuccess: async () => undefined },
  }
  return { input, targets, wire, fallbackWire, onDone, onError, decisions }
}
const overflow = () => new Response('{"error":{"code":"context_length_exceeded","message":"maximum context length exceeded"}}', { status: 400 })
beforeEach(() => { jest.clearAllMocks(); jest.mocked(providerRemoteCompactLifecycle.getCompactionGuardState).mockReturnValue({ autoDisabled: false } as ReturnType<typeof providerRemoteCompactLifecycle.getCompactionGuardState>) })
afterEach(() => { jest.restoreAllMocks(); expect(executionResources.retainedTextBytes).toBe(0) })

test('an uncapped wire request reserves the model maximum, never the app default', () => {
  const req = request(1000)
  const body = { messages: [{ role: 'user', content: 'hello' }] }
  expect(checkFinalProviderRequestCapacity({ ...req, body }).reservedOutputTokens).toBe(512)
  req.provider.modelConfigs![0].defaultMaxTokens = 100
  req.provider.modelConfigs![0].maxOutputTokens = 900
  expect(checkFinalProviderRequestCapacity({ ...req, body }).reservedOutputTokens).toBe(512)
  req.provider.modelConfigs![0].outputTokenLimit = { tokens: 900, source: 'provider' }
  expect(() => checkFinalProviderRequestCapacity({ ...req, body })).toThrow('context_capacity')
  delete req.provider.modelConfigs![0].outputTokenLimit
  expect(() => checkFinalProviderRequestCapacity({ ...req, body })).toThrow('invalid_capacity')
  expect(checkFinalProviderRequestCapacity({ ...req, body: { ...body, max_tokens: 100 } }).reservedOutputTokens).toBe(100)
})

test.each(['id-only discovery', 'legacy remote', 'remerged legacy remote'])(
  '%s cannot turn inferred output defaults into an uncapped bound', (source) => {
    const req = request()
    const model = req.model = 'custom-no-output-metadata'
    const legacy = { ...getModelConfig(model, 'openai-compatible'), source: 'remote' as const }
    req.provider.modelConfigs = source === 'id-only discovery'
      ? mapOpenAICompatibleModels({ data: [{ id: model }] }, 'openai-compatible')
      : [source === 'legacy remote' ? legacy : mergeModelConfig(model, 'openai-compatible', legacy)]
    expect(req.provider.modelConfigs[0]).toMatchObject({ source: 'remote', maxOutputTokens: 4096 })
    const body = { messages: [{ role: 'user', content: 'hello' }] }
    expect(() => checkFinalProviderRequestCapacity({ ...req, body })).toThrow('invalid_capacity')
    expect(checkFinalProviderRequestCapacity({ ...req, body: { ...body, max_tokens: 100 } }).reservedOutputTokens).toBe(100)
  },
)

test('catalog evidence survives id-only discovery and legacy rows without trusting their display limits', () => {
  const req = request()
  req.model = 'gpt-4o'
  const legacy = { ...getModelConfig(req.model), maxOutputTokens: 1, source: 'remote' as const }
  delete legacy.outputTokenLimit
  for (const modelConfigs of [[], [legacy], mapOpenAICompatibleModels({ data: [{ id: req.model }] }, 'openai-compatible')]) {
    req.provider.modelConfigs = modelConfigs
    expect(checkFinalProviderRequestCapacity({ ...req, body: { messages: [] } }).reservedOutputTokens).toBe(16384)
  }
})

test('uncapped admission preserves the raw provider limit across inferred context clamping and persistence', () => {
  const req = request()
  req.provider.modelConfigs = mapOpenAICompatibleModels({ data: [{ id: req.model, max_output_tokens: 60_000 }] }, 'openai-compatible')
  const persisted = JSON.parse(JSON.stringify(req.provider.modelConfigs[0]))
  req.provider.modelConfigs = [mergeModelConfig(req.model, 'openai-compatible', { ...persisted, contextWindow: 60_000 })]
  expect(req.provider.modelConfigs[0].maxOutputTokens).toBe(32768)
  expect(() => checkFinalProviderRequestCapacity({ ...req, body: { messages: [] } })).toThrow('context_capacity')
  expect(checkFinalProviderRequestCapacity({ ...req, body: { messages: [], max_tokens: 100 } }).reservedOutputTokens).toBe(100)
})

test.each([
  { output: undefined, error: 'invalid_capacity' },
  { output: 900, error: 'context_capacity' },
  { output: 512, error: undefined },
])('parameter correction removing the wire cap rechecks provider evidence ($output)', async ({ output, error }) => {
  const f = fixture(1000)
  f.input.req.model = 'custom-no-output-metadata'
  f.input.req.provider.modelConfigs = mapOpenAICompatibleModels({ data: [{ id: f.input.req.model,
    context_window: 1000, max_output_tokens: output }] }, 'openai-compatible')
  f.input.req.messages = [{ role: 'user', content: 'hello' }]
  f.input.body = JSON.stringify(body(f.input.req))
  f.wire.mockImplementationOnce(async () => new Response('unsupported parameter: max_tokens', { status: 400 }))
  if (error) {
    await expect(executeHttpSseChat(f.input)).rejects.toThrow(error)
    expect(f.wire).toHaveBeenCalledTimes(1)
    expect(f.targets).toHaveLength(1)
    expect(f.onDone).not.toHaveBeenCalled()
  } else {
    await executeHttpSseChat(f.input)
    expect(f.wire).toHaveBeenCalledTimes(2)
    expect(f.targets.map((target) => target.tokenEstimate?.outputTokens)).toEqual([100, 512])
    const corrected = JSON.parse((f.wire.mock.calls as unknown as [string, RequestInit][])[1][1].body as string)
    expect(corrected.max_tokens).toBeUndefined()
    expect(f.onDone).toHaveBeenCalledTimes(1)
  }
  expect(assistantRunBudgetStore.settle).toHaveBeenCalledTimes(error ? 1 : 2)
  expect(f.fallbackWire).not.toHaveBeenCalled()
})

test.each(['json', 'buffered', 'stream'] as const)('cancel during final usage persistence cannot publish %s completion', async (mode) => {
  const f = fixture(60_000)
  f.input.stream = mode !== 'json'
  const data = 'data: {"choices":[{"delta":{"content":"answer"}}]}\n\ndata: [DONE]\n\n'
  if (mode === 'buffered') f.wire.mockImplementation(async () => ({ ok: true, status: 200,
    headers: new Headers(), body: null, text: async () => data }) as Response)
  if (mode === 'stream') f.wire.mockImplementation(async () => new Response(data, { status: 200 }))
  let release!: () => void
  let entered!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  const persisting = new Promise<void>((resolve) => { entered = resolve })
  jest.mocked(assistantRunBudgetStore.settle).mockImplementationOnce(async () => { entered(); await pending })
  const execution = executeHttpSseChat(f.input)
  const rejected = expect(execution).rejects.toThrow('cancel during usage persistence')
  await persisting
  f.input.controller.abort(new Error('cancel during usage persistence'))
  release()
  await rejected
  expect(f.onDone).not.toHaveBeenCalled()
  expect(f.fallbackWire).not.toHaveBeenCalled()
  expect(f.wire).toHaveBeenCalledTimes(1)
})

test('local recovery rechecks the rebuilt envelope before its sole observed wire attempt', async () => {
  const f = fixture()
  await executeHttpSseChat(f.input)
  expect(f.wire).toHaveBeenCalledTimes(1)
  const sent = JSON.parse((f.wire.mock.calls as unknown as [string, RequestInit][])[0][1].body as string)
  expect(sent.messages[0]).toEqual(body(f.input.req).messages[0])
  expect(sent.messages.at(-1)).toEqual(f.input.req.messages.at(-1))
  expect(sent.messages.length).toBeLessThan(f.input.req.messages.length)
  expect(checkFinalProviderRequestCapacity({ ...f.input.req, body: sent }).limit).toBe(5100)
  expect(f.targets).toHaveLength(1)
  expect(f.targets[0].tokenEstimate!.inputTokens + f.targets[0].tokenEstimate!.outputTokens).toBeLessThanOrEqual(5100)
  expect(f.onDone).toHaveBeenCalledTimes(1)
})

test('an irreducible assembled tool schema stops before attribution, budget reservation or transport', async () => {
  const f = fixture()
  f.input.body = JSON.stringify({ ...body(f.input.req), tools: [{ description: 'tool schema '.repeat(5000) }] })
  const summarize = jest.spyOn(packing, 'summarizeContextPackingHistory')
  await expect(executeHttpSseChat(f.input)).rejects.toThrow('context_capacity')
  f.input.body = JSON.stringify(body(f.input.req))
  await expect(executeHttpSseChat(f.input)).rejects.toThrow('context_capacity')
  expect(summarize).toHaveBeenCalledTimes(1)
  expect(f.targets).toHaveLength(0)
  expect(f.wire).not.toHaveBeenCalled()
  expect(assistantRunBudgetStore.settle).not.toHaveBeenCalled()
  expect(recordProviderRuntimeFailure).not.toHaveBeenCalled()
})

test.each([{ modelContextCompressionEnabled: false }, { localCompressionAllowed: false }, { privacyMode: 'strict-remote' }])(
  'disabled or privacy-blocked compression never disables final admission (%j)', async (settings) => {
    const f = fixture(); f.input.req.settings = settings
    const summarize = jest.spyOn(packing, 'summarizeContextPackingHistory')
    await expect(executeHttpSseChat(f.input)).rejects.toThrow('context_capacity')
    expect(f.wire).not.toHaveBeenCalled(); expect(summarize).not.toHaveBeenCalled()
  },
)

test('a session auto-compaction circuit breaker also fails closed at final admission', () => {
  const req = request(); req.conversationId = 'guard-disabled'
  jest.mocked(providerRemoteCompactLifecycle.getCompactionGuardState).mockReturnValue({ autoDisabled: true } as ReturnType<typeof providerRemoteCompactLifecycle.getCompactionGuardState>)
  expect(() => prepareFinalProviderRequestCapacity({ req, body: body(req), signal: new AbortController().signal })).toThrow('context_capacity')
})

test.each(['messages', 'input', 'contents'] as const)('keeps current user, tool IDs, tool results and signed state exact for %s', (key) => {
  const req = request(100_000)
  req.provider = { ...req.provider, type: key === 'contents' ? 'google' : key === 'input' ? 'openai' : 'anthropic' }
  const plain = history().map((message) => key === 'contents'
    ? { role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] }
    : key === 'input' ? { role: message.role, content: [{ type: message.role === 'assistant' ? 'output_text' : 'input_text', text: message.content }] }
    : { role: message.role, content: [{ type: 'text', text: message.content }] })
  const protocol = key === 'contents' ? [
    { role: 'model', parts: [{ functionCall: { id: 'server-id', name: 'write', args: {} }, thoughtSignature: 'exact-signature' }] },
    { role: 'user', parts: [{ functionResponse: { id: 'server-id', name: 'write', response: { ok: true } } }] },
  ] : key === 'input' ? [
    { type: 'reasoning', id: 'rs-id', encrypted_content: 'opaque-replay' },
    { type: 'function_call', id: 'fc-id', call_id: 'call-id', name: 'write', arguments: '{}' },
    { type: 'function_call_output', call_id: 'call-id', output: 'already done' },
  ] : [
    { role: 'assistant', content: [{ type: 'thinking', thinking: ' exact\n ', signature: 'exact-signature' }, { type: 'tool_use', id: 'call-id', name: 'write', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-id', content: 'already done' }] },
  ]
  const input = { [key]: [...plain, ...protocol], max_tokens: 100 }
  const recovered = prepareFinalProviderRequestCapacity({ req, body: input, signal: new AbortController().signal, trigger: 'server_overflow' })
  expect(recovered.compressed).toBe(true)
  const output = recovered.body[key] as unknown[]
  expect(output.slice(-protocol.length - 1)).toEqual([plain.at(-1), ...protocol])
  for (const entry of protocol) expect(output).toContain(entry)
})

test('never truncates an oversized current user turn or detaches opaque server history', () => {
  const req = request()
  const hugeCurrent = { role: 'user', content: 'current user constraint '.repeat(3000) }
  for (const envelope of [{ messages: [hugeCurrent], max_tokens: 100 }, { ...body(req), previous_response_id: 'opaque-previous' }]) {
    expect(() => prepareFinalProviderRequestCapacity({ req, body: envelope, signal: new AbortController().signal })).toThrow('context_capacity')
  }
  expect(hugeCurrent.content.length).toBe('current user constraint '.length * 3000)
})

test('repeated server overflow spends at most one recompression request, regardless of maxRetries', async () => {
  const f = fixture(60_000); f.input.req.settings = { upstreamMaxRetries: 5 }
  f.wire.mockImplementation(async () => overflow())
  await expect(executeHttpSseChat(f.input)).rejects.toThrow('context_capacity')
  expect(f.wire).toHaveBeenCalledTimes(2)
  expect(f.targets).toHaveLength(2)
  expect(new Set(f.targets.map((target) => target.attemptId)).size).toBe(2)
  expect(assistantRunBudgetStore.settle).toHaveBeenCalledTimes(2)
  expect(f.fallbackWire).not.toHaveBeenCalled(); expect(f.onDone).not.toHaveBeenCalled()
})

test('server overflow with compression disabled cannot enter generic retries or route fallback', async () => {
  const f = fixture(60_000); f.input.req.settings = { upstreamMaxRetries: 5, modelContextCompressionEnabled: false }
  f.wire.mockImplementation(async () => overflow())
  await expect(executeHttpSseChat(f.input)).rejects.toThrow('context_capacity')
  expect(f.wire).toHaveBeenCalledTimes(1); expect(f.fallbackWire).not.toHaveBeenCalled()
})

function addSmallerFallback(f: ReturnType<typeof fixture>, window: number) {
  f.input.req.failoverPolicy = { mode: 'same-provider', maxCostTier: 'unknown' }
  f.input.req.provider.models.push('capacity-small')
  f.input.req.provider.modelConfigs!.push({ ...f.input.req.provider.modelConfigs![0], id: 'capacity-small', contextWindow: window })
  f.wire.mockImplementation(async () => new Response('upstream unavailable', { status: 503 }))
}

test('a smaller fallback goes through its own fully assembled capacity gate and counted attempt', async () => {
  const f = fixture(60_000); addSmallerFallback(f, 6000)
  await executeHttpSseChat(f.input)
  expect(f.decisions[0]?.decision).toMatchObject({ eligible: true, selected: { model: 'capacity-small' } })
  expect(f.wire).toHaveBeenCalledTimes(1); expect(f.fallbackWire).toHaveBeenCalledTimes(1)
  expect(f.targets.map((target) => target.model)).toEqual(['capacity-model', 'capacity-small'])
  const sent = JSON.parse((f.fallbackWire.mock.calls as unknown as [string, RequestInit][])[0][1].body as string)
  expect(checkFinalProviderRequestCapacity({ provider: f.input.req.provider, model: 'capacity-small', body: sent }).limit).toBe(5100)
  expect(sent.messages.at(-1)).toEqual(f.input.req.messages.at(-1))
})

test('an irreducible smaller fallback pauses without sending it or replaying the original attempt', async () => {
  const f = fixture(60_000); addSmallerFallback(f, 6000)
  f.input.req.messages = [{ role: 'user', content: 'current user constraint '.repeat(3000) }]
  f.input.body = JSON.stringify(body(f.input.req))
  await expect(executeHttpSseChat(f.input)).rejects.toThrow('context_capacity')
  expect(f.wire).toHaveBeenCalledTimes(1); expect(f.fallbackWire).not.toHaveBeenCalled()
  expect(f.targets).toHaveLength(1)
})

test('server overflow on the selected fallback shares the one-recompression budget', async () => {
  const f = fixture(100_000); addSmallerFallback(f, 60_000)
  f.fallbackWire.mockImplementation(async () => overflow())
  await expect(executeHttpSseChat(f.input)).rejects.toThrow('context_capacity')
  expect(f.wire).toHaveBeenCalledTimes(1); expect(f.fallbackWire).toHaveBeenCalledTimes(2)
  expect(new Set(f.targets.map((target) => target.attemptId)).size).toBe(3)
})

test('disabling cached local compression cannot detach opaque continuation on a route change', async () => {
  const f = fixture(60_000); addSmallerFallback(f, 6000)
  f.input.req.settings = { upstreamMaxRetries: 0, modelContextCompressionEnabled: false }
  f.input.req.remoteCompactEligible = true
  f.input.req.previousResponseId = 'opaque-prior-response'
  f.input.req.remoteCompactFallback = { messages: [{ role: 'user', content: 'current request' }], contextPrompt: 'prepared history summary' }
  await expect(executeHttpSseChat(f.input)).rejects.toThrow('context_capacity')
  expect(f.wire).toHaveBeenCalledTimes(1); expect(f.fallbackWire).not.toHaveBeenCalled()
  expect(f.input.req.previousResponseId).toBe('opaque-prior-response')
})

test('WebSocket overflow is bounded and each exact response.create envelope is admitted and settled', async () => {
  const f = fixture(60_000); f.input.req.settings = { transportMode: 'websocket' }
  const rawBody = { input: f.input.req.messages, max_output_tokens: 100, stream: true }
  const run = jest.fn(async () => { throw new Error('context_length_exceeded') })
  const input = { ...f.input, pipeline: { runtimeReq: f.input.req, effectiveReq: f.input.req, stream: true,
    transportSelection: { transport: 'responses_websocket' }, headers: {}, rawBody, proxyPolicy: { effectiveUrl: f.input.url },
    preparedHttpRequest: { url: f.input.url, headers: {}, body: JSON.stringify(rawBody) } },
    responsesWebSocketTransport: { run },
  } as unknown as ProviderRuntimeChatExecutionInput
  await executeProviderRuntimeChat(input)
  expect(run).toHaveBeenCalledTimes(2)
  for (const [wireInput] of run.mock.calls as unknown as [{ body: Record<string, unknown> }][]) {
    expect(wireInput.body.type).toBe('response.create'); expect(wireInput.body.stream).toBeUndefined()
    expect(() => checkFinalProviderRequestCapacity({ ...f.input.req, body: wireInput.body })).not.toThrow()
  }
  expect(f.targets).toHaveLength(2)
  expect(assistantRunBudgetStore.settle).toHaveBeenCalledTimes(2)
  expect(f.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'context_capacity' }))
  expect(f.wire).not.toHaveBeenCalled()
})

test('does not confuse output-parameter errors with a context overflow', () => {
  expect(isProviderContextOverflow(400, 'max_tokens must be at most 4096')).toBe(false)
  expect(isProviderContextOverflow(400, 'unknown parameter: context_window')).toBe(false)
  expect(isProviderContextOverflow(401, 'context_length_exceeded')).toBe(false)
})

test('HTTP 200 JSON and buffered SSE overflow errors cannot masquerade as empty output', async () => {
  const f = fixture(60_000); f.input.stream = true
  f.wire.mockImplementation(async () => new Response('data: {"error":{"code":"context_length_exceeded"}}\n\n', { status: 200 }))
  await expect(executeHttpSseChat(f.input)).rejects.toThrow('context_capacity')
  expect(f.wire).toHaveBeenCalledTimes(1); expect(f.fallbackWire).not.toHaveBeenCalled()
  expect(() => parseProviderChatCompletionJson({ error: { message: 'prompt is too long' } }, f.input.req)).toThrow('context_capacity')
  expect(parseProviderChatCompletionJson({ choices: [{ message: { content: 'The literal context_length_exceeded is just text.' } }] }, f.input.req).text).toContain('just text')
})

test('an in-band overflow after visible streaming output never repeats a provider or tool turn', async () => {
  const f = fixture(60_000); f.input.stream = true
  const events = [
    'data: {"choices":[{"delta":{"content":"visible partial"}}]}\n\n',
    'data: {"type":"response.failed","response":{"error":{"code":"context_length_exceeded"}}}\n\n',
  ]
  const reader = { read: jest.fn(async () => ({ done: false, value: new TextEncoder().encode(events.shift()!) })), cancel: jest.fn(async () => undefined) }
  f.wire.mockImplementation(async () => ({ ok: true, status: 200, headers: { get: () => null }, body: { getReader: () => reader } }) as unknown as Response)
  await expect(executeHttpSseChat(f.input)).rejects.toThrow('context_capacity')
  expect(f.input.onChunk).toHaveBeenCalledWith('visible partial')
  expect(f.wire).toHaveBeenCalledTimes(1); expect(f.fallbackWire).not.toHaveBeenCalled(); expect(f.onDone).not.toHaveBeenCalled()
  expect(reader.cancel).toHaveBeenCalledTimes(1)
})
