import { useEffect, useState, type ReactNode } from 'react'
import { Text, View } from 'react-native'
import { BookOpen, Brain, Check, Download, Globe2, HardDrive, Trash2, Upload } from 'lucide-react-native'
import { MotiView } from 'moti'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type { AIProvider, Conversation, KnowledgeDocument, LocalRagModelCapability, MemoryItem, MemorySourceKind, Message, RagEvaluationLog, RagIndexingJobStatus, Settings } from '@/types'
import { extractMemories, importKnowledgeFile, importKnowledgePlainText, retrieveContext, searchWeb } from '@/services/context'
import {
  addMemory,
  clearKnowledge,
  clearMemories,
  deleteKnowledgeDocument,
  deleteMemory,
  listKnowledgeDocuments,
  listMemories,
  searchKnowledge,
  searchMemories,
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
import { IslePressable } from '@/components/ui/isle'
import { IsleChip } from '@/components/ui/isle'
import { IsleField, IsleSection, IsleToggle } from '@/components/ui/isle'
import { useIsleDialog } from '@/components/ui/isle'
import { getPolicyPreferredProviderModel } from '@/services/ai/policy/providerModelAccess'
import { filterPendingMemoriesForReview, buildMemoryReviewSummary, type MemoryReviewQueueFocus } from '@/utils/memoryReview'
import { buildKnowledgeRecoverySummary } from '@/utils/knowledgeRecovery'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'

interface ContextPanelProps {
  providers: AIProvider[]
  section?: 'all' | 'context' | 'memory' | 'knowledge'
  focus?: 'import' | 'review'
}

interface SelfTestStep {
  name: string
  status: 'ok' | 'warn' | 'fail'
  detail: string
}

interface SelfTestResult {
  ranAt: number
  steps: SelfTestStep[]
}

type MemoryStatusFocus = 'all' | MemoryItem['status']
type KnowledgeStatusFocus = 'all' | 'ready' | 'extracting' | 'error' | 'empty'
type MemorySortMode = 'updated' | 'created' | 'lastUsed'
type KnowledgeSortMode = 'updated' | 'title' | 'chunks' | 'needsReview'

const memoryReviewSourceFocuses: MemorySourceKind[] = ['imported', 'model', 'deterministic', 'manual', 'legacy']

const contextChipPressableStyle = { minHeight: 44, justifyContent: 'center' as const }
const localModelActionStyle = {
  minHeight: 44,
  paddingHorizontal: 14,
  borderRadius: 18,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
}
const fullWidthActionStyle = {
  minHeight: 44,
  borderRadius: 22,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
}
const itemRowActionStyle = {
  minHeight: 44,
  paddingHorizontal: 14,
  borderRadius: 18,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
}
const memoryPreviewLimit = 6
const knowledgePreviewLimit = 6

function primaryActionSurface(colors: ReturnType<typeof useAppTheme>['colors']) {
  return {
    backgroundColor: colors.ui.control.primaryBackground,
    borderWidth: 1,
    borderColor: colors.ui.control.primaryBorder,
    borderRadius: colors.ui.radius.controlLarge,
  }
}

function secondaryActionSurface(colors: ReturnType<typeof useAppTheme>['colors']) {
  return {
    backgroundColor: colors.material.paperRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: colors.ui.radius.controlLarge,
  }
}

function rowActionSurface(colors: ReturnType<typeof useAppTheme>['colors']) {
  return {
    backgroundColor: colors.material.paperRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: colors.ui.radius.controlMiddle,
  }
}

function assetCardSurface(colors: ReturnType<typeof useAppTheme>['colors'], borderColor = colors.border) {
  return {
    borderRadius: colors.ui.radius.card,
    backgroundColor: colors.material.paperRaised,
    borderWidth: 1,
    borderColor,
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
  const normalizedMemoryFilter = memoryFilter.trim().toLocaleLowerCase()
  const normalizedKnowledgeFilter = knowledgeFilter.trim().toLocaleLowerCase()
  const statusFocusedMemories = memoryStatusFocus === 'all'
    ? memories
    : memories.filter((memory) => memory.status === memoryStatusFocus)
  const statusFocusedDocuments = knowledgeStatusFocus === 'all'
    ? documents
    : documents.filter((document) => {
      if (knowledgeStatusFocus === 'empty') return document.status === 'ready' && document.chunkCount <= 0
      if (knowledgeStatusFocus === 'ready') return document.status === 'ready' && document.chunkCount > 0
      return document.status === knowledgeStatusFocus
    })
  const filteredMemories = normalizedMemoryFilter
    ? statusFocusedMemories.filter((memory) => {
      const searchableMeta = [
        memory.content,
        memory.status,
        memory.conversationId,
        memory.sourceKind,
        memory.sourceDetail,
        typeof memory.confidence === 'number' ? Math.round(Math.max(0, Math.min(1, memory.confidence)) * 100) : undefined,
      ].filter(Boolean).join(' ')
      return searchableMeta.toLocaleLowerCase().includes(normalizedMemoryFilter)
    })
    : statusFocusedMemories
  const filteredDocuments = normalizedKnowledgeFilter
    ? statusFocusedDocuments.filter((document) => {
      return `${document.title} ${document.status} ${document.error ?? ''} ${document.chunkCount} ${Math.round(document.size / 1024)}`.toLocaleLowerCase().includes(normalizedKnowledgeFilter)
    })
    : statusFocusedDocuments
  const reviewFilteredMemories = memoryStatusFocus === 'pending' && memoryReviewFocus !== 'all'
    ? filterPendingMemoriesForReview(filteredMemories, memoryReviewFocus)
    : filteredMemories
  const sortedMemories = sortMemories(reviewFilteredMemories, memorySortMode)
  const sortedDocuments = sortKnowledgeDocuments(filteredDocuments, knowledgeSortMode)
  const visibleMemories = showAllMemories ? sortedMemories : sortedMemories.slice(0, memoryPreviewLimit)
  const visibleDocuments = showAllKnowledge ? sortedDocuments : sortedDocuments.slice(0, knowledgePreviewLimit)
  const hasMemoryFilters = memoryStatusFocus !== 'all' || memoryReviewFocus !== 'all' || !!memoryFilter.trim()
  const hasKnowledgeFilters = knowledgeStatusFocus !== 'all' || !!knowledgeFilter.trim()
  const filteredPendingMemories = sortedMemories.filter((memory) => memory.status === 'pending')
  const canConfirmFilteredMemories = hasMemoryFilters && filteredPendingMemories.length > 0 && filteredPendingMemories.length < pendingMemories.length
  const canRejectFilteredMemories = (hasMemoryFilters || memoryReviewFocus !== 'all') && filteredPendingMemories.length > 0
  const memoryEmptyMessage = memoryAssetEmptyMessage(memoryStatusFocus, normalizedMemoryFilter, t)
  const knowledgeEmptyMessage = knowledgeAssetEmptyMessage(knowledgeStatusFocus, normalizedKnowledgeFilter, t)
  const downloadableLocalModels = localModels.filter(isDownloadableLocalModel)
  const plannedLocalCapabilities = localModels.filter((view) => !isDownloadableLocalModel(view))

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
    const steps: SelfTestStep[] = []
    const canary = `islemind_canary_${Date.now()}`
    const primaryProvider = await getPrimaryConfiguredProvider()

    function pushStep(step: SelfTestStep) {
      steps.push(step)
      setSelfTestResult({ ranAt: Date.now(), steps: [...steps] })
    }

    try {
      const knowledgeText = [
        `IsleMind context self-test marker: ${canary}.`,
        `The RAG answer for ${canary} is aurora-lantern.`,
        'This text is intentionally local-only and should be retrievable by SQLite FTS or hybrid retrieval.',
      ].join(' ')
      const importResult = await importKnowledgePlainText(`Self test ${canary}`, knowledgeText, primaryProvider ?? undefined)
      pushStep({
        name: t('contextPanel.selfTest.knowledgeWrite'),
        status: importResult.ok ? 'ok' : 'fail',
        detail: importResult.message,
      })

      const knowledgeHits = await searchKnowledge(`${canary} aurora-lantern`, 3)
      pushStep({
        name: t('contextPanel.selfTest.knowledgeFts'),
        status: knowledgeHits.length ? 'ok' : 'fail',
        detail: knowledgeHits.length
          ? t('contextPanel.selfTest.hitFirst', { count: knowledgeHits.length, first: knowledgeHits[0]?.title ?? t('contextPanel.knowledgeChunk') })
          : t('contextPanel.selfTest.knowledgeMiss'),
      })

      const memoryContent = `User preference: ${canary} preferred answer = mint-echo`
      await addMemory(memoryContent, undefined, 'active')
      const memoryHits = await searchMemories(`${canary} mint-echo`, 3)
      pushStep({
        name: t('contextPanel.selfTest.memoryWriteSearch'),
        status: memoryHits.length ? 'ok' : 'fail',
        detail: memoryHits.length
          ? t('contextPanel.selfTest.hitFirst', { count: memoryHits.length, first: memoryHits[0]?.excerpt ?? memoryHits[0]?.content ?? t('settings.memory') })
          : t('contextPanel.selfTest.memoryMiss'),
      })

      const autoMemoryCanary = `autotest_${Date.now().toString(36)}`
      const primaryModel = primaryProvider ? getPolicyPreferredProviderModel(primaryProvider, settings) : undefined
      const extracted = await extractMemories(
        `self-test-${canary}`,
        [
          {
            id: `self-test-user-${canary}`,
            role: 'user',
            content: `My ${autoMemoryCanary} is velvet-river. Remember this fact for related questions.`,
            timestamp: Date.now(),
            status: 'done',
          },
          {
            id: `self-test-assistant-${canary}`,
            role: 'assistant',
            content: 'I will reference this long-term fact when needed.',
            timestamp: Date.now(),
            status: 'done',
          },
        ],
        primaryProvider ?? undefined,
        primaryModel
      )
      const extractedHits = await searchMemories(`${autoMemoryCanary} velvet-river`, 5, ['pending', 'active'])
      pushStep({
        name: t('contextPanel.selfTest.autoMemory'),
        status: extracted.length && extractedHits.length ? 'ok' : 'fail',
        detail: extracted.length && extractedHits.length
          ? t('contextPanel.selfTest.extractedHit', { count: extracted.length, first: extractedHits[0]?.excerpt ?? extracted[0] })
          : t('contextPanel.selfTest.extractedMiss', { count: extracted.length, hits: extractedHits.length }),
      })

      const conversation: Conversation = {
        id: `self-test-${canary}`,
        title: 'Context self-test',
        providerId: primaryProvider?.id ?? 'self-test',
        model: primaryModel ?? 'self-test-model',
        providerModelMode: 'manual',
        systemPrompt: '',
        temperature: 0.7,
        maxTokens: 512,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      const message: Message = {
        id: `self-test-message-${canary}`,
        role: 'user',
        content: `Use ${canary}, aurora-lantern, and mint-echo from local context.`,
        timestamp: Date.now(),
        status: 'done',
      }
      const context = await retrieveContext(conversation, message)
      const memoryCount = context.sources.filter((source) => source.type === 'memory').length
      const knowledgeCount = context.sources.filter((source) => source.type === 'knowledge').length
      pushStep({
        name: t('contextPanel.selfTest.chatContext'),
        status: memoryCount > 0 && knowledgeCount > 0 ? 'ok' : 'fail',
        detail: t('contextPanel.selfTest.contextHits', { total: context.sources.length, memories: memoryCount, knowledge: knowledgeCount }),
      })

      const tavilyKey = await getTavilyApiKey()
      const searchProvider = resolveSearchProvider(settings)
      if (searchProvider === 'off' || searchProvider === 'native') {
        pushStep({
          name: t('settings.webSearch'),
          status: 'warn',
          detail: searchProvider === 'native' ? t('contextPanel.selfTest.nativeSearchSkip') : t('contextPanel.selfTest.webSearchOff'),
        })
      } else if (searchProvider === 'tavily' && !tavilyKey?.trim()) {
        pushStep({
          name: t('contextPanel.selfTest.tavilySearch'),
          status: 'warn',
          detail: t('contextPanel.selfTest.tavilyMissingKey'),
        })
      } else {
        try {
          const webHits = await searchWeb(SEARCH_DIAGNOSTIC_QUERY, 3)
          pushStep({
            name: t('contextPanel.selfTest.webAdapter'),
            status: webHits.length ? 'ok' : 'fail',
            detail: webHits.length
              ? t('contextPanel.selfTest.webHitFirst', { count: webHits.length, first: webHits[0]?.title ?? webHits[0]?.url ?? t('source.webSource') })
              : t('contextPanel.selfTest.webNoResults'),
          })
        } catch (error) {
          pushStep({
            name: t('contextPanel.selfTest.tavilySearch'),
            status: 'fail',
            detail: error instanceof Error ? error.message : t('contextPanel.selfTest.tavilyFailed'),
          })
        }
      }

      const jobs = await listRagEmbeddingJobs(20)
      pushStep({
        name: t('contextPanel.selfTest.embeddingFallback'),
        status: jobs.some((job) => job.status === 'running') ? 'warn' : 'ok',
        detail: t('contextPanel.selfTest.embeddingJobs', { total: jobs.length, running: jobs.filter((job) => job.status === 'running').length, failed: jobs.filter((job) => job.status === 'error').length }),
      })
      const failed = steps.filter((step) => step.status === 'fail').length
      const warnings = steps.filter((step) => step.status === 'warn').length
      dialog.notice({
        title: failed ? t('contextPanel.selfTest.doneWithIssues') : t('contextPanel.selfTest.done'),
        message: t('contextPanel.selfTest.summary', { ok: steps.filter((step) => step.status === 'ok').length, warn: warnings, fail: failed }),
        tone: failed ? 'danger' : warnings ? 'amber' : 'mint',
      })
      await refresh()
    } catch (error) {
      pushStep({
        name: t('contextPanel.selfTest.exception'),
        status: 'fail',
        detail: error instanceof Error ? error.message : t('contextPanel.selfTest.failed'),
      })
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
    <>
      <IslePressable
        haptic
        onPress={importFile}
        disabled={importing}
        style={{ marginTop: 12, minHeight: 54, ...primaryActionSurface(colors), alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, opacity: importing ? 0.65 : 1 }}
      >
        <Upload color={colors.ui.control.primaryForeground} size={18} />
        <Text style={{ color: colors.ui.control.primaryForeground, fontSize: 14, fontWeight: '800' }}>{importing ? t('contextPanel.importing') : t('contextPanel.importKnowledgeFile')}</Text>
      </IslePressable>

      <IsleSection title={t('contextPanel.pasteTextKnowledge')} material="raised" style={{ marginTop: 12 }}>
        <IsleField label={t('contextPanel.knowledgeTitle')} inputProps={{ value: plainTitle, onChangeText: setPlainTitle, placeholder: t('contextPanel.knowledgeTitle') }} />
        <IsleField label={t('contextPanel.body')} style={{ marginTop: 10 }} inputProps={{ value: plainText, onChangeText: setPlainText, multiline: true, placeholder: t('contextPanel.body'), style: { minHeight: 96, maxHeight: 180 } }} />
        <IslePressable haptic onPress={importPlainText} disabled={importing || !plainText.trim()} style={{ ...fullWidthActionStyle, ...primaryActionSurface(colors), marginTop: 10, opacity: importing || !plainText.trim() ? 0.45 : 1 }}>
          <Text style={{ color: colors.ui.control.primaryForeground, fontSize: 14, fontWeight: '800' }}>{t('contextPanel.importPastedText')}</Text>
        </IslePressable>
      </IsleSection>
    </>
  ) : null

  return (
    <View style={{ paddingBottom: showKnowledge ? 96 : 0 }}>
      {showMemory ? (
        <IsleToggle
          icon={<Brain color={colors.text} size={18} />}
          title={t('settings.longMemory')}
          active={!!settings.memoryEnabled}
          onPress={() => updateSettings({ memoryEnabled: !settings.memoryEnabled })}
        />
      ) : null}
      {showKnowledge ? (
        <IsleToggle
          icon={<BookOpen color={colors.text} size={18} />}
          title={t('settings.localKnowledge')}
          active={!!settings.knowledgeEnabled}
          onPress={() => updateSettings({ knowledgeEnabled: !settings.knowledgeEnabled })}
        />
      ) : null}
      {showContext ? (
        <IsleToggle
          icon={<Globe2 color={colors.text} size={18} />}
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
          <Text style={{ color: embeddingJobs.error ? colors.warning : colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 6 }}>
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
            <HardDrive color={colors.text} size={17} />
            <Text style={{ color: colors.text, fontSize: 15, fontWeight: '900', flex: 1 }}>{t('contextPanel.localModel.title')}</Text>
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
        <IslePressable
          haptic
          onPress={() => void runContextSelfTest()}
          disabled={selfTesting}
          accessibilityLabel={t('contextPanel.runSelfTest')}
          testID="context-self-test-button"
          style={{ ...fullWidthActionStyle, ...primaryActionSurface(colors), marginTop: 10, opacity: selfTesting ? 0.65 : 1 }}
        >
          <Text style={{ color: colors.ui.control.primaryForeground, fontSize: 13, fontWeight: '900' }}>{selfTesting ? t('contextPanel.selfTesting') : t('contextPanel.runSelfTest')}</Text>
        </IslePressable>
        {selfTestResult ? (
          <View testID="context-self-test-result" style={{ marginTop: 12, gap: 8 }}>
            <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '800' }}>
              {t('contextPanel.lastSelfTest', { time: new Date(selfTestResult.ranAt).toLocaleTimeString() })}
            </Text>
            {selfTestResult.steps.map((step, index) => (
              <AnimatedDiagnosticsRow key={`${step.name}-${index}`} index={index}>
                <SelfTestRow step={step} />
              </AnimatedDiagnosticsRow>
            ))}
          </View>
        ) : null}
        <View style={{ marginTop: 16 }}>
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '900' }}>{t('contextPanel.ragDebug.title')}</Text>
          <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 4 }}>{t('contextPanel.ragDebug.subtitle')}</Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <DebugStat label={t('contextPanel.ragDebug.logs')} value={String(ragLogs.length)} />
            <DebugStat label={t('contextPanel.ragDebug.indexJobs')} value={String(indexingJobs.length)} />
            <DebugStat label={t('contextPanel.ragDebug.failedJobs')} value={String(indexingJobs.filter((job) => job.status === 'error').length)} />
          </View>
          <IslePressable
            haptic
            onPress={() => void runRagEvaluation()}
            disabled={ragEvaluating}
            accessibilityLabel={t('contextPanel.ragDebug.runEvaluation')}
            testID="context-rag-evaluation-button"
            style={{ ...fullWidthActionStyle, ...primaryActionSurface(colors), marginTop: 10, opacity: ragEvaluating ? 0.65 : 1 }}
          >
            <Text style={{ color: colors.ui.control.primaryForeground, fontSize: 13, fontWeight: '900' }}>{ragEvaluating ? t('contextPanel.ragDebug.evaluating') : t('contextPanel.ragDebug.runEvaluation')}</Text>
          </IslePressable>
          {ragEvaluation ? (
            <AnimatedDiagnosticsRow index={0}>
              <RagEvaluationCard run={ragEvaluation} />
            </AnimatedDiagnosticsRow>
          ) : null}
          {ragLogs.slice(0, 3).map((log, index) => (
            <AnimatedDiagnosticsRow key={log.id} index={index + 1}>
              <RagLogRow log={log} />
            </AnimatedDiagnosticsRow>
          ))}
          {indexingJobs.slice(0, 4).map((job, index) => (
            <AnimatedDiagnosticsRow key={job.id} index={index + 4}>
              <IndexingJobRow job={job} />
            </AnimatedDiagnosticsRow>
          ))}
        </View>
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
        {memories.length ? (
          <View testID="memory-lifecycle-summary" style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <DebugStat label={t('contextPanel.memoryPendingCount')} value={String(memoryStatusCounts.pending)} />
            <DebugStat label={t('contextPanel.memoryActiveCount')} value={String(memoryStatusCounts.active)} />
            <DebugStat label={t('contextPanel.memoryDisabledCount')} value={String(memoryStatusCounts.disabled)} />
          </View>
        ) : null}
        {memoryReviewSummary.pendingCount ? (
          <View testID="memory-review-summary" style={{ marginBottom: 10 }}>
            <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '900', marginBottom: 6 }}>
              {t('contextPanel.memoryReviewSummary')}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <DebugStat label={t('contextPanel.memoryReviewModel')} value={String(memoryReviewSummary.modelCount)} />
              <DebugStat label={t('contextPanel.memoryReviewDeterministic')} value={String(memoryReviewSummary.deterministicCount)} />
              <DebugStat label={t('contextPanel.memoryReviewImported')} value={String(memoryReviewSummary.importedCount)} />
              <DebugStat label={t('contextPanel.memoryReviewManual')} value={String(memoryReviewSummary.manualCount)} />
              <DebugStat label={t('contextPanel.memoryReviewLegacy')} value={String(memoryReviewSummary.legacyCount)} />
              <DebugStat label={t('contextPanel.memoryReviewLowConfidence')} value={String(memoryReviewSummary.lowConfidenceCount)} />
              <DebugStat
                label={t('contextPanel.memoryReviewAverageConfidence')}
                value={memoryReviewSummary.averageConfidence === undefined ? '-' : `${Math.round(memoryReviewSummary.averageConfidence * 100)}%`}
              />
            </View>
          </View>
        ) : null}
        {memories.length ? (
          <View testID="memory-status-focus" style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            {([
              ['all', t('contextPanel.statusFocusAll', { count: memories.length })],
              ['pending', t('contextPanel.statusFocusPending', { count: memoryStatusCounts.pending })],
              ['active', t('contextPanel.statusFocusActive', { count: memoryStatusCounts.active })],
              ['disabled', t('contextPanel.statusFocusDisabled', { count: memoryStatusCounts.disabled })],
            ] satisfies Array<[MemoryStatusFocus, string]>).map(([status, label]) => (
              <IslePressable
                key={status}
                haptic
                onPress={() => {
                  setMemoryStatusFocus(status)
                  setMemoryReviewFocus('all')
                }}
                style={contextChipPressableStyle}
              >
                <IsleChip active={memoryStatusFocus === status}>{label}</IsleChip>
              </IslePressable>
            ))}
          </View>
        ) : null}
        {memories.length ? (
          <IsleField
            label={t('contextPanel.memoryFilter')}
            style={{ marginBottom: 10 }}
            inputProps={{
              value: memoryFilter,
              onChangeText: setMemoryFilter,
              autoCapitalize: 'none',
              autoCorrect: false,
              placeholder: t('contextPanel.memoryFilterPlaceholder'),
            }}
          />
        ) : null}
        {memories.length ? (
          <View testID="memory-sort-mode" style={{ marginBottom: 10 }}>
            <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '900', marginBottom: 6 }}>{t('contextPanel.memorySort')}</Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {([
                ['updated', t('contextPanel.memorySortUpdated')],
                ['created', t('contextPanel.memorySortCreated')],
                ['lastUsed', t('contextPanel.memorySortLastUsed')],
              ] satisfies Array<[MemorySortMode, string]>).map(([mode, label]) => (
                <IslePressable key={mode} haptic onPress={() => setMemorySortMode(mode)} style={contextChipPressableStyle}>
                  <IsleChip active={memorySortMode === mode}>{label}</IsleChip>
                </IslePressable>
              ))}
            </View>
          </View>
        ) : null}
        {hasMemoryFilters ? (
          <View testID="memory-filter-summary" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, flex: 1 }}>
              {t('contextPanel.memoryFilterSummary', { count: sortedMemories.length, total: memories.length })}
            </Text>
            <IslePressable
              haptic
              onPress={() => {
                setMemoryFilter('')
                setMemoryStatusFocus('all')
                setMemoryReviewFocus('all')
                setShowAllMemories(false)
              }}
              accessibilityLabel={t('contextPanel.clearMemoryFilters')}
              style={{ ...itemRowActionStyle, ...rowActionSurface(colors) }}
            >
              <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '900' }}>{t('contextPanel.clearMemoryFilters')}</Text>
            </IslePressable>
          </View>
        ) : null}
        {memoryReviewSummary.pendingCount ? (
          <View testID="memory-review-focus" style={{ marginBottom: 10 }}>
            <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '900', marginBottom: 6 }}>{t('contextPanel.memoryReviewQueue')}</Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {([
                ['all', t('contextPanel.memoryReviewAll', { count: pendingMemories.length })],
                ...memoryReviewSourceFocuses.map((sourceKind) => [
                  sourceKind,
                  t(memoryReviewFocusKey(sourceKind), { count: filterPendingMemoriesForReview(pendingMemories, sourceKind).length }),
                ] satisfies [MemoryReviewQueueFocus, string]),
                ['lowConfidence', t('contextPanel.memoryReviewLowConfidenceFilter', { count: filterPendingMemoriesForReview(pendingMemories, 'lowConfidence').length })],
              ] satisfies Array<[MemoryReviewQueueFocus, string]>).map(([reviewFocus, label]) => (
                <IslePressable
                  key={reviewFocus}
                  haptic
                  onPress={() => {
                    setMemoryStatusFocus('pending')
                    setMemoryReviewFocus(reviewFocus)
                    setShowAllMemories(true)
                  }}
                  style={contextChipPressableStyle}
                >
                  <IsleChip active={memoryStatusFocus === 'pending' && memoryReviewFocus === reviewFocus}>{label}</IsleChip>
                </IslePressable>
              ))}
            </View>
          </View>
        ) : null}
        {canConfirmFilteredMemories ? (
          <IslePressable
            haptic
            onPress={() => void confirmPendingMemories(filteredPendingMemories, true)}
            disabled={confirmingMemories}
            accessibilityLabel={t('contextPanel.confirmFilteredPendingMemoriesTitle', { count: filteredPendingMemories.length })}
            style={{ ...fullWidthActionStyle, ...secondaryActionSurface(colors), marginBottom: 10, opacity: confirmingMemories ? 0.65 : 1 }}
          >
            <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '900' }}>
              {confirmingMemories ? t('contextPanel.confirmingPendingMemories') : t('contextPanel.confirmFilteredPendingMemories', { count: filteredPendingMemories.length })}
            </Text>
          </IslePressable>
        ) : null}
        {canRejectFilteredMemories ? (
          <IslePressable
            haptic
            onPress={() => void rejectPendingMemories(filteredPendingMemories)}
            disabled={confirmingMemories}
            accessibilityLabel={t('contextPanel.rejectFilteredPendingMemoriesTitle', { count: filteredPendingMemories.length })}
            style={{ ...fullWidthActionStyle, ...secondaryActionSurface(colors), marginBottom: 10, borderColor: colors.error, opacity: confirmingMemories ? 0.65 : 1 }}
          >
            <Text style={{ color: colors.error, fontSize: 13, fontWeight: '900' }}>
              {confirmingMemories ? t('contextPanel.confirmingPendingMemories') : t('contextPanel.rejectFilteredPendingMemories', { count: filteredPendingMemories.length })}
            </Text>
          </IslePressable>
        ) : null}
        {pendingMemories.length ? (
          <IslePressable
            haptic
            onPress={() => void confirmPendingMemories()}
            disabled={confirmingMemories}
            accessibilityLabel={t('contextPanel.confirmPendingMemoriesTitle', { count: pendingMemories.length })}
            style={{ ...fullWidthActionStyle, ...primaryActionSurface(colors), marginBottom: 10, opacity: confirmingMemories ? 0.65 : 1 }}
          >
            <Text style={{ color: colors.ui.control.primaryForeground, fontSize: 13, fontWeight: '900' }}>
              {confirmingMemories ? t('contextPanel.confirmingPendingMemories') : t('contextPanel.confirmPendingMemories', { count: pendingMemories.length })}
            </Text>
          </IslePressable>
        ) : null}
        {filteredMemories.length > memoryPreviewLimit ? (
          <Text testID="memory-list-showing-count" style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginBottom: 8 }}>
            {t('contextPanel.memoryListShowing', { shown: visibleMemories.length, total: filteredMemories.length })}
          </Text>
        ) : null}
        {hasMemoryFilters && !filteredMemories.length ? (
          <Text testID="memory-filter-empty" style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginBottom: 8 }}>
            {memoryEmptyMessage}
          </Text>
        ) : null}
        {visibleMemories.map((memory) => (
          <ItemRow
            key={memory.id}
            title={memory.status === 'pending' ? t('contextPanel.pendingMemory') : memory.status === 'active' ? t('settings.longMemory') : t('contextPanel.disabledMemory')}
            description={memory.content}
            meta={formatMemoryMeta(memory, t)}
            deleteName={memory.content}
            trailing={memory.status === 'pending' ? t('contextPanel.confirmMemory') : memory.status === 'disabled' ? t('contextPanel.restoreMemory') : t('contextPanel.disableMemory')}
            onToggle={async () => {
              await updateMemoryStatus(memory.id, memory.status === 'active' ? 'disabled' : 'active')
              await refresh()
            }}
            onDelete={async () => {
              await deleteMemory(memory.id)
              await refresh()
            }}
          />
        ))}
        {filteredMemories.length > memoryPreviewLimit ? (
          <IslePressable
            haptic
            onPress={() => setShowAllMemories((current) => !current)}
            accessibilityLabel={showAllMemories ? t('contextPanel.showFewerMemories') : t('contextPanel.showAllMemories', { count: filteredMemories.length })}
            testID="memory-list-toggle"
            style={{ ...fullWidthActionStyle, ...secondaryActionSurface(colors), marginTop: 10 }}
          >
            <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '800' }}>
              {showAllMemories
                ? t('contextPanel.showFewerMemories')
                : t('contextPanel.showMoreMemories', { count: filteredMemories.length - visibleMemories.length })}
            </Text>
          </IslePressable>
        ) : null}
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
          <Text testID="knowledge-readiness-warning" style={{ color: knowledgeStatusCounts.failed ? colors.error : colors.warning, fontSize: 12, lineHeight: 17, marginBottom: 10 }}>
            {knowledgeStatusCounts.failed && knowledgeStatusCounts.empty
              ? t('contextPanel.knowledgeReadinessWarning', { failed: knowledgeStatusCounts.failed, empty: knowledgeStatusCounts.empty })
              : knowledgeStatusCounts.failed
                ? t('contextPanel.knowledgeFailedWarning', { failed: knowledgeStatusCounts.failed })
                : t('contextPanel.knowledgeEmptyWarning', { empty: knowledgeStatusCounts.empty })}
          </Text>
        ) : null}
        {knowledgeRecoverySummary.recoverableDocuments || knowledgeRecoverySummary.failedJobs ? (
          <View testID="knowledge-recovery-summary" style={{ marginBottom: 10, padding: 12, ...assetCardSurface(colors, knowledgeRecoverySummary.failedDocuments || knowledgeRecoverySummary.failedJobs ? colors.error : colors.warning) }}>
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '900' }}>{t('contextPanel.knowledgeRecoveryTitle')}</Text>
            <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 4 }}>
              {t('contextPanel.knowledgeRecoverySummary', {
                failed: knowledgeRecoverySummary.failedDocuments,
                empty: knowledgeRecoverySummary.emptyDocuments,
                jobs: knowledgeRecoverySummary.failedJobs,
              })}
            </Text>
            {knowledgeRecoverySummary.lastError ? (
              <Text numberOfLines={2} style={{ color: colors.error, fontSize: 11, lineHeight: 16, marginTop: 6 }}>
                {t('contextPanel.knowledgeRecoveryLastError', { error: knowledgeRecoverySummary.lastError })}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              {knowledgeRecoverySummary.failedDocuments ? (
                <IslePressable haptic onPress={() => focusKnowledgeRecovery('error')} style={{ ...itemRowActionStyle, ...rowActionSurface(colors) }}>
                  <Text style={{ color: colors.error, fontSize: 12, fontWeight: '900' }}>{t('contextPanel.knowledgeRecoveryShowFailed')}</Text>
                </IslePressable>
              ) : null}
              {knowledgeRecoverySummary.emptyDocuments ? (
                <IslePressable haptic onPress={() => focusKnowledgeRecovery('empty')} style={{ ...itemRowActionStyle, ...rowActionSurface(colors) }}>
                  <Text style={{ color: colors.warning, fontSize: 12, fontWeight: '900' }}>{t('contextPanel.knowledgeRecoveryShowEmpty')}</Text>
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
            <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, flex: 1 }}>
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
          style={{ width: 44, height: 44, borderRadius: colors.ui.radius.controlLarge, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.material.paperRaised, borderWidth: 1, borderColor: colors.border }}
        >
          <Trash2 color={colors.textTertiary} size={15} />
        </IslePressable>
      </View>
      {children || <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{empty}</Text>}
    </View>
  )
}

