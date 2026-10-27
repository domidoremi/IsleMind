import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { View } from 'react-native'
import { ApiKeyPanel } from '../ApiKeyPanel'
import { useSettingsStore } from '@/store/settingsStore'
import { useChatStore } from '@/store/chatStore'
import type { AIProvider } from '@/types/providerContracts'
import { DEFAULT_PROVIDER_PRESET_ID } from '@/modules/providers'
import { getProviderPreset } from '@/bootstrap/providerRegistry'

const mockToast = jest.fn()
const mockSync = jest.fn()
const mockProbe = jest.fn()
const mockActivate = jest.fn()
const mockFlushSettings = jest.fn()
const mockConfirm = jest.fn()
const mockRemove = jest.fn()
const mockClipboardHasText = jest.fn()
const mockClipboardText = jest.fn()
jest.mock('expo-clipboard', () => ({
  hasStringAsync: () => mockClipboardHasText(),
  getStringAsync: () => mockClipboardText(),
}))
jest.mock('expo-router', () => ({ useNavigation: jest.fn() }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, values?: { name?: string; count?: number }) => key === 'apiKeyPanel.providerSaved' ? `${key}:${values?.name}` : key === 'settingsSubsystem.modelCount' ? `${key}:${values?.count}` : key }) }))
jest.mock('moti', () => ({
  MotiView: require('react-native').View,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
jest.mock('@/components/ui/AppIcon', () => ({
  AppIcon: () => null,
  appIconStroke: { fine: 1.5, regular: 1.75, strong: 2 },
}))
jest.mock('@/components/settings/SettingsHelp', () => ({ SettingsHelpButton: () => null }))
jest.mock('@/components/ui/isle', () => ({
  ...jest.requireActual('@/components/ui/isle'),
  useIsleDialog: () => ({ toast: mockToast, notice: mockToast, confirm: mockConfirm }),
}))
jest.mock('@/bootstrap/providerRegistry', () => ({
  ...jest.requireActual('@/bootstrap/providerRegistry'),
  probeProviderPreset: (...args: unknown[]) => mockProbe(...args),
}))
jest.mock('@/bootstrap/providerActivationRuntime', () => ({ syncAndTestProvider: (...args: unknown[]) => mockSync(...args) }))
jest.mock('@/components/providers/useProviderActivationJob', () => ({
  useProviderActivationJob: () => ({ activateProviders: mockActivate, isActivationRunning: false }),
}))
jest.mock('@/presentation/features/settings/settingsStorePersistenceCommand', () => ({ flushPersistedSettings: () => mockFlushSettings() }))

const initialState = useSettingsStore.getState()
const mockFlushProviders = jest.fn()
const mockRemember = jest.fn()
const mockHydrate = jest.fn()
const mockUpdate = jest.fn()
const onUse = jest.fn()
let order: string[]
let allowedProbes = 0
const fixture = (): AIProvider => ({
  id: 'fixture', name: 'Fixture connection', type: getProviderPreset(DEFAULT_PROVIDER_PRESET_ID).type,
  apiKey: '', baseUrl: 'https://example.test/v1', enabled: false,
  models: ['fixture-model'], manualModels: ['fixture-model'], lastTestStatus: 'bad', lastTestCode: 'network_error',
  credentialGroups: [{ id: 'key-a', label: 'Key A', enabled: true, apiKey: '' }],
})

function Panel({ initialView = 'models' as 'models' | 'connection' }) {
  const provider = useSettingsStore(state => state.providers[0])
  return <ApiKeyPanel provider={provider} expanded hideHeader initialView={initialView} onUse={onUse} sortControl={<View testID="provider-order-control" />} />
}

beforeEach(() => {
  jest.clearAllMocks()
  mockConfirm.mockReset().mockResolvedValue(false)
  mockRemove.mockReset().mockResolvedValue(undefined)
  mockProbe.mockReset().mockResolvedValue({ presetId: DEFAULT_PROVIDER_PRESET_ID, confidence: 'low', reason: 'local fixture', ok: false })
  order = []
  allowedProbes = 0
  mockUpdate.mockImplementation(async (id: string, patch: Partial<AIProvider>) => {
    order.push('provider')
    useSettingsStore.setState(state => ({ providers: state.providers.map(item => item.id === id ? { ...item, ...patch } : item) }))
  })
  mockHydrate.mockImplementation(async () => {
    order.push('hydrate')
    return { ...useSettingsStore.getState().providers[0], apiKey: 'fixture-only-credential' }
  })
  mockFlushProviders.mockImplementation(async () => { order.push('providers-durable') })
  mockRemember.mockImplementation(async (providerId: string, model: string) => {
    order.push('model-durable')
    useSettingsStore.setState(state => ({ settings: { ...state.settings, lastPreferredModel: { schema: 'islemind.global-model-preference.v1', providerId, model } } }))
  })
  mockFlushSettings.mockImplementation(async () => { order.push('settings-durable') })
  useSettingsStore.setState({
    ...initialState, providers: [fixture()],
    settings: { ...initialState.settings, defaultProvider: null, lastPreferredModel: undefined },
    updateProvider: mockUpdate, hydrateProviderKey: mockHydrate,
    removeProvider: mockRemove,
    flushProviderPersistence: mockFlushProviders, rememberPreferredModel: mockRemember,
    updateSettings: patch => {
      order.push('settings')
      useSettingsStore.setState(state => ({ settings: { ...state.settings, ...patch } }))
    },
  })
})
afterEach(() => {
  expect(mockSync).not.toHaveBeenCalled()
  expect(mockProbe).toHaveBeenCalledTimes(allowedProbes)
  expect(mockActivate).not.toHaveBeenCalled()
  useSettingsStore.setState(initialState, true)
})

it('selects locally only after durable writes, retaining previous failure evidence and existing chats', async () => {
  const chats = useChatStore.getState().conversations
  let finish!: () => void
  mockFlushProviders.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const screen = await render(<Panel />)
  expect(mockHydrate).not.toHaveBeenCalled()
  expect(screen.queryByTestId('provider-usage-query-editor-fixture')).toBeNull()
  await fireEvent.press(screen.getByTestId('provider-use-model-fixture-model'))
  expect(onUse).not.toHaveBeenCalled()
  expect(mockRemember).not.toHaveBeenCalled()
  await act(async () => { finish() })
  await waitFor(() => expect(onUse).toHaveBeenCalledTimes(1))
  expect(order).toEqual(['hydrate', 'provider', 'model-durable', 'settings', 'settings-durable'])
  expect(useSettingsStore.getState().providers[0].lastTestStatus).toBe('bad')
  expect(useSettingsStore.getState().settings.defaultProvider).toBe('fixture')
  expect(useChatStore.getState().conversations).toBe(chats)
})

it('retains connection edits after failed persistence and does not report model selection', async () => {
  const screen = await render(<Panel />)
  await fireEvent.press(screen.getByRole('tab', { name: 'apiKeyPanel.workspaceConnection' }))
  await fireEvent.changeText(screen.getByDisplayValue('Fixture connection'), 'Renamed fixture')
  await fireEvent.press(screen.getByRole('tab', { name: 'apiKeyPanel.workspaceModels' }))
  mockFlushProviders.mockRejectedValueOnce(new Error('fixture disk failure'))
  await fireEvent.press(screen.getByTestId('provider-use-model-fixture-model'))
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'settingsWorkspace.saveFailed' })))
  expect(onUse).not.toHaveBeenCalled()
  expect(mockRemember).not.toHaveBeenCalled()
  expect(useSettingsStore.getState().settings.defaultProvider).toBeNull()
  await fireEvent.press(screen.getByRole('tab', { name: 'apiKeyPanel.workspaceConnection' }))
  expect(screen.getByDisplayValue('Renamed fixture')).toBeTruthy()
  await fireEvent.press(screen.getByRole('tab', { name: 'apiKeyPanel.workspaceModels' }))
  await fireEvent.press(screen.getByTestId('provider-use-model-fixture-model'))
  await waitFor(() => expect(onUse).toHaveBeenCalledTimes(1))
})

