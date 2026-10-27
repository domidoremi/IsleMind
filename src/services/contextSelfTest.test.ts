import { runContextSelfTest } from './contextSelfTest'
import type { Settings } from '@/types/settingsContracts'
import {
  KNOWLEDGE_DOCUMENT_RECORD_SCHEMA, KNOWLEDGE_MEMORY_RECORD_SCHEMA,
  KnowledgeRepositoryConflictError, type KnowledgeDocumentRecord, type KnowledgeMemoryRecord,
} from '@/modules/knowledge/contracts'

// All persistence, retrieval, import and remote ports are isolated mocks.
const mockImport = jest.fn(), mockFts = jest.fn(), mockHybrid = jest.fn(), mockAgentic = jest.fn()
const mockExtract = jest.fn(), mockContext = jest.fn(), mockWeb = jest.fn(), mockJobs = jest.fn()
const mockSaveMemory = jest.fn(), mockSearchMemory = jest.fn()
const mockDeleteDocument = jest.fn(), mockDeleteMemory = jest.fn()
const mockListDocuments = jest.fn(), mockListMemories = jest.fn()
let mockDocuments: KnowledgeDocumentRecord[] = [], mockMemories: KnowledgeMemoryRecord[] = []
jest.mock('@/bootstrap/knowledgeDocumentImportRuntime', () => ({ importKnowledgePlainText: (...args: unknown[]) => mockImport(...args) }))
jest.mock('@/bootstrap/knowledgeRepository', () => ({
  deleteKnowledgeDocumentRecords: (...args: unknown[]) => mockDeleteDocument(...args),
  knowledgeRepository: {
    listDocuments: (...args: unknown[]) => mockListDocuments(...args),
    listMemories: (...args: unknown[]) => mockListMemories(...args),
    saveMemory: (...args: unknown[]) => mockSaveMemory(...args),
    searchMemories: (...args: unknown[]) => mockSearchMemory(...args),
    deleteMemory: (...args: unknown[]) => mockDeleteMemory(...args),
  },
}))
jest.mock('@/bootstrap/knowledgeRetrievalRuntime', () => ({
  searchKnowledgeFts: (...args: unknown[]) => mockFts(...args),
  searchKnowledgeWithFallback: (...args: unknown[]) => mockHybrid(...args),
  searchAgenticKnowledgeWithScope: (...args: unknown[]) => mockAgentic(...args),
}))
jest.mock('@/bootstrap/knowledgeMemoryExtraction', () => ({ extractConversationMemories: (...args: unknown[]) => mockExtract(...args) }))
jest.mock('@/bootstrap/knowledgeContextRuntime', () => ({ retrieveConversationKnowledgeContext: (...args: unknown[]) => mockContext(...args) }))
jest.mock('@/bootstrap/webSearchProviderRuntime', () => ({ searchWeb: (...args: unknown[]) => mockWeb(...args) }))
jest.mock('@/bootstrap/knowledgeRagEvaluation', () => ({ listRagEmbeddingJobs: (...args: unknown[]) => mockJobs(...args) }))
jest.mock('@/bootstrap/providerModelAccess', () => ({ getPolicyPreferredProviderModel: () => 'mock-model' }))
jest.mock('@/modules/integrations', () => ({
  SEARCH_DIAGNOSTIC_QUERY: 'fixture query', resolveSearchProvider: (settings: Settings) => settings.searchProvider ?? 'off',
}))
jest.mock('@/modules/knowledge', () => ({
  ...jest.requireActual('@/modules/knowledge/domain/knowledgeMutationGuard'),
  LOCAL_USER_MEMORY_SCOPE_ID: 'local-user',
}))

