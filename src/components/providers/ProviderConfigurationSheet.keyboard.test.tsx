import { act, fireEvent, render } from '@testing-library/react-native'
import { Keyboard, Platform, ScrollView, StyleSheet, TextInput, type KeyboardEvent, type View } from 'react-native'
import { ProviderConfigurationSheet } from './ProviderSettingsContent'
import type { AIProvider } from '@/types/providerContracts'
import type { useKeyboardScrollViewport } from '@/presentation/layout/useKeyboardScrollViewport'

let mockViewport: ReturnType<typeof useKeyboardScrollViewport> | undefined
const mockNavigation = { isFocused: () => true, addListener: () => () => undefined }
jest.mock('expo-router', () => ({
  useNavigation: () => mockNavigation,
  useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, [effect]),
}))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/hooks/useAppTheme', () => ({
  useAppTheme: () => ({ colors: require('@/theme/colors').getColors('dark', 'minimal'), canonicalThemeId: 'minimal', mode: 'dark' }),
}))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('@/components/settings/SettingsHelp', () => ({ SettingsHelpButton: () => null }))
jest.mock('moti', () => ({ MotiView: require('react-native').View }))
jest.mock('@/components/ui/isle', () => ({
  IslePressable: require('react-native').Pressable,
  useIsleDialog: () => ({ confirm: async () => true, notice: jest.fn(), toast: jest.fn() }),
}))
jest.mock('@/components/settings/ApiKeyPanel', () => ({
  ApiKeyPanel: () => {
    const [value, setValue] = require('react').useState('')
    const { TextInput } = require('react-native')
    return <TextInput testID="owned-key-replacement" value={value} onChangeText={setValue} secureTextEntry />
  },
}))
jest.mock('@/presentation/layout/useKeyboardScrollViewport', () => ({
  useKeyboardScrollViewport: (key: string) => {
    const viewport = jest.requireActual('@/presentation/layout/useKeyboardScrollViewport').useKeyboardScrollViewport(key)
    mockViewport = viewport
    return viewport
  },
}))

const listeners = new Map<string, Set<(event: KeyboardEvent) => void>>()
const frames = new Map<number, FrameRequestCallback>()
let frameId = 0
let focusedInput: ReturnType<typeof TextInput.State.currentlyFocusedInput> | null = null
const event: KeyboardEvent = {
  duration: 0, easing: 'keyboard',
  endCoordinates: { screenX: 0, screenY: 550, width: 390, height: 300 },
}
const provider: AIProvider = {
  id: 'owned-keyboard-provider', type: 'openai-compatible', name: 'Owned keyboard provider',
  apiKey: '', baseUrl: 'https://example.invalid/v1', models: [], enabled: true,
}
async function flushFrame() {
  await act(() => {
    const pending = [...frames.values()]
    frames.clear()
    for (const callback of pending) callback(0)
  })
}
async function emit(name: string) {
  await act(() => { for (const callback of listeners.get(name) ?? []) callback(event) })
  await flushFrame()
}
function layout(height: number) {
  return { nativeEvent: { layout: { x: 0, y: 0, width: 390, height } } }
}
function scroll(y: number) {
  return { nativeEvent: { contentOffset: { x: 0, y } } }
}
async function fixture() {
  let offset = 120
  let inputTop = 700
  const input = {
    measureInWindow: jest.fn((callback: (x: number, y: number, width: number, height: number) => void) => callback(0, inputTop, 340, 44)),
    focus: jest.fn(), setSelection: jest.fn(), setNativeProps: jest.fn(),
  }
  focusedInput = input as unknown as NonNullable<typeof focusedInput>
  const screen = await render(<ProviderConfigurationSheet visible provider={provider} deferMount={false}
    initialView="connection" onViewChange={jest.fn()} onUse={jest.fn()} onClose={jest.fn()} />)
  const sheetScroll = screen.getByTestId('provider-configuration-scroll')
  const scrollTo = jest.fn(({ y }: { y: number }) => {
    inputTop -= y - offset
    offset = y
    sheetScroll.props.onScroll?.(scroll(y))
  })
  if (mockViewport) {
    mockViewport.frameRef.current = {
      measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => callback(0, 110, 390, 740),
    } as unknown as View
    mockViewport.scrollRef.current = { scrollTo } as unknown as ScrollView
  }
  await fireEvent.changeText(screen.getByTestId('owned-key-replacement'), 'owned-new-key')
  await act(() => {
    sheetScroll.props.onScroll?.(scroll(offset))
    sheetScroll.props.onLayout?.(layout(740))
    sheetScroll.props.onFocus?.({ nativeEvent: { target: 1 } })
  })
  await flushFrame()
  return { screen, sheetScroll, scrollTo, input }
}
beforeEach(() => {
  mockViewport = undefined
  listeners.clear(); frames.clear(); frameId = 0; focusedInput = null
  jest.replaceProperty(Platform, 'OS', 'android')
  jest.spyOn(Keyboard, 'metrics').mockReturnValue(undefined)
  jest.spyOn(Keyboard, 'addListener').mockImplementation((name, callback) => {
    const callbacks = listeners.get(name) ?? new Set()
    callbacks.add(callback)
    listeners.set(name, callbacks)
    return { remove: () => { callbacks.delete(callback) } } as unknown as ReturnType<typeof Keyboard.addListener>
  })
  jest.spyOn(TextInput.State, 'currentlyFocusedInput').mockImplementation(() => focusedInput!)
  jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => {
    frames.set(++frameId, callback)
    return frameId
  })
  jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(id => { if (typeof id === 'number') frames.delete(id) })
})
afterEach(() => { jest.restoreAllMocks() })