it('guides a missing credential back to Connection without claiming success', async () => {
  mockHydrate.mockImplementation(async () => fixture())
  const screen = await render(<Panel />)
  await fireEvent.press(screen.getByTestId('provider-use-model-fixture-model'))
  await waitFor(() => expect(screen.getByRole('alert').props.children).toBe('chat.providerMissingKey'))
  expect(screen.getByRole('tab', { name: 'apiKeyPanel.workspaceConnection' }).props.accessibilityState).toMatchObject({ selected: true })
  expect(mockUpdate).not.toHaveBeenCalled()
  expect(onUse).not.toHaveBeenCalled()
})

it('does not present restored empty credential groups as configured while reading or after readback', async () => {
  let resolve!: (provider: AIProvider) => void
  mockHydrate.mockImplementationOnce(() => new Promise<AIProvider>(done => { resolve = done }))
  const screen = await render(<Panel initialView="connection" />)
  expect(screen.queryByText(/settingsSubsystem.connectionReady/)).toBeNull()
  expect(screen.getAllByText(/common.loading/).length).toBeGreaterThan(0)
  await act(() => resolve(fixture()))
  expect(screen.queryByText(/settingsSubsystem.connectionReady/)).toBeNull()
  expect(screen.getAllByText(/settingsSubsystem.connectionMissing/).length).toBeGreaterThan(0)
  expect(screen.queryByText('apiKeyPanel.newTokenPending')).toBeNull()
  expect(mockUpdate).not.toHaveBeenCalled()
})

