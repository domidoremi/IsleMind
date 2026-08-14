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
  KnowledgeDocumentRepository,
  KnowledgeRepositoryOperationOptions,
} from '../contracts'
import { createLocalKnowledgeEmbedding, tokenizeKnowledgeText } from '../domain/localVectorIndex'

const MIGRATION_SCOPE = 'knowledge-colbert-index'
const MIGRATION_VERSION = 1
const MODEL_ID = 'local-token-hash-v1'
const MAX_INDEX_TOKENS = 48
const MAX_QUERY_TOKENS = 24
const MAX_QUERY_LENGTH = 16_384
const MAX_LIMIT = 24

const matchedChunkRowSchema = v.object({
  chunkId: v.string(),
  matched: v.number(),
})

const searchHitRowSchema = v.object({
  id: v.string(),
  documentId: v.string(),
  title: v.string(),
  content: v.string(),
  ordinal: v.number(),
  chunkIndex: v.nullish(v.number()),
  createdAt: v.number(),
  sourceUri: v.nullish(v.string()),
  rawPath: v.nullish(v.string()),
})

export interface KnowledgeColbertSearchInput extends KnowledgeRepositoryOperationOptions {
  query: string
  limit: number
}

export interface KnowledgeColbertSearchHit {
  id: string
  chunkId: string
  documentId: string
  type: 'knowledge'
  title: string
  content: string
  excerpt: string
  ordinal: number
  chunkIndex?: number
  createdAt: number
  sourceUri?: string
  rawPath?: string
  score: number
  similarityScore: number
  retrievalMode: 'hybrid'
  retrievalStage: 'colbert-lite'
  sourceReason: 'colbert-token-maxsim'
}

export interface KnowledgeColbertSynchronizationResult {
  documentCount: number
  chunkCount: number
  tokenCount: number
}

export interface KnowledgeColbertIndex {
  synchronize(
    chunks: readonly KnowledgeChunkRecord[],
    options?: KnowledgeRepositoryOperationOptions,
  ): Promise<KnowledgeColbertSynchronizationResult>
  search(input: KnowledgeColbertSearchInput): Promise<readonly KnowledgeColbertSearchHit[]>
  deleteDocument(
    documentId: string,
    options?: KnowledgeRepositoryOperationOptions,
  ): Promise<void>
  clear(options?: KnowledgeRepositoryOperationOptions): Promise<void>
}

export interface SqliteKnowledgeColbertIndexDependencies {
  repository: KnowledgeDocumentRepository
  clock?: Clock
}

export class KnowledgeColbertIndexDataError extends Error {
  constructor(message = 'Persisted ColBERT index data is invalid.') {
    super(message)
    this.name = 'KnowledgeColbertIndexDataError'
  }
}

export class KnowledgeColbertIndexCancelledError extends Error {
  constructor() {
    super('Knowledge ColBERT index operation was cancelled.')
    this.name = 'KnowledgeColbertIndexCancelledError'
  }
}

