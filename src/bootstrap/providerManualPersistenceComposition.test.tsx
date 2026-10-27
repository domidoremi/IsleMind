import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { ProviderSettingsContent } from '@/components/providers/ProviderSettingsContent'
import { IsleDialogProvider } from '@/components/ui/isle'
import { IsleThemeProvider } from '@/components/ui/isle/IsleThemeProvider'
import { useSettingsStore } from '@/store/settingsStore'
import {
  bindSettingsStorePersistence,
  flushPersistedSettings,
  releaseSettingsStorePersistence,
} from '@/presentation/features/settings/settingsStorePersistenceCommand'
import type { AIProvider } from '@/types/providerContracts'
import { APPLICATION_DATA_STORAGE_KEYS } from './applicationDataRecords'
import { settingsStorePersistence } from './settingsStorePersistence'

const mockAvailabilityChange = jest.fn(async (_ids: readonly string[], mutation: () => Promise<unknown>) => mutation())
const mockActivation = jest.fn()
const mockDiscovery = jest.fn()
jest.mock('expo-router', () => ({
  useNavigation: jest.fn(),
  router: { back: jest.fn(), canGoBack: () => true, push: jest.fn() },
}))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }))
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true, default: () => ({ width: 360, height: 640, fontScale: 1.6, scale: 1 }),
}))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('@/hooks/useTransparencyPreference', () => ({ useTransparencyPreference: () => false }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('@/components/settings/SettingsHelp', () => ({ SettingsHelpButton: () => null }))
jest.mock('@/components/providers/useProviderActivationJob', () => ({
  useProviderActivationJob: () => ({
    activationBusy: false, activationJob: null, clearActivationJob: jest.fn(),
    isActivationRunning: false, activateProviders: (...args: unknown[]) => mockActivation(...args),
  }),
}))
jest.mock('@/bootstrap/providerActivationRuntime', () => ({ syncAndTestProvider: (...args: unknown[]) => mockDiscovery(...args) }))
jest.mock('@/bootstrap/providerModelAvailabilityRuntime', () => ({
  withProviderModelAvailabilityChanges: (...args: Parameters<typeof mockAvailabilityChange>) => mockAvailabilityChange(...args),
  providerModelAvailabilityRuntime: { invalidateAll: jest.fn(async () => undefined) },
}))
jest.mock('@/bootstrap/runtimeDiagnostics', () => ({ buildRuntimeDiagnosticsSummary: jest.fn(async () => ({ providerDetails: [] })) }))
jest.mock('@/bootstrap/providerUsageRuntime', () => ({ invalidateProviderUsage: jest.fn() }))
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }))
jest.mock('expo-file-system/legacy', () => ({
  EncodingType: { UTF8: 'utf8' },
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(),
  deleteAsync: jest.fn(async () => undefined),
}))
jest.mock('@/bootstrap/androidStatusNotification', () => ({
  updateAndroidStatusNotification: jest.fn(async () => ({ shown: false })),
  clearAndroidStatusNotification: jest.fn(async () => ({ shown: false })),
}))
jest.mock('@/platform/native/runtimeLog', () => ({
  readStoredRuntimeLogOptions: async () => ({ enabled: false }),
  appendRuntimeLog: jest.fn(async () => undefined),
}))

