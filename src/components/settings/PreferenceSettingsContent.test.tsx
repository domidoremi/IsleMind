import { act, fireEvent, render } from '@testing-library/react-native'
import { PreferenceSettingsContent } from './PreferenceSettingsContent'
import { SettingsEditBoundary } from './SettingsEditBoundary'
import { SettingsSectionContext } from './SettingsSection'

let mockSettings: Record<string, unknown> = {}
const mockUpdate = jest.fn((patch: object) => Object.assign(mockSettings, patch))
const mockFlush = jest.fn()
const mockToast = jest.fn()
const mockConfirm = jest.fn()
let mockRemove: (event: { data: { action: unknown } }) => void
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: Object.assign((select: any) => select({ settings: mockSettings }), { getState: () => ({ settings: mockSettings }) }) }))
jest.mock('./usePreferenceUndo', () => ({ usePreferenceUndo: () => ({ updateSettings: mockUpdate, canUndo: false }) }))
jest.mock('@/presentation/features/settings/settingsStorePersistenceCommand', () => ({ flushPersistedSettings: () => mockFlush() }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors('light', 'minimal'), canonicalThemeId: 'minimal' }) }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('expo-router', () => ({ useNavigation: () => ({ dispatch: jest.fn() }) }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: (_: boolean, callback: typeof mockRemove) => { mockRemove = callback } }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('moti', () => ({ MotiView: require('react-native').View }))
jest.mock('@/components/ui/isle', () => {
  const { Pressable: MockPressable, Text, TextInput, View } = require('react-native')
  return {
    IslePressable: MockPressable, IsleToggle: View,
    IsleField: ({ label, inputProps }: any) => <TextInput accessibilityLabel={label} {...inputProps} />,
    IsleButton: ({ label, ...props }: any) => <MockPressable accessibilityRole="button" accessibilityLabel={label} {...props}><Text>{label}</Text></MockPressable>,
    useIsleDialog: () => ({ toast: mockToast, confirm: mockConfirm }),
  }
})
function Page() {
  return <SettingsEditBoundary><SettingsSectionContext.Provider value={{ register: () => undefined }}><PreferenceSettingsContent /></SettingsSectionContext.Provider></SettingsEditBoundary>
}
beforeEach(() => { jest.clearAllMocks(); mockSettings = { defaultTemperature: 0.7 }; mockFlush.mockResolvedValue(undefined); mockConfirm.mockResolvedValue(true) })
afterEach(() => jest.restoreAllMocks())

it('uses measured content width at large font scale and preserves drafts across reflow', async () => {
  // Android landscape has room for two columns by window width, but not after
  // safe-area/page padding and the parent's maxWidth have been applied.
  const dimensions = jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({ width: 872, height: 393, scale: 2.75, fontScale: 2 })
  const screen = await render(<Page />)
  const input = () => screen.getAllByLabelText('chat.temperature').find(node => node.props.onChangeText)!
  await fireEvent.changeText(input(), '1.25')
  await fireEvent(screen.getByTestId('preference-settings-content'), 'layout', { nativeEvent: { layout: { width: 808, height: 600 } } })
  expect(screen.getByTestId('preference-generation-fields')).toHaveStyle({ flexDirection: 'column' })
  dimensions.mockReturnValue({ width: 1200, height: 800, scale: 2.75, fontScale: 2 })
  await screen.rerender(<Page />)
  expect(screen.getByTestId('preference-generation-fields')).toHaveStyle({ flexDirection: 'column' })
  dimensions.mockReturnValue({ width: 872, height: 393, scale: 2.75, fontScale: 1 })
  await screen.rerender(<Page />)
  expect(screen.getByTestId('preference-generation-fields')).toHaveStyle({ flexDirection: 'row' })
  await fireEvent(screen.getByTestId('preference-settings-content'), 'layout', { nativeEvent: { layout: { width: 350, height: 1000 } } })
  expect(screen.getByTestId('preference-generation-fields')).toHaveStyle({ flexDirection: 'column' })
  expect(input().props.value).toBe('1.25')
  expect(mockUpdate).not.toHaveBeenCalled()
})

it('keeps exact numeric input on blur, rejects incomplete values, and saves only explicitly', async () => {
  const screen = await render(<Page />)
  const input = screen.getAllByLabelText('chat.temperature').find(node => node.props.onChangeText)!
  await fireEvent.changeText(input, '.')
  await fireEvent(input, 'blur')
  expect(mockUpdate).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'settingsWorkspace.save' })).toBeDisabled()
  expect(screen.getByText('settingsWorkspace.error')).toBeTruthy()
  await fireEvent.changeText(input, '1.2')
  await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.save' }))
  expect(mockUpdate).toHaveBeenCalledWith({ defaultTemperature: 1.2 })
  expect(mockFlush).toHaveBeenCalledTimes(1)
  expect(mockToast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'settingsWorkspace.saved' }))
})

it('guards task navigation and clears discarded workflow input without committing', async () => {
  const screen = await render(<Page />)
  await fireEvent.press(screen.getByTestId('settings-task-workflow'))
  await fireEvent.changeText(screen.getByLabelText('preferences.agentWorkflowMaxSteps'), '6')
  mockConfirm.mockResolvedValueOnce(false)
  await fireEvent.press(screen.getByTestId('settings-task-workflow'))
  expect(screen.getByLabelText('preferences.agentWorkflowMaxSteps').props.value).toBe('6')
  expect(mockUpdate).not.toHaveBeenCalled()
  await act(async () => { mockRemove({ data: { action: { type: 'POP' } } }); await Promise.resolve() })
  expect(screen.getByLabelText('preferences.agentWorkflowMaxSteps').props.value).toBe('3')
  expect(mockUpdate).not.toHaveBeenCalled()
})

it('preserves identity input after persistence failure and refuses to overwrite an external update', async () => {
  const screen = await render(<Page />)
  const input = screen.getByLabelText('preferences.assistantDisplayName')
  await fireEvent.changeText(input, 'My assistant')
  await fireEvent(input, 'blur')
  expect(mockUpdate).not.toHaveBeenCalled()
  mockFlush.mockRejectedValueOnce(new Error('storage unavailable'))
  await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.save' }))
  expect(input.props.value).toBe('My assistant')
  expect(mockToast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'settingsWorkspace.saveFailed' }))
  mockSettings.assistantDisplayName = 'Changed elsewhere'
  mockUpdate.mockClear()
  await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.save' }))
  expect(mockUpdate).not.toHaveBeenCalled()
  expect(mockToast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'settingsWorkspace.conflict' }))
  await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.reload' }))
  expect(screen.getByLabelText('preferences.assistantDisplayName').props.value).toBe('Changed elsewhere')
})
