import { fireEvent, render } from '@testing-library/react-native'
import { useAppTheme } from '@/hooks/useAppTheme'
import { getColors } from '@/theme/colors'
import type { CanonicalThemeId } from '@/types/settingsContracts'
import { IsleThemeProvider } from '@/components/ui/isle/IsleThemeProvider'
import { SettingsThemeAccentControl, type ThemeAccentDraft } from './SettingsThemeAccentControl'

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('@/components/ui/HighFrameSpinner', () => ({ HighFrameSpinner: () => null }))

function setTheme(id: CanonicalThemeId = 'minimal', mode: 'light' | 'dark' = 'light', accent?: string) {
  const colors = getColors(mode, id, undefined, accent)
  jest.mocked(useAppTheme).mockReturnValue({
    colors, design: colors.design!, canonicalThemeId: id, mode, themeMode: mode, themeAccent: accent,
    isDark: mode === 'dark', isMinimal: id === 'minimal', isMonet: id === 'monet',
    isMaterial: id === 'material', isLiquidGlass: id === 'liquid-glass', isAnimalIsland: id === 'animal-island-ui',
  } as ReturnType<typeof useAppTheme>)
}

beforeEach(() => setTheme())

function setup() {
  const draftRef = { current: {} as ThemeAccentDraft }
  const onChange = jest.fn()
  const tree = (value?: string) => <IsleThemeProvider>
    <SettingsThemeAccentControl value={value} draftRef={draftRef} onChange={onChange} />
  </IsleThemeProvider>
  return { draftRef, onChange, tree }
}

it('preserves the labelled group and individually accessible radio choices', async () => {
  const { tree } = setup()
  const screen = await render(tree())
  const group = screen.getByTestId('settings-theme-accent-group')
  expect(group.props.role).toBe('radiogroup')
  expect(group.props.accessibilityLabel).toBe('settings.themeAccent')
  expect(group.props.accessible).toBe(false)
  expect(screen.getAllByRole('radio')).toHaveLength(6)
})

it('previews locally without committing or interrupting partial input, and associates validation with the field', async () => {
  const { tree, onChange } = setup()
  const screen = await render(tree())
  const field = () => screen.getByTestId('settings-theme-accent-input')
  await fireEvent.changeText(field(), '#1')
  expect(field().props['aria-invalid']).toBeFalsy()
  await fireEvent(field(), 'blur', {})
  expect(field().props['aria-invalid']).toBe(true)
  expect(screen.getByTestId('settings-theme-accent-hint')).toHaveTextContent('settings.themeAccentInvalid')
  expect(field().props['aria-describedby']).toBe(screen.getByTestId('settings-theme-accent-hint').props.nativeID)
  await fireEvent(field(), 'focus', {})
  expect(field().props['aria-invalid']).toBeFalsy()
  await fireEvent.changeText(field(), '#aBc')
  expect(screen.getByTestId('settings-theme-accent-preview', { includeHiddenElements: true })).toHaveStyle({ backgroundColor: getColors('light', 'minimal', undefined, '#AABBCC').ui.control.primaryBackground })
  expect(screen.getByTestId('settings-theme-accent-hint')).toHaveTextContent('settings.themeAccentPreviewHint')
  expect(screen.getByRole('radio', { checked: true }).props.testID).toBe('settings-theme-accent-default')
  expect(onChange).not.toHaveBeenCalled()
})

it('normalizes Enter submission, waits for actual application and prevents redundant application', async () => {
  const { tree, onChange } = setup()
  const screen = await render(tree())
  await fireEvent.changeText(screen.getByTestId('settings-theme-accent-input'), ' aBc ')
  await fireEvent(screen.getByTestId('settings-theme-accent-input'), 'submitEditing', {})
  expect(onChange).toHaveBeenCalledWith('#AABBCC')
  expect(screen.getByTestId('settings-theme-accent-input').props.value).toBe('#AABBCC')
  // No optimistic success: a failed or delayed host update must remain retryable.
  expect(screen.getByRole('button', { name: 'settings.themeAccentApply', disabled: false })).toBeTruthy()
  await screen.rerender(tree('#AABBCC'))
  expect(screen.getByRole('button', { name: 'settings.themeAccentApplied', disabled: true })).toBeTruthy()
  await fireEvent(screen.getByTestId('settings-theme-accent-input'), 'submitEditing', {})
  expect(onChange).toHaveBeenCalledTimes(1)
})

