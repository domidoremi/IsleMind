import {
  retrieveConversationFlareContext,
  retrieveConversationKnowledgeContext,
  retrieveConversationKnowledgeContextInLocalJob,
} from './knowledgeContextRuntime'
import type { Conversation, Message } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'

const mockListDocuments = jest.fn(), mockListMemories = jest.fn(), mockSearchMemories = jest.fn()
const mockSearchKnowledge = jest.fn(), mockRag = jest.fn(), mockHydrate = jest.fn(), mockRunLocal = jest.fn()
let mockSettings: Settings, mockProviders: AIProvider[]
jest.mock('@/bootstrap/knowledgeRepository', () => ({
  knowledgeRepository: {
    listDocuments: (...args: unknown[]) => mockListDocuments(...args),
    listMemories: (...args: unknown[]) => mockListMemories(...args),
    searchMemories: (...args: unknown[]) => mockSearchMemories(...args),
  },
}))
jest.mock('@/bootstrap/knowledgeRetrievalRuntime', () => ({
  searchKnowledgeWithFallback: (...args: unknown[]) => mockSearchKnowledge(...args),
}))
jest.mock('@/bootstrap/ragEvaluationRepository', () => ({ ragEvaluationRepository: { log: async () => undefined } }))
jest.mock('@/services/runtimeHealthLog', () => ({ logContextOperation: async () => undefined }))
jest.mock('@/i18n/service', () => ({ st: (key: string) => key }))
jest.mock('@/types/modelCatalog', () => ({ getModelConfig: () => ({ contextWindow: 4096, maxOutputTokens: 1024 }) }))
jest.mock('@/utils/providerModels', () => ({ resolveProviderModelAlias: (_provider: unknown, model: string) => model }))
jest.mock('@/modules/providers', () => jest.requireActual('@/modules/providers/providerConfigurationMutation'))
jest.mock('@/modules/knowledge', () => ({
  LOCAL_USER_MEMORY_SCOPE_ID: 'local-user',
  buildCompressedContextPrompt: () => '',
  buildFlareContextPrompt: () => '',
  buildKnowledgeScope: (sources: unknown) => ({ sources }),
  runAgenticRag: (...args: unknown[]) => mockRag(...args),
}))
jest.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      settings: mockSettings, providers: mockProviders,
      hydrateProviderKey: (...args: unknown[]) => mockHydrate(...args),
    }),
  },
}))
jest.mock('./executionResources', () => ({
  executionResources: { runLocal: (...args: unknown[]) => mockRunLocal(...args) },
}))

const conversation = (): Conversation => ({
  id: 'reviewed-chat', title: 'Reviewed title', providerId: 'reviewed-provider', model: 'reviewed-model',
  systemPrompt: 'Private instructions', maxTokens: 512, temperature: 0.7, messages: [],
  createdAt: 1, updatedAt: 1, knowledgeSources: ['reviewed-document'],
} as unknown as Conversation)
const message = (): Message => ({
  id: 'reviewed-message', role: 'user', content: 'Reviewed question', status: 'done', timestamp: 1,
})
const provider = (): AIProvider => ({
  id: 'reviewed-provider', apiKey: 'synthetic-reviewed-key', baseUrl: 'https://reviewed.invalid/v1',
} as AIProvider)
function deferred<T>() {
  let resolve!: (value: T) => void
  return { promise: new Promise<T>(yes => { resolve = yes }), resolve: (value: T) => resolve(value) }
}

beforeEach(() => {
  jest.resetAllMocks()
  mockSettings = { knowledgeEnabled: true, memoryEnabled: true, ragMode: 'hybrid', embeddingMode: 'local' } as Settings
  mockProviders = [provider()]
  mockListDocuments.mockResolvedValue([])
  mockListMemories.mockResolvedValue([])
  mockSearchMemories.mockResolvedValue([])
  mockSearchKnowledge.mockResolvedValue([])
  mockHydrate.mockResolvedValue(provider())
  mockRunLocal.mockImplementation(async (_signal, work) => work())
  mockRag.mockImplementation(async input => {
    await input.retrieveKnowledge(input.query, 3, { signal: input.signal })
    return { sources: [], contextPrompt: '', trace: [], plan: {}, quality: { latencyMs: 0 } }
  })
})

