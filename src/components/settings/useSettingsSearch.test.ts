import { act, renderHook } from '@testing-library/react-native'
import { Platform } from 'react-native'
import { createSettingsSearchPersistence } from '@/modules/settings'
import {
  bindSettingsStorePersistence,
  releaseSettingsStorePersistence,
  type SettingsStorePersistence,
} from '@/presentation/features/settings/settingsStorePersistenceCommand'
import { useSettingsSearch } from './useSettingsSearch'

it('protects browser reload while a search save is pending or failed, and removes the guard on unmount', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalOS = Platform.OS
  const browser = new EventTarget()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browser })
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' })
  let reject!: (error: Error) => void
  const writing = new Promise<void>((_resolve, no) => { reject = no })
  const write = jest.fn().mockReturnValueOnce(writing).mockResolvedValue(undefined)
  const persistence: SettingsStorePersistence = {
    settings: { load: async () => null, save: async () => {} },
    providers: { load: async () => null, save: async () => {} },
    search: createSettingsSearchPersistence({ read: async () => null, write }),
  }
  const add = jest.spyOn(browser, 'addEventListener')
  const remove = jest.spyOn(browser, 'removeEventListener')
  bindSettingsStorePersistence(persistence)
  try {
    const { result, unmount } = await renderHook(() => useSettingsSearch())
    const guard = add.mock.calls.find(([name]) => name === 'beforeunload')![1] as (event: BeforeUnloadEvent) => void
    const event = () => ({ preventDefault: jest.fn(), returnValue: undefined } as unknown as BeforeUnloadEvent)
    const clean = event()
    guard(clean)
    expect(clean.preventDefault).not.toHaveBeenCalled()
    await act(async () => result.current.setQuery('memory'))
    const pending = event()
    guard(pending)
    expect(pending.preventDefault).toHaveBeenCalledTimes(1)
    await act(async () => { reject(new Error('write failed')); await writing.catch(() => undefined) })
    const failed = event()
    guard(failed)
    expect(failed.preventDefault).toHaveBeenCalledTimes(1)
    expect(result.current.query).toBe('memory')
    await act(async () => result.current.retry())
    const saved = event()
    guard(saved)
    expect(saved.preventDefault).not.toHaveBeenCalled()
    await unmount()
    expect(remove).toHaveBeenCalledWith('beforeunload', guard)
  } finally {
    releaseSettingsStorePersistence(persistence)
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS })
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    jest.restoreAllMocks()
  }
})

it('restores the same durable search after remount without writing execution settings', async () => {
  let record: unknown = { schema: 'islemind.settings-search.v1', query: 'temperature' }
  const saveSettings = jest.fn()
  const saveProviders = jest.fn()
  const read = jest.fn(async () => record)
  const write = jest.fn(async (next: unknown) => { record = next })
  const persistence: SettingsStorePersistence = {
    settings: { load: async () => null, save: saveSettings },
    providers: { load: async () => null, save: saveProviders },
    search: createSettingsSearchPersistence({ read, write }),
  }
  bindSettingsStorePersistence(persistence)
  try {
    const first = await renderHook(() => useSettingsSearch())
    expect(first.result.current.query).toBe('temperature')
    await act(async () => first.result.current.setQuery('MCP'))
    await first.unmount()
    const second = await renderHook(() => useSettingsSearch())
    expect(second.result.current.query).toBe('MCP')
    expect(read).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith({ schema: 'islemind.settings-search.v1', query: 'MCP' })
    expect(saveSettings).not.toHaveBeenCalled()
    expect(saveProviders).not.toHaveBeenCalled()
    await second.unmount()
  } finally {
    releaseSettingsStorePersistence(persistence)
  }
})
