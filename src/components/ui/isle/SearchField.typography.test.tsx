import { fireEvent, render } from '@testing-library/react-native'
import { Platform } from 'react-native'
import { IsleSearchField } from './SearchField'
import { IsleThemeProvider } from './IsleThemeProvider'
import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import type { MotionIntensity } from '@/theme/themeMotion'
import zh from '@/i18n/resources/zh-CN.json'
import en from '@/i18n/resources/en.json'
import ja from '@/i18n/resources/ja.json'

let mockTheme: CanonicalThemeId = 'minimal'
let mockMode: 'light' | 'dark' = 'light'
let mockMotion: MotionIntensity = 'none'
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: () => false }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => {
  const colors = require('@/theme/colors').getColors(mockMode, mockTheme)
  return { colors, design: colors.design, canonicalThemeId: mockTheme, mode: mockMode, isDark: mockMode === 'dark' }
} }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => mockMotion }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: { fine: 1.5, regular: 1.75, strong: 2 } }))
jest.mock('@/components/ui/HighFrameSpinner', () => ({ HighFrameSpinner: () => null }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('react-native-reanimated', () => {
  const mock = require('react-native-reanimated/mock')
  return { ...mock, useSharedValue: (value: unknown) => require('react').useRef({ value }).current,
    useAnimatedStyle: (worklet: () => unknown) => worklet(), withTiming: (value: unknown) => value,
    withSpring: (value: unknown) => value, cancelAnimation: jest.fn(), runOnJS: (callback: unknown) => callback }
})
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))

const originalPlatform = Platform.OS
afterEach(() => Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform }))
const locales = [{ locale: 'zh-CN', copy: zh }, { locale: 'en', copy: en }, { locale: 'ja', copy: ja }]
const cases = CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).flatMap(mode =>
  (['full', 'reduced', 'none'] as const).flatMap(motion => locales.flatMap(({ locale, copy }) =>
    (['android', 'web'] as const).map(platform => ({ family, mode, motion, locale, copy, platform }))))))

// The app's established Web policy uses a unitless ratio for minimum-font enlargement.
function expectedTypography(override?: { fontSize: number; lineHeight: number }) {
  const body = { ...getColors(mockMode, mockTheme).design!.semantic.typography.body, ...override }
  return Platform.OS === 'web'
    ? { ...body, lineHeight: String(Math.max(1.5, body.lineHeight / body.fontSize)) } as unknown as typeof body
    : body
}

it.each(cases)('uses search body typography for $family/$mode/$motion/$locale/$platform and preserves editing', async ({ family, mode, motion, copy, platform }) => {
  mockTheme = family; mockMode = mode; mockMotion = motion
  Object.defineProperty(Platform, 'OS', { configurable: true, value: platform })
  const label = copy.providerSettings.searchModels, clear = copy.common.clear
  const query = `${copy.settingsWorkspace.saved} · 草稿 Draft 下書き`
  const change = jest.fn(), onClear = jest.fn(), focus = jest.fn(), blur = jest.fn()
  const tree = (compact = false, editable = true, pending = false, override?: { fontSize: number; lineHeight: number }) => <IsleThemeProvider>
    <IsleSearchField testID="theme-search" accessibilityLabel={label} placeholder={label}
      value={query} selection={{ start: 1, end: 4 }} compact={compact} editable={editable} pending={pending}
      keyboardType="web-search" returnKeyType="search" clearAccessibilityLabel={clear}
      inputStyle={override} onChangeText={change} onClear={onClear} onFocus={focus} onBlur={blur} />
  </IsleThemeProvider>
  const screen = await render(tree())
  const host = screen.getByLabelText(label)
  expect(host).toHaveStyle(expectedTypography())
  expect(host.props).toMatchObject({ value: query, selection: { start: 1, end: 4 }, keyboardType: 'web-search',
    returnKeyType: 'search', disableFullscreenUI: true })
  await fireEvent(host, 'focus', { nativeEvent: {} })
  await fireEvent.changeText(host, `${query} 2`)
  expect(change).toHaveBeenCalledTimes(1)
  expect(change).toHaveBeenLastCalledWith(`${query} 2`)
  for (const compact of [true, false]) {
    mockMode = mockMode === 'light' ? 'dark' : 'light'
    await screen.rerender(tree(compact, true, true))
    expect(screen.getByLabelText(label)).toBe(host)
    expect(host).toHaveStyle(expectedTypography())
    expect(host.props.accessibilityState.busy).toBe(true)
    expect(host.props.value).toBe(query)
    expect(host.props.selection).toEqual({ start: 1, end: 4 })
    expect(focus).toHaveBeenCalledTimes(1)
    expect(blur).not.toHaveBeenCalled()
    expect(change).toHaveBeenCalledTimes(1)
  }
  const override = { fontSize: 23, lineHeight: 36 }
  await screen.rerender(tree(true, false, false, override))
  expect(screen.getByLabelText(label)).toBe(host)
  expect(host).toHaveStyle({ ...expectedTypography(override), color: getColors(mockMode, mockTheme).ui.input.disabledForeground })
  expect(host).toBeDisabled()
  expect(screen.queryByRole('button', { name: clear })).toBeNull()
  await screen.rerender(tree(false, true, false, override))
  expect(screen.getByLabelText(label)).toBe(host)
  expect(host).toHaveStyle(expectedTypography(override))
  await fireEvent(host, 'blur', { nativeEvent: {} })
  expect(blur).toHaveBeenCalledTimes(1)
  await fireEvent.press(screen.getByRole('button', { name: clear }))
  expect(change).toHaveBeenCalledTimes(2)
  expect(change).toHaveBeenLastCalledWith('')
  expect(onClear).toHaveBeenCalledTimes(1)
  await screen.unmount()
})