function AnimatedDiagnosticsRow({ index, children }: { index: number; children: ReactNode }) {
  const motion = useMotionPreference()
  return (
    <MotiView
      from={motion === 'full' ? { opacity: 0, translateY: 8 } : { opacity: 0 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={motion === 'full'
        ? { type: 'spring', ...motionTokens.spring.gentle, delay: Math.min(index * 22, 130) }
        : { type: 'timing', duration: motionTokens.duration.fast }}
    >
      {children}
    </MotiView>
  )
}

function isDownloadableLocalModel(view: LocalEmbeddingModelView): boolean {
  return view.model.files.length > 0 && view.model.sizeBytes > 0
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
  const downloadable = view.model.files.length > 0 && view.model.sizeBytes > 0
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
    <View style={{ padding: 12, ...assetCardSurface(colors, view.active ? colors.success : colors.border) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 34, height: 34, borderRadius: colors.ui.radius.controlMiddle, alignItems: 'center', justifyContent: 'center', backgroundColor: view.active ? colors.mintSoft : colors.material.field }}>
          {view.active ? <Check color={colors.success} size={16} /> : <HardDrive color={colors.textTertiary} size={16} />}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13, fontWeight: '900' }}>{view.model.name}</Text>
          <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 2 }}>
            {modelMeta}
          </Text>
        </View>
        <Text style={{ color: view.active ? colors.success : colors.textTertiary, fontSize: 11, fontWeight: '900' }}>{statusLabel}</Text>
      </View>
      <Text numberOfLines={2} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 8 }}>{view.model.useCase}</Text>
      <Text numberOfLines={2} style={{ color: colors.textTertiary, fontSize: 10, lineHeight: 15, marginTop: 6 }}>
        {view.model.publisher ?? view.model.upstreamModel ?? '-'} · {view.model.license ?? '-'}
      </Text>
      {progress ? (
        <View style={{ marginTop: 10, gap: 6 }}>
          <View style={{ height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: colors.material.field }}>
            <View style={{ width: `${Math.max(2, progressPercent)}%`, height: '100%', borderRadius: 3, backgroundColor: colors.primary }} />
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
            <Download color={colors.ui.control.primaryForeground} size={13} />
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
            <Text style={{ color: colors.error, fontSize: 12, fontWeight: '900' }}>{t('common.delete')}</Text>
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
    <View style={{ padding: 12, ...assetCardSurface(colors, active ? colors.border : colors.warning) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 34, height: 34, borderRadius: colors.ui.radius.controlMiddle, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? colors.mintSoft : colors.material.field }}>
          {active ? <Check color={colors.success} size={16} /> : <HardDrive color={colors.warning} size={16} />}
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
      <Text style={{ color: active ? colors.textSecondary : colors.warning, fontSize: 11, lineHeight: 16, marginTop: 6, fontWeight: '800' }}>
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

function capabilityLabel(capability: LocalRagModelCapability, t: TFunction): string {
  return t(`contextPanel.localModel.capabilities.${capability}`)
}

function localCapabilityEnabled(capability: LocalRagModelCapability, settings: Settings): boolean {
  switch (capability) {
    case 'reranker':
      return settings.ragCrossEncoderEnabled !== false
    case 'colbert':
      return settings.ragColbertEnabled !== false
    case 'compressor':
      return settings.ragLlmlinguaEnabled !== false
    case 'embedding':
      return (settings.embeddingMode ?? 'hybrid') !== 'provider'
  }
}

function sortMemories(memories: MemoryItem[], mode: MemorySortMode): MemoryItem[] {
  return [...memories].sort((left, right) => {
    if (mode === 'created') return right.createdAt - left.createdAt
    if (mode === 'lastUsed') return (right.lastHitAt ?? 0) - (left.lastHitAt ?? 0)
    return right.updatedAt - left.updatedAt
  })
}

function sortKnowledgeDocuments(documents: KnowledgeDocument[], mode: KnowledgeSortMode): KnowledgeDocument[] {
  return [...documents].sort((left, right) => {
    if (mode === 'title') return left.title.localeCompare(right.title)
    if (mode === 'chunks') return right.chunkCount - left.chunkCount
    if (mode === 'needsReview') return knowledgeReviewWeight(right) - knowledgeReviewWeight(left) || right.updatedAt - left.updatedAt
    return right.updatedAt - left.updatedAt
  })
}

function knowledgeReviewWeight(document: KnowledgeDocument): number {
  if (document.status === 'error') return 3
  if (document.status === 'ready' && document.chunkCount <= 0) return 2
  if (document.status === 'extracting') return 1
  return 0
}

function memoryAssetEmptyMessage(focus: MemoryStatusFocus, normalizedFilter: string, t: TFunction): string {
  if (normalizedFilter || focus === 'all') return t('contextPanel.noMemoryMatches')
  if (focus === 'pending') return t('contextPanel.noPendingMemories')
  if (focus === 'active') return t('contextPanel.noActiveMemories')
  return t('contextPanel.noDisabledMemories')
}

function knowledgeAssetEmptyMessage(focus: KnowledgeStatusFocus, normalizedFilter: string, t: TFunction): string {
  if (normalizedFilter || focus === 'all') return t('contextPanel.noKnowledgeMatches')
  if (focus === 'ready') return t('contextPanel.noReadyKnowledge')
  if (focus === 'extracting') return t('contextPanel.noIndexingKnowledge')
  if (focus === 'error') return t('contextPanel.noFailedKnowledge')
  return t('contextPanel.noEmptyKnowledge')
}

function formatKnowledgeMeta(document: KnowledgeDocument, t: TFunction): string {
  const status = document.status === 'ready'
    ? document.chunkCount > 0
      ? t('contextPanel.knowledgeStatusReady')
      : t('contextPanel.knowledgeStatusEmpty')
    : document.status === 'extracting'
      ? t('contextPanel.knowledgeStatusIndexing')
      : t('contextPanel.knowledgeStatusFailed')
  const updated = t('contextPanel.knowledgeUpdatedAt', { time: formatMemoryTime(document.updatedAt) })
  const source = document.sourceUri
    ? t('contextPanel.knowledgeSource', { source: shortenKnowledgeSource(document.sourceUri) })
    : ''
  const error = document.status === 'error' && document.error
    ? t('contextPanel.knowledgeError', { error: document.error })
    : ''
  return [status, updated, source, error].filter(Boolean).join(' · ')
}

function shortenKnowledgeSource(source: string): string {
  if (source.length <= 48) return source
  return `${source.slice(0, 24)}...${source.slice(-18)}`
}

function formatMemoryMeta(memory: MemoryItem, t: TFunction): string {
  const origin = memory.conversationId
    ? t('contextPanel.memorySourceConversation', { id: memory.conversationId.slice(0, 8) })
    : ''
  const sourceKind = t(memorySourceKindKey(memory.sourceKind))
  const confidence = typeof memory.confidence === 'number'
    ? t('contextPanel.memoryConfidence', { confidence: Math.round(Math.max(0, Math.min(1, memory.confidence)) * 100) })
    : ''
  const sourceDetail = memory.sourceDetail
    ? t('contextPanel.memorySourceDetail', { detail: memory.sourceDetail })
    : ''
  const created = t('contextPanel.memoryCreatedAt', { time: formatMemoryTime(memory.createdAt) })
  const used = memory.lastHitAt
    ? t('contextPanel.memoryLastUsedAt', { time: formatMemoryTime(memory.lastHitAt) })
    : t('contextPanel.memoryNeverUsed')
  const updated = Math.abs(memory.updatedAt - memory.createdAt) > 1000
    ? t('contextPanel.memoryUpdatedAt', { time: formatMemoryTime(memory.updatedAt) })
    : ''
  return [origin, sourceKind, confidence, sourceDetail, created, used, updated].filter(Boolean).join(' · ')
}

function memorySourceKindKey(sourceKind: MemoryItem['sourceKind']): string {
  switch (sourceKind) {
    case 'manual':
      return 'contextPanel.memorySourceManual'
    case 'deterministic':
      return 'contextPanel.memorySourceDeterministic'
    case 'model':
      return 'contextPanel.memorySourceModel'
    case 'imported':
      return 'contextPanel.memorySourceImported'
    case 'legacy':
    default:
      return 'contextPanel.memorySourceLegacy'
  }
}

function memoryReviewFocusKey(focus: MemorySourceKind): string {
  switch (focus) {
    case 'manual':
      return 'contextPanel.memoryReviewManualFilter'
    case 'deterministic':
      return 'contextPanel.memoryReviewDeterministicFilter'
    case 'model':
      return 'contextPanel.memoryReviewModelFilter'
    case 'imported':
      return 'contextPanel.memoryReviewImportedFilter'
    case 'legacy':
    default:
      return 'contextPanel.memoryReviewLegacyFilter'
  }
}

function formatMemoryTime(value?: number): string {
  if (!value) return '-'
  try {
    return new Date(value).toLocaleString()
  } catch {
    return '-'
  }
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
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        {trailing && onToggle ? (
          <IslePressable onPress={() => void onToggle()} style={{ ...itemRowActionStyle, ...rowActionSurface(colors) }}>
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '800' }}>{trailing}</Text>
          </IslePressable>
        ) : null}
        <IslePressable onPress={() => void confirmDelete()} style={{ ...itemRowActionStyle, ...rowActionSurface(colors) }}>
          <Text style={{ color: colors.error, fontSize: 12, fontWeight: '800' }}>{t('common.delete')}</Text>
        </IslePressable>
      </View>
    </View>
  )
}

