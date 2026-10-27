import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import { useSettingsStore } from '@/store/settingsStore'
import { createSettingsPersistence, SettingsPersistenceValidationError } from '@/modules/settings'
import { ProviderMetadataPersistenceValidationError } from '@/modules/providers'
import type { AIProvider } from '@/types/providerContracts'
import {
  bindSettingsStorePersistence,
  flushPersistedSettings,
  releaseSettingsStorePersistence,
} from '@/presentation/features/settings/settingsStorePersistenceCommand'
import { APPLICATION_DATA_STORAGE_KEYS, ApplicationDataRecordPersistenceError } from './applicationDataRecords'
import { settingsStorePersistence } from './settingsStorePersistence'

// Execute the production hook with the existing CommonJS dynamic-import transform.
const filename = require('node:path').join(__dirname, '../hooks/useBootstrap.ts')
const { transformTypeScriptModule } = require('../../scripts/node-ts-support')
const hookModule = { exports: {} as typeof import('../hooks/useBootstrap') }
new Function('require', 'module', 'exports', transformTypeScriptModule(
  require('node:fs').readFileSync(filename, 'utf8'), filename,
))((specifier: string) => specifier === './useAppTheme'
  ? require('@/hooks/useAppTheme') : require(specifier), hookModule, hookModule.exports)
const { useBootstrap } = hookModule.exports

const mockLoadChats = jest.fn(async () => undefined)
const mockSetError = jest.fn()
const mockRunRecovery = jest.fn().mockResolvedValue([])
const mockTaskRecovery = jest.fn().mockResolvedValue({ ok: true, value: [] })
const mockUpdateCheck = jest.fn().mockResolvedValue({ status: 'current' })
jest.mock('@/store/chatStore', () => ({
  useChatStore: Object.assign((select: (state: unknown) => unknown) => select({ load: mockLoadChats }), {
    getState: () => ({ setError: mockSetError }),
  }),
}))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: { surface: '#000' } }) }))
jest.mock('expo-system-ui', () => ({ setBackgroundColorAsync: jest.fn() }))
jest.mock('@/i18n', () => ({ initI18n: jest.fn() }))
jest.mock('@/i18n/service', () => ({
  ...jest.requireActual('@/i18n/service'),
  st: (key: string, values?: { label?: string; message?: string }) =>
    values ? `${key}:${values.label ?? ''}:${values.message ?? ''}` : key,
}))
jest.mock('@/bootstrap/portableImportRecovery', () => ({ recoverInterruptedPortableImport: jest.fn(async () => ({ status: 'none' })) }))
jest.mock('@/bootstrap/portableDataApplication', () => ({ initializePortableDataApplication: jest.fn() }))
jest.mock('@/bootstrap/conversationReplyStart', () => ({ initializeConversationReplyStart: jest.fn() }))
jest.mock('@/bootstrap/conversationSkills', () => ({ initializeConversationSkills: jest.fn() }))
jest.mock('@/bootstrap/conversationStorePersistence', () => ({ initializeConversationStorePersistence: jest.fn() }))
jest.mock('@/bootstrap/conversationComposerDrafts', () => ({ initializeConversationComposerDraftPersistence: jest.fn() }))
jest.mock('@/bootstrap/conversationAssistantDetachedWorkRegistry', () => ({ cancelAllConversationAssistantDetachedWork: jest.fn() }))
jest.mock('@/presentation/features/conversations/plainChatCommand', () => ({ recoverChatRuns: (...args: unknown[]) => mockRunRecovery(...args) }))
jest.mock('@/bootstrap/conversationRuntime', () => ({ createConversationRuntime: jest.fn() }))
jest.mock('@/bootstrap/taskRuntime', () => ({ recoverInterruptedTasks: (...args: unknown[]) => mockTaskRecovery(...args) }))
jest.mock('@/bootstrap/workflowCheckpointRecovery', () => ({
  recoverWorkflowCheckpoints: jest.fn(async () => ({ completion: 'completed', failedCount: 0 })),
}))
jest.mock('@/bootstrap/conversationWorkspaceWritebackRecoveryRuntime', () => ({
  recoverConversationWorkspaceWritebackReceipts: jest.fn(async () => ({
    status: 'completed', ambiguousReceiptCount: 0, failedReceiptCount: 0,
  })),
}))
jest.mock('@/services/apkInstallCache', () => ({ clearStagedApkDownloads: jest.fn() }))
jest.mock('@/platform/native/androidApkUpdates', () => ({
  shouldAutoCheckApkUpdate: () => false,
  checkLatestApkReleaseSilently: (...args: unknown[]) => mockUpdateCheck(...args),
  shouldRecordApkUpdateCheck: () => false,
}))
jest.mock('@/platform/native/runtimeLog', () => ({
  readStoredRuntimeLogOptions: async () => ({ enabled: false }),
  appendRuntimeLog: jest.fn(async () => undefined),
}))

