import type { ReactNode } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { router } from 'expo-router'
import { BookOpen, Brain, Database, Download, Globe2, House, KeyRound, Languages, Network, RotateCcw, SlidersHorizontal, Smartphone, Sparkles, Trash2, Upload } from 'lucide-react-native'
import { useTranslation } from 'react-i18next'
import { PressableScale } from '@/components/ui/PressableScale'
import { Pill } from '@/components/ui/Pill'
import { IslandButton } from '@/components/ui/IslandButton'
import { IslandHeader, IslandIconButton, IslandListItem, IslandSection, IslandToggle } from '@/components/ui/IslandPrimitives'
import { MiniStat } from '@/components/ui/MiniStat'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import { useChatStore } from '@/store/chatStore'
import { exportToJsonFile, importFromJsonFile } from '@/services/portableData'
import { checkLatestApkRelease, downloadAndOpenApkInstaller, formatUpdateCheckTime, getVersionSnapshot, type ApkReleaseInfo } from '@/services/appUpdates'
import { useIslandDialog } from '@/components/ui/IslandDialog'
import { resolveSearchProvider, searchProviderLabel } from '@/services/searchPolicy'
import { changeAppLanguage } from '@/i18n'
import type { Language, ThemeMode } from '@/types'

const LANGUAGE_OPTIONS: { id: Language; label: string; detail: string }[] = [
  { id: 'zh-CN', label: '简体中文', detail: '中文界面' },
  { id: 'en', label: 'English', detail: 'English UI' },
  { id: 'ja', label: '日本語', detail: '日本語 UI' },
]

