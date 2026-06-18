import { useEffect, useState, type ReactNode } from 'react'
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/ui/AppIcon'
import type { AIProvider, KnowledgeDocument, LocalRagModelCapability, MemoryItem, RagEvaluationLog, RagIndexingJobStatus, Settings } from '@/types'
import { importKnowledgeFile, importKnowledgePlainText } from '@/services/context'
import {
  clearKnowledge,
  clearMemories,
  deleteKnowledgeDocument,
  deleteMemory,
  listKnowledgeDocuments,
  listMemories,
  updateMemoryStatus,
} from '@/services/contextStore'
import {
  deleteDownloadedLocalEmbeddingModel,
  downloadLocalEmbeddingModel,
  formatModelBytes,
  listLocalEmbeddingModelViews,
  type LocalEmbeddingDownloadProgress,
  type LocalEmbeddingModelView,
} from '@/services/localEmbeddingModels'
import { clearRagQueryCaches, listRagEmbeddingJobs, loadRagDebugSnapshot, loadRagEmbeddingJobSummary, rebuildRagKnowledgeEmbeddings, runRagGoldEvaluation, type RagEvaluationRun } from '@/services/ragEvaluation'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import { SEARCH_DIAGNOSTIC_QUERY, SEARCH_PROVIDER_CREDENTIAL_FIELDS, SEARCH_PROVIDER_OPTIONS, legacySearchModeForProvider, resolveSearchProvider, searchProviderLabel } from '@/services/searchPolicy'
import { filterAndSortKnowledgeDocuments, filterAndSortMemories, hasKnowledgeAssetFilters, hasMemoryAssetFilters, knowledgeAssetEmptyMessage, memoryAssetEmptyMessage, type KnowledgeSortMode, type KnowledgeStatusFocus, type MemorySortMode, type MemoryStatusFocus } from '@/services/contextAssetFilters'
import { capabilityLabel, formatKnowledgeMeta, formatMemoryMeta, memoryReviewFocusKey } from '@/services/contextAssetFormatters'
import { isDownloadableLocalModel, localCapabilityEnabled, splitLocalModelViews } from '@/services/contextLocalModelRules'
import { IslePressable } from '@/components/ui/isle'
import { IsleChip } from '@/components/ui/isle'
import { IsleField, IsleSection, IsleToggle } from '@/components/ui/isle'
import { useIsleDialog } from '@/components/ui/isle'
import { getPolicyPreferredProviderModel } from '@/services/ai/policy/providerModelAccess'
import { filterPendingMemoriesForReview, buildMemoryReviewSummary, type MemoryReviewQueueFocus } from '@/utils/memoryReview'
import { buildKnowledgeRecoverySummary } from '@/utils/knowledgeRecovery'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'
import { KnowledgeImportSection } from '@/components/settings/KnowledgeImportSection'
import { runContextSelfTest as runContextSelfTestScenario, type ContextSelfTestStep } from '@/services/contextSelfTest'
import { ContextDiagnosticsSection } from '@/components/settings/ContextDiagnosticsSection'
import { MemoryReviewSection } from '@/components/settings/MemoryReviewSection'

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

function primaryActionSurface(colors: ReturnType<typeof useAppTheme>['colors']) {
  return {
    backgroundColor: colors.ui.control.primaryBackground,
    borderWidth: colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth,
    borderColor: colors.ui.control.primaryBorder,
    borderRadius: colors.ui.radius.controlLarge,
  }
}

function secondaryActionSurface(colors: ReturnType<typeof useAppTheme>['colors']) {
  return {
    backgroundColor: colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.cartoon ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.muted,
    borderWidth: colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth,
    borderColor: colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.cartoon ? colors.material.stroke : colors.ui.semantic.chrome.border,
    borderRadius: colors.ui.radius.controlLarge,
  }
}