const initial = useSettingsStore.getState()
const records = new Map<string, string>()
const provider: AIProvider = {
  id: 'configured-provider', name: 'Configured provider', type: 'openai-compatible',
  presetId: 'custom-endpoint', detectedPresetId: 'custom-endpoint',
  baseUrl: 'https://fixture.invalid/v1', wireProtocol: 'openai-compatible',
  apiKey: '', enabled: false, models: ['reviewed-upstream'], manualModels: ['reviewed-upstream'],
  modelAliases: [{ alias: 'reviewed-alias', model: 'reviewed-upstream' }],
}
const preference = {
  schema: 'islemind.global-model-preference.v1',
  providerId: provider.id, model: 'reviewed-alias',
}
function persistedSettings(lastPreferredModel: unknown = preference) {
  return {
    ...initial.settings, language: 'en', defaultProvider: provider.id, lastPreferredModel,
    autoUpdateCheckEnabled: false, observabilitySinkApiKeyConfigured: false,
    webSearchEnabled: false, searchProvider: 'off', webSearchMode: 'off',
    providerAllowlist: ['kept-provider-policy'], memoryEnabled: false, knowledgeEnabled: false,
    mcpEnabled: false, skillsEnabled: false, hapticsEnabled: false,
  }
}
function readSettingsRecord() {
  return JSON.parse(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)!)
}
beforeEach(() => {
  jest.clearAllMocks()
  records.clear()
  mockLoadChats.mockResolvedValue(undefined)
  mockRunRecovery.mockResolvedValue([])
  mockTaskRecovery.mockResolvedValue({ ok: true, value: [] })
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => records.get(key) ?? null)
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => { records.set(key, value) })
  jest.mocked(AsyncStorage.removeItem).mockImplementation(async key => { records.delete(key) })
  jest.mocked(AsyncStorage.multiRemove).mockImplementation(async keys => { for (const key of keys) records.delete(key) })
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null)
  useSettingsStore.setState(initial, true)
  records.set(APPLICATION_DATA_STORAGE_KEYS.SETTINGS, JSON.stringify(persistedSettings()))
  records.set(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS, JSON.stringify([provider]))
  records.set('@islemind/language-source', 'user')
  bindSettingsStorePersistence(settingsStorePersistence)
})
afterEach(async () => {
  await flushPersistedSettings().catch(() => undefined)
  await useSettingsStore.getState().flushProviderPersistence()
  releaseSettingsStorePersistence(settingsStorePersistence)
  useSettingsStore.setState(initial, true)
})

it('validates a supported preference without replacing the original record or taking ownership of normalization', async () => {
  const saved = persistedSettings({
    ...preference, providerId: ` ${provider.id} `, model: ' reviewed-alias ',
  })
  const read = jest.fn().mockResolvedValue(saved)
  const write = jest.fn().mockResolvedValue(undefined)
  const persistence = createSettingsPersistence({ read, write })
  await expect(persistence.load()).resolves.toBe(saved)
  expect(saved.lastPreferredModel).toEqual({
    ...preference, providerId: ` ${provider.id} `, model: ' reviewed-alias ',
  })
  expect(read).toHaveBeenCalledTimes(1)
  expect(write).not.toHaveBeenCalled()
})

it('preserves underlying read and save rejection identities outside saved-preference validation', async () => {
  const failure = new Error('isolated record port unavailable')
  const read = jest.fn().mockRejectedValue(failure)
  const write = jest.fn().mockRejectedValue(failure)
  const persistence = createSettingsPersistence({ read, write })
  await expect(persistence.load()).rejects.toBe(failure)
  await expect(persistence.save(initial.settings)).rejects.toBe(failure)
  expect(write).toHaveBeenCalledWith(initial.settings)
})

