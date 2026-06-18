import type { AIProvider, RagQueryPlan, RagTechnique, RetrievalSource } from '@/types'
import { searchKnowledge } from '@/services/contextStore'
import { localDataStore, type SearchHybridOptions } from '@/services/localDataStore'
import { filterKnowledgeSources, type KnowledgeScope } from '@/services/knowledgeScope'
import { logContextOperation } from '@/services/runtimeHealthLog'

type KnowledgeSearchRuntime = Pick<SearchHybridOptions, 'localEmbeddingModelId' | 'localEmbeddingModelSource' | 'provider'> & {
  mode: 'hybrid'
  embeddingMode: 'provider' | 'local' | 'hybrid'
}

export interface SearchKnowledgeWithFallbackInput {
  query: string
  limit: number
  ragMode: 'fts' | 'hybrid'
  embeddingMode: 'provider' | 'local' | 'hybrid'
  localEmbeddingModelId?: SearchHybridOptions['localEmbeddingModelId']
  localEmbeddingModelSource?: SearchHybridOptions['localEmbeddingModelSource']
  provider?: AIProvider
  knowledgeScope?: KnowledgeScope
}

export interface SearchAgenticKnowledgeWithScopeInput {
  query: string
  limit: number
  knowledgeScope?: KnowledgeScope
  plan?: Pick<RagQueryPlan, 'enabledTechniques' | 'query'>
  techniques?: RagTechnique[]
}

export async function searchKnowledgeWithFallback(input: SearchKnowledgeWithFallbackInput): Promise<RetrievalSource[]> {
  const scopedLimit = resolveScopedKnowledgeLimit(input.limit, input.knowledgeScope)
  try {
    const results = input.ragMode === 'hybrid'
      ? await localDataStore.searchHybrid(input.query, {
          limit: scopedLimit,
          ...resolveKnowledgeSearchRuntime(input),
        })
      : await searchKnowledge(input.query, scopedLimit)
    return filterKnowledgeSources(results, input.knowledgeScope).slice(0, input.limit)
  } catch (error) {
    await logContextOperation({
      phase: 'knowledge_retrieval',
      status: 'error',
      detail: input.ragMode === 'hybrid' ? 'hybrid_search_failed' : 'fts_search_failed',
      reason: 'fallback_attempt',
      sourceType: 'text',
      error,
    })
    try {
      const fallback = filterKnowledgeSources(await searchKnowledge(input.query, scopedLimit), input.knowledgeScope).slice(0, input.limit)
      await logContextOperation({
        phase: 'knowledge_retrieval',
        status: 'done',
        detail: 'fts_fallback_applied',
        reason: input.ragMode === 'hybrid' ? 'hybrid_search_failed' : 'primary_search_failed',
        sourceType: 'text',
      })
      return fallback
    } catch (fallbackError) {
      await logContextOperation({
        phase: 'knowledge_retrieval',
        status: 'error',
        detail: 'fts_fallback_failed',
        reason: 'empty_result_fallback',
        sourceType: 'text',
        error: fallbackError,
      })
      return []
    }
  }
}

export async function searchAgenticKnowledgeWithScope(input: SearchAgenticKnowledgeWithScopeInput): Promise<RetrievalSource[]> {
  try {
    const sources = await localDataStore.searchAgenticIndexes(input.query, {
      limit: input.limit,
      ...(input.plan ? { plan: input.plan } : {}),
      ...(input.techniques ? { techniques: input.techniques } : {}),
    })
    return filterKnowledgeSources(sources, input.knowledgeScope).slice(0, input.limit)
  } catch (error) {
    await logContextOperation({
      phase: 'knowledge_retrieval',
      status: 'error',
      detail: 'agentic_search_failed',
      reason: 'empty_result_fallback',
      sourceType: 'text',
      error,
    })
    return []
  }
}

function resolveScopedKnowledgeLimit(limit: number, knowledgeScope?: KnowledgeScope): number {
  return knowledgeScope ? Math.max(limit * 4, 20) : limit
}

function resolveKnowledgeSearchRuntime(input: SearchKnowledgeWithFallbackInput): KnowledgeSearchRuntime {
  return {
    mode: 'hybrid',
    embeddingMode: input.embeddingMode,
    localEmbeddingModelId: input.localEmbeddingModelId,
    localEmbeddingModelSource: input.localEmbeddingModelSource,
    ...(input.provider ? { provider: input.provider } : {}),
  }
}
