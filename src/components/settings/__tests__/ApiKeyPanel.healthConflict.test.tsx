import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { ApiKeyPanel } from '@/components/settings/ApiKeyPanel'
import { useSettingsStore } from '@/store/settingsStore'
import type { AIProvider } from '@/types/providerContracts'
import { providerCredentialStorage } from '@/bootstrap/secureCredentialStorage'

const mockToast = jest.fn()
const mockUpdate = jest.fn()
const mockFlushProviders = jest.fn(async () => undefined)
jest.mock('expo-clipboard', () => ({ hasStringAsync: async () => false, getStringAsync: async () => '' }))
jest.mock('expo-router', () => ({ useNavigation: jest.fn() }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: { fine: 1.5, regular: 1.75, strong: 2 } }))
jest.mock('@/components/settings/SettingsHelp', () => ({ SettingsHelpButton: () => null }))
jest.mock('@/components/providers/ProviderLocalUsage', () => ({ ProviderLocalUsage: () => null }))
jest.mock('@/components/ui/isle', () => ({ ...jest.requireActual('@/components/ui/isle'),
  useIsleDialog: () => ({ toast: mockToast, notice: mockToast, confirm: async () => false }),
}))
jest.mock('@/bootstrap/providerActivationRuntime', () => ({ syncAndTestProvider: () => { throw Error('Unexpected model request') } }))
jest.mock('@/components/providers/useProviderActivationJob', () => ({ useProviderActivationJob: () => ({ isActivationRunning: false }) }))
jest.mock('@/presentation/features/settings/settingsStorePersistenceCommand', () => ({
  flushPersistedSettings: async () => undefined, savePersistedProviderMetadata: async () => undefined,
}))

const initialState = useSettingsStore.getState()
const fixture = (): AIProvider => ({
  id: 'fixture', name: 'Fixture connection', type: 'openai-compatible', presetId: 'custom-endpoint',
  apiKey: '', baseUrl: 'https://example.invalid/v1', enabled: false,
  models: ['fixture-model'], manualModels: ['fixture-model'],
})
function Panel({ initialView = 'connection' as 'models' | 'connection' }) {
  const provider = useSettingsStore(state => state.providers[0])
  return <ApiKeyPanel provider={provider} expanded hideHeader initialView={initialView} />
}
beforeEach(() => {
  jest.clearAllMocks()
  useSettingsStore.setState({ ...initialState,
    settings: { ...initialState.settings, defaultProvider: null, lastPreferredModel: undefined },
    updateProvider: mockUpdate, flushProviderPersistence: mockFlushProviders,
    hydrateProviderKey: async () => {
      const provider = useSettingsStore.getState().providers[0]
      return { ...provider, credentialGroups: provider.credentialGroups?.map(group => ({ ...group, apiKey: 'synthetic-' + group.id })) }
    },
  })
})
afterEach(() => useSettingsStore.setState(initialState, true))

// Exercise the actual store with isolated in-memory persistence and credentials.
const mockHealthGate = jest.fn(async (_ids: readonly string[], mutate: () => Promise<unknown>) => mutate())
jest.mock('@/bootstrap/providerModelAvailabilityRuntime', () => ({
  withProviderModelAvailabilityChanges: (...args: Parameters<typeof mockHealthGate>) => mockHealthGate(...args),
  providerModelAvailabilityRuntime: { withProviderMutation: async (_id: string, mutate: () => Promise<unknown>) => mutate() },
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

beforeEach(() => {
  mockHealthGate.mockReset().mockImplementation(async (_ids, mutate) => mutate())
  mockUpdate.mockImplementation(initialState.updateProvider)
  useSettingsStore.setState({ providers: [{ ...fixture(), credentialSelection: { strategy: 'balanced', preferredGroupId: 'key-a' },
    credentialGroups: [
      { id: 'key-a', label: 'Key A', enabled: true, apiKey: '', lastUsedAt: 10, lastFailureAt: 11, failureCount: 2 },
      { id: 'key-b', label: 'Key B', enabled: true, apiKey: '', lastUsedAt: 20, lastFailureAt: 21, failureCount: 3 },
    ],
  }] })
})

it.each(['name', 'group label', 'disable key'] as const)('saves %s after reply telemetry and retains current health', async edit => {
  const screen = await render(<Panel initialView="connection" />)
  if (edit === 'name') await fireEvent.changeText(screen.getByDisplayValue('Fixture connection'), 'Saved name')
  if (edit === 'group label') await fireEvent.changeText(screen.getByDisplayValue('Key A'), 'Saved key label')
  if (edit === 'disable key') await fireEvent.press(screen.getAllByLabelText('apiKeyPanel.disabled')[0])
  await act(async () => {
    await initialState.updateProviderCredentialGroupHealth('fixture', 'key-a', true)
    await initialState.updateProviderCredentialGroupHealth('fixture', 'key-b', false)
  })
  const latest = useSettingsStore.getState().providers[0].credentialGroups!.map(group => ({ ...group }))
  await fireEvent.press(screen.getByRole('button', { name: 'settingsSubsystem.saveChoose' }))
  await waitFor(() => expect(mockFlushProviders).toHaveBeenCalled())
  const saved = useSettingsStore.getState().providers[0]
  for (const group of saved.credentialGroups!) {
    const current = latest.find(item => item.id === group.id)!
    expect(group).toMatchObject({ lastUsedAt: current.lastUsedAt, lastFailureAt: current.lastFailureAt, failureCount: current.failureCount })
  }
  if (edit === 'name') expect(saved.name).toBe('Saved name')
  if (edit === 'group label') expect(saved.credentialGroups![0].label).toBe('Saved key label')
  if (edit === 'disable key') expect(saved.credentialGroups![0].enabled).toBe(false)
  expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'settingsWorkspace.conflict' }))
  await screen.unmount()
})

