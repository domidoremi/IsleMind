import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions, type ViewStyle } from 'react-native'
import { router, usePathname } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import * as Sharing from 'expo-sharing'
import { AnimatePresence, MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { AnimatedNavigationTrigger, type NavigationGlyph } from '@/components/navigation/AnimatedNavigationTrigger'
import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import { IslePressable } from '@/components/ui/isle'
import { IsleChip } from '@/components/ui/isle'
import { IsleButton } from '@/components/ui/isle'
import { IsleDisclosure, IsleField, IsleHeader, IsleSection, IsleToggle } from '@/components/ui/isle'
import { IsleMetric } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import { useChatStore } from '@/store/chatStore'
import { exportToJsonFile, importFromJsonFileDetailed } from '@/services/portableData'
import { formatImportSizeLimit, MAX_IMPORT_JSON_FILE_BYTES } from '@/services/fileImportGuards'
import { checkLatestApkRelease, downloadAndOpenApkInstaller, formatApkSizeBytes, formatUpdateCheckTime, getVersionSnapshot, shouldRecordApkUpdateCheck, type ApkInstallProgress, type ApkInstallProgressStage, type ApkReleaseInfo } from '@/services/appUpdates'
import { useIsleDialog } from '@/components/ui/isle'
import { resolveSearchProvider, searchProviderLabel } from '@/services/searchPolicy'
import { clearRuntimeLog, getRuntimeLogInfo, getRuntimeLogPath, readRuntimeLogText } from '@/services/runtimeLog'
import { buildRuntimeDiagnosticsSummary, type RuntimeDiagnosticsSummary } from '@/services/runtimeDiagnostics'
import { emitPluginManifestCatalogSnapshotEvent, loadPluginManifestCatalogSnapshot, type PluginManifestCatalogSnapshot } from '@/services/pluginManifest'
import { changeAppLanguage } from '@/i18n'
import type { BedrockCacheTtl, Language, ObservabilitySinkHighFrequencyExportMode, ObservabilitySinkMode, ObservabilitySinkTarget, PayloadPolicyMode, ProxyMode, RemoteCompactMode, ThemeId, ThemeMode, UpstreamTransportMode } from '@/types'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'
import { androidStatusNotificationsAvailable, clearAndroidStatusNotification, getAndroidStatusNotificationPermissionStatus, openAndroidStatusNotificationSettings, requestAndroidStatusNotificationPermission, type AndroidStatusNotificationPermissionStatus, type AndroidStatusNotificationSettingsTarget } from '@/services/androidStatusNotification'

const LANGUAGE_OPTIONS: { id: Language; label: string; detail: string }[] = [
  { id: 'zh-CN', label: '简体中文', detail: '中文界面' },
  { id: 'en', label: 'English', detail: 'English UI' },
  { id: 'ja', label: '日本語', detail: '日本語 UI' },
]

const THEME_FAMILY_OPTIONS: { id: ThemeId; labelKey: string; detailKey: string }[] = [
  { id: 'minimal', labelKey: 'settings.themeMinimal', detailKey: 'settings.themeMinimalDescription' },
  { id: 'glass', labelKey: 'settings.themeGlass', detailKey: 'settings.themeGlassDescription' },
  { id: 'cartoon', labelKey: 'settings.themeCartoon', detailKey: 'settings.themeCartoonDescription' },
]

const settingsChipPressableStyle = { minHeight: 44, justifyContent: 'center' as const }
const themeModeCardHeight = 82
type ApkUpdateUiStage = 'checking' | ApkInstallProgressStage

function updateStageLabelKey(stage: ApkUpdateUiStage): string {
  if (stage === 'checking') return 'settings.checkingUpdate'
  if (stage === 'downloading') return 'settings.downloadingApk'
  if (stage === 'verifying') return 'settings.verifyingApk'
  return 'settings.openingInstaller'
}

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

const OBSERVABILITY_SINK_MODE_OPTIONS: { value: ObservabilitySinkMode; labelKey: string }[] = [
  { value: 'off', labelKey: 'settings.observabilitySinkOff' },
  { value: 'local-only', labelKey: 'settings.observabilitySinkLocalOnly' },
  { value: 'external', labelKey: 'settings.observabilitySinkExternal' },
]

const OBSERVABILITY_SINK_TARGET_OPTIONS: { value: ObservabilitySinkTarget; labelKey: string }[] = [
  { value: 'opentelemetry', labelKey: 'settings.observabilitySinkTargetOpenTelemetry' },
  { value: 'langfuse', labelKey: 'settings.observabilitySinkTargetLangfuse' },
  { value: 'phoenix', labelKey: 'settings.observabilitySinkTargetPhoenix' },
]

const OBSERVABILITY_SINK_HIGH_FREQUENCY_OPTIONS: { value: ObservabilitySinkHighFrequencyExportMode; labelKey: string }[] = [
  { value: 'drop', labelKey: 'settings.observabilitySinkHighFrequencyDrop' },
  { value: 'coalesced', labelKey: 'settings.observabilitySinkHighFrequencyCoalesced' },
  { value: 'per-event', labelKey: 'settings.observabilitySinkHighFrequencyPerEvent' },
]

const CACHE_TTL_OPTIONS: { value: BedrockCacheTtl; labelKey: string }[] = [
  { value: 'default', labelKey: 'settings.cacheTtlDefault' },
  { value: '5m', labelKey: 'settings.cacheTtl5m' },
  { value: '1h', labelKey: 'settings.cacheTtl1h' },
]

function featureToggleIconColor(colors: ReturnType<typeof useAppTheme>['colors'], active: boolean): string {
  return active ? colors.ui.control.primaryForeground : colors.ui.icon.accentForeground
}

const describeSystemStatusNotification = (
  status: AndroidStatusNotificationPermissionStatus | null,
  t: ReturnType<typeof useTranslation>['t']
): string => {
  if (!status) return t('settings.systemStatusNotificationsStatusChecking')
  if (!status.available) return t('settings.systemStatusNotificationsStatusUnavailable')
  if (status.reason === 'native_error') return t('settings.systemStatusNotificationsStatusNativeError')
  if (!status.granted) return t('settings.systemStatusNotificationsStatusPermissionDenied')
  if (!status.promotedNotificationsAvailable) return t('settings.systemStatusNotificationsStatusStandardOnly')
  if (status.canPostPromotedNotifications === true) return t('settings.systemStatusNotificationsStatusPromotedReady')
  if (status.canPostPromotedNotifications === false) return t('settings.systemStatusNotificationsStatusPromotedBlocked')
  return t('settings.systemStatusNotificationsStatusPromotedUnknown')
}

type SettingsAdvancedGroup = 'diagnostics' | 'governance' | 'updates' | 'danger'
type RuntimeRepairTask = RuntimeDiagnosticsSummary['timeline']['repairPlan']['tasks'][number]
type RuntimeRepairSettingsRoute = '/settings/providers' | '/settings/context' | '/settings/mcp' | '/settings/skills'

function resolveSettingsFoldoutSurface(colors: ReturnType<typeof useAppTheme>['colors'], isGlass: boolean, variant: 'base' | 'muted' = 'base') {
  if (variant === 'muted') {
    return colors.ui.cartoon ? colors.ui.semantic.surface.muted : isGlass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted
  }
  return colors.ui.cartoon ? colors.ui.semantic.surface.base : isGlass ? colors.ui.semantic.chrome.background : colors.ui.semantic.surface.muted
}

function resolveSettingsFoldoutBorder(colors: ReturnType<typeof useAppTheme>['colors'], isGlass: boolean) {
  return colors.ui.cartoon ? colors.material.stroke : isGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
}

export function SettingsScreenContent({ active = true, onHome }: { active?: boolean; onHome?: () => void } = {}) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const { t } = useTranslation()
  const pathname = usePathname()
  const dialog = useIsleDialog()
  const { width } = useWindowDimensions()
  const narrowLayout = width < 430
  const pairedFieldRowStyle = { flexDirection: narrowLayout ? 'column' : 'row', gap: 10 } as const
  const pairedFieldStyle = narrowLayout ? undefined : { flex: 1, minWidth: 0 }
  const providers = useSettingsStore((state) => state.providers)
  const settings = useSettingsStore((state) => state.settings)
  const setTheme = useSettingsStore((state) => state.setTheme)
  const setThemeId = useSettingsStore((state) => state.setThemeId)
  const setLanguage = useSettingsStore((state) => state.setLanguage)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const resetSettings = useSettingsStore((state) => state.clearAll)
  const getObservabilitySinkApiKey = useSettingsStore((state) => state.getObservabilitySinkApiKey)
  const setObservabilitySinkApiKey = useSettingsStore((state) => state.setObservabilitySinkApiKey)
  const clearChats = useChatStore((state) => state.clearAll)
  const scrollRef = useRef<ScrollView>(null)
  const [apkUpdateStage, setApkUpdateStage] = useState<ApkUpdateUiStage | null>(null)
  const [activeApkRelease, setActiveApkRelease] = useState<ApkReleaseInfo | null>(null)
  const [apkInstallProgress, setApkInstallProgress] = useState<ApkInstallProgress | null>(null)
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnosticsSummary | null>(null)
  const [pluginCatalog, setPluginCatalog] = useState<PluginManifestCatalogSnapshot | null>(null)
  const [refreshingDiagnostics, setRefreshingDiagnostics] = useState(false)
  const [observabilitySinkApiKeyDraft, setObservabilitySinkApiKeyDraft] = useState('')
  const [savingObservabilitySinkApiKey, setSavingObservabilitySinkApiKey] = useState(false)
  const [systemStatusNotificationStatus, setSystemStatusNotificationStatus] = useState<AndroidStatusNotificationPermissionStatus | null>(null)
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
  const activeThemeId = settings.themeId ?? 'minimal'
  const subtleBorderWidth = colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth
  const foldoutBodyStyle = { marginTop: 8, borderRadius: colors.ui.radius.panel, padding: 11, backgroundColor: resolveSettingsFoldoutSurface(colors, colors.ui.glass), borderWidth: subtleBorderWidth, borderColor: resolveSettingsFoldoutBorder(colors, colors.ui.glass), gap: 10 }
  const settingsGridSectionStyle = (basis: number): ViewStyle => ({
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: narrowLayout ? '100%' : basis,
    minWidth: 0,
  })
  const foldoutCardStyle = (gap = 10): ViewStyle => ({
    borderRadius: colors.ui.radius.card,
    padding: 10,
    backgroundColor: colors.ui.cartoon ? colors.ui.semantic.surface.muted : colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted,
    borderWidth: subtleBorderWidth,
    borderColor: colors.ui.cartoon ? colors.material.stroke : colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border,
    gap,
  })
  const foldoutMotion = motion === 'full'
    ? { type: 'spring' as const, ...motionTokens.spring.gentle }
    : { type: 'timing' as const, duration: 1 }
  const diagnosticRows = useMemo(() => diagnostics ? buildDiagnosticRows(diagnostics, t, pluginCatalog) : [], [diagnostics, pluginCatalog, t])
  const systemStatusNotificationDescription = useMemo(
    () => describeSystemStatusNotification(systemStatusNotificationStatus, t),
    [systemStatusNotificationStatus, t]
  )
  const showSystemStatusNotificationSettingsAction = systemStatusNotificationStatus?.available === true && systemStatusNotificationStatus.granted === false
  const showPromotedNotificationSettingsAction =
    systemStatusNotificationStatus?.available === true &&
    systemStatusNotificationStatus.granted === true &&
    systemStatusNotificationStatus.promotedNotificationsAvailable === true &&
    systemStatusNotificationStatus.canPostPromotedNotifications === false
  const updatingApk = apkUpdateStage != null
  const updateActionLabel = apkUpdateStage ? t(updateStageLabelKey(apkUpdateStage)) : t('settings.checkApk')
  const updateProgressDetail = apkUpdateStage
    ? activeApkRelease
      ? formatApkUpdateProgressDetail(apkUpdateStage, activeApkRelease, apkInstallProgress, t)
      : t('settings.apkUpdateProgressChecking')
    : null

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
    void refreshSystemStatusNotificationStatus()
  }, [active, settings.systemStatusNotificationsEnabled])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    void getObservabilitySinkApiKey().then((apiKey) => {
      if (!cancelled) setObservabilitySinkApiKeyDraft(apiKey ?? '')
    })
    return () => {
      cancelled = true
    }
  }, [active, getObservabilitySinkApiKey])

  useEffect(() => {
    if (!active || !expandedGroups.diagnostics || diagnostics || refreshingDiagnostics) return
    void refreshRuntimeDiagnostics()
  }, [active, expandedGroups.diagnostics, diagnostics, refreshingDiagnostics])

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

  async function saveObservabilitySinkApiKey() {
    setSavingObservabilitySinkApiKey(true)
    try {
      await setObservabilitySinkApiKey(observabilitySinkApiKeyDraft)
      setDiagnostics(null)
      dialog.toast({
        title: observabilitySinkApiKeyDraft.trim() ? t('settings.observabilitySinkApiKeySaved') : t('settings.observabilitySinkApiKeyCleared'),
        tone: observabilitySinkApiKeyDraft.trim() ? 'mint' : 'amber',
      })
    } catch (error) {
      dialog.toast({
        title: t('settings.observabilitySinkApiKeySaveFailed'),
        message: error instanceof Error ? error.message : String(error),
        tone: 'danger',
      })
    } finally {
      setSavingObservabilitySinkApiKey(false)
    }
  }

  async function clearObservabilitySinkApiKey() {
    setObservabilitySinkApiKeyDraft('')
    setSavingObservabilitySinkApiKey(true)
    try {
      await setObservabilitySinkApiKey('')
      setDiagnostics(null)
      dialog.toast({ title: t('settings.observabilitySinkApiKeyCleared'), tone: 'amber' })
    } catch (error) {
      dialog.toast({
        title: t('settings.observabilitySinkApiKeySaveFailed'),
        message: error instanceof Error ? error.message : String(error),
        tone: 'danger',
      })
    } finally {
      setSavingObservabilitySinkApiKey(false)
    }
  }

  async function checkApkUpdate() {
    if (updatingApk) return
    setApkUpdateStage('checking')
    setActiveApkRelease(null)
    setApkInstallProgress(null)
    try {
      const result = await checkLatestApkRelease()
      if (shouldRecordApkUpdateCheck(result)) {
        updateSettings({ lastApkUpdateCheckAt: Date.now() })
      }
      if (result.status !== 'available' || !result.release) {
        const message = result.status === 'error'
          ? `${result.message}\n${t('settings.updateRetryNotSuppressed')}`
          : result.message
        dialog.notice({
          title: result.status === 'error' ? t('settings.apkCheckFailed') : t('settings.noNewApk'),
          message,
          tone: result.status === 'error' ? 'danger' : result.status === 'unsupported' ? 'amber' : 'mint',
        })
        return
      }
      setActiveApkRelease(result.release)
      const confirmed = await confirmApkInstall(result.release)
      if (!confirmed) return
      const installResult = await downloadAndOpenApkInstaller(result.release, {
        onProgress: (progress) => {
          setActiveApkRelease(progress.release)
          setApkUpdateStage(progress.stage)
          setApkInstallProgress(progress)
        },
      })
      dialog.notice({
        title: installResult.status === 'downloaded' ? t('settings.installerOpened') : t('settings.apkUpdateFailed'),
        message: installResult.message,
        tone: installResult.status === 'downloaded' ? 'mint' : 'danger',
      })
    } finally {
      setApkUpdateStage(null)
      setActiveApkRelease(null)
      setApkInstallProgress(null)
    }
  }

  function confirmApkInstall(release: ApkReleaseInfo) {
    const variantLabel = release.variant ? t(`settings.apkVariant.${release.variant}`) : null
    return dialog.confirm({
      title: t('settings.installVersion', { version: release.version }),
      message: t('settings.installConfirm'),
      confirmLabel: t('settings.downloadAndInstall'),
      cancelLabel: t('settings.later'),
      tone: 'amber',
      chips: [
        { label: release.apkName, tone: 'mint' },
        release.versionCode ? { label: t('settings.apkBuildCode', { code: release.versionCode }) } : null,
        release.abi ? { label: t('settings.apkArchitecture', { abi: release.abi }) } : null,
        variantLabel ? { label: variantLabel } : null,
        release.sizeBytes ? { label: t('settings.apkSize', { size: formatApkSizeBytes(release.sizeBytes) }) } : null,
        { label: release.tagName || release.name },
      ].filter((chip): chip is { label: string; tone?: 'mint' } => Boolean(chip)),
    })
  }

  function toggleAutoCheck() {
    const next = !(settings.autoUpdateCheckEnabled ?? true)
    updateSettings({ autoUpdateCheckEnabled: next })
    dialog.toast({ title: next ? t('settings.autoCheckOn') : t('settings.autoCheckOff'), tone: next ? 'mint' : 'amber' })
  }

  async function toggleSystemStatusNotifications() {
    const next = settings.systemStatusNotificationsEnabled !== true
    if (!next) {
      updateSettings({ systemStatusNotificationsEnabled: false })
      void clearAndroidStatusNotification()
      void refreshSystemStatusNotificationStatus()
      dialog.toast({ title: t('settings.systemStatusNotificationsOff'), tone: 'amber' })
      return
    }

    if (!androidStatusNotificationsAvailable()) {
      updateSettings({ systemStatusNotificationsEnabled: false })
      void refreshSystemStatusNotificationStatus()
      dialog.toast({
        title: t('settings.systemStatusNotificationsUnavailable'),
        message: t('settings.systemStatusNotificationsPermissionDeniedMessage'),
        tone: 'danger',
      })
      return
    }

    const permission = await requestAndroidStatusNotificationPermission({
      title: t('settings.systemStatusNotificationsPermissionTitle'),
      message: t('settings.systemStatusNotificationsPermissionMessage'),
      buttonPositive: t('common.confirm'),
      buttonNegative: t('common.cancel'),
    })
    setSystemStatusNotificationStatus(permission)
    if (!permission.granted) {
      updateSettings({ systemStatusNotificationsEnabled: false })
      dialog.toast({
        title: t('settings.systemStatusNotificationsPermissionDenied'),
        message: t('settings.systemStatusNotificationsPermissionDeniedMessage'),
        tone: 'danger',
      })
      return
    }

    updateSettings({ systemStatusNotificationsEnabled: true })
    void refreshSystemStatusNotificationStatus()
    dialog.toast({ title: t('settings.systemStatusNotificationsOn'), message: t('settings.systemStatusNotificationsDescription'), tone: 'mint' })
  }

  async function openSystemStatusNotificationSettings(target: AndroidStatusNotificationSettingsTarget) {
    const result = await openAndroidStatusNotificationSettings(target)
    if (!result.opened) {
      dialog.toast({
        title: t('settings.systemStatusNotificationsSettingsUnavailable'),
        message: result.reason === 'unsupported_api'
          ? t('settings.systemStatusNotificationsPromotedSettingsUnsupportedMessage')
          : t('settings.systemStatusNotificationsSettingsUnavailableMessage'),
        tone: 'danger',
      })
      return
    }

    const status = await refreshSystemStatusNotificationStatus()
    dialog.toast({
      title: t('settings.systemStatusNotificationsSettingsReturned'),
      message: describeSystemStatusNotification(status, t),
      tone: status.granted ? 'mint' : 'amber',
    })
  }

  async function refreshSystemStatusNotificationStatus() {
    const status = await getAndroidStatusNotificationPermissionStatus()
    setSystemStatusNotificationStatus(status)
    return status
  }

  function toggleExpandedGroup(group: SettingsAdvancedGroup) {
    setExpandedGroups((current) => ({ ...current, [group]: !current[group] }))
  }

  function openRuntimeRepairTask(task: RuntimeRepairTask) {
    switch (task.target.kind) {
      case 'provider-settings':
        openRuntimeRepairSettingsRoute('/settings/providers', task)
        return
      case 'tool-settings':
        openRuntimeRepairSettingsRoute('/settings/mcp', task)
        return
      case 'context-settings':
        openRuntimeRepairSettingsRoute('/settings/context', task)
        return
      case 'plugin-settings':
        openRuntimeRepairSettingsRoute('/settings/skills', task)
        return
      case 'agent-settings':
        openRuntimeRepairSettingsRoute('/settings/skills', task)
        return
      case 'session-affinity-settings':
      case 'compact-settings':
        setExpandedGroups((current) => ({ ...current, governance: true }))
        dialog.toast({
          title: t('settings.runtimeRepairOpened'),
          message: formatRuntimeRepairTaskScope(task),
          tone: task.severity === 'critical' ? 'danger' : task.severity === 'warning' ? 'amber' : 'mint',
        })
        return
      case 'retry-chat':
        openRuntimeRepairChat(task)
        return
    }
  }

  function openRuntimeRepairSettingsRoute(pathname: RuntimeRepairSettingsRoute, task: RuntimeRepairTask) {
    router.push({ pathname, params: runtimeRepairRouteParams(task) })
  }

  function openRuntimeRepairChat(task: RuntimeRepairTask) {
    const conversationId = task.target.conversationId
    const { conversations, select } = useChatStore.getState()
    if (conversationId && conversations.some((conversation) => conversation.id === conversationId)) {
      select(conversationId)
      router.push({ pathname: '/chat/[id]', params: { id: conversationId, ...runtimeRepairRouteParams(task) } })
      return
    }
    router.push('/')
    dialog.toast({
      title: t('settings.runtimeRepairChatUnavailable'),
      message: formatRuntimeRepairTaskScope(task),
      tone: 'amber',
    })
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
    key: 'runtimeLogMaxBytes' | 'sessionConcurrencyLimit' | 'sessionQueueTimeoutMs' | 'upstreamRequestTimeoutMs' | 'upstreamMaxRetries' | 'upstreamCircuitBreakerFailureThreshold' | 'upstreamCircuitBreakerCooldownMs' | 'agentWorkflowMaxSteps' | 'agentWorkflowMaxToolCallsPerStep' | 'agentWorkflowOutputCharLimit' | 'remoteCompactThresholdTokens' | 'sessionAffinityTtlMs' | 'observabilitySinkAttributeLimit' | 'observabilitySinkAttributeStringLimit',
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
    if (key === 'agentWorkflowMaxSteps') updateSettings({ agentWorkflowMaxSteps: next })
    if (key === 'agentWorkflowMaxToolCallsPerStep') updateSettings({ agentWorkflowMaxToolCallsPerStep: next })
    if (key === 'agentWorkflowOutputCharLimit') updateSettings({ agentWorkflowOutputCharLimit: next })
    if (key === 'remoteCompactThresholdTokens') updateSettings({ remoteCompactThresholdTokens: next })
    if (key === 'sessionAffinityTtlMs') updateSettings({ sessionAffinityTtlMs: next })
    if (key === 'observabilitySinkAttributeLimit') updateSettings({ observabilitySinkAttributeLimit: next })
    if (key === 'observabilitySinkAttributeStringLimit') updateSettings({ observabilitySinkAttributeStringLimit: next })
  }

  function updateRemoteCompactThreshold(value: string) {
    const parsed = Number.parseFloat(value)
    const next = Number.isFinite(parsed) ? Math.max(0.1, Math.min(2, parsed)) : 0.8
    updateSettings({ remoteCompactThreshold: next })
  }

  async function refreshRuntimeDiagnostics() {
    setRefreshingDiagnostics(true)
    try {
      const catalog = await loadPluginManifestCatalogSnapshot()
      await emitPluginManifestCatalogSnapshotEvent(catalog, 'settings-diagnostics-refresh')
      const summary = await buildRuntimeDiagnosticsSummary({ providers, settings })
      setDiagnostics(summary)
      setPluginCatalog(catalog)
    } catch (error) {
      dialog.toast({
        title: t('settings.runtimeDiagnosticsRefreshFailed'),
        message: error instanceof Error ? error.message : String(error),
        tone: 'danger',
      })
    } finally {
      setRefreshingDiagnostics(false)
    }
  }

  async function copyRuntimeLogTail() {
    try {
      const text = await readRuntimeLogText()
      await Clipboard.setStringAsync(text || t('settings.runtimeLogEmpty'))
      dialog.toast({ title: t('settings.runtimeLogCopied'), tone: 'mint' })
    } catch (error) {
      dialog.toast({
        title: t('settings.runtimeLogCopyFailed'),
        message: error instanceof Error ? error.message : String(error),
        tone: 'danger',
      })
    }
  }

  async function shareRuntimeLogFile() {
    try {
      const logInfo = await getRuntimeLogInfo()
      if (!logInfo.exists || logInfo.size <= 0) {
        await copyRuntimeLogTail()
        return
      }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(logInfo.path, { mimeType: 'application/json', dialogTitle: t('settings.runtimeLogShare') })
        return
      }
      await copyRuntimeLogTail()
    } catch (error) {
      dialog.toast({
        title: t('settings.runtimeLogShareFailed'),
        message: error instanceof Error ? error.message : String(error),
        tone: 'danger',
      })
    }
  }

  async function clearRuntimeLogFile() {
    try {
      await clearRuntimeLog()
      await refreshRuntimeDiagnostics()
      dialog.toast({ title: t('settings.runtimeLogCleared'), tone: 'amber' })
    } catch (error) {
      dialog.toast({
        title: t('settings.runtimeLogClearFailed'),
        message: error instanceof Error ? error.message : String(error),
        tone: 'danger',
      })
    }
  }

  return (
    <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" removeClippedSubviews={Platform.OS === 'android'} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 120 }}>
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

      <SettingsSectionTitle>{t('settings.aiSettings')}</SettingsSectionTitle>
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

      <SettingsSectionTitle>{t('settings.basicFeatures')}</SettingsSectionTitle>
      <IsleSection style={{ marginTop: 8 }}>
        <View style={{ gap: 10 }}>
          <IsleToggle
            icon={<AppIcon name="reasoning" color={featureToggleIconColor(colors, !!settings.memoryEnabled)} size={18} strokeWidth={appIconStroke.bold} />}
            title={t('settings.longMemory')}
            active={!!settings.memoryEnabled}
            onPress={() => updateSettings({ memoryEnabled: !settings.memoryEnabled })}
          />
          <IsleToggle
            icon={<AppIcon name="knowledge" color={featureToggleIconColor(colors, !!settings.knowledgeEnabled)} size={18} strokeWidth={appIconStroke.bold} />}
            title={t('settings.localKnowledge')}
            active={!!settings.knowledgeEnabled}
            onPress={() => updateSettings({ knowledgeEnabled: !settings.knowledgeEnabled })}
          />
          <IsleToggle
            icon={<AppIcon name="globe" color={featureToggleIconColor(colors, !!settings.webSearchEnabled)} size={18} strokeWidth={appIconStroke.bold} />}
            title={t('settings.webSearch')}
            active={!!settings.webSearchEnabled}
            onPress={() => updateSettings({ webSearchEnabled: !settings.webSearchEnabled })}
          />
          <IsleToggle
            icon={<AppIcon name="activity" color={featureToggleIconColor(colors, settings.systemStatusNotificationsEnabled === true)} size={18} strokeWidth={appIconStroke.bold} />}
            title={t('settings.systemStatusNotifications')}
            description={systemStatusNotificationDescription}
            active={settings.systemStatusNotificationsEnabled === true}
            onPress={() => void toggleSystemStatusNotifications()}
          />
          {showSystemStatusNotificationSettingsAction || showPromotedNotificationSettingsAction ? (
            <View style={{ flexDirection: narrowLayout ? 'column' : 'row', flexWrap: 'wrap', gap: 8, paddingTop: 2 }}>
              {showSystemStatusNotificationSettingsAction ? (
                <IsleButton
                  compact
                  label={t('settings.systemStatusNotificationsOpenSettings')}
                  icon={<AppIcon name="settings" color={colors.textSecondary} size={14} />}
                  onPress={() => void openSystemStatusNotificationSettings('notifications')}
                  style={narrowLayout ? { alignSelf: 'stretch' } : { alignSelf: 'flex-start', minWidth: 0 }}
                />
              ) : null}
              {showPromotedNotificationSettingsAction ? (
                <IsleButton
                  compact
                  label={t('settings.systemStatusNotificationsOpenPromotedSettings')}
                  icon={<AppIcon name="settings" color={colors.textSecondary} size={14} />}
                  onPress={() => void openSystemStatusNotificationSettings('promoted')}
                  style={narrowLayout ? { alignSelf: 'stretch' } : { alignSelf: 'flex-start', minWidth: 0 }}
                />
              ) : null}
            </View>
          ) : null}
        </View>
      </IsleSection>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
        <IsleSection title={t('settings.themeFamily')} style={settingsGridSectionStyle(220)} contentStyle={{ padding: 12 }}>
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
        <IsleSection title={t('settings.themeMode')} style={settingsGridSectionStyle(160)} contentStyle={{ padding: 12 }}>
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
        <IsleSection title={t('settings.language')} style={settingsGridSectionStyle(160)} contentStyle={{ padding: 12 }}>
          <View style={{ gap: 8 }}>
            {LANGUAGE_OPTIONS.map((item) => (
              <IslePressable key={item.id} haptic onPress={() => void chooseLanguage(item.id)} style={settingsChipPressableStyle}>
                <IsleChip active={settings.language === item.id}>{settings.language === item.id ? t('settings.current') : item.label}</IsleChip>
              </IslePressable>
            ))}
          </View>
        </IsleSection>
      </View>

      <SettingsSectionTitle>{t('settings.importExport')}</SettingsSectionTitle>
      <IsleSection style={{ marginTop: 8 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          <DataButton label={t('settings.exportJson')} icon={<AppIcon name="download" color={colors.ui.control.primaryForeground} size={18} />} onPress={() => void exportJson()} />
          <DataButton label={t('settings.importJson')} icon={<AppIcon name="upload" color={colors.ui.control.primaryForeground} size={18} />} onPress={() => void importJson()} />
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
            {diagnostics?.timeline.repairPlan.tasks.length ? (
              <RuntimeRepairTaskActions repairPlan={diagnostics.timeline.repairPlan} onOpenTask={openRuntimeRepairTask} />
            ) : null}
            <View style={foldoutCardStyle(7)}>
              <Text style={{ color: colors.text, fontSize: 13, fontWeight: '900' }}>{t('settings.runtimeLogFile')}</Text>
              <Text selectable numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, fontWeight: '800' }}>
                {diagnostics?.log.path ?? getRuntimeLogPath()}
              </Text>
              <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, fontWeight: '800' }}>
                {t('settings.runtimeLogState', { size: diagnostics?.log.size ?? 0, max: diagnostics?.log.maxBytes ?? settings.runtimeLogMaxBytes ?? 1048576 })}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <IsleButton label={refreshingDiagnostics ? t('settings.runtimeDiagnosticsRefreshing') : t('settings.runtimeDiagnosticsRefresh')} compact icon={<AppIcon name="activity" color={colors.textSecondary} size={15} />} onPress={() => void refreshRuntimeDiagnostics()} disabled={refreshingDiagnostics} />
              <IsleButton label={t('settings.runtimeLogCopy')} compact icon={<AppIcon name="json" color={colors.textSecondary} size={15} />} onPress={() => void copyRuntimeLogTail()} />
              <IsleButton label={t('settings.runtimeLogShare')} compact icon={<AppIcon name="upload" color={colors.textSecondary} size={15} />} onPress={() => void shareRuntimeLogFile()} />
              <IsleButton label={t('settings.runtimeLogClear')} compact tone="danger" icon={<AppIcon name="delete" color={colors.ui.control.dangerForeground} size={15} />} onPress={() => void clearRuntimeLogFile()} />
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
          <IsleField
            label={t('settings.remoteCompactThresholdTokens')}
            note={t('settings.remoteCompactThresholdTokensNote')}
            inputProps={{
              value: String(settings.remoteCompactThresholdTokens ?? 200000),
              onChangeText: (value) => updatePositiveInteger('remoteCompactThresholdTokens', value, 200000, 1024, 4000000),
              keyboardType: 'number-pad',
            }}
          />
          <View style={foldoutCardStyle(6)}>
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '900' }}>{t('settings.compactExecutionPolicy')}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, fontWeight: '800' }}>
              {t('settings.compactExecutionPolicyNote')}
            </Text>
          </View>
          <View style={foldoutCardStyle()}>
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '900' }}>{t('preferences.agentWorkflow')}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, fontWeight: '800' }}>
              {t('preferences.agentWorkflowSubtitle')}
            </Text>
            <View style={pairedFieldRowStyle}>
              <IsleField
                label={t('preferences.agentWorkflowMaxSteps')}
                note={t('preferences.agentWorkflowMaxStepsNote')}
                inputProps={{
                  value: String(settings.agentWorkflowMaxSteps ?? 3),
                  onChangeText: (value) => updatePositiveInteger('agentWorkflowMaxSteps', value, 3, 1, 8),
                  keyboardType: 'number-pad',
                }}
                style={pairedFieldStyle}
              />
              <IsleField
                label={t('preferences.agentWorkflowMaxToolCalls')}
                note={t('preferences.agentWorkflowMaxToolCallsNote')}
                inputProps={{
                  value: String(settings.agentWorkflowMaxToolCallsPerStep ?? 1),
                  onChangeText: (value) => updatePositiveInteger('agentWorkflowMaxToolCallsPerStep', value, 1, 1, 3),
                  keyboardType: 'number-pad',
                }}
                style={pairedFieldStyle}
              />
            </View>
            <IsleField
              label={t('preferences.agentWorkflowOutputLimit')}
              note={t('preferences.agentWorkflowOutputLimitNote')}
              inputProps={{
                value: String(settings.agentWorkflowOutputCharLimit ?? 4800),
                onChangeText: (value) => updatePositiveInteger('agentWorkflowOutputCharLimit', value, 4800, 512, 12000),
                keyboardType: 'number-pad',
              }}
            />
            <View style={{ gap: 10 }}>
              <IsleToggle
                icon={<AppIcon name="shield" color={colors.text} size={18} />}
                title={t('preferences.agentWorkflowReadOnlyTools')}
                description={t('preferences.agentWorkflowReadOnlyToolsDescription')}
                active={settings.agentWorkflowAllowReadOnlyTools ?? true}
                onPress={() => updateSettings({ agentWorkflowAllowReadOnlyTools: !(settings.agentWorkflowAllowReadOnlyTools ?? true) })}
              />
              <IsleToggle
                icon={<AppIcon name="shield" color={colors.text} size={18} />}
                title={t('preferences.agentWorkflowVisibleWrites')}
                description={t('preferences.agentWorkflowVisibleWritesDescription')}
                active={(settings.agentWorkflowAllowReadWriteTools ?? 'visible') !== false}
                onPress={() => updateSettings({ agentWorkflowAllowReadWriteTools: (settings.agentWorkflowAllowReadWriteTools ?? 'visible') === false ? 'visible' : false })}
              />
              <IsleToggle
                icon={<AppIcon name="shield" color={colors.text} size={18} />}
                title={t('preferences.agentWorkflowDestructiveConfirm')}
                description={t('preferences.agentWorkflowDestructiveConfirmDescription')}
                active={(settings.agentWorkflowAllowDestructiveTools ?? 'confirm') === 'confirm'}
                onPress={() => updateSettings({ agentWorkflowAllowDestructiveTools: (settings.agentWorkflowAllowDestructiveTools ?? 'confirm') === 'confirm' ? false : 'confirm' })}
              />
            </View>
          </View>
          <SegmentedSetting
            label={t('settings.payloadPolicyMode')}
            options={PAYLOAD_POLICY_OPTIONS}
            value={settings.payloadPolicyMode ?? 'warn'}
            onChange={(payloadPolicyMode) => updateSettings({ payloadPolicyMode })}
          />
          <View style={foldoutCardStyle(8)}>
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
          <View style={foldoutCardStyle()}>
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '900' }}>{t('settings.observabilitySinkSettings')}</Text>
            <SegmentedSetting
              label={t('settings.observabilitySinkMode')}
              options={OBSERVABILITY_SINK_MODE_OPTIONS}
              value={settings.observabilitySinkMode ?? 'off'}
              onChange={(observabilitySinkMode) => updateSettings({ observabilitySinkMode })}
            />
            <SegmentedSetting
              label={t('settings.observabilitySinkTarget')}
              options={OBSERVABILITY_SINK_TARGET_OPTIONS}
              value={settings.observabilitySinkTarget ?? 'opentelemetry'}
              onChange={(observabilitySinkTarget) => updateSettings({ observabilitySinkTarget })}
            />
            <IsleField
              label={t('settings.observabilitySinkEndpointUrl')}
              note={t('settings.observabilitySinkEndpointUrlNote')}
              inputProps={{
                value: settings.observabilitySinkEndpointUrl ?? '',
                onChangeText: (observabilitySinkEndpointUrl) => updateSettings({ observabilitySinkEndpointUrl }),
                placeholder: 'https://otel.example/v1/traces',
                autoCapitalize: 'none',
                autoCorrect: false,
              }}
            />
            <SegmentedSetting
              label={t('settings.observabilitySinkHighFrequencyMode')}
              options={OBSERVABILITY_SINK_HIGH_FREQUENCY_OPTIONS}
              value={settings.observabilitySinkHighFrequencyExportMode ?? 'coalesced'}
              onChange={(observabilitySinkHighFrequencyExportMode) => updateSettings({ observabilitySinkHighFrequencyExportMode })}
            />
            <View style={pairedFieldRowStyle}>
              <IsleField
                label={t('settings.observabilitySinkAttributeLimit')}
                inputProps={{
                  value: String(settings.observabilitySinkAttributeLimit ?? 48),
                  onChangeText: (value) => updatePositiveInteger('observabilitySinkAttributeLimit', value, 48, 1, 64),
                  keyboardType: 'number-pad',
                }}
                style={pairedFieldStyle}
              />
              <IsleField
                label={t('settings.observabilitySinkAttributeStringLimit')}
                inputProps={{
                  value: String(settings.observabilitySinkAttributeStringLimit ?? 160),
                  onChangeText: (value) => updatePositiveInteger('observabilitySinkAttributeStringLimit', value, 160, 1, 512),
                  keyboardType: 'number-pad',
                }}
                style={pairedFieldStyle}
              />
            </View>
            <IsleField
              label={t('settings.observabilitySinkApiKey')}
              note={t('settings.observabilitySinkApiKeyNote')}
              inputProps={{
                value: observabilitySinkApiKeyDraft,
                onChangeText: setObservabilitySinkApiKeyDraft,
                secureTextEntry: true,
                autoCapitalize: 'none',
                autoCorrect: false,
                placeholder: t('settings.observabilitySinkApiKeyPlaceholder'),
              }}
            />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <IsleButton
                label={savingObservabilitySinkApiKey ? t('settings.observabilitySinkApiKeySaving') : t('settings.observabilitySinkApiKeySave')}
                compact
                icon={<AppIcon name="provider-key" color={colors.textSecondary} size={15} />}
                onPress={() => void saveObservabilitySinkApiKey()}
                disabled={savingObservabilitySinkApiKey}
              />
              <IsleButton
                label={t('settings.observabilitySinkApiKeyClear')}
                compact
                tone="danger"
                icon={<AppIcon name="delete" color={colors.ui.control.dangerForeground} size={15} />}
                onPress={() => void clearObservabilitySinkApiKey()}
                disabled={savingObservabilitySinkApiKey || (!observabilitySinkApiKeyDraft && settings.observabilitySinkApiKeyConfigured !== true)}
              />
              <IsleChip tone={settings.observabilitySinkApiKeyConfigured === true ? 'mint' : 'default'}>
                {settings.observabilitySinkApiKeyConfigured === true ? t('settings.observabilitySinkApiKeyConfigured') : t('settings.observabilitySinkApiKeyMissing')}
              </IsleChip>
            </View>
            <View style={{ gap: 10 }}>
              <IsleToggle
                title={t('settings.observabilitySinkUserOptIn')}
                active={settings.observabilitySinkUserOptIn === true}
                onPress={() => updateSettings({ observabilitySinkUserOptIn: settings.observabilitySinkUserOptIn !== true })}
              />
              <IsleToggle
                title={t('settings.observabilitySinkWorkspaceConsent')}
                active={settings.observabilitySinkWorkspaceConsent === true}
                onPress={() => updateSettings({ observabilitySinkWorkspaceConsent: settings.observabilitySinkWorkspaceConsent !== true })}
              />
              <IsleToggle
                title={t('settings.observabilitySinkDevelopmentOnly')}
                active={settings.observabilitySinkDevelopmentOnly === true}
                onPress={() => updateSettings({ observabilitySinkDevelopmentOnly: settings.observabilitySinkDevelopmentOnly !== true })}
              />
            </View>
          </View>
          <View style={pairedFieldRowStyle}>
            <IsleField
              label={t('settings.sessionConcurrencyLimit')}
              inputProps={{
                value: String(settings.sessionConcurrencyLimit ?? 1),
                onChangeText: (value) => updatePositiveInteger('sessionConcurrencyLimit', value, 1, 1, 8),
                keyboardType: 'number-pad',
              }}
              style={pairedFieldStyle}
            />
            <IsleField
              label={t('settings.sessionQueueTimeoutMs')}
              inputProps={{
                value: String(settings.sessionQueueTimeoutMs ?? 1500),
                onChangeText: (value) => updatePositiveInteger('sessionQueueTimeoutMs', value, 1500, 0, 30000),
                keyboardType: 'number-pad',
              }}
              style={pairedFieldStyle}
            />
          </View>
          <View style={foldoutCardStyle()}>
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '900' }}>{t('settings.sessionAffinitySettings')}</Text>
            <IsleToggle
              icon={<AppIcon name="provider-key" color={colors.text} size={18} />}
              title={t('settings.sessionAffinityEnabled')}
              description={t('settings.sessionAffinityEnabledDescription')}
              active={settings.sessionAffinityEnabled === true}
              onPress={() => updateSettings({ sessionAffinityEnabled: settings.sessionAffinityEnabled !== true })}
            />
            <IsleField
              label={t('settings.sessionAffinityTtlMs')}
              note={t('settings.sessionAffinityTtlMsNote')}
              inputProps={{
                value: String(settings.sessionAffinityTtlMs ?? 1800000),
                onChangeText: (value) => updatePositiveInteger('sessionAffinityTtlMs', value, 1800000, 60000, 86400000),
                keyboardType: 'number-pad',
              }}
            />
          </View>
          <View style={foldoutCardStyle()}>
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '900' }}>{t('settings.retryTimeoutSettings')}</Text>
            <View style={pairedFieldRowStyle}>
              <IsleField
                label={t('settings.upstreamRequestTimeoutMs')}
                inputProps={{
                  value: String(settings.upstreamRequestTimeoutMs ?? 60000),
                  onChangeText: (value) => updatePositiveInteger('upstreamRequestTimeoutMs', value, 60000, 5000, 300000),
                  keyboardType: 'number-pad',
                }}
                style={pairedFieldStyle}
              />
              <IsleField
                label={t('settings.upstreamMaxRetries')}
                inputProps={{
                  value: String(settings.upstreamMaxRetries ?? 1),
                  onChangeText: (value) => updatePositiveInteger('upstreamMaxRetries', value, 1, 0, 5),
                  keyboardType: 'number-pad',
                }}
                style={pairedFieldStyle}
              />
            </View>
            <IsleToggle
              title={t('settings.upstreamCircuitBreakerEnabled')}
              active={settings.upstreamCircuitBreakerEnabled !== false}
              onPress={() => updateSettings({ upstreamCircuitBreakerEnabled: settings.upstreamCircuitBreakerEnabled === false })}
            />
            <View style={pairedFieldRowStyle}>
              <IsleField
                label={t('settings.upstreamCircuitBreakerFailureThreshold')}
                inputProps={{
                  value: String(settings.upstreamCircuitBreakerFailureThreshold ?? 3),
                  onChangeText: (value) => updatePositiveInteger('upstreamCircuitBreakerFailureThreshold', value, 3, 1, 20),
                  keyboardType: 'number-pad',
                }}
                style={pairedFieldStyle}
              />
              <IsleField
                label={t('settings.upstreamCircuitBreakerCooldownMs')}
                inputProps={{
                  value: String(settings.upstreamCircuitBreakerCooldownMs ?? 60000),
                  onChangeText: (value) => updatePositiveInteger('upstreamCircuitBreakerCooldownMs', value, 60000, 1000, 3600000),
                  keyboardType: 'number-pad',
                }}
                style={pairedFieldStyle}
              />
            </View>
          </View>
          <View style={foldoutCardStyle()}>
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '900' }}>{t('settings.rectificationSettings')}</Text>
            <IsleToggle title={t('settings.requestRectificationEnabled')} active={settings.requestRectificationEnabled !== false} onPress={() => updateSettings({ requestRectificationEnabled: settings.requestRectificationEnabled === false })} />
            <IsleToggle title={t('settings.anthropicThinkingSignatureRectificationEnabled')} active={settings.anthropicThinkingSignatureRectificationEnabled !== false} onPress={() => updateSettings({ anthropicThinkingSignatureRectificationEnabled: settings.anthropicThinkingSignatureRectificationEnabled === false })} />
            <IsleToggle title={t('settings.anthropicThinkingBudgetRectificationEnabled')} active={settings.anthropicThinkingBudgetRectificationEnabled !== false} onPress={() => updateSettings({ anthropicThinkingBudgetRectificationEnabled: settings.anthropicThinkingBudgetRectificationEnabled === false })} />
          </View>
          <View style={foldoutCardStyle()}>
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '900' }}>{t('settings.bedrockOptimizerSettings')}</Text>
            <IsleToggle title={t('settings.bedrockRequestOptimizerEnabled')} active={settings.bedrockRequestOptimizerEnabled === true} onPress={() => updateSettings({ bedrockRequestOptimizerEnabled: settings.bedrockRequestOptimizerEnabled !== true })} />
            <IsleToggle title={t('settings.thinkingOptimizerEnabled')} active={settings.thinkingOptimizerEnabled === true} onPress={() => updateSettings({ thinkingOptimizerEnabled: settings.thinkingOptimizerEnabled !== true })} />
            <IsleToggle title={t('settings.cacheInjectionEnabled')} active={settings.cacheInjectionEnabled === true} onPress={() => updateSettings({ cacheInjectionEnabled: settings.cacheInjectionEnabled !== true })} />
            <SegmentedSetting label={t('settings.cacheTtl')} options={CACHE_TTL_OPTIONS} value={settings.cacheTtl ?? 'default'} onChange={(cacheTtl) => updateSettings({ cacheTtl })} />
          </View>
          <View style={foldoutCardStyle()}>
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
            <View style={{ borderRadius: colors.ui.radius.card, padding: 13, backgroundColor: resolveSettingsFoldoutSurface(colors, colors.ui.glass, 'muted'), borderWidth: subtleBorderWidth, borderColor: resolveSettingsFoldoutBorder(colors, colors.ui.glass) }}>
              <VersionRow label={t('settings.appVersion')} value={`${version.appVersion} (${version.buildVersion})`} />
              <VersionRow label={t('settings.lastCheck')} value={formatUpdateCheckTime(settings.lastApkUpdateCheckAt)} />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', gap: 10 }}>
              <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: narrowLayout ? '100%' : '45%', minWidth: 0 }}>
                <DataButton
                  label={updateActionLabel}
                  icon={updatingApk ? <ActivityIndicator color={colors.ui.control.primaryForeground} size="small" /> : <AppIcon name="device" color={colors.ui.control.primaryForeground} size={18} />}
                  onPress={() => void checkApkUpdate()}
                  disabled={updatingApk}
                />
              </View>
              <View style={{ flexGrow: 1.2, flexShrink: 1, flexBasis: narrowLayout ? '100%' : '50%', minWidth: 0 }}>
                <IsleToggle
                  icon={<AppIcon name="retry" color={colors.text} size={18} />}
                  title={t('settings.autoCheck')}
                  active={settings.autoUpdateCheckEnabled ?? true}
                  onPress={toggleAutoCheck}
                />
              </View>
            </View>
            {updateProgressDetail ? (
              <View style={{ borderRadius: colors.ui.radius.card, padding: 11, backgroundColor: resolveSettingsFoldoutSurface(colors, colors.ui.glass, 'muted'), borderWidth: subtleBorderWidth, borderColor: resolveSettingsFoldoutBorder(colors, colors.ui.glass) }}>
                <Text style={{ color: colors.text, fontSize: 12, lineHeight: 17, fontWeight: '900' }}>{updateActionLabel}</Text>
                <Text style={{ marginTop: 4, color: colors.textSecondary, fontSize: 11, lineHeight: 16, fontWeight: '700' }}>{updateProgressDetail}</Text>
              </View>
            ) : null}
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
              <DangerButton label={t('settings.clearChats')} icon={<AppIcon name="delete" color={colors.ui.control.dangerForeground} size={18} />} onPress={confirmClearChats} />
              <DangerButton label={t('settings.resetSettings')} icon={<AppIcon name="retry" color={colors.ui.control.dangerForeground} size={18} />} onPress={confirmResetSettings} />
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

