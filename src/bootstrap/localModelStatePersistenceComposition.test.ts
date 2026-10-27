import {
  createLocalEmbeddingModelCatalogPolicy,
  createLocalModelStateRepository,
  LOCAL_MODEL_CATALOG_SCHEMA,
  LOCAL_MODEL_STATE_STORAGE_KEY,
  type LocalEmbeddingModelCatalogPolicy,
  type LocalModelStateRecord,
  type LocalModelStateRepository,
  type LocalModelStateRecoveryRepository,
} from '@/modules/knowledge'
import { createAsyncStorageLocalModelStateStoragePort } from '@/platform/localModels/asyncStorageLocalModelState'
import {
  deleteDownloadedLocalEmbeddingModel,
  downloadLocalEmbeddingModel,
  listLocalEmbeddingModelViews,
  reviewLocalEmbeddingModelStateRecovery,
} from './localModelRuntime'

const standardId = 'all-MiniLM-L6-v2'
const experimentalId = 'paraphrase-multilingual-MiniLM-L12-v2'
const literalPrototypeModelIds = [
  'constructor', 'toString', 'toLocaleString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
] as const
const mockInstall = jest.fn()
const mockDelete = jest.fn()
const mockRelease = jest.fn()
const mockVerifyFiles = jest.fn()
let mockRepository: LocalModelStateRecoveryRepository
let mockPolicy: ReturnType<typeof createLocalEmbeddingModelCatalogPolicy>

jest.mock('./localModelStateRepository', () => ({
  localModelStateRepository: {
    loadState: (...args: Parameters<LocalModelStateRepository['loadState']>) => mockRepository.loadState(...args),
    recordInstalledModel: (...args: Parameters<LocalModelStateRepository['recordInstalledModel']>) => mockRepository.recordInstalledModel(...args),
    markModelFailure: (...args: Parameters<LocalModelStateRepository['markModelFailure']>) => mockRepository.markModelFailure(...args),
    removeModel: (...args: Parameters<LocalModelStateRepository['removeModel']>) => mockRepository.removeModel(...args),
    clear: (...args: Parameters<LocalModelStateRepository['clear']>) => mockRepository.clear(...args),
    reviewInvalidState: (...args: Parameters<LocalModelStateRecoveryRepository['reviewInvalidState']>) => mockRepository.reviewInvalidState(...args),
  },
}))
jest.mock('./localModelCatalog', () => ({
  localEmbeddingModelCatalogPolicy: {
    requireModel: (modelId: string) => mockPolicy.requireModel(modelId),
    listModelViews: (...args: Parameters<LocalEmbeddingModelCatalogPolicy['listModelViews']>) => mockPolicy.listModelViews(...args),
  },
  localEmbeddingModels: [],
  localRagModelCapabilities: [],
}))
jest.mock('./localModelArtifactInstaller', () => ({
  LOCAL_MODEL_ROOT_DIRECTORY: 'owned-models:///',
  installLocalModelArtifacts: (...args: unknown[]) => mockInstall(...args),
  deleteInstalledLocalModelArtifacts: (...args: unknown[]) => mockDelete(...args),
}))
jest.mock('./localModelFileIntegrity', () => ({
  verifyLocalModelFiles: (...args: unknown[]) => mockVerifyFiles(...args),
}))
jest.mock('./knowledgeEmbeddingProvider', () => ({
  releaseOnnxEmbeddingResources: (...args: unknown[]) => mockRelease(...args),
}))

// Read model definitions through their bootstrap owner; file checks stay substituted.
const catalog = {
  schema: LOCAL_MODEL_CATALOG_SCHEMA,
  models: jest.requireActual<typeof import('./localModelCatalog')>('./localModelCatalog').localEmbeddingModels,
}

const installed: LocalModelStateRecord = {
  modelId: standardId, source: 'downloaded', bytes: 100,
  sha256: { 'model.onnx': '0'.repeat(64) },
}

