import { ragEvaluationRepository } from '@/bootstrap/ragEvaluationRepository'
import { knowledgeRepository } from '@/bootstrap/knowledgeRepository'
import {
  searchAgenticKnowledgeWithScope,
  searchKnowledgeWithFallback,
} from '@/bootstrap/knowledgeRetrievalRuntime'
import {
  buildCompressedContextPrompt,
  buildFlareContextPrompt,
  buildKnowledgeScope,
  LOCAL_USER_MEMORY_SCOPE_ID,
  runAgenticRag,
} from '@/modules/knowledge'
import { st } from '@/i18n/service'
import { logContextOperation } from '@/services/runtimeHealthLog'
import { useSettingsStore } from '@/store/settingsStore'
import type { Conversation, Message } from '@/types/chatContracts'
import type { Settings } from '@/types/settingsContracts'
import type {
  RagEvaluationResult,
  RagQueryPlan,
  RagTraceStep,
  RetrievalSource,
} from '@/types/contextContracts'

const MAX_CONTEXT_ITEMS = 8

/**
 * Ordinary Chat stays on SQLite FTS unless the context plan explicitly
 * admits an advanced retrieval pass (deep profile or advanced technique).
 */
export function resolveConversationKnowledgeRagMode(
  settings: Pick<Settings, 'ragMode'>,
  retrievalMode: 'baseline' | 'advanced' = 'baseline',
): 'fts' | 'hybrid' {
  if (settings.ragMode === 'off') return 'fts'
  if (settings.ragMode === 'fts') return 'fts'
  return retrievalMode === 'advanced' ? 'hybrid' : 'fts'
}

export interface RetrievedConversationKnowledgeContext {
  sources: RetrievalSource[]
  prompt: string
  plan?: RagQueryPlan
  trace?: RagTraceStep[]
  quality?: RagEvaluationResult
}

export interface RetrievedConversationFlareContext {
  sources: RetrievalSource[]
  prompt: string
  trace: RagTraceStep[]
  quality?: RagEvaluationResult
}

/**
 * Bootstrap composition for the conversation knowledge path. The target RAG
 * use case owns planning/packing while this binding supplies app settings,
 * persistence and concrete search adapters.
 */
export async function retrieveConversationKnowledgeContext(
  conversation: Conversation,
  draftMessage: Message,
  signal?: AbortSignal,
): Promise<RetrievedConversationKnowledgeContext> {
  throwIfCancelled(signal)
  try {
    await Promise.all([
      knowledgeRepository.listMemories({ signal }),
      knowledgeRepository.listDocuments({ signal }),
    ])
    throwIfCancelled(signal)
  } catch (error) {
    rethrowCancellation(error, signal)
    await logContextOperationBestEffort({
      phase: 'initialize',
      status: 'error',
      detail: 'retrieve_context',
      error,
    })
    throwIfCancelled(signal)
    return { sources: [], prompt: '' }
  }

  const settings = useSettingsStore.getState().settings
  // Retrieval intent is user/conversation-local. Never ship the private
  // system prompt to an embedding or search adapter: it is instructions, not
  // evidence about what the user is asking.
  const query = [draftMessage.content, conversation.title]
    .filter(Boolean)
    .join('\n')
  let memorySources: RetrievalSource[]
  try {
    memorySources = settings.memoryEnabled
      ? await searchMemorySources(
        query,
        settings.memoryTopK ?? 4,
        conversation.id,
        signal,
      )
      : []
  } catch (error) {
    rethrowCancellation(error, signal)
    throw error
  }
  throwIfCancelled(signal)

  const knowledgeScope = buildKnowledgeScope(
    conversation.knowledgeSources ?? conversation.skillSnapshot?.knowledgeSources,
  )
  if (!settings.knowledgeEnabled || settings.ragMode === 'off') {
    const sources = memorySources.slice(0, MAX_CONTEXT_ITEMS)
    return {
      sources,
      prompt: formatConversationContextPrompt(sources),
    }
  }

  const provider = await useSettingsStore.getState().hydrateProviderKey(conversation.providerId)
  throwIfCancelled(signal)

  try {
    const rag = await runAgenticRag({
      query,
      conversationTitle: conversation.title,
      systemPrompt: conversation.systemPrompt,
      settings,
      memorySources,
      maxContextItems: Math.max(
        settings.knowledgeTopK ?? 4,
        settings.memoryTopK ?? 4,
        MAX_CONTEXT_ITEMS,
      ),
      retrieveKnowledge: (variant, limit, options) => searchKnowledgeWithFallback({
        query: variant,
        limit,
        ragMode: resolveConversationKnowledgeRagMode(settings, options?.mode),
        embeddingMode: settings.embeddingMode ?? 'hybrid',
        localEmbeddingModelId: settings.localEmbeddingModelId,
        localEmbeddingModelSource: settings.localEmbeddingModelSource,
        provider: provider ?? undefined,
        knowledgeScope,
        onEmbeddingResolved: options?.onEmbeddingResolved,
        signal: options?.signal,
      }),
      retrieveAgentic: (variant, plan, limit, options) => searchAgenticKnowledgeWithScope({
        query: variant,
        plan,
        limit,
        knowledgeScope,
        onEmbeddingResolved: options?.onEmbeddingResolved,
        signal: options?.signal,
      }),
      signal,
    })
    throwIfCancelled(signal)

    // Telemetry must never affect retrieval and is started only after the
    // cancellable work has completed successfully.
    void logRagEvaluationBestEffort({
      query,
      plan: rag.plan,
      quality: rag.quality,
      sourceCount: rag.sources.length,
      latencyMs: rag.quality.latencyMs,
      flareTriggered: rag.quality.flareTriggered,
      fallbackReasons: rag.quality.fallbackReasons,
    }, signal)

    const sources = rag.sources.slice(0, MAX_CONTEXT_ITEMS)
    return {
      sources,
      prompt: rag.contextPrompt || formatConversationContextPrompt(sources),
      plan: rag.plan,
      trace: rag.trace,
      quality: rag.quality,
    }
  } catch (error) {
    rethrowCancellation(error, signal)
    throw error
  }
}

