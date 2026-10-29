import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Linking, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Text } from '@/components/ui/AppText'
import { IsleButton, useIsleDialog } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { collectCumulativeReleaseNotes } from '@/core/cumulativeReleaseNotes'
import { safeHttpUrl } from '@/utils/networkUrlSafety'
import {
  createApkUpdateIgnoreState,
  reconcileApkUpdateIgnoreState,
  shouldPromptApkUpdate,
  type InstalledApkVersion,
} from '@/modules/settings'
import type { ApkReleaseInfo } from '@/platform/native/androidApkUpdates'
import { flushPersistedSettings } from '@/presentation/features/settings/settingsStorePersistenceCommand'
import { markApkUpdatePromptHandled } from '@/presentation/features/settings/apkUpdateInteraction'
import { freezeApkUpdateTarget } from './apkUpdateTarget'
import { useSettingsStore } from '@/store/settingsStore'

const RELEASE_NOTE_RENDER_BATCH_SIZE = 50

export function useApkUpdatePrompt() {
  const dialog = useIsleDialog()
  const { t } = useTranslation()
  return useCallback(async (
    candidate: ApkReleaseInfo,
    baseline: InstalledApkVersion,
    options: { signal?: AbortSignal; automatic?: boolean; cancelMeansIgnore?: boolean; onApproved?: (target: ApkReleaseInfo) => void } = {},
  ): Promise<ApkReleaseInfo | undefined> => {
    if (options.signal?.aborted) return undefined
    const release = freezeApkUpdateTarget(candidate)
    const installed = Object.freeze({ ...baseline })
    const store = useSettingsStore.getState()
    if (options.automatic && (store.settings.autoUpdateCheckEnabled === false
      || !shouldPromptApkUpdate(store.settings, installed, release))) return undefined
    if (store.settings.ignoredApkUpdate
      && !reconcileApkUpdateIgnoreState(store.settings.ignoredApkUpdate, installed)) {
      store.updateSettings({ ignoredApkUpdate: undefined })
    }
    let approved: ApkReleaseInfo | undefined
    const confirmed = await dialog.confirm({
      title: t('settings.installVersion', { version: release.version }),
      message: t('settings.installConfirm'),
      confirmLabel: t('updates.updateNow'),
      cancelLabel: t(options.cancelMeansIgnore === false ? 'common.cancel' : 'updates.ignoreVersion'),
      signal: options.signal,
      onConfirm: () => {
        approved = release
        markApkUpdatePromptHandled(installed, release)
        options.onApproved?.(release)
      },
      tone: 'amber',
      chips: [
        { label: release.apkName, tone: 'mint' as const },
        release.versionCode ? { label: t('settings.apkBuildCode', { code: release.versionCode }) } : null,
        release.abi ? { label: t('settings.apkArchitecture', { abi: release.abi }) } : null,
        release.variant ? { label: t(`settings.apkVariant.${release.variant}`) } : null,
        release.sizeBytes ? { label: t('settings.apkSize', { size: formatApkSize(release.sizeBytes) }) } : null,
        { label: release.tagName || release.name },
      ].filter((chip): chip is { label: string; tone?: 'mint' } => Boolean(chip)),
      renderBody: () => <ApkUpdateReleaseNotes release={release}
        installedVersion={installed.appVersion} installedBuildVersion={installed.buildVersion} />,
    })
    // Closing a request on teardown or after changing reminder settings is not a user ignore.
    if (!approved && options.signal?.aborted) return undefined
    if (!approved && !confirmed && options.cancelMeansIgnore !== false) {
      const ignoredApkUpdate = createApkUpdateIgnoreState(installed, release)
      if (ignoredApkUpdate) {
        useSettingsStore.getState().updateSettings({ ignoredApkUpdate })
        await flushPersistedSettings().catch(() => {
          dialog.toast({ title: t('settingsWorkspace.saveFailed'), tone: 'danger' })
        })
      }
    } else if (!approved && confirmed) {
      markApkUpdatePromptHandled(installed, release)
      approved = release
    }
    return approved
  }, [dialog, t])
}