it('captures default settings and conversation provenance before a queued local job starts', async () => {
  const gate = deferred<void>()
  mockRunLocal.mockImplementationOnce(async (_signal, work) => { await gate.promise; return work() })
  const reviewed = conversation(), draft = message()
  const pending = retrieveConversationKnowledgeContext(reviewed, draft)
  mockSettings.knowledgeEnabled = false; mockSettings.memoryEnabled = false
  reviewed.title = 'Changed title'; reviewed.systemPrompt = 'Changed instructions'
  draft.content = 'Changed question'
  reviewed.knowledgeSources = ['changed-document'] as unknown as Conversation['knowledgeSources']
  gate.resolve()
  await pending
  expect(mockRag).toHaveBeenCalledWith(expect.objectContaining({
    query: 'Reviewed question\nReviewed title', conversationTitle: 'Reviewed title',
    systemPrompt: 'Private instructions', settings: expect.objectContaining({ knowledgeEnabled: true, memoryEnabled: true }),
  }))
  expect(mockSearchKnowledge.mock.calls[0][0].knowledgeScope).toEqual({ sources: ['reviewed-document'] })
  expect(mockSearchMemories).toHaveBeenCalledTimes(1)
})

it('detaches explicitly admitted settings and provider before local repository initialization', async () => {
  const gate = deferred<[]>()
  mockListDocuments.mockReturnValueOnce(gate.promise)
  const settings = { ...mockSettings, localEmbeddingModelId: 'reviewed-local' }, admitted = provider()
  const pending = retrieveConversationKnowledgeContextInLocalJob(conversation(), message(), undefined, { settings, provider: admitted })
  settings.knowledgeEnabled = false; settings.localEmbeddingModelId = 'changed-local'
  admitted.apiKey = 'synthetic-changed-key'; admitted.baseUrl = 'https://changed.invalid/v1'
  gate.resolve([])
  await pending
  expect(mockHydrate).not.toHaveBeenCalled()
  expect(mockRag.mock.calls[0][0].settings).toMatchObject({ knowledgeEnabled: true, localEmbeddingModelId: 'reviewed-local' })
  expect(mockSearchKnowledge.mock.calls[0][0]).toMatchObject({
    ragMode: 'fts', provider: { apiKey: 'synthetic-reviewed-key', baseUrl: 'https://reviewed.invalid/v1' },
  })
})

it('treats an explicit null provider as local retrieval without live credential hydration', async () => {
  await retrieveConversationKnowledgeContext(conversation(), message(), undefined, { settings: mockSettings, provider: null })
  expect(mockHydrate).not.toHaveBeenCalled()
  expect(mockSearchKnowledge.mock.calls[0][0].provider).toBeUndefined()
  expect(mockSearchKnowledge.mock.calls[0][0].ragMode).toBe('fts')
})

it('passes the captured provider catalog and original signal to default credential admission', async () => {
  const gate = deferred<void>(), controller = new AbortController()
  mockRunLocal.mockImplementationOnce(async (_signal, work) => { await gate.promise; return work() })
  const pending = retrieveConversationKnowledgeContext(conversation(), message(), controller.signal)
  mockProviders[0].baseUrl = 'https://changed.invalid/v1'
  gate.resolve()
  await pending
  expect(mockHydrate).toHaveBeenCalledWith('reviewed-provider', expect.objectContaining({
    signal: controller.signal, providers: [expect.objectContaining({ baseUrl: 'https://reviewed.invalid/v1' })],
  }))
})