export async function retrieveConversationFlareContext(input: {
  conversation: Conversation
  query: string
  followupQuery: string
  excludeChunkIds?: string[]
  limit?: number
  signal?: AbortSignal
}): Promise<RetrievedConversationFlareContext> {
  throwIfCancelled(input.signal)
  const settings = useSettingsStore.getState().settings
  if (!settings.knowledgeEnabled || settings.ragMode === 'off') {
    return { sources: [], prompt: '', trace: [] }
  }

  const provider = await useSettingsStore.getState().hydrateProviderKey(input.conversation.providerId)
  throwIfCancelled(input.signal)
  const startedAt = Date.now()
  const query = input.followupQuery || input.query
  const limit = input.limit ?? 4
  const knowledgeScope = buildKnowledgeScope(
    input.conversation.knowledgeSources ?? input.conversation.skillSnapshot?.knowledgeSources,
  )

  try {
    const hits = await searchKnowledgeWithFallback({
      query,
      limit,
      // FLARE is an explicit supplemental pass, so retain the configured
      // hybrid index even when the ordinary turn uses the FTS baseline.
      ragMode: settings.ragMode === 'fts' ? 'fts' : 'hybrid',
      embeddingMode: settings.embeddingMode ?? 'hybrid',
      localEmbeddingModelId: settings.localEmbeddingModelId,
      localEmbeddingModelSource: settings.localEmbeddingModelSource,
      provider: provider ?? undefined,
      knowledgeScope,
      signal: input.signal,
    })
    throwIfCancelled(input.signal)
    const advanced = await searchAgenticKnowledgeWithScope({
      query,
      limit,
      plan: { query, enabledTechniques: ['raptor', 'graphrag', 'colbert'] },
      techniques: ['raptor', 'graphrag', 'colbert'],
      knowledgeScope,
      signal: input.signal,
    })
    throwIfCancelled(input.signal)

    const excluded = new Set(input.excludeChunkIds ?? [])
    const merged = dedupeSources([...hits, ...advanced])
      .filter((source) => !source.chunkId || !excluded.has(source.chunkId))
      .slice(0, limit)
    const completedAt = Date.now()
    const trace: RagTraceStep = {
      id: `flare-retrieve-${completedAt}`,
      stage: 'flare',
      title: 'FLARE active retrieval',
      status: merged.length ? 'done' : 'skipped',
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
      content: merged.length
        ? `${merged.length} supplemental sources`
        : 'No supplemental evidence found.',
      metadata: {
        sourceCount: merged.length,
        followupQuery: input.followupQuery,
      },
    }
    return {
      sources: merged,
      prompt: buildFlareContextPrompt(input.query, merged),
      trace: [trace],
      quality: {
        sourceCount: merged.length,
        candidateCount: hits.length + advanced.length,
        citationCoverage: merged.length ? 1 : 0,
        contextPrecision: merged.length
          ? Math.min(1, merged.reduce((sum, source) => sum + (source.score ?? 0), 0) / merged.length)
          : 0,
        compressionRatio: 1,
        confidence: merged.length ? 0.62 : 0,
        activeRetrievals: 1,
        missingEvidence: merged.length === 0,
        warnings: merged.length ? [] : ['missing-evidence'],
        flareTriggered: true,
        latencyMs: trace.durationMs,
      },
    }
  } catch (error) {
    rethrowCancellation(error, input.signal)
    throw error
  }
}