function owner(
  raw: string | null = JSON.stringify({ records: {}, failed: {} }),
  modelCatalog: unknown = catalog,
  bundled: readonly string[] = [standardId],
) {
  const records = new Map<string, string>([
    ['@islemind/settings', '{"localEmbeddingModelId":"retained-selection","memoryEnabled":false}'],
    ['@islemind/providers', '[{"id":"retained-provider","enabled":false}]'],
  ])
  if (raw !== null) records.set(LOCAL_MODEL_STATE_STORAGE_KEY, raw)
  const settings = records.get('@islemind/settings')
  const providers = records.get('@islemind/providers')
  const adapter = {
    getItem: jest.fn(async (key: string) => records.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { records.set(key, value) }),
    removeItem: jest.fn(async (key: string) => { records.delete(key) }),
  }
  const port = createAsyncStorageLocalModelStateStoragePort(adapter)
  mockRepository = createLocalModelStateRepository(port)
  const verify = jest.fn(async () => true)
  mockPolicy = createLocalEmbeddingModelCatalogPolicy({
    catalog: modelCatalog, bundledModelIds: bundled, stateRepository: mockRepository, availability: { verify },
  })
  return {
    records, adapter, verify,
    fresh: () => createLocalModelStateRepository(port),
    assertUnrelatedData() {
      expect(records.get('@islemind/settings')).toBe(settings)
      expect(records.get('@islemind/providers')).toBe(providers)
      expect(mockVerifyFiles).not.toHaveBeenCalled()
    },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockInstall.mockReset().mockResolvedValue({ bytes: installed.bytes, sha256: installed.sha256 })
  mockDelete.mockReset().mockResolvedValue(undefined)
  mockRelease.mockReset().mockResolvedValue(undefined)
})

function expectNoRecoveryArtifacts(f: ReturnType<typeof owner>) {
  f.assertUnrelatedData()
  expect(mockInstall).not.toHaveBeenCalled()
  expect(mockDelete).not.toHaveBeenCalled()
  expect(mockRelease).not.toHaveBeenCalled()
  expect(f.adapter.setItem).not.toHaveBeenCalled()
}

function literalCatalog(modelId: string) {
  const model = catalog.models.find(candidate => candidate.id === standardId)
  if (!model) throw new Error('The owned catalog fixture requires its standard model')
  return { schema: LOCAL_MODEL_CATALOG_SCHEMA, models: [{ ...model, id: modelId, name: `Owned ${modelId}` }] }
}

it('composes an opaque reviewed reset through the actual adapter while preserving unrelated owned records and artifact ports', async () => {
  const raw = '{"schema":"future-model-state","private":"owned-composition-token"}'
  const f = owner(raw)
  f.records.set('@owned/knowledge', 'retained knowledge')
  f.records.set('@owned/memories', 'retained memories')
  f.records.set('owned-file:///model.onnx', 'retained file marker')
  const unrelated = [...f.records].filter(([key]) => key !== LOCAL_MODEL_STATE_STORAGE_KEY)
  const controller = new AbortController()
  const review = await reviewLocalEmbeddingModelStateRecovery(controller.signal)
  expect(review).not.toBeNull()
  expect(Object.isFrozen(review)).toBe(true)
  expect(JSON.stringify(review)).not.toContain('owned-composition-token')
  expect(f.adapter.removeItem).not.toHaveBeenCalled()
  expect(f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)).toBe(raw)
  await review!.reset()
  await expect(f.fresh().loadState()).resolves.toEqual({ records: {}, failed: {} })
  expect(f.adapter.removeItem).toHaveBeenCalledTimes(1)
  expect(f.adapter.removeItem).toHaveBeenCalledWith(LOCAL_MODEL_STATE_STORAGE_KEY)
  expect([...f.records].filter(([key]) => key !== LOCAL_MODEL_STATE_STORAGE_KEY)).toEqual(unrelated)
  expectNoRecoveryArtifacts(f)
})

