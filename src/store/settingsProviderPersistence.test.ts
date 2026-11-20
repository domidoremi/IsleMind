import { getModelConfig } from '@/types/modelCatalog'
import { useSettingsStore } from './settingsStore'
import { bindSettingsStorePersistence, flushPersistedSettings, releaseSettingsStorePersistence, type SettingsStorePersistence } from '@/presentation/features/settings/settingsStorePersistenceCommand'
import { providerCredentialStorage } from '@/bootstrap/secureCredentialStorage'
import type { Settings } from '@/types/settingsContracts'
import type { AIProvider } from '@/types/providerContracts'

jest.mock('@/bootstrap/providerModelAvailabilityRuntime', () => ({
  withProviderModelAvailabilityChanges: async (_ids: readonly string[], change: () => Promise<unknown>) => change(),
  providerModelAvailabilityRuntime: {},
}))

jest.mock('@/bootstrap/secureCredentialStorage', () => {
  const { createProviderCredentialStorage } = jest.requireActual('@/modules/providers')
  const values = new Map<string, string>()
  const secureKeyValueStorage = {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => { values.set(key, value) },
    removeItem: async (key: string) => { values.delete(key) },
  }
  return { ...jest.requireActual('@/bootstrap/secureCredentialStorage'), secureKeyValueStorage,
    providerCredentialStorage: createProviderCredentialStorage(secureKeyValueStorage) }
})

const originalProviders = useSettingsStore.getState().providers
const originalSettings = useSettingsStore.getState().settings
const provider = (name: string): AIProvider => ({ id: 'fixture', name, type: 'openai', apiKey: '', models: [], enabled: false })
let persistence: SettingsStorePersistence
let save: jest.Mock

beforeEach(() => {
  save = jest.fn().mockResolvedValue(undefined)
  persistence = { settings: { load: async () => null, save: async () => undefined }, providers: { load: async () => [], save } }
  bindSettingsStorePersistence(persistence)
  useSettingsStore.setState({ providers: [provider('Initial')] })
})
afterEach(() => { releaseSettingsStorePersistence(persistence); useSettingsStore.setState({ providers: originalProviders, settings: originalSettings }) })

it('retains authoritative empty catalogs when settings are saved and reloaded after a discovery failure', async () => {
  let metadata: readonly AIProvider[] = []
  save.mockImplementation(async value => { metadata = JSON.parse(JSON.stringify(value)) })
  persistence.providers.load = async () => metadata
  await useSettingsStore.getState().updateProvider('fixture', { modelCatalogKnown: true, lastModelSyncStatus: 'bad', models: [],
    lastTestStatus: 'ok', lastTestModel: 'stale', enabledModels: ['stale'],
    credentialGroups: [{ id: 'empty', label: 'Empty', enabled: true, availableModels: [], modelCatalogKnown: true, lastModelSyncStatus: 'bad' }] })
  await useSettingsStore.getState().flushProviderPersistence()
  await useSettingsStore.getState().load()
  expect(useSettingsStore.getState().providers[0]).toMatchObject({ modelCatalogKnown: true, lastModelSyncStatus: 'bad', models: [],
    credentialGroups: [{ modelCatalogKnown: true, availableModels: [], lastModelSyncStatus: 'bad' }] })
})

it('saves and reloads a complete large catalog with selected tail models, aliases and key ownership', async () => {
  const models = Array.from({ length: 1200 }, (_, i) => `catalog-${i}`)
  let metadata: readonly AIProvider[] = []
  save.mockImplementation(async value => { metadata = JSON.parse(JSON.stringify(value)) })
  persistence.providers.load = async () => metadata
  await useSettingsStore.getState().updateProvider('fixture', {
    models, manualModels: [], lastModelSyncStatus: 'ok', enabledModels: ['tail-alias'],
    modelAliases: [{ alias: 'tail-alias', model: models[1199] }],
    modelConfigs: models.map(id => ({ ...getModelConfig(id, 'openai-compatible'), contextWindow: 196608 })),
    credentialGroups: [
      { id: 'a', label: 'A', enabled: true, availableModels: models, lastModelSyncStatus: 'ok' },
      { id: 'b', label: 'B', enabled: true, availableModels: [models[1199]], lastModelSyncStatus: 'ok' },
    ],
  })
  await useSettingsStore.getState().flushProviderPersistence()
  const verify = (value: AIProvider) => {
    expect(value.models).toHaveLength(1200)
    expect(value.enabledModels).toEqual(['tail-alias'])
    expect(value.credentialGroups![0].availableModels).toHaveLength(1200)
    expect(value.modelAvailability!.find(item => item.modelId === models[1199])!.credentialGroupIds).toEqual(['a', 'b'])
    expect(value.modelConfigs!.find(config => config.id === models[1199])!.contextWindow).toBe(196608)
  }
  verify(metadata[0])
  await useSettingsStore.getState().load()
  verify(useSettingsStore.getState().providers[0])
  expect(useSettingsStore.getState().compactProviderStorage()).toBe(false)
  verify(useSettingsStore.getState().providers[0])
})

