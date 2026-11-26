import { fireEvent, render, within } from '@testing-library/react-native'
import { Platform } from 'react-native'
import { IsleSelect } from './IsleKit'
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
let mockWidth = 360
let mockFontScale = 1
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: () => false }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => {
  const colors = require('@/theme/colors').getColors(mockMode, mockTheme)
  return { colors, design: colors.design, canonicalThemeId: mockTheme, mode: mockMode, isDark: mockMode === 'dark',
    isMinimal: mockTheme === 'minimal', isMonet: mockTheme === 'monet', isMaterial: mockTheme === 'material',
    isLiquidGlass: mockTheme === 'liquid-glass', isAnimalIsland: mockTheme === 'animal-island-ui' }
} }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => mockMotion }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: { strong: 2 } }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 16, left: 0 }) }))
jest.mock('react-native-reanimated', () => {
  const mock = require('react-native-reanimated/mock')
  return { ...mock, useSharedValue: (value: unknown) => require('react').useRef({ value }).current,
    useAnimatedStyle: (worklet: () => unknown) => worklet(), withTiming: (value: unknown) => value,
    withSpring: (value: unknown) => value, cancelAnimation: jest.fn(), runOnJS: (callback: unknown) => callback }
})
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.spyOn(require('react-native'), 'useWindowDimensions').mockImplementation(() => ({ width: mockWidth, height: 844, scale: 1, fontScale: mockFontScale }))

// The application converts numeric Web line heights to a unitless ratio for browser minimum-font enlargement.
// Shared Select receives the same application metrics override explicitly; upstream defaults remain numeric.
function expectedTypography() {
  const label = getColors(mockMode, mockTheme).design!.semantic.typography.label
  return Platform.OS === 'web' ? { ...label, lineHeight: String(Math.max(1.5, label.lineHeight / label.fontSize)) } as unknown as typeof label : label
}
const originalPlatform = Platform.OS
afterEach(() => Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform }))
const locales = [{ locale: 'zh-CN', copy: zh }, { locale: 'en', copy: en }, { locale: 'ja', copy: ja }]
const cases = CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).flatMap(mode =>
  (['full', 'reduced', 'none'] as const).flatMap(motion => locales.flatMap(({ locale, copy }) =>
    (['android', 'web'] as const).map(platform => ({ family, mode, motion, locale, copy, platform }))))))

it.each(cases)('matches select typography for $family/$mode/$motion/$locale/$platform and retains controlled behavior', async ({ family, mode, motion, copy, platform }) => {
  mockTheme = family; mockMode = mode; mockMotion = motion; mockWidth = 360; mockFontScale = 1
  Object.defineProperty(Platform, 'OS', { configurable: true, value: platform })
  const label = copy.apiKeyPanel.customModels
  const first = `${copy.settingsWorkspace.saved} · 一 A あ`
  const next = `${copy.settingsReferences.manual} · 二 B い`
  const off = `${copy.settingsReferences.empty} · 三 C う`
  const placeholder = copy.providerSettings.modelsNote
  const onChange = jest.fn()
  const options = [{ value: 'first', label: first }, { value: 'next', label: next }, { value: 'off', label: off, disabled: true }]
  const tree = (value: string | undefined = 'first', disabled = false) => <IsleThemeProvider>
    <IsleSelect testID="theme-select" accessibilityLabel={label} placeholder={placeholder} value={value}
      options={options} onChange={onChange} disabled={disabled} style={{ marginTop: 9 }} />
  </IsleThemeProvider>
  const screen = await render(tree())
  const trigger = (valueLabel = first) => screen.getByRole(family === 'animal-island-ui' ? 'combobox' : 'button',
    { name: family === 'animal-island-ui' ? label : `${label} · ${valueLabel}`, includeHiddenElements: true })
  const control = trigger()
  expect(screen.getByTestId('theme-select')).toHaveStyle({ marginTop: 9 })
  await fireEvent.press(control)
  const checkOptions = () => {
    const typography = expectedTypography()
    // This first assertion independently reproduces the fixed option styles in all three render branches.
    expect(screen.getByText(next)).toHaveStyle(typography)
    expect(screen.getByText(off)).toHaveStyle(typography)
    for (const host of screen.getAllByText(first, { includeHiddenElements: true })) expect(host).toHaveStyle(typography)
  }
  checkOptions()
  const optionHost = screen.getByText(next)
  for (const width of [844, 1280, 360]) {
    mockWidth = width; mockFontScale = 1.8; mockMode = mockMode === 'light' ? 'dark' : 'light'
    await screen.rerender(tree()); checkOptions()
    expect(trigger()).toBe(control)
    expect(screen.getByText(next)).toBe(optionHost)
    expect(onChange).not.toHaveBeenCalled()
  }
  await fireEvent.press(screen.getByText(off))
  expect(onChange).not.toHaveBeenCalled()
  expect(screen.getByText(next)).toBe(optionHost)
  await fireEvent.press(screen.getByText(next))
  expect(onChange).toHaveBeenCalledTimes(1)
  expect(onChange).toHaveBeenCalledWith('next')
  expect(screen.queryByText(next)).toBeNull()
  expect(within(trigger()).getByText(first)).toHaveStyle(expectedTypography())
  await screen.rerender(tree('next'))
  expect(within(trigger(next)).getByText(next)).toHaveStyle(expectedTypography())
  await fireEvent.press(trigger(next))
  await screen.rerender(tree('next', true))
  expect(screen.queryByText(first)).toBeNull()
  const disabledControl = trigger(next)
  await fireEvent.press(disabledControl)
  expect(screen.queryByText(first)).toBeNull()
  expect(onChange).toHaveBeenCalledTimes(1)
  await screen.rerender(tree(''))
  expect(within(trigger(placeholder)).getByText(placeholder)).toHaveStyle(expectedTypography())
  await fireEvent.press(trigger(placeholder))
  checkOptions()
  await screen.unmount()
})
