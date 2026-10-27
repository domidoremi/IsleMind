import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { SavedSettingsField, useSettingsFieldSession } from '@/components/settings/SettingsFieldSession'
import { SettingsEditBoundary, useSettingsLeave } from '@/components/settings/SettingsEditBoundary'
import { SettingsNavigationContent } from '@/components/settings/SettingsNavigationContent'
import { IsleButton, IsleDialogProvider } from '@/components/ui/isle'
import { IsleThemeProvider } from '@/components/ui/isle/IsleThemeProvider'
import { useSettingsStore } from '@/store/settingsStore'
import {
  bindSettingsStorePersistence,
  flushPersistedSettings,
  releaseSettingsStorePersistence,
  type SettingsStorePersistence,
} from '@/presentation/features/settings/settingsStorePersistenceCommand'
import type { AIProvider } from '@/types/providerContracts'
import {
  APPLICATION_DATA_STORAGE_KEYS,
  ApplicationDataRecordPersistenceError,
  loadApplicationDataRecord,
  saveApplicationDataRecord,
} from './applicationDataRecords'
import { settingsStorePersistence } from './settingsStorePersistence'

const mockDispatch = jest.fn()
const mockLeave = jest.fn()
const mockPreventRemove = jest.fn()
const mockPush = jest.fn()
jest.mock('expo-router', () => ({
  useNavigation: () => ({ dispatch: mockDispatch }),
  router: { push: (...args: unknown[]) => mockPush(...args) },
}))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: (...args: unknown[]) => mockPreventRemove(...args) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('@/hooks/useTransparencyPreference', () => ({ useTransparencyPreference: () => false }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true, default: () => ({ width: 360, height: 640, fontScale: 1.6, scale: 1 }),
}))
jest.mock('@/platform/native/runtimeLog', () => ({
  readStoredRuntimeLogOptions: async () => ({ enabled: false }),
  appendRuntimeLog: jest.fn(async () => undefined),
}))

const initial = useSettingsStore.getState()
const records = new Map<string, string>()
const readFailures = new Map<string, Error>()
const writeFailures = new Map<string, Error>()
let activePersistence: SettingsStorePersistence
const themeCases = (['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui'] as const)
  .flatMap(family => (['light', 'dark'] as const).map(mode => [family, mode] as const))
const configuredProvider: AIProvider = {
  id: 'saved-provider', name: 'Saved provider', type: 'openai-compatible', presetId: 'custom-endpoint',
  baseUrl: 'https://fixture.invalid/v1', wireProtocol: 'openai-compatible', apiKey: '', enabled: false,
  models: ['saved-model'], manualModels: ['saved-model'],
  modelAliases: [{ alias: 'saved-alias', model: 'saved-model' }],
}

beforeEach(async () => {
  jest.clearAllMocks()
  records.clear(); readFailures.clear(); writeFailures.clear()
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => {
    if (readFailures.has(key)) throw readFailures.get(key)
    return records.get(key) ?? null
  })
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    if (writeFailures.has(key)) throw writeFailures.get(key)
    records.set(key, value)
  })
  jest.mocked(AsyncStorage.removeItem).mockImplementation(async key => { records.delete(key) })
  jest.mocked(AsyncStorage.multiRemove).mockImplementation(async keys => { for (const key of keys) records.delete(key) })
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null)
  records.set(APPLICATION_DATA_STORAGE_KEYS.SETTINGS, JSON.stringify({
    ...initial.settings, language: 'en', defaultProvider: configuredProvider.id,
    lastPreferredModel: { schema: 'islemind.global-model-preference.v1', providerId: configuredProvider.id, model: 'saved-alias' },
    providerAllowlist: ['legacy-*'], hapticsEnabled: false, memoryEnabled: false,
    knowledgeEnabled: false, mcpEnabled: false, skillsEnabled: false, webSearchEnabled: false,
  }))
  records.set(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS, JSON.stringify([configuredProvider]))
  records.set('@islemind/language-source', 'user')
  activePersistence = settingsStorePersistence
  bindSettingsStorePersistence(activePersistence)
  await useSettingsStore.getState().load()
  await flushPersistedSettings()
  await useSettingsStore.getState().flushProviderPersistence()
})
afterEach(async () => {
  readFailures.clear(); writeFailures.clear()
  await flushPersistedSettings().catch(() => undefined)
  await useSettingsStore.getState().flushProviderPersistence()
  releaseSettingsStorePersistence(activePersistence)
  useSettingsStore.setState(initial, true)
})

