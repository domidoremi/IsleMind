import { SettingsTaskWorkspace } from './SettingsTaskWorkspace'
import { SettingsSection, useSettingsTarget } from './SettingsSection'
import { useSettingsDraft, useSettingsLifetime } from './SettingsEditBoundary'
import { SettingsHelpButton } from './SettingsHelp'
import { SavedSettingsField, useSettingsFieldSession } from './SettingsFieldSession'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/ui/AppIcon'
import { describeUserFacingError, extractUserFacingErrorDetail, userFacingErrorDetail } from '@/core'
import type { KnowledgeDocument, LocalRagModelCapability, MemoryItem, RagEvaluationLog, RagIndexingJobStatus } from '@/types/contextContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'
import { snapshotProviderConfiguration } from '@/modules/providers'
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
  reviewLocalEmbeddingModelStateRecovery,
  type LocalEmbeddingDownloadProgress,
  type LocalEmbeddingModelView,
} from '@/bootstrap/localModelRuntime'
import { clearRagQueryCaches, listRagEmbeddingJobs, loadRagDebugSnapshot, loadRagEmbeddingJobSummary, rebuildRagKnowledgeEmbeddings, runRagGoldEvaluation } from '@/bootstrap/knowledgeRagEvaluation'
import {
  KnowledgeRepositoryConflictError,
  LocalModelStateDataError,
  LocalModelStateRecoveryConflictError,
  isDownloadableLocalModel,
  knowledgeMemoryReviewMutationOptions,
  snapshotKnowledgeMemory,
  localCapabilityEnabled,
  splitLocalModelViews,
  type KnowledgeDocumentRecord,
  type KnowledgeMemoryRecord,
  type RagEvaluationRun,
} from '@/modules/knowledge'
import { useAppTheme } from '@/hooks/useAppTheme'
import { glassShadowStyle } from '@/components/ui/isle/glassShadowStyle'
import { useSettingsStore } from '@/store/settingsStore'
import { SEARCH_DIAGNOSTIC_QUERY, SEARCH_PROVIDER_OPTIONS, legacySearchModeForProvider, resolveSearchProvider } from '@/modules/integrations'
import { SEARCH_PROVIDER_CREDENTIAL_FIELDS, searchProviderCredentialPresentation, searchProviderLabel } from '@/presentation/features/settings/searchProviderPresentation'
import { filterAndSortKnowledgeDocuments, filterAndSortMemories, hasKnowledgeAssetFilters, hasMemoryAssetFilters, knowledgeAssetEmptyMessage, memoryAssetEmptyMessage, type KnowledgeSortMode, type KnowledgeStatusFocus, type MemorySortMode, type MemoryStatusFocus } from '@/services/contextAssetFilters'
import { capabilityLabel, formatKnowledgeMeta, formatMemoryMeta, memoryReviewFocusKey } from '@/services/contextAssetFormatters'
import { ISLE_MIN_TOUCH_TARGET, IsleButton, IsleChip, IsleField, IslePressable, IsleProgress, IsleToggle, useIsleDialog } from '@/components/ui/isle'
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

type KnowledgeIndexOperation = { controller: AbortController; phase: 'running' | 'readback' }
type LocalModelOperationKind = 'download' | 'enable' | 'delete'
type LocalModelSettingsRevision = { settings: Settings; key: string }
type LocalModelOperation = {
  controller: AbortController
  kind: LocalModelOperationKind | 'save' | 'state-reset'
  modelId: string
  phase: 'review' | 'running' | 'persistence' | 'readback'
  savedSettings?: LocalModelSettingsRevision
}

function localModelSelectionKey(settings: Settings): string {
  return JSON.stringify({
    embeddingMode: settings.embeddingMode,
    localEmbeddingModelId: settings.localEmbeddingModelId,
    localEmbeddingModelSource: settings.localEmbeddingModelSource,
  })
}