it('keeps an admitted disabled knowledge setting even if live settings enable it during initialization', async () => {
  const gate = deferred<[]>()
  mockListDocuments.mockReturnValueOnce(gate.promise)
  mockSettings.knowledgeEnabled = false; mockSettings.memoryEnabled = false
  const pending = retrieveConversationKnowledgeContextInLocalJob(conversation(), message())
  mockSettings.knowledgeEnabled = true; mockSettings.memoryEnabled = true
  gate.resolve([])
  await pending
  expect(mockRag).not.toHaveBeenCalled()
  expect(mockSearchMemories).not.toHaveBeenCalled()
  expect(mockHydrate).not.toHaveBeenCalled()
})

it('rejects pre-cancelled retrieval before local queue or repository admission', async () => {
  const controller = new AbortController(); controller.abort()
  await expect(retrieveConversationKnowledgeContext(conversation(), message(), controller.signal))
    .rejects.toMatchObject({ name: 'AbortError' })
  expect(mockRunLocal).not.toHaveBeenCalled()
  expect(mockListDocuments).not.toHaveBeenCalled()
  expect(mockHydrate).not.toHaveBeenCalled()
})

it.each(['queued', 'initializing'] as const)('does not admit retrieval after cancellation while %s work settles', async stage => {
  const gate = deferred<void>(), controller = new AbortController()
  if (stage === 'queued') mockRunLocal.mockImplementationOnce(async (_signal, work) => { await gate.promise; return work() })
  else mockListDocuments.mockImplementationOnce(async () => { await gate.promise; return [] })
  const pending = retrieveConversationKnowledgeContext(conversation(), message(), controller.signal)
  const check = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort()
  gate.resolve()
  await check
  expect(mockRag).not.toHaveBeenCalled()
  expect(mockHydrate).not.toHaveBeenCalled()
})

it('keeps deep retrieval local-only even with a captured embedding-capable provider', async () => {
  await retrieveConversationKnowledgeContext(conversation(), message(), undefined, {
    settings: { ...mockSettings, ragMode: 'hybrid', embeddingMode: 'provider', ragProfile: 'deep' } as Settings,
    provider: { ...provider(), capabilities: { embeddings: true } } as AIProvider,
  })
  expect(mockSearchKnowledge.mock.calls[0][0].ragMode).toBe('fts')
})

it('captures FLARE query, scope, exclusions and settings before its local queue waits', async () => {
  const gate = deferred<void>()
  mockRunLocal.mockImplementationOnce(async (_signal, work) => { await gate.promise; return work() })
  mockSearchKnowledge.mockResolvedValue([{ id: 'source', chunkId: 'excluded', type: 'knowledge', content: 'Local source' }])
  const input = {
    conversation: conversation(), query: 'Original query', followupQuery: 'Reviewed followup',
    excludeChunkIds: ['excluded'], settings: { ...mockSettings, localEmbeddingModelId: 'reviewed-local' },
  }
  const pending = retrieveConversationFlareContext(input)
  input.followupQuery = 'Changed followup'; input.excludeChunkIds.length = 0
  input.conversation.knowledgeSources = ['changed-document'] as unknown as Conversation['knowledgeSources']
  input.settings.localEmbeddingModelId = 'changed-local'
  gate.resolve()
  expect((await pending).sources).toEqual([])
  expect(mockSearchKnowledge).toHaveBeenCalledWith(expect.objectContaining({
    query: 'Reviewed followup', localEmbeddingModelId: 'reviewed-local', ragMode: 'fts',
    knowledgeScope: { sources: ['reviewed-document'] },
  }))
  expect(mockHydrate).not.toHaveBeenCalled()
})

it('retains the original FLARE cancellation signal when a caller replaces it during local search', async () => {
  const gate = deferred<[]>(), controller = new AbortController()
  mockSearchKnowledge.mockReturnValueOnce(gate.promise)
  const input = { conversation: conversation(), query: 'Query', followupQuery: 'Followup', signal: controller.signal }
  const pending = retrieveConversationFlareContext(input)
  const check = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  input.signal = new AbortController().signal; controller.abort()
  gate.resolve([])
  await check
})
