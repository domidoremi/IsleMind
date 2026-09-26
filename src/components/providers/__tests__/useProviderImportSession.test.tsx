import { act, renderHook } from '@testing-library/react-native'
import { useProviderImportSession } from '../useProviderImportSession'

const mockParse = jest.fn()
const mockAdd = jest.fn()
const mockFlushProviders = jest.fn()
const mockFlushSettings = jest.fn()
const mockUpdateSettings = jest.fn((patch: object) => Object.assign(mockSettings, patch))
let mockSettings: Record<string, unknown>
jest.mock('@/bootstrap/providerRegistry', () => ({ parseProviderImportText: (...args: unknown[]) => mockParse(...args) }))
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: { getState: () => ({ settings: mockSettings, addProviders: mockAdd, flushProviderPersistence: mockFlushProviders, updateSettings: mockUpdateSettings }) } }))
jest.mock('@/presentation/features/settings/settingsStorePersistenceCommand', () => ({ flushPersistedSettings: () => mockFlushSettings() }))
const prepared = async () => undefined
const progress = () => undefined

beforeEach(() => {
  jest.clearAllMocks()
  mockSettings = { defaultProvider: 'old' }
  mockParse.mockImplementation(() => ({ providers: [{ id: `import-${mockParse.mock.calls.length}`, name: 'Example' }], warnings: [] }))
  mockAdd.mockResolvedValue(undefined)
  mockFlushProviders.mockResolvedValue(undefined)
  mockFlushSettings.mockResolvedValue(undefined)
})

it('does not finish or accept duplicate submissions before durability', async () => {
  let finish!: () => void
  mockFlushProviders.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve }))
  const { result } = await renderHook(useProviderImportSession)
  let save!: ReturnType<typeof result.current.save>
  await act(async () => { save = result.current.save('fixture', prepared, progress) })
  expect(result.current.persistencePending).toBe(true)
  expect(mockFlushSettings).not.toHaveBeenCalled()
  await act(async () => { expect(await result.current.save('fixture', prepared, progress)).toBeNull() })
  expect(mockAdd).toHaveBeenCalledTimes(1)
  await act(async () => { finish(); await save })
  expect(mockFlushSettings).toHaveBeenCalledTimes(1)
  expect(result.current.persistencePending).toBe(false)
})

it.each(['metadata', 'settings'])('retries %s persistence without duplicating or reverting newer configuration', async kind => {
  (kind === 'metadata' ? mockFlushProviders : mockFlushSettings).mockRejectedValueOnce(new Error('disk full'))
  const { result } = await renderHook(useProviderImportSession)
  await act(async () => { await expect(result.current.save('fixture', prepared, progress)).rejects.toThrow('disk full') })
  expect(result.current.persistencePending).toBe(true)
  mockSettings.defaultProvider = 'changed-elsewhere'
  await act(async () => { await result.current.save('fixture', prepared, progress) })
  expect(mockParse).toHaveBeenCalledTimes(1)
  expect(mockAdd).toHaveBeenCalledTimes(1)
  expect(mockSettings.defaultProvider).toBe('changed-elsewhere')
  expect(result.current.persistencePending).toBe(false)
})

it('retains import identities after a pre-commit failure and destroys the attempt on discard', async () => {
  mockAdd.mockRejectedValueOnce(new Error('credential storage unavailable'))
  const { result } = await renderHook(useProviderImportSession)
  await act(async () => { await expect(result.current.save('fixture', prepared, progress)).rejects.toThrow() })
  expect(result.current.persistencePending).toBe(false)
  await act(async () => { await result.current.save('fixture', prepared, progress) })
  expect(mockParse).toHaveBeenCalledTimes(1)
  expect(mockAdd.mock.calls[1][0]).toBe(mockAdd.mock.calls[0][0])
  mockFlushProviders.mockRejectedValueOnce(new Error('disk full'))
  await act(async () => { await expect(result.current.save('fixture', prepared, progress)).rejects.toThrow() })
  await act(async () => { result.current.reset() })
  await act(async () => { await result.current.save('new fixture', prepared, progress) })
  expect(mockParse).toHaveBeenCalledTimes(3)
})
