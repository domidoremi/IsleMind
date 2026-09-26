import { useSettingsStore } from './settingsStore'
import { bindSettingsStorePersistence, releaseSettingsStorePersistence, type SettingsStorePersistence } from '@/presentation/features/settings/settingsStorePersistenceCommand'
import type { AIProvider } from '@/types/providerContracts'

const originalProviders = useSettingsStore.getState().providers
const provider = (name: string): AIProvider => ({ id: 'fixture', name, type: 'openai', apiKey: '', models: [], enabled: false })
let persistence: SettingsStorePersistence
let save: jest.Mock

beforeEach(() => {
  save = jest.fn().mockResolvedValue(undefined)
  persistence = { settings: { load: async () => null, save: async () => undefined }, providers: { load: async () => [], save } }
  bindSettingsStorePersistence(persistence)
  useSettingsStore.setState({ providers: [provider('Initial')] })
})
afterEach(() => { releaseSettingsStorePersistence(persistence); useSettingsStore.setState({ providers: originalProviders }) })

it('retries a failed metadata write through the existing queue', async () => {
  save.mockRejectedValueOnce(new Error('disk full'))
  useSettingsStore.getState().reorderProviders(['fixture'])
  await expect(useSettingsStore.getState().flushProviderPersistence()).rejects.toThrow('disk full')
  await useSettingsStore.getState().flushProviderPersistence()
  expect(save).toHaveBeenCalledTimes(2)
  expect(save.mock.calls[1][0][0].name).toBe('Initial')
})

it('does not resurrect an older failed snapshot after a newer write', async () => {
  let reject!: (error: Error) => void
  save.mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail }))
  useSettingsStore.getState().reorderProviders(['fixture'])
  await Promise.resolve()
  useSettingsStore.setState({ providers: [provider('Newer')] })
  useSettingsStore.getState().reorderProviders(['fixture'])
  reject(new Error('old write failed'))
  await useSettingsStore.getState().flushProviderPersistence()
  await useSettingsStore.getState().flushProviderPersistence()
  expect(save).toHaveBeenCalledTimes(2)
  expect(save.mock.calls[1][0][0].name).toBe('Newer')
})

it('retries current state when a reload supersedes the failed snapshot', async () => {
  save.mockRejectedValueOnce(new Error('disk full'))
  useSettingsStore.getState().reorderProviders(['fixture'])
  await expect(useSettingsStore.getState().flushProviderPersistence()).rejects.toThrow('disk full')
  useSettingsStore.setState({ providers: [provider('Reloaded')] })
  await useSettingsStore.getState().flushProviderPersistence()
  expect(save.mock.calls[1][0][0].name).toBe('Reloaded')
})
