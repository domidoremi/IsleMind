import { flushPersistedSettings } from '@/presentation/features/settings/settingsStorePersistenceCommand'
import { SettingsEditBoundary, useSettingsDraft, useSettingsLeave } from '@/components/settings/SettingsEditBoundary'
import { SettingsHelpButton } from '@/components/settings/SettingsHelp'
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AppState, findNodeHandle, InteractionManager, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type KeyboardEvent, type LayoutChangeEvent } from 'react-native'
import { Text, TextInput } from '@/components/ui/AppText'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { MotiView } from 'moti'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/ui/AppIcon'
import { GlassSurface } from '@/components/ui/isle/GlassSurface'
import { HighFrameSpinner } from '@/components/ui/HighFrameSpinner'
import { ApiKeyPanel } from '@/components/settings/ApiKeyPanel'
import { ProviderTokenField } from './ProviderTokenField'
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
import { composeUserFacingError, extractUserFacingErrorDetail } from '@/core'
import type { ProviderPresetId, ProviderWireProtocol } from '@/types/providerContracts'
import { getProviderConfigIssue } from '@/types/providerBaseUrls'
import { applyProviderPreset, countDetectedProviderImports, formatProviderNameList, getProviderPreset, looksLikeProviderImportConnectionText, parseCredentialGroups, parseProviderImportDraft, parseProviderImportText, probeProviderPreset, PROVIDER_VENDOR_PRESETS } from '@/bootstrap/providerRegistry'
import { DEFAULT_PROVIDER_PRESET_ID, DEFAULT_PROVIDER_WIRE_PROTOCOL, PROVIDER_SETTINGS_MODEL_SAMPLE_LIMIT, PROVIDER_WIRE_PROTOCOL_OPTIONS, inferProviderWireProtocolFromBaseUrl, shouldSyncWireProtocolFromBaseUrl, type ProviderSettingsGroup, type ProviderSortMode } from '@/modules/providers'
import { resolveProviderConfigDraft } from '@/bootstrap/providerPolicies'
import { activationItemProgress } from '@/services/providerActivationJob'
import { deleteTemporaryImportCopy, isFileTooLargeError, MAX_IMPORT_TEXT_FILE_BYTES, readUtf8ImportFile } from '@/platform/native/boundedImportFile'
import { parseModels } from '@/utils/text'
import { summarizeProviderModelInventory } from '@/utils/providerModels'
import { hasProviderModelAccessRules } from '@/bootstrap/providerModelAccess'
import { buildProviderSettingsPolicyModelCache, buildProviderSettingsSearchIndex, filterAndSortProviders } from '@/bootstrap/providerSettingsList'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useProviderActivationJob } from '@/components/providers/useProviderActivationJob'
import { isExistingProviderImport, useProviderImportSession } from '@/components/providers/useProviderImportSession'
import { PROVIDER_CARD_DETAIL_MAX_WIDTH } from '@/components/providers/ProviderCardGrid'
import {
  LiquidGlassProviderSettingsExperience,
  MaterialProviderSettingsExperience,
  MinimalProviderSettingsExperience,
  MonetProviderSettingsExperience,
} from '@/components/providers/theme-experiences/ProviderSettingsExperiences'
import type { RuntimeDiagnosticsProviderDetail, RuntimeDiagnosticsSummary } from '@/bootstrap/runtimeDiagnostics'
import { clearAndroidStatusNotification, updateAndroidStatusNotification } from '@/bootstrap/androidStatusNotification'
import { resolveProviderDisplayName } from '@/presentation/features/settings/providerPresentation'
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
const CLEAR_INVALID_PROVIDER_LIST_LIMIT = 12
const PROVIDER_POLICY_MODEL_UI_LIMIT = PROVIDER_SETTINGS_MODEL_SAMPLE_LIMIT
const RUNTIME_DIAGNOSTICS_DEBOUNCE_MS = 900
const PROVIDER_RUNTIME_DIAGNOSTICS_AUTO_PROVIDER_LIMIT = 8
const PROVIDER_RUNTIME_DIAGNOSTICS_AUTO_MODEL_ENTRY_LIMIT = 256
const PROVIDER_MANUAL_SORT_RAIL_PROVIDER_LIMIT = 8
const PROVIDER_DETAILS_DEFER_PROVIDER_LIMIT = 8
const PROVIDER_DETAILS_DEFER_FALLBACK_MS = 180
const PROVIDER_IMPORT_LIVE_DETECTION_CHAR_LIMIT = 120000
let providerNotificationSequence = 0
type ProviderFormFieldId = 'name' | 'baseUrl' | 'tokens' | 'models'

function createProviderNotificationOwner(kind: string): string {
  providerNotificationSequence = (providerNotificationSequence + 1) % 1000000
  return `provider-${kind}:${Date.now()}:${providerNotificationSequence}`
}