export function SettingsScreenContent({ onHome }: { onHome?: () => void } = {}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIslandDialog()
  const providers = useSettingsStore((state) => state.providers)
  const settings = useSettingsStore((state) => state.settings)
  const setTheme = useSettingsStore((state) => state.setTheme)
  const setLanguage = useSettingsStore((state) => state.setLanguage)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const resetSettings = useSettingsStore((state) => state.clearAll)
  const clearChats = useChatStore((state) => state.clearAll)
  const enabledProviders = providers.filter((provider) => provider.enabled).length
  const defaultProvider = providers.find((provider) => provider.id === settings.defaultProvider)
  const version = getVersionSnapshot()
  const searchProvider = resolveSearchProvider(settings)

  async function exportJson() {
    const uri = await exportToJsonFile()
    dialog.notice({ title: t('settings.exportDone'), message: t('settings.exportDoneMessage', { uri }), tone: 'mint' })
  }

  async function importJson() {
    const ok = await importFromJsonFile()
    dialog.notice({
      title: ok ? t('settings.importDone') : t('settings.importSkipped'),
      message: ok ? t('settings.importDoneMessage') : t('settings.importSkippedMessage'),
      tone: ok ? 'mint' : 'amber',
    })
  }

  function confirmClearChats() {
    void dialog.confirm({
      title: t('settings.clearChats'),
      message: t('settings.clearChatsConfirm'),
      tone: 'danger',
      confirmLabel: t('settings.clear'),
      cancelLabel: t('common.cancel'),
    }).then((confirmed) => {
      if (confirmed) clearChats()
    })
  }

  function confirmResetSettings() {
    void dialog.confirm({
      title: t('settings.resetSettings'),
      message: t('settings.resetSettingsConfirm'),
      tone: 'danger',
      confirmLabel: t('settings.reset'),
      cancelLabel: t('common.cancel'),
    }).then((confirmed) => {
      if (confirmed) void resetSettings()
    })
  }

  async function checkApkUpdate() {
    const result = await checkLatestApkRelease()
    updateSettings({ lastApkUpdateCheckAt: Date.now() })
    if (result.status !== 'available' || !result.release) {
      dialog.notice({
        title: result.status === 'error' ? t('settings.apkCheckFailed') : t('settings.noNewApk'),
        message: result.message,
        tone: result.status === 'error' ? 'danger' : result.status === 'unsupported' ? 'amber' : 'mint',
      })
      return
    }
    const confirmed = await confirmApkInstall(result.release)
    if (!confirmed) return
    const installResult = await downloadAndOpenApkInstaller(result.release)
    dialog.notice({
      title: installResult.status === 'downloaded' ? t('settings.installerOpened') : t('settings.apkUpdateFailed'),
      message: installResult.message,
      tone: installResult.status === 'downloaded' ? 'mint' : 'danger',
    })
  }

  function confirmApkInstall(release: ApkReleaseInfo) {
    return dialog.confirm({
      title: t('settings.installVersion', { version: release.version }),
      message: t('settings.installConfirm'),
      confirmLabel: t('settings.downloadAndInstall'),
      cancelLabel: t('settings.later'),
      tone: 'amber',
      chips: [
        { label: release.apkName, tone: 'mint' },
        { label: release.tagName || release.name },
      ],
    })
  }

  function toggleAutoCheck() {
    const next = !(settings.autoUpdateCheckEnabled ?? true)
    updateSettings({ autoUpdateCheckEnabled: next })
    dialog.toast({ title: next ? t('settings.autoCheckOn') : t('settings.autoCheckOff'), message: t('settings.coldUpdatePolicy'), tone: next ? 'mint' : 'amber' })
  }

  async function chooseLanguage(language: Language) {
    setLanguage(language)
    await changeAppLanguage(language)
    dialog.toast({ title: t('settings.languageUpdated'), message: LANGUAGE_OPTIONS.find((item) => item.id === language)?.label, tone: 'mint' })
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 46 }}>
      <IslandHeader
        title={t('settings.title')}
        leading={
          onHome ? (
            <IslandIconButton label={t('common.home')} onPress={onHome}>
              <House color={colors.text} size={20} strokeWidth={1.9} />
            </IslandIconButton>
          ) : undefined
        }
      />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        <MiniStat label={`${t('settings.enabled')} ${enabledProviders}`} />
        <MiniStat label={defaultProvider ? `${t('settings.default')} ${defaultProvider.name}` : t('settings.noDefault')} />
        <MiniStat label={searchProvider !== 'off' ? `${t('settings.search')} ${searchProviderLabel(searchProvider)}` : t('settings.searchOff')} />
      </View>

      <IslandSection title={t('settings.basicFeatures')} style={{ marginTop: 18 }}>
        <View style={{ gap: 10 }}>
          <IslandToggle
            icon={<Brain color={colors.text} size={18} />}
            title={t('settings.longMemory')}
            active={!!settings.memoryEnabled}
            onPress={() => updateSettings({ memoryEnabled: !settings.memoryEnabled })}
          />
          <IslandToggle
            icon={<BookOpen color={colors.text} size={18} />}
            title={t('settings.localKnowledge')}
            active={!!settings.knowledgeEnabled}
            onPress={() => updateSettings({ knowledgeEnabled: !settings.knowledgeEnabled })}
          />
          <IslandToggle
            icon={<Globe2 color={colors.text} size={18} />}
            title={t('settings.webSearch')}
            active={!!settings.webSearchEnabled}
            onPress={() => updateSettings({ webSearchEnabled: !settings.webSearchEnabled })}
          />
        </View>
      </IslandSection>

      <IslandSection title={t('settings.theme')} style={{ marginTop: 14 }}>
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          {(['system', 'light', 'dark'] satisfies ThemeMode[]).map((item) => (
            <PressableScale key={item} haptic onPress={() => setTheme(item)}>
              <Pill active={settings.theme === item}>{item === 'system' ? t('settings.themeSystem') : item === 'light' ? t('settings.themeLight') : t('settings.themeDark')}</Pill>
            </PressableScale>
          ))}
        </View>
      </IslandSection>

      <IslandSection title={t('settings.language')} style={{ marginTop: 14 }}>
        <View style={{ gap: 8 }}>
          {LANGUAGE_OPTIONS.map((item) => (
            <IslandListItem
              key={item.id}
              title={item.label}
              description={item.detail}
              onPress={() => void chooseLanguage(item.id)}
              leading={<IconWrap><Languages color={colors.text} size={18} /></IconWrap>}
              trailing={<Pill active={settings.language === item.id}>{settings.language === item.id ? t('settings.current') : item.id}</Pill>}
            />
          ))}
        </View>
      </IslandSection>

      <IslandSection title={t('settings.aiSettings')} style={{ marginTop: 14 }}>
        <View style={{ gap: 8 }}>
          <SettingLink title={t('settings.providerManagement')} description={`${enabledProviders} ${t('settings.enabled')} · ${providers.length} ${t('settings.providers')}`} icon={<KeyRound color={colors.text} size={18} />} onPress={() => router.push('/settings/providers')} />
          <SettingLink title={t('settings.context')} description={t('settings.contextDescription')} icon={<Globe2 color={colors.text} size={18} />} onPress={() => router.push('/settings/context')} />
          <SettingLink title={t('settings.memory')} description={t('settings.memoryDescription')} icon={<Brain color={colors.text} size={18} />} onPress={() => router.push('/settings/memory')} />
          <SettingLink title={t('settings.knowledge')} description={t('settings.knowledgeDescription')} icon={<Database color={colors.text} size={18} />} onPress={() => router.push('/settings/knowledge')} />
          <SettingLink title={t('settings.preferences')} description={t('settings.preferencesDescription')} icon={<SlidersHorizontal color={colors.text} size={18} />} onPress={() => router.push('/settings/preferences')} />
          <SettingLink title={t('settings.skills')} description={t('settings.skillsDescription')} icon={<Sparkles color={colors.text} size={18} />} onPress={() => router.push('/settings/skills')} />
          <SettingLink title={t('settings.mcp')} description={t('settings.mcpDescription')} icon={<Network color={colors.text} size={18} />} onPress={() => router.push('/settings/mcp')} />
        </View>
      </IslandSection>

      <IslandSection title={t('settings.updates')} style={{ marginTop: 14 }}>
        <View style={{ borderRadius: 22, padding: 13, backgroundColor: colors.material.paperRaised, borderWidth: 1, borderColor: colors.border }}>
          <VersionRow label={t('settings.appVersion')} value={`${version.appVersion} (${version.buildVersion})`} />
          <VersionRow label={t('settings.coldUpdate')} value="GitHub Release APK" />
          <VersionRow label={t('settings.hotUpdate')} value={t('settings.disabled')} />
          <VersionRow label={t('settings.autoCheck')} value={(settings.autoUpdateCheckEnabled ?? true) ? t('settings.enabledState') : t('settings.disabledState')} />
          <VersionRow label={t('settings.lastCheck')} value={formatUpdateCheckTime(settings.lastApkUpdateCheckAt)} />
        </View>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 10 }}>
          <DataButton label={t('settings.checkApk')} icon={<Smartphone color={colors.surface} size={18} />} onPress={() => void checkApkUpdate()} />
          <IslandButton
            label={(settings.autoUpdateCheckEnabled ?? true) ? t('settings.autoEnabled') : t('settings.autoDisabled')}
            tone="soft"
            onPress={toggleAutoCheck}
            style={{ flex: 1, minHeight: 54, borderRadius: 27 }}
          />
        </View>
      </IslandSection>

      <IslandSection title={t('settings.importExport')} style={{ marginTop: 14 }}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <DataButton label={t('settings.exportJson')} icon={<Download color={colors.surface} size={18} />} onPress={() => void exportJson()} />
          <DataButton label={t('settings.importJson')} icon={<Upload color={colors.surface} size={18} />} onPress={() => void importJson()} />
        </View>
      </IslandSection>

      <IslandSection title={t('settings.dangerZone')} style={{ marginTop: 14 }}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <DangerButton label={t('settings.clearChats')} icon={<Trash2 color={colors.error} size={18} />} onPress={confirmClearChats} />
          <DangerButton label={t('settings.resetSettings')} icon={<RotateCcw color={colors.error} size={18} />} onPress={confirmResetSettings} />
        </View>
      </IslandSection>
    </ScrollView>
  )
}