it('retries a failed metadata write through the existing queue', async () => {
  save.mockRejectedValueOnce(new Error('disk full'))
  useSettingsStore.getState().reorderProviders(['fixture'])
  await expect(useSettingsStore.getState().flushProviderPersistence()).rejects.toThrow('disk full')
  await useSettingsStore.getState().flushProviderPersistence()
  expect(save).toHaveBeenCalledTimes(2)
  expect(save.mock.calls[1][0][0].name).toBe('Initial')
})

it('does not resurrect an older failed snapshot after a newer write', async () => {
  let reject!: (error: Error) => void
  save.mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail }))
  useSettingsStore.getState().reorderProviders(['fixture'])
  await Promise.resolve()
  useSettingsStore.setState({ providers: [provider('Newer')] })
  useSettingsStore.getState().reorderProviders(['fixture'])
  reject(new Error('old write failed'))
  await useSettingsStore.getState().flushProviderPersistence()
  await useSettingsStore.getState().flushProviderPersistence()
  expect(save).toHaveBeenCalledTimes(2)
  expect(save.mock.calls[1][0][0].name).toBe('Newer')
})

it('retries current state when a reload supersedes the failed snapshot', async () => {
  save.mockRejectedValueOnce(new Error('disk full'))
  useSettingsStore.getState().reorderProviders(['fixture'])
  await expect(useSettingsStore.getState().flushProviderPersistence()).rejects.toThrow('disk full')
  useSettingsStore.setState({ providers: [provider('Reloaded')] })
  await useSettingsStore.getState().flushProviderPersistence()
  expect(save.mock.calls[1][0][0].name).toBe('Reloaded')
})

it.each([0, undefined])('retains saved providers, credentials and explicit preferences when loading catalog version %s', async (providerCatalogVersion) => {
  const existing: AIProvider = {
    ...provider('Saved provider'), presetId: 'custom-endpoint', baseUrl: 'https://example.invalid/v1',
    models: ['qa-manual'], manualModels: ['qa-manual'], modelAliases: [{ alias: 'My model', model: 'qa-manual' }],
    credentialGroups: [{ id: 'saved-group', label: 'Saved group', enabled: false, availableModels: ['qa-group-model'] }],
  }
  let savedProviders: readonly AIProvider[] = [existing]
  let savedSettings: Partial<Settings> = {
    providerCatalogVersion, defaultProvider: 'fixture', theme: 'dark', themeId: 'monet',
    lastPreferredModel: { schema: 'islemind.global-model-preference.v1', providerId: 'fixture', model: 'My model' },
    hapticsEnabled: false, memoryEnabled: false, mcpEnabled: false, webSearchEnabled: false, searchProvider: 'off',
  }
  persistence.settings.load = async () => savedSettings
  persistence.settings.save = async value => { savedSettings = value }
  persistence.providers.load = async () => savedProviders
  save.mockImplementation(async value => { savedProviders = value })
  await providerCredentialStorage.setProviderCredential('fixture', 'qa-primary-placeholder')
  await providerCredentialStorage.setCredentialGroupCredential('fixture', 'saved-group', 'qa-group-placeholder')

  for (let load = 0; load < 2; load += 1) {
    await useSettingsStore.getState().load()
    await flushPersistedSettings()
    await useSettingsStore.getState().flushProviderPersistence()
    expect(await providerCredentialStorage.getProviderCredential('fixture')).toBe('qa-primary-placeholder')
    expect(await providerCredentialStorage.getCredentialGroupCredential('fixture', 'saved-group')).toBe('qa-group-placeholder')
    expect(useSettingsStore.getState().providers).toEqual([expect.objectContaining({
      id: 'fixture', name: 'Saved provider', enabled: false, models: ['qa-manual'],
      modelAliases: [{ alias: 'My model', model: 'qa-manual' }],
      credentialGroups: [expect.objectContaining({ id: 'saved-group', enabled: false, availableModels: ['qa-group-model'] })],
    })])
    expect(useSettingsStore.getState().settings).toMatchObject({
      defaultProvider: 'fixture', theme: 'dark', themeId: 'monet',
      lastPreferredModel: { providerId: 'fixture', model: 'My model' },
      hapticsEnabled: false, memoryEnabled: false, mcpEnabled: false, webSearchEnabled: false, searchProvider: 'off',
    })
    expect(savedProviders.map(item => item.id)).toEqual(['fixture'])
  }
})