function resolveProviderChrome(colors: AppThemeColors) {
  const subtleBorderWidth = colors.ui.monet ? 1 : StyleSheet.hairlineWidth
  const chromeSurface = colors.ui.monet ? colors.ui.semantic.surface.base : colors.ui.liquidGlass ? colors.ui.semantic.chrome.background : colors.ui.semantic.surface.base
  const chromeBorder = colors.ui.monet ? colors.material.stroke : colors.ui.liquidGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  const mutedSurface = colors.ui.monet ? colors.ui.semantic.surface.muted : colors.ui.liquidGlass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted
  const raisedSurface = colors.ui.monet ? colors.ui.semantic.surface.base : colors.ui.liquidGlass ? colors.ui.semantic.surface.overlay : colors.ui.semantic.surface.base
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

interface ProviderSettingsContentProps {
  embedded?: boolean
  autoOpenAdd?: boolean
  onAutoOpenAddConsumed?: () => void
  onClose?: () => void
  onProviderConnected?: () => void
  onBackgroundStateChange?: (state: IsleBackgroundState) => void
}

export function ProviderSettingsContent(props: ProviderSettingsContentProps) {
  return <SettingsEditBoundary><ProviderSettingsBody {...props} /></SettingsEditBoundary>
}

function ProviderSettingsBody({ embedded = false, autoOpenAdd = false, onAutoOpenAddConsumed, onClose, onProviderConnected, onBackgroundStateChange }: ProviderSettingsContentProps) {
  const { colors, canonicalThemeId } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const motion = useMotionPreference()
  const insets = useSafeAreaInsets()
  const { width, fontScale } = useWindowDimensions()
  const compactWidth = width < 430
  const pagePadding = compactWidth ? 12 : 16
  const pagerGestureLock = useMainPagerGestureLock()
  const providers = useSettingsStore((state) => state.providers)
  const reorderProviders = useSettingsStore((state) => state.reorderProviders)
  const removeProvider = useSettingsStore((state) => state.removeProvider)
  const clearAllProviders = useSettingsStore((state) => state.clearAllProviders)
  const listInvalidProviders = useSettingsStore((state) => state.listInvalidProviders)
  const clearInvalidProviders = useSettingsStore((state) => state.clearInvalidProviders)
  const compactProviderStorage = useSettingsStore((state) => state.compactProviderStorage)
  const settings = useSettingsStore((state) => state.settings)
  const storedConversations = useChatStore((state) => state.conversations)
  const draftConversationIds = useChatStore((state) => state.draftConversationIds)
  const conversations = useMemo(
    () => storedConversations.filter((conversation) => !draftConversationIds.has(conversation.id)),
    [draftConversationIds, storedConversations]
  )
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null)
  const [providerView, setProviderView] = useState<'connection' | 'models'>('models')
  const [deletingSupplierId, setDeletingSupplierId] = useState<string | null>(null)
  const selectedProvider = expandedProviderId ? providers.find((provider) => provider.id === expandedProviderId) : undefined
  const [sortMode, setSortMode] = useState<ProviderSortMode>('manual')
  const [modelFilter, setModelFilter] = useState('')
  const deferredModelFilter = useDeferredValue(modelFilter)
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(autoOpenAdd)
  const [batchActionsOpen, setBatchActionsOpen] = useState(false)
  const [importProgress, setImportProgress] = useState<ProviderImportProgress | null>(null)
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<RuntimeDiagnosticsSummary | null>(null)
  const runtimeDiagnosticsRunRef = useRef(0)
  const importSession = useProviderImportSession()
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
  const { activationBusy, activationJob, clearActivationJob, isActivationRunning } = useProviderActivationJob({
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
    if (!autoOpenAdd) return
    setImportOpen(true)
    onAutoOpenAddConsumed?.()
  }, [autoOpenAdd, onAutoOpenAddConsumed])

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
          const { buildRuntimeDiagnosticsSummary } = await import('@/bootstrap/runtimeDiagnostics')
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
      if (!conversation.providerId || conversation.providerId === 'local-setup') continue
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

  const providerAttentionItems: SettingsSummaryItem[] = []
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
  async function addProviderFromForm(provider: AIProvider) {
    // Saving configuration is not authorization to probe or test a paid model.
    const store = useSettingsStore.getState()
    if (store.providers.some(item => item.id === provider.id)) await store.updateProvider(provider.id, provider)
    else await store.addProviders([provider], { selectDefaultIfEmpty: false })
    await store.flushProviderPersistence()
    await flushPersistedSettings()
    setAddOpen(false)
    setExpandedProviderId(provider.id)
    setProviderView('models')
    setSortMode('manual')
    setModelFilter('')
  }

  async function publishImportProgress(progress: ProviderImportProgress, options: { waitForNotification?: boolean; owner?: string } = {}) {
    setImportProgress(progress)
    const notification = publishProviderImportStatusNotification(
      progress,
      t,
      useSettingsStore.getState().settings.systemStatusNotificationsEnabled === true,
      options.owner,
    )
    if (options.waitForNotification) await notification
  }

  async function importProvidersFromText(input: string, skipExisting = true): Promise<boolean> {
    if (importProgress) return false
    const notificationOwner = createProviderNotificationOwner('import')
    await publishImportProgress({ stage: 'parsing', completed: 0, total: 0 }, { waitForNotification: true, owner: notificationOwner })
    Keyboard.dismiss()
    await yieldToNextPaint()
    try {
      const result = await importSession.save(input, async total => {
        await publishImportProgress({ stage: 'saving', completed: 0, total }, { waitForNotification: true, owner: notificationOwner })
        await yieldToNextPaint()
      }, ({ completed, total, currentProviderName }) => {
        void publishImportProgress({ stage: 'saving', completed, total, currentProviderName }, { owner: notificationOwner })
      }, skipExisting)
      if (!result) return false
      if (!result.providers.length) {
        setImportProgress(null)
        void clearAndroidStatusNotification({ owner: notificationOwner })
        dialog.notice({ title: t('providerSettings.importEmpty'), message: result.warnings.join('\n') || t('providerSettings.importEmptyMessage'), tone: 'amber' })
        return false
      }

      void publishImportProgress({ stage: 'finishing', completed: result.providers.length, total: result.providers.length }, { owner: notificationOwner })
      await yieldToNextPaint()

      setImportProgress(null)
      setImportOpen(false)
      setExpandedProviderId(result.providers.length === 1 ? result.providers[0]?.id ?? null : null)
      setSortMode('manual')
      setModelFilter('')
      setProviderView('models')
      // Import is complete locally. Choosing a model is a separate user action,
      // never an invitation to activate/test every imported credential.
      void clearAndroidStatusNotification({ owner: notificationOwner })
      const savedNotice = {
        title: t('providerSettings.configurationSaved'),
        message: [t('providerSettings.selectModelHint'), ...result.warnings].filter(Boolean).join('\n'),
        tone: result.warnings.length ? 'amber' as const : 'mint' as const,
      }
      if (result.warnings.length) dialog.notice(savedNotice)
      else dialog.toast(savedNotice)
      return true
    } catch (error) {
      const failureMessage = providerImportFailureMessage(error, t)
      setImportProgress(null)
      void clearAndroidStatusNotification({ owner: notificationOwner })
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
    // Enabling is a local preference, not consent to test credentials or models.
    for (const id of ids) await useSettingsStore.getState().updateProvider(id, { enabled: true })
    await useSettingsStore.getState().flushProviderPersistence()
    dialog.toast({ title: t('providerSettings.configurationSaved'), tone: 'mint' })
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
    setSelectedIds((current) => new Set([...current].filter((id) => !ids.has(id))))
    const notificationOwner = createProviderNotificationOwner('delete')
    void publishProviderDeleteNotification(0, count, t, useSettingsStore.getState().settings.systemStatusNotificationsEnabled === true, notificationOwner)

    let removed = 0
    try {
      for (const provider of group.providers) {
        await removeProvider(provider.id)
        invalidateProviderUsage(provider.id)
        removed += 1
        void publishProviderDeleteNotification(removed, count, t, useSettingsStore.getState().settings.systemStatusNotificationsEnabled === true, notificationOwner)
      }
      dialog.toast({
        title: t('providerSettings.deleteSupplierDone'),
        message: t('providerSettings.deleteSupplierDoneMessage', { name: groupLabel, count }),
        tone: 'mint',
        dedupeKey: 'provider-delete-supplier',
      })
      void clearAndroidStatusNotification({ owner: notificationOwner })
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
      void clearAndroidStatusNotification({ owner: notificationOwner })
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
        position={providerIndex + 1}
        featured={provider.id === settings.defaultProvider}
        selected={selectedIds.has(provider.id)}
        batchMode={batchMode}
        expanded={expandedProviderId === provider.id}
        onToggleSelected={() => toggleSelection(provider.id)}
        onExpandedChange={(next) => { setProviderView('models'); setExpandedProviderId(next ? provider.id : null) }}
        onEdit={() => { setProviderView('connection'); setExpandedProviderId(provider.id) }}
      />
    )
  }

  const ProviderSettingsExperience = canonicalThemeId === 'monet'
    ? MonetProviderSettingsExperience
    : canonicalThemeId === 'material'
      ? MaterialProviderSettingsExperience
      : canonicalThemeId === 'liquid-glass'
        ? LiquidGlassProviderSettingsExperience
        : MinimalProviderSettingsExperience
  const providerAttention = providerModelAccessHasRules ? <SettingsSummaryStrip items={providerAttentionItems.filter(item => item.key === 'policy')} /> : undefined
  const providerActivation = activationJob
    ? <ActivationProgressCard job={activationJob} onDismiss={clearActivationJob} />
    : undefined
  const providerTools = <View style={{ gap: 10 }}>
    {providers.length ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <TextInput testID="provider-search" accessibilityLabel={t('providerSettings.searchConnections')}
        value={modelFilter} onChangeText={setModelFilter} autoCapitalize="none" autoCorrect={false}
        placeholder={t('providerSettings.searchConnections')} placeholderTextColor={colors.textTertiary}
        style={{ flex: 1, minWidth: 0, minHeight: ISLE_MIN_TOUCH_TARGET, paddingHorizontal: 12,
          borderRadius: 14, backgroundColor: colors.ui.semantic.surface.muted, color: colors.text, fontSize: 14 }} />
      <IslePressable testID="provider-management-toggle" accessibilityRole="button" accessibilityLabel={t('providerSettings.manageConnections')}
        accessibilityState={{ expanded: batchActionsOpen }} onPress={() => { setBatchActionsOpen(value => !value); setBatchMode(false); setSelectedIds(new Set()) }}
        style={{ width: ISLE_MIN_TOUCH_TARGET, height: ISLE_MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' }}>
        <AppIcon name="more" color={colors.textSecondary} size={20} />
      </IslePressable>
    </View> : null}
    {batchActionsOpen ? <View testID="provider-management-actions" style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {SORT_OPTIONS.map(option => <ChoiceIsleChip key={option.id} label={t(option.labelKey)} active={sortMode === option.id} onPress={() => setSortMode(option.id)} />)}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <IsleButton compact label={batchMode ? t('providerSettings.exitBatch') : t('providerSettings.selectionMode')}
          onPress={() => { setBatchMode(value => !value); setSelectedIds(new Set()) }} />
        {batchMode ? <>
          <IsleButton compact label={t('providerSettings.enableSelected', { count: selectedIds.size })}
            disabled={!selectedIds.size || activationBusy} onPress={() => void enableEffectiveSelection()} />
          <IsleButton compact tone="danger" label={t('providerSettings.deleteSelected')}
            disabled={!selectedIds.size || Boolean(deletingSupplierId)} onPress={() => {
              const group = { id: 'selection', label: t('providerSettings.selectionMode'), providers: providers.filter(provider => selectedIds.has(provider.id)) }
              void confirmRemoveSupplierGroup(group)
            }} />
        </> : null}
        <IsleButton compact label={t('modelAvailability.details')} onPress={() => router.push('/settings/model-availability')} />
        <IsleButton compact tone="amber" label={t('providerSettings.clearInvalid')} onPress={() => void confirmClearInvalidProviders()} />
        <IsleButton compact tone="danger" label={t('providerSettings.clearAll')} onPress={() => void confirmClearAllProviders()} />
      </View>
    </View> : null}
  </View>

  const providerRegistry = visibleProviderItems.length ? (
    <View accessibilityRole="list" testID="provider-connections" style={{ width: '100%', maxWidth: PROVIDER_CARD_DETAIL_MAX_WIDTH, alignSelf: 'center' }}>
      {visibleProviderItems.map((provider, index) => <View key={provider.id} role="listitem">
        {renderProviderItem({ item: provider, index })}
      </View>)}
    </View>
  ) : <View testID="provider-empty" style={{ padding: 32, gap: 18, alignItems: 'center' }}>
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: 60, height: 60, borderRadius: 20, backgroundColor: colors.ui.semantic.surface.muted, alignItems: 'center', justifyContent: 'center' }}><AppIcon name={providers.length ? 'search' : 'provider-key'} size={26} color={colors.ui.icon.accentForeground} /></View>
    <Text style={{ color: colors.text, fontSize: 18, lineHeight: 26, fontWeight: '600', textAlign: 'center' }}>{providers.length ? t('providerSettings.noMatches') : t('providerSettings.noProviders')}</Text>
    {!providers.length ? <>

      <IsleButton tone="primary" label={t('settingsUx.addConnection')} onPress={() => setImportOpen(true)} />
    </> : null}
  </View>

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
            subtitle=""
            backLabel={t('common.back')}
            addLabel={t('settings.addProvider')}
            compact={compactWidth}
            onBack={onClose ?? closeStandaloneProviderSettings}
            onAdd={() => setImportOpen(true)}
            attention={providerAttention}
            activation={providerActivation}
            tools={providerTools}
          >
            {providerRegistry}
          </ProviderSettingsExperience>
        </ScrollView>
      </KeyboardAvoidingView>
      {addOpen ? <ProviderFormModal
        visible
        onClose={() => setAddOpen(false)}
        onSubmit={addProviderFromForm}
      /> : null}
      {importOpen ? <ProviderImportModal
        visible
        onManual={() => { setImportOpen(false); setAddOpen(true) }}
        importProgress={importProgress}
        persistencePending={importSession.persistencePending}
        onClose={() => {
          if (importProgress) return
          importSession.reset()
          setImportOpen(false)
        }}
        onSubmit={importProvidersFromText}
      /> : null}
      {selectedProvider ? <ProviderConfigurationSheet
        visible
        initialView={providerView}
        onUse={() => { setExpandedProviderId(null); onProviderConnected?.() }}
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
      /> : null}
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
  initialView,
  onUse,
  sortControl,
  onClose,
}: {
  visible: boolean
  provider?: AIProvider
  runtimeDetail?: RuntimeDiagnosticsProviderDetail
  deferMount: boolean
  initialView: 'connection' | 'models'
  onUse: () => void
  sortControl?: ReactNode
  onClose: () => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const motion = useMotionPreference(true)
  const leave = useSettingsLeave()
  const { handleRequestClose } = useKeyboardAwareModalRequestClose(() => {
    void requestSheetClose()
  })
  const sheetHeight = Math.max(360, Math.min(Math.round(height * 0.9), height - Math.max(insets.top, 12) - 8))
  const sheetRadius = colors.ui.liquidGlass ? colors.ui.radius.panel : 8
  const providerName = provider ? resolveProviderDisplayName(provider, t('providerSettings.customProvider')) : ''

  async function requestSheetClose() { await leave(onClose) }

  return (
    <Modal transparent visible={visible && Boolean(provider)} animationType={motion === 'full' ? 'slide' : 'none'} statusBarTranslucent navigationBarTranslucent onRequestClose={handleRequestClose}>
      <View accessibilityViewIsModal style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable accessible={false} accessibilityRole="none" onPress={() => void requestSheetClose()} style={[StyleSheet.absoluteFill, { backgroundColor: colors.backdrop }]} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <GlassSurface
            colors={colors} enabled={Boolean(colors.ui.liquidGlass)} variant="floating" shadow="none"
            borderRadius={sheetRadius}
            style={{ height: sheetHeight, overflow: 'hidden', borderTopLeftRadius: sheetRadius, borderTopRightRadius: sheetRadius, backgroundColor: colors.material.sheet.surface, borderWidth: colors.ui.monet ? 1 : StyleSheet.hairlineWidth, borderBottomWidth: 0, borderColor: colors.material.sheet.border }}
          >
            <View style={{ alignItems: 'center', paddingTop: 6 }}>
              <View style={{ width: 34, height: 3, borderRadius: 2, backgroundColor: colors.textTertiary, opacity: 0.34 }} />
            </View>
            <View style={{ minHeight: 50, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.material.sheet.border }}>
              <View style={{ width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.icon.accentBackground }}>
                <AppIcon name="provider-key" color={colors.ui.icon.accentForeground} size={16} />
              </View>
              <Text accessibilityRole="header" style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 18, lineHeight: 25, fontWeight: '800', includeFontPadding: false }}>
                {providerName}
              </Text>
              <SettingsHelpButton compact topic="models" />
              <IslePressable haptic accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={() => void requestSheetClose()} style={{ width: ISLE_MIN_TOUCH_TARGET, height: ISLE_MIN_TOUCH_TARGET, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
                <AppIcon name="close" color={colors.textSecondary} size={17} />
              </IslePressable>
            </View>
            <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={{ width: '100%', maxWidth: PROVIDER_CARD_DETAIL_MAX_WIDTH, alignSelf: 'center', paddingHorizontal: 12, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 18) + 20 }}>
              {provider ? (
                <>
                  <DeferredProviderDetails
                    provider={provider}
                    runtimeDetail={runtimeDetail}
                    expanded
                    initialView={initialView}
                    onUse={onUse}
                    sortControl={sortControl}
                    onExpandedChange={(next) => {
                      if (!next) void requestSheetClose()
                    }}
                    deferMount={deferMount}
                  />
                </>
              ) : null}
            </ScrollView>
          </GlassSurface>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

function ProviderToolbarDisclosureRow({ title, detail, icon, open, tone, onPress }: { title: string; detail: string; icon: ReactNode; open: boolean; tone?: 'amber'; onPress: () => void }) {
  const { colors } = useAppTheme()
  const borderColor = tone === 'amber' ? colors.ui.tone.warning.border : colors.ui.liquidGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  const backgroundColor = tone === 'amber' ? colors.ui.tone.warning.background : colors.ui.liquidGlass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted
  const textColor = tone === 'amber' ? colors.ui.tone.warning.foreground : colors.textSecondary
  return (
    <IslePressable
      haptic
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      style={{ minHeight: 44, borderRadius: Math.min(colors.ui.radius.controlLarge, 8), paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor, borderWidth: colors.ui.monet ? 1 : StyleSheet.hairlineWidth, borderColor }}
    >
      {icon}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: textColor, fontSize: 14, lineHeight: 20, fontWeight: '800' }}>{title}</Text>
        <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, marginTop: 1, fontWeight: '700' }}>{detail}</Text>
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

