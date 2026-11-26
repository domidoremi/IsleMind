import { useState } from 'react'
import { fireEvent, render } from '@testing-library/react-native'
import { TextInput, View } from 'react-native'
import { IsleToggle } from './Primitives'
import { IsleThemeProvider } from './IsleThemeProvider'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import type { MotionIntensity } from '@/theme/themeMotion'
import { getColors } from '@/theme/colors'
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

const locales = [{ locale: 'zh-CN', copy: zh.updates }, { locale: 'en', copy: en.updates }, { locale: 'ja', copy: ja.updates }]
const cases = CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).flatMap(mode =>
  (['full', 'reduced', 'none'] as const).flatMap(motion => locales.map(({ locale, copy }) => ({ family, mode, motion, locale, copy })))))
function Frame({ title, description, active, disabled, onPress }: { title: string; description: string; active: boolean; disabled: boolean; onPress: () => void }) {
  const [draft, setDraft] = useState('Unsent 草稿 下書き')
  return <IsleThemeProvider><View>
    <TextInput testID="toggle-draft" value={draft} onChangeText={setDraft} selection={{ start: 1, end: 4 }} />
    <IsleToggle title={title} description={description} active={active} disabled={disabled} onPress={onPress} />
  </View></IsleThemeProvider>
}

it.each(cases)('matches theme toggle copy for $family/$mode/$motion/$locale and retains the setting session', async ({ family, mode, motion, copy }) => {
  mockTheme = family; mockMode = mode; mockMotion = motion
  const title = copy.autoDownload, description = copy.autoDownloadDescription, onPress = jest.fn()
  const tree = (active: boolean, disabled: boolean) => <Frame title={title} description={description} active={active} disabled={disabled} onPress={onPress} />
  const screen = await render(tree(false, false))
  const control = () => screen.getByRole('switch', { name: `${title}. ${description}` })
  const check = (active: boolean, disabled: boolean) => {
    const colors = getColors(mockMode, mockTheme)
    expect(screen.getByText(title)).toHaveStyle({ ...colors.design!.semantic.typography.label,
      color: disabled ? colors.ui.control.disabledForeground : colors.text })
    expect(screen.getByText(description)).toHaveStyle({ ...colors.design!.semantic.typography.body,
      color: disabled ? colors.ui.control.disabledForeground : colors.textSecondary })
    expect(control().props.accessibilityState).toMatchObject({ checked: active, disabled })
  }
  check(false, false)
  const originalControl = control(), draft = screen.getByTestId('toggle-draft')
  await fireEvent.changeText(draft, 'Retain edited 草稿 下書き')
  await fireEvent.press(control()); expect(onPress).toHaveBeenCalledTimes(1)
  await screen.rerender(tree(true, true)); check(true, true)
  await fireEvent.press(control()); expect(onPress).toHaveBeenCalledTimes(1)
  mockMode = mode === 'light' ? 'dark' : 'light'
  await screen.rerender(tree(false, true)); check(false, true)
  await screen.rerender(tree(true, false)); check(true, false)
  expect(control()).toBe(originalControl)
  expect(screen.getByTestId('toggle-draft')).toBe(draft)
  expect(draft.props.value).toBe('Retain edited 草稿 下書き')
  expect(draft.props.selection).toEqual({ start: 1, end: 4 })
  await fireEvent.press(control()); expect(onPress).toHaveBeenCalledTimes(2)
  await screen.unmount()
})
