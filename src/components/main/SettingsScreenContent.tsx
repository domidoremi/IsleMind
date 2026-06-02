import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, ScrollView, Text, View } from 'react-native'
import { router, usePathname } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import * as Sharing from 'expo-sharing'
import { Activity, BookOpen, Brain, Database, Download, FileJson, Globe2, House, KeyRound, Network, RotateCcw, ShieldCheck, SlidersHorizontal, Smartphone, Sparkles, Trash2, Upload } from 'lucide-react-native'
import { useTranslation } from 'react-i18next'
import { IslePressable } from '@/components/ui/isle'
import { IsleChip } from '@/components/ui/isle'
import { IsleButton } from '@/components/ui/isle'
import { IsleDisclosure, IsleField, IsleHeader, IsleIconButton, IsleListItem, IsleSection, IsleToggle } from '@/components/ui/isle'
import { IsleMetric } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import { useChatStore } from '@/store/chatStore'
import { exportToJsonFile, importFromJsonFileDetailed } from '@/services/portableData'
import { checkLatestApkRelease, downloadAndOpenApkInstaller, formatUpdateCheckTime, getVersionSnapshot, type ApkReleaseInfo } from '@/services/appUpdates'
import { listKnowledgeDocuments, listMemories } from '@/services/contextStore'
import { useIsleDialog } from '@/components/ui/isle'
import { resolveSearchProvider, searchProviderLabel } from '@/services/searchPolicy'
import { clearRuntimeLog, getRuntimeLogPath, readRuntimeLogText } from '@/services/runtimeLog'
import { buildRuntimeDiagnosticsSummary, type RuntimeDiagnosticsSummary } from '@/services/runtimeDiagnostics'
import { changeAppLanguage } from '@/i18n'
import { buildWorkspaceReadiness, type WorkspaceReadinessContextHealth, type WorkspaceReadinessItem, type WorkspaceReadinessKey, type WorkspaceReadinessStatus } from '@/utils/workspaceReadiness'
import type { BedrockCacheTtl, Language, PayloadPolicyMode, ProxyMode, RemoteCompactMode, ThemeMode, UpstreamTransportMode } from '@/types'

const LANGUAGE_OPTIONS: { id: Language; label: string; detail: string }[] = [
  { id: 'zh-CN', label: '简体中文', detail: '中文界面' },
  { id: 'en', label: 'English', detail: 'English UI' },
  { id: 'ja', label: '日本語', detail: '日本語 UI' },
]