/** Owns the deterministic token-level index while preserving its legacy table format. */
export function createSqliteKnowledgeColbertIndex(
  databaseProvider: SqliteDatabaseProvider,
  dependencies: SqliteKnowledgeColbertIndexDependencies,
): KnowledgeColbertIndex {
  const clock = dependencies.clock ?? systemClock
  let initialized: Promise<SqliteDatabase> | undefined

  async function database(signal?: AbortSignal): Promise<SqliteDatabase> {
    throwIfAborted(signal)
    const pending = initialized ??= (async () => {
      await dependencies.repository.listDocuments({ signal })
      throwIfAborted(signal)
      const value = await databaseProvider.get()
      throwIfAborted(signal)
      await applySqliteMigrations(value, [{
        scope: MIGRATION_SCOPE,
        version: MIGRATION_VERSION,
        name: 'target-colbert-lite-index',
        async up(transaction) {
          await transaction.exec(`
            CREATE TABLE IF NOT EXISTS colbert_embeddings (
              id TEXT PRIMARY KEY NOT NULL,
              chunkId TEXT NOT NULL,
              tokenIndex INTEGER NOT NULL,
              token TEXT NOT NULL,
              embeddingJson TEXT NOT NULL,
              model TEXT,
              updatedAt INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_colbert_embeddings_token
              ON colbert_embeddings(token);
            CREATE INDEX IF NOT EXISTS idx_colbert_embeddings_chunk
              ON colbert_embeddings(chunkId);
            CREATE TABLE IF NOT EXISTS indexing_jobs (
              id TEXT PRIMARY KEY NOT NULL,
              documentId TEXT,
              kind TEXT NOT NULL,
              status TEXT NOT NULL,
              progress REAL,
              error TEXT,
              createdAt INTEGER NOT NULL,
              updatedAt INTEGER NOT NULL
            );
          `)
        },
      }])
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

  async function synchronize(
    chunks: readonly KnowledgeChunkRecord[],
    options: KnowledgeRepositoryOperationOptions = {},
  ): Promise<KnowledgeColbertSynchronizationResult> {
    throwIfAborted(options.signal)
    const byDocument = validateAndGroupChunks(chunks)
    if (!byDocument.size) return { documentCount: 0, chunkCount: 0, tokenCount: 0 }
    const value = await database(options.signal)
    const now = normalizeTimestamp(clock.now())
    let tokenCount = 0

    for (const [documentId, documentChunks] of byDocument) {
      throwIfAborted(options.signal)
      await value.transaction(async (transaction) => {
        await writeJob(transaction, documentId, 'running', 0, now, options.signal)
        await run(
          transaction,
          'DELETE FROM colbert_embeddings WHERE chunkId IN (SELECT id FROM knowledge_chunks WHERE documentId = ?)',
          [documentId],
          options.signal,
        )
        for (const chunk of documentChunks) {
          throwIfAborted(options.signal)
          const tokens = uniqueTokens(chunk.content, MAX_INDEX_TOKENS)
          tokenCount += tokens.length
          for (const [tokenIndex, token] of tokens.entries()) {
            await run(
              transaction,
              `INSERT OR REPLACE INTO colbert_embeddings
                (id, chunkId, tokenIndex, token, embeddingJson, model, updatedAt)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [
                `colbert-${chunk.id}-${tokenIndex}`,
                chunk.id,
                tokenIndex,
                token,
                JSON.stringify(createLocalKnowledgeEmbedding(token)),
                MODEL_ID,
                now,
              ],
              options.signal,
            )
          }
        }
        await writeJob(transaction, documentId, 'done', 1, now, options.signal)
      })
      throwIfAborted(options.signal)
    }
    return { documentCount: byDocument.size, chunkCount: chunks.length, tokenCount }
  }

  async function search(input: KnowledgeColbertSearchInput): Promise<readonly KnowledgeColbertSearchHit[]> {
    const query = normalizeQuery(input.query)
    const limit = normalizeLimit(input.limit)
    const tokens = uniqueTokens(query, MAX_QUERY_TOKENS)
    if (!tokens.length) return []
    const value = await database(input.signal)
    const placeholders = tokens.map(() => '?').join(',')
    const candidateRows = await getAll(
      value,
      `SELECT chunkId, COUNT(DISTINCT token) AS matched
       FROM colbert_embeddings
       WHERE token IN (${placeholders})
       GROUP BY chunkId
       ORDER BY matched DESC
       LIMIT ?`,
      [...tokens, Math.max(limit * 6, 24)],
      input.signal,
    )
    const matches = candidateRows.map(normalizeMatchedChunkRow)
    if (!matches.length) return []

    const chunkIds = matches.map((row) => row.chunkId)
    const chunkPlaceholders = chunkIds.map(() => '?').join(',')
    const hitRows = await getAll(
      value,
      `SELECT c.id, c.documentId, c.title, c.content, c.ordinal, c.chunkIndex, c.createdAt,
              d.sourceUri, d.rawPath
       FROM knowledge_chunks AS c
       LEFT JOIN knowledge_documents AS d ON d.id = c.documentId
       WHERE c.id IN (${chunkPlaceholders})`,
      chunkIds,
      input.signal,
    )
    const matchedByChunkId = new Map(matches.map((row) => [row.chunkId, row.matched] as const))
    return hitRows
      .map((row) => normalizeSearchHit(row, matchedByChunkId, tokens.length))
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
  }

  async function deleteDocument(
    documentId: string,
    options: KnowledgeRepositoryOperationOptions = {},
  ): Promise<void> {
    const id = normalizeIdentifier(documentId, 'document id')
    const value = await database(options.signal)
    await value.transaction(async (transaction) => {
      await run(
        transaction,
        'DELETE FROM colbert_embeddings WHERE chunkId IN (SELECT id FROM knowledge_chunks WHERE documentId = ?)',
        [id],
        options.signal,
      )
      await run(
        transaction,
        "DELETE FROM indexing_jobs WHERE documentId = ? AND kind = 'colbert-lite'",
        [id],
        options.signal,
      )
    })
    throwIfAborted(options.signal)
  }

  async function clear(options: KnowledgeRepositoryOperationOptions = {}): Promise<void> {
    const value = await database(options.signal)
    await value.transaction(async (transaction) => {
      await run(transaction, 'DELETE FROM colbert_embeddings', [], options.signal)
      await run(transaction, "DELETE FROM indexing_jobs WHERE kind = 'colbert-lite'", [], options.signal)
    })
    throwIfAborted(options.signal)
  }

  return { synchronize, search, deleteDocument, clear }
}

function validateAndGroupChunks(
  chunks: readonly KnowledgeChunkRecord[],
): Map<string, KnowledgeChunkRecord[]> {
  const byDocument = new Map<string, KnowledgeChunkRecord[]>()
  for (const chunk of chunks) {
    const id = normalizeIdentifier(chunk.id, 'chunk id')
    const documentId = normalizeIdentifier(chunk.documentId, 'document id')
    if (typeof chunk.content !== 'string') {
      throw new KnowledgeColbertIndexDataError(`Chunk ${id} content must be a string.`)
    }
    const current = byDocument.get(documentId) ?? []
    current.push(chunk)
    byDocument.set(documentId, current)
  }
  return byDocument
}

function normalizeMatchedChunkRow(row: Record<string, unknown>): { chunkId: string; matched: number } {
  const result = v.safeParse(matchedChunkRowSchema, row)
  if (!result.success) throw new KnowledgeColbertIndexDataError()
  return {
    chunkId: normalizeIdentifier(result.output.chunkId, 'persisted chunk id'),
    matched: normalizeNonNegativeInteger(result.output.matched, 'persisted match count'),
  }
}

function normalizeSearchHit(
  row: Record<string, unknown>,
  matchedByChunkId: ReadonlyMap<string, number>,
  queryTokenCount: number,
): KnowledgeColbertSearchHit {
  const result = v.safeParse(searchHitRowSchema, row)
  if (!result.success) throw new KnowledgeColbertIndexDataError()
  const value = result.output
  const id = normalizeIdentifier(value.id, 'persisted chunk id')
  const score = Math.min(1, (matchedByChunkId.get(id) ?? 0) / Math.max(1, queryTokenCount))
  return {
    id,
    chunkId: id,
    documentId: normalizeIdentifier(value.documentId, 'persisted document id'),
    type: 'knowledge',
    title: value.title,
    content: value.content,
    excerpt: value.content.slice(0, 180),
    ordinal: normalizeNonNegativeInteger(value.ordinal, 'persisted chunk ordinal'),
    ...(value.chunkIndex == null ? {} : { chunkIndex: normalizeNonNegativeInteger(value.chunkIndex, 'persisted chunk index') }),
    createdAt: normalizeTimestamp(value.createdAt),
    ...(value.sourceUri != null
      ? { sourceUri: value.sourceUri }
      : value.rawPath != null
        ? { sourceUri: value.rawPath }
        : {}),
    ...(value.rawPath == null ? {} : { rawPath: value.rawPath }),
    score,
    similarityScore: score,
    retrievalMode: 'hybrid',
    retrievalStage: 'colbert-lite',
    sourceReason: 'colbert-token-maxsim',
  }
}

async function writeJob(
  database: SqliteExecutor,
  documentId: string,
  status: 'running' | 'done',
  progress: 0 | 1,
  now: number,
  signal?: AbortSignal,
): Promise<void> {
  const id = `index-colbert-lite-${documentId}`
  await run(
    database,
    `INSERT OR REPLACE INTO indexing_jobs
      (id, documentId, kind, status, progress, error, createdAt, updatedAt)
     VALUES (?, ?, 'colbert-lite', ?, ?, NULL,
       COALESCE((SELECT createdAt FROM indexing_jobs WHERE id = ?), ?), ?)`,
    [id, documentId, status, progress, id, now, now],
    signal,
  )
}

function uniqueTokens(text: string, limit: number): string[] {
  return Array.from(new Set(tokenizeKnowledgeText(text))).slice(0, limit)
}

function normalizeQuery(query: string): string {
  if (typeof query !== 'string') throw new KnowledgeColbertIndexDataError('ColBERT query must be a string.')
  const value = query.trim()
  if (value.length > MAX_QUERY_LENGTH) {
    throw new KnowledgeColbertIndexDataError(`ColBERT query exceeds ${MAX_QUERY_LENGTH} characters.`)
  }
  return value
}

function normalizeLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new KnowledgeColbertIndexDataError('ColBERT search limit must be a positive integer.')
  }
  return Math.min(limit, MAX_LIMIT)
}

function normalizeIdentifier(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new KnowledgeColbertIndexDataError(`The ${label} must be a non-empty string.`)
  }
  return value
}

function normalizeNonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new KnowledgeColbertIndexDataError(`The ${label} must be a non-negative integer.`)
  }
  return value
}

function normalizeTimestamp(value: number): number {
  return normalizeNonNegativeInteger(value, 'ColBERT index timestamp')
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

async function getAll(
  database: SqliteExecutor,
  source: string,
  parameters: readonly SqliteValue[],
  signal?: AbortSignal,
): Promise<readonly Record<string, unknown>[]> {
  throwIfAborted(signal)
  const rows = await database.getAll<Record<string, unknown>>(source, parameters)
  throwIfAborted(signal)
  return rows
}

function throwCancellationIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new KnowledgeColbertIndexCancelledError()
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new KnowledgeColbertIndexCancelledError()
}
