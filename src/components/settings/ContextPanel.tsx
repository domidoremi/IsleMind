import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/ui/AppIcon'
import { describeUserFacingError, extractUserFacingErrorDetail, userFacingErrorDetail } from '@/core'
import type { KnowledgeDocument, LocalRagModelCapability, MemoryItem, RagEvaluationLog, RagIndexingJobStatus } from '@/types/contextContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'
import { importKnowledgeFile, importKnowledgePlainText } from '@/bootstrap/knowledgeDocumentImportRuntime'
import {
  clearKnowledgeRecords,
  deleteKnowledgeDocumentRecords,
  knowledgeRepository,
} from '@/bootstrap/knowledgeRepository'
import {
  deleteDownloadedLocalEmbeddingModel,
  downloadLocalEmbeddingModel,
  formatModelBytes,
  listLocalEmbeddingModelViews,
  type LocalEmbeddingDownloadProgress,
  type LocalEmbeddingModelView,
} from '@/bootstrap/localModelRuntime'
import { clearRagQueryCaches, listRagEmbeddingJobs, loadRagDebugSnapshot, loadRagEmbeddingJobSummary, rebuildRagKnowledgeEmbeddings, runRagGoldEvaluation } from '@/bootstrap/knowledgeRagEvaluation'
import {
  isDownloadableLocalModel,
  localCapabilityEnabled,
  splitLocalModelViews,
  type RagEvaluationRun,
} from '@/modules/knowledge'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import { SEARCH_DIAGNOSTIC_QUERY, SEARCH_PROVIDER_OPTIONS, legacySearchModeForProvider, resolveSearchProvider } from '@/modules/integrations'
import { SEARCH_PROVIDER_CREDENTIAL_FIELDS, searchProviderCredentialPresentation, searchProviderLabel } from '@/presentation/features/settings/searchProviderPresentation'
import { filterAndSortKnowledgeDocuments, filterAndSortMemories, hasKnowledgeAssetFilters, hasMemoryAssetFilters, knowledgeAssetEmptyMessage, memoryAssetEmptyMessage, type KnowledgeSortMode, type KnowledgeStatusFocus, type MemorySortMode, type MemoryStatusFocus } from '@/services/contextAssetFilters'
import { capabilityLabel, formatKnowledgeMeta, formatMemoryMeta, memoryReviewFocusKey } from '@/services/contextAssetFormatters'
import { ISLE_MIN_TOUCH_TARGET, IsleChip, IsleField, IslePressable, IsleProgress, IsleToggle, useIsleDialog } from '@/components/ui/isle'
import { getPolicyPreferredProviderModel } from '@/bootstrap/providerModelAccess'
import { filterPendingMemoriesForReview, buildMemoryReviewSummary, type MemoryReviewQueueFocus } from '@/utils/memoryReview'
import { buildKnowledgeRecoverySummary } from '@/utils/knowledgeRecovery'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'
import { flushPersistedSettings } from '@/presentation/features/settings/settingsStorePersistenceCommand'
import { KnowledgeImportSection } from '@/components/settings/KnowledgeImportSection'
import { runContextSelfTest as runContextSelfTestScenario, type ContextSelfTestStep } from '@/services/contextSelfTest'
import { ContextDiagnosticsSection } from '@/components/settings/ContextDiagnosticsSection'
import { MemoryReviewSection } from '@/components/settings/MemoryReviewSection'
import { SettingsSummaryStrip, type SettingsSummaryItem } from '@/components/settings/SettingsSummaryStrip'
import {
  LiquidGlassContextSettingsLead,
  MaterialContextSettingsLead,
  MinimalContextSettingsLead,
  MonetContextSettingsLead,
} from '@/components/settings/theme-experiences/ContextSettingsExperiences'

interface ContextPanelProps {
  providers: AIProvider[]
  section?: 'all' | 'context' | 'memory' | 'knowledge'
  focus?: 'import' | 'review'
}

interface SelfTestResult {
  ranAt: number
  steps: ContextSelfTestStep[]
}

const contextChipPressableStyle = { minHeight: 44, justifyContent: 'center' as const }
const localModelActionStyle = {
  minHeight: 44,
  paddingHorizontal: 14,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
}
const fullWidthActionStyle = {
  minHeight: 44,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
}
const itemRowActionStyle = {
  minHeight: 44,
  paddingHorizontal: 14,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
}
const memoryPreviewLimit = 6
const knowledgePreviewLimit = 6

async function listMemories(statuses: MemoryItem['status'][]): Promise<MemoryItem[]> {
  return (await knowledgeRepository.listMemories({ statuses })).map(({ schema: _schema, ...memory }) => memory)
}

async function listKnowledgeDocuments(): Promise<KnowledgeDocument[]> {
  return (await knowledgeRepository.listDocuments()).map(({ schema: _schema, ...document }) => document)
}

const updateMemoryStatus = (id: string, status: MemoryItem['status']) => knowledgeRepository.updateMemoryStatus(id, status)
const deleteMemory = (id: string) => knowledgeRepository.deleteMemory(id)
const clearMemories = () => knowledgeRepository.clearMemories()
const deleteKnowledgeDocument = (id: string) => deleteKnowledgeDocumentRecords(id)
const clearKnowledge = () => clearKnowledgeRecords()

function primaryActionSurface(colors: ReturnType<typeof useAppTheme>['colors']) {
  return {
    backgroundColor: colors.ui.control.primaryBackground,
    borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth,
    borderColor: colors.ui.control.primaryBorder,
    borderRadius: Math.min(colors.ui.radius.controlLarge, 8),
  }
}

function secondaryActionSurface(colors: ReturnType<typeof useAppTheme>['colors']) {
  return {
    backgroundColor: colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.limeRoad ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.muted,
    borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth,
    borderColor: colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.limeRoad ? colors.material.stroke : colors.ui.semantic.chrome.border,
    borderRadius: Math.min(colors.ui.radius.controlLarge, 8),
  }
}

function rowActionSurface(colors: ReturnType<typeof useAppTheme>['colors']) {
  return {
    backgroundColor: colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.limeRoad ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.base,
    borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth,
    borderColor: colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.limeRoad ? colors.material.stroke : colors.ui.semantic.chrome.border,
    borderRadius: Math.min(colors.ui.radius.controlMiddle, 8),
  }
}

function assetCardSurface(colors: ReturnType<typeof useAppTheme>['colors'], borderColor = colors.material.stroke) {
  const resolvedBorderColor = colors.ui.limeRoad
    ? borderColor
    : borderColor === colors.material.stroke
      ? colors.ui.glass
        ? colors.ui.actionBar.itemBorder
        : colors.ui.semantic.chrome.border
      : borderColor
  return {
    borderRadius: Math.min(colors.ui.radius.card, 8),
    backgroundColor: colors.ui.glass ? colors.ui.semantic.chrome.background : colors.ui.limeRoad ? colors.ui.semantic.surface.base : colors.ui.semantic.surface.base,
    borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth,
    borderColor: resolvedBorderColor,
    shadowColor: colors.ui.control.shadow,
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  }
}

function countMemoryStatuses(memories: MemoryItem[]) {
  return memories.reduce((counts, memory) => {
    if (memory.status === 'pending') counts.pending += 1
    else if (memory.status === 'active') counts.active += 1
    else if (memory.status === 'disabled') counts.disabled += 1
    return counts
  }, { pending: 0, active: 0, disabled: 0 })
}

function countKnowledgeStatuses(documents: KnowledgeDocument[]) {
  return documents.reduce((counts, document) => {
    if (document.status === 'extracting') counts.indexing += 1
    else if (document.status === 'error') counts.failed += 1
    else if (document.status === 'ready' && document.chunkCount > 0) counts.ready += 1
    else if (document.status === 'ready') counts.empty += 1
    return counts
  }, { ready: 0, indexing: 0, failed: 0, empty: 0 })
}

