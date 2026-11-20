import { createProviderActivation, type ProviderActivationPorts } from '@/modules/providers'
import { useSettingsStore } from '@/store/settingsStore'
import { bindSettingsStorePersistence, releaseSettingsStorePersistence, type SettingsStorePersistence } from '@/presentation/features/settings/settingsStorePersistenceCommand'
import { getProviderAvailableModels, getProviderManualModels, getProviderPreferredModel, isProviderChatCompatibleModel } from '@/utils/providerModels'
import { resolveProviderModelAliasAccess } from './providerModelAccess'
import type { AIProvider } from '@/types/providerContracts'

jest.mock('./providerModelAvailabilityRuntime', () => ({
  withProviderModelAvailabilityChanges: async (_ids: readonly string[], mutation: () => Promise<unknown>) => mutation(),
}))

const original = useSettingsStore.getState()
const fixture: AIProvider = { id: 'discovery-race', name: 'Before', type: 'openai-compatible', presetId: 'custom-endpoint',
  baseUrl: 'https://fixture.invalid/v1', models: ['saved'], manualModels: ['saved'], enabledModels: ['saved'], apiKey: '', enabled: true }
let persistence: SettingsStorePersistence
beforeEach(() => {
  persistence = { settings: { load: async () => null, save: async () => undefined },
    providers: { load: async () => [], save: async () => undefined } }
  bindSettingsStorePersistence(persistence)
  useSettingsStore.setState({ providers: [fixture] })
})
afterEach(() => { releaseSettingsStorePersistence(persistence); useSettingsStore.setState(original, true) })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function runtime(updateOverride?: ProviderActivationPorts['updateProvider']) {
  const started = deferred<AIProvider>(), fetched = deferred<void>()
  const ports: ProviderActivationPorts = {
    readProviderConfiguration: id => useSettingsStore.getState().providers.find(item => item.id === id),
    updateProvider: updateOverride ?? ((id, patch, options) => useSettingsStore.getState().updateProvider(id, patch, options)),
    hydrateProviderKey: async id => {
      const provider = useSettingsStore.getState().providers.find(item => item.id === id)
      return provider ? { ...provider, apiKey: 'synthetic-only' } : null
    },
    updateProviderCredentialGroupHealth: (id, group, ok, options) => useSettingsStore.getState().updateProviderCredentialGroupHealth(id, group, ok, options),
  }
  const activation = createProviderActivation({
    translate: key => key,
    synchronizeProviderCredentials: async source => {
      started.resolve(source); await fetched.promise
      return { ok: true, code: 'ok', message: 'Fetched', data: { ...source, models: ['new'], lastModelSyncStatus: 'ok',
        credentialGroups: [{ id: 'default', label: 'Key', enabled: true, availableModels: ['new'], lastModelSyncStatus: 'ok' }] } }
    },
    testProviderModel: jest.fn(), getAvailableModels: getProviderAvailableModels, getManualModels: getProviderManualModels,
    getPreferredModel: getProviderPreferredModel, isChatCompatibleModel: isProviderChatCompatibleModel,
    isModelAllowed: (provider, model, settings) => resolveProviderModelAliasAccess({ provider, model, settings }).allowed,
  })
  const run = (signal?: AbortSignal) => activation.syncAndTestProvider(fixture, ports, { testModels: false, signal })
  return { started, fetched, run }
}

it.each([
  { name: 'Changed while fetching' }, { enabledModels: [] }, { baseUrl: 'https://new.fixture.invalid/v1' },
])('retains concurrent configuration %j and rejects a stale catalog result', async patch => {
  const f = runtime(), result = f.run()
  const rejected = expect(result).rejects.toThrow('provider_configuration_conflict')
  await f.started.promise
  await useSettingsStore.getState().updateProvider(fixture.id, patch)
  f.fetched.resolve()
  await rejected
  expect(useSettingsStore.getState().providers[0]).toMatchObject(patch)
  expect(useSettingsStore.getState().providers[0].models).toEqual(['saved'])
  expect(useSettingsStore.getState().providers[0].lastModelSyncStatus).not.toBe('ok')
})

it('retains a deletion performed while discovery is pending', async () => {
  const f = runtime(), result = f.run()
  const rejected = expect(result).rejects.toThrow('provider_configuration_conflict')
  await f.started.promise
  useSettingsStore.setState({ providers: [] })
  f.fetched.resolve(); await rejected
  expect(useSettingsStore.getState().providers).toEqual([])
})

it('passes the expected configuration into the real mutation queue to close the check/write race', async () => {
  const beforeWrite = deferred<void>(), allowWrite = deferred<void>()
  const f = runtime(async (id, patch, options) => {
    beforeWrite.resolve(); await allowWrite.promise
    await useSettingsStore.getState().updateProvider(id, patch, options)
  })
  const result = f.run(), rejected = expect(result).rejects.toThrow('provider_configuration_conflict')
  await f.started.promise; f.fetched.resolve(); await beforeWrite.promise
  await useSettingsStore.getState().updateProvider(fixture.id, { enabledModels: [] })
  allowWrite.resolve(); await rejected
  expect(useSettingsStore.getState().providers[0].enabledModels).toEqual([])
  expect(useSettingsStore.getState().providers[0].models).toEqual(['saved'])
})

it('allows its own catalog/status writes and persists them without hydrated keys', async () => {
  const save = jest.spyOn(persistence.providers, 'save')
  const f = runtime(), result = f.run()
  await f.started.promise; f.fetched.resolve()
  expect(await result).toMatchObject({ synced: true, tested: false })
  await useSettingsStore.getState().flushProviderPersistence()
  expect(useSettingsStore.getState().providers[0]).toMatchObject({ enabledModels: ['saved'], lastModelSyncStatus: 'ok', apiKey: '' })
  expect(JSON.stringify(save.mock.calls)).not.toContain('synthetic-only')
})

it('does not publish a completed catalog after cancellation', async () => {
  const controller = new AbortController(), f = runtime(), result = f.run(controller.signal)
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
  await f.started.promise; controller.abort(); f.fetched.resolve(); await rejected
  expect(useSettingsStore.getState().providers[0]).toEqual(fixture)
})
