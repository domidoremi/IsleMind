import { render } from '@testing-library/react-native'
import { Platform, TextInput, View } from 'react-native'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import { IsleInput } from './IsleKit'
import { IsleThemeProvider } from './IsleThemeProvider'

type Field = ReturnType<typeof TextInput.State.currentlyFocusedInput>
type InputControl = NonNullable<Field> & {
  mounted: boolean
  value: string
  isFocused: () => boolean
  blur: jest.Mock
}
let mockTheme: CanonicalThemeId = 'animal-island-ui'
let mockEvents: string[] = []
const mockControls = new Map<string, InputControl>()

jest.mock('@/hooks/useAppTheme', () => ({
  useAppTheme: () => {
    const colors = require('@/theme/colors').getColors('light', mockTheme)
    return { colors, design: colors.design, canonicalThemeId: mockTheme, isLiquidGlass: mockTheme === 'liquid-glass' }
  },
}))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('react-native/Libraries/Components/TextInput/TextInputState', () =>
  jest.requireActual('react-native/Libraries/Components/TextInput/TextInputState'))
jest.mock('animal-island-ui-rn', () => {
  const actual = jest.requireActual('animal-island-ui-rn')
  return { ...actual, Input: (props: any) => {
    const React = require('react')
    const state = jest.requireActual('react-native/Libraries/Components/TextInput/TextInputState').default
    const id = props.inputProps.testID
    const reference = React.useRef(null)
    if (!reference.current) {
      const control: any = { mounted: false, value: props.value }
      control.isFocused = () => state.currentlyFocusedInput() === control
      control.blur = jest.fn(() => {
        mockEvents.push(control.mounted ? `blur:${id}` : `late-blur:${id}`)
        // Native input methods cannot dispatch after their host has detached.
        if (control.mounted) state.blurInput(control)
      })
      reference.current = control
      mockControls.set(id, control)
    }
    const control = reference.current
    control.value = props.value
    React.useImperativeHandle(props.inputRef, () => control, [control])
    React.useLayoutEffect(() => {
      control.mounted = true
      state.registerInput(control)
      return () => {
        mockEvents.push(`detach:${id}`)
        control.mounted = false
        state.unregisterInput(control)
      }
    }, [control])
    return React.createElement(require('react-native').View, { testID: id })
  } }
})

const state = jest.requireActual('react-native/Libraries/Components/TextInput/TextInputState').default as typeof TextInput.State & {
  focusInput(field: Field): void
  blurInput(field: Field): void
  registerInput(field: Field): void
  unregisterInput(field: Field): void
  isTextInput(field: Field): boolean
}

beforeEach(() => {
  mockTheme = 'animal-island-ui'
  mockEvents = []
  mockControls.clear()
  jest.replaceProperty(Platform, 'OS', 'android')
})
afterEach(() => {
  const focused = state.currentlyFocusedInput()
  if (focused) { state.blurInput(focused); state.unregisterInput(focused) }
  jest.restoreAllMocks()
})

it.each(CANONICAL_THEME_IDS)('%s releases its focused input before the native child detaches', async theme => {
  mockTheme = theme
  const onChangeText = jest.fn()
  const screen = await render(<IsleThemeProvider>
    <IsleInput testID="search" value="Kept search" onChangeText={onChangeText} />
  </IsleThemeProvider>)
  const input = mockControls.get('search')!
  state.focusInput(input)
  expect(state.currentlyFocusedInput()).toBe(input)
  await screen.rerender(<IsleThemeProvider><View /></IsleThemeProvider>)
  expect(state.currentlyFocusedInput()).toBeNull()
  expect(state.isTextInput(input)).toBe(false)
  expect(mockEvents).toEqual(['blur:search', 'detach:search'])
  expect(input.value).toBe('Kept search')
  expect(onChangeText).not.toHaveBeenCalled()
  await screen.unmount()
})

it('keeps a different focused input when an unfocused field is removed', async () => {
  const screen = await render(<IsleInput testID="removed" value="Original text" />)
  const own = mockControls.get('removed')!
  const other = { isFocused: () => true } as unknown as Field
  state.registerInput(other)
  state.focusInput(other)
  await screen.unmount()
  expect(state.currentlyFocusedInput()).toBe(other)
  expect(state.isTextInput(other)).toBe(true)
  expect(own.blur).not.toHaveBeenCalled()
  expect(mockEvents).toEqual(['detach:removed'])
})

it('keeps focus and its host during a controlled value update', async () => {
  const screen = await render(<IsleInput testID="editing" value="First" />)
  const input = mockControls.get('editing')!
  state.focusInput(input)
  await screen.rerender(<IsleInput testID="editing" value="Latest draft" />)
  expect(mockControls.get('editing')).toBe(input)
  expect(state.currentlyFocusedInput()).toBe(input)
  expect(input.blur).not.toHaveBeenCalled()
  expect(input.value).toBe('Latest draft')
  await screen.unmount()
  expect(state.currentlyFocusedInput()).toBeNull()
})
