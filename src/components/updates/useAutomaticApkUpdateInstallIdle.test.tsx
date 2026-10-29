import { act, cleanup, renderHook } from '@testing-library/react-native'
import { appUpdateActivity } from '@/presentation/app-shell/appUpdateActivity'
import { useSettingsStore } from '@/store/settingsStore'
import { APP_UPDATE_QUIET_PERIOD_MS } from '@/core/appUpdateIdle'
import type { ApkInstallOptions, ApkReleaseInfo, ApkUpdateResult, PreparedApkUpdate } from '@/platform/native/androidApkUpdates'
import { apkUpdateDeliverySession } from './apkUpdateDeliverySession'
import { useAutomaticApkUpdateInstall } from './useAutomaticApkUpdateInstall'
import { useAutomaticApkUpdatePreparation } from './useAutomaticApkUpdatePreparation'

const mockPrepare = jest.fn()
const mockOpen = jest.fn()
const mockDiscard = jest.fn()
let mockDialogsPending: boolean | undefined = false
const mockDialogListeners = new Set<() => void>()
const mockDialog = {
  toast: jest.fn(), banner: jest.fn(), dismissBanner: jest.fn(), notice: jest.fn(),
  hasPendingDialogs: () => mockDialogsPending,
  subscribeDialogs: (listener: () => void) => {
    mockDialogListeners.add(listener)
    return () => { mockDialogListeners.delete(listener) }
  },
}
jest.mock('@/components/ui/isle', () => ({ useIsleDialog: () => mockDialog }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }))
jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ({ type: 'WIFI', isConnected: true, isInternetReachable: true })),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}))
jest.mock('@/platform/native/androidApkUpdates', () => ({
  prepareApkRelease: (...args: unknown[]) => mockPrepare(...args),
  openPreparedApkInstaller: (...args: unknown[]) => mockOpen(...args),
  discardPreparedApk: (...args: unknown[]) => mockDiscard(...args),
  formatApkSizeBytes: (size: number) => `${size} B`,
}))

const target: ApkReleaseInfo = {
  version: '1.2.0', versionCode: 12, tagName: 'v1.2.0', name: 'Release',
  htmlUrl: 'https://github.com/domidoremi/IsleMind/releases/tag/v1.2.0',
  apkUrl: 'https://github.com/domidoremi/IsleMind/releases/download/v1.2.0/a.apk',
  apkName: 'a.apk', publishedAt: null, sha256: 'a'.repeat(64), sizeBytes: 100,
}
const prepared: PreparedApkUpdate = Object.freeze({ release: target, localUri: 'file:///cache/a.apk' })
const preparedResult: ApkUpdateResult = { status: 'prepared', message: 'Ready', prepared, release: target }
const initial = useSettingsStore.getState()
const busyScopes = new Set<() => void>()
const port = {
  updateAndroidStatusNotification: jest.fn(async () => undefined),
  clearAndroidStatusNotification: jest.fn(async () => undefined),
} as unknown as Pick<typeof import('@/bootstrap/androidStatusNotification'),
  'updateAndroidStatusNotification' | 'clearAndroidStatusNotification'>
const loadNotifications = async () => port
async function tick(ms = 0) { await act(async () => { await jest.advanceTimersByTimeAsync(ms) }) }
async function approve() {
  let operation!: Promise<boolean>
  await act(() => { operation = apkUpdateDeliverySession.install(target) })
  await tick()
  return { operation }
}
function busy() {
  const release = appUpdateActivity.acquireBlocker('agent-or-editor')
  busyScopes.add(release)
  return () => { release(); busyScopes.delete(release) }
}
async function dialogs(pending: boolean | undefined) {
  await act(() => {
    mockDialogsPending = pending
    for (const listener of mockDialogListeners) listener()
  })
}

beforeEach(() => {
  jest.useFakeTimers()
  jest.clearAllMocks()
  mockDialogsPending = false
  mockDialogListeners.clear()
  mockPrepare.mockReset().mockResolvedValue(preparedResult)
  mockOpen.mockReset().mockImplementation(async (_file, options: ApkInstallOptions) => {
    return options.canOpenInstaller?.() === true
      ? { status: 'downloaded', message: 'Handed off', release: target }
      : preparedResult
  })
  mockDiscard.mockReset().mockResolvedValue(undefined)
  useSettingsStore.setState({ ...initial,
    updateSettings: (patch) => useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, ...patch } }),
    settings: {
    ...initial.settings, autoApkDownloadEnabled: false, proxyMode: 'off', ignoredApkUpdate: undefined,
  } }, true)
  appUpdateActivity.setForeground(true)
  appUpdateActivity.recordActivity()
})
afterEach(async () => {
  await cleanup()
  for (const release of busyScopes) release()
  busyScopes.clear()
  appUpdateActivity.setForeground(false)
  useSettingsStore.setState(initial, true)
  jest.useRealTimers()
})

