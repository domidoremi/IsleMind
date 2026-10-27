import { act, render } from '@testing-library/react-native'
import { useEffect, useState } from 'react'
import { AccessibilityInfo, Animated, StyleSheet, View } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import { IsleProgress } from './IsleKit'
import { IsleThemeProvider } from './IsleThemeProvider'

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: jest.fn(() => 'none') }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
// Inspect host animation instructions; the native fork still uses real RN Animated.
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: { fine: 1.5, regular: 1.75, strong: 2 } }))
jest.mock('@/components/ui/HighFrameSpinner', () => ({ HighFrameSpinner: () => null }))

const localThemes = CANONICAL_THEME_IDS.filter(id => id !== 'animal-island-ui')
type Screen = Awaited<ReturnType<typeof render>>

function setTheme(id: CanonicalThemeId, mode: 'light' | 'dark' = 'light') {
  const colors = getColors(mode, id)
  jest.mocked(useAppTheme).mockReturnValue({
    colors, design: colors.design!, canonicalThemeId: id, mode, themeMode: mode,
    isDark: mode === 'dark', isMinimal: id === 'minimal', isMonet: id === 'monet',
    isMaterial: id === 'material', isLiquidGlass: id === 'liquid-glass', isAnimalIsland: id === 'animal-island-ui',
  } as ReturnType<typeof useAppTheme>)
}

function value(screen: Screen) {
  const bar = screen.getByRole('progressbar')
  return {
    now: bar.props['aria-valuenow'] ?? bar.props.accessibilityValue?.now,
    text: bar.props['aria-valuetext'] ?? bar.props.accessibilityValue?.text,
  }
}

function fill(screen: Screen) {
  const result = screen.container.queryAll(node => typeof node.props.animate?.width === 'string')[0]
  expect(result).toBeDefined()
  return result!
}

beforeEach(() => {
  setTheme('animal-island-ui')
  jest.mocked(useMotionPreference).mockReturnValue('none')
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false)
})

afterEach(() => {
  jest.restoreAllMocks()
  jest.useRealTimers()
})

describe.each(CANONICAL_THEME_IDS)('%s host progress', family => {
  it.each(['light', 'dark'] as const)('publishes the real determinate value in the %s accessibility tree', async mode => {
    setTheme(family, mode)
    const screen = await render(<IsleThemeProvider><IsleProgress percent={35} /></IsleThemeProvider>)
    expect(value(screen)).toEqual({ now: 35, text: '35%' })
    await screen.unmount()
  })

  it.each(['light', 'dark'] as const)('does not invent a percentage for unknown progress in %s', async mode => {
    setTheme(family, mode)
    const screen = await render(<IsleThemeProvider><IsleProgress percent={35} indeterminate /></IsleThemeProvider>)
    expect(screen.queryByText('35%')).toBeNull()
    expect(value(screen).now).toBeUndefined()
    expect(value(screen).text ?? '').toBe('')
    await screen.unmount()
  })

  it('evaluates the host formatter once rather than before and inside the native renderer', async () => {
    setTheme(family)
    const infoFormat = jest.fn(percent => `Formatted ${percent}`)
    const screen = await render(<IsleThemeProvider><IsleProgress percent={42} infoFormat={infoFormat} /></IsleThemeProvider>)
    expect(infoFormat).toHaveBeenCalledTimes(1)
    expect(infoFormat).toHaveBeenCalledWith(42)
    expect(screen.getByText('Formatted 42')).toBeTruthy()
    await screen.unmount()
  })

  it.each(['light', 'dark'] as const)('preserves the caller label and test identity when %s progress has no visible text', async mode => {
    setTheme(family, mode)
    const screen = await render(<IsleThemeProvider>
      <IsleProgress percent={35} showInfo={false} accessibilityLabel="Document indexing" testID="index-progress" />
    </IsleThemeProvider>)
    expect(screen.getByRole('progressbar', { name: 'Document indexing' })).toBe(screen.getByTestId('index-progress'))
    expect(value(screen).now).toBe(35)
    expect(screen.queryByText('35%')).toBeNull()
    await screen.unmount()
  })

  it('replaces stale determinate values and still exposes deliberate host status text', async () => {
    setTheme(family)
    const tree = (percent: number, indeterminate = false, custom = false) => <IsleThemeProvider>
      <IsleProgress percent={percent} indeterminate={indeterminate}
        infoFormat={custom ? () => 'Waiting for source' : undefined} />
    </IsleThemeProvider>
    const screen = await render(tree(15))
    expect(value(screen).now).toBe(15)
    await screen.rerender(tree(80, true))
    expect(value(screen).now).toBeUndefined()
    expect(value(screen).text ?? '').toBe('')
    expect(screen.queryByText('80%')).toBeNull()
    await screen.rerender(tree(80, true, true))
    expect(value(screen)).toEqual({ now: undefined, text: 'Waiting for source' })
    expect(screen.getByText('Waiting for source')).toBeTruthy()
    await screen.rerender(tree(75))
    expect(value(screen)).toEqual({ now: 75, text: '75%' })
    await screen.unmount()
  })
})

