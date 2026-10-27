import {
  clearKnowledgeRecords,
  clearKnowledgeIndexCaches,
  createKnowledgeDocumentIndex,
  deleteKnowledgeDocumentRecords,
  rebuildKnowledgeEmbeddings,
  synchronizeKnowledgeChunkIndexes,
} from './knowledgeRepository'
import {
  KNOWLEDGE_CHUNK_RECORD_SCHEMA,
  KNOWLEDGE_DOCUMENT_RECORD_SCHEMA,
  KnowledgeRepositoryConflictError,
  type KnowledgeChunkRecord,
  type KnowledgeDocumentMutationOptions,
  type KnowledgeDocumentRecord,
} from '@/modules/knowledge'

jest.mock('@/platform/storage', () => ({ createExpoSqliteDatabaseProvider: () => ({ get: jest.fn() }) }))
jest.mock('@/modules/providers', () => ({
  ...jest.requireActual('@/modules/providers/providerConfigurationMutation'),
  getProviderCompatibilityEvidenceForProvider: () => ({ id: 'test' }),
  providerCompatibilityCapabilityCanBeSentForProvider: () => true,
}))
jest.mock('@/modules/knowledge', () => {
  const repository = {
    listDocuments: jest.fn(), listChunks: jest.fn(), loadSnapshot: jest.fn(), updateDocumentStatus: jest.fn(),
    deleteDocument: jest.fn(), clearDocuments: jest.fn(),
  }
  const hybrid = { deleteDocumentEmbeddings: jest.fn(), clearEmbeddings: jest.fn(), clearCache: jest.fn(), synchronizeEmbeddings: jest.fn(), upgradeProviderEmbeddings: jest.fn() }
  const colbert = { deleteDocument: jest.fn(), clear: jest.fn(), synchronize: jest.fn() }
  const agentic = { deleteDocument: jest.fn(), clear: jest.fn(), synchronize: jest.fn() }
  return {
    ...jest.requireActual('@/modules/knowledge'),
    createKnowledgeQueryEmbeddingUseCase: () => ({}),
    createSqliteKnowledgeRepository: () => repository,
    createSqliteKnowledgeHybridIndex: () => hybrid,
    createSqliteKnowledgeColbertIndex: () => colbert,
    createSqliteKnowledgeAgenticIndex: () => agentic,
    testRepository: repository, testHybrid: hybrid, testColbert: colbert, testAgentic: agentic,
  }
})

const {
  testRepository: repository, testHybrid: hybrid, testColbert: colbert, testAgentic: agentic,
} = jest.requireMock('@/modules/knowledge')
const reviewed: KnowledgeDocumentRecord = {
  schema: KNOWLEDGE_DOCUMENT_RECORD_SCHEMA, id: 'reviewed', title: 'Reviewed document',
  mimeType: 'text/plain', size: 16, chunkCount: 1, status: 'ready', createdAt: 1, updatedAt: 1,
}
const durableChunks: KnowledgeChunkRecord[] = [{
  schema: KNOWLEDGE_CHUNK_RECORD_SCHEMA, id: 'chunk', documentId: reviewed.id,
  title: reviewed.title, content: 'Current retained content', ordinal: 0, createdAt: 1,
}]

beforeEach(() => {
  jest.resetAllMocks()
  repository.listDocuments.mockResolvedValue([reviewed])
  repository.listChunks.mockResolvedValue(durableChunks)
  repository.loadSnapshot.mockResolvedValue({ memories: [], documents: [reviewed], chunks: durableChunks })
  for (const method of [
    repository.deleteDocument, repository.clearDocuments, repository.updateDocumentStatus,
    hybrid.deleteDocumentEmbeddings, hybrid.clearEmbeddings, hybrid.clearCache, hybrid.synchronizeEmbeddings, hybrid.upgradeProviderEmbeddings,
    colbert.deleteDocument, colbert.clear, colbert.synchronize,
    agentic.deleteDocument, agentic.clear, agentic.synchronize,
  ]) method.mockResolvedValue(undefined)
})

