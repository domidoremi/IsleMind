import { fireEvent, render } from '@testing-library/react-native'
import { Text } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'
import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import { IsleInput, IsleSwitch } from './IsleKit'
import { IsleToggle } from './Primitives'
import { IsleThemeProvider } from './IsleThemeProvider'

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('@/components/ui/HighFrameSpinner', () => ({ HighFrameSpinner: () => null }))

const appearances = CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).map(mode => ({ family, mode })))
function setTheme(family: CanonicalThemeId, mode: 'light' | 'dark') {
  const colors = getColors(mode, family)
  jest.mocked(useAppTheme).mockReturnValue({ colors, design: colors.design!, canonicalThemeId: family,
    mode, isDark: mode === 'dark' } as ReturnType<typeof useAppTheme>)
  return colors
}

it.each(appearances)('preserves the $family $mode toggle value while applying its disabled row tokens once', async ({ family, mode }) => {
  const colors = setTheme(family, mode), press = jest.fn()
  const tree = (active: boolean, disabled: boolean, brand = false) => <IsleThemeProvider>
    <IsleToggle title="Background work" description="Continue this task" active={active} disabled={disabled} onPress={press}
      icon={brand ? <Text testID="brand" style={{ color: '#992255' }}>Brand</Text>
        : foreground => <Text testID="toggle-state-icon" style={{ color: foreground }}>Task</Text>} />
  </IsleThemeProvider>
  const screen = await render(tree(true, false))
  const control = () => screen.getByRole('switch', { name: 'Background work. Continue this task' })
  const title = screen.getByText('Background work')
  for (const active of [true, false]) {
    await screen.rerender(tree(active, true))
    expect(control()).toBeDisabled()
    expect(control().props.accessibilityState.checked).toBe(active)
    expect(control()).toHaveStyle({ opacity: colors.ui.control.disabledOpacity })
    expect(title).toHaveStyle({ color: colors.ui.control.disabledForeground })
    expect(screen.getByText('Continue this task')).toHaveStyle({ color: colors.ui.control.disabledForeground })
    expect(screen.getByTestId('toggle-state-icon')).toHaveStyle({ color: colors.ui.control.disabledForeground })
    const surfaces = control().queryAll(node => node.props.animate?.translateY === 0 && node.props.animate?.borderColor !== undefined)
    expect(surfaces).toHaveLength(1)
    const surface = surfaces[0]!
    expect(surface.props.animate).toMatchObject({ backgroundColor: colors.ui.control.disabledBackground, borderColor: colors.ui.control.disabledBorder })
    const icons = control().queryAll(node => node.props.animate?.rotate === '0deg')
    expect(icons).toHaveLength(1)
    const icon = icons[0]!
    expect(icon.props.animate.backgroundColor).toBe(colors.ui.control.disabledBackground)
    await fireEvent.press(control())
    expect(press).not.toHaveBeenCalled()
  }
  await screen.rerender(tree(true, false))
  expect(screen.getByText('Background work')).toBe(title)
  expect(title).toHaveStyle({ color: colors.text })
  expect(screen.getByTestId('toggle-state-icon')).toHaveStyle({ color: colors.ui.control.primaryForeground })
  await fireEvent.press(control())
  expect(press).toHaveBeenCalledTimes(1)
  await screen.rerender(tree(false, true, true))
  expect(screen.getByTestId('brand')).toHaveStyle({ color: '#992255' })
  await screen.unmount()
})

it.each(appearances.filter(({ family }) => family !== 'animal-island-ui'))(
  'keeps the $family $mode standalone switch on its disabled tokens without an extra opacity layer', async ({ family, mode }) => {
    const colors = setTheme(family, mode), change = jest.fn()
    const tree = (disabled: boolean) => <IsleThemeProvider><IsleSwitch checked disabled={disabled} onChange={change} /></IsleThemeProvider>
    const screen = await render(tree(true))
    const control = () => screen.getByRole('switch')
    expect(control()).toHaveStyle({ opacity: colors.ui.control.disabledOpacity })
    expect(control().props.accessibilityState).toMatchObject({ checked: true, disabled: true })
    await fireEvent.press(control())
    expect(change).not.toHaveBeenCalled()
    await screen.rerender(tree(false))
    expect(control()).not.toBeDisabled()
    await fireEvent.press(control())
    expect(change).toHaveBeenCalledWith(false)
    await screen.unmount()
  },
)

it.each(appearances)('keeps $family $mode disabled field text readable without losing its draft or selection', async ({ family, mode }) => {
  const colors = setTheme(family, mode), change = jest.fn(), focus = jest.fn(), blur = jest.fn()
  const tree = (editable: boolean) => <IsleThemeProvider>
    <IsleInput testID="disabled-draft" value="Draft 草稿" editable={editable} selection={{ start: 3, end: 3 }}
      onChangeText={change} onFocus={focus} onBlur={blur} allowClear
      inputStyle={{ color: colors.primary, fontSize: 23 }} style={{ color: colors.ui.tone.danger.foreground }} />
  </IsleThemeProvider>
  const screen = await render(tree(true)), field = screen.getByTestId('disabled-draft')
  expect(field).toHaveStyle({ color: colors.ui.tone.danger.foreground, fontSize: 23 })
  await fireEvent(field, 'focus', { nativeEvent: {} })
  await screen.rerender(tree(false))
  expect(screen.getByTestId('disabled-draft')).toBe(field)
  expect(field).toHaveStyle({ color: colors.ui.input.disabledForeground, fontSize: 23 })
  expect(field.props.value).toBe('Draft 草稿')
  expect(field.props.selection).toEqual({ start: 3, end: 3 })
  expect(field.props.editable).toBe(false)
  expect(screen.queryByRole('button', { name: 'common.clear' })).toBeNull()
  expect(change).not.toHaveBeenCalled()
  expect(focus).toHaveBeenCalledTimes(1)
  await screen.rerender(tree(true))
  expect(screen.getByTestId('disabled-draft')).toBe(field)
  expect(field).toHaveStyle({ color: colors.ui.tone.danger.foreground, fontSize: 23 })
  await fireEvent.changeText(field, 'Changed 草稿')
  expect(change).toHaveBeenCalledWith('Changed 草稿')
  await screen.unmount()
})

it.each(appearances.filter(({ family }) => ['minimal', 'monet', 'material'].includes(family)))(
  'retires the $family $mode field focus decoration when the field becomes disabled', async ({ family, mode }) => {
    setTheme(family, mode)
    const tree = (editable: boolean) => <IsleThemeProvider><IsleInput testID="focus-draft" value="Keep me" editable={editable} /></IsleThemeProvider>
    const screen = await render(tree(true)), field = screen.getByTestId('focus-draft')
    await fireEvent(field, 'focus', { nativeEvent: {} })
    const decoration = () => screen.getByTestId(`theme-input-focus-${family}`, { includeHiddenElements: true })
    expect(decoration().props.animate.opacity).toBe(family === 'monet' ? 0.18 : 1)
    await screen.rerender(tree(false))
    expect(decoration().props.animate.opacity).toBe(family === 'monet' ? 0.06 : 0)
    expect(screen.getByTestId('focus-draft')).toBe(field)
    expect(field.props.value).toBe('Keep me')
    await screen.unmount()
  },
)