it('classifies a future saved model preference as required settings validation through the actual JSON bootstrap and store without rewriting it', async () => {
  const saved = persistedSettings({ ...preference, schema: 'islemind.global-model-preference.v2' })
  const raw = JSON.stringify(saved)
  records.set(APPLICATION_DATA_STORAGE_KEYS.SETTINGS, raw)
  const memory = useSettingsStore.getState()
  await expect(useSettingsStore.getState().load()).rejects.toBeInstanceOf(SettingsPersistenceValidationError)
  expect(useSettingsStore.getState()).toBe(memory)
  expect(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)).toBe(raw)
  expect(jest.mocked(AsyncStorage.setItem)).not.toHaveBeenCalled()
})

it('keeps actual bootstrap recovery and admission closed after a future saved model preference rather than admitting initial defaults', async () => {
  const raw = JSON.stringify(persistedSettings({ ...preference, schema: 'islemind.global-model-preference.v2' }))
  records.set(APPLICATION_DATA_STORAGE_KEYS.SETTINGS, raw)
  const hook = await renderHook(() => useBootstrap())
  await waitFor(() => expect(hook.result.current.status).toBe('blocked'))
  expect(hook.result.current.ready).toBe(false)
  expect(hook.result.current.failure?.reference).toBe('BOOT-STARTUP')
  expect(hook.result.current.failure?.message).toContain('bootstrap.settings')
  expect(mockRunRecovery).not.toHaveBeenCalled()
  expect(mockTaskRecovery).not.toHaveBeenCalled()
  expect(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)).toBe(raw)
  expect(useSettingsStore.getState().settings).toBe(initial.settings)
  await hook.unmount()
})

it('retries the real stored model preference after a reviewed record is supported and opens recovery only after hydration finishes', async () => {
  records.set(APPLICATION_DATA_STORAGE_KEYS.SETTINGS, JSON.stringify(
    persistedSettings({ ...preference, schema: 'islemind.global-model-preference.v2' }),
  ))
  const hook = await renderHook(() => useBootstrap())
  await waitFor(() => expect(hook.result.current.status).toBe('blocked'))
  records.set(APPLICATION_DATA_STORAGE_KEYS.SETTINGS, JSON.stringify(persistedSettings()))
  let finishRead!: (value: string) => void
  const pending = new Promise<string>(resolve => { finishRead = resolve })
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key =>
    key === APPLICATION_DATA_STORAGE_KEYS.SETTINGS ? pending : records.get(key) ?? null)
  await act(async () => { hook.result.current.retry(); hook.result.current.retry() })
  await waitFor(() => expect(hook.result.current.status).toBe('loading'))
  expect(mockRunRecovery).not.toHaveBeenCalled()
  await act(async () => { finishRead(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)!) })
  await waitFor(() => expect(hook.result.current.ready).toBe(true))
  expect(useSettingsStore.getState().settings.lastPreferredModel).toEqual(preference)
  expect(useSettingsStore.getState().settings.defaultProvider).toBe(provider.id)
  expect(mockRunRecovery).toHaveBeenCalledTimes(1)
  expect(mockTaskRecovery).toHaveBeenCalledTimes(1)
  expect(mockUpdateCheck).not.toHaveBeenCalled()
  await hook.unmount()
})

it('hydrates the current actual saved model and provider preferences before admitting runtime recovery', async () => {
  const hook = await renderHook(() => useBootstrap())
  await waitFor(() => expect(hook.result.current.ready).toBe(true))
  expect(useSettingsStore.getState().settings).toMatchObject({
    lastPreferredModel: preference, defaultProvider: provider.id,
    providerAllowlist: ['kept-provider-policy'], webSearchEnabled: false,
  })
  expect(readSettingsRecord().lastPreferredModel).toEqual(preference)
  expect(mockRunRecovery).toHaveBeenCalledTimes(1)
  expect(mockTaskRecovery).toHaveBeenCalledTimes(1)
  expect(mockUpdateCheck).not.toHaveBeenCalled()
  await hook.unmount()
})

it('roundtrips an explicitly saved supported model preference through actual JSON storage and store reconstruction without replacing provider policy', async () => {
  await useSettingsStore.getState().load()
  await flushPersistedSettings()
  await useSettingsStore.getState().rememberPreferredModel(provider.id, 'reviewed-upstream')
  const savedPreference = { ...preference, model: 'reviewed-upstream' }
  expect(readSettingsRecord().lastPreferredModel).toEqual(savedPreference)
  useSettingsStore.setState({ settings: initial.settings, providers: [] })
  await useSettingsStore.getState().load()
  expect(useSettingsStore.getState().settings).toMatchObject({
    lastPreferredModel: savedPreference, defaultProvider: provider.id,
    providerAllowlist: ['kept-provider-policy'], webSearchEnabled: false,
  })
  expect(useSettingsStore.getState().providers[0].modelAliases).toEqual(provider.modelAliases)
})