function RuntimeRepairTaskActions({
  repairPlan,
  onOpenTask,
}: {
  repairPlan: RuntimeDiagnosticsSummary['timeline']['repairPlan']
  onOpenTask: (task: RuntimeRepairTask) => void
}) {
  const { colors } = useAppTheme()
  const { width } = useWindowDimensions()
  const { t } = useTranslation()
  const compact = width < 430
  const visibleTasks = repairPlan.tasks.slice(0, 4)
  return (
    <View style={{ borderRadius: colors.ui.radius.card, padding: 10, backgroundColor: colors.ui.cartoon ? colors.ui.semantic.surface.muted : colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted, borderWidth: colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth, borderColor: colors.ui.cartoon ? colors.material.stroke : colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border, gap: 9 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <AppIcon name="tools" color={colors.textSecondary} size={16} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '900', includeFontPadding: false, textAlignVertical: 'center' }}>{t('settings.runtimeRepairTasks')}</Text>
          <Text numberOfLines={2} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, fontWeight: '800', marginTop: 2, includeFontPadding: false, textAlignVertical: 'center' }}>
            {t('settings.runtimeRepairTasksValue', {
              count: repairPlan.taskCount,
              critical: repairPlan.bySeverity.critical,
              warning: repairPlan.bySeverity.warning,
            })}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: compact ? 'column' : 'row', flexWrap: compact ? 'nowrap' : 'wrap', gap: 8, alignItems: compact ? 'stretch' : 'center' }}>
        {visibleTasks.map((task) => {
          const tone = runtimeRepairTaskButtonTone(task)
          return (
            <IsleButton
              key={task.id}
              label={formatRuntimeRepairTaskButtonLabel(task, t)}
              compact
              tone={tone}
              icon={<AppIcon name={runtimeRepairTaskIconName(task.target.kind)} color={runtimeRepairTaskIconColor(colors, tone)} size={14} />}
              onPress={() => onOpenTask(task)}
              style={{ flexGrow: 1, flexShrink: 1, flexBasis: compact ? '100%' : '47%', minWidth: 0, alignSelf: 'stretch' }}
              textStyle={{ textAlign: 'center' }}
            />
          )
        })}
      </View>
    </View>
  )
}

