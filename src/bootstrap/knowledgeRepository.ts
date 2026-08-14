import {
  createKnowledgeQueryEmbeddingUseCase,
  createSqliteKnowledgeAgenticIndex,
  createSqliteKnowledgeColbertIndex,
  createSqliteKnowledgeHybridIndex,
  createSqliteKnowledgeRepository,
  type KnowledgeDocumentIndexPort,
  type KnowledgeRepositoryOperationOptions,
  type KnowledgeRepositorySnapshot,
} from '@/modules/knowledge'
import { createExpoSqliteDatabaseProvider, type SqliteDatabaseProvider } from '@/platform/storage'
import {
  getProviderCompatibilityEvidenceForProvider,
  providerCompatibilityCapabilityCanBeSentForProvider,
  resolveProviderCompatibilityCapabilityStatus,
} from '@/modules/providers'
import type { AIProvider } from '@/types/providerContracts'
import type { KnowledgeChunk } from '@/types/contextContracts'

export interface KnowledgeIndexingOptions {
  provider?: AIProvider
  embeddingMode?: 'provider' | 'local' | 'hybrid'
  localEmbeddingModelId?: string
  localEmbeddingModelSource?: 'bundled' | 'downloaded' | 'none'
  refreshAgenticIndex?: boolean
}

let activeDatabaseProvider = createExpoSqliteDatabaseProvider()
const databaseProvider: SqliteDatabaseProvider = {
  async get() {
    try {
      return await activeDatabaseProvider.get()
    } catch (error) {
      activeDatabaseProvider = createExpoSqliteDatabaseProvider()
      throw error
    }
  },
}

/** Canonical bootstrap binding for target-owned knowledge persistence. */
export const knowledgeRepository = createSqliteKnowledgeRepository(databaseProvider)

const knowledgeQueryEmbedding = createKnowledgeQueryEmbeddingUseCase<AIProvider>({
  async embedWithOnnx(input) {
    if (input.embeddingMode === 'provider') return null
    const { createOnnxEmbeddingProvider } = await import('./knowledgeEmbeddingProvider')
    const provider = await createOnnxEmbeddingProvider({
      ...(input.localEmbeddingModelId === undefined ? {} : { localEmbeddingModelId: input.localEmbeddingModelId }),
      ...(input.localEmbeddingModelSource === undefined ? {} : { localEmbeddingModelSource: input.localEmbeddingModelSource }),
    })
    if (!provider || !await provider.available()) return null
    return provider.embed(input.query)
  },
  async embedWithProvider(input) {
    const { embedProviderText } = await import('./providerRuntime')
    return (await embedProviderText(input.provider, input.query, { signal: input.signal })).embedding
  },
  async notifyProviderUnsupported(input) {
    const evidence = getProviderCompatibilityEvidenceForProvider(input.provider)
    const status = resolveProviderCompatibilityCapabilityStatus(evidence.id, 'embeddings')
    const { logContextOperation } = await import('@/services/runtimeHealthLog')
    await logContextOperation({
      phase: 'knowledge_embedding',
      status: 'skipped',
      detail: 'provider_embedding_unsupported_by_contract',
      reason: `${evidence.id}:embeddings_${status}`,
      sourceType: 'text',
      providerId: input.provider.id,
    })
  },
})

/** Target-owned local-vector persistence, hybrid retrieval, repair, and cache. */
export const knowledgeHybridIndex = createSqliteKnowledgeHybridIndex<AIProvider>(databaseProvider, {
  repository: knowledgeRepository,
  queryEmbedding: knowledgeQueryEmbedding,
  resolveProviderEmbeddingState(provider) {
    return {
      configured: Boolean(provider.apiKey?.trim()),
      supportsEmbeddings: providerCompatibilityCapabilityCanBeSentForProvider(
        provider,
        'embeddings',
        provider.capabilities?.embeddings === true,
      ),
    }
  },
  providerCacheKey: (provider) => provider.id,
  async resolveOnnxEmbeddingPort(input) {
    const { createOnnxEmbeddingProvider } = await import('./knowledgeEmbeddingProvider')
    const provider = await createOnnxEmbeddingProvider({
      ...(input.localEmbeddingModelId === undefined ? {} : { localEmbeddingModelId: input.localEmbeddingModelId }),
      ...(input.localEmbeddingModelSource === undefined ? {} : { localEmbeddingModelSource: input.localEmbeddingModelSource }),
    })
    if (!provider || !await provider.available()) return undefined
    return {
      model: input.localEmbeddingModelId ?? 'onnx-local',
      embed: (text) => provider.embed(text),
    }
  },
  async embedWithProvider(input) {
    const { embedProviderText } = await import('./providerRuntime')
    return embedProviderText(input.provider, input.text, { signal: input.signal })
  },
  async notifyProviderEmbeddingUnsupported(input) {
    const evidence = getProviderCompatibilityEvidenceForProvider(input.provider)
    const status = resolveProviderCompatibilityCapabilityStatus(evidence.id, 'embeddings')
    const { logContextOperation } = await import('@/services/runtimeHealthLog')
    await logContextOperation({
      phase: 'knowledge_embedding',
      status: 'skipped',
      detail: 'provider_embedding_unsupported_by_contract',
      reason: `${evidence.id}:embeddings_${status}`,
      sourceType: 'text',
      providerId: input.provider.id,
    })
  },
})

