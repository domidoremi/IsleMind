import * as SQLite from 'expo-sqlite'
import type {
  AIProvider,
  Conversation,
  KnowledgeChunk,
  KnowledgeDocument,
  RagEvaluationResult,
  RagEvaluationLog,
  RagIndexingJobStatus,
  RagQueryPlan,
  RagTechnique,
  RetrievalSource,
} from '@/types'
import { embedTextWithProvider } from '@/services/ai/base'
import { createOnnxEmbeddingProvider, rerankRetrievalSources } from '@/services/rag'
import { localModelCacheKey } from '@/services/localEmbeddingModels'
export type { ConversationMetrics } from '@/services/conversationMetrics'

const DB_NAME = 'islemind-context.db'
const VECTOR_DIMENSION = 128
const RAG_CACHE_TTL_MS = 5 * 60 * 1000

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null
let conversationWriteQueue: Promise<void> = Promise.resolve()

export interface ChunkEmbeddingRecord {
  chunkId: string
  embeddingJson: string
  dimension: number
  source: 'provider' | 'local' | 'onnx'
  model?: string
  updatedAt: number
  status: 'ready' | 'fallback' | 'error'
  error?: string
}

export interface SearchHybridOptions {
  limit?: number
  mode?: 'fts' | 'hybrid'
  embeddingMode?: 'provider' | 'local' | 'hybrid'
  localEmbeddingModelId?: string
  localEmbeddingModelSource?: 'bundled' | 'downloaded' | 'none'
  provider?: AIProvider
}

export interface UpsertChunkOptions {
  provider?: AIProvider
  embeddingMode?: 'provider' | 'local' | 'hybrid'
  localEmbeddingModelId?: string
  localEmbeddingModelSource?: 'bundled' | 'downloaded' | 'none'
  refreshAgenticIndex?: boolean
}

export interface SearchAgenticIndexOptions {
  limit?: number
  techniques?: RagTechnique[]
  plan?: Pick<RagQueryPlan, 'enabledTechniques' | 'query'>
}

export interface RagEvaluationLogInput {
  query: string
  plan?: RagQueryPlan
  quality?: RagEvaluationResult
  sourceCount: number
  latencyMs?: number
  flareTriggered?: boolean
  fallbackReasons?: string[]
}

export interface EmbeddingJobStatus {
  id: string
  chunkId: string
  status: string
  source: string
  error?: string
  updatedAt: number
}

