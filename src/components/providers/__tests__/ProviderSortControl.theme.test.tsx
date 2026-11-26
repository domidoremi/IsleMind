import { useState } from 'react'
import type { TestInstance } from 'test-renderer'
import { act, fireEvent, render } from '@testing-library/react-native'
import { StyleSheet, TextInput, View } from 'react-native'
import { ProviderSettingsContent } from '../ProviderSettingsContent'
import { IsleIconButton } from '@/components/ui/isle/Primitives'
import { IsleThemeProvider } from '@/components/ui/isle/IsleThemeProvider'
import { useSettingsStore } from '@/store/settingsStore'
import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { MotionIntensity } from '@/theme/themeMotion'

let mockTheme: CanonicalThemeId = 'minimal'
let mockMode: 'light' | 'dark' = 'light'
let mockMotion: MotionIntensity = 'none'
let mockLocale = 'en'
const mockMove = jest.fn()
const mockTranslate = (key: string, options?: { name?: string }) => `${mockLocale}:${key}${options?.name ? ':' + options.name : ''}`
jest.mock('expo-router', () => ({ useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, []),
  useNavigation: jest.fn(), useNavigationContainerRef: () => ({ getRootState: () => undefined }),
  router: { back: jest.fn(), canGoBack: () => true, push: jest.fn(), dismissTo: jest.fn() } }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors(mockMode, mockTheme),
  canonicalThemeId: mockTheme, mode: mockMode, isDark: mockMode === 'dark' }) }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => mockMotion }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: ({ name, color }: { name: string; color: string }) => {
  const { Text } = require('react-native')
  return <Text testID={`sort-icon-${name}`} style={{ color }} />
} }))
jest.mock('@/components/settings/SettingsHelp', () => ({ SettingsHelpButton: () => null }))
jest.mock('@/components/settings/ApiKeyPanel', () => ({ ApiKeyPanel: ({ sortControl }: { sortControl: React.ReactNode }) => <MockDraftPanel>{sortControl}</MockDraftPanel> }))
jest.mock('@/components/providers/useProviderActivationJob', () => ({ useProviderActivationJob: () => ({
  activationBusy: false, activationJob: null, clearActivationJob: jest.fn(), isActivationRunning: false }) }))
jest.mock('@/bootstrap/usageStatisticsRuntime', () => ({ loadRecentProviderUsage: async () => [] }))
jest.mock('@/bootstrap/providerUsageRuntime', () => ({ invalidateProviderUsage: jest.fn() }))
jest.mock('@/presentation/features/settings/settingsStorePersistenceCommand', () => ({ flushPersistedSettings: async () => undefined }))
jest.mock('react-native-reanimated', () => {
  const mock = require('react-native-reanimated/mock')
  return { ...mock, useSharedValue: (value: unknown) => require('react').useRef({ value }).current,
    useAnimatedStyle: (worklet: () => unknown) => worklet(),
    withTiming: (value: unknown) => value, withSpring: (value: unknown) => value,
    cancelAnimation: jest.fn(), runOnJS: (callback: unknown) => callback }
})
jest.mock('moti', () => ({ MotiView: require('react-native').View }))
jest.mock('@/components/ui/isle', () => {
  const { Pressable, Text, TextInput } = require('react-native')
  const Button = ({ label, ...props }: any) => <Pressable accessibilityRole="button" accessibilityLabel={label} {...props}><Text>{label}</Text></Pressable>
  return { ISLE_MIN_TOUCH_TARGET: 44, IslePressable: jest.requireActual('@/components/ui/isle/Pressable').IslePressable,
    IsleIconButton: jest.requireActual('@/components/ui/isle/Primitives').IsleIconButton,
    IsleButton: Button, IsleProgress: jest.requireActual('@/components/ui/isle/IsleKit').IsleProgress,
    IsleField: ({ label, inputProps }: any) => <TextInput accessibilityLabel={label} {...inputProps} />,
    useIsleDialog: () => ({ confirm: jest.fn(), toast: jest.fn(), notice: jest.fn() }) }
})

function MockDraftPanel({ children }: { children: React.ReactNode }) {
  const [draft, setDraft] = useState('Unsent 草稿 下書き')
  return <View>{children}<TextInput testID="sort-draft" value={draft} onChangeText={setDraft} selection={{ start: 1, end: 4 }} /></View>
}
const initial = useSettingsStore.getState()
const providers: AIProvider[] = ['first', 'second'].map(id => ({ id, name: id, type: 'openai', apiKey: '',
  baseUrl: 'https://example.invalid/v1', models: [], enabled: false }))