it.each([null, '{"records":{},"failed":{}}'])('refuses destructive recovery for supported owned adapter state %s', async raw => {
  const f = owner(raw)
  await expect(reviewLocalEmbeddingModelStateRecovery()).resolves.toBeNull()
  expect(f.adapter.removeItem).not.toHaveBeenCalled()
  expectNoRecoveryArtifacts(f)
})

it('does not interpret an actual adapter read failure as consent to reset the unreadable index', async () => {
  const raw = '{"schema":"retained-invalid-state"}'
  const f = owner(raw)
  f.adapter.getItem.mockRejectedValueOnce(new Error('Owned recovery read failed'))
  await expect(reviewLocalEmbeddingModelStateRecovery()).rejects.toMatchObject({ name: 'LocalModelStatePersistenceError', operation: 'load' })
  expect(f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)).toBe(raw)
  expect(f.adapter.removeItem).not.toHaveBeenCalled()
  expectNoRecoveryArtifacts(f)
})

it('rejects changed bytes at actual adapter reset preflight without removing the replacement or any artifacts', async () => {
  const f = owner('{"schema":"reviewed-invalid-state"}')
  const review = await reviewLocalEmbeddingModelStateRecovery()
  const replacement = '{"schema":"replacement-invalid-state"}'
  f.records.set(LOCAL_MODEL_STATE_STORAGE_KEY, replacement)
  await expect(review!.reset()).rejects.toMatchObject({ name: 'LocalModelStateRecoveryConflictError' })
  expect(f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)).toBe(replacement)
  expect(f.adapter.removeItem).not.toHaveBeenCalled()
  expectNoRecoveryArtifacts(f)
})

it('rejects observed changed-and-restored owned adapter bytes instead of replaying an obsolete recovery review', async () => {
  const raw = '{"schema":"reviewed-invalid-state"}'
  const f = owner(raw)
  const review = await reviewLocalEmbeddingModelStateRecovery()
  f.records.set(LOCAL_MODEL_STATE_STORAGE_KEY, '{"schema":"observed-change"}')
  await expect(mockRepository.loadState()).rejects.toMatchObject({ name: 'LocalModelStateDataError' })
  f.records.set(LOCAL_MODEL_STATE_STORAGE_KEY, raw)
  await expect(mockRepository.loadState()).rejects.toMatchObject({ name: 'LocalModelStateDataError' })
  await expect(review!.reset()).rejects.toMatchObject({ name: 'LocalModelStateRecoveryConflictError' })
  expect(f.adapter.removeItem).not.toHaveBeenCalled()
  expectNoRecoveryArtifacts(f)
})

it('reads actual possibly committed removal effects after failure without restoring bytes or repeating the reviewed reset', async () => {
  const f = owner('{"schema":"reviewed-invalid-state"}')
  const review = await reviewLocalEmbeddingModelStateRecovery()
  f.adapter.removeItem.mockImplementationOnce(async key => {
    f.records.delete(key)
    throw new Error('Owned removal acknowledgement failed after commit')
  })
  await expect(review!.reset()).rejects.toMatchObject({ name: 'LocalModelStatePersistenceError', operation: 'remove' })
  await expect(f.fresh().loadState()).resolves.toEqual({ records: {}, failed: {} })
  await expect(review!.reset()).rejects.toMatchObject({ name: 'LocalModelStateRecoveryConflictError' })
  expect(f.adapter.removeItem).toHaveBeenCalledTimes(1)
  expectNoRecoveryArtifacts(f)
})

it('retires the original recovery lifetime before a new actual adapter reset read or removal', async () => {
  const f = owner('{"schema":"reviewed-invalid-state"}')
  const controller = new AbortController()
  const reason = new Error('Retired owned recovery lifetime')
  const review = await reviewLocalEmbeddingModelStateRecovery(controller.signal)
  controller.abort(reason)
  await expect(review!.reset({ signal: new AbortController().signal })).rejects.toBe(reason)
  expect(f.adapter.getItem).toHaveBeenCalledTimes(1)
  expect(f.adapter.removeItem).not.toHaveBeenCalled()
  expectNoRecoveryArtifacts(f)
})

