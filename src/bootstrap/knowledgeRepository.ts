import {
  assertKnowledgeDocumentUnchanged,
  assertKnowledgeChunkSourcesUnchanged,
  snapshotKnowledgeChunk,
  createKnowledgeQueryEmbeddingUseCase,
  createSqliteKnowledgeAgenticIndex,
  createSqliteKnowledgeColbertIndex,
  createSqliteKnowledgeHybridIndex,
  createSqliteKnowledgeRepository,
  snapshotKnowledgeMutationOptions,
  type KnowledgeDocumentIndexPort,
  type KnowledgeDocumentMutationOptions,
  type KnowledgeDocumentClearOptions,
  type KnowledgeRepositoryOperationOptions,
  type KnowledgeRepositorySnapshot,
} from '@/modules/knowledge'
import { createExpoSqliteDatabaseProvider, type SqliteDatabaseProvider } from '@/platform/storage'
import {
  getProviderCompatibilityEvidenceForProvider,
  providerCompatibilityCapabilityCanBeSentForProvider,
  resolveProviderCompatibilityCapabilityStatus,
  snapshotProviderConfiguration,
} from '@/modules/providers'
import type { AIProvider } from '@/types/providerContracts'
import type { KnowledgeChunk } from '@/types/contextContracts'
import { sha256Hex } from '@/core'

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
    if (!provider || !await provider.available({ signal: input.signal })) return null
    const embedding = await provider.embed(input.query, { signal: input.signal })
    return { embedding, model: provider.model! }
  },
  async embedWithProvider(input) {
    const { embedProviderText } = await import('./providerRuntime')
    const result = await embedProviderText(input.provider, input.query, { signal: input.signal })
    return { ...result, model: providerVectorSpace(input.provider, result.model) }
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
  // A profile id alone cannot identify mutable routes/models/credentials.
  // Leave provider-backed queries uncached until a non-secret config revision exists.
  async resolveOnnxEmbeddingPort(input) {
    const { createOnnxEmbeddingProvider } = await import('./knowledgeEmbeddingProvider')
    const provider = await createOnnxEmbeddingProvider({
      ...(input.localEmbeddingModelId === undefined ? {} : { localEmbeddingModelId: input.localEmbeddingModelId }),
      ...(input.localEmbeddingModelSource === undefined ? {} : { localEmbeddingModelSource: input.localEmbeddingModelSource }),
    })
    if (!provider || !await provider.available({ signal: input.signal })) return undefined
    // Catalogue fallback remains useful for read-only queries. An explicit
    // reindex must not replace valid vectors with an unrequested fallback
    // model when the selected model is missing or fails integrity verification.
    if (input.localEmbeddingModelId && !provider.model?.startsWith(`${input.localEmbeddingModelId}@`)) return undefined
    return {
      model: provider.model!,
      embed: (text, options) => provider.embed(text, options),
    }
  },
  async embedWithProvider(input) {
    const { embedProviderText } = await import('./providerRuntime')
    const result = await embedProviderText(input.provider, input.text, { signal: input.signal })
    return { ...result, model: providerVectorSpace(input.provider, result.model) }
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

function providerVectorSpace(provider: AIProvider, model: string): string {
  // Namespace ambiguous model aliases by profile and route without persisting
  // endpoint strings (which may contain credentials). No API keys are hashed.
  return `provider-space-v1:${sha256Hex(JSON.stringify([provider.id, provider.type, provider.baseUrl ?? '', model]))}`
}

export const knowledgeColbertIndex = createSqliteKnowledgeColbertIndex(databaseProvider, {
  repository: knowledgeRepository,
})
export const knowledgeAgenticIndex = createSqliteKnowledgeAgenticIndex(databaseProvider, {
  repository: knowledgeRepository,
})

/** Composition-root binding for target vector and agentic indexes. */
export function createKnowledgeDocumentIndex(
  indexing: KnowledgeIndexingOptions = {},
  observeProviderUpgrade?: (settlement: Promise<void>) => void,
): KnowledgeDocumentIndexPort {
  indexing = snapshotProviderConfiguration(indexing)
  return {
    async synchronize(document, chunks, operation) {
      const { signal } = operation
      chunks = chunks.map(snapshotKnowledgeChunk)
      throwIfAborted(signal)
      await knowledgeHybridIndex.synchronizeEmbeddings(chunks, { ...indexing, signal })
      throwIfAborted(signal)
      if (indexing.refreshAgenticIndex !== false) {
        await knowledgeColbertIndex.synchronize(chunks, { signal })
        throwIfAborted(signal)
        await knowledgeAgenticIndex.synchronize(chunks, { signal })
        throwIfAborted(signal)
      }
      await launchProviderEmbeddingUpgrade(chunks, indexing, signal, observeProviderUpgrade)
    },
  }
}

export async function synchronizeKnowledgeChunkIndexes(
  chunks: Parameters<typeof knowledgeHybridIndex.synchronizeEmbeddings>[0],
  indexing: KnowledgeIndexingOptions = {},
  signal = new AbortController().signal,
  observeProviderUpgrade?: (settlement: Promise<void>) => void,
): Promise<void> {
  indexing = snapshotProviderConfiguration(indexing)
  chunks = snapshotProviderConfiguration(chunks)
  throwIfAborted(signal)
  await knowledgeHybridIndex.synchronizeEmbeddings(chunks, { ...indexing, signal })
  throwIfAborted(signal)
  if (indexing.refreshAgenticIndex !== false) {
    await knowledgeColbertIndex.synchronize(chunks, { signal })
    throwIfAborted(signal)
    await knowledgeAgenticIndex.synchronize(chunks, { signal })
    throwIfAborted(signal)
  }
  await launchProviderEmbeddingUpgrade(chunks, indexing, signal, observeProviderUpgrade)
}

async function launchProviderEmbeddingUpgrade(
  chunks: Parameters<typeof knowledgeHybridIndex.upgradeProviderEmbeddings>[0],
  indexing: KnowledgeIndexingOptions,
  signal: AbortSignal,
  observeSettlement?: (settlement: Promise<void>) => void,
): Promise<void> {
  throwIfAborted(signal)
  if (!indexing.provider || indexing.embeddingMode === 'local') return
  const request = knowledgeHybridIndex.upgradeProviderEmbeddings(chunks, {
    provider: indexing.provider,
    signal,
  })
  observeSettlement?.(request.then(() => undefined, () => undefined))
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

export async function rebuildKnowledgeEmbeddings(
  indexing: KnowledgeIndexingOptions = {},
  operation: KnowledgeDocumentClearOptions = {},
): Promise<number> {
  operation = snapshotKnowledgeMutationOptions(operation)
  indexing = snapshotProviderConfiguration(indexing)
  const signal = operation.signal ?? new AbortController().signal
  throwIfAborted(signal)
  const initial = await knowledgeRepository.loadSnapshot({ signal })
  throwIfAborted(signal)
  const documents = (operation.expectedDocuments ?? initial.documents).map(document => ({ ...document }))
  for (const document of documents) {
    assertKnowledgeDocumentUnchanged(initial.documents.find(item => item.id === document.id), document)
  }
  const ids = new Set(documents.map(document => document.id))
  const chunks = initial.chunks.filter(chunk => ids.has(chunk.documentId)).map(snapshotKnowledgeChunk)
  const upgrades: Promise<void>[] = []
  try {
    // Explicit recovery owns the full local index and upgrade settlement.
    await synchronizeKnowledgeChunkIndexes(chunks, { ...indexing, refreshAgenticIndex: true }, signal,
      settlement => upgrades.push(settlement))
    await Promise.all(upgrades)
    throwIfAborted(signal)
    const current = await knowledgeRepository.loadSnapshot({ signal })
    throwIfAborted(signal)
    for (const document of documents) {
      assertKnowledgeDocumentUnchanged(current.documents.find(item => item.id === document.id), document)
    }
    assertKnowledgeChunkSourcesUnchanged(current.chunks.filter(chunk => ids.has(chunk.documentId)), chunks)
    for (const document of documents) {
      const documentChunks = chunks.filter(chunk => chunk.documentId === document.id)
      if (document.status === 'ready' || document.chunkCount <= 0 || documentChunks.length !== document.chunkCount) continue
      throwIfAborted(signal)
      await knowledgeRepository.updateDocumentStatus(document.id, 'ready', undefined, {
        signal, expectedDocument: document, expectedChunks: documentChunks,
      })
    }
    throwIfAborted(signal)
    return chunks.length
  } catch (error) {
    await Promise.all(upgrades)
    try {
      // Repair only the affected scope from durable source, never an old snapshot or a provider.
      const recoverySignal = new AbortController().signal
      for (const id of ids) await deleteKnowledgeDocumentIndexes(id, { signal: recoverySignal })
      const current = await knowledgeRepository.loadSnapshot({ signal: recoverySignal })
      await synchronizeKnowledgeChunkIndexes(current.chunks.filter(chunk => ids.has(chunk.documentId)), {}, recoverySignal)
    } catch (recoveryError) {
      throw new AggregateError([error, recoveryError], 'Knowledge rebuild and derived-index recovery both failed.')
    }
    throw error
  }
}

export async function clearKnowledgeIndexCaches(operation: KnowledgeRepositoryOperationOptions = {}): Promise<void> {
  operation = { ...operation }
  throwIfAborted(operation.signal)
  await knowledgeHybridIndex.clearCache(operation)
  throwIfAborted(operation.signal)
}

export async function deleteKnowledgeDocumentIndexes(
  documentId: string,
  operation: KnowledgeRepositoryOperationOptions = {},
): Promise<void> {
  operation = { ...operation }
  throwIfAborted(operation.signal)
  await knowledgeHybridIndex.deleteDocumentEmbeddings(documentId, operation)
  throwIfAborted(operation.signal)
  await knowledgeColbertIndex.deleteDocument(documentId, operation)
  throwIfAborted(operation.signal)
  await knowledgeAgenticIndex.deleteDocument(documentId, operation)
  throwIfAborted(operation.signal)
}

export async function deleteKnowledgeDocumentRecords(
  documentId: string,
  operation: KnowledgeDocumentMutationOptions = {},
): Promise<void> {
  operation = snapshotKnowledgeMutationOptions(operation)
  throwIfAborted(operation.signal)
  if (operation.expectedDocument !== undefined) {
    const current = (await knowledgeRepository.listDocuments(operation)).find(document => document.id === documentId)
    assertKnowledgeDocumentUnchanged(current, operation.expectedDocument)
  }
  try {
    // ColBERT cleanup still needs canonical chunks. Recheck the guard in the
    // canonical transaction and repair derived indexes if a late conflict wins.
    await deleteKnowledgeDocumentIndexes(documentId, operation)
    throwIfAborted(operation.signal)
    await knowledgeRepository.deleteDocument(documentId, operation)
  } catch (error) {
    if (operation.expectedDocument !== undefined) await recoverKnowledgeDocumentIndexes([documentId], error)
    throw error
  }
}

export async function clearKnowledgeIndexes(operation: KnowledgeRepositoryOperationOptions = {}): Promise<void> {
  operation = { ...operation }
  throwIfAborted(operation.signal)
  await knowledgeHybridIndex.clearEmbeddings(operation)
  throwIfAborted(operation.signal)
  await knowledgeColbertIndex.clear(operation)
  throwIfAborted(operation.signal)
  await knowledgeAgenticIndex.clear(operation)
  throwIfAborted(operation.signal)
}

export async function clearKnowledgeRecords(operation: KnowledgeDocumentClearOptions = {}): Promise<void> {
  operation = snapshotKnowledgeMutationOptions(operation)
  throwIfAborted(operation.signal)
  if (operation.expectedDocuments === undefined) {
    try {
      await clearKnowledgeIndexes(operation)
      throwIfAborted(operation.signal)
      await knowledgeRepository.clearDocuments(operation)
    } catch (error) {
      await recoverKnowledgeDocumentIndexes(undefined, error)
      throw error
    }
    return
  }
  const current = await knowledgeRepository.listDocuments(operation)
  for (const expected of operation.expectedDocuments) {
    assertKnowledgeDocumentUnchanged(current.find(document => document.id === expected.id), expected)
  }
  const ids = operation.expectedDocuments.map(document => document.id)
  try {
    for (const id of ids) await deleteKnowledgeDocumentIndexes(id, operation)
    throwIfAborted(operation.signal)
    await knowledgeRepository.clearDocuments(operation)
  } catch (error) {
    await recoverKnowledgeDocumentIndexes(ids, error)
    throw error
  }
}

async function recoverKnowledgeDocumentIndexes(documentIds: readonly string[] | undefined, originalError: unknown): Promise<void> {
  try {
    const signal = new AbortController().signal
    if (documentIds === undefined) {
      await synchronizeKnowledgeChunkIndexes(await knowledgeRepository.listChunks(undefined, { signal }), {}, signal)
      return
    }
    for (const id of documentIds) {
      const chunks = await knowledgeRepository.listChunks(id, { signal })
      await synchronizeKnowledgeChunkIndexes(chunks, {}, signal)
    }
  } catch (recoveryError) {
    throw new AggregateError([originalError, recoveryError], 'Knowledge deletion and derived-index recovery both failed.')
  }
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
  const error = new Error('The knowledge operation was cancelled.')
  error.name = 'AbortError'
  throw error
}
