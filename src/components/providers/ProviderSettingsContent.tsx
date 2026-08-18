import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AppState, findNodeHandle, InteractionManager, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type KeyboardEvent, type LayoutChangeEvent } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { MotiView } from 'moti'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/ui/AppIcon'
import { HighFrameSpinner } from '@/components/ui/HighFrameSpinner'
import { ApiKeyPanel } from '@/components/settings/ApiKeyPanel'
import { SettingsSummaryStrip, type SettingsSummaryItem } from '@/components/settings/SettingsSummaryStrip'
import { useMainPagerGestureLock } from '@/components/main/MainPagerGestureLock'
import { ISLE_MIN_TOUCH_TARGET, IsleField, IsleIconButton, IsleProgress } from '@/components/ui/isle'
import { IsleButton } from '@/components/ui/isle'
import { IsleOverlayPressable, IslePressable } from '@/components/ui/isle'
import type { IsleBackgroundState } from '@/components/ui/isle'
import { useIsleDialog } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { resolveActivationJobProgress, useActivationJobStore, type ActivationJobItemState, type ActivationJobState } from '@/store/activationJobStore'
import * as Clipboard from 'expo-clipboard'
import * as DocumentPicker from 'expo-document-picker'
import type { AIProvider } from '@/types/providerContracts'
import type { ProviderPresetId, ProviderWireProtocol } from '@/types/providerContracts'
import { getProviderConfigIssue } from '@/types/providerBaseUrls'
import { applyProviderPreset, countDetectedProviderImports, formatProviderNameList, getProviderPreset, looksLikeProviderImportConnectionText, parseCredentialGroups, parseProviderImportDraft, parseProviderImportText, probeProviderPreset, PROVIDER_VENDOR_PRESETS } from '@/bootstrap/providerRegistry'
import { DEFAULT_PROVIDER_PRESET_ID, DEFAULT_PROVIDER_WIRE_PROTOCOL, PROVIDER_SETTINGS_MODEL_SAMPLE_LIMIT, PROVIDER_WIRE_PROTOCOL_OPTIONS, inferProviderWireProtocolFromBaseUrl, shouldSyncWireProtocolFromBaseUrl, type ProviderSettingsGroup, type ProviderSortMode } from '@/modules/providers'
import { resolveProviderConfigDraft } from '@/bootstrap/providerPolicies'
import { activationItemProgress } from '@/services/providerActivationJob'
import { deleteTemporaryImportCopy, isFileTooLargeError, MAX_IMPORT_TEXT_FILE_BYTES, readUtf8ImportFile } from '@/platform/native/boundedImportFile'
import { parseModels } from '@/utils/text'
import { isProviderConversationReady } from '@/utils/providerModels'
import { hasProviderModelAccessRules, providerHasPolicyAllowedModel } from '@/bootstrap/providerModelAccess'
import { buildProviderSettingsPolicyModelCache, buildProviderSettingsSearchIndex, filterAndSortProviders, groupProviderSettingsCards } from '@/bootstrap/providerSettingsList'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useProviderActivationJob } from '@/components/providers/useProviderActivationJob'
import { useProviderUsageSnapshots, type ProviderUsageSnapshot, type ProviderUsageSnapshotMap } from '@/components/providers/useProviderUsageSnapshots'
import { ProviderUsageQueryEditor } from '@/components/providers/ProviderUsageQueryEditor'
import { PROVIDER_CARD_DETAIL_MAX_WIDTH } from '@/components/providers/ProviderCardGrid'
import {
  LimeRoadProviderSettingsExperience,
  MarkdownProviderSettingsExperience,
  MinimalProviderSettingsExperience,
} from '@/components/providers/theme-experiences/ProviderSettingsExperiences'
import type { RuntimeDiagnosticsProviderDetail, RuntimeDiagnosticsSummary } from '@/services/runtimeDiagnostics'
import { clearAndroidStatusNotification, updateAndroidStatusNotification } from '@/bootstrap/androidStatusNotification'
import { resolveProviderDisplayName, resolveProviderSupplierDisclosure } from '@/presentation/features/settings/providerPresentation'
import { invalidateProviderUsage } from '@/bootstrap/providerUsageRuntime'

type ClipboardReadState = 'idle' | 'requesting'
type AppThemeColors = ReturnType<typeof useAppTheme>['colors']
type ProviderImportProgressStage = 'parsing' | 'saving' | 'finishing'

interface ProviderImportProgress {
  stage: ProviderImportProgressStage
  completed: number
  total: number
  currentProviderName?: string
}

const SORT_OPTIONS: { id: ProviderSortMode; labelKey: string }[] = [
  { id: 'manual', labelKey: 'providerSettings.sort.manual' },
  { id: 'recent', labelKey: 'providerSettings.sort.recent' },
  { id: 'enabled', labelKey: 'providerSettings.sort.enabled' },
  { id: 'models', labelKey: 'providerSettings.sort.models' },
  { id: 'health', labelKey: 'providerSettings.sort.health' },
  { id: 'name', labelKey: 'providerSettings.sort.name' },
]

const IMPORT_INPUT_LINE_HEIGHT = 20
const IMPORT_INPUT_VERTICAL_PADDING = 18
const IMPORT_INPUT_MAX_LINES = 14
const IMPORT_SHEET_MARGIN = 16
const PROVIDER_MODAL_KEYBOARD_BRIDGE_HEIGHT = 48
const PROVIDER_MODAL_KEYBOARD_TOOLBAR_OVERLAP = 48
const IMPORT_HEADER_HEIGHT = 64
const IMPORT_FOOTER_HEIGHT = 64
const IMPORT_BODY_FIXED_SPACE = 100
const PROVIDER_ROW_HEIGHT = 72
const PROVIDER_DRAG_STEP = 64
const PROVIDER_CARD_RADIUS = 8
const CLEAR_INVALID_PROVIDER_LIST_LIMIT = 12
const PROVIDER_POLICY_MODEL_UI_LIMIT = PROVIDER_SETTINGS_MODEL_SAMPLE_LIMIT
const RUNTIME_DIAGNOSTICS_DEBOUNCE_MS = 900
const PROVIDER_RUNTIME_DIAGNOSTICS_AUTO_PROVIDER_LIMIT = 8
const PROVIDER_RUNTIME_DIAGNOSTICS_AUTO_MODEL_ENTRY_LIMIT = 256
const PROVIDER_MANUAL_SORT_RAIL_PROVIDER_LIMIT = 8
const PROVIDER_DETAILS_DEFER_PROVIDER_LIMIT = 8
const PROVIDER_DETAILS_DEFER_FALLBACK_MS = 180
const PROVIDER_IMPORT_PERSISTENCE_FLUSH_DELAY_MS = 1400
const PROVIDER_OPERATION_NOTIFICATION_CLEAR_DELAY_MS = 5000
const PROVIDER_IMPORT_LIVE_DETECTION_CHAR_LIMIT = 120000
type ProviderFormFieldId = 'name' | 'baseUrl' | 'tokens' | 'models'

function resolveProviderChrome(colors: AppThemeColors) {
  const subtleBorderWidth = colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth
  const chromeSurface = colors.ui.limeRoad ? colors.ui.semantic.surface.base : colors.ui.glass ? colors.ui.semantic.chrome.background : colors.ui.semantic.surface.base
  const chromeBorder = colors.ui.limeRoad ? colors.material.stroke : colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  const mutedSurface = colors.ui.limeRoad ? colors.ui.semantic.surface.muted : colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted
  const raisedSurface = colors.ui.limeRoad ? colors.ui.semantic.surface.base : colors.ui.glass ? colors.ui.semantic.surface.overlay : colors.ui.semantic.surface.base
  return { subtleBorderWidth, chromeSurface, chromeBorder, mutedSurface, raisedSurface }
}

function countProviderRuntimeDiagnosticsModelEntries(providers: AIProvider[]): number {
  return providers.reduce((sum, provider) => {
    const groupModels = (provider.credentialGroups ?? []).reduce((groupSum, group) => groupSum + (group.availableModels?.length ?? 0), 0)
    return sum +
      (provider.models?.length ?? 0) +
      (provider.modelConfigs?.length ?? 0) +
      (provider.modelAvailability?.length ?? 0) +
      groupModels
  }, 0)
}

