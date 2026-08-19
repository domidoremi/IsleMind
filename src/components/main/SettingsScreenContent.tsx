import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Platform, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type ViewStyle } from 'react-native'
import { router } from 'expo-router'
import * as Application from 'expo-application'
import Constants from 'expo-constants'
import { AnimatePresence, MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { AnimatedNavigationTrigger } from '@/components/navigation/AnimatedNavigationTrigger'
import { AppIcon, appIconStroke, type AppIconName } from '@/components/ui/AppIcon'
import { HighFrameSpinner } from '@/components/ui/HighFrameSpinner'
import { ISLE_MIN_TOUCH_TARGET, IslePressable } from '@/components/ui/isle'
import { IsleChip } from '@/components/ui/isle'
import { IsleButton } from '@/components/ui/isle'
import { IsleProgress } from '@/components/ui/isle'
import { IsleDisclosure, IsleField, IsleToggle } from '@/components/ui/isle'
import { SettingsSummaryStrip, type SettingsSummaryItem } from '@/components/settings/SettingsSummaryStrip'
import { CommittedSettingsField } from '@/components/settings/CommittedSettingsField'
import {
  LimeRoadSettingsOverviewExperience,
  MarkdownSettingsOverviewExperience,
  MinimalSettingsOverviewExperience,
} from '@/components/settings/theme-experiences/SettingsOverviewExperiences'
import {
  SettingsControlCatalog,
  SettingsControlNavigation,
  type SettingsControlView,
} from '@/components/settings/theme-experiences/SettingsControlCatalogExperiences'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import type { PortableDataExportOptions, PortableDataExportResult } from '@/modules/data-management'
import {
  clearPortableApplicationData,
  exportPortableDataToJsonFile,
  importPortableDataFromJsonFile,
} from '@/presentation/features/settings/portableDataCommand'
import { formatImportSizeLimit, MAX_IMPORT_JSON_FILE_BYTES } from '@/platform/native/boundedImportFile'
import type { ApkInstallProgress, ApkInstallProgressStage, ApkReleaseInfo } from '@/services/appUpdates'
import { useIsleDialog } from '@/components/ui/isle'
import { resolveSearchProvider } from '@/modules/integrations'
import { searchProviderLabel } from '@/presentation/features/settings/searchProviderPresentation'
import {
  matchesSettingsControlSearch,
  normalizeSettingsControlSearch,
  type SettingsControlSearchDocument,
} from '@/presentation/features/settings/settingsControlSearch'
import { resolveProviderDisplayName } from '@/presentation/features/settings/providerPresentation'
import type { RuntimeDiagnosticsSummary } from '@/services/runtimeDiagnostics'
import type { PluginManifestCatalogSnapshot } from '@/services/pluginManifest'
import { changeAppLanguage } from '@/i18n'
import type { BedrockCacheTtl, CanonicalThemeId, Language, ObservabilitySinkHighFrequencyExportMode, ObservabilitySinkMode, ObservabilitySinkTarget, PayloadPolicyMode, ProxyMode, RemoteCompactMode, ThemeMode, UpstreamTransportMode } from '@/types/settingsContracts'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'
import { createLazyComponent } from '@/utils/lazyLoad'
import { getColors, normalizeThemeAccent } from '@/theme/colors'
import type { AndroidStatusNotificationPermissionStatus, AndroidStatusNotificationSettingsTarget } from '@/bootstrap/androidStatusNotification'

const LANGUAGE_OPTIONS: { id: Language; label: string; detail: string }[] = [
  { id: 'zh-CN', label: '简体中文', detail: '中文界面' },
  { id: 'en', label: 'English', detail: 'English UI' },
  { id: 'ja', label: '日本語', detail: '日本語 UI' },
]

function summarizeTavernExportAudit(result: PortableDataExportResult) {
  const scopedAudits = Object.values(result.tavernSnapshotAudits ?? {})
  const audits = scopedAudits
  return audits.reduce(
    (summary, audit) => ({
      hidden: summary.hidden + audit.hiddenRelationshipMemoryOmitted,
      privatePending: summary.privatePending + audit.hiddenPendingRelationshipMemoryCandidateOmitted,
      pending: summary.pending + audit.pendingWritebackOmitted,
      summaries: summary.summaries + audit.pendingSummaryDraftOmitted,
      characters: summary.characters + audit.pendingCharacterDraftOmitted,
      lore: summary.lore + audit.pendingLorebookDraftOmitted,
      memories: summary.memories + audit.pendingRelationshipMemoryCandidateOmitted,
      scenes: summary.scenes + audit.pendingSceneChangeOmitted,
    }),
    { hidden: 0, privatePending: 0, pending: 0, summaries: 0, characters: 0, lore: 0, memories: 0, scenes: 0 }
  )
}

const THEME_FAMILY_OPTIONS: { id: CanonicalThemeId; labelKey: string; detailKey: string }[] = [
  { id: 'minimal', labelKey: 'settings.themeMinimal', detailKey: 'settings.themeMinimalDescription' },
  { id: 'monet', labelKey: 'settings.themeMonet', detailKey: 'settings.themeMonetDescription' },
  { id: 'material', labelKey: 'settings.themeMaterial', detailKey: 'settings.themeMaterialDescription' },
  { id: 'liquid-glass', labelKey: 'settings.themeLiquidGlass', detailKey: 'settings.themeLiquidGlassDescription' },
]

const THEME_ACCENT_OPTIONS = [
  { id: 'default', color: undefined, labelKey: 'settings.themeAccentDefault' },
  { id: 'teal', color: '#0F766E', labelKey: 'settings.themeAccentTeal' },
  { id: 'indigo', color: '#4F46A5', labelKey: 'settings.themeAccentIndigo' },
  { id: 'coral', color: '#B94B3F', labelKey: 'settings.themeAccentCoral' },
  { id: 'amber', color: '#A96A12', labelKey: 'settings.themeAccentAmber' },
] as const

const settingsChipPressableStyle = { minHeight: 44, justifyContent: 'center' as const }
const themeModeCardHeight = 58
type ApkUpdateUiStage = 'checking' | ApkInstallProgressStage
const APK_UPDATE_BANNER_ID = 'apk-update-progress'
const APK_UPDATE_FEEDBACK_CLEAR_DELAY_MS = 12_000

const RuntimeDiagnosticsDetails = createLazyComponent(
  () => import('@/components/settings/RuntimeDiagnosticsDetails')
    .then((module) => ({ default: module.RuntimeDiagnosticsDetails })),
)

type AndroidStatusNotificationModule = typeof import('@/bootstrap/androidStatusNotification')
let androidStatusNotificationModulePromise: Promise<AndroidStatusNotificationModule> | undefined

function loadAndroidStatusNotification(): Promise<AndroidStatusNotificationModule> {
  androidStatusNotificationModulePromise ??= import('@/bootstrap/androidStatusNotification')
  return androidStatusNotificationModulePromise
}

function getSettingsVersionSnapshot(): { appVersion: string; buildVersion: string } {
  return {
    appVersion: Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '1.0.0',
    buildVersion: Application.nativeBuildVersion ?? String(Constants.platform?.android?.versionCode ?? '1'),
  }
}

function formatSettingsUpdateCheckTime(value: number | undefined, t: ReturnType<typeof useTranslation>['t']): string {
  if (!value) return t('updates.never')
  try {
    return new Date(value).toLocaleString()
  } catch {
    return t('updates.unknown')
  }
}

function formatSettingsApkSizeBytes(sizeBytes: number | undefined, unknownLabel: string): string {
  if (sizeBytes == null || !Number.isFinite(sizeBytes) || sizeBytes < 0) return unknownLabel
  if (sizeBytes >= 1024 * 1024) return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`
  if (sizeBytes >= 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`
  return `${sizeBytes} B`
}

function normalizeBoundedIntegerDraft(value: string, fallback: number, min: number, max: number): string {
  const parsed = Number.parseInt(value, 10)
  return String(Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback)
}

function normalizeRemoteCompactThresholdDraft(value: string): string {
  const parsed = Number.parseFloat(value)
  return String(Number.isFinite(parsed) ? Math.max(0.1, Math.min(2, parsed)) : 0.8)
}

function normalizeTrimmedDraft(value: string): string {
  return value.trim()
}

function normalizeSettingsListDraft(value: string): string {
  return joinSettingsList(parseSettingsList(value))
}

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
  return active ? colors.ui.icon.accentForeground : colors.textTertiary
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

type SettingsAdvancedGroup = 'appearance' | 'data' | 'advanced' | 'diagnostics' | 'governance' | 'updates' | 'danger'
type SettingsGovernanceGroup = 'routing' | 'workflow' | 'observability' | 'runtimeLimits' | 'requestShaping' | 'accessRules'
interface SettingsControlEntry extends SettingsControlSearchDocument {
  key: string
  icon: AppIconName
  active?: boolean
  tone?: 'default' | 'warning' | 'danger'
  onPress: () => void
}
type RuntimeRepairTask = RuntimeDiagnosticsSummary['timeline']['repairPlan']['tasks'][number]
type RuntimeRepairSettingsRoute = '/settings/providers' | '/settings/context' | '/settings/mcp' | '/settings/skills'
type SettingsChildRoute = RuntimeRepairSettingsRoute | '/settings/usage' | '/settings/preferences' | '/settings/memory' | '/settings/knowledge'

function pushSettingsChildRoute(pathname: SettingsChildRoute, params?: Record<string, string>) {
  router.push({
    pathname,
    params: {
      ...params,
      returnTo: 'settings',
    },
  })
}

function resolveSettingsFoldoutSurface(colors: ReturnType<typeof useAppTheme>['colors'], isGlass: boolean, variant: 'base' | 'muted' = 'base') {
  if (variant === 'muted') {
    return colors.ui.limeRoad ? colors.ui.semantic.surface.muted : isGlass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted
  }
  return colors.ui.limeRoad ? colors.ui.semantic.surface.base : isGlass ? colors.ui.semantic.chrome.background : colors.ui.semantic.surface.muted
}

function resolveSettingsFoldoutBorder(colors: ReturnType<typeof useAppTheme>['colors'], isGlass: boolean) {
  return colors.ui.limeRoad ? colors.material.stroke : isGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
}

export const SettingsScreenContent = memo(function SettingsScreenContent({ shellNavigation = false, onHome }: { shellNavigation?: boolean; onHome?: () => void } = {}) {
  const { colors, canonicalThemeId } = useAppTheme()
  const motion = useMotionPreference()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const { width } = useWindowDimensions()
  const narrowLayout = width < 430
  const actionCompact = width < 360
  const settingsPageBottomPadding = shellNavigation ? 72 : 56
  const pairedFieldRowStyle = { flexDirection: narrowLayout ? 'column' : 'row', gap: 10 } as const
  const pairedFieldStyle = narrowLayout ? undefined : { flex: 1, minWidth: 0 }
  const providers = useSettingsStore((state) => state.providers)
  const settings = useSettingsStore((state) => state.settings)
  const setTheme = useSettingsStore((state) => state.setTheme)
  const setThemeId = useSettingsStore((state) => state.setThemeId)
  const setThemeAccent = useSettingsStore((state) => state.setThemeAccent)
  const setLanguage = useSettingsStore((state) => state.setLanguage)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const resetSettings = useSettingsStore((state) => state.clearAll)
  const getObservabilitySinkApiKey = useSettingsStore((state) => state.getObservabilitySinkApiKey)
  const setObservabilitySinkApiKey = useSettingsStore((state) => state.setObservabilitySinkApiKey)
  const scrollRef = useRef<ScrollView>(null)
  const revealedSystemPanelRef = useRef<SettingsAdvancedGroup | null>(null)
  const apkUpdateFeedbackClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const diagnosticsRefreshInFlightRef = useRef(false)
  const [apkUpdateStage, setApkUpdateStage] = useState<ApkUpdateUiStage | null>(null)
  const [activeApkRelease, setActiveApkRelease] = useState<ApkReleaseInfo | null>(null)
  const [apkInstallProgress, setApkInstallProgress] = useState<ApkInstallProgress | null>(null)
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnosticsSummary | null>(null)
  const [pluginCatalog, setPluginCatalog] = useState<PluginManifestCatalogSnapshot | null>(null)
  const [refreshingDiagnostics, setRefreshingDiagnostics] = useState(false)
  const [diagnosticDetailsOpen, setDiagnosticDetailsOpen] = useState(false)
  const [observabilitySinkApiKeyDraft, setObservabilitySinkApiKeyDraft] = useState('')
  const [themeAccentDraft, setThemeAccentDraft] = useState(settings.themeAccent ?? '')
  const [savingObservabilitySinkApiKey, setSavingObservabilitySinkApiKey] = useState(false)
  const [runtimeLogPath, setRuntimeLogPath] = useState<string | null>(null)
  const [systemStatusNotificationStatus, setSystemStatusNotificationStatus] = useState<AndroidStatusNotificationPermissionStatus | null>(null)
  const [controlView, setControlView] = useState<SettingsControlView | null>('ai')
  const [settingsSearch, setSettingsSearch] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Record<SettingsAdvancedGroup, boolean>>({
    appearance: false,
    data: false,
    advanced: false,
    diagnostics: false,
    governance: false,
    updates: false,
    danger: false,
  })
  const [expandedGovernanceGroups, setExpandedGovernanceGroups] = useState<Record<SettingsGovernanceGroup, boolean>>({
    routing: false,
    workflow: false,
    observability: false,
    runtimeLimits: false,
    requestShaping: false,
    accessRules: false,
  })
  const activeSystemPanel: SettingsAdvancedGroup | null = expandedGroups.appearance
    ? 'appearance'
    : expandedGroups.data
      ? 'data'
      : expandedGroups.diagnostics
        ? 'diagnostics'
        : expandedGroups.governance
          ? 'governance'
          : expandedGroups.updates
            ? 'updates'
            : expandedGroups.danger
              ? 'danger'
              : expandedGroups.advanced
                ? 'advanced'
                : null
  const enabledProviders = providers.filter((provider) => provider.enabled).length
  const defaultProvider = providers.find((provider) => provider.id === settings.defaultProvider)
  const defaultProviderDisplayName = defaultProvider ? resolveProviderDisplayName(defaultProvider, t('providerSettings.customProvider')) : undefined
  const version = getSettingsVersionSnapshot()
  const searchProvider = resolveSearchProvider(settings)
  const activeThemeId = canonicalThemeId
  const activeCustomThemeAccent = Boolean(settings.themeAccent && !THEME_ACCENT_OPTIONS.some((item) => item.color === settings.themeAccent))
  const normalizedThemeAccentDraft = normalizeThemeAccent(themeAccentDraft)
  const subtleBorderWidth = colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth
  const foldoutBodyStyle = { marginTop: 12, paddingHorizontal: 0, paddingVertical: 2, gap: 12 }
  const foldoutCardStyle = (gap = 10): ViewStyle => ({
    borderRadius: Math.min(colors.ui.radius.card, 8),
    padding: 10,
    backgroundColor: colors.ui.limeRoad ? colors.ui.semantic.surface.muted : colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted,
    borderWidth: subtleBorderWidth,
    borderColor: colors.ui.limeRoad ? colors.material.stroke : colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border,
    gap,
  })
  const foldoutMotion = { type: 'timing' as const, duration: motion === 'full' ? motionTokens.duration.fast : 1 }
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
  const updateProgressPercent = apkUpdateStage === 'downloading' ? apkInstallProgress?.percent ?? 0 : 0
  const updateProgressIndeterminate = apkUpdateStage != null && (
    apkUpdateStage !== 'downloading' || apkInstallProgress?.percent == null
  )
  const providerHealthSummary = defaultProvider
    ? [
        defaultProviderDisplayName,
        defaultProvider.lastTestStatus === 'ok'
          ? t('settings.runtimeDiagnosticsReady')
        : defaultProvider.lastTestStatus === 'bad'
            ? t('settings.disabled')
            : t('settings.enabled'),
      ].join(' · ')
    : t('settings.noDefault')
  const appearanceSummary = [
    t(THEME_FAMILY_OPTIONS.find((item) => item.id === activeThemeId)?.labelKey ?? 'settings.themeMinimal'),
    settings.theme === 'system' ? t('settings.themeSystem') : settings.theme === 'dark' ? t('settings.themeDark') : t('settings.themeLight'),
    settings.themeAccent ? settings.themeAccent : t('settings.themeAccentDefault'),
    LANGUAGE_OPTIONS.find((item) => item.id === settings.language)?.label ?? settings.language,
  ].join(' · ')

  useEffect(() => {
    setThemeAccentDraft(settings.themeAccent ?? '')
  }, [settings.themeAccent])
  const advancedSummary = [
    diagnostics?.timeline.repairPlan.taskCount ? `${t('settings.runtimeRepairTasks')} ${diagnostics.timeline.repairPlan.taskCount}` : null,
    settings.runtimeLogEnabled ? t('settings.runtimeLogEnabled') : null,
    settings.autoUpdateCheckEnabled ?? true ? t('settings.autoEnabled') : t('settings.autoDisabled'),
  ].filter(Boolean).join(' · ')
  const diagnosticsSummary = diagnostics
    ? [
        diagnostics.timeline.repairPlan.taskCount ? `${t('settings.runtimeRepairTasks')} ${diagnostics.timeline.repairPlan.taskCount}` : null,
        t('settings.runtimeDiagnosticsReady'),
      ].filter(Boolean).join(' · ')
    : t('settings.runtimeDiagnosticsIdle')
  const settingsAttentionItems: SettingsSummaryItem[] = []
  if (diagnostics?.timeline.repairPlan.taskCount) {
    settingsAttentionItems.push({
      key: 'advanced',
      label: t('settings.runtimeDiagnostics'),
      value: `${diagnostics.timeline.repairPlan.taskCount} ${t('settings.runtimeRepairTasks')}`,
      detail: diagnosticsSummary,
      icon: <AppIcon name="settings-sliders" color={colors.textTertiary} size={15} />,
      tone: 'amber',
    })
  }
  const aiControlEntries: SettingsControlEntry[] = [
    {
      key: 'providers',
      title: t('settings.quickProviderModel'),
      detail: providerHealthSummary,
      searchTerms: [
        t('settings.providerManagement'),
        t('settings.default'),
        t('settings.models'),
        t('settings.addProvider'),
        t('providerSettings.batchImportProviders'),
        t('providerSettings.baseUrl'),
        t('providerSettings.tokens'),
        t('providerSettings.protocol.title'),
      ],
      icon: 'provider-key',
      active: Boolean(defaultProvider),
      tone: defaultProvider ? 'default' : 'warning',
      onPress: () => pushSettingsChildRoute('/settings/providers'),
    },
    {
      key: 'usage',
      title: t('usage.title'),
      detail: t('usage.settingsSummary'),
      searchTerms: [
        t('usage.requests'),
        t('usage.totalTokens'),
        t('usage.estimatedCost'),
        t('usage.averageLatency'),
        t('usage.providerStatistics'),
        t('usage.modelStatistics'),
      ],
      icon: 'chart',
      onPress: () => pushSettingsChildRoute('/settings/usage'),
    },
    {
      key: 'preferences',
      title: t('settings.preferences'),
      detail: t('settings.preferencesDescription'),
      searchTerms: [
        t('preferences.identity'),
        t('preferences.generation'),
        t('preferences.generationSubtitle'),
        t('preferences.interaction'),
        t('preferences.agentWorkflow'),
        t('chat.temperature'),
        t('chat.maxTokens'),
        t('settings.haptics'),
      ],
      icon: 'preferences-sliders',
      onPress: () => pushSettingsChildRoute('/settings/preferences'),
    },
    {
      key: 'memory',
      title: t('settings.memory'),
      detail: `${settings.memoryEnabled ? t('settings.enabledState') : t('settings.disabledState')} · ${t('settings.memoryDescription')}`,
      searchTerms: [
        t('settings.longMemory'),
        t('contextPanel.memoryReviewQueue'),
        t('contextPanel.pendingMemory'),
        t('contextPanel.confirmPendingMemories', { count: 0 }),
        t('contextPanel.memoryFilters'),
      ],
      icon: 'memory-brain',
      active: settings.memoryEnabled,
      onPress: () => pushSettingsChildRoute('/settings/memory'),
    },
    {
      key: 'knowledge',
      title: t('settings.knowledge'),
      detail: `${settings.knowledgeEnabled ? t('settings.enabledState') : t('settings.disabledState')} · ${t('settings.knowledgeDescription')}`,
      searchTerms: [
        t('settings.localKnowledge'),
        t('contextPanel.importKnowledgeFile'),
        t('contextPanel.pasteTextKnowledge'),
        t('contextPanel.knowledgeRecoveryTitle'),
      ],
      icon: 'knowledge-database',
      active: settings.knowledgeEnabled,
      onPress: () => pushSettingsChildRoute('/settings/knowledge'),
    },
    {
      key: 'context',
      title: t('settings.context'),
      detail: t('settings.contextDescription'),
      searchTerms: [
        t('contextPanel.ragMode'),
        t('settings.webSearch'),
        t('contextPanel.searchApi'),
        t('contextPanel.embeddingStrategy'),
        t('contextPanel.runSelfTest'),
      ],
      icon: 'context-globe',
      onPress: () => pushSettingsChildRoute('/settings/context'),
    },
    {
      key: 'skills',
      title: t('settings.skills'),
      detail: t('settings.skillsDescription'),
      searchTerms: [
        t('skills.systemPrompt'),
        t('skills.model'),
        t('skills.temperature'),
        t('skills.knowledgeSources'),
        t('skills.workflowTemplates'),
      ],
      icon: 'skills-sparkles',
      active: settings.skillsEnabled ?? true,
      onPress: () => pushSettingsChildRoute('/settings/skills'),
    },
    {
      key: 'mcp',
      title: t('settings.mcp'),
      detail: t('settings.mcpDescription'),
      searchTerms: [
        t('mcp.addServer'),
        t('mcp.toolsTitle', { count: 0 }),
        t('mcp.promptsTitle', { count: 0 }),
        t('mcp.resourcesTitle', { count: 0 }),
        t('mcp.presetsTitle'),
      ],
      icon: 'mcp-network',
      active: settings.mcpEnabled ?? true,
      onPress: () => pushSettingsChildRoute('/settings/mcp'),
    },
  ]
  const systemControlEntries: SettingsControlEntry[] = [
    {
      key: 'appearance',
      title: t('settings.quickAppearanceLanguage'),
      detail: appearanceSummary,
      searchTerms: [
        t('settings.themeFamily'),
        t('settings.themeMode'),
        t('settings.themeAccent'),
        t('settings.themeAccentCustom'),
        t('settings.language'),
      ],
      icon: 'preferences-sliders',
      active: expandedGroups.appearance,
      onPress: () => activateSystemPanel('appearance'),
    },
    {
      key: 'data',
      title: t('settings.importExport'),
      detail: t('settings.importExportSummary'),
      searchTerms: [
        t('settings.exportJson'),
        t('settings.exportTavernPrivateJson'),
        t('settings.importJson'),
      ],
      icon: 'download',
      active: expandedGroups.data,
      onPress: () => activateSystemPanel('data'),
    },
    {
      key: 'diagnostics',
      title: t('settings.runtimeDiagnostics'),
      detail: diagnosticsSummary,
      searchTerms: [
        t('settings.runtimeDiagnosticDetails'),
        t('settings.runtimeRepairTasks'),
        t('settings.runtimeLogFile'),
        t('settings.runtimeDiagnosticsRefresh'),
      ],
      icon: 'activity',
      active: expandedGroups.diagnostics,
      tone: diagnostics?.timeline.repairPlan.taskCount ? 'warning' : 'default',
      onPress: () => activateSystemPanel('diagnostics'),
    },
    {
      key: 'governance',
      title: t('settings.upstreamGovernance'),
      detail: t('settings.upstreamGovernanceSubtitle'),
      searchTerms: [
        t('settings.governanceRouting'),
        t('settings.transportMode'),
        t('settings.remoteCompactMode'),
        t('settings.proxyBaseUrl'),
        t('settings.observabilitySinkSettings'),
        t('settings.governanceRuntimeLimits'),
        t('settings.governanceRequestShaping'),
        t('settings.governanceAccessAndLogs'),
      ],
      icon: 'shield',
      active: expandedGroups.governance,
      onPress: () => activateSystemPanel('governance'),
    },
    {
      key: 'updates',
      title: t('settings.updates'),
      detail: `${version.appVersion} (${version.buildVersion})`,
      searchTerms: [
        t('settings.checkApk'),
        t('settings.autoCheck'),
        t('settings.appVersion'),
        t('settings.lastCheck'),
      ],
      icon: 'device',
      active: expandedGroups.updates,
      onPress: () => activateSystemPanel('updates'),
    },
    {
      key: 'advanced',
      title: t('settings.advancedInterfaceSettings'),
      detail: advancedSummary || t('settings.upstreamGovernanceSubtitle'),
      searchTerms: [
        t('settings.systemStatusNotifications'),
        t('settings.systemStatusNotificationsDescription'),
      ],
      icon: 'settings-sliders',
      active: expandedGroups.advanced && !expandedGroups.diagnostics && !expandedGroups.governance && !expandedGroups.updates && !expandedGroups.danger,
      onPress: () => activateSystemPanel('advanced'),
    },
    {
      key: 'danger',
      title: t('settings.dangerZone'),
      detail: `${t('settings.clearChats')} · ${t('settings.resetSettings')} · ${t('settings.clearData')}`,
      icon: 'delete',
      active: expandedGroups.danger,
      tone: 'danger',
      onPress: () => activateSystemPanel('danger'),
    },
  ]
  const normalizedSettingsSearch = normalizeSettingsControlSearch(settingsSearch)
  const aiSearchMatches = aiControlEntries.filter((entry) => matchesSettingsControlSearch(entry, normalizedSettingsSearch))
  const systemSearchMatches = systemControlEntries.filter((entry) => matchesSettingsControlSearch(entry, normalizedSettingsSearch))
  const visibleControlEntries = controlView === 'ai' ? aiSearchMatches : controlView === 'system' ? systemSearchMatches : []
  const focusedControlEntries = normalizedSettingsSearch
    ? visibleControlEntries
    : controlView === 'system' && activeSystemPanel
    ? visibleControlEntries.filter((entry) => entry.key === activeSystemPanel)
    : visibleControlEntries
  const SettingsOverviewExperience = colors.ui.experience.navigation === 'route'
    ? LimeRoadSettingsOverviewExperience
      : colors.ui.experience.navigation === 'document'
        ? MarkdownSettingsOverviewExperience
        : MinimalSettingsOverviewExperience

  useEffect(() => {
    if (!normalizedSettingsSearch || !controlView) return
    if (controlView === 'ai' && !aiSearchMatches.length && systemSearchMatches.length) {
      setControlView('system')
      return
    }
    if (controlView === 'system' && !systemSearchMatches.length && aiSearchMatches.length) {
      setControlView('ai')
    }
  }, [aiSearchMatches.length, controlView, normalizedSettingsSearch, systemSearchMatches.length])

  useEffect(() => {
    if (!expandedGroups.advanced) return
    void refreshSystemStatusNotificationStatus()
  }, [expandedGroups.advanced, settings.systemStatusNotificationsEnabled])

  useEffect(() => {
    if (!expandedGovernanceGroups.accessRules && !expandedGroups.diagnostics) return
    let cancelled = false
    void import('@/services/runtimeLog').then(({ getRuntimeLogPath }) => {
      if (!cancelled) setRuntimeLogPath(getRuntimeLogPath())
    })
    return () => {
      cancelled = true
    }
  }, [expandedGovernanceGroups.accessRules, expandedGroups.diagnostics])

  useEffect(() => {
    if (!expandedGroups.governance || !expandedGovernanceGroups.observability) return
    let cancelled = false
    void getObservabilitySinkApiKey().then((apiKey) => {
      if (!cancelled) setObservabilitySinkApiKeyDraft(apiKey ?? '')
    })
    return () => {
      cancelled = true
    }
  }, [expandedGovernanceGroups.observability, expandedGroups.governance, getObservabilitySinkApiKey])

  async function exportJson(options: PortableDataExportOptions = {}) {
    const result = await exportPortableDataToJsonFile(options)
    const tavernAudit = summarizeTavernExportAudit(result)
    const tavernAuditMessage = tavernAudit.hidden || tavernAudit.privatePending || tavernAudit.pending
      ? `\n\n${t('settings.exportTavernAuditNotice', tavernAudit)}`
      : ''
    dialog.notice({ title: t('settings.exportDone'), message: `${t('settings.exportDoneMessage', { uri: result.publicUri ?? result.uri })}${tavernAuditMessage}`, tone: 'mint' })
  }

  async function exportPrivateTavernJson() {
    const confirmed = await dialog.confirm({
      title: t('settings.exportTavernPrivateTitle'),
      message: t('settings.exportTavernPrivateMessage'),
      confirmLabel: t('settings.exportTavernPrivateConfirm'),
      cancelLabel: t('common.cancel'),
      tone: 'amber',
    })
    if (!confirmed) return
    await exportJson({ tavern: { includeHiddenMemory: true, includePendingWritebacks: true } })
  }

  async function importJson() {
    const result = await importPortableDataFromJsonFile()
    if (result.ok && result.kind === 'mem0') {
      const reviewNow = await dialog.confirm({
        title: t('settings.importDone'),
        message: importResultMessage(result, t),
        confirmLabel: t('settings.reviewImportedMemories'),
        cancelLabel: t('settings.reviewImportedMemoriesLater'),
        tone: 'mint',
      })
      if (reviewNow) pushSettingsChildRoute('/settings/memory', { focus: 'review' })
      return
    }
    dialog.notice({
      title: result.ok ? t('settings.importDone') : t('settings.importSkipped'),
      message: importResultMessage(result, t),
      tone: result.ok ? 'mint' : 'amber',
    })
  }

  async function clearAllAppData() {
    try {
      await clearPortableApplicationData()
      dialog.toast({ title: t('settings.clearData'), tone: 'amber' })
    } catch (error) {
      dialog.toast({
        title: t('settings.clearData'),
        message: error instanceof Error ? error.message : String(error),
        tone: 'danger',
      })
    }
  }

  function confirmClearChats() {
    void dialog.confirm({
      title: t('settings.clearChats'),
      message: t('settings.clearChatsConfirm'),
      tone: 'danger',
      confirmLabel: t('settings.clear'),
      cancelLabel: t('common.cancel'),
    }).then(async (confirmed) => {
      if (!confirmed) return
      const { useChatStore } = await import('@/store/chatStore')
      useChatStore.getState().clearAll()
    }).catch((error) => {
      dialog.toast({
        title: t('settings.clearChats'),
        message: error instanceof Error ? error.message : String(error),
        tone: 'danger',
      })
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

  function cancelApkUpdateFeedbackClear() {
    if (!apkUpdateFeedbackClearTimerRef.current) return
    clearTimeout(apkUpdateFeedbackClearTimerRef.current)
    apkUpdateFeedbackClearTimerRef.current = null
  }

  function dismissApkUpdateFeedback() {
    cancelApkUpdateFeedbackClear()
    dialog.dismissBanner(APK_UPDATE_BANNER_ID)
    void loadAndroidStatusNotification()
      .then(({ clearAndroidStatusNotification }) => clearAndroidStatusNotification())
      .catch(() => undefined)
  }

  function publishApkUpdateProgress(
    stage: ApkUpdateUiStage,
    release: ApkReleaseInfo | null = null,
    progress: ApkInstallProgress | null = null,
  ) {
    cancelApkUpdateFeedbackClear()
    const title = t(updateStageLabelKey(stage))
    const detail = release
      ? formatApkUpdateProgressDetail(stage, release, progress, t)
      : t('settings.apkUpdateProgressChecking')
    const determinate = stage === 'downloading' && progress?.percent != null
    const percent = determinate ? Math.min(100, Math.max(0, progress.percent ?? 0)) : 0
    dialog.banner({
      id: APK_UPDATE_BANNER_ID,
      title,
      message: detail,
      tone: stage === 'checking' ? 'default' : stage === 'opening-installer' ? 'mint' : 'amber',
    })
    void loadAndroidStatusNotification()
      .then(({ updateAndroidStatusNotification }) => updateAndroidStatusNotification({
        state: 'running',
        title,
        message: detail,
        shortText: determinate ? `${percent}%` : title,
        deepLink: 'islemind://settings',
        progress: determinate ? percent / 100 : 0,
        indeterminate: !determinate,
        ongoing: true,
        requestPromotedOngoing: stage !== 'checking',
        foregroundService: stage !== 'checking',
      }, { enabled: settings.systemStatusNotificationsEnabled === true }))
      .catch(() => undefined)
  }

  function publishApkUpdateTerminalFeedback(options: {
    title: string
    message: string
    tone: 'mint' | 'amber' | 'danger'
    installFlow?: boolean
  }) {
    cancelApkUpdateFeedbackClear()
    dialog.banner({
      id: APK_UPDATE_BANNER_ID,
      title: options.title,
      message: options.message,
      tone: options.tone,
    })
    void loadAndroidStatusNotification()
      .then(({ updateAndroidStatusNotification }) => updateAndroidStatusNotification({
        state: options.tone === 'danger' ? 'error' : 'completed',
        title: options.title,
        message: options.message,
        shortText: options.title,
        deepLink: 'islemind://settings',
        progress: options.tone === 'mint' ? 1 : undefined,
        indeterminate: false,
        ongoing: false,
        requestPromotedOngoing: false,
        foregroundService: options.installFlow === true,
      }, { enabled: settings.systemStatusNotificationsEnabled === true }))
      .catch(() => undefined)
    apkUpdateFeedbackClearTimerRef.current = setTimeout(() => {
      apkUpdateFeedbackClearTimerRef.current = null
      dialog.dismissBanner(APK_UPDATE_BANNER_ID)
      void loadAndroidStatusNotification()
        .then(({ clearAndroidStatusNotification }) => clearAndroidStatusNotification())
        .catch(() => undefined)
    }, APK_UPDATE_FEEDBACK_CLEAR_DELAY_MS)
  }

  async function checkApkUpdate() {
    if (updatingApk) return
    setApkUpdateStage('checking')
    setActiveApkRelease(null)
    setApkInstallProgress(null)
    publishApkUpdateProgress('checking')
    try {
      const { checkLatestApkRelease, downloadAndOpenApkInstaller } = await import('@/services/appUpdates')
      const result = await checkLatestApkRelease()
      if (result.status === 'available' || result.status === 'unavailable') {
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
        publishApkUpdateTerminalFeedback({
          title: result.status === 'error' ? t('settings.apkCheckFailed') : t('settings.noNewApk'),
          message,
          tone: result.status === 'error' ? 'danger' : result.status === 'unsupported' ? 'amber' : 'mint',
        })
        return
      }
      setActiveApkRelease(result.release)
      dismissApkUpdateFeedback()
      const confirmed = await confirmApkInstall(result.release)
      if (!confirmed) {
        dismissApkUpdateFeedback()
        return
      }
      const installResult = await downloadAndOpenApkInstaller(result.release, {
        onProgress: (progress) => {
          setActiveApkRelease(progress.release)
          setApkUpdateStage(progress.stage)
          setApkInstallProgress(progress)
          publishApkUpdateProgress(progress.stage, progress.release, progress)
        },
      })
      const terminalTitle = installResult.status === 'downloaded' ? t('settings.installerOpened') : t('settings.apkUpdateFailed')
      const terminalTone = installResult.status === 'downloaded' ? 'mint' : 'danger'
      dialog.notice({ title: terminalTitle, message: installResult.message, tone: terminalTone })
      publishApkUpdateTerminalFeedback({
        title: terminalTitle,
        message: installResult.message,
        tone: terminalTone,
        installFlow: true,
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
        release.sizeBytes ? { label: t('settings.apkSize', { size: formatSettingsApkSizeBytes(release.sizeBytes, t('updates.unknown')) }) } : null,
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
      void loadAndroidStatusNotification()
        .then(({ clearAndroidStatusNotification }) => clearAndroidStatusNotification())
        .catch(() => undefined)
      void refreshSystemStatusNotificationStatus()
      dialog.toast({ title: t('settings.systemStatusNotificationsOff'), tone: 'amber' })
      return
    }

    const androidStatusNotification = await loadAndroidStatusNotification().catch(() => null)
    if (!androidStatusNotification || !androidStatusNotification.androidStatusNotificationsAvailable()) {
      updateSettings({ systemStatusNotificationsEnabled: false })
      void refreshSystemStatusNotificationStatus()
      dialog.toast({
        title: t('settings.systemStatusNotificationsUnavailable'),
        message: t('settings.systemStatusNotificationsPermissionDeniedMessage'),
        tone: 'danger',
      })
      return
    }

    const permission = await androidStatusNotification.requestAndroidStatusNotificationPermission({
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
    const androidStatusNotification = await loadAndroidStatusNotification().catch(() => null)
    const result = androidStatusNotification
      ? await androidStatusNotification.openAndroidStatusNotificationSettings(target)
      : { opened: false, target, reason: 'unavailable' as const }
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
    const androidStatusNotification = await loadAndroidStatusNotification().catch(() => null)
    const status = androidStatusNotification
      ? await androidStatusNotification.getAndroidStatusNotificationPermissionStatus()
      : { available: false, granted: false, backgroundReliable: false, reason: 'unavailable' as const }
    setSystemStatusNotificationStatus(status)
    return status
  }

  function toggleExpandedGroup(group: SettingsAdvancedGroup) {
    setExpandedGroups((current) => ({ ...current, [group]: !current[group] }))
  }

  function activateSystemPanel(group: SettingsAdvancedGroup) {
    revealedSystemPanelRef.current = null
    setControlView('system')
    setExpandedGroups((current) => {
      const empty: Record<SettingsAdvancedGroup, boolean> = {
        appearance: false,
        data: false,
        advanced: false,
        diagnostics: false,
        governance: false,
        updates: false,
        danger: false,
      }
      const nestedAdvancedOpen = current.diagnostics || current.governance || current.updates || current.danger
      const active = group === 'advanced' ? current.advanced && !nestedAdvancedOpen : current[group]
      if (active) return empty
      if (group === 'appearance' || group === 'data') return { ...empty, [group]: true }
      return { ...empty, advanced: true, [group]: true }
    })
  }

  function toggleControlView(nextView: SettingsControlView) {
    revealedSystemPanelRef.current = null
    // A tab is a stable navigation state, not a collapsible toggle.
    // Keeping the active tab mounted preserves discoverability and tab semantics.
    setControlView(nextView)
  }

  function revealSystemPanel(group: SettingsAdvancedGroup, y: number) {
    if (revealedSystemPanelRef.current === group) return
    revealedSystemPanelRef.current = group
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: motion === 'full' })
    })
  }

  function toggleExpandedGovernanceGroup(group: SettingsGovernanceGroup) {
    setExpandedGovernanceGroups((current) => ({ ...current, [group]: !current[group] }))
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
        void openRuntimeRepairChat(task)
        return
    }
  }

  function openRuntimeRepairSettingsRoute(pathname: RuntimeRepairSettingsRoute, task: RuntimeRepairTask) {
    pushSettingsChildRoute(pathname, runtimeRepairRouteParams(task))
  }

  async function openRuntimeRepairChat(task: RuntimeRepairTask) {
    const conversationId = task.target.conversationId
    try {
      const { useChatStore } = await import('@/store/chatStore')
      const { conversations, select } = useChatStore.getState()
      if (conversationId && conversations.some((conversation) => conversation.id === conversationId)) {
        select(conversationId)
        router.push({ pathname: '/chat/[id]', params: { id: conversationId, returnTo: 'settings', ...runtimeRepairRouteParams(task) } })
        return
      }
    } catch {
      // The same unavailable state handles a deferred module load failure.
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
    if (diagnosticsRefreshInFlightRef.current) return
    diagnosticsRefreshInFlightRef.current = true
    setRefreshingDiagnostics(true)
    try {
      const { emitPluginManifestCatalogSnapshotEvent, loadPluginManifestCatalogSnapshot } = await import('@/services/pluginManifest')
      const catalog = await loadPluginManifestCatalogSnapshot()
      await emitPluginManifestCatalogSnapshotEvent(catalog, 'settings-diagnostics-refresh')
      const { buildRuntimeDiagnosticsSummary } = await import('@/services/runtimeDiagnostics')
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
      diagnosticsRefreshInFlightRef.current = false
    }
  }

  async function copyRuntimeLogTail() {
    try {
      const [{ readRuntimeLogText }, Clipboard] = await Promise.all([
        import('@/services/runtimeLog'),
        import('expo-clipboard'),
      ])
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
      const [{ getRuntimeLogInfo }, Sharing] = await Promise.all([
        import('@/services/runtimeLog'),
        import('expo-sharing'),
      ])
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
      const { clearRuntimeLog } = await import('@/services/runtimeLog')
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
    <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" removeClippedSubviews={Platform.OS === 'android'} contentContainerStyle={{ paddingHorizontal: narrowLayout ? 12 : 16, paddingTop: shellNavigation ? 10 : 8, paddingBottom: settingsPageBottomPadding }}>
      <View style={{ width: '100%', maxWidth: 860, alignSelf: 'center' }}>
      <SettingsOverviewExperience
        title={t('settings.title')}
        compact={narrowLayout}
        embedded={shellNavigation}
        searchLabel={t('settings.search')}
        controlLabel={controlView === 'ai' ? t('settings.controlAi') : controlView === 'system' ? t('settings.controlSystem') : t('settings.title')}
        leading={!shellNavigation ? (
          <AnimatedNavigationTrigger
            variant="iconButton"
            label={t('common.backToChat')}
            size="md"
            glyph="back"
            onNavigate={() => {
              if (onHome) onHome()
              else router.replace('/')
            }}
            color={colors.text}
          />
        ) : undefined}
        status={(
          <View style={{ paddingHorizontal: 2, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: defaultProvider ? colors.ui.tone.success.foreground : colors.ui.tone.warning.foreground }} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '800', includeFontPadding: false }}>
                {defaultProviderDisplayName ?? t('settings.noDefault')}
              </Text>
              <Text numberOfLines={1} style={{ marginTop: 1, color: colors.textTertiary, fontSize: 11, lineHeight: 15, fontWeight: '600', includeFontPadding: false }}>
                {`${t('settings.enabled')} ${enabledProviders}/${providers.length} · ${searchProvider !== 'off' ? `${t('settings.search')} ${searchProviderLabel(searchProvider)}` : t('settings.searchOff')}`}
              </Text>
            </View>
          </View>
        )}
        attention={settingsAttentionItems.length ? <SettingsSummaryStrip items={settingsAttentionItems} /> : undefined}
        search={(
          <View style={{ minHeight: 44, borderRadius: Math.min(colors.ui.radius.controlLarge, 8), paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: colors.ui.input.background, borderWidth: subtleBorderWidth, borderColor: colors.ui.input.border }}>
            <AppIcon name="search" color={colors.textTertiary} size={16} />
            <TextInput
              value={settingsSearch}
              onChangeText={setSettingsSearch}
              placeholder={t('settings.controlSearchPlaceholder')}
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              style={{ flex: 1, minWidth: 0, minHeight: ISLE_MIN_TOUCH_TARGET, padding: 0, color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '700', includeFontPadding: false }}
            />
            {settingsSearch ? (
              <IslePressable haptic accessibilityRole="button" accessibilityLabel={t('common.clearSearch')} onPress={() => setSettingsSearch('')} style={{ width: 44, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
                <AppIcon name="close" color={colors.textSecondary} size={15} />
              </IslePressable>
            ) : null}
          </View>
        )}
        tabs={<SettingsControlNavigation value={controlView} onChange={toggleControlView} />}
        catalog={controlView ? (
          <AnimatePresence exitBeforeEnter>
            <MotiView
              key={`settings-control-catalog-${controlView}`}
              from={motion === 'full' ? { opacity: 0, translateY: 6 } : { opacity: 0 }}
              animate={{ opacity: 1, translateY: 0 }}
              exit={motion === 'full' ? { opacity: 0, translateY: -4 } : { opacity: 0 }}
              transition={foldoutMotion}
            >
              <SettingsControlCatalog entries={focusedControlEntries} compact={activeSystemPanel ? false : narrowLayout} />
            </MotiView>
          </AnimatePresence>
        ) : undefined}
        emptyState={controlView && !focusedControlEntries.length ? (
          <Text style={{ paddingVertical: 18, textAlign: 'center', color: colors.textTertiary, fontSize: 12, lineHeight: 17, fontWeight: '700' }}>{t('settings.controlSearchEmpty')}</Text>
        ) : undefined}
      />

      <AnimatePresence>
      {controlView === 'system' && expandedGroups.appearance ? (
        <MotiView
          key="appearance-foldout"
          onLayout={(event) => activeSystemPanel ? revealSystemPanel(activeSystemPanel, event.nativeEvent.layout.y) : undefined}
          testID="settings-appearance-foldout"
          from={motion === 'full' ? { opacity: 0, translateY: 8 } : { opacity: 0 }}
          animate={{ opacity: 1, translateY: 0 }}
          exit={motion === 'full' ? { opacity: 0, translateY: -4 } : { opacity: 0 }}
          transition={foldoutMotion}
          style={foldoutBodyStyle}
        >
          <SettingsInlineLabel
            title={t('settings.themeFamily')}
            detail={t('settings.themeFamilyCurrent', { value: t(THEME_FAMILY_OPTIONS.find((item) => item.id === activeThemeId)?.labelKey ?? 'settings.themeMinimal') })}
          />
          <View testID="settings-theme-family-group" accessibilityRole="radiogroup" accessibilityLabel={t('settings.themeFamily')} style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {THEME_FAMILY_OPTIONS.map((item) => (
              <ThemeFamilyCard
                key={item.id}
                themeId={item.id}
                label={t(item.labelKey)}
                detail={t(item.detailKey)}
                active={activeThemeId === item.id}
                compact={actionCompact}
                onPress={() => setThemeId(item.id)}
                testID={`settings-theme-family-${item.id}`}
              />
            ))}
          </View>
          <SettingsInlineLabel
            title={t('settings.themeMode')}
            detail={t('settings.themeModeCurrent', { value: settings.theme === 'system' ? t('settings.themeSystem') : settings.theme === 'dark' ? t('settings.themeDark') : t('settings.themeLight') })}
          />
          <View testID="settings-theme-mode-group" accessibilityRole="radiogroup" accessibilityLabel={t('settings.themeMode')} style={{ flexDirection: actionCompact ? 'column' : 'row', gap: 8 }}>
            {(['light', 'dark', 'system'] satisfies ThemeMode[]).map((item) => (
              <ThemeModeCard
                key={item}
                label={item === 'system' ? t('settings.themeSystem') : item === 'dark' ? t('settings.themeDark') : t('settings.themeLight')}
                active={settings.theme === item}
                onPress={() => setTheme(item)}
                testID={`settings-theme-mode-${item}`}
              />
            ))}
          </View>
          <SettingsInlineLabel
            title={t('settings.themeAccent')}
            detail={settings.themeAccent ?? t('settings.themeAccentDefault')}
          />
          <View testID="settings-theme-accent-group" accessibilityRole="radiogroup" accessibilityLabel={t('settings.themeAccent')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {THEME_ACCENT_OPTIONS.map((item) => (
              <ThemeAccentSwatch
                key={item.id}
                label={t(item.labelKey)}
                color={item.color}
                active={item.color === undefined ? !settings.themeAccent : settings.themeAccent === item.color}
                onPress={() => setThemeAccent(item.color)}
                testID={`settings-theme-accent-${item.id}`}
              />
            ))}
            <ThemeAccentSwatch
              label={t('settings.themeAccentCustom')}
              color={activeCustomThemeAccent ? settings.themeAccent : normalizedThemeAccentDraft}
              active={activeCustomThemeAccent}
              disabled={!activeCustomThemeAccent && !normalizedThemeAccentDraft}
              onPress={() => {
                if (normalizedThemeAccentDraft) setThemeAccent(normalizedThemeAccentDraft)
              }}
              testID="settings-theme-accent-custom"
            />
          </View>
          <View style={{ flexDirection: actionCompact ? 'column' : 'row', gap: 8, alignItems: actionCompact ? 'stretch' : 'flex-end' }}>
            <IsleField
              label={t('settings.themeAccentCustom')}
              note={themeAccentDraft.trim() && !normalizeThemeAccent(themeAccentDraft) ? t('settings.themeAccentInvalid') : t('settings.themeAccentCustomHint')}
              style={actionCompact ? undefined : { flex: 1, minWidth: 0 }}
              inputProps={{
                value: themeAccentDraft,
                onChangeText: setThemeAccentDraft,
                autoCapitalize: 'characters',
                autoCorrect: false,
                placeholder: '#4963A6',
                testID: 'settings-theme-accent-input',
              }}
            />
            <IsleButton
              label={t('settings.themeAccentApply')}
              icon={<AppIcon name="check" color={colors.ui.control.primaryForeground} size={15} />}
              tone="primary"
              disabled={!normalizeThemeAccent(themeAccentDraft)}
              testID="settings-theme-accent-apply"
              onPress={() => {
                const normalized = normalizeThemeAccent(themeAccentDraft)
                if (normalized) setThemeAccent(normalized)
              }}
              style={actionCompact ? { alignSelf: 'stretch', minHeight: 44 } : { minWidth: 112, minHeight: 44 }}
            />
          </View>
          <SettingsInlineLabel
            title={t('settings.language')}
            detail={t('settings.languageCurrent', { value: LANGUAGE_OPTIONS.find((item) => item.id === settings.language)?.label ?? settings.language })}
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {LANGUAGE_OPTIONS.map((item) => (
              <IslePressable key={item.id} haptic accessibilityLabel={item.label} accessibilityState={{ selected: settings.language === item.id }} onPress={() => void chooseLanguage(item.id)} style={settingsChipPressableStyle}>
                <IsleChip active={settings.language === item.id}>{settings.language === item.id ? t('settings.current') : item.label}</IsleChip>
              </IslePressable>
            ))}
          </View>
        </MotiView>
      ) : null}
      </AnimatePresence>

      {controlView === 'system' ? (
      <>
      <AnimatePresence>
        {expandedGroups.data ? (
          <MotiView
            key="data-transfer-foldout"
            onLayout={(event) => activeSystemPanel ? revealSystemPanel(activeSystemPanel, event.nativeEvent.layout.y) : undefined}
            from={motion === 'full' ? { opacity: 0, translateY: 8 } : { opacity: 0 }}
            animate={{ opacity: 1, translateY: 0 }}
            exit={motion === 'full' ? { opacity: 0, translateY: -4 } : { opacity: 0 }}
            transition={foldoutMotion}
            style={foldoutBodyStyle}
          >
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <DataButton label={t('settings.exportJson')} icon={<AppIcon name="download" color={colors.ui.control.primaryForeground} size={18} />} onPress={() => void exportJson()} />
              <DataButton label={t('settings.exportTavernPrivateJson')} icon={<AppIcon name="shield" color={colors.ui.control.primaryForeground} size={18} />} onPress={() => void exportPrivateTavernJson()} />
              <DataButton label={t('settings.importJson')} icon={<AppIcon name="upload" color={colors.ui.control.primaryForeground} size={18} />} onPress={() => void importJson()} />
            </View>
            <Text style={{ color: colors.textTertiary, fontSize: 12, fontWeight: '700', lineHeight: 18 }}>
              {t('settings.importExportDescription')}
            </Text>
          </MotiView>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {expandedGroups.advanced ? (
          <MotiView
            key="advanced-settings-foldout"
            onLayout={(event) => activeSystemPanel ? revealSystemPanel(activeSystemPanel, event.nativeEvent.layout.y) : undefined}
            from={motion === 'full' ? { opacity: 0, translateY: 8 } : { opacity: 0 }}
            animate={{ opacity: 1, translateY: 0 }}
            exit={motion === 'full' ? { opacity: 0, translateY: -4 } : { opacity: 0 }}
            transition={foldoutMotion}
            style={{ gap: 8 }}
          >
        {!expandedGroups.diagnostics && !expandedGroups.governance && !expandedGroups.updates && !expandedGroups.danger ? (
        <View style={foldoutBodyStyle}>
          <SettingsToggleRow
            icon={<AppIcon name="activity" color={featureToggleIconColor(colors, settings.systemStatusNotificationsEnabled === true)} size={18} strokeWidth={appIconStroke.bold} />}
            title={t('settings.systemStatusNotifications')}
            description={systemStatusNotificationDescription}
            active={settings.systemStatusNotificationsEnabled === true}
            onPress={() => void toggleSystemStatusNotifications()}
            first
          />
          {showSystemStatusNotificationSettingsAction || showPromotedNotificationSettingsAction ? (
            <View style={{ flexDirection: actionCompact ? 'column' : 'row', flexWrap: actionCompact ? 'nowrap' : 'wrap', gap: 8, paddingTop: 2, alignItems: actionCompact ? 'stretch' : 'center' }}>
              {showSystemStatusNotificationSettingsAction ? (
                <IsleButton
                  compact
                  label={t('settings.systemStatusNotificationsOpenSettings')}
                  icon={<AppIcon name="settings" color={colors.textSecondary} size={14} />}
                  onPress={() => void openSystemStatusNotificationSettings('notifications')}
                  style={actionCompact ? { alignSelf: 'stretch' } : { alignSelf: 'flex-start', minWidth: 0 }}
                />
              ) : null}
              {showPromotedNotificationSettingsAction ? (
                <IsleButton
                  compact
                  label={t('settings.systemStatusNotificationsOpenPromotedSettings')}
                  icon={<AppIcon name="settings" color={colors.textSecondary} size={14} />}
                  onPress={() => void openSystemStatusNotificationSettings('promoted')}
                  style={actionCompact ? { alignSelf: 'stretch' } : { alignSelf: 'flex-start', minWidth: 0 }}
                />
              ) : null}
            </View>
          ) : null}
        </View>
        ) : null}
        <AnimatePresence>
        {expandedGroups.diagnostics ? (
          <MotiView
            key="diagnostics-foldout"
            from={motion === 'full' ? { opacity: 0, translateY: 8 } : { opacity: 0 }}
            animate={{ opacity: 1, translateY: 0 }}
            exit={motion === 'full' ? { opacity: 0, translateY: -4 } : { opacity: 0 }}
            transition={foldoutMotion}
            style={foldoutBodyStyle}
          >
            {diagnostics ? (
              <>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <IsleChip tone={diagnostics.providers.degraded ? 'amber' : 'mint'}>
                    {t('settings.runtimeDiagnosticsReady')}
                  </IsleChip>
                </View>
                <IsleDisclosure
                  title={t('settings.runtimeDiagnosticDetails')}
                  summary={t('settings.runtimeDiagnosticsReady')}
                  expanded={diagnosticDetailsOpen}
                  onPress={() => setDiagnosticDetailsOpen((open) => !open)}
                />
                {diagnosticDetailsOpen ? (
                  <RuntimeDiagnosticsDetails
                    diagnostics={diagnostics}
                    pluginCatalog={pluginCatalog}
                  />
                ) : null}
              </>
            ) : (
              <View style={foldoutCardStyle(8)}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <IsleChip tone={refreshingDiagnostics ? 'amber' : 'default'}>
                    {refreshingDiagnostics ? t('settings.runtimeDiagnosticsRefreshing') : t('settings.runtimeDiagnosticsIdle')}
                  </IsleChip>
                </View>
                <IsleButton
                  label={refreshingDiagnostics ? t('settings.runtimeDiagnosticsRefreshing') : t('settings.runtimeDiagnosticsRun')}
                  compact
                  disabled={refreshingDiagnostics}
                  icon={<AppIcon name="activity" color={colors.ui.control.primaryForeground} size={15} />}
                  onPress={() => void refreshRuntimeDiagnostics()}
                />
              </View>
            )}
            {diagnostics?.timeline.repairPlan.tasks.length ? (
              <RuntimeRepairTaskActions repairPlan={diagnostics.timeline.repairPlan} onOpenTask={openRuntimeRepairTask} />
            ) : null}
            <View style={foldoutCardStyle(7)}>
              <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>{t('settings.runtimeLogFile')}</Text>
              <Text selectable numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, fontWeight: '800' }}>
                {diagnostics?.log.path ?? runtimeLogPath ?? '—'}
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

        <AnimatePresence>
        {expandedGroups.governance ? (
          <MotiView
            key="governance-foldout"
            from={motion === 'full' ? { opacity: 0, translateY: 8 } : { opacity: 0 }}
            animate={{ opacity: 1, translateY: 0 }}
            exit={motion === 'full' ? { opacity: 0, translateY: -4 } : { opacity: 0 }}
            transition={foldoutMotion}
            style={foldoutBodyStyle}
          >
          <IsleDisclosure
            title={t('settings.governanceRouting')}
            summary={t('settings.governanceRoutingSummary', {
              transport: t(`settings.transport${(settings.transportMode ?? 'auto') === 'http' ? 'Http' : (settings.transportMode ?? 'auto') === 'websocket' ? 'WebSocket' : 'Auto'}`),
              compact: t(`settings.compact${(settings.remoteCompactMode ?? 'auto') === 'required' ? 'Required' : (settings.remoteCompactMode ?? 'auto') === 'auto' ? 'Auto' : 'Off'}`),
              payload: t(`settings.payload${(settings.payloadPolicyMode ?? 'warn') === 'off' ? 'Off' : (settings.payloadPolicyMode ?? 'warn') === 'warn' ? 'Warn' : 'Block'}`),
              proxy: t(`settings.proxy${(settings.proxyMode ?? 'off') === 'custom-base-url' ? 'CustomBaseUrl' : (settings.proxyMode ?? 'off') === 'system-detected' ? 'SystemDetected' : 'Off'}`),
            })}
            expanded={expandedGovernanceGroups.routing}
            onPress={() => toggleExpandedGovernanceGroup('routing')}
          />
          {expandedGovernanceGroups.routing ? (
          <MotiView
            key="governance-routing-foldout"
            from={motion === 'full' ? { opacity: 0, translateY: 8 } : { opacity: 0 }}
            animate={{ opacity: 1, translateY: 0 }}
            exit={motion === 'full' ? { opacity: 0, translateY: -4 } : { opacity: 0 }}
            transition={foldoutMotion}
            style={foldoutCardStyle()}
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
              value={settings.remoteCompactMode ?? 'auto'}
              onChange={(remoteCompactMode) => updateSettings({ remoteCompactMode })}
            />
            <View style={pairedFieldRowStyle}>
              <CommittedSettingsField
                label={t('settings.remoteCompactThreshold')}
                note={t('settings.remoteCompactThresholdNote')}
                value={String(settings.remoteCompactThreshold ?? 0.8)}
                normalize={normalizeRemoteCompactThresholdDraft}
                onCommit={updateRemoteCompactThreshold}
                inputProps={{ keyboardType: 'decimal-pad' }}
                style={pairedFieldStyle}
              />
              <CommittedSettingsField
                label={t('settings.remoteCompactThresholdTokens')}
                note={t('settings.remoteCompactThresholdTokensNote')}
                value={String(settings.remoteCompactThresholdTokens ?? 200000)}
                normalize={(value) => normalizeBoundedIntegerDraft(value, 200000, 1024, 4000000)}
                onCommit={(value) => updatePositiveInteger('remoteCompactThresholdTokens', value, 200000, 1024, 4000000)}
                inputProps={{ keyboardType: 'number-pad' }}
                style={pairedFieldStyle}
              />
            </View>
            <SegmentedSetting
              label={t('settings.payloadPolicyMode')}
              options={PAYLOAD_POLICY_OPTIONS}
              value={settings.payloadPolicyMode ?? 'warn'}
              onChange={(payloadPolicyMode) => updateSettings({ payloadPolicyMode })}
            />
            <View style={foldoutCardStyle(8)}>
              <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>{t('settings.policySummary')}</Text>
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
            <CommittedSettingsField
              label={t('settings.proxyBaseUrl')}
              note={t('settings.proxyBaseUrlNote')}
              value={settings.proxyBaseUrl ?? ''}
              normalize={normalizeTrimmedDraft}
              onCommit={(proxyBaseUrl) => updateSettings({ proxyBaseUrl })}
              inputProps={{
                placeholder: 'https://proxy.example/upstream',
                autoCapitalize: 'none',
                autoCorrect: false,
              }}
            />
            <View style={foldoutCardStyle(6)}>
              <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>{t('settings.compactExecutionPolicy')}</Text>
              <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, fontWeight: '800' }}>
                {t('settings.compactExecutionPolicyNote')}
              </Text>
            </View>
          </MotiView>
          ) : null}
          <IsleDisclosure
            title={t('preferences.agentWorkflow')}
            summary={t('settings.governanceWorkflowSummary', {
              steps: settings.agentWorkflowMaxSteps ?? 3,
              tools: settings.agentWorkflowMaxToolCallsPerStep ?? 1,
              limit: settings.agentWorkflowOutputCharLimit ?? 4800,
            })}
            expanded={expandedGovernanceGroups.workflow}
            onPress={() => toggleExpandedGovernanceGroup('workflow')}
          />
          {expandedGovernanceGroups.workflow ? (
          <MotiView
            key="governance-workflow-foldout"
            from={motion === 'full' ? { opacity: 0, translateY: 8 } : { opacity: 0 }}
            animate={{ opacity: 1, translateY: 0 }}
            exit={motion === 'full' ? { opacity: 0, translateY: -4 } : { opacity: 0 }}
            transition={foldoutMotion}
            style={foldoutCardStyle()}
          >
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>{t('preferences.agentWorkflow')}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, fontWeight: '800' }}>
              {t('preferences.agentWorkflowSubtitle')}
            </Text>
            <View style={pairedFieldRowStyle}>
              <CommittedSettingsField
                label={t('preferences.agentWorkflowMaxSteps')}
                note={t('preferences.agentWorkflowMaxStepsNote')}
                value={String(settings.agentWorkflowMaxSteps ?? 3)}
                normalize={(value) => normalizeBoundedIntegerDraft(value, 3, 1, 8)}
                onCommit={(value) => updatePositiveInteger('agentWorkflowMaxSteps', value, 3, 1, 8)}
                inputProps={{ keyboardType: 'number-pad' }}
                style={pairedFieldStyle}
              />
              <CommittedSettingsField
                label={t('preferences.agentWorkflowMaxToolCalls')}
                note={t('preferences.agentWorkflowMaxToolCallsNote')}
                value={String(settings.agentWorkflowMaxToolCallsPerStep ?? 1)}
                normalize={(value) => normalizeBoundedIntegerDraft(value, 1, 1, 3)}
                onCommit={(value) => updatePositiveInteger('agentWorkflowMaxToolCallsPerStep', value, 1, 1, 3)}
                inputProps={{ keyboardType: 'number-pad' }}
                style={pairedFieldStyle}
              />
            </View>
            <CommittedSettingsField
              label={t('preferences.agentWorkflowOutputLimit')}
              note={t('preferences.agentWorkflowOutputLimitNote')}
              value={String(settings.agentWorkflowOutputCharLimit ?? 4800)}
              normalize={(value) => normalizeBoundedIntegerDraft(value, 4800, 512, 12000)}
              onCommit={(value) => updatePositiveInteger('agentWorkflowOutputCharLimit', value, 4800, 512, 12000)}
              inputProps={{ keyboardType: 'number-pad' }}
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
          </MotiView>
          ) : null}
          <IsleDisclosure
            title={t('settings.observabilitySinkSettings')}
            summary={t('settings.governanceObservabilitySummary', {
              mode: t(`settings.observabilitySink${(settings.observabilitySinkMode ?? 'off') === 'off' ? 'Off' : (settings.observabilitySinkMode ?? 'off') === 'local-only' ? 'LocalOnly' : 'External'}`),
              target: t(`settings.observabilitySinkTarget${(settings.observabilitySinkTarget ?? 'opentelemetry') === 'opentelemetry' ? 'OpenTelemetry' : (settings.observabilitySinkTarget ?? 'opentelemetry') === 'langfuse' ? 'Langfuse' : 'Phoenix'}`),
            })}
            expanded={expandedGovernanceGroups.observability}
            onPress={() => toggleExpandedGovernanceGroup('observability')}
          />
          {expandedGovernanceGroups.observability ? (
          <MotiView
            key="governance-observability-foldout"
            from={motion === 'full' ? { opacity: 0, translateY: 8 } : { opacity: 0 }}
            animate={{ opacity: 1, translateY: 0 }}
            exit={motion === 'full' ? { opacity: 0, translateY: -4 } : { opacity: 0 }}
            transition={foldoutMotion}
            style={foldoutCardStyle()}
          >
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>{t('settings.observabilitySinkSettings')}</Text>
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
            <CommittedSettingsField
              label={t('settings.observabilitySinkEndpointUrl')}
              note={t('settings.observabilitySinkEndpointUrlNote')}
              value={settings.observabilitySinkEndpointUrl ?? ''}
              normalize={normalizeTrimmedDraft}
              onCommit={(observabilitySinkEndpointUrl) => updateSettings({ observabilitySinkEndpointUrl })}
              inputProps={{
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
              <CommittedSettingsField
                label={t('settings.observabilitySinkAttributeLimit')}
                value={String(settings.observabilitySinkAttributeLimit ?? 48)}
                normalize={(value) => normalizeBoundedIntegerDraft(value, 48, 1, 64)}
                onCommit={(value) => updatePositiveInteger('observabilitySinkAttributeLimit', value, 48, 1, 64)}
                inputProps={{ keyboardType: 'number-pad' }}
                style={pairedFieldStyle}
              />
              <CommittedSettingsField
                label={t('settings.observabilitySinkAttributeStringLimit')}
                value={String(settings.observabilitySinkAttributeStringLimit ?? 160)}
                normalize={(value) => normalizeBoundedIntegerDraft(value, 160, 1, 512)}
                onCommit={(value) => updatePositiveInteger('observabilitySinkAttributeStringLimit', value, 160, 1, 512)}
                inputProps={{ keyboardType: 'number-pad' }}
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
          </MotiView>
          ) : null}
          <IsleDisclosure
            title={t('settings.governanceRuntimeLimits')}
            summary={t('settings.governanceRuntimeLimitsSummary', {
              concurrency: settings.sessionConcurrencyLimit ?? 1,
              timeout: settings.upstreamRequestTimeoutMs ?? 60000,
              retries: settings.upstreamMaxRetries ?? 1,
            })}
            expanded={expandedGovernanceGroups.runtimeLimits}
            onPress={() => toggleExpandedGovernanceGroup('runtimeLimits')}
          />
          {expandedGovernanceGroups.runtimeLimits ? (
          <MotiView
            key="governance-runtime-limits-foldout"
            from={motion === 'full' ? { opacity: 0, translateY: 8 } : { opacity: 0 }}
            animate={{ opacity: 1, translateY: 0 }}
            exit={motion === 'full' ? { opacity: 0, translateY: -4 } : { opacity: 0 }}
            transition={foldoutMotion}
            style={{ gap: 10 }}
          >
            <View style={pairedFieldRowStyle}>
              <CommittedSettingsField
                label={t('settings.sessionConcurrencyLimit')}
                value={String(settings.sessionConcurrencyLimit ?? 1)}
                normalize={(value) => normalizeBoundedIntegerDraft(value, 1, 1, 8)}
                onCommit={(value) => updatePositiveInteger('sessionConcurrencyLimit', value, 1, 1, 8)}
                inputProps={{ keyboardType: 'number-pad' }}
                style={pairedFieldStyle}
              />
              <CommittedSettingsField
                label={t('settings.sessionQueueTimeoutMs')}
                value={String(settings.sessionQueueTimeoutMs ?? 1500)}
                normalize={(value) => normalizeBoundedIntegerDraft(value, 1500, 0, 30000)}
                onCommit={(value) => updatePositiveInteger('sessionQueueTimeoutMs', value, 1500, 0, 30000)}
                inputProps={{ keyboardType: 'number-pad' }}
                style={pairedFieldStyle}
              />
            </View>
            <View style={foldoutCardStyle()}>
              <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>{t('settings.sessionAffinitySettings')}</Text>
              <IsleToggle
                icon={<AppIcon name="provider-key" color={colors.text} size={18} />}
                title={t('settings.sessionAffinityEnabled')}
                description={t('settings.sessionAffinityEnabledDescription')}
                active={settings.sessionAffinityEnabled === true}
                onPress={() => updateSettings({ sessionAffinityEnabled: settings.sessionAffinityEnabled !== true })}
              />
              <CommittedSettingsField
                label={t('settings.sessionAffinityTtlMs')}
                note={t('settings.sessionAffinityTtlMsNote')}
                value={String(settings.sessionAffinityTtlMs ?? 1800000)}
                normalize={(value) => normalizeBoundedIntegerDraft(value, 1800000, 60000, 86400000)}
                onCommit={(value) => updatePositiveInteger('sessionAffinityTtlMs', value, 1800000, 60000, 86400000)}
                inputProps={{ keyboardType: 'number-pad' }}
              />
            </View>
            <View style={foldoutCardStyle()}>
              <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>{t('settings.retryTimeoutSettings')}</Text>
              <View style={pairedFieldRowStyle}>
                <CommittedSettingsField
                  label={t('settings.upstreamRequestTimeoutMs')}
                  value={String(settings.upstreamRequestTimeoutMs ?? 60000)}
                  normalize={(value) => normalizeBoundedIntegerDraft(value, 60000, 5000, 300000)}
                  onCommit={(value) => updatePositiveInteger('upstreamRequestTimeoutMs', value, 60000, 5000, 300000)}
                  inputProps={{ keyboardType: 'number-pad' }}
                  style={pairedFieldStyle}
                />
                <CommittedSettingsField
                  label={t('settings.upstreamMaxRetries')}
                  value={String(settings.upstreamMaxRetries ?? 1)}
                  normalize={(value) => normalizeBoundedIntegerDraft(value, 1, 0, 5)}
                  onCommit={(value) => updatePositiveInteger('upstreamMaxRetries', value, 1, 0, 5)}
                  inputProps={{ keyboardType: 'number-pad' }}
                  style={pairedFieldStyle}
                />
              </View>
              <IsleToggle
                title={t('settings.upstreamCircuitBreakerEnabled')}
                active={settings.upstreamCircuitBreakerEnabled !== false}
                onPress={() => updateSettings({ upstreamCircuitBreakerEnabled: settings.upstreamCircuitBreakerEnabled === false })}
              />
              <View style={pairedFieldRowStyle}>
                <CommittedSettingsField
                  label={t('settings.upstreamCircuitBreakerFailureThreshold')}
                  value={String(settings.upstreamCircuitBreakerFailureThreshold ?? 3)}
                  normalize={(value) => normalizeBoundedIntegerDraft(value, 3, 1, 20)}
                  onCommit={(value) => updatePositiveInteger('upstreamCircuitBreakerFailureThreshold', value, 3, 1, 20)}
                  inputProps={{ keyboardType: 'number-pad' }}
                  style={pairedFieldStyle}
                />
                <CommittedSettingsField
                  label={t('settings.upstreamCircuitBreakerCooldownMs')}
                  value={String(settings.upstreamCircuitBreakerCooldownMs ?? 60000)}
                  normalize={(value) => normalizeBoundedIntegerDraft(value, 60000, 1000, 3600000)}
                  onCommit={(value) => updatePositiveInteger('upstreamCircuitBreakerCooldownMs', value, 60000, 1000, 3600000)}
                  inputProps={{ keyboardType: 'number-pad' }}
                  style={pairedFieldStyle}
                />
              </View>
            </View>
          </MotiView>
          ) : null}
          <IsleDisclosure
            title={t('settings.governanceRequestShaping')}
            summary={t('settings.governanceRequestShapingSummary', {
              rectification: settings.requestRectificationEnabled !== false ? t('settings.enabledState') : t('settings.disabledState'),
              cache: settings.cacheInjectionEnabled === true ? t('settings.enabledState') : t('settings.disabledState'),
            })}
            expanded={expandedGovernanceGroups.requestShaping}
            onPress={() => toggleExpandedGovernanceGroup('requestShaping')}
          />
          {expandedGovernanceGroups.requestShaping ? (
          <MotiView
            key="governance-request-shaping-foldout"
            from={motion === 'full' ? { opacity: 0, translateY: 8 } : { opacity: 0 }}
            animate={{ opacity: 1, translateY: 0 }}
            exit={motion === 'full' ? { opacity: 0, translateY: -4 } : { opacity: 0 }}
            transition={foldoutMotion}
            style={{ gap: 10 }}
          >
            <View style={foldoutCardStyle()}>
              <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>{t('settings.rectificationSettings')}</Text>
              <IsleToggle title={t('settings.requestRectificationEnabled')} active={settings.requestRectificationEnabled !== false} onPress={() => updateSettings({ requestRectificationEnabled: settings.requestRectificationEnabled === false })} />
              <IsleToggle title={t('settings.anthropicThinkingSignatureRectificationEnabled')} active={settings.anthropicThinkingSignatureRectificationEnabled !== false} onPress={() => updateSettings({ anthropicThinkingSignatureRectificationEnabled: settings.anthropicThinkingSignatureRectificationEnabled === false })} />
              <IsleToggle title={t('settings.anthropicThinkingBudgetRectificationEnabled')} active={settings.anthropicThinkingBudgetRectificationEnabled !== false} onPress={() => updateSettings({ anthropicThinkingBudgetRectificationEnabled: settings.anthropicThinkingBudgetRectificationEnabled === false })} />
            </View>
            <View style={foldoutCardStyle()}>
              <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>{t('settings.bedrockOptimizerSettings')}</Text>
              <IsleToggle title={t('settings.bedrockRequestOptimizerEnabled')} active={settings.bedrockRequestOptimizerEnabled === true} onPress={() => updateSettings({ bedrockRequestOptimizerEnabled: settings.bedrockRequestOptimizerEnabled !== true })} />
              <IsleToggle title={t('settings.thinkingOptimizerEnabled')} active={settings.thinkingOptimizerEnabled === true} onPress={() => updateSettings({ thinkingOptimizerEnabled: settings.thinkingOptimizerEnabled !== true })} />
              <IsleToggle title={t('settings.cacheInjectionEnabled')} active={settings.cacheInjectionEnabled === true} onPress={() => updateSettings({ cacheInjectionEnabled: settings.cacheInjectionEnabled !== true })} />
              <SegmentedSetting label={t('settings.cacheTtl')} options={CACHE_TTL_OPTIONS} value={settings.cacheTtl ?? 'default'} onChange={(cacheTtl) => updateSettings({ cacheTtl })} />
            </View>
          </MotiView>
          ) : null}
          <IsleDisclosure
            title={t('settings.governanceAccessAndLogs')}
            summary={t('settings.governanceAccessAndLogsSummary', {
              log: settings.runtimeLogEnabled === true ? t('settings.runtimeDiagnosticLogOn') : t('settings.runtimeDiagnosticLogOff'),
              allow: (settings.providerAllowlist?.length ?? 0) + (settings.modelAllowlist?.length ?? 0),
              block: (settings.providerBlocklist?.length ?? 0) + (settings.modelBlocklist?.length ?? 0),
            })}
            expanded={expandedGovernanceGroups.accessRules}
            onPress={() => toggleExpandedGovernanceGroup('accessRules')}
          />
          {expandedGovernanceGroups.accessRules ? (
          <MotiView
            key="governance-access-rules-foldout"
            from={motion === 'full' ? { opacity: 0, translateY: 8 } : { opacity: 0 }}
            animate={{ opacity: 1, translateY: 0 }}
            exit={motion === 'full' ? { opacity: 0, translateY: -4 } : { opacity: 0 }}
            transition={foldoutMotion}
            style={foldoutCardStyle()}
          >
            <IsleToggle
              title={t('settings.runtimeLogEnabled')}
              description={t('settings.runtimeLogDescription', { path: runtimeLogPath ?? '—' })}
              active={settings.runtimeLogEnabled === true}
              onPress={() => updateSettings({ runtimeLogEnabled: settings.runtimeLogEnabled !== true })}
            />
            <CommittedSettingsField
              label={t('settings.runtimeLogMaxBytes')}
              note={t('settings.runtimeLogMaxBytesNote')}
              value={String(settings.runtimeLogMaxBytes ?? 1048576)}
              normalize={(value) => normalizeBoundedIntegerDraft(value, 1048576, 4096, 10485760)}
              onCommit={(value) => updatePositiveInteger('runtimeLogMaxBytes', value, 1048576, 4096, 10485760)}
              inputProps={{ keyboardType: 'number-pad' }}
            />
            <CommittedSettingsField
              label={t('settings.providerAllowlist')}
              note={t('settings.listRuleNote')}
              value={joinSettingsList(settings.providerAllowlist)}
              normalize={normalizeSettingsListDraft}
              onCommit={(value) => updateSettingsList('providerAllowlist', value)}
              commitOnSubmit={false}
              inputProps={{ autoCapitalize: 'none', autoCorrect: false, multiline: true, style: { minHeight: 48, maxHeight: 88 } }}
            />
            <CommittedSettingsField
              label={t('settings.providerBlocklist')}
              note={t('settings.blocklistNote')}
              value={joinSettingsList(settings.providerBlocklist)}
              normalize={normalizeSettingsListDraft}
              onCommit={(value) => updateSettingsList('providerBlocklist', value)}
              commitOnSubmit={false}
              inputProps={{ autoCapitalize: 'none', autoCorrect: false, multiline: true, style: { minHeight: 48, maxHeight: 88 } }}
            />
            <CommittedSettingsField
              label={t('settings.modelAllowlist')}
              note={t('settings.listRuleNote')}
              value={joinSettingsList(settings.modelAllowlist)}
              normalize={normalizeSettingsListDraft}
              onCommit={(value) => updateSettingsList('modelAllowlist', value)}
              commitOnSubmit={false}
              inputProps={{ autoCapitalize: 'none', autoCorrect: false, multiline: true, style: { minHeight: 48, maxHeight: 88 } }}
            />
            <CommittedSettingsField
              label={t('settings.modelBlocklist')}
              note={t('settings.blocklistNote')}
              value={joinSettingsList(settings.modelBlocklist)}
              normalize={normalizeSettingsListDraft}
              onCommit={(value) => updateSettingsList('modelBlocklist', value)}
              commitOnSubmit={false}
              inputProps={{ autoCapitalize: 'none', autoCorrect: false, multiline: true, style: { minHeight: 48, maxHeight: 88 } }}
            />
          </MotiView>
          ) : null}
        </MotiView>
        ) : null}
        </AnimatePresence>

        <AnimatePresence>
        {expandedGroups.updates ? (
          <MotiView
            key="updates-foldout"
            from={motion === 'full' ? { opacity: 0, translateY: 8 } : { opacity: 0 }}
            animate={{ opacity: 1, translateY: 0 }}
            exit={motion === 'full' ? { opacity: 0, translateY: -4 } : { opacity: 0 }}
            transition={foldoutMotion}
            style={foldoutBodyStyle}
          >
            <View style={{ borderRadius: Math.min(colors.ui.radius.card, 8), padding: 10, backgroundColor: resolveSettingsFoldoutSurface(colors, colors.ui.glass, 'muted'), borderWidth: subtleBorderWidth, borderColor: resolveSettingsFoldoutBorder(colors, colors.ui.glass) }}>
              <VersionRow label={t('settings.appVersion')} value={`${version.appVersion} (${version.buildVersion})`} />
              <VersionRow label={t('settings.lastCheck')} value={formatSettingsUpdateCheckTime(settings.lastApkUpdateCheckAt, t)} />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', gap: 10 }}>
              <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: narrowLayout ? '100%' : '45%', minWidth: 0 }}>
                <DataButton
                  label={updateActionLabel}
                  icon={updatingApk ? <HighFrameSpinner color={colors.ui.control.primaryForeground} size={16} /> : <AppIcon name="device" color={colors.ui.control.primaryForeground} size={18} />}
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
              <View style={{ borderRadius: Math.min(colors.ui.radius.card, 8), padding: 10, backgroundColor: resolveSettingsFoldoutSurface(colors, colors.ui.glass, 'muted'), borderWidth: subtleBorderWidth, borderColor: resolveSettingsFoldoutBorder(colors, colors.ui.glass) }}>
                <Text style={{ color: colors.text, fontSize: 12, lineHeight: 17, fontWeight: '800' }}>{updateActionLabel}</Text>
                <IsleProgress
                  percent={updateProgressPercent}
                  size="small"
                  showInfo={!updateProgressIndeterminate}
                  infoPosition="right"
                  indeterminate={updateProgressIndeterminate}
                  style={{ marginTop: 8 }}
                />
                <Text style={{ marginTop: 4, color: colors.textSecondary, fontSize: 11, lineHeight: 16, fontWeight: '700' }}>{updateProgressDetail}</Text>
              </View>
            ) : null}
          </MotiView>
        ) : null}
        </AnimatePresence>

        <AnimatePresence>
        {expandedGroups.danger ? (
          <MotiView
            key="danger-foldout"
            from={motion === 'full' ? { opacity: 0, translateY: 8 } : { opacity: 0 }}
            animate={{ opacity: 1, translateY: 0 }}
            exit={motion === 'full' ? { opacity: 0, translateY: -4 } : { opacity: 0 }}
            transition={foldoutMotion}
            style={foldoutBodyStyle}
          >
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <DangerButton label={t('settings.clearChats')} icon={<AppIcon name="delete" color={colors.ui.control.dangerForeground} size={18} />} onPress={confirmClearChats} />
              <DangerButton label={t('settings.resetSettings')} icon={<AppIcon name="retry" color={colors.ui.control.dangerForeground} size={18} />} onPress={confirmResetSettings} />
              <DangerButton label={t('settings.clearData')} icon={<AppIcon name="delete" color={colors.ui.control.dangerForeground} size={18} />} onPress={() => void dialog.confirm({
                title: t('settings.clearData'),
                message: t('settings.clearDataConfirm'),
                tone: 'danger',
                confirmLabel: t('settings.clearData'),
                cancelLabel: t('common.cancel'),
              }).then((confirmed) => {
                if (confirmed) void clearAllAppData()
              })} />
            </View>
          </MotiView>
        ) : null}
        </AnimatePresence>
          </MotiView>
        ) : null}
        </AnimatePresence>
      </>
      ) : null}
      </View>
    </ScrollView>
  )
})

function SettingsInlineLabel({ title, detail }: { title: string; detail: string }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ paddingTop: 2 }}>
      <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '700', includeFontPadding: false, textAlignVertical: 'center' }}>{title}</Text>
      <Text numberOfLines={2} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, marginTop: 2, fontWeight: '500', includeFontPadding: false, textAlignVertical: 'center' }}>{detail}</Text>
    </View>
  )
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
  const actionCompact = width < 360
  const visibleTasks = repairPlan.tasks.slice(0, 4)
  return (
    <View style={{ borderRadius: Math.min(colors.ui.radius.card, 8), padding: 10, backgroundColor: colors.ui.limeRoad ? colors.ui.semantic.surface.muted : colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted, borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth, borderColor: colors.ui.limeRoad ? colors.material.stroke : colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border, gap: 9 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <AppIcon name="tools" color={colors.textSecondary} size={16} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '800', includeFontPadding: false, textAlignVertical: 'center' }}>{t('settings.runtimeRepairTasks')}</Text>
          <Text numberOfLines={2} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, fontWeight: '800', marginTop: 2, includeFontPadding: false, textAlignVertical: 'center' }}>
            {t('settings.runtimeRepairTasksValue', {
              count: repairPlan.taskCount,
              critical: repairPlan.bySeverity.critical,
              warning: repairPlan.bySeverity.warning,
            })}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: actionCompact ? 'column' : 'row', flexWrap: actionCompact ? 'nowrap' : 'wrap', gap: 8, alignItems: actionCompact ? 'stretch' : 'center' }}>
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
              style={{ flexGrow: 1, flexShrink: 1, flexBasis: actionCompact ? '100%' : '47%', minWidth: 0, alignSelf: 'stretch' }}
              textStyle={{ textAlign: 'center' }}
            />
          )
        })}
      </View>
    </View>
  )
}

