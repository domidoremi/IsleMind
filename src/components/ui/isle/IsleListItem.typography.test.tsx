import { useState } from 'react'
import { fireEvent, render } from '@testing-library/react-native'
import * as Native from 'react-native'
import { TextInput, View } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { IsleListItem } from './Primitives'
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
jest.mock('react-native-reanimated', () => {
  const mock = require('react-native-reanimated/mock')
  return { ...mock, useSharedValue: (value: unknown) => require('react').useRef({ value }).current,
    useAnimatedStyle: (worklet: () => unknown) => worklet(), withTiming: (value: unknown) => value,
    withSpring: (value: unknown) => value, cancelAnimation: jest.fn(), runOnJS: (callback: unknown) => callback }
})
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.spyOn(require('react-native'), 'useWindowDimensions').mockImplementation(() => ({ width: mockWidth, height: 844, scale: 1, fontScale: mockFontScale }))

const locales = [{ locale: 'zh-CN', copy: zh.mcp }, { locale: 'en', copy: en.mcp }, { locale: 'ja', copy: ja.mcp }]
const cases = CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).flatMap(mode =>
  (['full', 'reduced', 'none'] as const).flatMap(motion => locales.map(({ locale, copy }) => ({ family, mode, motion, locale, copy })))))

function Frame({ description, badge, danger, pressable, onPress }: { description?: string; badge: string; danger: boolean; pressable: boolean; onPress: () => void }) {
  const [draft, setDraft] = useState('Unsent 草稿 下書き')
  const [expanded, setExpanded] = useState(false)
  return <IsleThemeProvider><View>
    <TextInput testID="list-draft" value={draft} onChangeText={setDraft} selection={{ start: 1, end: 4 }} />
    <IsleListItem title="Context7" description={description} danger={danger} onPress={pressable ? onPress : undefined}
      style={{ marginTop: 9 }} leading={<Text testID="list-badge">{badge}</Text>}
      trailing={<Native.Pressable testID="list-details" onPress={() => setExpanded(value => !value)}><Text>{expanded ? '−' : '+'}</Text></Native.Pressable>} />
    {expanded ? <Text testID="list-expanded">Retained details</Text> : null}
  </View></IsleThemeProvider>
}

it.each(cases)('matches list item typography for $family/$mode/$motion/$locale and preserves row interactions', async ({ family, mode, motion, copy }) => {
  mockTheme = family; mockMode = mode; mockMotion = motion; mockWidth = 360; mockFontScale = 1
  const description = copy.presets.context7.useCase, onPress = jest.fn()
  const tree = (danger = false, pressable = true, detail: string | undefined = description) =>
    <Frame description={detail} badge={copy.presetAvailable} danger={danger} pressable={pressable} onPress={onPress} />
  const screen = await render(tree())
  const check = (danger = false, hasDescription = true) => {
    const colors = getColors(mockMode, mockTheme)
    expect(screen.getByText('Context7')).toHaveStyle({ ...colors.design!.semantic.typography.label,
      color: danger ? colors.ui.tone.danger.foreground : colors.text, includeFontPadding: false, textAlignVertical: 'center' })
    expect(screen.getByText('Context7').props.numberOfLines).toBe(1)
    if (hasDescription) {
      expect(screen.getByText(description)).toHaveStyle({ ...colors.design!.semantic.typography.body,
        color: colors.textSecondary, marginTop: 3, includeFontPadding: false, textAlignVertical: 'center' })
      expect(screen.getByText(description).props.numberOfLines).toBe(mockWidth < 430 ? 3 : 2)
    } else expect(screen.queryByText(description)).toBeNull()
  }
  check()
  const row = screen.getByLabelText(`Context7. ${description}`), title = screen.getByText('Context7')
  const detail = screen.getByText(description), badge = screen.getByTestId('list-badge'), draft = screen.getByTestId('list-draft')
  expect(row).toHaveStyle({ minHeight: 52, marginTop: 9 })
  await fireEvent.press(row); expect(onPress).toHaveBeenCalledTimes(1)
  await fireEvent.changeText(draft, 'Edited 草稿 下書き')
  await fireEvent.press(screen.getByTestId('list-details'))
  expect(screen.getByTestId('list-expanded')).toBeTruthy()
  for (const width of [844, 1280, 360]) {
    mockWidth = width; mockFontScale = 1.8
    mockMode = mockMode === 'light' ? 'dark' : 'light'
    mockTheme = CANONICAL_THEME_IDS[(CANONICAL_THEME_IDS.indexOf(mockTheme) + 1) % CANONICAL_THEME_IDS.length]
    await screen.rerender(tree()); check()
    expect(screen.getByLabelText(`Context7. ${description}`)).toBe(row)
    expect(screen.getByText('Context7')).toBe(title)
    expect(screen.getByText(description)).toBe(detail)
    expect(screen.getByTestId('list-badge')).toBe(badge)
    expect(screen.getByTestId('list-expanded')).toBeTruthy()
    expect(screen.getByTestId('list-draft')).toBe(draft)
    expect(draft.props.value).toBe('Edited 草稿 下書き')
    expect(draft.props.selection).toEqual({ start: 1, end: 4 })
  }
  await screen.rerender(tree(true)); check(true)
  await fireEvent.press(screen.getByLabelText(`Context7. ${description}`)); expect(onPress).toHaveBeenCalledTimes(2)
  await screen.rerender(tree(false, false)); check()
  expect(screen.queryByLabelText(`Context7. ${description}`)).toBeNull()
  expect(onPress).toHaveBeenCalledTimes(2)
  await screen.rerender(tree(false, true, '')); check(false, false)
  await fireEvent.press(screen.getByLabelText('Context7')); expect(onPress).toHaveBeenCalledTimes(3)
  await screen.unmount()
})
