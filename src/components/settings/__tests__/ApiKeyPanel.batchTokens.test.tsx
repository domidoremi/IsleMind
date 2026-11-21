import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { ApiKeyPanel } from '../ApiKeyPanel'
import { useSettingsStore } from '@/store/settingsStore'
import type { AIProvider } from '@/types/providerContracts'

const mockToast = jest.fn()
const mockHydrate = jest.fn()
const mockUpdate = jest.fn()
const mockFlush = jest.fn()
const mockExternal = jest.fn()
jest.mock('expo-router', () => ({ useNavigation: jest.fn() }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: { fine: 1.5, regular: 1.75, strong: 2 } }))
jest.mock('@/components/settings/SettingsHelp', () => ({ SettingsHelpButton: () => null }))
jest.mock('@/components/providers/ProviderLocalUsage', () => ({ ProviderLocalUsage: () => null }))
jest.mock('@/components/ui/isle', () => ({ ...jest.requireActual('@/components/ui/isle'),
  useIsleDialog: () => ({ toast: mockToast, notice: mockToast, confirm: jest.fn() }),
}))
jest.mock('@/bootstrap/providerRegistry', () => ({ ...jest.requireActual('@/bootstrap/providerRegistry'),
  probeProviderPreset: (...args: unknown[]) => mockExternal(...args),
}))
jest.mock('@/bootstrap/providerActivationRuntime', () => ({ syncAndTestProvider: (...args: unknown[]) => mockExternal(...args) }))
jest.mock('@/components/providers/useProviderActivationJob', () => ({
  useProviderActivationJob: () => ({ activateProviders: mockExternal, isActivationRunning: false }),
}))

const initialState = useSettingsStore.getState()
const fixture = (): AIProvider => ({
  id: 'batch-fixture', name: 'Batch fixture', type: 'openai-compatible', wireProtocol: 'openai-compatible',
  enabled: false, baseUrl: 'https://batch.example.test/v1', apiKey: '',
  models: ['model-a', 'model-b', 'shared'], manualModels: ['model-a', 'model-b', 'shared'], enabledModels: ['shared'],
  credentialSelection: { strategy: 'least-recently-used', preferredGroupId: 'key-b' },
  credentialGroups: ['a', 'b'].map((name, index) => ({ id: 'key-' + name, label: 'Key ' + name, apiKey: '', enabled: true,
    availableModels: ['model-' + name, 'shared'], modelCatalogKnown: true, failureCount: index + 2, lastUsedAt: index + 10 })),
})
function Panel() {
  const provider = useSettingsStore(state => state.providers[0])
  return <ApiKeyPanel provider={provider} expanded hideHeader initialView="connection" onUse={jest.fn()} />
}
beforeEach(() => {
  jest.clearAllMocks()
  mockFlush.mockResolvedValue(undefined)
  mockUpdate.mockImplementation(async (id: string, patch: Partial<AIProvider>) => {
    useSettingsStore.setState(state => ({ providers: state.providers.map(row => row.id === id ? { ...row, ...patch } : row) }))
  })
  mockHydrate.mockImplementation(async () => {
    const provider = useSettingsStore.getState().providers[0]
    return { ...provider, credentialGroups: provider.credentialGroups?.map(row => ({ ...row, apiKey: row.apiKey || 'stored-' + row.id })) }
  })
  useSettingsStore.setState({ ...initialState, providers: [fixture()], updateProvider: mockUpdate,
    hydrateProviderKey: mockHydrate, flushProviderPersistence: mockFlush,
    settings: { ...initialState.settings, defaultProvider: null },
  })
})
afterEach(() => {
  expect(mockExternal).not.toHaveBeenCalled()
  useSettingsStore.setState(initialState, true)
})
async function enterBatch(screen: Awaited<ReturnType<typeof render>>, value: string) {
  await waitFor(() => expect(mockHydrate).toHaveBeenCalled())
  await fireEvent.press(screen.getByRole('button', { name: 'apiKeyPanel.addTokens' }))
  await fireEvent.press(screen.getByText('providerSettings.multipleTokens'))
  await fireEvent.changeText(screen.getByLabelText('providerSettings.tokens'), value)
}

it.each(['apiKeyPanel.saveTokens', 'settingsSubsystem.saveChoose'])('deduplicates secure stored keys on %s while preserving existing groups and model ownership', async action => {
  const original = fixture()
  const screen = await render(<Panel />)
  await enterBatch(screen, 'stored-key-a\nnew-key-c\nnew-key-d\nnew-key-c')
  expect(mockUpdate).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByRole('button', { name: action }))
  await waitFor(() => expect(mockFlush).toHaveBeenCalledTimes(1))
  const [id, patch, options] = mockUpdate.mock.calls[0]
  expect(id).toBe(original.id)
  expect(patch.credentialGroups).toHaveLength(4)
  expect(patch.credentialGroups.slice(0, 2)).toEqual(original.credentialGroups)
  expect(patch.credentialGroups.slice(2).map((row: { apiKey: string }) => row.apiKey)).toEqual(['new-key-c', 'new-key-d'])
  expect(patch.credentialSelection).toEqual(original.credentialSelection)
  expect(patch.enabledModels).toEqual(original.enabledModels)
  expect(patch.models).toEqual(original.models)
  expect(options).toMatchObject({ expectedProvider: original, preserveCredentialHealth: true })
})

it('keeps the batch draft and refuses persistence when secure credential hydration fails', async () => {
  const screen = await render(<Panel />)
  const draft = 'stored-key-a\nnew-key-c'
  await enterBatch(screen, draft)
  mockHydrate.mockRejectedValueOnce(Error('secure storage unavailable'))
  await fireEvent.press(screen.getByRole('button', { name: 'apiKeyPanel.saveTokens' }))
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'settingsWorkspace.saveFailed' })))
  expect(mockUpdate).not.toHaveBeenCalled()
  expect(mockFlush).not.toHaveBeenCalled()
  expect(screen.getByLabelText('providerSettings.tokens').props.value).toBe(draft)
})

it('retires a pending secure read on unmount before a batch save can write', async () => {
  const screen = await render(<Panel />)
  await enterBatch(screen, 'stored-key-a\nnew-key-c')
  let finish!: (provider: AIProvider) => void
  const pending = new Promise<AIProvider>(resolve => { finish = resolve })
  mockHydrate.mockClear().mockReturnValueOnce(pending)
  await fireEvent.press(screen.getByRole('button', { name: 'apiKeyPanel.saveTokens' }))
  await waitFor(() => expect(mockHydrate).toHaveBeenCalledTimes(1))
  await screen.unmount()
  await act(async () => { finish(fixture()); await pending })
  expect(mockUpdate).not.toHaveBeenCalled()
  expect(mockFlush).not.toHaveBeenCalled()
})
