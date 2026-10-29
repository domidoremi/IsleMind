import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Text } from '@/components/ui/AppText'
import { IsleButton, IsleProgress, IsleToggle, useIsleDialog } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import { beginManualApkUpdateCheck } from '@/presentation/features/settings/apkUpdateInteraction'
import { flushPersistedSettings } from '@/presentation/features/settings/settingsStorePersistenceCommand'
import { ApkAutomaticDownloadConsent } from './ApkAutomaticDownloadConsent'
import { apkUpdateDeliverySession } from './apkUpdateDeliverySession'
import { ApkUpdateReleaseNotes, useApkUpdatePrompt } from './useApkUpdatePrompt'

export function ApkUpdateDeliverySettings() {
  const settings = useSettingsStore((state) => state.settings)
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const prompt = useApkUpdatePrompt()
  const snapshot = useSyncExternalStore(apkUpdateDeliverySession.subscribe,
    apkUpdateDeliverySession.getSnapshot, apkUpdateDeliverySession.getSnapshot)
  const review = useRef<{ controller: AbortController; approved: boolean } | undefined>(undefined)
  const downloadConsent = useRef<AbortController | undefined>(undefined)
  const [reviewing, setReviewing] = useState(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      downloadConsent.current?.abort()
      if (!review.current?.approved) review.current?.controller.abort()
    }
  }, [])
  useEffect(() => {
    if (snapshot.stage !== 'prepared' && !review.current?.approved) review.current?.controller.abort()
  }, [snapshot.stage])
  const toggleDownload = async () => {
    if (downloadConsent.current) return
    const enable = useSettingsStore.getState().settings.autoApkDownloadEnabled !== true
    const controller = new AbortController()
    downloadConsent.current = controller
    try {
      if (enable && !await dialog.confirm({
        title: t('updates.autoDownloadTitle'), message: t('updates.autoDownloadConsent'), signal: controller.signal,
        renderBody: () => <ApkAutomaticDownloadConsent />,
        confirmLabel: t('updates.enableAutoDownload'), cancelLabel: t('updates.notNow'), tone: 'amber',
      })) return
      if (controller.signal.aborted || !mounted.current) return
      useSettingsStore.getState().updateSettings({ autoApkDownloadEnabled: enable })
      await flushPersistedSettings().catch(() => dialog.toast({ title: t('settingsWorkspace.saveFailed'), tone: 'danger' }))
    } finally {
      if (downloadConsent.current === controller) downloadConsent.current = undefined
    }
  }
  const reviewPrepared = async () => {
    if (review.current || snapshot.stage !== 'prepared' || !snapshot.target) return
    const expected = snapshot
    const request = { controller: new AbortController(), approved: false }
    review.current = request
    setReviewing(true)
    const finish = beginManualApkUpdateCheck()
    try {
      const native = await import('@/platform/native/androidApkUpdates')
      if (request.controller.signal.aborted || apkUpdateDeliverySession.getSnapshot() !== expected) return
      const target = await prompt(snapshot.target, native.getVersionSnapshot(), {
        signal: request.controller.signal, cancelMeansIgnore: false, onApproved: () => { request.approved = true },
      })
      finish()
      if (target && apkUpdateDeliverySession.getSnapshot() === expected) await apkUpdateDeliverySession.install(target)
    } catch {
      if (!request.controller.signal.aborted) dialog.notice({ title: t('settings.apkUpdateFailed'), tone: 'danger' })
    } finally {
      finish()
      if (review.current === request) { review.current = undefined; if (mounted.current) setReviewing(false) }
    }
  }
  const readNotes = async () => {
    if (!snapshot.target) return
    const expected = snapshot
    try {
      const native = await import('@/platform/native/androidApkUpdates')
      if (!mounted.current || apkUpdateDeliverySession.getSnapshot() !== expected) return
      const baseline = native.getVersionSnapshot()
      dialog.notice({ title: t('updates.releaseNotes'), message: t('updates.preparedNotInstalled'),
        renderBody: () => <ApkUpdateReleaseNotes release={expected.target!}
          installedVersion={baseline.appVersion} installedBuildVersion={baseline.buildVersion} /> })
    } catch {
      if (mounted.current) dialog.notice({ title: t('settings.apkUpdateFailed'), tone: 'danger' })
    }
  }
  const pending = snapshot.target && ['preparing', 'prepared', 'waiting', 'validating', 'cancelling', 'opening'].includes(snapshot.stage)
  const progressLabel = snapshot.progress ? t(snapshot.progress.stage === 'downloading' ? 'settings.apkUpdateProgressDownloading'
    : snapshot.progress.stage === 'verifying' ? 'settings.apkUpdateProgressVerifying' : 'settings.apkUpdateProgressOpeningInstaller')
    : t(`updates.deliveryStage.${snapshot.stage}`)
  return <View style={{ gap: 12 }} testID="apk-update-delivery-settings">
    <IsleToggle title={t('updates.autoDownload')} description={t('updates.autoDownloadDescription')}
      active={settings.autoApkDownloadEnabled === true} onPress={() => void toggleDownload()} />
    <IsleToggle title={t('updates.progressBanner')} description={t('updates.progressBannerDescription')}
      active={settings.apkUpdateBannerEnabled !== false}
      onPress={() => useSettingsStore.getState().updateSettings({ apkUpdateBannerEnabled: settings.apkUpdateBannerEnabled === false })} />
    {pending ? <View style={{ gap: 8 }} testID="apk-update-pending">
      <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>
        {t(`updates.deliveryStage.${snapshot.stage}`)} · v{snapshot.target?.version}
      </Text>
      <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20 }}>{t('updates.preparedNotInstalled')}</Text>
      {snapshot.progress ? <IsleProgress size="small" percent={snapshot.progress.percent ?? 0}
        indeterminate={snapshot.progress.percent === undefined} accessibilityLabel={progressLabel} /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {snapshot.stage === 'prepared' ? <IsleButton label={t('updates.reviewPrepared')} disabled={reviewing}
          onPress={() => void reviewPrepared()} /> : null}
        {snapshot.stage !== 'opening' && snapshot.stage !== 'cancelling' ? <IsleButton tone="soft" label={t('updates.releaseNotes')}
          onPress={() => void readNotes()} /> : null}
        {snapshot.stage !== 'opening' ? <IsleButton tone="soft" disabled={snapshot.stage === 'cancelling'}
          label={t(snapshot.stage === 'cancelling' ? 'updates.cancelling' : 'updates.cancelPending')}
          onPress={() => { review.current?.controller.abort(); apkUpdateDeliverySession.cancel() }} /> : null}
      </View>
    </View> : null}
  </View>
}
