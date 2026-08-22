import { systemClock, type Clock, type IdGenerator } from '@/core'
import {
  applySqliteMigrations,
  type SqliteDatabaseProvider,
  type SqliteExecutor,
  type SqliteValue,
} from '@/platform/storage'
import * as v from 'valibot'
import {
  LOCAL_USER_MEMORY_SCOPE_ID,
  KNOWLEDGE_CHUNK_RECORD_SCHEMA,
  KNOWLEDGE_DOCUMENT_RECORD_SCHEMA,
  KNOWLEDGE_MEMORY_RECORD_SCHEMA,
  type KnowledgeChunkRecord,
  type KnowledgeDocumentRecord,
  type KnowledgeDocumentStatus,
  type KnowledgeEmbeddingProvider,
  type KnowledgeFtsSearchHit,
  type KnowledgeFtsSearchInput,
  type KnowledgeMemoryListInput,
  type KnowledgeMemoryRecord,
  type KnowledgeMemoryScope,
  type KnowledgeMemorySearchHit,
  type KnowledgeMemorySearchInput,
  type KnowledgeMemorySensitivity,
  type KnowledgeMemorySourceKind,
  type KnowledgeMemoryScopeKind,
  type KnowledgeMemoryStatus,
  type KnowledgeMemoryWrite,
  type KnowledgeRepository,
  type KnowledgeRepositoryOperationOptions,
  type KnowledgeRepositorySnapshot,
  type PendingMemoryCandidate,
} from '../contracts'

const MIGRATION_SCOPE = 'knowledge'
const MIGRATION_VERSION = 3
const MAX_MEMORY_CONTENT_LENGTH = 4_000
const MAX_MEMORY_FACT_FIELD_LENGTH = 512
const MAX_MEMORY_SOURCE_MESSAGE_IDS = 64
const MAX_DOCUMENT_TITLE_LENGTH = 512
const MAX_DOCUMENT_SOURCE_LENGTH = 2_048
const MAX_CHUNK_CONTENT_LENGTH = 24_000
const MAX_METADATA_ITEMS = 64
const MAX_FTS_QUERY_LENGTH = 16_384

const MEMORY_SELECT_COLUMNS = `id, content, status, scopeKind, scopeId, subject, factKey, factValue,
  sensitivity, sourceMessageIdsJson, validFrom, validUntil, supersedesId, conflictWithId,
  conversationId, sourceKind, sourceDetail, confidence, lastHitAt, lastConfirmedAt, createdAt, updatedAt`
const MEMORY_SEARCH_SELECT_COLUMNS = `memory.id, memory.content, memory.status, memory.scopeKind,
  memory.scopeId, memory.subject, memory.factKey, memory.factValue, memory.sensitivity,
  memory.sourceMessageIdsJson, memory.validFrom, memory.validUntil, memory.supersedesId,
  memory.conflictWithId, memory.conversationId, memory.sourceKind, memory.sourceDetail,
  memory.confidence, memory.lastHitAt, memory.lastConfirmedAt, memory.createdAt, memory.updatedAt`

