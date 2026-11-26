import { useState, type ReactElement, type ReactNode } from 'react'
import { act, fireEvent, render, within } from '@testing-library/react-native'
import { Platform, StyleSheet, Text, TextInput } from 'react-native'
import { LazyLoadingFallback } from '@/utils/lazyLoad'
import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import { IsleSelect } from '../isle/IsleKit'
import { IslePressable } from '../isle/Pressable'
import { IsleThemeProvider } from '../isle/IsleThemeProvider'

let mockFamily: CanonicalThemeId = 'minimal'
let mockMode: 'light' | 'dark' = 'light'
let mockLanguage: 'en' | 'ja' | 'zh-CN' = 'en'
let mockMotion = 'full'

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => {
  const colors = require('@/theme/colors').getColors(mockMode, mockFamily)
  return { colors, design: colors.design, canonicalThemeId: mockFamily, mode: mockMode,
    isDark: mockMode === 'dark', isLiquidGlass: mockFamily === 'liquid-glass' }
} }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => mockMotion }))
jest.mock('@/hooks/useTransparencyPreference', () => ({ useTransparencyPreference: () => true }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 24, left: 0 }) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => {
  const resources = mockLanguage === 'en' ? require('@/i18n/resources/en.json')
    : mockLanguage === 'ja' ? require('@/i18n/resources/ja.json') : require('@/i18n/resources/zh-CN.json')
  return key.split('.').reduce((value: any, part) => value[part], resources)
} }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: ({ name, color }: { name: string; color: string }) =>
  require('react').createElement(require('react-native').View, { testID: `control-icon-${name}`, style: { color } }) }))
jest.mock('@/components/ui/HighFrameSpinner', () => ({ HighFrameSpinner: ({ color }: { color: string }) =>
  require('react').createElement(require('react-native').View, { testID: 'fallback-spinner', style: { color } }) }))
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { createAnimatedComponent: (component: unknown) => component },
  useSharedValue: (value: number) => require('react').useRef({ value }).current,
  useAnimatedStyle: (worklet: () => unknown) => worklet(),
  withTiming: (value: number) => value,
  withSpring: (value: number) => value,
  cancelAnimation: jest.fn(),
  Easing: { out: () => undefined, inOut: () => undefined, bezier: () => undefined },
}))

const labels = {
  en: ['First connection', 'Second connection', 'Unavailable'],
  ja: ['最初の接続', '次の接続', '利用不可'],
  'zh-CN': ['第一个连接', '第二个连接', '不可用'],
}
function Draft() {
  const [draft, setDraft] = useState('Unsent draft')
  return <TextInput testID="retained-draft" value={draft} onChangeText={setDraft} selection={{ start: 1, end: 4 }} />
}
function Frame({ children }: { children: ReactNode }) {
  return <IsleThemeProvider>
    <IslePressable testID="interaction-reference"><Text>Reference</Text></IslePressable>
    <Draft />
    {children}
  </IsleThemeProvider>
}
type Screen = Awaited<ReturnType<typeof render>>
type Target = () => ReturnType<Screen['getByTestId']>
async function gestures(screen: Screen, tree: () => ReactElement, target: Target) {
  const reference = () => screen.getByTestId('interaction-reference', { includeHiddenElements: true })
  const compare = () => {
    const expected = StyleSheet.flatten(reference().props.style)
    expect(target()).toHaveStyle({ transform: expected.transform, opacity: expected.opacity })
  }
  for (const motion of ['full', 'reduced', 'none']) {
    mockMotion = motion
    await screen.rerender(tree())
    for (const event of ['hoverIn', 'focus', 'pressIn']) {
      await fireEvent(reference(), event)
      await fireEvent(target(), event)
      await screen.rerender(tree())
      compare()
    }
    if (motion === 'full') expect(StyleSheet.flatten(reference().props.style).transform[0].scale).toBeLessThan(1)
    else expect(target()).toHaveStyle({ transform: [{ scale: 1 }] })
    if (motion === 'none') expect(target()).toHaveStyle({ opacity: 1 })
    for (const event of ['pressOut', 'blur', 'hoverOut']) {
      await fireEvent(reference(), event)
      await fireEvent(target(), event)
    }
    await screen.rerender(tree())
    compare()
    expect(target()).toHaveStyle({ transform: [{ scale: 1 }], opacity: 1 })
  }
}

beforeEach(() => { mockMotion = 'full' })
afterEach(() => jest.restoreAllMocks())
const appearances = CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).flatMap(mode =>
  (['en', 'ja', 'zh-CN'] as const).map(language => ({ family, mode, language }))))

it.each(appearances)('themes the $family/$mode/$language loading escape through gestures and appearance changes', async ({ family, mode, language }) => {
  mockFamily = family; mockMode = mode; mockLanguage = language
  const dismiss = jest.fn()
  let customLabel: string | undefined
  const tree = () => <Frame><LazyLoadingFallback onDismiss={dismiss} dismissLabel={customLabel} /></Frame>
  const screen = await render(tree())
  const escape = () => screen.getAllByRole('button').find(button => button.props.accessibilityLabel !== undefined)!
  expect(escape()).toHaveStyle({ minWidth: 88, minHeight: 44 })
  await gestures(screen, tree, escape)
  expect(dismiss).not.toHaveBeenCalled()
  const draft = screen.getByTestId('retained-draft')
  await fireEvent.changeText(draft, 'Preserve loading draft')
  mockMode = mode === 'light' ? 'dark' : 'light'
  mockFamily = CANONICAL_THEME_IDS[(CANONICAL_THEME_IDS.indexOf(family) + 1) % CANONICAL_THEME_IDS.length]
  await screen.rerender(tree())
  expect(screen.getByTestId('retained-draft')).toBe(draft)
  expect(draft.props.value).toBe('Preserve loading draft')
  expect(draft.props.selection).toEqual({ start: 1, end: 4 })
  expect(screen.getByTestId('fallback-spinner')).toHaveStyle({ color: getColors(mockMode, mockFamily).ui.icon.accentForeground })
  expect(screen.getByRole('progressbar').props.accessibilityState.busy).toBe(true)
  customLabel = labels[language][0]
  await screen.rerender(tree())
  await fireEvent.press(screen.getByRole('button', { name: customLabel }))
  expect(dismiss).toHaveBeenCalledTimes(1)
  await screen.unmount()
})