it('keeps a local credential read failure visible and retries without probing', async () => {
  mockHydrate.mockRejectedValueOnce(new Error('secure storage unavailable'))
  const screen = await render(<Panel initialView="connection" />)
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/settingsSubsystem\.loadFailed/))
  expect(screen.queryByText(/settingsSubsystem.connectionReady/)).toBeNull()
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  await waitFor(() => expect(screen.getByText(/settingsSubsystem.connectionReady/)).toBeTruthy())
  expect(screen.queryByRole('alert')).toBeNull()
  expect(mockHydrate).toHaveBeenCalledTimes(2)
  expect(mockUpdate).not.toHaveBeenCalled()
})

it('leaves an unfinished credential read without stale busy or late success status', async () => {
  let resolve!: (provider: AIProvider) => void
  mockHydrate.mockImplementationOnce(() => new Promise<AIProvider>(done => { resolve = done }))
  const screen = await render(<Panel initialView="connection" />)
  await fireEvent.press(screen.getByRole('tab', { name: 'apiKeyPanel.workspaceModels' }))
  expect(screen.getByText(/settingsSubsystem.savedNotVerified/)).toBeTruthy()
  expect(screen.queryByText(/common.loading/)).toBeNull()
  await act(() => resolve({ ...fixture(), apiKey: 'fixture-only-credential' }))
  expect(screen.queryByText(/settingsSubsystem.connectionReady/)).toBeNull()
})

it('searches beyond the render sample without mounting the whole catalog', async () => {
  const models = Array.from({ length: 140 }, (_, i) => 'fixture-model-' + i)
  useSettingsStore.setState({ providers: [{ ...fixture(), models, manualModels: models }] })
  const screen = await render(<Panel />)
  expect(screen.getByText('settingsSubsystem.modelCount:140')).toBeTruthy()
  expect(screen.queryByTestId('provider-use-model-fixture-model-139')).toBeNull()
  await fireEvent.changeText(screen.getByLabelText('providerSettings.searchModels'), 'model-139')
  expect(screen.getByTestId('provider-use-model-fixture-model-139')).toBeTruthy()
  expect(screen.getAllByTestId(/^provider-use-model-/)).toHaveLength(1)
  expect(mockHydrate).not.toHaveBeenCalled()
})

