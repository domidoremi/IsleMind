import { fireEvent, render } from '@testing-library/react-native'
import { StyleSheet, Text } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'
import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS } from '@/types/settingsContracts'
import { IsleButton } from './Controls'
import { IsleThemeProvider } from './IsleThemeProvider'

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View }))
jest.mock('@/components/ui/AppIcon', () => ({
  AppIcon: ({ name, color }: { name: string; color: string }) =>
    require('react').createElement(require('react-native').Text, { testID: `glyph-${name}`, style: { color } }, name),
}))
jest.mock('@/components/ui/HighFrameSpinner', () => ({
  HighFrameSpinner: ({ color }: { color: string }) =>
    require('react').createElement(require('react-native').Text, { testID: 'progress-glyph', style: { color } }, 'Pending'),
}))

it.each(CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).map(mode => ({ family, mode }))))(
  'keeps $family $mode action icons on the label foreground through disabled and feedback states',
  async ({ family, mode }) => {
    const colors = getColors(mode, family)
    jest.mocked(useAppTheme).mockReturnValue({ colors, design: colors.design!, canonicalThemeId: family,
      mode, isDark: mode === 'dark' } as ReturnType<typeof useAppTheme>)
    const press = jest.fn()
    const tree = (tone: 'primary' | 'danger' | 'soft', phase: 'idle' | 'pending' | 'success', disabled = false) =>
      <IsleThemeProvider><IsleButton label="Save" testID="action" tone={tone} feedbackPhase={phase}
        disabled={disabled} onPress={press}
        icon={foreground => <Text testID="action-icon" style={{ color: foreground }}>Save icon</Text>} />
      </IsleThemeProvider>
    const screen = await render(tree('primary', 'idle'))
    const assertForeground = (id: string) => expect(screen.getByTestId(id, { includeHiddenElements: true }))
      .toHaveStyle({ color: StyleSheet.flatten(screen.getByText('Save').props.style).color })
    for (const tone of ['primary', 'danger', 'soft'] as const) {
      await screen.rerender(tree(tone, 'idle'))
      assertForeground('action-icon')
      await fireEvent.press(screen.getByRole('button', { name: 'Save' }))
      const activations = press.mock.calls.length
      await screen.rerender(tree(tone, 'idle', true))
      assertForeground('action-icon')
      await fireEvent.press(screen.getByRole('button', { name: 'Save' }))
      expect(press).toHaveBeenCalledTimes(activations)
      await screen.rerender(tree(tone, 'pending'))
      assertForeground('progress-glyph')
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Save' }).props.accessibilityState.busy).toBe(true)
      await screen.rerender(tree(tone, 'success'))
      assertForeground('glyph-check')
      expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled()
    }
    const customIcon = <Text testID="custom-icon" style={{ color: '#aa1122' }}>Brand</Text>
    await screen.rerender(<IsleThemeProvider><IsleButton label="Custom" icon={customIcon} /></IsleThemeProvider>)
    expect(screen.getByTestId('custom-icon', { includeHiddenElements: true })).toHaveStyle({ color: '#aa1122' })
    await screen.unmount()
  },
)
