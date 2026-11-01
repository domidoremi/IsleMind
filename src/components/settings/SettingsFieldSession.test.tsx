import { act, fireEvent, render, renderHook } from '@testing-library/react-native'
import { SavedSettingsField, useSettingsFieldSession } from './SettingsFieldSession'
let mockSettings: Record<string, unknown>
const mockFlush = jest.fn()
const mockToast = jest.fn()
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: { getState: () => ({ settings: mockSettings }) } }))
jest.mock('@/presentation/features/settings/settingsStorePersistenceCommand', () => ({ flushPersistedSettings: () => mockFlush() }))
jest.mock('./SettingsEditBoundary', () => ({ ...jest.requireActual('./SettingsEditBoundary'), useSettingsDraft: jest.fn() }))
jest.mock('expo-router', () => ({ useNavigation: jest.fn() }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors('light', 'minimal') }) }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('moti', () => ({ MotiView: require('react-native').View }))
jest.mock('@/components/ui/isle', () => {
  const { View, Pressable: MockPressable, Text, TextInput } = require('react-native')
  return { useIsleDialog: () => ({ toast: mockToast }), IslePressable: MockPressable, IsleInput: TextInput,
    IsleField: ({ label, labelAccessory, inputProps }: any) => <View>{labelAccessory}<TextInput accessibilityLabel={label} {...inputProps} /></View>,
    IsleButton: ({ label, ...props }: any) => <MockPressable accessibilityRole="button" {...props}><Text>{label}</Text></MockPressable>,
    IsleSelect: ({ options, onChange, disabled }: any) => <View>{options.map((option: any) => <MockPressable key={option.value} accessibilityLabel={option.label} disabled={disabled} onPress={() => onChange(option.value)}><Text>{option.label}</Text></MockPressable>)}</View>,
  }
})
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
beforeEach(() => { jest.clearAllMocks(); mockSettings = {}; mockFlush.mockResolvedValue(undefined) })
it('retains parent-owned input and detects an external change from an undefined baseline', async () => {
  const hook = await renderHook(useSettingsFieldSession)
  await act(() => hook.result.current.edit('proxyBaseUrl', 'https://draft.invalid', ''))
  mockSettings.proxyBaseUrl = 'https://external.invalid'
  await act(() => hook.result.current.edit('proxyBaseUrl', 'https://draft.invalid/v1', 'https://external.invalid'))
  const commit = jest.fn()
  await act(() => hook.result.current.save('proxyBaseUrl', commit, value => value))
  expect(commit).not.toHaveBeenCalled()
  expect(hook.result.current.entries.proxyBaseUrl?.draft).toBe('https://draft.invalid/v1')
  expect(mockToast).not.toHaveBeenCalled()
  expect(hook.result.current.entries.proxyBaseUrl?.error).toBe('conflict')
})
it('preserves failed writes for retry, and resets explicitly without committing', async () => {
  const hook = await renderHook(useSettingsFieldSession)
  await act(() => hook.result.current.edit('proxyBaseUrl', 'https://draft.invalid', ''))
  const commit = jest.fn(value => { mockSettings.proxyBaseUrl = value })
  mockFlush.mockRejectedValueOnce(new Error('disk unavailable'))
  await act(() => hook.result.current.save('proxyBaseUrl', commit, value => value))
  expect(hook.result.current.entries.proxyBaseUrl).toBeDefined()
  expect(hook.result.current.entries.proxyBaseUrl?.error).toBe('saveFailed')
  await act(() => hook.result.current.save('proxyBaseUrl', commit, value => value))
  expect(hook.result.current.entries.proxyBaseUrl).toBeUndefined()
  await act(() => hook.result.current.edit('proxyBaseUrl', 'another input', 'https://draft.invalid'))
  await act(() => hook.result.current.discard('proxyBaseUrl'))
  expect(commit).toHaveBeenCalledTimes(2)
  expect(hook.result.current.entries.proxyBaseUrl).toBeUndefined()
})

it('shows pending only on the saving field and validates the fixed receipt against durable settings', async () => {
  let finish!: () => void
  mockFlush.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  function Fields() {
    const session = useSettingsFieldSession()
    return <>
      <SavedSettingsField session={session} settingKey="proxyBaseUrl" label="Proxy" value={String(mockSettings.proxyBaseUrl ?? '')} onCommit={value => { mockSettings.proxyBaseUrl = value }} />
      <SavedSettingsField session={session} settingKey="assistantDisplayName" label="Name" value={String(mockSettings.assistantDisplayName ?? '')} onCommit={value => { mockSettings.assistantDisplayName = value }} />
    </>
  }
  const view = await render(<Fields />)
  const proxyStatus = view.getByTestId('settings-field-proxyBaseUrl-status')
  const nameStatus = view.getByTestId('settings-field-assistantDisplayName-status')
  await fireEvent.changeText(view.getByLabelText('Proxy'), 'https://draft.invalid')
  await fireEvent.press(view.getByRole('button', { name: 'settingsWorkspace.save' }))
  expect(proxyStatus.props.accessibilityState.busy).toBe(true)
  expect(nameStatus.props.accessibilityState.busy).toBe(false)
  expect(proxyStatus.props.accessibilityLabel).toBe('settingsWorkspace.saving')
  expect(view.queryByText('settingsWorkspace.saved')).toBeNull()
  await act(() => finish())
  expect(view.getByTestId('settings-field-proxyBaseUrl-status')).toBe(proxyStatus)
  expect(proxyStatus.props.accessibilityLabel).toBe('settingsWorkspace.saved')
  expect(proxyStatus).toHaveStyle({ width: 18, height: 18 })
  expect(nameStatus.props.accessibilityLabel).toBeUndefined()
  mockSettings.proxyBaseUrl = 'https://external.invalid'
  await view.rerender(<Fields />)
  expect(proxyStatus.props.accessibilityLabel).toBeUndefined()
  expect(view.queryByText('settingsWorkspace.saved')).toBeNull()
})