function localModelConsentKey(settings: Settings): string {
  return JSON.stringify([localModelSelectionKey(settings), settings.localModelDownloadMirrorBaseUrl])
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

type ContextMemoryRecord = KnowledgeMemoryRecord & { status: MemoryItem['status'] }

async function listMemories(statuses: MemoryItem['status'][]): Promise<ContextMemoryRecord[]> {
  return [...await knowledgeRepository.listMemories({ statuses })]
}

async function listKnowledgeDocuments(): Promise<KnowledgeDocumentRecord[]> {
  return [...await knowledgeRepository.listDocuments()]
}

const updateMemoryStatus = (memory: KnowledgeMemoryRecord, status: MemoryItem['status'], catalog: readonly KnowledgeMemoryRecord[], signal: AbortSignal) => knowledgeRepository.updateMemoryStatus(memory.id, status, { ...knowledgeMemoryReviewMutationOptions(memory, catalog), signal })
const deleteMemory = (memory: KnowledgeMemoryRecord, signal: AbortSignal) => knowledgeRepository.deleteMemory(memory.id, { expectedMemory: snapshotKnowledgeMemory(memory), signal })
const clearMemories = (memories: readonly KnowledgeMemoryRecord[], signal: AbortSignal) => knowledgeRepository.clearMemories({ expectedMemories: memories.map(snapshotKnowledgeMemory), signal })
const deleteKnowledgeDocument = (document: KnowledgeDocumentRecord, signal: AbortSignal) => deleteKnowledgeDocumentRecords(document.id, { expectedDocument: { ...document }, signal })
const clearKnowledge = (documents: readonly KnowledgeDocumentRecord[], signal: AbortSignal) => clearKnowledgeRecords({ expectedDocuments: documents.map(document => ({ ...document })), signal })

function primaryActionSurface(colors: ReturnType<typeof useAppTheme>['colors']) {
  return {
    backgroundColor: colors.ui.control.primaryBackground,
    borderWidth: colors.ui.monet ? 1 : StyleSheet.hairlineWidth,
    borderColor: colors.ui.control.primaryBorder,
    borderRadius: Math.min(colors.ui.radius.controlLarge, 8),
  }
}

function secondaryActionSurface(colors: ReturnType<typeof useAppTheme>['colors']) {
  return {
    backgroundColor: colors.ui.liquidGlass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted,
    borderWidth: colors.ui.monet ? 1 : StyleSheet.hairlineWidth,
    borderColor: colors.ui.liquidGlass ? colors.ui.actionBar.itemBorder : colors.ui.monet ? colors.material.stroke : colors.ui.semantic.chrome.border,
    borderRadius: Math.min(colors.ui.radius.controlLarge, 8),
  }
}

function rowActionSurface(colors: ReturnType<typeof useAppTheme>['colors']) {
  return {
    backgroundColor: colors.ui.liquidGlass ? colors.ui.actionBar.itemBackground : colors.ui.monet ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.base,
    borderWidth: colors.ui.monet ? 1 : StyleSheet.hairlineWidth,
    borderColor: colors.ui.liquidGlass ? colors.ui.actionBar.itemBorder : colors.ui.monet ? colors.material.stroke : colors.ui.semantic.chrome.border,
    borderRadius: Math.min(colors.ui.radius.controlMiddle, 8),
  }
}

function assetCardSurface(colors: ReturnType<typeof useAppTheme>['colors'], borderColor = colors.material.stroke) {
  const resolvedBorderColor = colors.ui.monet
    ? borderColor
    : borderColor === colors.material.stroke
      ? colors.ui.liquidGlass
        ? colors.ui.actionBar.itemBorder
        : colors.ui.semantic.chrome.border
      : borderColor
  return {
    borderRadius: Math.min(colors.ui.radius.card, 8),
    backgroundColor: colors.ui.liquidGlass ? colors.ui.semantic.chrome.background : colors.ui.semantic.surface.base,
    borderWidth: colors.ui.monet ? 1 : StyleSheet.hairlineWidth,
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
  const lifetime = useSettingsLifetime()
  const motion = useMotionPreference()
  const { width, fontScale } = useWindowDimensions()
  const compact = width / fontScale < 390
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
  const fieldSession = useSettingsFieldSession()
  const mirrorEntry = fieldSession.entries.localModelDownloadMirrorBaseUrl
  const mirrorStatus = t(mirrorEntry?.error ? 'settingsWorkspace.error' : mirrorEntry ? 'settingsWorkspace.unsaved' : settings.localModelDownloadMirrorBaseUrl ? 'settingsWorkspace.custom' : 'settingsWorkspace.default')
  const [saved, setSaved] = useState(false)
  const [keysReady, setKeysReady] = useState(false)
  const [keysLoadError, setKeysLoadError] = useState(false)
  const [keysLoadRequest, setKeysLoadRequest] = useState(0)
  const [keysSaving, setKeysSaving] = useState(false)
  const keysSaveLock = useRef(false)
  const keysBaseline = useRef<string[]>([])
  const keysDraft = [tavilyKey, googleSearchKey, bingSearchKey, customSearchKey, googleSearchCxDraft, customSearchEndpointDraft]
  const keysDirty = keysReady && keysDraft.some((value, index) => value !== keysBaseline.current[index])
  function discardSearchDraft() {
    const [tavily = '', google = '', bing = '', custom = '', cx = '', endpoint = ''] = keysBaseline.current
    setTavilyKey(tavily); setGoogleSearchKey(google); setBingSearchKey(bing); setCustomSearchKey(custom)
    setGoogleSearchCxDraft(cx); setCustomSearchEndpointDraft(endpoint)
  }
  const requestSearchDiscard = useSettingsDraft(keysDirty, keysSaving, discardSearchDraft, JSON.stringify(keysDraft))
  const savedResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [memories, setMemories] = useState<ContextMemoryRecord[]>([])
  const [documents, setDocuments] = useState<KnowledgeDocumentRecord[]>([])
  const [catalogState, setCatalogState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const catalogRead = useRef(0)
  useEffect(() => () => { catalogRead.current += 1 }, [])
  const [assetBusy, setAssetBusy] = useState(false)
  const [assetError, setAssetError] = useState<'failed' | 'conflict' | 'readback' | null>(null)
  const assetLock = useRef(false)
  const assetReadbackRequiredRef = useRef(true)
  const [assetReadbackRequired, setAssetReadbackRequired] = useState(true)
  const modelReadbackRequiredRef = useRef(false)
  const [modelReadbackRequired, setModelReadbackRequired] = useState(false)
  const modelSelectionSaveRequiredRef = useRef(false)
  const [modelSelectionSaveRequired, setModelSelectionSaveRequired] = useState(false)
  useSettingsDraft(false, assetBusy || modelSelectionSaveRequired, () => undefined)
  const [embeddingJobs, setEmbeddingJobs] = useState<{ running: number; error: number } | null>(null)
  const [indexingJobs, setIndexingJobs] = useState<RagIndexingJobStatus[]>([])
  const [ragLogs, setRagLogs] = useState<RagEvaluationLog[]>([])
  const [ragEvaluating, setRagEvaluating] = useState(false)
  const [ragEvaluation, setRagEvaluation] = useState<RagEvaluationRun | null>(null)
  const [clearingRagCache, setClearingRagCache] = useState(false)
  const diagnosticOperationRef = useRef<(KnowledgeIndexOperation & { kind: 'evaluation' | 'cache' }) | null>(null)
  const diagnosticReadbackRequiredRef = useRef(false)
  const [diagnosticReadbackRequired, setDiagnosticReadbackRequired] = useState(false)
  const [ragEvaluationCanCancel, setRagEvaluationCanCancel] = useState(false)
  const [cancellingRagEvaluation, setCancellingRagEvaluation] = useState(false)
  const [ragEvaluationCancelled, setRagEvaluationCancelled] = useState(false)
  const [localModels, setLocalModels] = useState<LocalEmbeddingModelView[]>([])
  const [modelCatalogState, setModelCatalogState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [modelStateInvalid, setModelStateInvalid] = useState(false)
  const modelStateInvalidRef = useRef(false)
  const localModelRevisionsRef = useRef(new Map<string, { key: string }>())
  const localModelCatalogReadyRef = useRef(false)
  const modelSelectionRevisionRef = useRef({ key: localModelSelectionKey(settings) })
  const modelConsentRevisionRef = useRef({ key: localModelConsentKey(settings) })
  const modelSettingsRevisionRef = useRef<LocalModelSettingsRevision>({ settings, key: JSON.stringify(settings) })
  function observeLocalModelSettings(current: Settings) {
    const selectionKey = localModelSelectionKey(current)
    const consentKey = localModelConsentKey(current)
    if (modelSelectionRevisionRef.current.key !== selectionKey) modelSelectionRevisionRef.current = { key: selectionKey }
    if (modelConsentRevisionRef.current.key !== consentKey) modelConsentRevisionRef.current = { key: consentKey }
    const key = JSON.stringify(current)
    if (modelSettingsRevisionRef.current.settings !== current || modelSettingsRevisionRef.current.key !== key) {
      modelSettingsRevisionRef.current = { settings: current, key }
    }
  }
  observeLocalModelSettings(settings)
  useEffect(() => useSettingsStore.subscribe(state => observeLocalModelSettings(state.settings)), [])
  const modelOperationRef = useRef<LocalModelOperation | null>(null)
  const [modelBusyId, setModelBusyId] = useState<string | null>(null)
  const [modelDownloadCanCancel, setModelDownloadCanCancel] = useState(false)
  const [cancellingModelDownload, setCancellingModelDownload] = useState(false)
  const [modelDownloadCancelled, setModelDownloadCancelled] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<LocalEmbeddingDownloadProgress | null>(null)
  const [rebuilding, setRebuilding] = useState(false)
  const [rebuildReadbackRequired, setRebuildReadbackRequired] = useState(false)
  const rebuildReadbackRequiredRef = useRef(false)
  const rebuildOperationRef = useRef<KnowledgeIndexOperation | null>(null)
  const [rebuildCanCancel, setRebuildCanCancel] = useState(false)
  const [cancellingRebuild, setCancellingRebuild] = useState(false)
  const [rebuildCancelled, setRebuildCancelled] = useState(false)
  const [importing, setImporting] = useState(false)
  const importOperationRef = useRef<KnowledgeIndexOperation | null>(null)
  const [cancellingImport, setCancellingImport] = useState(false)
  const [importCancelled, setImportCancelled] = useState(false)
  const [importReadbackRequired, setImportReadbackRequired] = useState(false)
  const importReadbackRequiredRef = useRef(false)
  const [importCanCancel, setImportCanCancel] = useState(false)
  const [selfTesting, setSelfTesting] = useState(false)
  const selfTestOperationRef = useRef<KnowledgeIndexOperation | null>(null)
  const [selfTestCanCancel, setSelfTestCanCancel] = useState(false)
  const [cancellingSelfTest, setCancellingSelfTest] = useState(false)
  const [selfTestCancelled, setSelfTestCancelled] = useState(false)
  const [selfTestReadbackRequired, setSelfTestReadbackRequired] = useState(false)
  const selfTestReadbackRequiredRef = useRef(false)
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
  const plainDraft = useRef({ title: plainTitle, text: plainText })
  if (plainDraft.current.title !== plainTitle || plainDraft.current.text !== plainText) {
    plainDraft.current = { title: plainTitle, text: plainText }
  }
  const reviewedPlainDraft = plainDraft.current
  const [activeContextSection, setActiveContextSection] = useState<'search' | 'rag' | 'credentials' | null>(null)
  const target = useSettingsTarget()
  const [ragTechniquesOpen, setRagTechniquesOpen] = useState(false)
  const [localModelsOpen, setLocalModelsOpen] = useState(false)
  useEffect(() => {
    if (target === 'rag-profile' || target === 'local-model-mirror') setActiveContextSection('rag')
    if (target === 'local-model-mirror') setLocalModelsOpen(true)
    if (target === 'search-provider') setActiveContextSection('search')
  }, [target])
  const [knowledgeToolsOpen, setKnowledgeToolsOpen] = useState<boolean | undefined>()
  const showContext = section === 'all' || section === 'context'
  const showMemory = section === 'all' || section === 'memory'
  const showKnowledge = section === 'all' || section === 'knowledge'
  useSettingsDraft(showKnowledge && Boolean(plainTitle || plainText), importing, () => { setPlainTitle(''); setPlainText('') }, JSON.stringify([showKnowledge, plainTitle, plainText]))
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
    importOperationRef.current?.controller.abort()
    importOperationRef.current = null
    rebuildOperationRef.current?.controller.abort()
    rebuildOperationRef.current = null
    selfTestOperationRef.current?.controller.abort()
    selfTestOperationRef.current = null
    diagnosticOperationRef.current?.controller.abort()
    diagnosticOperationRef.current = null
    if (savedResetTimerRef.current) clearTimeout(savedResetTimerRef.current)
    savedResetTimerRef.current = null
  }, [])
  useEffect(() => { if (!keysDirty) { keysBaseline.current[4] = settings.googleSearchCx ?? ''; setGoogleSearchCxDraft(settings.googleSearchCx ?? '') } }, [settings.googleSearchCx])
  useEffect(() => { if (!keysDirty) { keysBaseline.current[5] = settings.customSearchEndpoint ?? ''; setCustomSearchEndpointDraft(settings.customSearchEndpoint ?? '') } }, [settings.customSearchEndpoint])
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
    ...(mirrorEntry ? [mirrorStatus] : []),
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
  const knowledgeToolsVisible = knowledgeToolsOpen ?? (hasKnowledgeFilters || knowledgeStatusCounts.failed > 0 || knowledgeStatusCounts.empty > 0 || knowledgeRecoverySummary.recoverableDocuments > 0 || knowledgeRecoverySummary.failedJobs > 0)
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
    ...(isLiquidGlass ? glassShadowStyle(colors) : {}),
  } as const

  async function refresh(options?: { clearModelReadback?: boolean; requireModel?: boolean }): Promise<'ready' | 'failed' | 'retired'> {
    const signal = lifetime.current?.signal
    if (!signal || signal.aborted) return 'retired'
    const request = ++catalogRead.current
    localModelCatalogReadyRef.current = false
    modelStateInvalidRef.current = false
    setModelStateInvalid(false)
    setModelCatalogState('loading')
    setLocalModels([])
    setCatalogState('loading')

    const readModels = async (): Promise<'ready' | 'failed' | 'retired'> => {
      try {
        const models = await listLocalEmbeddingModelViews(snapshotProviderConfiguration(useSettingsStore.getState().settings), signal)
        if (signal.aborted || request !== catalogRead.current) return 'retired'
        const modelSnapshots = snapshotProviderConfiguration(models)
        const modelRevisions = new Map<string, { key: string }>()
        for (const view of modelSnapshots) {
          const key = JSON.stringify(view)
          const previous = localModelRevisionsRef.current.get(view.model.id)
          modelRevisions.set(view.model.id, previous?.key === key ? previous : { key })
        }
        localModelRevisionsRef.current = modelRevisions
        localModelCatalogReadyRef.current = true
        setLocalModels(modelSnapshots)
        setModelCatalogState('ready')
        if (options?.clearModelReadback && !modelOperationRef.current) {
          modelReadbackRequiredRef.current = false
          setModelReadbackRequired(false)
          setAssetError(error => error === 'readback' && !assetReadbackRequiredRef.current ? null : error)
        }
        return 'ready'
      } catch (error) {
        if (signal.aborted || request !== catalogRead.current) return 'retired'
        modelStateInvalidRef.current = error instanceof LocalModelStateDataError
        setModelStateInvalid(modelStateInvalidRef.current)
        setModelCatalogState('failed')
        return 'failed'
      }
    }

    const readAssets = async (): Promise<'ready' | 'failed' | 'retired'> => {
      try {
        const [memoryItems, documentItems, jobs, debug] = await Promise.all([
          listMemories(['pending', 'active', 'disabled']),
          listKnowledgeDocuments(),
          loadRagEmbeddingJobSummary(50),
          loadRagDebugSnapshot(),
        ])
        if (signal.aborted || request !== catalogRead.current) return 'retired'
        setMemories(memoryItems.map(snapshotKnowledgeMemory))
        setDocuments(documentItems.map(document => ({ ...document })))
        setEmbeddingJobs({ running: jobs.running, error: jobs.error })
        setIndexingJobs(debug.indexingJobs)
        setRagLogs(debug.evaluations)
        setCatalogState('ready')
        assetReadbackRequiredRef.current = false
        setAssetReadbackRequired(false)
        setAssetError(error => error === 'readback' && !modelReadbackRequiredRef.current ? null : error)
        if (!importOperationRef.current) {
          importReadbackRequiredRef.current = false
          setImportReadbackRequired(false)
        }
        if (!rebuildOperationRef.current) {
          rebuildReadbackRequiredRef.current = false
          setRebuildReadbackRequired(false)
        }
        if (!selfTestOperationRef.current) {
          selfTestReadbackRequiredRef.current = false
          setSelfTestReadbackRequired(false)
        }
        if (!diagnosticOperationRef.current) {
          diagnosticReadbackRequiredRef.current = false
          setDiagnosticReadbackRequired(false)
        }
        return 'ready'
      } catch {
        if (signal.aborted || request !== catalogRead.current) return 'retired'
        assetReadbackRequiredRef.current = true
        setAssetReadbackRequired(true)
        setCatalogState('failed')
        return 'failed'
      }
    }

    // Model metadata must not hide independent, successful knowledge/memory reads.
    const modelRead = readModels()
    const assetsResult = await readAssets()
    if (options?.requireModel || options?.clearModelReadback) {
      const modelsResult = await modelRead
      if (assetsResult === 'retired' || modelsResult === 'retired') return 'retired'
      return assetsResult === 'ready' && modelsResult === 'ready' ? 'ready' : 'failed'
    }
    return assetsResult
  }

  async function refreshAfterAssetWrite(signal: AbortSignal, requireModel = false): Promise<boolean> {
    if (signal.aborted) return false
    // Only a current catalog read clears debt; another mutation must not serve as retry.
    assetReadbackRequiredRef.current = true
    setAssetReadbackRequired(true)
    const result = await refresh({ requireModel })
    if (signal.aborted) return false
    // A committed write with failed readback is not a failed write to repeat.
    if (result === 'failed') setAssetError('readback')
    return result === 'ready'
  }

  async function mutateAssets(operation: (signal: AbortSignal) => Promise<void>, modelStateRecovery = false) {
    const signal = lifetime.current?.signal
    if (!signal || signal.aborted || assetLock.current || assetReadbackRequiredRef.current || selfTestReadbackRequiredRef.current ||
      importReadbackRequiredRef.current || rebuildReadbackRequiredRef.current || diagnosticReadbackRequiredRef.current ||
      (modelReadbackRequiredRef.current && !modelStateRecovery) || modelSelectionSaveRequiredRef.current ||
      (modelStateRecovery && (!modelStateInvalidRef.current || localModelCatalogReadyRef.current))) return
    assetLock.current = true
    setAssetBusy(true)
    setAssetError(null)
    try { await operation(signal) }
    catch (error) {
      if (signal.aborted) return
      setAssetError(error instanceof KnowledgeRepositoryConflictError ? 'conflict' : 'failed')
      // A batch can be partly persisted. Read it back rather than implying
      // that every requested change either succeeded or was rolled back.
      await refresh()
    } finally { assetLock.current = false; if (!signal.aborted) setAssetBusy(false) }
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

  async function confirmPendingMemories(signal: AbortSignal, targetMemories: ContextMemoryRecord[] = pendingMemories, filtered = false) {
    if (signal.aborted || !targetMemories.length || confirmingMemories) return
    const targets = targetMemories.map(memory => ({
      id: memory.id,
      options: { ...knowledgeMemoryReviewMutationOptions(memory, memories), signal },
    }))
    const confirmed = await dialog.confirm({
      title: t(filtered ? 'contextPanel.confirmFilteredPendingMemoriesTitle' : 'contextPanel.confirmPendingMemoriesTitle', { count: targetMemories.length }),
      message: t('contextPanel.confirmPendingMemoriesMessage'),
      confirmLabel: t(filtered ? 'contextPanel.confirmFilteredPendingMemories' : 'contextPanel.confirmPendingMemories', { count: targetMemories.length }),
      cancelLabel: t('common.cancel'),
      tone: 'mint',
      signal,
    })
    if (signal.aborted || !confirmed) return
    setConfirmingMemories(true)
    try {
      const results = await Promise.allSettled(targets.map(target => knowledgeRepository.updateMemoryStatus(target.id, 'active', target.options)))
      const failed = results.find(result => result.status === 'rejected')
      if (signal.aborted) return
      if (failed?.status === 'rejected') throw failed.reason
      if (!await refreshAfterAssetWrite(signal)) return
      dialog.toast({
        title: t('contextPanel.pendingMemoriesConfirmed', { count: targetMemories.length }),
        tone: 'mint',
      })
    } finally {
      if (!signal.aborted) setConfirmingMemories(false)
    }
  }

  async function rejectPendingMemories(signal: AbortSignal, targetMemories: ContextMemoryRecord[] = filteredPendingMemories) {
    if (signal.aborted || !targetMemories.length || confirmingMemories) return
    const targets = targetMemories.map(snapshotKnowledgeMemory)
    const confirmed = await dialog.confirm({
      title: t('contextPanel.rejectFilteredPendingMemoriesTitle', { count: targetMemories.length }),
      message: t('contextPanel.rejectFilteredPendingMemoriesMessage'),
      confirmLabel: t('contextPanel.rejectFilteredPendingMemories', { count: targetMemories.length }),
      cancelLabel: t('common.cancel'),
      tone: 'danger',
      signal,
    })
    if (signal.aborted || !confirmed) return
    setConfirmingMemories(true)
    try {
      const results = await Promise.allSettled(targets.map(memory => deleteMemory(memory, signal)))
      const failed = results.find(result => result.status === 'rejected')
      if (signal.aborted) return
      if (failed?.status === 'rejected') throw failed.reason
      if (!await refreshAfterAssetWrite(signal)) return
      dialog.toast({
        title: t('contextPanel.pendingMemoriesRejected', { count: targetMemories.length }),
        tone: 'amber',
      })
    } finally {
      if (!signal.aborted) setConfirmingMemories(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setKeysReady(false)
    setKeysLoadError(false)
    void Promise.all([getTavilyApiKey(), getGoogleSearchApiKey(), getBingSearchApiKey(), getCustomSearchApiKey()]).then(keys => {
      if (cancelled) return
      const current = useSettingsStore.getState().settings
      keysBaseline.current = [...keys.map(key => key ?? ''), current.googleSearchCx ?? '', current.customSearchEndpoint ?? '']
      discardSearchDraft()
      setKeysReady(true)
    }).catch(() => { if (!cancelled) setKeysLoadError(true) })
    void refresh()
    return () => { cancelled = true }
  }, [getBingSearchApiKey, getCustomSearchApiKey, getGoogleSearchApiKey, getTavilyApiKey, keysLoadRequest])

  useEffect(() => {
    if (section !== 'memory' || focus !== 'review') return
    setMemoryStatusFocus('pending')
    setMemoryReviewFocus('imported')
    setMemorySortMode('updated')
    setShowAllMemories(true)
  }, [focus, section])

  async function saveTavilyKey() {
    if (!keysReady || keysSaveLock.current) return
    keysSaveLock.current = true
    setKeysSaving(true)
    try {
    const currentKeys = await Promise.all([getTavilyApiKey(), getGoogleSearchApiKey(), getBingSearchApiKey(), getCustomSearchApiKey()])
    const currentSettings = useSettingsStore.getState().settings
    const current = [...currentKeys.map(key => key ?? ''), currentSettings.googleSearchCx ?? '', currentSettings.customSearchEndpoint ?? '']
    if (current.some((value, index) => value !== keysBaseline.current[index] && value !== keysDraft[index].trim())) {
      dialog.toast({ title: t('settingsWorkspace.conflict'), tone: 'amber' })
      return
    }
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
      }
      await flushPersistedSettings()

    keysBaseline.current = [tavilyKey.trim(), googleSearchKey.trim(), bingSearchKey.trim(), customSearchKey.trim(), nextGoogleSearchCx, nextCustomSearchEndpoint]
    discardSearchDraft()
    if (savedResetTimerRef.current) clearTimeout(savedResetTimerRef.current)
    setSaved(true)
    savedResetTimerRef.current = setTimeout(() => {
      savedResetTimerRef.current = null
      setSaved(false)
    }, 1408)
    } catch { dialog.toast({ title: t('settingsWorkspace.saveFailed'), tone: 'danger' }) }
    finally { keysSaveLock.current = false; setKeysSaving(false) }
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
    void requestSearchDiscard(() => {
      updateSettings({ searchProvider: provider, webSearchMode: legacySearchModeForProvider(provider), webSearchEnabled: provider !== 'off' })
      const credentials = searchProviderCredentialPresentation(provider)
      setActiveContextSection(credentials.fields.length || credentials.showEndpoint || credentials.showBearerKey ? 'credentials' : 'search')
    })
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

  async function runKnowledgeImport(kind: 'file' | 'text') {
    const lifetimeSignal = lifetime.current?.signal
    if (!lifetimeSignal || lifetimeSignal.aborted || importOperationRef.current || importReadbackRequiredRef.current || rebuildReadbackRequiredRef.current || selfTestReadbackRequiredRef.current ||
      (kind === 'text' && (reviewedPlainDraft !== plainDraft.current || !plainText.trim()))) return
    const reviewedSettings = snapshotProviderConfiguration(settings)
    const reviewedProviders = snapshotProviderConfiguration(providers)
    const controller = new AbortController()
    const operation: KnowledgeIndexOperation = { controller, phase: 'running' }
    importOperationRef.current = operation
    setImporting(true)
    setImportCanCancel(true)
    setCancellingImport(false)
    setImportCancelled(false)
    try {
      const provider = await getPrimaryConfiguredProvider({ settings: reviewedSettings, providers: reviewedProviders, signal: controller.signal })
      if (controller.signal.aborted) return
      const result = kind === 'file'
        ? await importKnowledgeFile(provider ?? undefined, provider ? getPolicyPreferredProviderModel(provider, reviewedSettings) : undefined, { signal: controller.signal, settings: reviewedSettings })
        : await importKnowledgePlainText(plainTitle, plainText, provider ?? undefined, { signal: controller.signal, settings: reviewedSettings })
      if (controller.signal.aborted) return
      operation.phase = 'readback'
      setImportCanCancel(false)
      if (kind === 'text' && result.ok && reviewedPlainDraft === plainDraft.current) {
        setPlainTitle(''); setPlainText('')
      }
      if (result.ok) {
        if (!await refreshAfterAssetWrite(controller.signal)) return
        dialog.toast({ title: t('contextPanel.knowledgeUpdated'), message: result.message, tone: 'mint' })
      } else {
        const feedback = { title: t('settings.importSkipped'), message: result.message, tone: 'amber' as const }
        if (result.reason === 'pdf_capacity_unavailable') dialog.notice(feedback)
        else dialog.toast(feedback)
        await refresh()
      }
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        controller.abort()
        return
      }
      throw error
    } finally {
      if (importOperationRef.current === operation) {
        if (controller.signal.aborted && !lifetimeSignal.aborted) {
          operation.phase = 'readback'
          setImportCanCancel(false)
          // The adapter has settled; cancelled imports may still have durable records.
          const readback = await refresh()
          if (!lifetimeSignal.aborted) {
            importReadbackRequiredRef.current = readback !== 'ready'
            setImportReadbackRequired(readback !== 'ready')
            setImportCancelled(true)
          }
        }
        if (importOperationRef.current === operation) importOperationRef.current = null
        if (!lifetimeSignal.aborted) {
          setImporting(false)
          setImportCanCancel(false)
          setCancellingImport(false)
        }
      }
    }
  }

  const displayedImport = importOperationRef.current
  function cancelKnowledgeImport() {
    const signal = lifetime.current?.signal
    if (!signal || signal.aborted || !displayedImport || importOperationRef.current !== displayedImport ||
      displayedImport.phase !== 'running' || displayedImport.controller.signal.aborted) return
    importReadbackRequiredRef.current = true
    setImportReadbackRequired(true)
    setCancellingImport(true)
    displayedImport.controller.abort()
  }

  async function runContextSelfTest() {
    if (selfTestReadbackRequiredRef.current || rebuildReadbackRequiredRef.current || importReadbackRequiredRef.current) return
    const reviewedSettings = snapshotProviderConfiguration(settings)
    const reviewedProviders = snapshotProviderConfiguration(providers)
    await mutateAssets(async signal => {
      const controller = new AbortController()
      const operation: KnowledgeIndexOperation = { controller, phase: 'running' }
      const abort = () => controller.abort()
      signal.addEventListener('abort', abort, { once: true })
      selfTestOperationRef.current = operation
      setSelfTesting(true)
      setSelfTestCanCancel(true)
      setCancellingSelfTest(false)
      setSelfTestCancelled(false)
      setSelfTestResult({ ranAt: Date.now(), steps: [] })
      try {
        const primaryProvider = await getPrimaryConfiguredProvider({ settings: reviewedSettings, providers: reviewedProviders, signal: controller.signal })
        if (signal.aborted || controller.signal.aborted) return
        const result = await runContextSelfTestScenario({
          settings: reviewedSettings, primaryProvider, getTavilyApiKey, t, signal: controller.signal,
          onStep: (step: ContextSelfTestStep) => {
            if (controller.signal.aborted || selfTestOperationRef.current !== operation || operation.phase !== 'running') return
            setSelfTestResult(current => ({ ranAt: current?.ranAt ?? Date.now(), steps: [...(current?.steps ?? []), { ...step }] }))
          },
        })
        if (controller.signal.aborted) return
        operation.phase = 'readback'
        setSelfTestCanCancel(false)
        if (!await refreshAfterAssetWrite(controller.signal)) {
          if (!signal.aborted) {
            selfTestReadbackRequiredRef.current = true
            setSelfTestReadbackRequired(true)
          }
          return
        }
        dialog.notice({
          title: result.fail ? t('contextPanel.selfTest.doneWithIssues') : t('contextPanel.selfTest.done'),
          message: t('contextPanel.selfTest.summary', { ok: result.ok, warn: result.warn, fail: result.fail }),
          tone: result.fail ? 'danger' : result.warn ? 'amber' : 'mint',
        })
      } catch (error) {
        if (signal.aborted) return
        const expectedCancellation = controller.signal.aborted && error instanceof Error && error.name === 'AbortError'
        if (!expectedCancellation) {
          setAssetError(error instanceof KnowledgeRepositoryConflictError ? 'conflict' : 'failed')
          setSelfTestResult(current => ({
            ranAt: current?.ranAt ?? Date.now(), steps: [...(current?.steps ?? []), {
              name: t('contextPanel.selfTest.exception'), status: 'fail',
              detail: describeUserFacingError(error, t, { headlineKey: 'contextPanel.selfTest.failed' }),
            }],
          }))
        }
        if (!controller.signal.aborted) {
          operation.phase = 'readback'
          setSelfTestCanCancel(false)
          const readback = await refresh()
          if (!signal.aborted) {
            selfTestReadbackRequiredRef.current = readback !== 'ready'
            setSelfTestReadbackRequired(readback !== 'ready')
          }
        }
      } finally {
        if (selfTestOperationRef.current === operation) {
          if (controller.signal.aborted && !signal.aborted) {
            operation.phase = 'readback'
            setSelfTestCanCancel(false)
            const readback = await refresh()
            if (!signal.aborted) {
              selfTestReadbackRequiredRef.current = readback !== 'ready'
              setSelfTestReadbackRequired(readback !== 'ready')
              setSelfTestCancelled(true)
            }
          }
          if (selfTestOperationRef.current === operation) selfTestOperationRef.current = null
          if (!signal.aborted) {
            setSelfTesting(false); setSelfTestCanCancel(false); setCancellingSelfTest(false)
          }
        }
        signal.removeEventListener('abort', abort)
      }
    })
  }

  const displayedSelfTest = selfTestOperationRef.current
  function cancelContextSelfTest() {
    const signal = lifetime.current?.signal
    if (!signal || signal.aborted || !displayedSelfTest || selfTestOperationRef.current !== displayedSelfTest ||
      displayedSelfTest.phase !== 'running' || displayedSelfTest.controller.signal.aborted) return
    selfTestReadbackRequiredRef.current = true
    setSelfTestReadbackRequired(true)
    setCancellingSelfTest(true)
    displayedSelfTest.controller.abort()
  }

  async function runRagEvaluation() {
    await runRagDiagnostic('evaluation')
  }

  async function runRagDiagnostic(kind: 'evaluation' | 'cache') {
    const reviewedSettings = snapshotProviderConfiguration(settings)
    await mutateAssets(async signal => {
      const controller = new AbortController()
      const operation: KnowledgeIndexOperation & { kind: typeof kind } = { controller, phase: 'running', kind }
      const abort = () => controller.abort()
      signal.addEventListener('abort', abort, { once: true })
      diagnosticOperationRef.current = operation
      let acknowledged = false
      let result: RagEvaluationRun | null = null
      if (kind === 'evaluation') {
        setRagEvaluating(true); setRagEvaluation(null); setRagEvaluationCanCancel(true)
        setCancellingRagEvaluation(false); setRagEvaluationCancelled(false)
      } else setClearingRagCache(true)
      try {
        if (controller.signal.aborted) return
        if (kind === 'evaluation') {
          result = await runRagGoldEvaluation(reviewedSettings, { title: 'RAG evaluation', systemPrompt: '' }, { signal: controller.signal })
        } else await clearRagQueryCaches({ signal: controller.signal })
        acknowledged = true
      } catch (error) {
        const expectedCancellation = controller.signal.aborted && error instanceof Error && error.name === 'AbortError'
        if (!signal.aborted && !expectedCancellation) {
          setAssetError(error instanceof KnowledgeRepositoryConflictError ? 'conflict' : 'failed')
        }
      } finally {
        if (diagnosticOperationRef.current === operation) {
          if (!signal.aborted) {
            operation.phase = 'readback'
            setRagEvaluationCanCancel(false)
            // Settlement can include a committed log/cache write even on failure or cancellation.
            const readback = await refresh()
            if (!signal.aborted) {
              diagnosticReadbackRequiredRef.current = readback !== 'ready'
              setDiagnosticReadbackRequired(readback !== 'ready')
              if (acknowledged && !controller.signal.aborted) {
                if (readback === 'failed') setAssetError('readback')
                if (readback === 'ready') {
                  if (result) {
                    setRagEvaluation(result)
                    dialog.notice({
                      title: t('contextPanel.ragDebug.evaluationDone'),
                      message: t('contextPanel.ragDebug.evaluationSummary', {
                        confidence: Math.round(result.averageConfidence * 100),
                        citation: Math.round(result.averageCitationCoverage * 100),
                        precision: Math.round(result.averageContextPrecision * 100),
                      }), tone: 'mint',
                    })
                  } else dialog.notice({ title: t('contextPanel.cacheCleared'), message: t('contextPanel.cacheClearedMessage'), tone: 'mint' })
                }
              }
              if (kind === 'evaluation') {
                setRagEvaluationCancelled(controller.signal.aborted)
                setRagEvaluating(false); setCancellingRagEvaluation(false)
              } else setClearingRagCache(false)
            }
          }
          if (diagnosticOperationRef.current === operation) diagnosticOperationRef.current = null
        }
        signal.removeEventListener('abort', abort)
      }
    })
  }

  const displayedDiagnostic = diagnosticOperationRef.current
  function cancelRagEvaluation() {
    if (!displayedDiagnostic || displayedDiagnostic.kind !== 'evaluation' ||
      diagnosticOperationRef.current !== displayedDiagnostic || displayedDiagnostic.phase !== 'running') return
    diagnosticReadbackRequiredRef.current = true
    setDiagnosticReadbackRequired(true)
    setCancellingRagEvaluation(true)
    displayedDiagnostic.controller.abort()
  }

  async function flushLocalModelSelection(operation: LocalModelOperation, signal: AbortSignal): Promise<boolean> {
    operation.phase = 'persistence'
    setModelDownloadCanCancel(false)
    setDownloadProgress(null)
    while (!signal.aborted && modelOperationRef.current === operation) {
      observeLocalModelSettings(useSettingsStore.getState().settings)
      const revision = modelSettingsRevisionRef.current
      try { await flushPersistedSettings() }
      catch {
        if (!signal.aborted) {
          modelSelectionSaveRequiredRef.current = true
          setModelSelectionSaveRequired(true)
        }
        return false
      }
      if (signal.aborted || modelOperationRef.current !== operation) return false
      observeLocalModelSettings(useSettingsStore.getState().settings)
      if (revision !== modelSettingsRevisionRef.current) continue
      operation.savedSettings = revision
      modelSelectionSaveRequiredRef.current = false
      setModelSelectionSaveRequired(false)
      return true
    }
    return false
  }

  async function readLocalModelState(operation: LocalModelOperation, signal: AbortSignal, savedSelection = false): Promise<boolean> {
    if (signal.aborted || modelOperationRef.current !== operation) return false
    setModelDownloadCanCancel(false)
    setDownloadProgress(null)
    modelReadbackRequiredRef.current = true
    setModelReadbackRequired(true)
    while (!signal.aborted && modelOperationRef.current === operation) {
      operation.phase = 'readback'
      observeLocalModelSettings(useSettingsStore.getState().settings)
      const selection = modelConsentRevisionRef.current
      const ready = await refreshAfterAssetWrite(signal, true)
      if (signal.aborted || modelOperationRef.current !== operation) return false
      observeLocalModelSettings(useSettingsStore.getState().settings)
      if (ready && savedSelection) {
        // A read of the earlier preference cannot acknowledge a later save.
        if (operation.savedSettings !== modelSettingsRevisionRef.current && !await flushLocalModelSelection(operation, signal)) return false
      }
      if (ready && selection !== modelConsentRevisionRef.current) continue
      modelReadbackRequiredRef.current = !ready
      setModelReadbackRequired(!ready)
      if (ready) setAssetError(error => error === 'readback' ? null : error)
      return ready
    }
    return false
  }

  function requireLocalModelConsent(view: LocalEmbeddingModelView, target: { key: string } | undefined, consent: { key: string }) {
    observeLocalModelSettings(useSettingsStore.getState().settings)
    const currentTarget = localModelRevisionsRef.current.get(view.model.id)
    if (!localModelCatalogReadyRef.current || !target || currentTarget !== target ||
      target.key !== JSON.stringify(view) || modelConsentRevisionRef.current !== consent) {
      throw new KnowledgeRepositoryConflictError()
    }
  }

  function requireModelStateRecoveryConsent(consent: { key: string }) {
    observeLocalModelSettings(useSettingsStore.getState().settings)
    if (!modelStateInvalidRef.current || localModelCatalogReadyRef.current ||
      modelConsentRevisionRef.current !== consent) throw new LocalModelStateRecoveryConflictError()
  }

  async function reviewModelStateReset() {
    await mutateAssets(async signal => {
      observeLocalModelSettings(useSettingsStore.getState().settings)
      const consent = modelConsentRevisionRef.current
      const controller = new AbortController()
      const operation: LocalModelOperation = { controller, kind: 'state-reset', modelId: '', phase: 'review' }
      const abort = () => controller.abort(signal.reason)
      const retired = () => signal.aborted || controller.signal.aborted || modelOperationRef.current !== operation
      signal.addEventListener('abort', abort, { once: true })
      modelOperationRef.current = operation
      try {
        const review = await reviewLocalEmbeddingModelStateRecovery(controller.signal)
        if (retired()) return
        if (!review) {
          await readLocalModelState(operation, signal)
          return
        }
        requireModelStateRecoveryConsent(consent)
        const confirmed = await dialog.confirm({
          title: t('contextPanel.localModel.stateResetTitle'),
          message: t('contextPanel.localModel.stateResetMessage'),
          confirmLabel: t('contextPanel.localModel.resetState'),
          cancelLabel: t('common.cancel'),
          tone: 'danger',
          signal: controller.signal,
        })
        if (retired() || !confirmed) return
        requireModelStateRecoveryConsent(consent)
        operation.phase = 'running'
        await review.reset({
          signal: controller.signal,
          isCurrent: () => {
            if (retired()) return false
            requireModelStateRecoveryConsent(consent)
            return true
          },
        })
        if (retired() || !await readLocalModelState(operation, signal)) return
        if (!retired()) dialog.toast({ title: t('contextPanel.localModel.stateResetDone'), tone: 'mint' })
      } catch (error) {
        if (retired()) return
        const failure = error instanceof LocalModelStateRecoveryConflictError || error instanceof KnowledgeRepositoryConflictError
          ? 'conflict' : 'failed'
        // A rejected acknowledgement can still have removed the index.
        await readLocalModelState(operation, signal)
        if (retired()) return
        setAssetError(failure)
        if (failure === 'failed') dialog.notice({
          title: t('contextPanel.localModel.stateResetFailed'),
          message: t('contextPanel.localModel.stateResetFailedDetail'),
          tone: 'danger',
        })
      } finally {
        if (modelOperationRef.current === operation) modelOperationRef.current = null
        signal.removeEventListener('abort', abort)
      }
    }, true)
  }

  async function runLocalModelOperation(kind: LocalModelOperationKind, view: LocalEmbeddingModelView) {
    await mutateAssets(async signal => {
      const reviewedView = snapshotProviderConfiguration(view)
      const reviewedSettings = snapshotProviderConfiguration(useSettingsStore.getState().settings)
      observeLocalModelSettings(useSettingsStore.getState().settings)
      const target = localModelRevisionsRef.current.get(reviewedView.model.id)
      const consent = modelConsentRevisionRef.current
      const selection = modelSelectionRevisionRef.current
      requireLocalModelConsent(reviewedView, target, consent)
      if (kind === 'enable' && reviewedView.source === 'none') return
      if (kind === 'download' && (!reviewedView.model.files.length || reviewedView.model.sizeBytes <= 0)) {
        showLocalModelDetails(reviewedView)
        return
      }
      if (kind === 'delete' && !reviewedView.downloaded) return
      const controller = new AbortController()
      const operation: LocalModelOperation = { controller, kind, modelId: reviewedView.model.id, phase: 'review' }
      const abort = () => controller.abort()
      signal.addEventListener('abort', abort, { once: true })
      modelOperationRef.current = operation
      setModelBusyId(operation.modelId)
      setDownloadProgress(null)
      setModelDownloadCanCancel(false)
      setCancellingModelDownload(false)
      setModelDownloadCancelled(false)
      let effectStarted = false
      try {
        if (kind !== 'enable') {
          const confirmed = await dialog.confirm({
            title: t(kind === 'download' ? 'contextPanel.localModel.downloadConfirmTitle' : 'contextPanel.localModel.deleteConfirmTitle'),
            message: t(kind === 'download' ? 'contextPanel.localModel.downloadConfirmMessage' : 'contextPanel.localModel.deleteConfirmMessage',
              { name: reviewedView.model.name, size: formatModelBytes(reviewedView.model.sizeBytes) }),
            confirmLabel: t(kind === 'download' ? 'contextPanel.localModel.download' : 'common.delete'),
            cancelLabel: t('common.cancel'),
            tone: kind === 'download' ? 'amber' : 'danger',
            signal: controller.signal,
          })
          if (signal.aborted || controller.signal.aborted || modelOperationRef.current !== operation || !confirmed) return
          requireLocalModelConsent(reviewedView, target, consent)
        }
        operation.phase = 'running'
        if (kind === 'download') {
          effectStarted = true
          setModelDownloadCanCancel(true)
          await downloadLocalEmbeddingModel(operation.modelId, {
            signal: controller.signal,
            mirrorBaseUrl: reviewedSettings.localModelDownloadMirrorBaseUrl,
            onProgress: progress => {
              if (signal.aborted || controller.signal.aborted || modelOperationRef.current !== operation ||
                operation.phase !== 'running' || progress.modelId !== operation.modelId) return
              setDownloadProgress(snapshotProviderConfiguration(progress))
            },
          })
        } else if (kind === 'delete') {
          effectStarted = true
          await deleteDownloadedLocalEmbeddingModel(operation.modelId, controller.signal)
        }
        if (signal.aborted || controller.signal.aborted || modelOperationRef.current !== operation) return
        operation.phase = 'persistence'
        setModelDownloadCanCancel(false)
        setDownloadProgress(null)
        const current = useSettingsStore.getState().settings
        observeLocalModelSettings(current)
        let saved = false
        try {
          // A newer explicit selection wins; retry never restores this reviewed choice.
          if (modelSelectionRevisionRef.current === selection) {
            if (kind === 'delete') {
              if (current.localEmbeddingModelId === operation.modelId && current.localEmbeddingModelSource === 'downloaded') {
                updateSettings({ localEmbeddingModelId: undefined, localEmbeddingModelSource: 'none' })
              }
            } else {
              updateSettings({
                embeddingMode: current.embeddingMode === 'provider' ? 'hybrid' : current.embeddingMode,
                localEmbeddingModelId: operation.modelId,
                localEmbeddingModelSource: kind === 'download' ? 'downloaded' : reviewedView.source,
              })
            }
          }
          saved = await flushLocalModelSelection(operation, signal)
        } catch {
          if (signal.aborted) return
          modelSelectionSaveRequiredRef.current = true
          setModelSelectionSaveRequired(true)
        }
        if (signal.aborted || !await readLocalModelState(operation, signal, saved) || !saved) return
        const acknowledged = useSettingsStore.getState().settings
        if (kind === 'enable' && (acknowledged.localEmbeddingModelId !== operation.modelId ||
          acknowledged.localEmbeddingModelSource !== reviewedView.source)) return
        const success = { title: t(`contextPanel.localModel.${kind === 'download' ? 'downloaded' : kind === 'enable' ? 'enabled' : 'deleted'}`), message: reviewedView.model.name, tone: 'mint' as const }
        if (kind === 'download') dialog.notice(success)
        else dialog.toast(success)
      } catch (error) {
        if (signal.aborted) return
        if (error instanceof Error && error.name === 'AbortError') {
          controller.abort()
          return
        }
        setAssetError(error instanceof KnowledgeRepositoryConflictError ? 'conflict' : 'failed')
        if (effectStarted) {
          await readLocalModelState(operation, signal)
          if (signal.aborted) return
          if (kind === 'download') {
            dialog.notice({ title: t('contextPanel.localModel.downloadFailed'), message: t('contextPanel.localModel.downloadFailedDetail', { error: extractUserFacingErrorDetail(error) || t('contextPanel.localModel.unknownError') }), tone: 'danger' })
          }
        }
      } finally {
        if (modelOperationRef.current === operation) {
          if (controller.signal.aborted && !signal.aborted && effectStarted && operation.phase === 'running') {
            // Cancellation waits for the adapter, then reads possible durable effects.
            await readLocalModelState(operation, signal)
          }
          if (controller.signal.aborted && !signal.aborted && effectStarted && kind === 'download') setModelDownloadCancelled(true)
          if (modelOperationRef.current === operation) modelOperationRef.current = null
          if (!signal.aborted) {
            setModelBusyId(null)
            setModelDownloadCanCancel(false)
            setCancellingModelDownload(false)
            setDownloadProgress(null)
          }
        }
        signal.removeEventListener('abort', abort)
      }
    })
  }

  const displayedModelOperation = modelOperationRef.current
  function cancelLocalModelDownload() {
    const signal = lifetime.current?.signal
    if (!signal || signal.aborted || !displayedModelOperation || modelOperationRef.current !== displayedModelOperation ||
      displayedModelOperation.kind !== 'download' || displayedModelOperation.phase !== 'running' ||
      displayedModelOperation.controller.signal.aborted) return
    modelReadbackRequiredRef.current = true
    setModelReadbackRequired(true)
    setCancellingModelDownload(true)
    setDownloadProgress(null)
    displayedModelOperation.controller.abort()
  }

  async function retryLocalModelSelectionSave() {
    const signal = lifetime.current?.signal
    if (!signal || signal.aborted || assetLock.current || !modelSelectionSaveRequiredRef.current) return
    assetLock.current = true
    setAssetBusy(true)
    const operation: LocalModelOperation = { controller: new AbortController(), kind: 'save', modelId: '', phase: 'persistence' }
    modelOperationRef.current = operation
    try {
      updateSettings(snapshotProviderConfiguration(useSettingsStore.getState().settings))
      const saved = await flushLocalModelSelection(operation, signal)
      if (!signal.aborted) await readLocalModelState(operation, signal, saved)
    } catch {
      if (!signal.aborted) {
        modelSelectionSaveRequiredRef.current = true
        setModelSelectionSaveRequired(true)
        await readLocalModelState(operation, signal)
      }
    } finally {
      if (modelOperationRef.current === operation) modelOperationRef.current = null
      assetLock.current = false
      if (!signal.aborted) setAssetBusy(false)
    }
  }

  function enableLocalModel(view: LocalEmbeddingModelView) {
    return runLocalModelOperation('enable', view)
  }

  function downloadModel(view: LocalEmbeddingModelView) {
    return runLocalModelOperation('download', view)
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

  function deleteModel(view: LocalEmbeddingModelView) {
    return runLocalModelOperation('delete', view)
  }

  async function rebuildIndex() {
    if (rebuildReadbackRequiredRef.current || importReadbackRequiredRef.current || selfTestReadbackRequiredRef.current) return
    const expectedDocuments = documents.map(document => ({ ...document }))
    const reviewedSettings = snapshotProviderConfiguration(settings)
    const reviewedProviders = snapshotProviderConfiguration(providers)
    const indexing = {
      embeddingMode: reviewedSettings.embeddingMode ?? 'hybrid',
      localEmbeddingModelId: reviewedSettings.localEmbeddingModelId, localEmbeddingModelSource: reviewedSettings.localEmbeddingModelSource,
    }
    await mutateAssets(async signal => {
      const controller = new AbortController()
      const operation: KnowledgeIndexOperation = { controller, phase: 'running' }
      const abort = () => controller.abort()
      signal.addEventListener('abort', abort, { once: true })
      rebuildOperationRef.current = operation
      setRebuilding(true)
      setRebuildCanCancel(true)
      setCancellingRebuild(false)
      setRebuildCancelled(false)
      try {
        const provider = await getPrimaryConfiguredProvider({ settings: reviewedSettings, providers: reviewedProviders, signal: controller.signal })
        if (signal.aborted || controller.signal.aborted) return
        const count = await rebuildRagKnowledgeEmbeddings({
          ...indexing, provider: provider ?? undefined,
        }, { signal: controller.signal, expectedDocuments })
        if (controller.signal.aborted) return
        operation.phase = 'readback'
        setRebuildCanCancel(false)
        if (!await refreshAfterAssetWrite(controller.signal)) {
          if (!signal.aborted) {
            rebuildReadbackRequiredRef.current = true
            setRebuildReadbackRequired(true)
          }
          return
        }
        dialog.notice({ title: t('contextPanel.localModel.rebuildDone'), message: t('contextPanel.localModel.rebuildDoneMessage', { count }), tone: 'mint' })
      } catch (error) {
        if (!controller.signal.aborted) throw error
        if (signal.aborted) return
        if (!(error instanceof Error && [
          'AbortError', 'KnowledgeRepositoryCancelledError', 'KnowledgeHybridIndexCancelledError',
          'KnowledgeColbertIndexCancelledError', 'KnowledgeAgenticIndexCancelledError',
        ].includes(error.name))) {
          // Keep failed repair visible; the owned cancellation readback runs exactly once.
          setAssetError(error instanceof KnowledgeRepositoryConflictError ? 'conflict' : 'failed')
        }
      } finally {
        if (rebuildOperationRef.current === operation) {
          if (controller.signal.aborted && !signal.aborted) {
            operation.phase = 'readback'
            setRebuildCanCancel(false)
            // Index/status writes may already be durable; cancellation is not rollback.
            const readback = await refresh()
            if (!signal.aborted) {
              rebuildReadbackRequiredRef.current = readback !== 'ready'
              setRebuildReadbackRequired(readback !== 'ready')
              setRebuildCancelled(true)
            }
          }
          if (rebuildOperationRef.current === operation) rebuildOperationRef.current = null
          if (!signal.aborted) {
            setRebuilding(false)
            setRebuildCanCancel(false)
            setCancellingRebuild(false)
          }
        }
        signal.removeEventListener('abort', abort)
      }
    })
  }

  const displayedRebuild = rebuildOperationRef.current
  function cancelKnowledgeRebuild() {
    const signal = lifetime.current?.signal
    if (!signal || signal.aborted || !displayedRebuild || rebuildOperationRef.current !== displayedRebuild ||
      displayedRebuild.phase !== 'running' || displayedRebuild.controller.signal.aborted) return
    rebuildReadbackRequiredRef.current = true
    setRebuildReadbackRequired(true)
    setCancellingRebuild(true)
    displayedRebuild.controller.abort()
  }

  const modelStateRecoveryBlocked = assetBusy || assetReadbackRequired || importReadbackRequired || rebuildReadbackRequired || selfTestReadbackRequired || diagnosticReadbackRequired || modelSelectionSaveRequired
  const assetsBlocked = modelStateRecoveryBlocked || modelReadbackRequired
  const knowledgeImportControls = showKnowledge ? (
    <KnowledgeImportSection
      importing={importing}
      blocked={assetsBlocked}
      cancelling={cancellingImport}
      cancelled={importCancelled}
      onCancel={importCanCancel ? cancelKnowledgeImport : undefined}
      plainTitle={plainTitle}
      plainText={plainText}
      onPlainTitleChange={setPlainTitle}
      onPlainTextChange={setPlainText}
      onImportFile={() => { if (!importReadbackRequiredRef.current && !rebuildReadbackRequiredRef.current && !selfTestReadbackRequiredRef.current) void mutateAssets(() => runKnowledgeImport('file')) }}
      onImportPlainText={() => { if (!importReadbackRequiredRef.current && !rebuildReadbackRequiredRef.current && !selfTestReadbackRequiredRef.current && reviewedPlainDraft === plainDraft.current) void mutateAssets(() => runKnowledgeImport('text')) }}
    />
  ) : null

  const summary = catalogState === 'ready' && contextSummaryItems.length ? <SettingsSummaryStrip items={contextSummaryItems} /> : undefined
  const toggles = (
      <View style={{ gap: isMinimal ? 0 : 8, marginTop: isMinimal ? 0 : 10 }}>
        {showMemory ? (
          <IsleToggle
            icon={<AppIcon name="reasoning" color={colors.text} size={18} />}
            title={t('settings.longMemory')}
            description={!settings.memoryEnabled ? t('settingsSubsystem.paused') : undefined}
            active={!!settings.memoryEnabled}
            onPress={() => updateSettings({ memoryEnabled: !settings.memoryEnabled })}
          />
        ) : null}
        {showKnowledge ? (
          <IsleToggle
            icon={<AppIcon name="knowledge" color={colors.text} size={18} />}
            title={t('settings.localKnowledge')}
            description={!settings.knowledgeEnabled ? t('settingsSubsystem.paused') : undefined}
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
      {assetBusy ? <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary }}>{t('common.loading')}</Text> : null}
      {modelBusyId && modelDownloadCanCancel ? <IsleButton label={t(cancellingModelDownload ? 'contextPanel.localModel.cancellingDownload' : 'contextPanel.localModel.cancelDownload')} onPress={cancelLocalModelDownload} disabled={cancellingModelDownload} /> : null}
      {modelDownloadCancelled ? <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary }}>{t('contextPanel.localModel.downloadCancelled')}</Text> : null}
      {modelSelectionSaveRequired ? <View style={{ gap: 8 }}>
        <Text accessibilityRole="alert" style={{ color: colors.ui.tone.warning.foreground }}>{t('contextPanel.localModel.selectionSaveFailed')}</Text>
        <IsleButton label={t('contextPanel.localModel.retrySelectionSave')} onPress={() => void retryLocalModelSelectionSave()} disabled={assetBusy} />
      </View> : null}
      {ragEvaluating && ragEvaluationCanCancel ? <IsleButton label={t(cancellingRagEvaluation ? 'contextPanel.cancellingRagEvaluation' : 'contextPanel.cancelRagEvaluation')} onPress={cancelRagEvaluation} disabled={cancellingRagEvaluation} /> : null}
      {ragEvaluationCancelled ? <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary }}>{t('contextPanel.ragEvaluationCancelled')}</Text> : null}
      {selfTesting && selfTestCanCancel ? <IsleButton label={t(cancellingSelfTest ? 'contextPanel.cancellingSelfTest' : 'contextPanel.cancelSelfTest')} onPress={cancelContextSelfTest} disabled={cancellingSelfTest} /> : null}
      {selfTestCancelled ? <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary }}>{t('contextPanel.selfTestCancelled')}</Text> : null}
      {rebuilding && rebuildCanCancel ? <IsleButton label={t(cancellingRebuild ? 'contextPanel.cancellingKnowledgeRebuild' : 'contextPanel.cancelKnowledgeRebuild')} onPress={cancelKnowledgeRebuild} disabled={cancellingRebuild} /> : null}
      {rebuildCancelled ? <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary }}>{t('contextPanel.knowledgeRebuildCancelled')}</Text> : null}
      {assetError ? <Text accessibilityRole="alert" style={{ color: colors.ui.tone.warning.foreground }}>{t(assetError === 'conflict' ? 'settingsWorkspace.conflict' : assetError === 'readback' ? 'settingsSubsystem.operationReadbackFailed' : 'settingsSubsystem.operationFailed')}</Text> : null}
      {(assetReadbackRequired || rebuildReadbackRequired || selfTestReadbackRequired || diagnosticReadbackRequired || modelReadbackRequired) && catalogState !== 'failed' && modelCatalogState !== 'failed' ? <IsleButton label={t('common.retry')} onPress={() => void refresh({ clearModelReadback: true })} disabled={assetBusy} /> : null}
      {catalogState !== 'ready' ? <View style={{ gap: 8, paddingVertical: 8 }}>
        <Text accessibilityRole={catalogState === 'failed' ? 'alert' : undefined} accessibilityLiveRegion="polite" style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20 }}>{t(catalogState === 'failed' ? 'settingsSubsystem.loadFailed' : 'common.loading')}</Text>
        {catalogState === 'failed' ? <IsleButton label={t('common.retry')} onPress={() => void refresh({ clearModelReadback: true })} disabled={assetBusy} /> : null}
      </View> : null}
      {modelCatalogState !== 'ready' ? <View style={{ gap: 8, paddingVertical: 8 }}>
        <Text accessibilityRole={modelCatalogState === 'failed' ? 'alert' : undefined} accessibilityLiveRegion="polite" style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20 }}>{t(modelCatalogState === 'failed' ? 'contextPanel.localModel.loadFailed' : 'common.loading')}</Text>
        {modelCatalogState === 'failed' ? <IsleButton label={t('common.retry')} onPress={() => void refresh({ clearModelReadback: true })} disabled={assetBusy} /> : null}
        {modelStateInvalid ? <>
          <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20 }}>{t('contextPanel.localModel.stateInvalid')}</Text>
          <IsleButton tone="danger" label={t('contextPanel.localModel.reviewStateReset')} onPress={() => void reviewModelStateReset()} disabled={modelStateRecoveryBlocked} />
        </> : null}
      </View> : null}
      {catalogState === 'ready' && importReadbackRequired && !importing
        ? <IsleButton label={t('common.retry')} onPress={() => void refresh()} /> : null}
      {!activeContextSection ? <Lead section={section} summary={summary} toggles={toggles} compact={compact} /> : null}
      {showContext && !activeContextSection && Platform.OS === 'web' ? (
        <Text accessibilityRole="alert" style={{ color: colors.ui.tone.warning.foreground, fontSize: 14, lineHeight: 20, marginTop: 10 }}>
          {t('contextPanel.webCompactStorageWarning')}
        </Text>
      ) : null}

      {showContext ? <SettingsTaskWorkspace onTaskChange={id => setActiveContextSection(id === 'rag-profile' ? 'rag' : id === 'search-provider' ? 'credentials' : null)} tasks={[
        { id: 'search-provider', title: t('settings.webSearch'), description: t('settingsUx.searchHint'), summary: searchProviderLabel(searchProvider), icon: 'globe', content: <><MotiView from={target || motion !== 'full' ? undefined : { opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: motion === 'full' ? 144 : 0 }}>
              <SettingsSection id="search-provider"><View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                {SEARCH_PROVIDER_OPTIONS.map((mode) => (
                  <IslePressable key={mode} haptic accessibilityLabel={searchProviderLabel(mode)} accessibilityState={{ selected: searchProvider === mode }} onPress={() => selectSearchProvider(mode)} style={contextChipPressableStyle}>
                    <IsleChip active={searchProvider === mode}>{searchProviderLabel(mode)}</IsleChip>
                  </IslePressable>
                ))}
              </View></SettingsSection>
              {Platform.OS === 'web' && searchProvider === 'islemind' ? (
                <Text accessibilityRole="alert" style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 8 }}>
                  {t('search.failure.browser_transport_required')}
                </Text>
              ) : null}
            </MotiView>{searchCredentialsAvailable ? <MotiView from={target || motion !== 'full' ? undefined : { opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: motion === 'full' ? 144 : 0 }} style={{ marginTop: 8, ...foldoutPanelStyle }}>
            <ContextFoldoutHeader
              title={searchProviderLabel(searchProvider)}
              detail={searchCredentialsConfiguredCount
                ? t('contextPanel.searchApiActiveDetail', { count: searchCredentialsConfiguredCount })
                : t('contextPanel.searchApiCollapsedDetail')}
            />
            {keysLoadError ? <IsleButton label={t('common.retry')} onPress={() => setKeysLoadRequest(value => value + 1)} /> : null}
            {searchCredentialPresentation.fields.map((field) => (
              <IsleField key={field.id} label={field.label} style={{ marginTop: 10 }} inputProps={{ value: searchCredentialFieldValue(field.id), editable: keysReady && !keysSaving, onChangeText: searchCredentialFieldUpdater(field.id), secureTextEntry: field.secureTextEntry, autoCapitalize: 'none', autoCorrect: false, placeholder: field.placeholder }} />
            ))}
            {searchCredentialPresentation.showEndpoint ? <IsleField label={t('contextPanel.customSearchEndpoint')} style={{ marginTop: 10 }} inputProps={{ value: customSearchEndpointDraft, editable: keysReady && !keysSaving, onChangeText: (value) => { markSearchConfigEdited(); setCustomSearchEndpointDraft(value) }, autoCapitalize: 'none', autoCorrect: false, placeholder: 'https://search.example.com?q={query}&limit={limit}' }} /> : null}
            {searchCredentialPresentation.showBearerKey ? <IsleField label={t('contextPanel.customSearchKey')} style={{ marginTop: 10 }} inputProps={{ value: customSearchKey, editable: keysReady && !keysSaving, onChangeText: (value) => { markSearchConfigEdited(); setCustomSearchKey(value) }, secureTextEntry: true, autoCapitalize: 'none', autoCorrect: false, placeholder: t('contextPanel.optionalBearerKey') }} /> : null}
            <IslePressable haptic accessibilityLabel={saved ? t('common.saved') : t('contextPanel.saveSearchConfig')} disabled={!keysReady || keysSaving} onPress={() => void saveTavilyKey()} style={{ ...fullWidthActionStyle, ...primaryActionSurface(colors), marginTop: 10 }}>
              <Text style={{ color: colors.ui.control.primaryForeground, fontSize: 14, fontWeight: '800' }}>{saved ? t('common.saved') : t('contextPanel.saveSearchConfig')}</Text>
              </IslePressable>
              {keysReady ? <IsleButton label={t('settingsWorkspace.reload')} disabled={keysSaving} onPress={() => void requestSearchDiscard(() => { setSaved(false); setKeysLoadRequest(value => value + 1) })} /> : null}
          </MotiView> : null}</> },
        { id: 'rag-profile', title: t('contextPanel.ragMode'), description: t('settingsUx.retrievalHint'), summary: ragSettingsSummary, icon: 'search-check', targets: ['local-model-mirror'], content: <MotiView from={target || motion !== 'full' ? undefined : { opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: motion === 'full' ? 144 : 0 }} style={{ marginTop: 8, ...foldoutPanelStyle }}>
        {embeddingJobs ? (
          <Text style={{ color: embeddingJobs.error ? colors.ui.tone.warning.foreground : colors.textTertiary, fontSize: 14, lineHeight: 20, marginTop: 6 }}>
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
        <SettingsSection id="rag-profile"><View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {(['fast', 'balanced', 'deep', 'offline'] as const).map((profile) => (
            <IslePressable key={profile} haptic accessibilityLabel={t(`contextPanel.ragProfiles.${profile}`)} accessibilityState={{ selected: (settings.ragProfile ?? 'balanced') === profile }} onPress={() => updateSettings({ ragProfile: profile })} style={{ flexBasis: compact ? '46%' : '22%', flexGrow: 1, minHeight: 92, padding: 14, borderRadius: 14, gap: 12, borderWidth: 2, borderColor: (settings.ragProfile ?? 'balanced') === profile ? colors.primary : colors.ui.semantic.chrome.border, backgroundColor: colors.ui.semantic.surface.base }}>
              <AppIcon name={({ fast: 'activity', balanced: 'layers', deep: 'search-check', offline: 'device' } as const)[profile]} color={colors.primary} size={26} />
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>{t(`contextPanel.ragProfiles.${profile}`)}</Text>
            </IslePressable>
          ))}
        </View></SettingsSection>
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
            <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '800' }}>{t('contextPanel.agenticTechniques')}</Text>
            <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, marginTop: 1 }}>{t('contextPanel.agenticTechniquesCollapsedDetail', { count: enabledTechniqueCount })}</Text>
          </View>
          <MotiView animate={{ rotate: ragTechniquesOpen ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: motion === 'full' ? 160 : 0 }}>
            <AppIcon name="collapse" color={colors.textTertiary} size={16} />
          </MotiView>
        </IslePressable>
        {ragTechniquesOpen ? (
          <MotiView from={target || motion !== 'full' ? undefined : { opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: motion === 'full' ? 144 : 0 }}>
            <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, marginTop: 10 }}>
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
          accessibilityLabel={`${t('contextPanel.localModel.title')}. ${t('contextPanel.localModel.collapsedDetail', { active: activeLocalModelCount, downloadable: downloadableLocalModels.length, planned: plannedLocalCapabilities.length })}. ${t('contextPanel.localModel.mirrorBaseUrl')}: ${mirrorStatus}`}
          accessibilityState={{ expanded: localModelsOpen }}
          onPress={() => setLocalModelsOpen((value) => !value)}
          style={{ marginTop: 10, minHeight: ISLE_MIN_TOUCH_TARGET, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, ...secondaryActionSurface(colors) }}
        >
          <AppIcon name="device" color={colors.textTertiary} size={16} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '800' }}>{t('contextPanel.localModel.title')}</Text>
            <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, marginTop: 1 }}>{t('contextPanel.localModel.collapsedDetail', { active: activeLocalModelCount, downloadable: downloadableLocalModels.length, planned: plannedLocalCapabilities.length })}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20 }}>{t('contextPanel.localModel.mirrorBaseUrl')}: {mirrorStatus}</Text>
          </View>
          <MotiView animate={{ rotate: localModelsOpen ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: motion === 'full' ? 160 : 0 }}>
            <AppIcon name="collapse" color={colors.textTertiary} size={16} />
          </MotiView>
        </IslePressable>
        {localModelsOpen ? (
          <MotiView from={target || motion !== 'full' ? undefined : { opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: motion === 'full' ? 144 : 0 }} style={{ marginTop: 10 }}>
            <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20 }}>
              {t('contextPanel.localModel.priority')}
            </Text>
            <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, marginTop: 4 }}>
              {t('contextPanel.localModel.capabilityNotice')}
            </Text>
            <SettingsSection id="local-model-mirror"><SavedSettingsField
              session={fieldSession}
              settingKey="localModelDownloadMirrorBaseUrl"
              value={settings.localModelDownloadMirrorBaseUrl ?? ''}
              normalize={value => value.trim()}
              onCommit={value => updateSettings({ localModelDownloadMirrorBaseUrl: value })}
              label={t('contextPanel.localModel.mirrorBaseUrl')}
              note={t('contextPanel.localModel.mirrorHelp')}
              style={{ marginTop: 10 }}
              inputProps={{
                returnKeyType: 'done',
                autoCapitalize: 'none',
                autoCorrect: false,
                placeholder: t('contextPanel.localModel.mirrorPlaceholder'),
              }}
            /></SettingsSection>
            <View style={{ marginTop: 10, gap: 10 }}>
              {downloadableLocalModels.length ? (
                <View style={{ gap: 8 }}>
                  <Text style={{ color: colors.textTertiary, fontSize: 14, fontWeight: '700' }}>{t('contextPanel.localModel.downloadableModels')}</Text>
                  {downloadableLocalModels.map((view, index) => (
                    <MotiView
                      key={view.model.id}
                      from={motion === 'full' ? { opacity: 0, translateY: 8 } : { opacity: 0 }}
                      animate={{ opacity: 1, translateY: 0 }}
                      transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 0, delay: motion === 'full' ? Math.min(index * 24, 120) : 0 }}
                    >
                      <LocalModelRow
                        view={view}
                        busy={modelBusyId === view.model.id}
                        blocked={assetsBlocked || modelCatalogState !== 'ready'}
                        progress={downloadProgress?.modelId === view.model.id ? downloadProgress : undefined}
                        onDownload={() => void downloadModel(view)}
                        onDetails={() => showLocalModelDetails(view)}
                        onEnable={() => void enableLocalModel(view)}
                        onDelete={() => void deleteModel(view)}
                      />
                    </MotiView>
                  ))}
                </View>
              ) : modelCatalogState === 'ready' ? (
                <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20 }}>{t('contextPanel.localModel.noDownloadableModels')}</Text>
              ) : null}
              {plannedLocalCapabilities.length ? (
                <View style={{ gap: 8 }}>
                  <Text style={{ color: colors.textTertiary, fontSize: 14, fontWeight: '700' }}>{t('contextPanel.localModel.capabilityStatus')}</Text>
                  <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20 }}>{t('contextPanel.localModel.capabilityStatusHelp')}</Text>
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
              accessibilityState={{ busy: rebuilding }}
              onPress={() => void rebuildIndex()}
              disabled={assetsBlocked}
              style={{ marginTop: 10, minHeight: 44, ...secondaryActionSurface(colors), alignItems: 'center', justifyContent: 'center', opacity: assetsBlocked ? 0.65 : 1 }}
            >
              <Text style={{ color: colors.textSecondary, fontSize: 14, fontWeight: '800' }}>{rebuilding ? t('contextPanel.localModel.rebuilding') : t('contextPanel.localModel.rebuildIndex')}</Text>
            </IslePressable>
          </MotiView>
        ) : null}
        <IslePressable
          haptic
          accessibilityLabel={t('contextPanel.clearRagCache')}
          accessibilityState={{ busy: clearingRagCache, disabled: assetsBlocked }}
          disabled={assetsBlocked}
          onPress={() => void runRagDiagnostic('cache')}
          style={{ ...fullWidthActionStyle, ...secondaryActionSurface(colors), marginTop: 10, opacity: assetsBlocked ? 0.65 : 1 }}
        >
          <Text style={{ color: colors.textSecondary, fontSize: 14, fontWeight: '800' }}>{t('contextPanel.clearRagCache')}</Text>
        </IslePressable>
        <ContextDiagnosticsSection
          selfTesting={selfTesting}
          selfTestBlocked={assetsBlocked}
          selfTestResult={selfTestResult}
          ragEvaluating={ragEvaluating}
          ragEvaluationBlocked={assetsBlocked}
          ragEvaluation={ragEvaluation}
          ragLogs={ragLogs}
          indexingJobs={indexingJobs}
          onRunSelfTest={() => void runContextSelfTest()}
          onRunRagEvaluation={() => void runRagEvaluation()}
          primaryActionStyle={{ ...fullWidthActionStyle, ...primaryActionSurface(colors) }}
          assetCardSurface={(borderColor) => assetCardSurface(colors, borderColor)}
        />
            </MotiView> },
      ]} /> : null}
      {shouldPromoteKnowledgeImport ? knowledgeImportControls : null}
      {!shouldPromoteKnowledgeImport ? knowledgeImportControls : null}

      {showMemory && catalogState === 'ready' ? <ContextList
        title={t('contextPanel.memoryCount', { count: memories.length })}
        empty={t('contextPanel.noMemories')}
        emptyDetail={t('contextPanel.noMemoriesDetail')}
        emptyVisible={!memories.length}
        onClear={() => mutateAssets(async signal => {
          await clearMemories(memories, signal)
          if (signal.aborted) return
          resetMemoryAssetView()
          await refreshAfterAssetWrite(signal)
        })}
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
          confirmingMemories={confirmingMemories || assetsBlocked}
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
          onConfirmPendingMemories={(targetMemories, filtered) => void mutateAssets(signal => confirmPendingMemories(signal, targetMemories, filtered))}
          onRejectPendingMemories={(targetMemories) => void mutateAssets(signal => rejectPendingMemories(signal, targetMemories))}
          onToggleMemory={(memory) => mutateAssets(async signal => {
            await updateMemoryStatus(memory, memory.status === 'active' ? 'disabled' : 'active', memories, signal)
            if (signal.aborted) return
            await refreshAfterAssetWrite(signal)
          })}
          onDeleteMemory={(memory) => mutateAssets(async signal => {
            await deleteMemory(memory, signal)
            if (signal.aborted) return
            await refreshAfterAssetWrite(signal)
          })}
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

      {showKnowledge && catalogState === 'ready' ? <ContextList
        title={t('contextPanel.knowledgeCount', { count: documents.length })}
        empty={t('contextPanel.noKnowledgeFiles')}
        emptyDetail={t('contextPanel.noKnowledgeFilesDetail')}
        emptyVisible={!documents.length}
        onClear={() => mutateAssets(async signal => {
          await clearKnowledge(documents, signal)
          if (signal.aborted) return
          resetKnowledgeAssetView()
          await refreshAfterAssetWrite(signal)
        })}
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
              onPress={() => setKnowledgeToolsOpen(!knowledgeToolsVisible)}
            />
            {knowledgeToolsVisible ? (
              <MotiView from={target || motion !== 'full' ? undefined : { opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: motion === 'full' ? 144 : 0 }} style={{ marginTop: 10 }}>
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
                  <Text testID="knowledge-readiness-warning" style={{ color: knowledgeStatusCounts.failed ? colors.ui.tone.danger.foreground : colors.ui.tone.warning.foreground, fontSize: 14, lineHeight: 20, marginBottom: 10 }}>
                    {knowledgeStatusCounts.failed && knowledgeStatusCounts.empty
                      ? t('contextPanel.knowledgeReadinessWarning', { failed: knowledgeStatusCounts.failed, empty: knowledgeStatusCounts.empty })
                      : knowledgeStatusCounts.failed
                        ? t('contextPanel.knowledgeFailedWarning', { failed: knowledgeStatusCounts.failed })
                        : t('contextPanel.knowledgeEmptyWarning', { empty: knowledgeStatusCounts.empty })}
                  </Text>
                ) : null}
                {knowledgeRecoverySummary.recoverableDocuments || knowledgeRecoverySummary.failedJobs ? (
                  <View testID="knowledge-recovery-summary" style={{ marginBottom: 10, padding: 10, ...assetCardSurface(colors, knowledgeRecoverySummary.failedDocuments || knowledgeRecoverySummary.failedJobs ? colors.ui.tone.danger.border : colors.ui.tone.warning.border) }}>
                    <Text style={{ color: colors.text, fontSize: 14, fontWeight: '800' }}>{t('contextPanel.knowledgeRecoveryTitle')}</Text>
                    <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, marginTop: 4 }}>
                      {t('contextPanel.knowledgeRecoverySummary', {
                        failed: knowledgeRecoverySummary.failedDocuments,
                        empty: knowledgeRecoverySummary.emptyDocuments,
                        jobs: knowledgeRecoverySummary.failedJobs,
                      })}
                    </Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 6 }}>{t('contextPanel.knowledgeRecoverySourceHint')}</Text>
                    {knowledgeRecoverySummary.lastError ? (
                      <Text style={{ color: colors.ui.tone.danger.foreground, fontSize: 14, lineHeight: 20, marginTop: 6 }}>
                        {t('contextPanel.knowledgeRecoveryLastError', { error: knowledgeRecoverySummary.lastError })}
                      </Text>
                    ) : null}
                    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                      {knowledgeRecoverySummary.failedDocuments ? (
                        <IslePressable haptic accessibilityLabel={t('contextPanel.knowledgeRecoveryShowFailed')} onPress={() => focusKnowledgeRecovery('error')} style={{ ...itemRowActionStyle, ...rowActionSurface(colors) }}>
                          <Text style={{ color: colors.ui.tone.danger.foreground, fontSize: 14, fontWeight: '800' }}>{t('contextPanel.knowledgeRecoveryShowFailed')}</Text>
                        </IslePressable>
                      ) : null}
                      {knowledgeRecoverySummary.emptyDocuments ? (
                        <IslePressable haptic accessibilityLabel={t('contextPanel.knowledgeRecoveryShowEmpty')} onPress={() => focusKnowledgeRecovery('empty')} style={{ ...itemRowActionStyle, ...rowActionSurface(colors) }}>
                          <Text style={{ color: colors.ui.tone.warning.foreground, fontSize: 14, fontWeight: '800' }}>{t('contextPanel.knowledgeRecoveryShowEmpty')}</Text>
                        </IslePressable>
                      ) : null}
                      <IslePressable haptic accessibilityLabel={rebuilding ? t('contextPanel.localModel.rebuilding') : t('contextPanel.knowledgeRecoveryRebuild')} accessibilityState={{ busy: rebuilding }} onPress={() => void rebuildIndex()} disabled={assetsBlocked} style={{ ...itemRowActionStyle, ...primaryActionSurface(colors), opacity: assetsBlocked ? 0.65 : 1 }}>
                        <Text style={{ color: colors.ui.control.primaryForeground, fontSize: 14, fontWeight: '800' }}>{rebuilding ? t('contextPanel.localModel.rebuilding') : t('contextPanel.knowledgeRecoveryRebuild')}</Text>
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
                  <Text style={{ color: colors.textTertiary, fontSize: 14, fontWeight: '700', marginBottom: 6 }}>{t('contextPanel.knowledgeSort')}</Text>
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
            <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, flex: 1, minWidth: 0 }}>
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
              <Text style={{ color: colors.textSecondary, fontSize: 14, fontWeight: '800' }}>{t('contextPanel.clearKnowledgeFilters')}</Text>
            </IslePressable>
          </View>
        ) : null}
        {filteredDocuments.length > knowledgePreviewLimit ? (
          <Text testID="knowledge-list-showing-count" style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, marginBottom: 8 }}>
            {t('contextPanel.knowledgeListShowing', { shown: visibleDocuments.length, total: filteredDocuments.length })}
          </Text>
        ) : null}
        {hasKnowledgeFilters && !filteredDocuments.length ? (
          <Text testID="knowledge-filter-empty" style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 8 }}>
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
            onDelete={() => mutateAssets(async signal => {
              await deleteKnowledgeDocument(document, signal)
              if (signal.aborted) return
              await refreshAfterAssetWrite(signal)
            })}
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
            <Text style={{ color: colors.textSecondary, fontSize: 14, fontWeight: '800' }}>
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
      <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '800', includeFontPadding: false }}>
        {title}
      </Text>
      {detail ? (
        <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, marginTop: 2, fontWeight: '700', includeFontPadding: false }}>
          {detail}
        </Text>
      ) : null}
    </View>
  )
}

