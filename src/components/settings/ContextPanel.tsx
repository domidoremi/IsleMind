import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { BookOpen, Brain, Globe2, Trash2, Upload } from 'lucide-react-native'
import type { AIProvider, Conversation, KnowledgeDocument, MemoryItem, Message, WebSearchMode } from '@/types'
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
import { useAppTheme } from '@/hooks/useAppTheme'
import { useSettingsStore } from '@/store/settingsStore'
import { getProviderModels } from '@/types'
import { PressableScale } from '@/components/ui/PressableScale'
import { Pill } from '@/components/ui/Pill'
import { IslandField, IslandSection, IslandToggle } from '@/components/ui/IslandPrimitives'
import { useIslandDialog } from '@/components/ui/IslandDialog'

interface ContextPanelProps {
  providers: AIProvider[]
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

export function ContextPanel({ providers }: ContextPanelProps) {
  const { colors } = useAppTheme()
  const dialog = useIslandDialog()
  void providers
  const settings = useSettingsStore((state) => state.settings)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const getTavilyApiKey = useSettingsStore((state) => state.getTavilyApiKey)
  const setTavilyApiKey = useSettingsStore((state) => state.setTavilyApiKey)
  const getPrimaryConfiguredProvider = useSettingsStore((state) => state.getPrimaryConfiguredProvider)
  const [tavilyKey, setTavilyKey] = useState('')
  const [saved, setSaved] = useState(false)
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [embeddingJobs, setEmbeddingJobs] = useState<{ running: number; error: number } | null>(null)
  const [importing, setImporting] = useState(false)
  const [selfTesting, setSelfTesting] = useState(false)
  const [selfTestResult, setSelfTestResult] = useState<SelfTestResult | null>(null)
  const [plainTitle, setPlainTitle] = useState('IsleMind smoke knowledge')
  const [plainText, setPlainText] = useState('')

  async function refresh() {
    const [memoryItems, documentItems, jobs] = await Promise.all([
      listMemories(['pending', 'active', 'disabled']),
      listKnowledgeDocuments(),
      localDataStore.listEmbeddingJobs(50),
    ])
    setMemories(memoryItems)
    setDocuments(documentItems)
    setEmbeddingJobs({
      running: jobs.filter((job) => job.status === 'running').length,
      error: jobs.filter((job) => job.status === 'error').length,
    })
  }

  useEffect(() => {
    void getTavilyApiKey().then((key) => setTavilyKey(key ?? ''))
    void refresh()
  }, [getTavilyApiKey])

  async function saveTavilyKey() {
    await setTavilyApiKey(tavilyKey.trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 1400)
  }

  async function importFile() {
    setImporting(true)
    try {
      const provider = await getPrimaryConfiguredProvider()
      const model = provider?.models[0] ?? (provider ? getProviderModels(provider.type)[0]?.id : undefined)
      const result = await importKnowledgeFile(provider ?? undefined, model)
      dialog.toast({ title: result.ok ? '知识库已更新' : '未导入', message: result.message, tone: result.ok ? 'mint' : 'amber' })
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
      dialog.toast({ title: result.ok ? '知识库已更新' : '未导入', message: result.message, tone: result.ok ? 'mint' : 'amber' })
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
        name: '知识库写入',
        status: importResult.ok ? 'ok' : 'fail',
        detail: importResult.message,
      })

      const knowledgeHits = await searchKnowledge(`${canary} aurora-lantern`, 3)
      pushStep({
        name: '知识库 FTS 检索',
        status: knowledgeHits.length ? 'ok' : 'fail',
        detail: knowledgeHits.length
          ? `命中 ${knowledgeHits.length} 条，首条：${knowledgeHits[0]?.title ?? '知识片段'}`
          : '未命中刚写入的 canary 文档。',
      })

      const memoryContent = `用户偏好：${canary} preferred answer = mint-echo`
      await addMemory(memoryContent, undefined, 'active')
      const memoryHits = await searchMemories(`${canary} mint-echo`, 3)
      pushStep({
        name: '长期记忆写入与检索',
        status: memoryHits.length ? 'ok' : 'fail',
        detail: memoryHits.length
          ? `命中 ${memoryHits.length} 条，首条：${memoryHits[0]?.excerpt ?? memoryHits[0]?.content ?? '记忆'}`
          : '未命中刚写入的 canary 记忆。',
      })

      const autoMemoryCanary = `autotest_${Date.now().toString(36)}`
      const extracted = await extractMemories(
        `self-test-${canary}`,
        [
          {
            id: `self-test-user-${canary}`,
            role: 'user',
            content: `我的${autoMemoryCanary}是velvet-river。以后相关问题请记住这个事实。`,
            timestamp: Date.now(),
            status: 'done',
          },
          {
            id: `self-test-assistant-${canary}`,
            role: 'assistant',
            content: '我会在需要时参考这个长期事实。',
            timestamp: Date.now(),
            status: 'done',
          },
        ],
        primaryProvider ?? undefined,
        primaryProvider?.models[0]
      )
      const extractedHits = await searchMemories(`${autoMemoryCanary} velvet-river`, 5)
      pushStep({
        name: '自动记忆抽取',
        status: extracted.length && extractedHits.length ? 'ok' : 'fail',
        detail: extracted.length && extractedHits.length
          ? `抽取 ${extracted.length} 条并可检索，首条：${extractedHits[0]?.excerpt ?? extracted[0]}`
          : `抽取 ${extracted.length} 条，检索命中 ${extractedHits.length} 条；自动抽取链路未闭环。`,
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
        name: '聊天上下文检索',
        status: memoryCount > 0 && knowledgeCount > 0 ? 'ok' : 'fail',
        detail: `总命中 ${context.sources.length} 条，记忆 ${memoryCount} 条，知识库 ${knowledgeCount} 条。`,
      })

      const tavilyKey = await getTavilyApiKey()
      if (!settings.webSearchEnabled || settings.webSearchMode !== 'tavily') {
        pushStep({
          name: 'Tavily 联网搜索',
          status: 'warn',
          detail: '当前未选择 Tavily 模式；聊天会跳过本地 Tavily 请求。',
        })
      } else if (!tavilyKey?.trim()) {
        pushStep({
          name: 'Tavily 联网搜索',
          status: 'warn',
          detail: 'Tavily 模式已开启，但 SecureStore 中没有 Key。',
        })
      } else {
        try {
          const webHits = await searchWeb('OpenAI Responses API streaming output_text delta', 3)
          pushStep({
            name: 'Tavily 联网搜索',
            status: webHits.length ? 'ok' : 'fail',
            detail: webHits.length
              ? `返回 ${webHits.length} 条网页，首条：${webHits[0]?.title ?? webHits[0]?.url ?? '网页来源'}`
              : '请求成功但未返回网页结果。',
          })
        } catch (error) {
          pushStep({
            name: 'Tavily 联网搜索',
            status: 'fail',
            detail: error instanceof Error ? error.message : 'Tavily 请求失败。',
          })
        }
      }

      const jobs = await localDataStore.listEmbeddingJobs(20)
      pushStep({
        name: 'Embedding 降级状态',
        status: jobs.some((job) => job.status === 'running') ? 'warn' : 'ok',
        detail: `最近任务 ${jobs.length} 个，运行中 ${jobs.filter((job) => job.status === 'running').length}，失败 ${jobs.filter((job) => job.status === 'error').length}；失败会保留本地向量降级。`,
      })
      await refresh()
    } catch (error) {
      pushStep({
        name: '自检异常',
        status: 'fail',
        detail: error instanceof Error ? error.message : '上下文自检失败。',
      })
    } finally {
      setSelfTesting(false)
    }
  }

  return (
    <View>
      <IslandToggle
        icon={<Brain color={colors.text} size={18} />}
        title="长期记忆"
        description="自动抽取待确认记忆，默认参与上下文检索。"
        active={!!settings.memoryEnabled}
        onPress={() => updateSettings({ memoryEnabled: !settings.memoryEnabled })}
      />
      <IslandToggle
        icon={<BookOpen color={colors.text} size={18} />}
        title="本机知识库"
        description="导入文件后使用 SQLite FTS 本地检索。"
        active={!!settings.knowledgeEnabled}
        onPress={() => updateSettings({ knowledgeEnabled: !settings.knowledgeEnabled })}
      />
      <IslandToggle
        icon={<Globe2 color={colors.text} size={18} />}
        title="联网搜索"
        description="默认服务商原生搜索，可切换 Tavily。"
        active={!!settings.webSearchEnabled}
        onPress={() => updateSettings({ webSearchEnabled: !settings.webSearchEnabled })}
      />

      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        {(['native', 'tavily', 'off'] satisfies WebSearchMode[]).map((mode) => (
          <PressableScale key={mode} haptic onPress={() => updateSettings({ webSearchMode: mode, webSearchEnabled: mode !== 'off' })}>
            <Pill active={(settings.webSearchMode ?? 'native') === mode}>{mode === 'native' ? '原生搜索' : mode === 'tavily' ? 'Tavily' : '关闭'}</Pill>
          </PressableScale>
        ))}
      </View>

      <IslandSection title="RAG 检索模式" subtitle="Hybrid 会融合 SQLite FTS 与本地 JS 向量；服务商向量失败会自动降级。" material="raised" style={{ marginTop: 12 }}>
        {embeddingJobs ? (
          <Text style={{ color: embeddingJobs.error ? colors.warning : colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 6 }}>
            Embedding 任务：运行中 {embeddingJobs.running} · 失败 {embeddingJobs.error} · 失败会保留本地向量降级。
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {(['hybrid', 'fts', 'off'] as const).map((mode) => (
            <PressableScale key={mode} haptic onPress={() => updateSettings({ ragMode: mode })}>
              <Pill active={(settings.ragMode ?? 'hybrid') === mode}>{mode === 'hybrid' ? '混合检索' : mode === 'fts' ? '仅 FTS' : '关闭 RAG'}</Pill>
            </PressableScale>
          ))}
        </View>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '800', marginTop: 14 }}>Embedding 策略</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {(['hybrid', 'provider', 'local'] as const).map((mode) => (
            <PressableScale key={mode} haptic onPress={() => updateSettings({ embeddingMode: mode })}>
              <Pill active={(settings.embeddingMode ?? 'hybrid') === mode}>{mode === 'hybrid' ? '服务商优先' : mode === 'provider' ? '仅服务商' : '本地估算'}</Pill>
            </PressableScale>
          ))}
        </View>
        <PressableScale
        haptic
        onPress={async () => {
          await localDataStore.clearRagCaches()
          dialog.notice({ title: '缓存已清理', message: 'RAG 查询缓存、请求缓存和 embedding 任务状态已清理。', tone: 'mint' })
        }}
          style={{ marginTop: 12, minHeight: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.islandRaised, borderWidth: 1, borderColor: colors.border }}
        >
          <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '800' }}>清理 RAG 缓存</Text>
        </PressableScale>
        <PressableScale
          haptic
          onPress={() => void runContextSelfTest()}
          disabled={selfTesting}
          style={{ marginTop: 10, minHeight: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.text, opacity: selfTesting ? 0.65 : 1 }}
        >
          <Text style={{ color: colors.surface, fontSize: 13, fontWeight: '900' }}>{selfTesting ? '自检中...' : '运行上下文功能自检'}</Text>
        </PressableScale>
        {selfTestResult ? (
          <View style={{ marginTop: 12, gap: 8 }}>
            <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: '800' }}>
              最近自检：{new Date(selfTestResult.ranAt).toLocaleTimeString()}
            </Text>
            {selfTestResult.steps.map((step, index) => (
              <SelfTestRow key={`${step.name}-${index}`} step={step} />
            ))}
          </View>
        ) : null}
      </IslandSection>

      <IslandSection title="Tavily API Key" material="raised" style={{ marginTop: 12 }}>
        <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 4 }}>
          {settings.webSearchEnabled && settings.webSearchMode === 'tavily'
            ? 'Tavily 搜索已启用；聊天过程面板会显示搜索命中或失败原因。'
            : tavilyKey.trim()
              ? 'Key 已保存，但当前没有启用 Tavily 搜索。请在上方选择 Tavily。'
              : '可选：保存后在上方选择 Tavily，用于第三方联网搜索。'}
        </Text>
        <IslandField label="Key" style={{ marginTop: 10 }} inputProps={{ value: tavilyKey, onChangeText: setTavilyKey, secureTextEntry: true, autoCapitalize: 'none', autoCorrect: false, placeholder: '可选：用于第三方联网搜索' }} />
        <PressableScale haptic onPress={saveTavilyKey} style={{ marginTop: 10, minHeight: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.text }}>
          <Text style={{ color: colors.surface, fontSize: 14, fontWeight: '800' }}>{saved ? '已保存' : '保存 Tavily Key'}</Text>
        </PressableScale>
      </IslandSection>

      <PressableScale
        haptic
        onPress={importFile}
        disabled={importing}
        style={{ marginTop: 12, minHeight: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, backgroundColor: colors.text, opacity: importing ? 0.65 : 1 }}
      >
        <Upload color={colors.surface} size={18} />
        <Text style={{ color: colors.surface, fontSize: 14, fontWeight: '800' }}>{importing ? '导入中...' : '导入知识文件'}</Text>
      </PressableScale>

      <IslandSection title="粘贴文本入库" material="raised" style={{ marginTop: 12 }}>
        <IslandField label="知识标题" inputProps={{ value: plainTitle, onChangeText: setPlainTitle, placeholder: '知识标题' }} />
        <IslandField label="正文" style={{ marginTop: 10 }} inputProps={{ value: plainText, onChangeText: setPlainText, multiline: true, placeholder: '粘贴一段要进入本机知识库的文本。', style: { minHeight: 96, maxHeight: 180 } }} />
        <PressableScale haptic onPress={importPlainText} disabled={importing || !plainText.trim()} style={{ marginTop: 10, minHeight: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.text, opacity: importing || !plainText.trim() ? 0.45 : 1 }}>
          <Text style={{ color: colors.surface, fontSize: 14, fontWeight: '800' }}>导入粘贴文本</Text>
        </PressableScale>
      </IslandSection>

      <ContextList
        title={`记忆 ${memories.length}`}
        empty="还没有自动沉淀的记忆。"
        onClear={async () => {
          await clearMemories()
          await refresh()
        }}
      >
        {memories.slice(0, 6).map((memory) => (
          <ItemRow
            key={memory.id}
            title={memory.status === 'pending' ? '待确认记忆' : memory.status === 'active' ? '长期记忆' : '已停用记忆'}
            description={memory.content}
            trailing={memory.status === 'disabled' ? '启用' : '停用'}
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
      </ContextList>

      <ContextList
        title={`知识库 ${documents.length}`}
        empty="还没有导入本机知识文件。"
        onClear={async () => {
          await clearKnowledge()
          await refresh()
        }}
      >
        {documents.slice(0, 6).map((document) => (
          <ItemRow
            key={document.id}
            title={document.title}
            description={`${document.chunkCount} 个片段 · ${Math.round(document.size / 1024)} KB`}
            onDelete={async () => {
              await deleteKnowledgeDocument(document.id)
              await refresh()
            }}
          />
        ))}
      </ContextList>
    </View>
  )
}

function ContextList({ title, empty, children, onClear }: { title: string; empty: string; children: React.ReactNode; onClear: () => Promise<void> }) {
  const { colors } = useAppTheme()
  const dialog = useIslandDialog()
  function confirmClear() {
    void dialog.confirm({
      title: `清空${title}`,
      message: '这个操作只会删除本机上下文数据，不会删除 API Key。',
      tone: 'danger',
      confirmLabel: '清空',
      cancelLabel: '取消',
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

function ItemRow({ title, description, trailing, onToggle, onDelete }: { title: string; description: string; trailing?: string; onToggle?: () => Promise<void>; onDelete: () => Promise<void> }) {
  const { colors } = useAppTheme()
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
          <Text style={{ color: colors.error, fontSize: 12, fontWeight: '800' }}>删除</Text>
        </PressableScale>
      </View>
    </View>
  )
}

function SelfTestRow({ step }: { step: SelfTestStep }) {
  const { colors } = useAppTheme()
  const statusColor = step.status === 'ok' ? colors.success : step.status === 'warn' ? colors.warning : colors.error
  const statusText = step.status === 'ok' ? '通过' : step.status === 'warn' ? '需配置' : '失败'
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
