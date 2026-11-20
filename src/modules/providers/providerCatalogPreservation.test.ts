import type { AIProvider } from '@/types/providerContracts'
import { getModelConfig } from '@/types/modelCatalog'
import { chooseCredentialForModel, mergeCredentialModelAvailability, normalizeProviderCredentialGroups, runCredentialGroupModelSync } from './providerCredentialGroups'
import { buildProviderModelConfigsForStorage, hasRedundantProviderModelStorage, normalizeProviderModelsForStorage } from '@/utils/providerModelStorage'

const models = Array.from({ length: 1200 }, (_, i) => `catalog-model-${String(i).padStart(4, '0')}`)
const fixture = (): AIProvider => ({
  id: 'catalog', name: 'Catalog', type: 'openai-compatible', enabled: true, apiKey: '',
  models, manualModels: [], enabledModels: [models[1199]], lastModelSyncStatus: 'ok',
  credentialGroups: [
    { id: 'a', label: 'A', apiKey: 'synthetic-a', enabled: true, availableModels: models, lastModelSyncStatus: 'ok', lastModelSyncAt: 10 },
    { id: 'b', label: 'B', apiKey: 'synthetic-b', enabled: true, availableModels: [models[0], models[1199]], lastModelSyncStatus: 'ok', lastModelSyncAt: 20 },
  ],
})

it('retains full key catalogs and every owner of models beyond the old index limit', () => {
  const provider = normalizeProviderCredentialGroups(fixture())
  expect(provider.credentialGroups![0].availableModels).toEqual(models)
  expect(provider.modelAvailability).toHaveLength(1200)
  for (const modelId of [models[0], models[1199]]) {
    expect(provider.modelAvailability!.find(item => item.modelId === modelId)).toEqual({
      modelId, credentialGroupIds: ['a', 'b'], lastSyncedAt: 20,
    })
  }
  expect(chooseCredentialForModel(provider, models[1199], { excludedCredentialGroupIds: ['a'] })).toMatchObject({ credentialGroupId: 'b', apiKey: 'synthetic-b' })
  const alias = { ...provider, modelAliases: [{ alias: 'tail-alias', model: models[1199] }], enabledModels: ['tail-alias'] }
  expect(chooseCredentialForModel(alias, 'tail-alias', { targetCredentialGroupId: 'b' }).credentialGroupId).toBe('b')
})

it('deduplicates trimmed IDs per owner without merging case-distinct upstream IDs or adding disabled keys', () => {
  const groups = fixture().credentialGroups!
  groups[0].availableModels = [' alpha ', 'alpha', 'Alpha', '']
  groups[1].enabled = false
  expect(mergeCredentialModelAvailability(groups)).toEqual(expect.arrayContaining([
    { modelId: 'alpha', credentialGroupIds: ['a'], lastSyncedAt: 10 },
    { modelId: 'Alpha', credentialGroupIds: ['a'], lastSyncedAt: 10 },
  ]))
  expect(mergeCredentialModelAvailability(groups)).toHaveLength(2)
})

it('discovers and counts the full catalog, including metadata at its tail', async () => {
  const provider = fixture()
  const result = await runCredentialGroupModelSync(provider, {
    delay: () => undefined, now: () => 30,
    fetchModels: async (_provider, group) => (group.id === 'a' ? models : [models[1199]]).map(id => ({
      ...getModelConfig(id, provider.type), name: `Remote ${id}`, contextWindow: 196608,
    })),
  })
  expect(result.models).toHaveLength(1200)
  expect(result.credentialGroups![0].availableModels).toHaveLength(1200)
  expect(result.credentialGroups![0].lastModelSyncMessage).toBe('1200 models fetched')
  expect(result.modelConfigs!.find(config => config.id === models[1199])).toMatchObject({ name: `Remote ${models[1199]}`, contextWindow: 196608 })
  expect(result.modelAvailability!.find(item => item.modelId === models[1199])!.credentialGroupIds).toEqual(['a', 'b'])
  expect(result.enabledModels).toEqual([models[1199]])
})

it('retains failed and disabled key catalogs and metadata during another key refresh', async () => {
  const provider = fixture()
  provider.credentialGroups![0].availableModels = ['cached-failed']
  provider.credentialGroups!.push({ id: 'off', label: 'Off', apiKey: 'unused', enabled: false, availableModels: ['cached-disabled'], lastModelSyncStatus: 'ok' })
  provider.modelConfigs = ['cached-failed', 'cached-disabled'].map(id => ({ ...getModelConfig(id, provider.type), contextWindow: 196608 }))
  const fetchModels = jest.fn(async (_source: AIProvider, group: { id: string }) => {
    if (group.id === 'a') throw new Error('Synthetic refresh failure')
    return [{ id: 'new-model', name: 'New', provider: provider.type }]
  })
  const result = await runCredentialGroupModelSync(provider, { fetchModels, delay: () => undefined })
  expect(fetchModels).toHaveBeenCalledTimes(2)
  expect(new Set(result.models)).toEqual(new Set(['cached-failed', 'cached-disabled', 'new-model']))
  expect(result.modelConfigs!.filter(model => model.id.startsWith('cached-')).map(model => model.contextWindow)).toEqual([196608, 196608])
  expect(result.modelAvailability!.map(item => item.modelId)).not.toContain('cached-disabled')
  expect(result.credentialGroups![0].lastModelSyncStatus).toBe('bad')
})

it('does not count an old success on a disabled key as a successful refresh', async () => {
  const provider = fixture()
  provider.credentialGroups![1].enabled = false
  const result = await runCredentialGroupModelSync(provider, { fetchModels: async () => { throw new Error('offline') }, delay: () => undefined })
  expect(result.lastModelSyncStatus).toBe('bad')
  expect(result.models).toEqual(models)
})

it('clears an explicitly empty successful catalog without reviving its previous contents', async () => {
  const provider = fixture()
  const result = await runCredentialGroupModelSync(provider, { fetchModels: async () => [], delay: () => undefined })
  expect(result.models).toEqual([])
  expect(result.modelConfigs).toEqual([])
  expect(result.modelAvailability).toEqual([])
  expect(result.enabledModels).toEqual([models[1199]])
})

it('keeps full storage, dormant metadata and aliases while compacting only duplicates', () => {
  const provider = fixture()
  provider.modelConfigs = [...models, 'dormant-model'].map(id => ({ ...getModelConfig(id, provider.type), contextWindow: 196608 }))
  provider.modelAliases = [{ alias: 'tail-alias', model: models[1199] }]
  expect(hasRedundantProviderModelStorage(provider)).toBe(false)
  const storedModels = normalizeProviderModelsForStorage(provider)
  const storedConfigs = buildProviderModelConfigsForStorage(provider, storedModels, [], provider.modelAliases)
  expect(storedModels).toHaveLength(models.length)
  expect(new Set(storedModels)).toEqual(new Set(models))
  expect(storedConfigs).toHaveLength(1201)
  expect(storedConfigs.find(config => config.id === models[1199])!.contextWindow).toBe(196608)
  expect(storedConfigs.find(config => config.id === 'dormant-model')!.contextWindow).toBe(196608)
  const duplicated = { ...provider, models: [...models, models[0], ' '] }
  expect(hasRedundantProviderModelStorage(duplicated)).toBe(true)
  expect(normalizeProviderModelsForStorage(duplicated)).toEqual(storedModels)
})
