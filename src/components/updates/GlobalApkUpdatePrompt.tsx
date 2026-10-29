import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsleDialog } from '@/components/ui/isle'
import { shouldPromptApkUpdate } from '@/modules/settings'
import { scheduleIdleAppUpdate } from '@/core/appUpdateIdle'
import { appUpdateActivity } from '@/presentation/app-shell/appUpdateActivity'
import type { ApkUpdateResult } from '@/platform/native/androidApkUpdates'
import { useSettingsStore } from '@/store/settingsStore'
import { claimAutomaticApkUpdatePrompt, clearAutomaticApkUpdatePromptSession } from '@/presentation/features/settings/apkUpdateInteraction'
import { useApkUpdatePrompt } from './useApkUpdatePrompt'
import { apkUpdateTargetIdentity, freezeApkUpdateTarget } from './apkUpdateTarget'
import { useAutomaticApkUpdateInstall } from './useAutomaticApkUpdateInstall'
import { useAutomaticApkUpdatePreparation } from './useAutomaticApkUpdatePreparation'
import { apkUpdateDeliverySession } from './apkUpdateDeliverySession'

/** Mounted only after bootstrap hydration; owns the automatic prompt across app routes. */
export function GlobalApkUpdatePrompt({ update }: { update: ApkUpdateResult | null }) {
  const prompt = useApkUpdatePrompt()
  const dialog = useIsleDialog()
  const { t } = useTranslation()
  const startInstall = useAutomaticApkUpdateInstall()
  const autoCheckEnabled = useSettingsStore((state) => state.settings.autoUpdateCheckEnabled !== false)
  const neverRemind = useSettingsStore((state) => state.settings.neverRemindUpdates === true)
  const ignored = useSettingsStore((state) => state.settings.ignoredApkUpdate)
  const mounted = useRef(true)
  const release = update?.status === 'available' ? update.release : undefined
  const installed = update?.currentVersion
  useAutomaticApkUpdatePreparation(release, installed?.updateMode === 'apk' ? installed : undefined)
  const targetKey = release ? apkUpdateTargetIdentity(release) : undefined
  const ignoredKey = JSON.stringify(ignored)
  const latest = useRef({ prompt, dialog, t, startInstall, release })
  latest.current = { prompt, dialog, t, startInstall, release }

  useEffect(() => {
    if (update?.status === 'error' && update.reason === 'manifest_invalid') {
      dialog.notice({ title: t('settings.apkCheckFailed'), message: update.message, tone: 'danger' })
    }
  }, [dialog, t, update?.status, update?.reason, update?.message])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      clearAutomaticApkUpdatePromptSession()
    }
  }, [])

  useEffect(() => {
    if (!autoCheckEnabled || !release || !installed || installed.updateMode !== 'apk'
      || !shouldPromptApkUpdate({ neverRemindUpdates: neverRemind, ignoredApkUpdate: ignored }, installed, release)) return
    const baseline = Object.freeze({ ...installed })
    let disposed = false
    let approved = false
    let controller: AbortController | undefined
    let releaseClaim: (() => void) | undefined
    let cancelDeadline: (() => void) | undefined
    let dialogBlocker: (() => void) | undefined
    const syncDialogs = () => {
      if (dialog.hasPendingDialogs()) dialogBlocker ??= appUpdateActivity.acquireBlocker('dialog')
      else { dialogBlocker?.(); dialogBlocker = undefined }
    }
    const eligible = () => {
      const settings = useSettingsStore.getState().settings
      const delivery = apkUpdateDeliverySession.getSnapshot()
      return !disposed && settings.autoUpdateCheckEnabled !== false
        && shouldPromptApkUpdate(settings, baseline, release)
        && !dialog.hasPendingDialogs()
        && delivery.stage !== 'waiting' && delivery.stage !== 'validating'
        && delivery.stage !== 'cancelling' && delivery.stage !== 'opening'
    }
    const schedule = () => {
      cancelDeadline?.()
      cancelDeadline = scheduleIdleAppUpdate({
        activity: appUpdateActivity,
        canPrompt: eligible,
        onIdle: () => {
          const candidate = latest.current.release
          if (!candidate || apkUpdateTargetIdentity(candidate) !== targetKey) return false
          const target = freezeApkUpdateTarget(candidate)
          const request = new AbortController()
          const claim = claimAutomaticApkUpdatePrompt(baseline, target, request)
          if (!claim) return false
          controller = request
          releaseClaim = claim
          void latest.current.prompt(target, baseline, {
            signal: request.signal, automatic: true, onApproved: () => { approved = true },
          }).then((consented) => {
            if (consented && mounted.current) return latest.current.startInstall(consented)
          }).catch(() => {
            if (!request.signal.aborted && mounted.current) {
              latest.current.dialog.toast({ title: latest.current.t('settings.apkUpdateFailed'), tone: 'danger' })
            }
          }).finally(() => {
            claim()
            if (controller === request) controller = undefined
            if (!disposed && !approved && request.signal.aborted) schedule()
          })
          return true
        },
      })
    }
    const unsubscribeDialogs = dialog.subscribeDialogs(syncDialogs)
    const unsubscribeForeground = appUpdateActivity.subscribe(() => {
      if (!approved && appUpdateActivity.getSnapshot().foreground !== true) controller?.abort()
    })
    syncDialogs()
    schedule()
    return () => {
      disposed = true
      cancelDeadline?.()
      unsubscribeDialogs(); unsubscribeForeground(); dialogBlocker?.()
      if (!approved) controller?.abort()
      releaseClaim?.()
    }
    // Artifact identity, installed identity, and reminder policy own request replacement.
    // New object instances or additional notes must not reset quiet time or rewrite open consent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCheckEnabled, ignoredKey, installed?.appVersion, installed?.buildVersion, installed?.updateMode, neverRemind, targetKey, dialog])

  return null
}
