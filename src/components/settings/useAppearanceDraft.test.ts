import { act, renderHook } from '@testing-library/react-native'
import { appearanceSelection, useAppearanceDraft } from './useAppearanceDraft'
import type { ThemeSelection } from '@/hooks/useThemeSelection'
import type { GestureResponderEvent } from 'react-native'

let mockSettings: { theme: 'light' | 'dark' | 'system'; themeId: 'minimal' | 'monet'; themeAccent?: string }
let mockController: AbortController
const mockFlush = jest.fn()
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: { getState: () => ({ settings: mockSettings }) } }))
jest.mock('@/presentation/features/settings/settingsStorePersistenceCommand', () => ({ flushPersistedSettings: () => mockFlush() }))
jest.mock('./SettingsEditBoundary', () => ({
  useSettingsDraft: jest.fn(),
  useSettingsLifetime: () => {
    require('react').useEffect(() => () => mockController.abort(), [])
    return { current: mockController }
  },
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const select = jest.fn(async (selection: ThemeSelection, _event?: GestureResponderEvent, canCommit?: () => boolean) => {
  if (canCommit && !canCommit()) return false
  Object.assign(mockSettings, selection); return true
})
beforeEach(() => {
  jest.clearAllMocks(); mockFlush.mockResolvedValue(undefined)
  mockSettings = { theme: 'light', themeId: 'minimal' }; mockController = new AbortController()
  select.mockImplementation(async (selection, _event, canCommit) => {
    if (canCommit && !canCommit()) return false
    Object.assign(mockSettings, selection); return true
  })
})
async function setup() {
  return renderHook(() => useAppearanceDraft(mockSettings, select))
}

it('keeps selection local and only confirms success after both transition and persistence settle', async () => {
  const transition = deferred<boolean>()
  const persistence = deferred<void>()
  select.mockImplementationOnce(async selection => { const success = await transition.promise; Object.assign(mockSettings, selection); return success })
  mockFlush.mockReturnValueOnce(persistence.promise)
  const hook = await setup()
  await act(() => hook.result.current.edit({ themeId: 'monet', theme: 'system' }))
  expect(mockSettings.themeId).toBe('minimal')
  expect(select).not.toHaveBeenCalled()
  let operation!: Promise<boolean>
  await act(() => { operation = hook.result.current.apply() })
  expect(hook.result.current.busy).toBe(true)
  expect(hook.result.current.saved).toBe(false)
  await act(async () => { expect(await hook.result.current.apply()).toBe(false) })
  await act(async () => transition.resolve(true))
  expect(mockFlush).toHaveBeenCalledTimes(1)
  expect(hook.result.current.saved).toBe(false)
  await act(async () => { persistence.resolve(); expect(await operation).toBe(true) })
  expect(hook.result.current.saved).toBe(true)
  expect(hook.result.current.dirty).toBe(false)
  expect(select).toHaveBeenCalledTimes(1)
})

it('follows external appearance only when the draft is untouched', async () => {
  const hook = await setup()
  mockSettings = { theme: 'dark', themeId: 'minimal' }
  await hook.rerender(undefined)
  expect(hook.result.current.draft.theme).toBe('dark')
  await act(() => hook.result.current.edit({ themeId: 'monet' }))
  mockSettings = { theme: 'system', themeId: 'minimal' }
  await hook.rerender(undefined)
  expect(hook.result.current.draft.themeId).toBe('monet')
  expect(hook.result.current.error).toBe('conflict')
  await act(async () => { expect(await hook.result.current.apply()).toBe(false) })
  expect(select).not.toHaveBeenCalled()
  await act(() => hook.result.current.discard())
  expect(hook.result.current.draft.theme).toBe('system')
  expect(hook.result.current.error).toBeUndefined()
  expect(hook.result.current.dirty).toBe(false)
})

it('preserves a failed write as unsaved and permits a durable retry even when memory already changed', async () => {
  mockFlush.mockRejectedValueOnce(new Error('disk unavailable'))
  const hook = await setup()
  await act(() => hook.result.current.edit({ themeId: 'monet', themeAccent: '#abc' }))
  await act(async () => { expect(await hook.result.current.apply()).toBe(false) })
  expect(mockSettings.themeId).toBe('monet')
  expect(hook.result.current.error).toBe('saveFailed')
  expect(hook.result.current.dirty).toBe(true)
  expect(hook.result.current.draft.themeAccent).toBe('#AABBCC')
  expect(hook.result.current.saved).toBe(false)
  await act(async () => { expect(await hook.result.current.apply()).toBe(true) })
  expect(hook.result.current.saved).toBe(true)
  expect(hook.result.current.error).toBeUndefined()
})

it('retains both the local draft and a newer external appearance during a delayed transition', async () => {
  const transition = deferred<boolean>()
  select.mockImplementationOnce(async (selection, _event, canCommit) => {
    await transition.promise
    if (!canCommit?.()) return false
    Object.assign(mockSettings, selection); return true
  })
  const hook = await setup()
  await act(() => hook.result.current.edit({ themeId: 'monet' }))
  let operation!: Promise<boolean>
  await act(() => { operation = hook.result.current.apply() })
  mockSettings = { theme: 'dark', themeId: 'minimal' }
  await act(async () => { transition.resolve(true); expect(await operation).toBe(false) })
  expect(mockSettings).toEqual({ theme: 'dark', themeId: 'minimal' })
  expect(hook.result.current.draft.themeId).toBe('monet')
  expect(hook.result.current.error).toBe('conflict')
  expect(mockFlush).not.toHaveBeenCalled()
})

it.each(['resolve', 'reject'] as const)('cannot overwrite an external appearance during a disk %s', async outcome => {
  const persistence = deferred<void>()
  mockFlush.mockReturnValueOnce(persistence.promise)
  const hook = await setup()
  await act(() => hook.result.current.edit({ themeId: 'monet' }))
  let operation!: Promise<boolean>
  await act(() => { operation = hook.result.current.apply() })
  mockSettings = { theme: 'dark', themeId: 'minimal' }
  await act(async () => {
    if (outcome === 'resolve') persistence.resolve()
    else persistence.reject(new Error('disk failure'))
    expect(await operation).toBe(false)
  })
  expect(hook.result.current.error).toBe('conflict')
  expect(hook.result.current.draft.themeId).toBe('monet')
  await act(async () => { expect(await hook.result.current.apply()).toBe(false) })
  expect(select).toHaveBeenCalledTimes(1)
  expect(mockSettings.theme).toBe('dark')
})

it('ignores late and captured apply handlers after its page has unmounted', async () => {
  const transition = deferred<boolean>()
  select.mockImplementationOnce(async (selection, _event, canCommit) => {
    await transition.promise
    if (!canCommit?.()) return false
    Object.assign(mockSettings, selection); return true
  })
  const hook = await setup()
  await act(() => hook.result.current.edit({ themeId: 'monet' }))
  const captured = hook.result.current.apply
  let operation!: Promise<boolean>
  await act(() => { operation = captured() })
  await hook.unmount()
  await act(async () => { transition.resolve(true); expect(await operation).toBe(false) })
  expect(await captured()).toBe(false)
  expect(mockFlush).not.toHaveBeenCalled()
  expect(select).toHaveBeenCalledTimes(1)
  expect(mockSettings).toEqual({ theme: 'light', themeId: 'minimal' })
})

it('normalizes only canonical families and accents for the preview', () => {
  expect(appearanceSelection({ theme: 'system', themeId: 'monet', themeAccent: '#abc' })).toEqual({ theme: 'system', themeId: 'monet', themeAccent: '#AABBCC' })
})

it('applies a family choice immediately without committing a pending accent preview', async () => {
  const hook = await setup()
  await act(() => hook.result.current.edit({ themeAccent: '#abc' }))
  await act(async () => { expect(await hook.result.current.choose({ themeId: 'monet' })).toBe(true) })
  expect(mockSettings).toEqual({ theme: 'light', themeId: 'monet' })
  expect(hook.result.current.draft).toEqual({ theme: 'light', themeId: 'monet', themeAccent: '#AABBCC' })
  expect(hook.result.current.dirty).toBe(true)
  expect(hook.result.current.saved).toBe(true)
  expect(mockFlush).toHaveBeenCalledTimes(1)
  await act(async () => { expect(await hook.result.current.apply()).toBe(true) })
  expect(mockSettings.themeAccent).toBe('#AABBCC')
  expect(hook.result.current.dirty).toBe(false)
})

it('keeps an immediate mode choice busy until it is durably saved and retains its press origin', async () => {
  const persistence = deferred<void>()
  mockFlush.mockReturnValueOnce(persistence.promise)
  const event = { nativeEvent: { pageX: 120, pageY: 240 } } as GestureResponderEvent
  const hook = await setup()
  let operation!: Promise<boolean>
  await act(() => { operation = hook.result.current.choose({ theme: 'dark' }, event) })
  expect(mockSettings.theme).toBe('dark')
  expect(select).toHaveBeenCalledWith({ theme: 'dark', themeId: 'minimal', themeAccent: undefined }, event, expect.any(Function))
  expect(hook.result.current.draft.theme).toBe('dark')
  expect(hook.result.current.busy).toBe(true)
  expect(hook.result.current.saved).toBe(false)
  await act(async () => { expect(await hook.result.current.choose({ theme: 'system' })).toBe(false) })
  expect(hook.result.current.draft.theme).toBe('dark')
  await act(async () => { persistence.resolve(); expect(await operation).toBe(true) })
  expect(hook.result.current.saved).toBe(true)
  expect(hook.result.current.busy).toBe(false)
  expect(hook.result.current.dirty).toBe(false)
})

it('retries a failed immediate choice without silently saving an accent draft', async () => {
  mockFlush.mockRejectedValueOnce(new Error('disk unavailable'))
  const hook = await setup()
  await act(() => hook.result.current.edit({ themeAccent: '#abc' }))
  await act(async () => { expect(await hook.result.current.choose({ theme: 'dark' })).toBe(false) })
  expect(mockSettings.theme).toBe('dark')
  expect(mockSettings.themeAccent).toBeUndefined()
  expect(hook.result.current.error).toBe('saveFailed')
  expect(hook.result.current.dirty).toBe(true)
  await act(async () => { expect(await hook.result.current.choose({ theme: 'dark' })).toBe(true) })
  expect(hook.result.current.error).toBeUndefined()
  expect(hook.result.current.draft.themeAccent).toBe('#AABBCC')
  expect(mockSettings.themeAccent).toBeUndefined()
  expect(mockFlush).toHaveBeenCalledTimes(2)
})

it('fences an immediate choice against external changes during its transition', async () => {
  const transition = deferred<boolean>()
  select.mockImplementationOnce(async (selection, _event, canCommit) => {
    await transition.promise
    if (!canCommit?.()) return false
    Object.assign(mockSettings, selection); return true
  })
  const hook = await setup()
  let operation!: Promise<boolean>
  await act(() => { operation = hook.result.current.choose({ themeId: 'monet' }) })
  mockSettings = { theme: 'system', themeId: 'minimal' }
  await act(async () => { transition.resolve(true); expect(await operation).toBe(false) })
  expect(mockSettings).toEqual({ theme: 'system', themeId: 'minimal' })
  expect(hook.result.current.draft.themeId).toBe('monet')
  expect(hook.result.current.error).toBe('conflict')
  expect(mockFlush).not.toHaveBeenCalled()
})

it('does not apply captured immediate choices after the page has unmounted', async () => {
  const hook = await setup()
  const choose = hook.result.current.choose
  await hook.unmount()
  expect(await choose({ theme: 'dark' })).toBe(false)
  expect(select).not.toHaveBeenCalled()
  expect(mockFlush).not.toHaveBeenCalled()
})