function formatProviderUsageNumber(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function providerUsageSummary(
  snapshot: ProviderUsageSnapshot | undefined,
  translate: (key: string, options?: Record<string, unknown>) => string,
): string | undefined {
  if (!snapshot) return undefined
  if (snapshot.status === 'loading') return translate('providerSettings.usageLoading')
  if (snapshot.status === 'error') return translate('providerSettings.usageError')
  if (snapshot.status === 'unavailable' || !snapshot.result) return translate('providerSettings.usageUnavailable')
  const result = snapshot.result
  const unit = result.unit ? ` ${result.unit}` : ''
  if (result.remaining !== undefined) {
    return translate('providerSettings.usageRemaining', { value: formatProviderUsageNumber(result.remaining), unit })
  }
  if (result.used !== undefined && result.limit !== undefined) {
    return translate('providerSettings.usageUsedOfLimit', {
      used: formatProviderUsageNumber(result.used),
      limit: formatProviderUsageNumber(result.limit),
      unit,
    })
  }
  if (result.used !== undefined) {
    return translate('providerSettings.usageUsed', { value: formatProviderUsageNumber(result.used), unit })
  }
  if (result.limit !== undefined) {
    return translate('providerSettings.usageLimit', { value: formatProviderUsageNumber(result.limit), unit })
  }
  return translate('providerSettings.usageUnavailable')
}

function providerUsageSnapshotForGroup(
  providers: readonly AIProvider[],
  snapshots: ProviderUsageSnapshotMap,
): ProviderUsageSnapshot | undefined {
  const groupSnapshots = providers.map((provider) => snapshots.get(provider.id)).filter(Boolean) as ProviderUsageSnapshot[]
  return groupSnapshots.find((snapshot) => snapshot.status === 'ready')
    ?? groupSnapshots.find((snapshot) => snapshot.status === 'loading')
    ?? groupSnapshots[0]
}

interface ProviderSettingsContentProps {
  embedded?: boolean
  autoOpenAdd?: boolean
  onClose?: () => void
  onProviderConnected?: () => void
  onBackgroundStateChange?: (state: IsleBackgroundState) => void
}

export function ProviderSettingsContent({ embedded = false, autoOpenAdd = false, onClose, onProviderConnected, onBackgroundStateChange }: ProviderSettingsContentProps) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const motion = useMotionPreference()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const compactWidth = width < 430
  const veryCompactWidth = width < 360
  const pagePadding = compactWidth ? 12 : 16
  const pagerGestureLock = useMainPagerGestureLock()
  const providers = useSettingsStore((state) => state.providers)
  const providerUsageSnapshots = useProviderUsageSnapshots(providers)
  const addProvider = useSettingsStore((state) => state.addProvider)
  const addProviders = useSettingsStore((state) => state.addProviders)
  const reorderProviders = useSettingsStore((state) => state.reorderProviders)
  const removeProvider = useSettingsStore((state) => state.removeProvider)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const clearAllProviders = useSettingsStore((state) => state.clearAllProviders)
  const listInvalidProviders = useSettingsStore((state) => state.listInvalidProviders)
  const clearInvalidProviders = useSettingsStore((state) => state.clearInvalidProviders)
  const compactProviderStorage = useSettingsStore((state) => state.compactProviderStorage)
  const flushProviderPersistence = useSettingsStore((state) => state.flushProviderPersistence)
  const settings = useSettingsStore((state) => state.settings)
  const storedConversations = useChatStore((state) => state.conversations)
  const draftConversationIds = useChatStore((state) => state.draftConversationIds)
  const conversations = useMemo(
    () => storedConversations.filter((conversation) => !draftConversationIds.has(conversation.id)),
    [draftConversationIds, storedConversations]
  )
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null)
  const [expandedSupplierId, setExpandedSupplierId] = useState<string | null>(null)
  const [deletingSupplierId, setDeletingSupplierId] = useState<string | null>(null)
  const selectedProvider = expandedProviderId ? providers.find((provider) => provider.id === expandedProviderId) : undefined
  const [sortMode, setSortMode] = useState<ProviderSortMode>('manual')
  const [modelFilter, setModelFilter] = useState('')
  const deferredModelFilter = useDeferredValue(modelFilter)
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [addOpen, setAddOpen] = useState(autoOpenAdd)
  const [importOpen, setImportOpen] = useState(false)
  const [batchActionsOpen, setBatchActionsOpen] = useState(false)
  const [listToolsOpen, setListToolsOpen] = useState(false)
  const [importProgress, setImportProgress] = useState<ProviderImportProgress | null>(null)
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<RuntimeDiagnosticsSummary | null>(null)
  const runtimeDiagnosticsRunRef = useRef(0)
  const providerNotificationClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const providerPersistenceFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppressedSupplierPress = useRef<string | null>(null)
  const providerModelAccessSettings = useMemo(() => ({
    providerAllowlist: settings.providerAllowlist,
    providerBlocklist: settings.providerBlocklist,
    modelAllowlist: settings.modelAllowlist,
    modelBlocklist: settings.modelBlocklist,
  }), [settings.providerAllowlist, settings.providerBlocklist, settings.modelAllowlist, settings.modelBlocklist])
  const providerModelAccessHasRules = useMemo(
    () => hasProviderModelAccessRules(providerModelAccessSettings),
    [providerModelAccessSettings]
  )
  const providerPolicyCacheRequired = sortMode === 'models' || (providerModelAccessHasRules && deferredModelFilter.trim().length > 0)
  const policyModelsByProviderId = useMemo(
    () => providerPolicyCacheRequired ? buildProviderSettingsPolicyModelCache(providers, providerModelAccessSettings, { modelLimit: PROVIDER_POLICY_MODEL_UI_LIMIT }) : undefined,
    [providers, providerModelAccessSettings, providerPolicyCacheRequired]
  )
  const providerSearchTextById = useMemo(
    () => deferredModelFilter.trim().length ? buildProviderSettingsSearchIndex(providers, policyModelsByProviderId) : undefined,
    [deferredModelFilter, providers, policyModelsByProviderId]
  )
  const providerRuntimeDiagnosticsModelEntries = useMemo(
    () => countProviderRuntimeDiagnosticsModelEntries(providers),
    [providers]
  )
  const autoRuntimeDiagnosticsEnabled = providers.length <= PROVIDER_RUNTIME_DIAGNOSTICS_AUTO_PROVIDER_LIMIT &&
    providerRuntimeDiagnosticsModelEntries <= PROVIDER_RUNTIME_DIAGNOSTICS_AUTO_MODEL_ENTRY_LIMIT
  const runtimeDiagnosticsEnabled = Boolean(selectedProvider) && autoRuntimeDiagnosticsEnabled
  const { activationBusy, activationJob, clearActivationJob, activateProviders, isActivationRunning } = useProviderActivationJob({
    onActivationCompleted: () => {
      setBatchMode(false)
      setSelectedIds(new Set())
      onProviderConnected?.()
    },
  })
  const backgroundState: IsleBackgroundState = keyboardHeight > 0
    ? 'input'
    : addOpen || importOpen || Boolean(selectedProvider)
      ? 'modal'
      : activationJob?.status === 'failed'
        ? 'error'
        : isActivationRunning
          ? 'active'
          : 'idle'

  useEffect(() => {
    if (!embedded) return undefined
    pagerGestureLock?.setLocked(true)
    return () => pagerGestureLock?.setLocked(false)
  }, [embedded, pagerGestureLock])

  useEffect(() => {
    if (autoOpenAdd) setAddOpen(true)
  }, [autoOpenAdd])

  useEffect(() => {
    const showSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (event) => {
      setKeyboardHeight(event.endCoordinates.height)
    })
    const hideSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      setKeyboardHeight(0)
    })
    return () => {
      showSub.remove()
      hideSub.remove()
    }
  }, [])

  useEffect(() => {
    onBackgroundStateChange?.(backgroundState)
  }, [backgroundState, onBackgroundStateChange])

  useEffect(() => () => {
    if (providerNotificationClearTimer.current) clearTimeout(providerNotificationClearTimer.current)
    if (providerPersistenceFlushTimer.current) clearTimeout(providerPersistenceFlushTimer.current)
  }, [])

  useEffect(() => {
    if (isActivationRunning || importProgress) return undefined
    const timer = setTimeout(() => {
      compactProviderStorage()
    }, 600)
    return () => clearTimeout(timer)
  }, [compactProviderStorage, importProgress, isActivationRunning, providers])

  useEffect(() => {
    if (!runtimeDiagnosticsEnabled || isActivationRunning || importProgress) {
      // Diagnostics are only useful after the user opens a provider detail sheet.
      // In particular, an empty provider page must not pull the multi-megabyte
      // diagnostics bundle just to render its list.
      runtimeDiagnosticsRunRef.current += 1
      setRuntimeDiagnostics(null)
      return undefined
    }
    let cancelled = false
    const runId = runtimeDiagnosticsRunRef.current + 1
    runtimeDiagnosticsRunRef.current = runId
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const { buildRuntimeDiagnosticsSummary } = await import('@/services/runtimeDiagnostics')
          if (cancelled || runtimeDiagnosticsRunRef.current !== runId) return
          const summary = await buildRuntimeDiagnosticsSummary({ providers, settings })
          if (!cancelled && runtimeDiagnosticsRunRef.current === runId) setRuntimeDiagnostics(summary)
        } catch {
          if (!cancelled && runtimeDiagnosticsRunRef.current === runId) setRuntimeDiagnostics(null)
        }
      })()
    }, RUNTIME_DIAGNOSTICS_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [providers, settings, isActivationRunning, importProgress, runtimeDiagnosticsEnabled, selectedProvider?.id])

  const usageByProvider = useMemo(() => {
    const usage = new Map<string, number>()
    for (const conversation of conversations) {
      if (conversation.providerId === 'local-setup') continue
      usage.set(conversation.providerId, Math.max(usage.get(conversation.providerId) ?? 0, conversation.updatedAt))
    }
    return usage
  }, [conversations])

  const visibleProviderItems = useMemo(
    () => filterAndSortProviders(providers, {
      filter: deferredModelFilter,
      sortMode,
      usageByProvider,
      settings: providerModelAccessSettings,
      policyModelsByProviderId,
      searchTextByProviderId: providerSearchTextById,
    }),
    [deferredModelFilter, providers, providerModelAccessSettings, providerSearchTextById, policyModelsByProviderId, sortMode, usageByProvider]
  )
  const providerCardGroups = groupProviderSettingsCards(visibleProviderItems)
  const featuredProviderId = useMemo(() => {
    if (settings.defaultProvider && visibleProviderItems.some((provider) => provider.id === settings.defaultProvider)) {
      return settings.defaultProvider
    }
    return [...visibleProviderItems]
      .sort((left, right) => (usageByProvider.get(right.id) ?? 0) - (usageByProvider.get(left.id) ?? 0))[0]?.id
  }, [settings.defaultProvider, usageByProvider, visibleProviderItems])
  const manualOrdering = sortMode === 'manual'
  const providerOrderById = useMemo(
    () => new Map(providers.map((provider, index) => [provider.id, index] as const)),
    [providers]
  )
  const runtimeDetailByProviderId = useMemo(
    () => new Map((runtimeDiagnostics?.providerDetails ?? []).map((detail) => [detail.providerId, detail] as const)),
    [runtimeDiagnostics]
  )
  const hasModelFilter = deferredModelFilter.trim().length > 0
  const providerListIsSmall = providers.length <= PROVIDER_MANUAL_SORT_RAIL_PROVIDER_LIMIT
  const showManualSortControls = manualOrdering && providerListIsSmall && !hasModelFilter

  const enabled = providers.filter((provider) => provider.enabled).length
  const available = useMemo(
    () => providers.filter((provider) => isProviderConversationReady(provider) && (!providerModelAccessHasRules || providerHasPolicyAllowedModel(provider, providerModelAccessSettings))).length,
    [providers, providerModelAccessHasRules, providerModelAccessSettings]
  )
  const providerAttentionItems: SettingsSummaryItem[] = []
  if (providers.length && !enabled) {
    providerAttentionItems.push({
      key: 'enabled',
      label: t('settings.enabled'),
      value: String(enabled),
      detail: t('providerSettings.providerCount', { count: providers.length }),
      icon: <AppIcon name="toggle-on" color={colors.textTertiary} size={15} />,
      tone: 'amber',
    })
  }
  if (providers.length && enabled > 0 && !available) {
    providerAttentionItems.push({
      key: 'available',
      label: t('providerSettings.overviewAvailable'),
      value: String(available),
      detail: t('providerSettings.availableCount', { count: available }),
      icon: <AppIcon name="health" color={colors.textTertiary} size={15} />,
      tone: 'amber',
    })
  }
  if (providers.length && providerModelAccessHasRules) {
    providerAttentionItems.push({
      key: 'policy',
      label: t('settings.upstreamGovernance'),
      value: t('settings.policySummary'),
      detail: t('settings.policyAllowRules', { count: (settings.providerAllowlist?.length ?? 0) + (settings.modelAllowlist?.length ?? 0) }),
      icon: <AppIcon name="shield" color={colors.textTertiary} size={15} />,
      tone: 'default',
    })
  }
  const { subtleBorderWidth, chromeSurface, chromeBorder, mutedSurface, raisedSurface } = resolveProviderChrome(colors)
  const activeSortLabel = t(SORT_OPTIONS.find((option) => option.id === sortMode)?.labelKey ?? SORT_OPTIONS[0].labelKey)
  const providerListHint = manualOrdering
    ? t('providerSettings.manualSortHint')
    : t('providerSettings.sortedViewHint', { label: activeSortLabel })
  const listToolsActive = modelFilter.trim().length > 0
  const listToolsExpanded = listToolsOpen || listToolsActive
  const batchActionsActive = batchMode || Boolean(activationJob)
  const batchActionsExpanded = batchActionsOpen || batchActionsActive
  const providerActionButtonStyle = { flexGrow: 1, flexShrink: 1, flexBasis: veryCompactWidth ? '100%' : '48%', minWidth: 0, minHeight: 44 } as const
  async function addProviderFromForm(provider: AIProvider) {
    setAddOpen(false)
    const previousDefaultProvider = settings.defaultProvider
    const providerDisplayName = resolveProviderDisplayName(provider, t('providerSettings.customProvider'))
    dialog.toast({
      title: t('providerSettings.autoDetect'),
      message: providerDisplayName,
      tone: 'mint',
      durationMs: 1400,
    })
    const probeApiKey = provider.apiKey.trim()
      || provider.credentialGroups?.find((group) => group.enabled && group.apiKey?.trim())?.apiKey?.trim()
      || provider.credentialGroups?.find((group) => group.apiKey?.trim())?.apiKey?.trim()
      || ''
    const detection = await probeProviderPreset({
      baseUrl: provider.baseUrl,
      name: provider.name,
      apiKey: probeApiKey,
    }, { timeoutMs: 2500 })
    const detectedProvider = applyProviderPreset({
      ...provider,
      presetId: detection.presetId,
      detectedPresetId: detection.presetId,
      wireProtocol: detection.presetId === DEFAULT_PROVIDER_PRESET_ID
        ? detection.wireProtocol ?? provider.wireProtocol ?? DEFAULT_PROVIDER_WIRE_PROTOCOL
        : provider.wireProtocol,
      detectionStatus: 'detected',
    }, detection.presetId)
    await addProvider(detectedProvider)
    if (!previousDefaultProvider) updateSettings({ defaultProvider: null })
    setExpandedProviderId(detectedProvider.id)
    setSortMode('manual')
    setModelFilter('')
    await activateProviders([detectedProvider.id], 'single')
  }

  async function publishImportProgress(progress: ProviderImportProgress, options: { waitForNotification?: boolean } = {}) {
    setImportProgress(progress)
    const notification = publishProviderImportStatusNotification(progress, t)
    if (options.waitForNotification) await notification
  }

  function scheduleProviderOperationNotificationClear(delayMs = PROVIDER_OPERATION_NOTIFICATION_CLEAR_DELAY_MS) {
    if (providerNotificationClearTimer.current) clearTimeout(providerNotificationClearTimer.current)
    providerNotificationClearTimer.current = setTimeout(() => {
      providerNotificationClearTimer.current = null
      void clearAndroidStatusNotification()
    }, delayMs)
  }

  function scheduleProviderPersistenceFlush() {
    if (providerPersistenceFlushTimer.current) clearTimeout(providerPersistenceFlushTimer.current)
    providerPersistenceFlushTimer.current = setTimeout(() => {
      providerPersistenceFlushTimer.current = null
      void flushProviderPersistence()
    }, PROVIDER_IMPORT_PERSISTENCE_FLUSH_DELAY_MS)
  }

  async function importProvidersFromText(input: string): Promise<boolean> {
    if (importProgress) return false
    await publishImportProgress({ stage: 'parsing', completed: 0, total: 0 }, { waitForNotification: true })
    Keyboard.dismiss()
    await yieldToNextPaint()
    try {
      const result = parseProviderImportText(input, { accessSettings: settings })
      if (!result.providers.length) {
        setImportProgress(null)
        void clearAndroidStatusNotification()
        dialog.notice({ title: t('providerSettings.importEmpty'), message: result.warnings.join('\n') || t('providerSettings.importEmptyMessage'), tone: 'amber' })
        return false
      }

      await publishImportProgress({ stage: 'saving', completed: 0, total: result.providers.length }, { waitForNotification: true })
      await yieldToNextPaint()
      await addProviders(result.providers, {
        persist: 'deferred',
        yieldEvery: 4,
        onProgress: ({ completed, total, currentProviderName }) => {
          void publishImportProgress({ stage: 'saving', completed, total, currentProviderName })
        },
      })
      void publishImportProgress({ stage: 'finishing', completed: result.providers.length, total: result.providers.length })
      await yieldToNextPaint()
      updateSettings({ defaultProvider: result.providers[0].id })
      scheduleProviderPersistenceFlush()

      setImportProgress(null)
      setImportOpen(false)
      setExpandedProviderId(result.providers.length === 1 ? result.providers[0]?.id ?? null : null)
      setSortMode('manual')
      setModelFilter('')
      dialog.toast({
        title: t('providerSettings.importDone'),
        message: t('providerSettings.importDoneMessage', { count: result.providers.length }),
        tone: result.warnings.length ? 'amber' : 'mint',
        durationMs: 1800,
      })
      publishProviderImportCompletedNotification(result.providers.length, t)
      scheduleProviderOperationNotificationClear()

      const enableNow = await dialog.confirm({
        title: t('providerSettings.enableImportedTitle'),
        message: [t('providerSettings.enableImportedMessage', { count: result.providers.length }), formatProviderNameList(result.providers), ...result.warnings].filter(Boolean).join('\n'),
        confirmLabel: t('providerSettings.enableImportedConfirm'),
        cancelLabel: t('providerSettings.enableLater'),
        tone: result.warnings.length ? 'amber' : 'mint',
      })
      if (enableNow) {
        void activateProviders(result.providers.map((provider) => provider.id), 'batch')
      }
      return true
    } catch (error) {
      const failureMessage = providerImportFailureMessage(error, t)
      setImportProgress(null)
      publishProviderImportFailedNotification(failureMessage, t)
      scheduleProviderOperationNotificationClear(7000)
      dialog.notice({
        title: t('providerSettings.importFailed'),
        message: failureMessage,
        tone: 'danger',
      })
      return false
    }
  }

  async function enableEffectiveSelection() {
    const ids = batchMode ? Array.from(selectedIds) : providers.map((provider) => provider.id)
    if (!ids.length) {
      dialog.toast({ title: t('providerSettings.enableNone'), tone: 'amber' })
      return
    }
    void activateProviders(ids, batchMode ? 'batch' : 'all')
  }

  async function confirmClearAllProviders() {
    const confirmed = await dialog.confirm({
      title: t('providerSettings.clearAllTitle'),
      message: t('providerSettings.clearAllMessage', { count: providers.length }),
      confirmLabel: t('providerSettings.clearAllConfirm'),
      cancelLabel: t('common.cancel'),
      tone: 'danger',
    })
    if (!confirmed) return
    await clearAllProviders()
    setBatchMode(false)
    setSelectedIds(new Set())
    setExpandedProviderId(null)
    setModelFilter('')
    dialog.toast({ title: t('providerSettings.clearAllDone'), tone: 'mint' })
  }

  async function confirmClearInvalidProviders() {
    if (!providers.length) {
      dialog.toast({ title: t('providerSettings.clearInvalidNone'), tone: 'amber' })
      return
    }
    const invalidProviders = await listInvalidProviders()
    if (!invalidProviders.length) {
      dialog.toast({ title: t('providerSettings.clearInvalidNone'), tone: 'amber' })
      return
    }
    const confirmed = await dialog.confirm({
      title: t('providerSettings.clearInvalidTitle'),
      message: [
        t('providerSettings.clearInvalidMessage'),
        t('providerSettings.clearInvalidPendingList', { count: invalidProviders.length }),
        formatClearInvalidProviderList(invalidProviders, t),
      ].join('\n\n'),
      confirmLabel: t('providerSettings.clearInvalidConfirm'),
      cancelLabel: t('common.cancel'),
      tone: 'amber',
    })
    if (!confirmed) return
    const count = await clearInvalidProviders(invalidProviders.map((provider) => provider.id))
    if (!count) {
      dialog.toast({ title: t('providerSettings.clearInvalidNone'), tone: 'amber' })
      return
    }
    setBatchMode(false)
    setSelectedIds(new Set())
    setExpandedProviderId(null)
    setModelFilter('')
    dialog.toast({ title: t('providerSettings.clearInvalidDone'), message: t('providerSettings.clearInvalidDoneMessage', { count }), tone: 'mint' })
  }

  async function confirmRemoveSupplierGroup(group: ProviderSettingsGroup) {
    if (deletingSupplierId) return
    const count = group.providers.length
    const groupLabel = group.id.startsWith('preset:')
      ? getProviderPreset(group.id.slice('preset:'.length) as ProviderPresetId).name
      : group.label
    const confirmed = await dialog.confirm({
      title: t('providerSettings.deleteSupplierTitle', { name: groupLabel }),
      message: count === 1
        ? t('providerSettings.deleteSupplierSingleMessage')
        : t('providerSettings.deleteSupplierGroupMessage', { count }),
      confirmLabel: t('providerSettings.deleteSupplierConfirm', { count }),
      cancelLabel: t('common.cancel'),
      tone: 'danger',
      chips: [{ label: t('providerSettings.deleteSupplierConfigCount', { count }), tone: 'danger' }],
    })
    if (!confirmed) return

    const ids = new Set(group.providers.map((provider) => provider.id))
    setDeletingSupplierId(group.id)
    setExpandedProviderId((current) => current && ids.has(current) ? null : current)
    setExpandedSupplierId((current) => current === group.id ? null : current)
    setSelectedIds((current) => new Set([...current].filter((id) => !ids.has(id))))
    dialog.toast({
      title: t('providerSettings.deleteSupplierStarted'),
      message: t('providerSettings.deleteSupplierProgress', { completed: 0, total: count }),
      tone: 'amber',
      durationMs: 1800,
    })
    void publishProviderDeleteNotification('running', groupLabel, 0, count, t)

    let removed = 0
    try {
      for (const provider of group.providers) {
        await removeProvider(provider.id)
        invalidateProviderUsage(provider.id)
        removed += 1
        void publishProviderDeleteNotification('running', groupLabel, removed, count, t)
      }
      dialog.toast({
        title: t('providerSettings.deleteSupplierDone'),
        message: t('providerSettings.deleteSupplierDoneMessage', { name: groupLabel, count }),
        tone: 'mint',
      })
      void publishProviderDeleteNotification('completed', groupLabel, removed, count, t)
      scheduleProviderOperationNotificationClear()
    } catch {
      const partial = removed > 0
      const message = partial
        ? t('providerSettings.deleteSupplierPartialMessage', { completed: removed, total: count })
        : t('providerSettings.deleteSupplierFailedMessage')
      dialog.notice({
        title: partial ? t('providerSettings.deleteSupplierPartial') : t('providerSettings.deleteSupplierFailed'),
        message,
        tone: 'danger',
      })
      void publishProviderDeleteNotification('error', groupLabel, removed, count, t)
      scheduleProviderOperationNotificationClear(7000)
    } finally {
      setDeletingSupplierId(null)
    }
  }

  function toggleSelection(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function moveProvider(sourceId: string, offset: number) {
    if (!manualOrdering) {
      setSortMode('manual')
      dialog.toast({ title: t('providerSettings.manualSortRequired'), tone: 'amber' })
      return
    }
    if (!offset) return
    const currentIndex = providers.findIndex((provider) => provider.id === sourceId)
    if (currentIndex < 0) return
    const targetIndex = Math.max(0, Math.min(providers.length - 1, currentIndex + offset))
    if (targetIndex < 0 || targetIndex >= providers.length) return
    if (targetIndex === currentIndex) return
    const ordered = [...providers]
    const [item] = ordered.splice(currentIndex, 1)
    ordered.splice(targetIndex, 0, item)
    reorderProviders(ordered.map((provider) => provider.id))
    setSortMode('manual')
  }

  function renderProviderItem({ item: provider, index }: { item: AIProvider; index: number }) {
    const providerIndex = providerOrderById.get(provider.id) ?? index
    return (
      <ProviderListRow
        provider={provider}
        usageSnapshot={providerUsageSnapshots.get(provider.id)}
        position={providerIndex + 1}
        featured={colors.ui.family === 'lime-road' && provider.id === featuredProviderId}
        selected={selectedIds.has(provider.id)}
        batchMode={batchMode}
        expanded={expandedProviderId === provider.id}
        grouped
        onToggleSelected={() => toggleSelection(provider.id)}
        onExpandedChange={(next) => setExpandedProviderId(next ? provider.id : null)}
      />
    )
  }

  const ProviderSettingsExperience = colors.ui.family === 'lime-road'
    ? LimeRoadProviderSettingsExperience
    : colors.ui.family === 'markdown'
      ? MarkdownProviderSettingsExperience
      : MinimalProviderSettingsExperience
  const providerAttention = providerAttentionItems.length ? <SettingsSummaryStrip items={providerAttentionItems} /> : undefined
  const providerActivation = activationJob
    ? <ActivationProgressCard job={activationJob} onDismiss={clearActivationJob} />
    : undefined
  const providerTools = providers.length > 3 || listToolsActive || providers.length > 1 || batchActionsActive ? (
    <View style={{ gap: 8 }}>
      {providers.length > 3 || listToolsActive ? (
        <>
          <ProviderToolbarDisclosureRow
            title={t('providerSettings.listTools')}
            detail={listToolsActive ? t('providerSettings.listToolsActive', { label: activeSortLabel, count: visibleProviderItems.length }) : t('providerSettings.listToolsCollapsedDetail', { label: activeSortLabel, count: visibleProviderItems.length })}
            icon={<AppIcon name="filter" color={colors.textTertiary} size={15} />}
            open={listToolsExpanded}
            onPress={() => setListToolsOpen((value) => !value)}
          />
          {listToolsExpanded ? (
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: veryCompactWidth ? 'column' : 'row', alignItems: veryCompactWidth ? 'stretch' : 'center', gap: 8 }}>
                <View style={{ minHeight: ISLE_MIN_TOUCH_TARGET, flex: 1, minWidth: 0, borderRadius: Math.min(colors.ui.radius.controlLarge, 8), paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.ui.input.background, borderWidth: subtleBorderWidth, borderColor: colors.ui.input.border }}>
                  <AppIcon name="search" color={colors.textTertiary} size={16} />
                  <TextInput
                    value={modelFilter}
                    onChangeText={setModelFilter}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder={t('providerSettings.filterModels')}
                    placeholderTextColor={colors.textTertiary}
                    style={{ flex: 1, minWidth: 0, minHeight: ISLE_MIN_TOUCH_TARGET, padding: 0, color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: '800', includeFontPadding: false, textAlignVertical: 'center' }}
                  />
                  {modelFilter ? (
                    <IslePressable haptic accessibilityLabel={t('common.clearSearch')} onPress={() => setModelFilter('')} style={{ width: ISLE_MIN_TOUCH_TARGET, height: ISLE_MIN_TOUCH_TARGET, borderRadius: Math.min(colors.ui.radius.controlSmall, 8), alignItems: 'center', justifyContent: 'center', backgroundColor: mutedSurface, borderWidth: subtleBorderWidth, borderColor: chromeBorder }}>
                      <AppIcon name="close" color={colors.textSecondary} size={15} />
                    </IslePressable>
                  ) : null}
                </View>
                {!manualOrdering ? (
                  <IslePressable haptic accessibilityLabel={t('providerSettings.switchToManualSort')} onPress={() => setSortMode('manual')} style={{ minHeight: ISLE_MIN_TOUCH_TARGET, borderRadius: Math.min(colors.ui.radius.controlMiddle, 8), paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: raisedSurface, borderWidth: subtleBorderWidth, borderColor: chromeBorder }}>
                    <AppIcon name="grab" color={colors.textSecondary} size={14} />
                    <Text style={{ color: colors.textSecondary, fontSize: 11.5, fontWeight: '800' }}>{t('providerSettings.sort.manual')}</Text>
                  </IslePressable>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {SORT_OPTIONS.map((option) => (
                  <ChoiceIsleChip
                    key={option.id}
                    label={t(option.labelKey)}
                    active={sortMode === option.id}
                    onPress={() => {
                      setSortMode(option.id)
                      dialog.toast({ title: t('providerSettings.sortChanged', { label: t(option.labelKey) }), tone: 'mint' })
                    }}
                  />
                ))}
              </View>
            </View>
          ) : null}
        </>
      ) : null}

      {providers.length > 1 || batchActionsActive ? (
        <>
          <ProviderToolbarDisclosureRow
            title={t('providerSettings.batchActions')}
            detail={batchMode ? t('providerSettings.batchActionsSelectionDetail', { selected: selectedIds.size, total: providers.length }) : t('providerSettings.batchActionsCollapsedDetail', { total: providers.length })}
            icon={<AppIcon name="list-check" color={batchMode ? colors.ui.tone.warning.foreground : colors.textTertiary} size={15} />}
            open={batchActionsExpanded}
            tone={batchMode ? 'amber' : undefined}
            onPress={() => setBatchActionsOpen((value) => !value)}
          />
          {batchActionsExpanded ? (
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <IsleButton
                label={batchMode ? t('providerSettings.enableSelected', { count: selectedIds.size }) : t('settings.enableAll')}
                compact
                block
                tone="mint"
                icon={<AppIcon name="zap" color={colors.textSecondary} size={15} />}
                onPress={() => void enableEffectiveSelection()}
                disabled={activationBusy || activationJob?.status === 'running' || (batchMode ? !selectedIds.size : !providers.length)}
                style={providerActionButtonStyle}
              />
              <IsleButton
                label={batchMode ? t('providerSettings.exitBatch') : t('providerSettings.selectionMode')}
                compact
                block
                accessibilityLabel={batchMode ? t('providerSettings.exitSelectionMode') : t('providerSettings.enterSelectionMode')}
                tone={batchMode ? 'amber' : 'soft'}
                icon={<AppIcon name="list-check" color={batchMode ? colors.ui.tone.warning.foreground : colors.textSecondary} size={15} />}
                onPress={() => {
                  setBatchMode((value) => !value)
                  setSelectedIds(new Set())
                  dialog.toast({ title: batchMode ? t('providerSettings.batchExited') : t('providerSettings.batchEntered'), tone: 'mint' })
                }}
                style={providerActionButtonStyle}
              />
              <IsleButton
                label={t('providerSettings.clearInvalid')}
                accessibilityLabel={t('providerSettings.clearInvalid')}
                compact
                block
                tone="amber"
                icon={<AppIcon name="warning" color={colors.textSecondary} size={15} />}
                onPress={() => void confirmClearInvalidProviders()}
                disabled={!providers.length}
                style={providerActionButtonStyle}
              />
              {providers.length ? (
                <IsleButton
                  label={t('providerSettings.clearAll')}
                  compact
                  block
                  tone="danger"
                  icon={<AppIcon name="delete" color={colors.ui.control.dangerForeground} size={15} />}
                  onPress={() => void confirmClearAllProviders()}
                  style={providerActionButtonStyle}
                />
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  ) : undefined

  const providerRegistry = providerCardGroups.length ? (
    <View accessibilityRole="list" style={{ width: '100%', maxWidth: PROVIDER_CARD_DETAIL_MAX_WIDTH, alignSelf: 'center', gap: 12 }}>
      {providerCardGroups.map((group) => {
        const groupFeatured = group.providers.some((provider) => provider.id === featuredProviderId)
        const groupEnabledCount = group.providers.filter((provider) => provider.enabled).length
        const groupLabel = group.id.startsWith('preset:')
          ? getProviderPreset(group.id.slice('preset:'.length) as ProviderPresetId).name
          : group.label
        const groupUsageSnapshot = providerUsageSnapshotForGroup(group.providers, providerUsageSnapshots)
        const groupUsageSummary = providerUsageSummary(groupUsageSnapshot, t)
        const groupExpanded = expandedSupplierId === group.id
        const disclosure = resolveProviderSupplierDisclosure(group.providers.length, groupExpanded, batchMode)
        const singleProvider = group.providers[0]
        const groupStateSummary = `${t('settings.enabled')} ${groupEnabledCount}/${group.providers.length}`
        const groupDeleting = deletingSupplierId === group.id
        return (
          <View
            key={group.id}
            role="listitem"
            testID={`provider-supplier-group-${group.id}`}
            style={{
              width: '100%',
              overflow: 'hidden',
              borderRadius: colors.ui.family === 'markdown' ? 0 : Math.min(colors.ui.radius.card, 8),
              backgroundColor: colors.ui.family === 'minimal' ? 'transparent' : raisedSurface,
              borderWidth: colors.ui.family === 'minimal' ? StyleSheet.hairlineWidth : 1,
              borderColor: groupFeatured ? colors.ui.control.primaryBorder : colors.ui.family === 'lime-road' ? colors.material.stroke : colors.ui.section.divider,
            }}
          >
            <IslePressable
              haptic
              focusable
              testID={`provider-supplier-toggle-${group.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${groupLabel}. ${groupStateSummary}`}
              accessibilityHint={!batchMode ? t('providerSettings.longPressDeleteHint') : undefined}
              accessibilityState={{ ...(disclosure.expandable ? { expanded: groupExpanded } : {}), disabled: groupDeleting }}
              accessibilityActions={!batchMode ? [{ name: 'delete', label: t('providerSettings.deleteSupplierAction') }] : undefined}
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === 'delete' && !batchMode && !groupDeleting) {
                  void confirmRemoveSupplierGroup(group)
                }
              }}
              delayLongPress={520}
              onLongPress={() => {
                if (batchMode || groupDeleting) return
                suppressedSupplierPress.current = group.id
                setTimeout(() => {
                  if (suppressedSupplierPress.current === group.id) suppressedSupplierPress.current = null
                }, 800)
                void confirmRemoveSupplierGroup(group)
              }}
              onPress={() => {
                if (suppressedSupplierPress.current === group.id) {
                  suppressedSupplierPress.current = null
                  return
                }
                if (groupDeleting) return
                if (disclosure.expandable) {
                  setExpandedSupplierId((current) => current === group.id ? null : group.id)
                  return
                }
                if (singleProvider) setExpandedProviderId(singleProvider.id)
              }}
              style={{ minHeight: 64, paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.ui.semantic.surface.muted }}
            >
              <View style={{ width: 30, height: 30, borderRadius: Math.min(colors.ui.radius.controlSmall, 8), alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.icon.accentBackground }}>
                <AppIcon name="provider-key" color={colors.ui.icon.accentForeground} size={15} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '900' }}>{groupLabel}</Text>
                <Text numberOfLines={1} style={{ marginTop: 1, color: colors.textTertiary, fontSize: 10, lineHeight: 14, fontWeight: '700' }}>{groupStateSummary}</Text>
                {groupUsageSummary ? <Text testID={`provider-usage-group-${group.id}`} numberOfLines={1} style={{ marginTop: 1, color: groupUsageSnapshot?.status === 'ready' ? colors.ui.tone.success.foreground : colors.textTertiary, fontSize: 10, lineHeight: 14, fontWeight: '700' }}>{groupUsageSummary}</Text> : null}
              </View>
              {groupDeleting ? (
                <View accessibilityLabel={t('providerSettings.deleteSupplierStarted')} style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
                  <HighFrameSpinner color={colors.textTertiary} size={16} />
                </View>
              ) : disclosure.expandable ? (
                <View style={{ minWidth: 30, height: 30, borderRadius: Math.min(colors.ui.radius.controlSmall, 8), paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: raisedSurface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.ui.section.divider }}>
                  <Text style={{ color: colors.textSecondary, fontSize: 10, lineHeight: 14, fontWeight: '900' }}>{group.providers.length}</Text>
                  <AppIcon name="collapse" color={colors.textTertiary} size={14} style={{ transform: [{ rotate: groupExpanded ? '180deg' : '0deg' }] }} />
                </View>
              ) : (
                <AppIcon name="back-next" color={colors.textTertiary} size={14} />
              )}
            </IslePressable>
            {disclosure.showConfigurations ? (
              <View accessibilityRole="list" testID={`provider-supplier-configurations-${group.id}`} style={{ borderTopWidth: colors.ui.family === 'lime-road' ? 1 : StyleSheet.hairlineWidth, borderTopColor: colors.ui.family === 'lime-road' ? colors.material.stroke : colors.ui.section.divider }}>
                {group.providers.map((provider, index) => (
                  <View key={provider.id} role="listitem" style={{ borderBottomWidth: index === group.providers.length - 1 ? 0 : StyleSheet.hairlineWidth, borderBottomColor: colors.ui.section.divider }}>
                    {renderProviderItem({ item: provider, index: providerOrderById.get(provider.id) ?? 0 })}
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        )
      })}
    </View>
  ) : colors.ui.family === 'markdown' ? (
    <View testID="provider-empty-markdown" style={{ minHeight: 84, paddingHorizontal: 12, paddingVertical: 10, borderLeftWidth: 3, borderLeftColor: colors.ui.section.divider, backgroundColor: colors.ui.semantic.surface.muted }}>
      <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 18, fontWeight: '800' }}>{providers.length ? t('providerSettings.noMatches') : t('providerSettings.noProviders')}</Text>
      {!providers.length ? <Text style={{ marginTop: 3, color: colors.textTertiary, fontSize: 11, lineHeight: 16, fontWeight: '600' }}>{t('providerSettings.noProvidersDetail')}</Text> : null}
    </View>
  ) : colors.ui.family === 'lime-road' ? (
    <View testID="provider-empty-lime-road" style={{ minHeight: 96, borderRadius: Math.min(colors.ui.radius.card, 8), paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.ui.semantic.surface.muted, borderWidth: 1, borderColor: colors.material.stroke }}>
      <View style={{ width: 34, alignItems: 'center' }}>
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: colors.ui.control.primaryBackground, borderWidth: 3, borderColor: colors.ui.semantic.surface.base }} />
        <View style={{ width: 2, height: 30, backgroundColor: colors.material.stroke }} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '900' }}>{providers.length ? t('providerSettings.noMatches') : t('providerSettings.noProviders')}</Text>
      {!providers.length ? <Text style={{ marginTop: 3, color: colors.textSecondary, fontSize: 11, lineHeight: 16, fontWeight: '600' }}>{t('providerSettings.noProvidersDetail')}</Text> : null}
      </View>
    </View>
  ) : (
    <View testID="provider-empty-minimal" style={{ minHeight: providers.length ? 54 : 76, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.section.divider }}>
      <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '700' }}>{providers.length ? t('providerSettings.noMatches') : t('providerSettings.noProviders')}</Text>
      {!providers.length ? <Text style={{ marginTop: 3, color: colors.textTertiary, fontSize: 11, lineHeight: 16, fontWeight: '500' }}>{t('providerSettings.noProvidersDetail')}</Text> : null}
    </View>
  )

  const content = (
    <>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0} style={{ flex: 1 }}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{ paddingHorizontal: pagePadding, paddingTop: embedded ? Math.max(insets.top, 0) + 8 : 8, paddingBottom: Math.max(insets.bottom, 20) + 76 }}
        >
          <ProviderSettingsExperience
            title={t('settings.providerManagement')}
            subtitle={providerListHint}
            backLabel={t('common.back')}
            addLabel={t('settings.addProvider')}
            importLabel={t('providerSettings.batchImportProviders')}
            enabledSummary={`${t('settings.enabled')} ${enabled}/${providers.length}`}
            visibleSummary={t('providerSettings.providerCount', { count: providerCardGroups.length })}
            enabledCount={enabled}
            totalCount={providers.length}
            visibleCount={providerCardGroups.length}
            compact={compactWidth}
            onBack={onClose ?? closeStandaloneProviderSettings}
            onAdd={() => setAddOpen(true)}
            onImport={() => setImportOpen(true)}
            attention={providerAttention}
            activation={providerActivation}
            tools={providerTools}
          >
            {providerRegistry}
          </ProviderSettingsExperience>
        </ScrollView>
      </KeyboardAvoidingView>
      <ProviderFormModal
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={(provider) => void addProviderFromForm(provider)}
      />
      <ProviderImportModal
        visible={importOpen}
        importProgress={importProgress}
        onClose={() => {
          if (importProgress) return
          setImportOpen(false)
        }}
        onSubmit={importProvidersFromText}
      />
      <ProviderConfigurationSheet
        visible={Boolean(selectedProvider)}
        provider={selectedProvider}
        runtimeDetail={selectedProvider ? runtimeDetailByProviderId.get(selectedProvider.id) : undefined}
        deferMount={providers.length > PROVIDER_DETAILS_DEFER_PROVIDER_LIMIT}
        sortControl={selectedProvider && manualOrdering && showManualSortControls && providers.length > 1 ? (
          <DragRail
            providerName={resolveProviderDisplayName(selectedProvider, t('providerSettings.customProvider'))}
            position={(providerOrderById.get(selectedProvider.id) ?? 0) + 1}
            total={providers.length}
            disabled={false}
            disabledUp={(providerOrderById.get(selectedProvider.id) ?? 0) <= 0}
            disabledDown={(providerOrderById.get(selectedProvider.id) ?? 0) >= providers.length - 1}
            onMove={(offset) => moveProvider(selectedProvider.id, offset)}
          />
        ) : undefined}
        onClose={() => setExpandedProviderId(null)}
      />
    </>
  )

  if (embedded) return <View style={{ flex: 1 }}>{content}</View>
  return content
}

