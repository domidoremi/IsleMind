import { systemClock, type Clock, type IdGenerator } from '@/core'
import {
  applySqliteMigrations,
  type SqliteDatabaseProvider,
  type SqliteExecutor,
  type SqliteValue,
} from '@/platform/storage'
import * as v from 'valibot'
import {
  KNOWLEDGE_CHUNK_RECORD_SCHEMA,
  KNOWLEDGE_DOCUMENT_RECORD_SCHEMA,
  KNOWLEDGE_MEMORY_RECORD_SCHEMA,
  type KnowledgeChunkRecord,
  type KnowledgeDocumentRecord,
  type KnowledgeDocumentStatus,
  type KnowledgeEmbeddingProvider,
  type KnowledgeFtsSearchHit,
  type KnowledgeFtsSearchInput,
  type KnowledgeMemoryRecord,
  type KnowledgeMemorySearchHit,
  type KnowledgeMemorySearchInput,
  type KnowledgeMemorySourceKind,
  type KnowledgeMemoryStatus,
  type KnowledgeMemoryWrite,
  type KnowledgeRepository,
  type KnowledgeRepositoryOperationOptions,
  type KnowledgeRepositorySnapshot,
  type PendingMemoryCandidate,
} from '../contracts'

const MIGRATION_SCOPE = 'knowledge'
const MIGRATION_VERSION = 2
const MAX_MEMORY_CONTENT_LENGTH = 4_000
const MAX_DOCUMENT_TITLE_LENGTH = 512
const MAX_DOCUMENT_SOURCE_LENGTH = 2_048
const MAX_CHUNK_CONTENT_LENGTH = 24_000
const MAX_METADATA_ITEMS = 64
const MAX_FTS_QUERY_LENGTH = 16_384

