import { knowledgeCosineSimilarity } from './localVectorIndex'
import {
  resolveKnowledgeSearchEmbedding,
  type KnowledgeEmbeddingRepairReason,
} from './embeddingPersistencePolicy'

export interface KnowledgeVectorCandidateRow {
  content: string
  embeddingJson?: string
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
  queryEmbedding: number[],
): KnowledgeVectorCandidateDecision {
  const resolved = resolveKnowledgeSearchEmbedding(
    row.embeddingJson,
    queryEmbedding.length,
    row.content,
  )
  const vectorScore = knowledgeCosineSimilarity(queryEmbedding, resolved.embedding)
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
