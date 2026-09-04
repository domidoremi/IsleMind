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
import {
  createLocalKnowledgeEmbedding,
  hashKnowledgeText,
  knowledgeCosineSimilarity,
  tokenizeKnowledgeText,
} from '../domain/localVectorIndex'
import { mergeAgenticKnowledgeCandidates } from '../domain/retrievalCandidateFusion'
import { rerankKnowledgeSources } from '../domain/retrievalReranking'

const MIGRATION_SCOPE = 'knowledge-agentic-index'
const MIGRATION_VERSION = 1
const MAX_QUERY_LENGTH = 16_384
const MAX_LIMIT = 24
const MAX_PERSISTED_ROWS = 420
const RAPTOR_GROUP_SIZE = 4

const raptorRowSchema = v.object({
  id: v.string(),
  documentId: v.string(),
  title: v.string(),
  summary: v.string(),
  childChunkIdsJson: v.string(),
  embeddingJson: v.nullish(v.string()),
  level: v.number(),
  sourceUri: v.nullish(v.string()),
  rawPath: v.nullish(v.string()),
})

const graphEntityRowSchema = v.object({
  documentId: v.string(),
  name: v.string(),
  score: v.nullish(v.number()),
  chunkIdsJson: v.string(),
})

const graphRelationRowSchema = v.object({
  documentId: v.string(),
  relation: v.string(),
  score: v.nullish(v.number()),
  chunkIdsJson: v.string(),
  sourceName: v.nullish(v.string()),
  targetName: v.nullish(v.string()),
})

const graphChunkRowSchema = v.object({
  id: v.string(),
  documentId: v.string(),
  title: v.string(),
  content: v.string(),
  ordinal: v.number(),
  chunkIndex: v.nullish(v.number()),
  semanticBoundary: v.nullish(v.string()),
  headingPathJson: v.nullish(v.string()),
  qualityScore: v.nullish(v.number()),
  createdAt: v.number(),
  sourceUri: v.nullish(v.string()),
  rawPath: v.nullish(v.string()),
})

