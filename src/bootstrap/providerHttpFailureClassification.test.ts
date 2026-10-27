import {
  executeHttpSseChat,
  fetchChatStreamWithRetry,
  rectifyOpenAICompatibleRequestBody,
  type HttpSseExecutionInput,
} from './providerRuntimeExecutor'
import { assistantRunBudgetStore } from './assistantRunGovernance'
import { executionResources } from './executionResources'
import { buildProviderFallbackCandidates } from './providerFallbackCandidates'
import { getModelConfig } from '@/types/modelCatalog'
import type { ProviderExecutionTarget, ProviderRuntimeChatRequest } from '@/modules/providers'

jest.mock('./assistantRunGovernance', () => ({ assistantRunBudgetStore: { settle: jest.fn(async () => undefined) } }))
jest.mock('./usageStatisticsRuntime', () => ({ recordProviderUsageAttempt: jest.fn(async () => undefined) }))
jest.mock('./providerHealthRepository', () => ({ loadProviderHealthSnapshot: async () => ({ records: [] }) }))
jest.mock('./providerRuntimeHealth', () => ({
  recordProviderRuntimeFailure: jest.fn(async () => ({ trigger: 'unknown', retryable: false, source: 'status', evidence: {} })),
}))
jest.mock('@/platform/native/runtimeLog', () => ({ appendRuntimeLog: jest.fn() }))
jest.mock('@/services/runtimeEvents', () => ({ emitRuntimeEvent: jest.fn() }))

const genericFailure = JSON.stringify({ error: { message: 'Owned inert provider failure', type: 'invalid_request_error' } })
const selectiveFailure = JSON.stringify({ error: { message: 'Unsupported parameter: top_p', type: 'invalid_request_error' } })
let nextProvider = 0

function fixture(enabled: boolean | undefined = true) {
  const targets: ProviderExecutionTarget[] = []
  const req: ProviderRuntimeChatRequest = {
    provider: {
      id: `http-failure-${nextProvider++}`, name: 'Owned failure', type: 'openai-compatible',
      enabled: true, baseUrl: 'https://example.invalid/v1', apiKey: 'test-only',
      apiKeySource: { kind: 'primary' }, models: ['owned-model'],
      modelConfigs: [{
        ...getModelConfig('owned-model', 'openai-compatible'), source: 'remote',
        contextWindow: 32768, maxOutputTokens: 4096, outputTokenLimit: undefined,
      }],
    },
    model: 'owned-model', messages: [{ role: 'user', content: 'hello' }], generationParameterSources: {},
    settings: { upstreamMaxRetries: 0, requestRectificationEnabled: enabled, modelContextCompressionEnabled: false },
    allowFallback: false, onExecutionTarget: async target => { targets.push(target) },
  }
  const body = JSON.stringify({ model: req.model, messages: req.messages, max_tokens: 2048, top_p: 0.8, stream: false })
  const wire = jest.fn(async () => new Response(genericFailure, { status: 400 }))
  const fallbackWire = jest.fn(async () => new Response('{}', { status: 200 }))
  const onError = jest.fn()
  const onDone = jest.fn()
  const input = {
    req, body, url: 'https://example.invalid/v1/chat/completions', headers: {},
    stream: false, controller: new AbortController(), resolveRoute: jest.fn(),
    transport: { requestStream: wire, request: fallbackWire, readResponseText: (response: Response) => response.text(),
      endpointHost: () => 'example.invalid' },
    onChunk: jest.fn(), onError, onDone, onTrace: jest.fn(), buildFallbackCandidates: buildProviderFallbackCandidates,
    fallbackEffects: { logDecision: jest.fn(), recordRouteFailure: jest.fn(), recordRouteSuccess: jest.fn() },
  } as unknown as HttpSseExecutionInput
  return { input, targets, wire, fallbackWire, onError, onDone }
}

function correction(errorText: string, enabled: boolean | undefined = true) {
  const { input } = fixture(enabled)
  return { req: input.req, body: input.body, status: 400, errorText, rectified: false }
}

beforeEach(() => jest.clearAllMocks())
afterEach(() => expect(executionResources.retainedTextBytes).toBe(0))

test('explicitly disabled compatible rectification never revises a rejected request', () => {
  expect(rectifyOpenAICompatibleRequestBody(correction(selectiveFailure, false))).toBeUndefined()
})

test.each([
  genericFailure,
  'invalid_request_error',
  'invalid request',
  'bad request',
])('generic HTTP category alone is not structural correction evidence: %s', errorText => {
  expect(rectifyOpenAICompatibleRequestBody(correction(errorText))).toBeUndefined()
})

test.each([true, undefined])('field-specific correction retains accepted output controls (enabled=%s)', enabled => {
  const input = correction(selectiveFailure, enabled)
  input.req.settings = { ...input.req.settings, requestRectificationEnabled: enabled }
  const result = rectifyOpenAICompatibleRequestBody(input)!
  expect(result.body).toEqual({ model: input.req.model, messages: input.req.messages, max_tokens: 2048, stream: false })
  expect(result.removedFields).toEqual(['top_p'])
})

test('echoed request metadata cannot supply rejected-field evidence', () => {
  const input = correction(JSON.stringify({ error: { message: 'Unsupported parameter: top_p', type: 'invalid_request_error' },
    request: { max_tokens: 2048, tools: [], response_format: { type: 'json_schema' } } }))
  const result = rectifyOpenAICompatibleRequestBody(input)!
  expect(result.failedFields).toEqual(['top_p'])
  expect(result.body.max_tokens).toBe(2048)
})

test.each([
  JSON.stringify({ error: { message: 'Owned inert provider failure', type: 'invalid_request_error' }, request: { schema: 'unsupported' } }),
  '<html>invalid request: unsupported schema</html>',
  JSON.stringify({ error: { message: 'Permission denied for unsupported tools' } }),
])('non-structural or denied errors do not authorize request reduction: %s', errorText => {
  expect(rectifyOpenAICompatibleRequestBody(correction(errorText))).toBeUndefined()
})

test.each([false, true])('generic HTTP400 reaches terminal error, not a capacity pause (enabled=%s)', async enabled => {
  const f = fixture(enabled)
  await executeHttpSseChat(f.input)
  expect(f.wire).toHaveBeenCalledTimes(1)
  expect(f.targets).toHaveLength(1)
  expect(f.onError).toHaveBeenCalledWith(expect.objectContaining({ chatErrorCode: 'invalid_request' }))
  expect(f.onDone).not.toHaveBeenCalled()
  expect(f.fallbackWire).not.toHaveBeenCalled()
  expect(assistantRunBudgetStore.settle).toHaveBeenCalledWith(expect.objectContaining({ settled: true, complete: false }))
})

test('disabled correction returns the original HTTP error without another paid attempt', async () => {
  const f = fixture(false)
  f.wire.mockImplementation(async () => new Response(selectiveFailure, { status: 400 }))
  const response = await fetchChatStreamWithRetry(f.input)
  expect(response.status).toBe(400)
  expect(await response.text()).toBe(selectiveFailure)
  expect(f.wire).toHaveBeenCalledTimes(1)
  expect(f.targets).toHaveLength(1)
})
