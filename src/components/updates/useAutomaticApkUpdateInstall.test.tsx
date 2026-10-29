import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ApkInstallOptions, ApkReleaseInfo, ApkUpdateResult } from '@/platform/native/androidApkUpdates'
import { useAutomaticApkUpdateInstall } from './useAutomaticApkUpdateInstall'
import { appUpdateActivity } from '@/presentation/app-shell/appUpdateActivity'
import { useSettingsStore } from '@/store/settingsStore'
import { apkUpdateDeliverySession } from './apkUpdateDeliverySession'
import { openPreparedApkInstaller } from '@/platform/native/androidApkUpdates'

const mockDownload = jest.fn()
const mockDialog = { toast: jest.fn(), banner: jest.fn(), dismissBanner: jest.fn(), notice: jest.fn(),
  hasPendingDialogs: () => false, subscribeDialogs: () => () => undefined }
const mockTranslate = (key: string) => key
jest.mock('@/components/ui/isle', () => ({ useIsleDialog: () => mockDialog }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }))
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }))
jest.mock('@/platform/native/androidApkUpdates', () => ({
  prepareApkRelease: (...args: unknown[]) => mockDownload(...args),
  openPreparedApkInstaller: jest.fn(async () => ({ status: 'downloaded', message: 'Opened' })),
  discardPreparedApk: jest.fn(async () => undefined),
  formatApkSizeBytes: (value: number) => `${value} B`,
}))
jest.mock('@/core/appUpdateIdle', () => ({
  ...jest.requireActual('@/core/appUpdateIdle'), APP_UPDATE_QUIET_PERIOD_MS: 1,
  scheduleIdleAppUpdate: (input: Parameters<typeof import('@/core/appUpdateIdle')['scheduleIdleAppUpdate']>[0]) =>
    jest.requireActual('@/core/appUpdateIdle').scheduleIdleAppUpdate({ ...input, quietPeriodMs: 1 }),
}))

type NotificationPort = Pick<typeof import('@/bootstrap/androidStatusNotification'),
  'updateAndroidStatusNotification' | 'clearAndroidStatusNotification'>
const target: ApkReleaseInfo = {
  version: '1.2.0', versionCode: 12, tagName: 'v1.2.0', name: 'Release',
  htmlUrl: 'https://example.test/release', apkUrl: 'https://example.test/a.apk',
  apkName: 'a.apk', publishedAt: null, sha256: 'a'.repeat(64), sizeBytes: 100,
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes })
  return { promise, resolve }
}
function fixture() {
  const requests: ReturnType<typeof deferred<NotificationPort>>[] = []
  const load = jest.fn(() => {
    const pending = deferred<NotificationPort>()
    requests.push(pending)
    return pending.promise
  })
  const port = {
    updateAndroidStatusNotification: jest.fn().mockResolvedValue(undefined),
    clearAndroidStatusNotification: jest.fn().mockResolvedValue(undefined),
  } as unknown as NotificationPort
  const download = deferred<ApkUpdateResult>()
  mockDownload.mockReturnValue(download.promise)
  return { requests, load, port, download }
}
const initial = useSettingsStore.getState()
beforeEach(() => { jest.clearAllMocks(); appUpdateActivity.setForeground(true) })
afterEach(() => { appUpdateActivity.setForeground(false); useSettingsStore.setState(initial, true) })

it('does not let a delayed progress notification overwrite the terminal notification', async () => {
  const f = fixture()
  const hook = await renderHook(() => useAutomaticApkUpdateInstall(f.load))
  let running: Promise<boolean> | undefined
  await act(() => { running = hook.result.current(target) })
  await waitFor(() => expect(mockDownload).toHaveBeenCalledTimes(1))
  const options: ApkInstallOptions = mockDownload.mock.calls[0][1]
  await act(() => options.onProgress?.({ stage: 'downloading', release: target, percent: 10 }))
  expect(f.requests).toHaveLength(1)
  await act(async () => { f.download.resolve({ status: 'prepared', message: 'Ready',
    prepared: { release: target, localUri: 'file:///cache/a.apk' } }); await running })
  expect(f.requests).toHaveLength(3)
  await act(() => f.requests[2].resolve(f.port))
  expect(f.port.updateAndroidStatusNotification).toHaveBeenCalledWith(expect.objectContaining({ state: 'completed' }), expect.anything())
  await act(() => f.requests[1].resolve(f.port))
  await act(() => f.requests[0].resolve(f.port))
  expect(f.port.updateAndroidStatusNotification).toHaveBeenCalledTimes(1)
  await hook.unmount()
  await act(() => f.requests[3].resolve(f.port))
})