function SettingsSectionTitle({ children }: { children: string }) {
  const { colors } = useAppTheme()
  return (
    <View
      style={{
        marginTop: 18,
        minHeight: 30,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
        paddingHorizontal: 0,
      }}
    >
      <View style={{ width: 3, height: 16, borderRadius: colors.ui.radius.chip, backgroundColor: colors.ui.section.marker }} />
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        style={{
          flexShrink: 1,
          minWidth: 0,
          color: colors.ui.section.title,
          fontSize: 14,
          lineHeight: 19,
          fontWeight: '900',
          includeFontPadding: false,
          textAlignVertical: 'center',
        }}
      >
        {children}
      </Text>
      <View style={{ flex: 1, height: 1, borderRadius: colors.ui.radius.chip, backgroundColor: colors.ui.section.divider }} />
    </View>
  )
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
  const motion = useMotionPreference()
  const activeBackground = colors.ui.control.primaryBackground
  const activeForeground = colors.ui.control.primaryForeground
  const activeBorder = colors.ui.control.primaryBorder
  const subtleBorderWidth = colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth
  const inactiveBackground = colors.ui.cartoon ? colors.ui.semantic.surface.muted : colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted
  const inactiveBorder = colors.ui.cartoon ? colors.material.stroke : colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  const previewBackground = active ? colors.highlight : colors.ui.glass ? colors.ui.semantic.surface.overlay : colors.ui.semantic.surface.base
  return (
    <IslePressable haptic onPress={onPress} style={{ flexGrow: 1, flexShrink: 1, flexBasis: '47%', minWidth: 0, minHeight: 88 }}>
      <MotiView
        animate={{
          backgroundColor: active ? activeBackground : inactiveBackground,
          borderColor: active ? activeBorder : inactiveBorder,
          scale: active ? 1.006 : 1,
        }}
        transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: 1 }}
        style={{
          minHeight: 84,
          borderRadius: colors.ui.radius.card,
          padding: 9,
          justifyContent: 'center',
          borderWidth: subtleBorderWidth,
          gap: 5,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, padding: 3, borderRadius: colors.ui.radius.controlSmall, backgroundColor: previewBackground }}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: active ? activeForeground : colors.ui.icon.accentForeground }} />
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: active ? colors.ui.tone.neutral.background : colors.ui.tone.warning.foreground }} />
            </View>
          <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: active ? activeForeground : colors.text, fontSize: 14, lineHeight: 19, fontWeight: '900' }}>
            {label}
          </Text>
          <View style={{ width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: previewBackground, borderWidth: subtleBorderWidth, borderColor: active ? colors.ui.control.primaryBorder : inactiveBorder }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: active ? activeForeground : 'transparent' }} />
          </View>
        </View>
        <Text numberOfLines={2} style={{ color: active ? activeForeground : colors.textSecondary, fontSize: 11, lineHeight: 16, fontWeight: '800', opacity: active ? 0.82 : 1 }}>
          {detail}
        </Text>
      </MotiView>
    </IslePressable>
  )
}

