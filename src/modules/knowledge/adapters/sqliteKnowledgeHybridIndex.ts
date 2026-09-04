import { systemClock, type Clock } from '@/core'
import {
  applySqliteMigrations,
  type SqliteDatabase,
  type SqliteDatabaseProvider,
  type SqliteExecutor,
  type SqliteValue,
} from '@/platform/storage'
import * as v from 'valibot'
import type {
  KnowledgeChunkRecord,
  KnowledgeDocumentIndexPort,
  KnowledgeDocumentRepository,
  KnowledgeFtsSearchHit,
  KnowledgeFtsSearchPort,
  KnowledgeRepositoryOperationOptions,
} from '../contracts'
import type {
  KnowledgeHybridSearchRequest,
} from '../application/knowledgeRetrievalUseCase'
import type {
  KnowledgeQueryEmbeddingUseCase,
  KnowledgeQueryEmbeddingMode,
  KnowledgeStoredEmbeddingDescriptor,
} from '../application/knowledgeQueryEmbedding'
import {
  KNOWLEDGE_LOCAL_HASH_MODEL_ID,
  resolveKnowledgeEmbeddingWrite,
} from '../domain/embeddingPersistencePolicy'
import {
  createLocalKnowledgeEmbedding,
  hashKnowledgeText,
} from '../domain/localVectorIndex'
import { fuseHybridKnowledgeCandidates } from '../domain/retrievalCandidateFusion'
import { rerankKnowledgeSources } from '../domain/retrievalReranking'
import { resolveKnowledgeVectorCandidate } from '../domain/vectorRetrievalCandidate'
import {
  createKnowledgeProviderEmbeddingCancelledJob,
  createKnowledgeProviderEmbeddingDoneJob,
  createKnowledgeProviderEmbeddingErrorJob,
  createKnowledgeProviderEmbeddingRunningJob,
  createKnowledgeProviderEmbeddingWrite,
  selectKnowledgeProviderEmbeddingCandidates,
  type KnowledgeProviderEmbeddingJobRecord,
} from '../domain/providerEmbeddingJobPolicy'

const MIGRATION_SCOPE = 'knowledge-hybrid-index'
const VECTOR_MIGRATION_VERSION = 1
const PROVIDER_JOB_MIGRATION_VERSION = 2
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1_000
const DEFAULT_MAX_VECTOR_CANDIDATES = 420
const MAX_QUERY_LENGTH = 16_384
const MAX_EMBEDDING_DIMENSION = 8_192

const vectorRowSchema = v.object({
  id: v.string(),
  documentId: v.string(),
  title: v.string(),
  content: v.string(),
  ordinal: v.number(),
  chunkIndex: v.nullish(v.number()),
  createdAt: v.number(),
  sourceUri: v.nullish(v.string()),
  rawPath: v.nullish(v.string()),
  embeddingJson: v.nullish(v.string()),
  source: v.nullish(v.string()),
  model: v.nullish(v.string()),
})

const cacheRowSchema = v.object({
  query: v.string(),
  resultJson: v.string(),
  expiresAt: v.number(),
})

const cachedHitSchema = v.object({
  id: v.string(),
  documentId: v.string(),
  title: v.string(),
  content: v.string(),
  ordinal: v.number(),
  chunkIndex: v.optional(v.number()),
  createdAt: v.optional(v.number()),
  sourceUri: v.optional(v.string()),
  rawPath: v.optional(v.string()),
  score: v.number(),
  similarityScore: v.number(),
  ftsScore: v.optional(v.number()),
  vectorScore: v.optional(v.number()),
  retrievalMode: v.picklist(['fts', 'vector', 'hybrid']),
})

const embeddingJobRowSchema = v.object({
  id: v.string(),
  chunkId: v.string(),
  status: v.picklist(['running', 'done', 'error', 'cancelled']),
  source: v.literal('provider'),
  error: v.nullish(v.string()),
  updatedAt: v.number(),
})

const providerEmbeddingResultSchema = v.object({
  embedding: v.array(v.number()),
  model: v.string(),
})

interface PersistedVectorRow {
  id: string
  documentId: string
  title: string
  content: string
  ordinal: number
  chunkIndex?: number
  createdAt: number
  sourceUri?: string
  rawPath?: string
  embeddingJson?: string
  source?: string
  model?: string
}

interface HybridCandidate {
  id: string
  documentId: string
  title: string
  content: string
  ordinal: number
  chunkIndex?: number
  createdAt?: number
  sourceUri?: string
  rawPath?: string
  score?: number
  ftsScore?: number
  vectorScore?: number
  retrievalMode?: 'fts' | 'vector' | 'hybrid'
}

interface ValidatedEmbeddingChunk {
  id: string
  documentId: string
  content: string
}

interface PendingEmbeddingWrite {
  chunkId: string
  embedding: number[]
  source: 'local' | 'onnx'
  model: string
  status: 'ready' | 'fallback'
  error: string | null
  embeddingProvider: 'onnx' | 'hash'
}

export interface KnowledgeHybridSearchHit {
  id: string
  documentId: string
  title: string
  content: string
  ordinal: number
  chunkIndex?: number
  createdAt?: number
  sourceUri?: string
  rawPath?: string
  score: number
  similarityScore: number
  ftsScore?: number
  vectorScore?: number
  retrievalMode: 'fts' | 'vector' | 'hybrid'
}

