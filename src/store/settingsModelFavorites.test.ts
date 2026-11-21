import AsyncStorage from '@react-native-async-storage/async-storage'
import { useSettingsStore } from './settingsStore'
import { settingsStorePersistence } from '@/bootstrap/settingsStorePersistence'
import { APPLICATION_DATA_STORAGE_KEYS } from '@/bootstrap/applicationDataRecords'
import { secureKeyValueStorage } from '@/bootstrap/secureCredentialStorage'
import { bindSettingsStorePersistence, flushPersistedSettings, releaseSettingsStorePersistence } from '@/presentation/features/settings/settingsStorePersistenceCommand'
import type { Settings } from '@/types/settingsContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { ModelRoutingPlan } from '@/core/modelRoutingPlan'

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
function routingPlan(id = 'draft'): ModelRoutingPlan {
  return { schema: 'islemind.model-routing-plan.v1', id, name: id, mode: 'fixed',
    primary: { providerId: 'a', model: 'routing-alias' }, crossProvider: 'ask' }
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

it('removes a failed new routing plan from live settings before the caller can discard its editor', async () => {
  const before = useSettingsStore.getState().settings
  failSettingsWrite = true
  await expect(useSettingsStore.getState().saveRoutingPlan(routingPlan())).rejects.toMatchObject({
    name: 'ApplicationDataRecordPersistenceError', operation: 'save', storageKey: 'SETTINGS',
  })
  expect(useSettingsStore.getState().settings).toEqual(before)
  expect(savedSettings()).toEqual(before)
  failSettingsWrite = false
  useSettingsStore.getState().updateSettings({ fontSize: 23 })
  await flushPersistedSettings()
  expect(savedSettings()).toMatchObject({ fontSize: 23, modelRoutingPlans: before.modelRoutingPlans })
})

it('restores the existing routing plan after a failed edit and permits an explicit durable retry', async () => {
  const original = routingPlan()
  await useSettingsStore.getState().saveRoutingPlan(original)
  const edited = { ...original, name: 'Changed route' }
  failSettingsWrite = true
  await expect(useSettingsStore.getState().saveRoutingPlan(edited)).rejects.toThrow()
  expect(useSettingsStore.getState().settings.modelRoutingPlans).toEqual([original])
  expect(savedSettings().modelRoutingPlans).toEqual([original])
  failSettingsWrite = false
  await useSettingsStore.getState().saveRoutingPlan(edited)
  expect(useSettingsStore.getState().settings.modelRoutingPlans).toEqual([edited])
  expect(savedSettings().modelRoutingPlans).toEqual([edited])
})

it('retains a failed deletion in both live and durable routes until deletion is retried successfully', async () => {
  const plan = routingPlan()
  await useSettingsStore.getState().saveRoutingPlan(plan)
  failSettingsWrite = true
  await expect(useSettingsStore.getState().removeRoutingPlan(plan.id)).rejects.toThrow()
  expect(useSettingsStore.getState().settings.modelRoutingPlans).toEqual([plan])
  expect(savedSettings().modelRoutingPlans).toEqual([plan])
  failSettingsWrite = false
  await useSettingsStore.getState().removeRoutingPlan(plan.id)
  expect(useSettingsStore.getState().settings.modelRoutingPlans).toEqual([])
  expect(savedSettings().modelRoutingPlans).toEqual([])
})

it('repairs a later settings snapshot containing a failed route while retaining its unrelated preference', async () => {
  let rejectWrite!: (error: Error) => void
  jest.mocked(AsyncStorage.setItem).mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectWrite = reject }))
  const pending = useSettingsStore.getState().saveRoutingPlan(routingPlan())
  const outcome = pending.catch(error => error)
  while (!rejectWrite) await Promise.resolve()
  useSettingsStore.getState().updateSettings({ fontSize: 29 })
  rejectWrite(new Error('First settings write failed'))
  expect(await outcome).toMatchObject({ name: 'ApplicationDataRecordPersistenceError' })
  await flushPersistedSettings()
  expect(useSettingsStore.getState().settings).toMatchObject({ fontSize: 29, modelRoutingPlans: [] })
  expect(savedSettings()).toMatchObject({ fontSize: 29, modelRoutingPlans: [] })
})