it('retains the discovered model count after saving a connection with no manual models', async () => {
  const models = ['remote-a', 'remote-b']
  useSettingsStore.setState({ providers: [{
    ...fixture(), models, manualModels: [], lastModelSyncStatus: 'ok',
    credentialGroups: [{ id: 'key-a', label: 'Key A', enabled: true, availableModels: models, lastModelSyncStatus: 'ok' }],
  }] })
  const screen = await render(<Panel initialView="connection" />)
  expect(screen.getByLabelText('providerSettings.baseUrl').props.keyboardType).toBe('url')
  expect(screen.getByText('settingsSubsystem.modelCount:2')).toBeTruthy()
  await fireEvent.press(screen.getByRole('button', { name: 'settingsSubsystem.saveChoose' }))
  await waitFor(() => expect(mockFlushProviders).toHaveBeenCalled())
  expect(useSettingsStore.getState().providers[0].models).toEqual([])
  expect(screen.getAllByTestId(/^provider-use-model-/)).toHaveLength(2)
  expect(screen.getByText('settingsSubsystem.modelCount:2')).toBeTruthy()
})

it('keeps credential replacement in the local draft until Connection is saved', async () => {
  const screen = await render(<Panel initialView="connection" />)
  await fireEvent.press(screen.getByRole('button', { name: 'providerSettings.replaceCredential' }))
  const input = screen.getByDisplayValue('')
  // The credential field is masked; no existing secret is copied into it.
  expect(input.props.secureTextEntry).toBe(true)
  await fireEvent.changeText(input, 'replacement-fixture-credential')
  expect(mockUpdate).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByRole('button', { name: 'settingsSubsystem.saveChoose' }))
  await waitFor(() => expect(mockFlushProviders).toHaveBeenCalled())
  expect(mockUpdate.mock.calls[0][1].credentialGroups[0]).toMatchObject({ id: 'key-a', apiKey: 'replacement-fixture-credential' })
  expect(screen.getByRole('button', { name: 'apiKeyPanel.fetchModelsAndTest' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'settingsSubsystem.saveChoose' })).toBeNull()
})

it('acknowledges the saved name rather than the previous provider name', async () => {
  const screen = await render(<Panel initialView="connection" />)
  await fireEvent.changeText(screen.getByDisplayValue('Fixture connection'), 'Renamed fixture')
  await fireEvent.press(screen.getByRole('button', { name: 'settingsSubsystem.saveChoose' }))
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'apiKeyPanel.providerSaved:Renamed fixture' })))
})

it('places catalog actions before model choices and keeps ordering in Advanced', async () => {
  const screen = await render(<Panel />)
  const buttons = screen.getAllByRole('button')
  expect(buttons.indexOf(screen.getByRole('button', { name: 'apiKeyPanel.fetchModelsAndTest' })))
    .toBeLessThan(buttons.indexOf(screen.getByTestId('provider-use-model-fixture-model')))
  expect(screen.queryByText('settingsUx.chooseModel')).toBeNull()
  expect(screen.queryByTestId('provider-order-control')).toBeNull()
  await fireEvent.press(screen.getByRole('button', { name: 'common.edit' }))
  expect(screen.queryByTestId('provider-model-choices')).toBeNull()
  await fireEvent.press(screen.getByRole('button', { name: 'common.cancel' }))
  expect(screen.getByTestId('provider-model-choices')).toBeTruthy()
  await fireEvent.press(screen.getByRole('tab', { name: 'apiKeyPanel.workspaceAdvanced' }))
  expect(screen.getByTestId('provider-order-control')).toBeTruthy()
  await fireEvent.press(screen.getByRole('tab', { name: 'apiKeyPanel.workspaceModels' }))
  expect(screen.queryByTestId('provider-order-control')).toBeNull()
})

it('offers connection setup rather than an unexplained disabled fetch for a missing credential', async () => {
  useSettingsStore.setState({ providers: [{ ...fixture(), credentialGroups: [] }] })
  const screen = await render(<Panel />)
  await fireEvent.press(screen.getByRole('button', { name: 'apiKeyPanel.configureConnection' }))
  expect(screen.getByRole('tab', { name: 'apiKeyPanel.workspaceConnection' }).props.accessibilityState).toMatchObject({ selected: true })
  expect(mockUpdate).not.toHaveBeenCalled()
})