function formatConversationContextPrompt(sources: RetrievalSource[]): string {
  if (!sources.length) return ''
  return [
    '以下是本机上下文增强材料。请只在相关时使用；如果材料不足或不确定，请明确说明。',
    buildCompressedContextPrompt(sources),
  ].join('\n\n')
}

async function searchMemorySources(
  query: string,
  limit: number,
  conversationId: string,
  signal?: AbortSignal,
): Promise<RetrievalSource[]> {
  if (!query.trim() || limit <= 0) return []
  const hits = await knowledgeRepository.searchMemories({
    query,
    limit,
    statuses: ['active'],
    scopes: [
      { kind: 'user', id: LOCAL_USER_MEMORY_SCOPE_ID },
      { kind: 'conversation', id: conversationId },
    ],
    signal,
  })
  throwIfCancelled(signal)
  return hits.map((memory) => {
    const reason = [`source=${memory.sourceKind}`]
    if (memory.confidence !== undefined) {
      reason.push(`confidence=${Number(memory.confidence.toFixed(2))}`)
    }
    if (memory.sourceDetail) reason.push(memory.sourceDetail)
    return {
      id: memory.id,
      type: 'memory' as const,
      title: memory.status === 'pending'
        ? st('contextStore.pendingMemory')
        : st('contextStore.longTermMemory'),
      content: memory.content,
      excerpt: memory.content,
      score: memory.score,
      sourceReason: reason.join(' · '),
    }
  })
}

function dedupeSources(sources: RetrievalSource[]): RetrievalSource[] {
  const map = new Map<string, RetrievalSource>()
  for (const source of sources) {
    const key = source.chunkId ?? source.url ?? source.id
    const existing = map.get(key)
    if (!existing || (source.score ?? 0) > (existing.score ?? 0)) map.set(key, source)
  }
  return Array.from(map.values()).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
}

async function logRagEvaluationBestEffort(
  input: Parameters<typeof ragEvaluationRepository.log>[0],
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return
  try {
    await ragEvaluationRepository.log(input)
  } catch {
    // Evaluation telemetry is diagnostic only and must not fail Chat retrieval.
  }
}

async function logContextOperationBestEffort(
  input: Parameters<typeof logContextOperation>[0],
): Promise<void> {
  try {
    await logContextOperation(input)
  } catch {
    // Initialization failure fallback must not depend on health-log storage.
  }
}

function rethrowCancellation(error: unknown, signal?: AbortSignal): void {
  if (signal?.aborted || isCancellationError(error)) {
    throw createAbortError(signal?.reason ?? error)
  }
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError(signal.reason)
}

function isCancellationError(error: unknown): boolean {
  return error instanceof Error && /abort|cancel/i.test(error.name)
}

function createAbortError(reason?: unknown): Error {
  if (reason instanceof Error && reason.name === 'AbortError') return reason
  const error = new Error(
    reason instanceof Error ? reason.message : 'Conversation knowledge retrieval was cancelled.',
  )
  error.name = 'AbortError'
  return error
}
