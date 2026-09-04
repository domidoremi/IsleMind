import {
  createIndexedKnowledgeSearchAdapter,
  createKnowledgeRetrievalUseCase,
  rerankKnowledgeSources,
  type IndexedKnowledgeSearchDriver,
  type KnowledgeAgenticSearchInput,
  type KnowledgeHybridSearchHit,
  type KnowledgeSearchWithFallbackInput,
} from '@/modules/knowledge'
import { logContextOperation } from '@/services/runtimeHealthLog'
import type { RagQueryPlan, RagTechnique, RetrievalSource } from '@/types/contextContracts'
import type { AIProvider } from '@/types/providerContracts'
import { knowledgeAgenticIndex, knowledgeColbertIndex, knowledgeHybridIndex, knowledgeRepository } from './knowledgeRepository'

export type SearchKnowledgeWithFallbackInput = KnowledgeSearchWithFallbackInput<AIProvider>
export type SearchAgenticKnowledgeWithScopeInput = KnowledgeAgenticSearchInput<
  Pick<RagQueryPlan, 'enabledTechniques' | 'query'>,
  RagTechnique
>

const knowledgeRetrieval = createKnowledgeRetrievalUseCase<
  RetrievalSource,
  AIProvider,
  Pick<RagQueryPlan, 'enabledTechniques' | 'query'>,
  RagTechnique
>({
  searchFts: searchKnowledgeFts,
  indexedSearch: createIndexedKnowledgeSearchAdapter({
    loadDriver: loadIndexedKnowledgeSearchDriver,
  }),
  async report(event) {
    await logContextOperation({
      phase: 'knowledge_retrieval',
      status: event.status,
      detail: event.detail,
      reason: event.reason,
      sourceType: 'text',
      ...(event.error === undefined ? {} : { error: event.error }),
    })
  },
})

/** Canonical bootstrap binding for the target-owned FTS read path. */
export async function searchKnowledgeFts(
  query: string,
  limit: number,
  options?: { signal?: AbortSignal },
): Promise<RetrievalSource[]> {
  const ftsCandidates = await knowledgeRepository.searchFts({ query, limit, signal: options?.signal })
  const candidates: RetrievalSource[] = ftsCandidates.map((candidate) => ({
    id: candidate.id,
    type: 'knowledge',
    title: candidate.title,
    content: candidate.content,
    excerpt: candidate.content.slice(0, 180),
    documentId: candidate.documentId,
    chunkId: candidate.id,
    chunkIndex: candidate.chunkIndex ?? candidate.ordinal,
    score: candidate.score,
    ftsScore: candidate.score,
    sourceUri: candidate.sourceUri ?? candidate.rawPath,
  }))
  const reranked = rerankKnowledgeSources(query, candidates, limit)
  await knowledgeRepository.markFtsHits(
    reranked.flatMap((source) => source.chunkId ? [source.chunkId] : []),
    { signal: options?.signal },
  )
  return reranked
}

type AppIndexedKnowledgeSearchDriver = IndexedKnowledgeSearchDriver<
  RetrievalSource,
  AIProvider,
  Pick<RagQueryPlan, 'enabledTechniques' | 'query'>,
  RagTechnique
>

let indexedKnowledgeSearchDriver: Promise<AppIndexedKnowledgeSearchDriver> | undefined

async function loadIndexedKnowledgeSearchDriver(): Promise<AppIndexedKnowledgeSearchDriver> {
  indexedKnowledgeSearchDriver ??= Promise.resolve({
    async searchHybrid(query, options) {
      const hits = await knowledgeHybridIndex.searchHybrid({
        query,
        limit: options.limit,
        embeddingMode: options.embeddingMode,
        ...(options.localEmbeddingModelId === undefined ? {} : { localEmbeddingModelId: options.localEmbeddingModelId }),
        ...(options.localEmbeddingModelSource === undefined ? {} : { localEmbeddingModelSource: options.localEmbeddingModelSource }),
        ...(options.provider === undefined ? {} : { provider: options.provider }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        ...(options.onEmbeddingResolved === undefined ? {} : { onEmbeddingResolved: options.onEmbeddingResolved }),
      })
      return hits.map(hybridHitToRetrievalSource)
    },
    async searchAgenticIndexes(query, options) {
      const techniques = new Set(options.techniques ?? options.plan?.enabledTechniques ?? [])
      const [colbert, agentic] = await Promise.all([
        techniques.has('colbert')
          ? knowledgeColbertIndex.search({ query, limit: options.limit, signal: options.signal })
          : Promise.resolve([]),
        knowledgeAgenticIndex.search({
          query,
          limit: options.limit,
          techniques: [...techniques].filter((technique): technique is 'raptor' | 'graphrag' => technique === 'raptor' || technique === 'graphrag'),
          signal: options.signal,
          onEmbeddingResolved: options.onEmbeddingResolved,
        }),
      ])
      return rerankKnowledgeSources(query, [
        ...colbert.map((hit) => ({ ...hit, sourceUri: hit.sourceUri ?? hit.rawPath })),
        ...agentic.map((hit): RetrievalSource => ({
          id: hit.id,
          type: 'knowledge',
          title: hit.title,
          content: hit.content,
          excerpt: hit.excerpt,
          documentId: hit.documentId,
          ...(hit.chunkId === undefined ? {} : { chunkId: hit.chunkId }),
          ...(hit.chunkIndex === undefined ? {} : { chunkIndex: hit.chunkIndex }),
          ...(hit.semanticBoundary === undefined ? {} : { semanticBoundary: hit.semanticBoundary }),
          ...(hit.headingPath === undefined ? {} : { headingPath: [...hit.headingPath] }),
          ...(hit.qualityScore === undefined ? {} : { qualityScore: hit.qualityScore }),
          ...(hit.createdAt === undefined ? {} : { createdAt: hit.createdAt }),
          score: hit.score,
          ...(hit.similarityScore === undefined ? {} : { similarityScore: hit.similarityScore }),
          ...(hit.vectorScore === undefined ? {} : { vectorScore: hit.vectorScore }),
          retrievalMode: hit.retrievalMode,
          ...(hit.retrievalStage === undefined ? {} : { retrievalStage: hit.retrievalStage }),
          sourceReason: hit.sourceReason,
          sourceUri: hit.sourceUri ?? hit.rawPath,
        })),
      ], options.limit)
    },
  })
  return indexedKnowledgeSearchDriver
}

function hybridHitToRetrievalSource(hit: KnowledgeHybridSearchHit): RetrievalSource {
  return {
    id: hit.id,
    type: 'knowledge',
    title: hit.title,
    content: hit.content,
    excerpt: hit.content.slice(0, 180),
    documentId: hit.documentId,
    chunkId: hit.id,
    chunkIndex: hit.chunkIndex ?? hit.ordinal,
    score: hit.score,
    similarityScore: hit.similarityScore,
    ftsScore: hit.ftsScore,
    vectorScore: hit.vectorScore,
    retrievalMode: hit.retrievalMode,
    sourceUri: hit.sourceUri ?? hit.rawPath,
  }
}

export async function searchKnowledgeWithFallback(input: SearchKnowledgeWithFallbackInput): Promise<RetrievalSource[]> {
  return knowledgeRetrieval.searchWithFallback(input)
}

export async function searchAgenticKnowledgeWithScope(input: SearchAgenticKnowledgeWithScopeInput): Promise<RetrievalSource[]> {
  return knowledgeRetrieval.searchAgentic(input)
}