function rowActionSurface(colors: ReturnType<typeof useAppTheme>['colors']) {
  return {
    backgroundColor: colors.ui.glass ? colors.ui.actionBar.itemBackground : colors.ui.cartoon ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.base,
    borderWidth: colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth,
    borderColor: colors.ui.glass ? colors.ui.actionBar.itemBorder : colors.ui.cartoon ? colors.material.stroke : colors.ui.semantic.chrome.border,
    borderRadius: colors.ui.radius.controlMiddle,
  }
}

function assetCardSurface(colors: ReturnType<typeof useAppTheme>['colors'], borderColor = colors.material.stroke) {
  const shadowOpacity = colors.ui.cartoon ? colors.ui.card.shadowOpacity : 0
  const resolvedBorderColor = colors.ui.cartoon
    ? borderColor
    : borderColor === colors.material.stroke
      ? colors.ui.glass
        ? colors.ui.actionBar.itemBorder
        : colors.ui.semantic.chrome.border
      : borderColor
  return {
    borderRadius: colors.ui.radius.card,
    backgroundColor: colors.ui.glass ? colors.ui.semantic.chrome.background : colors.ui.cartoon ? colors.ui.semantic.surface.base : colors.ui.semantic.surface.base,
    borderWidth: colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth,
    borderColor: resolvedBorderColor,
    shadowColor: colors.ui.control.shadow,
    shadowOpacity: shadowOpacity > 0 ? Math.min(shadowOpacity, 0.05) : 0,
    shadowRadius: colors.ui.cartoon ? Math.max(1, colors.ui.card.shadowRadius - 6) : 0,
    shadowOffset: { width: 0, height: colors.ui.cartoon ? Math.max(1, colors.ui.card.shadowOffset - 3) : 0 },
    elevation: colors.ui.cartoon && shadowOpacity > 0 ? 1 : 0,
  }
}

