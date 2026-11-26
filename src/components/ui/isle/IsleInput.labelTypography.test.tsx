import { fireEvent, render } from '@testing-library/react-native'
import { IsleInput } from './IsleKit'
import { IsleThemeProvider } from './IsleThemeProvider'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import type { MotionIntensity } from '@/theme/themeMotion'
import { getColors } from '@/theme/colors'
import { appUpdateActivity } from '@/presentation/app-shell/appUpdateActivity'
import zh from '@/i18n/resources/zh-CN.json'
import en from '@/i18n/resources/en.json'
import ja from '@/i18n/resources/ja.json'

let mockTheme: CanonicalThemeId = 'minimal'
let mockMode: 'light' | 'dark' = 'light'
let mockMotion: MotionIntensity = 'none'
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
jest.mock('react-native-reanimated', () => {
  const mock = require('react-native-reanimated/mock')
  return { ...mock, useSharedValue: (value: unknown) => require('react').useRef({ value }).current,
    useAnimatedStyle: (worklet: () => unknown) => worklet(), withTiming: (value: unknown) => value,
    withSpring: (value: unknown) => value, cancelAnimation: jest.fn(), runOnJS: (callback: unknown) => callback }
})
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))

const locales = [
  { locale: 'zh-CN', label: zh.scenes.name, clear: zh.common.clear },
  { locale: 'en', label: en.scenes.name, clear: en.common.clear },
  { locale: 'ja', label: ja.scenes.name, clear: ja.common.clear },
]
const cases = CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).flatMap(mode =>
  (['full', 'reduced', 'none'] as const).flatMap(motion => locales.map(copy => ({ family, mode, motion, ...copy })))))

it.each(cases)('matches input label typography for $family/$mode/$motion/$locale and retains the input session', async ({ family, mode, motion, label, clear }) => {
  mockTheme = family; mockMode = mode; mockMotion = motion
  const change = jest.fn(), onClear = jest.fn(), focus = jest.fn(), blur = jest.fn()
  const tree = (editable = true) => <IsleThemeProvider>
    <IsleInput testID="theme-label-input" label={label} defaultValue="Unsent 草稿 下書き" allowClear
      clearAccessibilityLabel={clear} selection={{ start: 1, end: 4 }} editable={editable}
      onChangeText={change} onClear={onClear} onFocus={focus} onBlur={blur} />
  </IsleThemeProvider>
  const screen = await render(tree())
  const check = () => {
    const colors = getColors(mockMode, mockTheme)
    expect(screen.getByText(label)).toHaveStyle({ ...colors.design!.semantic.typography.label,
      color: colors.textSecondary, marginBottom: 6 })
    expect(screen.getByTestId('theme-label-input')).toHaveStyle(colors.design!.semantic.typography.body)
    expect(screen.getByLabelText(label)).toBe(screen.getByTestId('theme-label-input'))
  }
  check()
  const originalField = screen.getByTestId('theme-label-input'), originalLabel = screen.getByText(label)
  await fireEvent.changeText(originalField, 'Edited 草稿 下書き')
  expect(change).toHaveBeenLastCalledWith('Edited 草稿 下書き')
  await fireEvent(originalField, 'focus', { nativeEvent: {} })
  expect(focus).toHaveBeenCalledTimes(1)
  expect(appUpdateActivity.getSnapshot().blocked).toBe(true)
  mockMode = mode === 'light' ? 'dark' : 'light'
  mockTheme = CANONICAL_THEME_IDS[(CANONICAL_THEME_IDS.indexOf(family) + 1) % CANONICAL_THEME_IDS.length]
  await screen.rerender(tree()); check()
  expect(screen.getByTestId('theme-label-input')).toBe(originalField)
  expect(screen.getByText(label)).toBe(originalLabel)
  expect(originalField.props.value).toBe('Edited 草稿 下書き')
  expect(originalField.props.selection).toEqual({ start: 1, end: 4 })
  expect(appUpdateActivity.getSnapshot().blocked).toBe(true)
  expect(focus).toHaveBeenCalledTimes(1)
  await fireEvent(originalField, 'blur', { nativeEvent: {} })
  expect(blur).toHaveBeenCalledTimes(1)
  expect(appUpdateActivity.getSnapshot().blocked).toBe(false)
  await screen.rerender(tree(false)); check()
  expect(screen.getByTestId('theme-label-input')).toBeDisabled()
  expect(screen.getByTestId('theme-label-input').props.accessibilityState.disabled).toBe(true)
  expect(screen.queryByRole('button', { name: clear })).toBeNull()
  expect(screen.getByTestId('theme-label-input').props.value).toBe('Edited 草稿 下書き')
  await screen.rerender(tree()); check()
  await fireEvent.press(screen.getByRole('button', { name: clear }))
  expect(change).toHaveBeenCalledTimes(2)
  expect(change).toHaveBeenLastCalledWith('')
  expect(onClear).toHaveBeenCalledTimes(1)
  expect(screen.getByTestId('theme-label-input').props.value).toBe('')
  expect(screen.getByTestId('theme-label-input')).toBe(originalField)
  await screen.unmount()
})