export default ProviderSettingsContent

function ProviderConfigurationSheet({
  visible,
  provider,
  runtimeDetail,
  deferMount,
  sortControl,
  onClose,
}: {
  visible: boolean
  provider?: AIProvider
  runtimeDetail?: RuntimeDiagnosticsProviderDetail
  deferMount: boolean
  sortControl?: ReactNode
  onClose: () => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const [usageEditorDirty, setUsageEditorDirty] = useState(false)
  const { handleRequestClose } = useKeyboardAwareModalRequestClose(() => {
    void requestSheetClose()
  })
  const sheetHeight = Math.max(360, Math.min(Math.round(height * 0.9), height - Math.max(insets.top, 12) - 8))
  const providerName = provider ? resolveProviderDisplayName(provider, t('providerSettings.customProvider')) : ''

  useEffect(() => {
    setUsageEditorDirty(false)
  }, [provider?.id, visible])

  async function requestSheetClose() {
    if (!usageEditorDirty) {
      onClose()
      return
    }
    const discard = await dialog.confirm({
      title: t('providerSettings.usageQueryDiscardTitle'),
      message: t('providerSettings.usageQueryDiscardMessage'),
      confirmLabel: t('providerSettings.usageQueryDiscardConfirm'),
      cancelLabel: t('common.cancel'),
      tone: 'amber',
    })
    if (discard) onClose()
  }

  return (
    <Modal transparent visible={visible && Boolean(provider)} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={handleRequestClose}>
      <View accessibilityViewIsModal style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable accessible={false} accessibilityRole="none" onPress={() => void requestSheetClose()} style={[StyleSheet.absoluteFill, { backgroundColor: colors.backdrop }]} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{ height: sheetHeight, overflow: 'hidden', borderTopLeftRadius: 8, borderTopRightRadius: 8, backgroundColor: colors.material.sheet.surface, borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth, borderBottomWidth: 0, borderColor: colors.material.sheet.border }}>
            <View style={{ alignItems: 'center', paddingTop: 6 }}>
              <View style={{ width: 34, height: 3, borderRadius: 2, backgroundColor: colors.textTertiary, opacity: 0.34 }} />
            </View>
            <View style={{ minHeight: 50, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.material.sheet.border }}>
              <View style={{ width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.icon.accentBackground }}>
                <AppIcon name="provider-key" color={colors.ui.icon.accentForeground} size={16} />
              </View>
              <Text numberOfLines={1} ellipsizeMode="tail" style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '800', includeFontPadding: false }}>
                {providerName}
              </Text>
              <IslePressable haptic accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={() => void requestSheetClose()} style={{ width: ISLE_MIN_TOUCH_TARGET, height: ISLE_MIN_TOUCH_TARGET, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
                <AppIcon name="close" color={colors.textSecondary} size={17} />
              </IslePressable>
            </View>
            <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={{ width: '100%', maxWidth: PROVIDER_CARD_DETAIL_MAX_WIDTH, alignSelf: 'center', paddingHorizontal: 12, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 18) + 20 }}>
              {sortControl ? <View style={{ marginBottom: 10 }}>{sortControl}</View> : null}
              {provider ? (
                <>
                  <DeferredProviderDetails
                    provider={provider}
                    runtimeDetail={runtimeDetail}
                    expanded
                    onExpandedChange={(next) => {
                      if (!next) void requestSheetClose()
                    }}
                    deferMount={deferMount}
                  />
                  <ProviderUsageQueryEditor provider={provider} onDirtyChange={setUsageEditorDirty} />
                </>
              ) : null}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

function ProviderToolbarDisclosureRow({ title, detail, icon, open, tone, onPress }: { title: string; detail: string; icon: ReactNode; open: boolean; tone?: 'amber'; onPress: () => void }) {
  const { colors } = useAppTheme()
  const borderColor = tone === 'amber' ? colors.ui.tone.warning.border : colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  const backgroundColor = tone === 'amber' ? colors.ui.tone.warning.background : colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted
  const textColor = tone === 'amber' ? colors.ui.tone.warning.foreground : colors.textSecondary
  return (
    <IslePressable
      haptic
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      style={{ minHeight: 44, borderRadius: Math.min(colors.ui.radius.controlLarge, 8), paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor, borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth, borderColor }}
    >
      {icon}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: textColor, fontSize: 12.5, lineHeight: 16, fontWeight: '800' }}>{title}</Text>
        <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, marginTop: 1, fontWeight: '700' }}>{detail}</Text>
      </View>
      <MotiView animate={{ rotate: open ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 160 }}>
        <AppIcon name="collapse" color={colors.textTertiary} size={16} />
      </MotiView>
    </IslePressable>
  )
}