function ThemeModeCard({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const subtleBorderWidth = colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth
  const inactiveBackground = colors.ui.cartoon ? colors.ui.semantic.surface.muted : colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted
  const inactiveBorder = colors.ui.cartoon ? colors.material.stroke : colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  return (
    <IslePressable haptic onPress={onPress} style={{ flex: 1, minWidth: 0, minHeight: themeModeCardHeight }}>
      <MotiView
        animate={{
          backgroundColor: active ? colors.ui.control.primaryBackground : inactiveBackground,
          borderColor: active ? colors.ui.control.primaryBorder : inactiveBorder,
          scale: active ? 1.006 : 1,
        }}
        transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: 1 }}
        style={{
          minHeight: themeModeCardHeight,
          borderRadius: colors.ui.radius.card,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: subtleBorderWidth,
          paddingHorizontal: 10,
          gap: 6,
        }}
      >
        <View style={{ width: 38, height: 16, borderRadius: 8, overflow: 'hidden', borderWidth: subtleBorderWidth, borderColor: active ? colors.ui.control.primaryBorder : inactiveBorder }}>
          <View style={{ flex: 1, flexDirection: 'row' }}>
            <View style={{ flex: 1, backgroundColor: active ? colors.ui.control.primaryForeground : colors.ui.input.background }} />
            <View style={{ flex: 1, backgroundColor: active ? colors.highlight : colors.ui.glass ? colors.ui.semantic.surface.overlay : colors.ui.semantic.surface.muted }} />
          </View>
        </View>
        <Text numberOfLines={1} style={{ color: active ? colors.ui.control.primaryForeground : colors.textSecondary, fontSize: 13, lineHeight: 18, fontWeight: '900', includeFontPadding: false, textAlignVertical: 'center' }}>
          {label}
        </Text>
      </MotiView>
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

function formatApkUpdateProgressDetail(
  stage: ApkUpdateUiStage,
  release: ApkReleaseInfo,
  progress: ApkInstallProgress | null,
  t: ReturnType<typeof useTranslation>['t']
): string {
  const stageLabel = t(updateStageLabelKey(stage))
  const releaseSize = release.sizeBytes ? formatApkSizeBytes(release.sizeBytes) : t('updates.unknown')
  if (stage === 'downloading' && progress?.bytesWritten != null) {
    const written = formatApkSizeBytes(progress.bytesWritten)
    const expected = progress.bytesExpected ? formatApkSizeBytes(progress.bytesExpected) : releaseSize
    const percent = progress.percent != null ? `${progress.percent}% · ` : ''
    return t('settings.apkUpdateDownloadProgressDetail', {
      stage: stageLabel,
      name: release.apkName,
      progress: `${percent}${written} / ${expected}`,
    })
  }
  return t('settings.apkUpdateProgressDetail', {
    stage: stageLabel,
    name: release.apkName,
    size: releaseSize,
  })
}

function buildDiagnosticRows(
  diagnostics: RuntimeDiagnosticsSummary,
  t: ReturnType<typeof useTranslation>['t'],
  pluginCatalog?: PluginManifestCatalogSnapshot | null
): Array<{ key: string; label: string; value: string; tone: 'mint' | 'amber' | 'danger' | 'default' }> {
  const rows: Array<{ key: string; label: string; value: string; tone: 'mint' | 'amber' | 'danger' | 'default' }> = [
    {
      key: 'responses',
      label: t('settings.runtimeDiagnosticResponses'),
      value: t('settings.runtimeDiagnosticResponsesValue', {
        ready: diagnostics.responses.readyProviders,
        capable: diagnostics.responses.capableProviders,
        active: Object.keys(diagnostics.responses.activeProtocols).length,
      }),
      tone: diagnostics.responses.readyProviders ? 'mint' : diagnostics.responses.capableProviders ? 'amber' : 'default',
    },
    {
      key: 'websocket',
      label: t('settings.runtimeDiagnosticWebSocket'),
      value: t('settings.runtimeDiagnosticWebSocketValue', {
        mode: t(`settings.transport${diagnostics.websocket.mode === 'auto' ? 'Auto' : diagnostics.websocket.mode === 'http' ? 'Http' : 'WebSocket'}`),
        ready: diagnostics.websocket.readyProviders,
        capable: diagnostics.websocket.capableProviders,
        fallback: diagnostics.websocket.fallbackCount,
      }),
      tone: diagnostics.websocket.mode === 'websocket' && !diagnostics.websocket.readyProviders ? 'amber' : 'mint',
    },
    {
      key: 'compact',
      label: t('settings.runtimeDiagnosticCompact'),
      value: t('settings.runtimeDiagnosticCompactValue', {
        mode: t(`settings.compact${diagnostics.compact.mode === 'off' ? 'Off' : diagnostics.compact.mode === 'auto' ? 'Auto' : 'Required'}`),
        count: diagnostics.compact.requestCount,
        remote: diagnostics.compact.remoteRequestCount,
        local: diagnostics.compact.localCompressionCount,
        fallback: diagnostics.compact.localFallbackCount,
        ready: diagnostics.compact.readyProviders,
        saved: diagnostics.compact.estimatedSavedTokens,
        localSaved: diagnostics.compact.localEstimatedSavedTokens,
        localRatio: formatCompactRatio(diagnostics.compact.localAverageCompressionRatio),
        fallbackReasons: [
          diagnostics.compact.fallbackReasons.belowThreshold ? t('settings.runtimeDiagnosticCompactReasonBelowThreshold', { count: diagnostics.compact.fallbackReasons.belowThreshold }) : null,
          diagnostics.compact.fallbackReasons.providerCapabilityMissing ? t('settings.runtimeDiagnosticCompactReasonCapabilityMissing', { count: diagnostics.compact.fallbackReasons.providerCapabilityMissing }) : null,
          diagnostics.compact.fallbackReasons.disabled ? t('settings.runtimeDiagnosticCompactReasonDisabled', { count: diagnostics.compact.fallbackReasons.disabled }) : null,
        ].filter(Boolean).join(' · '),
      }),
      tone: diagnostics.compact.failureCount ? 'amber' : 'mint',
    },
    {
      key: 'context-control-plane',
      label: t('settings.runtimeDiagnosticContextControlPlane'),
      value: t('settings.runtimeDiagnosticContextControlPlaneValue', {
        planned: diagnostics.contextControlPlane.planned,
        compact: diagnostics.contextControlPlane.compactDecided,
        capped: diagnostics.contextControlPlane.cappedFragments,
        cache: diagnostics.contextControlPlane.cacheDiagnostics,
        rewrite: diagnostics.contextControlPlane.fullRewriteDetected,
        unbounded: diagnostics.contextControlPlane.unboundedBlocked,
        manifest: diagnostics.contextControlPlane.manifests,
        manifestIssues: diagnostics.contextControlPlane.manifestIssues,
        examples: formatContextControlPlaneExamples(diagnostics.contextControlPlane.recentExamples, t),
      }),
      tone: diagnostics.contextControlPlane.unboundedBlocked || diagnostics.contextControlPlane.fullRewriteDetected || diagnostics.contextControlPlane.manifestIssues ? 'amber' : diagnostics.contextControlPlane.planned ? 'mint' : 'default',
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
      key: 'rectification',
      label: t('settings.runtimeDiagnosticRectification'),
      value: t('settings.runtimeDiagnosticRectificationValue', {
        total: diagnostics.rectification.total,
        retrying: diagnostics.rectification.retrying,
        success: diagnostics.rectification.success,
        failed: diagnostics.rectification.failed,
        examples: formatRectificationExamples(diagnostics.rectification.recentExamples, t),
      }),
      tone: diagnostics.rectification.failed ? 'amber' : diagnostics.rectification.success ? 'mint' : 'default',
    },
    {
      key: 'provider-health',
      label: t('settings.runtimeDiagnosticProviderHealth'),
      value: t('settings.runtimeDiagnosticProviderHealthValue', {
        cooldown: diagnostics.providerHealth.cooldown,
        circuit: diagnostics.providerHealth.circuitOpen,
        quota: diagnostics.providerHealth.quotaExhausted,
        credential: diagnostics.providerHealth.credentialUnhealthy,
        examples: formatProviderHealthExamples(diagnostics.providerHealth.recentExamples, t),
      }),
      tone: diagnostics.providerHealth.circuitOpen || diagnostics.providerHealth.quotaExhausted || diagnostics.providerHealth.credentialUnhealthy ? 'amber' : diagnostics.providerHealth.cooldown ? 'default' : 'mint',
    },
    {
      key: 'session-affinity',
      label: t('settings.runtimeDiagnosticSessionAffinity'),
      value: t('settings.runtimeDiagnosticSessionAffinityValue', {
        resolved: diagnostics.sessionAffinity.resolved,
        bound: diagnostics.sessionAffinity.bound,
        invalidated: diagnostics.sessionAffinity.invalidated,
        rotated: diagnostics.sessionAffinity.rotated,
        examples: formatSessionAffinityExamples(diagnostics.sessionAffinity.recentExamples, t),
      }),
      tone: diagnostics.sessionAffinity.invalidated || diagnostics.sessionAffinity.rotated ? 'amber' : diagnostics.sessionAffinity.bound ? 'mint' : 'default',
    },
    {
      key: 'request-examples',
      label: t('settings.runtimeDiagnosticRequestExamples'),
      value: t('settings.runtimeDiagnosticRequestExamplesValue', {
        examples: formatRequestExamples(diagnostics.requestExamples, t),
      }),
      tone: diagnostics.requestExamples.some((example) => example.kind === 'conformance_block' || example.kind === 'fallback') ? 'amber' : diagnostics.requestExamples.length ? 'mint' : 'default',
    },
    {
      key: 'runtime-timeline',
      label: t('settings.runtimeDiagnosticTimeline'),
      value: t('settings.runtimeDiagnosticTimelineValue', {
        total: diagnostics.timeline.counts.total,
        provider: diagnostics.timeline.counts.byStage.provider,
        context: diagnostics.timeline.counts.byStage.context,
        compact: diagnostics.timeline.counts.byStage.compact,
        plugin: diagnostics.timeline.counts.byStage.plugin,
        tool: diagnostics.timeline.counts.byStage.tool,
        session: diagnostics.timeline.counts.byStage.session,
        blocked: diagnostics.timeline.counts.byStatus.blocked,
        error: diagnostics.timeline.counts.byStatus.error,
        running: diagnostics.timeline.counts.byStatus.running,
        issues: diagnostics.timeline.issues.length,
        repairs: diagnostics.timeline.repairPlan.taskCount,
        examples: formatRuntimeTimelineExamples(diagnostics.timeline.entries, t),
        issueExamples: formatRuntimeTimelineIssues(diagnostics.timeline.issues, t),
        repairExamples: formatRuntimeTimelineRepairTasks(diagnostics.timeline.repairPlan, t),
      }),
      tone: diagnostics.timeline.issues.some((issue) => issue.severity === 'critical') || diagnostics.timeline.counts.byStatus.error
        ? 'danger'
        : diagnostics.timeline.issues.some((issue) => issue.severity === 'warning') || diagnostics.timeline.counts.byStatus.blocked
          ? 'amber'
          : diagnostics.timeline.counts.total ? 'mint' : 'default',
    },
    {
      key: 'runtime-performance',
      label: t('settings.runtimeDiagnosticPerformance'),
      value: t('settings.runtimeDiagnosticPerformanceValue', {
        duration: diagnostics.performance.buildDurationMs,
        tail: diagnostics.performance.logTailBytes,
        parsed: diagnostics.performance.parsedLogEntries,
        rawParsed: diagnostics.performance.rawParsedLogEntries,
        logLimit: diagnostics.performance.logEntryLimit,
        merged: diagnostics.performance.mergedLogEntries,
        memory: diagnostics.performance.memoryEventEntries,
        timeline: diagnostics.performance.timelineInputEvents,
        timelineLimit: diagnostics.performance.timelineEventLimit,
      }),
      tone: diagnostics.performance.parsedLogEntryLimitApplied || diagnostics.performance.timelineInputEvents >= diagnostics.performance.timelineEventLimit || diagnostics.performance.buildDurationMs > 750
        ? 'amber'
        : diagnostics.performance.mergedLogEntries ? 'mint' : 'default',
    },
    {
      key: 'observability',
      label: t('settings.runtimeDiagnosticObservability'),
      value: t('settings.runtimeDiagnosticObservabilityValue', {
        mode: t(`settings.runtimeDiagnosticObservabilityMode.${diagnostics.observability.mode}`),
        network: diagnostics.observability.networkExportAllowed ? t('settings.runtimeDiagnosticObservabilityAllowed') : t('settings.runtimeDiagnosticObservabilityBlocked'),
        local: diagnostics.observability.localDiagnosticsAllowed ? t('settings.runtimeDiagnosticObservabilityAllowed') : t('settings.runtimeDiagnosticObservabilityBlocked'),
        endpoint: t(`settings.runtimeDiagnosticObservabilityEndpoint.${diagnostics.observability.endpointKind}`),
        highFrequency: t(`settings.runtimeDiagnosticObservabilityHighFrequency.${diagnostics.observability.highFrequencyExportMode}`),
        attr: diagnostics.observability.effectiveAttributeLimit,
        string: diagnostics.observability.effectiveAttributeStringLimit,
        preview: t(`settings.runtimeDiagnosticObservabilityPreviewStatus.${diagnostics.observability.previewStatus}`),
        events: diagnostics.observability.previewEventCount,
        eventLimit: diagnostics.observability.previewEventLimit,
        spans: diagnostics.observability.previewSpanCount,
        failures: formatObservabilityPreviewFailures(diagnostics.observability.previewFailureCodes, t),
        blocks: formatObservabilityPolicyBlockReasons(diagnostics.observability.blockReasons, t),
        warnings: formatObservabilityPolicyWarnings(diagnostics.observability.warnings, t),
      }),
      tone: diagnostics.observability.networkExportAllowed ? 'mint' : diagnostics.observability.localDiagnosticsAllowed ? 'amber' : 'default',
    },
    ...(pluginCatalog
      ? [{
          key: 'plugin-catalog',
          label: t('settings.runtimeDiagnosticPluginCatalog'),
          value: t('settings.runtimeDiagnosticPluginCatalogValue', {
            total: pluginCatalog.counts.total,
            valid: pluginCatalog.counts.valid,
            invalid: pluginCatalog.counts.invalid,
            enabled: pluginCatalog.counts.enabled,
            hooks: pluginCatalog.counts.hooks,
            noop: pluginCatalog.counts.noopHooks,
            executable: pluginCatalog.counts.executableHooks,
            approved: pluginCatalog.reviewStates.approved,
            unreviewed: pluginCatalog.reviewStates.unreviewed,
            capabilities: formatPluginCatalogCapabilities(pluginCatalog.requiredCapabilities, t),
          }),
          tone: pluginCatalog.counts.executableHooks || pluginCatalog.counts.invalid
            ? 'danger'
            : pluginCatalog.reviewStates.unreviewed || pluginCatalog.counts.warnings
              ? 'amber'
              : pluginCatalog.counts.total ? 'mint' : 'default',
        } as const]
      : []),
    {
      key: 'proxy',
      label: t('settings.runtimeDiagnosticProxy'),
      value: [
        t(`settings.runtimeProxyReason.${diagnostics.proxy.reason}`),
        ...diagnostics.proxy.warnings.map((warning) => t(`settings.runtimeProxyWarning.${warning}`)),
      ].filter(Boolean).join(' · '),
      tone: diagnostics.proxy.reason === 'invalid_custom_base_url' ? 'danger' : diagnostics.proxy.warnings.length ? 'amber' : diagnostics.proxy.applied ? 'mint' : 'default',
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
      key: 'provider-coverage',
      label: t('settings.runtimeDiagnosticProviderCoverage'),
      value: t('settings.runtimeDiagnosticProviderCoverageValue', {
        official: diagnostics.capabilityMatrix.hostingProfiles.official,
        aggregator: diagnostics.capabilityMatrix.hostingProfiles.aggregator,
        relay: diagnostics.capabilityMatrix.hostingProfiles.relay,
        local: diagnostics.capabilityMatrix.hostingProfiles['local-runtime'],
        hosted: diagnostics.capabilityMatrix.hostingProfiles['cloud-hosted'],
      }),
      tone: diagnostics.capabilityMatrix.hostingProfiles['cloud-hosted'] ? 'amber' : 'mint',
    },
    {
      key: 'provider-support',
      label: t('settings.runtimeDiagnosticProviderSupport'),
      value: t('settings.runtimeDiagnosticProviderSupportValue', {
        full: diagnostics.capabilityMatrix.supportLevels.full,
        partial: diagnostics.capabilityMatrix.supportLevels.partial,
        planned: diagnostics.capabilityMatrix.supportLevels.planned,
        hosted: diagnostics.capabilityMatrix.hostedGapProviders,
        modelList: diagnostics.capabilityMatrix.genericModelListSuppressedProviders,
      }),
      tone: diagnostics.capabilityMatrix.plannedProviders ? 'amber' : diagnostics.capabilityMatrix.partialProviders ? 'default' : 'mint',
    },
    {
      key: 'provider-support-evidence',
      label: t('settings.runtimeDiagnosticProviderSupportEvidence'),
      value: t('settings.runtimeDiagnosticProviderSupportEvidenceValue', {
        planned: formatCapabilityMatrixExamples(diagnostics.capabilityMatrix.statusExamples.planned, t),
        partial: formatCapabilityMatrixExamples(diagnostics.capabilityMatrix.statusExamples.partial, t),
      }),
      tone: diagnostics.capabilityMatrix.statusExamples.planned.length ? 'amber' : 'default',
    },
    {
      key: 'provider-contract',
      label: t('settings.runtimeDiagnosticProviderContract'),
      value: t('settings.runtimeDiagnosticProviderContractValue', {
        ready: diagnostics.compatibility.conformanceReadyProviders,
        mapped: diagnostics.compatibility.docsMappedProviders,
        live: diagnostics.compatibility.needsLiveSmokeProviders,
        reference: diagnostics.compatibility.protocolReferenceProviders,
        gates: diagnostics.compatibility.liveSmokeGateCount,
        logged: diagnostics.compatibility.loggedEvents,
      }),
      tone: diagnostics.compatibility.needsLiveSmokeProviders || diagnostics.compatibility.docsMappedProviders ? 'amber' : 'mint',
    },
    {
      key: 'provider-capability-status',
      label: t('settings.runtimeDiagnosticCapabilityStatus'),
      value: t('settings.runtimeDiagnosticCapabilityStatusValue', {
        supported: diagnostics.compatibility.capabilityStatuses.supported,
        partial: diagnostics.compatibility.capabilityStatuses.partial,
        unsupported: diagnostics.compatibility.capabilityStatuses.unsupported,
        live: diagnostics.compatibility.capabilityStatuses.requiresLiveKey,
        docs: diagnostics.compatibility.capabilityStatuses.docsChanged,
      }),
      tone: diagnostics.compatibility.capabilityStatuses.docsChanged || diagnostics.compatibility.capabilityStatuses.requiresLiveKey ? 'amber' : 'default',
    },
    {
      key: 'provider-capability-send-policy',
      label: t('settings.runtimeDiagnosticCapabilitySendPolicy'),
      value: t('settings.runtimeDiagnosticCapabilitySendPolicyValue', {
        contract: diagnostics.compatibility.capabilitySendSources.contract,
        identity: diagnostics.compatibility.capabilitySendSources.provider_identity,
        declared: diagnostics.compatibility.capabilitySendSources.explicit_declaration,
        blocked: diagnostics.compatibility.capabilitySendSources.blocked,
        examples: formatCapabilitySendPolicyExamples(diagnostics.compatibility.capabilitySendPolicyExamples.explicit_declaration, t),
      }),
      tone: diagnostics.compatibility.capabilitySendSources.explicit_declaration ? 'amber' : 'default',
    },
    {
      key: 'provider-capability-evidence',
      label: t('settings.runtimeDiagnosticCapabilityEvidence'),
      value: t('settings.runtimeDiagnosticCapabilityEvidenceValue', {
        unsupported: formatCapabilityStatusExamples(diagnostics.compatibility.capabilityStatusExamples.unsupported, t),
        live: formatCapabilityStatusExamples(diagnostics.compatibility.capabilityStatusExamples.requiresLiveKey, t),
        partial: formatCapabilityStatusExamples(diagnostics.compatibility.capabilityStatusExamples.partial, t),
      }),
      tone: diagnostics.compatibility.capabilityStatusExamples.requiresLiveKey.length ? 'amber' : 'default',
    },
    {
      key: 'log',
      label: t('settings.runtimeDiagnosticLog'),
      value: diagnostics.log.enabled ? t('settings.runtimeDiagnosticLogOn') : t('settings.runtimeDiagnosticLogOff'),
      tone: diagnostics.log.enabled ? 'mint' : 'default',
    },
  ]
  return rows
}

function formatCompactRatio(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0%'
  return `${Math.round(value * 100)}%`
}

function formatPluginCatalogCapabilities(capabilities: Record<string, number>, t: ReturnType<typeof useTranslation>['t']): string {
  const examples = Object.entries(capabilities)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
  if (!examples.length) return t('settings.runtimeDiagnosticCapabilityEvidenceNone')
  return examples.map(([capability, count]) => `${capability} ${count}`).join(' · ')
}

function formatObservabilityPolicyBlockReasons(
  reasons: RuntimeDiagnosticsSummary['observability']['blockReasons'],
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!reasons.length) return t('settings.runtimeDiagnosticCapabilityEvidenceNone')
  return reasons.slice(0, 4).map((reason) => t(`settings.runtimeDiagnosticObservabilityBlockReason.${reason}`)).join(' · ')
}