it.each(['download', 'delete'] as const)('composes a real adapter read refusal before %s file or resource admission', async kind => {
  const f = owner()
  const original = f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)
  f.adapter.getItem.mockRejectedValueOnce(new Error('Owned adapter cannot read its directory'))
  const operation = kind === 'download' ? downloadLocalEmbeddingModel(standardId) : deleteDownloadedLocalEmbeddingModel(standardId)
  await expect(operation).rejects.toMatchObject({ name: 'LocalModelStatePersistenceError', operation: 'load' })
  expect(mockInstall).not.toHaveBeenCalled()
  expect(mockRelease).not.toHaveBeenCalled()
  expect(mockDelete).not.toHaveBeenCalled()
  expect(f.adapter.setItem).not.toHaveBeenCalled()
  expect(f.adapter.removeItem).not.toHaveBeenCalled()
  expect(f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)).toBe(original)
  f.assertUnrelatedData()
})

it.each(['download', 'delete'] as const)('retains unsupported persisted JSON when %s reaches the actual state repository', async kind => {
  const raw = '{"schema":"future-model-state","records":{},"failed":{}}'
  const f = owner(raw)
  const operation = kind === 'download' ? downloadLocalEmbeddingModel(standardId) : deleteDownloadedLocalEmbeddingModel(standardId)
  await expect(operation).rejects.toMatchObject({ name: 'LocalModelStateDataError' })
  expect(f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)).toBe(raw)
  expect(mockInstall).not.toHaveBeenCalled()
  expect(mockRelease).not.toHaveBeenCalled()
  expect(mockDelete).not.toHaveBeenCalled()
  expect(f.adapter.setItem).not.toHaveBeenCalled()
  f.assertUnrelatedData()
})

it('blocks actual catalog status and automatic fallback after a model-directory read failure', async () => {
  const f = owner()
  f.adapter.getItem.mockRejectedValue(new Error('Owned adapter read refusal'))
  await expect(mockPolicy.listModelViews({})).rejects.toMatchObject({ name: 'LocalModelStatePersistenceError', operation: 'load' })
  await expect(mockPolicy.resolveActiveModel({})).rejects.toMatchObject({ name: 'LocalModelStatePersistenceError', operation: 'load' })
  expect(f.verify).not.toHaveBeenCalled()
  expect(f.adapter.setItem).not.toHaveBeenCalled()
  f.assertUnrelatedData()
})

it('keeps the existing independently verified explicit selection path instead of substituting an automatic default', async () => {
  const f = owner()
  f.adapter.getItem.mockRejectedValue(new Error('Owned optional state read refusal'))
  await expect(mockPolicy.resolveActiveModel({
    localEmbeddingModelId: experimentalId, localEmbeddingModelSource: 'downloaded',
  })).resolves.toMatchObject({ model: { id: experimentalId }, source: 'downloaded', reason: 'requested' })
  expect(f.verify).toHaveBeenCalledWith(mockPolicy.requireModel(experimentalId), 'downloaded', undefined)
  expect(f.adapter.getItem).not.toHaveBeenCalled()
  expect(f.adapter.setItem).not.toHaveBeenCalled()
  f.assertUnrelatedData()
})

it('composes successful download, strict JSON save and fresh-repository status without touching unrelated preferences', async () => {
  const f = owner()
  const result = await downloadLocalEmbeddingModel(standardId)
  const saved = JSON.parse(f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)!)
  expect(saved.records[standardId]).toEqual(result)
  await expect(f.fresh().loadState()).resolves.toEqual(saved)
  await expect(mockPolicy.listModelViews({
    localEmbeddingModelId: standardId, localEmbeddingModelSource: 'downloaded',
  })).resolves.toEqual(expect.arrayContaining([expect.objectContaining({
    model: expect.objectContaining({ id: standardId }), source: 'downloaded', downloaded: true, active: true,
  })]))
  expect(mockInstall).toHaveBeenCalledTimes(1)
  f.assertUnrelatedData()
})