it.each([
  ['SETTINGS', 'read-error'],
  ['PROVIDERS', 'read-error'],
  ['SETTINGS', 'invalid-json'],
  ['PROVIDERS', 'invalid-json'],
] as const)('keeps actual hook admission and recovery closed after the required %s %s crosses the JSON persistence boundary', async (key, failure) => {
  const storageKey = APPLICATION_DATA_STORAGE_KEYS[key]
  if (failure === 'invalid-json') records.set(storageKey, '{broken-fixture')
  else jest.mocked(AsyncStorage.getItem).mockImplementation(async candidate => {
    if (candidate === storageKey) throw new Error('isolated record read unavailable')
    return records.get(candidate) ?? null
  })
  const before = new Map(records)
  const hook = await renderHook(() => useBootstrap())
  await waitFor(() => expect(hook.result.current.status).toBe('blocked'))
  expect(hook.result.current.ready).toBe(false)
  expect(hook.result.current.failure?.reference).toBe('BOOT-STARTUP')
  expect(mockRunRecovery).not.toHaveBeenCalled()
  expect(mockTaskRecovery).not.toHaveBeenCalled()
  expect(useSettingsStore.getState().settings).toBe(initial.settings)
  expect(records).toEqual(before)
  expect(jest.mocked(AsyncStorage.setItem)).not.toHaveBeenCalled()
  await hook.unmount()
})

it('retains the existing nonblocking generic optional-settings policy through actual secure hydration without reclassifying it as saved-preference validation', async () => {
  const before = new Map(records)
  jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(
    new Error('isolated optional secure hydration unavailable'),
  )
  const hook = await renderHook(() => useBootstrap())
  await waitFor(() => expect(hook.result.current.ready).toBe(true))
  expect(hook.result.current.errorCount).toBe(1)
  expect(mockRunRecovery).toHaveBeenCalledTimes(1)
  expect(mockTaskRecovery).toHaveBeenCalledTimes(1)
  expect(records).toEqual(before)
  expect(jest.mocked(AsyncStorage.setItem)).not.toHaveBeenCalled()
  await hook.unmount()
})

it.each([undefined, null])('preserves the existing absent preference behavior for actual saved value %s without inventing a preference', async value => {
  records.set(APPLICATION_DATA_STORAGE_KEYS.SETTINGS, JSON.stringify({
    ...persistedSettings(), lastPreferredModel: value,
  }))
  await useSettingsStore.getState().load()
  expect(useSettingsStore.getState().settings.lastPreferredModel).toBeUndefined()
  expect(useSettingsStore.getState().settings.defaultProvider).toBe(provider.id)
})

