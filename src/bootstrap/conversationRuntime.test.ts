import { createPlainChatRuntime, resumePausedConversationRun } from './conversationRuntime'
import type { Conversation } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'

const mockCreateRun = jest.fn(), mockCreateAdapter = jest.fn(), mockContextPort = jest.fn()
const mockRetrieve = jest.fn(), mockModelSession = jest.fn(), mockPlan = jest.fn()
const mockResumePaused = jest.fn(), mockPrepareUserResume = jest.fn()
jest.mock('@/platform/storage', () => ({ createExpoSqliteDatabaseProvider: () => ({}) }))
jest.mock('@/modules/conversations', () => ({
  createSqliteConversationRepository: () => ({}),
  createConversationRunUseCase: (input: unknown) => { mockCreateRun(input); return { ...input as object, resumePausedRun: mockResumePaused } },
}))
jest.mock('@/modules/knowledge', () => ({
  appendProviderContext: (prompt: string) => prompt,
  createSqliteContextSnapshotRepository: () => ({}),
  createContextSnapshotAssembler: (input: unknown) => input,
  createKnowledgeContextRetriever: (input: unknown) => input,
  createConversationContextRetrievalPort: (input: unknown) => { mockContextPort(input); return input },
}))
jest.mock('@/modules/providers', () => ({
  ...jest.requireActual('@/modules/providers/providerConfigurationMutation'),
  createProviderGateway: (adapters: unknown) => adapters,
  createSameProviderFallbackResolver: jest.fn(),
}))
jest.mock('@/modules/assistant-runtime', () => ({
  buildAssistantContextPlanReceipt: () => ({}), planUnifiedConversationCapabilities: () => ({}),
}))
jest.mock('./applicationAssistantRuntime', () => ({
  applicationAssistantRuntime: {}, assistantRunPersistence: {},
  bindAssistantRuntimeGateway: (gateway: unknown) => gateway,
}))
jest.mock('./assistantExecutionHostRuntime', () => ({ assistantExecutionHost: { prepareUserResume: (...args: unknown[]) => mockPrepareUserResume(...args) } }))
jest.mock('./providerRuntime', () => ({ createProviderRuntimeAdapter: (input: unknown) => { mockCreateAdapter(input); return input } }))
jest.mock('./knowledgeContextRuntime', () => ({ retrieveConversationKnowledgeContext: (...args: unknown[]) => mockRetrieve(...args) }))
jest.mock('./conversationModelOperationRuntime', () => ({ createConversationModelOperationSession: (input: unknown) => mockModelSession(input) }))
jest.mock('./contextPlanning', () => ({ planChatContext: (...args: unknown[]) => mockPlan(...args) }))
jest.mock('./contextContributionRuntime', () => ({
  buildChatContextRuntime: () => ({ counts: { memory: 0, knowledge: 0 }, retrievalSources: [], contextSources: [] }),
}))
jest.mock('./plainChatMessageIdentity', () => ({ preserveMessageIdentity: () => [] }))
jest.mock('@/services/promptEngineering', () => ({ buildSystemPrompt: () => 'Bound prompt' }))
jest.mock('@/types/modelCatalog', () => ({
  getModelConfig: () => ({ contextWindow: 4096, maxOutputTokens: 1024, defaultMaxTokens: 512 }),
}))
jest.mock('@/utils/providerModels', () => ({ resolveProviderModelAlias: (_provider: unknown, model: string) => model }))

function input() {
  return {
    conversation: { id: 'reviewed-chat', title: 'Reviewed title', model: 'reviewed-model', messages: [] } as unknown as Conversation,
    provider: { id: 'reviewed-provider', apiKey: 'synthetic-key', baseUrl: 'https://reviewed.invalid/v1' } as AIProvider,
    settings: { memoryEnabled: true, knowledgeEnabled: true, language: 'en', proxyMode: 'off' } as Settings,
  }
}
beforeEach(() => {
  jest.clearAllMocks()
  mockRetrieve.mockResolvedValue({ sources: [], prompt: '' })
  mockPlan.mockReturnValue({ packed: { estimatedInputTokens: 1, budgetTokens: 4096 }, messages: [], contextPrompt: '' })
  mockResumePaused.mockResolvedValue({ ok: true, value: { status: 'running' } })
})

