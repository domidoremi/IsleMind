import { act, renderHook } from '@testing-library/react-native'
import { Platform, type GestureResponderEvent } from 'react-native'
import { useThemeTransition } from 'animal-island-ui-rn'
import { useSettingsStore } from '@/store/settingsStore'
import { getColors } from '@/theme/colors'
import type { Settings } from '@/types/settingsContracts'
import { captureThemeSelectionAnchor, useThemeSelection } from './useThemeSelection'

jest.mock('animal-island-ui-rn', () => ({ useThemeTransition: jest.fn() }))
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: { getState: jest.fn() } }))
let settings: Settings
let updateSettings: jest.Mock
let transition: jest.Mock
beforeEach(() => {
  settings = { theme: 'light', themeId: 'minimal', themeAccent: undefined } as Settings
  updateSettings = jest.fn((selection) => { settings = { ...settings, ...selection } })
  jest.mocked(useSettingsStore.getState).mockImplementation(() => ({ settings, updateSettings }) as unknown as ReturnType<typeof useSettingsStore.getState>)
  transition = jest.fn(async (update) => { update() })
  jest.mocked(useThemeTransition).mockReturnValue(transition)
})

it('does not animate or persist an already-selected appearance', async () => {
  const { result } = await renderHook(() => useThemeSelection(jest.fn()))
  await act(() => result.current({ themeId: 'minimal' }))
  expect(transition).not.toHaveBeenCalled()
  expect(updateSettings).not.toHaveBeenCalled()
})
it('allows settings to record undo at the actual transition commit, not at click time', async () => {
  let apply!: () => void
  transition.mockImplementation(callback => new Promise<void>(resolve => { apply = () => { callback(); resolve() } }))
  const commit = jest.fn(selection => updateSettings(selection))
  const { result } = await renderHook(() => useThemeSelection(jest.fn(), commit))
  await act(() => result.current({ theme: 'dark' }))
  expect(commit).not.toHaveBeenCalled()
  await act(() => apply())
  expect(commit).toHaveBeenCalledWith({ theme: 'dark' })
})

it('passes the press origin and destination canvas, then applies through the existing settings command', async () => {
  const onError = jest.fn()
  const { result } = await renderHook(() => useThemeSelection(onError))
  await act(() => result.current({ theme: 'dark', themeId: 'animal-island-ui' }, { nativeEvent: { pageX: 42, pageY: 70 } } as GestureResponderEvent))
  expect(transition).toHaveBeenCalledWith(expect.any(Function), {
    origin: { x: 42, y: 70 }, color: getColors('dark', 'animal-island-ui').background.canvas,
  })
  expect(updateSettings).toHaveBeenCalledWith({ theme: 'dark', themeId: 'animal-island-ui' })
  expect(onError).not.toHaveBeenCalled()
})

it('does not discard returning to the current theme while another selection is pending', async () => {
  const queued: (() => void)[] = []
  transition.mockImplementation((update) => new Promise<void>((resolve) => { queued.push(() => { update(); resolve() }) }))
  const { result } = await renderHook(() => useThemeSelection(jest.fn()))
  await act(() => {
    result.current({ themeId: 'monet' })
    result.current({ themeId: 'minimal' })
  })
  expect(queued).toHaveLength(2)
  await act(() => queued.forEach((update) => update()))
  expect(settings.themeId).toBe('minimal')
  expect(updateSettings).toHaveBeenCalledTimes(2)
})

it('does not restart the reveal for repeated clicks on the same pending selection', async () => {
  let apply!: () => void
  transition.mockImplementation((update) => new Promise<void>((resolve) => { apply = () => { update(); resolve() } }))
  const { result } = await renderHook(() => useThemeSelection(jest.fn()))
  await act(() => {
    result.current({ themeId: 'monet' })
    result.current({ themeId: 'monet' })
  })
  expect(transition).toHaveBeenCalledTimes(1)
  await act(() => apply())
  expect(settings.themeId).toBe('monet')
})

it('retains rapid family + mode + accent intent when preparing the native cover color', async () => {
  const queued: (() => void)[] = []
  transition.mockImplementation((update) => new Promise<void>((resolve) => { queued.push(() => { update(); resolve() }) }))
  const { result } = await renderHook(() => useThemeSelection(jest.fn()))
  await act(() => {
    result.current({ themeId: 'monet' })
    result.current({ theme: 'dark' })
    result.current({ themeAccent: '#4455B7' })
  })
  expect(transition.mock.calls[2][1].color).toBe(getColors('dark', 'monet', undefined, '#4455B7').background.canvas)
  await act(() => queued.forEach((update) => update()))
  expect(settings).toMatchObject({ themeId: 'monet', theme: 'dark', themeAccent: '#4455B7' })
})

it('uses a centered reveal for keyboard presses and reports failures', async () => {
  const onError = jest.fn()
  const error = new Error('selection failed')
  transition.mockRejectedValueOnce(error)
  const { result } = await renderHook(() => useThemeSelection(onError))
  await act(() => result.current({ theme: 'dark' }, { nativeEvent: { pageX: 0, pageY: 0 } } as GestureResponderEvent))
  expect(transition.mock.calls[0][1].origin).toBeUndefined()
  expect(onError).toHaveBeenCalledWith(error)
  await act(() => result.current({ theme: 'light' }))
  expect(transition).toHaveBeenCalledTimes(1)
})

it('keeps the clicked control visually anchored on web without refocusing or touching a detached tree', () => {
  const styleDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle')
  const platform = jest.replaceProperty(Platform, 'OS', 'web')
  try {
    Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: () => ({ overflowY: 'auto' }) })
    const container = { scrollHeight: 1200, clientHeight: 800, scrollTop: 200, isConnected: true }
    let top = 120
    const target = { parentElement: container, isConnected: true, getBoundingClientRect: () => ({ top }) }
    const restore = captureThemeSelectionAnchor({ currentTarget: target } as unknown as GestureResponderEvent)
    top = 145
    restore!()
    expect(container.scrollTop).toBe(225)
    target.isConnected = false
    restore!()
    expect(container.scrollTop).toBe(225)
  } finally {
    platform.restore()
    if (styleDescriptor) Object.defineProperty(globalThis, 'getComputedStyle', styleDescriptor)
    else Reflect.deleteProperty(globalThis, 'getComputedStyle')
  }
})
