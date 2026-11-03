import { act, renderHook } from '@testing-library/react-native'
import {
  Keyboard, Platform, TextInput,
  type KeyboardEvent, type LayoutChangeEvent, type NativeScrollEvent,
  type NativeSyntheticEvent, type ScrollView, type View,
} from 'react-native'
import { useKeyboardScrollViewport } from './useKeyboardScrollViewport'

jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, [effect]),
}))

const listeners = new Map<string, (event: KeyboardEvent) => void>()
const frames = new Map<number, FrameRequestCallback>()
const removals: jest.Mock[] = []
let frameId = 0
let focusedInput: ReturnType<typeof TextInput.State.currentlyFocusedInput> | null = null
const keyboardEvent: KeyboardEvent = {
  duration: 0, easing: 'keyboard',
  endCoordinates: { screenX: 0, screenY: 550, width: 390, height: 300 },
}

function layout(height: number) {
  return { nativeEvent: { layout: { x: 0, y: 0, width: 390, height } } } as LayoutChangeEvent
}
function scroll(y: number) {
  return { nativeEvent: { contentOffset: { x: 0, y } } } as NativeSyntheticEvent<NativeScrollEvent>
}
async function flushFrame() {
  await act(() => {
    const pending = [...frames.values()]
    frames.clear()
    for (const callback of pending) callback(0)
  })
}
async function emit(name: string, event = keyboardEvent) {
  await act(() => { listeners.get(name)?.(event) })
  await flushFrame()
}

async function fixture() {
  let currentOffset = 120
  let inputTop = 700
  const input = {
    measureInWindow: jest.fn((callback: (x: number, y: number, width: number, height: number) => void) => callback(0, inputTop, 340, 76)),
    focus: jest.fn(), setSelection: jest.fn(), setNativeProps: jest.fn(),
  }
  focusedInput = input as unknown as NonNullable<typeof focusedInput>
  const hook = await renderHook<ReturnType<typeof useKeyboardScrollViewport>, { routeKey: string }>(({ routeKey }) => useKeyboardScrollViewport(routeKey), {
    initialProps: { routeKey: 'document-1' },
  })
  const measureFrame = jest.fn((callback: (x: number, y: number, width: number, height: number) => void) => callback(0, 110, 390, 740))
  const scrollTo = jest.fn(({ y }: { y: number }) => {
    inputTop -= y - currentOffset
    currentOffset = y
    hook.result.current.onScroll(scroll(y))
  })
  hook.result.current.frameRef.current = { measureInWindow: measureFrame } as unknown as View
  hook.result.current.scrollRef.current = { scrollTo } as unknown as ScrollView
  await act(() => {
    hook.result.current.onScroll(scroll(currentOffset))
    hook.result.current.onScrollLayout(layout(740))
    hook.result.current.onInputFocus()
  })
  await flushFrame()
  return { hook, input, scrollTo, measureFrame, setInputTop: (top: number) => { inputTop = top } }
}

beforeEach(() => {
  listeners.clear(); frames.clear(); removals.length = 0; focusedInput = null; frameId = 0
  jest.replaceProperty(Platform, 'OS', 'android')
  jest.spyOn(Keyboard, 'metrics').mockReturnValue(undefined)
  jest.spyOn(Keyboard, 'addListener').mockImplementation((name, callback) => {
    listeners.set(name, callback)
    const remove = jest.fn(() => { listeners.delete(name) })
    removals.push(remove)
    return { remove } as unknown as ReturnType<typeof Keyboard.addListener>
  })
  jest.spyOn(TextInput.State, 'currentlyFocusedInput').mockImplementation(() => focusedInput!)
  jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => {
    frameId += 1; frames.set(frameId, callback); return frameId
  })
  jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(id => { if (typeof id === 'number') frames.delete(id) })
})
afterEach(() => { jest.restoreAllMocks() })