const initial = useSettingsStore.getState()
const records = new Map<string, string>()
const secureRecords = new Map<string, string>()
const writeFailures = new Map<string, Error>()
const existingProvider: AIProvider = {
  id: 'saved-provider', name: 'Saved provider', type: 'openai-compatible',
  presetId: 'custom-endpoint', detectedPresetId: 'custom-endpoint',
  baseUrl: 'https://saved-fixture.invalid/v1', wireProtocol: 'openai-compatible',
  apiKey: '', enabled: false, models: ['saved-model'], manualModels: ['saved-model'],
  modelAliases: [{ alias: 'saved-alias', model: 'saved-model' }],
}
const credential = 'synthetic-manual-only'
const textEncoderDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'TextEncoder')
const fileDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'File')
beforeAll(() => {
  if (!textEncoderDescriptor) Object.defineProperty(globalThis, 'TextEncoder', {
    configurable: true, value: require('node:util').TextEncoder,
  })
  Object.defineProperty(globalThis, 'File', {
    configurable: true, value: require('node:buffer').File,
  })
})
afterAll(() => {
  if (!textEncoderDescriptor) Reflect.deleteProperty(globalThis, 'TextEncoder')
  if (fileDescriptor) Object.defineProperty(globalThis, 'File', fileDescriptor)
  else Reflect.deleteProperty(globalThis, 'File')
})

beforeEach(async () => {
  jest.clearAllMocks()
  records.clear(); secureRecords.clear(); writeFailures.clear()
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => records.get(key) ?? null)
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    if (writeFailures.has(key)) throw writeFailures.get(key)
    records.set(key, value)
  })
  jest.mocked(AsyncStorage.removeItem).mockImplementation(async key => { records.delete(key) })
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async key => secureRecords.get(key) ?? null)
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { secureRecords.set(key, value) })
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async key => { secureRecords.delete(key) })
  useSettingsStore.setState(initial, true)
  records.set(APPLICATION_DATA_STORAGE_KEYS.SETTINGS, JSON.stringify({
    ...initial.settings, language: 'en', defaultProvider: existingProvider.id,
    lastPreferredModel: { schema: 'islemind.global-model-preference.v1', providerId: existingProvider.id, model: 'saved-alias' },
    webSearchEnabled: false, searchProvider: 'off', webSearchMode: 'off',
    providerAllowlist: [], modelBlocklist: ['kept-model-policy'],
    memoryEnabled: false, knowledgeEnabled: false, mcpEnabled: false,
    skillsEnabled: false, hapticsEnabled: false, systemStatusNotificationsEnabled: false,
  }))
  records.set(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS, JSON.stringify([existingProvider]))
  records.set('@islemind/language-source', 'user')
  bindSettingsStorePersistence(settingsStorePersistence)
  await useSettingsStore.getState().load()
  await flushPersistedSettings()
  await useSettingsStore.getState().flushProviderPersistence()
  jest.mocked(AsyncStorage.setItem).mockClear()
  mockAvailabilityChange.mockClear()
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({ canceled: true, assets: null })
})
afterEach(async () => {
  writeFailures.clear()
  await flushPersistedSettings().catch(() => undefined)
  await useSettingsStore.getState().flushProviderPersistence()
  releaseSettingsStorePersistence(settingsStorePersistence)
  useSettingsStore.setState(initial, true)
  expect(mockActivation).not.toHaveBeenCalled()
  expect(mockDiscovery).not.toHaveBeenCalled()
})

function managementScreen() {
  return render(<IsleThemeProvider><IsleDialogProvider>
    <ProviderSettingsContent embedded autoOpenAdd />
  </IsleDialogProvider></IsleThemeProvider>)
}

async function manualEditor() {
  const screen = await managementScreen()
  await fireEvent.press(screen.getByTestId('provider-manual-entry'))
  await fireEvent.changeText(screen.getByLabelText('providerSettings.baseUrl'), 'https://manual-fixture.invalid/v1')
  await fireEvent.changeText(screen.getByLabelText('providerSettings.tokens'), credential)
  await fireEvent.press(screen.getByRole('button', { name: 'settingsUx.nextModels' }))
  await fireEvent.changeText(screen.getByLabelText('settings.models'), 'manual-model')
  return screen
}

function savedSettings() {
  return JSON.parse(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)!)
}
function savedProviders(): AIProvider[] {
  return JSON.parse(records.get(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS)!)
}

