import { fireEvent, render } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'
import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS } from '@/types/settingsContracts'
import { IsleSelect } from './IsleKit'
import { IsleThemeProvider } from './IsleThemeProvider'

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/HighFrameSpinner', () => ({ HighFrameSpinner: () => null }))
jest.mock('@/components/ui/AppIcon', () => ({
  AppIcon: ({ name, color }: { name: string; color: string }) => require('react').createElement(require('react-native').Text,
    { testID: `select-icon-${name}`, style: { color } }, name),
}))

it.each(CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).map(mode => ({ family, mode }))))(
  'keeps the $family $mode selection arrow on its disabled foreground and restores its value and actions',
  async ({ family, mode }) => {
    const colors = getColors(mode, family)
    jest.mocked(useAppTheme).mockReturnValue({ colors, design: colors.design!, canonicalThemeId: family,
      mode, isDark: mode === 'dark' } as ReturnType<typeof useAppTheme>)
    const change = jest.fn()
    const tree = (disabled = false) => <IsleThemeProvider>
      <IsleSelect testID="choice" accessibilityLabel="Theme choice" placeholder="Choose" value="first"
        options={[{ value: 'first', label: 'First' }, { value: 'second', label: 'Second' }]}
        disabled={disabled} onChange={change} />
    </IsleThemeProvider>
    const screen = await render(tree())
    const control = () => screen.getByRole(family === 'animal-island-ui' ? 'combobox' : 'button', { name: /^Theme choice/ })
    const enabledColor = screen.getByTestId('select-icon-collapse').props.style.color
    if (family !== 'animal-island-ui') {
      expect(screen.getByTestId('select-icon-collapse')).toHaveStyle({ color: StyleSheet.flatten(screen.getByText('First').props.style).color })
    }
    await fireEvent.press(control())
    expect(screen.getAllByText('Second')).toHaveLength(1)
    await screen.rerender(tree(true))
    expect(control()).toBeDisabled()
    expect(screen.getByTestId('select-icon-collapse')).toHaveStyle({ color: colors.ui.control.disabledForeground })
    expect(screen.queryByText('Second')).toBeNull()
    await fireEvent.press(control())
    expect(screen.queryByText('Second')).toBeNull()
    expect(change).not.toHaveBeenCalled()
    expect(screen.getByText('First')).toBeTruthy()
    await screen.rerender(tree())
    expect(control()).not.toBeDisabled()
    expect(screen.getByTestId('select-icon-collapse')).toHaveStyle({ color: enabledColor })
    await fireEvent.press(control())
    await fireEvent.press(screen.getByText('Second'))
    expect(change).toHaveBeenCalledTimes(1)
    expect(change).toHaveBeenCalledWith('second')
    expect(screen.queryByText('Second')).toBeNull()
    expect(screen.getByText('First')).toBeTruthy()
    await screen.unmount()
  },
)
