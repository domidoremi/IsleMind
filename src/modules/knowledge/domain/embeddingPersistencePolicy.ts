import {
  createLocalKnowledgeEmbedding,
  parseKnowledgeEmbedding,
} from './localVectorIndex'

export const KNOWLEDGE_LOCAL_HASH_MODEL_ID = 'local-hash-bow-v1'

/** Source and model identify a vector space; dimension alone never does. */
export interface KnowledgeEmbeddingIdentity {
  source: 'local' | 'onnx' | 'provider'
  model: string
}

export interface KnowledgeResolvedEmbedding extends KnowledgeEmbeddingIdentity {
  embedding: number[]
}

export interface KnowledgeEmbeddingWriteDecision {
  embedding: number[]
  source: 'local' | 'onnx'
  model: string
  status: 'ready' | 'fallback'
  error: string | null
  embeddingProvider: 'onnx' | 'hash'
}

export interface KnowledgeEmbeddingWriteDecisionInput {
  localEmbedding: number[]
  onnx?: {
    embedding: number[]
    model: string
  }
  onnxError?: string | null
}

export function resolveKnowledgeEmbeddingWrite(
  input: KnowledgeEmbeddingWriteDecisionInput,
): KnowledgeEmbeddingWriteDecision {
  if (input.onnx) {
    return {
      embedding: input.onnx.embedding,
      source: 'onnx',
      model: input.onnx.model,
      status: 'ready',
      error: null,
      embeddingProvider: 'onnx',
    }
  }
  return {
    embedding: input.localEmbedding,
    source: 'local',
    model: KNOWLEDGE_LOCAL_HASH_MODEL_ID,
    status: 'fallback',
    error: input.onnxError ?? null,
    embeddingProvider: 'hash',
  }
}

export type KnowledgeEmbeddingRepairReason = 'missing_or_malformed'

export interface KnowledgeSearchEmbeddingResolution {
  embedding?: number[]
  repairRequired: boolean
  repairReason?: KnowledgeEmbeddingRepairReason
}

export function resolveKnowledgeSearchEmbedding(
  rawEmbedding: string | undefined,
  query: KnowledgeResolvedEmbedding,
  content: string,
  identity: { source?: string; model?: string },
): KnowledgeSearchEmbeddingResolution {
  const persisted = parseKnowledgeEmbedding(rawEmbedding)
  const compatible = persisted && persisted.length === query.embedding.length
    && identity.source === query.source && identity.model === query.model
  return {
    // Offline hash comparisons use a transient projection, not a destructive
    // conversion of valid model vectors. Neural queries skip unknown spaces.
    embedding: compatible ? persisted
      : query.source === 'local' && query.model === KNOWLEDGE_LOCAL_HASH_MODEL_ID
        ? createLocalKnowledgeEmbedding(content) : undefined,
    repairRequired: !persisted,
    ...(!persisted ? { repairReason: 'missing_or_malformed' as const } : {}),
  }
}