function publishProviderImportStatusNotification(
  progress: ProviderImportProgress,
  t: ReturnType<typeof useTranslation>['t'],
  enabled: boolean,
  owner?: string,
) {
  if (!enabled) return Promise.resolve({ shown: false, reason: 'disabled', backgroundReliable: false } as const)
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
  }, { enabled: true, owner })
}

function publishProviderDeleteNotification(
  completed: number,
  total: number,
  t: ReturnType<typeof useTranslation>['t'],
  enabled: boolean,
  owner?: string,
) {
  if (!enabled) return Promise.resolve({ shown: false, reason: 'disabled', backgroundReliable: false } as const)
  const progress = total > 0 ? Math.min(1, Math.max(0, completed / total)) : 0
  const message = t('providerSettings.deleteSupplierProgress', { completed, total })
  return updateAndroidStatusNotification({
    state: 'running',
    title: t('providerSettings.deleteSupplierStarted'),
    message,
    shortText: `${completed}/${total}`,
    deepLink: 'islemind://settings/providers',
    progress,
    indeterminate: false,
    ongoing: true,
    requestPromotedOngoing: true,
    foregroundService: true,
  }, { enabled: true, owner })
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

function ProviderListRow({ provider, featured, selected, batchMode, expanded, onToggleSelected, onExpandedChange, onEdit }: {
  provider: AIProvider; position: number; featured: boolean; selected: boolean; batchMode: boolean; expanded: boolean
  onToggleSelected: () => void; onExpandedChange: (next: boolean) => void; onEdit: () => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const modelInventory = useMemo(() => summarizeProviderModelInventory(provider), [provider])
  const providerDisplayName = resolveProviderDisplayName(provider, t('providerSettings.customProvider'))
  const providerUrl = provider.baseUrl?.trim() || t('providerSettings.baseUrl')
  const providerStateLabel = featured && provider.enabled ? t('providerSettings.defaultConnection') : t(provider.enabled ? 'settings.enabled' : 'settings.disabled')
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.ui.section.divider, backgroundColor: selected ? colors.ui.semantic.surface.muted : 'transparent' }}>
    {batchMode ? <IslePressable accessibilityRole="checkbox" accessibilityLabel={`${t('providerSettings.selectProvider')} ${providerDisplayName}`}
      accessibilityState={{ checked: selected }} onPress={onToggleSelected}
      style={{ width: ISLE_MIN_TOUCH_TARGET, height: ISLE_MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' }}>
      <AppIcon name={selected ? 'check' : 'list-check'} color={colors.textSecondary} size={18} />
    </IslePressable> : null}
    <IslePressable testID={`provider-open-${provider.id}`} accessibilityRole="button"
      accessibilityLabel={`${providerDisplayName}. ${providerStateLabel}. ${providerUrl}`} accessibilityState={{ expanded }}
      onPress={() => onExpandedChange(!expanded)}
      style={{ flex: 1, minWidth: 0, minHeight: 76, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: colors.ui.semantic.surface.muted, alignItems: 'center', justifyContent: 'center' }}><AppIcon name="provider-key" color={colors.ui.icon.accentForeground} size={19} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text style={{ color: colors.text, fontSize: 15, lineHeight: 22, fontWeight: '700' }}>{providerDisplayName}</Text>
        <Text style={{ color: colors.textTertiary, fontSize: 13, lineHeight: 19 }}>{providerUrl}</Text>
        <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{providerStateLabel} · {t('settingsSubsystem.modelCount', { count: modelInventory.selectableModels })}</Text>
      </View>
      <AppIcon name="back-next" color={colors.textTertiary} size={16} />
    </IslePressable>
    {!batchMode ? <IslePressable testID={`provider-edit-${provider.id}`} accessibilityRole="button"
      accessibilityLabel={`${t('common.edit')} ${providerDisplayName}`} onPress={onEdit}
      style={{ width: ISLE_MIN_TOUCH_TARGET, height: ISLE_MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' }}>
      <AppIcon name="edit" color={colors.textSecondary} size={18} />
    </IslePressable> : null}
  </View>
}

function DeferredProviderDetails({
  provider,
  runtimeDetail,
  expanded,
  onExpandedChange,
  deferMount,
  initialView,
  onUse,
  sortControl,
}: {
  provider: AIProvider
  runtimeDetail?: RuntimeDiagnosticsProviderDetail
  expanded: boolean
  onExpandedChange: (next: boolean) => void
  deferMount: boolean
  initialView: 'connection' | 'models'
  onUse: () => void
  sortControl?: ReactNode
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
        <ApiKeyPanel initialView={initialView} onUse={onUse}
          sortControl={sortControl}
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
          <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, fontWeight: '800', includeFontPadding: false }}>
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
          <Text style={{ color: disabled ? colors.textTertiary : colors.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '800', includeFontPadding: false }}>
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
        <Text style={{ color: active ? colors.ui.control.primaryForeground : colors.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '800', includeFontPadding: false }}>{label}</Text>
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
            <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 2, fontWeight: '800' }}>
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
        <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, fontWeight: '700' }}>
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
          <Text style={{ color: colors.ui.tone.warning.foreground, fontSize: 14, lineHeight: 20, fontWeight: '800' }}>
            {group.line}
          </Text>
          <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, marginTop: 2, fontWeight: '800' }}>
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
              <Text style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '800' }}>{item.providerName}</Text>
              <Text style={{ color: warning ? colors.ui.tone.warning.foreground : ready ? colors.ui.control.link : colors.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '800' }}>
                {activationItemStatusLabel(item, t)}
              </Text>
            </View>
            <IsleProgress percent={progress * 100} size="small" showInfo={false} durationMs={1} fillColor={warning ? colors.ui.tone.warning.foreground : colors.ui.control.primaryBackground} />
            {item.stage ? (
              <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, fontWeight: '800' }}>{item.stage}</Text>
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
      <Text style={{ color: toneToken.foreground, fontSize: 14, fontWeight: '800' }}>{label}</Text>
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
            <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '800' }}>
              {t(`providerSettings.importProgress.${progress.stage}`)}
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 2, fontWeight: '800' }}>
              {detail}
            </Text>
          </View>
        </View>
        <IsleProgress percent={progressValue * 100} size="small" showInfo={false} indeterminate={!determinate} />
        {progress.currentProviderName ? (
          <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, fontWeight: '800' }}>
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

