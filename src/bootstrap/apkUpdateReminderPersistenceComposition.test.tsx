import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native'
import { Text } from 'react-native'
import { useSettingsStore } from '@/store/settingsStore'
import { IsleDialogProvider } from '@/components/ui/isle'
import { IsleThemeProvider } from '@/components/ui/isle/IsleThemeProvider'
import { GlobalApkUpdatePrompt } from '@/components/updates/GlobalApkUpdatePrompt'
import { createApkUpdateIgnoreState } from '@/modules/settings'
import type { Settings } from '@/types/settingsContracts'
import { CANONICAL_THEME_IDS } from '@/types/settingsContracts'
import type { ApkReleaseInfo, ApkUpdateResult, VersionSnapshot } from '@/platform/native/androidApkUpdates'
import { downloadAndOpenApkInstaller } from '@/platform/native/androidApkUpdates'
import {
  bindSettingsStorePersistence,
  flushPersistedSettings,
  releaseSettingsStorePersistence,
} from '@/presentation/features/settings/settingsStorePersistenceCommand'
import { APPLICATION_DATA_STORAGE_KEYS } from './applicationDataRecords'
import { settingsStorePersistence } from './settingsStorePersistence'

const filename = require('node:path').join(__dirname, '../hooks/useBootstrap.ts')
const { transformTypeScriptModule } = require('../../scripts/node-ts-support')
const hookModule = { exports: {} as typeof import('../hooks/useBootstrap') }
new Function('require', 'module', 'exports', transformTypeScriptModule(
  require('node:fs').readFileSync(filename, 'utf8'), filename,
))((specifier: string) => specifier === './useAppTheme'
  ? require('@/hooks/useAppTheme') : require(specifier), hookModule, hookModule.exports)
const { useBootstrap } = hookModule.exports

const mockLoadChats = jest.fn().mockResolvedValue(undefined)
const mockSetError = jest.fn()
const mockCheck = jest.fn<Promise<ApkUpdateResult>, []>()
let mockSnapshot: VersionSnapshot
let mockRelease: ApkReleaseInfo
let mockAutoCheckDue = true

jest.mock('@/store/chatStore', () => ({
  useChatStore: Object.assign((select: (state: unknown) => unknown) => select({ load: mockLoadChats }), {
    getState: () => ({ setError: mockSetError }),
  }),
}))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/i18n', () => ({ initI18n: jest.fn() }))
jest.mock('@/i18n/service', () => ({
  ...jest.requireActual('@/i18n/service'), st: (key: string) => key,
}))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('@/hooks/useTransparencyPreference', () => ({ useTransparencyPreference: () => false }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }))
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true, default: () => ({ width: 320, height: 640, fontScale: 1.8, scale: 1 }),
}))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('expo-system-ui', () => ({ setBackgroundColorAsync: jest.fn() }))
jest.mock('@/bootstrap/portableImportRecovery', () => ({ recoverInterruptedPortableImport: jest.fn().mockResolvedValue({ status: 'none' }) }))
jest.mock('@/bootstrap/portableDataApplication', () => ({ initializePortableDataApplication: jest.fn() }))
jest.mock('@/bootstrap/conversationReplyStart', () => ({ initializeConversationReplyStart: jest.fn() }))
jest.mock('@/bootstrap/conversationSkills', () => ({ initializeConversationSkills: jest.fn() }))
jest.mock('@/bootstrap/conversationStorePersistence', () => ({ initializeConversationStorePersistence: jest.fn() }))
jest.mock('@/bootstrap/conversationComposerDrafts', () => ({ initializeConversationComposerDraftPersistence: jest.fn() }))
jest.mock('@/bootstrap/settingsStorePersistence', () => ({
  ...jest.requireActual('@/bootstrap/settingsStorePersistence'), initializeSettingsStorePersistence: jest.fn(),
}))
jest.mock('@/bootstrap/conversationAssistantDetachedWorkRegistry', () => ({ cancelAllConversationAssistantDetachedWork: jest.fn() }))
jest.mock('@/presentation/features/conversations/plainChatCommand', () => ({ recoverChatRuns: jest.fn().mockResolvedValue([]) }))
jest.mock('@/bootstrap/conversationRuntime', () => ({ createConversationRuntime: jest.fn() }))
jest.mock('@/bootstrap/taskRuntime', () => ({ recoverInterruptedTasks: jest.fn().mockResolvedValue({ ok: true, value: [] }) }))
jest.mock('@/bootstrap/workflowCheckpointRecovery', () => ({ recoverWorkflowCheckpoints: jest.fn().mockResolvedValue({ completion: 'completed', failedCount: 0 }) }))
jest.mock('@/bootstrap/conversationWorkspaceWritebackRecoveryRuntime', () => ({
  recoverConversationWorkspaceWritebackReceipts: jest.fn().mockResolvedValue({
    status: 'completed', ambiguousReceiptCount: 0, failedReceiptCount: 0,
  }),
}))
jest.mock('@/services/apkInstallCache', () => ({ clearStagedApkDownloads: jest.fn() }))
jest.mock('@/platform/native/androidApkUpdates', () => ({
  getVersionSnapshot: () => mockSnapshot,
  shouldAutoCheckApkUpdate: () => mockAutoCheckDue,
  shouldRecordApkUpdateCheck: (result: ApkUpdateResult) => result.status === 'available' || result.status === 'unavailable',
  checkLatestApkReleaseSilently: () => mockCheck(),
  downloadAndOpenApkInstaller: jest.fn(),
  formatApkSizeBytes: (value: number | undefined) => value === undefined ? 'unknown' : `${value} B`,
}))
jest.mock('@/bootstrap/androidStatusNotification', () => ({
  clearAndroidStatusNotification: jest.fn().mockResolvedValue(undefined),
  updateAndroidStatusNotification: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/platform/native/runtimeLog', () => ({
  readStoredRuntimeLogOptions: async () => ({ enabled: false }),
  appendRuntimeLog: jest.fn(async () => undefined),
}))