export interface KnowledgeProviderEmbeddingState {
  configured: boolean
  supportsEmbeddings: boolean
}

export interface KnowledgeEmbeddingOperationOptions<Provider> {
  embeddingMode?: KnowledgeQueryEmbeddingMode
  localEmbeddingModelId?: string
  localEmbeddingModelSource?: 'bundled' | 'downloaded' | 'none'
  provider?: Provider
  signal: AbortSignal
}

export interface KnowledgeOnnxEmbeddingPort {
  model: string
  embed(text: string, options: { signal: AbortSignal }): Promise<unknown>
}

export interface KnowledgeOnnxEmbeddingPortRequest {
  embeddingMode?: KnowledgeQueryEmbeddingMode
  localEmbeddingModelId?: string
  localEmbeddingModelSource?: 'bundled' | 'downloaded' | 'none'
  signal: AbortSignal
}

export interface KnowledgeProviderChunkEmbeddingRequest<Provider> {
  provider: Provider
  chunkId: string
  text: string
  signal: AbortSignal
}

export interface KnowledgeProviderEmbeddingUnsupportedNotice<Provider> {
  provider: Provider
  signal: AbortSignal
}

export interface KnowledgeEmbeddingSynchronizationResult {
  chunkCount: number
  localCount: number
  onnxCount: number
}

export interface KnowledgeProviderEmbeddingBatchResult {
  status: 'completed' | 'cancelled' | 'skipped'
  attempted: number
  succeeded: number
  failed: number
  cancelled: number
  skippedReason?: 'provider_not_configured' | 'provider_unsupported' | 'provider_adapter_unavailable'
}

export interface SqliteKnowledgeHybridIndexDependencies<Provider> {
  repository: KnowledgeDocumentRepository & KnowledgeFtsSearchPort
  queryEmbedding: KnowledgeQueryEmbeddingUseCase<Provider>
  resolveProviderEmbeddingState?(provider: Provider): KnowledgeProviderEmbeddingState
  resolveOnnxEmbeddingPort?(
    input: KnowledgeOnnxEmbeddingPortRequest,
  ): Promise<KnowledgeOnnxEmbeddingPort | undefined> | KnowledgeOnnxEmbeddingPort | undefined
  embedWithProvider?(input: KnowledgeProviderChunkEmbeddingRequest<Provider>): Promise<unknown>
  notifyProviderEmbeddingUnsupported?(
    input: KnowledgeProviderEmbeddingUnsupportedNotice<Provider>,
  ): void | Promise<void>
  /**
   * Required to cache provider-backed queries. Returning no key keeps those
   * queries uncached so credentials or provider routes cannot share results.
   */
  providerCacheKey?(provider: Provider): string | undefined
  clock?: Clock
  cacheTtlMs?: number
  maxVectorCandidates?: number
}

export interface KnowledgeHybridIndex<Provider> extends KnowledgeDocumentIndexPort {
  synchronizeEmbeddings(
    chunks: readonly KnowledgeChunkRecord[],
    options: KnowledgeEmbeddingOperationOptions<Provider>,
  ): Promise<KnowledgeEmbeddingSynchronizationResult>
  upgradeProviderEmbeddings(
    chunks: readonly KnowledgeChunkRecord[],
    options: { provider: Provider; signal: AbortSignal },
  ): Promise<KnowledgeProviderEmbeddingBatchResult>
  listEmbeddingJobs(
    limit?: number,
    options?: KnowledgeRepositoryOperationOptions,
  ): Promise<readonly KnowledgeProviderEmbeddingJobRecord[]>
  searchHybrid(input: KnowledgeHybridSearchRequest<Provider>): Promise<readonly KnowledgeHybridSearchHit[]>
  clearCache(options?: KnowledgeRepositoryOperationOptions): Promise<void>
  clearEmbeddings(options?: KnowledgeRepositoryOperationOptions): Promise<void>
  deleteDocumentEmbeddings(
    documentId: string,
    options?: KnowledgeRepositoryOperationOptions,
  ): Promise<void>
}

export class KnowledgeHybridIndexDataError extends Error {
  constructor(message = 'Persisted knowledge index data is invalid.') {
    super(message)
    this.name = 'KnowledgeHybridIndexDataError'
  }
}

export class KnowledgeHybridIndexCancelledError extends Error {
  constructor() {
    super('Knowledge hybrid index operation was cancelled.')
    this.name = 'KnowledgeHybridIndexCancelledError'
  }
}

/**
 * Owns the SQLite-backed local-vector and hybrid-search path. It deliberately
 * reuses the existing chunk_embeddings and rag_query_cache tables so the
 * migration can replace the legacy driver without copying durable data.
 */
