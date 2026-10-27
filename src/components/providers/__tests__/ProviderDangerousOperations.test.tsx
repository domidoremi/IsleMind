import { act, fireEvent, render } from '@testing-library/react-native'
import { ProviderSettingsContent } from '../ProviderSettingsContent'
import { useSettingsStore } from '@/store/settingsStore'
import type { AIProvider } from '@/types/providerContracts'
import { DEFAULT_PROVIDER_PRESET_ID } from '@/modules/providers'
import { getProviderPreset } from '@/bootstrap/providerRegistry'
import { IsleThemeProvider } from '@/components/ui/isle/IsleThemeProvider'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import type { ActivationJobState } from '@/store/activationJobStore'

let mockTheme: CanonicalThemeId = 'minimal'
let mockActivationJob: ActivationJobState | null = null
const mockConfirm = jest.fn()
const mockToast = jest.fn()
const mockRemove = jest.fn()
const mockClearAll = jest.fn()
const mockClearInvalid = jest.fn()
const mockListInvalid = jest.fn()
const mockFlush = jest.fn()
const mockFlushSettings = jest.fn()
jest.mock('expo-router', () => ({ useNavigation: jest.fn(), router: { back: jest.fn(), canGoBack: () => true } }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors('light', mockTheme), canonicalThemeId: mockTheme, mode: 'light', isDark: false }) }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('@/components/settings/SettingsHelp', () => ({ SettingsHelpButton: () => null }))
jest.mock('moti', () => ({ MotiView: require('react-native').View }))
jest.mock('@/components/providers/useProviderActivationJob', () => ({
  useProviderActivationJob: () => ({ activationBusy: mockActivationJob?.status === 'running', activationJob: mockActivationJob, clearActivationJob: jest.fn(), isActivationRunning: mockActivationJob?.status === 'running' }),
}))
jest.mock('@/bootstrap/providerUsageRuntime', () => ({ invalidateProviderUsage: jest.fn() }))
jest.mock('@/presentation/features/settings/settingsStorePersistenceCommand', () => ({ flushPersistedSettings: () => mockFlushSettings() }))
jest.mock('@/components/ui/isle', () => {
  const { Pressable, Text, View, TextInput } = require('react-native')
  const Button = ({ label, ...props }: any) => <Pressable accessibilityRole="button" accessibilityLabel={label} {...props}><Text>{label}</Text></Pressable>
  return { ISLE_MIN_TOUCH_TARGET: 44, IslePressable: Pressable, IsleOverlayPressable: Pressable, IsleButton: Button, IsleIconButton: Button, IsleProgress: jest.requireActual('@/components/ui/isle/IsleKit').IsleProgress,
    IsleField: ({ label, inputProps }: any) => <TextInput accessibilityLabel={label} {...inputProps} />,
    useIsleDialog: () => ({ confirm: mockConfirm, toast: mockToast, notice: mockToast }) }
})

const initialState = useSettingsStore.getState()
const provider = (id = 'shown'): AIProvider => ({ id, name: id, type: getProviderPreset(DEFAULT_PROVIDER_PRESET_ID).type, apiKey: '', baseUrl: 'https://example.invalid/v1', models: [], enabled: false })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
beforeEach(() => {
  jest.clearAllMocks()
  mockTheme = 'minimal'
  mockActivationJob = null
  mockConfirm.mockReset().mockResolvedValue(false)
  mockClearAll.mockResolvedValue(undefined)
  mockClearInvalid.mockResolvedValue(1)
  mockListInvalid.mockResolvedValue([provider()])
  mockRemove.mockResolvedValue(undefined)
  mockFlush.mockResolvedValue(undefined)
  mockFlushSettings.mockResolvedValue(undefined)
  useSettingsStore.setState({ ...initialState, providers: [provider()], settings: { ...initialState.settings, defaultProvider: 'shown' },
    removeProvider: mockRemove, clearAllProviders: mockClearAll, clearInvalidProviders: mockClearInvalid, listInvalidProviders: mockListInvalid,
    flushProviderPersistence: mockFlush, compactProviderStorage: jest.fn(() => false) })
})
afterEach(() => useSettingsStore.setState(initialState, true))

