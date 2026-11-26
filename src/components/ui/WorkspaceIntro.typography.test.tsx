import { useEffect, useState } from 'react'
import { fireEvent, render } from '@testing-library/react-native'
import { Platform, TextInput, View } from 'react-native'
import { AppFontContext, Text } from './AppText'
import { WorkspaceIntro } from './WorkspaceIntro'
import { IsleButton } from './isle/IsleKit'
import { IsleThemeProvider } from './isle/IsleThemeProvider'
import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import type { MotionIntensity } from '@/theme/themeMotion'
import zh from '@/i18n/resources/zh-CN.json'
import en from '@/i18n/resources/en.json'
import ja from '@/i18n/resources/ja.json'

let mockFamily: CanonicalThemeId = 'minimal'
let mockMode: 'light' | 'dark' = 'light'
let mockMotion: MotionIntensity = 'none'
let mockWidth = 360
let mockFontScale = 1
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: () => false }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => {
  const colors = require('@/theme/colors').getColors(mockMode, mockFamily)
  return { colors, design: colors.design, canonicalThemeId: mockFamily, mode: mockMode,
    isDark: mockMode === 'dark', isLiquidGlass: mockFamily === 'liquid-glass' }
} }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => mockMotion }))
jest.mock('@/hooks/useTransparencyPreference', () => ({ useTransparencyPreference: () => true }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: { strong: 2 } }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('react-native-reanimated', () => {
  const mock = require('react-native-reanimated/mock')
  return { ...mock, useSharedValue: (value: unknown) => require('react').useRef({ value }).current,
    useAnimatedStyle: (worklet: () => unknown) => worklet(), withTiming: (value: unknown) => value,
    withSpring: (value: unknown) => value, cancelAnimation: jest.fn(), runOnJS: (callback: unknown) => callback }
})
jest.spyOn(require('react-native'), 'useWindowDimensions').mockImplementation(() => ({ width: mockWidth, height: 844, scale: 1, fontScale: mockFontScale }))
const originalPlatform = Platform.OS
afterEach(() => Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform }))
const locales = [{ locale: 'zh-CN', copy: zh }, { locale: 'en', copy: en }, { locale: 'ja', copy: ja }]
const cases = CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).flatMap(mode =>
  (['full', 'reduced', 'none'] as const).flatMap(motion => locales.flatMap(({ locale, copy }) =>
    (['android', 'web'] as const).map(platform => ({ family, mode, motion, locale, copy, platform }))))))
function expected(role: 'headline' | 'title' | 'body' | 'caption', fontFamily: string) {
  const typography = { ...getColors(mockMode, mockFamily).design!.semantic.typography[role], fontFamily }
  return Platform.OS === 'web'
    ? { ...typography, lineHeight: String(Math.max(1.5, typography.lineHeight / typography.fontSize)) } as unknown as typeof typography
    : typography
}