function input(controller = new AbortController()) {
  return {
    settings: { embeddingMode: 'local', memoryEnabled: false, knowledgeEnabled: false, searchProvider: 'off' } as Settings,
    primaryProvider: null, getTavilyApiKey: jest.fn(async () => null),
    t: (key: string) => key, onStep: jest.fn(), signal: controller.signal,
  }
}
function document(title: string): KnowledgeDocumentRecord {
  return { schema: KNOWLEDGE_DOCUMENT_RECORD_SCHEMA, id: 'owned-document', title, mimeType: 'text/plain',
    size: 16, chunkCount: 1, status: 'ready', createdAt: 1, updatedAt: 1 }
}
function memory(content: string): KnowledgeMemoryRecord {
  return { schema: KNOWLEDGE_MEMORY_RECORD_SCHEMA, id: 'owned-memory', content, status: 'active',
    sourceKind: 'manual', scope: { kind: 'user', id: 'local-user' }, sensitivity: 'normal',
    sourceMessageIds: [], createdAt: 1, updatedAt: 1 }
}
beforeEach(() => {
  jest.resetAllMocks()
  mockDocuments = []; mockMemories = []
  mockListDocuments.mockImplementation(async () => mockDocuments)
  mockListMemories.mockImplementation(async () => mockMemories)
  mockImport.mockImplementation(async (title: string) => { mockDocuments = [document(title)]; return { ok: true, message: 'Mock import' } })
  mockSaveMemory.mockImplementation(async (value: { content: string }) => {
    const record = memory(value.content); mockMemories = [record]; return record
  })
  for (const method of [mockFts, mockHybrid, mockAgentic, mockExtract, mockSearchMemory, mockJobs, mockWeb]) method.mockResolvedValue([])
  mockContext.mockResolvedValue({ sources: [] })
  mockDeleteDocument.mockImplementation(async () => { mockDocuments = [] })
  mockDeleteMemory.mockImplementation(async () => { mockMemories = [] })
})

it('rejects a pre-cancelled self-test before admitting any port', async () => {
  const controller = new AbortController(); controller.abort()
  await expect(runContextSelfTest(input(controller))).rejects.toMatchObject({ name: 'AbortError' })
  expect(mockListDocuments).not.toHaveBeenCalled()
  expect(mockImport).not.toHaveBeenCalled()
})

it('stops after cancelled baseline reads even if both repository ports return successfully', async () => {
  const controller = new AbortController()
  mockListDocuments.mockImplementationOnce(async () => { controller.abort(); return [] })
  await expect(runContextSelfTest(input(controller))).rejects.toMatchObject({ name: 'AbortError' })
  expect(mockImport).not.toHaveBeenCalled()
  expect(mockSaveMemory).not.toHaveBeenCalled()
})

it.each(['import', 'fts', 'hybrid', 'agentic', 'memory-search', 'extract', 'context', 'credentials', 'jobs'] as const)(
  'retires later self-test ports after cancelled %s settlement and still cleans owned artifacts',
  async stage => {
    const controller = new AbortController(), options = input(controller)
    options.settings.memoryEnabled = stage === 'extract' || stage === 'context'
    const ports: jest.Mock[] = [mockImport, mockFts, mockHybrid, mockAgentic, mockSearchMemory, mockExtract, mockContext, options.getTavilyApiKey, mockJobs]
    const selected = ports[['import', 'fts', 'hybrid', 'agentic', 'memory-search', 'extract', 'context', 'credentials', 'jobs'].indexOf(stage)]
    selected.mockImplementationOnce(async (...args: any[]) => {
      if (stage === 'import') mockDocuments = [document(args[0])]
      controller.abort()
      if (stage === 'import') return { ok: true, message: 'Persisted before cancel' }
      if (stage === 'context') return { sources: [] }
      return stage === 'credentials' ? null : []
    })
    await expect(runContextSelfTest(options)).rejects.toMatchObject({ name: 'AbortError' })
    const later = ports.slice(ports.indexOf(selected) + 1)
    for (const port of later) expect(port).not.toHaveBeenCalled()
    expect(mockWeb).not.toHaveBeenCalled()
    expect(mockDocuments).toEqual([])
    expect(mockMemories).toEqual([])
    expect(options.onStep).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'contextPanel.selfTest.cleanup' }))
  },
)

it('cleans a manual memory acknowledged after cancellation without admitting retrieval', async () => {
  const controller = new AbortController(), options = input(controller)
  mockSaveMemory.mockImplementationOnce(async (value: { content: string }) => {
    const record = memory(value.content); mockMemories = [record]; controller.abort(); return record
  })
  await expect(runContextSelfTest(options)).rejects.toMatchObject({ name: 'AbortError' })
  expect(mockSearchMemory).not.toHaveBeenCalled()
  expect(mockDeleteMemory).toHaveBeenCalledWith('owned-memory', expect.objectContaining({
    expectedMemory: expect.objectContaining({ id: 'owned-memory' }), signal: expect.any(AbortSignal),
  }))
})

