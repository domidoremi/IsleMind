import type { AIProvider, Conversation, Message, RetrievalSource, Settings } from '@/types'
import { extractMemories, importKnowledgePlainText, retrieveContext, searchKnowledgeAgenticIndexes, searchKnowledgeHybrid, searchWeb } from '@/services/context'
import { addMemory, searchKnowledge, searchMemories } from '@/services/contextStore'
import { listRagEmbeddingJobs } from '@/services/ragEvaluation'
import { SEARCH_DIAGNOSTIC_QUERY, resolveSearchProvider } from '@/services/searchPolicy'
import { getPolicyPreferredProviderModel } from '@/services/ai/policy/providerModelAccess'

export interface ContextSelfTestStep {
  name: string
  status: 'ok' | 'warn' | 'fail'
  detail: string
}

export interface RunContextSelfTestInput {
  settings: Settings
  primaryProvider: AIProvider | null
  getTavilyApiKey: () => Promise<string | null>
  t: (key: string, options?: Record<string, unknown>) => string
  onStep?: (step: ContextSelfTestStep) => void
}

export interface RunContextSelfTestResult {
  steps: ContextSelfTestStep[]
  ok: number
  warn: number
  fail: number
}

export async function runContextSelfTest(input: RunContextSelfTestInput): Promise<RunContextSelfTestResult> {
  const steps: ContextSelfTestStep[] = []
  const canary = `islemind_canary_${Date.now()}`

  const pushStep = (step: ContextSelfTestStep) => {
    steps.push(step)
    input.onStep?.(step)
  }

  const knowledgeText = [
    `IsleMind context self-test marker: ${canary}.`,
    `The RAG answer for ${canary} is aurora-lantern.`,
    'This text is intentionally local-only and should be retrievable by SQLite FTS or hybrid retrieval.',
  ].join(' ')
  const importResult = await importKnowledgePlainText(`Self test ${canary}`, knowledgeText, input.primaryProvider ?? undefined)
  pushStep({
    name: input.t('contextPanel.selfTest.knowledgeWrite'),
    status: importResult.ok ? 'ok' : 'fail',
    detail: importResult.message,
  })

  const knowledgeHits = await searchKnowledge(`${canary} aurora-lantern`, 3)
  pushStep(buildHitStep({
    name: input.t('contextPanel.selfTest.knowledgeFts'),
    hits: knowledgeHits,
    missText: input.t('contextPanel.selfTest.knowledgeMiss'),
    firstFallback: input.t('contextPanel.knowledgeChunk'),
    t: input.t,
  }))

  const hybridKnowledgeHits = await searchKnowledgeHybrid(`${canary} aurora-lantern`, {
    limit: 3,
    embeddingMode: input.settings.embeddingMode ?? 'hybrid',
    localEmbeddingModelId: input.settings.localEmbeddingModelId,
    localEmbeddingModelSource: input.settings.localEmbeddingModelSource,
    ...(input.primaryProvider ? { provider: input.primaryProvider } : {}),
  })
  pushStep(buildHitStep({
    name: input.t('contextPanel.selfTest.knowledgeHybrid'),
    hits: hybridKnowledgeHits,
    missText: input.t('contextPanel.selfTest.knowledgeMiss'),
    firstFallback: input.t('contextPanel.knowledgeChunk'),
    t: input.t,
  }))

  const agenticKnowledgeHits = await searchKnowledgeAgenticIndexes(`${canary} aurora-lantern`, {
    limit: 3,
    techniques: ['raptor', 'graphrag', 'colbert'],
  })
  pushStep(buildHitStep({
    name: input.t('contextPanel.selfTest.knowledgeAgentic'),
    hits: agenticKnowledgeHits,
    missText: input.t('contextPanel.selfTest.knowledgeMiss'),
    firstFallback: input.t('contextPanel.knowledgeChunk'),
    t: input.t,
  }))

  const memoryContent = `User preference: ${canary} preferred answer = mint-echo`
  await addMemory(memoryContent, undefined, 'active')
  const memoryHits = await searchMemories(`${canary} mint-echo`, 3)
  pushStep({
    name: input.t('contextPanel.selfTest.memoryWriteSearch'),
    status: memoryHits.length ? 'ok' : 'fail',
    detail: memoryHits.length
      ? input.t('contextPanel.selfTest.hitFirst', { count: memoryHits.length, first: memoryHits[0]?.excerpt ?? memoryHits[0]?.content ?? input.t('settings.memory') })
      : input.t('contextPanel.selfTest.memoryMiss'),
  })

  const autoMemoryCanary = `autotest_${Date.now().toString(36)}`
  const primaryModel = input.primaryProvider ? getPolicyPreferredProviderModel(input.primaryProvider, input.settings) : undefined
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
    input.primaryProvider ?? undefined,
    primaryModel
  )
  const extractedHits = await searchMemories(`${autoMemoryCanary} velvet-river`, 5, ['pending', 'active'])
  pushStep({
    name: input.t('contextPanel.selfTest.autoMemory'),
    status: extracted.length && extractedHits.length ? 'ok' : 'fail',
    detail: extracted.length && extractedHits.length
      ? input.t('contextPanel.selfTest.extractedHit', { count: extracted.length, first: extractedHits[0]?.excerpt ?? extracted[0] })
      : input.t('contextPanel.selfTest.extractedMiss', { count: extracted.length, hits: extractedHits.length }),
  })

  const conversation: Conversation = {
    id: `self-test-${canary}`,
    title: 'Context self-test',
    providerId: input.primaryProvider?.id ?? 'self-test',
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
    name: input.t('contextPanel.selfTest.chatContext'),
    status: memoryCount > 0 && knowledgeCount > 0 ? 'ok' : 'fail',
    detail: input.t('contextPanel.selfTest.contextHits', { total: context.sources.length, memories: memoryCount, knowledge: knowledgeCount }),
  })

  const tavilyKey = await input.getTavilyApiKey()
  const searchProvider = resolveSearchProvider(input.settings)
  if (searchProvider === 'off' || searchProvider === 'native') {
    pushStep({
      name: input.t('settings.webSearch'),
      status: 'warn',
      detail: searchProvider === 'native' ? input.t('contextPanel.selfTest.nativeSearchSkip') : input.t('contextPanel.selfTest.webSearchOff'),
    })
  } else if (searchProvider === 'tavily' && !tavilyKey?.trim()) {
    pushStep({
      name: input.t('contextPanel.selfTest.tavilySearch'),
      status: 'warn',
      detail: input.t('contextPanel.selfTest.tavilyMissingKey'),
    })
  } else {
    try {
      const webHits = await searchWeb(SEARCH_DIAGNOSTIC_QUERY, 3)
      pushStep({
        name: input.t('contextPanel.selfTest.webAdapter'),
        status: webHits.length ? 'ok' : 'fail',
        detail: webHits.length
          ? input.t('contextPanel.selfTest.webHitFirst', { count: webHits.length, first: webHits[0]?.title ?? webHits[0]?.url ?? input.t('source.webSource') })
          : input.t('contextPanel.selfTest.webNoResults'),
      })
    } catch (error) {
      pushStep({
        name: input.t('contextPanel.selfTest.tavilySearch'),
        status: 'fail',
        detail: error instanceof Error ? error.message : input.t('contextPanel.selfTest.tavilyFailed'),
      })
    }
  }

  const jobs = await listRagEmbeddingJobs(20)
  pushStep({
    name: input.t('contextPanel.selfTest.embeddingFallback'),
    status: jobs.some((job) => job.status === 'running') ? 'warn' : 'ok',
    detail: input.t('contextPanel.selfTest.embeddingJobs', {
      total: jobs.length,
      running: jobs.filter((job) => job.status === 'running').length,
      failed: jobs.filter((job) => job.status === 'error').length,
    }),
  })

  return {
    steps,
    ok: steps.filter((step) => step.status === 'ok').length,
    warn: steps.filter((step) => step.status === 'warn').length,
    fail: steps.filter((step) => step.status === 'fail').length,
  }
}

function buildHitStep(input: {
  name: string
  hits: RetrievalSource[]
  missText: string
  firstFallback: string
  t: RunContextSelfTestInput['t']
}): ContextSelfTestStep {
  return {
    name: input.name,
    status: input.hits.length ? 'ok' : 'fail',
    detail: input.hits.length
      ? input.t('contextPanel.selfTest.hitFirst', { count: input.hits.length, first: input.hits[0]?.title ?? input.firstFallback })
      : input.missText,
  }
}
