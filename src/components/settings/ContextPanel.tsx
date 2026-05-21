import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { BookOpen, Brain, Check, Download, Globe2, HardDrive, Trash2, Upload } from 'lucide-react-native'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type { AIProvider, Conversation, KnowledgeDocument, LocalRagModelCapability, MemoryItem, Message, RagEvaluationLog, RagIndexingJobStatus, SearchProviderId, Settings, WebSearchMode } from '@/types'
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
import { localDataStore } from '@/services/localDataStore'
import {
  deleteDownloadedLocalEmbeddingModel,
  downloadLocalEmbeddingModel,
  formatModelBytes,
  listLocalEmbeddingModelViews,
  type LocalEmbeddingModelView,
} from '@/services/localEmbeddingModels'
import { loadRagDebugSnapshot, runRagGoldEvaluation, type RagEvaluationRun } from '@/services/ragEvaluation'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import { legacySearchModeForProvider, resolveSearchProvider } from '@/services/searchPolicy'
import { PressableScale } from '@/components/ui/PressableScale'
import { Pill } from '@/components/ui/Pill'
import { IslandField, IslandSection, IslandToggle } from '@/components/ui/IslandPrimitives'
import { useIslandDialog } from '@/components/ui/IslandDialog'

interface ContextPanelProps {
  providers: AIProvider[]
  section?: 'all' | 'context' | 'memory' | 'knowledge'
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

export function ContextPanel({ providers, section = 'all' }: ContextPanelProps) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const dialog = useIslandDialog()
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
  const [rebuilding, setRebuilding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [selfTesting, setSelfTesting] = useState(false)
  const [selfTestResult, setSelfTestResult] = useState<SelfTestResult | null>(null)
  const [plainTitle, setPlainTitle] = useState('IsleMind smoke knowledge')
  const [plainText, setPlainText] = useState('')
  const showContext = section === 'all' || section === 'context'
  const showMemory = section === 'all' || section === 'memory'
  const showKnowledge = section === 'all' || section === 'knowledge'

  async function refresh() {
    const [memoryItems, documentItems, jobs, debug] = await Promise.all([
      listMemories(['pending', 'active', 'disabled']),
      listKnowledgeDocuments(),
      localDataStore.listEmbeddingJobs(50),
      loadRagDebugSnapshot(),
    ])
    setMemories(memoryItems)
    setDocuments(documentItems)
    setEmbeddingJobs({
      running: jobs.filter((job) => job.status === 'running').length,
      error: jobs.filter((job) => job.status === 'error').length,
    })
    setIndexingJobs(debug.indexingJobs)
    setRagLogs(debug.evaluations)
    setLocalModels(await listLocalEmbeddingModelViews(useSettingsStore.getState().settings))
  }

  useEffect(() => {
    void getTavilyApiKey().then((key) => setTavilyKey(key ?? ''))
    void getGoogleSearchApiKey().then((key) => setGoogleSearchKey(key ?? ''))
    void getBingSearchApiKey().then((key) => setBingSearchKey(key ?? ''))
    void getCustomSearchApiKey().then((key) => setCustomSearchKey(key ?? ''))
    void refresh()
  }, [getBingSearchApiKey, getCustomSearchApiKey, getGoogleSearchApiKey, getTavilyApiKey])

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

  async function importFile() {
    setImporting(true)
    try {
      const provider = await getPrimaryConfiguredProvider()
      const model = provider?.models[0]
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
        primaryProvider?.models[0]
      )
      const extractedHits = await searchMemories(`${autoMemoryCanary} velvet-river`, 5)
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
        model: primaryProvider?.models[0] ?? 'self-test-model',
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
          const webHits = await searchWeb('OpenAI Responses API streaming output_text delta', 3)
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

      const jobs = await localDataStore.listEmbeddingJobs(20)
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
      dialog.notice({
        title: t('contextPanel.localModel.statusPlaceholder'),
        message: t('contextPanel.localModel.placeholderMessage', {
          name: view.model.name,
          publisher: view.model.publisher ?? view.model.upstreamModel ?? '-',
          license: view.model.license ?? '-',
        }),
        tone: 'amber',
      })
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
    try {
      await downloadLocalEmbeddingModel(view.model.id)
      updateSettings({
        embeddingMode: settings.embeddingMode === 'provider' ? 'hybrid' : settings.embeddingMode,
        localEmbeddingModelId: view.model.id,
        localEmbeddingModelSource: 'downloaded',
      })
      dialog.notice({ title: t('contextPanel.localModel.downloaded'), message: view.model.name, tone: 'mint' })
    } catch (error) {
      dialog.notice({ title: t('contextPanel.localModel.downloadFailed'), message: error instanceof Error ? error.message : t('contextPanel.localModel.unknownError'), tone: 'danger' })
    } finally {
      setModelBusyId(null)
      await refresh()
    }
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
      const count = await localDataStore.rebuildKnowledgeEmbeddings({ provider: provider ?? undefined, embeddingMode: settings.embeddingMode ?? 'hybrid', localEmbeddingModelId: settings.localEmbeddingModelId, localEmbeddingModelSource: settings.localEmbeddingModelSource })
      dialog.notice({ title: t('contextPanel.localModel.rebuildDone'), message: t('contextPanel.localModel.rebuildDoneMessage', { count }), tone: 'mint' })
      await refresh()
    } catch (error) {
      dialog.notice({ title: t('contextPanel.localModel.rebuildFailed'), message: error instanceof Error ? error.message : t('contextPanel.localModel.unknownError'), tone: 'danger' })
    } finally {
      setRebuilding(false)
    }
  }