it('composes a saved model deletion and fresh JSON reload while preserving another installation', async () => {
  const f = owner(JSON.stringify({
    records: {
      [standardId]: installed,
      [experimentalId]: { ...installed, modelId: experimentalId },
    },
    failed: { [standardId]: 'Retained failure', [experimentalId]: 'Unrelated failure' },
  }))
  await deleteDownloadedLocalEmbeddingModel(standardId)
  await expect(f.fresh().loadState()).resolves.toEqual({
    records: { [experimentalId]: { ...installed, modelId: experimentalId } },
    failed: { [experimentalId]: 'Unrelated failure' },
  })
  expect(mockDelete).toHaveBeenCalledTimes(1)
  expect(mockRelease).toHaveBeenCalledTimes(1)
  f.assertUnrelatedData()
})

it('fails a real post-write catalog readback instead of reusing successful save cache as proof', async () => {
  const f = owner()
  await downloadLocalEmbeddingModel(standardId)
  const saved = f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)
  f.adapter.getItem.mockRejectedValueOnce(new Error('Owned post-write readback failure'))
  await expect(mockPolicy.listModelViews({
    localEmbeddingModelId: standardId, localEmbeddingModelSource: 'downloaded',
  })).rejects.toMatchObject({ name: 'LocalModelStatePersistenceError', operation: 'load' })
  expect(f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)).toBe(saved)
  expect(mockInstall).toHaveBeenCalledTimes(1)
  await expect(mockPolicy.listModelViews({})).resolves.toEqual(expect.arrayContaining([
    expect.objectContaining({ model: expect.objectContaining({ id: standardId }), downloaded: true }),
  ]))
  expect(mockInstall).toHaveBeenCalledTimes(1)
  f.assertUnrelatedData()
})

it('retains possible committed JSON after acknowledgement failure without repeating artifact installation', async () => {
  const f = owner()
  f.adapter.setItem.mockImplementationOnce(async (key, value) => {
    f.records.set(key, value)
    throw new Error('Owned adapter acknowledgement failed')
  })
  await expect(downloadLocalEmbeddingModel(standardId)).rejects.toMatchObject({ name: 'LocalModelStatePersistenceError', operation: 'save' })
  await expect(f.fresh().loadState()).resolves.toMatchObject({ records: { [standardId]: installed } })
  expect(mockInstall).toHaveBeenCalledTimes(1)
  f.assertUnrelatedData()
})

it('uses the actual storage adapter abort fence before any model-directory read', async () => {
  const f = owner()
  const controller = new AbortController()
  const reason = new Error('Retired before actual adapter')
  controller.abort(reason)
  await expect(mockRepository.loadState({ signal: controller.signal })).rejects.toBe(reason)
  expect(f.adapter.getItem).not.toHaveBeenCalled()
  f.assertUnrelatedData()
})