it('captures a document index configuration at construction before delayed synchronization', async () => {
  const indexing = {
    provider: { id: 'reviewed-provider', apiKey: 'synthetic-reviewed-key', baseUrl: 'https://reviewed.invalid/v1' } as any,
    embeddingMode: 'hybrid' as const, localEmbeddingModelId: 'reviewed-local', refreshAgenticIndex: true,
  }
  const port = createKnowledgeDocumentIndex(indexing)
  indexing.provider.apiKey = 'synthetic-changed-key'; indexing.provider.baseUrl = 'https://changed.invalid/v1'
  indexing.localEmbeddingModelId = 'changed-local'; indexing.refreshAgenticIndex = false
  await port.synchronize(reviewed, durableChunks, { signal: new AbortController().signal })
  expect(hybrid.synchronizeEmbeddings.mock.calls[0][1]).toMatchObject({
    localEmbeddingModelId: 'reviewed-local', provider: { apiKey: 'synthetic-reviewed-key', baseUrl: 'https://reviewed.invalid/v1' },
  })
  expect(colbert.synchronize).toHaveBeenCalledTimes(1)
  expect(agentic.synchronize).toHaveBeenCalledTimes(1)
})

it.each(['document', 'chunks'] as const)('retains %s index inputs through delayed hybrid-index settlement', async entry => {
  let release!: () => void
  hybrid.synchronizeEmbeddings.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
  const chunks = durableChunks.map(chunk => ({ ...chunk }))
  const indexing = {
    provider: { id: 'reviewed-provider', apiKey: 'synthetic-reviewed-key' } as any,
    embeddingMode: 'hybrid' as const, refreshAgenticIndex: true,
  }
  const signal = new AbortController().signal
  const pending = entry === 'document' ? createKnowledgeDocumentIndex(indexing).synchronize(reviewed, chunks, { signal })
    : synchronizeKnowledgeChunkIndexes(chunks, indexing, signal)
  chunks[0].content = 'Changed source'; indexing.provider.apiKey = 'synthetic-changed-key'
  indexing.refreshAgenticIndex = false
  release()
  await pending
  expect(colbert.synchronize).toHaveBeenCalledWith(
    [expect.objectContaining({ content: 'Current retained content' })], { signal },
  )
  expect(hybrid.upgradeProviderEmbeddings).toHaveBeenCalledWith(
    [expect.objectContaining({ content: 'Current retained content' })],
    expect.objectContaining({ provider: expect.objectContaining({ apiKey: 'synthetic-reviewed-key' }), signal }),
  )
})

it('clears only the saved hybrid query cache with the caller signal', async () => {
  const controller = new AbortController()
  await clearKnowledgeIndexCaches({ signal: controller.signal })
  expect(hybrid.clearCache).toHaveBeenCalledWith({ signal: controller.signal })
  expect(hybrid.clearEmbeddings).not.toHaveBeenCalled()
  expect(colbert.clear).not.toHaveBeenCalled()
  expect(agentic.clear).not.toHaveBeenCalled()
  expect(repository.clearDocuments).not.toHaveBeenCalled()
})