function formatClearInvalidProviderList(providers: AIProvider[], t: ReturnType<typeof useTranslation>['t']): string {
  const visibleProviders = providers.slice(0, CLEAR_INVALID_PROVIDER_LIST_LIMIT)
  const lines = visibleProviders.map((provider) => {
    const name = resolveProviderDisplayName(provider, t('providerSettings.customProvider'))
    const baseUrl = provider.baseUrl?.trim()
    return baseUrl ? `- ${name} (${baseUrl})` : `- ${name}`
  })
  const hiddenCount = providers.length - visibleProviders.length
  if (hiddenCount > 0) {
    lines.push(`- ${t('providerSettings.clearInvalidMore', { count: hiddenCount })}`)
  }
  return lines.join('\n')
}

function closeStandaloneProviderSettings() {
  if (router.canGoBack()) {
    router.back()
    return
  }
  router.replace('/settings')
}

async function yieldToNextPaint(): Promise<void> {
  if (AppState.currentState !== 'active') return
  await new Promise<void>((resolve) => {
    let settled = false
    let frame: number | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let appStateSubscription: { remove: () => void } | null = null
    const settle = () => {
      if (settled) return
      settled = true
      if (frame != null) cancelAnimationFrame(frame)
      if (timer) clearTimeout(timer)
      appStateSubscription?.remove()
      resolve()
    }
    appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') settle()
    })
    frame = requestAnimationFrame(settle)
    timer = setTimeout(settle, 32)
  })
}

function publishProviderImportStatusNotification(progress: ProviderImportProgress, t: ReturnType<typeof useTranslation>['t']) {
  const determinate = progress.total > 0
  const progressValue = determinate ? Math.min(1, Math.max(0, progress.completed / progress.total)) : 0
  const stage = t(`providerSettings.importProgress.${progress.stage}`)
  const detail = progress.stage === 'saving'
    ? t('providerSettings.importProgressSavingDetail', { completed: progress.completed, total: progress.total })
    : t('providerSettings.importProgressIndeterminate')
  const current = progress.currentProviderName
    ? t('providerSettings.importProgressCurrent', { name: progress.currentProviderName })
    : ''

  return updateAndroidStatusNotification({
    state: 'running',
    title: t('settings.batchImport'),
    message: [stage, detail, current].filter(Boolean).join('\n'),
    shortText: determinate ? `${progress.completed}/${progress.total}` : stage,
    deepLink: 'islemind://settings/providers',
    progress: progressValue,
    indeterminate: !determinate,
    ongoing: true,
    requestPromotedOngoing: true,
    foregroundService: true,
  })
}

function publishProviderImportCompletedNotification(count: number, t: ReturnType<typeof useTranslation>['t']) {
  void updateAndroidStatusNotification({
    state: 'completed',
    title: t('providerSettings.importDone'),
    message: t('providerSettings.importDoneMessage', { count }),
    shortText: t('providerSettings.importDone'),
    deepLink: 'islemind://settings/providers',
    progress: 1,
    indeterminate: false,
    ongoing: false,
    requestPromotedOngoing: false,
    foregroundService: true,
  })
}

function publishProviderImportFailedNotification(message: string, t: ReturnType<typeof useTranslation>['t']) {
  void updateAndroidStatusNotification({
    state: 'error',
    title: t('providerSettings.importFailed'),
    message,
    shortText: t('providerSettings.importFailed'),
    deepLink: 'islemind://settings/providers',
    indeterminate: false,
    ongoing: false,
    requestPromotedOngoing: false,
    foregroundService: true,
  })
}

function publishProviderDeleteNotification(
  state: 'running' | 'completed' | 'error',
  providerName: string,
  completed: number,
  total: number,
  t: ReturnType<typeof useTranslation>['t'],
) {
  const progress = total > 0 ? Math.min(1, Math.max(0, completed / total)) : 0
  const message = state === 'running'
    ? t('providerSettings.deleteSupplierProgress', { completed, total })
    : state === 'completed'
      ? t('providerSettings.deleteSupplierDoneMessage', { name: providerName, count: total })
      : completed > 0
        ? t('providerSettings.deleteSupplierPartialMessage', { completed, total })
        : t('providerSettings.deleteSupplierFailedMessage')
  return updateAndroidStatusNotification({
    state,
    title: state === 'running' ? t('providerSettings.deleteSupplierStarted') : state === 'completed' ? t('providerSettings.deleteSupplierDone') : t('providerSettings.deleteSupplierFailed'),
    message,
    shortText: state === 'running' ? `${completed}/${total}` : providerName,
    deepLink: 'islemind://settings/providers',
    progress,
    indeterminate: false,
    ongoing: state === 'running',
    requestPromotedOngoing: state === 'running',
    foregroundService: true,
  })
}

function useKeyboardAwareModalRequestClose(onClose: () => void) {
  const keyboardActiveRef = useRef(false)

  useEffect(() => {
    const showSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => {
      keyboardActiveRef.current = true
    })
    const hideSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      keyboardActiveRef.current = false
    })
    return () => {
      showSub.remove()
      hideSub.remove()
    }
  }, [])

  function markKeyboardActive() {
    keyboardActiveRef.current = true
  }

  function handleRequestClose() {
    if (Platform.OS === 'android' && keyboardActiveRef.current) {
      Keyboard.dismiss()
      keyboardActiveRef.current = false
      return
    }
    onClose()
  }

  return { handleRequestClose, markKeyboardActive }
}

type VisualViewportLike = {
  height?: number
  offsetTop?: number
  addEventListener?: (type: 'resize' | 'scroll', listener: () => void) => void
  removeEventListener?: (type: 'resize' | 'scroll', listener: () => void) => void
}

type WindowWithVisualViewport = {
  innerHeight?: number
  visualViewport?: VisualViewportLike
  addEventListener?: (type: 'resize', listener: () => void) => void
  removeEventListener?: (type: 'resize', listener: () => void) => void
}

function runtimeWindow(): WindowWithVisualViewport | undefined {
  return (globalThis as { window?: WindowWithVisualViewport }).window
}

type KeyboardFrameSnapshot = {
  height: number
  screenY?: number
}

function keyboardFrameSnapshotFromEvent(event: KeyboardEvent): KeyboardFrameSnapshot {
  return {
    height: event.endCoordinates.height,
    screenY: event.endCoordinates.screenY,
  }
}

function resolveKeyboardInsetFromFrame(frame: KeyboardFrameSnapshot | null, windowHeight: number): number {
  if (!frame) return 0
  if (Platform.OS !== 'android') return frame.height
  const screenY = frame.screenY
  const frameHeight = Math.round(Math.max(0, frame.height))
  if (typeof screenY === 'number' && Number.isFinite(screenY) && screenY > 0) {
    return Math.max(frameHeight, Math.round(Math.max(0, windowHeight - screenY)))
  }
  return frameHeight
}

function resolveModalKeyboardInset(rawInset: number): number {
  if (rawInset <= 0) return 0
  return Platform.OS === 'android' ? rawInset + PROVIDER_MODAL_KEYBOARD_TOOLBAR_OVERLAP : rawInset
}

function useWebVisualKeyboardInset(active: boolean): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    if (!active || Platform.OS !== 'web') {
      setInset(0)
      return undefined
    }
    const win = runtimeWindow()
    const viewport = win?.visualViewport
    const update = () => {
      const innerHeight = win?.innerHeight ?? viewport?.height ?? 0
      const viewportHeight = viewport?.height ?? innerHeight
      const offsetTop = Math.max(0, viewport?.offsetTop ?? 0)
      setInset(Math.round(Math.max(0, innerHeight - viewportHeight - offsetTop)))
    }
    update()
    viewport?.addEventListener?.('resize', update)
    viewport?.addEventListener?.('scroll', update)
    win?.addEventListener?.('resize', update)
    return () => {
      viewport?.removeEventListener?.('resize', update)
      viewport?.removeEventListener?.('scroll', update)
      win?.removeEventListener?.('resize', update)
    }
  }, [active])

  return inset
}

