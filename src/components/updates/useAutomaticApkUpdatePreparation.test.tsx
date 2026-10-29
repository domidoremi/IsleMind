import { act, cleanup, renderHook } from '@testing-library/react-native'
import * as Network from 'expo-network'
import { appUpdateActivity } from '@/presentation/app-shell/appUpdateActivity'
import { useSettingsStore } from '@/store/settingsStore'
import type { ApkReleaseInfo } from '@/platform/native/androidApkUpdates'
import { apkUpdateDeliverySession } from './apkUpdateDeliverySession'
import { useAutomaticApkUpdatePreparation } from './useAutomaticApkUpdatePreparation'

let mockNetworkListener: ((network: Network.NetworkState) => void) | undefined
const mockRemoveNetworkListener = jest.fn()
jest.mock('expo-network', () => ({
  NetworkStateType: { WIFI: 'WIFI', CELLULAR: 'CELLULAR' },
  getNetworkStateAsync: jest.fn(),
  addNetworkStateListener: (listener: typeof mockNetworkListener) => {
    mockNetworkListener = listener
    return { remove: mockRemoveNetworkListener }
  },
}))

const wifi: Network.NetworkState = { type: Network.NetworkStateType.WIFI, isConnected: true, isInternetReachable: true }
const target: ApkReleaseInfo = {
  version: '1.2.0', versionCode: 12, tagName: 'v1.2.0', name: 'Release',
  htmlUrl: 'https://github.com/domidoremi/IsleMind/releases/tag/v1.2.0',
  apkUrl: 'https://github.com/domidoremi/IsleMind/releases/download/v1.2.0/a.apk',
  apkName: 'a.apk', publishedAt: null, sha256: 'a'.repeat(64), sizeBytes: 100,
}
const installed = { appVersion: '1.1.0', buildVersion: '11' }
const initial = useSettingsStore.getState()
let binding: ReturnType<typeof apkUpdateDeliverySession.bind>
const start = jest.fn()
const cancel = jest.fn()
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }
async function network(next: Network.NetworkState) { await act(() => mockNetworkListener?.(next)); await flush() }
async function settings(patch: Partial<typeof initial.settings>) {
  await act(() => useSettingsStore.getState().updateSettings(patch))
  await flush()
}

beforeEach(() => {
  jest.clearAllMocks()
  mockNetworkListener = undefined
  useSettingsStore.setState({ ...initial,
    updateSettings: (patch) => useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, ...patch } }),
    settings: {
    ...initial.settings, autoApkDownloadEnabled: false, proxyMode: 'off', ignoredApkUpdate: undefined,
  } }, true)
  appUpdateActivity.setForeground(true)
  jest.mocked(Network.getNetworkStateAsync).mockResolvedValue(wifi)
  start.mockReset().mockImplementation(async (release) => {
    binding.publish({ stage: 'prepared', target: release, approved: false })
    return true
  })
  cancel.mockReset().mockImplementation((automaticOnly) => {
    if (automaticOnly && apkUpdateDeliverySession.getSnapshot().approved) return
    binding.publish({ stage: 'idle', approved: false })
  })
  binding = apkUpdateDeliverySession.bind({ start, cancel })
})
afterEach(async () => {
  await cleanup()
  binding.release()
  appUpdateActivity.setForeground(false)
  useSettingsStore.setState(initial, true)
})

it('is default-off and does not subscribe to network state until explicitly enabled', async () => {
  await renderHook(() => useAutomaticApkUpdatePreparation(target, installed))
  await flush()
  expect(Network.getNetworkStateAsync).not.toHaveBeenCalled()
  expect(start).not.toHaveBeenCalled()
  await settings({ autoApkDownloadEnabled: true })
  expect(start).toHaveBeenCalledTimes(1)
  expect(start).toHaveBeenCalledWith(expect.objectContaining({ apkUrl: target.apkUrl }), true)
  expect(apkUpdateDeliverySession.getSnapshot().approved).toBe(false)
})

it('fails closed on unknown reachability, cellular transport and a configured app proxy', async () => {
  await settings({ autoApkDownloadEnabled: true, proxyMode: 'custom-base-url' })
  jest.mocked(Network.getNetworkStateAsync).mockResolvedValue({ ...wifi, isInternetReachable: undefined })
  await renderHook(() => useAutomaticApkUpdatePreparation(target, installed))
  await flush()
  await settings({ proxyMode: 'off' })
  expect(start).not.toHaveBeenCalled()
  await network({ ...wifi, type: Network.NetworkStateType.CELLULAR })
  expect(start).not.toHaveBeenCalled()
  await network(wifi)
  expect(start).toHaveBeenCalledTimes(1)
})

it('cancels unapproved preparation on policy loss and resumes only after positively qualified recovery', async () => {
  await settings({ autoApkDownloadEnabled: true })
  await renderHook(() => useAutomaticApkUpdatePreparation(target, installed))
  await flush()
  await network({ ...wifi, isInternetReachable: false })
  expect(cancel).toHaveBeenCalledWith(true)
  expect(apkUpdateDeliverySession.getSnapshot().stage).toBe('idle')
  await network({ ...wifi, isInternetReachable: undefined })
  expect(start).toHaveBeenCalledTimes(1)
  await network(wifi)
  expect(start).toHaveBeenCalledTimes(2)
  expect(useSettingsStore.getState().settings.ignoredApkUpdate).toBeUndefined()
})

it('does not revoke an approved target when network or automatic-download settings change', async () => {
  await settings({ autoApkDownloadEnabled: true })
  await renderHook(() => useAutomaticApkUpdatePreparation(target, installed))
  await flush()
  await act(() => binding.publish({ stage: 'waiting', target, approved: true }))
  await network({ ...wifi, type: Network.NetworkStateType.CELLULAR })
  expect(cancel).not.toHaveBeenCalled()
  await settings({ autoApkDownloadEnabled: false })
  expect(apkUpdateDeliverySession.getSnapshot()).toMatchObject({ stage: 'waiting', target, approved: true })
  expect(mockRemoveNetworkListener).toHaveBeenCalledTimes(1)
})

it('fences a delayed initial network result behind a newer listener observation', async () => {
  let resolve!: (state: Network.NetworkState) => void
  jest.mocked(Network.getNetworkStateAsync).mockReturnValue(new Promise((yes) => { resolve = yes }))
  await settings({ autoApkDownloadEnabled: true })
  await renderHook(() => useAutomaticApkUpdatePreparation(target, installed))
  await network(wifi)
  await act(() => resolve({ ...wifi, isConnected: false }))
  expect(start).toHaveBeenCalledTimes(1)
  expect(cancel).not.toHaveBeenCalled()
})

it('keeps a single admission for unchanged artifact identity and does not resume explicit cancellation', async () => {
  await settings({ autoApkDownloadEnabled: true })
  let release = target
  const hook = await renderHook(() => useAutomaticApkUpdatePreparation(release, installed))
  await flush()
  await act(() => apkUpdateDeliverySession.cancel())
  release = { ...target, releaseNotes: [{ version: target.version, notes: 'Enriched' }] }
  await hook.rerender(undefined)
  await network(wifi)
  await act(() => appUpdateActivity.recordActivity())
  expect(start).toHaveBeenCalledTimes(1)
})