it('preserves an unreadable token draft on Save and accepts an opaque token on retry without a request', async () => {
  const screen = await render(<Panel initialView="connection" />)
  await fireEvent.press(screen.getByRole('button', { name: 'apiKeyPanel.addTokens' }))
  await fireEvent.changeText(screen.getByLabelText('providerSettings.tokens'), 'paste your key here')
  await fireEvent.press(screen.getByRole('button', { name: 'settingsSubsystem.saveChoose' }))
  expect(screen.getByRole('alert')).toHaveTextContent('apiKeyPanel.invalidTokenInput')
  expect(screen.getByDisplayValue('paste your key here')).toBeTruthy()
  expect(mockUpdate).not.toHaveBeenCalled()
  expect(mockFlushProviders).not.toHaveBeenCalled()
  await fireEvent.changeText(screen.getByLabelText('providerSettings.tokens'), 'synthetic-local-only')
  await fireEvent.press(screen.getByRole('button', { name: 'settingsSubsystem.saveChoose' }))
  await waitFor(() => expect(mockFlushProviders).toHaveBeenCalledTimes(1))
  expect(useSettingsStore.getState().providers[0].credentialGroups?.map(group => group.apiKey)).toContain('synthetic-local-only')
  expect(screen.queryByText('apiKeyPanel.invalidTokenInput')).toBeNull()
})

it('keeps catalog failures visible in Models and Connection even without a stored message', async () => {
  useSettingsStore.setState({ providers: [{ ...fixture(), lastModelSyncStatus: 'bad' }] })
  const screen = await render(<Panel />)
  expect(screen.getByTestId('provider-model-sync-issue')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'apiKeyPanel.retryFetchModels' })).toBeTruthy()
  expect(screen.getByTestId('provider-use-model-fixture-model')).toBeTruthy()
  await fireEvent.press(screen.getByRole('button', { name: 'apiKeyPanel.configureConnection' }))
  expect(screen.getByTestId('provider-model-sync-issue')).toBeTruthy()
  await fireEvent.press(screen.getByRole('tab', { name: 'apiKeyPanel.workspaceModels' }))
  expect(screen.getByRole('button', { name: 'apiKeyPanel.retryFetchModels' })).toBeTruthy()
})

it('does not label a remembered model as default when its provider is not the default connection', async () => {
  useSettingsStore.setState(state => ({
    providers: [{ ...fixture(), enabled: true }],
    settings: { ...state.settings, defaultProvider: 'other', lastPreferredModel: { schema: 'islemind.global-model-preference.v1', providerId: 'fixture', model: 'fixture-model' } },
  }))
  const screen = await render(<Panel />)
  expect(screen.getByTestId('provider-use-model-fixture-model').props.accessibilityState.selected).toBe(false)
  await act(async () => useSettingsStore.setState(state => ({ settings: { ...state.settings, defaultProvider: 'fixture' } })))
  expect(screen.getByTestId('provider-use-model-fixture-model').props.accessibilityState.selected).toBe(true)
  expect(screen.getByText('settings.default')).toBeTruthy()
})

it('does not delete from a late approval after the provider editor unmounts', async () => {
  let approve!: (value: boolean) => void
  mockConfirm.mockReturnValueOnce(new Promise<boolean>(resolve => { approve = resolve }))
  const screen = await render(<Panel />)
  await fireEvent.press(screen.getByRole('tab', { name: 'apiKeyPanel.workspaceAdvanced' }))
  await fireEvent.press(screen.getByRole('button', { name: 'common.delete' }))
  const options = mockConfirm.mock.calls.at(-1)![0]
  await screen.unmount()
  await act(() => approve(true))
  expect(mockRemove).not.toHaveBeenCalled()
  expect(options.signal).toBeInstanceOf(AbortSignal)
  expect(options.signal.aborted).toBe(true)
})

it('binds provider saves and confirmed removal to the shown snapshot and screen signal', async () => {
  const expected = useSettingsStore.getState().providers[0]
  const screen = await render(<Panel initialView="connection" />)
  await fireEvent.changeText(screen.getByDisplayValue('Fixture connection'), 'Bound draft')
  await fireEvent.press(screen.getByRole('button', { name: 'settingsSubsystem.saveChoose' }))
  expect(mockUpdate.mock.calls[0][2]).toEqual({ expectedProvider: expected, signal: expect.any(AbortSignal) })
  await fireEvent.press(screen.getByRole('tab', { name: 'apiKeyPanel.workspaceAdvanced' }))
  const shown = useSettingsStore.getState().providers[0]
  mockConfirm.mockResolvedValueOnce(true)
  await fireEvent.press(screen.getByRole('button', { name: 'common.delete' }))
  expect(mockRemove).toHaveBeenCalledWith('fixture', { expectedProvider: shown, signal: expect.any(AbortSignal) })
})

