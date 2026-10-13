import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { ApiKeyPanel } from '../ApiKeyPanel'
import { useSettingsStore } from '@/store/settingsStore'
import type { AIProvider } from '@/types/providerContracts'
import { DEFAULT_PROVIDER_PRESET_ID } from '@/modules/providers'
import { getProviderPreset } from '@/bootstrap/providerRegistry'

const mockSync = jest.fn()
const mockToast = jest.fn()
jest.mock('expo-router', () => ({ useNavigation: jest.fn() }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('moti', () => ({
  MotiView: require('react-native').View,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
jest.mock('@/components/ui/AppIcon', () => ({
  AppIcon: () => null,
  appIconStroke: { fine: 1.5, regular: 1.75, strong: 2 },
}))
jest.mock('@/components/ui/isle', () => ({
  ...jest.requireActual('@/components/ui/isle'),
  useIsleDialog: () => ({ toast: mockToast, notice: jest.fn(), confirm: jest.fn() }),
}))
jest.mock('@/bootstrap/providerActivationRuntime', () => ({
  syncAndTestProvider: (...args: unknown[]) => mockSync(...args),
}))
jest.mock('@/components/providers/useProviderActivationJob', () => ({
  useProviderActivationJob: () => ({ isActivationRunning: false }),
}))

const initialState = useSettingsStore.getState()
const fixture: AIProvider = {
  id: 'discovery-fixture', name: 'Local catalog fixture', type: getProviderPreset(DEFAULT_PROVIDER_PRESET_ID).type,
  baseUrl: 'https://catalog.invalid/v1', apiKey: '', enabled: false,
  models: ['saved-model'], manualModels: ['saved-model'],
  credentialGroups: [{ id: 'fixture-key', label: 'Fixture key', enabled: true }],
}

function Panel() {
  const provider = useSettingsStore(state => state.providers[0])
  return <ApiKeyPanel provider={provider} expanded hideHeader />
}

beforeEach(() => {
  jest.clearAllMocks()
  useSettingsStore.setState({
    ...initialState,
    providers: [fixture],
    settings: { ...initialState.settings, defaultProvider: null, lastPreferredModel: undefined },
    updateProvider: async (id, patch) => {
      useSettingsStore.setState(state => ({ providers: state.providers.map(item => item.id === id ? { ...item, ...patch } : item) }))
    },
    hydrateProviderKey: async () => ({ ...useSettingsStore.getState().providers[0], apiKey: 'synthetic-only' }),
    flushProviderPersistence: async () => undefined,
  })
})

afterEach(() => useSettingsStore.setState(initialState, true))

it('shows a thrown discovery failure inline, unlocks retry and keeps existing models without automatic activation', async () => {
  let reject!: (error: Error) => void
  mockSync.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
  const screen = await render(<Panel />)
  expect(mockSync).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByRole('button', { name: 'apiKeyPanel.fetchModelsAndTest' }))
  await waitFor(() => expect(mockSync).toHaveBeenCalledTimes(1))
  expect(mockToast).not.toHaveBeenCalled()
  const pending = screen.getByRole('button', { name: 'apiKeyPanel.fetchAndTestStarted' })
  expect(pending.props.accessibilityState.disabled).toBe(true)
  await fireEvent.press(pending)
  expect(mockSync).toHaveBeenCalledTimes(1)
  await act(async () => reject(new Error('Synthetic transport failure')))
  expect(screen.getByTestId('provider-model-sync-issue')).toBeTruthy()
  expect(screen.getByText('apiKeyPanel.modelFetchFailed')).toBeTruthy()
  expect(screen.queryByText('Synthetic transport failure')).toBeNull()
  expect(screen.getByTestId('provider-use-model-saved-model')).toBeTruthy()

  mockSync.mockImplementationOnce(async () => {
    await useSettingsStore.getState().updateProvider(fixture.id, {
      lastModelSyncStatus: 'ok',
      credentialGroups: [{ ...fixture.credentialGroups![0], lastModelSyncStatus: 'ok', availableModels: ['fetched-model'] }],
    })
    return { ready: false, synced: true, missingToken: false, failures: [] }
  })
  await fireEvent.press(screen.getByRole('button', { name: 'apiKeyPanel.retryFetchModels' }))
  await waitFor(() => expect(screen.queryByTestId('provider-model-sync-issue')).toBeNull())
  expect(mockSync).toHaveBeenCalledTimes(2)
  for (const call of mockSync.mock.calls) {
    expect(call[2]).toMatchObject({ enable: false, testModels: false, signal: expect.any(AbortSignal) })
  }
  expect(screen.getByTestId('provider-use-model-saved-model')).toBeTruthy()
  expect(screen.getByTestId('provider-use-model-fetched-model')).toBeTruthy()
  expect(useSettingsStore.getState().providers[0].enabled).toBe(false)
  expect(useSettingsStore.getState().settings.defaultProvider).toBeNull()
  expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'apiKeyPanel.fetchAndTestDone' }))
})

it('aborts the owned discovery when the detail unmounts without reporting success', async () => {
  let signal!: AbortSignal
  mockSync.mockImplementationOnce((_provider, _ports, options) => new Promise((_resolve, reject) => {
    signal = options.signal
    signal.addEventListener('abort', () => reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' })), { once: true })
  }))
  const screen = await render(<Panel />)
  await fireEvent.press(screen.getByRole('button', { name: 'apiKeyPanel.fetchModelsAndTest' }))
  await waitFor(() => expect(mockSync).toHaveBeenCalledTimes(1))
  await screen.unmount()
  expect(signal.aborted).toBe(true)
  expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'apiKeyPanel.fetchAndTestDone' }))
})

it('filters configured models locally and provides an accessible clear action', async () => {
  const models = Array.from({ length: 6 }, (_, index) => `saved-model-${index}`)
  useSettingsStore.setState({ providers: [{ ...fixture, models, manualModels: models }] })
  const screen = await render(<Panel />)
  await fireEvent.changeText(screen.getByLabelText('providerSettings.searchModels'), 'model-5')
  expect(screen.getByTestId('provider-use-model-saved-model-5')).toBeTruthy()
  expect(screen.queryByTestId('provider-use-model-saved-model-0')).toBeNull()
  await fireEvent.press(screen.getByLabelText('common.clearSearch'))
  expect(screen.getByTestId('provider-use-model-saved-model-0')).toBeTruthy()
  expect(mockSync).not.toHaveBeenCalled()
})