describe.each(localThemes)('%s host progress timing', family => {
  it.each(['reduced', 'none'] as const)('does not let caller timing override %s motion or delay current values', async motion => {
    setTheme(family)
    jest.mocked(useMotionPreference).mockReturnValue(motion)
    const tree = (percent: number, durationMs: number) => <IsleThemeProvider>
      <IsleProgress percent={percent} durationMs={durationMs} showInfo={false} />
    </IsleThemeProvider>
    const screen = await render(tree(15, 1200))
    expect(fill(screen).props.transition.duration).toBe(1)
    await screen.rerender(tree(75, 900))
    expect(fill(screen).props.transition.duration).toBe(1)
    expect(fill(screen).props.animate.width).toBe('75%')
    expect(value(screen).now).toBe(75)
    await screen.unmount()
  })

  it.each([
    { name: 'default', requested: undefined, expected: 176 },
    { name: 'caller duration', requested: 900, expected: 900 },
    { name: 'explicit zero', requested: 0, expected: 0 },
    { name: 'negative duration', requested: -100, expected: 0 },
    { name: 'NaN', requested: Number.NaN, expected: 0 },
    { name: 'infinity', requested: Number.POSITIVE_INFINITY, expected: 0 },
    { name: 'timer overflow', requested: 2147483648, expected: 2147483647 },
  ])('honors safe full-motion timing for $name', async ({ requested, expected }) => {
    setTheme(family)
    jest.mocked(useMotionPreference).mockReturnValue('full')
    const screen = await render(<IsleThemeProvider><IsleProgress percent={35} durationMs={requested} /></IsleThemeProvider>)
    expect(fill(screen).props.transition.duration).toBe(expected)
    await screen.unmount()
  })

  it('updates current progress when a mounted full-motion control switches to reduced motion', async () => {
    setTheme(family)
    jest.mocked(useMotionPreference).mockReturnValue('full')
    const tree = (percent: number) => <IsleThemeProvider><IsleProgress percent={percent} durationMs={900} /></IsleThemeProvider>
    const screen = await render(tree(15))
    const original = fill(screen)
    expect(original.props.transition.duration).toBe(900)
    jest.mocked(useMotionPreference).mockReturnValue('reduced')
    await screen.rerender(tree(75))
    expect(fill(screen)).toBe(original)
    expect(fill(screen).props.transition.duration).toBe(1)
    expect(fill(screen).props.animate.width).toBe('75%')
    expect(value(screen).now).toBe(75)
    await screen.unmount()
  })
})

it.each(['reduced', 'none'] as const)('the actual native fork settles %s progress without scheduling caller-duration animation', async motion => {
  setTheme('animal-island-ui')
  jest.mocked(useMotionPreference).mockReturnValue(motion)
  const timing = jest.spyOn(Animated, 'timing')
  const tree = (percent: number) => <IsleThemeProvider><IsleProgress percent={percent} durationMs={900} /></IsleThemeProvider>
  const screen = await render(tree(15))
  await screen.rerender(tree(75))
  expect(timing.mock.calls.filter(([, options]) => options.toValue === 75)).toHaveLength(0)
  expect(value(screen).now).toBe(75)
  await screen.unmount()
})

it('the actual native fork converts full caller milliseconds and cancels its active width animation on unmount', async () => {
  jest.useFakeTimers()
  setTheme('animal-island-ui')
  jest.mocked(useMotionPreference).mockReturnValue('full')
  const originalTiming = Animated.timing
  const stopped = jest.fn()
  const timing = jest.spyOn(Animated, 'timing').mockImplementation((animated, options) => {
    const animation = originalTiming(animated, options)
    const originalStop = animation.stop
    animation.stop = () => { stopped(); originalStop() }
    return animation
  })
  const tree = (percent: number) => <IsleThemeProvider>
    <IsleProgress percent={percent} durationMs={900} testID="native-progress" />
  </IsleThemeProvider>
  const screen = await render(tree(15))
  await screen.rerender(tree(75))
  expect(timing.mock.calls.filter(([, options]) => options.toValue === 75))
    .toEqual([[expect.anything(), expect.objectContaining({ duration: 900, useNativeDriver: false })]])
  await act(() => jest.advanceTimersByTime(450))
  const width = StyleSheet.flatten(screen.getByTestId('native-progress-fill', { includeHiddenElements: true }).props.style).width
  expect(Number.parseFloat(String(width))).toBeGreaterThan(15)
  expect(Number.parseFloat(String(width))).toBeLessThan(75)
  await screen.unmount()
  expect(stopped).toHaveBeenCalled()
})

it('keeps the current host value and unrelated mounted owner state through all five theme changes', async () => {
  const mounted = jest.fn()
  function Owner() {
    const [saved] = useState('saved provider alias')
    useEffect(() => { mounted() }, [])
    return <View accessibilityLabel={saved}><IsleProgress percent={75} showInfo={false} /></View>
  }
  const screen = await render(<IsleThemeProvider><Owner /></IsleThemeProvider>)
  for (const family of CANONICAL_THEME_IDS) {
    setTheme(family, 'dark')
    await screen.rerender(<IsleThemeProvider><Owner /></IsleThemeProvider>)
    expect(value(screen).now).toBe(75)
    expect(screen.getByLabelText('saved provider alias')).toBeTruthy()
  }
  expect(mounted).toHaveBeenCalledTimes(1)
  await screen.unmount()
})
