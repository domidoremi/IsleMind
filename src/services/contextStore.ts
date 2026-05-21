import * as SQLite from 'expo-sqlite'
import type { KnowledgeChunk, KnowledgeDocument, MemoryItem, MemoryStatus, RetrievalSource } from '@/types'
import { localDataStore } from '@/services/localDataStore'
import type { UpsertChunkOptions } from '@/services/localDataStore'
import { rerankRetrievalSources, splitTextIntoSentenceChunks } from '@/services/rag'
import { st } from '@/i18n/service'

const DB_NAME = 'islemind-context.db'

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

async function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY NOT NULL,
          content TEXT NOT NULL,
          status TEXT NOT NULL,
          conversationId TEXT,
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
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(id UNINDEXED, content);
        CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(id UNINDEXED, documentId UNINDEXED, title UNINDEXED, content);
      `)
      await migrateKnowledgeDocumentColumns(db)
      await migrateContextColumns(db)
      return db
    })
  }
  return dbPromise
}

export async function initializeContextStore(): Promise<void> {
  await getDb()
}

async function migrateKnowledgeDocumentColumns(db: SQLite.SQLiteDatabase): Promise<void> {
  await addColumnIfMissing(db, 'knowledge_documents', 'sourceUri', 'TEXT')
  await addColumnIfMissing(db, 'knowledge_documents', 'rawPath', 'TEXT')
  await addColumnIfMissing(db, 'knowledge_documents', 'contentHash', 'TEXT')
}

async function migrateContextColumns(db: SQLite.SQLiteDatabase): Promise<void> {
  await addColumnIfMissing(db, 'memories', 'lastHitAt', 'INTEGER')
  await addColumnIfMissing(db, 'knowledge_chunks', 'chunkIndex', 'INTEGER')
  await addColumnIfMissing(db, 'knowledge_chunks', 'sentenceStart', 'INTEGER')
  await addColumnIfMissing(db, 'knowledge_chunks', 'sentenceEnd', 'INTEGER')
  await addColumnIfMissing(db, 'knowledge_chunks', 'semanticBoundary', 'TEXT')
  await addColumnIfMissing(db, 'knowledge_chunks', 'headingPathJson', 'TEXT')
  await addColumnIfMissing(db, 'knowledge_chunks', 'entitiesJson', 'TEXT')
  await addColumnIfMissing(db, 'knowledge_chunks', 'relationsJson', 'TEXT')
  await addColumnIfMissing(db, 'knowledge_chunks', 'summaryNodeId', 'TEXT')
  await addColumnIfMissing(db, 'knowledge_chunks', 'parentChunkId', 'TEXT')
  await addColumnIfMissing(db, 'knowledge_chunks', 'qualityScore', 'REAL')
  await addColumnIfMissing(db, 'knowledge_chunks', 'embeddingModelId', 'TEXT')
  await addColumnIfMissing(db, 'knowledge_chunks', 'rerankSignalsJson', 'TEXT')
  await addColumnIfMissing(db, 'knowledge_chunks', 'embeddingProvider', 'TEXT')
  await addColumnIfMissing(db, 'knowledge_chunks', 'lastHitAt', 'INTEGER')
}

async function addColumnIfMissing(db: SQLite.SQLiteDatabase, table: string, column: string, definition: string): Promise<void> {
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`)
  if (rows.some((row) => row.name === column)) return
  await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

export async function addMemory(content: string, conversationId?: string, status: MemoryStatus = 'pending'): Promise<MemoryItem | null> {
  const text = normalizeText(content)
  if (!text) return null
  const db = await getDb()
  const now = Date.now()
  const memory: MemoryItem = {
    id: generateId(),
    content: text,
    status,
    conversationId,
    createdAt: now,
    updatedAt: now,
  }
  await db.runAsync(
    'INSERT INTO memories (id, content, status, conversationId, lastHitAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    memory.id,
    memory.content,
    memory.status,
    memory.conversationId ?? null,
    null,
    memory.createdAt,
    memory.updatedAt
  )
  await db.runAsync('INSERT INTO memory_fts (id, content) VALUES (?, ?)', memory.id, memory.content)
  return memory
}

