import { useState } from 'react'
import type { TestInstance } from 'test-renderer'
import { fireEvent, render } from '@testing-library/react-native'
import { StyleSheet, TextInput, View } from 'react-native'
import { ComposerToolButton } from '../FloatingComposerControls'
import { IslePressable } from '@/components/ui/isle/Pressable'
import { IsleThemeProvider } from '@/components/ui/isle/IsleThemeProvider'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import type { MotionIntensity } from '@/theme/themeMotion'

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
jest.mock('react-native-reanimated', () => {
  const mock = require('react-native-reanimated/mock')
  return { ...mock, useSharedValue: (value: unknown) => require('react').useRef({ value }).current,
    useAnimatedStyle: (worklet: () => unknown) => worklet(), withTiming: (value: unknown) => value,
    withSpring: (value: unknown) => value, cancelAnimation: jest.fn(), runOnJS: (callback: unknown) => callback }
})
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
// Keep the production pressable and its theme grammar while isolating unrelated barrel exports.
jest.mock('@/components/ui/isle', () => jest.requireActual('@/components/ui/isle/Pressable'))

type Variant = { compact: boolean; iconOnly: boolean; activeSurface: 'strong' | 'quiet' }
const variants: Variant[] = [false, true].flatMap(compact => [false, true].flatMap(iconOnly =>
  (['strong', 'quiet'] as const).map(activeSurface => ({ compact, iconOnly, activeSurface }))))
function Frame({ active, disabled, variant, onPress }: { active: boolean; disabled: boolean; variant: Variant; onPress: () => void }) {
  const [draft, setDraft] = useState('Unsent 草稿 下書き')
  return <IsleThemeProvider><View>
    <TextInput testID="tool-draft" value={draft} onChangeText={setDraft} selection={{ start: 1, end: 4 }} />
    <ComposerToolButton {...variant} active={active} disabled={disabled} label="Tool 工具 操作" stateLabel="High 高 高"
      testID="composer-tool" accessibilityHint="Choose a tool" accessibilityState={{ selected: active, busy: false, expanded: true }} onPress={onPress}>
      <View testID="tool-icon" />
    </ComposerToolButton>
    <IslePressable testID="theme-reference" accessibilityLabel="Reference tool" disabled={disabled} />
  </View></IsleThemeProvider>
}
const cases = CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).flatMap(mode =>
  (['full', 'reduced', 'none'] as const).flatMap(motion => [false, true].map(active => ({ family, mode, motion, active })))))

it.each(cases)('uses only theme disabled dimming for $family/$mode/$motion/active=$active and retains the tool session', async ({ family, mode, motion, active }) => {
  mockTheme = family; mockMode = mode; mockMotion = motion
  const onPress = jest.fn()
  const tree = (disabled: boolean, variant = variants[0]) => <Frame active={active} disabled={disabled} variant={variant} onPress={onPress} />
  const screen = await render(tree(false))
  const button = () => screen.getByTestId('composer-tool')
  const face = () => button().children[0] as TestInstance
  const opacity = (node: TestInstance) => StyleSheet.flatten(node.props.style).opacity ?? 1
  const check = (disabled: boolean) => {
    expect(opacity(face())).toBe(1)
    const standardOpacity = opacity(screen.getByTestId('theme-reference'))
    expect(opacity(button()) * opacity(face())).toBe(standardOpacity)
    expect(button().props.accessibilityState).toMatchObject({ disabled, selected: active, busy: false, expanded: true })
    expect(button().props.accessibilityHint).toBe('Choose a tool')
    expect(button().props.hitSlop).toEqual({ top: 8, right: 6, bottom: 8, left: 6 })
    expect(button()).toHaveStyle({ minHeight: 44 })
    expect(face()).toHaveStyle({ minHeight: 44 })
  }
  check(false)
  const originalButton = button(), originalFace = face(), draft = screen.getByTestId('tool-draft')
  await fireEvent.changeText(draft, 'Retain edited 草稿 下書き')
  await fireEvent.press(button()); expect(onPress).toHaveBeenCalledTimes(1)
  await screen.rerender(tree(true)); check(true)
  await fireEvent.press(button()); expect(onPress).toHaveBeenCalledTimes(1)
  mockMode = mode === 'dark' ? 'light' : 'dark'
  for (const variant of variants) {
    await screen.rerender(tree(true, variant)); check(true)
    expect(button()).toBe(originalButton); expect(face()).toBe(originalFace)
    expect(screen.getByTestId('tool-draft')).toBe(draft)
    expect(draft.props.value).toBe('Retain edited 草稿 下書き')
    expect(draft.props.selection).toEqual({ start: 1, end: 4 })
  }
  await screen.rerender(tree(false)); check(false)
  await fireEvent.press(button()); expect(onPress).toHaveBeenCalledTimes(2)
  await screen.unmount()
})