it.each(['label', 'preference', 'name'] as const)('keeps a real concurrent %s edit and preserves the unsaved local draft', async field => {
  const screen = await render(<Panel initialView="connection" />)
  await fireEvent.changeText(screen.getByDisplayValue('Fixture connection'), 'Local draft')
  await act(async () => useSettingsStore.setState(state => ({ providers: state.providers.map(provider => ({ ...provider,
    ...(field === 'name' ? { name: 'External name' } : field === 'preference'
      ? { credentialSelection: { strategy: 'balanced' as const, preferredGroupId: 'key-b' } }
      : { credentialGroups: provider.credentialGroups!.map(group => ({ ...group, label: 'External label' })) }),
  })) })))
  const latest = useSettingsStore.getState().providers[0]
  await fireEvent.press(screen.getByRole('button', { name: 'settingsSubsystem.saveChoose' }))
  expect(mockUpdate).not.toHaveBeenCalled()
  expect(useSettingsStore.getState().providers[0]).toEqual(latest)
  expect(screen.getByDisplayValue('Local draft')).toBeTruthy()
  expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'settingsWorkspace.conflict' }))
  await screen.unmount()
})

it('rebases health after Save waits in the actual store admission queue', async () => {
  let finish!: () => void
  mockHealthGate.mockImplementationOnce(async (_ids, mutate) => { await new Promise<void>(resolve => { finish = resolve }); return mutate() })
  const screen = await render(<Panel initialView="connection" />)
  await fireEvent.changeText(screen.getByDisplayValue('Key A'), 'Queued label')
  await fireEvent.press(screen.getByRole('button', { name: 'settingsSubsystem.saveChoose' }))
  await waitFor(() => expect(finish).toBeDefined())
  await act(async () => { await initialState.updateProviderCredentialGroupHealth('fixture', 'key-a', false) })
  const latest = useSettingsStore.getState().providers[0].credentialGroups![0]
  await act(async () => finish())
  await waitFor(() => expect(mockFlushProviders).toHaveBeenCalled())
  expect(useSettingsStore.getState().providers[0].credentialGroups![0]).toMatchObject({
    label: 'Queued label', lastUsedAt: latest.lastUsedAt, lastFailureAt: latest.lastFailureAt, failureCount: latest.failureCount,
  })
  await screen.unmount()
})

it.each([false, true])('preserves matching credential health and resets replacement health (replace: %s)', async replace => {
  const original = useSettingsStore.getState().providers[0]
  await providerCredentialStorage.setCredentialGroupCredential(original.id, 'key-a', 'original-fixture-key')
  const groups = original.credentialGroups!.map(group => group.id === 'key-a'
    ? { ...group, apiKey: replace ? 'replacement-fixture-key' : 'original-fixture-key' } : group)
  let finish!: () => void
  mockHealthGate.mockImplementationOnce(async (_ids, mutate) => {
    await new Promise<void>(resolve => { finish = resolve })
    return mutate()
  })
  const pending = initialState.updateProvider(original.id, { credentialGroups: groups }, {
    expectedProvider: original, preserveCredentialHealth: true,
  })
  await waitFor(() => expect(finish).toBeDefined())
  await initialState.updateProviderCredentialGroupHealth(original.id, 'key-a', false)
  const latest = useSettingsStore.getState().providers[0].credentialGroups![0]
  finish()
  await pending
  const saved = useSettingsStore.getState().providers[0].credentialGroups![0]
  expect(saved.lastUsedAt).toBe(replace ? undefined : latest.lastUsedAt)
  expect(saved.lastFailureAt).toBe(replace ? undefined : latest.lastFailureAt)
  expect(saved.failureCount).toBe(replace ? 0 : latest.failureCount)
  const stored = await providerCredentialStorage.getProviderCredentials(original.id, ['key-a'])
  expect(stored.credentialGroups[0].credential).toBe(replace ? 'replacement-fixture-key' : 'original-fixture-key')
})