it.each(CANONICAL_THEME_IDS)('names actual %s activation bars by task/provider and updates terminal status without changing selections', async family => {
  mockTheme = family
  mockActivationJob = {
    id: 'host-progress-only', status: 'running', total: 2, completed: 0, synced: 0, tested: 0, failed: 0, updatedAt: 1,
    items: [
      { providerId: 'first', providerName: 'First fixture', status: 'running', progress: 0.25, synced: false, tested: false, failed: false },
      { providerId: 'second', providerName: 'Second fixture', status: 'queued', progress: 0, synced: false, tested: false, failed: false },
    ],
  }
  const settings = useSettingsStore.getState().settings
  const providers = useSettingsStore.getState().providers
  const tree = () => <IsleThemeProvider><ProviderSettingsContent embedded /></IsleThemeProvider>
  const screen = await render(tree())
  const now = (name: string) => {
    const bar = screen.getByRole('progressbar', { name })
    return bar.props['aria-valuenow'] ?? bar.props.accessibilityValue?.now
  }
  expect(now('providerSettings.activationRunning')).toBe(13)
  expect(now('First fixture \u00b7 providerSettings.activationRunning')).toBe(25)
  expect(now('Second fixture \u00b7 providerSettings.activationQueued')).toBe(0)
  mockActivationJob = {
    ...mockActivationJob, status: 'done', completed: 2, failed: 1, synced: 1, tested: 1,
    items: [
      { ...mockActivationJob.items![0], status: 'failed', progress: 1, failed: true },
      { ...mockActivationJob.items![1], status: 'done', progress: 1, synced: true, tested: true },
    ],
  }
  await screen.rerender(tree())
  expect(now('providerSettings.activationBatchDone')).toBe(100)
  expect(now('First fixture \u00b7 providerSettings.activationNeedsCheck')).toBe(100)
  expect(now('Second fixture \u00b7 providerSettings.activationSuccess')).toBe(100)
  expect(screen.queryByRole('progressbar', { name: 'First fixture \u00b7 providerSettings.activationRunning' })).toBeNull()
  expect(useSettingsStore.getState().settings).toBe(settings)
  expect(useSettingsStore.getState().providers).toBe(providers)
  expect(mockRemove).not.toHaveBeenCalled()
  expect(mockClearAll).not.toHaveBeenCalled()
  await screen.unmount()
})

async function managementScreen() {
  const screen = await render(<ProviderSettingsContent embedded />)
  await fireEvent.press(screen.getByLabelText('providerSettings.manageConnections'))
  return screen
}

it('binds broad-clear approval to the shown catalog and reports completion only after durability', async () => {
  const expected = useSettingsStore.getState().providers
  const confirmation = deferred<boolean>()
  const durability = deferred<void>()
  mockConfirm.mockReturnValueOnce(confirmation.promise)
  mockFlush.mockReturnValueOnce(durability.promise)
  const screen = await managementScreen()
  await fireEvent.press(screen.getByLabelText('providerSettings.clearAll'))
  await act(() => useSettingsStore.setState({ providers: [...expected, provider('new-concurrent')] }))
  await act(() => confirmation.resolve(true))
  expect(mockClearAll).toHaveBeenCalledWith({ expectedProviders: expected, signal: expect.any(AbortSignal) })
  expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'providerSettings.clearAllDone' }))
  await act(() => durability.resolve())
  expect(mockFlushSettings).toHaveBeenCalled()
})

it.each(['providerSettings.clearAll', 'providerSettings.clearInvalid'])('does not apply a late %s confirmation after unmount', async label => {
  const confirmation = deferred<boolean>()
  mockConfirm.mockReturnValueOnce(confirmation.promise)
  const screen = await managementScreen()
  await fireEvent.press(screen.getByLabelText(label))
  const options = mockConfirm.mock.calls.at(-1)![0]
  await screen.unmount()
  await act(() => confirmation.resolve(true))
  expect(mockClearAll).not.toHaveBeenCalled()
  expect(mockClearInvalid).not.toHaveBeenCalled()
  expect(options.signal).toBeInstanceOf(AbortSignal)
  expect(options.signal.aborted).toBe(true)
})

