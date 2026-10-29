import { useEffect, useState } from 'react'
import { Platform } from 'react-native'
import * as Network from 'expo-network'
import { createAppUpdateCheckScheduler } from '@/core/appUpdateCheckScheduler'
import { reconcileApkUpdateIgnoreState } from '@/modules/settings'
import { appUpdateActivity } from '@/presentation/app-shell/appUpdateActivity'
import type { ApkUpdateResult } from '@/platform/native/androidApkUpdates'
import { isGooglePlayDistribution } from '@/platform/native/appDistribution'
import { useSettingsStore } from '@/store/settingsStore'

/** Enabled only after settings hydration and staged-file cleanup, not merely UI readiness. */
export function useScheduledApkUpdateCheck(enabled: boolean): ApkUpdateResult | null {
  const [available, setAvailable] = useState<ApkUpdateResult | null>(null)
  useEffect(() => {
    setAvailable(null)
    if (!enabled || Platform.OS !== 'android' || isGooglePlayDistribution()) return
    let disposed = false
    let online: boolean | undefined
    let networkRevision = 0
    let observedChannel = useSettingsStore.getState().settings.apkUpdateChannel ?? 'stable'
    void import('@/platform/native/androidApkUpdates').then((native) => {
      if (disposed) return
      const store = useSettingsStore.getState()
      if (store.settings.ignoredApkUpdate
        && !reconcileApkUpdateIgnoreState(store.settings.ignoredApkUpdate, native.getVersionSnapshot())) {
        store.updateSettings({ ignoredApkUpdate: undefined })
      }
    }).catch(() => undefined)
    const scheduler = createAppUpdateCheckScheduler({
      readPolicy: () => {
        const settings = useSettingsStore.getState().settings
        const channel = settings.apkUpdateChannel ?? 'stable'
        return {
          enabled: settings.autoUpdateCheckEnabled !== false,
          foreground: appUpdateActivity.getSnapshot().foreground,
          online, channel,
          intervalMs: (settings.apkUpdateCheckIntervalMinutes ?? 1440) * 60_000,
          lastCheckedAt: (settings.lastApkUpdateCheckChannel ?? 'stable') === channel
            ? settings.lastApkUpdateCheckAt : undefined,
        }
      },
      check: async (channel) => {
        const native = await import('@/platform/native/androidApkUpdates')
        const settings = useSettingsStore.getState().settings
        if (disposed || settings.autoUpdateCheckEnabled === false
          || (settings.apkUpdateChannel ?? 'stable') !== channel
          || online !== true || appUpdateActivity.getSnapshot().foreground !== true) return { success: false }
        const result = await native.checkLatestApkReleaseSilently({ channel })
        const store = useSettingsStore.getState()
        if (disposed || (store.settings.apkUpdateChannel ?? 'stable') !== channel
          || store.settings.autoUpdateCheckEnabled === false) return { success: false }
        const success = native.shouldRecordApkUpdateCheck(result)
        if (success) {
          const installed = native.getVersionSnapshot()
          store.updateSettings({
            lastApkUpdateCheckAt: Date.now(), lastApkUpdateCheckChannel: channel,
            ignoredApkUpdate: reconcileApkUpdateIgnoreState(store.settings.ignoredApkUpdate, installed),
          })
          setAvailable(result.status === 'available' ? result : null)
        }
        if (result.status === 'error' && result.reason === 'manifest_invalid') setAvailable(result)
        return { success, retryAfterMs: result.retryAfterMs }
      },
    })
    const publishNetwork = (state: Network.NetworkState) => {
      if (disposed) return
      online = state.isConnected === true && state.isInternetReachable === true
      scheduler.refresh()
    }
    const revision = networkRevision
    void Network.getNetworkStateAsync().then((state) => {
      if (revision === networkRevision) publishNetwork(state)
    }).catch(() => undefined)
    const network = Network.addNetworkStateListener((state) => { networkRevision += 1; publishNetwork(state) })
    const settings = useSettingsStore.subscribe((state) => {
      const channel = state.settings.apkUpdateChannel ?? 'stable'
      if (channel !== observedChannel) { observedChannel = channel; setAvailable(null) }
      scheduler.refresh()
    })
    const activity = appUpdateActivity.subscribe(scheduler.refresh)
    scheduler.refresh()
    return () => { disposed = true; network.remove(); settings(); activity(); scheduler.dispose() }
  }, [enabled])
  return available
}
