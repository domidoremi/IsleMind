import { act, fireEvent, render } from '@testing-library/react-native'
import { StyleSheet, Text } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'
import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS } from '@/types/settingsContracts'
import { AnimatedNavigationTrigger } from '@/components/navigation/AnimatedNavigationTrigger'
import { IsleIconButton } from './Primitives'
import { IsleThemeProvider } from './IsleThemeProvider'

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('@/components/ui/HighFrameSpinner', () => ({ HighFrameSpinner: () => null }))
jest.mock('@/components/navigation/AnimatedNavigationIcon', () => ({
  AnimatedNavigationIcon: ({ color, accentColor }: { color: string; accentColor: string }) =>
    require('react').createElement(require('react-native').View, null,
      require('react').createElement(require('react-native').Text, { testID: 'navigation-icon', style: { color } }, 'Navigate'),
      require('react').createElement(require('react-native').Text, { testID: 'navigation-accent', style: { color: accentColor } }, 'Accent')),
}))

it.each(CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).map(mode => ({ family, mode }))))(
  'keeps $family $mode icon-only controls on their current tone and disabled foreground',
  async ({ family, mode }) => {
    const colors = getColors(mode, family)
    jest.mocked(useAppTheme).mockReturnValue({ colors, design: colors.design!, canonicalThemeId: family,
      mode, isDark: mode === 'dark' } as ReturnType<typeof useAppTheme>)
    const press = jest.fn()
    const tree = (tone: 'default' | 'mint' | 'amber' | 'ink' | 'danger', disabled = false) =>
      <IsleThemeProvider><IsleIconButton label="Close" tone={tone} disabled={disabled} onPress={press}>
        {foreground => <Text testID="icon" style={{ color: foreground }}>Close icon</Text>}
      </IsleIconButton></IsleThemeProvider>
    const screen = await render(tree('default'))
    for (const tone of ['default', 'mint', 'amber', 'ink', 'danger'] as const) {
      await screen.rerender(tree(tone))
      const enabledForeground = family === 'liquid-glass' && tone === 'default' ? colors.text
        : StyleSheet.flatten(screen.getByText('Close', { includeHiddenElements: true }).props.style).color
      expect(screen.getByTestId('icon', { includeHiddenElements: true })).toHaveStyle({ color: enabledForeground })
      await fireEvent.press(screen.getByRole('button', { name: 'Close' }))
      const activations = press.mock.calls.length
      await screen.rerender(tree(tone, true))
      expect(screen.getByTestId('icon', { includeHiddenElements: true })).toHaveStyle({ color: colors.ui.control.disabledForeground })
      expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
      await fireEvent.press(screen.getByRole('button', { name: 'Close' }))
      expect(press).toHaveBeenCalledTimes(activations)
      await screen.rerender(tree(tone))
      expect(screen.getByTestId('icon', { includeHiddenElements: true })).toHaveStyle({ color: enabledForeground })
    }
    await screen.rerender(<IsleThemeProvider><IsleIconButton label="Brand">
      <Text testID="brand" style={{ color: '#aa1122' }}>Brand</Text>
    </IsleIconButton></IsleThemeProvider>)
    expect(screen.getByTestId('brand', { includeHiddenElements: true })).toHaveStyle({ color: '#aa1122' })
    await screen.unmount()
  },
)

it.each(CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).map(mode => ({ family, mode }))))(
  'keeps $family $mode navigation icons disabled during an async transition and restores explicit accents',
  async ({ family, mode }) => {
    const colors = getColors(mode, family)
    jest.mocked(useAppTheme).mockReturnValue({ colors, design: colors.design!, canonicalThemeId: family,
      mode, isDark: mode === 'dark' } as ReturnType<typeof useAppTheme>)
    let finish!: () => void
    const navigate = jest.fn(() => new Promise<void>(resolve => { finish = resolve }))
    const tree = (disabled = false) => <IsleThemeProvider>
      <AnimatedNavigationTrigger variant="iconButton" label="New chat" glyph="new-chat" tone="mint"
        disabled={disabled} onNavigate={navigate} color={colors.ui.control.primaryForeground}
        accentColor={colors.ui.icon.accentForeground} />
    </IsleThemeProvider>
    const screen = await render(tree())
    expect(screen.getByTestId('navigation-icon', { includeHiddenElements: true }))
      .toHaveStyle({ color: colors.ui.control.primaryForeground })
    await fireEvent.press(screen.getByRole('button', { name: 'New chat' }))
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'New chat' })).toBeDisabled()
    for (const id of ['navigation-icon', 'navigation-accent']) {
      expect(screen.getByTestId(id, { includeHiddenElements: true })).toHaveStyle({ color: colors.ui.control.disabledForeground })
    }
    await fireEvent.press(screen.getByRole('button', { name: 'New chat' }))
    expect(navigate).toHaveBeenCalledTimes(1)
    await act(async () => finish())
    expect(screen.getByRole('button', { name: 'New chat' })).not.toBeDisabled()
    expect(screen.getByTestId('navigation-icon', { includeHiddenElements: true }))
      .toHaveStyle({ color: colors.ui.control.primaryForeground })
    expect(screen.getByTestId('navigation-accent', { includeHiddenElements: true }))
      .toHaveStyle({ color: colors.ui.icon.accentForeground })
    await screen.rerender(tree(true))
    expect(screen.getByTestId('navigation-icon', { includeHiddenElements: true }))
      .toHaveStyle({ color: colors.ui.control.disabledForeground })
    await screen.unmount()
  },
)
