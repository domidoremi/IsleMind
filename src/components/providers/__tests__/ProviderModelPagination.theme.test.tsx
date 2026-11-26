import { useState } from 'react'
import type { TestInstance } from 'test-renderer'
import { createInstance } from 'i18next'
import { fireEvent, render } from '@testing-library/react-native'
import { StyleSheet, TextInput, View } from 'react-native'
import { ProviderModelPagination, PROVIDER_MODEL_PAGE_SIZE } from '../ProviderModelSourceFilter'
import { IsleButton } from '@/components/ui/isle/IsleKit'
import { IsleThemeProvider } from '@/components/ui/isle/IsleThemeProvider'
import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import type { MotionIntensity } from '@/theme/themeMotion'

let mockTheme: CanonicalThemeId = 'minimal'
let mockMode: 'light' | 'dark' = 'light'
let mockMotion: MotionIntensity = 'none'
const mockI18n = createInstance()
const mockChange = jest.fn()
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: () => false }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockI18n.t.bind(mockI18n) }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors(mockMode, mockTheme),
  canonicalThemeId: mockTheme, mode: mockMode, isDark: mockMode === 'dark' }) }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => mockMotion }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('@/components/ui/HighFrameSpinner', () => ({ HighFrameSpinner: () => null }))
jest.mock('react-native-reanimated', () => {
  const mock = require('react-native-reanimated/mock')
  return { ...mock, useSharedValue: (value: unknown) => require('react').useRef({ value }).current,
    useAnimatedStyle: (worklet: () => unknown) => worklet(),
    withTiming: (value: unknown) => value, withSpring: (value: unknown) => value,
    cancelAnimation: jest.fn(), runOnJS: (callback: unknown) => callback }
})
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))

beforeAll(async () => {
  await mockI18n.init({ lng: 'en', fallbackLng: false, interpolation: { escapeValue: false }, resources: {
    'zh-CN': { translation: require('@/i18n/resources/zh-CN.json') },
    en: { translation: require('@/i18n/resources/en.json') }, ja: { translation: require('@/i18n/resources/ja.json') },
  } })
})
beforeEach(() => mockChange.mockClear())

function Frame() {
  const [page, setPage] = useState(0), [draft, setDraft] = useState('Unsent 草稿 下書き')
  return <IsleThemeProvider><View>
    <TextInput testID="pagination-draft" value={draft} onChangeText={setDraft} selection={{ start: 1, end: 4 }} />
    <ProviderModelPagination total={49} page={page} onChange={next => { mockChange(next); setPage(next) }} colors={getColors(mockMode, mockTheme)} />
    <IsleButton type="link" size="small" label="Reference disabled" disabled style={{ paddingHorizontal: 8 }} />
    <IsleButton type="link" size="small" label="Reference enabled" style={{ paddingHorizontal: 8 }} />
  </View></IsleThemeProvider>
}
const cases = CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).flatMap(mode =>
  (['full', 'reduced', 'none'] as const).flatMap(motion => ['zh-CN', 'en', 'ja'].map(locale => ({ family, mode, motion, locale })))))

it.each(cases)('matches theme pagination $family/$mode/$motion/$locale with real labels and bounded page actions', async ({ family, mode, motion, locale }) => {
  mockTheme = family; mockMode = mode; mockMotion = motion
  await mockI18n.changeLanguage(locale)
  const screen = await render(<Frame />)
  const previousLabel = mockI18n.t('providerSettings.previousModelPage'), nextLabel = mockI18n.t('providerSettings.nextModelPage')
  expect(previousLabel).not.toContain('providerSettings.'); expect(nextLabel).not.toContain('providerSettings.')
  const previous = () => screen.getByRole('button', { name: previousLabel })
  const next = () => screen.getByRole('button', { name: nextLabel })
  const check = (page: number) => {
    const colors = getColors(mockMode, family)
    for (const [button, disabled] of [[previous(), page === 0], [next(), page === 2]] as const) {
      const surface = (node: TestInstance) => StyleSheet.flatten(node.props.style)
      const reference = screen.getByRole('button', { name: disabled ? 'Reference disabled' : 'Reference enabled' })
      expect(surface(button)).toEqual(surface(reference))
      if (disabled) expect(button).toBeDisabled(); else expect(button).toBeEnabled()
      expect(surface(button).minHeight).toBeGreaterThanOrEqual(44)
      const label = button === previous() ? previousLabel : nextLabel
      expect(screen.getByText(label, { includeHiddenElements: true })).toHaveStyle({ color: disabled ? colors.ui.control.disabledForeground : colors.ui.control.link })
    }
    expect(screen.getByText(mockI18n.t('providerSettings.modelPageRange', { start: page * 24 + 1, end: Math.min(49, (page + 1) * 24), total: 49 }))).toBeTruthy()
  }
  check(0)
  const previousHost = previous(), nextHost = next(), draft = screen.getByTestId('pagination-draft')
  await fireEvent.changeText(draft, 'Retain edited 草稿 下書き')
  await fireEvent.press(previous()); expect(mockChange).not.toHaveBeenCalled()
  await fireEvent.press(next()); expect(mockChange).toHaveBeenLastCalledWith(1); check(1)
  await fireEvent.press(next()); expect(mockChange).toHaveBeenLastCalledWith(2); check(2)
  expect(mockChange).toHaveBeenCalledTimes(2)
  await fireEvent.press(next()); expect(mockChange).toHaveBeenCalledTimes(2)
  mockMode = mode === 'dark' ? 'light' : 'dark'
  await screen.rerender(<Frame />); check(2)
  expect(previous()).toBe(previousHost); expect(next()).toBe(nextHost)
  expect(screen.getByTestId('pagination-draft')).toBe(draft)
  expect(draft.props.value).toBe('Retain edited 草稿 下書き')
  expect(draft.props.selection).toEqual({ start: 1, end: 4 })
  await fireEvent.press(previous()); expect(mockChange).toHaveBeenLastCalledWith(1); check(1)
  await fireEvent.press(previous()); expect(mockChange).toHaveBeenLastCalledWith(0); check(0)
  expect(mockChange.mock.calls.map(([page]) => page)).toEqual([1, 2, 1, 0])
  await screen.unmount()
})

it.each([0, 1, PROVIDER_MODEL_PAGE_SIZE])('hides pagination when total=%s fits on one page', async total => {
  const screen = await render(<IsleThemeProvider><ProviderModelPagination total={total} page={0} onChange={mockChange} colors={getColors(mockMode, mockTheme)} /></IsleThemeProvider>)
  expect(screen.queryAllByRole('button')).toHaveLength(0)
  expect(mockChange).not.toHaveBeenCalled()
  await screen.unmount()
})