function SettingsToggleRow({
  title,
  description,
  active,
  icon,
  onPress,
  first = false,
}: {
  title: string
  description?: string
  active: boolean
  icon?: ReactNode
  onPress: () => void
  first?: boolean
}) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const dividerColor = colors.ui.limeRoad ? colors.material.stroke : colors.ui.semantic.chrome.border
  return (
    <IslePressable haptic accessibilityRole="switch" accessibilityLabel={description ? `${title}. ${description}` : title} accessibilityState={{ checked: active }} onPress={onPress} style={{ borderRadius: Math.min(colors.ui.radius.controlMiddle, 8) }}>
      <MotiView
        animate={{ backgroundColor: 'transparent' }}
        transition={motion === 'full' ? { type: 'timing', duration: motionTokens.duration.fast } : { type: 'timing', duration: 1 }}
        style={{
          minHeight: description ? 60 : 50,
          paddingVertical: description ? 9 : 7,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
          borderTopColor: dividerColor,
        }}
      >
        {icon ? (
          <View style={{ width: 28, height: 34, alignItems: 'center', justifyContent: 'center' }}>
            {icon}
          </View>
        ) : null}
        <View style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: '700', includeFontPadding: false, textAlignVertical: 'center' }}>
            {title}
          </Text>
          {description ? (
            <Text numberOfLines={3} style={{ color: colors.textTertiary, fontSize: 12, lineHeight: 17, marginTop: 3, fontWeight: '500', includeFontPadding: false, textAlignVertical: 'center' }}>
              {description}
            </Text>
          ) : null}
        </View>
        <View accessible={false} pointerEvents="none" style={{ height: 34, justifyContent: 'center' }}>
          <SettingsMiniSwitch active={active} />
        </View>
      </MotiView>
    </IslePressable>
  )
}