it('composes nonempty manual provider Save and reload through actual form, store, verified credentials and JSON persistence without selecting or probing a model', async () => {
  const screen = await manualEditor()
  expect(useSettingsStore.getState().providers).toHaveLength(1)
  expect(useSettingsStore.getState().providers[0]).toMatchObject(existingProvider)
  expect(secureRecords.size).toBe(0)
  await fireEvent.press(screen.getByRole('button', { name: 'settingsUx.saveChooseModel' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'settingsUx.saveChooseModel' })).toBeNull())
  const imported = savedProviders().find(provider => provider.id !== existingProvider.id)!
  expect(imported).toMatchObject({
    baseUrl: 'https://manual-fixture.invalid/v1', enabled: false, models: ['manual-model'], apiKey: '',
  })
  expect(imported.credentialGroups).toEqual([expect.objectContaining({ apiKey: '', enabled: true })])
  expect(records.get(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS)).not.toContain(credential)
  expect([...secureRecords.values()]).toContain(credential)
  expect(savedSettings()).toMatchObject({
    defaultProvider: existingProvider.id, lastPreferredModel: { providerId: existingProvider.id, model: 'saved-alias' },
    modelBlocklist: ['kept-model-policy'], mcpEnabled: false, memoryEnabled: false,
  })
  await screen.unmount()
  useSettingsStore.setState({ settings: initial.settings, providers: [] })
  await useSettingsStore.getState().load()
  expect(useSettingsStore.getState().providers.map(provider => provider.id).sort())
    .toEqual([existingProvider.id, imported.id].sort())
  await expect(useSettingsStore.getState().hydrateProviderKey(imported.id)).resolves.toMatchObject({
    id: imported.id, apiKey: credential, models: ['manual-model'],
  })
})

it.each(['SETTINGS', 'PROVIDERS'] as const)(
  'retries an actual manual %s write failure with the same provider identity and later settings instead of awaiting an old failure forever',
  async record => {
    const beforeSettings = records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)
    const beforeProviders = records.get(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS)
    const screen = await manualEditor()
    writeFailures.set(APPLICATION_DATA_STORAGE_KEYS[record], new Error('isolated disk failure'))
    await fireEvent.press(screen.getByRole('button', { name: 'settingsUx.saveChooseModel' }))
    await waitFor(() => expect(screen.getByText('settingsWorkspace.saveFailed')).toBeTruthy())
    const imported = useSettingsStore.getState().providers.find(provider => provider.id !== existingProvider.id)!
    expect(imported).toBeTruthy()
    expect(screen.getByRole('button', { name: 'settingsUx.saveChooseModel' })).toBeEnabled()
    expect(screen.getByLabelText('settings.models').props.value).toBe('manual-model')
    expect(records.get(APPLICATION_DATA_STORAGE_KEYS[record]))
      .toBe(record === 'SETTINGS' ? beforeSettings : beforeProviders)
    await act(async () => {
      useSettingsStore.getState().updateSettings({
        defaultProvider: null, themeId: 'material', theme: 'dark',
        modelBlocklist: ['kept-model-policy', 'later-model-policy'],
      })
      if (record === 'SETTINGS') await expect(flushPersistedSettings()).rejects.toMatchObject({
        name: 'ApplicationDataRecordPersistenceError', operation: 'save', storageKey: 'SETTINGS',
      })
      else await flushPersistedSettings()
    })
    writeFailures.clear()
    const attemptsBeforeRetry = jest.mocked(AsyncStorage.setItem).mock.calls
      .filter(([key]) => key === APPLICATION_DATA_STORAGE_KEYS.SETTINGS).length
    await fireEvent.press(screen.getByRole('button', { name: 'settingsUx.saveChooseModel' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'settingsUx.saveChooseModel' })).toBeNull())
    expect(savedProviders().map(provider => provider.id).sort()).toEqual([existingProvider.id, imported.id].sort())
    if (record === 'SETTINGS') expect(jest.mocked(AsyncStorage.setItem).mock.calls
      .filter(([key]) => key === APPLICATION_DATA_STORAGE_KEYS.SETTINGS).length).toBeGreaterThan(attemptsBeforeRetry)
    expect(savedSettings()).toMatchObject({
      defaultProvider: null, themeId: 'material', theme: 'dark',
      modelBlocklist: ['kept-model-policy', 'later-model-policy'],
      lastPreferredModel: { providerId: existingProvider.id, model: 'saved-alias' },
      mcpEnabled: false, memoryEnabled: false, knowledgeEnabled: false, skillsEnabled: false,
    })
    await screen.unmount()
    useSettingsStore.setState({ settings: initial.settings, providers: [] })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().settings).toMatchObject({
      defaultProvider: null, themeId: 'material', modelBlocklist: ['kept-model-policy', 'later-model-policy'],
    })
  },
)

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(settle => { resolve = settle })
  return { promise, resolve }
}

