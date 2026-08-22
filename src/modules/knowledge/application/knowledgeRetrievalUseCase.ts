import {
  filterKnowledgeSources,
  type KnowledgeScope,
  type KnowledgeScopedSource,
} from '../domain/knowledgeScope'

export type KnowledgeRagMode = 'fts' | 'hybrid'
export type KnowledgeEmbeddingMode = 'provider' | 'local' | 'hybrid'

export interface KnowledgeHybridSearchRequest<Provider = unknown> {
  query: string
  limit: number
  embeddingMode: KnowledgeEmbeddingMode
  signal?: AbortSignal
  localEmbeddingModelId?: string
  localEmbeddingModelSource?: 'bundled' | 'downloaded' | 'none'
  provider?: Provider
}

export interface KnowledgeSearchWithFallbackInput<Provider = unknown> {
  query: string
  limit: number
  ragMode: KnowledgeRagMode
  embeddingMode: KnowledgeEmbeddingMode
  localEmbeddingModelId?: string
  localEmbeddingModelSource?: 'bundled' | 'downloaded' | 'none'
  provider?: Provider
  knowledgeScope?: KnowledgeScope
  signal?: AbortSignal
}

export interface KnowledgeAgenticSearchInput<Plan = unknown, Technique = unknown> {
  query: string
  limit: number
  knowledgeScope?: KnowledgeScope
  plan?: Plan
  techniques?: readonly Technique[]
  signal?: AbortSignal
}

export interface KnowledgeAgenticSearchRequest<Plan = unknown, Technique = unknown> {
  query: string
  limit: number
  plan?: Plan
  techniques?: readonly Technique[]
  signal?: AbortSignal
}

/**
 * Boundary for vector, hybrid, and agentic index strategies. The target use
 * case owns fallback and scope policy; concrete index implementations are
 * bound only at bootstrap.
 */
export interface KnowledgeIndexedSearchPort<
  Source,
  Provider = unknown,
  Plan = unknown,
  Technique = unknown,
> {
  searchHybrid(input: KnowledgeHybridSearchRequest<Provider>): Promise<readonly Source[]>
  searchAgentic(input: KnowledgeAgenticSearchRequest<Plan, Technique>): Promise<readonly Source[]>
}

export interface KnowledgeRetrievalDiagnosticEvent {
  status: 'done' | 'error'
  detail: 'hybrid_search_failed' | 'fts_search_failed' | 'fts_fallback_applied' | 'fts_fallback_failed' | 'agentic_search_failed'
  reason: 'fallback_attempt' | 'hybrid_search_failed' | 'primary_search_failed' | 'empty_result_fallback'
  error?: unknown
}

export interface KnowledgeRetrievalUseCaseDependencies<
  Source extends KnowledgeScopedSource,
  Provider = unknown,
  Plan = unknown,
  Technique = unknown,
> {
  searchFts(query: string, limit: number, options?: { signal?: AbortSignal }): Promise<readonly Source[]>
  indexedSearch: KnowledgeIndexedSearchPort<Source, Provider, Plan, Technique>
  report?(event: KnowledgeRetrievalDiagnosticEvent): void | Promise<void>
}

export interface KnowledgeRetrievalUseCase<
  Source extends KnowledgeScopedSource,
  Provider = unknown,
  Plan = unknown,
  Technique = unknown,
> {
  searchWithFallback(input: KnowledgeSearchWithFallbackInput<Provider>): Promise<Source[]>
  searchAgentic(input: KnowledgeAgenticSearchInput<Plan, Technique>): Promise<Source[]>
}

/**
 * Owns the provider-independent retrieval fallback and source-scope policy.
 * Storage, embedding, and diagnostics implementations are supplied as ports.
 */
export function createKnowledgeRetrievalUseCase<
  Source extends KnowledgeScopedSource,
  Provider = unknown,
  Plan = unknown,
  Technique = unknown,
>(
  dependencies: KnowledgeRetrievalUseCaseDependencies<Source, Provider, Plan, Technique>,
): KnowledgeRetrievalUseCase<Source, Provider, Plan, Technique> {
  return {
    async searchWithFallback(input) {
      throwIfAborted(input.signal)
      const scopedLimit = resolveScopedKnowledgeLimit(input.limit, input.knowledgeScope)
      try {
        const results = input.ragMode === 'hybrid'
          ? await dependencies.indexedSearch.searchHybrid({
              query: input.query,
              limit: scopedLimit,
              embeddingMode: input.embeddingMode,
              ...(input.localEmbeddingModelId === undefined ? {} : { localEmbeddingModelId: input.localEmbeddingModelId }),
              ...(input.localEmbeddingModelSource === undefined ? {} : { localEmbeddingModelSource: input.localEmbeddingModelSource }),
              ...(input.provider ? { provider: input.provider } : {}),
              ...(input.signal === undefined ? {} : { signal: input.signal }),
            })
          : await dependencies.searchFts(input.query, scopedLimit, { signal: input.signal })
        throwIfAborted(input.signal)
        return filterKnowledgeSources(results, input.knowledgeScope).slice(0, input.limit)
      } catch (error) {
        throwIfAborted(input.signal)
        const primaryFailure = input.ragMode === 'hybrid' ? 'hybrid_search_failed' : 'fts_search_failed'
        await reportBestEffort(dependencies.report, {
          status: 'error',
          detail: primaryFailure,
          reason: 'fallback_attempt',
          error,
        })
        try {
          const fallback = await dependencies.searchFts(input.query, scopedLimit, { signal: input.signal })
          throwIfAborted(input.signal)
          await reportBestEffort(dependencies.report, {
            status: 'done',
            detail: 'fts_fallback_applied',
            reason: input.ragMode === 'hybrid' ? 'hybrid_search_failed' : 'primary_search_failed',
          })
          return filterKnowledgeSources(fallback, input.knowledgeScope).slice(0, input.limit)
        } catch (fallbackError) {
          throwIfAborted(input.signal)
          await reportBestEffort(dependencies.report, {
            status: 'error',
            detail: 'fts_fallback_failed',
            reason: 'empty_result_fallback',
            error: fallbackError,
          })
          return []
        }
      }
    },

    async searchAgentic(input) {
      throwIfAborted(input.signal)
      try {
        const sources = await dependencies.indexedSearch.searchAgentic({
          query: input.query,
          limit: input.limit,
          ...(input.plan === undefined ? {} : { plan: input.plan }),
          ...(input.techniques ? { techniques: input.techniques } : {}),
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        })
        throwIfAborted(input.signal)
        return filterKnowledgeSources(sources, input.knowledgeScope).slice(0, input.limit)
      } catch (error) {
        throwIfAborted(input.signal)
        await reportBestEffort(dependencies.report, {
          status: 'error',
          detail: 'agentic_search_failed',
          reason: 'empty_result_fallback',
          error,
        })
        return []
      }
    },
  }
}

async function reportBestEffort(
  report: KnowledgeRetrievalUseCaseDependencies<KnowledgeScopedSource>['report'],
  event: KnowledgeRetrievalDiagnosticEvent,
): Promise<void> {
  if (!report) return
  try {
    await report(event)
  } catch {
    // Diagnostics must not change retrieval or suppress its fallback path.
  }
}

function resolveScopedKnowledgeLimit(limit: number, scope?: KnowledgeScope): number {
  return scope ? Math.max(limit * 4, 20) : limit
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  const error = new Error('Knowledge retrieval was cancelled.')
  error.name = 'AbortError'
  throw error
}
