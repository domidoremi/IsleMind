import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, ScrollView, Text, View } from 'react-native'
import { router, usePathname } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import * as Sharing from 'expo-sharing'
import { Activity, BookOpen, Brain, Download, FileJson, Globe2, RotateCcw, Smartphone, Trash2, Upload } from 'lucide-react-native'
import { AnimatePresence, MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { AnimatedNavigationTrigger, type NavigationGlyph } from '@/components/navigation/AnimatedNavigationTrigger'
import { IslePressable } from '@/components/ui/isle'
import { IsleChip } from '@/components/ui/isle'
import { IsleButton, IsleTitle } from '@/components/ui/isle'
import { IsleDisclosure, IsleField, IsleHeader, IsleSection, IsleToggle } from '@/components/ui/isle'
import { IsleMetric } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import { useChatStore } from '@/store/chatStore'
import { exportToJsonFile, importFromJsonFileDetailed } from '@/services/portableData'
import { checkLatestApkRelease, downloadAndOpenApkInstaller, formatUpdateCheckTime, getVersionSnapshot, type ApkReleaseInfo } from '@/services/appUpdates'
import { useIsleDialog } from '@/components/ui/isle'
import { resolveSearchProvider, searchProviderLabel } from '@/services/searchPolicy'
import { clearRuntimeLog, getRuntimeLogPath, readRuntimeLogText } from '@/services/runtimeLog'
import { buildRuntimeDiagnosticsSummary, type RuntimeDiagnosticsSummary } from '@/services/runtimeDiagnostics'
import { changeAppLanguage } from '@/i18n'
import type { BedrockCacheTtl, Language, PayloadPolicyMode, ProxyMode, RemoteCompactMode, ThemeId, ThemeMode, UpstreamTransportMode } from '@/types'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'

const LANGUAGE_OPTIONS: { id: Language; label: string; detail: string }[] = [
  { id: 'zh-CN', label: '简体中文', detail: '中文界面' },
  { id: 'en', label: 'English', detail: 'English UI' },
  { id: 'ja', label: '日本語', detail: '日本語 UI' },
]

const THEME_FAMILY_OPTIONS: { id: ThemeId; labelKey: string; detailKey: string }[] = [
  { id: 'island', labelKey: 'settings.themeIsland', detailKey: 'settings.themeIslandDescription' },
  { id: 'minimal', labelKey: 'settings.themeMinimal', detailKey: 'settings.themeMinimalDescription' },
]

const settingsChipPressableStyle = { minHeight: 44, justifyContent: 'center' as const }
const themeModeCardHeight = 82

const TRANSPORT_OPTIONS: { value: UpstreamTransportMode; labelKey: string }[] = [
  { value: 'auto', labelKey: 'settings.transportAuto' },
  { value: 'http', labelKey: 'settings.transportHttp' },
  { value: 'websocket', labelKey: 'settings.transportWebSocket' },
]

const REMOTE_COMPACT_OPTIONS: { value: RemoteCompactMode; labelKey: string }[] = [
  { value: 'off', labelKey: 'settings.compactOff' },
  { value: 'auto', labelKey: 'settings.compactAuto' },
  { value: 'required', labelKey: 'settings.compactRequired' },
]

const PAYLOAD_POLICY_OPTIONS: { value: PayloadPolicyMode; labelKey: string }[] = [
  { value: 'off', labelKey: 'settings.payloadOff' },
  { value: 'warn', labelKey: 'settings.payloadWarn' },
  { value: 'block', labelKey: 'settings.payloadBlock' },
]

const PROXY_OPTIONS: { value: ProxyMode; labelKey: string }[] = [
  { value: 'off', labelKey: 'settings.proxyOff' },
  { value: 'custom-base-url', labelKey: 'settings.proxyCustomBaseUrl' },
  { value: 'system-detected', labelKey: 'settings.proxySystemDetected' },
]

const CACHE_TTL_OPTIONS: { value: BedrockCacheTtl; labelKey: string }[] = [
  { value: 'default', labelKey: 'settings.cacheTtlDefault' },
  { value: '5m', labelKey: 'settings.cacheTtl5m' },
  { value: '1h', labelKey: 'settings.cacheTtl1h' },
]

type SettingsAdvancedGroup = 'diagnostics' | 'governance' | 'updates' | 'danger'

export function SettingsScreenContent({ active = true, onHome }: { active?: boolean; onHome?: () => void } = {}) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const { t } = useTranslation()
  const pathname = usePathname()
  const dialog = useIsleDialog()
  const providers = useSettingsStore((state) => state.providers)
  const settings = useSettingsStore((state) => state.settings)
  const setTheme = useSettingsStore((state) => state.setTheme)
  const setThemeId = useSettingsStore((state) => state.setThemeId)
  const setLanguage = useSettingsStore((state) => state.setLanguage)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const resetSettings = useSettingsStore((state) => state.clearAll)
  const clearChats = useChatStore((state) => state.clearAll)
  const scrollRef = useRef<ScrollView>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnosticsSummary | null>(null)
  const [refreshingDiagnostics, setRefreshingDiagnostics] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Record<SettingsAdvancedGroup, boolean>>({
    diagnostics: false,
    governance: false,
    updates: false,
    danger: false,
  })
  const enabledProviders = providers.filter((provider) => provider.enabled).length
  const defaultProvider = providers.find((provider) => provider.id === settings.defaultProvider)
  const version = getVersionSnapshot()
  const searchProvider = resolveSearchProvider(settings)
  const activeThemeId = settings.themeId ?? 'island'
  const foldoutBodyStyle = { marginTop: 8, borderRadius: 24, padding: 12, backgroundColor: colors.material.paper, borderWidth: 1, borderColor: colors.border, gap: 12 }
  const foldoutMotion = motion === 'full'
    ? { type: 'spring' as const, ...motionTokens.spring.gentle }
    : { type: 'timing' as const, duration: 1 }
  const diagnosticRows = useMemo(() => diagnostics ? buildDiagnosticRows(diagnostics, t) : [], [diagnostics, t])

  useEffect(() => {
    if (!active) return
    scrollRef.current?.scrollTo({ y: 0, animated: false })
  }, [active])

  useEffect(() => {
    if (!active || pathname !== '/settings') return
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false })
    })
  }, [active, pathname])

  useEffect(() => {
    if (!active) return
    void refreshRuntimeDiagnostics()
  }, [active, providers, settings])

  async function exportJson() {
    const uri = await exportToJsonFile()
    dialog.notice({ title: t('settings.exportDone'), message: t('settings.exportDoneMessage', { uri }), tone: 'mint' })
  }

  async function importJson() {
    const result = await importFromJsonFileDetailed()
    if (result.ok && result.kind === 'mem0') {
      const reviewNow = await dialog.confirm({
        title: t('settings.importDone'),
        message: importResultMessage(result, t),
        confirmLabel: t('settings.reviewImportedMemories'),
        cancelLabel: t('settings.reviewImportedMemoriesLater'),
        tone: 'mint',
      })
      if (reviewNow) router.push('/settings/memory?focus=review')
      return
    }
    dialog.notice({
      title: result.ok ? t('settings.importDone') : t('settings.importSkipped'),
      message: importResultMessage(result, t),
      tone: result.ok ? 'mint' : 'amber',
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
    if (checkingUpdate) return
    setCheckingUpdate(true)
    try {
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
    } finally {
      setCheckingUpdate(false)
    }
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
    dialog.toast({ title: next ? t('settings.autoCheckOn') : t('settings.autoCheckOff'), tone: next ? 'mint' : 'amber' })
  }

  function toggleExpandedGroup(group: SettingsAdvancedGroup) {
    setExpandedGroups((current) => ({ ...current, [group]: !current[group] }))
  }

  async function chooseLanguage(language: Language) {
    setLanguage(language)
    await changeAppLanguage(language)
    dialog.toast({ title: t('settings.languageUpdated'), message: LANGUAGE_OPTIONS.find((item) => item.id === language)?.label, tone: 'mint' })
  }

  function updateSettingsList(key: 'providerAllowlist' | 'providerBlocklist' | 'modelAllowlist' | 'modelBlocklist', value: string) {
    const list = parseSettingsList(value)
    if (key === 'providerAllowlist') updateSettings({ providerAllowlist: list })
    if (key === 'providerBlocklist') updateSettings({ providerBlocklist: list })
    if (key === 'modelAllowlist') updateSettings({ modelAllowlist: list })
    if (key === 'modelBlocklist') updateSettings({ modelBlocklist: list })
  }

  function updatePositiveInteger(
    key: 'runtimeLogMaxBytes' | 'sessionConcurrencyLimit' | 'sessionQueueTimeoutMs' | 'upstreamRequestTimeoutMs' | 'upstreamMaxRetries' | 'upstreamCircuitBreakerFailureThreshold' | 'upstreamCircuitBreakerCooldownMs',
    value: string,
    fallback: number,
    min: number,
    max: number
  ) {
    const parsed = Number.parseInt(value, 10)
    const next = Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback
    if (key === 'runtimeLogMaxBytes') updateSettings({ runtimeLogMaxBytes: next })
    if (key === 'sessionConcurrencyLimit') updateSettings({ sessionConcurrencyLimit: next })
    if (key === 'sessionQueueTimeoutMs') updateSettings({ sessionQueueTimeoutMs: next })
    if (key === 'upstreamRequestTimeoutMs') updateSettings({ upstreamRequestTimeoutMs: next })
    if (key === 'upstreamMaxRetries') updateSettings({ upstreamMaxRetries: next })
    if (key === 'upstreamCircuitBreakerFailureThreshold') updateSettings({ upstreamCircuitBreakerFailureThreshold: next })
    if (key === 'upstreamCircuitBreakerCooldownMs') updateSettings({ upstreamCircuitBreakerCooldownMs: next })
  }

  function updateRemoteCompactThreshold(value: string) {
    const parsed = Number.parseFloat(value)
    const next = Number.isFinite(parsed) ? Math.max(0.1, Math.min(2, parsed)) : 0.8
    updateSettings({ remoteCompactThreshold: next })
  }

  async function refreshRuntimeDiagnostics() {
    setRefreshingDiagnostics(true)
    const summary = await buildRuntimeDiagnosticsSummary({ providers, settings })
    setDiagnostics(summary)
    setRefreshingDiagnostics(false)
  }

  async function copyRuntimeLogTail() {
    const text = await readRuntimeLogText()
    await Clipboard.setStringAsync(text || t('settings.runtimeLogEmpty'))
    dialog.toast({ title: t('settings.runtimeLogCopied'), tone: 'mint' })
  }

  async function shareRuntimeLogFile() {
    const path = getRuntimeLogPath()
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(path, { mimeType: 'application/json', dialogTitle: t('settings.runtimeLogShare') })
      return
    }
    await copyRuntimeLogTail()
  }

  async function clearRuntimeLogFile() {
    await clearRuntimeLog()
    await refreshRuntimeDiagnostics()
    dialog.toast({ title: t('settings.runtimeLogCleared'), tone: 'amber' })
  }

  return (
    <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 120 }}>
      <IsleHeader
        title={t('settings.title')}
        leading={
          onHome ? (
            <AnimatedNavigationTrigger variant="iconButton" label={t('common.home')} size="lg" glyph="home" onNavigate={onHome} color={colors.text} />
          ) : undefined
        }
      />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        <IsleMetric label={`${t('settings.enabled')} ${enabledProviders}`} />
        <IsleMetric label={defaultProvider ? `${t('settings.default')} ${defaultProvider.name}` : t('settings.noDefault')} />
        <IsleMetric label={searchProvider !== 'off' ? `${t('settings.search')} ${searchProviderLabel(searchProvider)}` : t('settings.searchOff')} />
      </View>

      <IsleTitle color="app-teal" style={{ marginTop: 18 }}>{t('settings.aiSettings')}</IsleTitle>
      <IsleSection style={{ marginTop: 8 }}>
        <View style={{ gap: 8 }}>
          <SettingLink title={t('settings.providerManagement')} description={`${enabledProviders} ${t('settings.enabled')} · ${providers.length} ${t('settings.providers')}`} glyph="provider-key" onPress={() => router.push('/settings/providers')} />
          <SettingLink title={t('settings.context')} description={t('settings.contextDescription')} glyph="context-globe" onPress={() => router.push('/settings/context')} />
          <SettingLink title={t('settings.memory')} description={t('settings.memoryDescription')} glyph="memory-brain" onPress={() => router.push('/settings/memory')} />
          <SettingLink title={t('settings.knowledge')} description={t('settings.knowledgeDescription')} glyph="knowledge-database" onPress={() => router.push('/settings/knowledge')} />
          <SettingLink title={t('settings.preferences')} description={t('settings.preferencesDescription')} glyph="preferences-sliders" onPress={() => router.push('/settings/preferences')} />
          <SettingLink title={t('settings.skills')} description={t('settings.skillsDescription')} glyph="skills-sparkles" onPress={() => router.push('/settings/skills')} />
          <SettingLink title={t('settings.mcp')} description={t('settings.mcpDescription')} glyph="mcp-network" onPress={() => router.push('/settings/mcp')} />
        </View>
      </IsleSection>

      <IsleTitle color="app-green" variant="cloud" style={{ marginTop: 18 }}>{t('settings.basicFeatures')}</IsleTitle>
      <IsleSection style={{ marginTop: 8 }}>
        <View style={{ gap: 10 }}>
          <IsleToggle
            icon={<Brain color={colors.text} size={18} />}
            title={t('settings.longMemory')}
            active={!!settings.memoryEnabled}
            onPress={() => updateSettings({ memoryEnabled: !settings.memoryEnabled })}
          />
          <IsleToggle
            icon={<BookOpen color={colors.text} size={18} />}
            title={t('settings.localKnowledge')}
            active={!!settings.knowledgeEnabled}
            onPress={() => updateSettings({ knowledgeEnabled: !settings.knowledgeEnabled })}
          />
          <IsleToggle
            icon={<Globe2 color={colors.text} size={18} />}
            title={t('settings.webSearch')}
            active={!!settings.webSearchEnabled}
            onPress={() => updateSettings({ webSearchEnabled: !settings.webSearchEnabled })}
          />
        </View>
      </IsleSection>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
        <IsleSection title={t('settings.themeFamily')} style={{ flexGrow: 1, flexBasis: 220 }} contentStyle={{ padding: 12 }}>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {THEME_FAMILY_OPTIONS.map((item) => (
              <ThemeFamilyCard
                key={item.id}
                label={t(item.labelKey)}
                detail={t(item.detailKey)}
                active={activeThemeId === item.id}
                onPress={() => setThemeId(item.id)}
              />
            ))}
          </View>
        </IsleSection>
        <IsleSection title={t('settings.themeMode')} style={{ flexGrow: 1, flexBasis: 160 }} contentStyle={{ padding: 12 }}>
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row' }}>
              <ThemeModeCard
                label={t('settings.themeSystem')}
                active={settings.theme === 'system'}
                onPress={() => setTheme('system')}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['dark', 'light'] satisfies ThemeMode[]).map((item) => (
                <ThemeModeCard
                  key={item}
                  label={item === 'dark' ? t('settings.themeDark') : t('settings.themeLight')}
                  active={settings.theme === item}
                  onPress={() => setTheme(item)}
                />
              ))}
            </View>
          </View>
        </IsleSection>
        <IsleSection title={t('settings.language')} style={{ flexGrow: 1, flexBasis: 160 }} contentStyle={{ padding: 12 }}>
          <View style={{ gap: 8 }}>
            {LANGUAGE_OPTIONS.map((item) => (
              <IslePressable key={item.id} haptic onPress={() => void chooseLanguage(item.id)} style={settingsChipPressableStyle}>
                <IsleChip active={settings.language === item.id}>{settings.language === item.id ? t('settings.current') : item.label}</IsleChip>
              </IslePressable>
            ))}
          </View>
        </IsleSection>
      </View>

      <IsleTitle color="app-yellow" size="small" style={{ marginTop: 18 }}>{t('settings.importExport')}</IsleTitle>
      <IsleSection style={{ marginTop: 8 }}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <DataButton label={t('settings.exportJson')} icon={<Download color={colors.surface} size={18} />} onPress={() => void exportJson()} />
          <DataButton label={t('settings.importJson')} icon={<Upload color={colors.surface} size={18} />} onPress={() => void importJson()} />
        </View>
        <Text style={{ marginTop: 10, color: colors.textTertiary, fontSize: 12, fontWeight: '700', lineHeight: 18 }}>
          {t('settings.importExportDescription')}
        </Text>
      </IsleSection>

      <View style={{ gap: 8, marginTop: 14 }}>
        <IsleDisclosure
          title={t('settings.runtimeDiagnostics')}
          summary={t('settings.runtimeDiagnosticsSubtitle')}
          expanded={expandedGroups.diagnostics}
          onPress={() => toggleExpandedGroup('diagnostics')}
        />
        <AnimatePresence>
        {expandedGroups.diagnostics ? (
          <MotiView
            key="diagnostics-foldout"
            from={motion === 'full' ? { opacity: 0, translateY: 8, scale: 0.985 } : { opacity: 0 }}
            animate={{ opacity: 1, translateY: 0, scale: 1 }}
            exit={motion === 'full' ? { opacity: 0, translateY: -4, scale: 0.985 } : { opacity: 0 }}
            transition={foldoutMotion}
            style={foldoutBodyStyle}
          >
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <IsleChip tone={diagnostics?.providers.degraded ? 'amber' : 'mint'}>{diagnostics ? t('settings.runtimeDiagnosticsReady') : t('settings.runtimeDiagnosticsLoading')}</IsleChip>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {diagnosticRows.map((row) => (
                <DiagnosticPill key={row.key} label={row.label} value={row.value} tone={row.tone} />
              ))}
            </View>
            <View style={{ borderRadius: 18, padding: 11, backgroundColor: colors.islandRaised, borderWidth: 1, borderColor: colors.border, gap: 7 }}>
              <Text style={{ color: colors.text, fontSize: 13, fontWeight: '900' }}>{t('settings.runtimeLogFile')}</Text>
              <Text selectable numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, fontWeight: '800' }}>
                {diagnostics?.log.path ?? getRuntimeLogPath()}
              </Text>
              <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, fontWeight: '800' }}>
                {t('settings.runtimeLogState', { size: diagnostics?.log.size ?? 0, max: diagnostics?.log.maxBytes ?? settings.runtimeLogMaxBytes ?? 1048576 })}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <IsleButton label={refreshingDiagnostics ? t('settings.runtimeDiagnosticsRefreshing') : t('settings.runtimeDiagnosticsRefresh')} compact icon={<Activity color={colors.textSecondary} size={15} />} onPress={() => void refreshRuntimeDiagnostics()} disabled={refreshingDiagnostics} />
              <IsleButton label={t('settings.runtimeLogCopy')} compact icon={<FileJson color={colors.textSecondary} size={15} />} onPress={() => void copyRuntimeLogTail()} />
              <IsleButton label={t('settings.runtimeLogShare')} compact icon={<Upload color={colors.textSecondary} size={15} />} onPress={() => void shareRuntimeLogFile()} />
              <IsleButton label={t('settings.runtimeLogClear')} compact tone="danger" icon={<Trash2 color={colors.error} size={15} />} onPress={() => void clearRuntimeLogFile()} />
            </View>
          </MotiView>
        ) : null}
        </AnimatePresence>

        <IsleDisclosure
          title={t('settings.upstreamGovernance')}
          summary={t('settings.upstreamGovernanceSubtitle')}
          expanded={expandedGroups.governance}
          onPress={() => toggleExpandedGroup('governance')}
        />
        <AnimatePresence>
        {expandedGroups.governance ? (
          <MotiView
            key="governance-foldout"
            from={motion === 'full' ? { opacity: 0, translateY: 8, scale: 0.985 } : { opacity: 0 }}
            animate={{ opacity: 1, translateY: 0, scale: 1 }}
            exit={motion === 'full' ? { opacity: 0, translateY: -4, scale: 0.985 } : { opacity: 0 }}
            transition={foldoutMotion}
            style={foldoutBodyStyle}
          >
          <SegmentedSetting
            label={t('settings.transportMode')}
            options={TRANSPORT_OPTIONS}
            value={settings.transportMode ?? 'auto'}
            onChange={(transportMode) => updateSettings({ transportMode })}
          />
          <SegmentedSetting
            label={t('settings.remoteCompactMode')}
            options={REMOTE_COMPACT_OPTIONS}
            value={settings.remoteCompactMode ?? 'off'}
            onChange={(remoteCompactMode) => updateSettings({ remoteCompactMode })}
          />
          <IsleField
            label={t('settings.remoteCompactThreshold')}
            note={t('settings.remoteCompactThresholdNote')}
            inputProps={{
              value: String(settings.remoteCompactThreshold ?? 0.8),
              onChangeText: updateRemoteCompactThreshold,
              keyboardType: 'decimal-pad',
            }}
          />
          <SegmentedSetting
            label={t('settings.payloadPolicyMode')}
            options={PAYLOAD_POLICY_OPTIONS}
            value={settings.payloadPolicyMode ?? 'warn'}
            onChange={(payloadPolicyMode) => updateSettings({ payloadPolicyMode })}
          />
          <View style={{ borderRadius: 18, padding: 11, backgroundColor: colors.islandRaised, borderWidth: 1, borderColor: colors.border, gap: 8 }}>
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '900' }}>{t('settings.policySummary')}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
              <IsleChip tone={(settings.payloadPolicyMode ?? 'warn') === 'block' ? 'amber' : 'default'}>
                {t('settings.policyPayloadSummary', { mode: t(`settings.payload${(settings.payloadPolicyMode ?? 'warn') === 'off' ? 'Off' : (settings.payloadPolicyMode ?? 'warn') === 'warn' ? 'Warn' : 'Block'}`) })}
              </IsleChip>
              <IsleChip tone="default">{t('settings.policyBuiltInRules', { count: 4 })}</IsleChip>
              <IsleChip tone={(settings.providerBlocklist?.length ?? 0) || (settings.modelBlocklist?.length ?? 0) ? 'amber' : 'default'}>
                {t('settings.policyBlockRules', { count: (settings.providerBlocklist?.length ?? 0) + (settings.modelBlocklist?.length ?? 0) })}
              </IsleChip>
              <IsleChip tone={(settings.providerAllowlist?.length ?? 0) || (settings.modelAllowlist?.length ?? 0) ? 'mint' : 'default'}>
                {t('settings.policyAllowRules', { count: (settings.providerAllowlist?.length ?? 0) + (settings.modelAllowlist?.length ?? 0) })}
              </IsleChip>
            </View>
            <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, fontWeight: '800' }}>{t('settings.policySummaryNote')}</Text>
          </View>
          <SegmentedSetting
            label={t('settings.proxyMode')}
            options={PROXY_OPTIONS}
            value={settings.proxyMode ?? 'off'}
            onChange={(proxyMode) => updateSettings({ proxyMode })}
          />
          <IsleField
            label={t('settings.proxyBaseUrl')}
            note={t('settings.proxyBaseUrlNote')}
            inputProps={{
              value: settings.proxyBaseUrl ?? '',
              onChangeText: (proxyBaseUrl) => updateSettings({ proxyBaseUrl }),
              placeholder: 'https://proxy.example/upstream',
              autoCapitalize: 'none',
              autoCorrect: false,
            }}
          />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <IsleField
              label={t('settings.sessionConcurrencyLimit')}
              inputProps={{
                value: String(settings.sessionConcurrencyLimit ?? 1),
                onChangeText: (value) => updatePositiveInteger('sessionConcurrencyLimit', value, 1, 1, 8),
                keyboardType: 'number-pad',
              }}
              style={{ flex: 1 }}
            />
            <IsleField
              label={t('settings.sessionQueueTimeoutMs')}
              inputProps={{
                value: String(settings.sessionQueueTimeoutMs ?? 1500),
                onChangeText: (value) => updatePositiveInteger('sessionQueueTimeoutMs', value, 1500, 0, 30000),
                keyboardType: 'number-pad',
              }}
              style={{ flex: 1 }}
            />
          </View>
          <View style={{ borderRadius: 18, padding: 11, backgroundColor: colors.islandRaised, borderWidth: 1, borderColor: colors.border, gap: 10 }}>
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '900' }}>{t('settings.retryTimeoutSettings')}</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <IsleField
                label={t('settings.upstreamRequestTimeoutMs')}
                inputProps={{
                  value: String(settings.upstreamRequestTimeoutMs ?? 60000),
                  onChangeText: (value) => updatePositiveInteger('upstreamRequestTimeoutMs', value, 60000, 5000, 300000),
                  keyboardType: 'number-pad',
                }}
                style={{ flex: 1 }}
              />
              <IsleField
                label={t('settings.upstreamMaxRetries')}
                inputProps={{
                  value: String(settings.upstreamMaxRetries ?? 1),
                  onChangeText: (value) => updatePositiveInteger('upstreamMaxRetries', value, 1, 0, 5),
                  keyboardType: 'number-pad',
                }}
                style={{ flex: 1 }}
              />
            </View>
            <IsleToggle
              title={t('settings.upstreamCircuitBreakerEnabled')}
              active={settings.upstreamCircuitBreakerEnabled !== false}
              onPress={() => updateSettings({ upstreamCircuitBreakerEnabled: settings.upstreamCircuitBreakerEnabled === false })}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <IsleField
                label={t('settings.upstreamCircuitBreakerFailureThreshold')}
                inputProps={{
                  value: String(settings.upstreamCircuitBreakerFailureThreshold ?? 3),
                  onChangeText: (value) => updatePositiveInteger('upstreamCircuitBreakerFailureThreshold', value, 3, 1, 20),
                  keyboardType: 'number-pad',
                }}
                style={{ flex: 1 }}
              />
              <IsleField
                label={t('settings.upstreamCircuitBreakerCooldownMs')}
                inputProps={{
                  value: String(settings.upstreamCircuitBreakerCooldownMs ?? 60000),
                  onChangeText: (value) => updatePositiveInteger('upstreamCircuitBreakerCooldownMs', value, 60000, 1000, 3600000),
                  keyboardType: 'number-pad',
                }}
                style={{ flex: 1 }}
              />
            </View>
          </View>
          <View style={{ borderRadius: 18, padding: 11, backgroundColor: colors.islandRaised, borderWidth: 1, borderColor: colors.border, gap: 10 }}>
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '900' }}>{t('settings.rectificationSettings')}</Text>
            <IsleToggle title={t('settings.requestRectificationEnabled')} active={settings.requestRectificationEnabled !== false} onPress={() => updateSettings({ requestRectificationEnabled: settings.requestRectificationEnabled === false })} />
            <IsleToggle title={t('settings.anthropicThinkingSignatureRectificationEnabled')} active={settings.anthropicThinkingSignatureRectificationEnabled !== false} onPress={() => updateSettings({ anthropicThinkingSignatureRectificationEnabled: settings.anthropicThinkingSignatureRectificationEnabled === false })} />
            <IsleToggle title={t('settings.anthropicThinkingBudgetRectificationEnabled')} active={settings.anthropicThinkingBudgetRectificationEnabled !== false} onPress={() => updateSettings({ anthropicThinkingBudgetRectificationEnabled: settings.anthropicThinkingBudgetRectificationEnabled === false })} />
          </View>
          <View style={{ borderRadius: 18, padding: 11, backgroundColor: colors.islandRaised, borderWidth: 1, borderColor: colors.border, gap: 10 }}>
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '900' }}>{t('settings.bedrockOptimizerSettings')}</Text>
            <IsleToggle title={t('settings.bedrockRequestOptimizerEnabled')} active={settings.bedrockRequestOptimizerEnabled === true} onPress={() => updateSettings({ bedrockRequestOptimizerEnabled: settings.bedrockRequestOptimizerEnabled !== true })} />
            <IsleToggle title={t('settings.thinkingOptimizerEnabled')} active={settings.thinkingOptimizerEnabled === true} onPress={() => updateSettings({ thinkingOptimizerEnabled: settings.thinkingOptimizerEnabled !== true })} />
            <IsleToggle title={t('settings.cacheInjectionEnabled')} active={settings.cacheInjectionEnabled === true} onPress={() => updateSettings({ cacheInjectionEnabled: settings.cacheInjectionEnabled !== true })} />
            <SegmentedSetting label={t('settings.cacheTtl')} options={CACHE_TTL_OPTIONS} value={settings.cacheTtl ?? 'default'} onChange={(cacheTtl) => updateSettings({ cacheTtl })} />
          </View>
          <View style={{ borderRadius: 18, padding: 11, backgroundColor: colors.islandRaised, borderWidth: 1, borderColor: colors.border, gap: 10 }}>
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '900' }}>{t('settings.modelTestSettings')}</Text>
            <IsleField
              label={t('settings.modelTestModel')}
              note={t('settings.modelTestModelNote')}
              inputProps={{
                value: settings.modelTestModel ?? '',
                onChangeText: (modelTestModel) => updateSettings({ modelTestModel }),
                autoCapitalize: 'none',
                autoCorrect: false,
              }}
            />
            <IsleToggle title={t('settings.modelTestCheckParameters')} active={settings.modelTestCheckParameters !== false} onPress={() => updateSettings({ modelTestCheckParameters: settings.modelTestCheckParameters === false })} />
          </View>
          <IsleToggle
            title={t('settings.runtimeLogEnabled')}
            description={t('settings.runtimeLogDescription', { path: getRuntimeLogPath() })}
            active={settings.runtimeLogEnabled === true}
            onPress={() => updateSettings({ runtimeLogEnabled: settings.runtimeLogEnabled !== true })}
          />
          <IsleField
            label={t('settings.runtimeLogMaxBytes')}
            note={t('settings.runtimeLogMaxBytesNote')}
            inputProps={{
              value: String(settings.runtimeLogMaxBytes ?? 1048576),
              onChangeText: (value) => updatePositiveInteger('runtimeLogMaxBytes', value, 1048576, 4096, 10485760),
              keyboardType: 'number-pad',
            }}
          />
          <View style={{ gap: 10 }}>
            <IsleField
              label={t('settings.providerAllowlist')}
              note={t('settings.listRuleNote')}
              inputProps={{ value: joinSettingsList(settings.providerAllowlist), onChangeText: (value) => updateSettingsList('providerAllowlist', value), autoCapitalize: 'none', autoCorrect: false, multiline: true, style: { minHeight: 54, maxHeight: 96 } }}
            />
            <IsleField
              label={t('settings.providerBlocklist')}
              note={t('settings.blocklistNote')}
              inputProps={{ value: joinSettingsList(settings.providerBlocklist), onChangeText: (value) => updateSettingsList('providerBlocklist', value), autoCapitalize: 'none', autoCorrect: false, multiline: true, style: { minHeight: 54, maxHeight: 96 } }}
            />
            <IsleField
              label={t('settings.modelAllowlist')}
              note={t('settings.listRuleNote')}
              inputProps={{ value: joinSettingsList(settings.modelAllowlist), onChangeText: (value) => updateSettingsList('modelAllowlist', value), autoCapitalize: 'none', autoCorrect: false, multiline: true, style: { minHeight: 54, maxHeight: 96 } }}
            />
            <IsleField
              label={t('settings.modelBlocklist')}
              note={t('settings.blocklistNote')}
            inputProps={{ value: joinSettingsList(settings.modelBlocklist), onChangeText: (value) => updateSettingsList('modelBlocklist', value), autoCapitalize: 'none', autoCorrect: false, multiline: true, style: { minHeight: 54, maxHeight: 96 } }}
            />
          </View>
        </MotiView>
        ) : null}
        </AnimatePresence>

        <IsleDisclosure
          title={t('settings.updates')}
          summary={`${version.appVersion} (${version.buildVersion}) · ${formatUpdateCheckTime(settings.lastApkUpdateCheckAt)}`}
          expanded={expandedGroups.updates}
          onPress={() => toggleExpandedGroup('updates')}
        />
        <AnimatePresence>
        {expandedGroups.updates ? (
          <MotiView
            key="updates-foldout"
            from={motion === 'full' ? { opacity: 0, translateY: 8, scale: 0.985 } : { opacity: 0 }}
            animate={{ opacity: 1, translateY: 0, scale: 1 }}
            exit={motion === 'full' ? { opacity: 0, translateY: -4, scale: 0.985 } : { opacity: 0 }}
            transition={foldoutMotion}
            style={foldoutBodyStyle}
          >
            <View style={{ borderRadius: 22, padding: 13, backgroundColor: colors.material.paperRaised, borderWidth: 1, borderColor: colors.border }}>
              <VersionRow label={t('settings.appVersion')} value={`${version.appVersion} (${version.buildVersion})`} />
              <VersionRow label={t('settings.lastCheck')} value={formatUpdateCheckTime(settings.lastApkUpdateCheckAt)} />
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <DataButton
                  label={checkingUpdate ? t('settings.checkingUpdate') : t('settings.checkApk')}
                  icon={checkingUpdate ? <ActivityIndicator color={colors.surface} /> : <Smartphone color={colors.surface} size={18} />}
                  onPress={() => void checkApkUpdate()}
                />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <IsleToggle
                  icon={<RotateCcw color={colors.text} size={18} />}
                  title={t('settings.autoCheck')}
                  active={settings.autoUpdateCheckEnabled ?? true}
                  onPress={toggleAutoCheck}
                />
              </View>
            </View>
          </MotiView>
        ) : null}
        </AnimatePresence>

        <IsleDisclosure
          title={t('settings.dangerZone')}
          expanded={expandedGroups.danger}
          onPress={() => toggleExpandedGroup('danger')}
          danger
        />
        <AnimatePresence>
        {expandedGroups.danger ? (
          <MotiView
            key="danger-foldout"
            from={motion === 'full' ? { opacity: 0, translateY: 8, scale: 0.985 } : { opacity: 0 }}
            animate={{ opacity: 1, translateY: 0, scale: 1 }}
            exit={motion === 'full' ? { opacity: 0, translateY: -4, scale: 0.985 } : { opacity: 0 }}
            transition={foldoutMotion}
            style={foldoutBodyStyle}
          >
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <DangerButton label={t('settings.clearChats')} icon={<Trash2 color={colors.error} size={18} />} onPress={confirmClearChats} />
              <DangerButton label={t('settings.resetSettings')} icon={<RotateCcw color={colors.error} size={18} />} onPress={confirmResetSettings} />
            </View>
          </MotiView>
        ) : null}
        </AnimatePresence>
      </View>
    </ScrollView>
  )
}