function SettingsMiniSwitch({ active }: { active: boolean }) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const switchTokens = colors.ui.switch
  const width = 48
  const height = 28
  const thumbInset = 3
  const knob = height - thumbInset * 2
  const thumbTravel = width - knob - thumbInset * 2
  return (
    <MotiView
      accessible={false}
      style={{
        width,
        height,
        borderRadius: height / 2,
        alignItems: 'flex-start',
        justifyContent: 'center',
      }}
    >
      <MotiView
        animate={{
          backgroundColor: active ? switchTokens.trackOn : switchTokens.trackOff,
          borderColor: active ? switchTokens.trackOnBorder : switchTokens.trackOffBorder,
        }}
        transition={motion === 'full' ? { type: 'timing', duration: motionTokens.duration.fast } : { type: 'timing', duration: 1 }}
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: height / 2, borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth }}
      />
      <MotiView
        animate={{ translateX: active ? thumbTravel : 0 }}
        transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
        style={{
          position: 'absolute',
          top: thumbInset,
          left: thumbInset,
          width: knob,
          height: knob,
          borderRadius: knob / 2,
          backgroundColor: switchTokens.thumb,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: active ? switchTokens.thumbOnBorder : switchTokens.thumbOffBorder,
        }}
      />
    </MotiView>
  )
}

