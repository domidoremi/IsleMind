import { useSettingsStore } from './settingsStore'
import { providerCredentialStorage } from '@/bootstrap/secureCredentialStorage'
import { providerCredentialGroupStorageKey, providerCredentialStorageKey } from '@/modules/providers'
import type { AIProvider } from '@/types/providerContracts'

const mockRead = jest.fn(), mockWrite = jest.fn(), mockDelete = jest.fn()
const mockSaveProviders = jest.fn(), mockSaveSettings = jest.fn()
jest.mock('@/bootstrap/secureCredentialStorage', () => {
  const { createProviderCredentialStorage } = jest.requireActual('@/modules/providers')
  const { createVerifiedSecureKeyValueStorage } = jest.requireActual('@/core')
  const secureKeyValueStorage = createVerifiedSecureKeyValueStorage({
    getItem: (key: string) => mockRead(key),
    setItem: (key: string, value: string) => mockWrite(key, value),
    removeItem: (key: string) => mockDelete(key),
  })
  return { secureKeyValueStorage, providerCredentialStorage: createProviderCredentialStorage(secureKeyValueStorage) }
})
jest.mock('@/presentation/features/settings/settingsStorePersistenceCommand', () => ({
  loadPersistedProviderMetadata: async () => [], loadPersistedSettings: async () => null,
  savePersistedProviderMetadata: (...args: unknown[]) => mockSaveProviders(...args),
  savePersistedSettings: (...args: unknown[]) => mockSaveSettings(...args),
  flushPersistedSettings: async () => undefined,
}))
jest.mock('@/bootstrap/providerModelAvailabilityRuntime', () => ({
  withProviderModelAvailabilityChanges: async (_ids: unknown, change: () => Promise<unknown>) => change(),
  providerModelAvailabilityRuntime: {},
}))
jest.mock('@/bootstrap/providerHealthRepository', () => ({
  removeProviderHealthRecordsByProviderId: jest.fn(), clearProviderHealthSnapshot: jest.fn(),
}))
jest.mock('@/bootstrap/providerCompactStateRepository', () => ({
  invalidateAllCompactStates: jest.fn(), invalidateCompactStatesByProvider: jest.fn(),
}))

const initial = useSettingsStore.getState()
const values = new Map<string, string>()
const primaryKey = providerCredentialStorageKey('fixture')
const groupKey = providerCredentialGroupStorageKey('fixture', 'reviewed-group')
const fixtureProvider: AIProvider = {
  id: 'fixture', name: 'Fixture', type: 'openai-compatible', presetId: 'custom-endpoint',
  wireProtocol: 'openai-compatible', baseUrl: 'https://fixture.invalid/v1',
  apiKey: '', enabled: true, models: ['reviewed-model'], lastModelSyncStatus: 'ok',
  credentialGroups: [{ id: 'reviewed-group', label: 'Reviewed', enabled: true, apiKey: '' }],
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}

beforeEach(() => {
  jest.clearAllMocks()
  values.clear()
  mockRead.mockImplementation(async key => values.get(key) ?? null)
  mockWrite.mockImplementation(async (key, value) => { values.set(key, value) })
  mockDelete.mockImplementation(async key => { values.delete(key) })
  useSettingsStore.setState({
    ...initial, providers: [fixtureProvider],
    settings: {
      ...initial.settings, defaultProvider: 'fixture', memoryEnabled: false,
      knowledgeEnabled: false, mcpEnabled: false, skillsEnabled: false,
      webSearchEnabled: false, searchProvider: 'off',
    },
  })
})
afterEach(() => {
  useSettingsStore.setState(initial, true)
  expect(mockSaveProviders).not.toHaveBeenCalled()
  expect(mockSaveSettings).not.toHaveBeenCalled()
})

it.each([null, 'old-primary-placeholder'])('hydrates one queued credential version when primary is %s and a replacement is already waiting', async oldPrimary => {
  if (oldPrimary !== null) values.set(primaryKey, oldPrimary)
  values.set(groupKey, 'old-group-placeholder')
  const entered = deferred<void>(), release = deferred<void>()
  let first = true
  mockRead.mockImplementation(async key => {
    const value = values.get(key) ?? null
    if (first && key === primaryKey) { first = false; entered.resolve(); await release.promise }
    return value
  })
  const admittedSettings = JSON.stringify(useSettingsStore.getState().settings)
  const hydration = useSettingsStore.getState().hydrateProviderKey('fixture')
  await entered.promise
  const replacement = providerCredentialStorage.applyMutations([
    { providerId: 'fixture', credential: 'new-primary-placeholder' },
    { providerId: 'fixture', groupId: 'reviewed-group', credential: 'new-group-placeholder' },
  ])
  release.resolve()
  const [hydrated] = await Promise.all([hydration, replacement])
  expect(hydrated).toMatchObject({
    apiKey: oldPrimary ?? 'old-group-placeholder',
    apiKeySource: oldPrimary ? { kind: 'primary' } : { kind: 'group', groupId: 'reviewed-group' },
    credentialGroups: [expect.objectContaining({ id: 'reviewed-group', apiKey: 'old-group-placeholder' })],
  })
  expect(await providerCredentialStorage.getProviderCredential('fixture')).toBe('new-primary-placeholder')
  expect(await providerCredentialStorage.getCredentialGroupCredential('fixture', 'reviewed-group')).toBe('new-group-placeholder')
  expect(JSON.stringify(useSettingsStore.getState().settings)).toBe(admittedSettings)
  expect(useSettingsStore.getState().providers).toEqual([fixtureProvider])
  expect(mockSaveProviders).not.toHaveBeenCalled()
  expect(mockSaveSettings).not.toHaveBeenCalled()
})

