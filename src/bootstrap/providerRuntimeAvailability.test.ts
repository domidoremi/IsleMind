import { streamProviderChat } from './providerRuntime'
import { providerModelAvailabilityRuntime } from './providerModelAvailabilityRuntime'
import { providerFailureAvailabilityEvidence } from '@/modules/providers'
import type { ProviderExecutionTarget, ProviderRuntimeChatCallbacks, ProviderRuntimeChatRequest } from '@/modules/providers'
import type { AIProvider } from '@/types/providerContracts'

jest.mock('@/modules/providers', () => ({
  ...jest.requireActual('@/modules/providers'),
  createResponsesWebSocketTransport: () => ({}),
  createProviderStreamRuntime: () => ({
    async start(request: ProviderRuntimeChatRequest, callbacks: ProviderRuntimeChatCallbacks) {
      return { controller: new AbortController(), done: Promise.resolve().then(() => mockExecute(request, callbacks)) }
    },
  }),
}))
jest.mock('./providerModelAvailabilityRuntime', () => ({
  bindProviderModelAvailabilityOperations: jest.fn(),
  providerModelAvailabilityRuntime: {
    beginExecution: jest.fn(async (_target: ProviderExecutionTarget, operationId: string) => ({
      operationId, scopeId: 'scope', epoch: 'epoch',
    })),
    settleExecution: jest.fn(async () => undefined),
  },
}))
jest.mock('./providerChatResolutionRuntime', () => ({
  providerChatResolutionRuntime: { revalidate: jest.fn(async () => ({ provider: mockProvider })) },
  chatFallbackConfirmation: () => undefined,
}))
jest.mock('./providerRequestBinding', () => ({}))
jest.mock('./providerRuntimeExecutor', () => ({}))
jest.mock('./providerRuntimeGateway', () => ({}))
jest.mock('./providerRuntimePipeline', () => ({}))
jest.mock('./providerTransport', () => ({}))
jest.mock('./providerFallbackCandidates', () => ({}))
jest.mock('./providerRuntimeFallbackEffects', () => ({}))
jest.mock('./providerResponsePolicies', () => ({}))
jest.mock('./providerNativeToolDeclarations', () => ({}))
jest.mock('./usageStatisticsRuntime', () => ({}))
jest.mock('@/i18n/service', () => ({ st: (key: string) => key }))

const mockProvider: AIProvider = {
  id: 'availability-test', type: 'openai', name: 'Availability test', enabled: true,
  apiKey: 'synthetic-test-only', models: ['first-model', 'fallback-model'],
}
let mockExecute: (request: ProviderRuntimeChatRequest, callbacks: ProviderRuntimeChatCallbacks) => Promise<void>

function target(model: string, attemptId: string): ProviderExecutionTarget {
  return { providerId: mockProvider.id, model, attemptId, credentialSource: { kind: 'primary' },
    protocolAdapterId: 'openai-chat', endpointVariant: 'default' }
}

async function run(execute: typeof mockExecute, signal = new AbortController().signal) {
  mockExecute = execute
  const onError = jest.fn()
  const onDone = jest.fn()
  const handle = await streamProviderChat({
    provider: mockProvider, model: 'first-model', messages: [], generationParameterSources: {}, signal,
    executionConstraint: { identity: target('first-model', 'first'), scope: { scopeId: 'scope', epoch: 'epoch' }, fallbackUsed: false },
  }, jest.fn(), onDone, onError)
  await handle.done
  return { onError, onDone }
}

beforeEach(() => { jest.clearAllMocks() })

it.each([
  ['model_unavailable', 'upstream_error'],
  ['upstream_error', 'model_unavailable'],
  ['model_unavailable', 'unknown'],
] as const)('retains each target’s failure when %s is followed by %s', async (firstCode, fallbackCode) => {
  const terminalError = Object.assign(new Error('The original request failed'), { chatErrorCode: firstCode })
  const { onError } = await run(async (request, callbacks) => {
    await request.onExecutionTarget!(target('first-model', 'first'))
    request.onExecutionFailure!(firstCode)
    await request.onExecutionTarget!(target('fallback-model', 'fallback'))
    request.onExecutionFailure!(fallbackCode)
    callbacks.onError(terminalError)
  })
  expect(providerModelAvailabilityRuntime.settleExecution).toHaveBeenNthCalledWith(1,
    expect.objectContaining({ operationId: 'first' }), 'first-model', providerFailureAvailabilityEvidence(firstCode))
  expect(providerModelAvailabilityRuntime.settleExecution).toHaveBeenNthCalledWith(2,
    expect.objectContaining({ operationId: 'fallback' }), 'fallback-model', providerFailureAvailabilityEvidence(fallbackCode))
  expect(onError).toHaveBeenCalledWith(terminalError)
})

it('clears prior failure evidence for a completed retry of the same model', async () => {
  await run(async (request, callbacks) => {
    await request.onExecutionTarget!(target('first-model', 'first'))
    request.onExecutionFailure!('upstream_error')
    await request.onExecutionTarget!(target('first-model', 'retry'))
    callbacks.onChunk('Complete response')
    callbacks.onDone({ text: 'Complete response', traces: [] })
  })
  expect(providerModelAvailabilityRuntime.settleExecution).toHaveBeenNthCalledWith(1,
    expect.objectContaining({ operationId: 'first' }), 'first-model', { kind: 'operational', reason: 'server_error' })
  expect(providerModelAvailabilityRuntime.settleExecution).toHaveBeenNthCalledWith(2,
    expect.objectContaining({ operationId: 'retry' }), 'first-model', { kind: 'generation_success' })
})

it.each(['untyped-error', 'no-completion', 'error-after-completion'] as const)(
  'does not count partial text as successful generation after %s', async outcome => {
    await run(async (request, callbacks) => {
      await request.onExecutionTarget!(target('first-model', 'first'))
      callbacks.onChunk('Partial response')
      if (outcome === 'error-after-completion') callbacks.onDone({ text: 'Partial response', traces: [] })
      if (outcome !== 'no-completion') callbacks.onError(new TypeError('network request failed'))
    })
    expect(providerModelAvailabilityRuntime.settleExecution).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: 'first' }), 'first-model', { kind: 'operational', reason: 'partial' })
  },
)

it('a rejected execution promise cannot certify an earlier completion callback', async () => {
  const error = new Error('execution failed after callback')
  await expect(run(async (request, callbacks) => {
    await request.onExecutionTarget!(target('first-model', 'first'))
    callbacks.onDone({ text: 'Complete response', traces: [] })
    throw error
  })).rejects.toBe(error)
  expect(providerModelAvailabilityRuntime.settleExecution).toHaveBeenCalledWith(
    expect.objectContaining({ operationId: 'first' }), 'first-model', { kind: 'operational', reason: 'partial' })
})

it('keeps cancellation authoritative even after a completion callback', async () => {
  const controller = new AbortController()
  await run(async (request, callbacks) => {
    await request.onExecutionTarget!(target('first-model', 'first'))
    callbacks.onDone({ text: 'Complete response', traces: [] })
    controller.abort()
  }, controller.signal)
  expect(providerModelAvailabilityRuntime.settleExecution).toHaveBeenCalledWith(
    expect.objectContaining({ operationId: 'first' }), 'first-model', { kind: 'operational', reason: 'cancelled' })
})
