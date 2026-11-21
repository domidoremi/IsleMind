import type { AIProvider } from '@/types/providerContracts'
import { runCredentialGroupModelSync } from './providerCredentialGroups'

const cases = [
  { name: 'primary prefix of a group key', primary: 'fixture-alpha', keys: ['fixture-alpha-extension'], echoed: 'fixture-alpha-extension' },
  { name: 'primary suffix of a group key', primary: 'fixture-alpha', keys: ['extension-fixture-alpha'], echoed: 'extension-fixture-alpha' },
  { name: 'earlier group prefix of another key', primary: '', keys: ['fixture-alpha', 'fixture-alpha-extension'], echoed: 'fixture-alpha-extension' },
  { name: 'earlier group suffix of another key', primary: '', keys: ['fixture-alpha', 'extension-fixture-alpha'], echoed: 'extension-fixture-alpha' },
  { name: 'partially overlapping keys', primary: 'fixture-alpha', keys: ['alpha-extension'], echoed: 'fixture-alpha-extension' },
  { name: 'repeated overlapping keys', primary: 'fixture-alpha', keys: ['alpha-extension'], echoed: 'fixture-alpha-extension fixture-alpha-extension' },
  { name: 'literal pattern characters', primary: 'fixture.[a]+', keys: ['fixture.[a]+-extension'], echoed: 'fixture.[a]+-extension' },
  { name: 'trimmed stored keys', primary: '  fixture-alpha  ', keys: [' fixture-alpha-extension '], echoed: 'fixture-alpha-extension' },
]

it.each(cases)('redacts complete $name from failed catalog retrieval', async ({ primary, keys, echoed }) => {
  const provider: AIProvider = {
    id: 'owned-redaction-fixture', name: 'Owned redaction fixture', type: 'openai-compatible', enabled: false,
    apiKey: primary, models: ['retained-model'],
    credentialGroups: keys.map((apiKey, index) => ({
      id: `owned-${index}`, label: `Owned ${index}`, apiKey, enabled: true,
      availableModels: ['retained-model'], modelCatalogKnown: true,
    })),
  }
  const original = structuredClone(provider)
  const fetchModels = jest.fn(async () => { throw new Error(`Catalog denied: ${echoed}; retry later`) })
  const result = await runCredentialGroupModelSync(provider, { fetchModels, delay: async () => {}, now: () => 2000 })
  const safeDetail = `Catalog denied: ${echoed.includes(' ') ? '[redacted] [redacted]' : '[redacted]'}; retry later`
  for (const group of result.credentialGroups ?? []) {
    expect(group.lastModelSyncMessage).toBe(safeDetail)
    expect(group).toMatchObject({ lastModelSyncStatus: 'bad', availableModels: ['retained-model'], modelCatalogKnown: true })
  }
  expect(result.lastModelSyncMessage).toBe(keys.map((_, index) => `Owned ${index}: ${safeDetail}`).join('\n'))
  expect(result.apiKey).toBe(primary)
  expect(result.credentialGroups?.map(group => group.apiKey)).toEqual(keys)
  expect(provider).toEqual(original)
  expect(fetchModels).toHaveBeenCalledTimes(keys.length)
})

it('redacts a disabled key from another key’s error without changing the disabled catalog', async () => {
  const provider: AIProvider = {
    id: 'owned-disabled-redaction', name: 'Owned disabled redaction', type: 'openai-compatible', enabled: false,
    apiKey: 'fixture-alpha', models: [], credentialGroups: [
      { id: 'active', label: 'Active', enabled: true, apiKey: 'fixture-active', availableModels: [] },
      { id: 'paused', label: 'Paused', enabled: false, apiKey: 'fixture-alpha-extension', availableModels: [], modelCatalogKnown: true },
    ],
  }
  const fetchModels = jest.fn(async () => { throw new Error('Catalog denied: fixture-alpha-extension; retry later') })
  const result = await runCredentialGroupModelSync(provider, { fetchModels, delay: async () => {} })
  expect(result.credentialGroups?.[0].lastModelSyncMessage).toBe('Catalog denied: [redacted]; retry later')
  expect(result.credentialGroups?.[1]).toMatchObject(provider.credentialGroups![1])
  expect(fetchModels).toHaveBeenCalledTimes(1)
})

it('preserves useful diagnostics and empty credentials without changing their text', async () => {
  const provider: AIProvider = {
    id: 'owned-unrelated-error', name: 'Owned unrelated error', type: 'openai-compatible', enabled: false,
    apiKey: '', models: [], credentialGroups: [
      { id: 'active', label: 'Active', enabled: true, apiKey: 'fixture-active', availableModels: [] },
      { id: 'empty', label: 'Empty', enabled: false, apiKey: '  ', availableModels: [] },
    ],
  }
  const result = await runCredentialGroupModelSync(provider, {
    fetchModels: async () => { throw new Error('Catalog temporarily unavailable (503); retry later') }, delay: async () => {},
  })
  expect(result.credentialGroups?.[0].lastModelSyncMessage).toBe('Catalog temporarily unavailable (503); retry later')
  expect(result.apiKey).toBe('')
  expect(result.credentialGroups?.[1].apiKey).toBe('  ')
})
