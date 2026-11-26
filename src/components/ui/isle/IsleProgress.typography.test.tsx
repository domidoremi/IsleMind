import { useEffect, useState } from 'react'
import { fireEvent, render } from '@testing-library/react-native'
import { Platform, StyleSheet, TextInput, View } from 'react-native'
import { AppFontContext } from '@/components/ui/AppText'
import { IsleProgress, type IsleProgressInfoPosition, type IsleProgressSize } from './IsleKit'
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
  return { colors, design: colors.design, canonicalThemeId: mockTheme, mode: mockMode, isDark: mockMode === 'dark' }
} }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => mockMotion }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: { fine: 1.5, regular: 1.75, strong: 2 } }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('react-native-reanimated', () => {
  const mock = require('react-native-reanimated/mock')
  return { ...mock, useSharedValue: (value: unknown) => require('react').useRef({ value }).current,
    useAnimatedStyle: (worklet: () => unknown) => worklet(), withTiming: (value: unknown) => value,
    withSpring: (value: unknown) => value, cancelAnimation: jest.fn(), runOnJS: (callback: unknown) => callback }
})
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.spyOn(require('react-native'), 'useWindowDimensions').mockImplementation(() => ({ width: mockWidth, height: 844, scale: 1, fontScale: mockFontScale }))

const originalPlatform = Platform.OS
afterEach(() => Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform }))
const locales = [{ locale: 'zh-CN', copy: zh }, { locale: 'en', copy: en }, { locale: 'ja', copy: ja }]
const cases = CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).flatMap(mode =>
  (['full', 'reduced', 'none'] as const).flatMap(motion => locales.flatMap(({ locale, copy }) =>
    (['android', 'web'] as const).map(platform => ({ family, mode, motion, locale, copy, platform }))))))

function expectedTypography(fontFamily: string, position: IsleProgressInfoPosition, percent: number) {
  const caption = { ...getColors(mockMode, mockTheme).design!.semantic.typography.caption, fontFamily }
  // AppText deliberately leaves absolute labels numeric. Ordinary Web text uses a ratio.
  const absolute = mockTheme !== 'animal-island-ui' && position === 'inside' && percent < 18
  return Platform.OS === 'web' && !absolute
    ? { ...caption, lineHeight: String(Math.max(1.5, caption.lineHeight / caption.fontSize)) } as unknown as typeof caption
    : caption
}

it.each(cases)('uses progress caption typography for $family/$mode/$motion/$locale/$platform and preserves the owner', async ({ family, mode, motion, copy, platform }) => {
  mockTheme = family; mockMode = mode; mockMotion = motion; mockWidth = 360; mockFontScale = 1
  Object.defineProperty(Platform, 'OS', { configurable: true, value: platform })
  const label = copy.common.loading, mounted = jest.fn()
  const formatter = jest.fn((percent: number) => `${label} ${percent}`)
  type OwnerProps = { size: IsleProgressSize; position: IsleProgressInfoPosition; percent: number; showInfo: boolean }
  function Owner({ size, position, percent, showInfo }: OwnerProps) {
    const [draft, setDraft] = useState('Unsent 草稿 下書き')
    useEffect(() => { mounted() }, [])
    return <View>
      <TextInput testID="progress-owner-draft" value={draft} onChangeText={setDraft} selection={{ start: 1, end: 4 }} />
      <IsleProgress percent={percent} size={size} infoPosition={position} showInfo={showInfo}
        infoFormat={formatter} durationMs={0} testID="themed-progress" accessibilityLabel={label} />
    </View>
  }
  const tree = (size: IsleProgressSize, position: IsleProgressInfoPosition, percent: number, font: string, showInfo = true) => <IsleThemeProvider>
    <AppFontContext.Provider value={font}><Owner size={size} position={position} percent={percent} showInfo={showInfo} /></AppFontContext.Provider>
  </IsleThemeProvider>
  const screen = await render(tree('small', 'inside', 0, 'Context A'))
  expect(screen.getByText(`${label} 0`)).toHaveStyle(expectedTypography('Context A', 'inside', 0))
  const input = screen.getByTestId('progress-owner-draft')
  await fireEvent.changeText(input, 'Retained 草稿 下書き')
  for (const position of ['inside', 'top', 'right'] as const) {
    for (const [index, size] of (['small', 'middle', 'large'] as const).entries()) {
      const percent = [0, 42, 100][index], font = `Context ${position} ${size}`
      mockWidth = [360, 844, 1280][index]; mockFontScale = index === 0 ? 1 : 1.8
      mockMode = mockMode === 'light' ? 'dark' : 'light'
      await screen.rerender(tree(size, position, percent, font))
      expect(screen.getByText(`${label} ${percent}`)).toHaveStyle(expectedTypography(font, position, percent))
      const bar = screen.getByRole('progressbar', { name: label })
      expect(bar.props['aria-valuenow'] ?? bar.props.accessibilityValue?.now).toBe(percent)
      expect(bar.props['aria-valuetext'] ?? bar.props.accessibilityValue?.text).toBe(`${label} ${percent}`)
      if (family !== 'animal-island-ui' && position === 'inside') {
        const caption = getColors(mockMode, family).design!.semantic.typography.caption
        const style = StyleSheet.flatten(bar.props.style)
        expect(style.height).toBeGreaterThanOrEqual(caption.lineHeight * mockFontScale)
        if (percent === 0) {
          const info = StyleSheet.flatten(screen.getByText(`${label} ${percent}`).props.style)
          expect(info.top + caption.lineHeight * mockFontScale).toBeLessThanOrEqual(style.height)
        }
      }
      expect(screen.getByTestId('progress-owner-draft')).toBe(input)
      expect(input.props).toMatchObject({ value: 'Retained 草稿 下書き', selection: { start: 1, end: 4 } })
      expect(mounted).toHaveBeenCalledTimes(1)
    }
  }
  await screen.rerender(tree('small', 'right', 100, 'Final context', false))
  expect(screen.queryByText(`${label} 100`)).toBeNull()
  const bar = screen.getByRole('progressbar', { name: label })
  expect(bar.props['aria-valuenow'] ?? bar.props.accessibilityValue?.now).toBe(100)
  if (family !== 'animal-island-ui') expect(StyleSheet.flatten(bar.props.style).height).toBe(7)
  expect(screen.getByTestId('progress-owner-draft')).toBe(input)
  expect(mounted).toHaveBeenCalledTimes(1)
  await screen.unmount()
})