function ThemeFamilyCard({
  themeId,
  label,
  detail,
  active,
  compact,
  onPress,
  testID,
}: {
  themeId: CanonicalThemeId
  label: string
  detail: string
  active: boolean
  compact: boolean
  onPress: () => void
  testID: string
}) {
  const { colors, mode, themeAccent } = useAppTheme()
  const motion = useMotionPreference()
  const previewColors = getColors(mode, themeId, undefined, themeAccent)
  const activeBorder = colors.ui.control.primaryBackground
  const subtleBorderWidth = colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth
  const inactiveBackground = colors.ui.limeRoad ? colors.ui.semantic.surface.muted : colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted
  const inactiveBorder = colors.ui.limeRoad ? colors.material.stroke : colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  return (
    <IslePressable haptic testID={testID} accessibilityRole="radio" accessibilityLabel={`${label}. ${detail}`} accessibilityState={{ checked: active }} aria-checked={active} onPress={onPress} style={{ flexGrow: 1, flexShrink: 1, flexBasis: compact ? '100%' : '47%', minWidth: 0, minHeight: 116 }}>
      <MotiView
        animate={{
          backgroundColor: active ? colors.ui.semantic.surface.base : inactiveBackground,
          borderColor: active ? activeBorder : inactiveBorder,
        }}
        transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
        style={{
          minHeight: 116,
          borderRadius: Math.min(colors.ui.radius.card, 8),
          padding: 8,
          borderWidth: active ? 2 : subtleBorderWidth,
          gap: 7,
        }}
      >
        <ThemeFamilyPreview themeId={themeId} colors={previewColors} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '800' }}>
            {label}
          </Text>
          <View style={{ width: 20, height: 20, borderRadius: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? colors.ui.control.primaryBackground : 'transparent', borderWidth: subtleBorderWidth, borderColor: active ? colors.ui.control.primaryBorder : inactiveBorder }}>
            {active ? <AppIcon name="check" color={colors.ui.control.primaryForeground} size={13} strokeWidth={appIconStroke.bold} /> : null}
          </View>
        </View>
        <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 10.5, lineHeight: 15, fontWeight: '600' }}>
          {detail}
        </Text>
      </MotiView>
    </IslePressable>
  )
}

