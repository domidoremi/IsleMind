import {
  createLocalKnowledgeEmbedding,
  parseKnowledgeEmbedding,
} from './localVectorIndex'

export const KNOWLEDGE_LOCAL_HASH_MODEL_ID = 'local-hash-bow-v1'

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

export type KnowledgeEmbeddingRepairReason = 'missing_or_malformed' | 'dimension_mismatch'

export interface KnowledgeSearchEmbeddingResolution {
  embedding: number[]
  repairRequired: boolean
  repairReason?: KnowledgeEmbeddingRepairReason
}

export function resolveKnowledgeSearchEmbedding(
  rawEmbedding: string | undefined,
  expectedDimension: number,
  content: string,
): KnowledgeSearchEmbeddingResolution {
  const persisted = parseKnowledgeEmbedding(rawEmbedding)
  if (!persisted) {
    return {
      embedding: createLocalKnowledgeEmbedding(content),
      repairRequired: true,
      repairReason: 'missing_or_malformed',
    }
  }
  if (persisted.length !== expectedDimension) {
    return {
      embedding: createLocalKnowledgeEmbedding(content),
      repairRequired: true,
      repairReason: 'dimension_mismatch',
    }
  }
  return {
    embedding: persisted,
    repairRequired: false,
  }
}