export function ContextPanel({ providers, section = 'all', focus }: ContextPanelProps) {
  const { colors, canonicalThemeId } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const motion = useMotionPreference()
  const { width } = useWindowDimensions()
  const compact = width < 390
  void providers
  const settings = useSettingsStore((state) => state.settings)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const getTavilyApiKey = useSettingsStore((state) => state.getTavilyApiKey)
  const setTavilyApiKey = useSettingsStore((state) => state.setTavilyApiKey)
  const getGoogleSearchApiKey = useSettingsStore((state) => state.getGoogleSearchApiKey)
  const setGoogleSearchApiKey = useSettingsStore((state) => state.setGoogleSearchApiKey)
  const getBingSearchApiKey = useSettingsStore((state) => state.getBingSearchApiKey)
  const setBingSearchApiKey = useSettingsStore((state) => state.setBingSearchApiKey)
  const getCustomSearchApiKey = useSettingsStore((state) => state.getCustomSearchApiKey)
  const setCustomSearchApiKey = useSettingsStore((state) => state.setCustomSearchApiKey)
  const getPrimaryConfiguredProvider = useSettingsStore((state) => state.getPrimaryConfiguredProvider)
  const [tavilyKey, setTavilyKey] = useState('')
  const [googleSearchKey, setGoogleSearchKey] = useState('')
  const [bingSearchKey, setBingSearchKey] = useState('')
  const [customSearchKey, setCustomSearchKey] = useState('')
  const [googleSearchCxDraft, setGoogleSearchCxDraft] = useState(settings.googleSearchCx ?? '')
  const [customSearchEndpointDraft, setCustomSearchEndpointDraft] = useState(settings.customSearchEndpoint ?? '')
  const [localModelMirrorDraft, setLocalModelMirrorDraft] = useState(settings.localModelDownloadMirrorBaseUrl ?? '')
  const [saved, setSaved] = useState(false)
  const savedResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [embeddingJobs, setEmbeddingJobs] = useState<{ running: number; error: number } | null>(null)
  const [indexingJobs, setIndexingJobs] = useState<RagIndexingJobStatus[]>([])
  const [ragLogs, setRagLogs] = useState<RagEvaluationLog[]>([])
  const [ragEvaluating, setRagEvaluating] = useState(false)
  const [ragEvaluation, setRagEvaluation] = useState<RagEvaluationRun | null>(null)
  const [localModels, setLocalModels] = useState<LocalEmbeddingModelView[]>([])
  const [modelBusyId, setModelBusyId] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<LocalEmbeddingDownloadProgress | null>(null)
  const [rebuilding, setRebuilding] = useState(false)
  const [importing, setImporting] = useState(false)
  const importControllerRef = useRef<AbortController | null>(null)
  const [selfTesting, setSelfTesting] = useState(false)
  const selfTestControllerRef = useRef<AbortController | null>(null)
  const [confirmingMemories, setConfirmingMemories] = useState(false)
  const [showAllMemories, setShowAllMemories] = useState(false)
  const [showAllKnowledge, setShowAllKnowledge] = useState(false)
  const [memoryFilter, setMemoryFilter] = useState('')
  const [knowledgeFilter, setKnowledgeFilter] = useState('')
  const [memoryStatusFocus, setMemoryStatusFocus] = useState<MemoryStatusFocus>('all')
  const [memoryReviewFocus, setMemoryReviewFocus] = useState<MemoryReviewQueueFocus>('all')
  const [knowledgeStatusFocus, setKnowledgeStatusFocus] = useState<KnowledgeStatusFocus>('all')
  const [memorySortMode, setMemorySortMode] = useState<MemorySortMode>('updated')
  const [knowledgeSortMode, setKnowledgeSortMode] = useState<KnowledgeSortMode>('updated')
  const [selfTestResult, setSelfTestResult] = useState<SelfTestResult | null>(null)
  const [plainTitle, setPlainTitle] = useState('')
  const [plainText, setPlainText] = useState('')
  const [activeContextSection, setActiveContextSection] = useState<'search' | 'rag' | 'credentials' | null>(null)
  const [ragTechniquesOpen, setRagTechniquesOpen] = useState(false)
  const [localModelsOpen, setLocalModelsOpen] = useState(false)
  const [knowledgeToolsOpen, setKnowledgeToolsOpen] = useState(false)
  const showContext = section === 'all' || section === 'context'
  const showMemory = section === 'all' || section === 'memory'
  const showKnowledge = section === 'all' || section === 'knowledge'
  const shouldPromoteKnowledgeImport = showKnowledge && section === 'knowledge' && focus === 'import'
  const pendingMemories = useMemo(() => memories.filter((memory) => memory.status === 'pending'), [memories])
  const memoryReviewSummary = useMemo(() => buildMemoryReviewSummary(memories), [memories])
  const memoryStatusCounts = useMemo(() => countMemoryStatuses(memories), [memories])
  const knowledgeStatusCounts = useMemo(() => countKnowledgeStatuses(documents), [documents])
  const knowledgeRecoverySummary = useMemo(() => buildKnowledgeRecoverySummary(documents, indexingJobs), [documents, indexingJobs])
  const sortedMemories = useMemo(() => filterAndSortMemories(memories, {
    statusFocus: memoryStatusFocus,
    reviewFocus: memoryReviewFocus,
    filter: memoryFilter,
    sortMode: memorySortMode,
  }), [memories, memoryFilter, memoryReviewFocus, memorySortMode, memoryStatusFocus])
  const sortedDocuments = useMemo(() => filterAndSortKnowledgeDocuments(documents, {
    statusFocus: knowledgeStatusFocus,
    filter: knowledgeFilter,
    sortMode: knowledgeSortMode,
  }), [documents, knowledgeFilter, knowledgeSortMode, knowledgeStatusFocus])

  useEffect(() => () => {
    importControllerRef.current?.abort()
    importControllerRef.current = null
    selfTestControllerRef.current?.abort()
    selfTestControllerRef.current = null
    if (savedResetTimerRef.current) clearTimeout(savedResetTimerRef.current)
    savedResetTimerRef.current = null
  }, [])
  useEffect(() => setGoogleSearchCxDraft(settings.googleSearchCx ?? ''), [settings.googleSearchCx])
  useEffect(() => setCustomSearchEndpointDraft(settings.customSearchEndpoint ?? ''), [settings.customSearchEndpoint])
  useEffect(() => setLocalModelMirrorDraft(settings.localModelDownloadMirrorBaseUrl ?? ''), [settings.localModelDownloadMirrorBaseUrl])
  const filteredMemories = sortedMemories
  const filteredDocuments = sortedDocuments
  const visibleMemories = showAllMemories ? sortedMemories : sortedMemories.slice(0, memoryPreviewLimit)
  const visibleDocuments = showAllKnowledge ? sortedDocuments : sortedDocuments.slice(0, knowledgePreviewLimit)
  const hasMemoryFilters = hasMemoryAssetFilters(memoryStatusFocus, memoryReviewFocus, memoryFilter)
  const hasKnowledgeFilters = hasKnowledgeAssetFilters(knowledgeStatusFocus, knowledgeFilter)
  const filteredPendingMemories = useMemo(() => sortedMemories.filter((memory) => memory.status === 'pending'), [sortedMemories])
  const canConfirmFilteredMemories = hasMemoryFilters && filteredPendingMemories.length > 0 && filteredPendingMemories.length < pendingMemories.length
  const canRejectFilteredMemories = (hasMemoryFilters || memoryReviewFocus !== 'all') && filteredPendingMemories.length > 0
  const memoryEmptyMessage = memoryAssetEmptyMessage(memoryStatusFocus, memoryFilter, t)
  const knowledgeEmptyMessage = knowledgeAssetEmptyMessage(knowledgeStatusFocus, knowledgeFilter, t)
  const { downloadable: downloadableLocalModels, planned: plannedLocalCapabilities } = useMemo(() => splitLocalModelViews(localModels), [localModels])
  const searchProvider = resolveSearchProvider(settings)
  const searchCredentialPresentation = searchProviderCredentialPresentation(searchProvider)
  const searchCredentialsAvailable = searchCredentialPresentation.fields.length > 0
    || searchCredentialPresentation.showEndpoint
    || searchCredentialPresentation.showBearerKey
  const searchCredentialsConfiguredCount = [
    ...searchCredentialPresentation.fields.map((field) => searchCredentialFieldValue(field.id)),
    ...(searchCredentialPresentation.showEndpoint ? [customSearchEndpointDraft] : []),
    ...(searchCredentialPresentation.showBearerKey ? [customSearchKey] : []),
  ].filter((value) => value?.trim()).length
  const searchProviderOpen = activeContextSection === 'search'
  const searchCredentialsExpanded = activeContextSection === 'credentials'
  const ragSettingsExpanded = activeContextSection === 'rag'
  const ragSettingsSummary = [
    (settings.ragMode ?? 'hybrid') === 'hybrid' ? t('contextPanel.ragHybrid') : (settings.ragMode ?? 'hybrid') === 'fts' ? t('contextPanel.ragFts') : t('contextPanel.ragOff'),
    t(`contextPanel.ragProfiles.${settings.ragProfile ?? 'balanced'}`),
    (settings.embeddingMode ?? 'hybrid') === 'hybrid' ? t('contextPanel.embeddingHybrid') : (settings.embeddingMode ?? 'hybrid') === 'provider' ? t('contextPanel.embeddingProvider') : t('contextPanel.embeddingLocal'),
  ].join(' · ')
  const enabledTechniqueCount = [
    settings.ragQueryRewriteEnabled !== false,
    settings.ragHydeEnabled !== false,
    settings.ragFlareEnabled !== false,
    settings.ragCrossEncoderEnabled !== false,
    settings.ragLlmlinguaEnabled !== false,
    settings.ragRaptorEnabled !== false,
    settings.ragGraphEnabled !== false,
    settings.ragColbertEnabled !== false,
  ].filter(Boolean).length
  const activeLocalModelCount = localModels.filter((model) => model.active).length
  const contextSummaryItems: SettingsSummaryItem[] = [
    ...(showMemory && (memories.length || memoryStatusCounts.pending || !settings.memoryEnabled) ? [{
      key: 'memory',
      label: t('settings.longMemory'),
      value: String(memoryStatusCounts.active),
      detail: `${t('contextPanel.memoryPendingCount')} ${memoryStatusCounts.pending} · ${t('contextPanel.memoryDisabledCount')} ${memoryStatusCounts.disabled}`,
      icon: <AppIcon name="memory-brain" color={colors.textTertiary} size={15} />,
      tone: settings.memoryEnabled ? 'mint' as const : 'default' as const,
    }] : []),
    ...(showKnowledge && (documents.length || knowledgeStatusCounts.failed || knowledgeStatusCounts.empty || !settings.knowledgeEnabled) ? [{
      key: 'knowledge',
      label: t('settings.localKnowledge'),
      value: String(knowledgeStatusCounts.ready),
      detail: `${t('contextPanel.knowledgeStatusIndexing')} ${knowledgeStatusCounts.indexing} · ${t('contextPanel.knowledgeStatusFailed')} ${knowledgeStatusCounts.failed}`,
      icon: <AppIcon name="knowledge-database" color={colors.textTertiary} size={15} />,
      tone: knowledgeStatusCounts.failed ? 'danger' as const : settings.knowledgeEnabled ? 'mint' as const : 'default' as const,
    }] : []),
    ...(showContext && (settings.webSearchEnabled || searchProvider !== 'off' || searchCredentialsConfiguredCount > 0) ? [{
      key: 'search',
      label: t('settings.webSearch'),
      value: searchProvider === 'off' ? t('settings.searchOff') : searchProviderLabel(searchProvider),
      detail: settings.webSearchEnabled ? t('settings.enabledState') : t('settings.disabledState'),
      icon: <AppIcon name="context-globe" color={colors.textTertiary} size={15} />,
      tone: settings.webSearchEnabled && searchProvider !== 'off' ? 'mint' as const : 'amber' as const,
    }] : []),
    ...(showContext && ((settings.ragMode ?? 'hybrid') !== 'hybrid' || activeLocalModelCount > 0 || enabledTechniqueCount < 8 || Boolean(embeddingJobs?.running) || Boolean(embeddingJobs?.error)) ? [{
      key: 'rag',
      label: t('contextPanel.ragMode'),
      value: (settings.ragMode ?? 'hybrid') === 'hybrid' ? t('contextPanel.ragHybrid') : (settings.ragMode ?? 'hybrid') === 'fts' ? t('contextPanel.ragFts') : t('contextPanel.ragOff'),
      detail: t('contextPanel.overviewRagDetail', { count: enabledTechniqueCount, models: activeLocalModelCount }),
      icon: <AppIcon name="search-check" color={colors.textTertiary} size={15} />,
      tone: (settings.ragMode ?? 'hybrid') === 'off' ? 'amber' as const : 'mint' as const,
    }] : []),
  ]
  const knowledgeToolsVisible = knowledgeToolsOpen || hasKnowledgeFilters || knowledgeStatusCounts.failed > 0 || knowledgeStatusCounts.empty > 0 || knowledgeRecoverySummary.recoverableDocuments > 0 || knowledgeRecoverySummary.failedJobs > 0
  const isMinimal = canonicalThemeId === 'minimal'
  const isMaterial = canonicalThemeId === 'material'
  const isMonet = canonicalThemeId === 'monet'
  const isLiquidGlass = canonicalThemeId === 'liquid-glass'
  const subtleBorderWidth = isMinimal ? StyleSheet.hairlineWidth : 1
  const foldoutPanelStyle = {
    borderRadius: isMaterial ? 4 : isLiquidGlass ? colors.ui.radius.panel : Math.min(colors.ui.radius.card, 8),
    padding: compact ? 10 : 11,
    backgroundColor: isMinimal ? 'transparent' : isLiquidGlass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted,
    borderWidth: isMinimal ? 0 : subtleBorderWidth,
    borderTopWidth: isMinimal ? StyleSheet.hairlineWidth : undefined,
    borderBottomWidth: isMinimal ? StyleSheet.hairlineWidth : undefined,
    borderLeftWidth: isMaterial ? 3 : undefined,
    borderColor: isLiquidGlass ? colors.ui.actionBar.itemBorder : isMaterial ? colors.ui.section.divider : isMonet ? colors.material.stroke : colors.ui.semantic.chrome.border,
    ...(isLiquidGlass ? {
      shadowColor: colors.ui.control.shadow,
      shadowOpacity: 0.16,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 2,
    } : {}),
  } as const

  async function refresh() {
    const [memoryItems, documentItems, jobs, debug] = await Promise.all([
      listMemories(['pending', 'active', 'disabled']),
      listKnowledgeDocuments(),
      loadRagEmbeddingJobSummary(50),
      loadRagDebugSnapshot(),
    ])
    setMemories(memoryItems)
    setDocuments(documentItems)
    setEmbeddingJobs({
      running: jobs.running,
      error: jobs.error,
    })
    setIndexingJobs(debug.indexingJobs)
    setRagLogs(debug.evaluations)
    setLocalModels(await listLocalEmbeddingModelViews(useSettingsStore.getState().settings))
  }

  function resetMemoryAssetView() {
    setMemoryFilter('')
    setMemoryStatusFocus('all')
    setMemoryReviewFocus('all')
    setShowAllMemories(false)
    setMemorySortMode('updated')
  }

  function resetKnowledgeAssetView() {
    setKnowledgeFilter('')
    setKnowledgeStatusFocus('all')
    setShowAllKnowledge(false)
    setKnowledgeSortMode('updated')
  }

  function focusKnowledgeRecovery(status: Exclude<KnowledgeStatusFocus, 'all' | 'ready' | 'extracting'>) {
    setKnowledgeStatusFocus(status)
    setKnowledgeSortMode('needsReview')
    setKnowledgeFilter('')
    setShowAllKnowledge(true)
  }

  async function confirmPendingMemories(targetMemories: MemoryItem[] = pendingMemories, filtered = false) {
    if (!targetMemories.length || confirmingMemories) return
    const confirmed = await dialog.confirm({
      title: t(filtered ? 'contextPanel.confirmFilteredPendingMemoriesTitle' : 'contextPanel.confirmPendingMemoriesTitle', { count: targetMemories.length }),
      message: t('contextPanel.confirmPendingMemoriesMessage'),
      confirmLabel: t(filtered ? 'contextPanel.confirmFilteredPendingMemories' : 'contextPanel.confirmPendingMemories', { count: targetMemories.length }),
      cancelLabel: t('common.cancel'),
      tone: 'mint',
    })
    if (!confirmed) return
    setConfirmingMemories(true)
    try {
      await Promise.all(targetMemories.map((memory) => updateMemoryStatus(memory.id, 'active')))
      await refresh()
      dialog.toast({
        title: t('contextPanel.pendingMemoriesConfirmed', { count: targetMemories.length }),
        tone: 'mint',
      })
    } finally {
      setConfirmingMemories(false)
    }
  }

  async function rejectPendingMemories(targetMemories: MemoryItem[] = filteredPendingMemories) {
    if (!targetMemories.length || confirmingMemories) return
    const confirmed = await dialog.confirm({
      title: t('contextPanel.rejectFilteredPendingMemoriesTitle', { count: targetMemories.length }),
      message: t('contextPanel.rejectFilteredPendingMemoriesMessage'),
      confirmLabel: t('contextPanel.rejectFilteredPendingMemories', { count: targetMemories.length }),
      cancelLabel: t('common.cancel'),
      tone: 'danger',
    })
    if (!confirmed) return
    setConfirmingMemories(true)
    try {
      await Promise.all(targetMemories.map((memory) => deleteMemory(memory.id)))
      await refresh()
      dialog.toast({
        title: t('contextPanel.pendingMemoriesRejected', { count: targetMemories.length }),
        tone: 'amber',
      })
    } finally {
      setConfirmingMemories(false)
    }
  }

  useEffect(() => {
    void getTavilyApiKey().then((key) => setTavilyKey(key ?? ''))
    void getGoogleSearchApiKey().then((key) => setGoogleSearchKey(key ?? ''))
    void getBingSearchApiKey().then((key) => setBingSearchKey(key ?? ''))
    void getCustomSearchApiKey().then((key) => setCustomSearchKey(key ?? ''))
    void refresh()
  }, [getBingSearchApiKey, getCustomSearchApiKey, getGoogleSearchApiKey, getTavilyApiKey])

  useEffect(() => {
    if (section !== 'memory' || focus !== 'review') return
    setMemoryStatusFocus('pending')
    setMemoryReviewFocus('imported')
    setMemorySortMode('updated')
    setShowAllMemories(true)
  }, [focus, section])

  async function saveTavilyKey() {
    const nextGoogleSearchCx = googleSearchCxDraft.trim()
    const nextCustomSearchEndpoint = customSearchEndpointDraft.trim()
    await Promise.all([
      setTavilyApiKey(tavilyKey.trim()),
      setGoogleSearchApiKey(googleSearchKey.trim()),
      setBingSearchApiKey(bingSearchKey.trim()),
      setCustomSearchApiKey(customSearchKey.trim()),
    ])
    const settingsUpdates: Partial<Pick<Settings, 'googleSearchCx' | 'customSearchEndpoint'>> = {}
    if ((settings.googleSearchCx ?? '') !== nextGoogleSearchCx) settingsUpdates.googleSearchCx = nextGoogleSearchCx
    if ((settings.customSearchEndpoint ?? '') !== nextCustomSearchEndpoint) settingsUpdates.customSearchEndpoint = nextCustomSearchEndpoint
    if (Object.keys(settingsUpdates).length) {
      updateSettings(settingsUpdates)
      await flushPersistedSettings()
    }

    if (savedResetTimerRef.current) clearTimeout(savedResetTimerRef.current)
    setSaved(true)
    savedResetTimerRef.current = setTimeout(() => {
      savedResetTimerRef.current = null
      setSaved(false)
    }, 1408)
  }

  function commitLocalModelMirror() {
    const nextMirrorBaseUrl = localModelMirrorDraft.trim()
    if ((settings.localModelDownloadMirrorBaseUrl ?? '') === nextMirrorBaseUrl) return
    updateSettings({ localModelDownloadMirrorBaseUrl: nextMirrorBaseUrl })
  }

  function markSearchConfigEdited() {
    if (savedResetTimerRef.current) clearTimeout(savedResetTimerRef.current)
    savedResetTimerRef.current = null
    setSaved(false)
  }

  function toggleContextSection(sectionId: 'search' | 'rag' | 'credentials') {
    setActiveContextSection((current) => current === sectionId ? null : sectionId)
  }

  function selectSearchProvider(provider: typeof SEARCH_PROVIDER_OPTIONS[number]) {
    updateSettings({ searchProvider: provider, webSearchMode: legacySearchModeForProvider(provider), webSearchEnabled: provider !== 'off' })
    const credentials = searchProviderCredentialPresentation(provider)
    setActiveContextSection(credentials.fields.length || credentials.showEndpoint || credentials.showBearerKey ? 'credentials' : 'search')
  }

  function searchCredentialFieldValue(fieldId: typeof SEARCH_PROVIDER_CREDENTIAL_FIELDS[number]['id']): string {
    switch (fieldId) {
      case 'tavilyApiKey':
        return tavilyKey
      case 'googleSearchApiKey':
        return googleSearchKey
      case 'googleSearchCx':
        return googleSearchCxDraft
      case 'bingSearchApiKey':
        return bingSearchKey
    }
  }

  function searchCredentialFieldUpdater(fieldId: typeof SEARCH_PROVIDER_CREDENTIAL_FIELDS[number]['id']): (value: string) => void {
    switch (fieldId) {
      case 'tavilyApiKey':
        return (value) => {
          markSearchConfigEdited()
          setTavilyKey(value)
        }
      case 'googleSearchApiKey':
        return (value) => {
          markSearchConfigEdited()
          setGoogleSearchKey(value)
        }
      case 'googleSearchCx':
        return (value) => {
          markSearchConfigEdited()
          setGoogleSearchCxDraft(value)
        }
      case 'bingSearchApiKey':
        return (value) => {
          markSearchConfigEdited()
          setBingSearchKey(value)
        }
    }
  }

  async function importFile() {
    if (importControllerRef.current) return
    const controller = new AbortController()
    importControllerRef.current = controller
    setImporting(true)
    try {
      const provider = await getPrimaryConfiguredProvider()
      if (controller.signal.aborted) return
      const model = provider ? getPolicyPreferredProviderModel(provider, settings) : undefined
      const result = await importKnowledgeFile(provider ?? undefined, model, { signal: controller.signal })
      dialog.toast({ title: result.ok ? t('contextPanel.knowledgeUpdated') : t('settings.importSkipped'), message: result.message, tone: result.ok ? 'mint' : 'amber' })
      await refresh()
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return
      throw error
    } finally {
      if (importControllerRef.current === controller) {
        importControllerRef.current = null
        if (!controller.signal.aborted) setImporting(false)
      }
    }
  }

  async function importPlainText() {
    if (importControllerRef.current) return
    const controller = new AbortController()
    importControllerRef.current = controller
    setImporting(true)
    try {
      const provider = await getPrimaryConfiguredProvider()
      if (controller.signal.aborted) return
      const result = await importKnowledgePlainText(plainTitle, plainText, provider ?? undefined, { signal: controller.signal })
      dialog.toast({ title: result.ok ? t('contextPanel.knowledgeUpdated') : t('settings.importSkipped'), message: result.message, tone: result.ok ? 'mint' : 'amber' })
      if (result.ok) setPlainText('')
      await refresh()
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return
      throw error
    } finally {
      if (importControllerRef.current === controller) {
        importControllerRef.current = null
        if (!controller.signal.aborted) setImporting(false)
      }
    }
  }

  async function runContextSelfTest() {
    if (selfTesting) return
    const controller = new AbortController()
    selfTestControllerRef.current = controller
    setSelfTesting(true)
    try {
      const result = await runContextSelfTestScenario({
        settings,
        primaryProvider: await getPrimaryConfiguredProvider(),
        getTavilyApiKey,
        t,
        signal: controller.signal,
        onStep: (step: ContextSelfTestStep) => setSelfTestResult((current) => ({
          ranAt: current?.ranAt ?? Date.now(),
          steps: [...(current?.steps ?? []), step],
        })),
      })
      dialog.notice({
        title: result.fail ? t('contextPanel.selfTest.doneWithIssues') : t('contextPanel.selfTest.done'),
        message: t('contextPanel.selfTest.summary', { ok: result.ok, warn: result.warn, fail: result.fail }),
        tone: result.fail ? 'danger' : result.warn ? 'amber' : 'mint',
      })
      await refresh()
    } catch (error) {
      if (controller.signal.aborted) return
      setSelfTestResult((current) => ({
        ranAt: current?.ranAt ?? Date.now(),
        steps: [
          ...(current?.steps ?? []),
          {
        name: t('contextPanel.selfTest.exception'),
        status: 'fail',
        detail: describeUserFacingError(error, t, { headlineKey: 'contextPanel.selfTest.failed' }),
          },
        ],
      }))
      dialog.notice({
        title: t('contextPanel.selfTest.doneWithIssues'),
        message: describeUserFacingError(error, t, { headlineKey: 'contextPanel.selfTest.failed' }),
        tone: 'danger',
      })
    } finally {
      if (selfTestControllerRef.current === controller) {
        selfTestControllerRef.current = null
        if (!controller.signal.aborted) setSelfTesting(false)
      }
    }
  }

  async function runRagEvaluation() {
    if (ragEvaluating) return
    setRagEvaluating(true)
    try {
      const result = await runRagGoldEvaluation(useSettingsStore.getState().settings, { title: 'RAG evaluation', systemPrompt: '' })
      setRagEvaluation(result)
      dialog.notice({
        title: t('contextPanel.ragDebug.evaluationDone'),
        message: t('contextPanel.ragDebug.evaluationSummary', {
          confidence: Math.round(result.averageConfidence * 100),
          citation: Math.round(result.averageCitationCoverage * 100),
          precision: Math.round(result.averageContextPrecision * 100),
        }),
        tone: 'mint',
      })
      await refresh()
    } catch (error) {
      dialog.notice({ title: t('contextPanel.ragDebug.evaluationFailed'), message: userFacingErrorDetail(error) || t('contextPanel.localModel.unknownError'), tone: 'danger' })
    } finally {
      setRagEvaluating(false)
    }
  }

  async function enableLocalModel(view: LocalEmbeddingModelView) {
    if (view.source === 'none') return
    updateSettings({
      embeddingMode: settings.embeddingMode === 'provider' ? 'hybrid' : settings.embeddingMode,
      localEmbeddingModelId: view.model.id,
      localEmbeddingModelSource: view.source,
    })
    dialog.toast({ title: t('contextPanel.localModel.enabled'), message: view.model.name, tone: 'mint' })
    await refresh()
  }

  async function downloadModel(view: LocalEmbeddingModelView) {
    if (!view.model.files.length || view.model.sizeBytes <= 0) {
      showLocalModelDetails(view)
      return
    }
    const confirmed = await dialog.confirm({
      title: t('contextPanel.localModel.downloadConfirmTitle'),
      message: t('contextPanel.localModel.downloadConfirmMessage', { name: view.model.name, size: formatModelBytes(view.model.sizeBytes) }),
      confirmLabel: t('contextPanel.localModel.download'),
      cancelLabel: t('common.cancel'),
      tone: 'amber',
    })
    if (!confirmed) return
    setModelBusyId(view.model.id)
    setDownloadProgress(null)
    try {
      await downloadLocalEmbeddingModel(view.model.id, {
        mirrorBaseUrl: settings.localModelDownloadMirrorBaseUrl,
        onProgress: (progress) => setDownloadProgress(progress),
      })
      updateSettings({
        embeddingMode: settings.embeddingMode === 'provider' ? 'hybrid' : settings.embeddingMode,
        localEmbeddingModelId: view.model.id,
        localEmbeddingModelSource: 'downloaded',
      })
      dialog.notice({ title: t('contextPanel.localModel.downloaded'), message: view.model.name, tone: 'mint' })
    } catch (error) {
      dialog.notice({ title: t('contextPanel.localModel.downloadFailed'), message: t('contextPanel.localModel.downloadFailedDetail', { error: extractUserFacingErrorDetail(error) || t('contextPanel.localModel.unknownError') }), tone: 'danger' })
    } finally {
      setModelBusyId(null)
      setDownloadProgress(null)
      await refresh()
    }
  }

  function showLocalModelDetails(view: LocalEmbeddingModelView) {
    dialog.notice({
      title: t('contextPanel.localModel.statusPlaceholder'),
      message: t('contextPanel.localModel.placeholderMessage', {
        name: view.model.name,
        publisher: view.model.publisher ?? view.model.upstreamModel ?? '-',
        license: view.model.license ?? '-',
      }),
      tone: 'amber',
    })
  }

  async function deleteModel(view: LocalEmbeddingModelView) {
    const confirmed = await dialog.confirm({
      title: t('contextPanel.localModel.deleteConfirmTitle'),
      message: t('contextPanel.localModel.deleteConfirmMessage', { name: view.model.name }),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      tone: 'danger',
    })
    if (!confirmed) return
    setModelBusyId(view.model.id)
    try {
      await deleteDownloadedLocalEmbeddingModel(view.model.id)
      if (settings.localEmbeddingModelId === view.model.id && settings.localEmbeddingModelSource === 'downloaded') {
        updateSettings({ localEmbeddingModelId: undefined, localEmbeddingModelSource: 'none' })
      }
      dialog.toast({ title: t('contextPanel.localModel.deleted'), message: view.model.name, tone: 'mint' })
    } finally {
      setModelBusyId(null)
      await refresh()
    }
  }

  async function rebuildIndex() {
    setRebuilding(true)
    try {
      const provider = await getPrimaryConfiguredProvider()
      const count = await rebuildRagKnowledgeEmbeddings({ provider: provider ?? undefined, embeddingMode: settings.embeddingMode ?? 'hybrid', localEmbeddingModelId: settings.localEmbeddingModelId, localEmbeddingModelSource: settings.localEmbeddingModelSource })
      dialog.notice({ title: t('contextPanel.localModel.rebuildDone'), message: t('contextPanel.localModel.rebuildDoneMessage', { count }), tone: 'mint' })
      await refresh()
    } catch (error) {
      dialog.notice({ title: t('contextPanel.localModel.rebuildFailed'), message: userFacingErrorDetail(error) || t('contextPanel.localModel.unknownError'), tone: 'danger' })
    } finally {
      setRebuilding(false)
    }
  }

  const knowledgeImportControls = showKnowledge ? (
    <KnowledgeImportSection
      importing={importing}
      plainTitle={plainTitle}
      plainText={plainText}
      onPlainTitleChange={setPlainTitle}
      onPlainTextChange={setPlainText}
      onImportFile={() => void importFile()}
      onImportPlainText={() => void importPlainText()}
    />
  ) : null

  const summary = contextSummaryItems.length ? <SettingsSummaryStrip items={contextSummaryItems} /> : undefined
  const toggles = (
      <View style={{ gap: isMinimal ? 0 : 8, marginTop: isMinimal ? 0 : 10 }}>
        {showMemory ? (
          <IsleToggle
            icon={<AppIcon name="reasoning" color={colors.text} size={18} />}
            title={t('settings.longMemory')}
            active={!!settings.memoryEnabled}
            onPress={() => updateSettings({ memoryEnabled: !settings.memoryEnabled })}
          />
        ) : null}
        {showKnowledge ? (
          <IsleToggle
            icon={<AppIcon name="knowledge" color={colors.text} size={18} />}
            title={t('settings.localKnowledge')}
            active={!!settings.knowledgeEnabled}
            onPress={() => updateSettings({ knowledgeEnabled: !settings.knowledgeEnabled })}
          />
        ) : null}
        {showContext ? (
          <IsleToggle
            icon={<AppIcon name="globe" color={colors.text} size={18} />}
            title={t('settings.webSearch')}
            active={!!settings.webSearchEnabled}
            onPress={() => updateSettings({ webSearchEnabled: !settings.webSearchEnabled })}
          />
        ) : null}
        {showContext ? (
          <IsleToggle
            icon={<AppIcon name="reasoning" color={colors.text} size={18} />}
            title={t('settings.modelContextCompression')}
            description={t('settings.modelContextCompressionHint')}
            active={!!settings.modelContextCompressionEnabled}
            onPress={() => updateSettings({ modelContextCompressionEnabled: !settings.modelContextCompressionEnabled })}
          />
        ) : null}
      </View>
  )
  const Lead = canonicalThemeId === 'monet'
    ? MonetContextSettingsLead
    : canonicalThemeId === 'material'
      ? MaterialContextSettingsLead
      : canonicalThemeId === 'liquid-glass'
        ? LiquidGlassContextSettingsLead
        : MinimalContextSettingsLead
  return (
    <View style={{ paddingBottom: showKnowledge ? 12 : 0 }}>
      <Lead section={section} summary={summary} toggles={toggles} compact={compact} />

      {showContext ? (
        <View style={{ marginTop: 10 }}>
        <IslePressable
          haptic
          accessibilityRole="button"
          accessibilityLabel={`${t('settings.search')}. ${searchProviderLabel(searchProvider)}`}
          accessibilityState={{ expanded: searchProviderOpen }}
          onPress={() => toggleContextSection('search')}
            style={{ minHeight: ISLE_MIN_TOUCH_TARGET, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, ...secondaryActionSurface(colors) }}
          >
            <AppIcon name="context-globe" color={colors.textTertiary} size={16} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 17, fontWeight: '800' }}>{t('settings.search')}</Text>
              <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, marginTop: 1 }}>{searchProviderLabel(searchProvider)} · {settings.webSearchEnabled ? t('settings.enabledState') : t('settings.disabledState')}</Text>
            </View>
            <MotiView animate={{ rotate: searchProviderOpen ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 160 }}>
              <AppIcon name="collapse" color={colors.textTertiary} size={16} />
            </MotiView>
          </IslePressable>
          {searchProviderOpen ? (
            <MotiView from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 144 }}>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                {SEARCH_PROVIDER_OPTIONS.map((mode) => (
                  <IslePressable key={mode} haptic accessibilityLabel={searchProviderLabel(mode)} accessibilityState={{ selected: searchProvider === mode }} onPress={() => selectSearchProvider(mode)} style={contextChipPressableStyle}>
                    <IsleChip active={searchProvider === mode}>{searchProviderLabel(mode)}</IsleChip>
                  </IslePressable>
                ))}
              </View>
            </MotiView>
          ) : null}
        </View>
      ) : null}

      {shouldPromoteKnowledgeImport ? knowledgeImportControls : null}

      {showContext ? (
        <View style={{ marginTop: 10 }}>
        <IslePressable
          haptic
          accessibilityRole="button"
          accessibilityLabel={`${t('contextPanel.ragMode')}. ${ragSettingsSummary}`}
          accessibilityState={{ expanded: ragSettingsExpanded }}
          onPress={() => toggleContextSection('rag')}
            style={{ minHeight: ISLE_MIN_TOUCH_TARGET, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, ...secondaryActionSurface(colors) }}
          >
            <AppIcon name="search-check" color={colors.textTertiary} size={16} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 17, fontWeight: '800' }}>{t('contextPanel.ragMode')}</Text>
              <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, marginTop: 1 }}>{ragSettingsSummary}</Text>
            </View>
            <MotiView animate={{ rotate: ragSettingsExpanded ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 160 }}>
              <AppIcon name="collapse" color={colors.textTertiary} size={16} />
            </MotiView>
          </IslePressable>
          {ragSettingsExpanded ? (
            <MotiView from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 144 }} style={{ marginTop: 8, ...foldoutPanelStyle }}>
              <ContextFoldoutHeader title={t('contextPanel.ragMode')} detail={ragSettingsSummary} />
        {embeddingJobs ? (
          <Text style={{ color: embeddingJobs.error ? colors.ui.tone.warning.foreground : colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 6 }}>
            {t('contextPanel.embeddingStatus', { running: embeddingJobs.running, failed: embeddingJobs.error })}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {(['hybrid', 'fts', 'off'] as const).map((mode) => (
            <IslePressable key={mode} haptic accessibilityLabel={mode === 'hybrid' ? t('contextPanel.ragHybrid') : mode === 'fts' ? t('contextPanel.ragFts') : t('contextPanel.ragOff')} accessibilityState={{ selected: (settings.ragMode ?? 'hybrid') === mode }} onPress={() => updateSettings({ ragMode: mode })} style={contextChipPressableStyle}>
              <IsleChip active={(settings.ragMode ?? 'hybrid') === mode}>{mode === 'hybrid' ? t('contextPanel.ragHybrid') : mode === 'fts' ? t('contextPanel.ragFts') : t('contextPanel.ragOff')}</IsleChip>
            </IslePressable>
          ))}
        </View>
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '800', marginTop: 10 }}>{t('contextPanel.ragProfile')}</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {(['fast', 'balanced', 'deep', 'offline'] as const).map((profile) => (
            <IslePressable key={profile} haptic accessibilityLabel={t(`contextPanel.ragProfiles.${profile}`)} accessibilityState={{ selected: (settings.ragProfile ?? 'balanced') === profile }} onPress={() => updateSettings({ ragProfile: profile })} style={contextChipPressableStyle}>
              <IsleChip active={(settings.ragProfile ?? 'balanced') === profile}>{t(`contextPanel.ragProfiles.${profile}`)}</IsleChip>
            </IslePressable>
          ))}
        </View>
        <IslePressable
          haptic
          accessibilityRole="button"
          accessibilityLabel={`${t('contextPanel.agenticTechniques')}. ${t('contextPanel.agenticTechniquesCollapsedDetail', { count: enabledTechniqueCount })}`}
          accessibilityState={{ expanded: ragTechniquesOpen }}
          onPress={() => setRagTechniquesOpen((value) => !value)}
          style={{ marginTop: 10, minHeight: ISLE_MIN_TOUCH_TARGET, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, ...secondaryActionSurface(colors) }}
        >
          <AppIcon name="workflow" color={colors.textTertiary} size={16} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 17, fontWeight: '800' }}>{t('contextPanel.agenticTechniques')}</Text>
            <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, marginTop: 1 }}>{t('contextPanel.agenticTechniquesCollapsedDetail', { count: enabledTechniqueCount })}</Text>
          </View>
          <MotiView animate={{ rotate: ragTechniquesOpen ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 160 }}>
            <AppIcon name="collapse" color={colors.textTertiary} size={16} />
          </MotiView>
        </IslePressable>
        {ragTechniquesOpen ? (
          <MotiView from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 144 }}>
            <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 10 }}>
              {t('contextPanel.agenticTechniquesHelp')}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              {[
                ['ragQueryRewriteEnabled', 'queryRewrite'],
                ['ragHydeEnabled', 'hyde'],
                ['ragFlareEnabled', 'flare'],
                ['ragCrossEncoderEnabled', 'crossEncoder'],
                ['ragLlmlinguaEnabled', 'llmlingua'],
                ['ragRaptorEnabled', 'raptor'],
                ['ragGraphEnabled', 'graph'],
                ['ragColbertEnabled', 'colbert'],
              ].map(([key, label]) => {
                const settingKey = key as keyof Pick<Settings, 'ragQueryRewriteEnabled' | 'ragHydeEnabled' | 'ragFlareEnabled' | 'ragCrossEncoderEnabled' | 'ragLlmlinguaEnabled' | 'ragRaptorEnabled' | 'ragGraphEnabled' | 'ragColbertEnabled'>
                const active = settings[settingKey] !== false
                return (
                <IslePressable key={key} haptic accessibilityRole="checkbox" accessibilityLabel={t(`contextPanel.techniques.${label}`)} accessibilityState={{ checked: active }} onPress={() => updateSettings({ [settingKey]: !settings[settingKey] })} style={contextChipPressableStyle}>
                  <IsleChip active={active}>{t(`contextPanel.techniques.${label}`)}</IsleChip>
                </IslePressable>
                )
              })}
            </View>
          </MotiView>
        ) : null}
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '800', marginTop: 10 }}>{t('contextPanel.embeddingStrategy')}</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {(['hybrid', 'provider', 'local'] as const).map((mode) => (
            <IslePressable key={mode} haptic accessibilityLabel={mode === 'hybrid' ? t('contextPanel.embeddingHybrid') : mode === 'provider' ? t('contextPanel.embeddingProvider') : t('contextPanel.embeddingLocal')} accessibilityState={{ selected: (settings.embeddingMode ?? 'hybrid') === mode }} onPress={() => updateSettings({ embeddingMode: mode })} style={contextChipPressableStyle}>
              <IsleChip active={(settings.embeddingMode ?? 'hybrid') === mode}>{mode === 'hybrid' ? t('contextPanel.embeddingHybrid') : mode === 'provider' ? t('contextPanel.embeddingProvider') : t('contextPanel.embeddingLocal')}</IsleChip>
            </IslePressable>
          ))}
        </View>
        <IslePressable
          haptic
          accessibilityRole="button"
          accessibilityLabel={`${t('contextPanel.localModel.title')}. ${t('contextPanel.localModel.collapsedDetail', { active: activeLocalModelCount, downloadable: downloadableLocalModels.length, planned: plannedLocalCapabilities.length })}`}
          accessibilityState={{ expanded: localModelsOpen }}
          onPress={() => setLocalModelsOpen((value) => !value)}
          style={{ marginTop: 10, minHeight: ISLE_MIN_TOUCH_TARGET, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, ...secondaryActionSurface(colors) }}
        >
          <AppIcon name="device" color={colors.textTertiary} size={16} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 17, fontWeight: '800' }}>{t('contextPanel.localModel.title')}</Text>
            <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, marginTop: 1 }}>{t('contextPanel.localModel.collapsedDetail', { active: activeLocalModelCount, downloadable: downloadableLocalModels.length, planned: plannedLocalCapabilities.length })}</Text>
          </View>
          <MotiView animate={{ rotate: localModelsOpen ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 160 }}>
            <AppIcon name="collapse" color={colors.textTertiary} size={16} />
          </MotiView>
        </IslePressable>
        {localModelsOpen ? (
          <MotiView from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 144 }} style={{ marginTop: 10 }}>
            <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16 }}>
              {t('contextPanel.localModel.priority')}
            </Text>
            <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 4 }}>
              {t('contextPanel.localModel.capabilityNotice')}
            </Text>
            <IsleField
              label={t('contextPanel.localModel.mirrorBaseUrl')}
              note={t('contextPanel.localModel.mirrorHelp')}
              style={{ marginTop: 10 }}
              inputProps={{
                value: localModelMirrorDraft,
                onChangeText: setLocalModelMirrorDraft,
                onBlur: commitLocalModelMirror,
                onSubmitEditing: commitLocalModelMirror,
                returnKeyType: 'done',
                autoCapitalize: 'none',
                autoCorrect: false,
                placeholder: t('contextPanel.localModel.mirrorPlaceholder'),
              }}
            />
            <View style={{ marginTop: 10, gap: 10 }}>
              {downloadableLocalModels.length ? (
                <View style={{ gap: 8 }}>
                  <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '700' }}>{t('contextPanel.localModel.downloadableModels')}</Text>
                  {downloadableLocalModels.map((view, index) => (
                    <MotiView
                      key={view.model.id}
                      from={motion === 'full' ? { opacity: 0, translateY: 8 } : { opacity: 0 }}
                      animate={{ opacity: 1, translateY: 0 }}
                      transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1, delay: motion === 'full' ? Math.min(index * 24, 120) : 0 }}
                    >
                      <LocalModelRow
                        view={view}
                        busy={modelBusyId === view.model.id}
                        progress={downloadProgress?.modelId === view.model.id ? downloadProgress : undefined}
                        onDownload={() => void downloadModel(view)}
                        onDetails={() => showLocalModelDetails(view)}
                        onEnable={() => void enableLocalModel(view)}
                        onDelete={() => void deleteModel(view)}
                      />
                    </MotiView>
                  ))}
                </View>
              ) : (
                <Text style={{ color: colors.textTertiary, fontSize: 12, lineHeight: 17 }}>{t('contextPanel.localModel.noDownloadableModels')}</Text>
              )}
              {plannedLocalCapabilities.length ? (
                <View style={{ gap: 8 }}>
                  <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '700' }}>{t('contextPanel.localModel.capabilityStatus')}</Text>
                  <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16 }}>{t('contextPanel.localModel.capabilityStatusHelp')}</Text>
                  {plannedLocalCapabilities.map((view) => (
                    <LocalCapabilityRow
                      key={view.model.id}
                      view={view}
                      settings={settings}
                      onDetails={() => showLocalModelDetails(view)}
                    />
                  ))}
                </View>
              ) : null}
            </View>
            <IslePressable
              haptic
              accessibilityLabel={rebuilding ? t('contextPanel.localModel.rebuilding') : t('contextPanel.localModel.rebuildIndex')}
              onPress={() => void rebuildIndex()}
              disabled={rebuilding}
              style={{ marginTop: 10, minHeight: 44, ...secondaryActionSurface(colors), alignItems: 'center', justifyContent: 'center', opacity: rebuilding ? 0.65 : 1 }}
            >
              <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '800' }}>{rebuilding ? t('contextPanel.localModel.rebuilding') : t('contextPanel.localModel.rebuildIndex')}</Text>
            </IslePressable>
          </MotiView>
        ) : null}
        <IslePressable
          haptic
          accessibilityLabel={t('contextPanel.clearRagCache')}
          onPress={async () => {
            await clearRagQueryCaches()
            dialog.notice({ title: t('contextPanel.cacheCleared'), message: t('contextPanel.cacheClearedMessage'), tone: 'mint' })
          }}
          style={{ ...fullWidthActionStyle, ...secondaryActionSurface(colors), marginTop: 10 }}
        >
          <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '800' }}>{t('contextPanel.clearRagCache')}</Text>
        </IslePressable>
        <ContextDiagnosticsSection
          selfTesting={selfTesting}
          selfTestResult={selfTestResult}
          ragEvaluating={ragEvaluating}
          ragEvaluation={ragEvaluation}
          ragLogs={ragLogs}
          indexingJobs={indexingJobs}
          onRunSelfTest={() => void runContextSelfTest()}
          onRunRagEvaluation={() => void runRagEvaluation()}
          primaryActionStyle={{ ...fullWidthActionStyle, ...primaryActionSurface(colors) }}
          assetCardSurface={(borderColor) => assetCardSurface(colors, borderColor)}
        />
            </MotiView>
          ) : null}
        </View>
      ) : null}

      {showContext && searchCredentialsAvailable ? <View style={{ marginTop: 10 }}>
        <ContextDisclosureRow
          title={t('contextPanel.searchApi')}
          detail={`${searchProviderLabel(searchProvider)} · ${searchCredentialsConfiguredCount
            ? t('contextPanel.searchApiActiveDetail', { count: searchCredentialsConfiguredCount })
            : t('contextPanel.searchApiCollapsedDetail')}`}
          icon={<AppIcon name="key" color={colors.textTertiary} size={15} />}
          open={searchCredentialsExpanded}
          onPress={() => toggleContextSection('credentials')}
        />
        {searchCredentialsExpanded ? (
          <MotiView from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 144 }} style={{ marginTop: 8, ...foldoutPanelStyle }}>
            <ContextFoldoutHeader
              title={searchProviderLabel(searchProvider)}
              detail={searchCredentialsConfiguredCount
                ? t('contextPanel.searchApiActiveDetail', { count: searchCredentialsConfiguredCount })
                : t('contextPanel.searchApiCollapsedDetail')}
            />
            {searchCredentialPresentation.fields.map((field) => (
              <IsleField key={field.id} label={field.label} style={{ marginTop: 10 }} inputProps={{ value: searchCredentialFieldValue(field.id), onChangeText: searchCredentialFieldUpdater(field.id), secureTextEntry: field.secureTextEntry, autoCapitalize: 'none', autoCorrect: false, placeholder: field.placeholder }} />
            ))}
            {searchCredentialPresentation.showEndpoint ? <IsleField label={t('contextPanel.customSearchEndpoint')} style={{ marginTop: 10 }} inputProps={{ value: customSearchEndpointDraft, onChangeText: (value) => { markSearchConfigEdited(); setCustomSearchEndpointDraft(value) }, autoCapitalize: 'none', autoCorrect: false, placeholder: 'https://search.example.com?q={query}&limit={limit}' }} /> : null}
            {searchCredentialPresentation.showBearerKey ? <IsleField label={t('contextPanel.customSearchKey')} style={{ marginTop: 10 }} inputProps={{ value: customSearchKey, onChangeText: (value) => { markSearchConfigEdited(); setCustomSearchKey(value) }, secureTextEntry: true, autoCapitalize: 'none', autoCorrect: false, placeholder: t('contextPanel.optionalBearerKey') }} /> : null}
            <IslePressable haptic accessibilityLabel={saved ? t('common.saved') : t('contextPanel.saveSearchConfig')} onPress={saveTavilyKey} style={{ ...fullWidthActionStyle, ...primaryActionSurface(colors), marginTop: 10 }}>
              <Text style={{ color: colors.ui.control.primaryForeground, fontSize: 14, fontWeight: '800' }}>{saved ? t('common.saved') : t('contextPanel.saveSearchConfig')}</Text>
            </IslePressable>
          </MotiView>
        ) : null}
      </View> : null}

      {!shouldPromoteKnowledgeImport ? knowledgeImportControls : null}

      {showMemory ? <ContextList
        title={t('contextPanel.memoryCount', { count: memories.length })}
        empty={t('contextPanel.noMemories')}
        emptyDetail={t('contextPanel.noMemoriesDetail')}
        emptyVisible={!memories.length}
        onClear={async () => {
          await clearMemories()
          resetMemoryAssetView()
          await refresh()
        }}
      >
        <MemoryReviewSection
          memories={memories}
          pendingMemories={pendingMemories}
          filteredMemories={filteredMemories}
          filteredPendingMemories={filteredPendingMemories}
          visibleMemories={visibleMemories}
          memoryStatusCounts={memoryStatusCounts}
          memoryReviewSummary={memoryReviewSummary}
          memoryStatusFocus={memoryStatusFocus}
          memoryReviewFocus={memoryReviewFocus}
          memorySortMode={memorySortMode}
          memoryFilter={memoryFilter}
          hasMemoryFilters={hasMemoryFilters}
          canConfirmFilteredMemories={canConfirmFilteredMemories}
          canRejectFilteredMemories={canRejectFilteredMemories}
          confirmingMemories={confirmingMemories}
          memoryPreviewLimit={memoryPreviewLimit}
          showAllMemories={showAllMemories}
          contextChipPressableStyle={contextChipPressableStyle}
          itemRowActionStyle={itemRowActionStyle}
          fullWidthActionStyle={fullWidthActionStyle}
          rowActionSurface={() => rowActionSurface(colors)}
          primaryActionSurface={() => primaryActionSurface(colors)}
          secondaryActionSurface={() => secondaryActionSurface(colors)}
          memoryEmptyMessage={memoryEmptyMessage}
          onSetMemoryStatusFocus={setMemoryStatusFocus}
          onSetMemoryReviewFocus={setMemoryReviewFocus}
          onSetMemorySortMode={setMemorySortMode}
          onSetMemoryFilter={setMemoryFilter}
          onResetMemoryFilters={resetMemoryAssetView}
          onSetShowAllMemories={setShowAllMemories}
          onConfirmPendingMemories={(targetMemories, filtered) => void confirmPendingMemories(targetMemories, filtered)}
          onRejectPendingMemories={(targetMemories) => void rejectPendingMemories(targetMemories)}
          onToggleMemory={async (memory) => {
            await updateMemoryStatus(memory.id, memory.status === 'active' ? 'disabled' : 'active')
            await refresh()
          }}
          onDeleteMemory={async (memory) => {
            await deleteMemory(memory.id)
            await refresh()
          }}
          renderDebugStat={(label, value) => <DebugStat label={label} value={value} />}
          renderItemRow={({ key, title, description, meta, deleteName, trailing, onToggle, onDelete }) => (
            <ItemRow
              key={key}
              title={title}
              description={description}
              meta={meta}
              deleteName={deleteName}
              trailing={trailing}
              onToggle={onToggle}
              onDelete={onDelete}
            />
          )}
        />
      </ContextList> : null}

      {showKnowledge ? <ContextList
        title={t('contextPanel.knowledgeCount', { count: documents.length })}
        empty={t('contextPanel.noKnowledgeFiles')}
        emptyDetail={t('contextPanel.noKnowledgeFilesDetail')}
        emptyVisible={!documents.length}
        onClear={async () => {
          await clearKnowledge()
          resetKnowledgeAssetView()
          await refresh()
        }}
      >
        {documents.length ? (
          <>
            <ContextDisclosureRow
              title={t('contextPanel.knowledgeTools')}
              detail={hasKnowledgeFilters
                ? t('contextPanel.knowledgeFilterSummary', { count: filteredDocuments.length, total: documents.length })
                : t('contextPanel.knowledgeToolsCollapsedDetail', { ready: knowledgeStatusCounts.ready, failed: knowledgeStatusCounts.failed, empty: knowledgeStatusCounts.empty })}
              icon={<AppIcon name="filter" color={colors.textTertiary} size={15} />}
              open={knowledgeToolsVisible}
              onPress={() => setKnowledgeToolsOpen((value) => !value)}
            />
            {knowledgeToolsVisible ? (
              <MotiView from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 144 }} style={{ marginTop: 10 }}>
                <View testID="knowledge-readiness-summary" style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                  <DebugStat label={t('contextPanel.knowledgeReadyCount')} value={String(knowledgeStatusCounts.ready)} />
                  <DebugStat label={t('contextPanel.knowledgeIndexingCount')} value={String(knowledgeStatusCounts.indexing)} />
                  <DebugStat label={t('contextPanel.knowledgeFailedCount')} value={String(knowledgeStatusCounts.failed)} />
                  <DebugStat label={t('contextPanel.knowledgeEmptyCount')} value={String(knowledgeStatusCounts.empty)} />
                </View>
                <View testID="knowledge-status-focus" style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                  {([
                    ['all', t('contextPanel.statusFocusAll', { count: documents.length })],
                    ['ready', t('contextPanel.statusFocusReady', { count: knowledgeStatusCounts.ready })],
                    ['extracting', t('contextPanel.statusFocusIndexing', { count: knowledgeStatusCounts.indexing })],
                    ['error', t('contextPanel.statusFocusFailed', { count: knowledgeStatusCounts.failed })],
                    ['empty', t('contextPanel.statusFocusEmpty', { count: knowledgeStatusCounts.empty })],
                  ] satisfies Array<[KnowledgeStatusFocus, string]>).map(([status, label]) => (
                    <IslePressable key={status} haptic accessibilityLabel={label} accessibilityState={{ selected: knowledgeStatusFocus === status }} onPress={() => setKnowledgeStatusFocus(status)} style={contextChipPressableStyle}>
                      <IsleChip active={knowledgeStatusFocus === status}>{label}</IsleChip>
                    </IslePressable>
                  ))}
                </View>
                {knowledgeStatusCounts.failed || knowledgeStatusCounts.empty ? (
                  <Text testID="knowledge-readiness-warning" style={{ color: knowledgeStatusCounts.failed ? colors.ui.tone.danger.foreground : colors.ui.tone.warning.foreground, fontSize: 12, lineHeight: 17, marginBottom: 10 }}>
                    {knowledgeStatusCounts.failed && knowledgeStatusCounts.empty
                      ? t('contextPanel.knowledgeReadinessWarning', { failed: knowledgeStatusCounts.failed, empty: knowledgeStatusCounts.empty })
                      : knowledgeStatusCounts.failed
                        ? t('contextPanel.knowledgeFailedWarning', { failed: knowledgeStatusCounts.failed })
                        : t('contextPanel.knowledgeEmptyWarning', { empty: knowledgeStatusCounts.empty })}
                  </Text>
                ) : null}
                {knowledgeRecoverySummary.recoverableDocuments || knowledgeRecoverySummary.failedJobs ? (
                  <View testID="knowledge-recovery-summary" style={{ marginBottom: 10, padding: 10, ...assetCardSurface(colors, knowledgeRecoverySummary.failedDocuments || knowledgeRecoverySummary.failedJobs ? colors.ui.tone.danger.border : colors.ui.tone.warning.border) }}>
                    <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>{t('contextPanel.knowledgeRecoveryTitle')}</Text>
                    <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 4 }}>
                      {t('contextPanel.knowledgeRecoverySummary', {
                        failed: knowledgeRecoverySummary.failedDocuments,
                        empty: knowledgeRecoverySummary.emptyDocuments,
                        jobs: knowledgeRecoverySummary.failedJobs,
                      })}
                    </Text>
                    {knowledgeRecoverySummary.lastError ? (
                      <Text numberOfLines={2} style={{ color: colors.ui.tone.danger.foreground, fontSize: 11, lineHeight: 16, marginTop: 6 }}>
                        {t('contextPanel.knowledgeRecoveryLastError', { error: knowledgeRecoverySummary.lastError })}
                      </Text>
                    ) : null}
                    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                      {knowledgeRecoverySummary.failedDocuments ? (
                        <IslePressable haptic accessibilityLabel={t('contextPanel.knowledgeRecoveryShowFailed')} onPress={() => focusKnowledgeRecovery('error')} style={{ ...itemRowActionStyle, ...rowActionSurface(colors) }}>
                          <Text style={{ color: colors.ui.tone.danger.foreground, fontSize: 12, fontWeight: '800' }}>{t('contextPanel.knowledgeRecoveryShowFailed')}</Text>
                        </IslePressable>
                      ) : null}
                      {knowledgeRecoverySummary.emptyDocuments ? (
                        <IslePressable haptic accessibilityLabel={t('contextPanel.knowledgeRecoveryShowEmpty')} onPress={() => focusKnowledgeRecovery('empty')} style={{ ...itemRowActionStyle, ...rowActionSurface(colors) }}>
                          <Text style={{ color: colors.ui.tone.warning.foreground, fontSize: 12, fontWeight: '800' }}>{t('contextPanel.knowledgeRecoveryShowEmpty')}</Text>
                        </IslePressable>
                      ) : null}
                      <IslePressable haptic accessibilityLabel={rebuilding ? t('contextPanel.localModel.rebuilding') : t('contextPanel.knowledgeRecoveryRebuild')} accessibilityState={rebuilding ? { busy: true } : undefined} onPress={() => void rebuildIndex()} disabled={rebuilding} style={{ ...itemRowActionStyle, ...primaryActionSurface(colors), opacity: rebuilding ? 0.65 : 1 }}>
                        <Text style={{ color: colors.ui.control.primaryForeground, fontSize: 12, fontWeight: '800' }}>{rebuilding ? t('contextPanel.localModel.rebuilding') : t('contextPanel.knowledgeRecoveryRebuild')}</Text>
                      </IslePressable>
                    </View>
                  </View>
                ) : null}
                <IsleField
                  label={t('contextPanel.knowledgeFilter')}
                  style={{ marginBottom: 10 }}
                  inputProps={{
                    value: knowledgeFilter,
                    onChangeText: setKnowledgeFilter,
                    autoCapitalize: 'none',
                    autoCorrect: false,
                    placeholder: t('contextPanel.knowledgeFilterPlaceholder'),
                  }}
                />
                <View testID="knowledge-sort-mode" style={{ marginBottom: 10 }}>
                  <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '700', marginBottom: 6 }}>{t('contextPanel.knowledgeSort')}</Text>
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    {([
                      ['updated', t('contextPanel.knowledgeSortUpdated')],
                      ['needsReview', t('contextPanel.knowledgeSortNeedsReview')],
                      ['chunks', t('contextPanel.knowledgeSortChunks')],
                      ['title', t('contextPanel.knowledgeSortTitle')],
                    ] satisfies Array<[KnowledgeSortMode, string]>).map(([mode, label]) => (
                      <IslePressable key={mode} haptic accessibilityLabel={label} accessibilityState={{ selected: knowledgeSortMode === mode }} onPress={() => setKnowledgeSortMode(mode)} style={contextChipPressableStyle}>
                        <IsleChip active={knowledgeSortMode === mode}>{label}</IsleChip>
                      </IslePressable>
                    ))}
                  </View>
                </View>
              </MotiView>
            ) : null}
          </>
        ) : null}
        {hasKnowledgeFilters ? (
          <View testID="knowledge-filter-summary" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, flex: 1, minWidth: 0 }}>
              {t('contextPanel.knowledgeFilterSummary', { count: filteredDocuments.length, total: documents.length })}
            </Text>
            <IslePressable
              haptic
              onPress={() => {
                setKnowledgeFilter('')
                setKnowledgeStatusFocus('all')
                setShowAllKnowledge(false)
              }}
              accessibilityLabel={t('contextPanel.clearKnowledgeFilters')}
              style={{ ...itemRowActionStyle, ...rowActionSurface(colors) }}
            >
              <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '800' }}>{t('contextPanel.clearKnowledgeFilters')}</Text>
            </IslePressable>
          </View>
        ) : null}
        {filteredDocuments.length > knowledgePreviewLimit ? (
          <Text testID="knowledge-list-showing-count" style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginBottom: 8 }}>
            {t('contextPanel.knowledgeListShowing', { shown: visibleDocuments.length, total: filteredDocuments.length })}
          </Text>
        ) : null}
        {hasKnowledgeFilters && !filteredDocuments.length ? (
          <Text testID="knowledge-filter-empty" style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginBottom: 8 }}>
            {knowledgeEmptyMessage}
          </Text>
        ) : null}
        {visibleDocuments.map((document) => (
          <ItemRow
            key={document.id}
            title={document.title}
            description={t('contextPanel.chunkDescription', { count: document.chunkCount, kb: Math.round(document.size / 1024) })}
            meta={formatKnowledgeMeta(document, t)}
            deleteName={document.title}
            onDelete={async () => {
              await deleteKnowledgeDocument(document.id)
              await refresh()
            }}
          />
        ))}
        {filteredDocuments.length > knowledgePreviewLimit ? (
          <IslePressable
            haptic
            onPress={() => setShowAllKnowledge((current) => !current)}
            accessibilityLabel={showAllKnowledge ? t('contextPanel.showFewerKnowledge') : t('contextPanel.showAllKnowledge', { count: filteredDocuments.length })}
            testID="knowledge-list-toggle"
            style={{ ...fullWidthActionStyle, ...secondaryActionSurface(colors), marginTop: 10 }}
          >
            <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '800' }}>
              {showAllKnowledge
                ? t('contextPanel.showFewerKnowledge')
                : t('contextPanel.showMoreKnowledge', { count: filteredDocuments.length - visibleDocuments.length })}
            </Text>
          </IslePressable>
        ) : null}
      </ContextList> : null}
    </View>
  )
}