const jobRowSchema = v.object({
  id: v.string(),
  documentId: v.nullish(v.string()),
  kind: v.picklist(['raptor-lite', 'graphrag-lite']),
  status: v.picklist(['running', 'done', 'error', 'cancelled']),
  progress: v.nullish(v.number()),
  error: v.nullish(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})

export type KnowledgeAgenticTechnique = 'raptor' | 'graphrag'
export type KnowledgeAgenticJobKind = 'raptor-lite' | 'graphrag-lite'
export type KnowledgeAgenticJobStatusValue = 'running' | 'done' | 'error' | 'cancelled'

export interface SqliteKnowledgeAgenticSearchInput extends KnowledgeRepositoryOperationOptions {
  query: string
  limit: number
  techniques: readonly KnowledgeAgenticTechnique[]
  onEmbeddingResolved?: (notice: { source: 'onnx' | 'provider' | 'local-hash'; reason?: string }) => void
}

export interface KnowledgeAgenticSearchHit {
  id: string
  chunkId?: string
  documentId: string
  type: 'knowledge'
  title: string
  content: string
  excerpt: string
  chunkIndex?: number
  semanticBoundary?: string
  headingPath?: readonly string[]
  qualityScore?: number
  createdAt?: number
  sourceUri?: string
  rawPath?: string
  score: number
  similarityScore?: number
  vectorScore?: number
  retrievalMode: 'vector' | 'hybrid'
  retrievalStage?: 'graphrag'
  sourceReason: string
}

export interface KnowledgeAgenticSynchronizationResult {
  documentCount: number
  chunkCount: number
  graphEntityCount: number
  graphRelationCount: number
  raptorNodeCount: number
}

export interface KnowledgeAgenticJobStatus {
  id: string
  documentId?: string
  kind: KnowledgeAgenticJobKind
  status: KnowledgeAgenticJobStatusValue
  progress?: number
  error?: string
  createdAt: number
  updatedAt: number
}

export interface KnowledgeAgenticIndex {
  synchronize(
    chunks: readonly KnowledgeChunkRecord[],
    options?: KnowledgeRepositoryOperationOptions,
  ): Promise<KnowledgeAgenticSynchronizationResult>
  search(input: SqliteKnowledgeAgenticSearchInput): Promise<readonly KnowledgeAgenticSearchHit[]>
  listJobs(limit?: number, options?: KnowledgeRepositoryOperationOptions): Promise<readonly KnowledgeAgenticJobStatus[]>
  deleteDocument(documentId: string, options?: KnowledgeRepositoryOperationOptions): Promise<void>
  clear(options?: KnowledgeRepositoryOperationOptions): Promise<void>
}

export interface SqliteKnowledgeAgenticIndexDependencies {
  repository: KnowledgeDocumentRepository
  clock?: Clock
}

export class KnowledgeAgenticIndexDataError extends Error {
  constructor(message = 'Persisted knowledge agentic index data is invalid.') {
    super(message)
    this.name = 'KnowledgeAgenticIndexDataError'
  }
}

export class KnowledgeAgenticIndexCancelledError extends Error {
  constructor() {
    super('Knowledge agentic index operation was cancelled.')
    this.name = 'KnowledgeAgenticIndexCancelledError'
  }
}

/** Owns the deterministic RAPTOR and GraphRAG indexes while preserving their legacy table format. */
export function createSqliteKnowledgeAgenticIndex(
  databaseProvider: SqliteDatabaseProvider,
  dependencies: SqliteKnowledgeAgenticIndexDependencies,
): KnowledgeAgenticIndex {
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
        name: 'target-raptor-graphrag-indexes',
        async up(transaction) {
          await transaction.exec(`
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
            CREATE TABLE IF NOT EXISTS raptor_nodes (
              id TEXT PRIMARY KEY NOT NULL,
              documentId TEXT,
              parentId TEXT,
              level INTEGER NOT NULL,
              title TEXT NOT NULL,
              summary TEXT NOT NULL,
              childChunkIdsJson TEXT NOT NULL,
              embeddingJson TEXT,
              createdAt INTEGER NOT NULL,
              updatedAt INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_raptor_nodes_document
              ON raptor_nodes(documentId, level);
            CREATE TABLE IF NOT EXISTS graph_entities (
              id TEXT PRIMARY KEY NOT NULL,
              documentId TEXT,
              name TEXT NOT NULL,
              type TEXT,
              score REAL,
              chunkIdsJson TEXT NOT NULL,
              updatedAt INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_graph_entities_document
              ON graph_entities(documentId);
            CREATE TABLE IF NOT EXISTS graph_relations (
              id TEXT PRIMARY KEY NOT NULL,
              documentId TEXT,
              sourceEntityId TEXT NOT NULL,
              targetEntityId TEXT NOT NULL,
              relation TEXT NOT NULL,
              score REAL,
              chunkIdsJson TEXT NOT NULL,
              updatedAt INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_graph_relations_document
              ON graph_relations(documentId);
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
  ): Promise<KnowledgeAgenticSynchronizationResult> {
    throwIfAborted(options.signal)
    const byDocument = validateAndGroupChunks(chunks)
    if (!byDocument.size) {
      return { documentCount: 0, chunkCount: 0, graphEntityCount: 0, graphRelationCount: 0, raptorNodeCount: 0 }
    }
    const value = await database(options.signal)
    const totals = { graphEntityCount: 0, graphRelationCount: 0, raptorNodeCount: 0 }

    for (const [documentId, documentChunks] of byDocument) {
      throwIfAborted(options.signal)
      const synchronized = await synchronizeDocument(value, documentId, documentChunks, options.signal)
      totals.graphEntityCount += synchronized.entityCount
      totals.graphRelationCount += synchronized.relationCount
      totals.raptorNodeCount += synchronized.raptorNodeCount
    }

    return { documentCount: byDocument.size, chunkCount: chunks.length, ...totals }
  }

  async function synchronizeDocument(
    value: SqliteDatabase,
    documentId: string,
    chunks: readonly KnowledgeChunkRecord[],
    signal: AbortSignal | undefined,
  ): Promise<{ entityCount: number; relationCount: number; raptorNodeCount: number }> {
    const now = normalizeTimestamp(clock.now(), 'index timestamp')
    try {
      return await value.transaction(async (transaction) => {
        await writeJob(transaction, documentId, 'graphrag-lite', 'running', 0, now, undefined, signal)
        await writeJob(transaction, documentId, 'raptor-lite', 'running', 0, now, undefined, signal)
        await run(transaction, 'DELETE FROM graph_relations WHERE documentId = ?', [documentId], signal)
        await run(transaction, 'DELETE FROM graph_entities WHERE documentId = ?', [documentId], signal)
        const graph = await writeGraphIndex(transaction, documentId, chunks, now, signal)
        await writeJob(transaction, documentId, 'graphrag-lite', 'done', 1, now, undefined, signal)
        await run(transaction, 'DELETE FROM raptor_nodes WHERE documentId = ?', [documentId], signal)
        const raptorNodeCount = await writeRaptorIndex(transaction, documentId, chunks, now, signal)
        await writeJob(transaction, documentId, 'raptor-lite', 'done', 1, now, undefined, signal)
        return { ...graph, raptorNodeCount }
      })
    } catch (error) {
      const cancelled = signal?.aborted || error instanceof KnowledgeAgenticIndexCancelledError
      const terminalNow = normalizeTimestamp(clock.now(), 'index timestamp')
      for (const kind of ['graphrag-lite', 'raptor-lite'] as const) {
        await writeJob(
          value,
          documentId,
          kind,
          cancelled ? 'cancelled' : 'error',
          0,
          terminalNow,
          cancelled ? 'cancelled' : 'Knowledge agentic index operation failed.',
        ).catch(() => undefined)
      }
      if (cancelled) throw new KnowledgeAgenticIndexCancelledError()
      throw error
    }
  }

  async function search(input: SqliteKnowledgeAgenticSearchInput): Promise<readonly KnowledgeAgenticSearchHit[]> {
    const query = normalizeQuery(input.query)
    const limit = normalizeLimit(input.limit)
    const techniques = normalizeTechniques(input.techniques)
    if (!query || !techniques.length) return []
    const value = await database(input.signal)
    const batches: KnowledgeAgenticSearchHit[][] = []
    for (const technique of techniques) {
      throwIfAborted(input.signal)
      batches.push(technique === 'raptor'
        ? await searchRaptor(value, query, limit, input.signal, input.onEmbeddingResolved)
        : await searchGraph(value, query, limit, input.signal))
    }
    const results = rerankKnowledgeSources(query, mergeAgenticKnowledgeCandidates(batches), limit)
    await touchHits(value, results, normalizeTimestamp(clock.now(), 'hit timestamp'), input.signal)
    return results
  }

  async function listJobs(
    limit = 30,
    options: KnowledgeRepositoryOperationOptions = {},
  ): Promise<readonly KnowledgeAgenticJobStatus[]> {
    const normalizedLimit = normalizeJobLimit(limit)
    const value = await database(options.signal)
    const rows = await getAll(
      value,
      `SELECT id, documentId, kind, status, progress, error, createdAt, updatedAt
       FROM indexing_jobs
       WHERE kind IN ('raptor-lite', 'graphrag-lite')
       ORDER BY updatedAt DESC
       LIMIT ?`,
      [normalizedLimit],
      options.signal,
    )
    return rows.map(normalizeJobRow)
  }

  async function deleteDocument(
    documentId: string,
    options: KnowledgeRepositoryOperationOptions = {},
  ): Promise<void> {
    const id = normalizeIdentifier(documentId, 'document id')
    const value = await database(options.signal)
    await value.transaction(async (transaction) => {
      await run(transaction, 'DELETE FROM graph_relations WHERE documentId = ?', [id], options.signal)
      await run(transaction, 'DELETE FROM graph_entities WHERE documentId = ?', [id], options.signal)
      await run(transaction, 'DELETE FROM raptor_nodes WHERE documentId = ?', [id], options.signal)
      await run(
        transaction,
        "DELETE FROM indexing_jobs WHERE documentId = ? AND kind IN ('raptor-lite', 'graphrag-lite')",
        [id],
        options.signal,
      )
      await run(transaction, 'UPDATE knowledge_chunks SET summaryNodeId = NULL WHERE documentId = ?', [id], options.signal)
    })
    throwIfAborted(options.signal)
  }

  async function clear(options: KnowledgeRepositoryOperationOptions = {}): Promise<void> {
    const value = await database(options.signal)
    await value.transaction(async (transaction) => {
      await run(transaction, 'DELETE FROM graph_relations', [], options.signal)
      await run(transaction, 'DELETE FROM graph_entities', [], options.signal)
      await run(transaction, 'DELETE FROM raptor_nodes', [], options.signal)
      await run(
        transaction,
        "DELETE FROM indexing_jobs WHERE kind IN ('raptor-lite', 'graphrag-lite')",
        [],
        options.signal,
      )
      await run(transaction, 'UPDATE knowledge_chunks SET summaryNodeId = NULL', [], options.signal)
    })
    throwIfAborted(options.signal)
  }

  return { synchronize, search, listJobs, deleteDocument, clear }
}

function validateAndGroupChunks(chunks: readonly KnowledgeChunkRecord[]): Map<string, KnowledgeChunkRecord[]> {
  const byDocument = new Map<string, KnowledgeChunkRecord[]>()
  for (const chunk of chunks) {
    const id = normalizeIdentifier(chunk.id, 'chunk id')
    const documentId = normalizeIdentifier(chunk.documentId, 'document id')
    if (typeof chunk.content !== 'string') {
      throw new KnowledgeAgenticIndexDataError(`Chunk ${id} content must be a string.`)
    }
    normalizeNonNegativeInteger(chunk.ordinal, `chunk ${id} ordinal`)
    if (chunk.chunkIndex != null) normalizeNonNegativeInteger(chunk.chunkIndex, `chunk ${id} index`)
    validateStringArray(chunk.entities, `chunk ${id} entities`)
    validateStringArray(chunk.relations, `chunk ${id} relations`)
    const current = byDocument.get(documentId) ?? []
    current.push(chunk)
    byDocument.set(documentId, current)
  }
  return byDocument
}

async function writeGraphIndex(
  database: SqliteExecutor,
  documentId: string,
  chunks: readonly KnowledgeChunkRecord[],
  now: number,
  signal?: AbortSignal,
): Promise<{ entityCount: number; relationCount: number }> {
  const entityChunks = new Map<string, Set<string>>()
  const entityScores = new Map<string, number>()
  const relationChunks = new Map<string, Set<string>>()

  for (const chunk of chunks) {
    throwIfAborted(signal)
    const entities = chunk.entities?.length ? [...chunk.entities] : extractEntities(chunk.content)
    for (const entity of entities.slice(0, 24)) {
      const key = normalizeGraphEntity(entity)
      if (!key) continue
      const ids = entityChunks.get(key) ?? new Set<string>()
      ids.add(chunk.id)
      entityChunks.set(key, ids)
      entityScores.set(key, (entityScores.get(key) ?? 0) + normalizeQualityScore(chunk.qualityScore))
    }
    const relations = chunk.relations?.length ? chunk.relations : buildRelations(entities)
    for (const relation of relations.slice(0, 16)) {
      const parsed = parseRelation(relation)
      if (!parsed) continue
      const source = normalizeGraphEntity(parsed.source)
      const target = normalizeGraphEntity(parsed.target)
      if (!source || !target || source === target) continue
      const key = `${source}->${target}:${parsed.relation}`
      const ids = relationChunks.get(key) ?? new Set<string>()
      ids.add(chunk.id)
      relationChunks.set(key, ids)
    }
  }

  for (const [entity, chunkIds] of entityChunks) {
    await run(
      database,
      `INSERT OR REPLACE INTO graph_entities
        (id, documentId, name, type, score, chunkIdsJson, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        entityId(documentId, entity),
        documentId,
        entity,
        inferEntityType(entity),
        Number(((entityScores.get(entity) ?? 0) / Math.max(1, chunkIds.size)).toFixed(3)),
        JSON.stringify([...chunkIds]),
        now,
      ],
      signal,
    )
  }

  for (const [relationKey, chunkIds] of relationChunks) {
    const parsed = parseRelationKey(relationKey)
    if (!parsed) continue
    await run(
      database,
      `INSERT OR REPLACE INTO graph_relations
        (id, documentId, sourceEntityId, targetEntityId, relation, score, chunkIdsJson, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `graph-relation-${documentId}-${stableHash(relationKey)}`,
        documentId,
        entityId(documentId, parsed.source),
        entityId(documentId, parsed.target),
        parsed.relation,
        Math.min(1, chunkIds.size / 4),
        JSON.stringify([...chunkIds]),
        now,
      ],
      signal,
    )
  }

  return { entityCount: entityChunks.size, relationCount: relationChunks.size }
}

async function writeRaptorIndex(
  database: SqliteExecutor,
  documentId: string,
  chunks: readonly KnowledgeChunkRecord[],
  now: number,
  signal?: AbortSignal,
): Promise<number> {
  const sorted = [...chunks].sort((left, right) => (left.chunkIndex ?? left.ordinal) - (right.chunkIndex ?? right.ordinal))
  const parentIds: string[] = []
  const parentSummaries: Array<{ title: string; summary: string }> = []

  for (let offset = 0; offset < sorted.length; offset += RAPTOR_GROUP_SIZE) {
    throwIfAborted(signal)
    const group = sorted.slice(offset, offset + RAPTOR_GROUP_SIZE)
    const groupIndex = Math.floor(offset / RAPTOR_GROUP_SIZE)
    const id = `raptor-${documentId}-l1-${groupIndex}`
    const title = group[0]?.title ?? 'RAPTOR summary'
    const summary = summarizeRaptorGroup(group)
    parentIds.push(id)
    parentSummaries.push({ title, summary })
    await run(
      database,
      `INSERT OR REPLACE INTO raptor_nodes
        (id, documentId, parentId, level, title, summary, childChunkIdsJson, embeddingJson, createdAt, updatedAt)
       VALUES (?, ?, NULL, 1, ?, ?, ?, ?, ?, ?)`,
      [id, documentId, title, summary, JSON.stringify(group.map((chunk) => chunk.id)), JSON.stringify(createLocalKnowledgeEmbedding(summary)), now, now],
      signal,
    )
    for (const chunk of group) {
      await run(database, 'UPDATE knowledge_chunks SET summaryNodeId = ? WHERE id = ?', [id, chunk.id], signal)
    }
  }

  if (parentIds.length > 1) {
    const combinedSummary = parentSummaries.map((node) => node.summary).join('\n')
    await run(
      database,
      `INSERT OR REPLACE INTO raptor_nodes
        (id, documentId, parentId, level, title, summary, childChunkIdsJson, embeddingJson, createdAt, updatedAt)
       VALUES (?, ?, NULL, 2, ?, ?, ?, ?, ?, ?)`,
      [
        `raptor-${documentId}-root`,
        documentId,
        parentSummaries[0]?.title ?? 'RAPTOR root summary',
        summarizeText(combinedSummary, 900),
        JSON.stringify(parentIds),
        JSON.stringify(createLocalKnowledgeEmbedding(combinedSummary)),
        now,
        now,
      ],
      signal,
    )
  }
  return parentIds.length + (parentIds.length > 1 ? 1 : 0)
}

async function searchRaptor(
  database: SqliteExecutor,
  query: string,
  limit: number,
  signal?: AbortSignal,
  onEmbeddingResolved?: (notice: { source: 'onnx' | 'provider' | 'local-hash'; reason?: string }) => void,
): Promise<KnowledgeAgenticSearchHit[]> {
  const rows = await getAll(
    database,
    `SELECT node.id, node.documentId, node.title, node.summary, node.childChunkIdsJson,
            node.embeddingJson, node.level, document.sourceUri, document.rawPath
     FROM raptor_nodes AS node
     LEFT JOIN knowledge_documents AS document ON document.id = node.documentId
     ORDER BY node.updatedAt DESC
     LIMIT ?`,
    [MAX_PERSISTED_ROWS],
    signal,
  )
  const queryEmbedding = createLocalKnowledgeEmbedding(query)
  onEmbeddingResolved?.({ source: 'local-hash', reason: 'agentic_local_hash' })
  return rows
    .map((row) => normalizeRaptorRow(row, query, queryEmbedding))
    .filter((source) => source.score > 0.02)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
}

function normalizeRaptorRow(
  row: Record<string, unknown>,
  query: string,
  queryEmbedding: number[],
): KnowledgeAgenticSearchHit {
  const result = v.safeParse(raptorRowSchema, row)
  if (!result.success) throw new KnowledgeAgenticIndexDataError()
  const value = result.output
  const id = normalizeIdentifier(value.id, 'persisted RAPTOR node id')
  const documentId = normalizeIdentifier(value.documentId, 'persisted document id')
  const level = normalizePositiveInteger(value.level, 'persisted RAPTOR level')
  const chunkIds = parsePersistedStringArray(value.childChunkIdsJson, 'RAPTOR child chunk ids')
  const embedding = parsePersistedEmbedding(value.embeddingJson, value.summary)
  const vectorScore = knowledgeCosineSimilarity(queryEmbedding, embedding)
  const lexical = tokenOverlapScore(query, `${value.title} ${value.summary}`)
  const score = 0.56 * vectorScore + 0.44 * lexical + Math.min(0.06, level * 0.02)
  return {
    id,
    ...(chunkIds[0] == null ? {} : { chunkId: chunkIds[0] }),
    documentId,
    type: 'knowledge',
    title: `${value.title} · RAPTOR`,
    content: value.summary,
    excerpt: value.summary.slice(0, 180),
    ...(value.sourceUri != null ? { sourceUri: value.sourceUri } : value.rawPath != null ? { sourceUri: value.rawPath } : {}),
    ...(value.rawPath == null ? {} : { rawPath: value.rawPath }),
    score,
    vectorScore,
    retrievalMode: 'vector',
    sourceReason: 'raptor-summary',
  }
}

async function searchGraph(
  database: SqliteExecutor,
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<KnowledgeAgenticSearchHit[]> {
  const entityRows = await getAll(
    database,
    `SELECT documentId, name, score, chunkIdsJson
     FROM graph_entities
     ORDER BY updatedAt DESC
     LIMIT ?`,
    [MAX_PERSISTED_ROWS],
    signal,
  )
  const queryTokens = new Set(tokenizeKnowledgeText(query))
  const matched = new Map<string, GraphMatch>()
  for (const row of entityRows) {
    const value = normalizeGraphEntityRow(row)
    const entityTokens = tokenizeKnowledgeText(value.name)
    const overlap = entityTokens.filter((token) => queryTokens.has(token)).length
    const substring = query.toLowerCase().includes(value.name.toLowerCase()) ? 1 : 0
    const score = Math.min(1, 0.62 * (overlap / Math.max(1, entityTokens.length)) + 0.28 * substring + 0.1 * value.score)
    if (score <= 0.05) continue
    for (const chunkId of value.chunkIds) addGraphMatch(matched, chunkId, { documentId: value.documentId, score, entities: [value.name] })
  }

  const relationRows = await getAll(
    database,
    `SELECT relation.documentId, relation.relation, relation.score, relation.chunkIdsJson,
            source.name AS sourceName, target.name AS targetName
     FROM graph_relations AS relation
     LEFT JOIN graph_entities AS source ON source.id = relation.sourceEntityId
     LEFT JOIN graph_entities AS target ON target.id = relation.targetEntityId
     ORDER BY relation.updatedAt DESC
     LIMIT ?`,
    [MAX_PERSISTED_ROWS],
    signal,
  )
  const lowerQuery = query.toLowerCase()
  for (const row of relationRows) {
    const value = normalizeGraphRelationRow(row)
    const relationText = [value.sourceName, value.relation, value.targetName].filter(Boolean).join(' ')
    const relationTokens = tokenizeKnowledgeText(relationText)
    const overlap = relationTokens.filter((token) => queryTokens.has(token)).length / Math.max(1, relationTokens.length)
    const substring = [value.sourceName, value.targetName, value.relation]
      .filter((part): part is string => Boolean(part))
      .some((part) => lowerQuery.includes(part.toLowerCase())) ? 1 : 0
    const score = Math.min(1, 0.54 * overlap + 0.26 * substring + 0.2 * value.score)
    if (score <= 0.04) continue
    const label = `${value.sourceName || 'entity'}-${value.relation}-${value.targetName || 'entity'}`
    for (const chunkId of value.chunkIds) {
      addGraphMatch(matched, chunkId, {
        documentId: value.documentId,
        score,
        entities: [value.sourceName, value.targetName].filter((item): item is string => Boolean(item)),
        relations: [label],
      })
    }
  }
  if (!matched.size) return []

  const chunkIds = [...matched.keys()]
  const placeholders = chunkIds.map(() => '?').join(',')
  const chunkRows = await getAll(
    database,
    `SELECT chunk.id, chunk.documentId, chunk.title, chunk.content, chunk.ordinal, chunk.chunkIndex,
            chunk.semanticBoundary, chunk.headingPathJson, chunk.qualityScore, chunk.createdAt,
            document.sourceUri, document.rawPath
     FROM knowledge_chunks AS chunk
     LEFT JOIN knowledge_documents AS document ON document.id = chunk.documentId
     WHERE chunk.id IN (${placeholders})`,
    chunkIds,
    signal,
  )
  return chunkRows
    .map((row) => normalizeGraphChunkRow(row, matched))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
}

interface GraphMatch {
  documentId: string
  score: number
  entities: string[]
  relations: string[]
}

function addGraphMatch(
  target: Map<string, GraphMatch>,
  chunkId: string,
  input: { documentId: string; score: number; entities?: readonly string[]; relations?: readonly string[] },
): void {
  const id = normalizeIdentifier(chunkId, 'persisted graph chunk id')
  const existing = target.get(id)
  if (!existing) {
    target.set(id, {
      documentId: input.documentId,
      score: input.score,
      entities: [...new Set(input.entities ?? [])],
      relations: [...new Set(input.relations ?? [])],
    })
    return
  }
  existing.score = Math.max(existing.score, input.score)
  existing.entities = [...new Set([...existing.entities, ...(input.entities ?? [])])]
  existing.relations = [...new Set([...existing.relations, ...(input.relations ?? [])])]
}

function normalizeGraphEntityRow(row: Record<string, unknown>) {
  const result = v.safeParse(graphEntityRowSchema, row)
  if (!result.success) throw new KnowledgeAgenticIndexDataError()
  return {
    documentId: normalizeIdentifier(result.output.documentId, 'persisted graph document id'),
    name: normalizeIdentifier(result.output.name, 'persisted graph entity name'),
    score: normalizeUnitScore(result.output.score ?? 0.5, 'persisted graph entity score'),
    chunkIds: parsePersistedStringArray(result.output.chunkIdsJson, 'graph entity chunk ids'),
  }
}

function normalizeGraphRelationRow(row: Record<string, unknown>) {
  const result = v.safeParse(graphRelationRowSchema, row)
  if (!result.success) throw new KnowledgeAgenticIndexDataError()
  return {
    documentId: normalizeIdentifier(result.output.documentId, 'persisted graph relation document id'),
    relation: normalizeIdentifier(result.output.relation, 'persisted graph relation'),
    score: normalizeUnitScore(result.output.score ?? 0.5, 'persisted graph relation score'),
    chunkIds: parsePersistedStringArray(result.output.chunkIdsJson, 'graph relation chunk ids'),
    sourceName: result.output.sourceName ?? undefined,
    targetName: result.output.targetName ?? undefined,
  }
}

function normalizeGraphChunkRow(
  row: Record<string, unknown>,
  matches: ReadonlyMap<string, GraphMatch>,
): KnowledgeAgenticSearchHit {
  const result = v.safeParse(graphChunkRowSchema, row)
  if (!result.success) throw new KnowledgeAgenticIndexDataError()
  const value = result.output
  const id = normalizeIdentifier(value.id, 'persisted graph chunk id')
  const documentId = normalizeIdentifier(value.documentId, 'persisted graph document id')
  const match = matches.get(id)
  if (!match || match.documentId !== documentId) throw new KnowledgeAgenticIndexDataError('Graph index provenance is inconsistent.')
  const chunkIndex = value.chunkIndex == null ? value.ordinal : value.chunkIndex
  normalizeNonNegativeInteger(chunkIndex, 'persisted graph chunk index')
  const headings = value.headingPathJson == null ? undefined : parsePersistedStringArray(value.headingPathJson, 'chunk heading path')
  return {
    id,
    chunkId: id,
    documentId,
    type: 'knowledge',
    title: value.title,
    content: value.content,
    excerpt: value.content.slice(0, 180),
    chunkIndex,
    ...(value.semanticBoundary == null ? {} : { semanticBoundary: value.semanticBoundary }),
    ...(headings == null ? {} : { headingPath: headings }),
    ...(value.qualityScore == null ? {} : { qualityScore: normalizeUnitScore(value.qualityScore, 'persisted chunk quality score') }),
    createdAt: normalizeTimestamp(value.createdAt, 'persisted chunk timestamp'),
    ...(value.sourceUri != null ? { sourceUri: value.sourceUri } : value.rawPath != null ? { sourceUri: value.rawPath } : {}),
    ...(value.rawPath == null ? {} : { rawPath: value.rawPath }),
    score: match.score,
    retrievalMode: 'hybrid',
    retrievalStage: 'graphrag',
    sourceReason: `graphrag:${[...match.entities.slice(0, 3), ...match.relations.slice(0, 2)].join(',')}`,
  }
}

async function touchHits(
  database: SqliteExecutor,
  sources: readonly KnowledgeAgenticSearchHit[],
  now: number,
  signal?: AbortSignal,
): Promise<void> {
  const ids = [...new Set(sources.map((source) => source.chunkId).filter((id): id is string => Boolean(id)))]
  if (!ids.length) return
  const placeholders = ids.map(() => '?').join(',')
  await run(database, `UPDATE knowledge_chunks SET lastHitAt = ? WHERE id IN (${placeholders})`, [now, ...ids], signal)
}

async function writeJob(
  database: SqliteExecutor,
  documentId: string,
  kind: KnowledgeAgenticJobKind,
  status: KnowledgeAgenticJobStatusValue,
  progress: 0 | 1,
  now: number,
  error?: string,
  signal?: AbortSignal,
): Promise<void> {
  const id = `index-${kind}-${documentId}`
  await run(
    database,
    `INSERT OR REPLACE INTO indexing_jobs
      (id, documentId, kind, status, progress, error, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT createdAt FROM indexing_jobs WHERE id = ?), ?), ?)`,
    [id, documentId, kind, status, progress, error ?? null, id, now, now],
    signal,
  )
}

function normalizeJobRow(row: Record<string, unknown>): KnowledgeAgenticJobStatus {
  const result = v.safeParse(jobRowSchema, row)
  if (!result.success) throw new KnowledgeAgenticIndexDataError('Persisted knowledge indexing job is invalid.')
  const value = result.output
  return {
    id: normalizeIdentifier(value.id, 'persisted indexing job id'),
    ...(value.documentId == null ? {} : { documentId: normalizeIdentifier(value.documentId, 'persisted indexing job document id') }),
    kind: value.kind,
    status: value.status,
    ...(value.progress == null ? {} : { progress: normalizeUnitScore(value.progress, 'persisted indexing job progress') }),
    ...(value.error == null ? {} : { error: value.error }),
    createdAt: normalizeTimestamp(value.createdAt, 'persisted indexing job creation timestamp'),
    updatedAt: normalizeTimestamp(value.updatedAt, 'persisted indexing job update timestamp'),
  }
}

function extractEntities(content: string): string[] {
  const entities = new Set<string>()
  for (const match of content.match(/\b[A-Z][A-Za-z0-9_-]{2,}\b/g) ?? []) entities.add(match)
  for (const match of content.match(/[\u3400-\u9fff]{2,12}/g) ?? []) {
    if (!/^(这个|那个|我们|你们|他们|以及|或者|但是|因为|所以|然后|如果)$/.test(match)) entities.add(match)
  }
  return [...entities].slice(0, 24)
}

function buildRelations(entities: readonly string[]): string[] {
  const result: string[] = []
  for (let index = 0; index < Math.min(entities.length - 1, 12); index += 1) {
    result.push(`${entities[index]}->${entities[index + 1]}`)
  }
  return result
}

function parseRelation(value: string): { source: string; target: string; relation: string } | undefined {
  if (typeof value !== 'string') return undefined
  const arrow = value.match(/^(.+?)->(.+?)(?::(.+))?$/)
  if (arrow) {
    return { source: arrow[1].trim(), target: arrow[2].trim(), relation: (arrow[3] ?? 'related').trim() || 'related' }
  }
  const parts = value.split(/[|,，]/).map((part) => part.trim()).filter(Boolean)
  return parts.length >= 2 ? { source: parts[0], target: parts[1], relation: parts[2] ?? 'related' } : undefined
}

function parseRelationKey(value: string): { source: string; target: string; relation: string } | undefined {
  const separator = value.indexOf(':')
  const pair = separator < 0 ? value : value.slice(0, separator)
  const relation = separator < 0 ? 'related' : value.slice(separator + 1) || 'related'
  const arrow = pair.indexOf('->')
  if (arrow < 1) return undefined
  const source = pair.slice(0, arrow)
  const target = pair.slice(arrow + 2)
  return source && target ? { source, target, relation } : undefined
}

function normalizeGraphEntity(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 96)
}

function inferEntityType(entity: string): string {
  if (/^https?:\/\//i.test(entity)) return 'url'
  if (/^[A-Z][A-Za-z0-9_-]+$/.test(entity)) return 'term'
  if (/[\u3400-\u9fff]/.test(entity)) return 'concept'
  return 'entity'
}

function entityId(documentId: string, entity: string): string {
  return `graph-entity-${documentId}-${stableHash(entity)}`
}

function stableHash(value: string): string {
  return Math.abs(hashKnowledgeText(value)).toString(36)
}

function summarizeRaptorGroup(chunks: readonly KnowledgeChunkRecord[]): string {
  const heading = chunks[0]?.headingPath?.filter(Boolean).join(' / ') || chunks[0]?.title || 'Knowledge'
  const body = chunks.map((chunk) => summarizeText(chunk.content, 220)).filter(Boolean).join('\n')
  return summarizeText(`${heading}\n${body}`, 1200)
}

function summarizeText(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars).trim()}...`
}

function tokenOverlapScore(query: string, text: string): number {
  const queryTokens = new Set(tokenizeKnowledgeText(query))
  const textTokens = new Set(tokenizeKnowledgeText(text))
  if (!queryTokens.size || !textTokens.size) return 0
  let overlap = 0
  for (const token of queryTokens) if (textTokens.has(token)) overlap += 1
  return overlap / queryTokens.size
}

function parsePersistedEmbedding(raw: string | null | undefined, fallback: string): number[] {
  if (raw == null) return createLocalKnowledgeEmbedding(fallback)
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new KnowledgeAgenticIndexDataError('Persisted RAPTOR embedding is invalid JSON.')
  }
  if (!Array.isArray(value) || !value.length || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new KnowledgeAgenticIndexDataError('Persisted RAPTOR embedding is invalid.')
  }
  return value
}

