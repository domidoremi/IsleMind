import { useSettingsStore } from './settingsStore'
import { providerCredentialStorage } from '@/bootstrap/secureCredentialStorage'
import { bindSettingsStorePersistence, flushPersistedSettings, releaseSettingsStorePersistence, type SettingsStorePersistence } from '@/presentation/features/settings/settingsStorePersistenceCommand'
import type { AIProvider } from '@/types/providerContracts'

const mockFence = jest.fn(async (_ids: readonly string[], mutate: () => Promise<unknown>, _remove?: boolean) => mutate())
const mockRemoveHealth = jest.fn(async (_id: string) => undefined)
const mockInvalidateCompact = jest.fn(async (_id: string, _reason: string) => undefined)
jest.mock('@/bootstrap/providerModelAvailabilityRuntime', () => ({
  withProviderModelAvailabilityChanges: (...args: Parameters<typeof mockFence>) => mockFence(...args),
  providerModelAvailabilityRuntime: {
    withProviderMutation: async (_id: string, mutate: () => Promise<unknown>) => mutate(),
    clear: async () => undefined,
    invalidateAll: async () => undefined,
  },
}))
jest.mock('@/bootstrap/providerHealthRepository', () => ({
  removeProviderHealthRecordsByProviderId: (...args: Parameters<typeof mockRemoveHealth>) => mockRemoveHealth(...args),
  clearProviderHealthSnapshot: jest.fn(async () => undefined),
}))
jest.mock('@/bootstrap/providerCompactStateRepository', () => ({
  invalidateCompactStatesByProvider: (...args: Parameters<typeof mockInvalidateCompact>) => mockInvalidateCompact(...args),
  invalidateAllCompactStates: jest.fn(async () => undefined),
}))
jest.mock('@/bootstrap/secureCredentialStorage', () => {
  const values = new Map<string, string>()
  const secureKeyValueStorage = {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => { values.set(key, value) },
    removeItem: async (key: string) => { values.delete(key) },
  }
  return { secureKeyValueStorage, providerCredentialStorage: jest.requireActual('@/modules/providers').createProviderCredentialStorage(secureKeyValueStorage) }
})