describe('literal local-model catalog bootstrap', () => {
  it.each(literalPrototypeModelIds)('projects absent %s metadata through the real adapter, repository, policy and runtime bridge', async modelId => {
    const raw = '{"records":{},"failed":{}}'
    const f = owner(raw, literalCatalog(modelId), [])
    const signal = new AbortController().signal
    await expect(listLocalEmbeddingModelViews({
      localEmbeddingModelId: modelId, localEmbeddingModelSource: 'none',
    }, signal)).resolves.toEqual([
      expect.objectContaining({
        model: expect.objectContaining({ id: modelId }),
        status: 'not-downloaded', source: 'none', downloaded: false, bundled: false, active: false,
      }),
    ])
    await expect(f.fresh().loadState()).resolves.toEqual({ records: {}, failed: {} })
    expect(f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)).toBe(raw)
    expect(f.adapter.removeItem).not.toHaveBeenCalled()
    expect(f.verify).not.toHaveBeenCalled()
    expectNoRecoveryArtifacts(f)
  })

  it('composes literal installation hash metadata and fresh status after clearing only its own stored failure', async () => {
    const modelId = 'constructor'
    const other = { ...installed, modelId: 'unseen-model' }
    const f = owner(JSON.stringify({
      records: { 'unseen-model': other },
      failed: { constructor: 'Owned prior verification failure', 'unseen-model': 'Owned retained failure' },
    }), literalCatalog(modelId), [])
    const hashes = Object.fromEntries([
      ['__proto__', '0'.repeat(64)], ['constructor', '1'.repeat(64)], ['toString', '2'.repeat(64)],
    ])
    mockInstall.mockResolvedValueOnce({ bytes: 100, sha256: hashes })
    const result = await downloadLocalEmbeddingModel(modelId)
    const saved = JSON.parse(f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)!)
    expect(Object.hasOwn(saved.records, modelId)).toBe(true)
    expect(Object.hasOwn(saved.records[modelId].sha256, '__proto__')).toBe(true)
    expect(saved.records[modelId]).toEqual(result)
    expect(saved.records['unseen-model']).toEqual(other)
    expect(saved.failed).toEqual({ 'unseen-model': 'Owned retained failure' })
    await expect(f.fresh().loadState()).resolves.toEqual(saved)
    await expect(listLocalEmbeddingModelViews({})).resolves.toEqual([
      expect.objectContaining({ model: expect.objectContaining({ id: modelId }), status: 'downloaded', downloaded: true }),
    ])
    expect(mockInstall).toHaveBeenCalledTimes(1)
    expect(mockDelete).not.toHaveBeenCalled()
    expect(mockRelease).not.toHaveBeenCalled()
    expect(f.adapter.setItem).toHaveBeenCalledTimes(1)
    expect(f.adapter.removeItem).not.toHaveBeenCalled()
    f.assertUnrelatedData()
  })

  it('composes literal deletion and truthful absent status without removing another owned installation or failure', async () => {
    const modelId = 'constructor'
    const other = { ...installed, modelId: 'unseen-model' }
    const f = owner(JSON.stringify({
      records: { constructor: { ...installed, modelId }, 'unseen-model': other },
      failed: { constructor: 'Owned prior verification failure', 'unseen-model': 'Owned retained failure' },
    }), literalCatalog(modelId), [])
    await deleteDownloadedLocalEmbeddingModel(modelId)
    await expect(f.fresh().loadState()).resolves.toEqual({
      records: { 'unseen-model': other }, failed: { 'unseen-model': 'Owned retained failure' },
    })
    await expect(listLocalEmbeddingModelViews({})).resolves.toEqual([
      expect.objectContaining({ model: expect.objectContaining({ id: modelId }), status: 'not-downloaded', downloaded: false }),
    ])
    expect(mockDelete).toHaveBeenCalledTimes(1)
    expect(mockRelease).toHaveBeenCalledTimes(1)
    expect(mockInstall).not.toHaveBeenCalled()
    expect(f.adapter.setItem).toHaveBeenCalledTimes(1)
    expect(f.adapter.removeItem).not.toHaveBeenCalled()
    f.assertUnrelatedData()
  })

  it('keeps an actual literal failure visible through the runtime bridge without admitting file or metadata effects', async () => {
    const modelId = 'constructor'
    const raw = JSON.stringify({ records: {}, failed: { constructor: 'Owned persisted failure' } })
    const f = owner(raw, literalCatalog(modelId), [])
    await expect(listLocalEmbeddingModelViews({})).resolves.toEqual([
      expect.objectContaining({ model: expect.objectContaining({ id: modelId }), status: 'verify-failed', active: false }),
    ])
    expect(f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)).toBe(raw)
    expect(f.adapter.removeItem).not.toHaveBeenCalled()
    expect(f.verify).not.toHaveBeenCalled()
    expectNoRecoveryArtifacts(f)
  })

  it('refuses actual scalar-hash adapter bytes before the runtime bridge projects any catalog or default', async () => {
    const modelId = 'constructor'
    const raw = JSON.stringify({ records: { constructor: { ...installed, modelId, sha256: '0'.repeat(64) } }, failed: {} })
    const f = owner(raw, literalCatalog(modelId), [])
    await expect(listLocalEmbeddingModelViews({})).rejects.toMatchObject({ name: 'LocalModelStateDataError' })
    expect(f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)).toBe(raw)
    expect(f.adapter.removeItem).not.toHaveBeenCalled()
    expect(f.verify).not.toHaveBeenCalled()
    expectNoRecoveryArtifacts(f)
  })
})