it('detaches the reviewed delete target before awaiting confirmation', async () => {
  let approve!: (value: boolean) => void
  mockConfirm.mockReturnValueOnce(new Promise<boolean>(resolve => { approve = resolve }))
  const screen = await render(<Panel />)
  await fireEvent.press(screen.getByRole('tab', { name: 'apiKeyPanel.workspaceAdvanced' }))
  await fireEvent.press(screen.getByRole('button', { name: 'common.delete' }))
  useSettingsStore.getState().providers[0].name = 'mutated after prompt'
  await act(() => approve(true))
  expect(mockRemove).toHaveBeenCalledWith('fixture', {
    expectedProvider: expect.objectContaining({ name: 'Fixture connection' }),
    signal: expect.any(AbortSignal),
  })
})

it('does not enable or select a model from a late credential read after unmount', async () => {
  let hydrate!: (provider: AIProvider) => void
  mockHydrate.mockReturnValueOnce(new Promise<AIProvider>(resolve => { hydrate = resolve }))
  const screen = await render(<Panel />)
  await fireEvent.press(screen.getByTestId('provider-use-model-fixture-model'))
  await screen.unmount()
  await act(() => hydrate({ ...fixture(), apiKey: 'local-only' }))
  expect(mockUpdate).not.toHaveBeenCalled()
  expect(mockRemember).not.toHaveBeenCalled()
  expect(useSettingsStore.getState().settings.defaultProvider).toBeNull()
  expect(onUse).not.toHaveBeenCalled()
})

it('retains a newer default selection made while the old model choice waits for provider durability', async () => {
  let durable!: () => void
  mockFlushProviders.mockReturnValueOnce(new Promise<void>(resolve => { durable = resolve }))
  const screen = await render(<Panel />)
  await fireEvent.press(screen.getByTestId('provider-use-model-fixture-model'))
  await act(() => useSettingsStore.setState(state => ({ settings: { ...state.settings, defaultProvider: 'concurrent-choice' } })))
  await act(() => durable())
  expect(useSettingsStore.getState().settings.defaultProvider).toBe('concurrent-choice')
  expect(mockRemember).not.toHaveBeenCalled()
  expect(onUse).not.toHaveBeenCalled()
})

it('does not overwrite a newer model preference made while the remembered model becomes durable', async () => {
  let durable!: () => void
  mockRemember.mockImplementationOnce(async (providerId: string, model: string) => {
    useSettingsStore.setState(state => ({ settings: { ...state.settings, lastPreferredModel: { schema: 'islemind.global-model-preference.v1', providerId, model } } }))
    await new Promise<void>(resolve => { durable = resolve })
  })
  const screen = await render(<Panel />)
  await fireEvent.press(screen.getByTestId('provider-use-model-fixture-model'))
  await act(() => useSettingsStore.setState(state => ({ settings: { ...state.settings, lastPreferredModel: { schema: 'islemind.global-model-preference.v1', providerId: 'newer-provider', model: 'newer-model' } } })))
  await act(() => durable())
  expect(useSettingsStore.getState().settings.defaultProvider).toBeNull()
  expect(useSettingsStore.getState().settings.lastPreferredModel).toMatchObject({ providerId: 'newer-provider', model: 'newer-model' })
  expect(onUse).not.toHaveBeenCalled()
})

