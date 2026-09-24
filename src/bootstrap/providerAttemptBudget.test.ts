import { executeHttpSseChat, fetchChatStreamWithRetry, type FetchChatStreamWithRetryInput, type HttpSseExecutionInput } from './providerRuntimeExecutor'
import { assistantRunBudgetStore } from './assistantRunGovernance'
import type { ProviderExecutionTarget } from '@/modules/providers'
import { executionResources } from './executionResources'

jest.mock('./assistantRunGovernance', () => ({ assistantRunBudgetStore: { settle: jest.fn(async () => undefined) } }))
jest.mock('./usageStatisticsRuntime', () => ({ recordProviderUsageAttempt: jest.fn(async () => undefined) }))
jest.mock('./providerRuntimeHealth', () => ({ recordProviderRuntimeSuccess: jest.fn(), recordProviderRuntimeFailure: jest.fn() }))
jest.mock('@/platform/native/runtimeLog', () => ({ appendRuntimeLog: jest.fn() }))
jest.mock('@/services/runtimeEvents', () => ({ emitRuntimeEvent: jest.fn() }))
jest.mock('./providerRetryRuntime', () => ({ ...jest.requireActual('./providerRetryRuntime'), delayProviderRetry: async () => undefined }))
jest.mock('./providerResponsePolicies', () => ({
  ...jest.requireActual('./providerResponsePolicies'),
  parseProviderNonStreamingResponse: async () => ({ text: 'answer', usage: { source: 'provider', inputTokens: 20, outputTokens: 10, totalTokens: 30 } }),
}))

function fixture(): { input: FetchChatStreamWithRetryInput; targets: ProviderExecutionTarget[]; request: jest.Mock } {
  const targets: ProviderExecutionTarget[] = []
  const request = jest.fn(async () => response(200))
  const input = {
    req: { provider: { id: 'budget-test', name: 'Test', type: 'openai', apiKey: '', models: ['gpt-4o'], enabled: true }, model: 'gpt-4o', messages: [], generationParameterSources: {},
      settings: { upstreamMaxRetries: 1 }, onExecutionTarget: async (target: ProviderExecutionTarget) => { targets.push(target) } },
    url: 'https://example.invalid/v1/chat/completions', headers: {}, body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }], max_tokens: 100 }),
    stream: false, controller: new AbortController(),
    transport: { requestStream: request, readResponseText: async () => 'temporarily unavailable', endpointHost: () => 'example.invalid' },
  } as unknown as FetchChatStreamWithRetryInput
  return { input, targets, request }
}
function response(status: number): Response { return { status, ok: status === 200, headers: { get: () => null } } as unknown as Response }
beforeEach(() => jest.clearAllMocks())
afterEach(() => expect(executionResources.retainedTextBytes).toBe(0))

test('managed request copies share a hard ceiling without native pressure callbacks', async () => {
  const { input, request } = fixture()
  const release = executionResources.reserveText(8 * 1024 * 1024 - 1)
  try {
    await expect(fetchChatStreamWithRetry(input)).rejects.toThrow('text_budget')
    expect(request).not.toHaveBeenCalled()
  } finally { release() }
})

test('caller cancellation does not release retained text before an uncooperative transport settles', async () => {
  const { input, request } = fixture()
  let settle!: (response: Response) => void
  let entered!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve })
  request.mockImplementationOnce(() => new Promise<Response>((resolve) => { settle = resolve; entered() }))
  const pending = fetchChatStreamWithRetry(input)
  await started
  expect(executionResources.retainedTextBytes).toBeGreaterThan(0)
  input.controller.abort()
  expect(executionResources.retainedTextBytes).toBeGreaterThan(0)
  settle(response(200))
  await expect(pending).rejects.toBeDefined()
})