export function ContextPanel({ providers, section = 'all', focus }: ContextPanelProps) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const motion = useMotionPreference()
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
  const [saved, setSaved] = useState(false)
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
  const [selfTesting, setSelfTesting] = useState(false)
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
  const showContext = section === 'all' || section === 'context'
  const showMemory = section === 'all' || section === 'memory'
  const showKnowledge = section === 'all' || section === 'knowledge'
  const shouldPromoteKnowledgeImport = showKnowledge && section === 'knowledge' && focus === 'import'
  const pendingMemories = memories.filter((memory) => memory.status === 'pending')
  const memoryReviewSummary = buildMemoryReviewSummary(memories)
  const memoryStatusCounts = {
    pending: pendingMemories.length,
    active: memories.filter((memory) => memory.status === 'active').length,
    disabled: memories.filter((memory) => memory.status === 'disabled').length,
  }
  const knowledgeStatusCounts = {
    ready: documents.filter((document) => document.status === 'ready' && document.chunkCount > 0).length,
    indexing: documents.filter((document) => document.status === 'extracting').length,
    failed: documents.filter((document) => document.status === 'error').length,
    empty: documents.filter((document) => document.status === 'ready' && document.chunkCount <= 0).length,
  }
  const knowledgeRecoverySummary = buildKnowledgeRecoverySummary(documents, indexingJobs)
  const sortedMemories = filterAndSortMemories(memories, {
    statusFocus: memoryStatusFocus,
    reviewFocus: memoryReviewFocus,
    filter: memoryFilter,
    sortMode: memorySortMode,
  })
  const sortedDocuments = filterAndSortKnowledgeDocuments(documents, {
    statusFocus: knowledgeStatusFocus,
    filter: knowledgeFilter,
    sortMode: knowledgeSortMode,
  })
  const filteredMemories = sortedMemories
  const filteredDocuments = sortedDocuments
  const visibleMemories = showAllMemories ? sortedMemories : sortedMemories.slice(0, memoryPreviewLimit)
  const visibleDocuments = showAllKnowledge ? sortedDocuments : sortedDocuments.slice(0, knowledgePreviewLimit)
  const hasMemoryFilters = hasMemoryAssetFilters(memoryStatusFocus, memoryReviewFocus, memoryFilter)
  const hasKnowledgeFilters = hasKnowledgeAssetFilters(knowledgeStatusFocus, knowledgeFilter)
  const filteredPendingMemories = sortedMemories.filter((memory) => memory.status === 'pending')
  const canConfirmFilteredMemories = hasMemoryFilters && filteredPendingMemories.length > 0 && filteredPendingMemories.length < pendingMemories.length
  const canRejectFilteredMemories = (hasMemoryFilters || memoryReviewFocus !== 'all') && filteredPendingMemories.length > 0
  const memoryEmptyMessage = memoryAssetEmptyMessage(memoryStatusFocus, memoryFilter, t)
  const knowledgeEmptyMessage = knowledgeAssetEmptyMessage(knowledgeStatusFocus, knowledgeFilter, t)
  const { downloadable: downloadableLocalModels, planned: plannedLocalCapabilities } = splitLocalModelViews(localModels)

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
    await Promise.all([
      setTavilyApiKey(tavilyKey.trim()),
      setGoogleSearchApiKey(googleSearchKey.trim()),
      setBingSearchApiKey(bingSearchKey.trim()),
      setCustomSearchApiKey(customSearchKey.trim()),
    ])
    setSaved(true)
    setTimeout(() => setSaved(false), 1400)
  }

  function searchCredentialFieldValue(fieldId: typeof SEARCH_PROVIDER_CREDENTIAL_FIELDS[number]['id']): string {
    switch (fieldId) {
      case 'tavilyApiKey':
        return tavilyKey
      case 'googleSearchApiKey':
        return googleSearchKey
      case 'googleSearchCx':
        return settings.googleSearchCx ?? ''
      case 'bingSearchApiKey':
        return bingSearchKey
    }
  }

  function searchCredentialFieldUpdater(fieldId: typeof SEARCH_PROVIDER_CREDENTIAL_FIELDS[number]['id']): (value: string) => void {
    switch (fieldId) {
      case 'tavilyApiKey':
        return setTavilyKey
      case 'googleSearchApiKey':
        return setGoogleSearchKey
      case 'googleSearchCx':
        return (googleSearchCx) => updateSettings({ googleSearchCx })
      case 'bingSearchApiKey':
        return setBingSearchKey
    }
  }

  async function importFile() {
    setImporting(true)
    try {
      const provider = await getPrimaryConfiguredProvider()
      const model = provider ? getPolicyPreferredProviderModel(provider, settings) : undefined
      const result = await importKnowledgeFile(provider ?? undefined, model)
      dialog.toast({ title: result.ok ? t('contextPanel.knowledgeUpdated') : t('settings.importSkipped'), message: result.message, tone: result.ok ? 'mint' : 'amber' })
      await refresh()
    } finally {
      setImporting(false)
    }
  }

  async function importPlainText() {
    setImporting(true)
    try {
      const provider = await getPrimaryConfiguredProvider()
      const result = await importKnowledgePlainText(plainTitle, plainText, provider ?? undefined)
      dialog.toast({ title: result.ok ? t('contextPanel.knowledgeUpdated') : t('settings.importSkipped'), message: result.message, tone: result.ok ? 'mint' : 'amber' })
      if (result.ok) setPlainText('')
      await refresh()
    } finally {
      setImporting(false)
    }
  }

  async function runContextSelfTest() {
    if (selfTesting) return
    setSelfTesting(true)
    try {
      const result = await runContextSelfTestScenario({
        settings,
        primaryProvider: await getPrimaryConfiguredProvider(),
        getTavilyApiKey,
        t,
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
      setSelfTestResult((current) => ({
        ranAt: current?.ranAt ?? Date.now(),
        steps: [
          ...(current?.steps ?? []),
          {
        name: t('contextPanel.selfTest.exception'),
        status: 'fail',
        detail: error instanceof Error ? error.message : t('contextPanel.selfTest.failed'),
          },
        ],
      }))
      dialog.notice({
        title: t('contextPanel.selfTest.doneWithIssues'),
        message: error instanceof Error ? error.message : t('contextPanel.selfTest.failed'),
        tone: 'danger',
      })
    } finally {
      setSelfTesting(false)
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
      dialog.notice({ title: t('contextPanel.ragDebug.evaluationFailed'), message: error instanceof Error ? error.message : t('contextPanel.localModel.unknownError'), tone: 'danger' })
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
      dialog.notice({ title: t('contextPanel.localModel.downloadFailed'), message: t('contextPanel.localModel.downloadFailedDetail', { error: error instanceof Error ? error.message : t('contextPanel.localModel.unknownError') }), tone: 'danger' })
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
      dialog.notice({ title: t('contextPanel.localModel.rebuildFailed'), message: error instanceof Error ? error.message : t('contextPanel.localModel.unknownError'), tone: 'danger' })
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

  return (
    <View style={{ paddingBottom: showKnowledge ? 96 : 0 }}>
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
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {SEARCH_PROVIDER_OPTIONS.map((mode) => (
            <IslePressable key={mode} haptic onPress={() => updateSettings({ searchProvider: mode, webSearchMode: legacySearchModeForProvider(mode), webSearchEnabled: mode !== 'off' })} style={contextChipPressableStyle}>
              <IsleChip active={resolveSearchProvider(settings) === mode}>{searchProviderLabel(mode)}</IsleChip>
            </IslePressable>
          ))}
        </View>
      ) : null}

      {shouldPromoteKnowledgeImport ? knowledgeImportControls : null}

      {showContext ? <IsleSection title={t('contextPanel.ragMode')} material="raised" style={{ marginTop: 12 }}>
        {embeddingJobs ? (
          <Text style={{ color: embeddingJobs.error ? colors.ui.tone.warning.foreground : colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 6 }}>
            {t('contextPanel.embeddingStatus', { running: embeddingJobs.running, failed: embeddingJobs.error })}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {(['hybrid', 'fts', 'off'] as const).map((mode) => (
            <IslePressable key={mode} haptic onPress={() => updateSettings({ ragMode: mode })} style={contextChipPressableStyle}>
              <IsleChip active={(settings.ragMode ?? 'hybrid') === mode}>{mode === 'hybrid' ? t('contextPanel.ragHybrid') : mode === 'fts' ? t('contextPanel.ragFts') : t('contextPanel.ragOff')}</IsleChip>
            </IslePressable>
          ))}
        </View>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '800', marginTop: 14 }}>{t('contextPanel.ragProfile')}</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {(['fast', 'balanced', 'deep', 'offline'] as const).map((profile) => (
            <IslePressable key={profile} haptic onPress={() => updateSettings({ ragProfile: profile })} style={contextChipPressableStyle}>
              <IsleChip active={(settings.ragProfile ?? 'balanced') === profile}>{t(`contextPanel.ragProfiles.${profile}`)}</IsleChip>
            </IslePressable>
          ))}
        </View>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '800', marginTop: 14 }}>{t('contextPanel.agenticTechniques')}</Text>
        <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 4 }}>
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
            return (
            <IslePressable key={key} haptic onPress={() => updateSettings({ [settingKey]: !settings[settingKey] })} style={contextChipPressableStyle}>
              <IsleChip active={settings[settingKey] !== false}>{t(`contextPanel.techniques.${label}`)}</IsleChip>
            </IslePressable>
            )
          })}
        </View>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '800', marginTop: 14 }}>{t('contextPanel.embeddingStrategy')}</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {(['hybrid', 'provider', 'local'] as const).map((mode) => (
            <IslePressable key={mode} haptic onPress={() => updateSettings({ embeddingMode: mode })} style={contextChipPressableStyle}>
              <IsleChip active={(settings.embeddingMode ?? 'hybrid') === mode}>{mode === 'hybrid' ? t('contextPanel.embeddingHybrid') : mode === 'provider' ? t('contextPanel.embeddingProvider') : t('contextPanel.embeddingLocal')}</IsleChip>
            </IslePressable>
          ))}
        </View>
        <View style={{ marginTop: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <AppIcon name="device" color={colors.text} size={17} />
            <Text style={{ color: colors.text, fontSize: 15, fontWeight: '900', flex: 1, minWidth: 0 }}>{t('contextPanel.localModel.title')}</Text>
          </View>
          <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 4 }}>
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
              value: settings.localModelDownloadMirrorBaseUrl ?? '',
              onChangeText: (localModelDownloadMirrorBaseUrl) => updateSettings({ localModelDownloadMirrorBaseUrl }),
              autoCapitalize: 'none',
              autoCorrect: false,
              placeholder: t('contextPanel.localModel.mirrorPlaceholder'),
            }}
          />
          <View style={{ marginTop: 10, gap: 12 }}>
            {downloadableLocalModels.length ? (
              <View style={{ gap: 8 }}>
                <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '900' }}>{t('contextPanel.localModel.downloadableModels')}</Text>
                {downloadableLocalModels.map((view, index) => (
                  <MotiView
                    key={view.model.id}
                    from={motion === 'full' ? { opacity: 0, translateY: 8 } : { opacity: 0 }}
                    animate={{ opacity: 1, translateY: 0 }}
                    transition={motion === 'full'
                      ? { type: 'spring', ...motionTokens.spring.gentle, delay: Math.min(index * 24, 120) }
                      : { type: 'timing', duration: motionTokens.duration.fast }}
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
                <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '900' }}>{t('contextPanel.localModel.capabilityStatus')}</Text>
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
            onPress={() => void rebuildIndex()}
            disabled={rebuilding}
            style={{ marginTop: 10, minHeight: 44, ...secondaryActionSurface(colors), alignItems: 'center', justifyContent: 'center', opacity: rebuilding ? 0.65 : 1 }}
          >
            <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '800' }}>{rebuilding ? t('contextPanel.localModel.rebuilding') : t('contextPanel.localModel.rebuildIndex')}</Text>
          </IslePressable>
        </View>
        <IslePressable
          haptic
          onPress={async () => {
            await clearRagQueryCaches()
            dialog.notice({ title: t('contextPanel.cacheCleared'), message: t('contextPanel.cacheClearedMessage'), tone: 'mint' })
          }}
          style={{ ...fullWidthActionStyle, ...secondaryActionSurface(colors), marginTop: 12 }}
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
      </IsleSection> : null}

      {showContext ? <IsleSection title={t('contextPanel.searchApi')} material="raised" style={{ marginTop: 12 }}>
        {SEARCH_PROVIDER_CREDENTIAL_FIELDS.map((field) => (
          <IsleField key={field.id} label={field.label} style={{ marginTop: 10 }} inputProps={{ value: searchCredentialFieldValue(field.id), onChangeText: searchCredentialFieldUpdater(field.id), secureTextEntry: field.secureTextEntry, autoCapitalize: 'none', autoCorrect: false, placeholder: field.placeholder }} />
        ))}
        <IsleField label={t('contextPanel.customSearchEndpoint')} style={{ marginTop: 10 }} inputProps={{ value: settings.customSearchEndpoint ?? '', onChangeText: (customSearchEndpoint) => updateSettings({ customSearchEndpoint }), autoCapitalize: 'none', autoCorrect: false, placeholder: 'https://search.example.com?q={query}&limit={limit}' }} />
        <IsleField label={t('contextPanel.customSearchKey')} style={{ marginTop: 10 }} inputProps={{ value: customSearchKey, onChangeText: setCustomSearchKey, secureTextEntry: true, autoCapitalize: 'none', autoCorrect: false, placeholder: t('contextPanel.optionalBearerKey') }} />
        <IslePressable haptic onPress={saveTavilyKey} style={{ ...fullWidthActionStyle, ...primaryActionSurface(colors), marginTop: 10 }}>
          <Text style={{ color: colors.ui.control.primaryForeground, fontSize: 14, fontWeight: '800' }}>{saved ? t('common.saved') : t('contextPanel.saveSearchConfig')}</Text>
        </IslePressable>
      </IsleSection> : null}

      {!shouldPromoteKnowledgeImport ? knowledgeImportControls : null}

      {showMemory ? <ContextList
        title={t('contextPanel.memoryCount', { count: memories.length })}
        empty={t('contextPanel.noMemories')}
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
        onClear={async () => {
          await clearKnowledge()
          resetKnowledgeAssetView()
          await refresh()
        }}
      >
        {documents.length ? (
          <View testID="knowledge-readiness-summary" style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <DebugStat label={t('contextPanel.knowledgeReadyCount')} value={String(knowledgeStatusCounts.ready)} />
            <DebugStat label={t('contextPanel.knowledgeIndexingCount')} value={String(knowledgeStatusCounts.indexing)} />
            <DebugStat label={t('contextPanel.knowledgeFailedCount')} value={String(knowledgeStatusCounts.failed)} />
            <DebugStat label={t('contextPanel.knowledgeEmptyCount')} value={String(knowledgeStatusCounts.empty)} />
          </View>
        ) : null}
        {documents.length ? (
          <View testID="knowledge-status-focus" style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            {([
              ['all', t('contextPanel.statusFocusAll', { count: documents.length })],
              ['ready', t('contextPanel.statusFocusReady', { count: knowledgeStatusCounts.ready })],
              ['extracting', t('contextPanel.statusFocusIndexing', { count: knowledgeStatusCounts.indexing })],
              ['error', t('contextPanel.statusFocusFailed', { count: knowledgeStatusCounts.failed })],
              ['empty', t('contextPanel.statusFocusEmpty', { count: knowledgeStatusCounts.empty })],
            ] satisfies Array<[KnowledgeStatusFocus, string]>).map(([status, label]) => (
              <IslePressable key={status} haptic onPress={() => setKnowledgeStatusFocus(status)} style={contextChipPressableStyle}>
                <IsleChip active={knowledgeStatusFocus === status}>{label}</IsleChip>
              </IslePressable>
            ))}
          </View>
        ) : null}
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
          <View testID="knowledge-recovery-summary" style={{ marginBottom: 10, padding: 12, ...assetCardSurface(colors, knowledgeRecoverySummary.failedDocuments || knowledgeRecoverySummary.failedJobs ? colors.ui.tone.danger.border : colors.ui.tone.warning.border) }}>
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '900' }}>{t('contextPanel.knowledgeRecoveryTitle')}</Text>
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
                <IslePressable haptic onPress={() => focusKnowledgeRecovery('error')} style={{ ...itemRowActionStyle, ...rowActionSurface(colors) }}>
                  <Text style={{ color: colors.ui.tone.danger.foreground, fontSize: 12, fontWeight: '900' }}>{t('contextPanel.knowledgeRecoveryShowFailed')}</Text>
                </IslePressable>
              ) : null}
              {knowledgeRecoverySummary.emptyDocuments ? (
                <IslePressable haptic onPress={() => focusKnowledgeRecovery('empty')} style={{ ...itemRowActionStyle, ...rowActionSurface(colors) }}>
                  <Text style={{ color: colors.ui.tone.warning.foreground, fontSize: 12, fontWeight: '900' }}>{t('contextPanel.knowledgeRecoveryShowEmpty')}</Text>
                </IslePressable>
              ) : null}
              <IslePressable haptic onPress={() => void rebuildIndex()} disabled={rebuilding} style={{ ...itemRowActionStyle, ...primaryActionSurface(colors), opacity: rebuilding ? 0.65 : 1 }}>
                <Text style={{ color: colors.ui.control.primaryForeground, fontSize: 12, fontWeight: '900' }}>{rebuilding ? t('contextPanel.localModel.rebuilding') : t('contextPanel.knowledgeRecoveryRebuild')}</Text>
              </IslePressable>
            </View>
          </View>
        ) : null}
        {documents.length ? (
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
        ) : null}
        {documents.length ? (
          <View testID="knowledge-sort-mode" style={{ marginBottom: 10 }}>
            <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '900', marginBottom: 6 }}>{t('contextPanel.knowledgeSort')}</Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {([
                ['updated', t('contextPanel.knowledgeSortUpdated')],
                ['needsReview', t('contextPanel.knowledgeSortNeedsReview')],
                ['chunks', t('contextPanel.knowledgeSortChunks')],
                ['title', t('contextPanel.knowledgeSortTitle')],
              ] satisfies Array<[KnowledgeSortMode, string]>).map(([mode, label]) => (
                <IslePressable key={mode} haptic onPress={() => setKnowledgeSortMode(mode)} style={contextChipPressableStyle}>
                  <IsleChip active={knowledgeSortMode === mode}>{label}</IsleChip>
                </IslePressable>
              ))}
            </View>
          </View>
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
              <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '900' }}>{t('contextPanel.clearKnowledgeFilters')}</Text>
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

