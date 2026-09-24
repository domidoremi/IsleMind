import { fireEvent, render } from '@testing-library/react-native'
import { Text } from 'react-native'
import { Collapse, Image, Modal, Tag, useTheme } from 'animal-island-ui-rn'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { getColors } from '@/theme/colors'
import { THEME_MOTION_DURATIONS } from '@/theme/themeTokens'
import type { CanonicalThemeId } from '@/types/settingsContracts'
import { IsleButton, IsleCollapse, IsleInput, IsleModal, IsleSelect, IsleSwitch } from './IsleKit'
import { IsleImage } from './Image'
import { IsleTag } from './Tag'
import { IsleThemeProvider } from './IsleThemeProvider'
import { IsleSearchField } from './SearchField'

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: jest.fn(() => 'none') }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: { fine: 1.5, regular: 1.75, strong: 2 } }))
jest.mock('@/components/ui/HighFrameSpinner', () => ({ HighFrameSpinner: () => null }))

function setTheme(id: CanonicalThemeId = 'animal-island-ui', mode: 'light' | 'dark' = 'light', accent?: string) {
  const colors = getColors(mode, id, undefined, accent)
  jest.mocked(useAppTheme).mockReturnValue({
    colors, design: colors.design!, canonicalThemeId: id, mode, themeMode: mode, themeAccent: accent,
    isDark: mode === 'dark', isMinimal: id === 'minimal', isMonet: id === 'monet',
    isMaterial: id === 'material', isLiquidGlass: id === 'liquid-glass', isAnimalIsland: id === 'animal-island-ui',
  } as ReturnType<typeof useAppTheme>)
}

beforeEach(() => {
  setTheme()
  jest.mocked(useMotionPreference).mockReturnValue('none')
})

it('re-exports the actual fork implementations rather than duplicate ports', () => {
  expect(IsleCollapse).toBe(Collapse)
  expect(IsleModal).toBe(Modal)
  expect(IsleImage).toBe(Image)
  expect(IsleTag).toBe(Tag)
})

it('bridges resolved mode, accent and motion into the fork provider', async () => {
  function Probe() {
    const { mode, reducedMotion, theme } = useTheme()
    return <Text>{`${mode}:${reducedMotion}:${theme.colors.primary}`}</Text>
  }
  setTheme('animal-island-ui', 'dark', '#4455B7')
  const screen = await render(<IsleThemeProvider><Probe /></IsleThemeProvider>)
  expect(screen.getByText('dark:true:#4455B7')).toBeTruthy()
  jest.mocked(useMotionPreference).mockReturnValueOnce('full')
  setTheme('animal-island-ui', 'light')
  await screen.rerender(<IsleThemeProvider><Probe /></IsleThemeProvider>)
  expect(screen.getByText(/^light:false:/)).toBeTruthy()
})

it.each(['light', 'dark'] as const)('renders the fork button and preserves busy/disabled semantics in %s', async (mode) => {
  setTheme('animal-island-ui', mode)
  const onPress = jest.fn()
  const screen = await render(<IsleThemeProvider><IsleButton label="Save" loading accessibilityState={{ expanded: true }} onPress={onPress} testID="save" /></IsleThemeProvider>)
  expect(screen.getByTestId('save')).toHaveStyle({ minHeight: 44, borderRadius: 50 })
  expect(screen.getByRole('button', { name: 'Save', disabled: true, busy: true, expanded: true })).toBeTruthy()
  await fireEvent.press(screen.getByTestId('save'))
  expect(onPress).not.toHaveBeenCalled()
})

it('keeps uncontrolled input and switch values when changing themes in a mounted tree', async () => {
  const onChangeText = jest.fn()
  const tree = () => <IsleThemeProvider>
    <IsleInput defaultValue="first" allowClear testID="field" onChangeText={onChangeText} />
    <IsleSwitch defaultChecked />
  </IsleThemeProvider>
  const screen = await render(tree())
  await fireEvent.changeText(screen.getByTestId('field'), 'draft')
  await fireEvent.press(screen.getByRole('switch'))
  for (const id of ['minimal', 'material', 'liquid-glass', 'animal-island-ui'] as const) {
    setTheme(id)
    await screen.rerender(tree())
    expect(screen.getByTestId('field').props.value).toBe('draft')
    expect(screen.getByRole('switch', { checked: false })).toBeTruthy()
  }
  await fireEvent.press(screen.getByRole('button', { name: 'common.clear' }))
  expect(screen.getByTestId('field').props.value).toBe('')
  expect(onChangeText).toHaveBeenLastCalledWith('')
})

