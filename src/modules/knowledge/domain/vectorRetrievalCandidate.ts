import { knowledgeCosineSimilarity } from './localVectorIndex'
import {
  resolveKnowledgeSearchEmbedding,
  type KnowledgeEmbeddingRepairReason,
  type KnowledgeResolvedEmbedding,
} from './embeddingPersistencePolicy'

export interface KnowledgeVectorCandidateRow {
  content: string
  embeddingJson?: string
  source?: string
  model?: string
}

export interface KnowledgeVectorCandidateProjection {
  score: number
  vectorScore: number
  retrievalMode: 'vector'
}

export interface KnowledgeVectorCandidateDecision {
  repairRequired: boolean
  repairReason?: KnowledgeEmbeddingRepairReason
  candidate?: KnowledgeVectorCandidateProjection
}

export function resolveKnowledgeVectorCandidate(
  row: KnowledgeVectorCandidateRow,
  queryEmbedding: KnowledgeResolvedEmbedding,
): KnowledgeVectorCandidateDecision {
  const resolved = resolveKnowledgeSearchEmbedding(
    row.embeddingJson,
    queryEmbedding,
    row.content,
    row,
  )
  const vectorScore = resolved.embedding ? knowledgeCosineSimilarity(queryEmbedding.embedding, resolved.embedding) : 0
  return {
    repairRequired: resolved.repairRequired,
    ...(resolved.repairReason ? { repairReason: resolved.repairReason } : {}),
    ...(vectorScore > 0
      ? {
          candidate: {
            score: vectorScore,
            vectorScore,
            retrievalMode: 'vector' as const,
          },
        }
      : {}),
  }
}