function formatObservabilityPolicyWarnings(
  warnings: RuntimeDiagnosticsSummary['observability']['warnings'],
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!warnings.length) return t('settings.runtimeDiagnosticCapabilityEvidenceNone')
  return warnings.slice(0, 3).map((warning) => t(`settings.runtimeDiagnosticObservabilityWarning.${warning}`)).join(' · ')
}

function formatObservabilityPreviewFailures(
  failureCodes: RuntimeDiagnosticsSummary['observability']['previewFailureCodes'],
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!failureCodes.length) return t('settings.runtimeDiagnosticObservabilityPreviewFailuresNone')
  return failureCodes.slice(0, 3).join(' · ')
}

function formatCapabilityStatusExamples(
  examples: RuntimeDiagnosticsSummary['compatibility']['capabilityStatusExamples'][keyof RuntimeDiagnosticsSummary['compatibility']['capabilityStatusExamples']],
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!examples.length) return t('settings.runtimeDiagnosticCapabilityEvidenceNone')
  return examples.slice(0, 2).map((example) => {
    const provider = example.providerName || example.providerId || example.compatibilityId
    const gate = example.liveSmokeGates[0] ? `/${example.liveSmokeGates[0]}` : ''
    const reason = t(`settings.runtimeDiagnosticCapabilityReason.${example.limitationReason}`)
    const path = t(`settings.runtimeDiagnosticCapabilityPath.${example.degradationPath}`)
    return `${provider}:${example.capability} ${reason}/${path}${gate}`
  }).join(' · ')
}