it('rechecks provider metadata when the queued snapshot is admitted before touching its primary key', async () => {
  const entered = deferred<void>(), release = deferred<void>()
  mockRead.mockImplementationOnce(async () => { entered.resolve(); await release.promise; return null })
  const leading = providerCredentialStorage.getProviderCredential('leading')
  await entered.promise
  const hydration = useSettingsStore.getState().hydrateProviderKey('fixture').catch(error => error)
  const replacement = { ...fixtureProvider, baseUrl: 'https://changed-fixture.invalid/v1' }
  useSettingsStore.setState({ providers: [replacement] })
  release.resolve()
  const [, failure] = await Promise.all([leading, hydration])
  expect(failure).toMatchObject({ message: 'provider_configuration_conflict' })
  expect(mockRead.mock.calls.map(([key]) => key)).toEqual([providerCredentialStorageKey('leading')])
  expect(useSettingsStore.getState().providers).toEqual([replacement])
  expect(mockWrite).not.toHaveBeenCalled()
})

it.each(['cancel', 'metadata'] as const)('awaits an admitted group read on %s refusal without admitting another group', async refusal => {
  const entered = deferred<void>(), release = deferred<void>()
  const source: AIProvider = {
    ...fixtureProvider, credentialGroups: [
      ...fixtureProvider.credentialGroups!,
      { id: 'next-group', label: 'Next', enabled: true, apiKey: '' },
    ],
  }
  useSettingsStore.setState({ providers: [source] })
  mockRead.mockImplementation(async key => {
    if (key === groupKey) { entered.resolve(); await release.promise }
    return values.get(key) ?? null
  })
  const controller = new AbortController(), options = { signal: controller.signal }
  let settled = false
  const hydration = useSettingsStore.getState().hydrateProviderKey('fixture', options)
    .then(value => { settled = true; return value }, error => { settled = true; throw error })
  const outcome = hydration.catch(error => error)
  await entered.promise
  if (refusal === 'cancel') {
    options.signal = new AbortController().signal
    controller.abort()
  } else {
    useSettingsStore.setState({ providers: [{ ...source, enabled: false }] })
  }
  await Promise.resolve()
  const earlySettlement = settled
  release.resolve()
  const failure = await outcome
  expect(earlySettlement).toBe(false)
  expect(failure).toMatchObject(refusal === 'cancel'
    ? { name: 'AbortError' } : { message: 'provider_configuration_conflict' })
  expect(mockRead.mock.calls.map(([key]) => key)).toEqual([primaryKey, groupKey])
  expect(mockWrite).not.toHaveBeenCalled()
})

it('does not substitute legacy credentials or empty defaults for a secure read failure and permits an explicit retry', async () => {
  const source: AIProvider = {
    ...fixtureProvider,
    credentialGroups: [{ ...fixtureProvider.credentialGroups![0], apiKey: 'legacy-group-placeholder' }],
  }
  useSettingsStore.setState({ providers: [source] })
  const admittedSettings = JSON.stringify(useSettingsStore.getState().settings)
  mockRead.mockImplementation(async key => {
    if (key === groupKey) throw new Error('sensitive-storage-placeholder')
    return values.get(key) ?? null
  })
  const failure = await useSettingsStore.getState().hydrateProviderKey('fixture').catch(error => error)
  expect(failure).toMatchObject({ code: 'read_failed', scope: 'credential_group' })
  expect(String(failure)).not.toContain('sensitive-storage-placeholder')
  expect(JSON.stringify(useSettingsStore.getState().settings)).toBe(admittedSettings)
  expect(useSettingsStore.getState().providers).toEqual([source])
  expect(mockWrite).not.toHaveBeenCalled()
  mockRead.mockImplementation(async key => values.get(key) ?? null)
  values.set(groupKey, 'retried-group-placeholder')
  await expect(useSettingsStore.getState().hydrateProviderKey('fixture')).resolves.toMatchObject({
    apiKey: 'retried-group-placeholder', apiKeySource: { kind: 'group', groupId: 'reviewed-group' },
  })
})

it.each(['absent', 'disabled', 'legacy'] as const)('retains %s credential fallback semantics without changing the saved default', async variant => {
  const group = {
    ...fixtureProvider.credentialGroups![0],
    enabled: variant !== 'disabled',
    apiKey: variant === 'legacy' ? 'legacy-group-placeholder' : '',
  }
  const source = { ...fixtureProvider, credentialGroups: [group] }
  useSettingsStore.setState(state => ({
    providers: [source],
    settings: { ...state.settings, defaultProvider: 'unresolved-saved-provider' },
  }))
  if (variant === 'disabled') values.set(groupKey, 'disabled-group-placeholder')
  const admittedSettings = JSON.stringify(useSettingsStore.getState().settings)
  const hydrated = await useSettingsStore.getState().hydrateProviderKey('fixture')
  expect(hydrated).toMatchObject({
    apiKey: variant === 'legacy' ? 'legacy-group-placeholder' : '',
    apiKeySource: variant === 'legacy' ? { kind: 'group', groupId: 'reviewed-group' } : { kind: 'none' },
    credentialGroups: [expect.objectContaining({ id: 'reviewed-group', enabled: variant !== 'disabled' })],
  })
  expect(JSON.stringify(useSettingsStore.getState().settings)).toBe(admittedSettings)
  expect(useSettingsStore.getState().providers).toEqual([source])
  expect(mockWrite).not.toHaveBeenCalled()
})