function ContextDisclosureRow({ title, detail, icon, open, onPress }: { title: string; detail: string; icon: ReactNode; open: boolean; onPress: () => void }) {
  const { colors, canonicalThemeId } = useAppTheme()
  const motion = useMotionPreference()
  if (canonicalThemeId === 'minimal') {
    return (
      <IslePressable haptic accessibilityRole="button" accessibilityLabel={`${title}. ${detail}`} accessibilityState={{ expanded: open }} onPress={onPress} style={{ minHeight: 50, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.semantic.chrome.border }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '700' }}>{title}</Text>
          <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, marginTop: 1, fontWeight: '500' }}>{detail}</Text>
        </View>
        <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, fontWeight: '800' }}>{open ? '−' : '+'}</Text>
      </IslePressable>
    )
  }
  if (canonicalThemeId === 'material') {
    return (
      <IslePressable haptic accessibilityRole="button" accessibilityLabel={`${title}. ${detail}`} accessibilityState={{ expanded: open }} onPress={onPress} style={{ minHeight: 48, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: open ? colors.ui.semantic.surface.base : colors.ui.semantic.surface.muted, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.ui.section.divider, borderRadius: 4 }}>
        {icon}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '800' }}>{title}</Text>
          <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, marginTop: 1, fontWeight: '500' }}>{detail}</Text>
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
        style={{ minHeight: ISLE_MIN_TOUCH_TARGET, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: colors.ui.actionBar.itemBackground, borderWidth: 1, borderColor: colors.ui.actionBar.itemBorder, borderRadius: colors.ui.radius.controlLarge, ...glassShadowStyle(colors, 'control') }}
      >
        {icon}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '800' }}>{title}</Text>
          <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, marginTop: 1 }}>{detail}</Text>
        </View>
        <MotiView animate={{ rotate: open ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: motion === 'full' ? 160 : 0 }}>
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
        <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '800' }}>{title}</Text>
        <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, marginTop: 1 }}>{detail}</Text>
      </View>
      <MotiView animate={{ rotate: open ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: motion === 'full' ? 160 : 0 }}>
        <AppIcon name="collapse" color={colors.textTertiary} size={16} />
      </MotiView>
    </IslePressable>
  )
}

