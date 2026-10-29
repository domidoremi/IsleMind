import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsleDialog } from '@/components/ui/isle'
import { appUpdateActivity } from '@/presentation/app-shell/appUpdateActivity'
import type { ApkReleaseInfo } from '@/platform/native/androidApkUpdates'
import { useSettingsStore } from '@/store/settingsStore'
import { router } from 'expo-router'
import { APP_UPDATE_QUIET_PERIOD_MS, scheduleIdleAppUpdate } from '@/core/appUpdateIdle'
import { createApkUpdateDeliveryCoordinator } from './apkUpdateDeliveryCoordinator'
import { apkUpdateDeliverySession } from './apkUpdateDeliverySession'

const BANNER_ID = 'apk-update-automatic-progress'
const FEEDBACK_CLEAR_DELAY_MS = 12_000
let notificationSequence = 0
type NotificationPort = Pick<typeof import('@/bootstrap/androidStatusNotification'),
  'updateAndroidStatusNotification' | 'clearAndroidStatusNotification'>
const loadNotificationPort = () => import('@/bootstrap/androidStatusNotification')

/** Presentation adapter: installation authority remains in the existing native APK transport. */
export function useAutomaticApkUpdateInstall(loadNotifications: () => Promise<NotificationPort> = loadNotificationPort) {
  const dialog = useIsleDialog()
  const { t } = useTranslation()
  const latest = useRef({ dialog, t })
  latest.current = { dialog, t }
  const coordinator = useRef<ReturnType<typeof createApkUpdateDeliveryCoordinator> | undefined>(undefined)

  useEffect(() => {
    let mounted = true
    let owner: string | undefined
    let notificationRevision = 0
    let feedbackTimer: ReturnType<typeof setTimeout> | undefined
    let releaseBusy: (() => void) | undefined
    let binding: ReturnType<typeof apkUpdateDeliverySession.bind> | undefined
    let formatSize = (value: number | undefined) => value === undefined ? '?' : `${value} B`
    const clearFeedback = () => {
      notificationRevision += 1
      if (feedbackTimer !== undefined) clearTimeout(feedbackTimer)
      feedbackTimer = undefined
      latest.current.dialog.dismissBanner(BANNER_ID)
      const previous = owner
      owner = undefined
      if (previous) void loadNotifications()
        .then(({ clearAndroidStatusNotification }) => clearAndroidStatusNotification({ owner: previous }))
        .catch(() => undefined)
    }
    const publishNotification = (notification: Parameters<NotificationPort['updateAndroidStatusNotification']>[0], signal?: AbortSignal) => {
      const expected = owner
      const revision = ++notificationRevision
      void loadNotifications().then(({ updateAndroidStatusNotification }) => {
        if (!mounted || !expected || owner !== expected || revision !== notificationRevision || signal?.aborted) return
        return updateAndroidStatusNotification(notification, {
          enabled: useSettingsStore.getState().settings.systemStatusNotificationsEnabled === true, owner: expected,
        })
      }).catch(() => undefined)
    }
    const cancelled = () => {
      clearFeedback()
      latest.current.dialog.toast({ title: latest.current.t('updates.cancelled'), tone: 'amber' })
    }
    const canOpenInstaller = () => {
      const activity = appUpdateActivity.getSnapshot()
      return activity.foreground === true && !activity.blocked
        && appUpdateActivity.now() - activity.lastActivityAt >= APP_UPDATE_QUIET_PERIOD_MS
        && latest.current.dialog.hasPendingDialogs?.() === false
    }
    const banner = (value: Parameters<typeof dialog.banner>[0]) => {
      if (useSettingsStore.getState().settings.apkUpdateBannerEnabled !== false) latest.current.dialog.banner(value)
      else latest.current.dialog.dismissBanner(BANNER_ID)
    }
    const install = createApkUpdateDeliveryCoordinator({
      prepare: async (target, options) => {
        const native = await import('@/platform/native/androidApkUpdates')
        if (options.signal?.aborted) throw new Error('Update cancelled before transport admission.')
        formatSize = native.formatApkSizeBytes
        return native.prepareApkRelease(target, options)
      },
      open: async (prepared, options) => {
        const native = await import('@/platform/native/androidApkUpdates')
        if (options.signal?.aborted) throw new Error('Update cancelled before installer admission.')
        return native.openPreparedApkInstaller(prepared, options)
      },
      discard: async (prepared) => (await import('@/platform/native/androidApkUpdates')).discardPreparedApk(prepared),
      canOpenInstaller,
      waitForIdle: (signal) => new Promise<void>((resolve, reject) => {
        if (signal.aborted) { reject(new Error('Update cancelled')); return }
        let cancelDeadline = () => undefined as void
        let unsubscribeDialogs = () => undefined as void
        const clear = () => { cancelDeadline(); unsubscribeDialogs(); signal.removeEventListener('abort', abort) }
        const abort = () => { clear(); reject(new Error('Update cancelled')) }
        signal.addEventListener('abort', abort, { once: true })
        unsubscribeDialogs = latest.current.dialog.subscribeDialogs?.(() => appUpdateActivity.recordActivity()) ?? unsubscribeDialogs
        cancelDeadline = scheduleIdleAppUpdate({
          activity: appUpdateActivity, canPrompt: () => !signal.aborted && latest.current.dialog.hasPendingDialogs?.() === false,
          onIdle: () => { clear(); resolve(); return true },
        })
      }),
      onSnapshot: (snapshot) => {
        binding?.publish(snapshot)
        if (snapshot.stage === 'preparing' || snapshot.stage === 'cancelling') releaseBusy ??= appUpdateActivity.acquireBlocker('update-preparation')
        else { releaseBusy?.(); releaseBusy = undefined }
        if (snapshot.stage === 'waiting') {
          const title = latest.current.t('updates.waitingForIdle')
          banner({ id: BANNER_ID, title,
            message: `v${snapshot.target?.version}`, tone: 'amber',
            actionLabel: latest.current.t('updates.cancelPending'), onAction: () => install.cancel() })
          // A queued handoff is not an active transfer; this also stops an earlier foreground service.
          publishNotification({ state: 'completed', title, message: `v${snapshot.target?.version}`, shortText: title,
            deepLink: 'islemind://settings/system/updates', ongoing: false, indeterminate: false,
            foregroundService: true, requestPromotedOngoing: false })
        } else if (snapshot.stage === 'idle') clearFeedback()
      },
      onStart: () => {
        clearFeedback()
        owner = `apk-update:auto:${Date.now()}:${++notificationSequence}`
      },
      onProgress: (progress, signal) => {
        const target = progress.release
        const { t: translate } = latest.current
        const title = translate(progress.stage === 'downloading' ? 'settings.apkUpdateProgressDownloading'
          : progress.stage === 'verifying' ? 'settings.apkUpdateProgressVerifying' : 'settings.apkUpdateProgressOpeningInstaller')
        const detail = progress.stage === 'downloading'
          ? `v${target.version} | ${formatSize(progress.bytesWritten)} / ${formatSize(progress.bytesExpected ?? target.sizeBytes)}`
          : `v${target.version} | ${target.apkName}`
        banner({
          id: BANNER_ID, title, message: detail, tone: 'amber',
          ...(progress.stage === 'opening-installer' ? {} : {
            actionLabel: translate('updates.cancelDownload'), onAction: () => install.cancel(),
          }),
        })
        publishNotification({
          state: 'running', title, message: detail, shortText: title,
          deepLink: 'islemind://settings/system/updates',
          progress: progress.percent === undefined ? undefined : progress.percent / 100,
          indeterminate: progress.stage !== 'downloading' || progress.percent === undefined,
          ongoing: true, foregroundService: true, requestPromotedOngoing: true,
        }, signal)
      },
      onResult: (result) => {
        if (result.status === 'cancelled') { cancelled(); return }
        if (result.status === 'prepared' && result.release) {
          const target = result.release
          const title = latest.current.t('updates.preparedMessage')
          banner({ id: BANNER_ID, title, message: `v${target.version}`, tone: 'mint',
            actionLabel: latest.current.t('updates.reviewPrepared'),
            onAction: () => router.push('/settings/system/updates') })
          publishNotification({ state: 'completed', title, message: `v${target.version}`, shortText: title,
            deepLink: 'islemind://settings/system/updates', ongoing: false, indeterminate: false,
            foregroundService: true, requestPromotedOngoing: false })
          return
        }
        const { dialog: currentDialog, t: translate } = latest.current
        const title = translate(result.status === 'downloaded' ? 'settings.installerOpened'
          : result.status === 'busy' ? 'updates.installInProgress' : 'settings.apkUpdateFailed')
        const tone = result.status === 'downloaded' ? 'mint' : result.status === 'busy' ? 'amber' : 'danger'
        currentDialog.notice({ title, message: result.message, tone })
        banner({ id: BANNER_ID, title, message: result.message, tone })
        publishNotification({
          state: tone === 'danger' ? 'error' : 'completed', title, message: result.message, shortText: title,
          deepLink: 'islemind://settings/system/updates', ongoing: false, foregroundService: true,
          indeterminate: false, requestPromotedOngoing: false,
        })
        feedbackTimer = setTimeout(clearFeedback, FEEDBACK_CLEAR_DELAY_MS)
      },
      onFailure: () => {
        clearFeedback()
        latest.current.dialog.notice({ title: latest.current.t('settings.apkUpdateFailed'), tone: 'danger' })
      },
      onCancelled: cancelled,
      onSettled: () => { void Promise.resolve().then(() => { if (mounted) appUpdateActivity.recordActivity() }) },
    })
    binding = apkUpdateDeliverySession.bind(install)
    const unsubscribeSettings = useSettingsStore.subscribe((state) => {
      if (state.settings.apkUpdateBannerEnabled === false) latest.current.dialog.dismissBanner(BANNER_ID)
    })
    coordinator.current = install
    return () => {
      mounted = false
      install.dispose()
      binding?.release()
      unsubscribeSettings()
      releaseBusy?.()
      clearFeedback()
      if (coordinator.current === install) coordinator.current = undefined
    }
  }, [loadNotifications])
  return useCallback((target: ApkReleaseInfo) => apkUpdateDeliverySession.install(target), [])
}
