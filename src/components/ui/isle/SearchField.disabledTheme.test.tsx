import { fireEvent, render } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'
import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS } from '@/types/settingsContracts'
import { IsleThemeProvider } from './IsleThemeProvider'
import { IsleSearchField } from './SearchField'

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({
  AppIcon: ({ name, color }: { name: string; color: string }) => require('react').createElement(require('react-native').Text,
    { testID: `${name}-icon`, style: { color } }, name),
  appIconStroke: {},
}))
jest.mock('@/components/ui/HighFrameSpinner', () => ({ HighFrameSpinner: () => null }))

it.each(CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).map(mode => ({ family, mode }))))(
  'retires $family $mode search focus visuals and uses disabled tokens without losing the query', async ({ family, mode }) => {
    const colors = getColors(mode, family), change = jest.fn(), clear = jest.fn(), focus = jest.fn(), blur = jest.fn()
    jest.mocked(useAppTheme).mockReturnValue({ colors, design: colors.design!, canonicalThemeId: family,
      mode, isDark: mode === 'dark' } as ReturnType<typeof useAppTheme>)
    const tree = (editable: boolean) => <IsleThemeProvider>
      <IsleSearchField testID="search-shell" accessibilityLabel="Search manual" value="保留 Draft 下書き"
        selection={{ start: 2, end: 7 }} editable={editable}
        inputStyle={{ color: colors.ui.tone.danger.foreground, fontSize: 23 }} clearAccessibilityLabel="Clear search"
        onChangeText={change} onClear={clear} onFocus={focus} onBlur={blur} />
    </IsleThemeProvider>
    const screen = await render(tree(true)), field = screen.getByLabelText('Search manual')
    const shell = () => screen.getByTestId('search-shell')
    const decorations = () => shell().queryAll(node => node.props.pointerEvents === 'none'
      && node.props.importantForAccessibility === 'no-hide-descendants').map(node => StyleSheet.flatten(node.props.style))
    const resting = StyleSheet.flatten(shell().props.style), restingDecorations = decorations()
    expect(field).toHaveStyle({ color: colors.ui.tone.danger.foreground, fontSize: 23 })
    await fireEvent(field, 'focus', { nativeEvent: {} })
    if (family !== 'animal-island-ui') {
      expect(screen.getByTestId('search-icon', { includeHiddenElements: true })).toHaveStyle({ color: colors.ui.icon.accentForeground })
      if (family === 'minimal' || family === 'material') expect(decorations()).toHaveLength(1)
      if (family === 'monet') expect(decorations()[0]).toMatchObject({ opacity: 0.34 })
    }
    await screen.rerender(tree(false))
    expect(screen.getByLabelText('Search manual')).toBe(field)
    expect(field).toHaveStyle({ color: colors.ui.input.disabledForeground, fontSize: 23 })
    expect(field.props).toMatchObject({ value: '保留 Draft 下書き', selection: { start: 2, end: 7 }, editable: false })
    expect(screen.getByTestId('search-icon', { includeHiddenElements: true })).toHaveStyle({ color: colors.ui.input.disabledForeground })
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
    expect(change).not.toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
    expect(focus).toHaveBeenCalledTimes(1)
    expect(blur).not.toHaveBeenCalled()
    if (family !== 'animal-island-ui') {
      expect(shell().props.animate).toMatchObject({ backgroundColor: colors.ui.input.disabledBackground, borderColor: colors.ui.input.border })
      const disabled = StyleSheet.flatten(shell().props.style)
      for (const property of ['shadowOpacity', 'shadowRadius', 'elevation', 'borderBottomWidth'] as const) expect(disabled[property]).toBe(resting[property])
      expect(decorations()).toEqual(restingDecorations)
    }
    await screen.rerender(tree(true))
    expect(screen.getByLabelText('Search manual')).toBe(field)
    expect(field).toHaveStyle({ color: colors.ui.tone.danger.foreground, fontSize: 23 })
    await fireEvent.press(screen.getByRole('button', { name: 'Clear search' }))
    expect(change).toHaveBeenCalledTimes(1)
    expect(change).toHaveBeenCalledWith('')
    expect(clear).toHaveBeenCalledTimes(1)
    await screen.unmount()
  },
)