function ProviderListRow({
  provider,
  usageSnapshot,
  position,
  featured,
  selected,
  batchMode,
  expanded,
  grouped = false,
  onToggleSelected,
  onExpandedChange,
}: {
  provider: AIProvider
  usageSnapshot?: ProviderUsageSnapshot
  position: number
  featured: boolean
  selected: boolean
  batchMode: boolean
  expanded: boolean
  grouped?: boolean
  onToggleSelected: () => void
  onExpandedChange: (next: boolean) => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const providerDisplayName = resolveProviderDisplayName(provider, t('providerSettings.customProvider'))
  const { subtleBorderWidth, mutedSurface, raisedSurface } = resolveProviderChrome(colors)
  const providerUrl = provider.baseUrl?.trim() || t('providerSettings.baseUrl')
  const providerStateLabel = provider.enabled ? t('settings.enabled') : t('settings.disabled')
  const usageSummary = providerUsageSummary(usageSnapshot, t)
  const selectionControl = batchMode ? (
    <IslePressable
      haptic
      focusable
      onPress={onToggleSelected}
      accessibilityRole="checkbox"
      accessibilityLabel={selected ? t('providerSettings.unselectProvider') : t('providerSettings.selectProvider')}
      accessibilityState={{ checked: selected }}
      style={{ position: 'absolute', top: colors.ui.family === 'lime-road' ? 4 : 10, right: 4, width: 44, height: 44, borderRadius: colors.ui.family === 'markdown' ? 0 : 8, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? colors.ui.control.primaryBackground : colors.ui.semantic.surface.base, borderWidth: subtleBorderWidth, borderColor: selected ? colors.ui.control.primaryBorder : colors.ui.semantic.chrome.border }}
    >
      {selected ? <AppIcon name="check" color={colors.ui.control.primaryForeground} size={17} /> : <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.textTertiary }} />}
    </IslePressable>
  ) : null

  if (grouped) {
    return (
      <View style={{ minHeight: 68, backgroundColor: selected || expanded ? colors.ui.semantic.surface.muted : 'transparent' }}>
        <IslePressable
          haptic
          focusable
          onPress={() => onExpandedChange(!expanded)}
          accessibilityRole="button"
          accessibilityLabel={`${providerDisplayName}. ${providerStateLabel}. ${providerUrl}`}
          accessibilityState={{ expanded }}
          style={{ minHeight: 68, paddingHorizontal: 12, paddingRight: batchMode ? 54 : 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}
        >
          <Text style={{ width: 23, color: colors.textTertiary, fontSize: 9.5, lineHeight: 13, fontWeight: '800' }}>{String(position).padStart(2, '0')}</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '800', includeFontPadding: false }}>{providerDisplayName}</Text>
            <Text numberOfLines={1} ellipsizeMode="tail" style={{ marginTop: 2, color: colors.textTertiary, fontSize: 10, lineHeight: 14, fontWeight: '600', includeFontPadding: false }}>{providerUrl}</Text>
            {usageSummary ? <Text testID={`provider-usage-${provider.id}`} numberOfLines={1} ellipsizeMode="tail" style={{ marginTop: 1, color: usageSnapshot?.status === 'ready' ? colors.ui.tone.success.foreground : colors.textTertiary, fontSize: 10, lineHeight: 14, fontWeight: '700', includeFontPadding: false }}>{usageSummary}</Text> : null}
          </View>
          <Text style={{ color: provider.enabled ? colors.ui.tone.success.foreground : colors.textTertiary, fontSize: 9.5, lineHeight: 13, fontWeight: '800' }}>{providerStateLabel}</Text>
          {!batchMode ? <AppIcon name="back-next" color={colors.textTertiary} size={14} /> : null}
        </IslePressable>
        {selectionControl}
      </View>
    )
  }

  if (colors.ui.family === 'minimal') {
    return (
      <View style={{ minHeight: 74, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.section.divider, backgroundColor: selected ? colors.ui.semantic.surface.muted : 'transparent' }}>
        <IslePressable
          haptic
          focusable
          onPress={() => onExpandedChange(!expanded)}
          accessibilityRole="button"
           accessibilityLabel={`${providerDisplayName}. ${providerStateLabel}. ${providerUrl}`}
          accessibilityState={{ expanded }}
          style={{ minHeight: 74, paddingHorizontal: 4, paddingRight: batchMode ? 52 : 8, flexDirection: 'row', alignItems: 'center', gap: 11 }}
        >
          <View style={{ width: 34, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: provider.enabled ? colors.ui.icon.accentBackground : mutedSurface }}>
            <AppIcon name="provider-key" color={provider.enabled ? colors.ui.icon.accentForeground : colors.textSecondary} size={17} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: colors.text, fontSize: 13.5, lineHeight: 18, fontWeight: '800', includeFontPadding: false }}>{providerDisplayName}</Text>
             <Text numberOfLines={1} ellipsizeMode="tail" style={{ marginTop: 2, color: colors.textTertiary, fontSize: 10.5, lineHeight: 14, fontWeight: '600', includeFontPadding: false }}>{providerUrl}</Text>
             {usageSummary ? <Text testID={`provider-usage-${provider.id}`} numberOfLines={1} ellipsizeMode="tail" style={{ marginTop: 1, color: usageSnapshot?.status === 'ready' ? colors.ui.tone.success.foreground : colors.textTertiary, fontSize: 10, lineHeight: 14, fontWeight: '700', includeFontPadding: false }}>{usageSummary}</Text> : null}
          </View>
          {!batchMode ? (
            <AppIcon name="back-next" color={colors.textTertiary} size={14} />
          ) : null}
        </IslePressable>
        {selectionControl}
      </View>
    )
  }

  if (colors.ui.family === 'markdown') {
    return (
      <View style={{ minHeight: 66, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.section.divider, backgroundColor: expanded ? colors.ui.semantic.surface.muted : 'transparent' }}>
        <IslePressable
          haptic
          focusable
          onPress={() => onExpandedChange(!expanded)}
          accessibilityRole="button"
           accessibilityLabel={`${providerDisplayName}. ${providerStateLabel}. ${providerUrl}`}
          accessibilityState={{ expanded }}
          style={{ minHeight: 66, paddingHorizontal: 8, paddingRight: batchMode ? 52 : 8, flexDirection: 'row', alignItems: 'center', gap: 10 }}
        >
          <Text style={{ width: 24, color: colors.textTertiary, fontSize: 10, lineHeight: 14, fontWeight: '700' }}>{String(position).padStart(2, '0')}</Text>
          <View style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}>
            <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: colors.text, fontSize: 12.5, lineHeight: 17, fontWeight: '800', includeFontPadding: false }}>{providerDisplayName}</Text>
            {usageSummary ? <Text testID={`provider-usage-${provider.id}`} numberOfLines={1} ellipsizeMode="tail" style={{ marginTop: 1, color: usageSnapshot?.status === 'ready' ? colors.ui.tone.success.foreground : colors.textTertiary, fontSize: 9.5, lineHeight: 13, fontWeight: '700', includeFontPadding: false }}>{usageSummary}</Text> : null}
          </View>
           {!batchMode ? (
             <Text numberOfLines={1} ellipsizeMode="tail" style={{ maxWidth: 142, color: colors.textTertiary, fontSize: 9.5, lineHeight: 13, fontWeight: '600' }}>{providerUrl}</Text>
          ) : null}
          {!batchMode ? <AppIcon name="back-next" color={colors.textTertiary} size={14} /> : null}
        </IslePressable>
        {selectionControl}
      </View>
    )
  }

  if (featured) {
    return (
      <View style={{ flex: 1, borderRadius: PROVIDER_CARD_RADIUS, backgroundColor: raisedSurface, borderWidth: 1, borderColor: expanded || selected ? colors.ui.control.primaryBorder : colors.material.strokeStrong, overflow: 'hidden' }}>
        <IslePressable
          haptic
          focusable
          onPress={() => onExpandedChange(!expanded)}
          accessibilityRole="button"
           accessibilityLabel={`${providerDisplayName}. ${providerStateLabel}. ${providerUrl}`}
          accessibilityState={{ expanded }}
          style={{ flex: 1, minWidth: 0, paddingHorizontal: 15, paddingVertical: 13, paddingRight: batchMode ? 52 : 15, flexDirection: 'row', alignItems: 'center', gap: 13 }}
        >
          <View style={{ width: 46, height: 46, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.icon.accentBackground }}>
            <AppIcon name="provider-key" color={colors.ui.icon.accentForeground} size={21} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: colors.text, fontSize: 16, lineHeight: 21, fontWeight: '900', includeFontPadding: false }}>
              {providerDisplayName}
            </Text>
            <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: '700', includeFontPadding: false }}>
               {providerUrl}
            </Text>
            {usageSummary ? <Text testID={`provider-usage-${provider.id}`} numberOfLines={1} ellipsizeMode="tail" style={{ color: usageSnapshot?.status === 'ready' ? colors.ui.tone.success.foreground : colors.textTertiary, fontSize: 10, lineHeight: 14, fontWeight: '700', includeFontPadding: false }}>{usageSummary}</Text> : null}
          </View>
          {!batchMode ? (
            <View style={{ alignItems: 'flex-end' }}>
              <AppIcon name="back-next" color={colors.textTertiary} size={15} />
            </View>
          ) : null}
        </IslePressable>
        {selectionControl}
      </View>
    )
  }

  return (
    <View
      style={{
        flex: 1,
        borderRadius: PROVIDER_CARD_RADIUS - 2,
        backgroundColor: raisedSurface,
        borderWidth: subtleBorderWidth,
        borderColor: selected
          ? colors.ui.control.primaryBorder
          : colors.ui.semantic.chrome.border,
        overflow: 'hidden',
      }}
    >
      <IslePressable
        haptic
        focusable
        onPress={() => onExpandedChange(!expanded)}
        accessibilityRole="button"
         accessibilityLabel={`${providerDisplayName}. ${providerStateLabel}. ${providerUrl}`}
        accessibilityState={{ expanded }}
        style={{ flex: 1, minWidth: 0, padding: 14, paddingRight: batchMode ? 52 : 14, justifyContent: 'space-between' }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <View style={{ width: 38, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: provider.enabled ? colors.ui.icon.accentBackground : mutedSurface }}>
            <AppIcon name="provider-key" color={provider.enabled ? colors.ui.icon.accentForeground : colors.textSecondary} size={18} />
          </View>
          <AppIcon name="back-next" color={colors.textTertiary} size={14} />
        </View>
        <Text numberOfLines={2} ellipsizeMode="tail" style={{ color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: '900', includeFontPadding: false }}>
          {providerDisplayName}
        </Text>
        <View style={{ gap: 5 }}>
          <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 10.5, lineHeight: 14, fontWeight: '800', includeFontPadding: false }}>
             {providerUrl}
          </Text>
          {usageSummary ? <Text testID={`provider-usage-${provider.id}`} numberOfLines={1} style={{ color: usageSnapshot?.status === 'ready' ? colors.ui.tone.success.foreground : colors.textTertiary, fontSize: 10, lineHeight: 14, fontWeight: '700', includeFontPadding: false }}>{usageSummary}</Text> : null}
        </View>
      </IslePressable>
      {selectionControl}
    </View>
  )
}

function DeferredProviderDetails({
  provider,
  runtimeDetail,
  expanded,
  onExpandedChange,
  deferMount,
}: {
  provider: AIProvider
  runtimeDetail?: RuntimeDiagnosticsProviderDetail
  expanded: boolean
  onExpandedChange: (next: boolean) => void
  deferMount: boolean
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const [ready, setReady] = useState(!deferMount)

  useEffect(() => {
    if (!expanded) {
      setReady(!deferMount)
      return
    }
    if (!deferMount) {
      setReady(true)
      return
    }

    let cancelled = false
    setReady(false)
    const task = InteractionManager.runAfterInteractions(() => {
      if (!cancelled) setReady(true)
    })
    const fallback = setTimeout(() => {
      if (cancelled) return
      task.cancel?.()
      setReady(true)
    }, PROVIDER_DETAILS_DEFER_FALLBACK_MS)

    return () => {
      cancelled = true
      clearTimeout(fallback)
      task.cancel?.()
    }
  }, [deferMount, expanded, provider.id])

  if (!expanded) return null

  return (
    <View style={{ minWidth: 0, minHeight: PROVIDER_ROW_HEIGHT - 10, marginTop: 3 }}>
      {ready ? (
        <ApiKeyPanel
          provider={provider}
          runtimeDetail={runtimeDetail}
          expanded={expanded}
          onExpandedChange={onExpandedChange}
          hideHeader
          style={{
            marginBottom: 0,
            padding: 0,
            backgroundColor: 'transparent',
            borderWidth: 0,
          }}
        />
      ) : (
        <View
          accessibilityLabel={t('common.loading')}
          style={{
            minHeight: PROVIDER_ROW_HEIGHT - 10,
            borderRadius: Math.min(colors.ui.radius.controlMiddle, 8),
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 8,
          }}
        >
          <HighFrameSpinner color={colors.textTertiary} size={16} />
          <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 14, fontWeight: '800', includeFontPadding: false }}>
            {t('common.loading')}
          </Text>
        </View>
      )}
    </View>
  )
}

function DragRail({
  providerName,
  position,
  total,
  disabled,
  disabledUp,
  disabledDown,
  onMove,
}: {
  providerName: string
  position: number
  total: number
  disabled: boolean
  disabledUp: boolean
  disabledDown: boolean
  onMove: (offset: number) => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const motion = useMotionPreference()
  const { subtleBorderWidth, mutedSurface, raisedSurface } = resolveProviderChrome(colors)
  const translateY = useSharedValue(0)
  const dragging = useSharedValue(0)
  const dragStepCount = useRef(0)
  const active = !disabled && !(disabledUp && disabledDown)
  const gesture = Gesture.Pan()
    .enabled(!disabled && !(disabledUp && disabledDown))
    .activateAfterLongPress(180)
    .onBegin(() => {
      dragStepCount.current = 0
      dragging.value = 1
    })
    .onUpdate((event) => {
      translateY.value = Math.max(-48, Math.min(48, event.translationY))
      const nextStep = event.translationY < 0
        ? Math.ceil((event.translationY + PROVIDER_DRAG_STEP * 0.5) / PROVIDER_DRAG_STEP)
        : Math.floor((event.translationY - PROVIDER_DRAG_STEP * 0.5) / PROVIDER_DRAG_STEP)
      const boundedStep = Math.max(-(position - 1), Math.min(total - position, nextStep))
      while (boundedStep > dragStepCount.current) {
        dragStepCount.current += 1
        runOnJS(onMove)(1)
      }
      while (boundedStep < dragStepCount.current) {
        dragStepCount.current -= 1
        runOnJS(onMove)(-1)
      }
    })
    .onEnd(() => {
      translateY.value = withTiming(0, { duration: 112 })
      dragging.value = withTiming(0, { duration: 112 })
      dragStepCount.current = 0
    })
    .onFinalize(() => {
      translateY.value = withTiming(0, { duration: 112 })
      dragging.value = withTiming(0, { duration: 112 })
      dragStepCount.current = 0
    })
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: active ? 1 : 0.58,
  }))
  const animatedRailStyle = useAnimatedStyle(() => ({
    opacity: dragging.value ? 0.92 : 1,
  }))
  const railBorder = disabled ? colors.ui.semantic.chrome.border : colors.ui.control.primaryBorder
  const railBackground = disabled ? mutedSurface : raisedSurface
  const positionLabel = total ? t('providerSettings.orderPosition', { index: position, total }) : ''
  return (
    <Animated.View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 }, animatedRailStyle]}>
      <MoveButton
        label={t('providerSettings.moveUpProvider', { name: providerName })}
        icon="arrow-up"
        disabled={disabled || disabledUp}
        onPress={() => onMove(-1)}
      />
      <GestureDetector gesture={gesture}>
        <Animated.View
          accessibilityRole="adjustable"
          accessibilityLabel={disabled ? t('providerSettings.dragDisabledLabel', { name: providerName }) : t('providerSettings.dragProviderLabel', { name: providerName })}
          accessibilityHint={disabled ? t('providerSettings.dragDisabledHint') : t('providerSettings.dragProviderHint')}
          accessibilityValue={{ text: positionLabel }}
          style={[{
            minWidth: 94,
            height: 44,
            borderRadius: Math.min(colors.ui.radius.controlLarge, 8),
            paddingHorizontal: 10,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
            backgroundColor: railBackground,
            borderWidth: subtleBorderWidth,
            borderColor: railBorder,
            shadowColor: colors.shadowTint,
            shadowOpacity: 0,
            shadowRadius: 0,
            shadowOffset: { width: 0, height: 0 },
            elevation: 0,
          }, animatedStyle]}
          >
          <MotiView
            animate={{ opacity: active ? 1 : 0.82 }}
            transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
            style={{ width: 28, height: 28, borderRadius: Math.min(colors.ui.radius.controlSmall, 8), alignItems: 'center', justifyContent: 'center', backgroundColor: disabled ? mutedSurface : colors.ui.control.primaryBackground }}
          >
            <AppIcon name="grab" color={disabled ? colors.textTertiary : colors.ui.control.primaryForeground} size={15} />
          </MotiView>
          <Text style={{ color: disabled ? colors.textTertiary : colors.textSecondary, fontSize: 10, lineHeight: 12, fontWeight: '800', includeFontPadding: false }}>
            {position}
          </Text>
        </Animated.View>
      </GestureDetector>
      <MoveButton
        label={t('providerSettings.moveDownProvider', { name: providerName })}
        icon="arrow-down"
        disabled={disabled || disabledDown}
        onPress={() => onMove(1)}
      />
    </Animated.View>
  )
}

