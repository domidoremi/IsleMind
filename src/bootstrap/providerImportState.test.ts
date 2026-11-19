import { parseProviderImportText } from './providerRegistry'
import { createProviderMetadataPersistence } from '@/modules/providers'

const pausedKey = 'synthetic-import-state-paused'
const preferredKey = 'synthetic-import-state-preferred'
const unknownKey = 'synthetic-import-state-unknown'

function connection(extra: Record<string, unknown> = {}) {
  return {
    name: 'Import state fixture',
    baseUrl: 'http://127.0.0.1:18741/v1',
    wireProtocol: 'anthropic-compatible',
    apiKey: pausedKey,
    models: ['Model', 'model', 'manual'],
    enabledModels: [],
    manualModels: ['manual'],
    modelCatalogKnown: true,
    credentialGroups: [
      { id: 'paused', label: 'Paused owner', apiKey: pausedKey, enabled: false,
        availableModels: ['Model'], modelCatalogKnown: true },
      { id: 'preferred', label: 'Empty owner', apiKey: preferredKey, enabled: true,
        availableModels: [], modelCatalogKnown: true },
      { id: 'unknown', label: 'Cached owner', apiKey: unknownKey, enabled: true,
        models: ['model'], modelCatalogKnown: false },
    ],
    credentialSelection: { strategy: 'least-recently-used', preferredGroupId: 'preferred' },
    ...extra,
  }
}

test('imports key status, exact catalogs, model selection and preference from a structured connection', () => {
  const result = parseProviderImportText(JSON.stringify(connection()))
  expect(result.sourceType).toBe('json')
  expect(result.providers).toHaveLength(1)
  const provider = result.providers[0]
  expect(provider).toMatchObject({
    models: ['Model', 'model', 'manual'], enabledModels: [], manualModels: ['manual'],
    modelCatalogKnown: true, wireProtocol: 'anthropic-compatible', enabled: false,
  })
  expect(provider.credentialGroups).toHaveLength(3)
  expect(provider.credentialGroups).toEqual([
    expect.objectContaining({ label: 'Paused owner', apiKey: pausedKey, enabled: false,
      availableModels: ['Model'], modelCatalogKnown: true }),
    expect.objectContaining({ label: 'Empty owner', apiKey: preferredKey, enabled: true,
      availableModels: [], modelCatalogKnown: true }),
    expect.objectContaining({ label: 'Cached owner', apiKey: unknownKey, enabled: true,
      availableModels: ['model'], modelCatalogKnown: false }),
  ])
  expect(provider.credentialSelection).toEqual({
    strategy: 'least-recently-used', preferredGroupId: provider.credentialGroups![1].id,
  })
})

test('keeps an explicitly unknown catalog even when cached models and a prior successful sync are present', () => {
  const result = parseProviderImportText(JSON.stringify({ providers: [
    connection({ modelCatalogKnown: false, lastModelSyncStatus: 'ok' }),
  ] }))
  expect(result.providers).toHaveLength(1)
  expect(result.providers[0].modelCatalogKnown).toBe(false)
  expect(result.providers[0].credentialGroups!.find(group => group.apiKey === unknownKey))
    .toMatchObject({ availableModels: ['model'], modelCatalogKnown: false })
})

test('uses structured key groups without activating a leftover legacy primary key', () => {
  const result = parseProviderImportText(JSON.stringify(connection({
    apiKey: 'synthetic-legacy-import-leftover',
  })))
  expect(result.providers).toHaveLength(1)
  expect(result.providers[0].credentialGroups).toHaveLength(3)
  expect(result.providers[0].credentialGroups!.map(group => group.apiKey))
    .toEqual([pausedKey, preferredKey, unknownKey])
})

test('keeps the selection strategy and clears a preference whose source group no longer exists', () => {
  const result = parseProviderImportText(JSON.stringify(connection({
    credentialSelection: { strategy: 'least-recently-used', preferredGroupId: 'deleted' },
  })))
  expect(result.providers).toHaveLength(1)
  expect(result.providers[0].credentialSelection).toEqual({
    strategy: 'least-recently-used', preferredGroupId: undefined,
  })
})

test('applies model access rules to both catalogs and selection while keeping an empty selection', () => {
  const result = parseProviderImportText(JSON.stringify(connection({
    models: ['Model', 'model', 'manual', 'blocked'],
    credentialGroups: [
      { id: 'paused', label: 'Paused owner', apiKey: pausedKey, enabled: false,
        availableModels: ['Model', 'blocked'], modelCatalogKnown: true },
      { id: 'preferred', label: 'Empty owner', apiKey: preferredKey, enabled: true,
        availableModels: [], modelCatalogKnown: true },
      { id: 'unknown', label: 'Cached owner', apiKey: unknownKey, enabled: true,
        models: ['model', 'blocked'], modelCatalogKnown: false },
    ],
  })), {
    accessSettings: { modelBlocklist: ['blocked'] },
  })
  expect(result.providers).toHaveLength(1)
  const provider = result.providers[0]
  expect(provider.models).toEqual(['Model', 'model', 'manual'])
  expect(provider.enabledModels).toEqual([])
  expect(provider.manualModels).toEqual(['manual'])
  expect(provider.credentialGroups![0]).toMatchObject({
    availableModels: ['Model'], modelCatalogKnown: true, enabled: false,
  })
  expect(provider.credentialGroups![2]).toMatchObject({
    availableModels: ['model'], modelCatalogKnown: false,
  })
})

test('retains imported key and catalog state after the real metadata persistence layer saves and loads JSON', async () => {
  let record: unknown = null
  const persistence = createProviderMetadataPersistence({
    async read() { return record },
    async write(providers) { record = JSON.parse(JSON.stringify(providers)) },
  })
  const provider = parseProviderImportText(JSON.stringify(connection({ modelCatalogKnown: false }))).providers[0]
  await persistence.save([provider])
  const restored = await persistence.load()
  expect(restored).toHaveLength(1)
  expect(restored![0]).toMatchObject({
    modelCatalogKnown: false, enabledModels: [], manualModels: ['manual'], wireProtocol: 'anthropic-compatible',
  })
  expect(restored![0].credentialGroups).toEqual(provider.credentialGroups)
  expect(restored![0].credentialSelection).toEqual(provider.credentialSelection)
})
