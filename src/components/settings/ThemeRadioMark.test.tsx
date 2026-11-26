import { useState } from 'react'
import { fireEvent, render } from '@testing-library/react-native'
import { TextInput, View } from 'react-native'
import type { TestInstance } from 'test-renderer'
import { ThemeRadioMark } from './ThemeRadioMark'
import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import type { MotionIntensity } from '@/theme/themeMotion'

let mockFamily: CanonicalThemeId = 'minimal'
let mockMode: 'light' | 'dark' = 'light'
let mockMotion: MotionIntensity = 'full'
let mockAccent: string | undefined

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => {
  const colors = require('@/theme/colors').getColors(mockMode, mockFamily, undefined, mockAccent)
  return { colors, design: colors.design, canonicalThemeId: mockFamily, mode: mockMode, isDark: mockMode === 'dark' }
} }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => mockMotion }))
jest.mock('moti', () => ({ MotiView: require('react-native').View }))

function Draft() {
  const [draft, setDraft] = useState('Unsent draft 草稿 下書き')
  return <TextInput testID="radio-draft" value={draft} onChangeText={setDraft} selection={{ start: 1, end: 4 }} />
}
function Frame({ active, disabled = false, surface }: Parameters<typeof ThemeRadioMark>[0]) {
  return <View><Draft /><View testID="radio-host"><ThemeRadioMark active={active} disabled={disabled} surface={surface} /></View></View>
}

type Screen = Awaited<ReturnType<typeof render>>
const mark = (screen: Screen) => screen.getByTestId('radio-host').children[0] as TestInstance
const indicator = (screen: Screen) => mark(screen).children[0] as TestInstance
const cases = CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).flatMap(mode =>
  (['full', 'reduced', 'none'] as const).flatMap(motion => [true, false].map(active => ({ family, mode, motion, active })))))

it.each(cases)('preserves enabled $family/$mode/$motion/active=$active radio semantics', async ({ family, mode, motion, active }) => {
  mockFamily = family; mockMode = mode; mockMotion = motion
  const screen = await render(<Frame active={active} />)
  expect(mark(screen).props.animate.opacity).toBe(1)
  expect(indicator(screen).props.animate.opacity).toBe(active ? 1 : 0)
  expect(indicator(screen).props.animate.scale).toBe(motion === 'full' && !active ? 0.45 : 1)
  expect(mark(screen).props.accessible).toBe(false)
  expect(mark(screen).props.pointerEvents).toBe('none')
  expect(mark(screen).props.importantForAccessibility).toBe('no-hide-descendants')
  await screen.unmount()
})

it.each(CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).flatMap(mode =>
  (['full', 'reduced', 'none'] as const).map(motion => ({ family, mode, motion })))))('retains $family/$mode/$motion hosts, geometry and draft when the surface, accent or disabled state changes', async ({ family, mode, motion }) => {
  mockFamily = family; mockMode = mode; mockMotion = motion; mockAccent = undefined
  const tree = (surface: 'default' | 'primary', disabled = false) => <Frame active surface={surface} disabled={disabled} />
  const screen = await render(tree('default'))
  const host = mark(screen), dot = indicator(screen), draft = screen.getByTestId('radio-draft')
  const geometry = host.props.style
  const { backgroundColor: _initialColor, ...dotGeometry } = dot.props.style
  const transition = host.props.transition
  await fireEvent.changeText(draft, 'Keep this surface draft 草稿 下書き')
  try {
    for (const accent of [undefined, '#0F766E', '#4F46A5', '#B94B3F', '#A96A12', '#000000', '#FFFFFF']) {
      mockAccent = accent
      const colors = getColors(mode, family, undefined, accent)
      let enabledFill: string | undefined
      for (const surface of ['primary', 'default'] as const) {
        for (const disabled of [true, false]) {
          await screen.rerender(tree(surface, disabled))
          expect(mark(screen)).toBe(host)
          expect(indicator(screen)).toBe(dot)
          expect(host.props.style).toEqual(geometry)
          const { backgroundColor: _color, ...currentGeometry } = dot.props.style
          expect(currentGeometry).toEqual(dotGeometry)
          expect(host.props.transition).toEqual(transition)
          expect(dot.props.animate).toEqual({ opacity: 1, scale: 1 })
          expect(host.props.animate.opacity).toBe(disabled ? colors.ui.control.disabledOpacity : 1)
          if (disabled) {
            expect(host.props.animate.backgroundColor).toBe(colors.ui.control.disabledBackground)
            expect(dot).toHaveStyle({ backgroundColor: colors.ui.control.disabledForeground })
          } else {
            enabledFill ??= host.props.animate.backgroundColor
            expect(host.props.animate.backgroundColor).toBe(enabledFill)
          }
          expect(screen.getByTestId('radio-draft')).toBe(draft)
          expect(draft.props.value).toBe('Keep this surface draft 草稿 下書き')
          expect(draft.props.selection).toEqual({ start: 1, end: 4 })
        }
      }
    }
  } finally {
    mockAccent = undefined
    await screen.unmount()
  }
})

it.each(['light', 'dark'] as const)('preserves the opaque Monet %s wash and its paired dot on a primary host', async mode => {
  mockFamily = 'monet'; mockMode = mode; mockMotion = 'none'; mockAccent = undefined
  const colors = getColors(mode, 'monet')
  const screen = await render(<Frame active surface="primary" />)
  expect(mark(screen).props.animate.backgroundColor).toBe(colors.ui.icon.accentBackground)
  expect(indicator(screen)).toHaveStyle({ backgroundColor: colors.ui.icon.accentForeground })
  await screen.unmount()
})

it.each(cases)('uses theme disabled opacity for $family/$mode/$motion/active=$active without losing the draft or selection', async ({ family, mode, motion, active }) => {
  mockFamily = family; mockMode = mode; mockMotion = motion
  const tree = (disabled: boolean) => <Frame active={active} disabled={disabled} />
  const screen = await render(tree(false))
  const host = mark(screen), draft = screen.getByTestId('radio-draft')
  await fireEvent.changeText(draft, 'Keep this edited draft 草稿 下書き')
  await screen.rerender(tree(true))
  const check = () => {
    const colors = getColors(mockMode, mockFamily)
    expect(mark(screen).props.animate).toEqual({ backgroundColor: colors.ui.control.disabledBackground,
      borderColor: colors.ui.control.disabledBorder, opacity: colors.ui.control.disabledOpacity })
    expect(indicator(screen)).toHaveStyle({ backgroundColor: colors.ui.control.disabledForeground })
    expect(indicator(screen).props.animate.opacity).toBe(active ? 1 : 0)
    expect(mark(screen)).toBe(host)
    expect(screen.getByTestId('radio-draft')).toBe(draft)
    expect(draft.props.value).toBe('Keep this edited draft 草稿 下書き')
    expect(draft.props.selection).toEqual({ start: 1, end: 4 })
  }
  check()
  mockMode = mode === 'dark' ? 'light' : 'dark'
  await screen.rerender(tree(true))
  check()
  await screen.rerender(tree(false))
  expect(mark(screen)).toBe(host)
  expect(mark(screen).props.animate.opacity).toBe(1)
  expect(indicator(screen).props.animate.opacity).toBe(active ? 1 : 0)
  expect(screen.getByTestId('radio-draft')).toBe(draft)
  expect(draft.props.value).toBe('Keep this edited draft 草稿 下書き')
  await screen.unmount()
})
