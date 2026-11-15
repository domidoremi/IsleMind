import type { AIProvider } from '@/types/providerContracts'
import { mergeModelConfig } from '@/types/modelCatalog'
import { runCredentialGroupModelSync } from './providerCredentialGroups'

function fixture(): AIProvider {
  return {
    id: 'owned-catalog-retention', name: 'Owned catalog retention', type: 'openai', enabled: true,
    apiKey: '', models: ['owned-old-a', 'owned-cached-b'],
    modelConfigs: [
      mergeModelConfig('owned-old-a', 'openai', { name: 'Old A' }),
      mergeModelConfig('owned-cached-b', 'openai', {
        name: 'Cached B', contextWindow: 245760, maxOutputTokens: 32768,
        outputTokenLimit: { tokens: 32768, source: 'provider' }, defaultMaxTokens: 8192, supportsVision: true, supportsTools: true,
      }),
    ],
    credentialGroups: [
      { id: 'owned-a', label: 'A', apiKey: 'owned-catalog-key-a', enabled: true,
        availableModels: ['owned-old-a'], lastModelSyncStatus: 'ok' },
      { id: 'owned-b', label: 'B', apiKey: 'owned-catalog-key-b', enabled: true,
        availableModels: ['owned-cached-b'], lastModelSyncStatus: 'ok' },
    ],
  }
}

it.each(['failed', 'disabled'] as const)(
  'retains a %s key’s cached catalog and model metadata when another key refreshes',
  async state => {
    const provider = fixture()
    if (state === 'disabled') provider.credentialGroups![1].enabled = false
    const before = structuredClone(provider)
    const fetchModels = jest.fn(async (_provider, group) => {
      if (group.id === 'owned-b') throw new Error('owned-catalog-unavailable')
      return [{ id: 'owned-new-a', name: 'New A', provider: 'openai' as const }]
    })
    const result = await runCredentialGroupModelSync(provider, {
      fetchModels, delay: async () => {}, now: () => 2000,
    })
    expect(new Set(result.models)).toEqual(new Set(['owned-new-a', 'owned-cached-b']))
    expect(result.modelConfigs?.find(model => model.id === 'owned-cached-b')).toMatchObject({
      name: 'Cached B', contextWindow: 245760, maxOutputTokens: 32768,
      outputTokenLimit: { tokens: 32768, source: 'provider' }, defaultMaxTokens: 8192, supportsVision: true, supportsTools: true,
    })
    expect(result.credentialGroups![1]).toMatchObject({
      availableModels: ['owned-cached-b'], enabled: state !== 'disabled',
      lastModelSyncStatus: state === 'failed' ? 'bad' : 'ok',
    })
    expect(result.modelAvailability?.find(model => model.modelId === 'owned-cached-b')?.credentialGroupIds)
      .toEqual(state === 'failed' ? ['owned-b'] : undefined)
    expect(fetchModels).toHaveBeenCalledTimes(state === 'failed' ? 2 : 1)
    expect(provider).toEqual(before)
  },
)

it('retains a disabled key’s cached model when its detailed model metadata is absent', async () => {
  const provider = fixture()
  provider.credentialGroups![1].enabled = false
  provider.modelConfigs = provider.modelConfigs!.filter(model => model.id !== 'owned-cached-b')
  const result = await runCredentialGroupModelSync(provider, {
    fetchModels: async () => [{ id: 'owned-new-a', name: 'New A', provider: 'openai' }],
    delay: async () => {},
  })
  expect(result.models).toContain('owned-cached-b')
  expect(result.modelConfigs?.find(model => model.id === 'owned-cached-b')).toMatchObject({
    id: 'owned-cached-b', provider: 'openai',
  })
})

it('keeps fresh successful metadata for a model also cached by a failed key', async () => {
  const provider = fixture()
  provider.credentialGroups![1].availableModels = ['owned-shared']
  provider.models = ['owned-old-a', 'owned-shared']
  provider.modelConfigs = [
    provider.modelConfigs![0],
    mergeModelConfig('owned-shared', 'openai', { name: 'Cached shared', supportsVision: true }),
  ]
  const result = await runCredentialGroupModelSync(provider, {
    fetchModels: async (_provider, group) => {
      if (group.id === 'owned-b') throw new Error('owned-catalog-unavailable')
      return [mergeModelConfig('owned-shared', 'openai', { name: 'Fresh shared', supportsVision: false })]
    },
    delay: async () => {},
  })
  expect(result.models).toEqual(['owned-shared'])
  expect(result.modelConfigs).toHaveLength(1)
  expect(result.modelConfigs![0]).toMatchObject({ name: 'Fresh shared', supportsVision: false })
  expect(result.modelAvailability![0].credentialGroupIds).toEqual(['owned-a', 'owned-b'])
})