it('preserves native input events, selection, multiline growth and read-only state', async () => {
  const onChange = jest.fn()
  const onContentSizeChange = jest.fn()
  const screen = await render(<IsleThemeProvider>
    <IsleInput testID="native-input" multiline selection={{ start: 1, end: 1 }} onChange={onChange} onContentSizeChange={onContentSizeChange} />
  </IsleThemeProvider>)
  const field = screen.getByTestId('native-input')
  const event = { nativeEvent: { text: 'native', target: 7, eventCount: 1 } }
  await fireEvent(field, 'change', event)
  await fireEvent(field, 'contentSizeChange', { nativeEvent: { contentSize: { width: 160, height: 100 } } })
  expect(onChange).toHaveBeenCalledWith(event)
  expect(onContentSizeChange).toHaveBeenCalledTimes(1)
  expect(field.props.selection).toEqual({ start: 1, end: 1 })
  expect(field.props.multiline).toBe(true)
  expect(field.parent).toHaveStyle({ height: 118 })
  await screen.rerender(<IsleThemeProvider><IsleInput testID="native-input" value="locked" allowClear editable={false} /></IsleThemeProvider>)
  expect(screen.getByTestId('native-input').props.editable).toBe(false)
  expect(screen.queryByRole('button', { name: 'common.clear' })).toBeNull()
})

it('maps app option values to the fork and cannot select disabled choices', async () => {
  const onChange = jest.fn()
  const screen = await render(<IsleThemeProvider><IsleSelect placeholder="Choose" options={[
    { label: 'Unavailable', value: 'off', disabled: true }, { label: 'Available', value: 'on' },
  ]} onChange={onChange} /></IsleThemeProvider>)
  await fireEvent.press(screen.getByText('Choose'))
  await fireEvent.press(screen.getByText('Unavailable'))
  expect(onChange).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByText('Available'))
  expect(onChange).toHaveBeenCalledWith('on')
})

it.each(['minimal', 'monet', 'material', 'liquid-glass'] as const)('%s focus decorates without remounting the input or dropping its draft', async (theme) => {
  setTheme(theme)
  jest.mocked(useMotionPreference).mockReturnValue('full')
  const screen = await render(<IsleInput testID="draft" defaultValue="first" />)
  const input = screen.getByTestId('draft')
  await fireEvent.changeText(input, 'keep this draft')
  await fireEvent(input, 'focus', { nativeEvent: {} })
  expect(screen.getByTestId('draft')).toBe(input)
  expect(input.props.value).toBe('keep this draft')
  const decoration = screen.getByTestId(`theme-input-focus-${theme}`, { includeHiddenElements: true })
  expect(decoration.props.pointerEvents).toBe('none')
  expect(decoration.props.transition.duration).toBeGreaterThan(1)
  jest.mocked(useMotionPreference).mockReturnValue('reduced')
  await screen.rerender(<IsleInput testID="draft" defaultValue="first" />)
  const reduced = screen.getByTestId(`theme-input-focus-${theme}`, { includeHiddenElements: true }).props
  expect(reduced.animate.scale ?? 1).toBe(1)
  expect(reduced.animate.scaleX ?? 1).toBe(1)
  expect(reduced.transition.duration).toBe(120)
  expect(screen.getByTestId('draft')).toBe(input)
  expect(input.props.value).toBe('keep this draft')
})

it.each(['minimal', 'monet', 'material', 'liquid-glass'] as const)('%s dropdown settles at full size, selects immediately and removes closed actions', async (theme) => {
  setTheme(theme)
  jest.mocked(useMotionPreference).mockReturnValue('full')
  const onChange = jest.fn()
  const options = [{ label: 'Unavailable', value: 'off', disabled: true }, { label: 'Available', value: 'on' }]
  const tree = (disabled = false) => <IsleSelect placeholder="Choose" options={options} onChange={onChange} disabled={disabled} />
  const screen = await render(tree())
  await fireEvent.press(screen.getByText('Choose'))
  const menu = screen.getByTestId(`theme-dropdown-${theme}`)
  expect(menu.props.from.opacity).toBeGreaterThanOrEqual(0.65)
  expect(menu.props.animate).toEqual({ opacity: 1, translateX: 0, translateY: 0, scale: 1 })
  await fireEvent.press(screen.getByText('Unavailable'))
  expect(onChange).not.toHaveBeenCalled()
  await fireEvent.press(screen.getByText('Available'))
  expect(onChange).toHaveBeenCalledWith('on')
  expect(screen.queryByText('Available')).toBeNull()
  await fireEvent.press(screen.getByText('Choose'))
  await screen.rerender(tree(true))
  expect(screen.queryByText('Available')).toBeNull()
  await screen.rerender(tree())
  expect(screen.queryByText('Available')).toBeNull()
})

it('animates search focus colors without moving or replacing the editable field', async () => {
  setTheme('monet')
  jest.mocked(useMotionPreference).mockReturnValue('full')
  const screen = await render(<IsleSearchField value="draft" clearAccessibilityLabel="Clear" />)
  const input = screen.getByDisplayValue('draft')
  await fireEvent(input, 'focus', { nativeEvent: {} })
  expect(screen.getByDisplayValue('draft')).toBe(input)
  const frame = screen.getByTestId('theme-search-monet')
  expect(frame.props.transition.duration).toBe(THEME_MOTION_DURATIONS.monet.emphasis)
  expect(frame.props.animate.scale).toBeUndefined()
  expect(frame.props.animate.translateY).toBeUndefined()
})
