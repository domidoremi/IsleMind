import { useCallback } from 'react'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Text } from '@/components/ui/AppText'
import { useIsleDialog } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { mergeAppReleaseNotes } from '@/core/appVersion'
import {
  createApkUpdateIgnoreState,
  reconcileApkUpdateIgnoreState,
  shouldPromptApkUpdate,
  type InstalledApkVersion,
} from '@/modules/settings'
import type { ApkReleaseInfo } from '@/platform/native/androidApkUpdates'
import { flushPersistedSettings } from '@/presentation/features/settings/settingsStorePersistenceCommand'
import { markApkUpdatePromptHandled } from '@/presentation/features/settings/apkUpdateInteraction'
import { useSettingsStore } from '@/store/settingsStore'

export function useApkUpdatePrompt() {
  const dialog = useIsleDialog()
  const { t } = useTranslation()
  return useCallback(async (
    release: ApkReleaseInfo,
    installed: InstalledApkVersion,
    options: { signal?: AbortSignal; automatic?: boolean } = {},
  ): Promise<boolean> => {
    if (options.signal?.aborted) return false
    const store = useSettingsStore.getState()
    if (options.automatic && (store.settings.autoUpdateCheckEnabled === false
      || !shouldPromptApkUpdate(store.settings, installed, release))) return false
    if (store.settings.ignoredApkUpdate
      && !reconcileApkUpdateIgnoreState(store.settings.ignoredApkUpdate, installed)) {
      store.updateSettings({ ignoredApkUpdate: undefined })
    }
    const confirmed = await dialog.confirm({
      title: t('settings.installVersion', { version: release.version }),
      message: t('settings.installConfirm'),
      confirmLabel: t('updates.updateNow'),
      cancelLabel: t('updates.ignoreVersion'),
      signal: options.signal,
      tone: 'amber',
      chips: [
        { label: release.apkName, tone: 'mint' as const },
        release.versionCode ? { label: t('settings.apkBuildCode', { code: release.versionCode }) } : null,
        release.abi ? { label: t('settings.apkArchitecture', { abi: release.abi }) } : null,
        release.variant ? { label: t(`settings.apkVariant.${release.variant}`) } : null,
        release.sizeBytes ? { label: t('settings.apkSize', { size: formatApkSize(release.sizeBytes) }) } : null,
        { label: release.tagName || release.name },
      ].filter((chip): chip is { label: string; tone?: 'mint' } => Boolean(chip)),
      renderBody: () => <ApkUpdateReleaseNotes release={release} installedVersion={installed.appVersion} />,
    })
    // Closing a request on teardown or after changing reminder settings is not a user ignore.
    if (options.signal?.aborted) return false
    if (!confirmed) {
      const ignoredApkUpdate = createApkUpdateIgnoreState(installed, release)
      if (ignoredApkUpdate) {
        useSettingsStore.getState().updateSettings({ ignoredApkUpdate })
        await flushPersistedSettings().catch(() => {
          dialog.toast({ title: t('settingsWorkspace.saveFailed'), tone: 'danger' })
        })
      }
    } else {
      markApkUpdatePromptHandled(installed, release)
    }
    return confirmed
  }, [dialog, t])
}

export function ApkUpdateReleaseNotes({ release, installedVersion }: {
  release: ApkReleaseInfo
  installedVersion: string
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const entries = mergeAppReleaseNotes(installedVersion, release.version, release.releaseNotes ?? [])
  return <View testID="apk-update-release-notes" style={{ gap: 12 }}>
    <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 16, fontWeight: '800' }}>
      {t('updates.releaseNotes')}
    </Text>
    {entries.map((entry) => <View key={entry.version} style={{ gap: 4 }}>
      <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 15, fontWeight: '800' }}>v{entry.version}</Text>
      <Text selectable style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 21 }}>{entry.notes}</Text>
    </View>)}
    {!entries.length && release.releaseNotesComplete !== false
      ? <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 21 }}>{t('updates.noReleaseNotes')}</Text> : null}
    {release.releaseNotesComplete === false
      ? <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 21 }}>{t('updates.releaseNotesIncomplete')}</Text> : null}
  </View>
}

function formatApkSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${size} B`
}
