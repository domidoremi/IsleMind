import type { Conversation, Message } from '@/types/chatContracts'
import { describeUserFacingError } from '@/core'
import type { RetrievalSource } from '@/types/contextContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'
import { retrieveConversationKnowledgeContext } from '@/bootstrap/knowledgeContextRuntime'
import { extractConversationMemories } from '@/bootstrap/knowledgeMemoryExtraction'
import { importKnowledgePlainText } from '@/bootstrap/knowledgeDocumentImportRuntime'
import { searchWeb } from '@/bootstrap/webSearchProviderRuntime'
import { deleteKnowledgeDocumentRecords, knowledgeRepository } from '@/bootstrap/knowledgeRepository'
import {
  searchAgenticKnowledgeWithScope,
  searchKnowledgeFts,
  searchKnowledgeWithFallback,
} from '@/bootstrap/knowledgeRetrievalRuntime'
import { listRagEmbeddingJobs } from '@/bootstrap/knowledgeRagEvaluation'
import { SEARCH_DIAGNOSTIC_QUERY, resolveSearchProvider } from '@/modules/integrations'
import { getPolicyPreferredProviderModel } from '@/bootstrap/providerModelAccess'
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
  signal?: AbortSignal
}

export interface RunContextSelfTestResult {
  steps: ContextSelfTestStep[]
  ok: number
  warn: number
  fail: number
}

async function searchSelfTestMemories(
  query: string,
  limit: number,
  statuses: Array<'pending' | 'active'> = ['active'],
  signal?: AbortSignal,
) {
  const hits = await knowledgeRepository.searchMemories({ query, limit, statuses, signal })
  return hits.map((hit) => ({ ...hit, excerpt: hit.content }))
}