function formatCapabilitySendPolicyExamples(
  examples: RuntimeDiagnosticsSummary['compatibility']['capabilitySendPolicyExamples'][keyof RuntimeDiagnosticsSummary['compatibility']['capabilitySendPolicyExamples']],
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!examples.length) return t('settings.runtimeDiagnosticCapabilityEvidenceNone')
  return examples.slice(0, 2).map((example) => {
    const provider = example.providerName || example.providerId || example.compatibilityId
    const source = t(`settings.runtimeDiagnosticCapabilitySendSource.${example.sendSource}`)
    const path = t(`settings.runtimeDiagnosticCapabilityPath.${example.degradationPath}`)
    return `${provider}:${example.capability} ${source}/${path}`
  }).join(' · ')
}

function formatCapabilityMatrixExamples(
  examples: RuntimeDiagnosticsSummary['capabilityMatrix']['statusExamples'][keyof RuntimeDiagnosticsSummary['capabilityMatrix']['statusExamples']],
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!examples.length) return t('settings.runtimeDiagnosticCapabilityEvidenceNone')
  return examples.slice(0, 2).map((example) => {
    const provider = example.providerName || example.providerId || example.compatibilityId
    const contract = example.contractStatus ? `/${example.contractStatus}` : ''
    const reason = example.limitationReason ? t(`settings.runtimeDiagnosticCapabilityReason.${example.limitationReason}`) : example.reason
    const path = example.degradationPath ? `/${t(`settings.runtimeDiagnosticCapabilityPath.${example.degradationPath}`)}` : ''
    return `${provider}:${example.area} ${example.level}${contract} ${reason}${path}`
  }).join(' · ')
}