function ThemeFamilyPreview({ themeId, colors }: { themeId: CanonicalThemeId; colors: ReturnType<typeof getColors> }) {
  const editorial = colors.ui.experience.layout === 'editorial'
  const material = colors.ui.experience.layout === 'structured'
  const glass = colors.ui.experience.layout === 'layered'

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        height: 58,
        overflow: 'hidden',
        position: 'relative',
        borderRadius: Math.min(colors.ui.radius.panel, glass ? 8 : 6),
        backgroundColor: colors.background.canvas,
        borderWidth: 1,
        borderColor: colors.ui.semantic.chrome.border,
      }}
    >
      {editorial ? <View style={{ position: 'absolute', top: 0, right: 0, left: 0, height: 20, backgroundColor: colors.skyWash }} /> : null}
      {material ? <View style={{ position: 'absolute', top: 7, right: 7, bottom: 7, left: 7, borderRadius: 6, backgroundColor: colors.ui.semantic.surface.muted }} /> : null}
      {glass ? <View style={{ position: 'absolute', top: 5, right: 5, bottom: 5, left: 5, borderRadius: 8, backgroundColor: colors.ui.semantic.surface.overlay, borderWidth: 1, borderColor: colors.ui.semantic.chrome.border }} /> : null}
      <View style={{ height: 15, paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ width: editorial ? 26 : 20, height: 3, backgroundColor: colors.ui.section.title }} />
        <View style={{ flexDirection: 'row', gap: 3 }}>
          <View style={{ width: 5, height: 5, borderRadius: material ? 3 : 2, backgroundColor: colors.ui.icon.accentForeground }} />
          <View style={{ width: 5, height: 5, borderRadius: material ? 3 : 2, backgroundColor: colors.ui.tone.warning.foreground }} />
        </View>
      </View>
      <View style={{ flex: 1, paddingHorizontal: glass ? 12 : 8, paddingTop: 4, gap: 4 }}>
        <View style={{ width: '66%', height: 4, backgroundColor: colors.text, opacity: 0.78 }} />
        <View style={{ width: '88%', height: 3, backgroundColor: colors.textSecondary, opacity: 0.4 }} />
        <View style={{ width: '52%', height: 3, backgroundColor: colors.textSecondary, opacity: 0.28 }} />
      </View>
      {editorial ? (
        <View style={{ position: 'absolute', right: 8, bottom: 8, left: 8, height: 2, backgroundColor: colors.primary }}>
          <View style={{ position: 'absolute', right: 18, top: -4, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent, borderWidth: 2, borderColor: colors.primary }} />
        </View>
      ) : null}
      <View style={{ position: 'absolute', right: 7, bottom: 6, width: material ? 26 : 32, height: 9, borderRadius: material ? 5 : glass ? 7 : 4, backgroundColor: colors.ui.control.primaryBackground }} />
      <View style={{ position: 'absolute', left: 7, bottom: 6, width: themeId === 'minimal' ? 18 : 10, height: 9, borderRadius: material ? 5 : glass ? 7 : 4, backgroundColor: colors.ui.semantic.surface.muted }} />
    </View>
  )
}

