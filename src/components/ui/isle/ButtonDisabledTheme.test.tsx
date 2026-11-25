import { fireEvent, render } from '@testing-library/react-native'
import { Text } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'
import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS } from '@/types/settingsContracts'
import { IsleButton } from './Controls'
import { IsleThemeProvider } from './IsleThemeProvider'

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('@/components/ui/HighFrameSpinner', () => ({ HighFrameSpinner: () => null }))

it.each(CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).map(mode => ({ family, mode }))))(
  'uses $family $mode disabled tokens without dimming twice and restores enabled actions',
  async ({ family, mode }) => {
    const colors = getColors(mode, family)
    jest.mocked(useAppTheme).mockReturnValue({ colors, design: colors.design!, canonicalThemeId: family,
      mode, isDark: mode === 'dark' } as ReturnType<typeof useAppTheme>)
    const press = jest.fn()
    const tree = (tone: 'primary' | 'danger' | 'soft', disabled: boolean) => <IsleThemeProvider>
      <IsleButton label="Save" testID="action" tone={tone} disabled={disabled} onPress={press}
        textStyle={{ color: colors.ui.control.primaryForeground, fontSize: 20 }}
        icon={foreground => <Text testID="action-icon" style={{ color: foreground }}>Save icon</Text>} />
    </IsleThemeProvider>
    const screen = await render(tree('primary', false))
    for (const tone of ['primary', 'danger', 'soft'] as const) {
      await screen.rerender(tree(tone, false))
      const label = screen.getByText('Save')
      await fireEvent.press(screen.getByRole('button', { name: 'Save' }))
      const activations = press.mock.calls.length
      await screen.rerender(tree(tone, true))
      const action = screen.getByRole('button', { name: 'Save' })
      expect(action).toBeDisabled()
      expect(action).toHaveStyle({ backgroundColor: colors.ui.control.disabledBackground,
        borderColor: colors.ui.control.disabledBorder, opacity: colors.ui.control.disabledOpacity })
      expect(screen.getByText('Save')).toBe(label)
      expect(label).toHaveStyle({ color: colors.ui.control.disabledForeground, fontSize: 20 })
      expect(screen.getByTestId('action-icon', { includeHiddenElements: true }))
        .toHaveStyle({ color: colors.ui.control.disabledForeground })
      await fireEvent.press(action)
      expect(press).toHaveBeenCalledTimes(activations)
      await screen.rerender(tree(tone, false))
      expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled()
      expect(label).toHaveStyle({ color: colors.ui.control.primaryForeground })
      await fireEvent.press(screen.getByRole('button', { name: 'Save' }))
      expect(press).toHaveBeenCalledTimes(activations + 1)
    }
    await screen.unmount()
  },
)