const initial = useSettingsStore.getState()
const records = new Map<string, string>()

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}

function savedSettings(patch: Partial<Settings> = {}) {
  return { ...initial.settings, language: 'en', themeId: 'minimal',
    autoUpdateCheckEnabled: true, neverRemindUpdates: false, ...patch }
}

function saveFixture(patch: Partial<Settings> = {}) {
  records.set(APPLICATION_DATA_STORAGE_KEYS.SETTINGS, JSON.stringify(savedSettings(patch)))
}

function persistedSettings(): Settings {
  return JSON.parse(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)!)
}

function Root() {
  const boot = useBootstrap()
  return <IsleThemeProvider><IsleDialogProvider>
    <Text testID="boot-status">{boot.status}</Text>
    {boot.ready ? <GlobalApkUpdatePrompt update={boot.availableApkUpdate} /> : null}
  </IsleDialogProvider></IsleThemeProvider>
}

async function ready() {
  const screen = await render(<Root />)
  await waitFor(() => expect(screen.getByTestId('boot-status').props.children).toBe('ready'))
  return screen
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAutoCheckDue = true
  mockSnapshot = { appVersion: '1.1.2', buildVersion: '127', updateMode: 'apk', hotUpdateMode: 'disabled' }
  mockRelease = {
    version: '1.1.4', versionCode: 129, tagName: 'v1.1.4', name: 'IsleMind 1.1.4',
    htmlUrl: 'https://github.com/domidoremi/IsleMind/releases/tag/v1.1.4',
    apkUrl: 'https://example.test/update.apk', apkName: 'update.apk', publishedAt: null,
    sha256: 'a'.repeat(64), sizeBytes: 100,
    releaseNotesComplete: true,
    releaseNotes: [
      { version: '1.1.4', notes: '- latest' },
      { version: '1.1.2', notes: '- installed' },
      { version: '1.1.3', notes: '- intermediate' },
      { version: '1.1.5', notes: '- future' },
    ],
  }
  mockCheck.mockReset().mockImplementation(async () => ({
    status: 'available', message: 'available', release: mockRelease, currentVersion: { ...mockSnapshot },
  }))
  jest.mocked(downloadAndOpenApkInstaller).mockReset().mockResolvedValue({ status: 'downloaded', message: 'installer opened' })
  useSettingsStore.setState(initial, true)
  records.clear()
  saveFixture()
  records.set(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS, '[]')
  records.set('@islemind/language-source', 'user')
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => records.get(key) ?? null)
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => { records.set(key, value) })
  jest.mocked(AsyncStorage.removeItem).mockImplementation(async key => { records.delete(key) })
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null)
  bindSettingsStorePersistence(settingsStorePersistence)
})