const settingsChipPressableStyle = { minHeight: 44, justifyContent: 'center' as const }

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
  const { t } = useTranslation()
  const pathname = usePathname()
  const dialog = useIsleDialog()
  const providers = useSettingsStore((state) => state.providers)
  const settings = useSettingsStore((state) => state.settings)
  const setTheme = useSettingsStore((state) => state.setTheme)
  const setLanguage = useSettingsStore((state) => state.setLanguage)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const resetSettings = useSettingsStore((state) => state.clearAll)
  const clearChats = useChatStore((state) => state.clearAll)
  const scrollRef = useRef<ScrollView>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [contextHealth, setContextHealth] = useState<WorkspaceReadinessContextHealth>({ loading: true })
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
  const readiness = buildWorkspaceReadiness({ providers, settings, contextHealth })
  const foldoutBodyStyle = { marginTop: 8, borderRadius: 24, padding: 12, backgroundColor: colors.material.paper, borderWidth: 1, borderColor: colors.border, gap: 12 }
  const diagnosticRows = useMemo(() => diagnostics ? buildDiagnosticRows(diagnostics, t) : [], [diagnostics, t])
  const readinessItems = readiness.items.map((item) => ({
    ...item,
    title: readinessTitle(item.key, t),
    description: readinessDescription(item, t),
    icon: readinessIcon(item.key, colors.text),
    onPress: readinessRoute(item.key, item.status),
  }))
  const primaryReadinessAction = readiness.primaryAction
    ? {
      title: readinessTitle(readiness.primaryAction.key, t),
      description: readinessPrimaryActionDescription(readiness.primaryAction, t),
      onPress: readinessRoute(readiness.primaryAction.key, readiness.primaryAction.status),
    }
    : null

  useEffect(() => {
    if (!active) return
    scrollRef.current?.scrollTo({ y: 0, animated: false })
    let mounted = true
    async function loadContextHealth() {
      setContextHealth((current) => ({ ...current, loading: true }))
      try {
        const [memories, documents] = await Promise.all([
          listMemories(['pending', 'active', 'disabled']),
          listKnowledgeDocuments(),
        ])
        if (!mounted) return
        setContextHealth({
          loading: false,
          memoryCount: memories.filter((memory) => memory.status !== 'disabled').length,
          activeMemoryCount: memories.filter((memory) => memory.status === 'active').length,
          pendingMemoryCount: memories.filter((memory) => memory.status === 'pending').length,
          knowledgeDocumentCount: documents.filter((document) => document.status === 'ready').length,
          knowledgeChunkCount: documents.filter((document) => document.status === 'ready').reduce((total, document) => total + document.chunkCount, 0),
          failedKnowledgeDocumentCount: documents.filter((document) => document.status === 'error').length,
        })
      } catch {
        if (!mounted) return
        setContextHealth({ loading: false })
      }
    }
    void loadContextHealth()
    return () => {
      mounted = false
    }
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
            <IsleIconButton label={t('common.home')} size="lg" onPress={onHome}>
              <House color={colors.text} size={20} strokeWidth={1.9} />
            </IsleIconButton>
          ) : undefined
        }
      />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        <IsleMetric label={`${t('settings.enabled')} ${enabledProviders}`} />
        <IsleMetric label={defaultProvider ? `${t('settings.default')} ${defaultProvider.name}` : t('settings.noDefault')} />
        <IsleMetric label={searchProvider !== 'off' ? `${t('settings.search')} ${searchProviderLabel(searchProvider)}` : t('settings.searchOff')} />
      </View>

      <IsleSection
        title={t('settings.readiness.title')}
        subtitle={t('settings.readiness.subtitle')}
        action={<IsleChip tone={readiness.readyCount === readiness.totalCount ? 'mint' : 'amber'}>{t('settings.readiness.score', { ready: readiness.readyCount, total: readiness.totalCount })}</IsleChip>}
        style={{ marginTop: 18 }}
      >
        <View style={{ gap: 8 }}>
          {primaryReadinessAction ? (
            <IsleListItem
              title={t('settings.readiness.primaryActionTitle')}
              description={t('settings.readiness.primaryActionDescription', {
                title: primaryReadinessAction.title,
                action: primaryReadinessAction.description,
              })}
              leading={<IconWrap><Sparkles color={colors.text} size={18} /></IconWrap>}
              trailing={<IsleChip tone="amber">{t('settings.readiness.next')}</IsleChip>}
              onPress={primaryReadinessAction.onPress}
            />
          ) : (
            <IsleListItem
              title={t('settings.readiness.primaryReadyTitle')}
              description={t('settings.readiness.primaryReadyDescription')}
              leading={<IconWrap><ShieldCheck color={colors.text} size={18} /></IconWrap>}
              trailing={<IsleChip tone="mint">{t('settings.readiness.ready')}</IsleChip>}
            />
          )}
          {readinessItems.map((item) => (
            <IsleListItem
              key={item.key}
              title={item.title}
              description={item.description}
              leading={<IconWrap>{item.icon}</IconWrap>}
              trailing={<IsleChip tone={readinessTone(item.status)}>{t(`settings.readiness.${item.status}`)}</IsleChip>}
              onPress={item.onPress}
            />
          ))}
        </View>
      </IsleSection>

      <IsleSection title={t('settings.aiSettings')} style={{ marginTop: 14 }}>
        <View style={{ gap: 8 }}>
          <SettingLink title={t('settings.providerManagement')} description={`${enabledProviders} ${t('settings.enabled')} · ${providers.length} ${t('settings.providers')}`} icon={<KeyRound color={colors.text} size={18} />} onPress={() => router.push('/settings/providers')} />
          <SettingLink title={t('settings.context')} description={t('settings.contextDescription')} icon={<Globe2 color={colors.text} size={18} />} onPress={() => router.push('/settings/context')} />
          <SettingLink title={t('settings.memory')} description={t('settings.memoryDescription')} icon={<Brain color={colors.text} size={18} />} onPress={() => router.push('/settings/memory')} />
          <SettingLink title={t('settings.knowledge')} description={t('settings.knowledgeDescription')} icon={<Database color={colors.text} size={18} />} onPress={() => router.push('/settings/knowledge')} />
          <SettingLink title={t('settings.preferences')} description={t('settings.preferencesDescription')} icon={<SlidersHorizontal color={colors.text} size={18} />} onPress={() => router.push('/settings/preferences')} />
          <SettingLink title={t('settings.skills')} description={t('settings.skillsDescription')} icon={<Sparkles color={colors.text} size={18} />} onPress={() => router.push('/settings/skills')} />
          <SettingLink title={t('settings.mcp')} description={t('settings.mcpDescription')} icon={<Network color={colors.text} size={18} />} onPress={() => router.push('/settings/mcp')} />
        </View>
      </IsleSection>

      <IsleSection title={t('settings.basicFeatures')} style={{ marginTop: 14 }}>
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
          <IsleToggle
            icon={<Sparkles color={colors.text} size={18} />}
            title={`${t('settings.pet')} · ${t('settings.experimental')}`}
            description={t('settings.petDescription')}
            active={settings.petEnabled === true}
            onPress={() => updateSettings({ petEnabled: settings.petEnabled !== true })}
          />
        </View>
      </IsleSection>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
        <IsleSection title={t('settings.theme')} style={{ flexGrow: 1, flexBasis: 160 }} contentStyle={{ padding: 12 }}>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {(['system', 'light', 'dark'] satisfies ThemeMode[]).map((item) => (
              <IslePressable key={item} haptic onPress={() => setTheme(item)} style={settingsChipPressableStyle}>
                <IsleChip active={settings.theme === item}>{item === 'system' ? t('settings.themeSystem') : item === 'light' ? t('settings.themeLight') : t('settings.themeDark')}</IsleChip>
              </IslePressable>
            ))}
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

      <IsleSection title={t('settings.importExport')} style={{ marginTop: 14 }}>
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
        {expandedGroups.diagnostics ? (
          <View style={foldoutBodyStyle}>
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
          </View>
        ) : null}

        <IsleDisclosure
          title={t('settings.upstreamGovernance')}
          summary={t('settings.upstreamGovernanceSubtitle')}
          expanded={expandedGroups.governance}
          onPress={() => toggleExpandedGroup('governance')}
        />
        {expandedGroups.governance ? (
          <View style={foldoutBodyStyle}>
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
        </View>
        ) : null}

        <IsleDisclosure
          title={t('settings.updates')}
          summary={`${version.appVersion} (${version.buildVersion}) · ${formatUpdateCheckTime(settings.lastApkUpdateCheckAt)}`}
          expanded={expandedGroups.updates}
          onPress={() => toggleExpandedGroup('updates')}
        />
        {expandedGroups.updates ? (
          <View style={foldoutBodyStyle}>
            <View style={{ borderRadius: 22, padding: 13, backgroundColor: colors.material.paperRaised, borderWidth: 1, borderColor: colors.border }}>
              <VersionRow label={t('settings.appVersion')} value={`${version.appVersion} (${version.buildVersion})`} />
              <VersionRow label={t('settings.lastCheck')} value={formatUpdateCheckTime(settings.lastApkUpdateCheckAt)} />
            </View>
            <View style={{ gap: 10 }}>
              <DataButton
                label={checkingUpdate ? t('settings.checkingUpdate') : t('settings.checkApk')}
                icon={checkingUpdate ? <ActivityIndicator color={colors.surface} /> : <Smartphone color={colors.surface} size={18} />}
                onPress={() => void checkApkUpdate()}
              />
              <IsleToggle
                icon={<RotateCcw color={colors.text} size={18} />}
                title={t('settings.autoCheck')}
                active={settings.autoUpdateCheckEnabled ?? true}
                onPress={toggleAutoCheck}
              />
            </View>
          </View>
        ) : null}

        <IsleDisclosure
          title={t('settings.dangerZone')}
          expanded={expandedGroups.danger}
          onPress={() => toggleExpandedGroup('danger')}
          danger
        />
        {expandedGroups.danger ? (
          <View style={foldoutBodyStyle}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <DangerButton label={t('settings.clearChats')} icon={<Trash2 color={colors.error} size={18} />} onPress={confirmClearChats} />
              <DangerButton label={t('settings.resetSettings')} icon={<RotateCcw color={colors.error} size={18} />} onPress={confirmResetSettings} />
            </View>
          </View>
        ) : null}
      </View>
    </ScrollView>
  )
}

