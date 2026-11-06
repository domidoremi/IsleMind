import AsyncStorage from '@react-native-async-storage/async-storage'
import { useSettingsStore } from './settingsStore'
import { settingsStorePersistence } from '@/bootstrap/settingsStorePersistence'
import { APPLICATION_DATA_STORAGE_KEYS } from '@/bootstrap/applicationDataRecords'
import { secureKeyValueStorage } from '@/bootstrap/secureCredentialStorage'
import { bindSettingsStorePersistence, flushPersistedSettings, releaseSettingsStorePersistence } from '@/presentation/features/settings/settingsStorePersistenceCommand'
import type { Settings } from '@/types/settingsContracts'
import type { AIProvider } from '@/types/providerContracts'

const mockInvalidateAll = jest.fn(async () => undefined)
const mockAvailabilityFence = jest.fn(async (_ids: readonly string[], mutate: () => Promise<unknown>) => mutate())
jest.mock('@/bootstrap/providerModelAvailabilityRuntime', () => ({
  withProviderModelAvailabilityChanges: (...args: Parameters<typeof mockAvailabilityFence>) => mockAvailabilityFence(...args),
  providerModelAvailabilityRuntime: {
    invalidateAll: () => mockInvalidateAll(), clear: jest.fn(async () => undefined),
    withProviderMutation: async (_id: string, mutate: () => Promise<unknown>) => mutate(),
  },
}))
jest.mock('@/bootstrap/providerHealthRepository', () => ({
  removeProviderHealthRecordsByProviderId: jest.fn(async () => undefined),
  clearProviderHealthSnapshot: jest.fn(async () => undefined),
}))
jest.mock('@/bootstrap/providerCompactStateRepository', () => ({
  invalidateCompactStatesByProvider: jest.fn(async () => undefined),
  invalidateAllCompactStates: jest.fn(async () => undefined),
}))
jest.mock('@/bootstrap/secureCredentialStorage', () => {
  const secureKeyValueStorage = {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  }
  return {
    secureKeyValueStorage, OBSERVABILITY_SINK_API_KEY: 'fixture-observability',
    providerCredentialStorage: jest.requireActual('@/modules/providers').createProviderCredentialStorage(secureKeyValueStorage),
  }
})

const initial = useSettingsStore.getState()
const records = new Map<string, string>()
let failSettingsWrite = false
function provider(id: string): AIProvider {
  return {
    id, name: id, type: 'openai-compatible', presetId: 'custom-endpoint', baseUrl: 'https://fixture.invalid/v1',
    wireProtocol: 'openai-compatible', enabled: false, apiKey: '', models: ['upstream'], manualModels: ['upstream'],
    modelAliases: [{ alias: 'routing-alias', model: 'upstream' }],
  }
}
function savedSettings(): Settings {
  return JSON.parse(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)!)
}
beforeEach(() => {
  jest.clearAllMocks()
  records.clear()
  failSettingsWrite = false
  mockInvalidateAll.mockResolvedValue(undefined)
  jest.mocked(AsyncStorage.getItem).mockImplementation(async (key) => records.get(key) ?? null)
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    if (key === APPLICATION_DATA_STORAGE_KEYS.SETTINGS && failSettingsWrite) throw new Error('fixture settings write failed')
    records.set(key, value)
  })
  jest.mocked(AsyncStorage.removeItem).mockImplementation(async (key) => { records.delete(key) })
  jest.mocked(AsyncStorage.multiRemove).mockImplementation(async (keys) => { for (const key of keys) records.delete(key) })
  const settings: Settings = {
    ...initial.settings, language: 'en', defaultProvider: 'a', modelFavorites: [],
    lastPreferredModel: { schema: 'islemind.global-model-preference.v1', providerId: 'a', model: 'routing-alias' },
    modelDisplayAliases: [{ providerId: 'a', modelId: 'routing-alias', displayName: 'Friendly' }],
    providerAllowlist: ['kept-policy'], autoUpdateCheckEnabled: false,
  }
  const providers = [provider('a'), provider('b')]
  useSettingsStore.setState({ ...initial, settings, providers }, true)
  records.set(APPLICATION_DATA_STORAGE_KEYS.SETTINGS, JSON.stringify(settings))
  records.set(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS, JSON.stringify(providers))
  records.set('@islemind/language-source', 'user')
  bindSettingsStorePersistence(settingsStorePersistence)
})
afterEach(async () => {
  failSettingsWrite = false
  await flushPersistedSettings().catch(() => undefined)
  await useSettingsStore.getState().flushProviderPersistence().catch(() => undefined)
  releaseSettingsStorePersistence(settingsStorePersistence)
  useSettingsStore.setState(initial, true)
})