it('suppresses already queued running notifications after explicit download cancellation', async () => {
  const f = fixture()
  const hook = await renderHook(() => useAutomaticApkUpdateInstall(f.load))
  let running: Promise<boolean> | undefined
  await act(() => { running = hook.result.current(target) })
  await waitFor(() => expect(mockDownload).toHaveBeenCalledTimes(1))
  const options: ApkInstallOptions = mockDownload.mock.calls[0][1]
  await act(() => options.onProgress?.({ stage: 'downloading', release: target, percent: 10 }))
  await act(() => mockDialog.banner.mock.calls[0][0].onAction())
  expect(options.signal?.aborted).toBe(true)
  await act(() => f.requests[0].resolve(f.port))
  expect(f.port.updateAndroidStatusNotification).not.toHaveBeenCalled()
  await act(async () => { f.download.resolve({ status: 'cancelled', message: 'Cancelled' }); await running })
  expect(mockDialog.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'updates.cancelled' }))
  await act(() => f.requests[1].resolve(f.port))
  await hook.unmount()
})

it('stops an ongoing transfer notification while an approved target waits for idle', async () => {
  const f = fixture()
  const hook = await renderHook(() => useAutomaticApkUpdateInstall(f.load))
  let running: Promise<boolean> | undefined
  await act(() => { running = hook.result.current(target) })
  await waitFor(() => expect(mockDownload).toHaveBeenCalledTimes(1))
  const busy = appUpdateActivity.acquireBlocker('active-agent')
  const options: ApkInstallOptions = mockDownload.mock.calls[0][1]
  await act(() => options.onProgress?.({ stage: 'downloading', release: target, percent: 10 }))
  await act(() => f.requests[0].resolve(f.port))
  await act(() => f.download.resolve({ status: 'prepared', message: 'Ready',
    prepared: { release: target, localUri: 'file:///cache/a.apk' } }))
  await act(() => f.requests[1].resolve(f.port))
  expect(f.port.updateAndroidStatusNotification).toHaveBeenLastCalledWith(expect.objectContaining({
    title: 'updates.waitingForIdle', ongoing: false, indeterminate: false,
    foregroundService: true, requestPromotedOngoing: false,
  }), expect.anything())
  expect(openPreparedApkInstaller).not.toHaveBeenCalled()
  await act(() => apkUpdateDeliverySession.cancel())
  await act(async () => { await running })
  busy()
  await hook.unmount()
  await act(() => f.requests[2].resolve(f.port))
})

it('keeps integrity failures visible when progress banners are disabled', async () => {
  const f = fixture()
  useSettingsStore.setState({ settings: { ...initial.settings, apkUpdateBannerEnabled: false } })
  const hook = await renderHook(() => useAutomaticApkUpdateInstall(f.load))
  let running: Promise<boolean> | undefined
  await act(() => { running = hook.result.current(target) })
  await waitFor(() => expect(mockDownload).toHaveBeenCalledTimes(1))
  await act(async () => { f.download.resolve({ status: 'error', reason: 'checksum_mismatch', message: 'Invalid bytes' }); await running })
  expect(mockDialog.banner).not.toHaveBeenCalled()
  expect(mockDialog.notice).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger', message: 'Invalid bytes' }))
  expect(openPreparedApkInstaller).not.toHaveBeenCalled()
  await hook.unmount()
  await act(() => { f.requests[0].resolve(f.port); f.requests[1].resolve(f.port) })
})