  return (
    <View>
      {showMemory ? (
        <IslandToggle
          icon={<Brain color={colors.text} size={18} />}
          title={t('settings.longMemory')}
          active={!!settings.memoryEnabled}
          onPress={() => updateSettings({ memoryEnabled: !settings.memoryEnabled })}
        />
      ) : null}
      {showKnowledge ? (
        <IslandToggle
          icon={<BookOpen color={colors.text} size={18} />}
          title={t('settings.localKnowledge')}
          active={!!settings.knowledgeEnabled}
          onPress={() => updateSettings({ knowledgeEnabled: !settings.knowledgeEnabled })}
        />
      ) : null}
      {showContext ? (
        <IslandToggle
          icon={<Globe2 color={colors.text} size={18} />}
          title={t('settings.webSearch')}
          active={!!settings.webSearchEnabled}
          onPress={() => updateSettings({ webSearchEnabled: !settings.webSearchEnabled })}
        />
      ) : null}

      {showContext ? (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {(['native', 'tavily', 'google', 'bing', 'custom', 'off'] satisfies SearchProviderId[]).map((mode) => (
            <PressableScale key={mode} haptic onPress={() => updateSettings({ searchProvider: mode, webSearchMode: legacySearchModeForProvider(mode), webSearchEnabled: mode !== 'off' })}>
              <Pill active={resolveSearchProvider(settings) === mode}>{searchModeLabel(mode, t)}</Pill>
            </PressableScale>
          ))}
        </View>
      ) : null}

      {showContext || showKnowledge ? <IslandSection title={t('contextPanel.ragMode')} material="raised" style={{ marginTop: 12 }}>
        {embeddingJobs ? (
          <Text style={{ color: embeddingJobs.error ? colors.warning : colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 6 }}>
            {t('contextPanel.embeddingStatus', { running: embeddingJobs.running, failed: embeddingJobs.error })}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {(['hybrid', 'fts', 'off'] as const).map((mode) => (
            <PressableScale key={mode} haptic onPress={() => updateSettings({ ragMode: mode })}>
              <Pill active={(settings.ragMode ?? 'hybrid') === mode}>{mode === 'hybrid' ? t('contextPanel.ragHybrid') : mode === 'fts' ? t('contextPanel.ragFts') : t('contextPanel.ragOff')}</Pill>
            </PressableScale>
          ))}
        </View>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '800', marginTop: 14 }}>{t('contextPanel.ragProfile')}</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {(['fast', 'balanced', 'deep', 'offline'] as const).map((profile) => (
            <PressableScale key={profile} haptic onPress={() => updateSettings({ ragProfile: profile })}>
              <Pill active={(settings.ragProfile ?? 'balanced') === profile}>{t(`contextPanel.ragProfiles.${profile}`)}</Pill>
            </PressableScale>
          ))}
        </View>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '800', marginTop: 14 }}>{t('contextPanel.agenticTechniques')}</Text>
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
            <PressableScale key={key} haptic onPress={() => updateSettings({ [settingKey]: !settings[settingKey] })}>
              <Pill active={settings[settingKey] !== false}>{t(`contextPanel.techniques.${label}`)}</Pill>
            </PressableScale>
            )
          })}
        </View>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '800', marginTop: 14 }}>{t('contextPanel.embeddingStrategy')}</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {(['hybrid', 'provider', 'local'] as const).map((mode) => (
            <PressableScale key={mode} haptic onPress={() => updateSettings({ embeddingMode: mode })}>
              <Pill active={(settings.embeddingMode ?? 'hybrid') === mode}>{mode === 'hybrid' ? t('contextPanel.embeddingHybrid') : mode === 'provider' ? t('contextPanel.embeddingProvider') : t('contextPanel.embeddingLocal')}</Pill>
            </PressableScale>
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
          <View style={{ marginTop: 10, gap: 12 }}>
            {(['embedding', 'reranker', 'colbert', 'compressor'] satisfies LocalRagModelCapability[]).map((capability) => {
              const models = localModels.filter((view) => (view.model.capability ?? 'embedding') === capability)
              if (!models.length) return null
              return (
                <View key={capability} style={{ gap: 8 }}>
                  <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '900' }}>{capabilityLabel(capability, t)}</Text>
                  {models.map((view) => (
                    <LocalModelRow
                      key={view.model.id}
                      view={view}
                      busy={modelBusyId === view.model.id}
                      onDownload={() => void downloadModel(view)}
                      onEnable={() => void enableLocalModel(view)}
                      onDelete={() => void deleteModel(view)}
                    />
                  ))}
                </View>
              )
            })}
          </View>
          <PressableScale
            haptic
            onPress={() => void rebuildIndex()}
            disabled={rebuilding}
            style={{ marginTop: 10, minHeight: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.islandRaised, borderWidth: 1, borderColor: colors.border, opacity: rebuilding ? 0.65 : 1 }}
          >
            <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '800' }}>{rebuilding ? t('contextPanel.localModel.rebuilding') : t('contextPanel.localModel.rebuildIndex')}</Text>
          </PressableScale>
        </View>
        <PressableScale
        haptic
        onPress={async () => {
          await localDataStore.clearRagCaches()
          dialog.notice({ title: t('contextPanel.cacheCleared'), message: t('contextPanel.cacheClearedMessage'), tone: 'mint' })
        }}
          style={{ marginTop: 12, minHeight: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.islandRaised, borderWidth: 1, borderColor: colors.border }}
        >
          <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '800' }}>{t('contextPanel.clearRagCache')}</Text>
        </PressableScale>
        <PressableScale
          haptic
          onPress={() => void runContextSelfTest()}
          disabled={selfTesting}
          accessibilityLabel={t('contextPanel.runSelfTest')}
          testID="context-self-test-button"
          style={{ marginTop: 10, minHeight: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.text, opacity: selfTesting ? 0.65 : 1 }}
        >
          <Text style={{ color: colors.surface, fontSize: 13, fontWeight: '900' }}>{selfTesting ? t('contextPanel.selfTesting') : t('contextPanel.runSelfTest')}</Text>
        </PressableScale>
        {selfTestResult ? (
          <View testID="context-self-test-result" style={{ marginTop: 12, gap: 8 }}>
            <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '800' }}>
              {t('contextPanel.lastSelfTest', { time: new Date(selfTestResult.ranAt).toLocaleTimeString() })}
            </Text>
            {selfTestResult.steps.map((step, index) => (
              <SelfTestRow key={`${step.name}-${index}`} step={step} />
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
          <PressableScale
            haptic
            onPress={() => void runRagEvaluation()}
            disabled={ragEvaluating}
            accessibilityLabel={t('contextPanel.ragDebug.runEvaluation')}
            testID="context-rag-evaluation-button"
            style={{ marginTop: 10, minHeight: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.text, opacity: ragEvaluating ? 0.65 : 1 }}
          >
            <Text style={{ color: colors.surface, fontSize: 13, fontWeight: '900' }}>{ragEvaluating ? t('contextPanel.ragDebug.evaluating') : t('contextPanel.ragDebug.runEvaluation')}</Text>
          </PressableScale>
          {ragEvaluation ? <RagEvaluationCard run={ragEvaluation} /> : null}
          {ragLogs.slice(0, 3).map((log) => <RagLogRow key={log.id} log={log} />)}
          {indexingJobs.slice(0, 4).map((job) => <IndexingJobRow key={job.id} job={job} />)}
        </View>
      </IslandSection> : null}

      {showContext ? <IslandSection title={t('contextPanel.searchApi')} material="raised" style={{ marginTop: 12 }}>
        <IslandField label="Tavily Key" style={{ marginTop: 10 }} inputProps={{ value: tavilyKey, onChangeText: setTavilyKey, secureTextEntry: true, autoCapitalize: 'none', autoCorrect: false, placeholder: 'tvly-...' }} />
        <IslandField label="Google Search Key" style={{ marginTop: 10 }} inputProps={{ value: googleSearchKey, onChangeText: setGoogleSearchKey, secureTextEntry: true, autoCapitalize: 'none', autoCorrect: false, placeholder: 'Google API Key' }} />
        <IslandField label="Google CX" style={{ marginTop: 10 }} inputProps={{ value: settings.googleSearchCx ?? '', onChangeText: (googleSearchCx) => updateSettings({ googleSearchCx }), autoCapitalize: 'none', autoCorrect: false, placeholder: 'Programmable Search Engine cx' }} />
        <IslandField label="Bing / Azure Key" style={{ marginTop: 10 }} inputProps={{ value: bingSearchKey, onChangeText: setBingSearchKey, secureTextEntry: true, autoCapitalize: 'none', autoCorrect: false, placeholder: t('contextPanel.bingKeyPlaceholder') }} />
        <IslandField label={t('contextPanel.customSearchEndpoint')} style={{ marginTop: 10 }} inputProps={{ value: settings.customSearchEndpoint ?? '', onChangeText: (customSearchEndpoint) => updateSettings({ customSearchEndpoint }), autoCapitalize: 'none', autoCorrect: false, placeholder: 'https://search.example.com?q={query}&limit={limit}' }} />
        <IslandField label={t('contextPanel.customSearchKey')} style={{ marginTop: 10 }} inputProps={{ value: customSearchKey, onChangeText: setCustomSearchKey, secureTextEntry: true, autoCapitalize: 'none', autoCorrect: false, placeholder: t('contextPanel.optionalBearerKey') }} />
        <PressableScale haptic onPress={saveTavilyKey} style={{ marginTop: 10, minHeight: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.text }}>
          <Text style={{ color: colors.surface, fontSize: 14, fontWeight: '800' }}>{saved ? t('common.saved') : t('contextPanel.saveSearchConfig')}</Text>
        </PressableScale>
      </IslandSection> : null}

      {showKnowledge ? <PressableScale
        haptic
        onPress={importFile}
        disabled={importing}
        style={{ marginTop: 12, minHeight: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, backgroundColor: colors.text, opacity: importing ? 0.65 : 1 }}
      >
        <Upload color={colors.surface} size={18} />
        <Text style={{ color: colors.surface, fontSize: 14, fontWeight: '800' }}>{importing ? t('contextPanel.importing') : t('contextPanel.importKnowledgeFile')}</Text>
      </PressableScale> : null}

      {showKnowledge ? <IslandSection title={t('contextPanel.pasteTextKnowledge')} material="raised" style={{ marginTop: 12 }}>
        <IslandField label={t('contextPanel.knowledgeTitle')} inputProps={{ value: plainTitle, onChangeText: setPlainTitle, placeholder: t('contextPanel.knowledgeTitle') }} />
        <IslandField label={t('contextPanel.body')} style={{ marginTop: 10 }} inputProps={{ value: plainText, onChangeText: setPlainText, multiline: true, placeholder: t('contextPanel.body'), style: { minHeight: 96, maxHeight: 180 } }} />
        <PressableScale haptic onPress={importPlainText} disabled={importing || !plainText.trim()} style={{ marginTop: 10, minHeight: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.text, opacity: importing || !plainText.trim() ? 0.45 : 1 }}>
          <Text style={{ color: colors.surface, fontSize: 14, fontWeight: '800' }}>{t('contextPanel.importPastedText')}</Text>
        </PressableScale>
      </IslandSection> : null}

      {showMemory ? <ContextList
        title={t('contextPanel.memoryCount', { count: memories.length })}
        empty={t('contextPanel.noMemories')}
        onClear={async () => {
          await clearMemories()
          await refresh()
        }}
      >
        {memories.slice(0, 6).map((memory) => (
          <ItemRow
            key={memory.id}
            title={memory.status === 'pending' ? t('contextPanel.pendingMemory') : memory.status === 'active' ? t('settings.longMemory') : t('contextPanel.disabledMemory')}
            description={memory.content}
            trailing={memory.status === 'disabled' ? t('apiKeyPanel.enabled') : t('apiKeyPanel.disabled')}
            onToggle={async () => {
              await updateMemoryStatus(memory.id, memory.status === 'disabled' ? 'active' : 'disabled')
              await refresh()
            }}
            onDelete={async () => {
              await deleteMemory(memory.id)
              await refresh()
            }}
          />
        ))}
      </ContextList> : null}

      {showKnowledge ? <ContextList
        title={t('contextPanel.knowledgeCount', { count: documents.length })}
        empty={t('contextPanel.noKnowledgeFiles')}
        onClear={async () => {
          await clearKnowledge()
          await refresh()
        }}
      >
        {documents.slice(0, 6).map((document) => (
          <ItemRow
            key={document.id}
            title={document.title}
            description={t('contextPanel.chunkDescription', { count: document.chunkCount, kb: Math.round(document.size / 1024) })}
            onDelete={async () => {
              await deleteKnowledgeDocument(document.id)
              await refresh()
            }}
          />
        ))}
      </ContextList> : null}
    </View>
  )
}

