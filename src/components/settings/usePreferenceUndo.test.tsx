import { act, renderHook } from '@testing-library/react-native'
import { usePreferenceUndo } from './usePreferenceUndo'

let mockSettings: Record<string, unknown>
const mockListeners = new Set<(next: any, previous: any) => void>()
const mockUpdate = jest.fn((patch: Record<string, unknown>) => {
  const previous = mockSettings
  mockSettings = { ...mockSettings, ...patch }
  mockListeners.forEach(listener => listener({ settings: mockSettings }, { settings: previous }))
})
const mockFlush = jest.fn()
const mockToast = jest.fn()
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: {
  getState: () => ({ settings: mockSettings, updateSettings: mockUpdate }),
  subscribe: (listener: any) => { mockListeners.add(listener); return () => mockListeners.delete(listener) },
} }))
jest.mock('@/presentation/features/settings/settingsStorePersistenceCommand', () => ({ flushPersistedSettings: () => mockFlush() }))
jest.mock('@/components/ui/isle', () => ({ useIsleDialog: () => ({ toast: mockToast }) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
beforeEach(() => { jest.clearAllMocks(); mockSettings = { hapticsEnabled: true, commandPaletteEnabled: true }; mockFlush.mockResolvedValue(undefined) })

it('exposes undo only after persistence succeeds, and removes it on save failure', async () => {
  let resolve!: () => void
  mockFlush.mockImplementationOnce(() => new Promise<void>(done => { resolve = done }))
  const hook = await renderHook(usePreferenceUndo)
  await act(() => hook.result.current.updateSettings({ hapticsEnabled: false }))
  expect(hook.result.current.canUndo).toBe(false)
  await act(() => resolve())
  expect(hook.result.current.canUndo).toBe(true)
  mockFlush.mockRejectedValueOnce(new Error('storage unavailable'))
  await act(() => hook.result.current.updateSettings({ commandPaletteEnabled: false }))
  expect(hook.result.current.canUndo).toBe(false)
  expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger' }))
})
it('undoes untouched fields only, including protection against an ABA edit', async () => {
  const hook = await renderHook(usePreferenceUndo)
  await act(() => hook.result.current.updateSettings({ hapticsEnabled: false, commandPaletteEnabled: false }))
  await act(() => { mockUpdate({ hapticsEnabled: true }); mockUpdate({ hapticsEnabled: false }) })
  await act(() => hook.result.current.undo())
  expect(mockSettings).toEqual({ hapticsEnabled: false, commandPaletteEnabled: true })
})
it('never offers generic undo for permissions or after unmounting a pending operation', async () => {
  const hook = await renderHook(usePreferenceUndo)
  await act(() => hook.result.current.updateSettings({ mcpEnabled: false }))
  expect(hook.result.current.canUndo).toBe(false)
  expect(mockFlush).not.toHaveBeenCalled()
  await hook.unmount()
  expect(mockListeners.size).toBe(0)
})
