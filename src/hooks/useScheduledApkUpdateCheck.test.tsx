import { act, renderHook } from '@testing-library/react-native'
import { Platform } from 'react-native'
import * as Network from 'expo-network'
import { appUpdateActivity } from '@/presentation/app-shell/appUpdateActivity'
import { useSettingsStore } from '@/store/settingsStore'
import type { ApkUpdateResult } from '@/platform/native/androidApkUpdates'
import { useScheduledApkUpdateCheck } from './useScheduledApkUpdateCheck'

const mockCheck = jest.fn()
let mockNetwork: ((state: Network.NetworkState) => void) | undefined
const mockRemove = jest.fn()
jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  addNetworkStateListener: (listener: typeof mockNetwork) => { mockNetwork = listener; return { remove: mockRemove } },
}))
jest.mock('@/platform/native/appDistribution', () => ({ isGooglePlayDistribution: () => false }))
jest.mock('@/platform/native/androidApkUpdates', () => ({
  checkLatestApkReleaseSilently: (...args: unknown[]) => mockCheck(...args),
  shouldRecordApkUpdateCheck: (result: ApkUpdateResult) => ['available', 'unavailable'].includes(result.status),
  getVersionSnapshot: () => ({ appVersion: '1.1.4', buildVersion: '129' }),
}))
const initial = useSettingsStore.getState()
const originalOS = Platform.OS
const latest: ApkUpdateResult = { status: 'unavailable', message: 'Current' }
async function tick(ms = 0) { await act(async () => { await jest.advanceTimersByTimeAsync(ms) }) }
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(1_000_000_000)
  jest.clearAllMocks()
  Platform.OS = 'android'
  appUpdateActivity.setForeground(true)
  useSettingsStore.setState({ ...initial,
    updateSettings: (updates) => useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, ...updates } }),
    settings: { ...initial.settings,
    autoUpdateCheckEnabled: true, apkUpdateChannel: 'stable', lastApkUpdateCheckAt: undefined,
  } }, true)
  mockCheck.mockReset().mockResolvedValue(latest)
  jest.mocked(Network.getNetworkStateAsync).mockResolvedValue({ isConnected: true, isInternetReachable: true })
})
afterEach(() => {
  Platform.OS = originalOS
  appUpdateActivity.setForeground(false)
  useSettingsStore.setState(initial, true)
  jest.useRealTimers()
})

it('waits for enabled hydration and keeps success timestamps bound to the selected channel', async () => {
  let enabled = false
  const hook = await renderHook(() => useScheduledApkUpdateCheck(enabled))
  await tick()
  expect(mockCheck).not.toHaveBeenCalled()
  enabled = true
  await hook.rerender(undefined); await tick()
  expect(mockCheck).toHaveBeenCalledWith({ channel: 'stable' })
  expect(useSettingsStore.getState().settings).toMatchObject({ lastApkUpdateCheckAt: Date.now(), lastApkUpdateCheckChannel: 'stable' })
  await hook.unmount()
})

it('fails closed on unknown network and resumes once connectivity is positively known', async () => {
  jest.mocked(Network.getNetworkStateAsync).mockResolvedValue({})
  const hook = await renderHook(() => useScheduledApkUpdateCheck(true))
  await tick(60_000)
  expect(mockCheck).not.toHaveBeenCalled()
  await act(() => mockNetwork?.({ isConnected: true, isInternetReachable: true })); await tick()
  expect(mockCheck).toHaveBeenCalledTimes(1)
  await hook.unmount()
})

it('does not publish an old channel response after a switch', async () => {
  let resolve!: (value: ApkUpdateResult) => void
  mockCheck.mockImplementationOnce(() => new Promise((yes) => { resolve = yes }))
  const hook = await renderHook(() => useScheduledApkUpdateCheck(true))
  await tick()
  await act(() => useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, apkUpdateChannel: 'every-release' } }))
  await act(() => resolve({ status: 'available', message: 'Old channel' })); await tick()
  expect(mockCheck.mock.calls.map(([options]) => options.channel)).toEqual(['stable', 'every-release'])
  expect(hook.result.current).toBeNull()
  expect(useSettingsStore.getState().settings.lastApkUpdateCheckChannel).toBe('every-release')
  await hook.unmount()
})

it('removes all subscriptions and ignores late work after disposal', async () => {
  let resolve!: (value: ApkUpdateResult) => void
  mockCheck.mockImplementationOnce(() => new Promise((yes) => { resolve = yes }))
  const hook = await renderHook(() => useScheduledApkUpdateCheck(true))
  await tick(); await hook.unmount()
  resolve(latest); await tick()
  expect(mockRemove).toHaveBeenCalledTimes(1)
  expect(useSettingsStore.getState().settings.lastApkUpdateCheckAt).toBeUndefined()
})