function parsePersistedStringArray(raw: string, label: string): string[] {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new KnowledgeAgenticIndexDataError(`Persisted ${label} is invalid JSON.`)
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new KnowledgeAgenticIndexDataError(`Persisted ${label} is invalid.`)
  }
  return [...new Set(value)]
}

function validateStringArray(value: readonly string[] | undefined, label: string): void {
  if (value != null && (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))) {
    throw new KnowledgeAgenticIndexDataError(`The ${label} must contain only strings.`)
  }
}

function normalizeTechniques(value: readonly KnowledgeAgenticTechnique[]): KnowledgeAgenticTechnique[] {
  if (!Array.isArray(value) || value.some((item) => item !== 'raptor' && item !== 'graphrag')) {
    throw new KnowledgeAgenticIndexDataError('Knowledge agentic techniques are invalid.')
  }
  return [...new Set(value)]
}

function normalizeQuery(query: string): string {
  if (typeof query !== 'string') throw new KnowledgeAgenticIndexDataError('Knowledge agentic query must be a string.')
  const value = query.trim()
  if (value.length > MAX_QUERY_LENGTH) {
    throw new KnowledgeAgenticIndexDataError(`Knowledge agentic query exceeds ${MAX_QUERY_LENGTH} characters.`)
  }
  return value
}

function normalizeLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new KnowledgeAgenticIndexDataError('Knowledge agentic search limit must be a positive integer.')
  }
  return Math.min(limit, MAX_LIMIT)
}

function normalizeJobLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new KnowledgeAgenticIndexDataError('Knowledge agentic job limit must be a positive integer.')
  }
  return Math.min(limit, 120)
}

function normalizeIdentifier(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new KnowledgeAgenticIndexDataError(`The ${label} must be a non-empty string.`)
  }
  return value
}

function normalizeNonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) throw new KnowledgeAgenticIndexDataError(`The ${label} must be a non-negative integer.`)
  return value
}

function normalizePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) throw new KnowledgeAgenticIndexDataError(`The ${label} must be a positive integer.`)
  return value
}

function normalizeTimestamp(value: number, label: string): number {
  return normalizeNonNegativeInteger(value, label)
}

function normalizeUnitScore(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new KnowledgeAgenticIndexDataError(`The ${label} must be between zero and one.`)
  return value
}

function normalizeQualityScore(value: number | undefined): number {
  return value == null ? 0.5 : normalizeUnitScore(value, 'chunk quality score')
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
  if (signal?.aborted) throw new KnowledgeAgenticIndexCancelledError()
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new KnowledgeAgenticIndexCancelledError()
}