function holdSettingsWrite() {
  const gate = deferred()
  const write = jest.mocked(AsyncStorage.setItem).getMockImplementation()!
  let started = false
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    if (key === APPLICATION_DATA_STORAGE_KEYS.SETTINGS) {
      started = true
      await gate.promise
    }
    await write(key, value)
  })
  return { ...gate, started: () => started }
}

it('keeps the actual manual save pending and single-flight until the required settings write settles without rolling back committed provider metadata', async () => {
  const screen = await manualEditor()
  const gate = holdSettingsWrite()
  try {
    await fireEvent.press(screen.getByTestId('provider-form-submit'))
    await waitFor(() => expect(gate.started()).toBe(true))
    expect(screen.getByTestId('provider-form-submit')).toBeDisabled()
    expect(screen.getByLabelText('settings.models').props.value).toBe('manual-model')
    expect(useSettingsStore.getState().providers).toHaveLength(2)
    expect(savedSettings().defaultProvider).toBe(existingProvider.id)
    const writesBeforeDuplicate = jest.mocked(AsyncStorage.setItem).mock.calls.length
    await fireEvent.press(screen.getByTestId('provider-form-submit'))
    expect(jest.mocked(AsyncStorage.setItem).mock.calls).toHaveLength(writesBeforeDuplicate)
  } finally {
    await act(async () => { gate.resolve(); await flushPersistedSettings() })
  }
  await waitFor(() => expect(screen.queryByTestId('provider-form-submit')).toBeNull())
  expect(savedProviders()).toHaveLength(2)
  await screen.unmount()
})

it('finishes an already committed actual manual retry after unmount without importing a second identity or reporting cancellation as rollback', async () => {
  const screen = await manualEditor()
  writeFailures.set(APPLICATION_DATA_STORAGE_KEYS.SETTINGS, new Error('isolated disk failure'))
  await fireEvent.press(screen.getByTestId('provider-form-submit'))
  await waitFor(() => expect(screen.getByText('settingsWorkspace.saveFailed')).toBeTruthy())
  const importedId = useSettingsStore.getState().providers[0].id
  writeFailures.clear()
  const gate = holdSettingsWrite()
  try {
    await fireEvent.press(screen.getByTestId('provider-form-submit'))
    await waitFor(() => expect(gate.started()).toBe(true))
    await screen.unmount()
  } finally {
    await act(async () => { gate.resolve(); await flushPersistedSettings() })
  }
  await useSettingsStore.getState().flushProviderPersistence()
  expect(savedProviders().map(provider => provider.id).sort()).toEqual([existingProvider.id, importedId].sort())
  expect(savedSettings().defaultProvider).toBe(existingProvider.id)
})