export function ProviderFormModal({
  visible,
  onClose,
  onSubmit,
}: {
  visible: boolean
  onClose: () => void
  onSubmit: (provider: AIProvider) => Promise<void>
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
  const [saving, setSaving] = useState(false)
  const saveLock = useRef(false)
  const pendingProvider = useRef<AIProvider | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [nameDirty, setNameDirty] = useState(false)
  const [baseUrlDirty, setBaseUrlDirty] = useState(false)
  const [wireProtocol, setWireProtocol] = useState<ProviderWireProtocol>(DEFAULT_PROVIDER_WIRE_PROTOCOL)
  const [modelsText, setModelsText] = useState('')
  const [keysText, setKeysText] = useState('')
  const [step, setStep] = useState<'connection' | 'models'>('connection')
  const [presetPickerOpen, setPresetPickerOpen] = useState(false)
  const [presetQuery, setPresetQuery] = useState('')
  const [protocolOpen, setProtocolOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [clipboardState, setClipboardState] = useState<ClipboardReadState>('idle')
  const [keyboardFrame, setKeyboardFrame] = useState<KeyboardFrameSnapshot | null>(null)
  const webKeyboardInset = useWebVisualKeyboardInset(visible)
  const preset = getProviderPreset(presetId)
  const providerConfigDraft = resolveProviderConfigDraft({ provider: {}, presetId, baseUrl, wireProtocol })
  const validationCredentialGroups = useMemo(() => parseCredentialGroups(keysText, { explicit: true }), [keysText])
  const invalidTokenInput = Boolean(keysText.trim() && !validationCredentialGroups.length)
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
    pendingProvider.current = null
    setName('')
    setBaseUrl('')
    setNameDirty(false)
    setBaseUrlDirty(false)
    setModelsText('')
    setKeysText('')
    setStep('connection')
    setPresetPickerOpen(false)
    setPresetQuery('')
    setProtocolOpen(false)
    setAdvancedOpen(false)
    setClipboardState('idle')
    setPresetId(DEFAULT_PROVIDER_PRESET_ID)
    setWireProtocol(DEFAULT_PROVIDER_WIRE_PROTOCOL)
  }

  const requestDiscard = useSettingsDraft(visible && Boolean(name || baseUrl || keysText || modelsText || presetId !== DEFAULT_PROVIDER_PRESET_ID), saving, resetDraft)
  function closeWithoutSubmit() { void requestDiscard(onClose) }

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

  async function submit() {
    if (providerConfigIssue || invalidTokenInput || saveLock.current) return
    const modelList = parseModels(modelsText)
    const provider = applyProviderPreset({
      id: pendingProvider.current?.id ?? `custom-${Date.now().toString(36)}`,
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
    pendingProvider.current = provider
    Keyboard.dismiss()
    saveLock.current = true
    setSaving(true)
    try { await onSubmit(provider); resetDraft() }
    catch { dialog.toast({ title: t('settingsWorkspace.saveFailed'), tone: 'danger' }) }
    finally { saveLock.current = false; setSaving(false) }
  }

  function selectPreset(nextPresetId: ProviderPresetId) {
    setPresetPickerOpen(false)
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


  return (
    <Modal transparent visible={visible} animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={keyboardRequestClose.handleRequestClose}>
      <View pointerEvents={saving ? 'none' : 'auto'} style={{ flex: 1 }}>
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
                  <SettingsHelpButton compact topic="models" />
                </View>
                <IsleIconButton label={t('dialog.close')} onPress={closeWithoutSubmit}>
                  <AppIcon name="close" color={colors.textSecondary} size={18} />
                </IsleIconButton>
              </View>
              <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 22 }}>{t(step === 'connection' ? 'settingsUx.connectionStep' : 'settingsUx.modelStep')}</Text>
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
              {step === 'connection' ? <>
              <IslePressable testID="provider-preset-picker" accessibilityRole="button" accessibilityState={{ expanded: presetPickerOpen }}
                onPress={() => setPresetPickerOpen(value => !value)} style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1 }}><Text style={{ color: colors.textSecondary, fontSize: 13 }}>{t('settingsWorkspace.stepProvider')}</Text>
                  <Text style={{ color: colors.text, fontSize: 16, lineHeight: 24 }}>{preset.name}</Text></View>
                <AppIcon name={presetPickerOpen ? 'collapse' : 'back-next'} color={colors.textSecondary} size={18} />
              </IslePressable>
              {presetPickerOpen ? <View testID="provider-preset-list" style={{ flexDirection: 'column', gap: 4 }}>
                <IsleField label={t('settingsUx.findProvider')} inputProps={{ value: presetQuery, onChangeText: setPresetQuery, autoCorrect: false, autoCapitalize: 'none' }} />
                {PROVIDER_VENDOR_PRESETS.filter(item => `${item.name} ${item.id}`.toLowerCase().includes(presetQuery.trim().toLowerCase())).map(item =>
                  <IslePressable key={item.id} accessibilityRole="radio" accessibilityLabel={item.name} accessibilityState={{ checked: presetId === item.id }} onPress={() => selectPreset(item.id)}
                    style={{ minHeight: 48, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Text style={{ flex: 1, color: colors.text, fontSize: 15 }}>{item.name}</Text>
                    {presetId === item.id ? <AppIcon name="check" color={colors.primary} size={18} /> : null}
                  </IslePressable>)}
              </View> : <>
              <View onLayout={rememberFieldLayout('baseUrl')}>
                <IsleField
                  label={t('providerSettings.baseUrl')}
                  inputProps={{ editable: !saving,
                    value: baseUrl,
                    onFocus: () => markInputFocused('baseUrl'),
                    onChangeText: handleBaseUrlText,
                    placeholder: preset.baseUrl ?? 'https://example.com/v1',
                    keyboardType: 'url',
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
                    style={{ marginTop: 6, color: colors.ui.tone.danger.foreground, fontSize: 14, lineHeight: 20, fontWeight: '700' }}
                  >
                    {providerConfigIssueMessage}
                  </Text>
                ) : null}
              </View>
              <View onLayout={rememberFieldLayout('tokens')}>
                <ProviderTokenField editable={!saving} value={keysText} onChangeText={handleKeysText} onFocus={() => markInputFocused('tokens')} />
                {invalidTokenInput ? <Text accessibilityRole="alert" style={{ color: colors.ui.tone.danger.foreground, fontSize: 14, lineHeight: 21 }}>{t('apiKeyPanel.invalidTokenInput')}</Text> : null}
              </View>
              </>}
              </> : <>

                  <View onLayout={rememberFieldLayout('models')}>
                    <IsleField
                      label={t('settings.models')}
                      note={t('providerSettings.modelsNote')}
                      inputProps={{ editable: !saving, value: modelsText, onChangeText: setModelsText, onFocus: () => markInputFocused('models'), placeholder: t('providerSettings.oneModelPerLine'), autoCapitalize: 'none', autoCorrect: false, multiline: true, style: { minHeight: 56, maxHeight: 96 } }}
                    />
                  </View>
              </>}
              <IslePressable
                haptic
                accessibilityRole="button"
                accessibilityLabel={t('providerSettings.advancedInterfaceSettings')}
                accessibilityState={{ expanded: advancedOpen }}
                onPress={() => setAdvancedOpen((value) => !value)}
                style={{ minHeight: ISLE_MIN_TOUCH_TARGET, borderRadius: Math.min(colors.ui.radius.controlLarge, 8), paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.ui.input.background, borderWidth: subtleBorderWidth, borderColor: colors.ui.input.border }}
              >
                <Text style={{ flex: 1, minWidth: 0, color: colors.textSecondary, fontSize: 14, fontWeight: '800' }}>{t('providerSettings.advancedInterfaceSettings')}</Text>
                <MotiView animate={{ rotate: advancedOpen ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 160 }}>
                  <AppIcon name="collapse" color={colors.textTertiary} size={16} />
                </MotiView>
              </IslePressable>
              {advancedOpen ? (
                <View style={{ gap: 8 }}>
                  <View onLayout={rememberFieldLayout('name')}>
                    <IsleField label={t('providerSettings.name')} inputProps={{ editable: !saving, value: name, onChangeText: (value) => {
                      setName(value)
                      setNameDirty(true)
                    }, onFocus: () => markInputFocused('name'), placeholder: presetId === DEFAULT_PROVIDER_PRESET_ID ? t('providerSettings.customProviderNamePlaceholder') : preset.name, autoCapitalize: 'none' }} />
                  </View>

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
                          <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20 }}>{t('providerSettings.protocol.endpointNote')}</Text>
                        </MotiView>
                      ) : null}
                    </View>
                  ) : null}

                </View>
              ) : null}
            </ScrollView>
            {!presetPickerOpen ? (
              <View style={{ flexDirection: footerCompact ? 'column' : 'row', gap: 8, paddingHorizontal: modalPadding, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 10) + 8, backgroundColor: footerSurface, borderTopWidth: 1, borderTopColor: sheetMaterial.divider }}>
                <IsleButton label={t(step === 'connection' ? 'common.cancel' : 'common.back')} onPress={step === 'connection' ? closeWithoutSubmit : () => setStep('connection')} style={modalActionStyle} />
                <IsleButton
                  testID="provider-form-submit"
                  label={t(saving ? 'settingsWorkspace.saving' : step === 'connection' ? 'settingsUx.nextModels' : 'settingsUx.saveChooseModel')}
                  tone="primary"
                  onPress={() => { if (step === 'connection') { Keyboard.dismiss(); setStep('models') } else void submit() }}
                  disabled={saving || clipboardBusy || Boolean(providerConfigIssue) || invalidTokenInput}
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

export function ProviderImportModal({
  visible,
  importProgress,
  persistencePending = false,
  onClose,
  onManual,
  onSubmit,
}: {
  visible: boolean
  importProgress: ProviderImportProgress | null
  persistencePending?: boolean
  onClose: () => void
  onManual?: () => void
  onSubmit: (input: string, skipExisting?: boolean) => Promise<boolean>
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const insets = useSafeAreaInsets()
  const { height, width, fontScale } = useWindowDimensions()
  const motion = useMotionPreference()
  const bodyScrollRef = useRef<ScrollView>(null)
  const [input, setInput] = useState('')
  const existingProviders = useSettingsStore(state => state.providers)
  const settings = useSettingsStore(state => state.settings)
  const [review, setReview] = useState<ReturnType<typeof parseProviderImportText> | null>(null)
  const [skipExisting, setSkipExisting] = useState(true)
  const [previewLimit, setPreviewLimit] = useState(8)
  const conflicts = review?.providers.filter(provider => isExistingProviderImport(provider, existingProviders)).length ?? 0
  const importableCount = (review?.providers.length ?? 0) - (skipExisting ? conflicts : 0)
  const deferredInput = useDeferredValue(input)
  const inputValue = useRef(input)
  inputValue.current = input
  const draftEpoch = useRef(0)
  const submitLock = useRef(false)
  const [submitting, setSubmitting] = useState(false)
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
  const measuredHeight = input && contentHeight ? contentHeight : logicalHeight
  const targetInputHeight = Math.max(logicalHeight, measuredHeight)
  const inputHeight = Math.min(targetInputHeight, maxInputHeight, 160)
  const inputScrollEnabled = targetInputHeight > inputHeight
  const sheetMaxHeight = Math.min(availableSheetHeight, height * (keyboardVisible ? 0.82 : compact ? 0.96 : 0.9))
  const sheetMaterial = colors.material.sheet
  const footerSurface = colors.ui.monet ? sheetMaterial.chrome : colors.ui.liquidGlass ? colors.ui.semantic.chrome.background : sheetMaterial.chrome
  const { subtleBorderWidth } = resolveProviderChrome(colors)
  // Text scaling can make a phone effectively narrower without changing its dp width.
  const footerCompact = width / Math.max(1, fontScale) < 380
  const modalPadding = compactWidth ? 12 : 16
  const modalActionStyle = footerCompact ? { alignSelf: 'stretch' as const, minHeight: 44 } : { flex: 1, minHeight: 44 }
  const detectionLimited = deferredInput.length > PROVIDER_IMPORT_LIVE_DETECTION_CHAR_LIMIT
  const liveDetectionInput = detectionLimited ? deferredInput.slice(0, PROVIDER_IMPORT_LIVE_DETECTION_CHAR_LIMIT) : deferredInput
  const detectedImportCount = useMemo(() => countDetectedProviderImports(liveDetectionInput), [liveDetectionInput])
  const clipboardBusy = clipboardState !== 'idle'
  const importBusy = importProgress !== null || submitting
  const resetDraft = () => {
    draftEpoch.current += 1
    inputValue.current = ''
    setInput('')
    setReview(null)
    setSkipExisting(true)
    setPreviewLimit(8)
    setContentHeight(0)
    setClipboardState('idle')
  }
  const requestDiscard = useSettingsDraft(visible && Boolean(input), importBusy, () => { resetDraft(); onClose() })
  const closeWithoutSubmit = () => {
    if (!submitLock.current) void requestDiscard(() => undefined)
  }
  const keyboardRequestClose = useKeyboardAwareModalRequestClose(closeWithoutSubmit)
  useEffect(() => { if (!visible) resetDraft(); return () => { draftEpoch.current += 1 } }, [visible])

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
    const showSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (event) => {
      setKeyboardFrame(keyboardFrameSnapshotFromEvent(event))
      // 只在有较多内容时才滚动到底部，避免初始打开时输入框被推到顶部
      if (inputValue.current.trim() && countLogicalTextLines(inputValue.current, 6) > 5) {
        scrollBodyToEndSoon()
      }
    })
    const hideSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      setKeyboardFrame(null)
    })
    return () => {
      showSub.remove()
      hideSub.remove()
    }
  }, [height, visible, importBusy])

  function scrollBodyToEndSoon() {
    const epoch = draftEpoch.current
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (epoch !== draftEpoch.current) return
        bodyScrollRef.current?.scrollToEnd({ animated: true })
      })
    })
  }

  function appendInputText(text: string): boolean {
    if (importBusy || submitLock.current || persistencePending) return false
    const trimmed = text.trim()
    if (!trimmed) return false
    const nextInput = [inputValue.current.trim(), trimmed].filter(Boolean).join('\n\n')
    if (nextInput.length > MAX_IMPORT_TEXT_FILE_BYTES) {
      toastImportTextTooLarge()
      return false
    }
    inputValue.current = nextInput
    setReview(null)
    setInput(nextInput)
    scrollBodyToEndSoon()
    return true
  }

  function toastImportTextTooLarge() {
    dialog.toast({ title: t('error.fileTooLarge'), message: t('chat.fileTooLarge20'), tone: 'amber' })
  }

  async function submit() {
    const text = input.trim()
    if (!text || importBusy || submitLock.current) return
    if (text.length > MAX_IMPORT_TEXT_FILE_BYTES) {
      toastImportTextTooLarge()
      return
    }
    if (!review && !persistencePending) {
      try {
        setReview(parseProviderImportText(text, { accessSettings: settings }))
        Keyboard.dismiss()
      } catch (error) {
        dialog.notice({ title: t('providerSettings.importFailed'), message: providerImportFailureMessage(error, t), tone: 'danger' })
      }
      return
    }
    submitLock.current = true
    draftEpoch.current += 1
    setClipboardState('idle')
    setSubmitting(true)
    try {
      const imported = await onSubmit(text, skipExisting)
      if (imported) resetDraft()
    } catch (error) {
      dialog.notice({ title: t('providerSettings.importFailed'), message: providerImportFailureMessage(error, t), tone: 'danger' })
    } finally { submitLock.current = false; setSubmitting(false) }
  }

  async function pasteFromClipboard() {
    if (importBusy || submitLock.current || persistencePending) return
    const epoch = draftEpoch.current
    setClipboardState('requesting')
    try {
      const hasText = await Clipboard.hasStringAsync()
      if (epoch !== draftEpoch.current) return
      if (!hasText) {
        dialog.toast({ title: t('providerSettings.clipboardEmpty'), tone: 'amber' })
        return
      }
      const text = await Clipboard.getStringAsync()
      if (epoch !== draftEpoch.current) return
      if (!text.trim()) {
        dialog.toast({ title: t('providerSettings.clipboardEmpty'), tone: 'amber' })
        return
      }
      if (!appendInputText(text)) return
      if (text.length > PROVIDER_IMPORT_LIVE_DETECTION_CHAR_LIMIT) {
        dialog.toast({ title: t('providerSettings.clipboardRead'), message: t('providerSettings.importDetectionLimited'), tone: 'amber' })
        return
      }
      const detected = parseProviderImportText(inputValue.current, { accessSettings: settings })
      if (detected.providers.length) { setReview(detected); Keyboard.dismiss(); return }
      dialog.toast({
        title: detected.providers.length ? t('providerSettings.clipboardDetected') : t('providerSettings.clipboardRead'),
        message: detected.providers.length
          ? t('providerSettings.clipboardDetectedMessage', { count: detected.providers.length })
          : t('providerSettings.clipboardNoConfig'),
        tone: detected.providers.length ? 'mint' : 'amber',
      })
    } catch (error) {
      if (epoch !== draftEpoch.current) return
      dialog.toast({
        title: t('providerSettings.clipboardReadFailed'),
        message: clipboardReadFailureMessage(error, t),
        tone: 'amber',
      })
    } finally {
      if (epoch === draftEpoch.current) setClipboardState('idle')
    }
  }

  async function importFromFile() {
    if (importBusy || submitLock.current || persistencePending) return
    const epoch = draftEpoch.current
    let importUri: string | undefined
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/plain', 'text/csv', 'application/csv', 'application/json', 'text/json', '*/*'],
        copyToCacheDirectory: true,
      })
      if (result.canceled || !result.assets[0]) return
      const asset = result.assets[0]
      importUri = asset.uri
      if (epoch !== draftEpoch.current) return
      const name = asset.name.toLowerCase()
      const supported = /\.(txt|csv|json)$/i.test(name) || ['text/plain', 'text/csv', 'application/csv', 'application/json', 'text/json'].includes(asset.mimeType ?? '')
      if (!supported) {
        dialog.toast({ title: t('providerSettings.fileUnsupported'), message: t('providerSettings.fileUnsupportedMessage'), tone: 'amber' })
        return
      }
      const text = await readUtf8ImportFile(importUri, {
        size: asset.size,
        file: asset.file,
        limitBytes: MAX_IMPORT_TEXT_FILE_BYTES,
      })
      if (epoch !== draftEpoch.current) return
      appendInputText(text)
      dialog.toast({ title: t('providerSettings.fileRead'), message: asset.name, tone: 'mint' })
    } catch (error) {
      if (epoch !== draftEpoch.current) return
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
          <IsleOverlayPressable accessible={false} accessibilityRole="none" onPress={closeWithoutSubmit} style={{ flex: 1, backgroundColor: colors.backdrop }} />
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
                <Text style={{ color: colors.text, fontSize: 15, fontWeight: '800' }}>{t('providerSettings.importConfiguration')}</Text>
              </View>
              <IsleIconButton label={t('dialog.close')} onPress={closeWithoutSubmit} disabled={importBusy}>
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
                {!review ? <View style={{ marginBottom: 16, gap: 10 }}>

                  <View style={{ flexDirection: footerCompact ? 'column' : 'row', gap: 8 }}>
                    <IsleButton
                      label={clipboardBusy ? t('providerSettings.clipboardChecking') : t('settingsUx.pasteConfig')}
                      tone="primary"
                      compact
                      icon={<AppIcon name="paste" color={colors.textSecondary} size={16} />}
                      onPress={() => void pasteFromClipboard()}
                      disabled={clipboardBusy || importBusy || persistencePending}
                      style={modalActionStyle}
                    />
                    <IsleButton
                      label={t('settings.chooseFile')}
                      compact
                      icon={<AppIcon name="json" color={colors.textSecondary} size={16} />}
                      onPress={() => void importFromFile()}
                      disabled={importBusy || persistencePending}
                      style={modalActionStyle}
                    />
                  </View>
                  {onManual ? <IsleButton testID="provider-manual-entry" label={t('providerSettings.addManually')} disabled={importBusy || persistencePending}
                    onPress={() => void requestDiscard(onManual)} /> : null}
                </View> : null}
                {importProgress ? <ProviderImportProgressCard progress={importProgress} /> : null}
                {persistencePending && !importBusy ? <Text accessibilityRole="alert" style={{ color: colors.text, fontSize: 14, lineHeight: 22, marginBottom: 10 }}>{t('providerSettings.importSavePending')}</Text> : null}
                <View
                  style={{
                    height: review ? undefined : inputHeight,
                    paddingVertical: review ? 12 : 0,
                    borderRadius: Math.min(colors.ui.radius.panel, 8),
                    paddingHorizontal: 12,
                    backgroundColor: colors.ui.input.background,
                    borderWidth: colors.ui.monet ? 1 : subtleBorderWidth,
                    borderColor: colors.ui.input.border,
                    overflow: 'hidden',
                    shadowColor: colors.shadow.color,
                    shadowOpacity: 0,
                    shadowRadius: 0,
                    shadowOffset: { width: 0, height: 0 },
                    elevation: 0,
                  }}
                >
                  {!review ? <TextInput
                    value={input}
                    accessibilityLabel={t('providerSettings.importContent')}
                    onChangeText={value => { inputValue.current = value; setInput(value); setReview(null) }}
                    maxLength={MAX_IMPORT_TEXT_FILE_BYTES}
                    editable={!importBusy && !persistencePending}
                    onFocus={keyboardRequestClose.markKeyboardActive}
                    onContentSizeChange={(event) => setContentHeight(event.nativeEvent.contentSize.height)}
                    multiline
                    scrollEnabled={inputScrollEnabled}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder={t('settingsUx.pastePlaceholder')}
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
                  /> : <View testID="provider-import-review" style={{ gap: 10 }}>
                    <Text style={{ color: colors.text, fontSize: 16, fontWeight: '800' }}>{t('providerSettings.reviewImport')}</Text>

                    {review.providers.slice(0, previewLimit).map(provider => {
                      let endpoint = ''
                      try { const url = new URL(provider.baseUrl ?? ''); endpoint = url.origin + url.pathname } catch { /* Invalid addresses are not echoed. */ }
                      return <View key={provider.id} style={{ gap: 3, paddingVertical: 6 }}>
                        <Text style={{ color: colors.text, fontWeight: '700' }}>{provider.name}</Text>
                        <Text style={{ color: colors.textSecondary }}>{endpoint || t('providerSettings.baseUrl')}</Text>
                        <Text style={{ color: colors.textSecondary }}>{provider.models.slice(0, 3).join(', ') || t('providerSettings.addModelHint')}</Text>
                        <Text style={{ color: colors.textTertiary }}>{t('providerSettings.importCredentialSummary', { count: provider.credentialGroups?.length || (provider.apiKey ? 1 : 0) })}</Text>
                      </View>
                    })}
                    {review.providers.length > previewLimit ? <IsleButton label={t('providerSettings.importShowMore')} onPress={() => setPreviewLimit(value => value + 8)} /> : null}
                    {!review.providers.length ? <Text accessibilityRole="alert" style={{ color: colors.ui.tone.danger.foreground }}>{review.warnings.join('\n') || t('providerSettings.importEmptyMessage')}</Text>
                      : review.warnings.length ? <Text style={{ color: colors.ui.tone.warning.foreground }}>{t('providerSettings.importWarnings', { count: review.warnings.length, duplicates: review.duplicates.length })}</Text> : null}
                    {conflicts ? <View style={{ gap: 6 }}>
                      <Text style={{ color: colors.ui.tone.warning.foreground }}>{t('providerSettings.importConflicts', { count: conflicts })}</Text>
                      <IsleButton label={t('providerSettings.importSkipExisting')} tone={skipExisting ? 'primary' : 'soft'} disabled={importBusy || persistencePending} onPress={() => setSkipExisting(true)} />
                      <IsleButton label={t('providerSettings.importKeepBoth')} tone={!skipExisting ? 'primary' : 'soft'} disabled={importBusy || persistencePending} onPress={() => setSkipExisting(false)} />
                    </View> : null}
                    {review.providers.length > 0 && !importableCount ? <Text style={{ color: colors.ui.tone.warning.foreground }}>{t('providerSettings.importNothingNew')}</Text> : null}
                    <IsleButton label={t('common.edit')} disabled={importBusy || persistencePending} onPress={() => setReview(null)} />
                  </View>}
                </View>
                {input.trim() ? <Text style={{ color: detectedImportCount ? colors.ui.tone.success.foreground : colors.textTertiary, fontSize: 14, lineHeight: 20, marginTop: 8, fontWeight: detectedImportCount ? '900' : '700' }}>
                  {input.trim()
                    ? detectionLimited
                      ? t('providerSettings.importDetectionLimited')
                      : detectedImportCount
                      ? t('providerSettings.importDetected', { count: detectedImportCount })
                      : t('providerSettings.importDetectionEmpty')
                    : null}
                </Text> : null}
              </View>
            </ScrollView>
            <View style={{ minHeight: keyboardVisible ? 56 : IMPORT_FOOTER_HEIGHT, flexDirection: footerCompact ? 'column' : 'row', alignItems: footerCompact ? 'stretch' : 'center', gap: footerCompact ? 8 : 10, paddingHorizontal: modalPadding, paddingTop: keyboardVisible ? 8 : 12, paddingBottom: (keyboardVisible ? 8 : Math.max(insets.bottom, 10) + 10), backgroundColor: footerSurface, borderTopWidth: subtleBorderWidth, borderTopColor: sheetMaterial.divider }}>
                <IsleButton label={t('common.cancel')} compact onPress={closeWithoutSubmit} disabled={importBusy} style={modalActionStyle} />
                <IsleButton
                  label={importBusy ? t('providerSettings.importProgressWorking') : persistencePending ? t('common.retry') : review ? t('providerSettings.import') : t('providerSettings.reviewImport')}
                  compact
                  tone="primary"
                  busy={importBusy}
                  disabled={!input.trim() || importBusy || (Boolean(review) && !importableCount && !persistencePending)}
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
  return composeUserFacingError(t('providerSettings.importFailedMessage'), extractUserFacingErrorDetail(error))
}
