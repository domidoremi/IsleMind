import { useEffect, useRef } from 'react'
import * as Network from 'expo-network'
import { canAutomaticallyPrepareApk } from '@/core/apkAutomaticDownloadPolicy'
import { shouldPromptApkUpdate, type InstalledApkVersion } from '@/modules/settings'
import { appUpdateActivity } from '@/presentation/app-shell/appUpdateActivity'
import { useSettingsStore } from '@/store/settingsStore'
import type { ApkReleaseInfo } from '@/platform/native/androidApkUpdates'
import { apkUpdateDeliverySession } from './apkUpdateDeliverySession'
import { apkUpdateTargetIdentity, freezeApkUpdateTarget } from './apkUpdateTarget'

export function useAutomaticApkUpdatePreparation(release?: ApkReleaseInfo, installed?: InstalledApkVersion) {
  const attempted = useRef<string | undefined>(undefined)
  const wasEnabled = useRef(false)
  const automaticEnabled = useSettingsStore((state) => state.settings.autoApkDownloadEnabled === true)
  const identity = release ? apkUpdateTargetIdentity(release) : undefined
  useEffect(() => {
    if (!automaticEnabled) { wasEnabled.current = false; return }
    if (!release || !installed || !identity) return
    if (!wasEnabled.current) attempted.current = undefined
    wasEnabled.current = true
    let disposed = false
    let network: Network.NetworkState | undefined
    let revision = 0
    const target = freezeApkUpdateTarget(release)
    const attempt = () => {
      if (disposed) return
      const settings = useSettingsStore.getState().settings
      const enabled = settings.autoApkDownloadEnabled === true
      const eligible = canAutomaticallyPrepareApk({
        enabled,
        foreground: appUpdateActivity.getSnapshot().foreground, proxyMode: settings.proxyMode, network,
      }) && shouldPromptApkUpdate({ neverRemindUpdates: false, ignoredApkUpdate: settings.ignoredApkUpdate }, installed, target)
      if (!eligible) {
        const pending = apkUpdateDeliverySession.getSnapshot()
        if (attempted.current === identity && !pending.approved
          && (pending.stage === 'preparing' || pending.stage === 'prepared')) {
          apkUpdateDeliverySession.cancel(true)
          attempted.current = undefined
        }
        return
      }
      if (attempted.current === identity) return
      attempted.current = identity
      void apkUpdateDeliverySession.prepare(target).then((accepted) => {
        if (!disposed && !accepted && attempted.current === identity) attempted.current = undefined
      }).catch(() => undefined)
    }
    const version = revision
    void Network.getNetworkStateAsync().then((state) => {
      if (!disposed && version === revision) { network = state; attempt() }
    }).catch(() => undefined)
    const subscription = Network.addNetworkStateListener((state) => { revision += 1; network = state; attempt() })
    const unsubscribeSettings = useSettingsStore.subscribe(attempt)
    const unsubscribeActivity = appUpdateActivity.subscribe(attempt)
    return () => {
      disposed = true; subscription.remove(); unsubscribeSettings(); unsubscribeActivity()
      if (attempted.current === identity) apkUpdateDeliverySession.cancel(true)
    }
    // Notes can be enriched without replacing the captured artifact or resetting download admission.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [automaticEnabled, identity, installed?.appVersion, installed?.buildVersion])
}
