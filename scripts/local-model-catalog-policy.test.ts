import catalog from '../assets/models/catalog.json'
import { createLocalEmbeddingModelCatalogPolicy, LOCAL_MODEL_CATALOG_SCHEMA } from '../src/modules/knowledge/application/localModelCatalogPolicy'
import {
  createLocalModelStateRepository,
  type LocalModelStateRecord,
  type LocalModelStateSnapshot,
} from '../src/modules/knowledge/application/localModelStateRepository'

const experimentalId = 'paraphrase-multilingual-MiniLM-L12-v2'
const standardId = 'all-MiniLM-L6-v2'
const literalPrototypeModelIds = [
  'constructor',
  'toString',
  'toLocaleString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
] as const

function literalRecord(modelId: string): LocalModelStateRecord {
  return {
    modelId, source: 'downloaded', downloadedAt: 10, verifiedAt: 20, bytes: 100,
    sha256: { 'model.onnx': '0'.repeat(64) },
  }
}

function literalSetup(
  modelIds: readonly string[],
  initialState: LocalModelStateSnapshot | string = { records: {}, failed: {} },
) {
  const base = catalog.models.find(model => model.id === standardId)
  if (!base) throw new Error('The owned catalog fixture requires its standard model')
  let raw: string | null = typeof initialState === 'string' ? initialState : JSON.stringify(initialState)
  const storage = {
    getItem: jest.fn(async () => raw),
    setItem: jest.fn(async (_key: string, value: string) => { raw = value }),
    removeItem: jest.fn(async () => { raw = null }),
  }
  const stateRepository = createLocalModelStateRepository(storage)
  const verify = jest.fn(async () => true)
  const policy = createLocalEmbeddingModelCatalogPolicy({
    catalog: {
      schema: LOCAL_MODEL_CATALOG_SCHEMA,
      models: modelIds.map(modelId => ({ ...base, id: modelId, name: `Owned ${modelId}` })),
    },
    bundledModelIds: [],
    stateRepository,
    availability: { verify },
  })
  return {
    policy, stateRepository, verify, storage, raw: () => raw,
    assertReadOnly(original: string | null) {
      expect(raw).toBe(original)
      expect(storage.setItem).not.toHaveBeenCalled()
      expect(storage.removeItem).not.toHaveBeenCalled()
    },
  }
}

function setup(installed: string[], bundled: string[] = []) {
  const verify = jest.fn(async () => true)
  const records = Object.fromEntries(installed.map(modelId => [modelId, { modelId, source: 'downloaded' }]))
  const stateRepository = createLocalModelStateRepository({
    getItem: async () => JSON.stringify({ records, failed: {} }),
    setItem: async () => undefined,
    removeItem: async () => undefined,
  })
  const policy = createLocalEmbeddingModelCatalogPolicy({ catalog, bundledModelIds: bundled, stateRepository, availability: { verify } })
  return { policy, verify }
}

test('the multilingual model is explicitly experimental and excluded from default APK variants', () => {
  const { policy } = setup([])
  expect(policy.requireModel(experimentalId).experimental).toBe(true)
  expect(catalog.variants['no-model'].bundledModels).toEqual([])
  expect(catalog.variants['with-model-small'].bundledModels).toEqual([standardId])
})

test('downloaded experimental models are not even verified during automatic fallback', async () => {
  const { policy, verify } = setup([experimentalId])
  await expect(policy.resolveActiveModel({})).resolves.toBeNull()
  expect(verify).not.toHaveBeenCalled()
})

test('automatic fallback selects an available standard model', async () => {
  const { policy, verify } = setup([experimentalId, standardId])
  const selection = await policy.resolveActiveModel({})
  expect(selection).toMatchObject({ model: { id: standardId }, reason: 'downloaded-fallback' })
  expect(verify).toHaveBeenCalledTimes(1)
  expect(verify).toHaveBeenCalledWith(policy.requireModel(standardId), 'downloaded', undefined)
})