export async function listMemories(statuses: MemoryStatus[] = ['pending', 'active']): Promise<MemoryItem[]> {
  const db = await getDb()
  const placeholders = statuses.map(() => '?').join(',')
  return db.getAllAsync<MemoryItem>(
    `SELECT id, content, status, conversationId, lastHitAt, createdAt, updatedAt FROM memories WHERE status IN (${placeholders}) ORDER BY updatedAt DESC`,
    statuses
  )
}

export async function updateMemoryStatus(id: string, status: MemoryStatus): Promise<void> {
  const db = await getDb()
  await db.runAsync('UPDATE memories SET status = ?, updatedAt = ? WHERE id = ?', status, Date.now(), id)
}

export async function deleteMemory(id: string): Promise<void> {
  const db = await getDb()
  await db.runAsync('DELETE FROM memories WHERE id = ?', id)
  await db.runAsync('DELETE FROM memory_fts WHERE id = ?', id)
}

export async function clearMemories(): Promise<void> {
  const db = await getDb()
  await db.runAsync('DELETE FROM memories')
  await db.runAsync('DELETE FROM memory_fts')
}

export async function searchMemories(query: string, limit: number): Promise<RetrievalSource[]> {
  const db = await getDb()
  const ftsQuery = buildFtsQuery(query)
  if (!ftsQuery || limit <= 0) return []
  const rows = await db.getAllAsync<MemoryItem & { score: number }>(
    `
      SELECT m.id, m.content, m.status, m.conversationId, m.lastHitAt, m.createdAt, m.updatedAt, bm25(memory_fts) AS score
      FROM memory_fts
      JOIN memories m ON m.id = memory_fts.id
      WHERE memory_fts MATCH ? AND m.status IN ('pending', 'active')
      LIMIT ?
    `,
    ftsQuery,
    Math.max(limit * 4, limit)
  )
  const now = Date.now()
  const ranked = rankMemoryRows(rows, now).slice(0, limit)
  await Promise.all(ranked.map((item) => db.runAsync('UPDATE memories SET lastHitAt = ? WHERE id = ?', now, item.id)))
  await disableStaleMemories(db)
  return ranked.map((item) => ({
    id: item.id,
    type: 'memory',
    title: item.status === 'pending' ? st('contextStore.pendingMemory') : st('contextStore.longTermMemory'),
    content: item.content,
    excerpt: item.content,
    score: item.score,
  }))
}

function rankMemoryRows<T extends MemoryItem & { score: number }>(rows: T[], now: number): T[] {
  return [...rows].sort((a, b) => memoryRankScore(a, now) - memoryRankScore(b, now))
}

function memoryRankScore(memory: MemoryItem & { score: number }, now: number): number {
  const ageDays = Math.max(0, (now - (memory.createdAt || now)) / 86_400_000)
  const recencyBoost = Math.exp(-ageDays / 30)
  return Math.abs(memory.score ?? 0) / Math.max(recencyBoost, 0.05)
}