it('serializes routing changes so a successful successor cannot retain the failed predecessor', async () => {
  let rejectWrite!: (error: Error) => void
  jest.mocked(AsyncStorage.setItem).mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectWrite = reject }))
  const failed = useSettingsStore.getState().saveRoutingPlan(routingPlan('failed')).catch(error => error)
  while (!rejectWrite) await Promise.resolve()
  const succeeding = useSettingsStore.getState().saveRoutingPlan(routingPlan('kept'))
  rejectWrite(new Error('First route failed'))
  expect(await failed).toMatchObject({ name: 'ApplicationDataRecordPersistenceError' })
  await succeeding
  expect(useSettingsStore.getState().settings.modelRoutingPlans).toEqual([routingPlan('kept')])
  expect(savedSettings().modelRoutingPlans).toEqual([routingPlan('kept')])
})

it('preserves an explicitly replaced route collection instead of restoring a stale failed snapshot', async () => {
  let rejectWrite!: (error: Error) => void
  jest.mocked(AsyncStorage.setItem).mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectWrite = reject }))
  const failed = useSettingsStore.getState().saveRoutingPlan(routingPlan('failed')).catch(error => error)
  while (!rejectWrite) await Promise.resolve()
  const replacement = routingPlan('replacement')
  useSettingsStore.getState().updateSettings({ modelRoutingPlans: [replacement], fontSize: 27 })
  rejectWrite(new Error('Replaced route failed'))
  expect(await failed).toMatchObject({ name: 'ApplicationDataRecordPersistenceError' })
  await flushPersistedSettings()
  expect(useSettingsStore.getState().settings).toMatchObject({ fontSize: 27, modelRoutingPlans: [replacement] })
  expect(savedSettings()).toMatchObject({ fontSize: 27, modelRoutingPlans: [replacement] })
})

it('captures queued route input before its caller changes the submitted object', async () => {
  let completeWrite!: () => void
  jest.mocked(AsyncStorage.setItem).mockImplementationOnce(async (key, value) => {
    await new Promise<void>(resolve => { completeWrite = resolve })
    records.set(key, value)
  })
  const first = useSettingsStore.getState().saveRoutingPlan(routingPlan('first'))
  while (!completeWrite) await Promise.resolve()
  const input = routingPlan('queued')
  const queued = useSettingsStore.getState().saveRoutingPlan(input)
  input.name = 'Mutated after submission'
  input.primary.model = 'Mutated model'
  completeWrite()
  await Promise.all([first, queued])
  expect(savedSettings().modelRoutingPlans).toEqual([routingPlan('first'), routingPlan('queued')])
})

it('validates a queued route against connections still present when its turn begins', async () => {
  let completeWrite!: () => void
  jest.mocked(AsyncStorage.setItem).mockImplementationOnce(async (key, value) => {
    await new Promise<void>(resolve => { completeWrite = resolve })
    records.set(key, value)
  })
  const first = useSettingsStore.getState().saveRoutingPlan(routingPlan('first'))
  while (!completeWrite) await Promise.resolve()
  const removedConnectionPlan = { ...routingPlan('queued'), primary: { providerId: 'b', model: 'routing-alias' } }
  const queued = useSettingsStore.getState().saveRoutingPlan(removedConnectionPlan).catch(error => error)
  useSettingsStore.setState(state => ({ providers: state.providers.filter(item => item.id !== 'b') }))
  completeWrite()
  await first
  expect(await queued).toMatchObject({ message: 'provider_configuration_conflict' })
  expect(useSettingsStore.getState().settings.modelRoutingPlans).toEqual([routingPlan('first')])
  expect(savedSettings().modelRoutingPlans).toEqual([routingPlan('first')])
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
