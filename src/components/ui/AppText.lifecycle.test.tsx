import { createRef } from 'react'
import { render } from '@testing-library/react-native'
import { Platform, TextInput as NativeTextInput, View } from 'react-native'
import { TextInput } from './AppText'

type Field = ReturnType<typeof NativeTextInput.State.currentlyFocusedInput>
type Control = NonNullable<Field> & { mounted: boolean; value: string; blur: jest.Mock }
const mockControls = new Map<string, Control>()
let mockEvents: string[] = []

jest.mock('@/hooks/useAppUpdateBlocker', () => ({ useAppUpdateBlocker: jest.fn() }))
jest.mock('react-native/Libraries/Components/TextInput/TextInputState', () =>
  jest.requireActual('react-native/Libraries/Components/TextInput/TextInputState'))
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native')
  const React = require('react')
  const state = jest.requireActual('react-native/Libraries/Components/TextInput/TextInputState').default
  const HostInput = React.forwardRef((props: any, ref: any) => {
    const reference = React.useRef(null)
    if (!reference.current) {
      const input: any = { mounted: false, value: props.value }
      input.isFocused = () => state.currentlyFocusedInput() === input
      input.blur = jest.fn(() => {
        mockEvents.push(input.mounted ? `blur:${props.testID}` : `late-blur:${props.testID}`)
        if (input.mounted) state.blurInput(input)
      })
      reference.current = input
      mockControls.set(props.testID, input)
    }
    const input = reference.current
    input.value = props.value
    React.useLayoutEffect(() => {
      const cleanup = typeof ref === 'function' ? ref(input) : undefined
      if (ref && typeof ref !== 'function') ref.current = input
      return () => {
        if (actual.Platform.OS !== 'web' && typeof cleanup === 'function') cleanup()
        else if (typeof ref === 'function') ref(null)
        else if (ref) ref.current = null
      }
    }, [ref, input])
    React.useLayoutEffect(() => {
      input.mounted = true
      state.registerInput(input)
      return () => {
        mockEvents.push(`detach:${props.testID}`)
        input.mounted = false
        state.unregisterInput(input)
      }
    }, [input])
    return React.createElement(actual.View, { testID: props.testID })
  })
  const Input = React.forwardRef((props: any, ref: unknown) =>
    React.createElement(HostInput, { ...props, ref, key: props.multiline ? 'multiline' : 'singleline' }))
  Input.State = state
  return new Proxy(actual, { get: (target, key) => key === 'TextInput' ? Input : Reflect.get(target, key) })
})

const state = jest.requireActual('react-native/Libraries/Components/TextInput/TextInputState').default as typeof NativeTextInput.State & {
  focusInput(input: Field): void
  blurInput(input: Field): void
  registerInput(input: Field): void
  unregisterInput(input: Field): void
  isTextInput(input: Field): boolean
}

beforeEach(() => {
  mockEvents = []
  mockControls.clear()
  jest.replaceProperty(Platform, 'OS', 'android')
})
afterEach(() => {
  const current = state.currentlyFocusedInput()
  if (current) { state.blurInput(current); state.unregisterInput(current) }
  jest.restoreAllMocks()
})

it.each(['', 'Saved system prompt'])('releases a focused field containing %p before its native host detaches', async value => {
  const onChangeText = jest.fn()
  const view = await render(<TextInput testID="prompt" value={value} onChangeText={onChangeText} />)
  const input = mockControls.get('prompt')!
  state.focusInput(input)
  await view.rerender(<View />)
  expect(state.currentlyFocusedInput()).toBeNull()
  expect(state.isTextInput(input)).toBe(false)
  expect(mockEvents).toEqual(['blur:prompt', 'detach:prompt'])
  expect(input.value).toBe(value)
  expect(onChangeText).not.toHaveBeenCalled()
  await view.unmount()
})

it('preserves a different focused field when this input is removed', async () => {
  const view = await render(<TextInput testID="prompt" value="Kept prompt" />)
  const own = mockControls.get('prompt')!
  const other = { isFocused: () => true } as unknown as Field
  state.registerInput(other)
  state.focusInput(other)
  await view.unmount()
  expect(state.currentlyFocusedInput()).toBe(other)
  expect(state.isTextInput(other)).toBe(true)
  expect(own.blur).not.toHaveBeenCalled()
})