it.each(cases)('uses workspace introduction type in $family/$mode/$motion/$locale/$platform and retains slots and draft', async ({ family, mode, motion, copy, platform }) => {
  mockFamily = family; mockMode = mode; mockMotion = motion; mockWidth = 360; mockFontScale = 1
  Object.defineProperty(Platform, 'OS', { configurable: true, value: platform })
  const title = copy.livelyUi.agentEmptyTitle, description = copy.agentTasks.newRunHint, eyebrow = copy.agents.title
  const mounted = jest.fn(), unmounted = jest.fn(), action = jest.fn()
  const slotMounted = jest.fn(), slotUnmounted = jest.fn()
  function ActionSlot({ disabled, onAction }: { disabled: boolean; onAction: () => void }) {
    const [draft, setDraft] = useState('Slot draft'), [presses, setPresses] = useState(0)
    useEffect(() => { slotMounted(); return () => { slotUnmounted() } }, [])
    return <View>
      <TextInput testID="intro-action-draft" value={draft} onChangeText={setDraft} selection={{ start: 1, end: 3 }} />
      <IsleButton label={copy.common.retry} disabled={disabled} onPress={() => { setPresses(value => value + 1); onAction() }} />
      <Text testID="intro-action-count">{presses}</Text>
    </View>
  }
  function Owner({ compact, detail, disabled }: { compact: boolean; detail: boolean; disabled: boolean }) {
    const [draft, setDraft] = useState('Unsent 草稿 下書き')
    const [opened, setOpened] = useState(false)
    useEffect(() => { mounted(); return () => { unmounted() } }, [])
    return <View>
      <TextInput testID="intro-owner-draft" value={draft} onChangeText={setDraft} selection={{ start: 2, end: 5 }} />
      <WorkspaceIntro title={title} description={detail ? description : undefined} eyebrow={eyebrow} icon="workflow" compact={compact} testID="intro"
        status={<Text testID="intro-status">{copy.common.loading}</Text>}
        action={<ActionSlot disabled={disabled} onAction={() => { action(); setOpened(value => !value) }} />} />
      {opened ? <Text testID="intro-opened">{copy.common.close}</Text> : null}
    </View>
  }
  const tree = (font: string, compact = false, detail = true, disabled = false) => <IsleThemeProvider>
    <AppFontContext.Provider value={font}><Owner compact={compact} detail={detail} disabled={disabled} /></AppFontContext.Provider>
  </IsleThemeProvider>
  const screen = await render(tree('Context A'))
  function check(font: string, compact = false, detail = true) {
    const colors = getColors(mockMode, mockFamily)
    if (detail) {
      expect(screen.getByText(description)).toHaveStyle({ ...expected('body', font), color: colors.textSecondary })
      expect(screen.getByText(description).props.selectable).toBe(true)
      expect(screen.getByText(description).props.numberOfLines).toBeUndefined()
    } else expect(screen.queryByText(description)).toBeNull()
    expect(screen.getByRole('header', { name: title })).toHaveStyle({ ...expected(compact ? 'title' : 'headline', font), color: colors.text })
    // The existing eyebrow tracking is an intentional editorial cue.
    expect(screen.getByText(eyebrow)).toHaveStyle({ ...expected('caption', font), letterSpacing: 1.2, color: colors.textTertiary })
    expect(screen.getByTestId('intro')).toHaveStyle({ minWidth: 0, gap: compact ? 8 : 12, paddingVertical: compact ? 4 : 8 })
    expect(screen.getByRole('button', { name: copy.common.retry })).toHaveStyle({ minHeight: 44 })
  }
  check('Context A')
  const draft = screen.getByTestId('intro-owner-draft'), heading = screen.getByRole('header', { name: title })
  const detail = screen.getByText(description), status = screen.getByTestId('intro-status'), actionDraft = screen.getByTestId('intro-action-draft')
  let button = screen.getByRole('button', { name: copy.common.retry }), buttonFamily = mockFamily
  await fireEvent.changeText(draft, 'Retained 草稿 下書き')
  await fireEvent.changeText(actionDraft, 'Retained slot draft')
  await fireEvent.press(button)
  expect(action).toHaveBeenCalledTimes(1); expect(screen.getByTestId('intro-opened')).toBeTruthy()
  const nextFamily = CANONICAL_THEME_IDS[(CANONICAL_THEME_IDS.indexOf(family) + 1) % CANONICAL_THEME_IDS.length]
  for (const [index, target] of [nextFamily, family].entries()) {
    mockFamily = target; mockMode = mockMode === 'light' ? 'dark' : 'light'
    mockWidth = index === 0 ? 844 : 1280; mockFontScale = index === 0 ? 1.8 : 2
    const font = `Context ${index}`
    await screen.rerender(tree(font, index === 0)); check(font, index === 0)
    expect(screen.getByTestId('intro-owner-draft')).toBe(draft)
    expect(draft.props).toMatchObject({ value: 'Retained 草稿 下書き', selection: { start: 2, end: 5 } })
    expect(screen.getByRole('header', { name: title })).toBe(heading)
    expect(screen.getByText(description)).toBe(detail); expect(screen.getByTestId('intro-status')).toBe(status)
    const currentButton = screen.getByRole('button', { name: copy.common.retry })
    // Existing IsleButton intentionally selects its shared implementation for Animal Island.
    // Check that exact branch behavior while preserving the action slot's own state.
    expect(currentButton === button).toBe((buttonFamily === 'animal-island-ui') === (mockFamily === 'animal-island-ui'))
    button = currentButton; buttonFamily = mockFamily
    expect(screen.getByTestId('intro-action-draft')).toBe(actionDraft)
    expect(actionDraft.props).toMatchObject({ value: 'Retained slot draft', selection: { start: 1, end: 3 } })
    expect(screen.getByTestId('intro-action-count').props.children).toBe(1)
    expect(slotMounted).toHaveBeenCalledTimes(1); expect(slotUnmounted).not.toHaveBeenCalled()
    expect(screen.getByTestId('intro-opened')).toBeTruthy()
    expect(mounted).toHaveBeenCalledTimes(1); expect(unmounted).not.toHaveBeenCalled(); expect(action).toHaveBeenCalledTimes(1)
  }
  await screen.rerender(tree('Final font', true, false, true)); check('Final font', true, false)
  expect(button).toBeDisabled(); await fireEvent.press(button); expect(action).toHaveBeenCalledTimes(1)
  expect(screen.getByTestId('intro-opened')).toBeTruthy()
  await screen.rerender(tree('Final font', true, false)); await fireEvent.press(button)
  expect(action).toHaveBeenCalledTimes(2); expect(screen.queryByTestId('intro-opened')).toBeNull()
  expect(screen.getByTestId('intro-owner-draft')).toBe(draft); expect(draft.props.value).toBe('Retained 草稿 下書き')
  expect(screen.getByTestId('intro-action-count').props.children).toBe(2)
  expect(screen.getByTestId('intro-action-draft')).toBe(actionDraft)
  await screen.unmount(); expect(unmounted).toHaveBeenCalledTimes(1); expect(slotUnmounted).toHaveBeenCalledTimes(1)
})