it('does not admit query cache clearing with an already cancelled signal', async () => {
  const controller = new AbortController(); controller.abort()
  await expect(clearKnowledgeIndexCaches({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(hybrid.clearCache).not.toHaveBeenCalled()
})

it('waits for an admitted cache clear and retains the original signal through caller mutation', async () => {
  let finish!: () => void
  hybrid.clearCache.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const controller = new AbortController(), operation = { signal: controller.signal }
  const promise = clearKnowledgeIndexCaches(operation)
  operation.signal = new AbortController().signal
  controller.abort()
  expect(hybrid.clearCache.mock.calls[0][0].signal).toBe(controller.signal)
  const check = expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  finish()
  await check
})

it.each(['error', 'extracting'] as const)('rebuilds all indexes before recovering a retained %s document', async status => {
  const document = { ...reviewed, status, error: 'Interrupted indexing' }
  repository.loadSnapshot.mockResolvedValue({ memories: [], documents: [document], chunks: durableChunks })
  const controller = new AbortController()
  expect(await rebuildKnowledgeEmbeddings({ embeddingMode: 'local' }, {
    signal: controller.signal, expectedDocuments: [document],
  })).toBe(1)
  for (const method of [hybrid.synchronizeEmbeddings, colbert.synchronize, agentic.synchronize]) {
    expect(method).toHaveBeenCalledWith(durableChunks, expect.objectContaining({ signal: controller.signal }))
    expect(method.mock.invocationCallOrder[0]).toBeLessThan(repository.updateDocumentStatus.mock.invocationCallOrder[0])
  }
  expect(repository.updateDocumentStatus).toHaveBeenCalledWith(document.id, 'ready', undefined, {
    signal: controller.signal, expectedDocument: document, expectedChunks: durableChunks,
  })
})

it('does not call an empty or incomplete document recovered after rebuilding other retained chunks', async () => {
  const documents = [
    { ...reviewed, id: 'empty', status: 'error', chunkCount: 0 },
    { ...reviewed, status: 'error', chunkCount: 2 },
  ]
  repository.loadSnapshot.mockResolvedValue({ memories: [], documents, chunks: durableChunks })
  await rebuildKnowledgeEmbeddings()
  expect(repository.updateDocumentStatus).not.toHaveBeenCalled()
})

it('does not recover a document when a required agentic index fails', async () => {
  const document = { ...reviewed, status: 'error' }
  repository.loadSnapshot.mockResolvedValue({ memories: [], documents: [document], chunks: durableChunks })
  agentic.synchronize.mockRejectedValueOnce(new Error('Agentic index unavailable'))
  await expect(rebuildKnowledgeEmbeddings()).rejects.toThrow('Agentic index unavailable')
  expect(repository.updateDocumentStatus).not.toHaveBeenCalled()
})

it('rejects changed reviewed documents before rebuilding any index', async () => {
  await expect(rebuildKnowledgeEmbeddings({}, {
    expectedDocuments: [{ ...reviewed, title: 'Old title' }],
  })).rejects.toBeInstanceOf(KnowledgeRepositoryConflictError)
  expect(hybrid.synchronizeEmbeddings).not.toHaveBeenCalled()
})

it('rejects a same-ID source replacement during rebuilding and repairs current indexes locally', async () => {
  const document = { ...reviewed, status: 'error' }
  const replacementChunks = [{ ...durableChunks[0], content: 'Unreviewed replacement' }]
  repository.loadSnapshot
    .mockResolvedValueOnce({ memories: [], documents: [document], chunks: durableChunks })
    .mockResolvedValue({ memories: [], documents: [document], chunks: replacementChunks })
  await expect(rebuildKnowledgeEmbeddings()).rejects.toBeInstanceOf(KnowledgeRepositoryConflictError)
  expect(repository.updateDocumentStatus).not.toHaveBeenCalled()
  expect(hybrid.synchronizeEmbeddings).toHaveBeenLastCalledWith(replacementChunks, expect.objectContaining({
    signal: expect.any(AbortSignal),
  }))
  expect(hybrid.synchronizeEmbeddings.mock.calls[1][1].provider).toBeUndefined()
})

it('retires a rebuild before indexing when its original signal is cancelled during snapshot loading', async () => {
  const controller = new AbortController()
  let finish!: (snapshot: unknown) => void
  repository.loadSnapshot.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const options = { signal: controller.signal }
  const pending = rebuildKnowledgeEmbeddings({}, options)
  controller.abort()
  options.signal = new AbortController().signal
  finish({ memories: [], documents: [reviewed], chunks: durableChunks })
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(hybrid.synchronizeEmbeddings).not.toHaveBeenCalled()
})

it('waits for an explicit rebuild provider upgrade before acknowledging recovery', async () => {
  const document = { ...reviewed, status: 'error' }
  repository.loadSnapshot.mockResolvedValue({ memories: [], documents: [document], chunks: durableChunks })
  let settle!: () => void
  let upgradeStarted!: () => void
  const started = new Promise<void>(resolve => { upgradeStarted = resolve })
  hybrid.upgradeProviderEmbeddings.mockImplementationOnce(() => {
    upgradeStarted()
    return new Promise<void>(resolve => { settle = resolve })
  })
  const pending = rebuildKnowledgeEmbeddings({
    provider: { id: 'provider', type: 'openai', name: 'Provider', apiKey: 'fixture-only' } as any,
  })
  await started
  expect(repository.updateDocumentStatus).not.toHaveBeenCalled()
  settle()
  await pending
  expect(repository.updateDocumentStatus).toHaveBeenCalledTimes(1)
})

it('holds cancellation until a running upgrade settles and does not mark its source ready', async () => {
  const document = { ...reviewed, status: 'error' }
  repository.loadSnapshot.mockResolvedValue({ memories: [], documents: [document], chunks: durableChunks })
  let settle!: () => void
  let upgradeStarted!: () => void
  const started = new Promise<void>(resolve => { upgradeStarted = resolve })
  hybrid.upgradeProviderEmbeddings.mockImplementationOnce(() => {
    upgradeStarted()
    return new Promise<void>(resolve => { settle = resolve })
  })
  const controller = new AbortController()
  const pending = rebuildKnowledgeEmbeddings({
    provider: { id: 'provider', type: 'openai', name: 'Provider', apiKey: 'fixture-only' } as any,
  }, { signal: controller.signal })
  let finished = false
  const result = pending.then(() => { finished = true }, error => { finished = true; return error })
  await started
  controller.abort()
  await Promise.resolve()
  expect(finished).toBe(false)
  expect(repository.updateDocumentStatus).not.toHaveBeenCalled()
  settle()
  expect(await result).toMatchObject({ name: 'AbortError' })
  expect(repository.updateDocumentStatus).not.toHaveBeenCalled()
  expect(hybrid.synchronizeEmbeddings.mock.calls[1][1].provider).toBeUndefined()
})

it('limits recovery to the displayed source scope and keeps new unseen documents out of rebuild writes', async () => {
  const document = { ...reviewed, status: 'error' as const }
  const unseen = { ...document, id: 'unseen' }
  const unseenChunk = { ...durableChunks[0], id: 'unseen-chunk', documentId: unseen.id }
  repository.loadSnapshot.mockResolvedValue({ memories: [], documents: [document, unseen], chunks: [...durableChunks, unseenChunk] })
  expect(await rebuildKnowledgeEmbeddings({}, { expectedDocuments: [document] })).toBe(1)
  expect(hybrid.synchronizeEmbeddings).toHaveBeenCalledWith(durableChunks, expect.anything())
  expect(repository.updateDocumentStatus).toHaveBeenCalledTimes(1)
  expect(repository.updateDocumentStatus.mock.calls[0][0]).toBe(document.id)
})

it('detaches reviewed rebuild documents and model options before awaiting the snapshot', async () => {
  const document = { ...reviewed, status: 'error' as const }
  const expected = { ...document }
  const options = { embeddingMode: 'local' as const, localEmbeddingModelId: 'selected-original' }
  let finish!: () => void
  repository.loadSnapshot.mockImplementationOnce(() => new Promise(resolve => {
    finish = () => resolve({ memories: [], documents: [document], chunks: durableChunks })
  })).mockResolvedValue({ memories: [], documents: [document], chunks: durableChunks })
  const pending = rebuildKnowledgeEmbeddings(options, { expectedDocuments: [expected] })
  expected.title = 'Caller changed title'
  options.localEmbeddingModelId = 'unreviewed-model'
  finish()
  await pending
  expect(hybrid.synchronizeEmbeddings.mock.calls[0][1].localEmbeddingModelId).toBe('selected-original')
  expect(repository.updateDocumentStatus.mock.calls[0][3].expectedDocument).toEqual(document)
})

it('preserves a late status conflict and repairs only the affected indexes from current source', async () => {
  const document = { ...reviewed, status: 'error' }
  repository.loadSnapshot.mockResolvedValue({ memories: [], documents: [document], chunks: durableChunks })
  const failure = new KnowledgeRepositoryConflictError()
  repository.updateDocumentStatus.mockRejectedValueOnce(failure)
  await expect(rebuildKnowledgeEmbeddings()).rejects.toBe(failure)
  expect(hybrid.deleteDocumentEmbeddings).toHaveBeenCalledWith(document.id, expect.objectContaining({ signal: expect.any(AbortSignal) }))
  expect(repository.saveDocument).toBeUndefined()
  expect(hybrid.synchronizeEmbeddings).toHaveBeenCalledTimes(2)
})

it('preserves both the original rebuilding failure and a failed local repair', async () => {
  const failure = new Error('Index unavailable'), repairFailure = new Error('Repair unavailable')
  hybrid.synchronizeEmbeddings.mockRejectedValueOnce(failure)
  hybrid.deleteDocumentEmbeddings.mockRejectedValueOnce(repairFailure)
  await expect(rebuildKnowledgeEmbeddings()).rejects.toMatchObject({
    name: 'AggregateError', errors: [failure, repairFailure],
  })
  expect(repository.updateDocumentStatus).not.toHaveBeenCalled()
})

it.each(['hybrid', 'colbert', 'agentic'] as const)(
  'stops later index and provider work when the %s rebuild adapter returns after cancellation',
  async stage => {
    const controller = new AbortController()
    const method = stage === 'hybrid' ? hybrid.synchronizeEmbeddings
      : stage === 'colbert' ? colbert.synchronize : agentic.synchronize
    method.mockImplementationOnce(async () => { controller.abort() })
    await expect(rebuildKnowledgeEmbeddings({
      provider: { id: 'provider', type: 'openai', name: 'Provider', apiKey: 'fixture-only' } as any,
    }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(hybrid.upgradeProviderEmbeddings).not.toHaveBeenCalled()
    expect(repository.updateDocumentStatus).not.toHaveBeenCalled()
    for (const port of [hybrid.synchronizeEmbeddings, colbert.synchronize, agentic.synchronize]) {
      const calls = port.mock.calls.filter((args: any[]) => args[1].signal === controller.signal)
      expect(calls).toHaveLength(stage === 'hybrid' && port !== hybrid.synchronizeEmbeddings ||
        stage === 'colbert' && port === agentic.synchronize ? 0 : 1)
    }
  },
)

it('retains cancellation until scoped local index repair settles and keeps failed source status', async () => {
  const document = { ...reviewed, status: 'error' }
  repository.loadSnapshot.mockResolvedValue({ memories: [], documents: [document], chunks: durableChunks })
  const controller = new AbortController()
  hybrid.synchronizeEmbeddings.mockImplementationOnce(async () => { controller.abort() })
  let finish!: () => void, repairing!: () => void
  const started = new Promise<void>(resolve => { repairing = resolve })
  hybrid.deleteDocumentEmbeddings.mockImplementationOnce(() => {
    repairing()
    return new Promise<void>(resolve => { finish = resolve })
  })
  let settled = false
  const result = rebuildKnowledgeEmbeddings({}, { signal: controller.signal })
    .then(() => { settled = true }, error => { settled = true; return error })
  await started
  expect(settled).toBe(false)
  expect(repository.updateDocumentStatus).not.toHaveBeenCalled()
  finish()
  expect(await result).toMatchObject({ name: 'AbortError' })
  expect(hybrid.synchronizeEmbeddings.mock.calls[1][1].signal.aborted).toBe(false)
  expect(repository.updateDocumentStatus).not.toHaveBeenCalled()
})

it.each(['hybrid', 'colbert', 'agentic'] as const)(
  'retires the shared import index pipeline after its %s adapter settles cancelled',
  async stage => {
    const controller = new AbortController()
    const method = stage === 'hybrid' ? hybrid.synchronizeEmbeddings
      : stage === 'colbert' ? colbert.synchronize : agentic.synchronize
    method.mockImplementationOnce(async () => { controller.abort() })
    const index = createKnowledgeDocumentIndex({
      provider: { id: 'provider', type: 'openai', name: 'Provider', apiKey: 'fixture-only' } as any,
    })
    await expect(index.synchronize(reviewed, durableChunks, { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(hybrid.upgradeProviderEmbeddings).not.toHaveBeenCalled()
    expect(colbert.synchronize).toHaveBeenCalledTimes(stage === 'hybrid' ? 0 : 1)
    expect(agentic.synchronize).toHaveBeenCalledTimes(stage === 'agentic' ? 1 : 0)
  },
)

it('detaches the reviewed document before awaiting the canonical preflight read', async () => {
  const expected = { ...reviewed }
  let finish!: () => void
  repository.listDocuments.mockImplementationOnce(() => new Promise(resolve => {
    finish = () => resolve([{ ...reviewed, title: 'Unreviewed replacement' }])
  }))
  const pending = deleteKnowledgeDocumentRecords(expected.id, { expectedDocument: expected })
  expected.title = 'Unreviewed replacement'
  finish()
  await expect(pending).rejects.toBeInstanceOf(KnowledgeRepositoryConflictError)
  expect(repository.deleteDocument).not.toHaveBeenCalled()
  expect(hybrid.deleteDocumentEmbeddings).not.toHaveBeenCalled()
})

it('detaches a displayed document clear collection before awaiting preflight and index cleanup', async () => {
  const unseen = { ...reviewed, id: 'unseen', title: 'Unseen document' }
  let finish!: () => void
  repository.listDocuments.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve([reviewed, unseen]) }))
  const expectedDocuments = [{ ...reviewed }]
  const pending = clearKnowledgeRecords({ expectedDocuments })
  expectedDocuments.push(unseen)
  finish()
  await pending
  expect(hybrid.deleteDocumentEmbeddings).toHaveBeenCalledTimes(1)
  expect(hybrid.deleteDocumentEmbeddings.mock.calls[0][0]).toBe(reviewed.id)
  expect(repository.clearDocuments).toHaveBeenCalledWith(expect.objectContaining({ expectedDocuments: [reviewed] }))
})

it('retains the original document cancellation signal after a caller replaces its options during index cleanup', async () => {
  const controller = new AbortController()
  const operation = { expectedDocument: { ...reviewed }, signal: controller.signal }
  let finish!: () => void
  hybrid.deleteDocumentEmbeddings.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  repository.deleteDocument.mockImplementation(async (_id: string, options: KnowledgeDocumentMutationOptions) => {
    if (options.signal?.aborted) throw new Error('cancelled before canonical deletion')
  })
  const pending = deleteKnowledgeDocumentRecords(reviewed.id, operation)
  await Promise.resolve()
  await Promise.resolve()
  expect(hybrid.deleteDocumentEmbeddings).toHaveBeenCalledTimes(1)
  controller.abort()
  operation.signal = new AbortController().signal
  finish()
  await expect(pending).rejects.toThrow(/cancel/)
  expect(repository.deleteDocument).not.toHaveBeenCalled()
})

it.each(['delete', 'clear'])('rejects stale %s before any derived-index mutation', async action => {
  repository.listDocuments.mockResolvedValue([{ ...reviewed, title: 'Changed title' }])
  const operation = action === 'delete'
    ? deleteKnowledgeDocumentRecords(reviewed.id, { expectedDocument: reviewed })
    : clearKnowledgeRecords({ expectedDocuments: [reviewed] })
  await expect(operation).rejects.toBeInstanceOf(KnowledgeRepositoryConflictError)
  expect(hybrid.deleteDocumentEmbeddings).not.toHaveBeenCalled()
  expect(colbert.deleteDocument).not.toHaveBeenCalled()
  expect(agentic.deleteDocument).not.toHaveBeenCalled()
  expect(repository.deleteDocument).not.toHaveBeenCalled()
  expect(repository.clearDocuments).not.toHaveBeenCalled()
})

it('uses scoped cleanup for a confirmed clear and never clears unseen derived indexes', async () => {
  const unseen = { ...reviewed, id: 'unseen' }
  repository.listDocuments.mockResolvedValue([reviewed, unseen])
  await clearKnowledgeRecords({ expectedDocuments: [reviewed] })
  expect(repository.clearDocuments).toHaveBeenCalledWith({ expectedDocuments: [reviewed] })
  for (const method of [hybrid.deleteDocumentEmbeddings, colbert.deleteDocument, agentic.deleteDocument]) {
    expect(method).toHaveBeenCalledTimes(1)
    expect(method).toHaveBeenCalledWith(reviewed.id, { expectedDocuments: [reviewed] })
  }
  expect(hybrid.clearEmbeddings).not.toHaveBeenCalled()
  expect(colbert.clear).not.toHaveBeenCalled()
  expect(agentic.clear).not.toHaveBeenCalled()
})

it.each(['delete', 'clear'])('rebuilds current retained indexes after a late canonical %s conflict without contacting a provider', async action => {
  const failure = new KnowledgeRepositoryConflictError()
  const method = action === 'delete' ? repository.deleteDocument : repository.clearDocuments
  method.mockRejectedValueOnce(failure)
  const operation = action === 'delete'
    ? deleteKnowledgeDocumentRecords(reviewed.id, { expectedDocument: reviewed })
    : clearKnowledgeRecords({ expectedDocuments: [reviewed] })
  await expect(operation).rejects.toBe(failure)
  expect(repository.listChunks).toHaveBeenCalledWith(reviewed.id, { signal: expect.any(AbortSignal) })
  expect(hybrid.synchronizeEmbeddings).toHaveBeenCalledWith(durableChunks, { signal: expect.any(AbortSignal) })
  expect(colbert.synchronize).toHaveBeenCalledWith(durableChunks, { signal: expect.any(AbortSignal) })
  expect(agentic.synchronize).toHaveBeenCalledWith(durableChunks, { signal: expect.any(AbortSignal) })
  expect(hybrid.synchronizeEmbeddings.mock.calls[0][1].provider).toBeUndefined()
})

it('repairs a cancelled partial index deletion with a fresh signal and retains the canonical source', async () => {
  const controller = new AbortController()
  const failure = new Error('index deletion cancelled')
  colbert.deleteDocument.mockImplementationOnce(async () => {
    controller.abort()
    throw failure
  })
  await expect(deleteKnowledgeDocumentRecords(reviewed.id, {
    expectedDocument: reviewed, signal: controller.signal,
  })).rejects.toBe(failure)
  expect(repository.deleteDocument).not.toHaveBeenCalled()
  const recoverySignal = repository.listChunks.mock.calls[0][1].signal as AbortSignal
  expect(recoverySignal).not.toBe(controller.signal)
  expect(recoverySignal.aborted).toBe(false)
  expect(hybrid.synchronizeEmbeddings).toHaveBeenCalledWith(durableChunks, { signal: recoverySignal })
})

it('retains both failures when deletion and derived-index repair fail', async () => {
  const original = new KnowledgeRepositoryConflictError()
  const recovery = new Error('repair storage failed')
  repository.deleteDocument.mockRejectedValueOnce(original)
  hybrid.synchronizeEmbeddings.mockRejectedValueOnce(recovery)
  let caught: unknown
  try { await deleteKnowledgeDocumentRecords(reviewed.id, { expectedDocument: reviewed }) }
  catch (error) { caught = error }
  expect(caught).toBeInstanceOf(AggregateError)
  expect((caught as AggregateError).errors).toEqual([original, recovery])
})

it('performs no index removal for an explicit empty confirmation', async () => {
  await clearKnowledgeRecords({ expectedDocuments: [] })
  expect(repository.clearDocuments).toHaveBeenCalledWith({ expectedDocuments: [] })
  expect(hybrid.deleteDocumentEmbeddings).not.toHaveBeenCalled()
  expect(hybrid.clearEmbeddings).not.toHaveBeenCalled()
})

it('rejects an already-cancelled full clear before any canonical or derived-index work', async () => {
  const controller = new AbortController()
  controller.abort()
  repository.clearDocuments.mockImplementationOnce(async (options: { signal: AbortSignal }) => {
    if (options.signal.aborted) {
      const error = new Error('cancelled')
      error.name = 'AbortError'
      throw error
    }
  })
  await expect(clearKnowledgeRecords({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(hybrid.clearEmbeddings).not.toHaveBeenCalled()
  expect(colbert.clear).not.toHaveBeenCalled()
  expect(agentic.clear).not.toHaveBeenCalled()
  expect(repository.clearDocuments).not.toHaveBeenCalled()
})

it('repairs a partially cancelled full index clear with current retained chunks before reporting failure', async () => {
  const controller = new AbortController()
  const failure = new Error('full index clear cancelled')
  colbert.clear.mockImplementationOnce(async () => { controller.abort(); throw failure })
  await expect(clearKnowledgeRecords({ signal: controller.signal })).rejects.toBe(failure)
  expect(repository.clearDocuments).not.toHaveBeenCalled()
  expect(hybrid.clearEmbeddings).toHaveBeenCalledWith({ signal: controller.signal })
  const recoverySignal = repository.listChunks.mock.calls[0][1].signal as AbortSignal
  expect(recoverySignal.aborted).toBe(false)
  expect(repository.listChunks).toHaveBeenCalledWith(undefined, { signal: recoverySignal })
  expect(hybrid.synchronizeEmbeddings).toHaveBeenCalledWith(durableChunks, { signal: recoverySignal })
})

it('stops later derived-index clears when the first adapter returns successfully after cancellation', async () => {
  const controller = new AbortController()
  hybrid.clearEmbeddings.mockImplementationOnce(async () => { controller.abort() })
  await expect(clearKnowledgeRecords({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(colbert.clear).not.toHaveBeenCalled()
  expect(agentic.clear).not.toHaveBeenCalled()
  expect(repository.clearDocuments).not.toHaveBeenCalled()
  const recoverySignal = repository.listChunks.mock.calls[0][1].signal as AbortSignal
  expect(recoverySignal.aborted).toBe(false)
})

it('exposes provider upgrade settlement to an import owner without blocking normal index acknowledgement', async () => {
  let finish!: () => void
  hybrid.upgradeProviderEmbeddings.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const started = jest.fn()
  const controller = new AbortController()
  const index = createKnowledgeDocumentIndex({ provider: { id: 'p', apiKey: 'fixture' } as never }, started)
  await index.synchronize(reviewed, durableChunks, { signal: controller.signal })
  expect(started).toHaveBeenCalledTimes(1)
  const pending = started.mock.calls[0][0] as Promise<void>
  let settled = false
  void pending.then(() => { settled = true })
  controller.abort()
  await Promise.resolve()
  expect(settled).toBe(false)
  expect(hybrid.upgradeProviderEmbeddings).toHaveBeenCalledWith(durableChunks, {
    provider: { id: 'p', apiKey: 'fixture' }, signal: controller.signal,
  })
  finish()
  await pending
  expect(settled).toBe(true)
})