export async function importKnowledgeText(input: {
  title: string
  mimeType: string
  size: number
  text: string
  sourceUri?: string
  rawPath?: string
}, options: UpsertChunkOptions = {}): Promise<KnowledgeDocument> {
  const db = await getDb()
  const now = Date.now()
  const documentId = generateId()
  const chunks = splitText(input.text)
  const document: KnowledgeDocument = {
    id: documentId,
    title: input.title,
    mimeType: input.mimeType,
    size: input.size,
    chunkCount: chunks.length,
    status: 'ready',
    sourceUri: input.sourceUri,
    rawPath: input.rawPath,
    contentHash: hashText(input.text),
    createdAt: now,
    updatedAt: now,
  }

  await db.runAsync(
    'INSERT INTO knowledge_documents (id, title, mimeType, size, chunkCount, status, error, sourceUri, rawPath, contentHash, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    document.id,
    document.title,
    document.mimeType,
    document.size,
    document.chunkCount,
    document.status,
    null,
    document.sourceUri ?? null,
    document.rawPath ?? null,
    document.contentHash ?? null,
    document.createdAt,
    document.updatedAt
  )

  const importedChunks: KnowledgeChunk[] = []
  for (const [index, chunkDraft] of chunks.entries()) {
    const chunkId = generateId()
    const metadata = buildChunkMetadata(chunkDraft.content, input.title)
    const chunk: KnowledgeChunk = {
      id: chunkId,
      documentId: document.id,
      title: document.title,
      content: chunkDraft.content,
      ordinal: index,
      chunkIndex: index,
      sentenceStart: chunkDraft.sentenceStart,
      sentenceEnd: chunkDraft.sentenceEnd,
      semanticBoundary: metadata.semanticBoundary,
      headingPath: metadata.headingPath,
      entities: metadata.entities,
      relations: metadata.relations,
      qualityScore: metadata.qualityScore,
      rerankSignals: metadata.rerankSignals,
      embeddingProvider: 'hash',
      createdAt: now,
    }
    await db.runAsync(
      'INSERT INTO knowledge_chunks (id, documentId, title, content, ordinal, chunkIndex, sentenceStart, sentenceEnd, semanticBoundary, headingPathJson, entitiesJson, relationsJson, summaryNodeId, parentChunkId, qualityScore, embeddingModelId, rerankSignalsJson, embeddingProvider, lastHitAt, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      chunkId,
      document.id,
      document.title,
      chunkDraft.content,
      index,
      index,
      chunkDraft.sentenceStart ?? null,
      chunkDraft.sentenceEnd ?? null,
      metadata.semanticBoundary ?? 'sentence',
      JSON.stringify(metadata.headingPath),
      JSON.stringify(metadata.entities),
      JSON.stringify(metadata.relations),
      null,
      null,
      metadata.qualityScore ?? 0,
      null,
      JSON.stringify(metadata.rerankSignals),
      'hash',
      null,
      now
    )
    await db.runAsync('INSERT INTO knowledge_fts (id, documentId, title, content) VALUES (?, ?, ?, ?)', chunkId, document.id, document.title, chunkDraft.content)
    importedChunks.push(chunk)
  }
  await localDataStore.upsertDocument(document)
  await localDataStore.upsertChunks(importedChunks, options)

  return document
}

export async function listKnowledgeDocuments(): Promise<KnowledgeDocument[]> {
  const db = await getDb()
  return db.getAllAsync<KnowledgeDocument>(
    'SELECT id, title, mimeType, size, chunkCount, status, error, sourceUri, rawPath, contentHash, createdAt, updatedAt FROM knowledge_documents ORDER BY updatedAt DESC'
  )
}

export async function deleteKnowledgeDocument(id: string): Promise<void> {
  const db = await getDb()
  await localDataStore.deleteKnowledgeDocumentIndexes(id)
  await db.runAsync('DELETE FROM knowledge_documents WHERE id = ?', id)
  await db.runAsync('DELETE FROM knowledge_chunks WHERE documentId = ?', id)
  await db.runAsync('DELETE FROM knowledge_fts WHERE documentId = ?', id)
}

export async function clearKnowledge(): Promise<void> {
  const db = await getDb()
  await localDataStore.clearKnowledgeIndexes()
  await db.runAsync('DELETE FROM knowledge_documents')
  await db.runAsync('DELETE FROM knowledge_chunks')
  await db.runAsync('DELETE FROM knowledge_fts')
}

export async function searchKnowledge(query: string, limit: number): Promise<RetrievalSource[]> {
  const db = await getDb()
  const ftsQuery = buildFtsQuery(query)
  if (!ftsQuery || limit <= 0) return []
  const rows = await db.getAllAsync<KnowledgeChunk & { score: number }>(
    `
      SELECT c.id, c.documentId, c.title, c.content, c.ordinal, c.chunkIndex, c.sentenceStart, c.sentenceEnd, c.embeddingProvider, c.lastHitAt, c.createdAt, bm25(knowledge_fts) AS score
      FROM knowledge_fts
      JOIN knowledge_chunks c ON c.id = knowledge_fts.id
      WHERE knowledge_fts MATCH ?
      ORDER BY score
      LIMIT ?
    `,
    ftsQuery,
    Math.max(limit * 4, 20)
  )
  const reranked = rerankRetrievalSources(query, rows.map((chunk) => ({
    id: chunk.id,
    type: 'knowledge',
    title: chunk.title,
    content: chunk.content,
    excerpt: chunk.content.slice(0, 180),
    documentId: chunk.documentId,
    chunkId: chunk.id,
    chunkIndex: chunk.chunkIndex ?? chunk.ordinal,
    score: chunk.score,
    ftsScore: chunk.score,
  })), limit)
  await Promise.all(reranked.map((source) => source.chunkId ? db.runAsync('UPDATE knowledge_chunks SET lastHitAt = ? WHERE id = ?', Date.now(), source.chunkId) : Promise.resolve()))
  return reranked
}