it('serializes dangerous prompts across clear variants and retries after a refused prompt', async () => {
  const confirmation = deferred<boolean>()
  mockConfirm.mockReturnValueOnce(confirmation.promise)
  const screen = await managementScreen()
  await fireEvent.press(screen.getByLabelText('providerSettings.clearAll'))
  await fireEvent.press(screen.getByLabelText('providerSettings.clearInvalid'))
  expect(mockConfirm).toHaveBeenCalledTimes(1)
  await act(() => confirmation.resolve(false))
  await fireEvent.press(screen.getByLabelText('providerSettings.clearInvalid'))
  expect(mockConfirm).toHaveBeenCalledTimes(2)
  expect(mockClearInvalid).not.toHaveBeenCalled()
})

it('passes the reviewed invalid-provider snapshots instead of treating IDs as permission to delete replacements', async () => {
  const expected = [provider()]
  mockListInvalid.mockResolvedValueOnce(expected)
  mockConfirm.mockResolvedValueOnce(true)
  const screen = await managementScreen()
  await fireEvent.press(screen.getByLabelText('providerSettings.clearInvalid'))
  expect(mockClearInvalid).toHaveBeenCalledWith(['shown'], { expectedProviders: expected, signal: expect.any(AbortSignal) })
  expect(mockFlush).toHaveBeenCalledTimes(1)
  expect(mockFlushSettings).toHaveBeenCalledTimes(1)
})

it('fails a rejected dangerous prompt closed and releases the prompt lock', async () => {
  mockConfirm.mockRejectedValueOnce(new Error('dialog unavailable'))
  const screen = await managementScreen()
  await fireEvent.press(screen.getByLabelText('providerSettings.clearAll'))
  await fireEvent.press(screen.getByLabelText('providerSettings.clearAll'))
  expect(mockConfirm).toHaveBeenCalledTimes(2)
  expect(mockClearAll).not.toHaveBeenCalled()
  expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'providerSettings.clearAllDone' }))
})

it('does not claim existing data was kept when selected deletion succeeded but its durable write failed', async () => {
  mockRemove.mockImplementationOnce(async id => {
    useSettingsStore.setState(state => ({ providers: state.providers.filter(item => item.id !== id) }))
  })
  mockFlush.mockRejectedValueOnce(new Error('local disk failure'))
  mockConfirm.mockResolvedValueOnce(true)
  const screen = await managementScreen()
  await fireEvent.press(screen.getByRole('button', { name: 'providerSettings.selectionMode' }))
  await fireEvent.press(screen.getByRole('checkbox', { name: 'providerSettings.selectProvider shown' }))
  await fireEvent.press(screen.getByRole('button', { name: 'providerSettings.deleteSelected' }))
  expect(mockRemove).toHaveBeenCalledTimes(1)
  expect(useSettingsStore.getState().providers).toEqual([])
  expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
    title: 'providerSettings.deleteSupplierFailed', message: 'settingsWorkspace.saveFailed',
  }))
  expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ message: 'providerSettings.deleteSupplierFailedMessage' }))
})

it('keeps selected deletions serial and stops further mutations after unmount during the first durability wait', async () => {
  useSettingsStore.setState({ providers: [provider('shown'), provider('second')] })
  let durable!: () => void
  mockFlush.mockReturnValueOnce(new Promise<void>(resolve => { durable = resolve }))
  mockConfirm.mockResolvedValueOnce(true)
  const screen = await managementScreen()
  await fireEvent.press(screen.getByRole('button', { name: 'providerSettings.selectionMode' }))
  await fireEvent.press(screen.getByRole('checkbox', { name: 'providerSettings.selectProvider shown' }))
  await fireEvent.press(screen.getByRole('checkbox', { name: 'providerSettings.selectProvider second' }))
  await fireEvent.press(screen.getByRole('button', { name: 'providerSettings.deleteSelected' }))
  await screen.unmount()
  await act(() => durable())
  expect(mockRemove).toHaveBeenCalledTimes(1)
  expect(mockRemove).toHaveBeenCalledWith('shown', { expectedProvider: provider('shown'), signal: expect.any(AbortSignal) })
  expect(mockFlushSettings).toHaveBeenCalledTimes(1)
  expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'providerSettings.deleteSupplierDone' }))
})