function SelfTestRow({ step }: { step: SelfTestStep }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(step.status === 'fail')
  const statusColor = step.status === 'ok' ? colors.success : step.status === 'warn' ? colors.warning : colors.error
  const statusText = step.status === 'ok' ? t('contextPanel.selfTest.passed') : step.status === 'warn' ? t('contextPanel.selfTest.needsConfig') : t('contextPanel.selfTest.failedStatus')
  return (
    <IslePressable
      haptic={step.status !== 'ok'}
      disabled={step.status === 'ok'}
      onPress={() => setExpanded((value) => !value)}
      style={{ padding: 10, ...assetCardSurface(colors) }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: statusColor }} />
        <Text style={{ color: colors.text, fontSize: 12, fontWeight: '900', flex: 1 }}>{step.name}</Text>
        <Text style={{ color: statusColor, fontSize: 11, fontWeight: '900' }}>{statusText}</Text>
      </View>
      {expanded || step.status === 'ok' ? (
        <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 5 }}>{step.detail}</Text>
      ) : (
        <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 5 }}>{t('contextPanel.selfTest.tapForDetails')}</Text>
      )}
    </IslePressable>
  )
}

function RagEvaluationCard({ run }: { run: RagEvaluationRun }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  return (
    <View style={{ marginTop: 10, padding: 12, ...assetCardSurface(colors) }}>
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '900' }}>{t('contextPanel.ragDebug.lastEvaluation')}</Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <DebugStat label={t('contextPanel.ragDebug.confidence')} value={`${Math.round(run.averageConfidence * 100)}%`} />
        <DebugStat label={t('contextPanel.ragDebug.citation')} value={`${Math.round(run.averageCitationCoverage * 100)}%`} />
        <DebugStat label={t('contextPanel.ragDebug.precision')} value={`${Math.round(run.averageContextPrecision * 100)}%`} />
      </View>
      {run.fallbackReasons.length ? (
        <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 8 }}>{t('contextPanel.ragDebug.fallbacks', { value: run.fallbackReasons.slice(0, 3).join(', ') })}</Text>
      ) : null}
    </View>
  )
}