it('waits for native resize, reveals the focused instruction and restores only its automatic scroll', async () => {
  const f = await fixture()
  await emit('keyboardDidShow')
  expect(f.hook.result.current.bottomInset).toBe(300)
  expect(f.hook.result.current.visibleHeight).toBe(440)
  expect(f.scrollTo).not.toHaveBeenCalled()
  await act(() => { f.hook.result.current.onScrollLayout(layout(440)) })
  await flushFrame()
  expect(f.scrollTo).toHaveBeenLastCalledWith({ y: 358, animated: false })
  await emit('keyboardDidHide')
  expect(f.hook.result.current.bottomInset).toBe(0)
  expect(f.scrollTo).toHaveBeenCalledTimes(1)
  await act(() => { f.hook.result.current.onScrollLayout(layout(740)) })
  await flushFrame()
  expect(f.scrollTo).toHaveBeenLastCalledWith({ y: 120, animated: false })
  expect(f.input.focus).not.toHaveBeenCalled()
  expect(f.input.setSelection).not.toHaveBeenCalled()
  expect(f.input.setNativeProps).not.toHaveBeenCalled()
})

it('does not undo manual reading while the keyboard is open', async () => {
  const f = await fixture()
  await emit('keyboardDidShow')
  await act(() => { f.hook.result.current.onScrollLayout(layout(440)) })
  await flushFrame()
  f.scrollTo.mockClear()
  await act(() => {
    f.hook.result.current.onScrollBeginDrag()
    f.hook.result.current.onScroll(scroll(400))
  })
  await emit('keyboardDidHide')
  await act(() => { f.hook.result.current.onScrollLayout(layout(740)) })
  await flushFrame()
  expect(f.scrollTo).not.toHaveBeenCalled()
})

it('remeasures focus and field layout with an already-open keyboard without redundant scrolling', async () => {
  const f = await fixture()
  await emit('keyboardDidShow')
  await act(() => { f.hook.result.current.onScrollLayout(layout(440)) })
  await flushFrame()
  f.scrollTo.mockClear()
  f.setInputTop(350)
  await act(() => { f.hook.result.current.onInputFocus() })
  await flushFrame()
  expect(f.scrollTo).not.toHaveBeenCalled()
  f.setInputTop(700)
  await act(() => { f.hook.result.current.onInputLayout() })
  await flushFrame()
  expect(f.scrollTo).toHaveBeenCalledTimes(1)
})

it('handles an already-visible keyboard on entry and retains the original baseline through keyboard-height changes', async () => {
  jest.mocked(Keyboard.metrics).mockReturnValue(keyboardEvent.endCoordinates)
  const f = await fixture()
  expect(f.hook.result.current.keyboardVisible).toBe(true)
  await act(() => { f.hook.result.current.onScrollLayout(layout(440)) })
  await flushFrame()
  await emit('keyboardDidShow', { ...keyboardEvent, endCoordinates: { ...keyboardEvent.endCoordinates, screenY: 500, height: 350 } })
  expect(f.hook.result.current.bottomInset).toBe(350)
  await act(() => { f.hook.result.current.onScrollLayout(layout(390)) })
  await flushFrame()
  await emit('keyboardDidHide')
  await act(() => { f.hook.result.current.onScrollLayout(layout(740)) })
  await flushFrame()
  expect(f.scrollTo).toHaveBeenLastCalledWith({ y: 0, animated: false })
})

it.each(['route', 'unmount'] as const)('cancels pending frames and stale native callbacks on %s', async change => {
  const f = await fixture()
  await emit('keyboardDidShow')
  let finish: ((x: number, y: number, width: number, height: number) => void) | undefined
  f.measureFrame.mockImplementation(callback => { finish = callback })
  await act(() => { f.hook.result.current.onScrollLayout(layout(440)) })
  await flushFrame()
  if (change === 'route') await f.hook.rerender({ routeKey: 'document-2' })
  else await f.hook.unmount()
  await act(() => { finish?.(0, 110, 390, 740) })
  expect(f.scrollTo).not.toHaveBeenCalled()
  expect(removals.slice(0, 2).every(remove => remove.mock.calls.length === 1)).toBe(true)
  if (change === 'unmount') expect(frames.size).toBe(0)
})

it.each(['ios', 'web'] as const)('leaves %s keyboard ownership to its existing platform behavior', async platform => {
  jest.replaceProperty(Platform, 'OS', platform)
  const hook = await renderHook(() => useKeyboardScrollViewport('document'))
  expect(Keyboard.addListener).not.toHaveBeenCalled()
  expect(Keyboard.metrics).not.toHaveBeenCalled()
  expect(hook.result.current.bottomInset).toBe(0)
})