function ReferenceEditor() {
  const session = useSettingsFieldSession()
  const saved = useSettingsStore(state => state.settings.providerAllowlist ?? [])
  const leave = useSettingsLeave()
  return <>
    <SavedSettingsField session={session} settingKey="providerAllowlist" label="Allowed providers"
      value={saved.join('\n')} referenceOptions={[{ value: configuredProvider.id, label: configuredProvider.name }]}
      onCommit={value => useSettingsStore.getState().updateSettings({ providerAllowlist: value.split('\n').filter(Boolean) })} />
    <IsleButton label="Leave settings" onPress={() => { void leave(mockLeave) }} />
  </>
}

function editor() {
  return render(<IsleThemeProvider><IsleDialogProvider><SettingsEditBoundary>
    <ReferenceEditor />
  </SettingsEditBoundary></IsleDialogProvider></IsleThemeProvider>)
}

async function chooseProvider(view: Awaited<ReturnType<typeof editor>>) {
  await fireEvent.press(view.getByText('settingsReferences.choose'))
  await fireEvent.press(view.getByText(configuredProvider.name))
}

it.each(themeCases)('composes %s %s real reference Save and remount with serialized storage at small-screen large-font host metrics', async (family, mode) => {
  useSettingsStore.setState(state => ({ settings: { ...state.settings, themeId: family, theme: mode } }))
  const before = records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)
  const view = await editor()
  await chooseProvider(view)
  expect(useSettingsStore.getState().settings.providerAllowlist).toEqual(['legacy-*'])
  expect(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)).toBe(before)
  await fireEvent.press(view.getByRole('button', { name: 'settingsWorkspace.save' }))
  await waitFor(() => expect(view.getByText('settingsWorkspace.saved')).toBeTruthy())
  expect(JSON.parse(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)!)).toMatchObject({
    providerAllowlist: ['legacy-*', configuredProvider.id], defaultProvider: configuredProvider.id,
    lastPreferredModel: { providerId: configuredProvider.id, model: 'saved-alias' },
    mcpEnabled: false, memoryEnabled: false, knowledgeEnabled: false, webSearchEnabled: false,
  })
  await view.unmount()
  useSettingsStore.setState({ settings: initial.settings, providers: [] })
  await useSettingsStore.getState().load()
  const reopened = await editor()
  expect(reopened.getByText(configuredProvider.name)).toBeTruthy()
  expect(reopened.getByText('legacy-* · agents.unresolved')).toBeTruthy()
  expect(reopened.queryByRole('button', { name: 'settingsWorkspace.save' })).toBeNull()
  expect(useSettingsStore.getState().providers[0].modelAliases).toEqual(configuredProvider.modelAliases)
  expect(useSettingsStore.getState().settings).toMatchObject({ themeId: family, theme: mode })
  await reopened.unmount()
})