it('keeps the same native ref and focus while a controlled value changes', async () => {
  const ref = createRef<NativeTextInput>()
  const view = await render(<TextInput ref={ref} testID="prompt" value="Old prompt" />)
  const input = mockControls.get('prompt')!
  expect(ref.current).toBe(input)
  state.focusInput(input)
  await view.rerender(<TextInput ref={ref} testID="prompt" value="Scene prompt" />)
  expect(ref.current).toBe(input)
  expect(state.currentlyFocusedInput()).toBe(input)
  expect(input.value).toBe('Scene prompt')
  expect(input.blur).not.toHaveBeenCalled()
  await view.unmount()
  expect(ref.current).toBeNull()
})

it('forwards a callback ref and releases its focused native field on removal', async () => {
  const reference = jest.fn()
  const view = await render(<TextInput ref={reference} testID="prompt" value="Kept prompt" />)
  const input = mockControls.get('prompt')!
  expect(reference).toHaveBeenLastCalledWith(input)
  state.focusInput(input)
  await view.unmount()
  expect(reference).toHaveBeenLastCalledWith(null)
  expect(state.currentlyFocusedInput()).toBeNull()
})

it('keeps an object ref attached to the current field when its host changes', async () => {
  const ref = createRef<NativeTextInput>()
  const view = await render(<TextInput ref={ref} testID="prompt" value="Kept draft" />)
  const first = mockControls.get('prompt')!
  await view.rerender(<TextInput ref={ref} testID="prompt" value="Kept draft" multiline />)
  const replacement = mockControls.get('prompt')!
  expect(replacement).not.toBe(first)
  expect(first.mounted).toBe(false)
  expect(ref.current).toBe(replacement)
  expect(replacement.value).toBe('Kept draft')
  state.focusInput(replacement)
  await view.unmount()
  expect(ref.current).toBeNull()
  expect(state.currentlyFocusedInput()).toBeNull()
})

it('notifies a callback ref when the native input host changes', async () => {
  const reference = jest.fn()
  const view = await render(<TextInput ref={reference} testID="prompt" value="Kept draft" />)
  const first = mockControls.get('prompt')!
  await view.rerender(<TextInput ref={reference} testID="prompt" value="Kept draft" multiline />)
  const replacement = mockControls.get('prompt')!
  expect(reference.mock.calls.map(([input]) => input)).toEqual([first, null, replacement])
  await view.unmount()
  expect(reference).toHaveBeenLastCalledWith(null)
})

it.each(['android', 'web'])('runs callback ref cleanup on removal without an extra null assignment on %s', async platform => {
  jest.replaceProperty(Platform, 'OS', platform as 'android' | 'web')
  const cleanup = jest.fn()
  const reference = jest.fn(() => cleanup)
  const view = await render(<TextInput ref={reference} testID="prompt" value="Kept draft" />)
  const input = mockControls.get('prompt')!
  state.focusInput(input)
  await view.unmount()
  expect(cleanup).toHaveBeenCalledTimes(1)
  expect(reference).toHaveBeenCalledTimes(1)
  expect(state.currentlyFocusedInput()).toBeNull()
})

it.each(['android', 'web'])('cleans up a replaced callback ref without blurring the retained input on %s', async platform => {
  jest.replaceProperty(Platform, 'OS', platform as 'android' | 'web')
  const cleanup = jest.fn()
  const first = jest.fn(() => cleanup)
  const next = jest.fn()
  const view = await render(<TextInput ref={first} testID="prompt" value="Kept draft" />)
  const input = mockControls.get('prompt')!
  state.focusInput(input)
  await view.rerender(<TextInput ref={next} testID="prompt" value="Kept draft" />)
  expect(cleanup).toHaveBeenCalledTimes(1)
  expect(first).toHaveBeenCalledTimes(1)
  expect(next).toHaveBeenLastCalledWith(input)
  expect(state.currentlyFocusedInput()).toBe(input)
  expect(input.blur).not.toHaveBeenCalled()
  await view.unmount()
})
