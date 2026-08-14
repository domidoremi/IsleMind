export const KNOWLEDGE_PROVIDER_EMBEDDING_JOB_LIMIT = 80

export interface KnowledgeProviderEmbeddingJobRecord {
  id: string
  chunkId: string
  status: 'running' | 'done' | 'error' | 'cancelled'
  source: 'provider'
  error: string | null
  updatedAt: number
}

export interface KnowledgeProviderEmbeddingResult {
  embedding: number[]
  source: 'provider'
  model: string
}

export interface KnowledgeProviderEmbeddingWriteRecord {
  chunkId: string
  embedding: number[]
  dimension: number
  source: 'provider'
  model: string
  updatedAt: number
  status: 'ready'
  error: null
}

export function selectKnowledgeProviderEmbeddingCandidates<T>(items: readonly T[]): T[] {
  return items.slice(0, KNOWLEDGE_PROVIDER_EMBEDDING_JOB_LIMIT)
}

export function createKnowledgeProviderEmbeddingRunningJob(
  chunkId: string,
  updatedAt: number,
): KnowledgeProviderEmbeddingJobRecord {
  return {
    id: providerEmbeddingJobId(chunkId),
    chunkId,
    status: 'running',
    source: 'provider',
    error: null,
    updatedAt,
  }
}

export function createKnowledgeProviderEmbeddingWrite(
  chunkId: string,
  result: KnowledgeProviderEmbeddingResult,
  updatedAt: number,
): KnowledgeProviderEmbeddingWriteRecord {
  return {
    chunkId,
    embedding: result.embedding,
    dimension: result.embedding.length,
    source: result.source,
    model: result.model,
    updatedAt,
    status: 'ready',
    error: null,
  }
}

export function createKnowledgeProviderEmbeddingDoneJob(
  chunkId: string,
  updatedAt: number,
): KnowledgeProviderEmbeddingJobRecord {
  return {
    id: providerEmbeddingJobId(chunkId),
    chunkId,
    status: 'done',
    source: 'provider',
    error: null,
    updatedAt,
  }
}

export function createKnowledgeProviderEmbeddingErrorJob(
  chunkId: string,
  error: unknown,
  updatedAt: number,
): KnowledgeProviderEmbeddingJobRecord {
  return {
    id: providerEmbeddingJobId(chunkId),
    chunkId,
    status: 'error',
    source: 'provider',
    error: error instanceof Error ? error.message : 'embedding failed',
    updatedAt,
  }
}

export function createKnowledgeProviderEmbeddingCancelledJob(
  chunkId: string,
  updatedAt: number,
): KnowledgeProviderEmbeddingJobRecord {
  return {
    id: providerEmbeddingJobId(chunkId),
    chunkId,
    status: 'cancelled',
    source: 'provider',
    error: 'cancelled',
    updatedAt,
  }
}

function providerEmbeddingJobId(chunkId: string): string {
  return `embed-${chunkId}`
}