it('retains the existing malformed legacy preference normalization without changing configured provider policy', async () => {
  records.set(APPLICATION_DATA_STORAGE_KEYS.SETTINGS, JSON.stringify(persistedSettings({
    ...preference, model: '',
  })))
  await useSettingsStore.getState().load()
  expect(useSettingsStore.getState().settings.lastPreferredModel).toBeUndefined()
  expect(useSettingsStore.getState().settings).toMatchObject({
    defaultProvider: provider.id, providerAllowlist: ['kept-provider-policy'],
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((fulfill, fail) => { resolve = fulfill; reject = fail })
  return { promise, resolve, reject }
}

it.each([
  ['SETTINGS', 'invalid-json'],
  ['SETTINGS', 'future-preference'],
  ['PROVIDERS', 'invalid-json'],
  ['PROVIDERS', 'invalid-metadata'],
] as const)('does not let an early optional secure hydration error hide a later required %s %s failure in actual bootstrap', async (key, failure) => {
  const storageKey = APPLICATION_DATA_STORAGE_KEYS[key]
  const raw = failure === 'invalid-json' ? '{broken-fixture'
    : failure === 'future-preference' ? JSON.stringify(persistedSettings({
      ...preference, schema: 'islemind.global-model-preference.v2',
    })) : JSON.stringify([{ ...provider, wireProtocol: 'unsupported-fixture' }])
  records.set(storageKey, raw)
  const read = deferred<string>()
  jest.mocked(AsyncStorage.getItem).mockImplementation(async candidate =>
    candidate === storageKey ? read.promise : records.get(candidate) ?? null)
  jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('optional secure hydration unavailable'))
  const before = new Map(records)
  const hook = await renderHook(() => useBootstrap())
  try {
    await waitFor(() => expect(jest.mocked(AsyncStorage.getItem)).toHaveBeenCalledWith(storageKey))
    await act(async () => { read.resolve(raw) })
    await waitFor(() => expect(hook.result.current.status).toBe('blocked'))
    expect(hook.result.current.ready).toBe(false)
    expect(hook.result.current.failure?.reference).toBe('BOOT-STARTUP')
    expect(mockRunRecovery).not.toHaveBeenCalled()
    expect(mockTaskRecovery).not.toHaveBeenCalled()
    expect(useSettingsStore.getState().settings).toBe(initial.settings)
    expect(records).toEqual(before)
    expect(jest.mocked(AsyncStorage.setItem)).not.toHaveBeenCalled()
  } finally {
    read.resolve(raw)
    await hook.unmount()
  }
})

it.each(['SETTINGS', 'PROVIDERS'] as const)('retains the typed late %s read failure rather than the first optional error in the actual settings store load', async key => {
  const storageKey = APPLICATION_DATA_STORAGE_KEYS[key]
  const read = deferred<string>()
  jest.mocked(AsyncStorage.getItem).mockImplementation(async candidate =>
    candidate === storageKey ? read.promise : records.get(candidate) ?? null)
  jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('optional secure hydration unavailable'))
  const before = useSettingsStore.getState()
  const observed = before.load().then(() => undefined, error => error)
  await Promise.resolve()
  read.reject(new Error('required record read unavailable'))
  const error = await observed
  expect(error).toEqual(new ApplicationDataRecordPersistenceError('load', key))
  expect(useSettingsStore.getState()).toBe(before)
  expect(jest.mocked(AsyncStorage.setItem)).not.toHaveBeenCalled()
})

it('keeps actual admission closed while required settings are pending even when optional secure hydration has already failed', async () => {
  const read = deferred<string>()
  const raw = records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)!
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key =>
    key === APPLICATION_DATA_STORAGE_KEYS.SETTINGS ? read.promise : records.get(key) ?? null)
  jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('optional secure hydration unavailable'))
  const hook = await renderHook(() => useBootstrap())
  try {
    await waitFor(() => expect(jest.mocked(SecureStore.getItemAsync)).toHaveBeenCalled())
    await act(async () => undefined)
    const admissionBeforeRead = hook.result.current.ready
    const recoveryCallsBeforeRead = mockRunRecovery.mock.calls.length
    await act(async () => { read.resolve(raw) })
    await waitFor(() => expect(hook.result.current.ready).toBe(true))
    expect(admissionBeforeRead).toBe(false)
    expect(recoveryCallsBeforeRead).toBe(0)
    expect(hook.result.current.errorCount).toBe(1)
    expect(mockRunRecovery).toHaveBeenCalledTimes(1)
    expect(mockTaskRecovery).toHaveBeenCalledTimes(1)
    expect(useSettingsStore.getState().settings).toBe(initial.settings)
  } finally {
    read.resolve(raw)
    await hook.unmount()
  }
})

it('keeps a later required provider migration write failure authoritative over an earlier optional secure hydration rejection', async () => {
  const raw = JSON.stringify([{ ...provider, presetId: ['custom', 'openai', 'compatible'].join('-') }])
  records.set(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS, raw)
  const write = deferred<void>()
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    if (key === APPLICATION_DATA_STORAGE_KEYS.PROVIDERS) return write.promise
    records.set(key, value)
  })
  jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('optional secure hydration unavailable'))
  const hook = await renderHook(() => useBootstrap())
  try {
    await waitFor(() => expect(jest.mocked(AsyncStorage.setItem)).toHaveBeenCalledWith(
      APPLICATION_DATA_STORAGE_KEYS.PROVIDERS, expect.any(String),
    ))
    await act(async () => { write.reject(new Error('required migration write unavailable')) })
    await waitFor(() => expect(hook.result.current.status).toBe('blocked'))
    expect(mockRunRecovery).not.toHaveBeenCalled()
    expect(mockTaskRecovery).not.toHaveBeenCalled()
    expect(useSettingsStore.getState().settings).toBe(initial.settings)
    expect(records.get(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS)).toBe(raw)
  } finally {
    write.resolve()
    await hook.unmount()
  }
})