test('experimental models require explicit model and source selection', async () => {
  const { policy, verify } = setup([experimentalId])
  await expect(policy.resolveActiveModel({ localEmbeddingModelId: experimentalId })).resolves.toBeNull()
  expect(verify).not.toHaveBeenCalled()
  await expect(policy.resolveActiveModel({ localEmbeddingModelId: experimentalId, localEmbeddingModelSource: 'downloaded' }))
    .resolves.toMatchObject({ model: { id: experimentalId }, source: 'downloaded', reason: 'requested' })
})

test('experimental models cannot enter automatic fallback through bundle metadata', async () => {
  const { policy, verify } = setup([], [experimentalId])
  await expect(policy.resolveActiveModel({ localEmbeddingModelId: 'missing-model', localEmbeddingModelSource: 'downloaded' })).resolves.toBeNull()
  expect(verify).not.toHaveBeenCalled()
})

test('failed explicit experimental selection falls back only to a verified standard model', async () => {
  const { policy, verify } = setup([experimentalId, standardId])
  verify.mockResolvedValueOnce(false)
  await expect(policy.resolveActiveModel({ localEmbeddingModelId: experimentalId, localEmbeddingModelSource: 'downloaded' }))
    .resolves.toMatchObject({ model: { id: standardId }, reason: 'downloaded-fallback' })
  expect(verify).toHaveBeenCalledTimes(2)
})

test('cancellation still prevents all model verification', async () => {
  const { policy, verify } = setup([experimentalId, standardId])
  const controller = new AbortController()
  controller.abort()
  await expect(policy.resolveActiveModel({}, { signal: controller.signal })).rejects.toThrow()
  expect(verify).not.toHaveBeenCalled()
})