it('saves, reloads and removes routing templates without storing provider secrets', async () => {
  const plan = { schema: 'islemind.model-routing-plan.v1' as const, id: 'stable', name: 'Stable', mode: 'fallback' as const,
    primary: { providerId: 'a', model: 'routing-alias' }, backup: { providerId: 'b', model: 'routing-alias' }, crossProvider: 'ask' as const }
  await useSettingsStore.getState().saveRoutingPlan(plan)
  expect(savedSettings().modelRoutingPlans).toEqual([plan])
  useSettingsStore.setState({ settings: initial.settings })
  await useSettingsStore.getState().load()
  expect(useSettingsStore.getState().settings.modelRoutingPlans).toEqual([plan])
  expect(secureKeyValueStorage.setItem).not.toHaveBeenCalled()
  await useSettingsStore.getState().removeRoutingPlan(plan.id)
  expect(savedSettings().modelRoutingPlans).toEqual([])
})

it('saves only the composite requested identity through the existing settings adapter', async () => {
  const before = useSettingsStore.getState()
  await before.setModelFavorite('b', 'routing-alias', true)
  expect(savedSettings().modelFavorites).toEqual([{ providerId: 'b', modelId: 'routing-alias' }])
  expect(savedSettings()).toMatchObject({
    defaultProvider: 'a', lastPreferredModel: before.settings.lastPreferredModel,
    modelDisplayAliases: before.settings.modelDisplayAliases, providerAllowlist: ['kept-policy'],
  })
  expect(useSettingsStore.getState().providers).toBe(before.providers)
  expect(mockInvalidateAll).not.toHaveBeenCalled()
  expect(mockAvailabilityFence).not.toHaveBeenCalled()
  expect(secureKeyValueStorage.getItem).not.toHaveBeenCalled()
  expect(secureKeyValueStorage.setItem).not.toHaveBeenCalled()
  expect(secureKeyValueStorage.removeItem).not.toHaveBeenCalled()
  expect(jest.mocked(AsyncStorage.setItem).mock.calls.every(([key]) => key === APPLICATION_DATA_STORAGE_KEYS.SETTINGS)).toBe(true)
})

it('keeps favorites separate across connections and serializes consecutive writes without losing either choice', async () => {
  const a = useSettingsStore.getState().setModelFavorite('a', 'routing-alias', true)
  const b = useSettingsStore.getState().setModelFavorite('b', 'routing-alias', true)
  await Promise.all([a, b])
  expect(savedSettings().modelFavorites).toEqual([
    { providerId: 'a', modelId: 'routing-alias' }, { providerId: 'b', modelId: 'routing-alias' },
  ])
})

it('restores favorites, aliases, and explicit preference on a new settings load', async () => {
  await useSettingsStore.getState().setModelFavorite('b', 'routing-alias', true)
  useSettingsStore.setState({ settings: { ...initial.settings, modelFavorites: [] }, providers: [] })
  await useSettingsStore.getState().load()
  await flushPersistedSettings()
  expect(useSettingsStore.getState().settings).toMatchObject({
    modelFavorites: [{ providerId: 'b', modelId: 'routing-alias' }],
    lastPreferredModel: { providerId: 'a', model: 'routing-alias' },
    modelDisplayAliases: [{ providerId: 'a', modelId: 'routing-alias', displayName: 'Friendly' }],
    defaultProvider: 'a', providerAllowlist: ['kept-policy'],
  })
  expect(useSettingsStore.getState().providers.map((item) => item.enabled)).toEqual([false, false])
})

it('retains an explicitly empty list after removal and storage reconstruction', async () => {
  await useSettingsStore.getState().setModelFavorite('a', 'routing-alias', true)
  await useSettingsStore.getState().setModelFavorite('a', 'routing-alias', false)
  expect(savedSettings().modelFavorites).toEqual([])
  await useSettingsStore.getState().load()
  expect(useSettingsStore.getState().settings.modelFavorites).toEqual([])
})

