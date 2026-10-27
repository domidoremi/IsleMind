import { useSettingsStore } from './settingsStore'
import type { AIProvider } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'

const mockReadPrimary = jest.fn(), mockReadGroup = jest.fn()
const mockSaveProviders = jest.fn(), mockSaveSettings = jest.fn(), mockAllowed = jest.fn()
jest.mock('@/bootstrap/secureCredentialStorage', () => ({
  providerCredentialStorage: {
    getProviderCredential: (...args: unknown[]) => mockReadPrimary(...args),
    getCredentialGroupCredential: (...args: unknown[]) => mockReadGroup(...args),
    getProviderCredentials: async (providerId: string, groupIds: readonly string[], options?: { beforeRead?: () => void }) => {
      options?.beforeRead?.()
      const credential = await mockReadPrimary(providerId)
      options?.beforeRead?.()
      const credentialGroups = []
      for (const groupId of groupIds) {
        const value = await mockReadGroup(providerId, groupId)
        options?.beforeRead?.()
        credentialGroups.push({ groupId, credential: value })
      }
      return { credential, credentialGroups }
    },
  },
  secureKeyValueStorage: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}))
jest.mock('@/presentation/features/settings/settingsStorePersistenceCommand', () => ({
  loadPersistedProviderMetadata: async () => [], loadPersistedSettings: async () => null,
  savePersistedProviderMetadata: (...args: unknown[]) => mockSaveProviders(...args),
  savePersistedSettings: (...args: unknown[]) => mockSaveSettings(...args), flushPersistedSettings: async () => undefined,
}))
jest.mock('@/bootstrap/providerModelAvailabilityRuntime', () => ({
  withProviderModelAvailabilityChanges: async (_ids: unknown, change: () => Promise<unknown>) => change(),
  providerModelAvailabilityRuntime: {},
}))
jest.mock('@/bootstrap/providerHealthRepository', () => ({ removeProviderHealthRecordsByProviderId: jest.fn(), clearProviderHealthSnapshot: jest.fn() }))
jest.mock('@/bootstrap/providerCompactStateRepository', () => ({ invalidateAllCompactStates: jest.fn(), invalidateCompactStatesByProvider: jest.fn() }))
jest.mock('@/bootstrap/providerModelAccess', () => ({
  providerHasPolicyAllowedModel: (...args: unknown[]) => mockAllowed(...args),
  getPolicyPreferredProviderModel: (provider: AIProvider, settings: Settings) => mockAllowed(provider, settings) ? 'reviewed-model' : undefined,
}))

const initial = useSettingsStore.getState()
function provider(id: string): AIProvider {
  return { id, name: id, type: 'openai-compatible', presetId: 'custom-endpoint', wireProtocol: 'openai-compatible',
    baseUrl: `https://${id}.invalid/v1`, apiKey: '', enabled: true, models: ['reviewed-model'], lastModelSyncStatus: 'ok' }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  return { promise: new Promise<T>(yes => { resolve = yes }), resolve: (value: T) => resolve(value) }
}
beforeEach(() => {
  jest.resetAllMocks()
  mockReadPrimary.mockImplementation(async id => `synthetic-${id}-key`)
  mockReadGroup.mockResolvedValue('synthetic-group-key')
  mockAllowed.mockImplementation((_provider, settings) => settings.proxyMode === 'off')
  useSettingsStore.setState({ ...initial, providers: [provider('first'), provider('second')],
    settings: { ...initial.settings, defaultProvider: 'first', proxyMode: 'off' } })
})
afterEach(() => useSettingsStore.setState(initial, true))