it('binds delayed plain-chat retrieval to one detached conversation, provider and settings snapshot', async () => {
  const admitted = input()
  createPlainChatRuntime(admitted)
  admitted.provider.apiKey = 'synthetic-changed-key'; admitted.provider.baseUrl = 'https://changed.invalid/v1'
  admitted.settings.memoryEnabled = false; admitted.settings.knowledgeEnabled = false
  admitted.conversation.title = 'Changed title'; admitted.conversation.model = 'changed-model'
  const port = mockContextPort.mock.calls[0][0], signal = new AbortController().signal
  const draft = { id: 'draft', content: 'Question' }
  await port.retrieveContext(port.conversation, draft, { signal })
  expect(mockRetrieve).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Reviewed title', model: 'reviewed-model' }), draft, signal,
    expect.objectContaining({
      settings: expect.objectContaining({ memoryEnabled: true, knowledgeEnabled: true }),
      provider: expect.objectContaining({ apiKey: 'synthetic-key', baseUrl: 'https://reviewed.invalid/v1' }),
    }),
  )
})

it('keeps model-operation admission consistent with the already captured plain-chat provider and preferences', () => {
  const admitted = input()
  createPlainChatRuntime(admitted)
  admitted.settings.proxyMode = 'custom-base-url'; admitted.settings.proxyBaseUrl = 'https://changed.invalid'
  admitted.conversation.model = 'changed-model'; admitted.provider.id = 'changed-provider'
  mockCreateRun.mock.calls[0][0].createModelOperationSession()
  expect(mockModelSession).toHaveBeenCalledWith(expect.objectContaining({
    conversation: expect.objectContaining({ model: 'reviewed-model' }),
    provider: expect.objectContaining({ id: 'reviewed-provider' }),
    settings: expect.objectContaining({ proxyMode: 'off' }),
  }))
  expect(mockCreateAdapter.mock.calls[0][0].provider.id).toBe('reviewed-provider')
  expect(mockCreateRun.mock.calls[0][0].providerGatewayOptions).toBeUndefined()
})

it('uses captured settings during delayed canonical conversation request preparation', async () => {
  const admitted = input()
  createPlainChatRuntime(admitted)
  const preparation = mockCreateRun.mock.calls[0][0].requestPreparation
  admitted.provider.id = 'changed-provider'; admitted.settings.language = 'ja'
  const result = await preparation.prepare({
    cancellationSignal: new AbortController().signal, conversation: { systemPrompt: '' },
    request: { conversationId: 'reviewed-chat', providerId: 'stored-provider', model: 'stored-model',
      messages: [{ id: 'draft', role: 'user', text: 'Question' }], maxTokens: 512 },
  } as never)
  expect(result.request.providerId).toBe('reviewed-provider')
  expect(result.request.model).toBe('reviewed-model')
  expect(mockPlan.mock.calls[0][0].settings.language).toBe('en')
})

it('prepares the visible execution host and forwards admission and settlement as separate resume lifetimes', async () => {
  const admitted = input(), projection = jest.fn(), onSettled = jest.fn()
  const signal = new AbortController().signal
  await expect(resumePausedConversationRun({ ...admitted, runId: 'selected-run', expectedJournalSequence: 9,
    cancellationSignal: signal, projection, onSettled })).resolves.toBe(true)
  expect(mockPrepareUserResume).toHaveBeenCalledWith('selected-run')
  expect(mockResumePaused).toHaveBeenCalledWith({
    runId: 'selected-run', expectedJournalSequence: 9, cancellationSignal: signal, projection, onSettled,
  })
  expect(admitted.conversation.model).toBe('reviewed-model')
})

it('does not re-enable resources or construct a provider adapter for an already cancelled resume', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(resumePausedConversationRun({ ...input(), runId: 'run', expectedJournalSequence: 9,
    cancellationSignal: controller.signal, projection: jest.fn() })).resolves.toBe(false)
  expect(mockPrepareUserResume).not.toHaveBeenCalled()
  expect(mockCreateAdapter).not.toHaveBeenCalled()
  expect(mockResumePaused).not.toHaveBeenCalled()
})