it('never applies an invalid or empty draft', async () => {
  const { tree, onChange } = setup()
  const screen = await render(tree())
  for (const value of ['', '#12', '#GGFFFF', '#11223344']) {
    await fireEvent.changeText(screen.getByTestId('settings-theme-accent-input'), value)
    await fireEvent(screen.getByTestId('settings-theme-accent-input'), 'submitEditing', {})
    expect(screen.getByTestId('settings-theme-accent-input').props['aria-invalid']).toBe(true)
    expect(screen.getByRole('button', { name: 'settings.themeAccentApply', disabled: true })).toBeTruthy()
  }
  expect(onChange).not.toHaveBeenCalled()
})

it('restores the displayed custom color, not the draft, after selecting a preset', async () => {
  const { tree, onChange } = setup()
  const screen = await render(tree('#112233'))
  await fireEvent.changeText(screen.getByTestId('settings-theme-accent-input'), '#778899')
  await fireEvent.press(screen.getByTestId('settings-theme-accent-indigo'))
  await screen.rerender(tree('#4F46A5'))
  expect(screen.getByTestId('settings-theme-accent-input').props.value).toBe('#778899')
  expect(screen.getByTestId('settings-theme-accent-custom').props.accessibilityLabel).toContain('#112233')
  await fireEvent.press(screen.getByTestId('settings-theme-accent-custom'))
  expect(onChange.mock.calls.at(-1)?.[0]).toBe('#112233')
  await screen.rerender(tree('#112233'))
  expect(screen.getAllByRole('radio', { checked: true })).toHaveLength(1)
  expect(screen.getByRole('radio', { checked: true }).props.testID).toBe('settings-theme-accent-custom')
  expect(screen.getByTestId('settings-theme-accent-input').props.value).toBe('#778899')
})

it('preserves the page-session draft and custom recall across closing and reopening the foldout', async () => {
  const { tree } = setup()
  const screen = await render(tree('#112233'))
  await fireEvent.changeText(screen.getByTestId('settings-theme-accent-input'), '#77')
  await screen.rerender(tree('#4F46A5'))
  await screen.rerender(<></>)
  await screen.rerender(tree('#4F46A5'))
  expect(screen.getByTestId('settings-theme-accent-input').props.value).toBe('#77')
  expect(screen.getByTestId('settings-theme-accent-custom').props.accessibilityLabel).toContain('#112233')
  expect(screen.getByTestId('settings-theme-accent-input').props['aria-invalid']).toBeFalsy()
})

it('follows external custom changes only while the editor is pristine', async () => {
  const { tree } = setup()
  const screen = await render(tree())
  await screen.rerender(tree('#112233'))
  expect(screen.getByTestId('settings-theme-accent-input').props.value).toBe('#112233')
  await fireEvent.changeText(screen.getByTestId('settings-theme-accent-input'), '')
  await screen.rerender(tree('#445566'))
  expect(screen.getByTestId('settings-theme-accent-input').props.value).toBe('')
})

it('previews the theme default independently of the currently applied custom accent', async () => {
  const { tree } = setup()
  setTheme('minimal', 'light', '#FF0055')
  const screen = await render(tree('#FF0055'))
  expect(screen.getByTestId('settings-theme-accent-default-color', { includeHiddenElements: true })).toHaveStyle({
    backgroundColor: getColors('light', 'minimal').ui.control.primaryBackground,
  })
})

it('keeps typing updates local instead of rerendering the settings page', async () => {
  const { tree } = setup()
  const hostRender = jest.fn()
  function Host() { hostRender(); return tree() }
  const screen = await render(<Host />)
  const before = hostRender.mock.calls.length
  await fireEvent.changeText(screen.getByTestId('settings-theme-accent-input'), '#1')
  await fireEvent.changeText(screen.getByTestId('settings-theme-accent-input'), '#12')
  expect(hostRender).toHaveBeenCalledTimes(before)
})

it.each(['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui'] as const)('preserves the draft and input semantics in the %s family', async (id) => {
  const { tree } = setup()
  const screen = await render(tree())
  await fireEvent.changeText(screen.getByTestId('settings-theme-accent-input'), '#1122')
  for (const mode of ['light', 'dark'] as const) {
    setTheme(id, mode)
    await screen.rerender(tree())
    expect(screen.getByTestId('settings-theme-accent-input').props.value).toBe('#1122')
    await fireEvent(screen.getByTestId('settings-theme-accent-input'), 'submitEditing', {})
    expect(screen.getByTestId('settings-theme-accent-input').props['aria-invalid']).toBe(true)
    expect(screen.getByTestId('settings-theme-accent-input').props.submitBehavior).toBe('submit')
    expect(screen.getByTestId('settings-theme-accent-input').props.blurOnSubmit).toBe(false)
    expect(screen.getAllByRole('radio', { checked: true })).toHaveLength(1)
  }
})