it('does not wait for optional secure hydration to finish before reporting an actual required provider validation failure', async () => {
  records.set(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS, JSON.stringify([
    { ...provider, wireProtocol: 'unsupported-fixture' },
  ]))
  const secure = deferred<string | null>()
  jest.mocked(SecureStore.getItemAsync).mockReturnValueOnce(secure.promise)
  const hook = await renderHook(() => useBootstrap())
  try {
    await waitFor(() => expect(hook.result.current.status).toBe('blocked'))
    expect(hook.result.current.ready).toBe(false)
    expect(mockRunRecovery).not.toHaveBeenCalled()
    expect(mockTaskRecovery).not.toHaveBeenCalled()
    await expect(settingsStorePersistence.providers.load()).rejects
      .toBeInstanceOf(ProviderMetadataPersistenceValidationError)
  } finally {
    await act(async () => { secure.resolve(null) })
    await hook.unmount()
  }
})

it('starts required and optional reads concurrently but admits supported saved configuration only after both succeed', async () => {
  const read = deferred<string>()
  const secure = deferred<string | null>()
  const raw = records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)!
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key =>
    key === APPLICATION_DATA_STORAGE_KEYS.SETTINGS ? read.promise : records.get(key) ?? null)
  jest.mocked(SecureStore.getItemAsync).mockReturnValueOnce(secure.promise)
  const hook = await renderHook(() => useBootstrap())
  try {
    await waitFor(() => expect(jest.mocked(AsyncStorage.getItem))
      .toHaveBeenCalledWith(APPLICATION_DATA_STORAGE_KEYS.SETTINGS))
    await waitFor(() => expect(jest.mocked(SecureStore.getItemAsync)).toHaveBeenCalled())
    expect(hook.result.current.ready).toBe(false)
    await act(async () => { read.resolve(raw) })
    expect(hook.result.current.ready).toBe(false)
    expect(mockRunRecovery).not.toHaveBeenCalled()
    await act(async () => { secure.resolve(null) })
    await waitFor(() => expect(hook.result.current.ready).toBe(true))
    expect(useSettingsStore.getState().settings.lastPreferredModel).toEqual(preference)
    expect(mockRunRecovery).toHaveBeenCalledTimes(1)
    expect(mockTaskRecovery).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => { read.resolve(raw); secure.resolve(null) })
    await hook.unmount()
  }
})

it('retries the blocked combined hydration failure from stored records without reusing the earlier optional failure or inventing a preference', async () => {
  const read = deferred<string>()
  const raw = JSON.stringify(persistedSettings({
    ...preference, schema: 'islemind.global-model-preference.v2',
  }))
  records.set(APPLICATION_DATA_STORAGE_KEYS.SETTINGS, raw)
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key =>
    key === APPLICATION_DATA_STORAGE_KEYS.SETTINGS ? read.promise : records.get(key) ?? null)
  jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('optional secure hydration unavailable'))
  const hook = await renderHook(() => useBootstrap())
  try {
    await act(async () => { read.resolve(raw) })
    await waitFor(() => expect(hook.result.current.status).toBe('blocked'))
    expect(mockRunRecovery).not.toHaveBeenCalled()
    records.set(APPLICATION_DATA_STORAGE_KEYS.SETTINGS, JSON.stringify(persistedSettings()))
    jest.mocked(AsyncStorage.getItem).mockImplementation(async key => records.get(key) ?? null)
    await act(async () => { hook.result.current.retry(); hook.result.current.retry() })
    await waitFor(() => expect(hook.result.current.ready).toBe(true))
    expect(hook.result.current.failure).toBeNull()
    expect(useSettingsStore.getState().settings.lastPreferredModel).toEqual(preference)
    expect(useSettingsStore.getState().settings.defaultProvider).toBe(provider.id)
    expect(mockRunRecovery).toHaveBeenCalledTimes(1)
    expect(mockTaskRecovery).toHaveBeenCalledTimes(1)
    expect(mockUpdateCheck).not.toHaveBeenCalled()
  } finally {
    read.resolve(raw)
    await hook.unmount()
  }
})