it.each(['resolve', 'reject'])('suppresses late save feedback after unmount when persistence will %s', async outcome => {
  let resolve!: () => void
  let reject!: (error: Error) => void
  mockFlush.mockImplementationOnce(() => new Promise<void>((yes, no) => { resolve = yes; reject = no }))
  const hook = await renderHook(useSettingsFieldSession)
  await act(() => hook.result.current.edit('proxyBaseUrl', 'draft', ''))
  const commit = jest.fn(value => { mockSettings.proxyBaseUrl = value })
  let saving!: Promise<void>
  await act(() => { saving = hook.result.current.save('proxyBaseUrl', commit, value => value) })
  await hook.unmount()
  await act(async () => { if (outcome === 'resolve') resolve(); else reject(new Error('late failure')); await saving })
  expect(commit).toHaveBeenCalledTimes(1)
  expect(mockToast).not.toHaveBeenCalled()
})

it('retains the draft as a conflict when the saved field changes while persistence is pending', async () => {
  let resolve!: () => void
  mockFlush.mockImplementationOnce(() => new Promise<void>(yes => { resolve = yes }))
  const hook = await renderHook(useSettingsFieldSession)
  await act(() => hook.result.current.edit('proxyBaseUrl', 'draft', ''))
  const commit = jest.fn(value => { mockSettings.proxyBaseUrl = value })
  let saving!: Promise<void>
  await act(() => { saving = hook.result.current.save('proxyBaseUrl', commit, value => value) })
  mockSettings.proxyBaseUrl = 'external update'
  await act(async () => { resolve(); await saving })
  expect(hook.result.current.entries.proxyBaseUrl?.draft).toBe('draft')
  expect(hook.result.current.entries.proxyBaseUrl?.error).toBe('conflict')
  expect(mockToast).not.toHaveBeenCalled()
  expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'settingsWorkspace.saved' }))
  await act(() => hook.result.current.save('proxyBaseUrl', commit, value => value))
  expect(commit).toHaveBeenCalledTimes(1)
  expect(mockSettings.proxyBaseUrl).toBe('external update')
})

it('never commits through a captured save callback after its editor unmounts', async () => {
  const hook = await renderHook(useSettingsFieldSession)
  await act(() => hook.result.current.edit('proxyBaseUrl', 'draft', ''))
  const save = hook.result.current.save
  await hook.unmount()
  const commit = jest.fn()
  await act(() => save('proxyBaseUrl', commit, value => value))
  expect(commit).not.toHaveBeenCalled()
  expect(mockFlush).not.toHaveBeenCalled()
})

it('selects saved references without committing until Save and preserves legacy rules through a failed write', async () => {
  mockSettings.providerAllowlist = ['legacy-*']
  function Editor() {
    const session = useSettingsFieldSession()
    return <SavedSettingsField session={session} settingKey="providerAllowlist" label="Providers"
      value={(mockSettings.providerAllowlist as string[]).join('\n')}
      referenceOptions={[{ value: 'configured-provider', label: 'My provider' }]}
      onCommit={value => { mockSettings.providerAllowlist = value.split('\n') }} />
  }
  const screen = await render(<Editor />)
  expect(screen.queryByLabelText('Providers')).toBeNull()
  expect(screen.getByText('legacy-* · agents.unresolved')).toBeTruthy()
  await fireEvent.press(screen.getByLabelText('My provider'))
  expect(mockSettings.providerAllowlist).toEqual(['legacy-*'])
  mockFlush.mockRejectedValueOnce(new Error('disk unavailable'))
  await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.save' }))
  expect(screen.getByRole('alert')).toHaveTextContent('settingsWorkspace.saveFailed')
  expect(mockSettings.providerAllowlist).toEqual(['legacy-*', 'configured-provider'])
  await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.save' }))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('button', { name: 'settingsWorkspace.save' })).toBeNull()
  expect(screen.getByTestId('settings-field-providerAllowlist-status').props.accessibilityLabel).toBe('settingsWorkspace.saved')
  expect(screen.getByTestId('settings-field-providerAllowlist-status')).toHaveStyle({ width: 18, height: 18 })
  expect(mockFlush).toHaveBeenCalledTimes(2)
})