afterEach(async () => {
  await flushPersistedSettings().catch(() => undefined)
  await useSettingsStore.getState().flushProviderPersistence()
  releaseSettingsStorePersistence(settingsStorePersistence)
  useSettingsStore.setState(initial, true)
})

it('does not check or prompt before reminder preferences hydrate; persisted never-remind wins over defaults', async () => {
  const stored = JSON.stringify(savedSettings({ neverRemindUpdates: true }))
  const read = deferred<string | null>()
  jest.mocked(AsyncStorage.getItem).mockImplementation(key => key === APPLICATION_DATA_STORAGE_KEYS.SETTINGS
    ? read.promise : Promise.resolve(records.get(key) ?? null))
  const screen = await render(<Root />)
  expect(screen.getByTestId('boot-status').props.children).toBe('loading')
  expect(mockCheck).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'updates.updateNow' })).toBeNull()
  await act(() => read.resolve(stored))
  await waitFor(() => expect(mockCheck).toHaveBeenCalledTimes(1))
  expect(useSettingsStore.getState().settings.neverRemindUpdates).toBe(true)
  expect(screen.queryByRole('button', { name: 'updates.updateNow' })).toBeNull()
})

it('persists never-remind independently and allows a known target after switching it off', async () => {
  saveFixture({ neverRemindUpdates: true })
  const screen = await ready()
  await waitFor(() => expect(mockCheck).toHaveBeenCalledTimes(1))
  expect(screen.queryByRole('button', { name: 'updates.updateNow' })).toBeNull()
  expect(persistedSettings().neverRemindUpdates).toBe(true)
  await act(async () => {
    useSettingsStore.getState().updateSettings({ neverRemindUpdates: false })
    await flushPersistedSettings()
  })
  await waitFor(() => expect(screen.getByRole('button', { name: 'updates.updateNow' })).toBeTruthy())
  expect(persistedSettings().neverRemindUpdates).toBe(false)
})

it('restores a newly saved never-remind preference after app restart even for a higher target', async () => {
  saveFixture({ autoUpdateCheckEnabled: false })
  const first = await ready()
  await act(async () => {
    useSettingsStore.getState().updateSettings({ neverRemindUpdates: true, autoUpdateCheckEnabled: true })
    await flushPersistedSettings()
  })
  await first.unmount()
  useSettingsStore.setState(initial, true)
  mockRelease = { ...mockRelease, version: '1.1.5', versionCode: 130, tagName: 'v1.1.5' }
  const restarted = await ready()
  await waitFor(() => expect(mockCheck).toHaveBeenCalledTimes(1))
  expect(useSettingsStore.getState().settings.neverRemindUpdates).toBe(true)
  expect(restarted.queryByRole('button', { name: 'updates.updateNow' })).toBeNull()
})

it.each(CANONICAL_THEME_IDS)('keeps %s update actions and merged notes accessible on a narrow, large-font screen', async themeId => {
  saveFixture({ themeId })
  const screen = await ready()
  await waitFor(() => expect(screen.getByRole('button', { name: 'updates.updateNow' })).toBeTruthy())
  expect(screen.getByRole('button', { name: 'updates.ignoreVersion' })).toBeEnabled()
  expect(screen.getByText('- intermediate')).toBeTruthy()
  expect(screen.getByText('- latest')).toBeTruthy()
})