function formatRectificationExamples(
  examples: RuntimeDiagnosticsSummary['rectification']['recentExamples'],
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!examples.length) return t('settings.runtimeDiagnosticCapabilityEvidenceNone')
  return examples.slice(0, 2).map((example) => {
    const provider = example.providerId || example.model || 'provider'
    const fields = [...example.failedFields.slice(0, 2), ...example.removedFields.slice(0, 2), ...example.retainedFields.slice(0, 2)]
    const fieldLabel = fields.length ? `:${Array.from(new Set(fields)).join('/')}` : ''
    const status = example.status ? `/${example.status}` : ''
    return `${provider}:${example.kind} ${example.result}${status}${fieldLabel}`
  }).join(' · ')
}

function formatProviderHealthExamples(
  examples: RuntimeDiagnosticsSummary['providerHealth']['recentExamples'],
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!examples.length) return t('settings.runtimeDiagnosticCapabilityEvidenceNone')
  return examples.slice(0, 2).map((example) => {
    const provider = example.providerId || example.model || 'provider'
    const group = example.credentialGroupId ? `/${example.credentialGroupId}` : ''
    const trigger = example.trigger ? `/${example.trigger}` : ''
    const status = example.status ? `/${example.status}` : ''
    return `${provider}${group} ${t(`settings.runtimeDiagnosticProviderHealthReason.${example.reason}`)}${trigger}${status}`
  }).join(' · ')
}