it('captures settings and cancellation options before delayed import settlement', async () => {
  const options = input()
  let finish!: () => void
  mockImport.mockImplementationOnce((title: string) => new Promise(resolve => {
    finish = () => { mockDocuments = [document(title)]; resolve({ ok: true, message: 'Mock import' }) }
  }))
  const pending = runContextSelfTest(options)
  await Promise.resolve(); await Promise.resolve()
  options.settings.memoryEnabled = true
  options.settings.embeddingMode = 'provider'
  options.settings.searchProvider = 'tavily'
  finish()
  await pending
  expect(mockHybrid.mock.calls[0][0].embeddingMode).toBe('local')
  expect(mockExtract).not.toHaveBeenCalled()
  expect(mockWeb).not.toHaveBeenCalled()
})

it('passes one detached operation configuration through import, extraction, conversation retrieval and web admission', async () => {
  const options = input()
  options.settings = { ...options.settings, memoryEnabled: true, knowledgeEnabled: true, webSearchEnabled: true,
    searchProvider: 'tavily', localEmbeddingModelId: 'reviewed-local', proxyBaseUrl: 'https://reviewed.invalid' }
  options.getTavilyApiKey.mockResolvedValue('synthetic-reviewed-key' as never)
  let finish!: () => void
  mockImport.mockImplementationOnce((title: string) => new Promise(resolve => {
    finish = () => { mockDocuments = [document(title)]; resolve({ ok: true, message: 'Mock import' }) }
  }))
  const pending = runContextSelfTest(options)
  await Promise.resolve(); await Promise.resolve()
  options.settings.memoryEnabled = false; options.settings.knowledgeEnabled = false
  options.settings.searchProvider = 'off'; options.settings.localEmbeddingModelId = 'changed-live'
  finish()
  await pending
  const reviewed = expect.objectContaining({ memoryEnabled: true, knowledgeEnabled: true,
    searchProvider: 'tavily', localEmbeddingModelId: 'reviewed-local' })
  expect(mockImport.mock.calls[0][3]).toMatchObject({ settings: reviewed, waitForProviderUpgrades: true })
  expect(mockExtract.mock.calls[0][5]).toMatchObject({ settings: reviewed })
  expect(mockContext.mock.calls[0][3]).toMatchObject({ settings: reviewed, provider: null })
  expect(mockWeb.mock.calls[0][2]).toMatchObject({
    settings: reviewed, configuration: { provider: 'tavily', apiKey: 'synthetic-reviewed-key' },
  })
  expect(options.getTavilyApiKey).toHaveBeenCalledTimes(1)
})

it('guards cleanup document and memory snapshots rather than deleting a replacement record', async () => {
  const options = input()
  mockDeleteDocument.mockImplementationOnce(async (_id: string, operation: any) => {
    expect(operation.expectedDocument).toEqual(mockDocuments[0])
    mockDocuments = [{ ...mockDocuments[0], title: 'Unreviewed replacement' }]
    throw new KnowledgeRepositoryConflictError()
  })
  mockDeleteMemory.mockImplementationOnce(async (_id: string, operation: any) => {
    expect(operation.expectedMemory).toEqual(mockMemories[0])
    mockMemories = [{ ...mockMemories[0], content: 'Unreviewed replacement' }]
    throw new KnowledgeRepositoryConflictError()
  })
  const result = await runContextSelfTest(options)
  expect(result.steps.find(step => step.name === 'contextPanel.selfTest.cleanup')?.status).toBe('fail')
  expect(mockDocuments[0].title).toBe('Unreviewed replacement')
  expect(mockMemories[0].content).toBe('Unreviewed replacement')
})

it('never deletes an unrelated new memory merely because it contains a diagnostic marker', async () => {
  mockJobs.mockImplementationOnce(async () => {
    mockMemories.push({ ...mockMemories[0], id: 'unrelated', sourceKind: 'imported' })
    return []
  })
  await runContextSelfTest(input())
  expect(mockDeleteMemory).toHaveBeenCalledTimes(1)
  expect(mockDeleteMemory.mock.calls[0][0]).toBe('owned-memory')
})

it('waits for cleanup settlement after cancellation and surfaces a failed cleanup instead of silently resolving', async () => {
  const controller = new AbortController()
  mockFts.mockImplementationOnce(async () => { controller.abort(); return [] })
  let finish!: () => void, entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  mockDeleteDocument.mockImplementationOnce(() => {
    entered()
    return new Promise((_resolve, reject) => { finish = () => reject(new Error('Mock cleanup unavailable')) })
  })
  let settled = false
  const result = runContextSelfTest(input(controller)).then(() => { settled = true }, error => { settled = true; return error })
  await started
  expect(settled).toBe(false)
  finish()
  expect(await result).toMatchObject({ name: 'ContextSelfTestCleanupError' })
})