it.each(['explicit', 'current'] as const)('keeps the %s default selection captured before credential hydration', async mode => {
  const gate = deferred<string>()
  mockReadPrimary.mockReturnValueOnce(gate.promise)
  const reviewed = { ...useSettingsStore.getState().settings }
  const options = mode === 'explicit' ? { settings: reviewed } : undefined
  const pending = useSettingsStore.getState().getPrimaryConfiguredProvider(options)
  reviewed.defaultProvider = 'second'
  useSettingsStore.setState(state => ({ settings: { ...state.settings, defaultProvider: 'second' } }))
  gate.resolve('synthetic-first-key')
  expect((await pending)?.id).toBe('first')
  expect(useSettingsStore.getState().settings.defaultProvider).toBe('second')
  expect(mockSaveProviders).not.toHaveBeenCalled()
  expect(mockSaveSettings).not.toHaveBeenCalled()
})

it('applies the admitted model-selection policy rather than a later live settings revision', async () => {
  const gate = deferred<string>()
  mockReadPrimary.mockReturnValueOnce(gate.promise)
  const pending = useSettingsStore.getState().getConfiguredProviders()
  useSettingsStore.setState(state => ({ settings: { ...state.settings, proxyMode: 'custom-base-url' } }))
  gate.resolve('synthetic-first-key')
  expect((await pending).map(item => item.id)).toEqual(['first', 'second'])
  expect(mockAllowed.mock.calls.every(args => args[1].proxyMode === 'off')).toBe(true)
})

it('detaches an explicitly reviewed provider catalog before async secure reads', async () => {
  const gate = deferred<string>()
  mockReadPrimary.mockReturnValueOnce(gate.promise)
  const providers = useSettingsStore.getState().providers.map(item => ({ ...item, models: [...item.models] }))
  const pending = useSettingsStore.getState().getConfiguredProviders({ providers })
  providers[0].baseUrl = 'https://changed.invalid/v1'; providers[0].models.length = 0
  gate.resolve('synthetic-first-key')
  expect((await pending)[0]).toMatchObject({ baseUrl: 'https://first.invalid/v1', models: ['reviewed-model'] })
})

it('rejects a provider metadata replacement during the primary credential read without returning mixed configuration', async () => {
  const gate = deferred<string>()
  mockReadPrimary.mockReturnValueOnce(gate.promise)
  const pending = useSettingsStore.getState().hydrateProviderKey('first')
  const check = expect(pending).rejects.toThrow('provider_configuration_conflict')
  useSettingsStore.setState(state => ({ providers: state.providers.map(item => item.id === 'first'
    ? { ...item, baseUrl: 'https://changed.invalid/v1' } : item) }))
  gate.resolve('synthetic-first-key')
  await check
  expect(mockReadGroup).not.toHaveBeenCalled()
  expect(mockSaveProviders).not.toHaveBeenCalled()
})

it('rechecks provider provenance after an admitted credential-group read settles', async () => {
  const gate = deferred<string>()
  const first = { ...provider('first'), credentialGroups: [{ id: 'reviewed-group', label: 'Group', enabled: true, apiKey: '' }] } as AIProvider
  useSettingsStore.setState({ providers: [first] })
  mockReadGroup.mockReturnValueOnce(gate.promise)
  const pending = useSettingsStore.getState().hydrateProviderKey('first')
  const check = expect(pending).rejects.toThrow('provider_configuration_conflict')
  await Promise.resolve()
  expect(mockReadGroup).toHaveBeenCalledTimes(1)
  useSettingsStore.setState({ providers: [{ ...first, credentialGroups: [{ ...first.credentialGroups![0], enabled: false }] }] })
  gate.resolve('synthetic-group-key')
  await check
})

it('does not begin credential reads for pre-cancelled selection', async () => {
  const controller = new AbortController(); controller.abort()
  await expect(useSettingsStore.getState().getPrimaryConfiguredProvider({ signal: controller.signal }))
    .rejects.toMatchObject({ name: 'AbortError' })
  expect(mockReadPrimary).not.toHaveBeenCalled()
})

