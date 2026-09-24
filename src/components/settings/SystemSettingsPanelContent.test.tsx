import { act, fireEvent, render } from '@testing-library/react-native'
import { ScrollView } from 'react-native'
import Constants from 'expo-constants'
import { AnimatePresence, MotiView } from 'moti'
import { THEME_MOTION_DURATIONS } from '@/theme/themeTokens'
import { SystemSettingsPanelContent } from './SystemSettingsPanelContent'

const mockTranslate = (key: string) => key
const mockState = { providers: [], settings: { theme: 'dark', themeId: 'material', language: 'zh-CN' } }
let mockMotion = 'full'

jest.mock('@/store/settingsStore', () => ({ useSettingsStore: (select: (state: unknown) => unknown) => select(mockState) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => {
  const colors = require('@/theme/colors').getColors('dark', 'material')
  return { colors, design: colors.design, canonicalThemeId: 'material' }
} }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => mockMotion }))
jest.mock('@/hooks/useThemeSelection', () => ({ useThemeSelection: () => jest.fn() }))
jest.mock('./usePreferenceUndo', () => ({ usePreferenceUndo: () => ({ updateSettings: jest.fn(), canUndo: false, undo: jest.fn() }) }))
jest.mock('./SettingsEditBoundary', () => ({ useSettingsDraft: () => jest.fn() }))
jest.mock('./SettingsPageShell', () => ({ SettingsPageShell: ({ children }: { children: React.ReactNode }) => children }))
jest.mock('@/core', () => ({ userFacingErrorDetail: String }))
jest.mock('@/i18n', () => ({ changeAppLanguage: jest.fn() }))
jest.mock('@/modules/integrations', () => ({ resolveSearchProvider: () => 'off' }))
jest.mock('@/presentation/features/settings/portableDataCommand', () => ({}))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }))
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }))
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0', nativeBuildVersion: '1' }))
jest.mock('expo-constants', () => ({ expoConfig: {} }))
jest.mock('animal-island-ui-rn', () => ({ RadioGroup: require('react-native').View }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('@/components/ui/HighFrameSpinner', () => ({ HighFrameSpinner: () => null }))
jest.mock('@/components/navigation/AnimatedNavigationTrigger', () => ({ AnimatedNavigationTrigger: () => null }))
jest.mock('@/components/settings/SettingsThemeAccentControl', () => ({ SettingsThemeAccentControl: () => null }))
jest.mock('@/components/ui/isle/GlassSurface', () => ({ GlassSurface: require('react-native').View }))
jest.mock('@/components/ui/isle', () => {
  const { Pressable, Text, TextInput, View } = require('react-native')
  return {
    IslePressable: Pressable, IsleSearchField: TextInput, IsleField: TextInput,
    IsleChip: Text, IsleButton: Text, IsleProgress: View, IsleDisclosure: View, IsleToggle: View,
    ISLE_MIN_TOUCH_TARGET: 44, useIsleDialog: () => ({ toast: jest.fn() }),
  }
})
jest.mock('moti', () => ({
  MotiView: jest.fn((props) => require('react').createElement(require('react-native').View, props)),
  AnimatePresence: jest.fn(({ children }) => children),
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockMotion = 'full'
  Constants.expoConfig!.extra = { distributionChannel: 'github' }
})
afterEach(() => jest.restoreAllMocks())

it.each(['github', 'google-play'])('renders channel-appropriate update controls for %s', async channel => {
  Constants.expoConfig!.extra = { distributionChannel: channel }
  const screen = await render(<SystemSettingsPanelContent panel="updates" />)
  if (channel === 'google-play') {
    expect(screen.getByText('updates.googlePlayManaged')).toBeTruthy()
    expect(screen.container.queryAll(node => node.props.label === 'settings.checkApk')).toHaveLength(0)
    expect(screen.queryByText('settings.lastCheck')).toBeNull()
    expect(screen.container.queryAll(node => node.props.title === 'settings.autoCheck')).toHaveLength(0)
  } else {
    expect(screen.queryByText('updates.googlePlayManaged')).toBeNull()
    expect(screen.container.queryAll(node => node.props.label === 'settings.checkApk')).not.toHaveLength(0)
    expect(screen.getByText('settings.lastCheck')).toBeTruthy()
    expect(screen.container.queryAll(node => node.props.title === 'settings.autoCheck')).not.toHaveLength(0)
  }
})

it.each(['full', 'reduced'])('uses a visible %s transition instead of a one-millisecond swap', async (motion) => {
  mockMotion = motion
  await render(<SystemSettingsPanelContent panel="appearance" />)
  const props = jest.mocked(MotiView).mock.calls.findLast(([props]) => props.testID === 'settings-appearance-foldout')![0]
  expect(props.transition).toMatchObject({ type: 'timing', duration: motion === 'full' ? THEME_MOTION_DURATIONS.material.panel : 120 })
  const readableFrame = motion === 'full'
    ? { opacity: 0.65, translateX: 6, translateY: 0, scale: 0.99 }
    : { opacity: 0.65, translateX: 0, translateY: 0, scale: 1 }
  expect(props.from).toEqual(readableFrame)
  const catalog = jest.mocked(MotiView).mock.calls.findLast(([props]) => typeof props.from === 'object' && props.from.opacity === 0.65)![0]
  expect(catalog.from).toEqual(readableFrame)
})

it('keeps the appearance controls on parent-only renders', async () => {
  const screen = await render(<SystemSettingsPanelContent panel="appearance" />)
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo')
  scrollTo.mockClear()
  await screen.rerender(<SystemSettingsPanelContent panel="appearance" />)
  expect(screen.getByTestId('settings-appearance-foldout')).toBeTruthy()
  expect(scrollTo).not.toHaveBeenCalled()
})

it.each([[1, '47%'], [2, '100%']] as const)('sizes theme previews for %sx system text', async (fontScale, flexBasis) => {
  jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({ width: 390, height: 844, scale: 1, fontScale })
  const screen = await render(<SystemSettingsPanelContent panel="appearance" />)
  expect(screen.getByTestId('settings-theme-family-minimal')).toHaveStyle({ flexBasis })
})