const cases = CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).flatMap(mode =>
  (['full', 'reduced', 'none'] as const).flatMap(motion => ['zh-CN', 'en', 'ja'].map(locale => ({ family, mode, motion, locale })))))
beforeEach(() => {
  mockMove.mockReset().mockImplementation((ids: string[]) => useSettingsStore.setState({ providers: ids.map(id => providers.find(item => item.id === id)!) }))
  useSettingsStore.setState({ ...initial, providers, reorderProviders: mockMove, settings: { ...initial.settings, hapticsEnabled: false } })
})
afterEach(() => useSettingsStore.setState(initial, true))

it.each(cases)('matches themed sort control $family/$mode/$motion/$locale and preserves reorder, draft and selection', async ({ family, mode, motion, locale }) => {
  mockTheme = family; mockMode = mode; mockMotion = motion; mockLocale = locale
  const tree = () => <IsleThemeProvider><ProviderSettingsContent embedded autoOpenProviderId="first" />
    <IsleIconButton label="Reference disabled" disabled><View /></IsleIconButton>
    <IsleIconButton label="Reference enabled"><View /></IsleIconButton>
  </IsleThemeProvider>
  const screen = await render(tree())
  const up = () => screen.getByRole('button', { name: `${locale}:providerSettings.moveUpProvider:first` })
  const down = () => screen.getByRole('button', { name: `${locale}:providerSettings.moveDownProvider:first` })
  const checkTheme = (disabledName: string, enabledName: string) => {
    const disabledButton = screen.getByRole('button', { name: disabledName })
    const enabledButton = screen.getByRole('button', { name: enabledName })
    const surface = (node: TestInstance) => StyleSheet.flatten(node.props.style)
    expect(surface(disabledButton)).toEqual(surface(screen.getByRole('button', { name: 'Reference disabled' })))
    expect(surface(enabledButton)).toEqual(surface(screen.getByRole('button', { name: 'Reference enabled' })))
    expect(disabledButton).toBeDisabled(); expect(enabledButton).toBeEnabled()
    for (const button of [disabledButton, enabledButton]) {
      expect(button.props.hitSlop).toBe(8)
      expect(button).toHaveStyle({ width: 44, height: 44 })
    }
  }
  checkTheme(up().props.accessibilityLabel, down().props.accessibilityLabel)
  expect(screen.getByTestId('sort-icon-arrow-up', { includeHiddenElements: true })).toHaveStyle({ color: getColors(mode, family).ui.control.disabledForeground })
  expect(screen.getByTestId('sort-icon-arrow-down', { includeHiddenElements: true })).toHaveStyle({ color: getColors(mode, family).text })
  await fireEvent.press(up()); expect(mockMove).not.toHaveBeenCalled()
  const originalUp = up(), originalDown = down(), draft = screen.getByTestId('sort-draft')
  await fireEvent.changeText(draft, 'Retain edited 草稿 下書き')
  await fireEvent.press(down()); expect(mockMove).toHaveBeenCalledTimes(1)
  expect(mockMove).toHaveBeenLastCalledWith(['second', 'first'])
  checkTheme(down().props.accessibilityLabel, up().props.accessibilityLabel)
  expect(up()).toBe(originalUp); expect(down()).toBe(originalDown)
  mockMode = mode === 'dark' ? 'light' : 'dark'
  await screen.rerender(tree())
  checkTheme(down().props.accessibilityLabel, up().props.accessibilityLabel)
  expect(screen.getByTestId('sort-icon-arrow-down', { includeHiddenElements: true })).toHaveStyle({ color: getColors(mockMode, family).ui.control.disabledForeground })
  expect(screen.getByTestId('sort-draft')).toBe(draft)
  expect(draft.props.value).toBe('Retain edited 草稿 下書き')
  expect(draft.props.selection).toEqual({ start: 1, end: 4 })
  await fireEvent.press(down()); expect(mockMove).toHaveBeenCalledTimes(1)
  await fireEvent.press(up()); expect(mockMove).toHaveBeenCalledTimes(2)
  expect(mockMove).toHaveBeenLastCalledWith(['first', 'second'])
  await act(async () => undefined)
  await screen.unmount()
})