it.each(['default', 'model'])('does not acknowledge old selection after a newer %s choice during final settings persistence', async changed => {
  let durable!: () => void
  mockFlushSettings.mockReturnValueOnce(new Promise<void>(resolve => { durable = resolve }))
  const screen = await render(<Panel />)
  await fireEvent.press(screen.getByTestId('provider-use-model-fixture-model'))
  expect(useSettingsStore.getState().settings.defaultProvider).toBe('fixture')
  await act(() => useSettingsStore.setState(state => ({ settings: {
    ...state.settings,
    ...(changed === 'default' ? { defaultProvider: 'newer-provider' } : {
      lastPreferredModel: { schema: 'islemind.global-model-preference.v1' as const, providerId: 'newer-provider', model: 'newer-model' },
    }),
  } })))
  await act(() => durable())
  expect(onUse).not.toHaveBeenCalled()
  expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'providerSettings.modelSelected' }))
  expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'settingsWorkspace.conflict' }))
})

it('uses the existing lifetime-bound discard guard for Reset and serializes it with Reload', async () => {
  let approve!: (value: boolean) => void
  mockConfirm.mockReturnValueOnce(new Promise<boolean>(resolve => { approve = resolve }))
  const screen = await render(<Panel initialView="connection" />)
  await fireEvent.changeText(screen.getByDisplayValue('Fixture connection'), 'Unsaved reset draft')
  await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.reset' }))
  const options = mockConfirm.mock.calls.at(-1)![0]
  await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.reload' }))
  expect(mockConfirm).toHaveBeenCalledTimes(1)
  await screen.unmount()
  await act(() => approve(true))
  expect(options.signal).toBeInstanceOf(AbortSignal)
  expect(options.signal.aborted).toBe(true)
  expect(mockUpdate).not.toHaveBeenCalled()
})

it('does not acknowledge a disabled connection before its provider metadata is durable', async () => {
  useSettingsStore.setState({ providers: [{ ...fixture(), enabled: true }] })
  let durable!: () => void
  mockFlushProviders.mockReturnValueOnce(new Promise<void>(resolve => { durable = resolve }))
  const screen = await render(<Panel initialView="connection" />)
  const shown = useSettingsStore.getState().providers[0]
  await fireEvent.press(screen.getByRole('switch', { name: /settingsUx.useConnection/ }))
  expect(mockUpdate).toHaveBeenCalledWith('fixture', { enabled: false }, { expectedProvider: shown, signal: expect.any(AbortSignal) })
  expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'apiKeyPanel.providerDisabled' }))
  await act(() => durable())
  expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'apiKeyPanel.providerDisabled' }))
  expect(mockProbe).not.toHaveBeenCalled()
})

it('does not enable a connection after the saved form waits across unmount', async () => {
  let durable!: () => void
  mockFlushProviders.mockReturnValueOnce(new Promise<void>(resolve => { durable = resolve }))
  const screen = await render(<Panel initialView="connection" />)
  await fireEvent.press(screen.getByRole('switch', { name: /settingsUx.useConnection/ }))
  await screen.unmount()
  await act(() => durable())
  expect(mockUpdate.mock.calls.some(([, patch]) => patch.enabled === true)).toBe(false)
  expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'providerSettings.configurationSaved' }))
})

it('enables the saved connection using its post-save snapshot rather than stale render props', async () => {
  const screen = await render(<Panel initialView="connection" />)
  await fireEvent.changeText(screen.getByDisplayValue('Fixture connection'), 'Saved enabled connection')
  await fireEvent.press(screen.getByRole('switch', { name: /settingsUx.useConnection/ }))
  const call = mockUpdate.mock.calls.find(([, patch]) => patch.enabled === true)
  expect(call).toBeDefined()
  expect(call![2]).toMatchObject({
    expectedProvider: { name: 'Saved enabled connection', lastTestStatus: 'idle', enabled: false },
    signal: expect.any(AbortSignal),
  })
  expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'providerSettings.configurationSaved' }))
  expect(mockProbe).not.toHaveBeenCalled()
})

it('does not read or apply clipboard contents after a late availability result on an unmounted editor', async () => {
  let available!: (value: boolean) => void
  mockClipboardHasText.mockReturnValueOnce(new Promise<boolean>(resolve => { available = resolve }))
  const screen = await render(<Panel initialView="connection" />)
  await fireEvent.press(screen.getByRole('button', { name: 'settings.pasteClipboard' }))
  await screen.unmount()
  await act(() => available(true))
  expect(mockClipboardText).not.toHaveBeenCalled()
  expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'providerSettings.clipboardRead' }))
})