function SettingLink({ title, description, glyph, onPress }: { title: string; description: string; glyph: NavigationGlyph; onPress: () => void }) {
  return <AnimatedNavigationTrigger variant="listItem" title={title} description={description} glyph={glyph} onNavigate={onPress} />
}

function ThemeFamilyCard({
  label,
  detail,
  active,
  onPress,
}: {
  label: string
  detail: string
  active: boolean
  onPress: () => void
}) {
  const { colors } = useAppTheme()
  return (
    <IslePressable haptic onPress={onPress} style={{ flexGrow: 1, flexBasis: 150, minHeight: 82 }}>
      <View
        style={{
          minHeight: 82,
          borderRadius: colors.ui.radius.card,
          padding: 11,
          justifyContent: 'center',
          backgroundColor: active ? colors.mintSoft : colors.material.paperRaised,
          borderWidth: 2,
          borderColor: active ? colors.primary : colors.border,
          gap: 6,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: active ? colors.primary : colors.textTertiary }} />
          <Text numberOfLines={1} style={{ flex: 1, color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: '900' }}>
            {label}
          </Text>
        </View>
        <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, fontWeight: '800' }}>
          {detail}
        </Text>
      </View>
    </IslePressable>
  )
}

function ThemeModeCard({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  return (
    <IslePressable haptic onPress={onPress} style={{ flex: 1, minHeight: themeModeCardHeight }}>
      <View
        style={{
          minHeight: themeModeCardHeight,
          borderRadius: colors.ui.radius.card,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: active ? colors.text : colors.material.paperRaised,
          borderWidth: active ? 0 : 1,
          borderColor: colors.border,
          paddingHorizontal: 10,
        }}
      >
        <Text numberOfLines={1} style={{ color: active ? colors.surface : colors.textSecondary, fontSize: 13, lineHeight: 18, fontWeight: '900', includeFontPadding: false, textAlignVertical: 'center' }}>
          {label}
        </Text>
      </View>
    </IslePressable>
  )
}

function SegmentedSetting<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { value: T; labelKey: string }[]
  value: T
  onChange: (value: T) => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  return (
    <View>
      <Text style={{ color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '900', marginBottom: 7, includeFontPadding: false, textAlignVertical: 'center' }}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {options.map((option) => (
          <IslePressable key={option.value} haptic onPress={() => onChange(option.value)} style={settingsChipPressableStyle}>
            <IsleChip active={option.value === value}>{t(option.labelKey)}</IsleChip>
          </IslePressable>
        ))}
      </View>
    </View>
  )
}

