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

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => {
  const colors = require('@/theme/colors').getColors(mockMode, mockFamily)
  return { colors, design: colors.design, canonicalThemeId: mockFamily, mode: mockMode, isDark: mockMode === 'dark' }
} }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => mockMotion }))
jest.mock('moti', () => ({ MotiView: require('react-native').View }))

function Draft() {
  const [draft, setDraft] = useState('Unsent draft 草稿 下書き')
  return <TextInput testID="radio-draft" value={draft} onChangeText={setDraft} selection={{ start: 1, end: 4 }} />
}
function Frame({ active, disabled = false }: { active: boolean; disabled?: boolean }) {
  return <View><Draft /><View testID="radio-host"><ThemeRadioMark active={active} disabled={disabled} /></View></View>
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