function SettingLink({ title, description, icon, onPress }: { title: string; description: string; icon: ReactNode; onPress: () => void }) {
  return <IslandListItem title={title} description={description} leading={<IconWrap>{icon}</IconWrap>} onPress={onPress} />
}

function IconWrap({ children }: { children: ReactNode }) {
  const { colors } = useAppTheme()
  return <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mintSoft }}>{children}</View>
}

function VersionRow({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '900', width: 76 }}>{label}</Text>
      <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12, fontWeight: '800', flex: 1 }}>{value}</Text>
    </View>
  )
}

function DataButton({ label, icon, onPress }: { label: string; icon: ReactNode; onPress: () => void }) {
  return <IslandButton label={label} icon={icon} tone="primary" onPress={onPress} style={{ flex: 1, minHeight: 54, borderRadius: 27 }} />
}

function DangerButton({ label, icon, onPress }: { label: string; icon: ReactNode; onPress: () => void }) {
  const { colors } = useAppTheme()
  return (
    <PressableScale haptic onPress={onPress} style={{ flex: 1, minHeight: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, backgroundColor: colors.coralWash, borderWidth: 1, borderColor: colors.error }}>
      {icon}
      <Text style={{ color: colors.error, fontSize: 14, fontWeight: '800' }}>{label}</Text>
    </PressableScale>
  )
}