function RagLogRow({ log }: { log: RagEvaluationLog }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const quality = log.quality
  return (
    <View style={{ marginTop: 8, padding: 10, ...assetCardSurface(colors) }}>
      <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12, fontWeight: '900' }}>{log.query}</Text>
      <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 4 }}>
        {t('contextPanel.ragDebug.logMeta', {
          profile: log.plan?.profile ?? '-',
          sources: log.sourceCount,
          confidence: Math.round((quality?.generationConfidence ?? quality?.confidence ?? 0) * 100),
          flare: quality?.flareTriggered ? t('contextPanel.ragDebug.yes') : t('contextPanel.ragDebug.no'),
        })}
      </Text>
    </View>
  )
}

function IndexingJobRow({ job }: { job: RagIndexingJobStatus }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ marginTop: 8, padding: 10, ...assetCardSurface(colors, job.status === 'error' ? colors.error : colors.border) }}>
      <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12, fontWeight: '900' }}>{job.kind}</Text>
      <Text numberOfLines={2} style={{ color: job.status === 'error' ? colors.error : colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 4 }}>
        {job.status}{job.progress !== undefined ? ` · ${Math.round((job.progress ?? 0) * 100)}%` : ''}{job.error ? ` · ${job.error}` : ''}
      </Text>
    </View>
  )
}

function DebugStat({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme()
  return (
    <View style={{ minHeight: 34, minWidth: 74, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', ...rowActionSurface(colors) }}>
      <Text style={{ color: colors.text, fontSize: 12, fontWeight: '900' }}>{value}</Text>
      <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '800' }}>{label}</Text>
    </View>
  )
}
