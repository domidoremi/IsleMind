import { act, renderHook } from '@testing-library/react-native'
import { Keyboard, Platform, type KeyboardEvent, type View } from 'react-native'
import { useKeyboardViewportInset } from './useKeyboardScrollViewport'

const listeners = new Map<string, (event: KeyboardEvent) => void>()
const frames = new Map<number, FrameRequestCallback>()
const removals: jest.Mock[] = []
let frameId = 0
const event: KeyboardEvent = { duration: 0, easing: 'keyboard', endCoordinates: { screenX: 0, screenY: 550, width: 390, height: 300 } }
async function flush() { await act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)) }) }
async function emit(name: string, value = event) { await act(() => { listeners.get(name)?.(value) }); await flush() }
async function fixture(top = 110, height = 740) {
  const hook = await renderHook(() => useKeyboardViewportInset())
  const measure = jest.fn((callback: (x: number, y: number, width: number, height: number) => void) => callback(0, top, 390, height))
  hook.result.current.frameRef.current = { measureInWindow: measure } as unknown as View
  await flush()
  return { hook, measure, geometry: (nextTop: number, nextHeight: number) => { top = nextTop; height = nextHeight } }
}
beforeEach(() => {
  listeners.clear(); frames.clear(); removals.length = 0; frameId = 0
  jest.replaceProperty(Platform, 'OS', 'android')
  jest.spyOn(Keyboard, 'metrics').mockReturnValue(undefined)
  jest.spyOn(Keyboard, 'addListener').mockImplementation((name, callback) => {
    listeners.set(name, callback); const remove = jest.fn(() => { listeners.delete(name) }); removals.push(remove)
    return { remove } as unknown as ReturnType<typeof Keyboard.addListener>
  })
  jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++frameId, callback); return frameId })
  jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(id => { if (typeof id === 'number') frames.delete(id) })
})
afterEach(() => { jest.restoreAllMocks() })

it('crops an overlay keyboard against the unchanged parent frame and restores its full content height', async () => {
  const f = await fixture()
  expect(f.hook.result.current.visibleHeight).toBe(740)
  await emit('keyboardDidShow')
  expect(f.hook.result.current.bottomInset).toBe(300); expect(f.hook.result.current.visibleHeight).toBe(440)
  await act(() => { f.hook.result.current.onFrameLayout() }); await flush()
  expect(f.hook.result.current.bottomInset).toBe(300); expect(f.hook.result.current.visibleHeight).toBe(440)
  await emit('keyboardDidHide')
  expect(f.hook.result.current.bottomInset).toBe(0); expect(f.hook.result.current.visibleHeight).toBe(740)
})
it('does not subtract the keyboard twice when Android has already resized the parent frame', async () => {
  const f = await fixture(110, 440); await emit('keyboardDidShow')
  expect(f.hook.result.current.bottomInset).toBe(0); expect(f.hook.result.current.visibleHeight).toBe(440)
})
it('uses the actual inset top for the original landscape search region', async () => {
  const f = await fixture(32, 358)
  await emit('keyboardDidShow', { ...event, endCoordinates: { ...event.endCoordinates, screenY: 135, height: 255 } })
  expect(f.hook.result.current.bottomInset).toBe(255); expect(f.hook.result.current.visibleHeight).toBe(103)
})
it('measures an already-visible keyboard after the native frame attaches', async () => {
  jest.mocked(Keyboard.metrics).mockReturnValue(event.endCoordinates)
  const f = await fixture(); expect(f.hook.result.current.bottomInset).toBe(300)
})
it('updates the actual available height after rotation and keyboard height changes', async () => {
  const f = await fixture(); await emit('keyboardDidShow')
  f.geometry(30, 360)
  await emit('keyboardDidShow', { ...event, endCoordinates: { ...event.endCoordinates, screenY: 150, height: 240 } })
  expect(f.hook.result.current.bottomInset).toBe(240); expect(f.hook.result.current.visibleHeight).toBe(120)
})
it('keeps the latest valid geometry when a hidden native frame reports zero or invalid measurements', async () => {
  const f = await fixture(); await emit('keyboardDidShow')
  f.geometry(0, 0); await act(() => { f.hook.result.current.onFrameLayout() }); await flush()
  expect(f.hook.result.current.bottomInset).toBe(300)
  f.geometry(NaN, 740); await act(() => { f.hook.result.current.onFrameLayout() }); await flush()
  expect(f.hook.result.current.visibleHeight).toBe(440)
})
it('ignores invalid keyboard coordinates instead of changing the current inset', async () => {
  const f = await fixture(); await emit('keyboardDidShow')
  await emit('keyboardDidShow', { ...event, endCoordinates: { ...event.endCoordinates, screenY: NaN } })
  await emit('keyboardDidShow', { ...event, endCoordinates: { ...event.endCoordinates, height: 0 } })
  expect(f.hook.result.current.bottomInset).toBe(300)
})
it.each(['replace', 'unmount'] as const)('retires an in-flight measurement after frame %s', async change => {
  const f = await fixture(); let finish: ((x: number, y: number, width: number, height: number) => void) | undefined
  f.measure.mockImplementation(callback => { finish = callback })
  await act(() => { f.hook.result.current.onFrameLayout() }); await flush()
  if (change === 'unmount') await f.hook.unmount()
  else f.hook.result.current.frameRef.current = { measureInWindow: jest.fn() } as unknown as View
  await act(() => { finish?.(0, 110, 390, 500) })
  if (change === 'replace') expect(f.hook.result.current.visibleHeight).toBe(740)
  else { expect(removals.every(remove => remove.mock.calls.length === 1)).toBe(true); expect(frames.size).toBe(0) }
})
it.each(['ios', 'web'] as const)('uses existing %s viewport behavior without Android keyboard subscriptions', async platform => {
  jest.replaceProperty(Platform, 'OS', platform)
  const hook = await renderHook(() => useKeyboardViewportInset())
  expect(Keyboard.addListener).not.toHaveBeenCalled(); expect(Keyboard.metrics).not.toHaveBeenCalled()
  expect(hook.result.current.bottomInset).toBe(0); expect(hook.result.current.visibleHeight).toBeNull()
})