function SettingLink({ title, description, icon, onPress }: { title: string; description: string; icon: ReactNode; onPress: () => void }) {
  return <IsleListItem title={title} description={description} leading={<IconWrap>{icon}</IconWrap>} onPress={onPress} />
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
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '900', marginBottom: 7 }}>{label}</Text>
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
        <Text style={{ color: colors.text, fontSize: 12, fontWeight: '900' }}>{label}</Text>
      </View>
      <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, fontWeight: '800', marginTop: 5 }}>{value}</Text>
    </View>
  )
}

function readinessTone(status: WorkspaceReadinessStatus): 'mint' | 'amber' | 'default' {
  if (status === 'ready') return 'mint'
  if (status === 'action') return 'amber'
  return 'default'
}

function importResultMessage(
  result: Awaited<ReturnType<typeof importFromJsonFileDetailed>>,
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!result.ok) return t('settings.importSkippedMessage')
  if (result.kind === 'mem0') return t('settings.importMem0DoneMessage', { count: result.memories })
  return t('settings.importDoneMessage')
}

function readinessTitle(key: WorkspaceReadinessKey, t: ReturnType<typeof useTranslation>['t']): string {
  switch (key) {
    case 'provider':
      return t('settings.readiness.providerTitle')
    case 'memory':
      return t('settings.readiness.memoryTitle')
    case 'knowledge':
      return t('settings.readiness.knowledgeTitle')
    case 'search':
      return t('settings.readiness.searchTitle')
    case 'recovery':
      return t('settings.readiness.backupTitle')
  }
}