function ContextList({ title, empty, children, onClear }: { title: string; empty: string; children: React.ReactNode; onClear: () => Promise<void> }) {
  const { colors } = useAppTheme()
  const dialog = useIsleDialog()
  const { t } = useTranslation()
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
  return (
    <View style={{ marginTop: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: '800' }}>{title}</Text>
        <IslePressable
          onPress={confirmClear}
          accessibilityLabel={t('contextPanel.clearTitle', { title })}
          style={{ width: 44, height: 44, borderRadius: colors.ui.radius.controlLarge, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ui.tone.danger.background, borderWidth: colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth, borderColor: colors.ui.tone.danger.border }}
        >
          <AppIcon name="delete" color={colors.ui.tone.danger.foreground} size={15} />
        </IslePressable>
      </View>
      {children || <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{empty}</Text>}
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
    <View style={{ padding: 12, ...assetCardSurface(colors, view.active ? colors.ui.control.primaryBorder : colors.material.stroke) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 34, height: 34, borderRadius: colors.ui.radius.controlMiddle, alignItems: 'center', justifyContent: 'center', backgroundColor: view.active ? colors.ui.control.primaryBackground : colors.ui.icon.accentBackground }}>
          {view.active ? <AppIcon name="check" color={colors.ui.control.primaryForeground} size={16} /> : <AppIcon name="device" color={colors.textTertiary} size={16} />}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13, fontWeight: '900' }}>{view.model.name}</Text>
          <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 2 }}>
            {modelMeta}
          </Text>
        </View>
        <Text style={{ color: view.active ? colors.ui.control.link : colors.textTertiary, fontSize: 11, fontWeight: '900' }}>{statusLabel}</Text>
      </View>
      <Text numberOfLines={2} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 8 }}>{view.model.useCase}</Text>
      <Text numberOfLines={2} style={{ color: colors.textTertiary, fontSize: 10, lineHeight: 15, marginTop: 6 }}>
        {view.model.publisher ?? view.model.upstreamModel ?? '-'} · {view.model.license ?? '-'}
      </Text>
      {progress ? (
        <View style={{ marginTop: 10, gap: 6 }}>
          <View style={{ height: 6, borderRadius: colors.ui.radius.chip, overflow: 'hidden', backgroundColor: colors.ui.section.divider }}>
            <View style={{ width: `${Math.max(2, progressPercent)}%`, height: '100%', borderRadius: colors.ui.radius.chip, backgroundColor: colors.ui.control.primaryBackground }} />
          </View>
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
          <IslePressable haptic disabled={busy} onPress={onDownload} style={{ ...localModelActionStyle, ...primaryActionSurface(colors), flexDirection: 'row', gap: 6, opacity: busy ? 0.65 : 1 }}>
            <AppIcon name="download" color={colors.ui.control.primaryForeground} size={13} />
            <Text style={{ color: colors.ui.control.primaryForeground, fontSize: 12, fontWeight: '900' }}>{busy && progress ? `${progress.percent}%` : busy ? t('contextPanel.localModel.downloading') : t('contextPanel.localModel.download')}</Text>
          </IslePressable>
        ) : null}
        {!downloadable ? (
          <IslePressable haptic onPress={onDetails} accessibilityLabel={t('contextPanel.localModel.detailsFor', { name: view.model.name })} style={{ ...localModelActionStyle, ...rowActionSurface(colors) }}>
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '900' }}>{t('contextPanel.localModel.details')}</Text>
          </IslePressable>
        ) : null}
        {canEnable && !view.active ? (
          <IslePressable haptic disabled={busy} onPress={onEnable} style={{ ...localModelActionStyle, ...rowActionSurface(colors), opacity: busy ? 0.65 : 1 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '900' }}>{t('contextPanel.localModel.enable')}</Text>
          </IslePressable>
        ) : null}
        {view.downloaded ? (
          <IslePressable haptic disabled={busy} onPress={onDelete} style={{ ...localModelActionStyle, ...rowActionSurface(colors), opacity: busy ? 0.65 : 1 }}>
            <Text style={{ color: colors.ui.tone.danger.foreground, fontSize: 12, fontWeight: '900' }}>{t('common.delete')}</Text>
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
    <View style={{ padding: 12, ...assetCardSurface(colors, active ? colors.ui.control.primaryBorder : colors.ui.tone.warning.border) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 34, height: 34, borderRadius: colors.ui.radius.controlMiddle, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? colors.ui.control.primaryBackground : colors.ui.tone.warning.background }}>
          {active ? <AppIcon name="check" color={colors.ui.control.primaryForeground} size={16} /> : <AppIcon name="device" color={colors.ui.tone.warning.foreground} size={16} />}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13, fontWeight: '900' }}>{view.model.name}</Text>
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
          <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '900' }}>{t('contextPanel.localModel.details')}</Text>
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
  const { colors } = useAppTheme()
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

  return (
    <View style={{ padding: 12, marginBottom: 8, ...assetCardSurface(colors) }}>
      <Text style={{ color: colors.text, fontSize: 14, fontWeight: '800' }}>{title}</Text>
      <Text numberOfLines={3} style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 4 }}>{description}</Text>
      {meta ? <Text numberOfLines={2} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 6 }}>{meta}</Text> : null}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {trailing && onToggle ? (
          <IslePressable onPress={() => void onToggle()} style={{ ...itemRowActionStyle, ...rowActionSurface(colors) }}>
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '800' }}>{trailing}</Text>
          </IslePressable>
        ) : null}
        <IslePressable onPress={() => void confirmDelete()} style={{ ...itemRowActionStyle, ...rowActionSurface(colors) }}>
          <Text style={{ color: colors.ui.tone.danger.foreground, fontSize: 12, fontWeight: '800' }}>{t('common.delete')}</Text>
        </IslePressable>
      </View>
    </View>
  )
}

function DebugStat({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme()
  const { width } = useWindowDimensions()
  const statMinWidth = width < 390 ? 64 : 74
  return (
    <View style={{ minHeight: 34, minWidth: statMinWidth, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', ...rowActionSurface(colors) }}>
      <Text style={{ color: colors.text, fontSize: 12, fontWeight: '900' }}>{value}</Text>
      <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '800' }}>{label}</Text>
    </View>
  )
}