function parseSettingsList(value: string): string[] {
  return Array.from(new Set(
    value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
  ))
}

function joinSettingsList(value: string[] | undefined): string {
  return (value ?? []).join('\n')
}

function buildDiagnosticRows(diagnostics: RuntimeDiagnosticsSummary, t: ReturnType<typeof useTranslation>['t']): Array<{ key: string; label: string; value: string; tone: 'mint' | 'amber' | 'danger' | 'default' }> {
  return [
    {
      key: 'websocket',
      label: t('settings.runtimeDiagnosticWebSocket'),
      value: t('settings.runtimeDiagnosticWebSocketValue', {
        mode: t(`settings.transport${diagnostics.websocket.mode === 'auto' ? 'Auto' : diagnostics.websocket.mode === 'http' ? 'Http' : 'WebSocket'}`),
        ready: diagnostics.websocket.readyProviders,
        capable: diagnostics.websocket.capableProviders,
      }),
      tone: diagnostics.websocket.mode === 'websocket' && !diagnostics.websocket.readyProviders ? 'amber' : 'mint',
    },
    {
      key: 'compact',
      label: t('settings.runtimeDiagnosticCompact'),
      value: t('settings.runtimeDiagnosticCompactValue', {
        mode: t(`settings.compact${diagnostics.compact.mode === 'off' ? 'Off' : diagnostics.compact.mode === 'auto' ? 'Auto' : 'Required'}`),
        count: diagnostics.compact.requestCount,
        saved: diagnostics.compact.estimatedSavedTokens,
      }),
      tone: diagnostics.compact.failureCount ? 'amber' : 'mint',
    },
    {
      key: 'policy',
      label: t('settings.runtimeDiagnosticPolicy'),
      value: t('settings.runtimeDiagnosticPolicyValue', {
        payload: t(`settings.payload${diagnostics.policy.payloadMode === 'off' ? 'Off' : diagnostics.policy.payloadMode === 'warn' ? 'Warn' : 'Block'}`),
        rules: diagnostics.policy.providerAllowRules + diagnostics.policy.providerBlockRules + diagnostics.policy.modelAllowRules + diagnostics.policy.modelBlockRules,
      }),
      tone: diagnostics.policy.payloadMode === 'block' ? 'amber' : 'default',
    },
    {
      key: 'proxy',
      label: t('settings.runtimeDiagnosticProxy'),
      value: t(`settings.runtimeProxyReason.${diagnostics.proxy.reason}`),
      tone: diagnostics.proxy.reason === 'invalid_custom_base_url' ? 'danger' : diagnostics.proxy.applied ? 'mint' : 'default',
    },
    {
      key: 'providers',
      label: t('settings.runtimeDiagnosticProviders'),
      value: t('settings.runtimeDiagnosticProvidersValue', {
        ready: diagnostics.providers.ready,
        enabled: diagnostics.providers.enabled,
        alias: diagnostics.providers.aliasProviders,
      }),
      tone: diagnostics.providers.degraded ? 'amber' : 'mint',
    },
    {
      key: 'log',
      label: t('settings.runtimeDiagnosticLog'),
      value: diagnostics.log.enabled ? t('settings.runtimeDiagnosticLogOn') : t('settings.runtimeDiagnosticLogOff'),
      tone: diagnostics.log.enabled ? 'mint' : 'default',
    },
  ]
}