it('shows ordered intermediate notes with exactly the ignore/update actions', async () => {
  const screen = await ready()
  await waitFor(() => expect(screen.getByRole('button', { name: 'updates.ignoreVersion' })).toBeTruthy())
  expect(screen.getByRole('button', { name: 'updates.updateNow' })).toBeTruthy()
  expect(screen.queryByText('- installed')).toBeNull()
  expect(screen.queryByText('- future')).toBeNull()
  expect(screen.getAllByRole('header').map(node => node.props.children).flat()).toEqual(
    expect.arrayContaining(['updates.releaseNotes', '1.1.3', '1.1.4']),
  )
  expect(within(screen.getByTestId('apk-update-release-notes')).getAllByRole('header')
    .map(node => Array.isArray(node.props.children) ? node.props.children.join('') : node.props.children)).toEqual([
    'updates.releaseNotes', 'v1.1.3', 'v1.1.4',
  ])
  expect(screen.getByText('- intermediate')).toBeTruthy()
  expect(screen.getByText('- latest')).toBeTruthy()
  expect(downloadAndOpenApkInstaller).not.toHaveBeenCalled()
})

it('survives restart after ignore and prompts again for a higher target', async () => {
  const first = await ready()
  await waitFor(() => expect(first.getByRole('button', { name: 'updates.ignoreVersion' })).toBeTruthy())
  await fireEvent.press(first.getByRole('button', { name: 'updates.ignoreVersion' }))
  await flushPersistedSettings()
  expect(persistedSettings().ignoredApkUpdate).toEqual(createApkUpdateIgnoreState(mockSnapshot, mockRelease))
  expect(downloadAndOpenApkInstaller).not.toHaveBeenCalled()
  await first.unmount()
  useSettingsStore.setState(initial, true)
  const restarted = await ready()
  await waitFor(() => expect(mockCheck).toHaveBeenCalledTimes(2))
  expect(restarted.queryByRole('button', { name: 'updates.updateNow' })).toBeNull()
  await restarted.unmount()
  useSettingsStore.setState(initial, true)
  mockRelease = { ...mockRelease, version: '1.1.5', versionCode: 130, tagName: 'v1.1.5' }
  const higher = await ready()
  await waitFor(() => expect(higher.getByRole('button', { name: 'updates.updateNow' })).toBeTruthy())
})

it('keeps a target ignore when never-remind is switched on and off', async () => {
  saveFixture({ ignoredApkUpdate: createApkUpdateIgnoreState(mockSnapshot, mockRelease) })
  const screen = await ready()
  await waitFor(() => expect(mockCheck).toHaveBeenCalledTimes(1))
  for (const neverRemindUpdates of [true, false]) {
    await act(async () => {
      useSettingsStore.getState().updateSettings({ neverRemindUpdates })
      await flushPersistedSettings()
    })
    expect(screen.queryByRole('button', { name: 'updates.updateNow' })).toBeNull()
    expect(persistedSettings().ignoredApkUpdate).toEqual(createApkUpdateIgnoreState(mockSnapshot, mockRelease))
  }
})

it('clears stale ignore after a real upgrade and uses the new installed changelog baseline', async () => {
  const ignoredApkUpdate = createApkUpdateIgnoreState(mockSnapshot, mockRelease)
  saveFixture({ ignoredApkUpdate })
  mockSnapshot = { ...mockSnapshot, appVersion: '1.1.4', buildVersion: '129' }
  mockRelease = { ...mockRelease, version: '1.1.5', versionCode: 130, tagName: 'v1.1.5' }
  const screen = await ready()
  await waitFor(() => expect(screen.getByRole('button', { name: 'updates.updateNow' })).toBeTruthy())
  await flushPersistedSettings()
  expect(persistedSettings().ignoredApkUpdate).toBeUndefined()
  expect(screen.queryByText('- intermediate')).toBeNull()
  expect(screen.queryByText('- latest')).toBeNull()
  expect(screen.getByText('- future')).toBeTruthy()
})

it.each(['disabled', 'throttled'] as const)('expires stale ignore even when automatic checks are %s, without changing never-remind', async reason => {
  saveFixture({
    ignoredApkUpdate: createApkUpdateIgnoreState(mockSnapshot, mockRelease),
    neverRemindUpdates: true, autoUpdateCheckEnabled: reason !== 'disabled',
  })
  mockAutoCheckDue = reason !== 'throttled'
  mockSnapshot = { ...mockSnapshot, appVersion: '1.1.4', buildVersion: '129' }
  const screen = await ready()
  await waitFor(() => expect(useSettingsStore.getState().settings.ignoredApkUpdate).toBeUndefined())
  await flushPersistedSettings()
  expect(persistedSettings().ignoredApkUpdate).toBeUndefined()
  expect(persistedSettings().neverRemindUpdates).toBe(true)
  expect(mockCheck).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'updates.updateNow' })).toBeNull()
})