function ContextList({ title, empty, children, onClear }: { title: string; empty: string; children: React.ReactNode; onClear: () => Promise<void> }) {
  const { colors } = useAppTheme()
  const dialog = useIslandDialog()
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
        <PressableScale onPress={confirmClear} style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.islandRaised }}>
          <Trash2 color={colors.textTertiary} size={15} />
        </PressableScale>
      </View>
      {children || <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{empty}</Text>}
    </View>
  )
}

function searchModeLabel(mode: SearchProviderId, t: TFunction): string {
  switch (mode) {
    case 'native':
      return t('contextPanel.nativeSearch')
    case 'tavily':
      return 'Tavily'
    case 'google':
      return 'Google'
    case 'bing':
      return 'Bing/Azure'
    case 'custom':
      return t('contextPanel.custom')
    case 'off':
      return t('contextPanel.off')
  }
}

function LocalModelRow({ view, busy, onDownload, onEnable, onDelete }: {
  view: LocalEmbeddingModelView
  busy: boolean
  onDownload: () => void
  onEnable: () => void
  onDelete: () => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const canEnable = view.source !== 'none'
  const downloadable = view.model.files.length > 0 && view.model.sizeBytes > 0
  const statusLabel = view.active
    ? t('contextPanel.localModel.statusEnabled')
    : view.status === 'bundled'
      ? t('contextPanel.localModel.statusBundled')
      : view.status === 'downloaded'
        ? t('contextPanel.localModel.statusDownloaded')
        : view.status === 'verify-failed'
          ? t('contextPanel.localModel.statusFailed')
          : downloadable
            ? t('contextPanel.localModel.statusNotDownloaded')
            : t('contextPanel.localModel.statusPlaceholder')
  return (
    <View style={{ borderRadius: 18, padding: 12, backgroundColor: colors.material.paper, borderWidth: 1, borderColor: view.active ? colors.success : colors.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: view.active ? colors.mintSoft : colors.islandRaised }}>
          {view.active ? <Check color={colors.success} size={16} /> : <HardDrive color={colors.textTertiary} size={16} />}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13, fontWeight: '900' }}>{view.model.name}</Text>
          <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 2 }}>
            {capabilityLabel(view.model.capability ?? 'embedding', t)} · {view.model.language} · {downloadable ? formatModelBytes(view.model.sizeBytes) : t('contextPanel.localModel.sizePending')} · {view.model.dimension ? `${view.model.dimension}d` : t('contextPanel.localModel.dimensionPending')}
          </Text>
        </View>
        <Text style={{ color: view.active ? colors.success : colors.textTertiary, fontSize: 11, fontWeight: '900' }}>{statusLabel}</Text>
      </View>
      <Text numberOfLines={2} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 8 }}>{view.model.useCase}</Text>
      <Text numberOfLines={2} style={{ color: colors.textTertiary, fontSize: 10, lineHeight: 15, marginTop: 6 }}>
        {view.model.publisher ?? view.model.upstreamModel ?? '-'} · {view.model.license ?? '-'}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        {!view.downloaded && !view.bundled && downloadable ? (
          <PressableScale haptic disabled={busy} onPress={onDownload} style={{ minHeight: 32, paddingHorizontal: 12, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, backgroundColor: colors.text, opacity: busy ? 0.65 : 1 }}>
            <Download color={colors.surface} size={13} />
            <Text style={{ color: colors.surface, fontSize: 12, fontWeight: '900' }}>{busy ? t('contextPanel.localModel.downloading') : t('contextPanel.localModel.download')}</Text>
          </PressableScale>
        ) : null}
        {canEnable && !view.active ? (
          <PressableScale haptic disabled={busy} onPress={onEnable} style={{ minHeight: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center', backgroundColor: colors.islandRaised, opacity: busy ? 0.65 : 1 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '900' }}>{t('contextPanel.localModel.enable')}</Text>
          </PressableScale>
        ) : null}
        {view.downloaded ? (
          <PressableScale haptic disabled={busy} onPress={onDelete} style={{ minHeight: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center', backgroundColor: colors.islandRaised, opacity: busy ? 0.65 : 1 }}>
            <Text style={{ color: colors.error, fontSize: 12, fontWeight: '900' }}>{t('common.delete')}</Text>
          </PressableScale>
        ) : null}
      </View>
    </View>
  )
}

function capabilityLabel(capability: LocalRagModelCapability, t: TFunction): string {
  return t(`contextPanel.localModel.capabilities.${capability}`)
}

function ItemRow({ title, description, trailing, onToggle, onDelete }: { title: string; description: string; trailing?: string; onToggle?: () => Promise<void>; onDelete: () => Promise<void> }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  return (
    <View style={{ borderRadius: 20, padding: 12, marginBottom: 8, backgroundColor: colors.material.paper, borderWidth: 1, borderColor: colors.border }}>
      <Text style={{ color: colors.text, fontSize: 14, fontWeight: '800' }}>{title}</Text>
      <Text numberOfLines={3} style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 4 }}>{description}</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        {trailing && onToggle ? (
          <PressableScale onPress={() => void onToggle()} style={{ minHeight: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center', backgroundColor: colors.islandRaised }}>
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '800' }}>{trailing}</Text>
          </PressableScale>
        ) : null}
        <PressableScale onPress={() => void onDelete()} style={{ minHeight: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center', backgroundColor: colors.islandRaised }}>
          <Text style={{ color: colors.error, fontSize: 12, fontWeight: '800' }}>{t('common.delete')}</Text>
        </PressableScale>
      </View>
    </View>
  )
}

function SelfTestRow({ step }: { step: SelfTestStep }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const statusColor = step.status === 'ok' ? colors.success : step.status === 'warn' ? colors.warning : colors.error
  const statusText = step.status === 'ok' ? t('contextPanel.selfTest.passed') : step.status === 'warn' ? t('contextPanel.selfTest.needsConfig') : t('contextPanel.selfTest.failedStatus')
  return (
    <View style={{ borderRadius: 16, padding: 10, backgroundColor: colors.islandRaised, borderWidth: 1, borderColor: colors.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: statusColor }} />
        <Text style={{ color: colors.text, fontSize: 12, fontWeight: '900', flex: 1 }}>{step.name}</Text>
        <Text style={{ color: statusColor, fontSize: 11, fontWeight: '900' }}>{statusText}</Text>
      </View>
      <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 5 }}>{step.detail}</Text>
    </View>
  )
}

function RagEvaluationCard({ run }: { run: RagEvaluationRun }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  return (
    <View style={{ marginTop: 10, borderRadius: 18, padding: 12, backgroundColor: colors.material.paper, borderWidth: 1, borderColor: colors.border }}>
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
    <View style={{ marginTop: 8, borderRadius: 16, padding: 10, backgroundColor: colors.islandRaised, borderWidth: 1, borderColor: colors.border }}>
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
    <View style={{ marginTop: 8, borderRadius: 16, padding: 10, backgroundColor: colors.material.paper, borderWidth: 1, borderColor: job.status === 'error' ? colors.error : colors.border }}>
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
    <View style={{ minHeight: 34, minWidth: 74, borderRadius: 17, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.islandRaised, borderWidth: 1, borderColor: colors.border }}>
      <Text style={{ color: colors.text, fontSize: 12, fontWeight: '900' }}>{value}</Text>
      <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '800' }}>{label}</Text>
    </View>
  )
}