function DiagnosticPill({ label, value, tone }: { label: string; value: string; tone: 'mint' | 'amber' | 'danger' | 'default' }) {
  const { colors } = useAppTheme()
  const background = tone === 'mint' ? colors.mintSoft : tone === 'amber' ? colors.amberSoft : tone === 'danger' ? colors.coralWash : colors.islandRaised
  const marker = tone === 'mint' ? colors.success : tone === 'amber' ? colors.warning : tone === 'danger' ? colors.error : colors.textTertiary
  return (
    <View style={{ minHeight: 68, minWidth: 150, flexGrow: 1, flexBasis: '47%', borderRadius: 18, padding: 11, backgroundColor: background, borderWidth: 1, borderColor: colors.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: marker }} />
        <Text style={{ color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: '900', includeFontPadding: false, textAlignVertical: 'center' }}>{label}</Text>
      </View>
      <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, fontWeight: '800', marginTop: 5, includeFontPadding: false, textAlignVertical: 'center' }}>{value}</Text>
    </View>
  )
}

function importResultMessage(
  result: Awaited<ReturnType<typeof importFromJsonFileDetailed>>,
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!result.ok) return t('settings.importSkippedMessage')
  if (result.kind === 'mem0') return t('settings.importMem0DoneMessage', { count: result.memories })
  return t('settings.importDoneMessage')
}

function VersionRow({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, fontWeight: '900', width: 76, includeFontPadding: false, textAlignVertical: 'center' }}>{label}</Text>
      <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12, lineHeight: 17, fontWeight: '800', flex: 1, includeFontPadding: false, textAlignVertical: 'center' }}>{value}</Text>
    </View>
  )
}

function DataButton({ label, icon, onPress }: { label: string; icon: ReactNode; onPress: () => void }) {
  return <IsleButton label={label} icon={icon} tone="primary" onPress={onPress} style={{ flex: 1, minHeight: 54, borderRadius: 27 }} />
}

function DangerButton({ label, icon, onPress }: { label: string; icon: ReactNode; onPress: () => void }) {
  return <IsleButton label={label} icon={icon} tone="danger" onPress={onPress} style={{ flex: 1, minHeight: 54, borderRadius: 27 }} />
}
