import { act, renderHook } from '@testing-library/react-native'
import { useProviderActivationJob } from '../useProviderActivationJob'
import type { AIProvider } from '@/types/providerContracts'
import { getProviderPreset } from '@/bootstrap/providerRegistry'

const mockHydrate = jest.fn()
const mockFlushPatches = jest.fn()
const mockSync = jest.fn()
const mockDialog = { toast: jest.fn() }
const mockProvider: AIProvider = { id: 'imported', name: 'Imported', type: getProviderPreset('custom-endpoint').type, apiKey: '', enabled: false, models: [] }
const mockSettingsState = {
  settings: {}, providers: [mockProvider], hydrateProviderKey: mockHydrate,
  updateProvider: jest.fn(), updateProviderPatches: mockFlushPatches,
  updateProviderCredentialGroupHealth: jest.fn(), flushProviderPersistence: jest.fn(), updateSettings: jest.fn(),
}
const mockJobState = { job: null, start: jest.fn(), update: jest.fn(), finish: jest.fn(), clear: jest.fn() }
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/components/ui/isle', () => ({ useIsleDialog: () => mockDialog }))
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: Object.assign(
  (select: (state: typeof mockSettingsState) => unknown) => select(mockSettingsState), { getState: () => mockSettingsState },
) }))
jest.mock('@/store/activationJobStore', () => ({
  useActivationJobStore: Object.assign((select: (state: typeof mockJobState) => unknown) => select(mockJobState), { getState: () => mockJobState }),
  resolveActivationJobProgress: () => 0,
}))
jest.mock('@/bootstrap/providerActivationRuntime', () => ({
  syncAndTestProvider: (...args: unknown[]) => mockSync(...args),
  isProviderActivationReady: () => true,
  summarizeProviderActivation: () => ({ tone: 'mint', message: 'Ready' }),
}))
jest.mock('@/bootstrap/androidStatusNotification', () => ({ clearAndroidStatusNotification: jest.fn(), updateAndroidStatusNotification: jest.fn() }))

it('settles buffered enable mutations before hydration can admit discovery', async () => {
  let finishWrite!: () => void
  let activation: Promise<void> | undefined
  const write = new Promise<void>(resolve => { finishWrite = resolve })
  mockFlushPatches.mockImplementation(async () => { await write })
  mockHydrate.mockResolvedValue({ ...mockProvider, enabled: true })
  mockSync.mockImplementation(async (_provider, ports) => {
    await ports.updateProvider(mockProvider.id, { enabled: true })
    await ports.hydrateProviderKey(mockProvider.id)
    return { providerId: mockProvider.id, providerName: mockProvider.name, synced: true, ready: true, failures: [] }
  })
  jest.useFakeTimers()
  const { result, unmount } = await renderHook(useProviderActivationJob)
  try {
    await act(async () => { activation = result.current.activateProviders([mockProvider.id], 'batch') })
    expect(mockHydrate).not.toHaveBeenCalled()
    expect(mockFlushPatches).toHaveBeenCalledWith([{ id: mockProvider.id, updates: { enabled: true } }], { persist: 'deferred' })
    await act(async () => { finishWrite(); await activation })
    expect(mockHydrate).toHaveBeenCalledWith(mockProvider.id)
  } finally {
    finishWrite()
    await act(async () => { jest.runOnlyPendingTimers(); await activation })
    await unmount()
    jest.clearAllTimers()
    jest.useRealTimers()
  }
})