const memoryRowSchema = v.object({
  id: v.string(),
  content: v.string(),
  status: v.string(),
  scopeKind: v.nullish(v.string()),
  scopeId: v.nullish(v.string()),
  subject: v.nullish(v.string()),
  factKey: v.nullish(v.string()),
  factValue: v.nullish(v.string()),
  sensitivity: v.nullish(v.string()),
  sourceMessageIdsJson: v.nullish(v.string()),
  validFrom: v.nullish(v.number()),
  validUntil: v.nullish(v.number()),
  supersedesId: v.nullish(v.string()),
  conflictWithId: v.nullish(v.string()),
  conversationId: v.nullish(v.string()),
  sourceKind: v.nullish(v.string()),
  sourceDetail: v.nullish(v.string()),
  confidence: v.nullish(v.number()),
  lastHitAt: v.nullish(v.number()),
  lastConfirmedAt: v.nullish(v.number()),
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
          name: 'structured-memory-facts-and-scoped-retrieval',
          async up(transaction) {
            await transaction.exec(`
              CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY NOT NULL,
                content TEXT NOT NULL,
                status TEXT NOT NULL,
                scopeKind TEXT NOT NULL DEFAULT 'user',
                scopeId TEXT NOT NULL DEFAULT '${LOCAL_USER_MEMORY_SCOPE_ID}',
                subject TEXT,
                normalizedSubject TEXT,
                factKey TEXT,
                normalizedKey TEXT,
                factValue TEXT,
                sensitivity TEXT NOT NULL DEFAULT 'normal',
                sourceMessageIdsJson TEXT NOT NULL DEFAULT '[]',
                validFrom INTEGER,
                validUntil INTEGER,
                supersedesId TEXT,
                conflictWithId TEXT,
                conversationId TEXT,
                sourceKind TEXT,
                sourceDetail TEXT,
                confidence REAL,
                lastHitAt INTEGER,
                lastConfirmedAt INTEGER,
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
            await ensureStructuredMemoryIntegrity(transaction)
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

  async function listMemories<const Status extends KnowledgeMemoryStatus = KnowledgeMemoryStatus>(
    input: KnowledgeMemoryListInput<Status> = {},
  ): Promise<readonly (KnowledgeMemoryRecord & { status: Status })[]> {
    const statuses = normalizeMemoryStatuses(input.statuses)
    const placeholders = statuses.map(() => '?').join(', ')
    const rows = await (await database(input.signal)).getAll<Record<string, unknown>>(
      `SELECT ${MEMORY_SELECT_COLUMNS}
       FROM memories WHERE status IN (${placeholders}) ORDER BY updatedAt DESC`,
      statuses,
    )
    throwIfAborted(input.signal)
    return rows.map(normalizeMemoryRow) as unknown as readonly (KnowledgeMemoryRecord & { status: Status })[]
  }

  async function saveMemory(
    input: KnowledgeMemoryWrite,
    operation: KnowledgeRepositoryOperationOptions = {},
  ): Promise<KnowledgeMemoryRecord> {
    let record = normalizeMemoryWrite(input, clock, ids)
    const value = await database(operation.signal)
    await value.transaction(async (transaction) => {
      record = await resolveMemoryWrite(
        transaction,
        record,
        assertTimestamp(clock.now(), 'clock timestamp'),
        operation.signal,
      )
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
    const now = assertTimestamp(clock.now(), 'clock timestamp')
    await value.transaction(async (transaction) => {
      const target = await readMemoryById(transaction, memoryId, operation.signal)
      if (!target) {
        await run(transaction,
          'UPDATE memories SET status = ?, updatedAt = ? WHERE id = ?',
          [normalizedStatus, now, memoryId],
          operation.signal,
        )
        return
      }
      if (normalizedStatus !== 'active') {
        await run(transaction,
          'UPDATE memories SET status = ?, updatedAt = ? WHERE id = ?',
          [normalizedStatus, now, memoryId],
          operation.signal,
        )
        return
      }

      const active = await readActiveMemoryForLogicalKey(transaction, target, operation.signal)
      if (active && active.id !== target.id) {
        await writeMemoryRecord(transaction, {
          ...active,
          status: 'superseded',
          updatedAt: now,
        }, operation.signal)
      }
      const { conflictWithId: _conflictWithId, ...confirmed } = target
      await writeMemoryRecord(transaction, {
        ...confirmed,
        status: 'active',
        ...(active && active.id !== target.id ? { supersedesId: active.id } : {}),
        lastConfirmedAt: now,
        updatedAt: now,
      }, operation.signal)
    })
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
    const scopes = normalizeMemoryScopes(input.scopes)
    const scopeClause = scopes.length
      ? ` AND (${scopes.map(() => '(memory.scopeKind = ? AND memory.scopeId = ?)').join(' OR ')})`
      : ''
    const scopeParameters = scopes.flatMap((scope) => [scope.kind, scope.id])
    const searchTerms = tokenizeFtsQuery(query).slice(0, 16)
    const ftsQuery = buildFtsQuery(query)
    if (!ftsQuery || !searchTerms.length) return []
    const value = await database(input.signal)
    const candidateLimit = Math.max(limit * 4, limit)
    const now = assertTimestamp(clock.now(), 'clock timestamp')
    const rows = searchMode === 'fts5'
      ? await value.getAll<Record<string, unknown>>(
        `SELECT ${MEMORY_SEARCH_SELECT_COLUMNS},
                bm25(memory_fts) AS score
         FROM memory_fts
         JOIN memories AS memory ON memory.id = memory_fts.id
         WHERE memory_fts MATCH ? AND memory.status IN (${placeholders})
           AND (memory.validFrom IS NULL OR memory.validFrom <= ?)
           AND (memory.validUntil IS NULL OR memory.validUntil > ?)
           ${scopeClause}
         LIMIT ?`,
        [ftsQuery, ...statuses, now, now, ...scopeParameters, candidateLimit],
      )
      : await value.getAll<Record<string, unknown>>(
        `SELECT ${MEMORY_SEARCH_SELECT_COLUMNS},
                0.0 AS score
         FROM memory_fts
         JOIN memories AS memory ON memory.id = memory_fts.id
         WHERE (${searchTerms.map(() => 'LOWER(memory_fts.content) LIKE ?').join(' OR ')})
           AND memory.status IN (${placeholders})
           AND (memory.validFrom IS NULL OR memory.validFrom <= ?)
           AND (memory.validUntil IS NULL OR memory.validUntil > ?)
           ${scopeClause}
         ORDER BY memory.updatedAt DESC
         LIMIT ?`,
        [...searchTerms.map(likeSearchPattern), ...statuses, now, now, ...scopeParameters, candidateLimit],
      )
    throwIfAborted(input.signal)
    const ranked = rows
      .map(normalizeMemorySearchRow)
      .sort((left, right) => memoryRankScore(left, now) - memoryRankScore(right, now))
      .slice(0, limit)
    await value.transaction(async (transaction) => {
      for (const memory of ranked) {
        await run(transaction, 'UPDATE memories SET lastHitAt = ? WHERE id = ?', [now, memory.id], input.signal)
      }
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
        `SELECT ${MEMORY_SELECT_COLUMNS} FROM memories`,
      )
      const records = existingRows.map(normalizeMemoryRow)
      for (const input of memories) {
        throwIfAborted(operation.signal)
        const incoming = resolveMemoryCollectionWrite(
          records,
          normalizeMemoryWrite(input, clock, ids),
          assertTimestamp(clock.now(), 'clock timestamp'),
        )
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
          `SELECT ${MEMORY_SELECT_COLUMNS}
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
      const incoming = resolveMemoryCollectionWrite(
        memories,
        normalizeMemoryWrite(input, clock, ids),
        assertTimestamp(clock.now(), 'clock timestamp'),
      )
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
        scope: candidate.scope,
        ...(candidate.subject === undefined ? {} : { subject: candidate.subject }),
        ...(candidate.key === undefined ? {} : { key: candidate.key }),
        ...(candidate.value === undefined ? {} : { value: candidate.value }),
        sensitivity: candidate.sensitivity,
        sourceMessageIds: candidate.sourceMessageIds,
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
    ['scopeKind', "TEXT NOT NULL DEFAULT 'user'"],
    ['scopeId', `TEXT NOT NULL DEFAULT '${LOCAL_USER_MEMORY_SCOPE_ID}'`],
    ['subject', 'TEXT'],
    ['normalizedSubject', 'TEXT'],
    ['factKey', 'TEXT'],
    ['normalizedKey', 'TEXT'],
    ['factValue', 'TEXT'],
    ['sensitivity', "TEXT NOT NULL DEFAULT 'normal'"],
    ['sourceMessageIdsJson', "TEXT NOT NULL DEFAULT '[]'"],
    ['validFrom', 'INTEGER'],
    ['validUntil', 'INTEGER'],
    ['supersedesId', 'TEXT'],
    ['conflictWithId', 'TEXT'],
    ['conversationId', 'TEXT'],
    ['sourceKind', 'TEXT'],
    ['sourceDetail', 'TEXT'],
    ['confidence', 'REAL'],
    ['lastHitAt', 'INTEGER'],
    ['lastConfirmedAt', 'INTEGER'],
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

async function ensureStructuredMemoryIntegrity(database: SqliteExecutor): Promise<void> {
  await database.exec(`
    UPDATE memories
    SET scopeKind = CASE
          WHEN conversationId IS NOT NULL AND TRIM(conversationId) <> '' THEN 'conversation'
          ELSE 'user'
        END,
        scopeId = CASE
          WHEN conversationId IS NOT NULL AND TRIM(conversationId) <> '' THEN conversationId
          ELSE '${LOCAL_USER_MEMORY_SCOPE_ID}'
        END;
    UPDATE memories
    SET status = 'pending'
    WHERE status = 'active'
      AND (subject IS NULL OR factKey IS NULL OR factValue IS NULL);
    WITH ranked_active_facts AS (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY scopeKind, scopeId, normalizedSubject, normalizedKey
               ORDER BY COALESCE(lastConfirmedAt, updatedAt, createdAt) DESC,
                        updatedAt DESC,
                        createdAt DESC,
                        id DESC
             ) AS fact_rank
      FROM memories
      WHERE status = 'active'
        AND normalizedSubject IS NOT NULL
        AND normalizedKey IS NOT NULL
    )
    UPDATE memories
    SET status = 'superseded'
    WHERE id IN (
      SELECT id FROM ranked_active_facts WHERE fact_rank > 1
    );
    CREATE INDEX IF NOT EXISTS memories_scope_status_updated_idx
      ON memories(scopeKind, scopeId, status, updatedAt DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS memories_active_logical_key_idx
      ON memories(scopeKind, scopeId, normalizedSubject, normalizedKey)
      WHERE status = 'active'
        AND normalizedSubject IS NOT NULL
        AND normalizedKey IS NOT NULL;
  `)
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
  const normalizedSubject = record.subject === undefined
    ? null
    : normalizeMemoryLogicalKey(record.subject, 'memory subject')
  const normalizedKey = record.key === undefined
    ? null
    : normalizeMemoryLogicalKey(record.key, 'memory key')
  await run(database,
    `INSERT INTO memories (
       id, content, status, scopeKind, scopeId, subject, normalizedSubject, factKey, normalizedKey,
       factValue, sensitivity, sourceMessageIdsJson, validFrom, validUntil, supersedesId, conflictWithId,
       conversationId, sourceKind, sourceDetail, confidence, lastHitAt, lastConfirmedAt, createdAt, updatedAt
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       content = excluded.content,
       status = excluded.status,
       scopeKind = excluded.scopeKind,
       scopeId = excluded.scopeId,
       subject = excluded.subject,
       normalizedSubject = excluded.normalizedSubject,
       factKey = excluded.factKey,
       normalizedKey = excluded.normalizedKey,
       factValue = excluded.factValue,
       sensitivity = excluded.sensitivity,
       sourceMessageIdsJson = excluded.sourceMessageIdsJson,
       validFrom = excluded.validFrom,
       validUntil = excluded.validUntil,
       supersedesId = excluded.supersedesId,
       conflictWithId = excluded.conflictWithId,
       conversationId = excluded.conversationId,
       sourceKind = excluded.sourceKind,
       sourceDetail = excluded.sourceDetail,
       confidence = excluded.confidence,
       lastHitAt = excluded.lastHitAt,
       lastConfirmedAt = excluded.lastConfirmedAt,
       createdAt = excluded.createdAt,
       updatedAt = excluded.updatedAt`,
    [
      record.id,
      record.content,
      record.status,
      record.scope.kind,
      record.scope.id,
      record.subject ?? null,
      normalizedSubject,
      record.key ?? null,
      normalizedKey,
      record.value ?? null,
      record.sensitivity,
      JSON.stringify(record.sourceMessageIds),
      record.validFrom ?? null,
      record.validUntil ?? null,
      record.supersedesId ?? null,
      record.conflictWithId ?? null,
      record.conversationId ?? null,
      record.sourceKind,
      record.sourceDetail ?? null,
      record.confidence ?? null,
      record.lastHitAt ?? null,
      record.lastConfirmedAt ?? null,
      record.createdAt,
      record.updatedAt,
    ],
    signal,
  )
  await run(database, 'DELETE FROM memory_fts WHERE id = ?', [record.id], signal)
  await run(
    database,
    'INSERT INTO memory_fts (id, content) VALUES (?, ?)',
    [record.id, memorySearchText(record)],
    signal,
  )
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
  const scope = normalizeMemoryScopeInput(input.scope, input.conversationId)
  return normalizeMemoryRow({
    id: input.id ?? ids.next('memory'),
    content: input.content,
    status: input.status,
    scopeKind: scope.kind,
    scopeId: scope.id,
    subject: input.subject,
    factKey: input.key,
    factValue: input.value,
    sensitivity: input.sensitivity,
    sourceMessageIdsJson: JSON.stringify(input.sourceMessageIds ?? []),
    validFrom: input.validFrom,
    validUntil: input.validUntil,
    supersedesId: input.supersedesId,
    conflictWithId: input.conflictWithId,
    conversationId: input.conversationId,
    sourceKind: input.sourceKind,
    sourceDetail: input.sourceDetail,
    confidence: input.confidence,
    lastHitAt: input.lastHitAt,
    lastConfirmedAt: input.lastConfirmedAt,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  })
}

function normalizeMemoryScopeInput(
  scope: KnowledgeMemoryScope | undefined,
  conversationId: string | undefined,
): KnowledgeMemoryScope {
  if (scope) {
    return normalizeMemoryScope(scope.kind, scope.id, conversationId)
  }
  const normalizedConversationId = conversationId?.trim()
  return normalizedConversationId
    ? { kind: 'conversation', id: normalizeIdentifier(normalizedConversationId, 'memory conversation scope id') }
    : { kind: 'user', id: LOCAL_USER_MEMORY_SCOPE_ID }
}

function normalizeMemoryScopes(scopes: readonly KnowledgeMemoryScope[] | undefined): KnowledgeMemoryScope[] {
  const byIdentity = new Map<string, KnowledgeMemoryScope>()
  for (const scope of scopes ?? []) {
    const normalized = normalizeMemoryScope(scope.kind, scope.id, undefined)
    byIdentity.set(`${normalized.kind}:${normalized.id}`, normalized)
  }
  return Array.from(byIdentity.values())
}

function normalizeMemoryScope(
  kind: string | null | undefined,
  id: string | null | undefined,
  conversationId: string | null | undefined,
): KnowledgeMemoryScope {
  if (kind === undefined || kind === null || !kind.trim()) {
    const normalizedConversationId = typeof conversationId === 'string' ? conversationId.trim() : ''
    return normalizedConversationId
      ? { kind: 'conversation', id: normalizeIdentifier(normalizedConversationId, 'memory conversation scope id') }
      : { kind: 'user', id: LOCAL_USER_MEMORY_SCOPE_ID }
  }
  if (kind !== 'user' && kind !== 'conversation') {
    throw new KnowledgeRepositoryDataError('A memory scope kind is invalid.')
  }
  return {
    kind,
    id: normalizeIdentifier(id ?? '', 'memory scope id'),
  }
}

function normalizeMemoryFactFields(
  subject: string | null | undefined,
  key: string | null | undefined,
  value: string | null | undefined,
): Pick<KnowledgeMemoryRecord, 'subject' | 'key' | 'value'> {
  const normalizedSubject = optionalText(subject, 'memory subject', MAX_MEMORY_FACT_FIELD_LENGTH)
  const normalizedKey = optionalText(key, 'memory key', MAX_MEMORY_FACT_FIELD_LENGTH)
  const normalizedValue = optionalText(value, 'memory value', MAX_MEMORY_CONTENT_LENGTH)
  const present = [normalizedSubject, normalizedKey, normalizedValue].filter((item) => item !== undefined).length
  if (present === 0) return {}
  if (present !== 3) throw new KnowledgeRepositoryDataError('A structured memory fact must include subject, key, and value.')
  return {
    subject: normalizedSubject,
    key: normalizedKey,
    value: normalizedValue,
  }
}

function parseMemorySourceMessageIds(value: string | null | undefined): readonly string[] {
  if (value === undefined || value === null || !value.trim()) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new KnowledgeRepositoryDataError('Memory source message IDs are invalid.')
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_MEMORY_SOURCE_MESSAGE_IDS) {
    throw new KnowledgeRepositoryDataError('Memory source message IDs are invalid.')
  }
  return Array.from(new Set(parsed.map((item) => {
    if (typeof item !== 'string') throw new KnowledgeRepositoryDataError('Memory source message IDs are invalid.')
    return normalizeIdentifier(item, 'memory source message id')
  })))
}

function normalizeMemorySensitivity(value: string | null | undefined): KnowledgeMemorySensitivity {
  if (value === undefined || value === null || !value.trim()) return 'normal'
  if (value === 'normal' || value === 'sensitive') return value
  throw new KnowledgeRepositoryDataError('A memory sensitivity value is invalid.')
}

function normalizeMemoryLogicalKey(value: string, label: string): string {
  const normalized = value.normalize('NFKC').trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  if (!normalized || normalized.length > MAX_MEMORY_FACT_FIELD_LENGTH) {
    throw new KnowledgeRepositoryDataError(`The ${label} is invalid.`)
  }
  return normalized
}

function normalizeMemoryComparableValue(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
}

function sameMemoryLogicalValue(left: KnowledgeMemoryRecord, right: KnowledgeMemoryRecord): boolean {
  if (!left.subject || !left.key || !right.subject || !right.key) return false
  return left.scope.kind === right.scope.kind &&
    left.scope.id === right.scope.id &&
    normalizeMemoryLogicalKey(left.subject, 'memory subject') === normalizeMemoryLogicalKey(right.subject, 'memory subject') &&
    normalizeMemoryLogicalKey(left.key, 'memory key') === normalizeMemoryLogicalKey(right.key, 'memory key') &&
    normalizeMemoryComparableValue(left.value ?? '') === normalizeMemoryComparableValue(right.value ?? '')
}

function clearMemoryRelations(record: KnowledgeMemoryRecord): KnowledgeMemoryRecord {
  const copy = { ...record }
  delete copy.supersedesId
  delete copy.conflictWithId
  return copy
}

function memorySearchText(record: KnowledgeMemoryRecord): string {
  return [record.content, record.subject, record.key, record.value].filter(Boolean).join('\n')
}

async function readMemoryById(
  database: SqliteExecutor,
  id: string,
  signal: AbortSignal | undefined,
): Promise<KnowledgeMemoryRecord | undefined> {
  const row = await database.getFirst<Record<string, unknown>>(
    `SELECT ${MEMORY_SELECT_COLUMNS} FROM memories WHERE id = ? LIMIT 1`,
    [id],
  )
  throwIfAborted(signal)
  return row ? normalizeMemoryRow(row) : undefined
}

async function readActiveMemoryForLogicalKey(
  database: SqliteExecutor,
  record: KnowledgeMemoryRecord,
  signal: AbortSignal | undefined,
): Promise<KnowledgeMemoryRecord | undefined> {
  if (!record.subject || !record.key) return undefined
  const row = await database.getFirst<Record<string, unknown>>(
    `SELECT ${MEMORY_SELECT_COLUMNS}
       FROM memories
      WHERE status = 'active'
        AND scopeKind = ?
        AND scopeId = ?
        AND normalizedSubject = ?
        AND normalizedKey = ?
        AND id <> ?
      LIMIT 1`,
    [
      record.scope.kind,
      record.scope.id,
      normalizeMemoryLogicalKey(record.subject, 'memory subject'),
      normalizeMemoryLogicalKey(record.key, 'memory key'),
      record.id,
    ],
  )
  throwIfAborted(signal)
  return row ? normalizeMemoryRow(row) : undefined
}

async function resolveMemoryWrite(
  database: SqliteExecutor,
  incoming: KnowledgeMemoryRecord,
  now: number,
  signal: AbortSignal | undefined,
): Promise<KnowledgeMemoryRecord> {
  const active = await readActiveMemoryForLogicalKey(database, incoming, signal)
  if (!active) return incoming
  if (sameMemoryLogicalValue(active, incoming)) {
    return mergeMemoryRecords(active, {
      ...incoming,
      status: 'active',
      lastConfirmedAt: now,
    }, now)
  }
  if (incoming.status === 'active' && incoming.supersedesId === active.id) {
    await writeMemoryRecord(database, {
      ...active,
      status: 'superseded',
      updatedAt: now,
    }, signal)
    return {
      ...clearMemoryRelations(incoming),
      status: 'active',
      supersedesId: active.id,
      lastConfirmedAt: now,
      updatedAt: now,
    }
  }
  return {
    ...clearMemoryRelations(incoming),
    status: 'pending',
    conflictWithId: active.id,
  }
}

function resolveMemoryCollectionWrite(
  memories: KnowledgeMemoryRecord[],
  incoming: KnowledgeMemoryRecord,
  now: number,
): KnowledgeMemoryRecord {
  const activeIndex = incoming.subject && incoming.key
    ? memories.findIndex((memory) => memory.status === 'active' && memory.id !== incoming.id && sameMemoryLogicalValue(memory, incoming))
    : -1
  if (activeIndex >= 0) {
    const active = memories[activeIndex]
    if (sameMemoryLogicalValue(active, incoming)) {
      const merged = mergeMemoryRecords(active, { ...incoming, status: 'active', lastConfirmedAt: now }, now)
      memories[activeIndex] = merged
      return merged
    }
  }

  const conflictingIndex = incoming.subject && incoming.key
    ? memories.findIndex((memory) =>
      memory.status === 'active' &&
      memory.id !== incoming.id &&
      memory.scope.kind === incoming.scope.kind &&
      memory.scope.id === incoming.scope.id &&
      normalizeMemoryLogicalKey(memory.subject ?? '', 'memory subject') === normalizeMemoryLogicalKey(incoming.subject!, 'memory subject') &&
      normalizeMemoryLogicalKey(memory.key ?? '', 'memory key') === normalizeMemoryLogicalKey(incoming.key!, 'memory key'))
    : -1
  if (conflictingIndex < 0) return incoming
  const active = memories[conflictingIndex]
  if (incoming.status === 'active' && incoming.supersedesId === active.id) {
    memories[conflictingIndex] = { ...active, status: 'superseded', updatedAt: now }
    return { ...clearMemoryRelations(incoming), status: 'active', supersedesId: active.id, lastConfirmedAt: now, updatedAt: now }
  }
  return { ...clearMemoryRelations(incoming), status: 'pending', conflictWithId: active.id }
}

function normalizeMemoryRow(value: unknown): KnowledgeMemoryRecord {
  const parsed = v.safeParse(memoryRowSchema, value)
  if (!parsed.success) throw new KnowledgeRepositoryDataError('A persisted memory record is invalid.')
  const row = parsed.output
  const sourceKind = normalizeMemorySourceKind(row.sourceKind)
  const scope = normalizeMemoryScope(row.scopeKind, row.scopeId, row.conversationId)
  const fact = normalizeMemoryFactFields(row.subject, row.factKey, row.factValue)
  const sourceMessageIds = parseMemorySourceMessageIds(row.sourceMessageIdsJson)
  const validFrom = optionalTimestamp(row.validFrom, 'memory valid-from timestamp')
  const validUntil = optionalTimestamp(row.validUntil, 'memory valid-until timestamp')
  if (validFrom !== undefined && validUntil !== undefined && validUntil <= validFrom) {
    throw new KnowledgeRepositoryDataError('A memory validity interval is invalid.')
  }
  return {
    schema: KNOWLEDGE_MEMORY_RECORD_SCHEMA,
    id: normalizeIdentifier(row.id, 'memory id'),
    content: normalizeMemoryContent(row.content),
    status: normalizeMemoryStatus(row.status),
    scope,
    ...fact,
    sensitivity: normalizeMemorySensitivity(row.sensitivity),
    sourceMessageIds,
    ...(validFrom === undefined ? {} : { validFrom }),
    ...(validUntil === undefined ? {} : { validUntil }),
    ...(optionalText(row.supersedesId, 'memory superseded id', 256) === undefined ? {} : { supersedesId: optionalText(row.supersedesId, 'memory superseded id', 256) }),
    ...(optionalText(row.conflictWithId, 'memory conflict id', 256) === undefined ? {} : { conflictWithId: optionalText(row.conflictWithId, 'memory conflict id', 256) }),
    ...(optionalText(row.conversationId, 'memory conversation id', 256) === undefined ? {} : { conversationId: optionalText(row.conversationId, 'memory conversation id', 256) }),
    sourceKind,
    ...(optionalText(row.sourceDetail, 'memory source detail', 512) === undefined ? {} : { sourceDetail: optionalText(row.sourceDetail, 'memory source detail', 512) }),
    ...(optionalConfidence(row.confidence) === undefined ? {} : { confidence: optionalConfidence(row.confidence) }),
    ...(optionalTimestamp(row.lastHitAt, 'memory last-hit timestamp') === undefined ? {} : { lastHitAt: optionalTimestamp(row.lastHitAt, 'memory last-hit timestamp') }),
    ...(optionalTimestamp(row.lastConfirmedAt, 'memory last-confirmed timestamp') === undefined ? {} : { lastConfirmedAt: optionalTimestamp(row.lastConfirmedAt, 'memory last-confirmed timestamp') }),
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
    const existing = memories[index]
    if (!sameMemoryLogicalValue(existing, incoming)) {
      if (existing.subject !== undefined || incoming.subject !== undefined || existing.key !== undefined || incoming.key !== undefined) continue
      if (existing.content !== incoming.content) continue
    }
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
  const sourceMessageIds = Array.from(new Set([...existing.sourceMessageIds, ...incoming.sourceMessageIds]))
  return {
    schema: KNOWLEDGE_MEMORY_RECORD_SCHEMA,
    id: existing.id,
    content: existing.content,
    status: mergeMemoryStatus(existing.status, incoming.status),
    scope: existing.scope,
    ...(existing.subject ?? incoming.subject ? { subject: existing.subject ?? incoming.subject } : {}),
    ...(existing.key ?? incoming.key ? { key: existing.key ?? incoming.key } : {}),
    ...(existing.value ?? incoming.value ? { value: existing.value ?? incoming.value } : {}),
    sensitivity: existing.sensitivity === 'sensitive' || incoming.sensitivity === 'sensitive' ? 'sensitive' : 'normal',
    sourceMessageIds,
    ...(maxOptionalTimestamp(existing.validFrom, incoming.validFrom) === undefined ? {} : { validFrom: maxOptionalTimestamp(existing.validFrom, incoming.validFrom) }),
    ...(maxOptionalTimestamp(existing.validUntil, incoming.validUntil) === undefined ? {} : { validUntil: maxOptionalTimestamp(existing.validUntil, incoming.validUntil) }),
    ...(incoming.supersedesId ?? existing.supersedesId ? { supersedesId: incoming.supersedesId ?? existing.supersedesId } : {}),
    ...(incoming.conflictWithId ?? existing.conflictWithId ? { conflictWithId: incoming.conflictWithId ?? existing.conflictWithId } : {}),
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
    ...(maxOptionalTimestamp(existing.lastConfirmedAt, incoming.lastConfirmedAt) === undefined ? {} : { lastConfirmedAt: maxOptionalTimestamp(existing.lastConfirmedAt, incoming.lastConfirmedAt) }),
    createdAt: Math.min(existing.createdAt, incoming.createdAt),
    updatedAt: Math.max(existing.updatedAt, incoming.updatedAt, now),
  }
}

function mergeMemoryStatus(left: KnowledgeMemoryStatus, right: KnowledgeMemoryStatus): KnowledgeMemoryStatus {
  if (left === 'active' || right === 'active') return 'active'
  if (left === 'pending' || right === 'pending') return 'pending'
  if (left === 'superseded' || right === 'superseded') return 'superseded'
  return 'disabled'
}

function memoryStatusMergeRank(status: KnowledgeMemoryStatus): number {
  if (status === 'active') return 0
  if (status === 'pending') return 1
  if (status === 'superseded') return 2
  return 3
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
  const input = statuses?.length ? statuses : ['pending', 'active', 'superseded', 'disabled']
  return Array.from(new Set(input.map(normalizeMemoryStatus)))
}

function normalizeMemoryStatus(value: string): KnowledgeMemoryStatus {
  if (value === 'pending' || value === 'active' || value === 'superseded' || value === 'disabled') return value
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
    DELETE FROM memory_fts;
    INSERT INTO memory_fts (id, content)
    SELECT memory.id,
           memory.content || char(10) || coalesce(memory.subject, '') || char(10) ||
           coalesce(memory.factKey, '') || char(10) || coalesce(memory.factValue, '')
    FROM memories AS memory;
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
