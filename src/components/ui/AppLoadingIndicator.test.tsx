import { render } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'
import { AppLoadingIndicator } from './AppLoadingIndicator'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS } from '@/types/settingsContracts'

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: jest.fn(() => 'none') }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: () => 'Loading' }) }))
jest.mock('moti', () => ({ MotiView: (props: any) => require('react').createElement(require('react-native').View,
  { ...props, testID: 'animated-loading-mark' }) }))

it.each(CANONICAL_THEME_IDS)('uses %s graphics in both modes with a static reduced-motion mark', async family => {
  for (const mode of ['light', 'dark'] as const) for (const motion of ['full', 'reduced', 'none'] as const) {
    const colors = getColors(mode, family)
    jest.mocked(useAppTheme).mockReturnValue({ colors, canonicalThemeId: family, mode } as ReturnType<typeof useAppTheme>)
    jest.mocked(useMotionPreference).mockReturnValue(motion)
    const screen = await render(<AppLoadingIndicator testID="loading" size="large" />)
    expect(screen.getByRole('progressbar', { name: 'Loading' }).props.accessibilityState.busy).toBe(true)
    expect(screen.getByTestId(`theme-loading-${family}`, { includeHiddenElements: true })).toHaveStyle({ width: 36, height: 36 })
    const animated = screen.queryAllByTestId('animated-loading-mark', { includeHiddenElements: true })
    expect(animated.length > 0).toBe(motion === 'full')
    for (const mark of animated) expect(mark.props.transition).toMatchObject({ loop: true })
    await screen.unmount()
  }
})

it('keeps status labels, explicit colors, sizing and stopped layout under application control', async () => {
  const colors = getColors('dark', 'material')
  jest.mocked(useAppTheme).mockReturnValue({ colors, canonicalThemeId: 'material', mode: 'dark' } as ReturnType<typeof useAppTheme>)
  jest.mocked(useMotionPreference).mockReturnValue('full')
  const screen = await render(<AppLoadingIndicator testID="status" accessibilityLabel="Reading saved source" color="#abcdef" size={24} />)
  expect(screen.getByRole('progressbar', { name: 'Reading saved source' })).toBeTruthy()
  expect(screen.getByTestId('theme-loading-material', { includeHiddenElements: true })).toHaveStyle({ width: 24 })
  expect(screen.getByTestId('animated-loading-mark', { includeHiddenElements: true })).toHaveStyle({ borderColor: '#abcdef' })
  await screen.rerender(<AppLoadingIndicator testID="status" animating={false} hidesWhenStopped={false} />)
  expect(screen.queryByTestId('animated-loading-mark', { includeHiddenElements: true })).toBeNull()
  // The graphic is intentionally hidden from accessibility; its visual ancestry must stay opaque.
  const mark = screen.getByTestId('theme-loading-material', { includeHiddenElements: true })
  let ancestor: typeof mark | null = mark
  while (ancestor) {
    expect(StyleSheet.flatten(ancestor.props.style)?.opacity).not.toBe(0)
    ancestor = ancestor.parent
  }
  expect(screen.getByTestId('status').props.accessibilityState.busy).toBe(false)
  await screen.rerender(<AppLoadingIndicator testID="status" animating={false} />)
  expect(screen.queryByTestId('status')).toBeNull()
})