export interface ContextSnapshot {
  memories: MemoryItem[]
  documents: KnowledgeDocument[]
  chunks: KnowledgeChunk[]
}

export async function exportContextSnapshot(): Promise<ContextSnapshot> {
  const db = await getDb()
  const [memories, documents, chunks] = await Promise.all([
    db.getAllAsync<MemoryItem>('SELECT id, content, status, conversationId, lastHitAt, createdAt, updatedAt FROM memories ORDER BY updatedAt DESC'),
    db.getAllAsync<KnowledgeDocument>('SELECT id, title, mimeType, size, chunkCount, status, error, sourceUri, rawPath, contentHash, createdAt, updatedAt FROM knowledge_documents ORDER BY updatedAt DESC'),
    db.getAllAsync<KnowledgeChunk>('SELECT id, documentId, title, content, ordinal, chunkIndex, sentenceStart, sentenceEnd, semanticBoundary, summaryNodeId, parentChunkId, qualityScore, embeddingModelId, embeddingProvider, lastHitAt, createdAt FROM knowledge_chunks ORDER BY createdAt DESC, ordinal ASC'),
  ])
  return { memories, documents, chunks }
}

export async function importContextSnapshot(snapshot: Partial<ContextSnapshot>): Promise<void> {
  const db = await getDb()
  const memories = Array.isArray(snapshot.memories) ? snapshot.memories : []
  const documents = Array.isArray(snapshot.documents) ? snapshot.documents : []
  const chunks = Array.isArray(snapshot.chunks) ? snapshot.chunks : []
  await clearMemories()
  await clearKnowledge()
  for (const memory of memories) {
    if (!memory.id || !memory.content) continue
    await db.runAsync(
      'INSERT OR REPLACE INTO memories (id, content, status, conversationId, lastHitAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      memory.id,
      memory.content,
      memory.status ?? 'pending',
      memory.conversationId ?? null,
      memory.lastHitAt ?? null,
      memory.createdAt ?? Date.now(),
      memory.updatedAt ?? Date.now()
    )
    await db.runAsync('INSERT INTO memory_fts (id, content) VALUES (?, ?)', memory.id, memory.content)
  }
  for (const document of documents) {
    if (!document.id || !document.title) continue
    await db.runAsync(
      'INSERT OR REPLACE INTO knowledge_documents (id, title, mimeType, size, chunkCount, status, error, sourceUri, rawPath, contentHash, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      document.id,
      document.title,
      document.mimeType ?? 'text/plain',
      document.size ?? 0,
      document.chunkCount ?? 0,
      document.status ?? 'ready',
      document.error ?? null,
      document.sourceUri ?? null,
      document.rawPath ?? null,
      document.contentHash ?? null,
      document.createdAt ?? Date.now(),
      document.updatedAt ?? Date.now()
    )
    await localDataStore.upsertDocument(document)
  }
  const importedChunks: KnowledgeChunk[] = []
  for (const chunk of chunks) {
    if (!chunk.id || !chunk.documentId || !chunk.content) continue
    const metadata = buildChunkMetadata(chunk.content, chunk.title ?? st('contextStore.knowledgeChunk'))
    await db.runAsync(
      'INSERT OR REPLACE INTO knowledge_chunks (id, documentId, title, content, ordinal, chunkIndex, sentenceStart, sentenceEnd, semanticBoundary, headingPathJson, entitiesJson, relationsJson, summaryNodeId, parentChunkId, qualityScore, embeddingModelId, rerankSignalsJson, embeddingProvider, lastHitAt, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      chunk.id,
      chunk.documentId,
      chunk.title ?? st('contextStore.knowledgeChunk'),
      chunk.content,
      chunk.ordinal ?? 0,
      chunk.chunkIndex ?? chunk.ordinal ?? 0,
      chunk.sentenceStart ?? null,
      chunk.sentenceEnd ?? null,
      chunk.semanticBoundary ?? metadata.semanticBoundary ?? 'sentence',
      JSON.stringify(chunk.headingPath ?? metadata.headingPath),
      JSON.stringify(chunk.entities ?? metadata.entities),
      JSON.stringify(chunk.relations ?? metadata.relations),
      chunk.summaryNodeId ?? null,
      chunk.parentChunkId ?? null,
      chunk.qualityScore ?? metadata.qualityScore ?? 0,
      chunk.embeddingModelId ?? null,
      JSON.stringify(chunk.rerankSignals ?? metadata.rerankSignals),
      chunk.embeddingProvider ?? 'hash',
      chunk.lastHitAt ?? null,
      chunk.createdAt ?? Date.now()
    )
    await db.runAsync('INSERT INTO knowledge_fts (id, documentId, title, content) VALUES (?, ?, ?, ?)', chunk.id, chunk.documentId, chunk.title ?? st('contextStore.knowledgeChunk'), chunk.content)
    importedChunks.push(chunk)
  }
  await localDataStore.upsertChunks(importedChunks)
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function splitText(text: string) {
  return splitTextIntoSentenceChunks(text)
}

function buildChunkMetadata(content: string, title: string): Pick<KnowledgeChunk, 'semanticBoundary' | 'headingPath' | 'entities' | 'relations' | 'qualityScore' | 'rerankSignals'> {
  const headingPath = inferHeadingPath(content, title)
  const entities = extractEntities(content)
  const semanticBoundary = inferSemanticBoundary(content)
  const qualityScore = estimateQuality(content)
  return {
    semanticBoundary,
    headingPath,
    entities,
    relations: buildEntityRelations(entities),
    qualityScore,
    rerankSignals: {
      length: Math.min(1, content.length / 1200),
      structure: semanticBoundary === 'heading' || semanticBoundary === 'list' ? 1 : 0,
      entityDensity: Math.min(1, entities.length / 8),
      quality: qualityScore,
    },
  }
}

function inferHeadingPath(content: string, title: string): string[] {
  const headings = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^#{1,6}\s+/.test(line))
    .map((line) => line.replace(/^#{1,6}\s+/, '').trim())
    .slice(0, 4)
  return [title, ...headings].filter(Boolean)
}

function inferSemanticBoundary(content: string): string {
  const firstLine = content.split('\n').map((line) => line.trim()).find(Boolean)
  if (!firstLine) return 'body'
  if (/^#{1,6}\s+/.test(firstLine)) return 'heading'
  if (/^[-*]\s+|\d+[.)]\s+/.test(firstLine)) return 'list'
  return 'sentence'
}

function extractEntities(content: string): string[] {
  const entities = new Set<string>()
  for (const match of content.match(/\b[A-Z][A-Za-z0-9_-]{2,}\b/g) ?? []) entities.add(match)
  for (const match of content.match(/[\u3400-\u9fff]{2,10}/g) ?? []) {
    if (!/^(这个|那个|我们|你们|他们|以及|或者|但是|因为|所以)$/.test(match)) entities.add(match)
  }
  return Array.from(entities).slice(0, 16)
}

function buildEntityRelations(entities: string[]): string[] {
  const relations: string[] = []
  for (let index = 0; index < Math.min(entities.length - 1, 8); index += 1) {
    relations.push(`${entities[index]}->${entities[index + 1]}`)
  }
  return relations
}

function estimateQuality(content: string): number {
  const trimmed = content.trim()
  if (!trimmed) return 0
  const lengthScore = trimmed.length < 120 ? trimmed.length / 120 : trimmed.length <= 1600 ? 1 : Math.max(0.4, 1 - (trimmed.length - 1600) / 3200)
  const structure = /(^|\n)#{1,6}\s|\n[-*]\s|\n\d+[.)]/.test(trimmed) ? 0.1 : 0
  const sentenceCount = (trimmed.match(/[。！？.!?]/g) ?? []).length
  return Number(Math.min(1, 0.78 * lengthScore + structure + Math.min(0.12, sentenceCount / 24)).toFixed(3))
}

async function disableStaleMemories(db: SQLite.SQLiteDatabase): Promise<void> {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  await db.runAsync(
    "UPDATE memories SET status = 'disabled', updatedAt = ? WHERE status = 'active' AND COALESCE(lastHitAt, updatedAt, createdAt) < ?",
    Date.now(),
    cutoff
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

function hashText(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}