describe('empty-message failure persistence and catalog status', () => {
  it.each([standardId, 'constructor'])('projects a newly persisted empty-message %s failure through the real adapter and runtime', async modelId => {
    const f = owner(undefined, literalCatalog(modelId), [])
    await mockRepository.markModelFailure(modelId, '')
    const saved = f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)
    const reloaded = await f.fresh().loadState()
    expect(Object.hasOwn(reloaded.failed, modelId)).toBe(true)
    expect(reloaded.failed[modelId]).toBe('')
    await expect(listLocalEmbeddingModelViews({})).resolves.toEqual([
      expect.objectContaining({
        model: expect.objectContaining({ id: modelId }),
        status: 'verify-failed', source: 'none', downloaded: false, active: false,
      }),
    ])
    expect(f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)).toBe(saved)
    expect(f.adapter.setItem).toHaveBeenCalledTimes(1)
    expect(f.adapter.removeItem).not.toHaveBeenCalled()
    expect(f.verify).not.toHaveBeenCalled()
    expect(mockInstall).not.toHaveBeenCalled()
    expect(mockDelete).not.toHaveBeenCalled()
    expect(mockRelease).not.toHaveBeenCalled()
    f.assertUnrelatedData()
  })

  it.each(['', 'Owned persisted failure'])('clears only its own persisted %j failure on supported installation metadata readback', async message => {
    const modelId = 'constructor'
    const record = { ...installed, modelId }
    const f = owner(JSON.stringify({
      records: { constructor: record },
      failed: { constructor: message, 'unseen-model': '' },
    }), literalCatalog(modelId), [])
    const original = f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)
    await expect(listLocalEmbeddingModelViews({})).resolves.toEqual([
      expect.objectContaining({ status: 'verify-failed', source: 'downloaded', downloaded: true, active: false }),
    ])
    expect(f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)).toBe(original)
    expect(f.adapter.setItem).not.toHaveBeenCalled()
    await mockRepository.recordInstalledModel(record)
    const saved = f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)
    await expect(f.fresh().loadState()).resolves.toEqual({
      records: { constructor: record }, failed: { 'unseen-model': '' },
    })
    await expect(listLocalEmbeddingModelViews({})).resolves.toEqual([
      expect.objectContaining({ status: 'downloaded', source: 'downloaded', downloaded: true, active: false }),
    ])
    expect(f.records.get(LOCAL_MODEL_STATE_STORAGE_KEY)).toBe(saved)
    expect(f.adapter.setItem).toHaveBeenCalledTimes(1)
    expect(f.adapter.removeItem).not.toHaveBeenCalled()
    expect(f.verify).not.toHaveBeenCalled()
    expect(mockInstall).not.toHaveBeenCalled()
    expect(mockDelete).not.toHaveBeenCalled()
    expect(mockRelease).not.toHaveBeenCalled()
    f.assertUnrelatedData()
  })
})