it('starts the existing installer immediately but does not mistake handoff for upgrade success', async () => {
  const olderIgnore = createApkUpdateIgnoreState(mockSnapshot, { version: '1.1.3', versionCode: 128 })
  saveFixture({ ignoredApkUpdate: olderIgnore })
  const screen = await ready()
  await waitFor(() => expect(screen.getByRole('button', { name: 'updates.updateNow' })).toBeTruthy())
  await fireEvent.press(screen.getByRole('button', { name: 'updates.updateNow' }))
  await waitFor(() => expect(downloadAndOpenApkInstaller).toHaveBeenCalledTimes(1))
  expect(downloadAndOpenApkInstaller).toHaveBeenCalledWith(mockRelease, expect.objectContaining({
    signal: expect.anything(), onProgress: expect.any(Function),
  }))
  await waitFor(() => expect(screen.getAllByText('settings.installerOpened').length).toBeGreaterThan(0))
  await flushPersistedSettings()
  expect(persistedSettings().ignoredApkUpdate).toEqual(olderIgnore)
})

it('cancels a displayed reminder without recording an ignore when never-remind is enabled', async () => {
  const screen = await ready()
  await waitFor(() => expect(screen.getByRole('button', { name: 'updates.updateNow' })).toBeTruthy())
  await act(async () => {
    useSettingsStore.getState().updateSettings({ neverRemindUpdates: true })
    await flushPersistedSettings()
  })
  expect(screen.queryByRole('button', { name: 'updates.updateNow' })).toBeNull()
  expect(persistedSettings().ignoredApkUpdate).toBeUndefined()
  expect(downloadAndOpenApkInstaller).not.toHaveBeenCalled()
})

it('does not record an ignore when the app unmounts with an open reminder', async () => {
  const screen = await ready()
  await waitFor(() => expect(screen.getByRole('button', { name: 'updates.updateNow' })).toBeTruthy())
  await screen.unmount()
  await flushPersistedSettings()
  expect(persistedSettings().ignoredApkUpdate).toBeUndefined()
  expect(downloadAndOpenApkInstaller).not.toHaveBeenCalled()
})

it('does not cancel an explicitly chosen update when global reminders are disabled, but offers download cancellation', async () => {
  const pending = deferred<ApkUpdateResult>()
  jest.mocked(downloadAndOpenApkInstaller).mockReturnValueOnce(pending.promise)
  const screen = await ready()
  await waitFor(() => expect(screen.getByRole('button', { name: 'updates.updateNow' })).toBeTruthy())
  await fireEvent.press(screen.getByRole('button', { name: 'updates.updateNow' }))
  await waitFor(() => expect(downloadAndOpenApkInstaller).toHaveBeenCalledTimes(1))
  const options = jest.mocked(downloadAndOpenApkInstaller).mock.calls[0][1]!
  await act(async () => {
    useSettingsStore.getState().updateSettings({ neverRemindUpdates: true })
    await flushPersistedSettings()
    options.onProgress?.({ stage: 'downloading', release: mockRelease, percent: 10, bytesWritten: 10, bytesExpected: 100 })
  })
  expect(options.signal?.aborted).toBe(false)
  await fireEvent.press(screen.getByRole('button', { name: 'updates.cancelDownload' }))
  expect(options.signal?.aborted).toBe(true)
  await act(() => pending.resolve({ status: 'cancelled', message: 'cancelled' }))
  expect(screen.queryByText('settings.installerOpened')).toBeNull()
})

it('warns about partial history without disabling either update action', async () => {
  mockRelease = { ...mockRelease, releaseNotesComplete: false }
  const screen = await ready()
  await waitFor(() => expect(screen.getByText('updates.releaseNotesIncomplete')).toBeTruthy())
  expect(screen.getByRole('button', { name: 'updates.updateNow' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'updates.ignoreVersion' })).toBeEnabled()
  expect(screen.getByText('- intermediate')).toBeTruthy()
})