it('does not start interface probing from a credential read completed after unmount', async () => {
  let hydrate!: (value: AIProvider) => void
  mockHydrate.mockReturnValueOnce(new Promise<AIProvider>(resolve => { hydrate = resolve }))
  const screen = await render(<Panel />)
  await fireEvent.press(screen.getByRole('tab', { name: 'apiKeyPanel.workspaceAdvanced' }))
  await fireEvent.press(screen.getByRole('button', { name: 'apiKeyPanel.detectInterface' }))
  await screen.unmount()
  await act(() => hydrate({ ...fixture(), apiKey: 'local-probe-placeholder' }))
  expect(mockProbe).not.toHaveBeenCalled()
  expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'apiKeyPanel.interfaceProbeDone' }))
})

it('passes the editor signal to explicit probing and discards a late result', async () => {
  allowedProbes = 1
  let complete!: (value: ReturnType<typeof getProviderPreset> & { presetId: typeof DEFAULT_PROVIDER_PRESET_ID; confidence: 'low'; reason: string; ok: boolean }) => void
  mockProbe.mockReturnValueOnce(new Promise(resolve => { complete = resolve }))
  const screen = await render(<Panel />)
  await fireEvent.press(screen.getByRole('tab', { name: 'apiKeyPanel.workspaceAdvanced' }))
  await fireEvent.press(screen.getByRole('button', { name: 'apiKeyPanel.detectInterface' }))
  expect(mockProbe).toHaveBeenCalledTimes(1)
  const signal = mockProbe.mock.calls[0][1]?.signal
  await screen.unmount()
  await act(() => complete({ ...getProviderPreset(DEFAULT_PROVIDER_PRESET_ID), presetId: DEFAULT_PROVIDER_PRESET_ID, confidence: 'low', reason: 'local fixture', ok: true }))
  expect(signal).toBeInstanceOf(AbortSignal)
  expect(signal.aborted).toBe(true)
  expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'apiKeyPanel.interfaceProbeDone' }))
})

it('binds immediate compatibility changes to the shown configuration and waits for persistence', async () => {
  let durable!: () => void
  mockFlushProviders.mockReturnValueOnce(new Promise<void>(resolve => { durable = resolve }))
  const screen = await render(<Panel />)
  await fireEvent.press(screen.getByRole('tab', { name: 'apiKeyPanel.workspaceAdvanced' }))
  const shown = useSettingsStore.getState().providers[0]
  await fireEvent.press(screen.getByRole('button', { name: 'providerSettings.clientCompatibility.islemind' }))
  expect(mockUpdate.mock.calls[0]?.[2]).toEqual({ expectedProvider: shown, signal: expect.any(AbortSignal) })
  expect(mockFlushProviders).toHaveBeenCalledTimes(1)
  await screen.unmount()
  await act(() => durable())
  expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'providerSettings.configurationSaved' }))
  expect(mockProbe).not.toHaveBeenCalled()
})

it('keeps capability declarations local and does not acknowledge them before provider durability', async () => {
  let durable!: () => void
  mockFlushProviders.mockReturnValueOnce(new Promise<void>(resolve => { durable = resolve }))
  const screen = await render(<Panel />)
  await fireEvent.press(screen.getByRole('tab', { name: 'apiKeyPanel.workspaceAdvanced' }))
  await fireEvent.press(screen.getByRole('button', { name: /apiKeyPanel.capabilityMatrix\./ }))
  const shown = useSettingsStore.getState().providers[0]
  await fireEvent.press(screen.getByRole('checkbox', { name: 'apiKeyPanel.capability.nativeTools' }))
  expect(mockUpdate).toHaveBeenCalledWith('fixture', { capabilities: expect.objectContaining({ nativeTools: true }) }, {
    expectedProvider: shown, signal: expect.any(AbortSignal),
  })
  expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'apiKeyPanel.capabilityUpdated' }))
  await act(() => durable())
  expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'apiKeyPanel.capabilityUpdated', message: 'apiKeyPanel.capability.nativeTools' }))
  expect(mockProbe).not.toHaveBeenCalled()
})