it('keeps repeated actual manual settings failures retryable with one provider identity and redacted feedback until a new settings write succeeds', async () => {
  const screen = await manualEditor()
  const rawError = 'synthetic platform error must stay private'
  writeFailures.set(APPLICATION_DATA_STORAGE_KEYS.SETTINGS, new Error(rawError))
  await fireEvent.press(screen.getByTestId('provider-form-submit'))
  await waitFor(() => expect(screen.getByText('settingsWorkspace.saveFailed')).toBeTruthy())
  const importedId = useSettingsStore.getState().providers[0].id
  const settingsWrites = () => jest.mocked(AsyncStorage.setItem).mock.calls
    .filter(([key]) => key === APPLICATION_DATA_STORAGE_KEYS.SETTINGS).length
  const beforeRetry = settingsWrites()
  await fireEvent.press(screen.getByTestId('provider-form-submit'))
  await waitFor(() => expect(settingsWrites()).toBe(beforeRetry + 1))
  await waitFor(() => expect(screen.getByTestId('provider-form-submit')).toBeEnabled())
  expect(screen.queryByText(rawError)).toBeNull()
  expect(useSettingsStore.getState().providers.map(provider => provider.id).sort()).toEqual([existingProvider.id, importedId].sort())
  writeFailures.clear()
  await fireEvent.press(screen.getByTestId('provider-form-submit'))
  await waitFor(() => expect(screen.queryByTestId('provider-form-submit')).toBeNull())
  await expect(flushPersistedSettings()).resolves.toBeUndefined()
  expect(savedProviders().map(provider => provider.id).sort()).toEqual([existingProvider.id, importedId].sort())
  await screen.unmount()
})

function importText(name = 'Imported provider', baseUrl = 'https://text-fixture.invalid/v1') {
  return JSON.stringify({ name, baseUrl, apiKey: credential, models: ['imported-model'] })
}
async function reviewImport(screen: Awaited<ReturnType<typeof managementScreen>>, input: string) {
  await fireEvent.changeText(screen.getByLabelText('providerSettings.importContent'), input)
  await fireEvent.press(screen.getByRole('button', { name: 'providerSettings.reviewImport' }))
  expect(screen.getByTestId('provider-import-review')).toBeTruthy()
  expect(screen.queryByDisplayValue(new RegExp(credential))).toBeNull()
}

it('composes selected-file bounded reading, local review, explicit import, verified credentials and fresh JSON reload without automatic discovery', async () => {
  const input = importText('Selected file provider')
  const file = new File([input], 'provider.json', { type: 'application/json', lastModified: 0 })
  const readText = jest.spyOn(file, 'text')
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
    canceled: false, assets: [{
      name: file.name, uri: 'file:///host-selected-provider.json', size: file.size,
      lastModified: file.lastModified, file,
    }],
  })
  const screen = await managementScreen()
  const before = records.get(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS)
  await fireEvent.press(screen.getByRole('button', { name: 'settings.chooseFile' }))
  await waitFor(() => expect(screen.getByLabelText('providerSettings.importContent').props.value).toBe(input))
  expect(readText).toHaveBeenCalledTimes(1)
  expect(jest.mocked(FileSystem.readAsStringAsync)).not.toHaveBeenCalled()
  expect(jest.mocked(FileSystem.deleteAsync)).toHaveBeenCalledWith('file:///host-selected-provider.json', { idempotent: true })
  expect(records.get(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS)).toBe(before)
  expect(secureRecords.size).toBe(0)
  await fireEvent.press(screen.getByRole('button', { name: 'providerSettings.reviewImport' }))
  expect(screen.getByTestId('provider-import-review')).toBeTruthy()
  expect(records.get(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS)).toBe(before)
  await fireEvent.press(screen.getByRole('button', { name: 'providerSettings.import' }))
  await waitFor(() => expect(screen.queryByTestId('provider-import-review')).toBeNull())
  const imported = savedProviders().find(provider => provider.id !== existingProvider.id)!
  expect(imported).toMatchObject({ name: 'Selected file provider', models: ['imported-model'], enabled: false, apiKey: '' })
  expect(records.get(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS)).not.toContain(credential)
  expect(savedSettings().defaultProvider).toBe(existingProvider.id)
  await screen.unmount()
  useSettingsStore.setState({ settings: initial.settings, providers: [] })
  await useSettingsStore.getState().load()
  await expect(useSettingsStore.getState().hydrateProviderKey(imported.id)).resolves.toMatchObject({ apiKey: credential })
})