it('reveals a deep saved-key draft after native resize and restores its automatic scroll when the keyboard closes', async () => {
  const f = await fixture()
  const owner = f.screen.getByTestId('owned-key-replacement')
  await emit('keyboardDidShow')
  expect(StyleSheet.flatten(f.sheetScroll.props.style)?.marginBottom ?? 0).toBe(300)
  expect(f.scrollTo).not.toHaveBeenCalled()
  await act(() => f.sheetScroll.props.onLayout?.(layout(440)))
  await flushFrame()
  expect(f.scrollTo).toHaveBeenLastCalledWith({ y: 326, animated: false })
  await emit('keyboardDidHide')
  await act(() => f.sheetScroll.props.onLayout?.(layout(740)))
  await flushFrame()
  expect(f.scrollTo).toHaveBeenLastCalledWith({ y: 120, animated: false })
  expect(f.screen.getByTestId('owned-key-replacement')).toBe(owner)
  expect(owner.props.value).toBe('owned-new-key')
  expect(owner.props.secureTextEntry).toBe(true)
  expect(f.input.focus).not.toHaveBeenCalled()
  expect(f.input.setSelection).not.toHaveBeenCalled()
  expect(f.input.setNativeProps).not.toHaveBeenCalled()
  await f.screen.unmount()
})

it('preserves the user scroll and replacement draft when the keyboard closes after a drag', async () => {
  const f = await fixture()
  await emit('keyboardDidShow')
  await act(() => f.sheetScroll.props.onLayout?.(layout(440)))
  await flushFrame()
  expect(f.scrollTo).toHaveBeenLastCalledWith({ y: 326, animated: false })
  f.scrollTo.mockClear()
  await act(() => {
    f.sheetScroll.props.onScrollBeginDrag?.()
    f.sheetScroll.props.onScroll?.(scroll(400))
  })
  await emit('keyboardDidHide')
  await act(() => f.sheetScroll.props.onLayout?.(layout(740)))
  await flushFrame()
  expect(f.scrollTo).not.toHaveBeenCalled()
  expect(f.screen.getByTestId('owned-key-replacement').props.value).toBe('owned-new-key')
  await f.screen.unmount()
})