it('retains a real failed settings write as an unsaved draft and retries serialized current state instead of reporting success', async () => {
  const before = records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)
  writeFailures.set(APPLICATION_DATA_STORAGE_KEYS.SETTINGS, new Error('raw storage secret must not reach the editor'))
  const view = await editor()
  await chooseProvider(view)
  await fireEvent.press(view.getByRole('button', { name: 'settingsWorkspace.save' }))
  await waitFor(() => {
    for (const alert of view.getAllByRole('alert')) expect(alert).toHaveTextContent('settingsWorkspace.saveFailed')
  })
  expect(view.queryByText('settingsWorkspace.saved')).toBeNull()
  expect(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)).toBe(before)
  // A failed disk write does not roll back the existing in-memory store mutation.
  expect(useSettingsStore.getState().settings.providerAllowlist).toEqual(['legacy-*', configuredProvider.id])
  await expect(flushPersistedSettings()).rejects.toMatchObject({
    name: 'ApplicationDataRecordPersistenceError', operation: 'save', storageKey: 'SETTINGS',
  })
  await fireEvent.press(view.getByRole('button', { name: 'Leave settings' }))
  expect(view.getByText('settingsWorkspace.discardTitle')).toBeTruthy()
  await fireEvent.press(view.getByText('settingsWorkspace.keepEditing'))
  expect(mockLeave).not.toHaveBeenCalled()
  for (const alert of view.getAllByRole('alert')) expect(alert).toHaveTextContent('settingsWorkspace.saveFailed')
  writeFailures.clear()
  await fireEvent.press(view.getByRole('button', { name: 'settingsWorkspace.save' }))
  await waitFor(() => expect(view.queryByRole('button', { name: 'settingsWorkspace.save' })).toBeNull())
  expect(JSON.parse(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)!)).toMatchObject({
    providerAllowlist: ['legacy-*', configuredProvider.id], defaultProvider: configuredProvider.id,
  })
  await view.unmount()
  useSettingsStore.setState({ settings: initial.settings, providers: [] })
  await useSettingsStore.getState().load()
  expect(useSettingsStore.getState().settings.providerAllowlist).toEqual(['legacy-*', configuredProvider.id])
})

it('propagates provider metadata storage rejection to the real retry queue without replacing saved model preferences', async () => {
  const before = records.get(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS)
  writeFailures.set(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS, new Error('metadata storage failed'))
  const writes = () => jest.mocked(AsyncStorage.setItem).mock.calls.filter(([key]) => key === APPLICATION_DATA_STORAGE_KEYS.PROVIDERS).length
  const initialWrites = writes()
  useSettingsStore.getState().reorderProviders([configuredProvider.id])
  await expect(useSettingsStore.getState().flushProviderPersistence()).rejects.toMatchObject({
    name: 'ApplicationDataRecordPersistenceError', operation: 'save', storageKey: 'PROVIDERS',
  })
  expect(records.get(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS)).toBe(before)
  expect(writes()).toBe(initialWrites + 1)
  writeFailures.clear()
  await useSettingsStore.getState().flushProviderPersistence()
  expect(writes()).toBe(initialWrites + 2)
  expect(JSON.parse(records.get(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS)!)[0]).toMatchObject({
    id: configuredProvider.id, enabled: false, modelAliases: configuredProvider.modelAliases,
  })
  expect(useSettingsStore.getState().settings.lastPreferredModel?.model).toBe('saved-alias')
})

it('rejects a failed asynchronous preferred-model save with a redacted persistence error', async () => {
  const before = records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)
  writeFailures.set(APPLICATION_DATA_STORAGE_KEYS.SETTINGS, new Error('raw credential-like failure'))
  await expect(useSettingsStore.getState().rememberPreferredModel(configuredProvider.id, 'another-model')).rejects.toEqual(
    new ApplicationDataRecordPersistenceError('save', 'SETTINGS'),
  )
  expect(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)).toBe(before)
  expect(useSettingsStore.getState().settings.lastPreferredModel?.model).toBe('another-model')
  writeFailures.clear()
  await useSettingsStore.getState().rememberPreferredModel(configuredProvider.id, 'another-model')
  expect(JSON.parse(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)!).lastPreferredModel.model).toBe('another-model')
})