async function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS document_sources (
          documentId TEXT PRIMARY KEY NOT NULL,
          sourceUri TEXT,
          rawPath TEXT,
          contentHash TEXT,
          updatedAt INTEGER NOT NULL
        );
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
        CREATE TABLE IF NOT EXISTS request_cache (
          key TEXT PRIMARY KEY NOT NULL,
          valueJson TEXT NOT NULL,
          expiresAt INTEGER NOT NULL,
          createdAt INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS rag_query_cache (
          key TEXT PRIMARY KEY NOT NULL,
          query TEXT NOT NULL,
          resultJson TEXT NOT NULL,
          expiresAt INTEGER NOT NULL,
          createdAt INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS embedding_jobs (
          id TEXT PRIMARY KEY NOT NULL,
          chunkId TEXT NOT NULL,
          status TEXT NOT NULL,
          source TEXT NOT NULL,
          error TEXT,
          updatedAt INTEGER NOT NULL
        );
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
        CREATE TABLE IF NOT EXISTS colbert_embeddings (
          id TEXT PRIMARY KEY NOT NULL,
          chunkId TEXT NOT NULL,
          tokenIndex INTEGER NOT NULL,
          token TEXT NOT NULL,
          embeddingJson TEXT NOT NULL,
          model TEXT,
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
        CREATE TABLE IF NOT EXISTS graph_entities (
          id TEXT PRIMARY KEY NOT NULL,
          documentId TEXT,
          name TEXT NOT NULL,
          type TEXT,
          score REAL,
          chunkIdsJson TEXT NOT NULL,
          updatedAt INTEGER NOT NULL
        );
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
        CREATE TABLE IF NOT EXISTS rag_evaluation_logs (
          id TEXT PRIMARY KEY NOT NULL,
          query TEXT NOT NULL,
          planJson TEXT,
          qualityJson TEXT,
          sourceCount INTEGER NOT NULL,
          latencyMs INTEGER,
          createdAt INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS conversation_records (
          id TEXT PRIMARY KEY NOT NULL,
          title TEXT NOT NULL,
          providerId TEXT NOT NULL,
          model TEXT NOT NULL,
          updatedAt INTEGER NOT NULL,
          payloadJson TEXT NOT NULL
        );
      `)
      return db
    })
  }
  return dbPromise
}

export const localDataStore = {
  initialize,
  upsertDocument,
  upsertChunks,
  rebuildKnowledgeEmbeddings,
  searchHybrid,
  searchAgenticIndexes,
  logRagEvaluation,
  listRagEvaluationLogs,
  listIndexingJobs,
  clearRagCaches,
  listEmbeddingJobs,
  loadConversations,
  saveConversations,
  clearConversations,
  deleteKnowledgeDocumentIndexes,
  clearKnowledgeIndexes,
}

export async function initialize(): Promise<void> {
  await getDb()
}

export async function upsertDocument(document: KnowledgeDocument): Promise<void> {
  const db = await getDb()
  await db.runAsync(
    'INSERT OR REPLACE INTO document_sources (documentId, sourceUri, rawPath, contentHash, updatedAt) VALUES (?, ?, ?, ?, ?)',
    document.id,
    document.sourceUri ?? null,
    document.rawPath ?? null,
    document.contentHash ?? null,
    Date.now()
  )
}

export async function upsertChunks(chunks: KnowledgeChunk[], options: UpsertChunkOptions = {}): Promise<void> {
  const db = await getDb()
  const now = Date.now()
  const onnxProvider = await resolveOnnxProvider(options.embeddingMode, options)
  for (const chunk of chunks) {
    let embedding = createLocalEmbedding(chunk.content)
    let source: ChunkEmbeddingRecord['source'] = 'local'
    let model = 'local-hash-bow-v1'
    let status: ChunkEmbeddingRecord['status'] = 'fallback'
    let error: string | null = null
    if (onnxProvider) {
      try {
        embedding = await onnxProvider.embed(chunk.content)
        source = 'onnx'
        model = activeLocalModelId(options)
        status = 'ready'
        chunk.embeddingProvider = 'onnx'
      } catch (embedError) {
        error = embedError instanceof Error ? embedError.message : 'ONNX embedding failed'
      }
    }
    await db.runAsync(
      'INSERT OR REPLACE INTO chunk_embeddings (chunkId, embeddingJson, dimension, source, model, updatedAt, status, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      chunk.id,
      JSON.stringify(embedding),
      embedding.length,
      source,
      model,
      now,
      status,
      error
    )
    await db.runAsync('UPDATE knowledge_chunks SET embeddingProvider = ? WHERE id = ?', source === 'onnx' ? 'onnx' : 'hash', chunk.id).catch(() => undefined)
  }
  if (options.refreshAgenticIndex !== false) {
    await upsertAgenticIndexes(chunks, now)
  }
  if (options.provider?.apiKey && options.embeddingMode !== 'local') {
    void upgradeChunksWithProviderEmbeddings(chunks, options.provider)
  }
}

export async function rebuildKnowledgeEmbeddings(options: UpsertChunkOptions = {}): Promise<number> {
  const db = await getDb()
  const rows = await db.getAllAsync<KnowledgeChunk>(
    'SELECT id, documentId, title, content, ordinal, chunkIndex, sentenceStart, sentenceEnd, semanticBoundary, headingPathJson, entitiesJson, relationsJson, summaryNodeId, parentChunkId, qualityScore, embeddingModelId, rerankSignalsJson, embeddingProvider, lastHitAt, createdAt FROM knowledge_chunks ORDER BY createdAt DESC, ordinal ASC'
  )
  await upsertChunks(rows, options)
  await clearRagCaches()
  return rows.length
}

export async function searchHybrid(query: string, options: SearchHybridOptions = {}): Promise<RetrievalSource[]> {
  await initialize()
  const mode = options.mode ?? 'hybrid'
  const limit = Math.max(1, Math.min(options.limit ?? 4, 12))
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return []

  const cacheKey = `rag:${mode}:${options.embeddingMode ?? 'hybrid'}:${localModelCacheKey(options)}:${limit}:${hashString(normalizedQuery)}`
  const cached = await readRagCache(cacheKey)
  if (cached) return cached

  const [ftsRows, vectorRows] = await Promise.all([
    searchKnowledgeFts(normalizedQuery, 20),
    mode === 'hybrid' ? searchKnowledgeVector(normalizedQuery, 20, options) : Promise.resolve([]),
  ])

  const merged = new Map<string, RetrievalSource>()
  for (const row of ftsRows) {
    const ftsScore = normalizeFtsScore(row.score ?? 0)
    merged.set(row.id, {
      ...row,
      score: ftsScore,
      ftsScore,
      retrievalMode: 'fts',
    })
  }
  for (const row of vectorRows) {
    const existing = merged.get(row.id)
    const vectorScore = row.vectorScore ?? row.score ?? 0
    const ftsScore = existing?.ftsScore ?? 0
    merged.set(row.id, {
      ...(existing ?? row),
      score: mode === 'hybrid' ? vectorScore * 0.62 + ftsScore * 0.38 : vectorScore,
      vectorScore,
      ftsScore: existing?.ftsScore,
      retrievalMode: existing ? 'hybrid' : 'vector',
    })
  }

  const results = rerankRetrievalSources(normalizedQuery, Array.from(merged.values()), limit)
  await touchKnowledgeHits(results)
  await writeRagCache(cacheKey, normalizedQuery, results)
  return results
}

export async function searchAgenticIndexes(query: string, options: SearchAgenticIndexOptions = {}): Promise<RetrievalSource[]> {
  await initialize()
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return []
  const limit = Math.max(1, Math.min(options.limit ?? 8, 24))
  const techniques = new Set(options.techniques ?? options.plan?.enabledTechniques ?? [])
  const batches: RetrievalSource[][] = []
  if (techniques.has('raptor')) batches.push(await searchRaptorIndex(normalizedQuery, limit))
  if (techniques.has('graphrag')) batches.push(await searchGraphIndex(normalizedQuery, limit))
  if (techniques.has('colbert')) batches.push(await searchColbertIndex(normalizedQuery, limit))
  if (!batches.length) return []

  const merged = new Map<string, RetrievalSource>()
  for (const source of batches.flat()) {
    const key = source.chunkId ?? source.id
    const existing = merged.get(key)
    if (!existing || (source.score ?? 0) > (existing.score ?? 0)) {
      merged.set(key, existing ? { ...source, sourceReason: mergeSourceReason(existing.sourceReason, source.sourceReason) } : source)
    }
  }
  const results = rerankRetrievalSources(normalizedQuery, Array.from(merged.values()), limit)
  await touchKnowledgeHits(results)
  return results
}

export async function logRagEvaluation(input: RagEvaluationLogInput): Promise<void> {
  const db = await getDb()
  const now = Date.now()
  const quality = input.quality
    ? {
        ...input.quality,
        flareTriggered: input.flareTriggered ?? input.quality.flareTriggered,
        fallbackReasons: Array.from(new Set([...(input.quality.fallbackReasons ?? []), ...(input.fallbackReasons ?? [])])),
        latencyMs: input.latencyMs ?? input.quality.latencyMs,
      }
    : undefined
  await db.runAsync(
    'INSERT OR REPLACE INTO rag_evaluation_logs (id, query, planJson, qualityJson, sourceCount, latencyMs, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    `rag-eval-${now}-${Math.abs(hashString(input.query)).toString(36)}`,
    input.query.slice(0, 2000),
    input.plan ? JSON.stringify(input.plan) : null,
    quality ? JSON.stringify(quality) : null,
    input.sourceCount,
    input.latencyMs ?? null,
    now
  )
}

export async function listRagEvaluationLogs(limit = 12): Promise<RagEvaluationLog[]> {
  const db = await getDb()
  const rows = await db.getAllAsync<{ id: string; query: string; planJson?: string; qualityJson?: string; sourceCount: number; latencyMs?: number; createdAt: number }>(
    'SELECT id, query, planJson, qualityJson, sourceCount, latencyMs, createdAt FROM rag_evaluation_logs ORDER BY createdAt DESC LIMIT ?',
    Math.max(1, Math.min(limit, 100))
  )
  return rows.map((row) => ({
    id: row.id,
    query: row.query,
    plan: parseJsonObject<RagQueryPlan>(row.planJson),
    quality: parseJsonObject<RagEvaluationResult>(row.qualityJson),
    sourceCount: row.sourceCount,
    latencyMs: row.latencyMs,
    createdAt: row.createdAt,
  }))
}

export async function listIndexingJobs(limit = 30): Promise<RagIndexingJobStatus[]> {
  const db = await getDb()
  return db.getAllAsync<RagIndexingJobStatus>(
    'SELECT id, documentId, kind, status, progress, error, createdAt, updatedAt FROM indexing_jobs ORDER BY updatedAt DESC LIMIT ?',
    Math.max(1, Math.min(limit, 120))
  )
}

export async function clearRagCaches(): Promise<void> {
  const db = await getDb()
  await db.runAsync('DELETE FROM request_cache')
  await db.runAsync('DELETE FROM rag_query_cache')
  await db.runAsync('DELETE FROM embedding_jobs')
}

export async function listEmbeddingJobs(limit = 20): Promise<EmbeddingJobStatus[]> {
  const db = await getDb()
  return db.getAllAsync<EmbeddingJobStatus>(
    'SELECT id, chunkId, status, source, error, updatedAt FROM embedding_jobs ORDER BY updatedAt DESC LIMIT ?',
    Math.max(1, Math.min(limit, 100))
  )
}

export async function loadConversations(): Promise<Conversation[]> {
  const db = await getDb()
  const rows = await db.getAllAsync<{ payloadJson: string; updatedAt: number }>(
    'SELECT payloadJson, updatedAt FROM conversation_records ORDER BY updatedAt DESC'
  )
  const conversations: Conversation[] = []
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.payloadJson) as Conversation
      conversations.push(parsed)
    } catch {
      // Ignore corrupt rows rather than blocking app startup.
    }
  }
  return conversations
}

export async function saveConversations(conversations: Conversation[]): Promise<void> {
  const snapshot = conversations.map((conversation) => ({ ...conversation, messages: [...conversation.messages] }))
  conversationWriteQueue = conversationWriteQueue
    .catch(() => undefined)
    .then(async () => {
      const db = await getDb()
      await db.runAsync('DELETE FROM conversation_records')
      for (const conversation of snapshot) {
        await db.runAsync(
          'INSERT OR REPLACE INTO conversation_records (id, title, providerId, model, updatedAt, payloadJson) VALUES (?, ?, ?, ?, ?, ?)',
          conversation.id,
          conversation.title,
          conversation.providerId,
          conversation.model,
          conversation.updatedAt,
          JSON.stringify(conversation)
        )
      }
    })
  await conversationWriteQueue
}

export async function clearConversations(): Promise<void> {
  const db = await getDb()
  await db.runAsync('DELETE FROM conversation_records')
}

export async function deleteKnowledgeDocumentIndexes(documentId: string): Promise<void> {
  const db = await getDb()
  await db.runAsync('DELETE FROM chunk_embeddings WHERE chunkId IN (SELECT id FROM knowledge_chunks WHERE documentId = ?)', documentId)
  await db.runAsync('DELETE FROM colbert_embeddings WHERE chunkId IN (SELECT id FROM knowledge_chunks WHERE documentId = ?)', documentId)
  await db.runAsync('DELETE FROM raptor_nodes WHERE documentId = ?', documentId)
  await db.runAsync('DELETE FROM graph_relations WHERE documentId = ?', documentId)
  await db.runAsync('DELETE FROM graph_entities WHERE documentId = ?', documentId)
  await db.runAsync('DELETE FROM indexing_jobs WHERE documentId = ?', documentId)
  await clearRagCaches()
}

export async function clearKnowledgeIndexes(): Promise<void> {
  const db = await getDb()
  await db.runAsync('DELETE FROM chunk_embeddings')
  await db.runAsync('DELETE FROM colbert_embeddings')
  await db.runAsync('DELETE FROM raptor_nodes')
  await db.runAsync('DELETE FROM graph_relations')
  await db.runAsync('DELETE FROM graph_entities')
  await db.runAsync('DELETE FROM indexing_jobs')
  await clearRagCaches()
}

async function upgradeChunksWithProviderEmbeddings(chunks: KnowledgeChunk[], provider: AIProvider): Promise<void> {
  const db = await getDb()
  for (const chunk of chunks.slice(0, 80)) {
    const jobId = `embed-${chunk.id}`
    const now = Date.now()
    await db.runAsync(
      'INSERT OR REPLACE INTO embedding_jobs (id, chunkId, status, source, error, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
      jobId,
      chunk.id,
      'running',
      'provider',
      null,
      now
    )
    try {
      const result = await embedTextWithProvider(provider, chunk.content)
      await db.runAsync(
        'INSERT OR REPLACE INTO chunk_embeddings (chunkId, embeddingJson, dimension, source, model, updatedAt, status, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        chunk.id,
        JSON.stringify(result.embedding),
        result.embedding.length,
        result.source,
        result.model,
        Date.now(),
        'ready',
        null
      )
      await db.runAsync('UPDATE embedding_jobs SET status = ?, error = ?, updatedAt = ? WHERE id = ?', 'done', null, Date.now(), jobId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'embedding failed'
      await db.runAsync('UPDATE embedding_jobs SET status = ?, error = ?, updatedAt = ? WHERE id = ?', 'error', message, Date.now(), jobId)
    }
  }
}

async function searchKnowledgeFts(query: string, limit: number): Promise<RetrievalSource[]> {
  const ftsQuery = buildFtsQuery(query)
  if (!ftsQuery) return []
  const db = await getDb()
  try {
    const rows = await db.getAllAsync<KnowledgeChunk & { score: number }>(
      `
        SELECT c.id, c.documentId, c.title, c.content, c.ordinal, c.chunkIndex, c.sentenceStart, c.sentenceEnd,
               c.semanticBoundary, c.headingPathJson, c.entitiesJson, c.relationsJson, c.summaryNodeId, c.parentChunkId,
               c.qualityScore, c.embeddingModelId, c.rerankSignalsJson, c.embeddingProvider, c.lastHitAt, c.createdAt,
               bm25(knowledge_fts) AS score
        FROM knowledge_fts
        JOIN knowledge_chunks c ON c.id = knowledge_fts.id
        WHERE knowledge_fts MATCH ?
        ORDER BY score
        LIMIT ?
      `,
      ftsQuery,
      limit
    )
    return rows.map(chunkToSource)
  } catch {
    return []
  }
}

async function searchKnowledgeVector(query: string, limit: number, options: SearchHybridOptions): Promise<RetrievalSource[]> {
  const db = await getDb()
  const rows = await db.getAllAsync<KnowledgeChunk & Partial<ChunkEmbeddingRecord>>(
    `
      SELECT c.id, c.documentId, c.title, c.content, c.ordinal, c.chunkIndex, c.sentenceStart, c.sentenceEnd,
             c.semanticBoundary, c.headingPathJson, c.entitiesJson, c.relationsJson, c.summaryNodeId, c.parentChunkId,
             c.qualityScore, c.embeddingModelId, c.rerankSignalsJson, c.embeddingProvider, c.lastHitAt, c.createdAt,
             e.embeddingJson, e.dimension, e.source, e.model, e.status
      FROM knowledge_chunks c
      LEFT JOIN chunk_embeddings e ON e.chunkId = c.id
      ORDER BY c.createdAt DESC
      LIMIT 420
    `
  )
  if (!rows.length) return []

  const queryEmbedding = await createQueryEmbedding(query, rows, options)
  const scored: RetrievalSource[] = []
  const chunksNeedingLocalEmbedding: KnowledgeChunk[] = []

  for (const row of rows) {
    let vector = parseEmbedding(row.embeddingJson)
    if (!vector || vector.length !== queryEmbedding.length) {
      vector = createLocalEmbedding(row.content)
      chunksNeedingLocalEmbedding.push(row)
    }
    const vectorScore = cosineSimilarity(queryEmbedding, vector)
    if (vectorScore <= 0) continue
    scored.push({
      ...chunkToSource(row),
      score: vectorScore,
      vectorScore,
      retrievalMode: 'vector',
    })
  }

  if (chunksNeedingLocalEmbedding.length) {
    void upsertChunks(chunksNeedingLocalEmbedding)
  }

  return scored.sort((a, b) => (b.vectorScore ?? 0) - (a.vectorScore ?? 0)).slice(0, limit)
}

async function createQueryEmbedding(query: string, chunks: Partial<ChunkEmbeddingRecord>[], options: SearchHybridOptions): Promise<number[]> {
  const onnxVectorExists = chunks.some((chunk) => chunk.source === 'onnx' && typeof chunk.embeddingJson === 'string' && chunk.model === activeLocalModelId(options))
  if (options.embeddingMode !== 'provider' && onnxVectorExists) {
    const onnxProvider = await resolveOnnxProvider(options.embeddingMode, options)
    if (onnxProvider) {
      try {
        const result = await onnxProvider.embed(query)
        if (result.length) return result
      } catch {
        // Local hash vectors remain available when ONNX is unavailable.
      }
    }
  }
  const providerReady = options.embeddingMode !== 'local' && options.provider?.apiKey
  const providerVectorExists = chunks.some((chunk) => chunk.source === 'provider' && typeof chunk.embeddingJson === 'string')
  if (providerReady && providerVectorExists) {
    try {
      const result = await embedTextWithProvider(options.provider!, query)
      if (result.embedding.length) return result.embedding
    } catch {
      // Provider embedding is an optional quality upgrade; local hash vectors keep RAG usable offline.
    }
  }
  return createLocalEmbedding(query)
}

function chunkToSource(chunk: KnowledgeChunk & { score?: number }): RetrievalSource {
  const raw = chunk as KnowledgeChunk & { headingPathJson?: string; entitiesJson?: string; rerankSignalsJson?: string }
  return {
    id: chunk.id,
    type: 'knowledge',
    title: chunk.title,
    content: chunk.content,
    excerpt: chunk.content.slice(0, 180),
    documentId: chunk.documentId,
    chunkId: chunk.id,
    chunkIndex: chunk.chunkIndex ?? chunk.ordinal,
    score: chunk.score,
    semanticBoundary: chunk.semanticBoundary,
    headingPath: chunk.headingPath ?? parseJsonArray(raw.headingPathJson),
    qualityScore: chunk.qualityScore,
    sourceReason: raw.rerankSignalsJson || raw.entitiesJson ? 'indexed-signals' : undefined,
  }
}

async function upsertAgenticIndexes(chunks: KnowledgeChunk[], now: number): Promise<void> {
  if (!chunks.length) return
  const db = await getDb()
  const byDocument = new Map<string, KnowledgeChunk[]>()
  for (const chunk of chunks) {
    if (!byDocument.has(chunk.documentId)) byDocument.set(chunk.documentId, [])
    byDocument.get(chunk.documentId)!.push(chunk)
  }

  for (const [documentId, documentChunks] of byDocument.entries()) {
    await writeIndexingJob(db, documentId, 'colbert-lite', 'running', now)
    await db.runAsync('DELETE FROM colbert_embeddings WHERE chunkId IN (SELECT id FROM knowledge_chunks WHERE documentId = ?)', documentId)
    for (const chunk of documentChunks) {
      const tokens = Array.from(new Set(tokenize(chunk.content))).slice(0, 48)
      for (const [tokenIndex, token] of tokens.entries()) {
        await db.runAsync(
          'INSERT OR REPLACE INTO colbert_embeddings (id, chunkId, tokenIndex, token, embeddingJson, model, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
          `colbert-${chunk.id}-${tokenIndex}`,
          chunk.id,
          tokenIndex,
          token,
          JSON.stringify(createLocalEmbedding(token)),
          'local-token-hash-v1',
          now
        )
      }
    }
    await writeIndexingJob(db, documentId, 'colbert-lite', 'done', now, 1)

    await writeIndexingJob(db, documentId, 'graphrag-lite', 'running', now)
    await db.runAsync('DELETE FROM graph_relations WHERE documentId = ?', documentId)
    await db.runAsync('DELETE FROM graph_entities WHERE documentId = ?', documentId)
    await upsertGraphIndex(db, documentId, documentChunks, now)
    await writeIndexingJob(db, documentId, 'graphrag-lite', 'done', now, 1)

    await writeIndexingJob(db, documentId, 'raptor-lite', 'running', now)
    await db.runAsync('DELETE FROM raptor_nodes WHERE documentId = ?', documentId)
    await upsertRaptorIndex(db, documentId, documentChunks, now)
    await writeIndexingJob(db, documentId, 'raptor-lite', 'done', now, 1)
  }
}

async function writeIndexingJob(
  db: SQLite.SQLiteDatabase,
  documentId: string,
  kind: string,
  status: string,
  now: number,
  progress = 0,
  error?: string
): Promise<void> {
  await db.runAsync(
    'INSERT OR REPLACE INTO indexing_jobs (id, documentId, kind, status, progress, error, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT createdAt FROM indexing_jobs WHERE id = ?), ?), ?)',
    `index-${kind}-${documentId}`,
    documentId,
    kind,
    status,
    progress,
    error ?? null,
    `index-${kind}-${documentId}`,
    now,
    now
  )
}

async function upsertGraphIndex(db: SQLite.SQLiteDatabase, documentId: string, chunks: KnowledgeChunk[], now: number): Promise<void> {
  const entityChunks = new Map<string, Set<string>>()
  const entityScores = new Map<string, number>()
  const relationChunks = new Map<string, Set<string>>()

  for (const chunk of chunks) {
    const entities = chunk.entities?.length ? chunk.entities : extractIndexEntities(chunk.content)
    for (const entity of entities.slice(0, 24)) {
      const key = normalizeGraphEntity(entity)
      if (!key) continue
      if (!entityChunks.has(key)) entityChunks.set(key, new Set())
      entityChunks.get(key)!.add(chunk.id)
      entityScores.set(key, (entityScores.get(key) ?? 0) + (chunk.qualityScore ?? 0.5))
    }
    const relations = chunk.relations?.length ? chunk.relations : buildIndexRelations(entities)
    for (const relation of relations.slice(0, 16)) {
      const parsed = parseRelation(relation)
      if (!parsed) continue
      const source = normalizeGraphEntity(parsed.source)
      const target = normalizeGraphEntity(parsed.target)
      if (!source || !target || source === target) continue
      const relationKey = `${source}->${target}:${parsed.relation}`
      if (!relationChunks.has(relationKey)) relationChunks.set(relationKey, new Set())
      relationChunks.get(relationKey)!.add(chunk.id)
    }
  }

  for (const [entity, chunkIds] of entityChunks.entries()) {
    await db.runAsync(
      'INSERT OR REPLACE INTO graph_entities (id, documentId, name, type, score, chunkIdsJson, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      `graph-entity-${documentId}-${Math.abs(hashString(entity)).toString(36)}`,
      documentId,
      entity,
      inferEntityType(entity),
      Number(((entityScores.get(entity) ?? 0) / Math.max(1, chunkIds.size)).toFixed(3)),
      JSON.stringify(Array.from(chunkIds)),
      now
    )
  }

  for (const [relationKey, chunkIds] of relationChunks.entries()) {
    const [pair, relation] = relationKey.split(':')
    const [source, target] = pair.split('->')
    if (!source || !target) continue
    await db.runAsync(
      'INSERT OR REPLACE INTO graph_relations (id, documentId, sourceEntityId, targetEntityId, relation, score, chunkIdsJson, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      `graph-relation-${documentId}-${Math.abs(hashString(relationKey)).toString(36)}`,
      documentId,
      `graph-entity-${documentId}-${Math.abs(hashString(source)).toString(36)}`,
      `graph-entity-${documentId}-${Math.abs(hashString(target)).toString(36)}`,
      relation || 'related',
      Math.min(1, chunkIds.size / 4),
      JSON.stringify(Array.from(chunkIds)),
      now
    )
  }
}

async function upsertRaptorIndex(db: SQLite.SQLiteDatabase, documentId: string, chunks: KnowledgeChunk[], now: number): Promise<void> {
  const sorted = [...chunks].sort((a, b) => (a.chunkIndex ?? a.ordinal) - (b.chunkIndex ?? b.ordinal))
  const groups: KnowledgeChunk[][] = []
  for (let index = 0; index < sorted.length; index += 4) {
    groups.push(sorted.slice(index, index + 4))
  }
  const parentIds: string[] = []
  for (const [groupIndex, group] of groups.entries()) {
    const summary = summarizeRaptorGroup(group)
    const id = `raptor-${documentId}-l1-${groupIndex}`
    parentIds.push(id)
    await db.runAsync(
      'INSERT OR REPLACE INTO raptor_nodes (id, documentId, parentId, level, title, summary, childChunkIdsJson, embeddingJson, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      documentId,
      null,
      1,
      group[0]?.title ?? 'RAPTOR summary',
      summary,
      JSON.stringify(group.map((chunk) => chunk.id)),
      JSON.stringify(createLocalEmbedding(summary)),
      now,
      now
    )
    await Promise.all(group.map((chunk) => db.runAsync('UPDATE knowledge_chunks SET summaryNodeId = ? WHERE id = ?', id, chunk.id)))
  }
  if (parentIds.length > 1) {
    const parentSummaries = await db.getAllAsync<{ id: string; summary: string; title: string }>(
      `SELECT id, summary, title FROM raptor_nodes WHERE documentId = ? AND level = 1 ORDER BY id`,
      documentId
    )
    const summary = parentSummaries.map((node) => node.summary).join('\n')
    await db.runAsync(
      'INSERT OR REPLACE INTO raptor_nodes (id, documentId, parentId, level, title, summary, childChunkIdsJson, embeddingJson, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      `raptor-${documentId}-root`,
      documentId,
      null,
      2,
      parentSummaries[0]?.title ?? 'RAPTOR root summary',
      summarizeText(summary, 900),
      JSON.stringify(parentIds),
      JSON.stringify(createLocalEmbedding(summary)),
      now,
      now
    )
  }
}

async function searchRaptorIndex(query: string, limit: number): Promise<RetrievalSource[]> {
  const db = await getDb()
  const rows = await db.getAllAsync<{ id: string; documentId: string; title: string; summary: string; childChunkIdsJson: string; embeddingJson?: string; level: number }>(
    'SELECT id, documentId, title, summary, childChunkIdsJson, embeddingJson, level FROM raptor_nodes ORDER BY updatedAt DESC LIMIT 240'
  )
  const queryEmbedding = createLocalEmbedding(query)
  return rows
    .map((node) => {
      const vectorScore = cosineSimilarity(queryEmbedding, parseEmbedding(node.embeddingJson) ?? createLocalEmbedding(node.summary))
      const lexical = tokenOverlapScore(query, `${node.title} ${node.summary}`)
      const score = 0.56 * vectorScore + 0.44 * lexical + Math.min(0.06, node.level * 0.02)
      const chunkIds = parseJsonArray(node.childChunkIdsJson) ?? []
      return {
        id: node.id,
        type: 'knowledge' as const,
        title: `${node.title} · RAPTOR`,
        content: node.summary,
        excerpt: node.summary.slice(0, 180),
        documentId: node.documentId,
        chunkId: chunkIds[0],
        score,
        vectorScore,
        retrievalMode: 'vector' as const,
        sourceReason: 'raptor-summary',
      }
    })
    .filter((source) => (source.score ?? 0) > 0.02)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit)
}

async function searchGraphIndex(query: string, limit: number): Promise<RetrievalSource[]> {
  const db = await getDb()
  const rows = await db.getAllAsync<{ id: string; documentId: string; name: string; type?: string; score?: number; chunkIdsJson: string }>(
    'SELECT id, documentId, name, type, score, chunkIdsJson FROM graph_entities ORDER BY updatedAt DESC LIMIT 420'
  )
  const queryTokens = new Set(tokenize(query))
  const matchedChunkIds = new Map<string, { score: number; entities: string[]; relations: string[]; documentId: string }>()
  function addGraphMatch(chunkId: string, match: { score: number; entities?: string[]; relations?: string[]; documentId: string }) {
    const existing = matchedChunkIds.get(chunkId)
    if (!existing) {
      matchedChunkIds.set(chunkId, {
        score: match.score,
        entities: Array.from(new Set(match.entities ?? [])),
        relations: Array.from(new Set(match.relations ?? [])),
        documentId: match.documentId,
      })
      return
    }
    existing.score = Math.max(existing.score, match.score)
    existing.entities = Array.from(new Set([...existing.entities, ...(match.entities ?? [])]))
    existing.relations = Array.from(new Set([...existing.relations, ...(match.relations ?? [])]))
  }
  for (const row of rows) {
    const entityTokens = tokenize(row.name)
    const overlap = entityTokens.filter((token) => queryTokens.has(token)).length
    const substring = query.toLowerCase().includes(row.name.toLowerCase()) ? 1 : 0
    const score = Math.min(1, 0.62 * (overlap / Math.max(1, entityTokens.length)) + 0.28 * substring + 0.1 * (row.score ?? 0.5))
    if (score <= 0.05) continue
    for (const chunkId of parseJsonArray(row.chunkIdsJson) ?? []) {
      addGraphMatch(chunkId, { score, entities: [row.name], documentId: row.documentId })
    }
  }
  const relationRows = await db.getAllAsync<{
    id: string
    documentId: string
    relation: string
    score?: number
    chunkIdsJson: string
    sourceName?: string
    targetName?: string
  }>(
    `SELECT r.id, r.documentId, r.relation, r.score, r.chunkIdsJson, source.name AS sourceName, target.name AS targetName
     FROM graph_relations r
     LEFT JOIN graph_entities source ON source.id = r.sourceEntityId
     LEFT JOIN graph_entities target ON target.id = r.targetEntityId
     ORDER BY r.updatedAt DESC
     LIMIT 420`
  )
  const lowerQuery = query.toLowerCase()
  for (const row of relationRows) {
    const sourceName = row.sourceName ?? ''
    const targetName = row.targetName ?? ''
    const relationText = [sourceName, row.relation, targetName].filter(Boolean).join(' ')
    const relationTokens = tokenize(relationText)
    const overlap = relationTokens.filter((token) => queryTokens.has(token)).length / Math.max(1, relationTokens.length)
    const substring = [sourceName, targetName, row.relation]
      .filter(Boolean)
      .some((part) => lowerQuery.includes(part.toLowerCase())) ? 1 : 0
    const score = Math.min(1, 0.54 * overlap + 0.26 * substring + 0.2 * (row.score ?? 0.5))
    if (score <= 0.04) continue
    const relationLabel = `${sourceName || 'entity'}-${row.relation || 'related'}-${targetName || 'entity'}`
    for (const chunkId of parseJsonArray(row.chunkIdsJson) ?? []) {
      addGraphMatch(chunkId, {
        score,
        entities: [sourceName, targetName].filter(Boolean),
        relations: [relationLabel],
        documentId: row.documentId,
      })
    }
  }
  if (!matchedChunkIds.size) return []
  const placeholders = Array.from(matchedChunkIds.keys()).map(() => '?').join(',')
  const chunks = await db.getAllAsync<KnowledgeChunk>(
    `SELECT id, documentId, title, content, ordinal, chunkIndex, sentenceStart, sentenceEnd,
            semanticBoundary, headingPathJson, entitiesJson, relationsJson, summaryNodeId, parentChunkId,
            qualityScore, embeddingModelId, rerankSignalsJson, embeddingProvider, lastHitAt, createdAt
     FROM knowledge_chunks WHERE id IN (${placeholders})`,
    ...Array.from(matchedChunkIds.keys())
  )
  return chunks
    .map((chunk) => {
      const match = matchedChunkIds.get(chunk.id)!
      return {
        ...chunkToSource(chunk),
        score: match.score,
        retrievalMode: 'hybrid' as const,
        retrievalStage: 'graphrag',
        sourceReason: `graphrag:${[...match.entities.slice(0, 3), ...match.relations.slice(0, 2)].join(',')}`,
      }
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit)
}

async function searchColbertIndex(query: string, limit: number): Promise<RetrievalSource[]> {
  const db = await getDb()
  const tokens = tokenize(query).slice(0, 24)
  if (!tokens.length) return []
  const placeholders = tokens.map(() => '?').join(',')
  const rows = await db.getAllAsync<{ chunkId: string; matched: number }>(
    `SELECT chunkId, COUNT(DISTINCT token) AS matched FROM colbert_embeddings WHERE token IN (${placeholders}) GROUP BY chunkId ORDER BY matched DESC LIMIT ?`,
    ...tokens,
    Math.max(limit * 6, 24)
  )
  if (!rows.length) return []
  const chunkIds = rows.map((row) => row.chunkId)
  const chunkPlaceholders = chunkIds.map(() => '?').join(',')
  const chunks = await db.getAllAsync<KnowledgeChunk>(
    `SELECT id, documentId, title, content, ordinal, chunkIndex, sentenceStart, sentenceEnd,
            semanticBoundary, headingPathJson, entitiesJson, relationsJson, summaryNodeId, parentChunkId,
            qualityScore, embeddingModelId, rerankSignalsJson, embeddingProvider, lastHitAt, createdAt
     FROM knowledge_chunks WHERE id IN (${chunkPlaceholders})`,
    ...chunkIds
  )
  const matched = new Map(rows.map((row) => [row.chunkId, row.matched]))
  return chunks
    .map((chunk) => {
      const score = Math.min(1, (matched.get(chunk.id) ?? 0) / Math.max(1, tokens.length))
      return {
        ...chunkToSource(chunk),
        score,
        retrievalMode: 'hybrid' as const,
        retrievalStage: 'colbert-lite',
        sourceReason: 'colbert-token-maxsim',
      }
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit)
}

async function resolveOnnxProvider(embeddingMode: 'provider' | 'local' | 'hybrid' | undefined, settings: Pick<SearchHybridOptions, 'localEmbeddingModelId' | 'localEmbeddingModelSource'>) {
  if (embeddingMode === 'provider') return null
  const provider = await createOnnxEmbeddingProvider(settings)
  if (!provider) return null
  return await provider.available() ? provider : null
}

function activeLocalModelId(settings: Pick<SearchHybridOptions, 'localEmbeddingModelId'>): string {
  return settings.localEmbeddingModelId ?? 'auto-local-onnx'
}

async function touchKnowledgeHits(sources: RetrievalSource[]): Promise<void> {
  const ids = sources.map((source) => source.chunkId).filter((id): id is string => !!id)
  if (!ids.length) return
  const db = await getDb()
  await Promise.all(ids.map((id) => db.runAsync('UPDATE knowledge_chunks SET lastHitAt = ? WHERE id = ?', Date.now(), id)))
}

function createLocalEmbedding(text: string): number[] {
  const vector = Array.from({ length: VECTOR_DIMENSION }, () => 0)
  const tokens = tokenize(text)
  for (const token of tokens) {
    const index = Math.abs(hashString(token)) % VECTOR_DIMENSION
    const weight = token.length > 1 ? 1 : 0.62
    vector[index] += weight
  }
  return normalizeVector(vector)
}

function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const words = lower.match(/[a-z0-9_]+(?:[-'][a-z0-9_]+)?/g) ?? []
  const cjk = lower.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) ?? []
  const cjkBigrams = cjk.slice(0, -1).map((char, index) => `${char}${cjk[index + 1]}`)
  return [...words, ...cjk, ...cjkBigrams].filter(Boolean)
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (!magnitude) return vector
  return vector.map((value) => Number((value / magnitude).toFixed(6)))
}

function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length)
  let sum = 0
  for (let index = 0; index < length; index += 1) {
    sum += a[index] * b[index]
  }
  return Math.max(0, Math.min(1, sum))
}

function normalizeFtsScore(score: number): number {
  return 1 / (1 + Math.abs(score))
}

function parseEmbedding(raw?: string): number[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.every((value) => typeof value === 'number') ? parsed : null
  } catch {
    return null
  }
}

function parseJsonArray(raw?: string | unknown): string[] | undefined {
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === 'string')
  if (typeof raw !== 'string' || !raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : undefined
  } catch {
    return undefined
  }
}

function parseJsonObject<T>(raw?: string | unknown): T | undefined {
  if (!raw || typeof raw !== 'string') return undefined
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as T : undefined
  } catch {
    return undefined
  }
}

function mergeSourceReason(left?: string, right?: string): string | undefined {
  const reasons = [left, right].filter((item): item is string => !!item)
  return reasons.length ? Array.from(new Set(reasons)).join('+') : undefined
}

function tokenOverlapScore(query: string, text: string): number {
  const queryTokens = new Set(tokenize(query))
  const textTokens = new Set(tokenize(text))
  if (!queryTokens.size || !textTokens.size) return 0
  let overlap = 0
  for (const token of queryTokens) {
    if (textTokens.has(token)) overlap += 1
  }
  return overlap / Math.max(1, queryTokens.size)
}

function extractIndexEntities(content: string): string[] {
  const entities = new Set<string>()
  for (const match of content.match(/\b[A-Z][A-Za-z0-9_-]{2,}\b/g) ?? []) entities.add(match)
  for (const match of content.match(/[\u3400-\u9fff]{2,12}/g) ?? []) {
    if (!/^(这个|那个|我们|你们|他们|以及|或者|但是|因为|所以|然后|如果)$/.test(match)) entities.add(match)
  }
  return Array.from(entities).slice(0, 24)
}

function buildIndexRelations(entities: string[] | undefined): string[] {
  const result: string[] = []
  const source = entities ?? []
  for (let index = 0; index < Math.min(source.length - 1, 12); index += 1) {
    result.push(`${source[index]}->${source[index + 1]}`)
  }
  return result
}

function parseRelation(relation: string): { source: string; target: string; relation: string } | null {
  const arrow = relation.match(/^(.+?)->(.+?)(?::(.+))?$/)
  if (arrow) {
    return { source: arrow[1].trim(), target: arrow[2].trim(), relation: (arrow[3] ?? 'related').trim() || 'related' }
  }
  const parts = relation.split(/[|,，]/).map((part) => part.trim()).filter(Boolean)
  if (parts.length >= 2) return { source: parts[0], target: parts[1], relation: parts[2] ?? 'related' }
  return null
}

function normalizeGraphEntity(entity: string): string {
  return entity.replace(/\s+/g, ' ').trim().slice(0, 96)
}

function inferEntityType(entity: string): string {
  if (/^https?:\/\//i.test(entity)) return 'url'
  if (/^[A-Z][A-Za-z0-9_-]+$/.test(entity)) return 'term'
  if (/[\u3400-\u9fff]/.test(entity)) return 'concept'
  return 'entity'
}

function summarizeRaptorGroup(chunks: KnowledgeChunk[]): string {
  const heading = chunks[0]?.headingPath?.filter(Boolean).join(' / ') || chunks[0]?.title || 'Knowledge'
  const body = chunks
    .map((chunk) => summarizeText(chunk.content, 220))
    .filter(Boolean)
    .join('\n')
  return summarizeText(`${heading}\n${body}`, 1200)
}

function summarizeText(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, maxChars).trim()}...`
}

async function readRagCache(key: string): Promise<RetrievalSource[] | null> {
  const db = await getDb()
  const row = await db.getFirstAsync<{ resultJson: string; expiresAt: number }>('SELECT resultJson, expiresAt FROM rag_query_cache WHERE key = ?', key)
  if (!row || row.expiresAt < Date.now()) return null
  try {
    const parsed = JSON.parse(row.resultJson)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function writeRagCache(key: string, query: string, results: RetrievalSource[]): Promise<void> {
  const db = await getDb()
  const now = Date.now()
  await db.runAsync(
    'INSERT OR REPLACE INTO rag_query_cache (key, query, resultJson, expiresAt, createdAt) VALUES (?, ?, ?, ?, ?)',
    key,
    query,
    JSON.stringify(results),
    now + RAG_CACHE_TTL_MS,
    now
  )
}

function buildFtsQuery(query: string): string {
  const words = tokenizeFtsQuery(query).slice(0, 16)
  if (!words.length) return ''
  return words.map((word) => `"${word}"`).join(' OR ')
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

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash | 0
}
