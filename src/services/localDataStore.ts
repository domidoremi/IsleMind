import * as SQLite from 'expo-sqlite'
import type { AIProvider, Conversation, KnowledgeChunk, KnowledgeDocument, MessageUsage, RetrievalSource } from '@/types'
import { embedTextWithProvider } from '@/services/ai/base'

const DB_NAME = 'islemind-context.db'
const VECTOR_DIMENSION = 128
const RAG_CACHE_TTL_MS = 5 * 60 * 1000

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null
let conversationWriteQueue: Promise<void> = Promise.resolve()

export interface ChunkEmbeddingRecord {
  chunkId: string
  embeddingJson: string
  dimension: number
  source: 'provider' | 'local'
  model?: string
  updatedAt: number
  status: 'ready' | 'fallback' | 'error'
  error?: string
}

export interface SearchHybridOptions {
  limit?: number
  mode?: 'fts' | 'hybrid'
  embeddingMode?: 'provider' | 'local' | 'hybrid'
  provider?: AIProvider
}

export interface UpsertChunkOptions {
  provider?: AIProvider
  embeddingMode?: 'provider' | 'local' | 'hybrid'
}

export interface EmbeddingJobStatus {
  id: string
  chunkId: string
  status: string
  source: string
  error?: string
  updatedAt: number
}

export interface ConversationMetrics {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  reasoningTokens: number
  estimated: boolean
  durationMs: number
  messageCount: number
  sourceCount: number
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
  searchHybrid,
  getConversationMetrics,
  clearRagCaches,
  listEmbeddingJobs,
  loadConversations,
  saveConversations,
  clearConversations,
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
  for (const chunk of chunks) {
    const embedding = createLocalEmbedding(chunk.content)
    await db.runAsync(
      'INSERT OR REPLACE INTO chunk_embeddings (chunkId, embeddingJson, dimension, source, model, updatedAt, status, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      chunk.id,
      JSON.stringify(embedding),
      embedding.length,
      'local',
      'local-hash-bow-v1',
      now,
      'fallback',
      null
    )
  }
  if (options.provider?.apiKey && options.embeddingMode !== 'local') {
    void upgradeChunksWithProviderEmbeddings(chunks, options.provider)
  }
}

export async function searchHybrid(query: string, options: SearchHybridOptions = {}): Promise<RetrievalSource[]> {
  await initialize()
  const mode = options.mode ?? 'hybrid'
  const limit = Math.max(1, Math.min(options.limit ?? 4, 12))
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return []

  const cacheKey = `rag:${mode}:${options.embeddingMode ?? 'hybrid'}:${limit}:${hashString(normalizedQuery)}`
  const cached = await readRagCache(cacheKey)
  if (cached) return cached

  const [ftsRows, vectorRows] = await Promise.all([
    searchKnowledgeFts(normalizedQuery, Math.max(limit * 2, 12)),
    mode === 'hybrid' ? searchKnowledgeVector(normalizedQuery, Math.max(limit * 4, 24), options) : Promise.resolve([]),
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

  const results = Array.from(merged.values())
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit)
  await writeRagCache(cacheKey, normalizedQuery, results)
  return results
}

export function getConversationMetrics(conversation: Conversation | null | undefined): ConversationMetrics {
  const messages = conversation?.messages ?? []
  return messages.reduce<ConversationMetrics>(
    (metrics, message) => {
      const usage = message.usage
      metrics.inputTokens += usage?.inputTokens ?? 0
      metrics.outputTokens += usage?.outputTokens ?? 0
      metrics.totalTokens += usage?.totalTokens ?? (usage ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) : 0)
      metrics.reasoningTokens += usage?.reasoningTokens ?? 0
      metrics.estimated = metrics.estimated || usage?.source === 'estimated' || !!message.estimatedTokens
      metrics.durationMs += message.durationMs ?? 0
      metrics.messageCount += 1
      metrics.sourceCount += message.citations?.length ?? 0
      return metrics
    },
    { inputTokens: 0, outputTokens: 0, totalTokens: 0, reasoningTokens: 0, estimated: false, durationMs: 0, messageCount: 0, sourceCount: 0 }
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
        SELECT c.id, c.documentId, c.title, c.content, c.ordinal, c.createdAt, bm25(knowledge_fts) AS score
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
      SELECT c.id, c.documentId, c.title, c.content, c.ordinal, c.createdAt,
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
  return {
    id: chunk.id,
    type: 'knowledge',
    title: chunk.title,
    content: chunk.content,
    excerpt: chunk.content.slice(0, 180),
    documentId: chunk.documentId,
    chunkId: chunk.id,
    score: chunk.score,
  }
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

export function usageFromMetrics(metrics: ConversationMetrics): MessageUsage {
  return {
    inputTokens: metrics.inputTokens,
    outputTokens: metrics.outputTokens,
    reasoningTokens: metrics.reasoningTokens || undefined,
    totalTokens: metrics.totalTokens,
    source: metrics.estimated ? 'estimated' : 'provider',
  }
}