it.each([
  ['SETTINGS', 'read-error'],
  ['PROVIDERS', 'read-error'],
  ['SETTINGS', 'invalid-json'],
  ['PROVIDERS', 'invalid-json'],
] as const)('does not replace configured in-memory selections or serialized data after %s %s', async (key, failure) => {
  const saved = useSettingsStore.getState()
  const storageKey = APPLICATION_DATA_STORAGE_KEYS[key]
  if (failure === 'read-error') readFailures.set(storageKey, new Error('unavailable fixture storage'))
  else records.set(storageKey, '{broken-fixture')
  const rawBefore = new Map(records)
  const writesBefore = jest.mocked(AsyncStorage.setItem).mock.calls.length
  await expect(useSettingsStore.getState().load()).rejects.toMatchObject({
    name: 'ApplicationDataRecordPersistenceError', operation: 'load', storageKey: key,
  })
  expect(useSettingsStore.getState().settings).toBe(saved.settings)
  expect(useSettingsStore.getState().providers).toBe(saved.providers)
  expect(records).toEqual(rawBefore)
  expect(jest.mocked(AsyncStorage.setItem).mock.calls).toHaveLength(writesBefore)
  records.set(storageKey, JSON.stringify(key === 'SETTINGS' ? saved.settings : saved.providers))
  readFailures.clear()
  await useSettingsStore.getState().load()
  expect(useSettingsStore.getState().settings.defaultProvider).toBe(configuredProvider.id)
  expect(useSettingsStore.getState().settings.lastPreferredModel?.model).toBe('saved-alias')
})

it('retains the legacy compatibility record API independently of strict management persistence', async () => {
  const before = new Map(records)
  writeFailures.set(APPLICATION_DATA_STORAGE_KEYS.SETTINGS, new Error('compatibility fixture write failed'))
  await expect(saveApplicationDataRecord('SETTINGS', { fontSize: 24 })).resolves.toBeUndefined()
  readFailures.set(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS, new Error('compatibility fixture read failed'))
  await expect(loadApplicationDataRecord('PROVIDERS')).resolves.toBeNull()
  expect(records).toEqual(before)
})

function freshSearchPersistence() {
  // Re-execute the unchanged bootstrap factory without resetting React modules.
  const filename = require('node:path').join(__dirname, 'settingsSearchPersistence.ts')
  const { transformTypeScriptModule } = require('../../scripts/node-ts-support')
  const output = { exports: {} as typeof import('./settingsSearchPersistence') }
  new Function('require', 'module', 'exports', transformTypeScriptModule(
    require('node:fs').readFileSync(filename, 'utf8'), filename,
  ))(require, output, output.exports)
  releaseSettingsStorePersistence(activePersistence)
  activePersistence = { ...settingsStorePersistence, search: output.exports.settingsSearchPersistence }
  bindSettingsStorePersistence(activePersistence)
}

function navigation(category?: 'privacy') {
  return render(<IsleThemeProvider><SettingsNavigationContent category={category} /></IsleThemeProvider>)
}

