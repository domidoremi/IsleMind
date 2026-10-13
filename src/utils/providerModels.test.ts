import { getProviderAvailableModels, getProviderPreferredModel, getProviderCompactModel, isProviderConversationReady, resolveProviderModelAlias } from './providerModels'
import { runCredentialGroupModelSync } from '@/modules/providers/providerCredentialGroups'
import { getPolicyAllowedProviderModels, providerHasPolicyModel } from '@/bootstrap/providerModelAccess'
import type { AIModel, AIProvider } from '@/types/providerContracts'

it('does not treat old request failures as a required probe before local selection', () => {
  const provider: AIProvider = { id: 'fixture', name: 'Fixture', type: 'openai-compatible', apiKey: '', models: ['fixture-model'], manualModels: ['fixture-model'], enabled: true, lastTestStatus: 'bad' }
  expect(isProviderConversationReady(provider)).toBe(true)
  expect(isProviderConversationReady({ ...provider, enabled: false })).toBe(false)
  expect(isProviderConversationReady({ ...provider, models: [], manualModels: [] })).toBe(false)
  expect(provider.lastTestStatus).toBe('bad')
})

it('preserves distinguishing revision text without changing the upstream identity', () => {
  const id = 'deepseek-ai/deepseek-v4-flash-0731'
  expect(getProviderCompactModel(undefined, id)).toBe('deepseek-v4-flash-0731')
  expect(resolveProviderModelAlias({}, id)).toBe(id)
})

it('keeps aliases compact and disambiguates colliding namespace suffixes', () => {
  const provider = { modelAliases: [{ alias: 'My model', model: 'namespace/model-0731' }],
    modelConfigs: [{ id: 'namespace/model-0731' }, { id: 'other/model-0731' }] as AIModel[] }
  expect(getProviderCompactModel(provider, 'My model')).toBe('My model')
  expect(resolveProviderModelAlias(provider, 'My model')).toBe('namespace/model-0731')
  expect(getProviderCompactModel(provider, 'namespace/model-0731')).toBe('namespace/model-0731')
})

it('disambiguates cached model IDs even when detailed model metadata is absent', () => {
  const provider = { models: ['first/model-0731', 'second/model-0731'] }
  expect(getProviderCompactModel(provider, 'first/model-0731')).toBe('first/model-0731')
  expect(getProviderCompactModel(provider, 'second/model-0731')).toBe('second/model-0731')
})

it('retains the discovered model catalog after a failed refresh without rewriting failure as success', async () => {
  const provider: AIProvider = { id: 'fixture', name: 'Fixture', type: 'openai', apiKey: 'local', enabled: true, models: [], manualModels: [],
    credentialGroups: [{ id: 'key', label: 'Fixture key', apiKey: 'local', enabled: true, availableModels: [] }] }
  const discovered = await runCredentialGroupModelSync(provider, { fetchModels: async () => [{ id: 'cached-model', name: 'Cached model', provider: 'openai' }] })
  const failed = await runCredentialGroupModelSync(discovered, { fetchModels: async () => { throw new Error('Temporary discovery failure') } })
  expect(failed.lastModelSyncStatus).toBe('bad')
  expect(failed.credentialGroups![0].lastModelSyncStatus).toBe('bad')
  expect(getProviderAvailableModels(failed)).toEqual(['cached-model'])
  expect(getProviderPreferredModel(failed)).toBe('cached-model')
  expect(isProviderConversationReady(failed)).toBe(true)
  expect(getPolicyAllowedProviderModels(failed)).toEqual(['cached-model'])
  expect(providerHasPolicyModel(failed, 'cached-model')).toBe(true)
  expect(getPolicyAllowedProviderModels(failed, { modelBlocklist: ['cached-model'] })).toEqual([])
  expect(getProviderAvailableModels({ ...failed, credentialGroups: failed.credentialGroups!.map(group => ({ ...group, enabled: false })) })).toEqual([])
  const recovered = await runCredentialGroupModelSync(failed, { fetchModels: async () => [{ id: 'replacement-model', name: 'Replacement', provider: 'openai' }] })
  expect(getProviderAvailableModels(recovered)).toEqual(['replacement-model'])
})