it('requires the full production five-second quiet period after preparation releases its own blocker', async () => {
  expect(APP_UPDATE_QUIET_PERIOD_MS).toBe(5_000)
  await renderHook(() => useAutomaticApkUpdateInstall(loadNotifications))
  const { operation } = await approve()
  expect(apkUpdateDeliverySession.getSnapshot()).toMatchObject({ stage: 'waiting', approved: true })
  await tick(APP_UPDATE_QUIET_PERIOD_MS - 1)
  expect(mockOpen).not.toHaveBeenCalled()
  await tick(1)
  await operation
  expect(mockOpen).toHaveBeenCalledTimes(1)
})

it('does not count blocked or unknown-foreground time as idle', async () => {
  const release = busy()
  await renderHook(() => useAutomaticApkUpdateInstall(loadNotifications))
  const { operation } = await approve()
  await tick(60_000)
  expect(mockOpen).not.toHaveBeenCalled()
  await act(() => { appUpdateActivity.setForeground(undefined); release() })
  await tick(60_000)
  expect(mockOpen).not.toHaveBeenCalled()
  await act(() => appUpdateActivity.setForeground(true))
  await tick(APP_UPDATE_QUIET_PERIOD_MS - 1)
  expect(mockOpen).not.toHaveBeenCalled()
  await tick(1)
  await operation
  expect(mockOpen).toHaveBeenCalledTimes(1)
})

it('fails closed on unknown dialogs and waits for five seconds after a read-only dialog closes', async () => {
  mockDialogsPending = undefined
  await renderHook(() => useAutomaticApkUpdateInstall(loadNotifications))
  const { operation } = await approve()
  await tick(60_000)
  expect(mockOpen).not.toHaveBeenCalled()
  await dialogs(true)
  await tick(60_000)
  expect(mockOpen).not.toHaveBeenCalled()
  await dialogs(false)
  await tick(APP_UPDATE_QUIET_PERIOD_MS - 1)
  expect(mockOpen).not.toHaveBeenCalled()
  await tick(1)
  await operation
  expect(mockOpen).toHaveBeenCalledTimes(1)
})

it('keeps the approved immutable target when a final live guard defers native handoff', async () => {
  mockOpen.mockImplementationOnce(async (_file, options: ApkInstallOptions) => {
    options.onProgress?.({ stage: 'verifying', release: target })
    appUpdateActivity.recordActivity()
    expect(options.canOpenInstaller?.()).toBe(false)
    return preparedResult
  })
  await renderHook(() => useAutomaticApkUpdateInstall(loadNotifications))
  const { operation } = await approve()
  await tick(APP_UPDATE_QUIET_PERIOD_MS)
  expect(mockOpen).toHaveBeenCalledTimes(1)
  expect(apkUpdateDeliverySession.getSnapshot()).toMatchObject({ stage: 'waiting', target, approved: true })
  await tick(APP_UPDATE_QUIET_PERIOD_MS - 1)
  expect(mockOpen).toHaveBeenCalledTimes(1)
  await tick(1)
  await operation
  expect(mockPrepare).toHaveBeenCalledTimes(1)
  expect(mockOpen).toHaveBeenCalledTimes(2)
})

it('automatic preparation never opens the installer, and disabling its policy cannot revoke later explicit consent', async () => {
  useSettingsStore.getState().updateSettings({ autoApkDownloadEnabled: true })
  await renderHook(() => {
    useAutomaticApkUpdateInstall(loadNotifications)
    useAutomaticApkUpdatePreparation(target, { appVersion: '1.1.0', buildVersion: '11' })
  })
  await tick(60_000)
  expect(mockPrepare).toHaveBeenCalledTimes(1)
  expect(mockOpen).not.toHaveBeenCalled()
  expect(apkUpdateDeliverySession.getSnapshot()).toMatchObject({ stage: 'prepared', approved: false })
  const release = busy()
  const { operation } = await approve()
  await act(() => useSettingsStore.getState().updateSettings({ autoApkDownloadEnabled: false }))
  await tick(60_000)
  expect(mockOpen).not.toHaveBeenCalled()
  expect(apkUpdateDeliverySession.getSnapshot()).toMatchObject({ stage: 'waiting', approved: true })
  await act(release)
  await tick(APP_UPDATE_QUIET_PERIOD_MS)
  await operation
  expect(mockPrepare).toHaveBeenCalledTimes(1)
  expect(mockOpen).toHaveBeenCalledTimes(1)
  expect(mockDiscard).not.toHaveBeenCalled()
})

it('cancels a queued handoff without changing installed or ignore state and rejects late idle callbacks', async () => {
  await renderHook(() => useAutomaticApkUpdateInstall(loadNotifications))
  const { operation } = await approve()
  const settingsBefore = useSettingsStore.getState().settings
  await act(() => apkUpdateDeliverySession.cancel())
  await tick(60_000)
  await operation
  expect(mockOpen).not.toHaveBeenCalled()
  expect(mockDiscard).toHaveBeenCalledWith(prepared)
  expect(useSettingsStore.getState().settings).toBe(settingsBefore)
  expect(apkUpdateDeliverySession.getSnapshot().stage).toBe('idle')
})