function ContextFoldoutHeader({ title, detail }: { title: string; detail?: string }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ marginBottom: 10 }}>
      <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13, lineHeight: 17, fontWeight: '800', includeFontPadding: false }}>
        {title}
      </Text>
      {detail ? (
        <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, marginTop: 2, fontWeight: '700', includeFontPadding: false }}>
          {detail}
        </Text>
      ) : null}
    </View>
  )
}

function ContextDisclosureRow({ title, detail, icon, open, onPress }: { title: string; detail: string; icon: ReactNode; open: boolean; onPress: () => void }) {
  const { colors, canonicalThemeId } = useAppTheme()
  if (canonicalThemeId === 'minimal') {
    return (
      <IslePressable haptic accessibilityRole="button" accessibilityLabel={`${title}. ${detail}`} accessibilityState={{ expanded: open }} onPress={onPress} style={{ minHeight: 50, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.semantic.chrome.border }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12.5, lineHeight: 17, fontWeight: '700' }}>{title}</Text>
          <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10.5, lineHeight: 14, marginTop: 1, fontWeight: '500' }}>{detail}</Text>
        </View>
        <Text style={{ color: colors.textTertiary, fontSize: 13, lineHeight: 17, fontWeight: '800' }}>{open ? '−' : '+'}</Text>
      </IslePressable>
    )
  }
  if (canonicalThemeId === 'material') {
    return (
      <IslePressable haptic accessibilityRole="button" accessibilityLabel={`${title}. ${detail}`} accessibilityState={{ expanded: open }} onPress={onPress} style={{ minHeight: 48, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: open ? colors.ui.semantic.surface.base : colors.ui.semantic.surface.muted, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.ui.section.divider, borderRadius: 4 }}>
        {icon}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 11.5, lineHeight: 16, fontWeight: '800' }}>{title}</Text>
          <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 9.5, lineHeight: 13, marginTop: 1, fontWeight: '500' }}>{detail}</Text>
        </View>
      </IslePressable>
    )
  }
  if (canonicalThemeId === 'liquid-glass') {
    return (
      <IslePressable
        haptic
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${detail}`}
        accessibilityState={{ expanded: open }}
        onPress={onPress}
        style={{ minHeight: ISLE_MIN_TOUCH_TARGET, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: colors.ui.actionBar.itemBackground, borderWidth: 1, borderColor: colors.ui.actionBar.itemBorder, borderRadius: colors.ui.radius.controlLarge, shadowColor: colors.ui.control.shadow, shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 1 }}
      >
        {icon}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 17, fontWeight: '800' }}>{title}</Text>
          <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, marginTop: 1 }}>{detail}</Text>
        </View>
        <MotiView animate={{ rotate: open ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 160 }}>
          <AppIcon name="collapse" color={colors.textTertiary} size={16} />
        </MotiView>
      </IslePressable>
    )
  }
  return (
    <IslePressable
      haptic
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      style={{ minHeight: ISLE_MIN_TOUCH_TARGET, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, ...secondaryActionSurface(colors) }}
    >
      {icon}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 17, fontWeight: '800' }}>{title}</Text>
        <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, marginTop: 1 }}>{detail}</Text>
      </View>
      <MotiView animate={{ rotate: open ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 160 }}>
        <AppIcon name="collapse" color={colors.textTertiary} size={16} />
      </MotiView>
    </IslePressable>
  )
}

function ContextList({ title, empty, emptyDetail, emptyVisible = false, children, onClear }: { title: string; empty: string; emptyDetail?: string; emptyVisible?: boolean; children: React.ReactNode; onClear: () => Promise<void> }) {
  const { colors, canonicalThemeId } = useAppTheme()
  const dialog = useIsleDialog()
  const { t } = useTranslation()
  const isMinimal = canonicalThemeId === 'minimal'
  const isMaterial = canonicalThemeId === 'material'
  const isLiquidGlass = canonicalThemeId === 'liquid-glass'
  const subtleBorderWidth = isMinimal ? StyleSheet.hairlineWidth : 1
  const borderColor = isLiquidGlass ? colors.ui.actionBar.itemBorder : canonicalThemeId === 'monet' ? colors.material.stroke : colors.ui.semantic.chrome.border
  const emptySurface = isLiquidGlass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted
  function confirmClear() {
    void dialog.confirm({
      title: t('contextPanel.clearTitle', { title }),
      message: t('contextPanel.clearConfirm'),
      tone: 'danger',
      confirmLabel: t('contextPanel.clear'),
      cancelLabel: t('common.cancel'),
    }).then((confirmed: boolean) => {
      if (confirmed) void onClear()
    })
  }
  if (isMinimal) {
    return (
      <View style={{ marginTop: 16 }}>
        <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.semantic.chrome.border }}>
          <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '800' }}>{title}</Text>
          <IslePressable onPress={confirmClear} disabled={emptyVisible} accessibilityLabel={t('contextPanel.clearTitle', { title })} style={{ minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center', opacity: emptyVisible ? 0.45 : 1 }}>
            <Text style={{ color: colors.ui.tone.danger.foreground, fontSize: 10.5, lineHeight: 14, fontWeight: '800' }}>{t('contextPanel.clear')}</Text>
          </IslePressable>
        </View>
        {emptyVisible ? (
          <View style={{ minHeight: emptyDetail ? 58 : 44, paddingVertical: 9, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.semantic.chrome.border }}>
            <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '700' }}>{empty}</Text>
            {emptyDetail ? <Text numberOfLines={2} style={{ color: colors.textTertiary, fontSize: 10.5, lineHeight: 15, marginTop: 2, fontWeight: '500' }}>{emptyDetail}</Text> : null}
          </View>
        ) : children}
      </View>
    )
  }
  if (isMaterial) {
    return (
      <View style={{ marginTop: 16, gap: 8 }}>
        <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.section.divider }}>
          <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: '800' }}>{title}</Text>
          <IslePressable onPress={confirmClear} disabled={emptyVisible} accessibilityLabel={t('contextPanel.clearTitle', { title })} style={{ minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center', opacity: emptyVisible ? 0.45 : 1 }}>
            <Text style={{ color: colors.ui.tone.danger.foreground, fontSize: 10, lineHeight: 14, fontWeight: '800' }}>{t('contextPanel.clear')}</Text>
          </IslePressable>
        </View>
        {emptyVisible ? (
          <View style={{ minHeight: emptyDetail ? 58 : 44, paddingHorizontal: 10, paddingVertical: 8, justifyContent: 'center', backgroundColor: colors.ui.semantic.surface.muted, borderLeftWidth: 3, borderLeftColor: colors.ui.section.divider }}>
            <Text style={{ color: colors.textSecondary, fontSize: 11.5, lineHeight: 16, fontWeight: '700' }}>{empty}</Text>
            {emptyDetail ? <Text numberOfLines={2} style={{ color: colors.textTertiary, fontSize: 10.5, lineHeight: 15, marginTop: 2, fontWeight: '500' }}>{emptyDetail}</Text> : null}
          </View>
        ) : children}
      </View>
    )
  }
  if (isLiquidGlass) {
    return (
      <View style={{ marginTop: 12, gap: 8 }}>
        <View style={{ minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 2 }}>
          <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: '800' }}>{title}</Text>
          <IslePressable onPress={confirmClear} disabled={emptyVisible} accessibilityLabel={t('contextPanel.clearTitle', { title })} style={{ width: 44, height: 44, borderRadius: colors.ui.radius.controlLarge, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.tone.danger.background, borderWidth: 1, borderColor: colors.ui.tone.danger.border, opacity: emptyVisible ? 0.45 : 1 }}>
            <AppIcon name="delete" color={colors.ui.tone.danger.foreground} size={15} />
          </IslePressable>
        </View>
        {emptyVisible ? (
          <View style={{ minHeight: emptyDetail ? 64 : 48, borderRadius: colors.ui.radius.panel, paddingHorizontal: 12, paddingVertical: 10, justifyContent: 'center', backgroundColor: emptySurface, borderWidth: 1, borderColor, shadowColor: colors.ui.control.shadow, shadowOpacity: 0.14, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 1 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '800', includeFontPadding: false }}>{empty}</Text>
            {emptyDetail ? <Text numberOfLines={2} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 2, fontWeight: '600', includeFontPadding: false }}>{emptyDetail}</Text> : null}
          </View>
        ) : children}
      </View>
    )
  }
  return (
    <View style={{ marginTop: 10, gap: 7 }}>
      <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 2 }}>
        <View style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 14, lineHeight: 18, fontWeight: '800', includeFontPadding: false, textAlignVertical: 'center' }}>{title}</Text>
        </View>
        <IslePressable
          onPress={confirmClear}
          disabled={emptyVisible}
          accessibilityLabel={t('contextPanel.clearTitle', { title })}
          style={{ width: 44, height: 44, borderRadius: Math.min(colors.ui.radius.controlLarge, 8), alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.tone.danger.background, borderWidth: 1, borderColor: colors.ui.tone.danger.border, opacity: emptyVisible ? 0.45 : 1 }}
        >
          <AppIcon name="delete" color={colors.ui.tone.danger.foreground} size={15} />
        </IslePressable>
      </View>
      {emptyVisible ? (
        <View style={{ minHeight: emptyDetail ? 58 : 44, borderRadius: Math.min(colors.ui.radius.card, 8), paddingHorizontal: 9, paddingVertical: 8, justifyContent: 'center', backgroundColor: emptySurface, borderWidth: subtleBorderWidth, borderColor }}>
          <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '800', includeFontPadding: false }}>{empty}</Text>
          {emptyDetail ? (
            <Text numberOfLines={2} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 2, fontWeight: '700', includeFontPadding: false }}>
              {emptyDetail}
            </Text>
          ) : null}
        </View>
      ) : children}
    </View>
  )
}

function LocalModelRow({ view, busy, progress, onDownload, onDetails, onEnable, onDelete }: {
  view: LocalEmbeddingModelView
  busy: boolean
  progress?: LocalEmbeddingDownloadProgress
  onDownload: () => void
  onDetails: () => void
  onEnable: () => void
  onDelete: () => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const canEnable = view.source !== 'none'
  const downloadable = isDownloadableLocalModel(view)
  const modelMeta = [
    capabilityLabel(view.model.capability ?? 'embedding', t),
    view.model.language,
    downloadable ? formatModelBytes(view.model.sizeBytes) : t('contextPanel.localModel.notProvided'),
    view.model.dimension ? `${view.model.dimension}d` : t('contextPanel.localModel.reservedCapability'),
  ].join(' · ')
  const statusLabel = view.active
    ? t('contextPanel.localModel.statusEnabled')
    : view.status === 'planned'
      ? t('contextPanel.localModel.statusPlaceholder')
    : view.status === 'bundled'
      ? t('contextPanel.localModel.statusBundled')
      : view.status === 'downloaded'
        ? t('contextPanel.localModel.statusDownloaded')
        : view.status === 'verify-failed'
          ? t('contextPanel.localModel.statusFailed')
          : downloadable
            ? t('contextPanel.localModel.statusNotDownloaded')
            : t('contextPanel.localModel.statusPlaceholder')
  const progressPercent = progress?.percent ?? 0
  const progressText = progress
    ? t('contextPanel.localModel.progressText', {
        percent: progress.percent,
        file: progress.filePath,
        index: progress.fileIndex,
        count: progress.fileCount,
        stage: t(`contextPanel.localModel.downloadStages.${progress.stage}`),
      })
    : ''
  return (
    <View style={{ padding: 10, ...assetCardSurface(colors, view.active ? colors.ui.control.primaryBorder : colors.material.stroke) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 34, height: 34, borderRadius: Math.min(colors.ui.radius.controlMiddle, 8), alignItems: 'center', justifyContent: 'center', backgroundColor: view.active ? colors.ui.control.primaryBackground : colors.ui.icon.accentBackground }}>
          {view.active ? <AppIcon name="check" color={colors.ui.control.primaryForeground} size={16} /> : <AppIcon name="device" color={colors.textTertiary} size={16} />}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>{view.model.name}</Text>
          <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 2 }}>
            {modelMeta}
          </Text>
        </View>
        <Text style={{ color: view.active ? colors.ui.control.link : colors.textTertiary, fontSize: 11, fontWeight: '800' }}>{statusLabel}</Text>
      </View>
      <Text numberOfLines={2} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 8 }}>{view.model.useCase}</Text>
      <Text numberOfLines={2} style={{ color: colors.textTertiary, fontSize: 10, lineHeight: 15, marginTop: 6 }}>
        {view.model.publisher ?? view.model.upstreamModel ?? '-'} · {view.model.license ?? '-'}
      </Text>
      {progress ? (
        <View style={{ marginTop: 10, gap: 6 }}>
          <IsleProgress percent={progressPercent} size="small" showInfo={false} fillColor={colors.ui.control.primaryBackground} />
          <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, fontWeight: '800' }}>
            {progressText}
          </Text>
          {progress.sourceUrl ? (
            <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '700' }}>
              {progress.sourceUrl}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        {!view.downloaded && !view.bundled && downloadable ? (
          <IslePressable haptic disabled={busy} accessibilityLabel={t('contextPanel.localModel.download')} accessibilityState={busy ? { busy: true } : undefined} onPress={onDownload} style={{ ...localModelActionStyle, ...primaryActionSurface(colors), flexDirection: 'row', gap: 6, opacity: busy ? 0.65 : 1 }}>
            <AppIcon name="download" color={colors.ui.control.primaryForeground} size={13} />
            <Text style={{ color: colors.ui.control.primaryForeground, fontSize: 12, fontWeight: '800' }}>{busy && progress ? `${progress.percent}%` : busy ? t('contextPanel.localModel.downloading') : t('contextPanel.localModel.download')}</Text>
          </IslePressable>
        ) : null}
        {!downloadable ? (
          <IslePressable haptic onPress={onDetails} accessibilityLabel={t('contextPanel.localModel.detailsFor', { name: view.model.name })} style={{ ...localModelActionStyle, ...rowActionSurface(colors) }}>
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '800' }}>{t('contextPanel.localModel.details')}</Text>
          </IslePressable>
        ) : null}
        {canEnable && !view.active ? (
          <IslePressable haptic disabled={busy} accessibilityLabel={t('contextPanel.localModel.enable')} accessibilityState={busy ? { busy: true } : undefined} onPress={onEnable} style={{ ...localModelActionStyle, ...rowActionSurface(colors), opacity: busy ? 0.65 : 1 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '800' }}>{t('contextPanel.localModel.enable')}</Text>
          </IslePressable>
        ) : null}
        {view.downloaded ? (
          <IslePressable haptic disabled={busy} accessibilityLabel={t('common.delete')} accessibilityState={busy ? { busy: true } : undefined} onPress={onDelete} style={{ ...localModelActionStyle, ...rowActionSurface(colors), opacity: busy ? 0.65 : 1 }}>
            <Text style={{ color: colors.ui.tone.danger.foreground, fontSize: 12, fontWeight: '800' }}>{t('common.delete')}</Text>
          </IslePressable>
        ) : null}
      </View>
    </View>
  )
}

function LocalCapabilityRow({ view, settings, onDetails }: {
  view: LocalEmbeddingModelView
  settings: Settings
  onDetails: () => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const capability = view.model.capability ?? 'embedding'
  const active = localCapabilityEnabled(capability, settings)
  const modelMeta = [
    capabilityLabel(capability, t),
    view.model.language,
    t('contextPanel.localModel.manifestUnavailable'),
    view.model.maxTokens ? t('contextPanel.localModel.maxTokens', { count: view.model.maxTokens }) : '',
  ].filter(Boolean).join(' · ')
  return (
    <View style={{ padding: 10, ...assetCardSurface(colors, active ? colors.ui.control.primaryBorder : colors.ui.tone.warning.border) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 34, height: 34, borderRadius: Math.min(colors.ui.radius.controlMiddle, 8), alignItems: 'center', justifyContent: 'center', backgroundColor: active ? colors.ui.control.primaryBackground : colors.ui.tone.warning.background }}>
          {active ? <AppIcon name="check" color={colors.ui.control.primaryForeground} size={16} /> : <AppIcon name="device" color={colors.ui.tone.warning.foreground} size={16} />}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>{view.model.name}</Text>
          <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 2 }}>
            {modelMeta}
          </Text>
        </View>
        <IsleChip tone={active ? 'mint' : 'amber'}>{active ? t('contextPanel.localModel.strategyOn') : t('contextPanel.localModel.strategyOff')}</IsleChip>
      </View>
      <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 8 }}>
        {t(`contextPanel.localModel.fallbackStrategies.${capability}`)}
      </Text>
      <Text style={{ color: active ? colors.textSecondary : colors.ui.tone.warning.foreground, fontSize: 11, lineHeight: 16, marginTop: 6, fontWeight: '800' }}>
        {active ? t('contextPanel.localModel.runtimeBoundaryOn') : t('contextPanel.localModel.runtimeBoundaryOff')}
      </Text>
      <Text numberOfLines={2} style={{ color: colors.textTertiary, fontSize: 10, lineHeight: 15, marginTop: 6 }}>
        {view.model.publisher ?? view.model.upstreamModel ?? '-'} · {view.model.license ?? '-'}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        <IslePressable haptic onPress={onDetails} accessibilityLabel={t('contextPanel.localModel.detailsFor', { name: view.model.name })} style={{ ...localModelActionStyle, ...rowActionSurface(colors) }}>
          <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '800' }}>{t('contextPanel.localModel.details')}</Text>
        </IslePressable>
      </View>
    </View>
  )
}

interface ItemRowProps {
  title: string
  description: string
  meta?: string
  deleteName?: string
  trailing?: string
  onToggle?: () => Promise<void>
  onDelete: () => Promise<void>
}

function ItemRow({ title, description, meta, deleteName, trailing, onToggle, onDelete }: ItemRowProps) {
  const { colors, canonicalThemeId } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIsleDialog()

  async function confirmDelete() {
    const confirmed = await dialog.confirm({
      title: t('contextPanel.deleteItemTitle'),
      message: t('contextPanel.deleteItemConfirm', { title: deleteName || title }),
      tone: 'danger',
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
    })
    if (confirmed) await onDelete()
  }

  if (canonicalThemeId === 'minimal') {
    return (
      <View style={{ paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.semantic.chrome.border }}>
        <Text style={{ color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '800' }}>{title}</Text>
        <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 11.5, lineHeight: 16, marginTop: 3 }}>{description}</Text>
        {meta ? <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10.5, lineHeight: 14, marginTop: 4 }}>{meta}</Text> : null}
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
          {trailing && onToggle ? <IslePressable accessibilityLabel={trailing} onPress={() => void onToggle()} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.textSecondary, fontSize: 10.5, fontWeight: '800' }}>{trailing}</Text></IslePressable> : null}
          <IslePressable accessibilityLabel={t('common.delete')} onPress={() => void confirmDelete()} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.ui.tone.danger.foreground, fontSize: 10.5, fontWeight: '800' }}>{t('common.delete')}</Text></IslePressable>
        </View>
      </View>
    )
  }
  if (canonicalThemeId === 'material') {
    return (
      <View style={{ paddingHorizontal: 9, paddingVertical: 9, marginBottom: 6, backgroundColor: colors.ui.semantic.surface.muted, borderLeftWidth: 3, borderLeftColor: colors.ui.section.divider }}>
        <Text style={{ color: colors.text, fontSize: 11.5, lineHeight: 16, fontWeight: '800' }}>{`- ${title}`}</Text>
        <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 10.5, lineHeight: 15, marginTop: 3 }}>{description}</Text>
        {meta ? <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 9.5, lineHeight: 13, marginTop: 4 }}>{`  ${meta}`}</Text> : null}
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 7, flexWrap: 'wrap' }}>
          {trailing && onToggle ? <IslePressable accessibilityLabel={trailing} onPress={() => void onToggle()} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.textSecondary, fontSize: 9.5, fontWeight: '800' }}>{`toggle(${trailing})`}</Text></IslePressable> : null}
          <IslePressable accessibilityLabel={t('common.delete')} onPress={() => void confirmDelete()} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.ui.tone.danger.foreground, fontSize: 9.5, fontWeight: '800' }}>delete()</Text></IslePressable>
        </View>
      </View>
    )
  }
  if (canonicalThemeId === 'liquid-glass') {
    return (
      <View style={{ padding: 12, marginBottom: 9, borderRadius: colors.ui.radius.panel, backgroundColor: colors.ui.actionBar.itemBackground, borderWidth: 1, borderColor: colors.ui.actionBar.itemBorder, shadowColor: colors.ui.control.shadow, shadowOpacity: 0.14, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 1 }}>
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '800' }}>{title}</Text>
        <Text numberOfLines={3} style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 4 }}>{description}</Text>
        {meta ? <Text numberOfLines={2} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 6 }}>{meta}</Text> : null}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {trailing && onToggle ? (
            <IslePressable accessibilityLabel={trailing} onPress={() => void onToggle()} style={{ ...itemRowActionStyle, backgroundColor: colors.ui.actionBar.itemBackground, borderWidth: 1, borderColor: colors.ui.actionBar.itemBorder, borderRadius: colors.ui.radius.controlMiddle }}>
              <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '800' }}>{trailing}</Text>
            </IslePressable>
          ) : null}
          <IslePressable accessibilityLabel={t('common.delete')} onPress={() => void confirmDelete()} style={{ ...itemRowActionStyle, backgroundColor: colors.ui.tone.danger.background, borderWidth: 1, borderColor: colors.ui.tone.danger.border, borderRadius: colors.ui.radius.controlMiddle }}>
            <Text style={{ color: colors.ui.tone.danger.foreground, fontSize: 12, fontWeight: '800' }}>{t('common.delete')}</Text>
          </IslePressable>
        </View>
      </View>
    )
  }
  return (
    <View style={{ padding: 10, marginBottom: 8, ...assetCardSurface(colors) }}>
      <Text style={{ color: colors.text, fontSize: 14, fontWeight: '800' }}>{title}</Text>
      <Text numberOfLines={3} style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 4 }}>{description}</Text>
      {meta ? <Text numberOfLines={2} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 6 }}>{meta}</Text> : null}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {trailing && onToggle ? (
          <IslePressable accessibilityLabel={trailing} onPress={() => void onToggle()} style={{ ...itemRowActionStyle, ...rowActionSurface(colors) }}>
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '800' }}>{trailing}</Text>
          </IslePressable>
        ) : null}
        <IslePressable accessibilityLabel={t('common.delete')} onPress={() => void confirmDelete()} style={{ ...itemRowActionStyle, ...rowActionSurface(colors) }}>
          <Text style={{ color: colors.ui.tone.danger.foreground, fontSize: 12, fontWeight: '800' }}>{t('common.delete')}</Text>
        </IslePressable>
      </View>
    </View>
  )
}

function DebugStat({ label, value }: { label: string; value: string }) {
  const { colors, canonicalThemeId } = useAppTheme()
  const { width } = useWindowDimensions()
  const statMinWidth = width < 390 ? 64 : 74
  if (canonicalThemeId === 'minimal') {
    return (
      <View style={{ minHeight: 34, minWidth: statMinWidth, paddingHorizontal: 4, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.semantic.chrome.border }}>
        <Text style={{ color: colors.text, fontSize: 12, fontWeight: '800' }}>{value}</Text>
        <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 9.5, fontWeight: '600' }}>{label}</Text>
      </View>
    )
  }
  if (canonicalThemeId === 'material') {
    return (
      <View style={{ minHeight: 34, minWidth: statMinWidth, paddingHorizontal: 8, justifyContent: 'center', backgroundColor: colors.ui.semantic.surface.muted, borderLeftWidth: 2, borderLeftColor: colors.ui.section.divider }}>
        <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 9.5, fontWeight: '700' }}>{`${label}: ${value}`}</Text>
      </View>
    )
  }
  if (canonicalThemeId === 'liquid-glass') {
    return (
      <View style={{ minHeight: 38, minWidth: statMinWidth, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: colors.ui.radius.controlMiddle, backgroundColor: colors.ui.actionBar.itemBackground, borderWidth: 1, borderColor: colors.ui.actionBar.itemBorder }}>
        <Text style={{ color: colors.text, fontSize: 12, fontWeight: '800' }}>{value}</Text>
        <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '800' }}>{label}</Text>
      </View>
    )
  }
  return (
    <View style={{ minHeight: 34, minWidth: statMinWidth, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', ...rowActionSurface(colors) }}>
      <Text style={{ color: colors.text, fontSize: 12, fontWeight: '800' }}>{value}</Text>
      <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '800' }}>{label}</Text>
    </View>
  )
}