export const knowledgeColbertIndex = createSqliteKnowledgeColbertIndex(databaseProvider, {
  repository: knowledgeRepository,
})
export const knowledgeAgenticIndex = createSqliteKnowledgeAgenticIndex(databaseProvider, {
  repository: knowledgeRepository,
})

/** Composition-root binding for target vector and agentic indexes. */
export function createKnowledgeDocumentIndex(indexing: KnowledgeIndexingOptions = {}): KnowledgeDocumentIndexPort {
  return {
    async synchronize(document, chunks, operation) {
      await knowledgeHybridIndex.synchronizeEmbeddings(chunks, { ...indexing, signal: operation.signal })
      if (indexing.refreshAgenticIndex !== false) {
        await knowledgeColbertIndex.synchronize(chunks, { signal: operation.signal })
        await knowledgeAgenticIndex.synchronize(chunks, { signal: operation.signal })
      }
      await launchProviderEmbeddingUpgrade(chunks, indexing, operation.signal)
    },
  }
}

export async function synchronizeKnowledgeChunkIndexes(
  chunks: Parameters<typeof knowledgeHybridIndex.synchronizeEmbeddings>[0],
  indexing: KnowledgeIndexingOptions = {},
  signal = new AbortController().signal,
): Promise<void> {
  await knowledgeHybridIndex.synchronizeEmbeddings(chunks, { ...indexing, signal })
  if (indexing.refreshAgenticIndex !== false) {
    await knowledgeColbertIndex.synchronize(chunks, { signal })
    await knowledgeAgenticIndex.synchronize(chunks, { signal })
  }
  await launchProviderEmbeddingUpgrade(chunks, indexing, signal)
}

async function launchProviderEmbeddingUpgrade(
  chunks: Parameters<typeof knowledgeHybridIndex.upgradeProviderEmbeddings>[0],
  indexing: KnowledgeIndexingOptions,
  signal: AbortSignal,
): Promise<void> {
  if (!indexing.provider || indexing.embeddingMode === 'local') return
  const request = knowledgeHybridIndex.upgradeProviderEmbeddings(chunks, {
    provider: indexing.provider,
    signal,
  })
  const state = {
    configured: Boolean(indexing.provider.apiKey?.trim()),
    supportsEmbeddings: providerCompatibilityCapabilityCanBeSentForProvider(
      indexing.provider,
      'embeddings',
      indexing.provider.capabilities?.embeddings === true,
    ),
  }
  if (state.configured && !state.supportsEmbeddings) {
    await request
    return
  }
  void request.catch(() => undefined)
}

export async function rebuildKnowledgeEmbeddings(indexing: KnowledgeIndexingOptions = {}): Promise<number> {
  const chunks = await knowledgeRepository.listChunks()
  await synchronizeKnowledgeChunkIndexes(chunks, { ...indexing, refreshAgenticIndex: false })
  return chunks.length
}

export async function clearKnowledgeIndexCaches(): Promise<void> {
  await knowledgeHybridIndex.clearCache()
}

export async function deleteKnowledgeDocumentIndexes(documentId: string): Promise<void> {
  await knowledgeHybridIndex.deleteDocumentEmbeddings(documentId)
  await knowledgeColbertIndex.deleteDocument(documentId)
  await knowledgeAgenticIndex.deleteDocument(documentId)
}

export async function deleteKnowledgeDocumentRecords(documentId: string): Promise<void> {
  await deleteKnowledgeDocumentIndexes(documentId)
  await knowledgeRepository.deleteDocument(documentId)
}

export async function clearKnowledgeIndexes(): Promise<void> {
  await knowledgeHybridIndex.clearEmbeddings()
  await knowledgeColbertIndex.clear()
  await knowledgeAgenticIndex.clear()
}

export async function clearKnowledgeRecords(): Promise<void> {
  await clearKnowledgeIndexes()
  await knowledgeRepository.clearDocuments()
}

/** Replaces portable context records, then rebuilds every target-owned knowledge index. */
export async function replaceKnowledgeContextSnapshot(
  snapshot: KnowledgeRepositorySnapshot,
  operation: KnowledgeRepositoryOperationOptions = {},
): Promise<void> {
  throwIfAborted(operation.signal)
  try {
    await clearKnowledgeIndexes()
    throwIfAborted(operation.signal)
    await knowledgeRepository.replaceSnapshot(snapshot, operation)
    throwIfAborted(operation.signal)
    await synchronizeKnowledgeChunkIndexes(snapshot.chunks, {}, operation.signal)
    throwIfAborted(operation.signal)
  } catch (error) {
    try {
      // Recovery must finish even when the caller cancelled the interrupted import.
      const recoverySignal = new AbortController().signal
      await clearKnowledgeIndexes()
      const durableChunks = await knowledgeRepository.listChunks(undefined, { signal: recoverySignal })
      await synchronizeKnowledgeChunkIndexes(durableChunks, {}, recoverySignal)
    } catch (recoveryError) {
      throw new AggregateError(
        [error, recoveryError],
        'Portable knowledge snapshot replacement and derived-index recovery both failed.',
      )
    }
    throw error
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('Knowledge snapshot replacement was cancelled.')
  error.name = 'AbortError'
  throw error
}
