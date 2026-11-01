import { act, renderHook } from '@testing-library/react-native'
import { Appearance } from 'react-native'
import { useSystemColorScheme } from './useSystemColorScheme'

let scheme: 'light' | 'dark' | null
const listeners = new Set<() => void>()
const remove = jest.fn()
let subscribe: jest.SpyInstance

beforeEach(() => {
  scheme = 'light'
  listeners.clear()
  remove.mockClear()
  jest.spyOn(Appearance, 'getColorScheme').mockImplementation(() => scheme)
  subscribe = jest.spyOn(Appearance, 'addChangeListener').mockImplementation(listener => {
    const notify = () => listener({ colorScheme: scheme ?? 'unspecified' })
    listeners.add(notify)
    return { remove: () => { listeners.delete(notify); remove() } }
  })
})

afterEach(() => {
  jest.restoreAllMocks()
})

it('updates all consumers without replacing their subscriptions during theme renders', async () => {
  const { result, rerender, unmount } = await renderHook(() => ({
    shell: useSystemColorScheme(),
    preview: useSystemColorScheme(),
  }))
  expect(result.current).toEqual({ shell: 'light', preview: 'light' })
  expect(subscribe).toHaveBeenCalledTimes(2)
  for (const next of ['dark', 'light', 'dark'] as const) {
    await act(() => {
      scheme = next
      for (const notify of [...listeners]) notify()
    })
    await rerender({})
    expect(result.current).toEqual({ shell: next, preview: next })
    expect(subscribe).toHaveBeenCalledTimes(2)
    expect(remove).not.toHaveBeenCalled()
  }
  await unmount()
  expect(remove).toHaveBeenCalledTimes(2)
  expect(listeners.size).toBe(0)
})

it('reads the current preference on render even when a legacy media event was missed', async () => {
  const { result, rerender } = await renderHook(() => useSystemColorScheme())
  scheme = 'dark'
  await rerender({})
  expect(result.current).toBe('dark')
  expect(subscribe).toHaveBeenCalledTimes(1)
})

it('closes the render-to-subscription race without requiring a second event', async () => {
  subscribe.mockImplementationOnce(listener => {
    scheme = 'dark'
    const notify = () => listener({ colorScheme: scheme ?? 'unspecified' })
    listeners.add(notify)
    return { remove: () => { listeners.delete(notify); remove() } }
  })
  const { result } = await renderHook(() => useSystemColorScheme())
  expect(result.current).toBe('dark')
})

it('normalizes an unavailable device preference without inventing a dark mode', async () => {
  scheme = null
  const { result } = await renderHook(() => useSystemColorScheme())
  expect(result.current).toBeNull()
  await act(() => {
    scheme = 'dark'
    for (const notify of [...listeners]) notify()
  })
  expect(result.current).toBe('dark')
})