function ContextList({ title, empty, emptyDetail, emptyVisible = false, children, onClear }: { title: string; empty: string; emptyDetail?: string; emptyVisible?: boolean; children: React.ReactNode; onClear: () => Promise<void> }) {
  const { colors, canonicalThemeId } = useAppTheme()
  const dialog = useIsleDialog()
  const lifetime = useSettingsLifetime()
  const { t } = useTranslation()
  const isMinimal = canonicalThemeId === 'minimal'
  const isMaterial = canonicalThemeId === 'material'
  const isLiquidGlass = canonicalThemeId === 'liquid-glass'
  const subtleBorderWidth = isMinimal ? StyleSheet.hairlineWidth : 1
  const borderColor = isLiquidGlass ? colors.ui.actionBar.itemBorder : canonicalThemeId === 'monet' ? colors.material.stroke : colors.ui.semantic.chrome.border
  const emptySurface = isLiquidGlass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted
  const confirmationLock = useRef(false)
  const [confirming, setConfirming] = useState(false)
  async function confirmClear() {
    const signal = lifetime.current?.signal
    if (!signal || signal.aborted || confirmationLock.current) return
    confirmationLock.current = true
    setConfirming(true)
    try {
      const confirmed = await dialog.confirm({
        title: t('contextPanel.clearTitle', { title }),
        message: t('contextPanel.clearConfirm'),
        tone: 'danger',
        confirmLabel: t('contextPanel.clear'),
        cancelLabel: t('common.cancel'),
        signal,
      })
      if (!signal.aborted && confirmed) await onClear()
    } catch {
      if (!signal.aborted) dialog.toast({ title: t('settingsSubsystem.operationFailed'), tone: 'amber' })
    } finally {
      confirmationLock.current = false
      if (!signal.aborted) setConfirming(false)
    }
  }
  if (isMinimal) {
    return (
      <View style={{ marginTop: 16 }}>
        <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.semantic.chrome.border }}>
          <Text style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '800' }}>{title}</Text>
          <IslePressable onPress={() => void confirmClear()} disabled={emptyVisible || confirming} accessibilityState={{ busy: confirming }} accessibilityLabel={t('contextPanel.clearTitle', { title })} style={{ minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center', opacity: emptyVisible ? 0.45 : 1 }}>
            <Text style={{ color: colors.ui.tone.danger.foreground, fontSize: 14, lineHeight: 20, fontWeight: '800' }}>{t('contextPanel.clear')}</Text>
          </IslePressable>
        </View>
        {emptyVisible ? (
          <View style={{ minHeight: emptyDetail ? 58 : 44, paddingVertical: 9, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.semantic.chrome.border }}>
            <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '700' }}>{empty}</Text>
            {emptyDetail ? <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, marginTop: 2, fontWeight: '500' }}>{emptyDetail}</Text> : null}
          </View>
        ) : children}
      </View>
    )
  }
  if (isMaterial) {
    return (
      <View style={{ marginTop: 16, gap: 8 }}>
        <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.section.divider }}>
          <Text style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '800' }}>{title}</Text>
          <IslePressable onPress={() => void confirmClear()} disabled={emptyVisible || confirming} accessibilityState={{ busy: confirming }} accessibilityLabel={t('contextPanel.clearTitle', { title })} style={{ minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center', opacity: emptyVisible ? 0.45 : 1 }}>
            <Text style={{ color: colors.ui.tone.danger.foreground, fontSize: 14, lineHeight: 20, fontWeight: '800' }}>{t('contextPanel.clear')}</Text>
          </IslePressable>
        </View>
        {emptyVisible ? (
          <View style={{ minHeight: emptyDetail ? 58 : 44, paddingHorizontal: 10, paddingVertical: 8, justifyContent: 'center', backgroundColor: colors.ui.semantic.surface.muted, borderLeftWidth: 3, borderLeftColor: colors.ui.section.divider }}>
            <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '700' }}>{empty}</Text>
            {emptyDetail ? <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, marginTop: 2, fontWeight: '500' }}>{emptyDetail}</Text> : null}
          </View>
        ) : children}
      </View>
    )
  }
  if (isLiquidGlass) {
    return (
      <View style={{ marginTop: 12, gap: 8 }}>
        <View style={{ minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 2 }}>
          <Text style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '800' }}>{title}</Text>
          <IslePressable onPress={() => void confirmClear()} disabled={emptyVisible || confirming} accessibilityState={{ busy: confirming }} accessibilityLabel={t('contextPanel.clearTitle', { title })} style={{ width: 44, height: 44, borderRadius: colors.ui.radius.controlLarge, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.tone.danger.background, borderWidth: 1, borderColor: colors.ui.tone.danger.border, opacity: emptyVisible ? 0.45 : 1 }}>
            <AppIcon name="delete" color={colors.ui.tone.danger.foreground} size={15} />
          </IslePressable>
        </View>
        {emptyVisible ? (
          <View style={{ minHeight: emptyDetail ? 64 : 48, borderRadius: colors.ui.radius.panel, paddingHorizontal: 12, paddingVertical: 10, justifyContent: 'center', backgroundColor: emptySurface, borderWidth: 1, borderColor, ...glassShadowStyle(colors) }}>
            <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '800', includeFontPadding: false }}>{empty}</Text>
            {emptyDetail ? <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, marginTop: 2, fontWeight: '600', includeFontPadding: false }}>{emptyDetail}</Text> : null}
          </View>
        ) : children}
      </View>
    )
  }
  return (
    <View style={{ marginTop: 10, gap: 7 }}>
      <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 2 }}>
        <View style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}>
          <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '800', includeFontPadding: false, textAlignVertical: 'center' }}>{title}</Text>
        </View>
        <IslePressable
          onPress={() => void confirmClear()}
          disabled={emptyVisible || confirming}
          accessibilityState={{ busy: confirming }}
          accessibilityLabel={t('contextPanel.clearTitle', { title })}
          style={{ width: 44, height: 44, borderRadius: Math.min(colors.ui.radius.controlLarge, 8), alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.tone.danger.background, borderWidth: 1, borderColor: colors.ui.tone.danger.border, opacity: emptyVisible ? 0.45 : 1 }}
        >
          <AppIcon name="delete" color={colors.ui.tone.danger.foreground} size={15} />
        </IslePressable>
      </View>
      {emptyVisible ? (
        <View style={{ minHeight: emptyDetail ? 58 : 44, borderRadius: Math.min(colors.ui.radius.card, 8), paddingHorizontal: 9, paddingVertical: 8, justifyContent: 'center', backgroundColor: emptySurface, borderWidth: subtleBorderWidth, borderColor }}>
          <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '800', includeFontPadding: false }}>{empty}</Text>
          {emptyDetail ? (
            <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, marginTop: 2, fontWeight: '700', includeFontPadding: false }}>
              {emptyDetail}
            </Text>
          ) : null}
        </View>
      ) : children}
    </View>
  )
}