it('loads legacy records without favorites and normalizes malformed collections without discarding other preferences', async () => {
  const before = savedSettings()
  const { modelFavorites: _favorites, ...legacy } = before
  records.set(APPLICATION_DATA_STORAGE_KEYS.SETTINGS, JSON.stringify(legacy))
  await useSettingsStore.getState().load()
  expect(useSettingsStore.getState().settings.modelFavorites).toEqual([])
  records.set(APPLICATION_DATA_STORAGE_KEYS.SETTINGS, JSON.stringify({
    ...before, modelFavorites: [null, 'bad', { providerId: 'b', modelId: ' routing-alias ' }, { providerId: 'b', modelId: 'routing-alias' }],
  }))
  await useSettingsStore.getState().load()
  await flushPersistedSettings()
  expect(savedSettings()).toMatchObject({
    modelFavorites: [{ providerId: 'b', modelId: 'routing-alias' }], providerAllowlist: ['kept-policy'],
    lastPreferredModel: before.lastPreferredModel,
  })
})

it('surfaces write failure and retries the latest preferences instead of resurrecting an older snapshot', async () => {
  failSettingsWrite = true
  await expect(useSettingsStore.getState().setModelFavorite('b', 'routing-alias', true)).rejects.toThrow()
  expect(savedSettings().modelFavorites).toEqual([])
  expect(useSettingsStore.getState().settings.modelFavorites).toEqual([{ providerId: 'b', modelId: 'routing-alias' }])
  failSettingsWrite = false
  useSettingsStore.getState().updateSettings({ fontSize: 21 })
  await flushPersistedSettings()
  await useSettingsStore.getState().setModelFavorite('b', 'routing-alias', true)
  expect(savedSettings()).toMatchObject({ fontSize: 21, modelFavorites: [{ providerId: 'b', modelId: 'routing-alias' }] })
})

it('does not bypass a failed provider-scope prerequisite when saving favorites', async () => {
  mockInvalidateAll.mockRejectedValueOnce(new Error('scope invalidation failed'))
  useSettingsStore.getState().updateSettings({ proxyMode: 'custom-base-url', proxyBaseUrl: 'https://proxy.invalid/v1' })
  await expect(flushPersistedSettings()).rejects.toThrow('scope invalidation failed')
  await expect(useSettingsStore.getState().setModelFavorite('b', 'routing-alias', true)).rejects.toThrow('scope invalidation failed')
  expect(savedSettings().modelFavorites).toEqual([])
  useSettingsStore.getState().updateSettings({ proxyMode: 'custom-base-url', proxyBaseUrl: 'https://proxy.invalid/v1' })
  await flushPersistedSettings()
  await useSettingsStore.getState().setModelFavorite('b', 'routing-alias', true)
  expect(savedSettings()).toMatchObject({
    proxyMode: 'custom-base-url', modelFavorites: [{ providerId: 'b', modelId: 'routing-alias' }],
  })
})

it('removes only the deleted connection favorites and preserves the others durably', async () => {
  await useSettingsStore.getState().setModelFavorite('a', 'routing-alias', true)
  await useSettingsStore.getState().setModelFavorite('b', 'routing-alias', true)
  await useSettingsStore.getState().removeProvider('a')
  await flushPersistedSettings()
  await useSettingsStore.getState().flushProviderPersistence()
  expect(savedSettings().modelFavorites).toEqual([{ providerId: 'b', modelId: 'routing-alias' }])
  expect(useSettingsStore.getState().providers.map((item) => item.id)).toEqual(['b'])
  await expect(useSettingsStore.getState().setModelFavorite('a', 'routing-alias', true)).rejects.toThrow('provider_configuration_conflict')
  expect(savedSettings().modelFavorites).toEqual([{ providerId: 'b', modelId: 'routing-alias' }])
})

it('clears favorites with explicit connection clearing and full settings reset', async () => {
  await useSettingsStore.getState().setModelFavorite('a', 'routing-alias', true)
  await useSettingsStore.getState().clearAllProviders()
  await flushPersistedSettings()
  expect(savedSettings().modelFavorites).toEqual([])
  await useSettingsStore.getState().addProvider(provider('b'))
  await useSettingsStore.getState().setModelFavorite('b', 'routing-alias', true)
  await useSettingsStore.getState().clearAll()
  expect(savedSettings().modelFavorites).toEqual([])
  expect(useSettingsStore.getState().settings.defaultProvider).toBeNull()
})