test('abort from a non-stream consumer settles actual usage and releases its retained request', async () => {
  const { input, targets } = fixture()
  const done = jest.fn()
  await expect(executeHttpSseChat({ ...input, onChunk: () => input.controller.abort(), onDone: done, onError: jest.fn() } as unknown as HttpSseExecutionInput)).rejects.toBeDefined()
  expect(done).not.toHaveBeenCalled()
  expect(assistantRunBudgetStore.settle).toHaveBeenCalledWith(expect.objectContaining({ attemptId: targets[0].attemptId, complete: true,
    usage: expect.objectContaining({ totalTokens: 30 }) }))
})

test('a buffered-stream body read failure still settles non-free usage and releases text', async () => {
  const { input, targets } = fixture()
  input.stream = true
  input.transport.readResponseText = async () => { throw new Error('body read failed') }
  await expect(executeHttpSseChat({ ...input, onChunk: jest.fn(), onDone: jest.fn(), onError: jest.fn() } as unknown as HttpSseExecutionInput)).rejects.toThrow('body read failed')
  expect(assistantRunBudgetStore.settle).toHaveBeenCalledWith(expect.objectContaining({ attemptId: targets[0].attemptId, settled: true, complete: false }))
})

test('retry reservations and final usage use the same actual-attempt identities', async () => {
  const { input, targets, request } = fixture()
  request.mockResolvedValueOnce(response(503))
  const done = jest.fn()
  await executeHttpSseChat({ ...input, onChunk: jest.fn(), onDone: done, onError: jest.fn() } as unknown as HttpSseExecutionInput)
  expect(request).toHaveBeenCalledTimes(2)
  expect(targets).toHaveLength(2)
  expect(targets[0].attemptId).not.toBe(targets[1].attemptId)
  expect(targets[0].tokenEstimate).toMatchObject({ outputTokens: 100 })
  expect(assistantRunBudgetStore.settle).toHaveBeenNthCalledWith(1, expect.objectContaining({ attemptId: targets[0].attemptId, settled: true, complete: false }))
  expect(assistantRunBudgetStore.settle).toHaveBeenNthCalledWith(2, expect.objectContaining({ attemptId: targets[1].attemptId, complete: true, usage: expect.objectContaining({ totalTokens: 30 }) }))
  expect(done).toHaveBeenCalledTimes(1)
})

test('an admission failure cannot cause a wire request or health retry', async () => {
  const { input, request } = fixture()
  input.req.onExecutionTarget = async () => { throw new Error('budget exhausted') }
  await expect(fetchChatStreamWithRetry(input)).rejects.toThrow('Could not record')
  expect(request).not.toHaveBeenCalled()
})

test('cancellation still records a non-free terminal attempt outside the aborted signal', async () => {
  const { input, targets, request } = fixture()
  request.mockImplementationOnce(async () => { input.controller.abort(); throw new Error('aborted') })
  await expect(fetchChatStreamWithRetry(input)).rejects.toBeDefined()
  expect(assistantRunBudgetStore.settle).toHaveBeenCalledWith(expect.objectContaining({ attemptId: targets[0].attemptId, settled: true, complete: false }))
  expect(request).toHaveBeenCalledTimes(1)
})

test('the actual wire boundary checks the mutated envelope before reserving or dispatching', async () => {
  const { input, request, targets } = fixture()
  input.body = JSON.stringify({ messages: [], max_tokens: 1_000_000 })
  await expect(fetchChatStreamWithRetry(input)).rejects.toThrow('context_capacity')
  expect(request).not.toHaveBeenCalled()
  expect(targets).toHaveLength(0)
})

test('a failed usage receipt cannot trigger another paid retry', async () => {
  const { input, request } = fixture()
  request.mockResolvedValueOnce(response(503))
  jest.mocked(assistantRunBudgetStore.settle).mockRejectedValueOnce(new Error('SQLite unavailable'))
  await expect(fetchChatStreamWithRetry(input)).rejects.toThrow('Could not record')
  expect(request).toHaveBeenCalledTimes(1)
})
