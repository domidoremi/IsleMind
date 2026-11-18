import { useEffect, useState } from 'react'
import { act, fireEvent, render } from '@testing-library/react-native'
import { Platform, TextInput, View } from 'react-native'
import { IsleDialogProvider, useIsleDialog } from '../isle/Dialog'
import { IsleThemeProvider } from '../isle/IsleThemeProvider'
import type { CanonicalThemeId } from '@/types/settingsContracts'

let mockTheme: CanonicalThemeId = 'minimal'
jest.mock('@/hooks/useAppTheme', () => ({
  useAppTheme: () => {
    const colors = require('@/theme/colors').getColors('light', mockTheme)
    return { colors, design: colors.design, canonicalThemeId: mockTheme, isLiquidGlass: mockTheme === 'liquid-glass' }
  },
}))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('@/hooks/useTransparencyPreference', () => ({ useTransparencyPreference: () => false }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('react-native/Libraries/ReactNative/RendererProxy', () => ({
  ...jest.requireActual('react-native/Libraries/ReactNative/RendererProxy'),
  dispatchCommand: jest.fn(),
}))
jest.mock('react-native/Libraries/Components/TextInput/TextInputState', () =>
  jest.requireActual('react-native/Libraries/Components/TextInput/TextInputState'))
jest.mock('react-native/Libraries/Utilities/dismissKeyboard', () =>
  jest.requireActual('react-native/Libraries/Utilities/dismissKeyboard'))
jest.mock('react-native/Libraries/Components/Keyboard/Keyboard', () =>
  jest.requireActual('react-native/Libraries/Components/Keyboard/Keyboard'))

type Field = ReturnType<typeof TextInput.State.currentlyFocusedInput>
const state = jest.requireActual('react-native/Libraries/Components/TextInput/TextInputState').default as typeof TextInput.State & {
  focusInput: (field: Field) => void
  blurInput: (field: Field) => void
  registerInput: (field: Field) => void
  unregisterInput: (field: Field) => void
  isTextInput: (field: Field) => boolean
}
const themes: CanonicalThemeId[] = ['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui']
function field() {
  return { _nativeTag: 811, currentProps: { editable: true } } as unknown as Field
}

async function fixture(control: Field) {
  let api!: ReturnType<typeof useIsleDialog>
  let leave!: () => void
  function InputOwner() {
    useEffect(() => {
      state.registerInput(control)
      return () => state.unregisterInput(control)
    }, [])
    return <View testID="editing-input-owner" />
  }
  function Screen() {
    api = useIsleDialog()
    const [editing, setEditing] = useState(true)
    leave = () => setEditing(false)
    return editing ? <InputOwner /> : null
  }
  const screen = await render(<IsleThemeProvider><IsleDialogProvider><Screen /></IsleDialogProvider></IsleThemeProvider>)
  state.focusInput(control)
  expect(state.currentlyFocusedInput()).toBe(control)
  return { screen, api, leave }
}
beforeEach(() => {
  mockTheme = 'minimal'
  jest.replaceProperty(Platform, 'OS', 'android')
})
afterEach(() => {
  const focused = state.currentlyFocusedInput()
  if (focused) { state.blurInput(focused); state.unregisterInput(focused) }
  jest.restoreAllMocks()
})

it.each(themes.flatMap(theme => (['android', 'ios'] as const).map(platform => [theme, platform] as const)))(
  '%s on %s releases the input before a confirmed operation removes its editor',
  async (theme, platform) => {
    mockTheme = theme
    jest.replaceProperty(Platform, 'OS', platform)
    const control = field(), { screen, api, leave } = await fixture(control)
    let focusAtConfirm: Field | null | undefined
    let outcome: Promise<boolean> | undefined
    try {
      await act(() => {
        outcome = api.confirm({
          title: 'Discard draft?', confirmLabel: 'Discard', cancelLabel: 'Keep editing',
          onConfirm: () => { focusAtConfirm = state.currentlyFocusedInput(); leave() },
        })
      })
      await fireEvent.press(screen.getByText('Discard'))
      expect(await outcome).toBe(true)
      expect(screen.queryByTestId('editing-input-owner')).toBeNull()
      expect(state.isTextInput(control)).toBe(false)
      expect(focusAtConfirm).toBeNull()
      expect(state.currentlyFocusedInput()).toBeNull()
    } finally { await screen.unmount() }
  },
)

it.each(themes)('%s keeps the focused registered input when the user cancels', async theme => {
  mockTheme = theme
  const control = field(), { screen, api, leave } = await fixture(control)
  let outcome: Promise<boolean> | undefined
  try {
    await act(() => {
      outcome = api.confirm({ title: 'Discard draft?', confirmLabel: 'Discard', cancelLabel: 'Keep editing', onConfirm: leave })
    })
    await fireEvent.press(screen.getByText('Keep editing'))
    expect(await outcome).toBe(false)
    expect(screen.getByTestId('editing-input-owner')).toBeTruthy()
    expect(state.isTextInput(control)).toBe(true)
    expect(state.currentlyFocusedInput()).toBe(control)
  } finally { await screen.unmount() }
})

it('preserves native input focus when a confirmation is aborted', async () => {
  const control = field(), { screen, api, leave } = await fixture(control)
  const controller = new AbortController()
  let outcome: Promise<boolean> | undefined
  try {
    await act(() => {
      outcome = api.confirm({ title: 'Discard draft?', signal: controller.signal, onConfirm: leave })
    })
    await act(() => controller.abort())
    expect(await outcome).toBe(false)
    expect(screen.getByTestId('editing-input-owner')).toBeTruthy()
    expect(state.currentlyFocusedInput()).toBe(control)
  } finally { await screen.unmount() }
})

it('keeps the input focus when an informational notice is dismissed', async () => {
  const control = field(), { screen, api } = await fixture(control)
  try {
    await act(() => api.notice({ title: 'Saved details', actionLabel: 'Close notice' }))
    await fireEvent.press(screen.getByText('Close notice'))
    expect(screen.queryByText('Saved details')).toBeNull()
    expect(state.currentlyFocusedInput()).toBe(control)
  } finally { await screen.unmount() }
})

it('leaves Web input focus to the browser when an operation is confirmed', async () => {
  jest.replaceProperty(Platform, 'OS', 'web')
  const control = field(), { screen, api } = await fixture(control)
  let outcome: Promise<boolean> | undefined
  try {
    await act(() => {
      outcome = api.confirm({ title: 'Apply edit?', confirmLabel: 'Apply', onConfirm: () => undefined })
    })
    await fireEvent.press(screen.getByText('Apply'))
    expect(await outcome).toBe(true)
    expect(state.currentlyFocusedInput()).toBe(control)
  } finally { await screen.unmount() }
})

it('settles a native confirmation when no text input is focused', async () => {
  let api!: ReturnType<typeof useIsleDialog>, outcome: Promise<boolean> | undefined
  function Capture() { api = useIsleDialog(); return null }
  const screen = await render(<IsleThemeProvider><IsleDialogProvider><Capture /></IsleDialogProvider></IsleThemeProvider>)
  try {
    expect(state.currentlyFocusedInput()).toBeNull()
    await act(() => { outcome = api.confirm({ title: 'Apply edit?', confirmLabel: 'Apply' }) })
    await fireEvent.press(screen.getByText('Apply'))
    expect(await outcome).toBe(true)
    expect(state.currentlyFocusedInput()).toBeNull()
  } finally { await screen.unmount() }
})