export function createSqliteKnowledgeHybridIndex<Provider = unknown>(
  databaseProvider: SqliteDatabaseProvider,
  dependencies: SqliteKnowledgeHybridIndexDependencies<Provider>,
): KnowledgeHybridIndex<Provider> {
  const clock = dependencies.clock ?? systemClock
  const cacheTtlMs = normalizeNonNegativeInteger(
    dependencies.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
    'cache TTL',
  )
  const maxVectorCandidates = normalizePositiveInteger(
    dependencies.maxVectorCandidates ?? DEFAULT_MAX_VECTOR_CANDIDATES,
    'vector candidate limit',
  )
  let initialized: Promise<SqliteDatabase> | undefined

  async function database(signal?: AbortSignal): Promise<SqliteDatabase> {
    throwIfAborted(signal)
    const pending = initialized ??= (async () => {
      // The canonical repository owns knowledge_documents/knowledge_chunks.
      // Touching it first makes migration order explicit without duplicating
      // its schema in this secondary-index adapter.
      await dependencies.repository.listDocuments({ signal })
      throwIfAborted(signal)
      const value = await databaseProvider.get()
      throwIfAborted(signal)
      await applySqliteMigrations(value, [
        {
          scope: MIGRATION_SCOPE,
          version: VECTOR_MIGRATION_VERSION,
          name: 'target-local-vector-and-hybrid-cache',
          async up(transaction) {
            await transaction.exec(`
              CREATE TABLE IF NOT EXISTS chunk_embeddings (
                chunkId TEXT PRIMARY KEY NOT NULL,
                embeddingJson TEXT NOT NULL,
                dimension INTEGER NOT NULL,
                source TEXT NOT NULL,
                model TEXT,
                updatedAt INTEGER NOT NULL,
                status TEXT NOT NULL,
                error TEXT
              );
              CREATE TABLE IF NOT EXISTS rag_query_cache (
                key TEXT PRIMARY KEY NOT NULL,
                query TEXT NOT NULL,
                resultJson TEXT NOT NULL,
                expiresAt INTEGER NOT NULL,
                createdAt INTEGER NOT NULL
              );
              CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_source_model
                ON chunk_embeddings(source, model);
              CREATE INDEX IF NOT EXISTS idx_rag_query_cache_expiry
                ON rag_query_cache(expiresAt);
            `)
          },
        },
        {
          scope: MIGRATION_SCOPE,
          version: PROVIDER_JOB_MIGRATION_VERSION,
          name: 'target-provider-embedding-jobs',
          async up(transaction) {
            await transaction.exec(`
              CREATE TABLE IF NOT EXISTS embedding_jobs (
                id TEXT PRIMARY KEY NOT NULL,
                chunkId TEXT NOT NULL,
                status TEXT NOT NULL,
                source TEXT NOT NULL,
                error TEXT,
                updatedAt INTEGER NOT NULL
              );
              CREATE INDEX IF NOT EXISTS idx_embedding_jobs_updated_at
                ON embedding_jobs(updatedAt DESC);
            `)
          },
        },
      ])
      return value
    })()
    try {
      const value = await pending
      throwIfAborted(signal)
      return value
    } catch (error) {
      if (initialized === pending) initialized = undefined
      throwCancellationIfAborted(signal)
      throw error
    }
  }

  async function clearCache(
    options: KnowledgeRepositoryOperationOptions = {},
  ): Promise<void> {
    const value = await database(options.signal)
    await run(value, 'DELETE FROM rag_query_cache', [], options.signal)
  }

  async function synchronizeEmbeddings(
    chunks: readonly KnowledgeChunkRecord[],
    options: KnowledgeEmbeddingOperationOptions<Provider>,
  ): Promise<KnowledgeEmbeddingSynchronizationResult> {
    throwIfAborted(options.signal)
    const validatedChunks = validateEmbeddingChunks(chunks)
    let onnxPort: KnowledgeOnnxEmbeddingPort | undefined
    let onnxInitializationError: string | undefined
    if (
      options.embeddingMode !== 'provider'
      && options.localEmbeddingModelSource !== 'none'
      && dependencies.resolveOnnxEmbeddingPort
    ) {
      try {
        onnxPort = await raceWithAbort(
          Promise.resolve(dependencies.resolveOnnxEmbeddingPort({
            embeddingMode: options.embeddingMode,
            ...(options.localEmbeddingModelId === undefined ? {} : { localEmbeddingModelId: options.localEmbeddingModelId }),
            ...(options.localEmbeddingModelSource === undefined ? {} : { localEmbeddingModelSource: options.localEmbeddingModelSource }),
            signal: options.signal,
          })),
          options.signal,
        )
        if (onnxPort) normalizeEmbeddingModel(onnxPort.model)
      } catch (error) {
        throwCancellationIfAborted(options.signal)
        onnxInitializationError = normalizeEmbeddingError(error, 'ONNX embedding unavailable')
      }
    }

    const writes: PendingEmbeddingWrite[] = []
    let localCount = 0
    let onnxCount = 0
    for (const chunk of validatedChunks) {
      throwIfAborted(options.signal)
      const localEmbedding = createLocalKnowledgeEmbedding(chunk.content)
      let onnx: { embedding: number[]; model: string } | undefined
      let onnxError = onnxInitializationError
      if (onnxPort) {
        try {
          onnx = {
            embedding: normalizeEmbedding(await raceWithAbort(
              onnxPort.embed(chunk.content, { signal: options.signal }),
              options.signal,
            ) as readonly number[]),
            model: normalizeEmbeddingModel(onnxPort.model),
          }
        } catch (error) {
          throwCancellationIfAborted(options.signal)
          onnxError = normalizeEmbeddingError(error, 'ONNX embedding failed')
        }
      }
      const decision = resolveKnowledgeEmbeddingWrite({
        localEmbedding,
        ...(onnx === undefined ? {} : { onnx }),
        ...(onnxError === undefined ? {} : { onnxError }),
      })
      if (decision.source === 'onnx') onnxCount += 1
      else localCount += 1
      writes.push({ chunkId: chunk.id, ...decision })
    }

    const value = await database(options.signal)
    const now = normalizeTimestamp(clock.now())
    await value.transaction(async (transaction) => {
      for (const write of writes) {
        await run(
          transaction,
          `INSERT INTO chunk_embeddings
             (chunkId, embeddingJson, dimension, source, model, updatedAt, status, error)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(chunkId) DO UPDATE SET
             embeddingJson = excluded.embeddingJson,
             dimension = excluded.dimension,
             source = excluded.source,
             model = excluded.model,
             updatedAt = excluded.updatedAt,
             status = excluded.status,
             error = excluded.error
           WHERE chunk_embeddings.source NOT IN ('provider', 'onnx')
              OR (excluded.source = 'onnx' AND chunk_embeddings.source <> 'provider')`,
          [
            write.chunkId,
            JSON.stringify(write.embedding),
            write.embedding.length,
            write.source,
            write.model,
            now,
            write.status,
            write.error,
          ],
          options.signal,
        )
        await updateChunkEmbeddingProvider(transaction, write.chunkId, options.signal)
      }
      await run(transaction, 'DELETE FROM rag_query_cache', [], options.signal)
    })
    throwIfAborted(options.signal)
    return { chunkCount: writes.length, localCount, onnxCount }
  }

  async function upgradeProviderEmbeddings(
    chunks: readonly KnowledgeChunkRecord[],
    options: { provider: Provider; signal: AbortSignal },
  ): Promise<KnowledgeProviderEmbeddingBatchResult> {
    const result: KnowledgeProviderEmbeddingBatchResult = {
      status: 'completed',
      attempted: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    }
    if (options.signal.aborted) return { ...result, status: 'cancelled' }
    const providerState = dependencies.resolveProviderEmbeddingState?.(options.provider)
      ?? { configured: false, supportsEmbeddings: false }
    if (!providerState.configured) {
      return { ...result, status: 'skipped', skippedReason: 'provider_not_configured' }
    }
    if (!providerState.supportsEmbeddings) {
      if (dependencies.notifyProviderEmbeddingUnsupported) {
        try {
          await raceWithAbort(
            Promise.resolve(dependencies.notifyProviderEmbeddingUnsupported({
              provider: options.provider,
              signal: options.signal,
            })),
            options.signal,
          )
        } catch (error) {
          if (options.signal.aborted) return { ...result, status: 'cancelled' }
          throw error
        }
      }
      return { ...result, status: 'skipped', skippedReason: 'provider_unsupported' }
    }
    if (!dependencies.embedWithProvider) {
      return { ...result, status: 'skipped', skippedReason: 'provider_adapter_unavailable' }
    }

    const candidates = selectKnowledgeProviderEmbeddingCandidates(validateEmbeddingChunks(chunks))
    const value = await database(options.signal)
    for (const chunk of candidates) {
      if (options.signal.aborted) return { ...result, status: 'cancelled' }
      result.attempted += 1
      const runningJob = createKnowledgeProviderEmbeddingRunningJob(chunk.id, normalizeTimestamp(clock.now()))
      await persistProviderJob(value, runningJob, options.signal)
      try {
        const embedded = normalizeProviderEmbeddingResult(await raceWithAbort(
          dependencies.embedWithProvider({
            provider: options.provider,
            chunkId: chunk.id,
            text: chunk.content,
            signal: options.signal,
          }),
          options.signal,
        ))
        throwIfAborted(options.signal)
        const now = normalizeTimestamp(clock.now())
        const write = createKnowledgeProviderEmbeddingWrite(chunk.id, {
          embedding: embedded.embedding,
          source: 'provider',
          model: embedded.model,
        }, now)
        const doneJob = createKnowledgeProviderEmbeddingDoneJob(chunk.id, now)
        await value.transaction(async (transaction) => {
          await run(
            transaction,
            `INSERT OR REPLACE INTO chunk_embeddings
               (chunkId, embeddingJson, dimension, source, model, updatedAt, status, error)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              write.chunkId,
              JSON.stringify(write.embedding),
              write.dimension,
              write.source,
              write.model,
              write.updatedAt,
              write.status,
              write.error,
            ],
            options.signal,
          )
          await run(
            transaction,
            'UPDATE knowledge_chunks SET embeddingProvider = ? WHERE id = ?',
            ['provider', chunk.id],
            options.signal,
          )
          await persistProviderJob(transaction, doneJob, options.signal)
          await run(transaction, 'DELETE FROM rag_query_cache', [], options.signal)
        })
        result.succeeded += 1
      } catch (error) {
        if (options.signal.aborted || error instanceof KnowledgeHybridIndexCancelledError) {
          const cancelledJob = createKnowledgeProviderEmbeddingCancelledJob(
            chunk.id,
            normalizeTimestamp(clock.now()),
          )
          // Terminal cancellation evidence must outlive the cancelled request.
          await persistProviderJob(value, cancelledJob)
          result.cancelled += 1
          return { ...result, status: 'cancelled' }
        }
        const failedJob = createKnowledgeProviderEmbeddingErrorJob(
          chunk.id,
          new Error(normalizeEmbeddingError(error, 'Provider embedding failed')),
          normalizeTimestamp(clock.now()),
        )
        await persistProviderJob(value, failedJob, options.signal)
        result.failed += 1
      }
    }
    return result
  }

  async function persistProviderJob(
    executor: SqliteExecutor,
    job: KnowledgeProviderEmbeddingJobRecord,
    signal?: AbortSignal,
  ): Promise<void> {
    const record = normalizeEmbeddingJobRecord(job)
    await run(
      executor,
      `INSERT OR REPLACE INTO embedding_jobs
         (id, chunkId, status, source, error, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [record.id, record.chunkId, record.status, record.source, record.error, record.updatedAt],
      signal,
    )
  }

  async function updateChunkEmbeddingProvider(
    executor: SqliteExecutor,
    chunkId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await run(
      executor,
      `UPDATE knowledge_chunks
       SET embeddingProvider = CASE (
         SELECT source FROM chunk_embeddings WHERE chunkId = ?
       )
         WHEN 'provider' THEN 'provider'
         WHEN 'onnx' THEN 'onnx'
         ELSE 'hash'
       END
       WHERE id = ?`,
      [chunkId, chunkId],
      signal,
    )
  }

  return {
    async synchronize(document, chunks, operation) {
      throwIfAborted(operation.signal)
      const documentId = normalizeIdentifier(document.id, 'document id')
      const uniqueChunkIds = new Set<string>()
      for (const chunk of chunks) {
        const chunkId = normalizeIdentifier(chunk.id, 'chunk id')
        if (chunk.documentId !== documentId) {
          throw new KnowledgeHybridIndexDataError('A chunk does not belong to the synchronized document.')
        }
        if (uniqueChunkIds.has(chunkId)) {
          throw new KnowledgeHybridIndexDataError(`Chunk ${chunkId} is duplicated in the synchronized document.`)
        }
        uniqueChunkIds.add(chunkId)
      }
      await synchronizeEmbeddings(chunks, {
        embeddingMode: 'local',
        localEmbeddingModelSource: 'none',
        signal: operation.signal,
      })
    },

    synchronizeEmbeddings,

    upgradeProviderEmbeddings,

    async listEmbeddingJobs(limit = 20, options = {}) {
      const normalizedLimit = Math.min(normalizePositiveInteger(limit, 'embedding job limit'), 100)
      const value = await database(options.signal)
      const rows = await value.getAll<Record<string, unknown>>(
        `SELECT id, chunkId, status, source, error, updatedAt
         FROM embedding_jobs ORDER BY updatedAt DESC LIMIT ?`,
        [normalizedLimit],
      )
      throwIfAborted(options.signal)
      return rows.map(normalizeEmbeddingJobRow)
    },

    async searchHybrid(input) {
      try {
        throwIfAborted(input.signal)
        const query = normalizeQuery(input.query)
        if (!query) return []
        const limit = normalizePositiveInteger(input.limit, 'hybrid search limit')
        const providerKey = resolveProviderCacheKey(input.provider, dependencies.providerCacheKey)
        const cacheKey = providerKey === null
          ? undefined
          : createCacheKey(input, query, limit, providerKey)

        if (cacheKey && cacheTtlMs > 0 && !input.onEmbeddingResolved) {
          const cached = await readCache(cacheKey, query, input.signal)
          if (cached) {
            await dependencies.repository.markFtsHits(cached.map((hit) => hit.id), { signal: input.signal })
            throwIfAborted(input.signal)
            return cached
          }
        }

        const [ftsRows, vectorRows] = await Promise.all([
          dependencies.repository.searchFts({ query, limit, signal: input.signal }),
          searchVector(input, query, limit),
        ])
        throwIfAborted(input.signal)
        const fused = fuseHybridKnowledgeCandidates(
          ftsRows.map(ftsHitToCandidate),
          vectorRows,
          'hybrid',
        )
        const results = rerankKnowledgeSources(query, fused, limit).map(normalizeHybridHit)
        await dependencies.repository.markFtsHits(results.map((hit) => hit.id), { signal: input.signal })
        throwIfAborted(input.signal)
        if (cacheKey && cacheTtlMs > 0) {
          await writeCache(cacheKey, query, results, input.signal)
        }
        return results
      } catch (error) {
        throwCancellationIfAborted(input.signal)
        throw error
      }
    },

    clearCache,

    async clearEmbeddings(options = {}) {
      const value = await database(options.signal)
      await value.transaction(async (transaction) => {
        await run(transaction, 'DELETE FROM chunk_embeddings', [], options.signal)
        await run(transaction, 'DELETE FROM embedding_jobs', [], options.signal)
        await run(transaction, 'DELETE FROM rag_query_cache', [], options.signal)
      })
      throwIfAborted(options.signal)
    },

    async deleteDocumentEmbeddings(documentId, options = {}) {
      const normalizedId = normalizeIdentifier(documentId, 'document id')
      const value = await database(options.signal)
      await value.transaction(async (transaction) => {
        await run(
          transaction,
          'DELETE FROM embedding_jobs WHERE chunkId IN (SELECT id FROM knowledge_chunks WHERE documentId = ?)',
          [normalizedId],
          options.signal,
        )
        await run(
          transaction,
          'DELETE FROM chunk_embeddings WHERE chunkId IN (SELECT id FROM knowledge_chunks WHERE documentId = ?)',
          [normalizedId],
          options.signal,
        )
        await run(transaction, 'DELETE FROM rag_query_cache', [], options.signal)
      })
      throwIfAborted(options.signal)
    },
  }

  async function searchVector(
    input: KnowledgeHybridSearchRequest<Provider>,
    query: string,
    limit: number,
  ): Promise<HybridCandidate[]> {
    const value = await database(input.signal)
    const rawRows = await value.getAll<Record<string, unknown>>(
      `SELECT c.id, c.documentId, c.title, c.content, c.ordinal, c.chunkIndex, c.createdAt,
              d.sourceUri, d.rawPath, e.embeddingJson, e.source, e.model
       FROM knowledge_chunks AS c
       LEFT JOIN knowledge_documents AS d ON d.id = c.documentId
       LEFT JOIN chunk_embeddings AS e ON e.chunkId = c.id
       ORDER BY c.createdAt DESC
       LIMIT ?`,
      [maxVectorCandidates],
    )
    throwIfAborted(input.signal)
    const rows = rawRows.map(normalizeVectorRow)
    if (!rows.length) return []

    const providerState = input.provider === undefined
      ? { configured: false, supportsEmbeddings: false }
      : dependencies.resolveProviderEmbeddingState?.(input.provider)
        ?? { configured: false, supportsEmbeddings: false }
    const queryEmbedding = normalizeEmbedding(await dependencies.queryEmbedding.resolve({
      query,
      chunks: rows.map(toEmbeddingDescriptor),
      embeddingMode: input.embeddingMode,
      ...(input.localEmbeddingModelId === undefined ? {} : { localEmbeddingModelId: input.localEmbeddingModelId }),
      ...(input.localEmbeddingModelSource === undefined ? {} : { localEmbeddingModelSource: input.localEmbeddingModelSource }),
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      providerConfigured: providerState.configured,
      providerSupportsEmbeddings: providerState.supportsEmbeddings,
      ...(input.onEmbeddingResolved === undefined ? {} : { onResolved: input.onEmbeddingResolved }),
    }))
    throwIfAborted(input.signal)

    const candidates: HybridCandidate[] = []
    const repairs: Array<{ chunkId: string; embedding: number[]; reason: string }> = []
    for (const row of rows) {
      throwIfAborted(input.signal)
      const decision = resolveKnowledgeVectorCandidate(row, queryEmbedding)
      if (decision.repairRequired) {
        repairs.push({
          chunkId: row.id,
          embedding: createLocalKnowledgeEmbedding(row.content),
          reason: decision.repairReason ?? 'missing_or_malformed',
        })
      }
      if (!decision.candidate) continue
      candidates.push({
        id: row.id,
        documentId: row.documentId,
        title: row.title,
        content: row.content,
        ordinal: row.ordinal,
        ...(row.chunkIndex === undefined ? {} : { chunkIndex: row.chunkIndex }),
        createdAt: row.createdAt,
        ...(row.sourceUri === undefined ? {} : { sourceUri: row.sourceUri }),
        ...(row.rawPath === undefined ? {} : { rawPath: row.rawPath }),
        ...decision.candidate,
      })
    }

    if (repairs.length) await persistRepairs(value, repairs, input.signal)
    return candidates
      .sort((left, right) => (right.vectorScore ?? 0) - (left.vectorScore ?? 0))
      .slice(0, Math.max(limit * 4, 20))
  }

  async function persistRepairs(
    value: SqliteDatabase,
    repairs: readonly { chunkId: string; embedding: number[]; reason: string }[],
    signal?: AbortSignal,
  ): Promise<void> {
    const now = normalizeTimestamp(clock.now())
    await value.transaction(async (transaction) => {
      for (const repair of repairs) {
        await run(
          transaction,
          `INSERT OR REPLACE INTO chunk_embeddings
             (chunkId, embeddingJson, dimension, source, model, updatedAt, status, error)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            repair.chunkId,
            JSON.stringify(repair.embedding),
            repair.embedding.length,
            'local',
            KNOWLEDGE_LOCAL_HASH_MODEL_ID,
            now,
            'fallback',
            repair.reason,
          ],
          signal,
        )
        await run(
          transaction,
          'UPDATE knowledge_chunks SET embeddingProvider = ? WHERE id = ?',
          ['hash', repair.chunkId],
          signal,
        )
      }
    })
  }

  async function readCache(
    key: string,
    query: string,
    signal?: AbortSignal,
  ): Promise<KnowledgeHybridSearchHit[] | undefined> {
    const value = await database(signal)
    const raw = await value.getFirst<Record<string, unknown>>(
      'SELECT query, resultJson, expiresAt FROM rag_query_cache WHERE key = ?',
      [key],
    )
    throwIfAborted(signal)
    if (!raw) return undefined
    const parsedRow = v.safeParse(cacheRowSchema, raw)
    if (!parsedRow.success || parsedRow.output.query !== query || !Number.isFinite(parsedRow.output.expiresAt)) {
      await run(value, 'DELETE FROM rag_query_cache WHERE key = ?', [key], signal)
      return undefined
    }
    if (parsedRow.output.expiresAt <= normalizeTimestamp(clock.now())) {
      await run(value, 'DELETE FROM rag_query_cache WHERE key = ?', [key], signal)
      return undefined
    }
    try {
      const parsedJson: unknown = JSON.parse(parsedRow.output.resultJson)
      const parsedHits = v.safeParse(v.array(cachedHitSchema), parsedJson)
      if (!parsedHits.success) throw new Error('invalid cache result')
      return parsedHits.output.map(normalizeHybridHit)
    } catch {
      await run(value, 'DELETE FROM rag_query_cache WHERE key = ?', [key], signal)
      return undefined
    }
  }

  async function writeCache(
    key: string,
    query: string,
    results: readonly KnowledgeHybridSearchHit[],
    signal?: AbortSignal,
  ): Promise<void> {
    const value = await database(signal)
    const now = normalizeTimestamp(clock.now())
    await run(
      value,
      `INSERT OR REPLACE INTO rag_query_cache
         (key, query, resultJson, expiresAt, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
      [key, query, JSON.stringify(results), now + cacheTtlMs, now],
      signal,
    )
  }
}

function normalizeVectorRow(raw: Record<string, unknown>): PersistedVectorRow {
  const parsed = v.safeParse(vectorRowSchema, raw)
  if (!parsed.success) throw new KnowledgeHybridIndexDataError()
  const row = parsed.output
  return {
    id: normalizeIdentifier(row.id, 'persisted chunk id'),
    documentId: normalizeIdentifier(row.documentId, 'persisted document id'),
    title: normalizeText(row.title, 'persisted chunk title'),
    content: normalizeContent(row.content),
    ordinal: normalizeNonNegativeInteger(row.ordinal, 'persisted chunk ordinal'),
    ...(row.chunkIndex == null
      ? {}
      : { chunkIndex: normalizeNonNegativeInteger(row.chunkIndex, 'persisted chunk index') }),
    createdAt: normalizeTimestamp(row.createdAt),
    ...(row.sourceUri == null ? {} : { sourceUri: row.sourceUri }),
    ...(row.rawPath == null ? {} : { rawPath: row.rawPath }),
    ...(row.embeddingJson == null ? {} : { embeddingJson: row.embeddingJson }),
    ...(row.source == null ? {} : { source: row.source }),
    ...(row.model == null ? {} : { model: row.model }),
  }
}

function ftsHitToCandidate(hit: KnowledgeFtsSearchHit): HybridCandidate {
  return {
    id: normalizeIdentifier(hit.id, 'FTS hit id'),
    documentId: normalizeIdentifier(hit.documentId, 'FTS document id'),
    title: normalizeText(hit.title, 'FTS title'),
    content: normalizeContent(hit.content),
    ordinal: normalizeNonNegativeInteger(hit.ordinal, 'FTS ordinal'),
    ...(hit.chunkIndex === undefined
      ? {}
      : { chunkIndex: normalizeNonNegativeInteger(hit.chunkIndex, 'FTS chunk index') }),
    ...(hit.sourceUri === undefined ? {} : { sourceUri: hit.sourceUri }),
    ...(hit.rawPath === undefined ? {} : { rawPath: hit.rawPath }),
    score: normalizeFiniteNumber(hit.score, 'FTS score'),
    ftsScore: normalizeFiniteNumber(hit.score, 'FTS score'),
    retrievalMode: 'fts',
  }
}

function normalizeHybridHit(input: HybridCandidate & { score: number; similarityScore: number }): KnowledgeHybridSearchHit
function normalizeHybridHit(input: v.InferOutput<typeof cachedHitSchema>): KnowledgeHybridSearchHit
function normalizeHybridHit(input: HybridCandidate & { score: number; similarityScore: number }): KnowledgeHybridSearchHit {
  const retrievalMode = input.retrievalMode
  if (retrievalMode !== 'fts' && retrievalMode !== 'vector' && retrievalMode !== 'hybrid') {
    throw new KnowledgeHybridIndexDataError('A hybrid result has no valid retrieval mode.')
  }
  return {
    id: normalizeIdentifier(input.id, 'hybrid result id'),
    documentId: normalizeIdentifier(input.documentId, 'hybrid result document id'),
    title: normalizeText(input.title, 'hybrid result title'),
    content: normalizeContent(input.content),
    ordinal: normalizeNonNegativeInteger(input.ordinal, 'hybrid result ordinal'),
    ...(input.chunkIndex === undefined
      ? {}
      : { chunkIndex: normalizeNonNegativeInteger(input.chunkIndex, 'hybrid result chunk index') }),
    ...(input.createdAt === undefined ? {} : { createdAt: normalizeTimestamp(input.createdAt) }),
    ...(input.sourceUri === undefined ? {} : { sourceUri: input.sourceUri }),
    ...(input.rawPath === undefined ? {} : { rawPath: input.rawPath }),
    score: normalizeFiniteNumber(input.score, 'hybrid result score'),
    similarityScore: normalizeFiniteNumber(input.similarityScore, 'hybrid similarity score'),
    ...(input.ftsScore === undefined ? {} : { ftsScore: normalizeFiniteNumber(input.ftsScore, 'hybrid FTS score') }),
    ...(input.vectorScore === undefined
      ? {}
      : { vectorScore: normalizeFiniteNumber(input.vectorScore, 'hybrid vector score') }),
    retrievalMode,
  }
}

function toEmbeddingDescriptor(row: PersistedVectorRow): KnowledgeStoredEmbeddingDescriptor {
  return {
    ...(row.source === undefined ? {} : { source: row.source }),
    ...(row.embeddingJson === undefined ? {} : { embeddingJson: row.embeddingJson }),
    ...(row.model === undefined ? {} : { model: row.model }),
  }
}

function createCacheKey<Provider>(
  input: KnowledgeHybridSearchRequest<Provider>,
  query: string,
  limit: number,
  providerKey: string,
): string {
  const identity = [
    'knowledge-hybrid-v1',
    input.embeddingMode,
    input.localEmbeddingModelId ?? 'auto-local-onnx',
    input.localEmbeddingModelSource ?? 'none',
    providerKey,
    String(limit),
    query,
  ].join('\u0000')
  return `knowledge-hybrid:${(hashKnowledgeText(identity) >>> 0).toString(36)}`
}

function resolveProviderCacheKey<Provider>(
  provider: Provider | undefined,
  resolver: ((provider: Provider) => string | undefined) | undefined,
): string | null {
  if (provider === undefined) return 'none'
  const resolved = resolver?.(provider)?.trim()
  return resolved ? resolved.slice(0, 256) : null
}

function normalizeEmbedding(value: readonly number[]): number[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_EMBEDDING_DIMENSION) {
    throw new KnowledgeHybridIndexDataError('The query embedding dimension is invalid.')
  }
  return value.map((item) => normalizeFiniteNumber(item, 'query embedding value'))
}

function validateEmbeddingChunks(chunks: readonly KnowledgeChunkRecord[]): ValidatedEmbeddingChunk[] {
  const seen = new Set<string>()
  return chunks.map((chunk) => {
    const id = normalizeIdentifier(chunk.id, 'chunk id')
    if (seen.has(id)) throw new KnowledgeHybridIndexDataError(`Chunk ${id} is duplicated.`)
    seen.add(id)
    return {
      id,
      documentId: normalizeIdentifier(chunk.documentId, 'document id'),
      content: normalizeContent(chunk.content),
    }
  })
}

function normalizeEmbeddingModel(value: string): string {
  return normalizeText(value, 'embedding model').slice(0, 512)
}

function normalizeEmbeddingError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback
  return message.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 500) || fallback
}

function normalizeProviderEmbeddingResult(value: unknown): { embedding: number[]; model: string } {
  const parsed = v.safeParse(providerEmbeddingResultSchema, value)
  if (!parsed.success) throw new KnowledgeHybridIndexDataError('The provider embedding result is invalid.')
  return {
    embedding: normalizeEmbedding(parsed.output.embedding),
    model: normalizeEmbeddingModel(parsed.output.model),
  }
}

function normalizeEmbeddingJobRecord(
  record: KnowledgeProviderEmbeddingJobRecord,
): KnowledgeProviderEmbeddingJobRecord {
  return {
    id: normalizeIdentifier(record.id, 'embedding job id'),
    chunkId: normalizeIdentifier(record.chunkId, 'embedding job chunk id'),
    status: record.status,
    source: 'provider',
    error: record.error === null ? null : normalizeEmbeddingError(record.error, 'embedding failed'),
    updatedAt: normalizeTimestamp(record.updatedAt),
  }
}

function normalizeEmbeddingJobRow(raw: Record<string, unknown>): KnowledgeProviderEmbeddingJobRecord {
  const parsed = v.safeParse(embeddingJobRowSchema, raw)
  if (!parsed.success) throw new KnowledgeHybridIndexDataError('Persisted embedding job data is invalid.')
  return normalizeEmbeddingJobRecord({
    ...parsed.output,
    error: parsed.output.error ?? null,
  })
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new KnowledgeHybridIndexCancelledError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new KnowledgeHybridIndexCancelledError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

function normalizeQuery(value: string): string {
  if (typeof value !== 'string') throw new KnowledgeHybridIndexDataError('The hybrid search query must be text.')
  return value.trim().slice(0, MAX_QUERY_LENGTH)
}

function normalizeIdentifier(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new KnowledgeHybridIndexDataError(`The ${label} must not be empty.`)
  }
  return value.trim()
}

function normalizeText(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new KnowledgeHybridIndexDataError(`The ${label} must not be empty.`)
  }
  return value.trim()
}

function normalizeContent(value: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new KnowledgeHybridIndexDataError('Knowledge chunk content must not be empty.')
  }
  return value.trim()
}

function normalizePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new KnowledgeHybridIndexDataError(`The ${label} must be a positive integer.`)
  }
  return value
}

function normalizeNonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new KnowledgeHybridIndexDataError(`The ${label} must be a non-negative integer.`)
  }
  return value
}

function normalizeFiniteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new KnowledgeHybridIndexDataError(`The ${label} must be finite.`)
  }
  return value
}

function normalizeTimestamp(value: number): number {
  return normalizeNonNegativeInteger(value, 'knowledge index timestamp')
}

async function run(
  database: SqliteExecutor,
  source: string,
  parameters: readonly SqliteValue[],
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal)
  await database.run(source, parameters)
  throwIfAborted(signal)
}

function throwCancellationIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new KnowledgeHybridIndexCancelledError()
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new KnowledgeHybridIndexCancelledError()
}