function readinessDescription(item: WorkspaceReadinessItem, t: ReturnType<typeof useTranslation>['t']): string {
  switch (item.key) {
    case 'provider':
      return item.status === 'ready'
        ? t('settings.readiness.providerReady', { count: item.metrics.readyProviders })
        : t('settings.readiness.providerAction')
    case 'memory':
      if (item.status === 'ready') {
        return t('settings.readiness.memoryReady', {
          active: item.metrics.activeMemoryCount ?? 0,
          pending: item.metrics.pendingMemoryCount ?? 0,
        })
      }
      if (item.status === 'review') {
        return item.metrics.loading
          ? t('settings.readiness.memoryReviewLoading')
          : t('settings.readiness.memoryReviewEmpty')
      }
      return t('settings.readiness.memoryAction')
    case 'knowledge':
      if (item.status === 'ready') {
        return t('settings.readiness.knowledgeReady', {
          documents: item.metrics.knowledgeDocumentCount ?? 0,
          chunks: item.metrics.knowledgeChunkCount ?? 0,
        })
      }
      if (item.status === 'review') {
        if (item.metrics.loading) return t('settings.readiness.knowledgeReviewLoading')
        if ((item.metrics.failedKnowledgeDocumentCount ?? 0) > 0) {
          return t('settings.readiness.knowledgeReviewFailed', { count: item.metrics.failedKnowledgeDocumentCount })
        }
        return t('settings.readiness.knowledgeReviewEmpty')
      }
      return t('settings.readiness.knowledgeAction')
    case 'search':
      return item.status === 'ready'
        ? t('settings.readiness.searchReady', { provider: searchProviderLabel(item.metrics.searchProvider) })
        : t('settings.readiness.searchReview')
    case 'recovery':
      return item.status === 'ready' ? t('settings.readiness.backupReady') : t('settings.readiness.backupReview')
  }
}

function readinessPrimaryActionDescription(item: WorkspaceReadinessItem, t: ReturnType<typeof useTranslation>['t']): string {
  switch (item.key) {
    case 'provider':
      return t('settings.readiness.providerNext')
    case 'memory':
      return item.status === 'action'
        ? t('settings.readiness.memoryNextEnable')
        : t('settings.readiness.memoryNextReview')
    case 'knowledge':
      if (item.status === 'action') return t('settings.readiness.knowledgeNextEnable')
      return (item.metrics.failedKnowledgeDocumentCount ?? 0) > 0
        ? t('settings.readiness.knowledgeNextRecover')
        : t('settings.readiness.knowledgeNextImport')
    case 'search':
      return t('settings.readiness.searchNext')
    case 'recovery':
      return t('settings.readiness.backupNext')
  }
}

function readinessIcon(key: WorkspaceReadinessKey, color: string): ReactNode {
  switch (key) {
    case 'provider':
      return <KeyRound color={color} size={18} />
    case 'memory':
      return <Brain color={color} size={18} />
    case 'knowledge':
      return <Database color={color} size={18} />
    case 'search':
      return <Globe2 color={color} size={18} />
    case 'recovery':
      return <ShieldCheck color={color} size={18} />
  }
}

function readinessRoute(key: WorkspaceReadinessKey, status?: WorkspaceReadinessStatus): (() => void) | undefined {
  switch (key) {
    case 'provider':
      return () => router.push('/settings/providers')
    case 'memory':
      return () => router.push(status === 'review' ? '/settings/memory?focus=review' : '/settings/memory')
    case 'knowledge':
      return () => router.push('/settings/knowledge')
    case 'search':
      return () => router.push('/settings/context')
    case 'recovery':
      return undefined
  }
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
  return <IsleButton label={label} icon={icon} tone="primary" onPress={onPress} style={{ flex: 1, minHeight: 54, borderRadius: 27 }} />
}

function DangerButton({ label, icon, onPress }: { label: string; icon: ReactNode; onPress: () => void }) {
  return <IsleButton label={label} icon={icon} tone="danger" onPress={onPress} style={{ flex: 1, minHeight: 54, borderRadius: 27 }} />
}