const initialState = useSettingsStore.getState()
const provider = (id = 'target', name = id): AIProvider => ({
  id, name, type: 'openai-compatible', presetId: 'custom-endpoint', wireProtocol: 'openai-compatible',
  baseUrl: 'https://example.invalid/v1', apiKey: '', models: [], enabled: false,
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
let persistence: SettingsStorePersistence
let saveProviders: jest.Mock
beforeEach(async () => {
  jest.clearAllMocks()
  mockFence.mockImplementation(async (_ids, mutate) => mutate())
  saveProviders = jest.fn(async () => undefined)
  persistence = { providers: { load: async () => [], save: saveProviders }, settings: { load: async () => null, save: async () => undefined } }
  bindSettingsStorePersistence(persistence)
  useSettingsStore.setState({ ...initialState, providers: [provider(), provider('other')], settings: { ...initialState.settings, defaultProvider: 'other' } })
  await providerCredentialStorage.setProviderCredential('target', 'local-target-placeholder')
  await providerCredentialStorage.setProviderCredential('other', 'local-other-placeholder')
})
afterEach(async () => {
  await useSettingsStore.getState().flushProviderPersistence().catch(() => undefined)
  await flushPersistedSettings().catch(() => undefined)
  releaseSettingsStorePersistence(persistence)
  useSettingsStore.setState(initialState, true)
})

it('rejects an approved clear after a concurrent provider addition without deleting any credentials or defaults', async () => {
  const expectedProviders = useSettingsStore.getState().providers
  const third = provider('third')
  useSettingsStore.setState(state => ({ providers: [...state.providers, third], settings: { ...state.settings, defaultProvider: 'third' } }))
  await providerCredentialStorage.setProviderCredential('third', 'local-third-placeholder')
  const clear = useSettingsStore.getState().clearAllProviders as (options?: unknown) => Promise<void>
  await expect(clear({ expectedProviders })).rejects.toThrow('provider_configuration_conflict')
  expect(useSettingsStore.getState().providers.map(item => item.id)).toEqual(['target', 'other', 'third'])
  expect(useSettingsStore.getState().settings.defaultProvider).toBe('third')
  expect(await providerCredentialStorage.getProviderCredential('target')).toBe('local-target-placeholder')
  expect(await providerCredentialStorage.getProviderCredential('third')).toBe('local-third-placeholder')
  expect(saveProviders).not.toHaveBeenCalled()
})

it('checks the shown removal snapshot again after the availability fence and before credential deletion', async () => {
  const expectedProvider = useSettingsStore.getState().providers[0]
  const entered = deferred<void>()
  const release = deferred<void>()
  mockFence.mockImplementationOnce(async (_ids, mutate) => { entered.resolve(); await release.promise; return mutate() })
  const remove = useSettingsStore.getState().removeProvider as (id: string, options?: unknown) => Promise<void>
  const removing = remove('target', { expectedProvider })
  const outcome = removing.catch(error => error)
  await entered.promise
  useSettingsStore.setState(state => ({ providers: state.providers.map(item => item.id === 'target' ? { ...item, name: 'concurrent edit' } : item) }))
  release.resolve()
  expect(await outcome).toEqual(expect.objectContaining({ message: 'provider_configuration_conflict' }))
  expect(await providerCredentialStorage.getProviderCredential('target')).toBe('local-target-placeholder')
  expect(useSettingsStore.getState().providers[0].name).toBe('concurrent edit')
  expect(mockRemoveHealth).not.toHaveBeenCalled()
  expect(saveProviders).not.toHaveBeenCalled()
})

it('drops a removal cancelled while the fence is pending before any destructive effect', async () => {
  const abort = new AbortController()
  const entered = deferred<void>()
  const release = deferred<void>()
  mockFence.mockImplementationOnce(async (_ids, mutate) => { entered.resolve(); await release.promise; return mutate() })
  const remove = useSettingsStore.getState().removeProvider as (id: string, options?: unknown) => Promise<void>
  const removing = remove('target', { expectedProvider: provider(), signal: abort.signal })
  const outcome = removing.catch(error => error)
  await entered.promise
  const reason = new Error('editor disposed')
  abort.abort(reason)
  release.resolve()
  expect(await outcome).toBe(reason)
  expect(await providerCredentialStorage.getProviderCredential('target')).toBe('local-target-placeholder')
  expect(useSettingsStore.getState().providers).toHaveLength(2)
  expect(mockRemoveHealth).not.toHaveBeenCalled()
})

it('does not lose a new provider added while clear-all waits at its canonical boundary', async () => {
  const entered = deferred<void>()
  const release = deferred<void>()
  mockFence.mockImplementationOnce(async (_ids, mutate) => { entered.resolve(); await release.promise; return mutate() })
  const clearing = useSettingsStore.getState().clearAllProviders()
  await entered.promise
  const third = provider('third')
  const adding = useSettingsStore.getState().addProviders([third], { selectDefaultIfEmpty: false })
  await new Promise<void>(resolve => setTimeout(resolve, 10))
  release.resolve()
  await Promise.all([clearing, adding])
  expect(useSettingsStore.getState().providers.map(item => item.id)).toEqual(['third'])
  expect(useSettingsStore.getState().settings.defaultProvider).toBeNull()
})

it('does not delete a same-ID replacement while validating invalid configurations', async () => {
  const invalid = provider('target')
  useSettingsStore.setState({ providers: [invalid] })
  const reading = deferred<AIProvider>()
  const hydrate = jest.fn(() => reading.promise)
  useSettingsStore.setState({ hydrateProviderKey: hydrate })
  const clear = useSettingsStore.getState().clearInvalidProviders as (ids?: string[], options?: unknown) => Promise<number>
  const clearing = clear(['target'], { expectedProviders: [invalid] })
  const outcome = clearing.catch(error => error)
  await Promise.resolve()
  useSettingsStore.setState({ providers: [{ ...invalid, name: 'corrected meanwhile' }] })
  reading.resolve(invalid)
  expect(await outcome).toEqual(expect.objectContaining({ message: 'provider_configuration_conflict' }))
  expect(useSettingsStore.getState().providers[0].name).toBe('corrected meanwhile')
  expect(await providerCredentialStorage.getProviderCredential('target')).toBe('local-target-placeholder')
})

it('binds edits to the reviewed provider at the actual credential-mutation boundary', async () => {
  const original = useSettingsStore.getState().providers[0]
  const entered = deferred<void>()
  const release = deferred<void>()
  mockFence.mockImplementationOnce(async (_ids, mutate) => { entered.resolve(); await release.promise; return mutate() })
  const update = useSettingsStore.getState().updateProvider as (id: string, patch: Partial<AIProvider>, options?: unknown) => Promise<void>
  const updating = update('target', { name: 'local draft', baseUrl: 'https://draft.invalid/v1', apiKey: 'local-draft-placeholder' }, { expectedProvider: original })
  const outcome = updating.catch(error => error)
  await entered.promise
  useSettingsStore.setState(state => ({ providers: state.providers.map(item => item.id === 'target' ? { ...item, baseUrl: 'https://concurrent.invalid/v1' } : item) }))
  release.resolve()
  expect(await outcome).toEqual(expect.objectContaining({ message: 'provider_configuration_conflict' }))
  expect(await providerCredentialStorage.getProviderCredential('target')).toBe('local-target-placeholder')
  expect(useSettingsStore.getState().providers[0].baseUrl).toBe('https://concurrent.invalid/v1')
})

it('keeps an explicit empty default when removing a nondefault provider', async () => {
  useSettingsStore.setState(state => ({ settings: { ...state.settings, defaultProvider: null } }))
  await useSettingsStore.getState().removeProvider('target')
  expect(useSettingsStore.getState().providers.map(item => item.id)).toEqual(['other'])
  expect(useSettingsStore.getState().settings.defaultProvider).toBeNull()
})

it('keeps an explicit empty default when clearing invalid providers', async () => {
  useSettingsStore.setState(state => ({ settings: { ...state.settings, defaultProvider: null }, hydrateProviderKey: async id => ({ ...provider(id), apiKey: id === 'other' ? 'local-other-placeholder' : '' }) }))
  await useSettingsStore.getState().clearInvalidProviders(['target'])
  expect(useSettingsStore.getState().providers.map(item => item.id)).toEqual(['other'])
  expect(useSettingsStore.getState().settings.defaultProvider).toBeNull()
})

it('retains explicit undefined update fields instead of replaying old verification labels', async () => {
  useSettingsStore.setState(state => ({ providers: state.providers.map(item => ({ ...item, lastTestMessage: 'old verification', lastTestModel: 'old-model' })) }))
  await useSettingsStore.getState().updateProvider('target', { lastTestMessage: undefined, lastTestModel: undefined })
  expect(useSettingsStore.getState().providers[0].lastTestMessage).toBeUndefined()
  expect(useSettingsStore.getState().providers[0].lastTestModel).toBeUndefined()
})

it('finishes both metadata removals when cancellation follows the first already-started invalid cleanup effect', async () => {
  useSettingsStore.setState({ providers: [provider('target'), provider('second'), provider('other')],
    hydrateProviderKey: async id => ({ ...provider(id), apiKey: id === 'other' ? 'local-other-placeholder' : '' }) })
  await providerCredentialStorage.setProviderCredential('second', 'local-second-placeholder')
  const abort = new AbortController()
  mockRemoveHealth.mockImplementationOnce(async () => { abort.abort() })
  const clear = useSettingsStore.getState().clearInvalidProviders
  await expect(clear(['target', 'second'], { signal: abort.signal })).resolves.toBe(2)
  expect(useSettingsStore.getState().providers.map(item => item.id)).toEqual(['other'])
  expect(await providerCredentialStorage.getProviderCredential('target')).toBeNull()
  expect(await providerCredentialStorage.getProviderCredential('second')).toBeNull()
  expect(await providerCredentialStorage.getProviderCredential('other')).toBe('local-other-placeholder')
})

it('detaches a queued editor snapshot so caller mutation cannot broaden confirmation', async () => {
  const entered = deferred<void>()
  const release = deferred<void>()
  mockFence.mockImplementationOnce(async (_ids, mutate) => { entered.resolve(); await release.promise; return mutate() })
  const leading = useSettingsStore.getState().updateProvider('target', { name: 'concurrent queued edit', baseUrl: 'https://changed.invalid/v1' })
  await entered.promise
  const expectedProvider = provider()
  const removing = useSettingsStore.getState().removeProvider('target', { expectedProvider })
  const outcome = removing.catch(error => error)
  expectedProvider.name = 'concurrent queued edit'
  expectedProvider.baseUrl = 'https://changed.invalid/v1'
  release.resolve()
  await leading
  expect(await outcome).toEqual(expect.objectContaining({ message: 'provider_configuration_conflict' }))
  expect(useSettingsStore.getState().providers.some(item => item.id === 'target')).toBe(true)
})

it('drops a queued import cancelled before secure-storage admission and keeps the empty default', async () => {
  const entered = deferred<void>()
  const release = deferred<void>()
  mockFence.mockImplementationOnce(async (_ids, mutate) => { entered.resolve(); await release.promise; return mutate() })
  const leading = useSettingsStore.getState().updateProvider('target', { baseUrl: 'https://changed.invalid/v1' })
  await entered.promise
  const abort = new AbortController()
  const imported = { ...provider('cancelled-import'), apiKey: 'local-import-placeholder' }
  const importing = useSettingsStore.getState().addProviders([imported], { selectDefaultIfEmpty: false, signal: abort.signal })
  const outcome = importing.catch(error => error)
  const reason = new Error('cancel queued import')
  abort.abort(reason)
  release.resolve()
  await leading
  expect(await outcome).toBe(reason)
  expect(await providerCredentialStorage.getProviderCredential(imported.id)).toBeNull()
  expect(useSettingsStore.getState().providers.some(item => item.id === imported.id)).toBe(false)
})

it.each(['updateProviders', 'updateProviderPatches'] as const)('rejects stale expected catalog entries in %s before credential or metadata writes', async operation => {
  const store = useSettingsStore.getState()
  const expectedProviders = store.providers
  useSettingsStore.setState(state => ({
    providers: state.providers.map(item => item.id === 'target' ? { ...item, name: 'newer configuration' } : item),
  }))
  const patch = { name: 'stale edit', apiKey: 'local-stale-placeholder' }
  const updating = operation === 'updateProviders'
    ? store.updateProviders(['target'], patch, { expectedProviders })
    : store.updateProviderPatches([{ id: 'target', updates: patch }], { expectedProviders })
  await expect(updating).rejects.toThrow('provider_configuration_conflict')
  expect(useSettingsStore.getState().providers[0].name).toBe('newer configuration')
  expect(await providerCredentialStorage.getProviderCredential('target')).toBe('local-target-placeholder')
  expect(saveProviders).not.toHaveBeenCalled()
})

it.each(['updateProviders', 'updateProviderPatches'] as const)('captures expected snapshots and rechecks %s after delayed admission', async operation => {
  const expectedProviders = useSettingsStore.getState().providers.map(item => ({ ...item }))
  const entered = deferred<void>()
  const release = deferred<void>()
  mockFence.mockImplementationOnce(async (_ids, mutate) => { entered.resolve(); await release.promise; return mutate() })
  const store = useSettingsStore.getState()
  const updating = operation === 'updateProviders'
    ? store.updateProviders(['target'], { baseUrl: 'https://new.invalid/v1' }, { expectedProviders })
    : store.updateProviderPatches([{ id: 'target', updates: { baseUrl: 'https://new.invalid/v1' } }], { expectedProviders })
  const outcome = updating.catch(error => error)
  await entered.promise
  useSettingsStore.setState(state => ({ providers: state.providers.map(item => item.id === 'target' ? { ...item, name: 'replacement' } : item) }))
  expectedProviders[0].name = 'replacement'
  release.resolve()
  expect(await outcome).toEqual(expect.objectContaining({ message: 'provider_configuration_conflict' }))
  expect(useSettingsStore.getState().providers[0].baseUrl).toBe('https://example.invalid/v1')
  expect(saveProviders).not.toHaveBeenCalled()
})

it('does not invalidate availability for an import already cancelled while waiting in the canonical queue', async () => {
  const entered = deferred<void>()
  const release = deferred<void>()
  mockFence.mockImplementationOnce(async (_ids, mutate) => { entered.resolve(); await release.promise; return mutate() })
  const store = useSettingsStore.getState()
  const leading = store.updateProvider('target', { baseUrl: 'https://changed.invalid/v1' })
  await entered.promise
  const abort = new AbortController()
  const importing = store.addProviders([provider('not-admitted')], { signal: abort.signal, selectDefaultIfEmpty: false })
  const outcome = importing.catch(error => error)
  abort.abort()
  release.resolve()
  await leading
  expect(await outcome).toEqual(expect.objectContaining({ name: 'AbortError' }))
  expect(mockFence).toHaveBeenCalledTimes(1)
})