function formatSessionAffinityExamples(
  examples: RuntimeDiagnosticsSummary['sessionAffinity']['recentExamples'],
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!examples.length) return t('settings.runtimeDiagnosticCapabilityEvidenceNone')
  return examples.slice(0, 2).map((example) => {
    const provider = example.providerId || example.model || 'provider'
    const group = example.toGroupId || example.credentialGroupId || example.fromGroupId
    const groupLabel = group ? `/${group}` : ''
    const trigger = example.trigger ? `/${example.trigger}` : ''
    const status = example.upstreamStatus ? `/${example.upstreamStatus}` : ''
    return `${provider}${groupLabel} ${t(`settings.runtimeDiagnosticSessionAffinityStatus.${example.status}`)}${trigger}${status}`
  }).join(' · ')
}

function formatContextControlPlaneExamples(
  examples: RuntimeDiagnosticsSummary['contextControlPlane']['recentExamples'],
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!examples.length) return t('settings.runtimeDiagnosticCapabilityEvidenceNone')
  return examples.slice(0, 2).map((example) => {
    const provider = example.providerId || example.model || 'context'
    if (example.event === 'context.compact.decided') {
      return `${provider} compact ${example.compactMode ?? 'unknown'}/${example.compactEnabled ? 'on' : 'off'}/${example.compactReason ?? 'unknown'}`
    }
    const manifest = example.contextManifestSchema ? `/manifest ${example.contextManifestFailureCodes?.length ?? 0}` : ''
    return `${provider} fragments ${example.fragmentCount ?? 0}/capped ${example.cappedFragmentCount ?? 0}/cache ${example.cacheDiagnosticCount ?? 0}${manifest}`
  }).join(' · ')
}

function formatRequestExamples(
  examples: RuntimeDiagnosticsSummary['requestExamples'],
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!examples.length) return t('settings.runtimeDiagnosticCapabilityEvidenceNone')
  return examples.slice(0, 3).map((example) => {
    const provider = [example.providerId, example.model].filter(Boolean).join('/') || 'request'
    const label = t(`settings.runtimeDiagnosticRequestExampleKind.${example.kind}`)
    const detail = [
      example.protocol,
      example.status,
      example.reason,
      example.trigger,
      example.selectedProviderId ? `${example.selectedProviderId}${example.selectedModel ? `/${example.selectedModel}` : ''}` : undefined,
    ].filter(Boolean).join('/')
    return detail ? `${provider} ${label}:${detail}` : `${provider} ${label}`
  }).join(' · ')
}

function formatRuntimeTimelineExamples(
  entries: RuntimeDiagnosticsSummary['timeline']['entries'],
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!entries.length) return t('settings.runtimeDiagnosticCapabilityEvidenceNone')
  return entries.slice(-3).reverse().map((entry) => {
    const stage = t(`settings.runtimeDiagnosticTimelineStage.${entry.stage}`)
    const status = t(`settings.runtimeDiagnosticTimelineStatus.${entry.status}`)
    const scope = [entry.providerId, entry.model].filter(Boolean).join('/') || entry.conversationId || entry.event
    return `${stage}/${status} ${scope}:${entry.event}`
  }).join(' · ')
}

function formatRuntimeTimelineIssues(
  issues: RuntimeDiagnosticsSummary['timeline']['issues'],
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!issues.length) return t('settings.runtimeDiagnosticCapabilityEvidenceNone')
  return issues.slice(0, 3).map((issue) => {
    const label = t(`settings.runtimeDiagnosticTimelineIssue.${issue.code}`)
    const severity = t(`settings.runtimeDiagnosticTimelineSeverity.${issue.severity}`)
    const nextAction = t(`settings.runtimeDiagnosticTimelineNextAction.${issue.nextAction}`)
    const target = t(`settings.runtimeDiagnosticTimelineActionTarget.${issue.actionTarget.kind}`)
    const scope = [issue.providerId, issue.model].filter(Boolean).join('/') || issue.event
    return `${severity} ${label} ${scope} x${issue.count} -> ${nextAction} @ ${target}`
  }).join(' · ')
}

function formatRuntimeTimelineRepairTasks(
  repairPlan: RuntimeDiagnosticsSummary['timeline']['repairPlan'],
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!repairPlan.tasks.length) return t('settings.runtimeDiagnosticCapabilityEvidenceNone')
  return repairPlan.tasks.slice(0, 3).map((task) => {
    const severity = t(`settings.runtimeDiagnosticTimelineSeverity.${task.severity}`)
    const action = t(`settings.runtimeDiagnosticTimelineNextAction.${task.action}`)
    const target = t(`settings.runtimeDiagnosticTimelineActionTarget.${task.target.kind}`)
    const scope = [task.target.providerId, task.target.model].filter(Boolean).join('/') || task.target.conversationId || task.target.event
    return `${severity} ${action} @ ${target} ${scope} x${task.eventCount}`
  }).join(' · ')
}

function formatRuntimeRepairTaskButtonLabel(
  task: RuntimeRepairTask,
  t: ReturnType<typeof useTranslation>['t']
): string {
  const action = t(`settings.runtimeDiagnosticTimelineNextAction.${task.action}`)
  const target = t(`settings.runtimeDiagnosticTimelineActionTarget.${task.target.kind}`)
  return t('settings.runtimeRepairTaskButton', { action, target })
}

function formatRuntimeRepairTaskScope(task: RuntimeRepairTask): string {
  return [task.target.providerId, task.target.model].filter(Boolean).join('/') || task.target.conversationId || task.target.event
}

function runtimeRepairRouteParams(task: RuntimeRepairTask): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      source: 'runtime-repair',
      action: task.action,
      target: task.target.kind,
      event: task.target.event,
      providerId: task.target.providerId,
      credentialGroupId: task.target.credentialGroupId,
      model: task.target.model,
      conversationId: task.target.conversationId,
      severity: task.severity,
      issueCodes: task.issueCodes.join(','),
      sourceEventIds: task.sourceEventIds.join(','),
      latestEventId: task.latestEventId,
      eventCount: String(task.eventCount),
      summary: task.summary,
    }).filter(([, value]) => typeof value === 'string' && value.trim()),
  ) as Record<string, string>
}

function runtimeRepairTaskButtonTone(task: RuntimeRepairTask): 'danger' | 'amber' | 'soft' {
  if (task.severity === 'critical') return 'danger'
  if (task.severity === 'warning') return 'amber'
  return 'soft'
}

function runtimeRepairTaskIconColor(
  colors: ReturnType<typeof useAppTheme>['colors'],
  tone: ReturnType<typeof runtimeRepairTaskButtonTone>,
): string {
  if (tone === 'danger') return colors.ui.control.dangerForeground
  if (tone === 'amber') return colors.ui.control.primaryForeground
  return colors.textSecondary
}

function runtimeRepairTaskIconName(kind: RuntimeRepairTask['target']['kind']) {
  switch (kind) {
    case 'provider-settings':
      return 'provider-key'
    case 'tool-settings':
      return 'mcp-network'
    case 'context-settings':
      return 'context-globe'
    case 'plugin-settings':
    case 'agent-settings':
      return 'skills-sparkles'
    case 'session-affinity-settings':
    case 'compact-settings':
      return 'settings'
    case 'retry-chat':
      return 'message'
  }
}

function DiagnosticPill({ label, value, tone }: { label: string; value: string; tone: 'mint' | 'amber' | 'danger' | 'default' }) {
  const { colors } = useAppTheme()
  const { width } = useWindowDimensions()
  const compact = width < 390
  const toneToken = tone === 'mint'
    ? colors.ui.tone.success
    : tone === 'amber'
      ? colors.ui.tone.warning
      : tone === 'danger'
      ? colors.ui.tone.danger
      : colors.ui.tone.neutral
  return (
    <View style={{ minHeight: 64, minWidth: 0, flexGrow: 1, flexShrink: 1, flexBasis: compact ? '100%' : '47%', borderRadius: colors.ui.radius.card, padding: 10, backgroundColor: toneToken.background, borderWidth: colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth, borderColor: toneToken.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: toneToken.foreground }} />
        <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: '900', includeFontPadding: false, textAlignVertical: 'center' }}>{label}</Text>
      </View>
      <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, fontWeight: '800', marginTop: 5, includeFontPadding: false, textAlignVertical: 'center' }}>{value}</Text>
    </View>
  )
}

function importResultMessage(
  result: Awaited<ReturnType<typeof importFromJsonFileDetailed>>,
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!result.ok && result.reason === 'file_too_large') {
    return `${t('error.fileTooLarge')} (${formatImportSizeLimit(MAX_IMPORT_JSON_FILE_BYTES)})`
  }
  if (!result.ok) return t('settings.importSkippedMessage')
  if (result.kind === 'mem0') return t('settings.importMem0DoneMessage', { count: result.memories })
  return t('settings.importDoneMessage')
}

function VersionRow({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Text numberOfLines={2} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, fontWeight: '900', flexBasis: '34%', minWidth: 0, maxWidth: '42%', flexShrink: 1, includeFontPadding: false, textAlignVertical: 'center' }}>{label}</Text>
      <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12, lineHeight: 17, fontWeight: '800', flex: 1, minWidth: 0, includeFontPadding: false, textAlignVertical: 'center' }}>{value}</Text>
    </View>
  )
}

function DataButton({ label, icon, onPress, disabled = false }: { label: string; icon: ReactNode; onPress: () => void; disabled?: boolean }) {
  const { colors } = useAppTheme()
  return (
    <IsleButton
      label={label}
      icon={icon}
      tone="primary"
      block
      onPress={onPress}
      disabled={disabled}
      style={{ flexGrow: 1, flexShrink: 1, flexBasis: '47%', minWidth: 0, alignSelf: 'stretch', minHeight: 54, borderRadius: colors.ui.radius.controlLarge, justifyContent: 'center', paddingHorizontal: 16 }}
      textStyle={{ textAlign: 'center', textAlignVertical: 'center' }}
    />
  )
}

function DangerButton({ label, icon, onPress }: { label: string; icon: ReactNode; onPress: () => void }) {
  const { colors } = useAppTheme()
  return <IsleButton label={label} icon={icon} tone="danger" onPress={onPress} style={{ flexGrow: 1, flexShrink: 1, flexBasis: '47%', minWidth: 0, minHeight: 54, borderRadius: colors.ui.radius.controlLarge }} />
}