export async function runContextSelfTest(input: RunContextSelfTestInput): Promise<RunContextSelfTestResult> {
  const steps: ContextSelfTestStep[] = []
  const canary = `islemind_canary_${Date.now()}`
  const autoMemoryCanary = `autotest_${Date.now().toString(36)}`
  const conversationId = `self-test-${canary}`
  const knowledgeTitle = `Self test ${canary}`
  let manualMemoryId: string | undefined

  const pushStep = (step: ContextSelfTestStep) => {
    steps.push(step)
    input.onStep?.(step)
  }

  const [existingDocuments, existingMemories] = await Promise.all([
    knowledgeRepository.listDocuments({ signal: input.signal }),
    knowledgeRepository.listMemories({ signal: input.signal }),
  ])
  const existingDocumentIds = new Set(existingDocuments.map((document) => document.id))
  const existingMemoryIds = new Set(existingMemories.map((memory) => memory.id))

  try {
  const knowledgeText = [
    `IsleMind context self-test marker: ${canary}.`,
    `The RAG answer for ${canary} is aurora-lantern.`,
    'This text is intentionally local-only and should be retrievable by SQLite FTS or hybrid retrieval.',
  ].join(' ')
  const importResult = await importKnowledgePlainText(
    knowledgeTitle,
    knowledgeText,
    input.primaryProvider ?? undefined,
    { signal: input.signal ?? new AbortController().signal },
  )
  pushStep({
    name: input.t('contextPanel.selfTest.knowledgeWrite'),
    status: importResult.ok ? 'ok' : 'fail',
    detail: importResult.message,
  })

  const knowledgeHits = filterSelfTestHits(
    await searchKnowledgeFts(`${canary} aurora-lantern`, 3, { signal: input.signal }),
    canary,
  )
  pushStep(buildHitStep({
    name: input.t('contextPanel.selfTest.knowledgeFts'),
    hits: knowledgeHits,
    missText: input.t('contextPanel.selfTest.knowledgeMiss'),
    firstFallback: input.t('contextPanel.knowledgeChunk'),
    t: input.t,
  }))

  const hybridKnowledgeHits = filterSelfTestHits(await searchKnowledgeWithFallback({
    query: `${canary} aurora-lantern`,
    limit: 3,
    ragMode: 'hybrid',
    embeddingMode: input.settings.embeddingMode ?? 'hybrid',
    localEmbeddingModelId: input.settings.localEmbeddingModelId,
    localEmbeddingModelSource: input.settings.localEmbeddingModelSource,
    ...(input.primaryProvider ? { provider: input.primaryProvider } : {}),
    signal: input.signal,
  }), canary)
  pushStep(buildHitStep({
    name: input.t('contextPanel.selfTest.knowledgeHybrid'),
    hits: hybridKnowledgeHits,
    missText: input.t('contextPanel.selfTest.knowledgeMiss'),
    firstFallback: input.t('contextPanel.knowledgeChunk'),
    t: input.t,
  }))

  const agenticKnowledgeHits = filterSelfTestHits(await searchAgenticKnowledgeWithScope({
    query: `${canary} aurora-lantern`,
    limit: 3,
    techniques: ['raptor', 'graphrag', 'colbert'],
    signal: input.signal,
  }), canary)
  pushStep(buildHitStep({
    name: input.t('contextPanel.selfTest.knowledgeAgentic'),
    hits: agenticKnowledgeHits,
    missText: input.t('contextPanel.selfTest.knowledgeMiss'),
    firstFallback: input.t('contextPanel.knowledgeChunk'),
    t: input.t,
  }))

  const memoryContent = `User preference: ${canary} preferred answer = mint-echo`
  const manualMemory = await knowledgeRepository.saveMemory(
    { content: memoryContent, status: 'active', sourceKind: 'manual', confidence: 1 },
    { signal: input.signal },
  )
  manualMemoryId = manualMemory.id
  const memoryHits = (await searchSelfTestMemories(`${canary} mint-echo`, 3, ['active'], input.signal))
    .filter((hit) => hit.content.includes(canary))
  pushStep({
    name: input.t('contextPanel.selfTest.memoryWriteSearch'),
    status: memoryHits.length ? 'ok' : 'fail',
    detail: memoryHits.length
      ? input.t('contextPanel.selfTest.hitFirst', { count: memoryHits.length, first: memoryHits[0]?.excerpt ?? memoryHits[0]?.content ?? input.t('settings.memory') })
      : input.t('contextPanel.selfTest.memoryMiss'),
  })

  const primaryModel = input.primaryProvider ? getPolicyPreferredProviderModel(input.primaryProvider, input.settings) : undefined
  if (input.settings.memoryEnabled !== true) {
    pushStep({
      name: input.t('contextPanel.selfTest.autoMemory'),
      status: 'warn',
      detail: input.t('contextPanel.selfTest.disabledSkip'),
    })
  } else {
    const extracted = await extractConversationMemories(
      conversationId,
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
      primaryModel,
      input.signal,
    )
    const extractedHits = (await searchSelfTestMemories(`${autoMemoryCanary} velvet-river`, 5, ['pending', 'active'], input.signal))
      .filter((hit) => hit.content.includes(autoMemoryCanary))
    pushStep({
      name: input.t('contextPanel.selfTest.autoMemory'),
      status: extracted.length && extractedHits.length ? 'ok' : 'fail',
      detail: extracted.length && extractedHits.length
        ? input.t('contextPanel.selfTest.extractedHit', { count: extracted.length, first: extractedHits[0]?.excerpt ?? extracted[0] })
        : input.t('contextPanel.selfTest.extractedMiss', { count: extracted.length, hits: extractedHits.length }),
    })
  }

  const conversation: Conversation = {
    id: conversationId,
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
  const memoryContextEnabled = input.settings.memoryEnabled === true
  const knowledgeContextEnabled = input.settings.knowledgeEnabled === true && (input.settings.ragMode ?? 'hybrid') !== 'off'
  if (!memoryContextEnabled && !knowledgeContextEnabled) {
    pushStep({
      name: input.t('contextPanel.selfTest.chatContext'),
      status: 'warn',
      detail: input.t('contextPanel.selfTest.chatContextSkip'),
    })
  } else {
    const context = await retrieveConversationKnowledgeContext(
      conversation,
      message,
      input.signal ?? new AbortController().signal,
    )
    const memoryCount = context.sources.filter((source) => source.type === 'memory' && source.content.includes(canary)).length
    const knowledgeCount = context.sources.filter((source) => source.type === 'knowledge' && source.content.includes(canary)).length
    const expectedContextFound = (!memoryContextEnabled || memoryCount > 0)
      && (!knowledgeContextEnabled || knowledgeCount > 0)
    pushStep({
      name: input.t('contextPanel.selfTest.chatContext'),
      status: expectedContextFound ? 'ok' : 'fail',
      detail: input.t('contextPanel.selfTest.contextHits', { total: context.sources.length, memories: memoryCount, knowledge: knowledgeCount }),
    })
  }

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
      const webHits = await searchWeb(SEARCH_DIAGNOSTIC_QUERY, 3, { signal: input.signal })
      pushStep({
        name: input.t('contextPanel.selfTest.webAdapter'),
        status: webHits.length ? 'ok' : 'fail',
        detail: webHits.length
          ? input.t('contextPanel.selfTest.webHitFirst', { count: webHits.length, first: webHits[0]?.title ?? webHits[0]?.url ?? input.t('source.webSource') })
          : input.t('contextPanel.selfTest.webNoResults'),
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      pushStep({
        name: input.t('contextPanel.selfTest.tavilySearch'),
        status: 'fail',
        detail: describeUserFacingError(error, input.t, { headlineKey: 'contextPanel.selfTest.tavilyFailed' }),
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
  } finally {
    const cleanup = await cleanupContextSelfTestArtifacts({
      canary,
      autoMemoryCanary,
      conversationId,
      knowledgeTitle,
      manualMemoryId,
      existingDocumentIds,
      existingMemoryIds,
    })
    if (!input.signal?.aborted) {
      pushStep({
        name: input.t('contextPanel.selfTest.cleanup'),
        status: cleanup.failed ? 'fail' : 'ok',
        detail: input.t(cleanup.failed ? 'contextPanel.selfTest.cleanupFailed' : 'contextPanel.selfTest.cleanupComplete', {
          count: cleanup.failed || cleanup.removed,
        }),
      })
    }
  }

  return {
    steps,
    ok: steps.filter((step) => step.status === 'ok').length,
    warn: steps.filter((step) => step.status === 'warn').length,
    fail: steps.filter((step) => step.status === 'fail').length,
  }
}

async function cleanupContextSelfTestArtifacts(input: {
  canary: string
  autoMemoryCanary: string
  conversationId: string
  knowledgeTitle: string
  manualMemoryId?: string
  existingDocumentIds: ReadonlySet<string>
  existingMemoryIds: ReadonlySet<string>
}): Promise<{ removed: number; failed: number }> {
  const cleanupSignal = new AbortController().signal
  let removed = 0
  let failed = 0
  try {
    const [documents, memories] = await Promise.all([
      knowledgeRepository.listDocuments({ signal: cleanupSignal }),
      knowledgeRepository.listMemories({ signal: cleanupSignal }),
    ])
    const documentIds = documents
      .filter((document) => !input.existingDocumentIds.has(document.id) && document.title === input.knowledgeTitle)
      .map((document) => document.id)
    const memoryIds = memories
      .filter((memory) => !input.existingMemoryIds.has(memory.id) && (
        memory.id === input.manualMemoryId
        || memory.conversationId === input.conversationId
        || memory.content.includes(input.canary)
        || memory.content.includes(input.autoMemoryCanary)
      ))
      .map((memory) => memory.id)

    for (const documentId of documentIds) {
      try {
        await deleteKnowledgeDocumentRecords(documentId)
        removed += 1
      } catch {
        failed += 1
      }
    }
    for (const memoryId of memoryIds) {
      try {
        await knowledgeRepository.deleteMemory(memoryId, { signal: cleanupSignal })
        removed += 1
      } catch {
        failed += 1
      }
    }
  } catch {
    failed += 1
  }
  return { removed, failed }
}

function filterSelfTestHits(hits: RetrievalSource[], marker: string): RetrievalSource[] {
  return hits.filter((hit) => hit.content.includes(marker) || hit.title?.includes(marker) || hit.excerpt?.includes(marker))
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
