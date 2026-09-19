import catalog from '../assets/models/catalog.json'
import { createLocalEmbeddingModelCatalogPolicy } from '../src/modules/knowledge/application/localModelCatalogPolicy'
import { createLocalModelStateRepository } from '../src/modules/knowledge/application/localModelStateRepository'

const experimentalId = 'paraphrase-multilingual-MiniLM-L12-v2'
const standardId = 'all-MiniLM-L6-v2'

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
