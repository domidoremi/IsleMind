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
jest.mock('./theme-experiences/PreferenceSettingsExperiences', () => ({
  MinimalPreferenceSettingsExperience: ({ identity, generation, interaction, workflow }: any) => <>{identity}{generation}{interaction}{workflow}</>,
}))
jest.mock('@/components/ui/isle', () => {
  const { Pressable, Text, TextInput, View } = require('react-native')
  return {
    IslePressable: Pressable, IsleToggle: View,
    IsleField: ({ label, inputProps }: any) => <TextInput accessibilityLabel={label} {...inputProps} />,
    IsleButton: ({ label, ...props }: any) => <Pressable accessibilityRole="button" accessibilityLabel={label} {...props}><Text>{label}</Text></Pressable>,
    useIsleDialog: () => ({ toast: mockToast, confirm: mockConfirm }),
  }
})
function Page() {
  return <SettingsEditBoundary><SettingsSectionContext.Provider value={{ register: () => undefined }}><PreferenceSettingsContent /></SettingsSectionContext.Provider></SettingsEditBoundary>
}
beforeEach(() => { jest.clearAllMocks(); mockSettings = { defaultTemperature: 0.7 }; mockFlush.mockResolvedValue(undefined); mockConfirm.mockResolvedValue(true) })

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

it('retains workflow drafts across folding and clears discarded input without committing', async () => {
  const screen = await render(<Page />)
  const toggle = () => screen.getByRole('button', { name: /^preferences.agentWorkflow\./ })
  await fireEvent.press(toggle())
  await fireEvent.changeText(screen.getByLabelText('preferences.agentWorkflowMaxSteps'), '6')
  await fireEvent.press(toggle())
  expect(screen.queryByLabelText('preferences.agentWorkflowMaxSteps')).toBeNull()
  expect(screen.getByText('settingsWorkspace.unsaved')).toBeTruthy()
  await fireEvent.press(toggle())
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
