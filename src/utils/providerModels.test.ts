import { getProviderCompactModel, resolveProviderModelAlias } from './providerModels'
import type { AIModel } from '@/types/providerContracts'

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