function MoveButton({ label, icon, disabled, onPress }: { label: string; icon: 'arrow-up' | 'arrow-down'; disabled: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  const { subtleBorderWidth, mutedSurface, chromeBorder } = resolveProviderChrome(colors)
  return (
    <IslePressable
      haptic
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={{
        width: 44,
        height: 44,
        borderRadius: Math.min(colors.ui.radius.controlMiddle, 8),
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: mutedSurface,
        borderWidth: subtleBorderWidth,
        borderColor: chromeBorder,
        opacity: disabled ? 0.42 : 1,
      }}
    >
      <AppIcon name={icon} color={disabled ? colors.textTertiary : colors.textSecondary} size={16} />
    </IslePressable>
  )
}

function ChoiceIsleChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const { subtleBorderWidth, mutedSurface, chromeBorder } = resolveProviderChrome(colors)
  return (
    <IslePressable haptic accessibilityLabel={label} accessibilityState={{ selected: active }} onPress={onPress} style={{ minHeight: ISLE_MIN_TOUCH_TARGET, borderRadius: Math.min(colors.ui.radius.controlMiddle, 8), alignItems: 'center', justifyContent: 'center' }}>
      <MotiView
        animate={{
          backgroundColor: active ? colors.ui.control.primaryBackground : mutedSurface,
          borderColor: active ? colors.ui.control.primaryBorder : chromeBorder,
        }}
        transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
        style={{ minHeight: 40, borderRadius: Math.min(colors.ui.radius.controlMiddle, 8), paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center', borderWidth: subtleBorderWidth }}
      >
        <Text style={{ color: active ? colors.ui.control.primaryForeground : colors.textSecondary, fontSize: 11.5, lineHeight: 15, fontWeight: '800', includeFontPadding: false }}>{label}</Text>
      </MotiView>
    </IslePressable>
  )
}

function ActivationProgressCard({ job, onDismiss }: { job: ActivationJobState; onDismiss: () => void }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const { subtleBorderWidth, chromeSurface, chromeBorder } = resolveProviderChrome(colors)
  const progress = resolveActivationJobProgress(job)
  const done = job.status !== 'running'
  const providerItems = job.items ?? []
  const showProviderItems = providerItems.length > 1
  const title = done
    ? job.status === 'failed' ? t('providerSettings.activationFailed') : activationDoneTitle(job.total === 1 ? 'single' : 'batch', job.total, t)
    : t('providerSettings.activationRunning')
  return (
    <View style={{ marginTop: 10 }}>
      <View style={{ borderRadius: Math.min(colors.ui.radius.panel, 8), padding: 10, backgroundColor: chromeSurface, borderWidth: subtleBorderWidth, borderColor: chromeBorder, shadowColor: colors.ui.control.shadow, shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: colors.text, fontSize: 14, fontWeight: '800' }}>
              {title}
            </Text>
            <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 2, fontWeight: '800' }}>
              {job.stage ?? job.currentName ?? t('providerSettings.activationQueued')}
            </Text>
          </View>
          {done ? (
            <IsleIconButton label={t('dialog.close')} size="sm" onPress={onDismiss}>
              <AppIcon name="close" color={colors.textSecondary} size={15} />
            </IsleIconButton>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          <ActivationProgressPill label={`${job.completed}/${job.total}`} />
          {!showProviderItems && job.currentName ? <ActivationProgressPill label={job.currentName} /> : null}
          <ActivationProgressPill label={activationStatusLabel(job, t)} tone={job.status === 'failed' ? 'danger' : job.failed ? 'amber' : done ? 'mint' : 'default'} />
        </View>
        {showProviderItems ? <ActivationProviderProgressList items={providerItems} /> : null}
        {done && job.issueGroups?.length ? <ActivationIssueGroupList groups={job.issueGroups} /> : null}
        <IsleProgress percent={progress * 100} size="middle" showInfo={false} fillColor={job.failed ? colors.ui.tone.warning.foreground : colors.ui.control.primaryBackground} />
        <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, fontWeight: '700' }}>
          {t('providerSettings.activationProgressMessage', { completed: job.completed, total: job.total, synced: job.synced, tested: job.tested, failed: job.failed })}
        </Text>
      </View>
    </View>
  )
}

function ActivationIssueGroupList({ groups }: { groups: NonNullable<ActivationJobState['issueGroups']> }) {
  const { colors } = useAppTheme()
  const { subtleBorderWidth } = resolveProviderChrome(colors)
  return (
    <View style={{ gap: 6 }}>
      {groups.map((group) => (
        <View key={`${group.key}-${group.count}`} style={{ borderRadius: Math.min(colors.ui.radius.card, 8), paddingVertical: 7, paddingHorizontal: 9, backgroundColor: colors.ui.tone.warning.background, borderWidth: subtleBorderWidth, borderColor: colors.ui.tone.warning.border }}>
          <Text numberOfLines={2} style={{ color: colors.ui.tone.warning.foreground, fontSize: 11, lineHeight: 15, fontWeight: '800' }}>
            {group.line}
          </Text>
          <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10, lineHeight: 14, marginTop: 2, fontWeight: '800' }}>
            {group.providerNames.join(', ')}{group.hiddenProviderCount ? ` +${group.hiddenProviderCount}` : ''}
          </Text>
        </View>
      ))}
    </View>
  )
}

function ActivationProviderProgressList({ items }: { items: ActivationJobItemState[] }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  return (
    <View style={{ gap: 8 }}>
      {items.map((item) => {
        const progress = activationItemProgress(item.progress)
        const warning = item.status === 'failed' || item.failed
        const ready = item.status === 'done' && item.tested
        return (
          <View key={item.providerId} style={{ gap: 5 }}>
            <View style={{ minHeight: 20, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: '800' }}>{item.providerName}</Text>
              <Text numberOfLines={1} style={{ color: warning ? colors.ui.tone.warning.foreground : ready ? colors.ui.control.link : colors.textSecondary, fontSize: 10, lineHeight: 14, fontWeight: '800' }}>
                {activationItemStatusLabel(item, t)}
              </Text>
            </View>
            <IsleProgress percent={progress * 100} size="small" showInfo={false} durationMs={1} fillColor={warning ? colors.ui.tone.warning.foreground : colors.ui.control.primaryBackground} />
            {item.stage ? (
              <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10, lineHeight: 14, fontWeight: '800' }}>{item.stage}</Text>
            ) : null}
          </View>
        )
      })}
    </View>
  )
}

function ActivationProgressPill({ label, tone = 'default' }: { label: string; tone?: 'default' | 'mint' | 'amber' | 'danger' }) {
  const { colors } = useAppTheme()
  const { subtleBorderWidth } = resolveProviderChrome(colors)
  const toneToken = tone === 'mint'
    ? colors.ui.tone.success
    : tone === 'amber'
      ? colors.ui.tone.warning
      : tone === 'danger'
        ? colors.ui.tone.danger
        : colors.ui.tone.neutral
  return (
    <View style={{ minHeight: 28, borderRadius: colors.ui.radius.chip, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: toneToken.background, borderWidth: subtleBorderWidth, borderColor: toneToken.border }}>
      <Text numberOfLines={1} style={{ color: toneToken.foreground, fontSize: 11, fontWeight: '800' }}>{label}</Text>
    </View>
  )
}

function ProviderImportProgressCard({ progress }: { progress: ProviderImportProgress }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const { subtleBorderWidth, chromeSurface, chromeBorder } = resolveProviderChrome(colors)
  const determinate = progress.total > 0
  const progressValue = determinate ? Math.min(1, Math.max(0, progress.completed / progress.total)) : 0
  const detail = progress.stage === 'saving'
    ? t('providerSettings.importProgressSavingDetail', { completed: progress.completed, total: progress.total })
    : t('providerSettings.importProgressIndeterminate')

  return (
    <View style={{ marginBottom: 10 }}>
      <View style={{ borderRadius: Math.min(colors.ui.radius.panel, 8), padding: 10, backgroundColor: chromeSurface, borderWidth: subtleBorderWidth, borderColor: chromeBorder, gap: 9 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <HighFrameSpinner color={colors.ui.icon.accentForeground} size={16} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: colors.text, fontSize: 13, lineHeight: 17, fontWeight: '800' }}>
              {t(`providerSettings.importProgress.${progress.stage}`)}
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 15, marginTop: 2, fontWeight: '800' }}>
              {detail}
            </Text>
          </View>
        </View>
        <IsleProgress percent={progressValue * 100} size="small" showInfo={false} indeterminate={!determinate} />
        {progress.currentProviderName ? (
          <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10.5, lineHeight: 14, fontWeight: '800' }}>
            {t('providerSettings.importProgressCurrent', { name: progress.currentProviderName })}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

function activationDoneTitle(mode: 'single' | 'batch' | 'all', total: number, t: ReturnType<typeof useTranslation>['t']): string {
  if (mode === 'single' || total === 1) return t('providerSettings.activationSingleDone')
  if (mode === 'all') return t('providerSettings.activationAllDone')
  return t('providerSettings.activationBatchDone')
}

function activationItemStatusLabel(item: ActivationJobItemState, t: ReturnType<typeof useTranslation>['t']): string {
  if (item.status === 'queued') return t('providerSettings.activationQueued')
  if (item.status === 'running') return t('providerSettings.activationRunning')
  if (item.status === 'failed' || item.failed) return t('providerSettings.activationNeedsCheck')
  if (item.tested) return t('providerSettings.activationSuccess')
  return t('providerSettings.activationPartial')
}

function activationStatusLabel(job: ActivationJobState, t: ReturnType<typeof useTranslation>['t']): string {
  if (job.status === 'running') return t('providerSettings.activationRunning')
  if (job.status === 'failed') return t('providerSettings.activationFailed')
  if (job.failed > 0) return t('providerSettings.activationPartial')
  return t('providerSettings.activationSuccess')
}

function isPresetDefaultBaseUrl(value: string, presetId: ProviderPresetId, wireProtocol: ProviderWireProtocol): boolean {
  const current = normalizeDraftBaseUrl(value)
  if (!current) return true
  const preset = getProviderPreset(presetId)
  const draft = resolveProviderConfigDraft({ provider: {}, presetId, baseUrl: '', wireProtocol })
  return [preset.baseUrl, draft.baseUrl].some((candidate) => normalizeDraftBaseUrl(candidate ?? '') === current)
}

function normalizeDraftBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase()
}

