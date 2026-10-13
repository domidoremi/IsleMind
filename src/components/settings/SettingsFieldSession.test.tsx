import { act, fireEvent, render, renderHook } from '@testing-library/react-native'
import { SavedSettingsField, useSettingsFieldSession } from './SettingsFieldSession'
let mockSettings: Record<string, unknown>
const mockFlush = jest.fn()
const mockToast = jest.fn()
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: { getState: () => ({ settings: mockSettings }) } }))
jest.mock('@/presentation/features/settings/settingsStorePersistenceCommand', () => ({ flushPersistedSettings: () => mockFlush() }))
jest.mock('./SettingsEditBoundary', () => ({ useSettingsDraft: jest.fn() }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors('light', 'minimal') }) }))
jest.mock('@/components/ui/isle', () => {
  const { View, Pressable, Text, TextInput } = require('react-native')
  return { useIsleDialog: () => ({ toast: mockToast }), IslePressable: Pressable, IsleInput: TextInput,
    IsleField: ({ label, inputProps }: any) => <TextInput accessibilityLabel={label} {...inputProps} />,
    IsleButton: ({ label, ...props }: any) => <Pressable accessibilityRole="button" {...props}><Text>{label}</Text></Pressable>,
    IsleSelect: ({ options, onChange, disabled }: any) => <View>{options.map((option: any) => <Pressable key={option.value} accessibilityLabel={option.label} disabled={disabled} onPress={() => onChange(option.value)}><Text>{option.label}</Text></Pressable>)}</View>,
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
  expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'settingsWorkspace.conflict' }))
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
  expect(mockFlush).toHaveBeenCalledTimes(2)
})