export function ApkUpdateReleaseNotes({ release, installedVersion, installedBuildVersion }: {
  release: ApkReleaseInfo
  installedVersion: string
  installedBuildVersion?: string
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const language = useSettingsStore((state) => state.settings.language)
  const notes = useMemo(() => collectCumulativeReleaseNotes({
    installed: { version: installedVersion, versionCode: Number(installedBuildVersion) },
    target: { version: release.version, versionCode: release.versionCode },
    entries: release.releaseNotes ?? [],
    language,
    complete: release.releaseNotesComplete,
  }), [installedVersion, installedBuildVersion, release, language])
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({})
  useEffect(() => {
    setVisibleCounts((current) => Object.keys(current).length ? {} : current)
  }, [notes])
  const openLink = (url: string) => {
    void Linking.openURL(url).catch(() => dialog.toast({ title: t('updates.releaseLinkOpenFailed'), tone: 'danger' }))
  }
  return <View testID="apk-update-release-notes" style={{ gap: 12 }}>
    <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 16, fontWeight: '800' }}>
      {t('updates.releaseNotes')}
    </Text>
    {notes.releaseCount > 0 ? <Text testID="apk-update-release-range"
      style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 21 }}>
      {t(notes.complete ? 'updates.releaseRange' : 'updates.releaseRangePartial', {
        count: notes.releaseCount, from: notes.firstVersion, to: notes.lastVersion,
      })}
    </Text> : null}
    {notes.groups.map((group) => <View key={group.category} style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 15, fontWeight: '800' }}>
        {t('updates.categoryCount', { category: t(`updates.categories.${group.category}`), count: group.items.length })}
      </Text>
      {group.items.slice(0, visibleCounts[group.category] ?? RELEASE_NOTE_RENDER_BATCH_SIZE).map((item) => <View key={item.id} style={{ gap: 4 }}>
        <Text selectable style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 21 }}>
          {renderNoteLinks(item.text, colors.primary, openLink)}
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 18 }}>v{item.version}</Text>
      </View>)}
      {group.items.length > (visibleCounts[group.category] ?? RELEASE_NOTE_RENDER_BATCH_SIZE) ? <IsleButton
        multiline tone="soft"
        label={t('updates.showMoreChanges', {
          count: Math.min(RELEASE_NOTE_RENDER_BATCH_SIZE, group.items.length - (visibleCounts[group.category] ?? RELEASE_NOTE_RENDER_BATCH_SIZE)),
          remaining: group.items.length - (visibleCounts[group.category] ?? RELEASE_NOTE_RENDER_BATCH_SIZE),
        })}
        onPress={() => setVisibleCounts((current) => ({
          ...current, [group.category]: (current[group.category] ?? RELEASE_NOTE_RENDER_BATCH_SIZE) + RELEASE_NOTE_RENDER_BATCH_SIZE,
        }))}
      /> : null}
    </View>)}
    {!notes.changeCount
      ? <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 21 }}>{t('updates.noReleaseNotes')}</Text> : null}
    {!notes.complete
      ? <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 21 }}>{t('updates.releaseNotesIncomplete')}</Text> : null}
    {notes.fallbackVersions.length ? <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 21 }}>
      {t('updates.releaseNotesLanguageFallback', { versions: notes.fallbackVersions.map((version) => `v${version}`).join(', ') })}
    </Text> : null}
  </View>
}

/** Keep issue links usable without loading a full Markdown renderer in the application shell. */
function renderNoteLinks(text: string, color: string, open: (url: string) => void): ReactNode {
  const parts: ReactNode[] = []
  const links = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g
  let cursor = 0
  for (const match of text.matchAll(links)) {
    const url = safeHttpUrl(match[2])
    if (!url) continue
    parts.push(text.slice(cursor, match.index))
    parts.push(<Text key={match.index} accessibilityRole="link" onPress={() => open(url)}
      style={{ color, textDecorationLine: 'underline' }}>{match[1]}</Text>)
    cursor = match.index + match[0].length
  }
  return parts.length ? [...parts, text.slice(cursor)] : text
}

function formatApkSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${size} B`
}