it('retains the original cancellation signal and waits for an already admitted secure read', async () => {
  const gate = deferred<string>(), controller = new AbortController(), options = { signal: controller.signal }
  mockReadPrimary.mockReturnValueOnce(gate.promise)
  let settled = false
  const pending = useSettingsStore.getState().hydrateProviderKey('first', options)
    .then(value => { settled = true; return value }, error => { settled = true; throw error })
  const check = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  options.signal = new AbortController().signal; controller.abort()
  await Promise.resolve()
  expect(settled).toBe(false)
  gate.resolve('synthetic-first-key')
  await check
  expect(mockReadGroup).not.toHaveBeenCalled()
})

it('uses only the captured catalog when another provider is added during credential admission', async () => {
  const gate = deferred<string>()
  mockReadPrimary.mockReturnValueOnce(gate.promise)
  const pending = useSettingsStore.getState().getConfiguredProviders()
  useSettingsStore.setState(state => ({ providers: [...state.providers, provider('new-provider')] }))
  gate.resolve('synthetic-first-key')
  expect((await pending).map(item => item.id)).toEqual(['first', 'second'])
  expect(mockReadPrimary.mock.calls.map(args => args[0])).toEqual(['first', 'second'])
})

it('does not silently rewrite an unavailable stored default while returning a usable fallback', async () => {
  useSettingsStore.setState(state => ({
    providers: [state.providers[0], { ...state.providers[1], enabled: false }],
    settings: { ...state.settings, defaultProvider: 'second' },
  }))
  expect((await useSettingsStore.getState().getPrimaryConfiguredProvider())?.id).toBe('first')
  expect(useSettingsStore.getState().settings.defaultProvider).toBe('second')
  expect(mockSaveSettings).not.toHaveBeenCalled()
})

it('rejects an explicitly reviewed provider that was removed before selection admission', async () => {
  const providers = useSettingsStore.getState().providers
  useSettingsStore.setState({ providers: [providers[1]] })
  await expect(useSettingsStore.getState().hydrateProviderKey('first', { providers })).rejects.toThrow('provider_configuration_conflict')
  expect(mockReadPrimary).not.toHaveBeenCalled()
})

it('waits for all admitted provider reads before surfacing one failed selection', async () => {
  const gate = deferred<string>(), failure = new Error('Synthetic credential read failed')
  mockReadPrimary.mockRejectedValueOnce(failure).mockReturnValueOnce(gate.promise)
  let settled = false
  const pending = useSettingsStore.getState().getConfiguredProviders()
    .then(value => { settled = true; return value }, error => { settled = true; throw error })
  const check = expect(pending).rejects.toBe(failure)
  for (let step = 0; step < 10; step++) await Promise.resolve()
  expect(settled).toBe(false)
  gate.resolve('synthetic-second-key')
  await check
})

it('does not admit another credential-group read after cancellation during the current group read', async () => {
  const gate = deferred<string>(), controller = new AbortController()
  useSettingsStore.setState({ providers: [{ ...provider('first'), credentialGroups: [
    { id: 'first-group', label: 'First', enabled: true, apiKey: '' },
    { id: 'second-group', label: 'Second', enabled: true, apiKey: '' },
  ] }] })
  mockReadGroup.mockReturnValueOnce(gate.promise)
  const pending = useSettingsStore.getState().hydrateProviderKey('first', { signal: controller.signal })
  const check = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await Promise.resolve()
  expect(mockReadGroup).toHaveBeenCalledTimes(1)
  controller.abort()
  gate.resolve('synthetic-first-group-key')
  await check
  expect(mockReadGroup).toHaveBeenCalledTimes(1)
})

it('rejects a captured provider removed after its own read while another provider read is still pending', async () => {
  const gate = deferred<string>()
  mockReadPrimary.mockReturnValueOnce(Promise.resolve('synthetic-first-key')).mockReturnValueOnce(gate.promise)
  const pending = useSettingsStore.getState().getConfiguredProviders()
  const check = expect(pending).rejects.toThrow('provider_configuration_conflict')
  await Promise.resolve(); await Promise.resolve()
  useSettingsStore.setState(state => ({ providers: [state.providers[1]] }))
  gate.resolve('synthetic-second-key')
  await check
})
