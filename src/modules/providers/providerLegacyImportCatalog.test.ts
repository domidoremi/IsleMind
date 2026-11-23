import { createProviderRegistry } from './providerRegistry'
import { hasCredentialModelCatalog } from './providerModelCatalog'

const registry = createProviderRegistry({
  translate: (key, _variables, fallback) => fallback ?? key,
  configurationIssue: () => null,
  resolveModelAccess: () => ({ allowed: true }),
  fetch: jest.fn() as unknown as typeof fetch,
})
const endpoint = 'https://legacy-import.invalid/v1'
const parse = (value: Record<string, unknown>) => {
  const result = registry.parseProviderImportText(JSON.stringify({ baseUrl: endpoint, ...value }))
  expect(result.warnings).toEqual([])
  expect(result.providers).toHaveLength(1)
  return result.providers[0]
}

it.each([
  { modelCatalogKnown: true },
  { lastModelSyncStatus: 'ok' },
  { modelCatalogKnown: true, lastModelSyncStatus: 'bad' },
])('retains a successful empty catalog on the single legacy key: %j', marker => {
  const provider = parse({ apiKey: 'fixture-legacy-empty', models: [], ...marker })
  expect(provider.credentialGroups).toHaveLength(1)
  expect(provider.credentialGroups?.[0]).toMatchObject({
    apiKey: 'fixture-legacy-empty', availableModels: [], modelCatalogKnown: true,
  })
  expect(hasCredentialModelCatalog(provider.credentialGroups![0])).toBe(true)
})

it.each(['apiKey', 'api_key'])('retains the confirmed catalog on the single %s without changing model case', field => {
  const provider = parse({ [field]: 'fixture-legacy-known', models: [' Model ', 'model', 'Model'], modelCatalogKnown: true })
  expect(provider.models).toEqual(['Model', 'model'])
  expect(provider.credentialGroups?.[0]).toMatchObject({
    apiKey: 'fixture-legacy-known', availableModels: ['Model', 'model'], modelCatalogKnown: true,
  })
})

it('accepts the explicitly confirmed availableModels catalog for a legacy key', () => {
  const provider = parse({ apiKey: 'fixture-legacy-available', availableModels: ['Model'], lastModelSyncStatus: 'ok' })
  expect(provider.models).toEqual(['Model'])
  expect(provider.credentialGroups?.[0]).toMatchObject({ availableModels: ['Model'], modelCatalogKnown: true })
})

it('keeps a confirmed empty legacy catalog when its models field is absent', () => {
  const provider = parse({ apiKey: 'fixture-legacy-no-models', modelCatalogKnown: true })
  expect(provider.credentialGroups?.[0]).toMatchObject({ availableModels: [], modelCatalogKnown: true })
})

it.each([{}, { modelCatalogKnown: false }, { modelCatalogKnown: false, lastModelSyncStatus: 'ok' }])(
  'does not turn unknown or manually configured legacy models into a key catalog: %j', marker => {
    const provider = parse({ apiKey: 'fixture-legacy-manual', models: ['Manual'], manualModels: ['Manual'], ...marker })
    expect(provider.models).toEqual(['Manual'])
    expect(provider.manualModels).toEqual(['Manual'])
    expect(provider.credentialGroups?.[0].availableModels ?? []).toEqual([])
    expect(hasCredentialModelCatalog(provider.credentialGroups![0])).toBe(false)
  },
)

it('does not assign a provider aggregate to two legacy keys', () => {
  const provider = parse({ apiKey: 'fixture-legacy-first\nfixture-legacy-second', models: ['Model'], modelCatalogKnown: true })
  expect(provider.credentialGroups?.map(group => group.apiKey)).toEqual(['fixture-legacy-first', 'fixture-legacy-second'])
  expect(provider.credentialGroups?.every(group => !hasCredentialModelCatalog(group) && !(group.availableModels?.length))).toBe(true)
})

it('keeps a single structured group authoritative over the legacy root catalog', () => {
  const provider = parse({ apiKey: 'fixture-legacy-duplicate', models: ['Aggregate'], modelCatalogKnown: true,
    credentialGroups: [{ id: 'owner', apiKey: 'fixture-legacy-duplicate', availableModels: [], modelCatalogKnown: false }],
  })
  expect(provider.credentialGroups).toHaveLength(1)
  expect(provider.credentialGroups?.[0]).toMatchObject({ availableModels: [], modelCatalogKnown: false })
})

it.each(['apiKey', 'api_key'])('keeps the object inside %s authoritative over root catalog metadata', field => {
  const provider = parse({ [field]: { apiKey: 'fixture-nested-unknown', availableModels: [], modelCatalogKnown: false },
    models: ['Aggregate'], modelCatalogKnown: true })
  expect(provider.credentialGroups?.[0]).toMatchObject({ availableModels: [], modelCatalogKnown: false })
})

it.each(['model', '模型', '模型列表'])('uses the same confirmed legacy catalog from %s for the provider and its one key', field => {
  const result = registry.parseProviderImportText(JSON.stringify({ baseUrl: 'https://legacy-fields.invalid/v1',
    apiKey: 'fixture-legacy-fields', [field]: ' Model,model,Model ', modelCatalogKnown: true }))
  expect(result.warnings).toEqual([])
  const provider = result.providers[0]
  expect(provider.models).toEqual(['Model', 'model'])
  expect(provider.credentialGroups).toHaveLength(1)
  expect(provider.credentialGroups?.[0]).toMatchObject({
    apiKey: 'fixture-legacy-fields', availableModels: ['Model', 'model'], modelCatalogKnown: true,
  })
})
