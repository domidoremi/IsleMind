import { fireEvent, render } from '@testing-library/react-native'
import { useAppTheme } from '@/hooks/useAppTheme'
import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS } from '@/types/settingsContracts'
import { IsleSwitch, IsleToggle } from './Primitives'
import { IsleThemeProvider } from './IsleThemeProvider'

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))

it.each(CANONICAL_THEME_IDS)('preserves named and disabled task toggles through %s light and dark appearances', async family => {
  for (const mode of ['light', 'dark'] as const) {
    const colors = getColors(mode, family)
    jest.mocked(useAppTheme).mockReturnValue({ colors, design: colors.design, canonicalThemeId: family, mode } as ReturnType<typeof useAppTheme>)
    const press = jest.fn()
    const tree = (disabled: boolean, active: boolean) => <IsleThemeProvider>
      <IsleToggle title="Continue in background" description="Keep this task running" active={active} disabled={disabled} onPress={press} />
    </IsleThemeProvider>
    const screen = await render(tree(true, false))
    const control = () => screen.getByRole('switch', { name: 'Continue in background. Keep this task running' })
    expect(screen.getAllByRole('switch')).toHaveLength(1)
    expect(control()).toBeDisabled()
    await fireEvent.press(control())
    expect(press).not.toHaveBeenCalled()
    await screen.rerender(tree(false, true))
    expect(control().props.accessibilityState.checked).toBe(true)
    await fireEvent.press(control())
    expect(press).toHaveBeenCalledTimes(1)
    await screen.unmount()
  }
})

it.each(CANONICAL_THEME_IDS)('keeps a decorative %s switch out of the input order', async family => {
  const colors = getColors('light', family)
  jest.mocked(useAppTheme).mockReturnValue({ colors, design: colors.design, canonicalThemeId: family, mode: 'light' } as ReturnType<typeof useAppTheme>)
  const press = jest.fn()
  const tree = (interactive: boolean) => <IsleThemeProvider>
    <IsleSwitch active onChange={interactive ? press : undefined} />
  </IsleThemeProvider>
  const screen = await render(tree(false))
  expect(screen.queryByRole('switch')).toBeNull()
  await screen.rerender(tree(true))
  await fireEvent.press(screen.getByRole('switch'))
  expect(press).toHaveBeenCalledTimes(1)
  await screen.unmount()
})