describe('literal local-model catalog keys', () => {
  test.each(literalPrototypeModelIds)('does not fabricate a persisted failure for absent %s', async modelId => {
    const f = literalSetup([modelId])
    const original = f.raw()
    expect(f.policy.requireModel(modelId).id).toBe(modelId)
    await expect(f.policy.listModelViews({})).resolves.toEqual([
      expect.objectContaining({
        model: expect.objectContaining({ id: modelId }),
        status: 'not-downloaded', source: 'none', downloaded: false, bundled: false, active: false,
      }),
    ])
    await expect(f.policy.resolveActiveModel({})).resolves.toBeNull()
    expect(f.verify).not.toHaveBeenCalled()
    f.assertReadOnly(original)
  })

  test.each(literalPrototypeModelIds)('projects a saved %s installation after its own failure is absent', async modelId => {
    const record = literalRecord(modelId)
    const f = literalSetup([modelId], { records: Object.fromEntries([[modelId, record]]), failed: {} })
    const original = f.raw()
    await expect(f.policy.listModelViews({})).resolves.toEqual([
      expect.objectContaining({
        model: expect.objectContaining({ id: modelId }), status: 'downloaded',
        source: 'downloaded', downloaded: true, active: false, bytes: record.bytes,
      }),
    ])
    await expect(f.policy.resolveActiveModel({})).resolves.toMatchObject({
      model: { id: modelId }, source: 'downloaded', reason: 'downloaded-fallback',
    })
    expect(f.verify).toHaveBeenCalledWith(f.policy.requireModel(modelId), 'downloaded', undefined)
    f.assertReadOnly(original)
  })

  test.each(literalPrototypeModelIds)('keeps the actual own %s failure visible instead of discarding it', async modelId => {
    const f = literalSetup([modelId], {
      records: {}, failed: Object.fromEntries([[modelId, 'Owned persisted verification failure']]),
    })
    const original = f.raw()
    await expect(f.policy.listModelViews({})).resolves.toEqual([
      expect.objectContaining({ model: expect.objectContaining({ id: modelId }), status: 'verify-failed', active: false }),
    ])
    const state = await f.stateRepository.loadState()
    const reconciled = f.policy.reconcileInstalledState(state)
    expect(Object.hasOwn(reconciled.failed, modelId)).toBe(true)
    expect(reconciled.failed[modelId]).toBe('Owned persisted verification failure')
    expect(f.verify).not.toHaveBeenCalled()
    f.assertReadOnly(original)
  })

  test.each(['plain', 'null-prototype'] as const)('detaches literal file hashes from %s input through real persistence and reconciliation', async prototype => {
    const f = literalSetup(['constructor'])
    const hashes = Object.fromEntries([
      ['__proto__', '0'.repeat(64)], ['constructor', '1'.repeat(64)], ['toString', '2'.repeat(64)],
    ])
    if (prototype === 'null-prototype') Object.setPrototypeOf(hashes, null)
    const record = { ...literalRecord('constructor'), sha256: hashes }
    await f.stateRepository.recordInstalledModel(record)
    const saved = f.raw()
    const state = await f.stateRepository.loadState()
    const reconciled = f.policy.reconcileInstalledState(state)
    const copied = reconciled.records[record.modelId].sha256!
    expect(Object.keys(copied).sort()).toEqual(['__proto__', 'constructor', 'toString'].sort())
    expect(Object.hasOwn(copied, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(copied)).toBe(Object.prototype)
    expect(copied).toEqual(hashes)
    expect(copied).not.toBe(state.records[record.modelId].sha256)
    copied.__proto__ = 'f'.repeat(64)
    expect(state.records[record.modelId].sha256!.__proto__).toBe('0'.repeat(64))
    await expect(f.stateRepository.loadState()).resolves.toMatchObject({
      records: { constructor: { sha256: { ['__proto__']: '0'.repeat(64), constructor: '1'.repeat(64), toString: '2'.repeat(64) } } },
    })
    expect(f.raw()).toBe(saved)
    expect(f.storage.setItem).toHaveBeenCalledTimes(1)
    expect(f.storage.removeItem).not.toHaveBeenCalled()
  })

  test('refuses a scalar hash before reconciliation rather than spreading it into indexed metadata', async () => {
    const raw = JSON.stringify({
      records: { constructor: { ...literalRecord('constructor'), sha256: '0'.repeat(64) } }, failed: {},
    })
    const f = literalSetup(['constructor'], raw)
    await expect(f.policy.listModelViews({})).rejects.toMatchObject({ name: 'LocalModelStateDataError' })
    expect(f.verify).not.toHaveBeenCalled()
    f.assertReadOnly(raw)
  })

  test('filters literal orphan ids without deleting their actual persisted records or failures', async () => {
    const f = literalSetup(['constructor'], {
      records: Object.fromEntries([['__proto__', literalRecord('__proto__')], ['unseen-model', literalRecord('unseen-model')]]),
      failed: Object.fromEntries([['__proto__', 'Owned literal orphan'], ['unseen-model', 'Owned unseen failure']]),
    })
    const original = f.raw()
    const reconciled = f.policy.reconcileInstalledState(await f.stateRepository.loadState())
    expect(Object.keys(reconciled.records)).toEqual([])
    expect(Object.keys(reconciled.failed)).toEqual([])
    expect(reconciled.installedModelIds).toEqual([])
    expect(reconciled.orphanedModelIds).toEqual(['__proto__', 'unseen-model'])
    f.assertReadOnly(original)
  })

  test('retains independently verified explicit literal selection without loading or saving an automatic default', async () => {
    const f = literalSetup(['constructor'])
    const original = f.raw()
    const preference = { localEmbeddingModelId: 'constructor', localEmbeddingModelSource: 'downloaded' as const }
    await expect(f.policy.resolveActiveModel(preference)).resolves.toMatchObject({
      model: { id: 'constructor' }, source: 'downloaded', reason: 'requested',
    })
    expect(preference).toEqual({ localEmbeddingModelId: 'constructor', localEmbeddingModelSource: 'downloaded' })
    expect(f.storage.getItem).not.toHaveBeenCalled()
    expect(f.verify).toHaveBeenCalledTimes(1)
    f.assertReadOnly(original)
  })

  test('keeps the existing catalog id grammar instead of admitting an invalid prototype setter id', () => {
    expect(() => literalSetup(['__proto__'])).toThrow()
  })
})

describe('persisted local-model failure presence', () => {
  test.each([standardId, ...literalPrototypeModelIds])('keeps an own empty-message %s failure visible after a real state read', async modelId => {
    const f = literalSetup([modelId], { records: {}, failed: Object.fromEntries([[modelId, '']]) })
    const original = f.raw()
    const state = await f.stateRepository.loadState()
    expect(Object.hasOwn(state.failed, modelId)).toBe(true)
    expect(state.failed[modelId]).toBe('')
    await expect(f.policy.listModelViews({})).resolves.toEqual([
      expect.objectContaining({
        model: expect.objectContaining({ id: modelId }),
        status: 'verify-failed', source: 'none', downloaded: false, bundled: false, active: false,
      }),
    ])
    expect(f.verify).not.toHaveBeenCalled()
    f.assertReadOnly(original)
  })

  test.each([standardId, 'constructor'])('keeps an own empty-message %s failure visible over downloaded status', async modelId => {
    const f = literalSetup([modelId], {
      records: Object.fromEntries([[modelId, literalRecord(modelId)]]),
      failed: Object.fromEntries([[modelId, '']]),
    })
    const original = f.raw()
    await expect(f.policy.listModelViews({})).resolves.toEqual([
      expect.objectContaining({ status: 'verify-failed', source: 'downloaded', downloaded: true, active: false }),
    ])
    expect(f.verify).not.toHaveBeenCalled()
    f.assertReadOnly(original)
  })

  test('keeps an own empty-message failure visible over bundled status', async () => {
    const f = literalSetup([standardId], { records: {}, failed: { [standardId]: '' } })
    const original = f.raw()
    const policy = createLocalEmbeddingModelCatalogPolicy({
      catalog: { schema: LOCAL_MODEL_CATALOG_SCHEMA, models: f.policy.models },
      bundledModelIds: [standardId], stateRepository: f.stateRepository, availability: { verify: f.verify },
    })
    await expect(policy.listModelViews({})).resolves.toEqual([
      expect.objectContaining({ status: 'verify-failed', source: 'bundled', bundled: true, active: false }),
    ])
    expect(f.verify).not.toHaveBeenCalled()
    f.assertReadOnly(original)
  })

  test.each(['downloaded', 'bundled'] as const)('retains active %s status precedence over an own empty-message failure', async source => {
    const f = literalSetup([standardId], {
      records: { [standardId]: literalRecord(standardId) }, failed: { [standardId]: '' },
    })
    const original = f.raw()
    await expect(f.policy.listModelViews({ localEmbeddingModelId: standardId, localEmbeddingModelSource: source }))
      .resolves.toEqual([expect.objectContaining({ status: 'enabled', source, active: true })])
    expect(f.verify).not.toHaveBeenCalled()
    f.assertReadOnly(original)
  })

  test('retains planned status precedence over an own empty-message failure and saved selection', async () => {
    const f = literalSetup([standardId], { records: {}, failed: { [standardId]: '' } })
    const original = f.raw()
    const policy = createLocalEmbeddingModelCatalogPolicy({
      catalog: {
        schema: LOCAL_MODEL_CATALOG_SCHEMA,
        models: [{ ...f.policy.requireModel(standardId), files: [], sizeBytes: 0 }],
      },
      bundledModelIds: [], stateRepository: f.stateRepository, availability: { verify: f.verify },
    })
    await expect(policy.listModelViews({ localEmbeddingModelId: standardId, localEmbeddingModelSource: 'downloaded' }))
      .resolves.toEqual([expect.objectContaining({ status: 'planned', active: false })])
    expect(f.verify).not.toHaveBeenCalled()
    f.assertReadOnly(original)
  })

  test('does not change independently verified automatic fallback because an own failure message is empty', async () => {
    const f = literalSetup([standardId], {
      records: { [standardId]: literalRecord(standardId) }, failed: { [standardId]: '' },
    })
    const original = f.raw()
    await expect(f.policy.resolveActiveModel({})).resolves.toMatchObject({
      model: { id: standardId }, source: 'downloaded', reason: 'downloaded-fallback',
    })
    expect(f.verify).toHaveBeenCalledTimes(1)
    expect(f.verify).toHaveBeenCalledWith(f.policy.requireModel(standardId), 'downloaded', undefined)
    f.assertReadOnly(original)
  })
})