it.each(themeCases)('round-trips %s %s root and legacy-category search through the actual bootstrap storage adapter without changing execution settings', async (family, mode) => {
  useSettingsStore.setState(state => ({ settings: { ...state.settings, themeId: family, theme: mode } }))
  freshSearchPersistence()
  const settingsBefore = useSettingsStore.getState().settings
  const settingsRawBefore = records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)
  const providersRawBefore = records.get(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS)
  let view = await navigation()
  try {
    await fireEvent.changeText(view.getByLabelText('settings.search'), 'temperature')
    await waitFor(() => expect(view.getByTestId('settings-result-temperature')).toBeTruthy())
    expect(JSON.parse(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS_SEARCH)!)).toEqual({
      schema: 'islemind.settings-search.v1', query: 'temperature',
    })
    await fireEvent.press(view.getByTestId('settings-result-temperature'))
    expect(mockPush).toHaveBeenLastCalledWith({
      pathname: '/settings/preferences',
      params: { section: 'generation-temperature', locate: expect.any(String), returnTo: 'settings' },
    })
    await view.unmount()
    view = await navigation('privacy')
    expect(view.getByLabelText('settings.search').props.value).toBe('temperature')
    await waitFor(() => expect(view.getByTestId('settings-result-temperature')).toBeTruthy())
    await view.unmount()
    freshSearchPersistence()
    view = await navigation()
    await waitFor(() => expect(view.getByLabelText('settings.search').props.value).toBe('temperature'))
    await fireEvent.press(view.getByLabelText('common.clearSearch'))
    await waitFor(() => expect(JSON.parse(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS_SEARCH)!).query).toBe(''))
    await view.unmount()
    freshSearchPersistence()
    view = await navigation('privacy')
    await waitFor(() => expect(activePersistence.search!.getSnapshot().hydrated).toBe(true))
    expect(view.getByLabelText('settings.search').props.value).toBe('')
    expect(view.queryByTestId('settings-result-temperature')).toBeNull()
    expect(useSettingsStore.getState().settings).toBe(settingsBefore)
    expect(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)).toBe(settingsRawBefore)
    expect(records.get(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS)).toBe(providersRawBefore)
  } finally { await view.unmount() }
})

it('keeps failed search storage visible in the actual navigation UI and retries the exact query without overwriting settings or providers', async () => {
  freshSearchPersistence()
  const settingsRawBefore = records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)
  const providersRawBefore = records.get(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS)
  writeFailures.set(APPLICATION_DATA_STORAGE_KEYS.SETTINGS_SEARCH, new Error('search write unavailable'))
  const view = await navigation()
  try {
    await fireEvent.changeText(view.getByLabelText('settings.search'), 'skills')
    await waitFor(() => expect(view.getByRole('alert')).toHaveTextContent('settingsWorkspace.saveFailed'))
    expect(view.getByLabelText('settings.search').props.value).toBe('skills')
    expect(records.has(APPLICATION_DATA_STORAGE_KEYS.SETTINGS_SEARCH)).toBe(false)
    writeFailures.clear()
    await fireEvent.press(view.getByRole('button', { name: 'common.retry' }))
    await waitFor(() => expect(view.queryByRole('alert')).toBeNull())
    expect(JSON.parse(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS_SEARCH)!)).toEqual({
      schema: 'islemind.settings-search.v1', query: 'skills',
    })
    expect(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)).toBe(settingsRawBefore)
    expect(records.get(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS)).toBe(providersRawBefore)
  } finally { await view.unmount() }
})

it('blocks leaving during a real pending serialized settings write and reports success only after that write finishes', async () => {
  let entered!: () => void
  let release!: () => void
  const started = new Promise<void>(yes => { entered = yes })
  const gate = new Promise<void>(yes => { release = yes })
  const before = records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)
  const view = await editor()
  try {
    await chooseProvider(view)
    jest.mocked(AsyncStorage.setItem).mockImplementationOnce(async (key, value) => {
      expect(key).toBe(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)
      entered(); await gate; records.set(key, value)
    })
    await fireEvent.press(view.getByRole('button', { name: 'settingsWorkspace.save' }))
    await started
    expect(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)).toBe(before)
    expect(view.queryByText('settingsWorkspace.saved')).toBeNull()
    await fireEvent.press(view.getByRole('button', { name: 'Leave settings' }))
    expect(view.queryByText('settingsWorkspace.discardTitle')).toBeNull()
    expect(mockLeave).not.toHaveBeenCalled()
    await act(async () => { release(); await flushPersistedSettings() })
    await waitFor(() => expect(view.getByText('settingsWorkspace.saved')).toBeTruthy())
    expect(JSON.parse(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)!).providerAllowlist).toEqual(['legacy-*', configuredProvider.id])
  } finally { release(); await view.unmount() }
})