function ProviderFormModal({
  visible,
  onClose,
  onSubmit,
}: {
  visible: boolean
  onClose: () => void
  onSubmit: (provider: AIProvider) => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const insets = useSafeAreaInsets()
  const { height, width } = useWindowDimensions()
  const motion = useMotionPreference()
  const bodyScrollRef = useRef<ScrollView>(null)
  const fieldOffsetsRef = useRef<Partial<Record<ProviderFormFieldId, number>>>({})
  const focusedFieldRef = useRef<ProviderFormFieldId | null>(null)
  const [presetId, setPresetId] = useState<ProviderPresetId>(DEFAULT_PROVIDER_PRESET_ID)
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [nameDirty, setNameDirty] = useState(false)
  const [baseUrlDirty, setBaseUrlDirty] = useState(false)
  const [wireProtocol, setWireProtocol] = useState<ProviderWireProtocol>(DEFAULT_PROVIDER_WIRE_PROTOCOL)
  const [modelsText, setModelsText] = useState('')
  const [keysText, setKeysText] = useState('')
  const [protocolOpen, setProtocolOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [clipboardState, setClipboardState] = useState<ClipboardReadState>('idle')
  const [keyboardFrame, setKeyboardFrame] = useState<KeyboardFrameSnapshot | null>(null)
  const webKeyboardInset = useWebVisualKeyboardInset(visible)
  const preset = getProviderPreset(presetId)
  const providerConfigDraft = resolveProviderConfigDraft({ provider: {}, presetId, baseUrl, wireProtocol })
  const validationCredentialGroups = useMemo(() => parseCredentialGroups(keysText), [keysText])
  const validationApiKey = validationCredentialGroups.find((group) => group.enabled && group.apiKey?.trim())?.apiKey
    ?? validationCredentialGroups.find((group) => group.apiKey?.trim())?.apiKey
    ?? ''
  const providerConfigIssue = getProviderConfigIssue({
    type: preset.type,
    baseUrl: providerConfigDraft.baseUrl,
    credentialMode: providerConfigDraft.credentialMode,
    tokenPlanRegion: providerConfigDraft.tokenPlanRegion,
    wireProtocol: providerConfigDraft.wireProtocol,
  }, validationApiKey)
  const providerConfigIssueMessage = providerConfigIssue
    ? t(providerConfigIssue.messageKey ?? providerConfigIssue.message)
    : undefined
  const compact = height < 680
  const compactWidth = width < 430
  const actionCompact = width < 360
  const footerCompact = width < 380
  const clipboardBusy = clipboardState !== 'idle'
  const rawKeyboardInset = Platform.OS === 'web' ? webKeyboardInset : Platform.OS === 'android' ? resolveKeyboardInsetFromFrame(keyboardFrame, height) : 0
  const keyboardInset = resolveModalKeyboardInset(rawKeyboardInset)
  const keyboardFrameVisible = Platform.OS === 'android' && keyboardFrame !== null
  const keyboardVisible = keyboardInset > 0 || keyboardFrameVisible
  const keyboardBridgeHeight = keyboardInset > 0 ? Math.min(PROVIDER_MODAL_KEYBOARD_BRIDGE_HEIGHT, keyboardInset) : 0
  const keyboardLayoutInset = Math.max(0, keyboardInset - keyboardBridgeHeight)
  const availableSheetHeight = Math.max(
    keyboardVisible ? 300 : 360,
    height - insets.top - Math.max(insets.bottom, 10) - keyboardInset - IMPORT_SHEET_MARGIN,
  )
  const sheetMaxHeight = Math.min(availableSheetHeight, height * (keyboardVisible ? 0.82 : compact ? 0.96 : 0.88))
  const sheetMaterial = colors.material.sheet
  const footerSurface = sheetMaterial.chrome
  const { subtleBorderWidth, chromeBorder, chromeSurface } = resolveProviderChrome(colors)
  const modalPadding = compactWidth ? 12 : 16
  const modalActionStyle = footerCompact ? { alignSelf: 'stretch' as const, minHeight: 44 } : { flexGrow: 1, flexShrink: 1, flexBasis: '47%' as const, minWidth: 0 }
  const footerScrollReserve = Math.max(insets.bottom, 10) + 132
  const focusedInputKeyboardOffset = Platform.OS === 'android' ? footerScrollReserve + 72 : 96
  const fieldScrollViewportOffset: Record<ProviderFormFieldId, number> = {
    name: 72,
    baseUrl: 48,
    tokens: -56,
    models: -56,
  }

  function resetDraft() {
    setName('')
    setBaseUrl('')
    setNameDirty(false)
    setBaseUrlDirty(false)
    setModelsText('')
    setKeysText('')
    setProtocolOpen(false)
    setAdvancedOpen(false)
    setClipboardState('idle')
    setPresetId(DEFAULT_PROVIDER_PRESET_ID)
    setWireProtocol(DEFAULT_PROVIDER_WIRE_PROTOCOL)
  }

  function closeWithoutSubmit() {
    resetDraft()
    onClose()
  }

  const keyboardRequestClose = useKeyboardAwareModalRequestClose(closeWithoutSubmit)

  useEffect(() => {
    if (!visible) {
      setKeyboardFrame(null)
      return undefined
    }
    const showSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (event) => {
      setKeyboardFrame(keyboardFrameSnapshotFromEvent(event))
      scrollFocusedInputAboveKeyboard()
      scheduleFocusedFieldScroll()
      setTimeout(scrollFocusedInputAboveKeyboard, 112)
      setTimeout(scheduleFocusedFieldScroll, 176)
    })
    const hideSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      setKeyboardFrame(null)
    })
    return () => {
      showSub.remove()
      hideSub.remove()
    }
  }, [height, visible])

  function rememberFieldLayout(id: ProviderFormFieldId) {
    return (event: LayoutChangeEvent) => {
      fieldOffsetsRef.current[id] = event.nativeEvent.layout.y
    }
  }

  function scrollFocusedFieldIntoView() {
    const focusedField = focusedFieldRef.current
    if (!focusedField) return
    const fieldOffset = fieldOffsetsRef.current[focusedField]
    if (fieldOffset === undefined) return
    bodyScrollRef.current?.scrollTo({ y: Math.max(0, fieldOffset - fieldScrollViewportOffset[focusedField]), animated: true })
  }

  function scheduleFocusedFieldScroll() {
    requestAnimationFrame(() => {
      requestAnimationFrame(scrollFocusedFieldIntoView)
    })
  }

  function scrollFocusedInputAboveKeyboard() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        type TextInputState = {
          currentlyFocusedInput?: () => unknown
        }
        type ScrollResponder = {
          scrollResponderScrollNativeHandleToKeyboard?: (
            nodeHandle: number | null,
            additionalOffset?: number,
            preventNegativeScrollOffset?: boolean,
          ) => void
        }
        const textInputState = (TextInput as unknown as { State?: TextInputState }).State
        const focusedInput = textInputState?.currentlyFocusedInput?.()
        const focusedHandle = typeof focusedInput === 'number'
          ? focusedInput
          : focusedInput
            ? findNodeHandle(focusedInput as Parameters<typeof findNodeHandle>[0])
            : null
        if (focusedHandle) {
          const responder = (bodyScrollRef.current as unknown as { getScrollResponder?: () => ScrollResponder }).getScrollResponder?.()
          responder?.scrollResponderScrollNativeHandleToKeyboard?.(focusedHandle, focusedInputKeyboardOffset, true)
        }
        scrollFocusedFieldIntoView()
      })
    })
  }

  function markInputFocused(fieldId: ProviderFormFieldId) {
    focusedFieldRef.current = fieldId
    keyboardRequestClose.markKeyboardActive()
    scrollFocusedInputAboveKeyboard()
    scheduleFocusedFieldScroll()
    setTimeout(scrollFocusedInputAboveKeyboard, 112)
    setTimeout(scheduleFocusedFieldScroll, 176)
  }

  function submit() {
    if (providerConfigIssue) return
    const modelList = parseModels(modelsText)
    const provider = applyProviderPreset({
      id: `custom-${Date.now().toString(36)}`,
      presetId,
      detectedPresetId: presetId,
      detectionStatus: 'manual',
      type: preset.type,
      name: name.trim() || (presetId === DEFAULT_PROVIDER_PRESET_ID ? t('providerSettings.customProvider') : preset.name),
      baseUrl: providerConfigDraft.baseUrl,
      credentialMode: providerConfigDraft.credentialMode,
      tokenPlanRegion: providerConfigDraft.tokenPlanRegion,
      wireProtocol: providerConfigDraft.wireProtocol,
      apiKey: '',
      credentialGroups: validationCredentialGroups,
      models: modelList,
      enabled: false,
    } satisfies AIProvider, presetId)
    onSubmit(provider)
    resetDraft()
  }

  function selectPreset(nextPresetId: ProviderPresetId) {
    const currentPreset = getProviderPreset(presetId)
    const nextPreset = getProviderPreset(nextPresetId)
    const shouldReplaceName = !nameDirty || !name.trim() || name.trim() === currentPreset.name
    const shouldReplaceBaseUrl = !baseUrlDirty || !baseUrl.trim() || isPresetDefaultBaseUrl(baseUrl, presetId, wireProtocol)
    const draftBaseUrl = shouldReplaceBaseUrl ? '' : baseUrl
    const nextProtocol = inferProviderWireProtocolFromBaseUrl(draftBaseUrl)
    const nextDraft = resolveProviderConfigDraft({ provider: {}, presetId: nextPresetId, baseUrl: draftBaseUrl, wireProtocol: nextProtocol })
    setPresetId(nextPresetId)
    setWireProtocol(nextProtocol)
    setBaseUrl(nextDraft.baseUrl)
    setBaseUrlDirty(!shouldReplaceBaseUrl)
    if (shouldReplaceName) {
      const nextName = nextPresetId === DEFAULT_PROVIDER_PRESET_ID
        ? ''
        : nextPreset.name
      setName(nextName)
      setNameDirty(false)
    }
  }

  function selectWireProtocol(nextProtocol: ProviderWireProtocol) {
    setWireProtocol(nextProtocol)
    const shouldReplaceBaseUrl = !baseUrlDirty || isPresetDefaultBaseUrl(baseUrl, presetId, wireProtocol)
    setBaseUrl(resolveProviderConfigDraft({ provider: {}, presetId, baseUrl: shouldReplaceBaseUrl ? '' : baseUrl, wireProtocol: nextProtocol }).baseUrl)
    setBaseUrlDirty(!shouldReplaceBaseUrl)
  }

  function applyProviderImportDraftText(text: string, source: 'clipboard' | 'manual'): boolean {
    const draft = parseProviderImportDraft(text, { requireConnection: source === 'manual', preferredWireProtocol: wireProtocol })
    if (!draft) return false
    const nextDraft = resolveProviderConfigDraft({ provider: draft.provider, presetId: draft.presetId, baseUrl: draft.baseUrl, wireProtocol: draft.wireProtocol })
    setPresetId(draft.presetId)
    setWireProtocol(draft.wireProtocol)
    setBaseUrl(nextDraft.baseUrl)
    setName(draft.provider.name)
    setNameDirty(false)
    setBaseUrlDirty(false)
    setKeysText(draft.credentialText)
    if (draft.modelText) setModelsText(draft.modelText)
    dialog.toast({
      title: t('providerSettings.clipboardDetected'),
      message: t(source === 'clipboard' && draft.count > 1 ? 'providerSettings.importAppliedFirst' : 'providerSettings.importDetected', { count: draft.count }),
      tone: 'mint',
    })
    return true
  }

  function handleBaseUrlText(value: string) {
    if (looksLikeProviderImportConnectionText(value) && applyProviderImportDraftText(value, 'manual')) return
    setBaseUrl(value)
    setBaseUrlDirty(true)
    if (shouldSyncWireProtocolFromBaseUrl(providerConfigDraft)) setWireProtocol(inferProviderWireProtocolFromBaseUrl(value))
  }

  function handleKeysText(value: string) {
    if (looksLikeProviderImportConnectionText(value) && applyProviderImportDraftText(value, 'manual')) return
    setKeysText(value)
  }

  async function readProviderClipboard() {
    setClipboardState('requesting')
    dialog.toast({
      title: t('providerSettings.clipboardPermissionRequest'),
      message: t('providerSettings.clipboardPermissionMessage'),
      tone: 'mint',
      durationMs: 1400,
    })
    try {
      const hasText = await Clipboard.hasStringAsync()
      if (!hasText) {
        dialog.toast({ title: t('providerSettings.clipboardEmpty'), tone: 'amber' })
        return
      }
      const text = await Clipboard.getStringAsync()
      if (!text.trim()) {
        dialog.toast({ title: t('providerSettings.clipboardEmpty'), tone: 'amber' })
        return
      }
      if (!applyProviderImportDraftText(text, 'clipboard')) {
        dialog.toast({ title: t('providerSettings.clipboardRead'), message: t('providerSettings.clipboardNoConfig'), tone: 'amber' })
      }
    } catch (error) {
      dialog.toast({
        title: t('providerSettings.clipboardReadFailed'),
        message: clipboardReadFailureMessage(error, t),
        tone: 'amber',
      })
    } finally {
      setClipboardState('idle')
    }
  }

  return (
    <Modal transparent visible={visible} animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={keyboardRequestClose.handleRequestClose}>
      <View style={{ flex: 1 }}>
        <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
          <IsleOverlayPressable accessible={false} accessibilityRole="none" onPress={closeWithoutSubmit} style={{ flex: 1, backgroundColor: colors.backdrop }} />
        </View>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', paddingBottom: keyboardLayoutInset }}>
          <View
            accessibilityViewIsModal
            style={{ maxHeight: sheetMaxHeight, borderTopLeftRadius: Math.min(colors.ui.radius.panel, 8), borderTopRightRadius: Math.min(colors.ui.radius.panel, 8), backgroundColor: sheetMaterial.surface, borderWidth: subtleBorderWidth, borderBottomWidth: keyboardBridgeHeight > 0 ? 0 : subtleBorderWidth, borderColor: sheetMaterial.border, overflow: 'hidden' }}
          >
            <View style={{ paddingHorizontal: modalPadding, paddingTop: 10, paddingBottom: 8, backgroundColor: sheetMaterial.chrome, borderBottomWidth: 1, borderBottomColor: sheetMaterial.divider }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: colors.text, fontSize: 15, fontWeight: '800' }}>{t('settings.addProvider')}</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 3 }}>{t('providerSettings.addSubtitle')}</Text>
                </View>
                <IsleIconButton label={t('dialog.close')} onPress={closeWithoutSubmit}>
                  <AppIcon name="close" color={colors.textSecondary} size={18} />
                </IsleIconButton>
              </View>
              <View style={{ paddingTop: 10, alignItems: actionCompact ? 'stretch' : 'flex-start' }}>
                <IsleButton
                  label={clipboardBusy ? t('providerSettings.clipboardChecking') : t('settings.pasteClipboard')}
                  compact
                  icon={<AppIcon name="paste" color={colors.textSecondary} size={16} />}
                  onPress={() => void readProviderClipboard()}
                  disabled={clipboardBusy}
                  style={actionCompact ? { alignSelf: 'stretch' } : undefined}
                />
              </View>
            </View>
            <ScrollView
              ref={bodyScrollRef}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              removeClippedSubviews={Platform.OS === 'android'}
              showsVerticalScrollIndicator={compact}
              style={{ flexShrink: 1 }}
              contentContainerStyle={{ gap: 8, paddingHorizontal: modalPadding, paddingBottom: 10, backgroundColor: sheetMaterial.body }}
            >
              <View onLayout={rememberFieldLayout('baseUrl')}>
                <IsleField
                  label={t('providerSettings.baseUrl')}
                  inputProps={{
                    value: baseUrl,
                    onFocus: () => markInputFocused('baseUrl'),
                    onChangeText: handleBaseUrlText,
                    placeholder: preset.baseUrl ?? 'https://example.com/v1',
                    autoCapitalize: 'none',
                    autoCorrect: false,
                    accessibilityHint: providerConfigIssueMessage,
                  }}
                />
                {providerConfigIssueMessage ? (
                  <Text
                    testID="provider-form-base-url-error"
                    accessibilityRole="alert"
                    accessibilityLiveRegion="polite"
                    style={{ marginTop: 6, color: colors.ui.tone.danger.foreground, fontSize: 11, lineHeight: 16, fontWeight: '700' }}
                  >
                    {providerConfigIssueMessage}
                  </Text>
                ) : null}
              </View>
              <View onLayout={rememberFieldLayout('tokens')}>
                <IsleField
                  label={t('providerSettings.tokens')}
                  note={t('providerSettings.tokensNote')}
                  inputProps={{ value: keysText, onChangeText: handleKeysText, onFocus: () => markInputFocused('tokens'), placeholder: 'sk-...\nsk-...', autoCapitalize: 'none', autoCorrect: false, multiline: true, secureTextEntry: false, style: { minHeight: compact ? 64 : 80, maxHeight: compact ? 96 : 124 } }}
                />
              </View>
              <IslePressable
                haptic
                accessibilityRole="button"
                accessibilityLabel={t('providerSettings.advancedInterfaceSettings')}
                accessibilityState={{ expanded: advancedOpen }}
                onPress={() => setAdvancedOpen((value) => !value)}
                style={{ minHeight: ISLE_MIN_TOUCH_TARGET, borderRadius: Math.min(colors.ui.radius.controlLarge, 8), paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.ui.input.background, borderWidth: subtleBorderWidth, borderColor: colors.ui.input.border }}
              >
                <Text style={{ flex: 1, minWidth: 0, color: colors.textSecondary, fontSize: 12, fontWeight: '800' }}>{t('providerSettings.advancedInterfaceSettings')}</Text>
                <MotiView animate={{ rotate: advancedOpen ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 160 }}>
                  <AppIcon name="collapse" color={colors.textTertiary} size={16} />
                </MotiView>
              </IslePressable>
              {advancedOpen ? (
                <View style={{ gap: 8 }}>
                  <View onLayout={rememberFieldLayout('name')}>
                    <IsleField label={t('providerSettings.name')} inputProps={{ value: name, onChangeText: (value) => {
                      setName(value)
                      setNameDirty(true)
                    }, onFocus: () => markInputFocused('name'), placeholder: presetId === DEFAULT_PROVIDER_PRESET_ID ? t('providerSettings.customProviderNamePlaceholder') : preset.name, autoCapitalize: 'none' }} />
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {PROVIDER_VENDOR_PRESETS.map((item) => (
                      <ChoiceIsleChip key={item.id} label={item.name} active={presetId === item.id} onPress={() => selectPreset(item.id)} />
                    ))}
                  </ScrollView>
                  {providerConfigDraft.isProtocolSelectable ? (
                    <View style={{ gap: 8 }}>
                      <ProviderToolbarDisclosureRow
                        title={t('providerSettings.protocol.title')}
                        detail={t('providerSettings.protocol.collapsedDetail', {
                          protocol: t(`providerSettings.protocol.${providerConfigDraft.wireProtocol}`),
                          endpoint: providerConfigDraft.baseUrl || t('common.none'),
                        })}
                        icon={<AppIcon name="network" color={colors.textTertiary} size={15} />}
                        open={protocolOpen}
                        onPress={() => setProtocolOpen((value) => !value)}
                      />
                      {protocolOpen ? (
                        <MotiView
                          from={motion === 'full' ? { opacity: 0, translateY: 6 } : { opacity: 0 }}
                          animate={{ opacity: 1, translateY: 0 }}
                          exit={motion === 'full' ? { opacity: 0, translateY: -4 } : { opacity: 0 }}
                          transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
                          style={{ borderRadius: Math.min(colors.ui.radius.panel, 8), padding: 10, backgroundColor: chromeSurface, borderWidth: subtleBorderWidth, borderColor: chromeBorder, gap: 8 }}
                        >
                          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                            {PROVIDER_WIRE_PROTOCOL_OPTIONS.map((protocol) => (
                              <ChoiceIsleChip key={protocol} active={wireProtocol === protocol} label={t(`providerSettings.protocol.${protocol}`)} onPress={() => selectWireProtocol(protocol)} />
                            ))}
                          </View>
                          <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16 }}>{t('providerSettings.protocol.endpointNote')}</Text>
                        </MotiView>
                      ) : null}
                    </View>
                  ) : null}
                  <View onLayout={rememberFieldLayout('models')}>
                    <IsleField
                      label={t('settings.models')}
                      note={t('providerSettings.modelsNote')}
                      inputProps={{ value: modelsText, onChangeText: setModelsText, onFocus: () => markInputFocused('models'), placeholder: t('providerSettings.oneModelPerLine'), autoCapitalize: 'none', autoCorrect: false, multiline: true, style: { minHeight: 56, maxHeight: 96 } }}
                    />
                  </View>
                </View>
              ) : null}
            </ScrollView>
            {!keyboardVisible ? (
              <View style={{ flexDirection: footerCompact ? 'column' : 'row', gap: 8, paddingHorizontal: modalPadding, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 10) + 8, backgroundColor: footerSurface, borderTopWidth: 1, borderTopColor: sheetMaterial.divider }}>
                <IsleButton label={t('common.cancel')} onPress={closeWithoutSubmit} style={modalActionStyle} />
                <IsleButton
                  testID="provider-form-submit"
                  label={t('providerSettings.addAndConnect')}
                  tone="primary"
                  onPress={submit}
                  disabled={clipboardBusy || Boolean(providerConfigIssue)}
                  style={modalActionStyle}
                />
              </View>
            ) : null}
          </View>
          {keyboardBridgeHeight > 0 ? (
            <View pointerEvents="none" style={{ height: keyboardBridgeHeight, backgroundColor: footerSurface }} />
          ) : null}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

function countLogicalTextLines(value: string, stopAfter: number): number {
  if (!value) return 1
  let lines = 1
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (char !== '\n' && char !== '\r') continue
    lines += 1
    if (char === '\r' && value[index + 1] === '\n') index += 1
    if (lines >= stopAfter) return lines
  }
  return lines
}