it('uses distinct diagnostic identities for consecutive self-tests within one clock tick', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(100)
  try {
    await runContextSelfTest(input()); await runContextSelfTest(input())
    expect(mockImport.mock.calls[0][0]).not.toBe(mockImport.mock.calls[1][0])
  } finally { now.mockRestore() }
})

it('does not admit later ports when a progress observer cancels immediately after an acknowledged import', async () => {
  const controller = new AbortController(), options = input(controller)
  options.onStep.mockImplementationOnce(() => { controller.abort() })
  await expect(runContextSelfTest(options)).rejects.toMatchObject({ name: 'AbortError' })
  expect(mockFts).not.toHaveBeenCalled()
  expect(mockDocuments).toEqual([])
})

it('preserves both an operation failure and cleanup failure without treating cleanup as successful', async () => {
  const failure = new Error('Mock retrieval unavailable'), cleanup = new Error('Mock cleanup unavailable')
  mockFts.mockRejectedValueOnce(failure)
  mockDeleteDocument.mockRejectedValueOnce(cleanup)
  await expect(runContextSelfTest(input())).rejects.toMatchObject({
    name: 'ContextSelfTestCleanupError', originalError: failure, cleanupFailures: [cleanup],
  })
})

it('cleans a partly persisted import failure and preserves the original failure', async () => {
  const failure = new Error('Mock index unavailable')
  mockImport.mockImplementationOnce(async (title: string) => { mockDocuments = [document(title)]; throw failure })
  await expect(runContextSelfTest(input())).rejects.toBe(failure)
  expect(mockDocuments).toEqual([])
  expect(mockFts).not.toHaveBeenCalled()
})

it('retains existing records and unrelated new documents throughout scoped self-test cleanup', async () => {
  const retained = document('User library')
  retained.id = 'existing'
  mockDocuments = [retained]
  mockImport.mockImplementationOnce(async (title: string) => {
    mockDocuments = [retained, document(title), { ...retained, id: 'unseen', title: 'Unseen import' }]
    return { ok: true, message: 'Mock import' }
  })
  mockDeleteDocument.mockImplementation(async (id: string) => { mockDocuments = mockDocuments.filter(item => item.id !== id) })
  await runContextSelfTest(input())
  expect(mockDocuments.map(item => item.id)).toEqual(['existing', 'unseen'])
  expect(mockDeleteDocument).toHaveBeenCalledTimes(1)
})

it('does not proceed to job diagnostics when a web adapter returns after cancellation', async () => {
  const controller = new AbortController(), options = input(controller)
  options.settings.searchProvider = 'tavily'
  options.getTavilyApiKey.mockResolvedValue('fixture-only' as never)
  mockWeb.mockImplementationOnce(async () => { controller.abort(); return [] })
  await expect(runContextSelfTest(options)).rejects.toMatchObject({ name: 'AbortError' })
  expect(mockJobs).not.toHaveBeenCalled()
  expect(mockDocuments).toEqual([])
  expect(mockMemories).toEqual([])
})

it('retains the original cancellation signal when a caller replaces input during pending import', async () => {
  const controller = new AbortController(), options = input(controller)
  let finish!: () => void
  mockImport.mockImplementationOnce((title: string) => new Promise(resolve => {
    finish = () => { mockDocuments = [document(title)]; resolve({ ok: true, message: 'Mock import' }) }
  }))
  const pending = runContextSelfTest(options)
  await Promise.resolve(); await Promise.resolve()
  controller.abort()
  options.signal = new AbortController().signal
  finish()
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(mockFts).not.toHaveBeenCalled()
  expect(mockDocuments).toEqual([])
})

it('removes owned extracted memory only when conversation, source and diagnostic marker agree', async () => {
  const options = input()
  options.settings.memoryEnabled = true
  mockExtract.mockImplementationOnce(async (conversationId: string, messages: any[]) => {
    const content = messages[0].content
    mockMemories.push({ ...memory(content), id: 'extracted', sourceKind: 'deterministic', conversationId })
    mockMemories.push({ ...memory(content), id: 'different-conversation', sourceKind: 'deterministic', conversationId: 'user-chat' })
    return []
  })
  await runContextSelfTest(options)
  expect(mockDeleteMemory.mock.calls.map(args => args[0])).toEqual(['owned-memory', 'extracted'])
})