it('keeps actual same-name endpoint duplicates skipped until an explicit Keep Both choice and preserves the selected model on serialized reload', async () => {
  const screen = await managementScreen()
  const before = records.get(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS)
  await reviewImport(screen, importText(existingProvider.name, existingProvider.baseUrl))
  expect(screen.getByRole('button', { name: 'providerSettings.import' })).toBeDisabled()
  expect(records.get(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS)).toBe(before)
  expect(secureRecords.size).toBe(0)
  await fireEvent.press(screen.getByRole('button', { name: 'providerSettings.importKeepBoth' }))
  await fireEvent.press(screen.getByRole('button', { name: 'providerSettings.import' }))
  await waitFor(() => expect(screen.queryByTestId('provider-import-review')).toBeNull())
  const providers = savedProviders()
  expect(providers).toHaveLength(2)
  expect(new Set(providers.map(provider => provider.id)).size).toBe(2)
  expect(savedSettings()).toMatchObject({
    defaultProvider: existingProvider.id, lastPreferredModel: { providerId: existingProvider.id, model: 'saved-alias' },
  })
  await screen.unmount()
  useSettingsStore.setState({ settings: initial.settings, providers: [] })
  await useSettingsStore.getState().load()
  expect(useSettingsStore.getState().providers).toHaveLength(2)
  expect(useSettingsStore.getState().settings.lastPreferredModel).toMatchObject({ providerId: existingProvider.id, model: 'saved-alias' })
})

it.each(['SETTINGS', 'PROVIDERS'] as const)(
  'retains actual reviewed import identity after a %s storage failure and retries current JSON settings without duplicate import or network activation',
  async record => {
    const screen = await managementScreen()
    await reviewImport(screen, importText())
    const before = records.get(APPLICATION_DATA_STORAGE_KEYS[record])
    writeFailures.set(APPLICATION_DATA_STORAGE_KEYS[record], new Error('isolated import disk failure'))
    await fireEvent.press(screen.getByRole('button', { name: 'providerSettings.import' }))
    await waitFor(() => expect(screen.getByText('providerSettings.importFailed')).toBeTruthy())
    const importedId = useSettingsStore.getState().providers.find(provider => provider.id !== existingProvider.id)!.id
    expect(records.get(APPLICATION_DATA_STORAGE_KEYS[record])).toBe(before)
    expect(screen.getByText('providerSettings.importSavePending')).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'dialog.ok' }))
    await act(async () => {
      useSettingsStore.getState().updateSettings({ defaultProvider: null, modelBlocklist: ['later-import-policy'] })
      if (record === 'SETTINGS') await expect(flushPersistedSettings()).rejects.toMatchObject({ storageKey: 'SETTINGS' })
      else await flushPersistedSettings()
    })
    writeFailures.clear()
    await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
    await waitFor(() => expect(screen.queryByTestId('provider-import-review')).toBeNull())
    expect(savedProviders().map(provider => provider.id).sort()).toEqual([existingProvider.id, importedId].sort())
    expect(savedSettings()).toMatchObject({ defaultProvider: null, modelBlocklist: ['later-import-policy'] })
    await screen.unmount()
    useSettingsStore.setState({ settings: initial.settings, providers: [] })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().providers.map(provider => provider.id).sort()).toEqual([existingProvider.id, importedId].sort())
    expect(useSettingsStore.getState().settings).toMatchObject({ defaultProvider: null, modelBlocklist: ['later-import-policy'] })
  },
)