function ProviderImportModal({
  visible,
  importProgress,
  onClose,
  onSubmit,
}: {
  visible: boolean
  importProgress: ProviderImportProgress | null
  onClose: () => void
  onSubmit: (input: string) => Promise<boolean>
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const insets = useSafeAreaInsets()
  const { height, width } = useWindowDimensions()
  const motion = useMotionPreference()
  const bodyScrollRef = useRef<ScrollView>(null)
  const inputRef = useRef<TextInput>(null)
  const [input, setInput] = useState('')
  const deferredInput = useDeferredValue(input)
  const [clipboardState, setClipboardState] = useState<ClipboardReadState>('idle')
  const [contentHeight, setContentHeight] = useState(0)
  const [keyboardFrame, setKeyboardFrame] = useState<KeyboardFrameSnapshot | null>(null)
  const webKeyboardInset = useWebVisualKeyboardInset(visible && importProgress === null)
  const compact = height < 680
  const compactWidth = width < 430
  const rawKeyboardInset = Platform.OS === 'web' ? webKeyboardInset : Platform.OS === 'android' ? resolveKeyboardInsetFromFrame(keyboardFrame, height) : 0
  const keyboardInset = resolveModalKeyboardInset(rawKeyboardInset)
  const keyboardFrameVisible = Platform.OS === 'android' && keyboardFrame !== null
  const keyboardVisible = keyboardInset > 0 || keyboardFrameVisible
  const keyboardBridgeHeight = keyboardInset > 0 ? Math.min(PROVIDER_MODAL_KEYBOARD_BRIDGE_HEIGHT, keyboardInset) : 0
  const keyboardLayoutInset = Math.max(0, keyboardInset - keyboardBridgeHeight)
  const availableSheetHeight = Math.max(
    keyboardVisible ? 300 : 360,
    height - insets.top - Math.max(insets.bottom, 10) - keyboardInset - IMPORT_SHEET_MARGIN,
  )
  const availableBodyHeight = Math.max(
    180,
    availableSheetHeight - IMPORT_HEADER_HEIGHT - IMPORT_FOOTER_HEIGHT - IMPORT_BODY_FIXED_SPACE,
  )
  const maxInputHeight = Math.max(
    IMPORT_INPUT_LINE_HEIGHT * 2 + IMPORT_INPUT_VERTICAL_PADDING,
    Math.min(
      availableBodyHeight * 0.72,
      IMPORT_INPUT_LINE_HEIGHT * IMPORT_INPUT_MAX_LINES + IMPORT_INPUT_VERTICAL_PADDING,
    ),
  )
  const logicalLines = countLogicalTextLines(input, IMPORT_INPUT_MAX_LINES + 1)
  const logicalVisibleLines = Math.max(2, logicalLines + 1)
  const logicalHeight = IMPORT_INPUT_VERTICAL_PADDING + logicalVisibleLines * IMPORT_INPUT_LINE_HEIGHT
  const measuredHeight = contentHeight ? contentHeight + IMPORT_INPUT_VERTICAL_PADDING : logicalHeight
  const targetInputHeight = Math.max(logicalHeight, measuredHeight)
  const inputHeight = Math.min(targetInputHeight, maxInputHeight)
  const inputScrollEnabled = targetInputHeight > maxInputHeight
  const sheetMaxHeight = Math.min(availableSheetHeight, height * (keyboardVisible ? 0.82 : compact ? 0.96 : 0.9))
  const sheetMaterial = colors.material.sheet
  const footerSurface = colors.ui.limeRoad ? sheetMaterial.chrome : colors.ui.glass ? colors.ui.semantic.chrome.background : sheetMaterial.chrome
  const { subtleBorderWidth } = resolveProviderChrome(colors)
  const footerCompact = width < 380
  const modalPadding = compactWidth ? 12 : 16
  const modalActionStyle = footerCompact ? { alignSelf: 'stretch' as const, minHeight: 44 } : { flex: 1, minHeight: 44 }
  const detectionLimited = deferredInput.length > PROVIDER_IMPORT_LIVE_DETECTION_CHAR_LIMIT
  const liveDetectionInput = detectionLimited ? deferredInput.slice(0, PROVIDER_IMPORT_LIVE_DETECTION_CHAR_LIMIT) : deferredInput
  const detectedImportCount = useMemo(() => countDetectedProviderImports(liveDetectionInput), [liveDetectionInput])
  const clipboardBusy = clipboardState !== 'idle'
  const importBusy = importProgress !== null
  const keyboardRequestClose = useKeyboardAwareModalRequestClose(onClose)

  useEffect(() => {
    if (!visible) {
      setKeyboardFrame(null)
      setContentHeight(0)
      setClipboardState('idle')
      return
    }
    if (importBusy) {
      setKeyboardFrame(null)
      return undefined
    }
    const focusTimer = setTimeout(() => {
      inputRef.current?.focus()
    }, Platform.OS === 'android' ? 260 : 120)
    const showSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (event) => {
      setKeyboardFrame(keyboardFrameSnapshotFromEvent(event))
      // 只在有较多内容时才滚动到底部，避免初始打开时输入框被推到顶部
      if (input.trim() && countLogicalTextLines(input, 6) > 5) {
        scrollBodyToEndSoon()
      }
    })
    const hideSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      setKeyboardFrame(null)
    })
    return () => {
      clearTimeout(focusTimer)
      showSub.remove()
      hideSub.remove()
    }
  }, [height, visible, input, importBusy])

  function scrollBodyToEndSoon() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        bodyScrollRef.current?.scrollToEnd({ animated: true })
      })
    })
  }

  function appendInputText(text: string): boolean {
    if (importBusy) return false
    const trimmed = text.trim()
    if (!trimmed) return false
    const nextInput = [input.trim(), trimmed].filter(Boolean).join('\n\n')
    if (nextInput.length > MAX_IMPORT_TEXT_FILE_BYTES) {
      toastImportTextTooLarge()
      return false
    }
    setInput(nextInput)
    scrollBodyToEndSoon()
    return true
  }

  function toastImportTextTooLarge() {
    dialog.toast({ title: t('error.fileTooLarge'), message: t('chat.fileTooLarge20'), tone: 'amber' })
  }

  async function submit() {
    const text = input.trim()
    if (!text || importBusy) return
    if (text.length > MAX_IMPORT_TEXT_FILE_BYTES) {
      toastImportTextTooLarge()
      return
    }
    const imported = await onSubmit(text)
    if (!imported) return
    setInput('')
    setContentHeight(0)
  }

  async function pasteFromClipboard() {
    if (importBusy) return
    setClipboardState('requesting')
    dialog.toast({
      title: t('providerSettings.clipboardPermissionRequest'),
      message: t('providerSettings.clipboardPermissionMessage'),
      tone: 'mint',
      durationMs: 1400,
    })
    try {
      const hasText = await Clipboard.hasStringAsync()
      if (!hasText) {
        dialog.toast({ title: t('providerSettings.clipboardEmpty'), tone: 'amber' })
        return
      }
      const text = await Clipboard.getStringAsync()
      if (!text.trim()) {
        dialog.toast({ title: t('providerSettings.clipboardEmpty'), tone: 'amber' })
        return
      }
      if (!appendInputText(text)) return
      if (text.length > PROVIDER_IMPORT_LIVE_DETECTION_CHAR_LIMIT) {
        dialog.toast({ title: t('providerSettings.clipboardRead'), message: t('providerSettings.importDetectionLimited'), tone: 'amber' })
        return
      }
      const detected = parseProviderImportText(text)
      dialog.toast({
        title: detected.providers.length ? t('providerSettings.clipboardDetected') : t('providerSettings.clipboardRead'),
        message: detected.providers.length
          ? t('providerSettings.clipboardDetectedMessage', { count: detected.providers.length })
          : t('providerSettings.clipboardNoConfig'),
        tone: detected.providers.length ? 'mint' : 'amber',
      })
    } catch (error) {
      dialog.toast({
        title: t('providerSettings.clipboardReadFailed'),
        message: clipboardReadFailureMessage(error, t),
        tone: 'amber',
      })
    } finally {
      setClipboardState('idle')
    }
  }

  async function importFromFile() {
    if (importBusy) return
    let importUri: string | undefined
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/plain', 'text/csv', 'application/csv', 'application/json', 'text/json', '*/*'],
        copyToCacheDirectory: true,
      })
      if (result.canceled || !result.assets[0]) return
      const asset = result.assets[0]
      importUri = asset.uri
      const name = asset.name.toLowerCase()
      const supported = /\.(txt|csv|json)$/i.test(name) || ['text/plain', 'text/csv', 'application/csv', 'application/json', 'text/json'].includes(asset.mimeType ?? '')
      if (!supported) {
        dialog.toast({ title: t('providerSettings.fileUnsupported'), message: t('providerSettings.fileUnsupportedMessage'), tone: 'amber' })
        return
      }
      const text = await readUtf8ImportFile(importUri, {
        size: asset.size,
        limitBytes: MAX_IMPORT_TEXT_FILE_BYTES,
      })
      appendInputText(text)
      dialog.toast({ title: t('providerSettings.fileRead'), message: asset.name, tone: 'mint' })
    } catch (error) {
      dialog.toast({
        title: isFileTooLargeError(error) ? t('error.fileTooLarge') : t('providerSettings.fileUnsupported'),
        message: isFileTooLargeError(error) ? t('chat.fileTooLarge20') : t('providerSettings.fileUnsupportedMessage'),
        tone: 'amber',
      })
    } finally {
      await deleteTemporaryImportCopy(importUri, { assumeTemporaryCopy: true })
    }
  }

  return (
    <Modal transparent visible={visible} animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={keyboardRequestClose.handleRequestClose}>
      <View style={{ flex: 1 }}>
        <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
          <IsleOverlayPressable accessible={false} accessibilityRole="none" onPress={onClose} style={{ flex: 1, backgroundColor: colors.backdrop }} />
        </View>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', paddingBottom: keyboardLayoutInset }}>
          <View
            accessibilityViewIsModal
            style={{
              maxHeight: sheetMaxHeight,
              borderTopLeftRadius: Math.min(colors.ui.radius.panel, 8),
              borderTopRightRadius: Math.min(colors.ui.radius.panel, 8),
              backgroundColor: sheetMaterial.surface,
              borderWidth: subtleBorderWidth,
              borderBottomWidth: keyboardBridgeHeight > 0 ? 0 : subtleBorderWidth,
              borderColor: sheetMaterial.border,
              overflow: 'hidden',
            }}
          >
            <View style={{ minHeight: IMPORT_HEADER_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: modalPadding, paddingTop: 10, paddingBottom: 8, backgroundColor: sheetMaterial.chrome, borderBottomWidth: 1, borderBottomColor: sheetMaterial.divider }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: colors.text, fontSize: 15, fontWeight: '800' }}>{t('settings.batchImport')}</Text>
              </View>
              <IsleIconButton label={t('dialog.close')} onPress={onClose} disabled={importBusy}>
                <AppIcon name="close" color={colors.textSecondary} size={18} />
              </IsleIconButton>
            </View>
            <ScrollView
              ref={bodyScrollRef}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              removeClippedSubviews={Platform.OS === 'android'}
              showsVerticalScrollIndicator={compact || inputScrollEnabled}
              style={{ flexShrink: 1 }}
              contentContainerStyle={{ paddingHorizontal: modalPadding, paddingTop: 10, paddingBottom: 10, backgroundColor: sheetMaterial.body }}
            >
              <View>
                <View style={{ marginBottom: 10 }}>
                  <Text style={{ color: colors.text, fontSize: 12, fontWeight: '800', marginBottom: 7 }}>{t('providerSettings.importSources')}</Text>
                  <View style={{ flexDirection: footerCompact ? 'column' : 'row', gap: 8 }}>
                    <IsleButton
                      label={clipboardBusy ? t('providerSettings.clipboardChecking') : t('settings.pasteClipboard')}
                      compact
                      icon={<AppIcon name="paste" color={colors.textSecondary} size={16} />}
                      onPress={() => void pasteFromClipboard()}
                      disabled={clipboardBusy || importBusy}
                      style={modalActionStyle}
                    />
                    <IsleButton
                      label={t('settings.chooseFile')}
                      compact
                      icon={<AppIcon name="json" color={colors.textSecondary} size={16} />}
                      onPress={() => void importFromFile()}
                      disabled={importBusy}
                      style={modalActionStyle}
                    />
                  </View>
                </View>
                {importProgress ? <ProviderImportProgressCard progress={importProgress} /> : null}
                <Text style={{ color: colors.text, fontSize: 12, fontWeight: '800', marginBottom: 6 }}>{t('providerSettings.importContent')}</Text>
                <View
                  style={{
                    height: inputHeight,
                    borderRadius: Math.min(colors.ui.radius.panel, 8),
                    paddingHorizontal: 12,
                    backgroundColor: colors.ui.input.background,
                    borderWidth: colors.ui.limeRoad ? 1 : subtleBorderWidth,
                    borderColor: colors.ui.input.border,
                    overflow: 'hidden',
                    shadowColor: colors.shadow.color,
                    shadowOpacity: 0,
                    shadowRadius: 0,
                    shadowOffset: { width: 0, height: 0 },
                    elevation: 0,
                  }}
                >
                  <TextInput
                    ref={inputRef}
                    value={input}
                    onChangeText={setInput}
                    maxLength={MAX_IMPORT_TEXT_FILE_BYTES}
                    editable={!importBusy}
                    onFocus={keyboardRequestClose.markKeyboardActive}
                    onContentSizeChange={(event) => setContentHeight(event.nativeEvent.contentSize.height)}
                    multiline
                    scrollEnabled={inputScrollEnabled}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder={'https://api.example.com/v1\nsk-...\nsk-...\n\nhttps://api.other.com/v1\nsk-...'}
                    placeholderTextColor={colors.textTertiary}
                    textAlignVertical="top"
                    style={{
                      height: inputHeight,
                      paddingTop: 10,
                      paddingBottom: 10,
                      paddingHorizontal: 0,
                      color: colors.text,
                      fontSize: 14,
                      fontWeight: '700',
                      lineHeight: IMPORT_INPUT_LINE_HEIGHT,
                      includeFontPadding: false,
                    }}
                  />
                </View>
                <Text style={{ color: detectedImportCount ? colors.ui.tone.success.foreground : colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 8, fontWeight: detectedImportCount ? '900' : '700' }}>
                  {input.trim()
                    ? detectionLimited
                      ? t('providerSettings.importDetectionLimited')
                      : detectedImportCount
                      ? t('providerSettings.importDetected', { count: detectedImportCount })
                      : t('providerSettings.importDetectionEmpty')
                    : t('providerSettings.importNote')}
                </Text>
              </View>
            </ScrollView>
            <View style={{ minHeight: keyboardVisible ? 56 : IMPORT_FOOTER_HEIGHT, flexDirection: footerCompact ? 'column' : 'row', alignItems: footerCompact ? 'stretch' : 'center', gap: footerCompact ? 8 : 10, paddingHorizontal: modalPadding, paddingTop: keyboardVisible ? 8 : 12, paddingBottom: (keyboardVisible ? 8 : Math.max(insets.bottom, 10) + 10), backgroundColor: footerSurface, borderTopWidth: subtleBorderWidth, borderTopColor: sheetMaterial.divider }}>
                <IsleButton label={t('common.cancel')} compact onPress={onClose} disabled={importBusy} style={modalActionStyle} />
                <IsleButton
                  label={importBusy ? t('providerSettings.importProgressWorking') : t('providerSettings.import')}
                  compact
                  tone="primary"
                  busy={importBusy}
                  disabled={!input.trim() || importBusy}
                  onPress={() => void submit()}
                  style={modalActionStyle}
                />
            </View>
          </View>
          {keyboardBridgeHeight > 0 ? (
            <View pointerEvents="none" style={{ height: keyboardBridgeHeight, backgroundColor: footerSurface }} />
          ) : null}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

function clipboardReadFailureMessage(error: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? '')
  return /permission|denied|not.?allowed|nopermission/i.test(message)
    ? t('providerSettings.clipboardPermissionDenied')
    : t('providerSettings.clipboardUnavailable')
}

function providerImportFailureMessage(error: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return [t('providerSettings.importFailedMessage'), message.trim()].filter(Boolean).join('\n')
}
