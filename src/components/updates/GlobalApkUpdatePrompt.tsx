import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsleDialog } from '@/components/ui/isle'
import { shouldPromptApkUpdate } from '@/modules/settings'
import type { ApkInstallProgress, ApkReleaseInfo, ApkUpdateResult } from '@/platform/native/androidApkUpdates'
import { useSettingsStore } from '@/store/settingsStore'
import { claimAutomaticApkUpdatePrompt, clearAutomaticApkUpdatePromptSession } from '@/presentation/features/settings/apkUpdateInteraction'
import { useApkUpdatePrompt } from './useApkUpdatePrompt'

const AUTO_UPDATE_BANNER_ID = 'apk-update-automatic-progress'
const UPDATE_FEEDBACK_CLEAR_DELAY_MS = 12_000

/** Mounted only after bootstrap hydration; owns the automatic prompt across app routes. */
export function GlobalApkUpdatePrompt({ update }: { update: ApkUpdateResult | null }) {
  const prompt = useApkUpdatePrompt()
  const dialog = useIsleDialog()
  const { t } = useTranslation()
  const autoCheckEnabled = useSettingsStore((state) => state.settings.autoUpdateCheckEnabled !== false)
  const neverRemind = useSettingsStore((state) => state.settings.neverRemindUpdates === true)
  const ignored = useSettingsStore((state) => state.settings.ignoredApkUpdate)
  const latest = useRef({ prompt, dialog, t })
  latest.current = { prompt, dialog, t }
  const mounted = useRef(true)
  const install = useRef<AbortController | null>(null)
  const notificationOwner = useRef<string | null>(null)
  const notificationSequence = useRef(0)
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const release = update?.status === 'available' ? update.release : undefined
  const installed = update?.currentVersion

  function clearFeedback() {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    feedbackTimer.current = null
    latest.current.dialog.dismissBanner(AUTO_UPDATE_BANNER_ID)
    const owner = notificationOwner.current
    notificationOwner.current = null
    if (owner) void import('@/bootstrap/androidStatusNotification')
      .then(({ clearAndroidStatusNotification }) => clearAndroidStatusNotification({ owner }))
      .catch(() => undefined)
  }

  const startInstall = useRef<(target: ApkReleaseInfo) => Promise<void>>(async () => undefined)
  startInstall.current = async (target) => {
    if (install.current || !mounted.current) return
    clearFeedback()
    const controller = new AbortController()
    install.current = controller
    const owner = `apk-update:auto:${Date.now()}:${++notificationSequence.current}`
    notificationOwner.current = owner
    const isCurrent = () => mounted.current && install.current === controller
    try {
      const { downloadAndOpenApkInstaller, formatApkSizeBytes } = await import('@/platform/native/androidApkUpdates')
      if (!isCurrent() || controller.signal.aborted) return
      const result = await downloadAndOpenApkInstaller(target, {
        signal: controller.signal,
        onProgress: (progress: ApkInstallProgress) => {
          if (!isCurrent() || controller.signal.aborted) return
          const { dialog: currentDialog, t: translate } = latest.current
          const title = translate(progress.stage === 'downloading' ? 'settings.apkUpdateProgressDownloading'
            : progress.stage === 'verifying' ? 'settings.apkUpdateProgressVerifying' : 'settings.apkUpdateProgressOpeningInstaller')
          const detail = progress.stage === 'downloading'
            ? `v${target.version} | ${formatApkSizeBytes(progress.bytesWritten)} / ${formatApkSizeBytes(progress.bytesExpected ?? target.sizeBytes)}`
            : `v${target.version} | ${target.apkName}`
          currentDialog.banner({
            id: AUTO_UPDATE_BANNER_ID, title, message: detail, tone: 'amber',
            ...(progress.stage === 'opening-installer' ? {} : {
              actionLabel: translate('updates.cancelDownload'),
              onAction: () => controller.abort(),
            }),
          })
          void import('@/bootstrap/androidStatusNotification').then(({ updateAndroidStatusNotification }) => {
            if (!isCurrent() || controller.signal.aborted || notificationOwner.current !== owner) return
            return updateAndroidStatusNotification({
              state: 'running', title, message: detail, shortText: title,
              deepLink: 'islemind://settings/system/updates',
              progress: progress.percent === undefined ? undefined : progress.percent / 100,
              indeterminate: progress.stage !== 'downloading' || progress.percent === undefined,
              ongoing: true, foregroundService: true, requestPromotedOngoing: true,
            }, { enabled: useSettingsStore.getState().settings.systemStatusNotificationsEnabled === true, owner })
          }).catch(() => undefined)
        },
      })
      if (!isCurrent()) return
      const { dialog: currentDialog, t: translate } = latest.current
      if (result.status === 'cancelled') {
        clearFeedback()
        currentDialog.toast({ title: translate('updates.cancelled'), tone: 'amber' })
        return
      }
      const title = translate(result.status === 'downloaded' ? 'settings.installerOpened'
        : result.status === 'busy' ? 'updates.installInProgress' : 'settings.apkUpdateFailed')
      const tone = result.status === 'downloaded' ? 'mint' : result.status === 'busy' ? 'amber' : 'danger'
      currentDialog.notice({ title, message: result.message, tone })
      currentDialog.banner({ id: AUTO_UPDATE_BANNER_ID, title, message: result.message, tone })
      void import('@/bootstrap/androidStatusNotification').then(({ updateAndroidStatusNotification }) => {
        if (!mounted.current || notificationOwner.current !== owner) return
        return updateAndroidStatusNotification({
          state: tone === 'danger' ? 'error' : 'completed', title, message: result.message, shortText: title,
          deepLink: 'islemind://settings/system/updates', ongoing: false, foregroundService: true,
          indeterminate: false, requestPromotedOngoing: false,
        }, { enabled: useSettingsStore.getState().settings.systemStatusNotificationsEnabled === true, owner })
      }).catch(() => undefined)
      feedbackTimer.current = setTimeout(clearFeedback, UPDATE_FEEDBACK_CLEAR_DELAY_MS)
    } catch {
      if (isCurrent()) {
        clearFeedback()
        latest.current.dialog.notice({ title: latest.current.t('settings.apkUpdateFailed'), tone: 'danger' })
      }
    } finally {
      if (install.current === controller) install.current = null
    }
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      install.current?.abort()
      clearFeedback()
      clearAutomaticApkUpdatePromptSession()
    }
  }, [])

  useEffect(() => {
    if (!autoCheckEnabled || !release || !installed || installed.updateMode !== 'apk'
      || !shouldPromptApkUpdate({ neverRemindUpdates: neverRemind, ignoredApkUpdate: ignored }, installed, release)) return
    const controller = new AbortController()
    const releaseClaim = claimAutomaticApkUpdatePrompt(installed, release, controller)
    if (!releaseClaim) return
    void latest.current.prompt(release, installed, { signal: controller.signal, automatic: true })
      .then((confirmed) => {
        if (confirmed && !controller.signal.aborted && mounted.current) return startInstall.current(release)
      })
      .catch(() => {
        if (!controller.signal.aborted && mounted.current) {
          latest.current.dialog.toast({ title: latest.current.t('settings.apkUpdateFailed'), tone: 'danger' })
        }
      })
      .finally(releaseClaim)
    return () => { controller.abort(); releaseClaim() }
  }, [autoCheckEnabled, ignored, installed, neverRemind, release])

  return null
}