function ThemeModeCard({ label, active, onPress, testID }: { label: string; active: boolean; onPress: () => void; testID: string }) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const subtleBorderWidth = colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth
  const inactiveBackground = colors.ui.limeRoad ? colors.ui.semantic.surface.muted : colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted
  const inactiveBorder = colors.ui.limeRoad ? colors.material.stroke : colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  return (
    <IslePressable haptic testID={testID} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: active }} aria-checked={active} onPress={onPress} style={{ flex: 1, minWidth: 0, minHeight: themeModeCardHeight }}>
      <MotiView
        animate={{
          backgroundColor: active ? colors.ui.control.primaryBackground : inactiveBackground,
          borderColor: active ? colors.ui.control.primaryBorder : inactiveBorder,
        }}
        transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
        style={{
          minHeight: themeModeCardHeight,
          borderRadius: Math.min(colors.ui.radius.card, 8),
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
        <Text numberOfLines={1} style={{ color: active ? colors.ui.control.primaryForeground : colors.textSecondary, fontSize: 13, lineHeight: 18, fontWeight: '700', includeFontPadding: false, textAlignVertical: 'center' }}>
          {label}
        </Text>
      </MotiView>
    </IslePressable>
  )
}

function ThemeAccentSwatch({
  label,
  color,
  active,
  disabled = false,
  onPress,
  testID,
}: {
  label: string
  color?: string
  active: boolean
  disabled?: boolean
  onPress: () => void
  testID: string
}) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const borderColor = active ? colors.ui.control.primaryBorder : colors.ui.semantic.chrome.border
  return (
    <IslePressable
      haptic
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: active }}
      aria-checked={active}
      disabled={disabled}
      onPress={onPress}
      style={{ minWidth: 62, minHeight: 46, flexGrow: 1, flexBasis: '17%' }}
    >
      <MotiView
        animate={{ backgroundColor: active ? colors.ui.semantic.surface.raised : colors.ui.semantic.surface.muted, borderColor }}
        transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
        style={{ minHeight: 46, borderRadius: Math.min(colors.ui.radius.controlMiddle, 8), borderWidth: active ? 2 : StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 8 }}
      >
        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: color ?? colors.ui.control.primaryBackground, borderWidth: 2, borderColor: color ? 'rgba(255,255,255,0.7)' : colors.ui.semantic.chrome.border, overflow: 'hidden' }}>
          {color === undefined ? <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 12, backgroundColor: colors.ui.semantic.surface.base }} /> : null}
        </View>
        <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 10, lineHeight: 13, fontWeight: '600' }}>{label}</Text>
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
    <View accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text style={{ color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '700', marginBottom: 7, includeFontPadding: false, textAlignVertical: 'center' }}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {options.map((option) => (
          <IslePressable key={option.value} haptic accessibilityRole="radio" accessibilityLabel={t(option.labelKey)} accessibilityState={{ checked: option.value === value }} onPress={() => onChange(option.value)} style={settingsChipPressableStyle}>
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
  const releaseSize = release.sizeBytes ? formatSettingsApkSizeBytes(release.sizeBytes, t('updates.unknown')) : t('updates.unknown')
  if (stage === 'downloading' && progress?.bytesWritten != null) {
    const written = formatSettingsApkSizeBytes(progress.bytesWritten, t('updates.unknown'))
    const expected = progress.bytesExpected ? formatSettingsApkSizeBytes(progress.bytesExpected, t('updates.unknown')) : releaseSize
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

function importResultMessage(
  result: Awaited<ReturnType<typeof importPortableDataFromJsonFile>>,
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (!result.ok && result.reason === 'file_too_large') {
    return `${t('error.fileTooLarge')} (${formatImportSizeLimit(MAX_IMPORT_JSON_FILE_BYTES)})`
  }
  if (!result.ok && result.reason === 'picker_failed') return t('settings.importPickerFailedMessage')
  if (!result.ok && result.reason === 'read_failed') return t('settings.importReadFailedMessage')
  if (!result.ok && result.reason === 'invalid_json') return t('settings.importInvalidJsonMessage')
  if (!result.ok && result.reason === 'persistence_failed') return t('settings.importPersistenceFailedMessage')
  if (!result.ok) return t('settings.importSkippedMessage')
  if (result.kind === 'mem0') return t('settings.importMem0DoneMessage', { count: result.memories })
  return t('settings.importDoneMessage')
}

function VersionRow({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Text numberOfLines={2} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, fontWeight: '700', flexBasis: '34%', minWidth: 0, maxWidth: '42%', flexShrink: 1, includeFontPadding: false, textAlignVertical: 'center' }}>{label}</Text>
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
      style={{ flexGrow: 1, flexShrink: 1, flexBasis: '47%', minWidth: 0, alignSelf: 'stretch', minHeight: 48, borderRadius: Math.min(colors.ui.radius.controlLarge, 8), justifyContent: 'center', paddingHorizontal: 14 }}
      textStyle={{ textAlign: 'center', textAlignVertical: 'center' }}
    />
  )
}

function DangerButton({ label, icon, onPress }: { label: string; icon: ReactNode; onPress: () => void }) {
  const { colors } = useAppTheme()
  return <IsleButton label={label} icon={icon} tone="danger" onPress={onPress} style={{ flexGrow: 1, flexShrink: 1, flexBasis: '47%', minWidth: 0, minHeight: 48, borderRadius: Math.min(colors.ui.radius.controlLarge, 8) }} />
}