const memoryRowSchema = v.object({
  id: v.string(),
  content: v.string(),
  status: v.string(),
  conversationId: v.nullish(v.string()),
  sourceKind: v.nullish(v.string()),
  sourceDetail: v.nullish(v.string()),
  confidence: v.nullish(v.number()),
  lastHitAt: v.nullish(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})

const memorySearchRowSchema = v.object({
  ...memoryRowSchema.entries,
  score: v.number(),
})

const documentRowSchema = v.object({
  id: v.string(),
  title: v.string(),
  mimeType: v.string(),
  size: v.number(),
  chunkCount: v.number(),
  status: v.string(),
  error: v.nullish(v.string()),
  sourceUri: v.nullish(v.string()),
  rawPath: v.nullish(v.string()),
  contentHash: v.nullish(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})

const chunkRowSchema = v.object({
  id: v.string(),
  documentId: v.string(),
  title: v.string(),
  content: v.string(),
  ordinal: v.number(),
  chunkIndex: v.nullish(v.number()),
  sentenceStart: v.nullish(v.number()),
  sentenceEnd: v.nullish(v.number()),
  semanticBoundary: v.nullish(v.string()),
  headingPathJson: v.nullish(v.string()),
  entitiesJson: v.nullish(v.string()),
  relationsJson: v.nullish(v.string()),
  summaryNodeId: v.nullish(v.string()),
  parentChunkId: v.nullish(v.string()),
  qualityScore: v.nullish(v.number()),
  embeddingModelId: v.nullish(v.string()),
  rerankSignalsJson: v.nullish(v.string()),
  embeddingProvider: v.nullish(v.string()),
  lastHitAt: v.nullish(v.number()),
  createdAt: v.number(),
})

const ftsSearchRowSchema = v.object({
  id: v.string(),
  documentId: v.string(),
  title: v.string(),
  content: v.string(),
  ordinal: v.number(),
  chunkIndex: v.nullish(v.number()),
  sourceUri: v.nullish(v.string()),
  rawPath: v.nullish(v.string()),
  score: v.number(),
})

interface ColumnRow {
  name: string
}

type SqliteKnowledgeSearchMode = 'fts5' | 'plain'

interface SqliteCompileOptionRow {
  enabled?: unknown
}

export interface SqliteKnowledgeRepositoryOptions {
  clock?: Clock
  ids?: IdGenerator
}

export class KnowledgeRepositoryDataError extends Error {
  constructor(message = 'A persisted knowledge record is invalid.') {
    super(message)
    this.name = 'KnowledgeRepositoryDataError'
  }
}

export class KnowledgeRepositoryCancelledError extends Error {
  constructor() {
    super('The knowledge repository operation was cancelled.')
    this.name = 'KnowledgeRepositoryCancelledError'
  }
}

/**
 * Migration adapter for the existing local context database. It owns typed
 * records and validation while a later knowledge-index port replaces the
 * remaining legacy hybrid-index synchronization.
 */
export function createSqliteKnowledgeRepository(
  databaseProvider: SqliteDatabaseProvider,
  options: SqliteKnowledgeRepositoryOptions = {},
): KnowledgeRepository {
  const clock = options.clock ?? systemClock
  const ids = options.ids ?? createSystemIdGenerator(clock)
  let initialized: Promise<void> | undefined
  let searchMode: SqliteKnowledgeSearchMode = 'fts5'

  async function database(signal?: AbortSignal) {
    throwIfAborted(signal)
    const value = await databaseProvider.get()
    throwIfAborted(signal)
    initialized ??= (async () => {
      searchMode = await resolveSqliteKnowledgeSearchMode(value)
      await applySqliteMigrations(value, [
        {
          scope: MIGRATION_SCOPE,
          version: MIGRATION_VERSION,
          name: 'knowledge-memory-document-chunk-repository',
          async up(transaction) {
            await transaction.exec(`
              CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY NOT NULL,
                content TEXT NOT NULL,
                status TEXT NOT NULL,
                conversationId TEXT,
                sourceKind TEXT,
                sourceDetail TEXT,
                confidence REAL,
                lastHitAt INTEGER,
                createdAt INTEGER NOT NULL,
                updatedAt INTEGER NOT NULL
              );
              CREATE TABLE IF NOT EXISTS knowledge_documents (
                id TEXT PRIMARY KEY NOT NULL,
                title TEXT NOT NULL,
                mimeType TEXT NOT NULL,
                size INTEGER NOT NULL,
                chunkCount INTEGER NOT NULL,
                status TEXT NOT NULL,
                error TEXT,
                sourceUri TEXT,
                rawPath TEXT,
                contentHash TEXT,
                createdAt INTEGER NOT NULL,
                updatedAt INTEGER NOT NULL
              );
              CREATE TABLE IF NOT EXISTS knowledge_chunks (
                id TEXT PRIMARY KEY NOT NULL,
                documentId TEXT NOT NULL,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                ordinal INTEGER NOT NULL,
                chunkIndex INTEGER,
                sentenceStart INTEGER,
                sentenceEnd INTEGER,
                semanticBoundary TEXT,
                headingPathJson TEXT,
                entitiesJson TEXT,
                relationsJson TEXT,
                summaryNodeId TEXT,
                parentChunkId TEXT,
                qualityScore REAL,
                embeddingModelId TEXT,
                rerankSignalsJson TEXT,
                embeddingProvider TEXT,
                lastHitAt INTEGER,
                createdAt INTEGER NOT NULL
              );
            `)
            await ensureLegacyColumns(transaction)
            await ensureKnowledgeSearchTables(transaction, searchMode)
          },
        },
      ])
    })()
    try {
      await initialized
    } catch (error) {
      initialized = undefined
      throw error
    }
    throwIfAborted(signal)
    return value
  }

  async function listMemories(input: {
    statuses?: readonly KnowledgeMemoryStatus[]
    signal?: AbortSignal
  } = {}): Promise<readonly KnowledgeMemoryRecord[]> {
    const statuses = normalizeMemoryStatuses(input.statuses)
    const placeholders = statuses.map(() => '?').join(', ')
    const rows = await (await database(input.signal)).getAll<Record<string, unknown>>(
      `SELECT id, content, status, conversationId, sourceKind, sourceDetail, confidence, lastHitAt, createdAt, updatedAt
       FROM memories WHERE status IN (${placeholders}) ORDER BY updatedAt DESC`,
      statuses,
    )
    throwIfAborted(input.signal)
    return rows.map(normalizeMemoryRow)
  }

  async function saveMemory(
    input: KnowledgeMemoryWrite,
    operation: KnowledgeRepositoryOperationOptions = {},
  ): Promise<KnowledgeMemoryRecord> {
    const record = normalizeMemoryWrite(input, clock, ids)
    const value = await database(operation.signal)
    await value.transaction(async (transaction) => {
      await writeMemoryRecord(transaction, record, operation.signal)
    })
    throwIfAborted(operation.signal)
    return record
  }

  async function updateMemoryStatus(
    id: string,
    status: KnowledgeMemoryStatus,
    operation: KnowledgeRepositoryOperationOptions = {},
  ): Promise<void> {
    const memoryId = normalizeIdentifier(id, 'memory id')
    const normalizedStatus = normalizeMemoryStatus(status)
    const value = await database(operation.signal)
    await run(value,
      'UPDATE memories SET status = ?, updatedAt = ? WHERE id = ?',
      [normalizedStatus, clock.now(), memoryId],
      operation.signal,
    )
  }

  async function deleteMemory(id: string, operation: KnowledgeRepositoryOperationOptions = {}): Promise<void> {
    const memoryId = normalizeIdentifier(id, 'memory id')
    const value = await database(operation.signal)
    await value.transaction(async (transaction) => {
      await run(transaction, 'DELETE FROM memory_fts WHERE id = ?', [memoryId], operation.signal)
      await run(transaction, 'DELETE FROM memories WHERE id = ?', [memoryId], operation.signal)
    })
  }

  async function clearMemories(operation: KnowledgeRepositoryOperationOptions = {}): Promise<void> {
    const value = await database(operation.signal)
    await value.transaction(async (transaction) => {
      await run(transaction, 'DELETE FROM memory_fts', [], operation.signal)
      await run(transaction, 'DELETE FROM memories', [], operation.signal)
    })
  }

  async function searchMemories(
    input: KnowledgeMemorySearchInput,
  ): Promise<readonly KnowledgeMemorySearchHit[]> {
    const query = normalizeFtsSearchQuery(input.query)
    if (!query || input.limit <= 0 || !input.statuses.length) {
      throwIfAborted(input.signal)
      return []
    }
    const limit = assertPositiveInteger(input.limit, 'memory search limit')
    const statuses = Array.from(new Set(input.statuses.map(normalizeMemoryStatus)))
    const placeholders = statuses.map(() => '?').join(', ')
    const searchTerms = tokenizeFtsQuery(query).slice(0, 16)
    const ftsQuery = buildFtsQuery(query)
    if (!ftsQuery || !searchTerms.length) return []
    const value = await database(input.signal)
    const candidateLimit = Math.max(limit * 4, limit)
    const rows = searchMode === 'fts5'
      ? await value.getAll<Record<string, unknown>>(
        `SELECT memory.id, memory.content, memory.status, memory.conversationId, memory.sourceKind,
                memory.sourceDetail, memory.confidence, memory.lastHitAt, memory.createdAt, memory.updatedAt,
                bm25(memory_fts) AS score
         FROM memory_fts
         JOIN memories AS memory ON memory.id = memory_fts.id
         WHERE memory_fts MATCH ? AND memory.status IN (${placeholders})
         LIMIT ?`,
        [ftsQuery, ...statuses, candidateLimit],
      )
      : await value.getAll<Record<string, unknown>>(
        `SELECT memory.id, memory.content, memory.status, memory.conversationId, memory.sourceKind,
                memory.sourceDetail, memory.confidence, memory.lastHitAt, memory.createdAt, memory.updatedAt,
                0.0 AS score
         FROM memory_fts
         JOIN memories AS memory ON memory.id = memory_fts.id
         WHERE (${searchTerms.map(() => 'LOWER(memory_fts.content) LIKE ?').join(' OR ')})
           AND memory.status IN (${placeholders})
         ORDER BY memory.updatedAt DESC
         LIMIT ?`,
        [...searchTerms.map(likeSearchPattern), ...statuses, candidateLimit],
      )
    throwIfAborted(input.signal)
    const now = assertTimestamp(clock.now(), 'clock timestamp')
    const ranked = rows
      .map(normalizeMemorySearchRow)
      .sort((left, right) => memoryRankScore(left, now) - memoryRankScore(right, now))
      .slice(0, limit)
    await value.transaction(async (transaction) => {
      for (const memory of ranked) {
        await run(transaction, 'UPDATE memories SET lastHitAt = ? WHERE id = ?', [now, memory.id], input.signal)
      }
      await run(
        transaction,
        "UPDATE memories SET status = 'disabled', updatedAt = ? WHERE status = 'active' AND COALESCE(lastHitAt, updatedAt, createdAt) < ?",
        [now, now - 30 * 24 * 60 * 60 * 1000],
        input.signal,
      )
    })
    return ranked
  }

  async function importMemories(
    memories: readonly KnowledgeMemoryWrite[],
    operation: KnowledgeRepositoryOperationOptions = {},
  ): Promise<readonly KnowledgeMemoryRecord[]> {
    if (!memories.length) {
      throwIfAborted(operation.signal)
      return []
    }
    const value = await database(operation.signal)
    const imported: KnowledgeMemoryRecord[] = []
    await value.transaction(async (transaction) => {
      const existingRows = await transaction.getAll<Record<string, unknown>>(
        'SELECT id, content, status, conversationId, sourceKind, sourceDetail, confidence, lastHitAt, createdAt, updatedAt FROM memories',
      )
      const records = existingRows.map(normalizeMemoryRow)
      for (const input of memories) {
        throwIfAborted(operation.signal)
        const incoming = normalizeMemoryWrite(input, clock, ids)
        const duplicateIndex = findMemoryDuplicateIndex(records, incoming)
        const next = duplicateIndex < 0
          ? incoming
          : mergeMemoryRecords(records[duplicateIndex], incoming, assertTimestamp(clock.now(), 'clock timestamp'))
        if (duplicateIndex < 0) records.push(next)
        else records[duplicateIndex] = next
        await writeMemoryRecord(transaction, next, operation.signal)
        imported.push(next)
      }
    })
    return imported
  }

  async function updateDocumentStatus(
    id: string,
    status: KnowledgeDocumentStatus,
    error?: string,
    operation: KnowledgeRepositoryOperationOptions = {},
  ): Promise<void> {
    const documentId = normalizeIdentifier(id, 'document id')
    const normalizedStatus = normalizeDocumentStatus(status)
    const normalizedError = optionalText(error, 'document error', MAX_DOCUMENT_SOURCE_LENGTH)
    const value = await database(operation.signal)
    await run(
      value,
      'UPDATE knowledge_documents SET status = ?, error = ?, updatedAt = ? WHERE id = ?',
      [normalizedStatus, normalizedError ?? null, clock.now(), documentId],
      operation.signal,
    )
  }

  async function saveDocument(
    document: KnowledgeDocumentRecord,
    chunks: readonly KnowledgeChunkRecord[],
    operation: KnowledgeRepositoryOperationOptions = {},
  ): Promise<void> {
    const normalizedDocument = normalizeDocumentRecord(document)
    const normalizedChunks = chunks.map(normalizeChunkRecord)
    validateDocumentBundle(normalizedDocument, normalizedChunks)
    const value = await database(operation.signal)
    await value.transaction(async (transaction) => {
      await run(transaction, 'DELETE FROM knowledge_fts WHERE documentId = ?', [normalizedDocument.id], operation.signal)
      await run(transaction, 'DELETE FROM knowledge_chunks WHERE documentId = ?', [normalizedDocument.id], operation.signal)
      await run(transaction,
        `INSERT OR REPLACE INTO knowledge_documents (
           id, title, mimeType, size, chunkCount, status, error, sourceUri, rawPath, contentHash, createdAt, updatedAt
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          normalizedDocument.id,
          normalizedDocument.title,
          normalizedDocument.mimeType,
          normalizedDocument.size,
          normalizedDocument.chunkCount,
          normalizedDocument.status,
          normalizedDocument.error ?? null,
          normalizedDocument.sourceUri ?? null,
          normalizedDocument.rawPath ?? null,
          normalizedDocument.contentHash ?? null,
          normalizedDocument.createdAt,
          normalizedDocument.updatedAt,
        ],
        operation.signal,
      )
      for (const chunk of normalizedChunks) {
        await run(transaction,
          `INSERT INTO knowledge_chunks (
             id, documentId, title, content, ordinal, chunkIndex, sentenceStart, sentenceEnd, semanticBoundary,
             headingPathJson, entitiesJson, relationsJson, summaryNodeId, parentChunkId, qualityScore,
             embeddingModelId, rerankSignalsJson, embeddingProvider, lastHitAt, createdAt
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            chunk.id,
            chunk.documentId,
            chunk.title,
            chunk.content,
            chunk.ordinal,
            chunk.chunkIndex ?? null,
            chunk.sentenceStart ?? null,
            chunk.sentenceEnd ?? null,
            chunk.semanticBoundary ?? null,
            serializeOptionalStringArray(chunk.headingPath),
            serializeOptionalStringArray(chunk.entities),
            serializeOptionalStringArray(chunk.relations),
            chunk.summaryNodeId ?? null,
            chunk.parentChunkId ?? null,
            chunk.qualityScore ?? null,
            chunk.embeddingModelId ?? null,
            serializeOptionalNumberRecord(chunk.rerankSignals),
            chunk.embeddingProvider ?? null,
            chunk.lastHitAt ?? null,
            chunk.createdAt,
          ],
          operation.signal,
        )
        await run(transaction,
          'INSERT INTO knowledge_fts (id, documentId, title, content) VALUES (?, ?, ?, ?)',
          [chunk.id, chunk.documentId, chunk.title, chunk.content],
          operation.signal,
        )
      }
    })
    throwIfAborted(operation.signal)
  }

  async function listDocuments(
    operation: KnowledgeRepositoryOperationOptions = {},
  ): Promise<readonly KnowledgeDocumentRecord[]> {
    const rows = await (await database(operation.signal)).getAll<Record<string, unknown>>(
      `SELECT id, title, mimeType, size, chunkCount, status, error, sourceUri, rawPath, contentHash, createdAt, updatedAt
       FROM knowledge_documents ORDER BY updatedAt DESC`,
    )
    throwIfAborted(operation.signal)
    return rows.map(normalizeDocumentRow)
  }

  async function listChunks(
    documentId?: string,
    operation: KnowledgeRepositoryOperationOptions = {},
  ): Promise<readonly KnowledgeChunkRecord[]> {
    const normalizedDocumentId = documentId === undefined ? undefined : normalizeIdentifier(documentId, 'document id')
    const rows = await (await database(operation.signal)).getAll<Record<string, unknown>>(
      normalizedDocumentId
        ? `SELECT id, documentId, title, content, ordinal, chunkIndex, sentenceStart, sentenceEnd, semanticBoundary,
                  headingPathJson, entitiesJson, relationsJson, summaryNodeId, parentChunkId, qualityScore,
                  embeddingModelId, rerankSignalsJson, embeddingProvider, lastHitAt, createdAt
           FROM knowledge_chunks WHERE documentId = ? ORDER BY ordinal ASC`
        : `SELECT id, documentId, title, content, ordinal, chunkIndex, sentenceStart, sentenceEnd, semanticBoundary,
                  headingPathJson, entitiesJson, relationsJson, summaryNodeId, parentChunkId, qualityScore,
                  embeddingModelId, rerankSignalsJson, embeddingProvider, lastHitAt, createdAt
           FROM knowledge_chunks ORDER BY documentId ASC, ordinal ASC`,
      normalizedDocumentId ? [normalizedDocumentId] : [],
    )
    throwIfAborted(operation.signal)
    return rows.map(normalizeChunkRow)
  }

  async function loadSnapshot(
    operation: KnowledgeRepositoryOperationOptions = {},
  ): Promise<KnowledgeRepositorySnapshot> {
    const value = await database(operation.signal)
    const snapshot = await value.transaction(async (transaction) => {
      const [memoryRows, documentRows, chunkRows] = await Promise.all([
        transaction.getAll<Record<string, unknown>>(
          `SELECT id, content, status, conversationId, sourceKind, sourceDetail, confidence, lastHitAt, createdAt, updatedAt
           FROM memories ORDER BY updatedAt DESC, id ASC`,
        ),
        transaction.getAll<Record<string, unknown>>(
          `SELECT id, title, mimeType, size, chunkCount, status, error, sourceUri, rawPath, contentHash, createdAt, updatedAt
           FROM knowledge_documents ORDER BY updatedAt DESC, id ASC`,
        ),
        transaction.getAll<Record<string, unknown>>(
          `SELECT id, documentId, title, content, ordinal, chunkIndex, sentenceStart, sentenceEnd, semanticBoundary,
                  headingPathJson, entitiesJson, relationsJson, summaryNodeId, parentChunkId, qualityScore,
                  embeddingModelId, rerankSignalsJson, embeddingProvider, lastHitAt, createdAt
           FROM knowledge_chunks ORDER BY documentId ASC, ordinal ASC, id ASC`,
        ),
      ])
      throwIfAborted(operation.signal)
      return {
        memories: memoryRows.map(normalizeMemoryRow),
        documents: documentRows.map(normalizeDocumentRow),
        chunks: chunkRows.map(normalizeChunkRow),
      }
    })
    throwIfAborted(operation.signal)
    return snapshot
  }

  async function searchFts(input: KnowledgeFtsSearchInput): Promise<readonly KnowledgeFtsSearchHit[]> {
    const query = normalizeFtsSearchQuery(input.query)
    const limit = assertPositiveInteger(input.limit, 'FTS search limit')
    const searchTerms = tokenizeFtsQuery(query).slice(0, 16)
    const ftsQuery = buildFtsQuery(query)
    if (!ftsQuery || !searchTerms.length) return []

    const value = await database(input.signal)
    const candidateLimit = Math.max(limit * 4, 20)
    const rows = searchMode === 'fts5'
      ? await value.getAll<Record<string, unknown>>(
        `SELECT c.id, c.documentId, c.title, c.content, c.ordinal, c.chunkIndex,
                d.sourceUri, d.rawPath, bm25(knowledge_fts) AS score
         FROM knowledge_fts
         JOIN knowledge_chunks AS c ON c.id = knowledge_fts.id
         LEFT JOIN knowledge_documents AS d ON d.id = c.documentId
         WHERE knowledge_fts MATCH ?
         ORDER BY score
         LIMIT ?`,
        [ftsQuery, candidateLimit],
      )
      : await value.getAll<Record<string, unknown>>(
        `SELECT c.id, c.documentId, c.title, c.content, c.ordinal, c.chunkIndex,
                d.sourceUri, d.rawPath, 0.0 AS score
         FROM knowledge_fts
         JOIN knowledge_chunks AS c ON c.id = knowledge_fts.id
         LEFT JOIN knowledge_documents AS d ON d.id = c.documentId
         WHERE (${searchTerms.map(() => '(LOWER(knowledge_fts.title) LIKE ? OR LOWER(knowledge_fts.content) LIKE ?)').join(' OR ')})
         ORDER BY c.ordinal ASC
         LIMIT ?`,
        [...searchTerms.flatMap((term) => [likeSearchPattern(term), likeSearchPattern(term)]), candidateLimit],
      )
    throwIfAborted(input.signal)
    return rows.map(normalizeFtsSearchRow)
  }

  async function markFtsHits(
    chunkIds: readonly string[],
    operation: KnowledgeRepositoryOperationOptions = {},
  ): Promise<void> {
    const idsToMark = Array.from(new Set(chunkIds.map((id) => normalizeIdentifier(id, 'chunk id'))))
    if (!idsToMark.length) {
      throwIfAborted(operation.signal)
      return
    }
    const value = await database(operation.signal)
    const timestamp = assertTimestamp(clock.now(), 'clock timestamp')
    await value.transaction(async (transaction) => {
      for (const chunkId of idsToMark) {
        await run(
          transaction,
          'UPDATE knowledge_chunks SET lastHitAt = ? WHERE id = ?',
          [timestamp, chunkId],
          operation.signal,
        )
      }
    })
    throwIfAborted(operation.signal)
  }

  async function deleteDocument(id: string, operation: KnowledgeRepositoryOperationOptions = {}): Promise<void> {
    const documentId = normalizeIdentifier(id, 'document id')
    const value = await database(operation.signal)
    await value.transaction(async (transaction) => {
      await run(transaction, 'DELETE FROM knowledge_fts WHERE documentId = ?', [documentId], operation.signal)
      await run(transaction, 'DELETE FROM knowledge_chunks WHERE documentId = ?', [documentId], operation.signal)
      await run(transaction, 'DELETE FROM knowledge_documents WHERE id = ?', [documentId], operation.signal)
    })
  }

  async function clearDocuments(operation: KnowledgeRepositoryOperationOptions = {}): Promise<void> {
    const value = await database(operation.signal)
    await value.transaction(async (transaction) => {
      await run(transaction, 'DELETE FROM knowledge_fts', [], operation.signal)
      await run(transaction, 'DELETE FROM knowledge_chunks', [], operation.signal)
      await run(transaction, 'DELETE FROM knowledge_documents', [], operation.signal)
    })
  }

  async function replaceSnapshot(
    snapshot: KnowledgeRepositorySnapshot,
    operation: KnowledgeRepositoryOperationOptions = {},
  ): Promise<void> {
    const prepared = prepareReplacementSnapshot(snapshot)
    const { documents, chunks } = prepared
    const memories = prepared.memories as readonly KnowledgeMemoryRecord[]
    const value = await database(operation.signal)
    await value.transaction(async (transaction) => {
      await run(transaction, 'DELETE FROM memory_fts', [], operation.signal)
      await run(transaction, 'DELETE FROM memories', [], operation.signal)
      await run(transaction, 'DELETE FROM knowledge_fts', [], operation.signal)
      await run(transaction, 'DELETE FROM knowledge_chunks', [], operation.signal)
      await run(transaction, 'DELETE FROM knowledge_documents', [], operation.signal)
      for (const memory of memories) await writeMemoryRecord(transaction, memory, operation.signal)
      for (const document of documents) await writeDocumentRecord(transaction, document, operation.signal)
      for (const chunk of chunks) await writeChunkRecord(transaction, chunk, operation.signal)
    })
    throwIfAborted(operation.signal)
  }

  function prepareReplacementSnapshot(
    snapshot: KnowledgeRepositorySnapshot,
  ): KnowledgeRepositorySnapshot {
    const documents = snapshot.documents.map(normalizeDocumentRecord)
    const chunks = snapshot.chunks.map(normalizeChunkRecord)
    const memories: KnowledgeMemoryRecord[] = []
    for (const input of snapshot.memories) {
      const incoming = normalizeMemoryWrite(input, clock, ids)
      const duplicateIndex = findMemoryDuplicateIndex(memories, incoming)
      if (duplicateIndex < 0) {
        memories.push(incoming)
      } else {
        memories[duplicateIndex] = mergeMemoryRecords(
          memories[duplicateIndex],
          incoming,
          assertTimestamp(clock.now(), 'clock timestamp'),
        )
      }
    }
    return { memories, documents, chunks }
  }

  return {
    async listAll(operation) {
      return (await listMemories({ signal: operation?.signal })).map(({ content }) => ({ content }))
    },

    async addPending(candidate: PendingMemoryCandidate, operation) {
      const memory = await saveMemory({
        content: candidate.content,
        status: 'pending',
        conversationId: candidate.conversationId,
        sourceKind: candidate.sourceKind,
        sourceDetail: candidate.sourceDetail,
        confidence: candidate.confidence,
      }, operation)
      return { content: memory.content }
    },

    listMemories,
    saveMemory,
    updateMemoryStatus,
    deleteMemory,
    clearMemories,
    searchMemories,
    importMemories,
    loadSnapshot,
    prepareReplacementSnapshot,
    saveDocument,
    updateDocumentStatus,
    listDocuments,
    listChunks,
    searchFts,
    markFtsHits,
    deleteDocument,
    clearDocuments,
    replaceSnapshot,
  }
}

async function ensureLegacyColumns(database: SqliteExecutor): Promise<void> {
  await ensureColumns(database, 'memories', [
    ['conversationId', 'TEXT'],
    ['sourceKind', 'TEXT'],
    ['sourceDetail', 'TEXT'],
    ['confidence', 'REAL'],
    ['lastHitAt', 'INTEGER'],
  ])
  await ensureColumns(database, 'knowledge_documents', [
    ['sourceUri', 'TEXT'],
    ['rawPath', 'TEXT'],
    ['contentHash', 'TEXT'],
  ])
  await ensureColumns(database, 'knowledge_chunks', [
    ['chunkIndex', 'INTEGER'],
    ['sentenceStart', 'INTEGER'],
    ['sentenceEnd', 'INTEGER'],
    ['semanticBoundary', 'TEXT'],
    ['headingPathJson', 'TEXT'],
    ['entitiesJson', 'TEXT'],
    ['relationsJson', 'TEXT'],
    ['summaryNodeId', 'TEXT'],
    ['parentChunkId', 'TEXT'],
    ['qualityScore', 'REAL'],
    ['embeddingModelId', 'TEXT'],
    ['rerankSignalsJson', 'TEXT'],
    ['embeddingProvider', 'TEXT'],
    ['lastHitAt', 'INTEGER'],
  ])
}

async function ensureColumns(
  database: SqliteExecutor,
  table: 'memories' | 'knowledge_documents' | 'knowledge_chunks',
  columns: readonly (readonly [string, string])[],
): Promise<void> {
  const existing = await database.getAll<ColumnRow>(`PRAGMA table_info(${table})`)
  const names = new Set(existing.map((column) => column.name))
  for (const [name, definition] of columns) {
    if (names.has(name)) continue
    await database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
  }
}

async function run(
  database: SqliteExecutor,
  source: string,
  parameters: readonly SqliteValue[],
  signal: AbortSignal | undefined,
): Promise<void> {
  throwIfAborted(signal)
  await database.run(source, parameters)
  throwIfAborted(signal)
}

async function writeMemoryRecord(
  database: SqliteExecutor,
  record: KnowledgeMemoryRecord,
  signal: AbortSignal | undefined,
): Promise<void> {
  await run(database,
    `INSERT OR REPLACE INTO memories (
       id, content, status, conversationId, sourceKind, sourceDetail, confidence, lastHitAt, createdAt, updatedAt
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.content,
      record.status,
      record.conversationId ?? null,
      record.sourceKind,
      record.sourceDetail ?? null,
      record.confidence ?? null,
      record.lastHitAt ?? null,
      record.createdAt,
      record.updatedAt,
    ],
    signal,
  )
  await run(database, 'DELETE FROM memory_fts WHERE id = ?', [record.id], signal)
  await run(database, 'INSERT INTO memory_fts (id, content) VALUES (?, ?)', [record.id, record.content], signal)
}

async function writeDocumentRecord(
  database: SqliteExecutor,
  document: KnowledgeDocumentRecord,
  signal: AbortSignal | undefined,
): Promise<void> {
  await run(database,
    `INSERT OR REPLACE INTO knowledge_documents (
       id, title, mimeType, size, chunkCount, status, error, sourceUri, rawPath, contentHash, createdAt, updatedAt
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      document.id,
      document.title,
      document.mimeType,
      document.size,
      document.chunkCount,
      document.status,
      document.error ?? null,
      document.sourceUri ?? null,
      document.rawPath ?? null,
      document.contentHash ?? null,
      document.createdAt,
      document.updatedAt,
    ],
    signal,
  )
}

async function writeChunkRecord(
  database: SqliteExecutor,
  chunk: KnowledgeChunkRecord,
  signal: AbortSignal | undefined,
): Promise<void> {
  await run(database,
    `INSERT OR REPLACE INTO knowledge_chunks (
       id, documentId, title, content, ordinal, chunkIndex, sentenceStart, sentenceEnd, semanticBoundary,
       headingPathJson, entitiesJson, relationsJson, summaryNodeId, parentChunkId, qualityScore,
       embeddingModelId, rerankSignalsJson, embeddingProvider, lastHitAt, createdAt
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      chunk.id,
      chunk.documentId,
      chunk.title,
      chunk.content,
      chunk.ordinal,
      chunk.chunkIndex ?? null,
      chunk.sentenceStart ?? null,
      chunk.sentenceEnd ?? null,
      chunk.semanticBoundary ?? null,
      serializeOptionalStringArray(chunk.headingPath),
      serializeOptionalStringArray(chunk.entities),
      serializeOptionalStringArray(chunk.relations),
      chunk.summaryNodeId ?? null,
      chunk.parentChunkId ?? null,
      chunk.qualityScore ?? null,
      chunk.embeddingModelId ?? null,
      serializeOptionalNumberRecord(chunk.rerankSignals),
      chunk.embeddingProvider ?? null,
      chunk.lastHitAt ?? null,
      chunk.createdAt,
    ],
    signal,
  )
  await run(
    database,
    'DELETE FROM knowledge_fts WHERE id = ?',
    [chunk.id],
    signal,
  )
  await run(
    database,
    'INSERT INTO knowledge_fts (id, documentId, title, content) VALUES (?, ?, ?, ?)',
    [chunk.id, chunk.documentId, chunk.title, chunk.content],
    signal,
  )
}

function normalizeMemoryWrite(input: KnowledgeMemoryWrite, clock: Clock, ids: IdGenerator): KnowledgeMemoryRecord {
  const now = assertTimestamp(clock.now(), 'clock timestamp')
  return normalizeMemoryRow({
    id: input.id ?? ids.next('memory'),
    content: input.content,
    status: input.status,
    conversationId: input.conversationId,
    sourceKind: input.sourceKind,
    sourceDetail: input.sourceDetail,
    confidence: input.confidence,
    lastHitAt: input.lastHitAt,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  })
}

function normalizeMemoryRow(value: unknown): KnowledgeMemoryRecord {
  const parsed = v.safeParse(memoryRowSchema, value)
  if (!parsed.success) throw new KnowledgeRepositoryDataError('A persisted memory record is invalid.')
  const row = parsed.output
  const sourceKind = normalizeMemorySourceKind(row.sourceKind)
  return {
    schema: KNOWLEDGE_MEMORY_RECORD_SCHEMA,
    id: normalizeIdentifier(row.id, 'memory id'),
    content: normalizeMemoryContent(row.content),
    status: normalizeMemoryStatus(row.status),
    ...(optionalText(row.conversationId, 'memory conversation id', 256) === undefined ? {} : { conversationId: optionalText(row.conversationId, 'memory conversation id', 256) }),
    sourceKind,
    ...(optionalText(row.sourceDetail, 'memory source detail', 512) === undefined ? {} : { sourceDetail: optionalText(row.sourceDetail, 'memory source detail', 512) }),
    ...(optionalConfidence(row.confidence) === undefined ? {} : { confidence: optionalConfidence(row.confidence) }),
    ...(optionalTimestamp(row.lastHitAt, 'memory last-hit timestamp') === undefined ? {} : { lastHitAt: optionalTimestamp(row.lastHitAt, 'memory last-hit timestamp') }),
    createdAt: assertTimestamp(row.createdAt, 'memory creation timestamp'),
    updatedAt: assertTimestamp(row.updatedAt, 'memory update timestamp'),
  }
}

function normalizeMemorySearchRow(value: unknown): KnowledgeMemorySearchHit {
  const parsed = v.safeParse(memorySearchRowSchema, value)
  if (!parsed.success) throw new KnowledgeRepositoryDataError('A persisted memory search row is invalid.')
  return {
    ...normalizeMemoryRow(parsed.output),
    score: assertFiniteNumber(parsed.output.score, 'memory FTS score'),
  }
}

function memoryRankScore(memory: KnowledgeMemorySearchHit, now: number): number {
  const ageDays = Math.max(0, (now - memory.createdAt) / 86_400_000)
  const recencyBoost = Math.exp(-ageDays / 30)
  const confidence = memory.confidence ?? defaultMemoryConfidence(memory.sourceKind)
  const confidencePenalty = 1 + (1 - confidence) * 0.3
  return (Math.abs(memory.score) * confidencePenalty) / Math.max(recencyBoost, 0.05)
}

function findMemoryDuplicateIndex(
  memories: readonly KnowledgeMemoryRecord[],
  incoming: KnowledgeMemoryRecord,
): number {
  const byId = memories.findIndex((memory) => memory.id === incoming.id)
  if (byId >= 0) return byId
  let match = -1
  for (let index = 0; index < memories.length; index += 1) {
    if (memories[index].content !== incoming.content) continue
    if (match < 0 || compareMemoryMergePriority(memories[index], memories[match]) < 0) match = index
  }
  return match
}

function compareMemoryMergePriority(left: KnowledgeMemoryRecord, right: KnowledgeMemoryRecord): number {
  return memoryStatusMergeRank(left.status) - memoryStatusMergeRank(right.status) ||
    memorySourceKindSortRank(left.sourceKind) - memorySourceKindSortRank(right.sourceKind) ||
    right.updatedAt - left.updatedAt
}

function mergeMemoryRecords(
  existing: KnowledgeMemoryRecord,
  incoming: KnowledgeMemoryRecord,
  now: number,
): KnowledgeMemoryRecord {
  const sourceKind = strongerMemorySourceKind(existing.sourceKind, incoming.sourceKind)
  return {
    schema: KNOWLEDGE_MEMORY_RECORD_SCHEMA,
    id: existing.id,
    content: existing.content,
    status: mergeMemoryStatus(existing.status, incoming.status),
    ...(existing.conversationId ?? incoming.conversationId
      ? { conversationId: existing.conversationId ?? incoming.conversationId }
      : {}),
    sourceKind,
    ...(mergeMemorySourceDetails(existing.sourceDetail, incoming.sourceDetail) === undefined
      ? {}
      : { sourceDetail: mergeMemorySourceDetails(existing.sourceDetail, incoming.sourceDetail) }),
    confidence: Math.max(
      existing.confidence ?? defaultMemoryConfidence(existing.sourceKind),
      incoming.confidence ?? defaultMemoryConfidence(incoming.sourceKind),
    ),
    ...(maxOptionalTimestamp(existing.lastHitAt, incoming.lastHitAt) === undefined
      ? {}
      : { lastHitAt: maxOptionalTimestamp(existing.lastHitAt, incoming.lastHitAt) }),
    createdAt: Math.min(existing.createdAt, incoming.createdAt),
    updatedAt: Math.max(existing.updatedAt, incoming.updatedAt, now),
  }
}

function mergeMemoryStatus(left: KnowledgeMemoryStatus, right: KnowledgeMemoryStatus): KnowledgeMemoryStatus {
  if (left === 'active' || right === 'active') return 'active'
  if (left === 'pending' || right === 'pending') return 'pending'
  return 'disabled'
}

function memoryStatusMergeRank(status: KnowledgeMemoryStatus): number {
  if (status === 'active') return 0
  if (status === 'pending') return 1
  return 2
}

function strongerMemorySourceKind(
  left: KnowledgeMemorySourceKind,
  right: KnowledgeMemorySourceKind,
): KnowledgeMemorySourceKind {
  return memorySourceKindRank(left) >= memorySourceKindRank(right) ? left : right
}

function memorySourceKindSortRank(sourceKind: KnowledgeMemorySourceKind): number {
  return 5 - memorySourceKindRank(sourceKind)
}

function memorySourceKindRank(sourceKind: KnowledgeMemorySourceKind): number {
  switch (sourceKind) {
    case 'manual':
      return 5
    case 'deterministic':
      return 4
    case 'model':
      return 3
    case 'imported':
      return 2
    case 'legacy':
    default:
      return 1
  }
}

function mergeMemorySourceDetails(...values: Array<string | undefined>): string | undefined {
  const parts: string[] = []
  for (const value of values) {
    const detail = value?.replace(/\s+/g, ' ').trim()
    if (detail && !parts.includes(detail)) parts.push(detail)
  }
  return parts.length ? parts.join('; ') : undefined
}

function maxOptionalTimestamp(...values: Array<number | undefined>): number | undefined {
  const timestamps = values.filter((value): value is number => typeof value === 'number')
  return timestamps.length ? Math.max(...timestamps) : undefined
}

function defaultMemoryConfidence(sourceKind: KnowledgeMemorySourceKind): number {
  switch (sourceKind) {
    case 'manual':
      return 1
    case 'deterministic':
      return 0.82
    case 'model':
      return 0.68
    case 'imported':
      return 0.74
    case 'legacy':
    default:
      return 0.5
  }
}

function normalizeDocumentRow(value: unknown): KnowledgeDocumentRecord {
  const parsed = v.safeParse(documentRowSchema, value)
  if (!parsed.success) throw new KnowledgeRepositoryDataError('A persisted knowledge document is invalid.')
  const row = parsed.output
  return {
    schema: KNOWLEDGE_DOCUMENT_RECORD_SCHEMA,
    id: normalizeIdentifier(row.id, 'document id'),
    title: normalizeRequiredText(row.title, 'document title', MAX_DOCUMENT_TITLE_LENGTH),
    mimeType: normalizeRequiredText(row.mimeType, 'document MIME type', 256),
    size: assertNonNegativeInteger(row.size, 'document size'),
    chunkCount: assertNonNegativeInteger(row.chunkCount, 'document chunk count'),
    status: normalizeDocumentStatus(row.status),
    ...(optionalText(row.error, 'document error', 1_200) === undefined ? {} : { error: optionalText(row.error, 'document error', 1_200) }),
    ...(optionalText(row.sourceUri, 'document source URI', MAX_DOCUMENT_SOURCE_LENGTH) === undefined ? {} : { sourceUri: optionalText(row.sourceUri, 'document source URI', MAX_DOCUMENT_SOURCE_LENGTH) }),
    ...(optionalText(row.rawPath, 'document raw path', MAX_DOCUMENT_SOURCE_LENGTH) === undefined ? {} : { rawPath: optionalText(row.rawPath, 'document raw path', MAX_DOCUMENT_SOURCE_LENGTH) }),
    ...(optionalText(row.contentHash, 'document content hash', 512) === undefined ? {} : { contentHash: optionalText(row.contentHash, 'document content hash', 512) }),
    createdAt: assertTimestamp(row.createdAt, 'document creation timestamp'),
    updatedAt: assertTimestamp(row.updatedAt, 'document update timestamp'),
  }
}

function normalizeDocumentRecord(value: KnowledgeDocumentRecord): KnowledgeDocumentRecord {
  if (value.schema !== KNOWLEDGE_DOCUMENT_RECORD_SCHEMA) {
    throw new KnowledgeRepositoryDataError('A knowledge document schema is invalid.')
  }
  return normalizeDocumentRow(value)
}

function normalizeChunkRow(value: unknown): KnowledgeChunkRecord {
  const parsed = v.safeParse(chunkRowSchema, value)
  if (!parsed.success) throw new KnowledgeRepositoryDataError('A persisted knowledge chunk is invalid.')
  const row = parsed.output
  return {
    schema: KNOWLEDGE_CHUNK_RECORD_SCHEMA,
    id: normalizeIdentifier(row.id, 'chunk id'),
    documentId: normalizeIdentifier(row.documentId, 'chunk document id'),
    title: normalizeRequiredText(row.title, 'chunk title', MAX_DOCUMENT_TITLE_LENGTH),
    content: normalizeRequiredText(row.content, 'chunk content', MAX_CHUNK_CONTENT_LENGTH),
    ordinal: assertNonNegativeInteger(row.ordinal, 'chunk ordinal'),
    ...(optionalNonNegativeInteger(row.chunkIndex, 'chunk index') === undefined ? {} : { chunkIndex: optionalNonNegativeInteger(row.chunkIndex, 'chunk index') }),
    ...(optionalNonNegativeInteger(row.sentenceStart, 'chunk sentence start') === undefined ? {} : { sentenceStart: optionalNonNegativeInteger(row.sentenceStart, 'chunk sentence start') }),
    ...(optionalNonNegativeInteger(row.sentenceEnd, 'chunk sentence end') === undefined ? {} : { sentenceEnd: optionalNonNegativeInteger(row.sentenceEnd, 'chunk sentence end') }),
    ...(optionalText(row.semanticBoundary, 'chunk semantic boundary', 128) === undefined ? {} : { semanticBoundary: optionalText(row.semanticBoundary, 'chunk semantic boundary', 128) }),
    ...(parseOptionalStringArray(row.headingPathJson, 'chunk heading path') === undefined ? {} : { headingPath: parseOptionalStringArray(row.headingPathJson, 'chunk heading path') }),
    ...(parseOptionalStringArray(row.entitiesJson, 'chunk entities') === undefined ? {} : { entities: parseOptionalStringArray(row.entitiesJson, 'chunk entities') }),
    ...(parseOptionalStringArray(row.relationsJson, 'chunk relations') === undefined ? {} : { relations: parseOptionalStringArray(row.relationsJson, 'chunk relations') }),
    ...(optionalText(row.summaryNodeId, 'chunk summary node id', 512) === undefined ? {} : { summaryNodeId: optionalText(row.summaryNodeId, 'chunk summary node id', 512) }),
    ...(optionalText(row.parentChunkId, 'chunk parent chunk id', 512) === undefined ? {} : { parentChunkId: optionalText(row.parentChunkId, 'chunk parent chunk id', 512) }),
    ...(optionalQualityScore(row.qualityScore) === undefined ? {} : { qualityScore: optionalQualityScore(row.qualityScore) }),
    ...(optionalText(row.embeddingModelId, 'chunk embedding model id', 512) === undefined ? {} : { embeddingModelId: optionalText(row.embeddingModelId, 'chunk embedding model id', 512) }),
    ...(parseOptionalNumberRecord(row.rerankSignalsJson, 'chunk rerank signals') === undefined ? {} : { rerankSignals: parseOptionalNumberRecord(row.rerankSignalsJson, 'chunk rerank signals') }),
    ...(optionalEmbeddingProvider(row.embeddingProvider) === undefined ? {} : { embeddingProvider: optionalEmbeddingProvider(row.embeddingProvider) }),
    ...(optionalTimestamp(row.lastHitAt, 'chunk last-hit timestamp') === undefined ? {} : { lastHitAt: optionalTimestamp(row.lastHitAt, 'chunk last-hit timestamp') }),
    createdAt: assertTimestamp(row.createdAt, 'chunk creation timestamp'),
  }
}

function normalizeChunkRecord(value: KnowledgeChunkRecord): KnowledgeChunkRecord {
  if (value.schema !== KNOWLEDGE_CHUNK_RECORD_SCHEMA) {
    throw new KnowledgeRepositoryDataError('A knowledge chunk schema is invalid.')
  }
  return normalizeChunkRow({
    ...value,
    headingPathJson: serializeOptionalStringArray(value.headingPath),
    entitiesJson: serializeOptionalStringArray(value.entities),
    relationsJson: serializeOptionalStringArray(value.relations),
    rerankSignalsJson: serializeOptionalNumberRecord(value.rerankSignals),
  })
}

function normalizeFtsSearchRow(value: unknown): KnowledgeFtsSearchHit {
  const parsed = v.safeParse(ftsSearchRowSchema, value)
  if (!parsed.success) throw new KnowledgeRepositoryDataError('A persisted FTS search row is invalid.')
  const row = parsed.output
  return {
    id: normalizeIdentifier(row.id, 'chunk id'),
    documentId: normalizeIdentifier(row.documentId, 'chunk document id'),
    title: normalizeRequiredText(row.title, 'chunk title', MAX_DOCUMENT_TITLE_LENGTH),
    content: normalizeRequiredText(row.content, 'chunk content', MAX_CHUNK_CONTENT_LENGTH),
    ordinal: assertNonNegativeInteger(row.ordinal, 'chunk ordinal'),
    ...(optionalNonNegativeInteger(row.chunkIndex, 'chunk index') === undefined
      ? {}
      : { chunkIndex: optionalNonNegativeInteger(row.chunkIndex, 'chunk index') }),
    ...(optionalText(row.sourceUri, 'document source URI', MAX_DOCUMENT_SOURCE_LENGTH) === undefined
      ? {}
      : { sourceUri: optionalText(row.sourceUri, 'document source URI', MAX_DOCUMENT_SOURCE_LENGTH) }),
    ...(optionalText(row.rawPath, 'document raw path', MAX_DOCUMENT_SOURCE_LENGTH) === undefined
      ? {}
      : { rawPath: optionalText(row.rawPath, 'document raw path', MAX_DOCUMENT_SOURCE_LENGTH) }),
    score: assertFiniteNumber(row.score, 'FTS score'),
  }
}

function validateDocumentBundle(
  document: KnowledgeDocumentRecord,
  chunks: readonly KnowledgeChunkRecord[],
): void {
  if (document.chunkCount !== chunks.length) {
    throw new KnowledgeRepositoryDataError('The document chunk count does not match its chunk records.')
  }
  const ids = new Set<string>()
  const ordinals = new Set<number>()
  for (const chunk of chunks) {
    if (chunk.documentId !== document.id || ids.has(chunk.id) || ordinals.has(chunk.ordinal)) {
      throw new KnowledgeRepositoryDataError('The document chunk records are inconsistent.')
    }
    ids.add(chunk.id)
    ordinals.add(chunk.ordinal)
  }
}

function normalizeMemoryStatuses(statuses: readonly KnowledgeMemoryStatus[] | undefined): KnowledgeMemoryStatus[] {
  const input = statuses?.length ? statuses : ['pending', 'active', 'disabled']
  return Array.from(new Set(input.map(normalizeMemoryStatus)))
}

function normalizeMemoryStatus(value: string): KnowledgeMemoryStatus {
  if (value === 'pending' || value === 'active' || value === 'disabled') return value
  throw new KnowledgeRepositoryDataError('A memory status is invalid.')
}

function normalizeMemorySourceKind(value: string | null | undefined): KnowledgeMemorySourceKind {
  if (value === undefined || value === null || !value.trim()) return 'legacy'
  if (value === 'manual' || value === 'deterministic' || value === 'model' || value === 'imported' || value === 'legacy') return value
  throw new KnowledgeRepositoryDataError('A memory source kind is invalid.')
}

function normalizeDocumentStatus(value: string): KnowledgeDocumentStatus {
  if (value === 'ready' || value === 'extracting' || value === 'error') return value
  throw new KnowledgeRepositoryDataError('A knowledge document status is invalid.')
}

function optionalEmbeddingProvider(value: string | null | undefined): KnowledgeEmbeddingProvider | undefined {
  if (value === undefined || value === null || !value.trim()) return undefined
  if (value === 'hash' || value === 'provider' || value === 'onnx') return value
  throw new KnowledgeRepositoryDataError('A chunk embedding provider is invalid.')
}

function normalizeIdentifier(value: string, label: string): string {
  return normalizeRequiredText(value, label, 512)
}

function normalizeRequiredText(value: string, label: string, limit: number): string {
  const text = value.trim()
  if (!text || text.length > limit) throw new KnowledgeRepositoryDataError(`The ${label} is invalid.`)
  return text
}

function normalizeMemoryContent(value: string): string {
  return normalizeRequiredText(value.replace(/\s+/g, ' '), 'memory content', MAX_MEMORY_CONTENT_LENGTH)
}

function optionalText(value: string | null | undefined, label: string, limit: number): string | undefined {
  if (value === undefined || value === null) return undefined
  const text = value.trim()
  if (!text) return undefined
  if (text.length > limit) throw new KnowledgeRepositoryDataError(`The ${label} is invalid.`)
  return text
}

function assertTimestamp(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new KnowledgeRepositoryDataError(`The ${label} is invalid.`)
  return value
}

function optionalTimestamp(value: number | null | undefined, label: string): number | undefined {
  if (value === undefined || value === null) return undefined
  return assertTimestamp(value, label)
}

function assertNonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new KnowledgeRepositoryDataError(`The ${label} is invalid.`)
  return value
}

function assertPositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > Math.floor(Number.MAX_SAFE_INTEGER / 4)) {
    throw new KnowledgeRepositoryDataError(`The ${label} is invalid.`)
  }
  return value
}

function assertFiniteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new KnowledgeRepositoryDataError(`The ${label} is invalid.`)
  return value
}

function optionalNonNegativeInteger(value: number | null | undefined, label: string): number | undefined {
  if (value === undefined || value === null) return undefined
  return assertNonNegativeInteger(value, label)
}

function optionalConfidence(value: number | null | undefined): number | undefined {
  if (value === undefined || value === null) return undefined
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new KnowledgeRepositoryDataError('A memory confidence value is invalid.')
  return value
}

function optionalQualityScore(value: number | null | undefined): number | undefined {
  if (value === undefined || value === null) return undefined
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new KnowledgeRepositoryDataError('A chunk quality score is invalid.')
  return value
}

function parseOptionalStringArray(value: string | null | undefined, label: string): readonly string[] | undefined {
  if (value === undefined || value === null) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new KnowledgeRepositoryDataError(`The ${label} is invalid.`)
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_METADATA_ITEMS) {
    throw new KnowledgeRepositoryDataError(`The ${label} is invalid.`)
  }
  return parsed.map((item) => {
    if (typeof item !== 'string') throw new KnowledgeRepositoryDataError(`The ${label} is invalid.`)
    return normalizeRequiredText(item, label, 512)
  })
}

function parseOptionalNumberRecord(value: string | null | undefined, label: string): Readonly<Record<string, number>> | undefined {
  if (value === undefined || value === null) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new KnowledgeRepositoryDataError(`The ${label} is invalid.`)
  }
  if (!isRecord(parsed) || Object.keys(parsed).length > MAX_METADATA_ITEMS) {
    throw new KnowledgeRepositoryDataError(`The ${label} is invalid.`)
  }
  const result: Record<string, number> = {}
  for (const [key, entry] of Object.entries(parsed)) {
    const normalizedKey = normalizeRequiredText(key, label, 128)
    if (typeof entry !== 'number' || !Number.isFinite(entry)) {
      throw new KnowledgeRepositoryDataError(`The ${label} is invalid.`)
    }
    result[normalizedKey] = entry
  }
  return result
}

function serializeOptionalStringArray(value: readonly string[] | undefined): string | null {
  return value === undefined ? null : JSON.stringify(value)
}

function serializeOptionalNumberRecord(value: Readonly<Record<string, number>> | undefined): string | null {
  return value === undefined ? null : JSON.stringify(value)
}

function normalizeFtsSearchQuery(value: string): string {
  const query = value.trim()
  if (query.length > MAX_FTS_QUERY_LENGTH) {
    throw new KnowledgeRepositoryDataError('The FTS search query is invalid.')
  }
  return query
}

function buildFtsQuery(query: string): string {
  const words = tokenizeFtsQuery(query).slice(0, 16)
  if (!words.length) return ''
  return words.map((word) => `"${word}"`).join(' OR ')
}

function likeSearchPattern(term: string): string {
  return `%${term.toLowerCase()}%`
}

async function resolveSqliteKnowledgeSearchMode(database: SqliteExecutor): Promise<SqliteKnowledgeSearchMode> {
  const row = await database.getFirst<SqliteCompileOptionRow>(
    "SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled",
  )
  if (!row || row.enabled === undefined || row.enabled === null) return 'fts5'
  return Number(row.enabled) === 1 ? 'fts5' : 'plain'
}

async function ensureKnowledgeSearchTables(
  database: SqliteExecutor,
  mode: SqliteKnowledgeSearchMode,
): Promise<void> {
  await database.exec(mode === 'fts5'
    ? `
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(id UNINDEXED, content);
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(id UNINDEXED, documentId UNINDEXED, title UNINDEXED, content);
    `
    : `
      CREATE TABLE IF NOT EXISTS memory_fts (
        id TEXT PRIMARY KEY NOT NULL,
        content TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS knowledge_fts (
        id TEXT PRIMARY KEY NOT NULL,
        documentId TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL
      );
    `)
  await database.exec(`
    INSERT INTO memory_fts (id, content)
    SELECT memory.id, memory.content
    FROM memories AS memory
    WHERE NOT EXISTS (SELECT 1 FROM memory_fts AS indexed WHERE indexed.id = memory.id);
    INSERT INTO knowledge_fts (id, documentId, title, content)
    SELECT chunk.id, chunk.documentId, chunk.title, chunk.content
    FROM knowledge_chunks AS chunk
    WHERE NOT EXISTS (SELECT 1 FROM knowledge_fts AS indexed WHERE indexed.id = chunk.id);
  `)
}

function tokenizeFtsQuery(query: string): string[] {
  const normalized = query
    .replace(/["'`]/g, ' ')
    .replace(/[_/\\|.,;:!?()[\]{}<>+=*&^%$#@~，。！？；：（）【】《》、]/g, ' ')
    .toLowerCase()
  const matches = normalized.match(/[a-z0-9]+|[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g) ?? []
  const tokens = new Set<string>()
  for (const match of matches) {
    if (/^[a-z0-9]+$/.test(match)) {
      if (match.length >= 2) tokens.add(match)
      continue
    }
    if (match.length <= 4) {
      tokens.add(match)
      continue
    }
    for (let index = 0; index < match.length - 1; index += 1) {
      tokens.add(match.slice(index, index + 2))
    }
  }
  return [...tokens].filter((token) => token.length >= 2)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new KnowledgeRepositoryCancelledError()
}

function createSystemIdGenerator(clock: Clock): IdGenerator {
  let sequence = 0
  return {
    next(prefix) {
      sequence += 1
      return `${prefix}-${clock.now().toString(36)}-${sequence.toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    },
  }
}