const nativeCases = (['android', 'ios'] as const).flatMap(platform => (['light', 'dark'] as const).flatMap(mode =>
  (['en', 'ja', 'zh-CN'] as const).map(language => ({ platform, mode, language }))))

it.each(nativeCases)('themes the island $platform/$mode/$language select without changing native boundaries or selection', async ({ platform, mode, language }) => {
  jest.replaceProperty(Platform, 'OS', platform)
  mockFamily = 'animal-island-ui'; mockMode = mode; mockLanguage = language
  const change = jest.fn()
  let disabled = false, value = 'first'
  const options = [
    { value: 'first', label: labels[language][0] },
    { value: 'second', label: labels[language][1] },
    { value: 'off', label: labels[language][2], disabled: true },
  ]
  const tree = () => <Frame><IsleSelect testID="native-choice" accessibilityLabel="Connection" value={value}
    options={options} disabled={disabled} onChange={change} /></Frame>
  const screen = await render(tree())
  const trigger = () => screen.getByTestId('native-choice-trigger', { includeHiddenElements: true })
  const host = trigger()
  await gestures(screen, tree, trigger)
  await fireEvent.press(trigger())
  const first = () => screen.getByTestId('native-choice-option-first')
  const second = () => screen.getByTestId('native-choice-option-second')
  await gestures(screen, tree, first)
  await gestures(screen, tree, second)
  expect(change).not.toHaveBeenCalled()
  expect(first().props.accessibilityState).toMatchObject({ selected: true, disabled: false })
  expect(within(first()).getAllByTestId('control-icon-check', { includeHiddenElements: true })).toHaveLength(1)
  const blocked = screen.getByTestId('native-choice-option-off')
  expect(blocked).toBeDisabled()
  expect(blocked.props.focusable).toBe(false)
  for (const event of ['hoverIn', 'focus', 'pressIn', 'press']) await fireEvent(blocked, event)
  await screen.rerender(tree())
  expect(blocked).toHaveStyle({ opacity: 1, transform: [{ scale: 1 }] })
  expect(change).not.toHaveBeenCalled()
  const draft = screen.getByTestId('retained-draft', { includeHiddenElements: true })
  await fireEvent.changeText(draft, 'Preserve select draft')
  mockMode = mode === 'light' ? 'dark' : 'light'
  await screen.rerender(tree())
  expect(trigger()).toBe(host)
  expect(first()).toHaveStyle({ minHeight: 44, backgroundColor: getColors(mockMode, mockFamily).ui.tone.success.background })
  expect(screen.getByTestId('retained-draft', { includeHiddenElements: true })).toBe(draft)
  expect(draft.props.value).toBe('Preserve select draft')
  expect(draft.props.selection).toEqual({ start: 1, end: 4 })
  const backdrop = screen.getByTestId('native-choice-backdrop', { includeHiddenElements: true })
  expect(backdrop.props).toMatchObject({ accessible: false, accessibilityRole: 'none', focusable: false, importantForAccessibility: 'no-hide-descendants' })
  expect(StyleSheet.flatten(backdrop.props.style).transform).toBeUndefined()
  await fireEvent.press(backdrop)
  expect(screen.queryByTestId('native-choice-listbox')).toBeNull()
  expect(change).not.toHaveBeenCalled()
  await fireEvent.press(trigger())
  await act(() => screen.getByTestId('native-choice-modal').props.onRequestClose())
  expect(screen.queryByTestId('native-choice-listbox')).toBeNull()
  await fireEvent.press(trigger())
  await fireEvent.press(second())
  expect(change).toHaveBeenCalledTimes(1); expect(change).toHaveBeenCalledWith('second')
  expect(trigger()).toHaveAccessibilityValue({ text: labels[language][0] })
  value = 'second'
  await screen.rerender(tree())
  expect(trigger()).toHaveAccessibilityValue({ text: labels[language][1] })
  disabled = true
  await screen.rerender(tree())
  expect(trigger()).toBeDisabled()
  expect(trigger()).toHaveStyle({ opacity: 1 })
  const disabledColors = getColors(mockMode, mockFamily)
  expect(screen.getByTestId('native-choice')).toHaveStyle({ opacity: disabledColors.ui.control.disabledOpacity })
  expect(trigger()).toHaveStyle({ backgroundColor: disabledColors.ui.control.disabledBackground, borderColor: disabledColors.ui.control.disabledBorder })
  expect(within(trigger()).getByText(labels[language][1])).toHaveStyle({ color: disabledColors.ui.control.disabledForeground })
  expect(within(trigger()).getByTestId('control-icon-collapse')).toHaveStyle({ color: disabledColors.ui.control.disabledForeground })
  await fireEvent.press(trigger())
  expect(screen.queryByTestId('native-choice-listbox')).toBeNull()
  disabled = false
  await screen.rerender(tree())
  await fireEvent.press(trigger())
  expect(screen.getByTestId('native-choice-listbox')).toBeTruthy()
  expect(change).toHaveBeenCalledTimes(1)
  await screen.unmount()
})