function LocalModelRow({ view, busy, blocked, progress, onDownload, onDetails, onEnable, onDelete }: {
  view: LocalEmbeddingModelView
  busy: boolean
  blocked: boolean
  progress?: LocalEmbeddingDownloadProgress
  onDownload: () => void
  onDetails: () => void
  onEnable: () => void
  onDelete: () => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const { width, fontScale } = useWindowDimensions()
  const stackedStatus = width / fontScale < 600
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
  const progressStage = progress ? t(`contextPanel.localModel.downloadStages.${progress.stage}`) : ''
  const progressText = progress
    ? t('contextPanel.localModel.progressText', {
        percent: progress.percent,
        file: progress.filePath,
        index: progress.fileIndex,
        count: progress.fileCount,
        stage: progressStage,
      })
    : ''
  return (
    <View style={{ padding: 10, ...assetCardSurface(colors, view.active ? colors.ui.control.primaryBorder : colors.material.stroke) }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 34, height: 34, borderRadius: Math.min(colors.ui.radius.controlMiddle, 8), alignItems: 'center', justifyContent: 'center', backgroundColor: view.active ? colors.ui.control.primaryBackground : colors.ui.icon.accentBackground }}>
          {view.active ? <AppIcon name="check" color={colors.ui.control.primaryForeground} size={16} /> : <AppIcon name="device" color={colors.textTertiary} size={16} />}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: colors.text, fontSize: 14, fontWeight: '800' }}>{view.model.name}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 2 }}>
            {modelMeta}
          </Text>
        </View>
        <Text style={{ width: stackedStatus ? '100%' : undefined, color: view.active ? colors.ui.control.link : colors.textTertiary, fontSize: 14, lineHeight: 20, fontWeight: '800' }}>{statusLabel}</Text>
      </View>
      <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, marginTop: 8 }}>{view.model.useCase}</Text>
      {view.model.experimental ? <Text style={{ color: colors.ui.tone.warning.foreground, fontSize: 14, lineHeight: 20, marginTop: 6 }}>{t('contextPanel.localModel.experimentalNotice')}</Text> : null}
      <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, marginTop: 6 }}>
        {view.model.publisher ?? view.model.upstreamModel ?? '-'} · {view.model.license ?? '-'}
      </Text>
      {progress ? (
        <View style={{ marginTop: 10, gap: 6 }}>
          <IsleProgress percent={progressPercent} size="small" showInfo={false}
            accessibilityLabel={`${view.model.name} · ${progressStage}`} fillColor={colors.ui.control.primaryBackground} />
          <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '800' }}>
            {progressText}
          </Text>
          {progress.sourceUrl ? (
            <Text style={{ color: colors.textTertiary, fontSize: 14, fontWeight: '700' }}>
              {progress.sourceUrl}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        {!view.downloaded && !view.bundled && downloadable ? (
          <IslePressable haptic disabled={blocked} accessibilityLabel={t('contextPanel.localModel.download')} accessibilityState={busy ? { busy: true } : undefined} onPress={onDownload} style={{ ...localModelActionStyle, ...primaryActionSurface(colors), flexDirection: 'row', gap: 6, opacity: blocked ? 0.65 : 1 }}>
            <AppIcon name="download" color={colors.ui.control.primaryForeground} size={13} />
            <Text style={{ color: colors.ui.control.primaryForeground, fontSize: 14, fontWeight: '800' }}>{busy && progress ? `${progress.percent}%` : busy ? t('contextPanel.localModel.downloading') : t('contextPanel.localModel.download')}</Text>
          </IslePressable>
        ) : null}
        {!downloadable ? (
          <IslePressable haptic onPress={onDetails} accessibilityLabel={t('contextPanel.localModel.detailsFor', { name: view.model.name })} style={{ ...localModelActionStyle, ...rowActionSurface(colors) }}>
            <Text style={{ color: colors.textSecondary, fontSize: 14, fontWeight: '800' }}>{t('contextPanel.localModel.details')}</Text>
          </IslePressable>
        ) : null}
        {canEnable && !view.active ? (
          <IslePressable haptic disabled={blocked} accessibilityLabel={t('contextPanel.localModel.enable')} accessibilityState={busy ? { busy: true } : undefined} onPress={onEnable} style={{ ...localModelActionStyle, ...rowActionSurface(colors), opacity: blocked ? 0.65 : 1 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 14, fontWeight: '800' }}>{t('contextPanel.localModel.enable')}</Text>
          </IslePressable>
        ) : null}
        {view.downloaded ? (
          <IslePressable haptic disabled={blocked} accessibilityLabel={t('common.delete')} accessibilityState={busy ? { busy: true } : undefined} onPress={onDelete} style={{ ...localModelActionStyle, ...rowActionSurface(colors), opacity: blocked ? 0.65 : 1 }}>
            <Text style={{ color: colors.ui.tone.danger.foreground, fontSize: 14, fontWeight: '800' }}>{t('common.delete')}</Text>
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
  const { width, fontScale } = useWindowDimensions()
  const stackedStatus = width / fontScale < 600
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
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 34, height: 34, borderRadius: Math.min(colors.ui.radius.controlMiddle, 8), alignItems: 'center', justifyContent: 'center', backgroundColor: active ? colors.ui.control.primaryBackground : colors.ui.tone.warning.background }}>
          {active ? <AppIcon name="check" color={colors.ui.control.primaryForeground} size={16} /> : <AppIcon name="device" color={colors.ui.tone.warning.foreground} size={16} />}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: colors.text, fontSize: 14, fontWeight: '800' }}>{view.model.name}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 2 }}>
            {modelMeta}
          </Text>
        </View>
        <View style={{ width: stackedStatus ? '100%' : undefined, maxWidth: '100%', alignItems: 'flex-start' }}>
          <IsleChip tone={active ? 'mint' : 'amber'}>{active ? t('contextPanel.localModel.strategyOn') : t('contextPanel.localModel.strategyOff')}</IsleChip>
        </View>
      </View>
      <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, marginTop: 8 }}>
        {t(`contextPanel.localModel.fallbackStrategies.${capability}`)}
      </Text>
      <Text style={{ color: active ? colors.textSecondary : colors.ui.tone.warning.foreground, fontSize: 14, lineHeight: 20, marginTop: 6, fontWeight: '800' }}>
        {active ? t('contextPanel.localModel.runtimeBoundaryOn') : t('contextPanel.localModel.runtimeBoundaryOff')}
      </Text>
      <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, marginTop: 6 }}>
        {view.model.publisher ?? view.model.upstreamModel ?? '-'} · {view.model.license ?? '-'}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        <IslePressable haptic onPress={onDetails} accessibilityLabel={t('contextPanel.localModel.detailsFor', { name: view.model.name })} style={{ ...localModelActionStyle, ...rowActionSurface(colors) }}>
          <Text style={{ color: colors.textSecondary, fontSize: 14, fontWeight: '800' }}>{t('contextPanel.localModel.details')}</Text>
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
  const lifetime = useSettingsLifetime()
  const deletionLock = useRef(false)
  const [deleting, setDeleting] = useState(false)

  async function confirmDelete() {
    const signal = lifetime.current?.signal
    if (!signal || signal.aborted || deletionLock.current) return
    deletionLock.current = true
    setDeleting(true)
    try {
      const confirmed = await dialog.confirm({
        title: t('contextPanel.deleteItemTitle'),
        message: t('contextPanel.deleteItemConfirm', { title: deleteName || title }),
        tone: 'danger',
        confirmLabel: t('common.delete'),
        cancelLabel: t('common.cancel'),
        signal,
      })
      if (!signal.aborted && confirmed) await onDelete()
    } catch {
      if (!signal.aborted) dialog.toast({ title: t('settingsSubsystem.operationFailed'), tone: 'amber' })
    } finally {
      deletionLock.current = false
      if (!signal.aborted) setDeleting(false)
    }
  }

  if (canonicalThemeId === 'minimal') {
    return (
      <View style={{ paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.semantic.chrome.border }}>
        <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '800' }}>{title}</Text>
        <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 3 }}>{description}</Text>
        {meta ? <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, marginTop: 4 }}>{meta}</Text> : null}
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
          {trailing && onToggle ? <IslePressable accessibilityLabel={trailing} onPress={() => void onToggle()} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.textSecondary, fontSize: 14, fontWeight: '800' }}>{trailing}</Text></IslePressable> : null}
          <IslePressable accessibilityLabel={t('common.delete')} onPress={() => void confirmDelete()} disabled={deleting} accessibilityState={{ busy: deleting }} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.ui.tone.danger.foreground, fontSize: 14, fontWeight: '800' }}>{t('common.delete')}</Text></IslePressable>
        </View>
      </View>
    )
  }
  if (canonicalThemeId === 'material') {
    return (
      <View style={{ paddingHorizontal: 9, paddingVertical: 9, marginBottom: 6, backgroundColor: colors.ui.semantic.surface.muted, borderLeftWidth: 3, borderLeftColor: colors.ui.section.divider }}>
        <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '800' }}>{`- ${title}`}</Text>
        <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 3 }}>{description}</Text>
        {meta ? <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, marginTop: 4 }}>{`  ${meta}`}</Text> : null}
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 7, flexWrap: 'wrap' }}>
          {trailing && onToggle ? <IslePressable accessibilityLabel={trailing} onPress={() => void onToggle()} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.textSecondary, fontSize: 14, fontWeight: '800' }}>{`toggle(${trailing})`}</Text></IslePressable> : null}
          <IslePressable accessibilityLabel={t('common.delete')} onPress={() => void confirmDelete()} disabled={deleting} accessibilityState={{ busy: deleting }} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.ui.tone.danger.foreground, fontSize: 14, fontWeight: '800' }}>delete()</Text></IslePressable>
        </View>
      </View>
    )
  }
  if (canonicalThemeId === 'liquid-glass') {
    return (
      <View style={{ padding: 12, marginBottom: 9, borderRadius: colors.ui.radius.panel, backgroundColor: colors.ui.actionBar.itemBackground, borderWidth: 1, borderColor: colors.ui.actionBar.itemBorder, ...glassShadowStyle(colors) }}>
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '800' }}>{title}</Text>
        <Text numberOfLines={3} style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 4 }}>{description}</Text>
        {meta ? <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, marginTop: 6 }}>{meta}</Text> : null}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {trailing && onToggle ? (
            <IslePressable accessibilityLabel={trailing} onPress={() => void onToggle()} style={{ ...itemRowActionStyle, backgroundColor: colors.ui.actionBar.itemBackground, borderWidth: 1, borderColor: colors.ui.actionBar.itemBorder, borderRadius: colors.ui.radius.controlMiddle }}>
              <Text style={{ color: colors.textSecondary, fontSize: 14, fontWeight: '800' }}>{trailing}</Text>
            </IslePressable>
          ) : null}
          <IslePressable accessibilityLabel={t('common.delete')} onPress={() => void confirmDelete()} disabled={deleting} accessibilityState={{ busy: deleting }} style={{ ...itemRowActionStyle, backgroundColor: colors.ui.tone.danger.background, borderWidth: 1, borderColor: colors.ui.tone.danger.border, borderRadius: colors.ui.radius.controlMiddle }}>
            <Text style={{ color: colors.ui.tone.danger.foreground, fontSize: 14, fontWeight: '800' }}>{t('common.delete')}</Text>
          </IslePressable>
        </View>
      </View>
    )
  }
  return (
    <View style={{ padding: 10, marginBottom: 8, ...assetCardSurface(colors) }}>
      <Text style={{ color: colors.text, fontSize: 14, fontWeight: '800' }}>{title}</Text>
      <Text numberOfLines={3} style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 4 }}>{description}</Text>
      {meta ? <Text style={{ color: colors.textTertiary, fontSize: 14, lineHeight: 20, marginTop: 6 }}>{meta}</Text> : null}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {trailing && onToggle ? (
          <IslePressable accessibilityLabel={trailing} onPress={() => void onToggle()} style={{ ...itemRowActionStyle, ...rowActionSurface(colors) }}>
            <Text style={{ color: colors.textSecondary, fontSize: 14, fontWeight: '800' }}>{trailing}</Text>
          </IslePressable>
        ) : null}
        <IslePressable accessibilityLabel={t('common.delete')} onPress={() => void confirmDelete()} disabled={deleting} accessibilityState={{ busy: deleting }} style={{ ...itemRowActionStyle, ...rowActionSurface(colors) }}>
          <Text style={{ color: colors.ui.tone.danger.foreground, fontSize: 14, fontWeight: '800' }}>{t('common.delete')}</Text>
        </IslePressable>
      </View>
    </View>
  )
}

function DebugStat({ label, value }: { label: string; value: string }) {
  const { colors, canonicalThemeId } = useAppTheme()
  const { width, fontScale } = useWindowDimensions()
  const statMinWidth = width < 390 ? 64 : 74
  if (canonicalThemeId === 'minimal') {
    return (
      <View style={{ minHeight: 34, minWidth: statMinWidth, paddingHorizontal: 4, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.semantic.chrome.border }}>
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '800' }}>{value}</Text>
        <Text style={{ color: colors.textTertiary, fontSize: 14, fontWeight: '600' }}>{label}</Text>
      </View>
    )
  }
  if (canonicalThemeId === 'material') {
    return (
      <View style={{ minHeight: 34, minWidth: statMinWidth, paddingHorizontal: 8, justifyContent: 'center', backgroundColor: colors.ui.semantic.surface.muted, borderLeftWidth: 2, borderLeftColor: colors.ui.section.divider }}>
        <Text style={{ color: colors.textSecondary, fontSize: 14, fontWeight: '700' }}>{`${label}: ${value}`}</Text>
      </View>
    )
  }
  if (canonicalThemeId === 'liquid-glass') {
    return (
      <View style={{ minHeight: 38, minWidth: statMinWidth, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: colors.ui.radius.controlMiddle, backgroundColor: colors.ui.actionBar.itemBackground, borderWidth: 1, borderColor: colors.ui.actionBar.itemBorder }}>
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '800' }}>{value}</Text>
        <Text style={{ color: colors.textTertiary, fontSize: 14, fontWeight: '800' }}>{label}</Text>
      </View>
    )
  }
  return (
    <View style={{ minHeight: 34, minWidth: statMinWidth, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', ...rowActionSurface(colors) }}>
      <Text style={{ color: colors.text, fontSize: 14, fontWeight: '800' }}>{value}</Text>
      <Text style={{ color: colors.textTertiary, fontSize: 14, fontWeight: '800' }}>{label}</Text>
    </View>
  )
}
