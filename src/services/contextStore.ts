import * as SQLite from 'expo-sqlite'
import type { KnowledgeChunk, KnowledgeDocument, MemoryItem, MemorySourceKind, MemoryStatus, RetrievalSource } from '@/types'
import { localDataStore } from '@/services/localDataStore'
import type { UpsertChunkOptions } from '@/services/localDataStore'
import { rerankRetrievalSources, splitTextIntoSentenceChunks } from '@/services/rag'
import { st } from '@/i18n/service'

const DB_NAME = 'islemind-context.db'

interface AddMemoryOptions {
  sourceKind?: MemorySourceKind
  sourceDetail?: string
  confidence?: number
}

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
    }).catch((error) => {
      dbPromise = null
      throw error
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
  await addColumnIfMissing(db, 'memories', 'sourceKind', 'TEXT')
  await addColumnIfMissing(db, 'memories', 'sourceDetail', 'TEXT')
  await addColumnIfMissing(db, 'memories', 'confidence', 'REAL')
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

export async function addMemory(content: string, conversationId?: string, status: MemoryStatus = 'pending', options: AddMemoryOptions = {}): Promise<MemoryItem | null> {
  const text = normalizeText(content)
  if (!text) return null
  const db = await getDb()
  const now = Date.now()
  const sourceKind = options.sourceKind ?? (conversationId ? 'deterministic' : 'manual')
  const memory: MemoryItem = {
    id: generateId(),
    content: text,
    status,
    conversationId,
    sourceKind,
    sourceDetail: normalizeOptionalText(options.sourceDetail),
    confidence: normalizeConfidence(options.confidence ?? defaultMemoryConfidence(sourceKind)),
    createdAt: now,
    updatedAt: now,
  }
  await db.runAsync(
    'INSERT INTO memories (id, content, status, conversationId, sourceKind, sourceDetail, confidence, lastHitAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    memory.id,
    memory.content,
    memory.status,
    memory.conversationId ?? null,
    memory.sourceKind ?? null,
    memory.sourceDetail ?? null,
    memory.confidence ?? null,
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
    `SELECT id, content, status, conversationId, sourceKind, sourceDetail, confidence, lastHitAt, createdAt, updatedAt FROM memories WHERE status IN (${placeholders}) ORDER BY updatedAt DESC`,
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

export async function searchMemories(query: string, limit: number, statuses: MemoryStatus[] = ['active']): Promise<RetrievalSource[]> {
  const db = await getDb()
  const ftsQuery = buildFtsQuery(query)
  if (!ftsQuery || limit <= 0 || !statuses.length) return []
  const placeholders = statuses.map(() => '?').join(',')
  const rows = await db.getAllAsync<MemoryItem & { score: number }>(
    `
      SELECT m.id, m.content, m.status, m.conversationId, m.sourceKind, m.sourceDetail, m.confidence,
        m.lastHitAt, m.createdAt, m.updatedAt, bm25(memory_fts) AS score
      FROM memory_fts
      JOIN memories m ON m.id = memory_fts.id
      WHERE memory_fts MATCH ? AND m.status IN (${placeholders})
      LIMIT ?
    `,
    ftsQuery,
    ...statuses,
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
    sourceReason: formatMemorySourceReason(item),
  }))
}

function rankMemoryRows<T extends MemoryItem & { score: number }>(rows: T[], now: number): T[] {
  return [...rows].sort((a, b) => memoryRankScore(a, now) - memoryRankScore(b, now))
}

function memoryRankScore(memory: MemoryItem & { score: number }, now: number): number {
  const ageDays = Math.max(0, (now - (memory.createdAt || now)) / 86_400_000)
  const recencyBoost = Math.exp(-ageDays / 30)
  const sourceKind = normalizeMemorySourceKind(memory.sourceKind)
  const confidence = normalizeConfidence(memory.confidence ?? defaultMemoryConfidence(sourceKind)) ?? 0.5
  const confidencePenalty = 1 + (1 - confidence) * 0.3
  return (Math.abs(memory.score ?? 0) * confidencePenalty) / Math.max(recencyBoost, 0.05)
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
  const normalizedSourceUri = normalizeKnowledgeSourceLabel(input.sourceUri) ?? normalizeKnowledgeSourceLabel(input.rawPath) ?? normalizeKnowledgeSourceLabel(input.title)
  const document: KnowledgeDocument = {
    id: documentId,
    title: input.title,
    mimeType: input.mimeType,
    size: input.size,
    chunkCount: chunks.length,
    status: 'ready',
    sourceUri: normalizedSourceUri,
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
  const rows = await db.getAllAsync<KnowledgeDocument>(
    'SELECT id, title, mimeType, size, chunkCount, status, error, sourceUri, rawPath, contentHash, createdAt, updatedAt FROM knowledge_documents ORDER BY updatedAt DESC'
  )
  return rows.map(normalizeKnowledgeDocumentRecord)
}

export async function deleteKnowledgeDocument(id: string): Promise<void> {
  const db = await getDb()
  await localDataStore.deleteKnowledgeDocumentIndexes(id)
  await db.runAsync('DELETE FROM document_sources WHERE documentId = ?', id)
  await db.runAsync('DELETE FROM knowledge_documents WHERE id = ?', id)
  await db.runAsync('DELETE FROM knowledge_chunks WHERE documentId = ?', id)
  await db.runAsync('DELETE FROM knowledge_fts WHERE documentId = ?', id)
}

export async function clearKnowledge(): Promise<void> {
  const db = await getDb()
  await localDataStore.clearKnowledgeIndexes()
  await localDataStore.clearDocumentSources()
  await db.runAsync('DELETE FROM knowledge_documents')
  await db.runAsync('DELETE FROM knowledge_chunks')
  await db.runAsync('DELETE FROM knowledge_fts')
}

export async function searchKnowledge(query: string, limit: number): Promise<RetrievalSource[]> {
  const db = await getDb()
  const ftsQuery = buildFtsQuery(query)
  if (!ftsQuery || limit <= 0) return []
  const rows = await db.getAllAsync<(KnowledgeChunk & { score: number }) & Pick<KnowledgeDocument, 'sourceUri' | 'rawPath'>>(
    `
      SELECT c.id, c.documentId, c.title, c.content, c.ordinal, c.chunkIndex, c.sentenceStart, c.sentenceEnd,
        c.embeddingProvider, c.lastHitAt, c.createdAt, d.sourceUri, d.rawPath, bm25(knowledge_fts) AS score
      FROM knowledge_fts
      JOIN knowledge_chunks c ON c.id = knowledge_fts.id
      LEFT JOIN knowledge_documents d ON d.id = c.documentId
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
    sourceUri: normalizeOptionalText(chunk.sourceUri) ?? normalizeOptionalText(chunk.rawPath),
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
    db.getAllAsync<MemoryItem>('SELECT id, content, status, conversationId, sourceKind, sourceDetail, confidence, lastHitAt, createdAt, updatedAt FROM memories ORDER BY updatedAt DESC'),
    db.getAllAsync<KnowledgeDocument>('SELECT id, title, mimeType, size, chunkCount, status, error, sourceUri, rawPath, contentHash, createdAt, updatedAt FROM knowledge_documents ORDER BY updatedAt DESC'),
    db.getAllAsync<KnowledgeChunk>('SELECT id, documentId, title, content, ordinal, chunkIndex, sentenceStart, sentenceEnd, semanticBoundary, summaryNodeId, parentChunkId, qualityScore, embeddingModelId, embeddingProvider, lastHitAt, createdAt FROM knowledge_chunks ORDER BY createdAt DESC, ordinal ASC'),
  ])
  return { memories, documents: documents.map(normalizeKnowledgeDocumentRecord), chunks }
}

export async function importContextSnapshot(snapshot: Partial<ContextSnapshot>): Promise<void> {
  const db = await getDb()
  const memories = Array.isArray(snapshot.memories) ? snapshot.memories : []
  const documents = Array.isArray(snapshot.documents) ? snapshot.documents : []
  const chunks = Array.isArray(snapshot.chunks) ? snapshot.chunks : []
  await clearMemories()
  await clearKnowledge()
  for (const memory of memories) {
    await upsertImportedMemory(db, memory)
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

export async function importMemoriesForReview(memories: MemoryItem[]): Promise<void> {
  if (!memories.length) return
  const db = await getDb()
  for (const memory of memories) {
    await upsertImportedMemory(db, memory)
  }
}

async function upsertImportedMemory(db: SQLite.SQLiteDatabase, memory: Partial<MemoryItem>): Promise<void> {
  if (!memory.id || !memory.content) return
  const now = Date.now()
  const content = normalizeText(memory.content)
  if (!content) return
  const sourceKind = memory.sourceKind === undefined || memory.sourceKind === null
    ? 'imported'
    : normalizeMemorySourceKind(memory.sourceKind)
  const imported: MemoryItem = {
    id: memory.id,
    content,
    status: normalizeMemoryStatus(memory.status),
    conversationId: memory.conversationId,
    sourceKind,
    sourceDetail: normalizeOptionalText(memory.sourceDetail),
    confidence: normalizeConfidence(memory.confidence ?? defaultMemoryConfidence(sourceKind)),
    lastHitAt: memory.lastHitAt,
    createdAt: memory.createdAt ?? now,
    updatedAt: memory.updatedAt ?? now,
  }
  const existing = await findImportedMemoryDuplicate(db, imported)
  const next = existing ? mergeImportedMemory(existing, imported, now) : imported
  await db.runAsync(
    'INSERT OR REPLACE INTO memories (id, content, status, conversationId, sourceKind, sourceDetail, confidence, lastHitAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    next.id,
    next.content,
    next.status,
    next.conversationId ?? null,
    next.sourceKind ?? null,
    next.sourceDetail ?? null,
    next.confidence ?? null,
    next.lastHitAt ?? null,
    next.createdAt,
    next.updatedAt
  )
  await db.runAsync('DELETE FROM memory_fts WHERE id = ?', next.id)
  await db.runAsync('INSERT INTO memory_fts (id, content) VALUES (?, ?)', next.id, next.content)
}

async function findImportedMemoryDuplicate(db: SQLite.SQLiteDatabase, memory: MemoryItem): Promise<MemoryItem | null> {
  const rows = await db.getAllAsync<MemoryItem>(
    'SELECT id, content, status, conversationId, sourceKind, sourceDetail, confidence, lastHitAt, createdAt, updatedAt FROM memories'
  )
  const byId = rows.find((row) => row.id === memory.id)
  if (byId) return byId
  return rows
    .filter((row) => row.content === memory.content)
    .sort(compareMemoryMergePriority)[0] ?? null
}

function compareMemoryMergePriority(left: MemoryItem, right: MemoryItem): number {
  return memoryStatusMergeRank(left.status) - memoryStatusMergeRank(right.status) ||
    memorySourceKindSortRank(normalizeMemorySourceKind(left.sourceKind)) - memorySourceKindSortRank(normalizeMemorySourceKind(right.sourceKind)) ||
    (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
}

function mergeImportedMemory(existing: MemoryItem, incoming: MemoryItem, now: number): MemoryItem {
  const existingKind = normalizeMemorySourceKind(existing.sourceKind)
  const incomingKind = normalizeMemorySourceKind(incoming.sourceKind)
  const sourceKind = strongerMemorySourceKind(existingKind, incomingKind)
  const existingConfidence = normalizeConfidence(existing.confidence ?? defaultMemoryConfidence(existingKind)) ?? 0
  const incomingConfidence = normalizeConfidence(incoming.confidence ?? defaultMemoryConfidence(incomingKind)) ?? 0
  return {
    id: existing.id,
    content: existing.content,
    status: mergeMemoryStatus(existing.status, incoming.status),
    conversationId: existing.conversationId ?? incoming.conversationId,
    sourceKind,
    sourceDetail: mergeMemorySourceDetails(existing.sourceDetail, incoming.sourceDetail),
    confidence: normalizeConfidence(Math.max(existingConfidence, incomingConfidence)),
    lastHitAt: maxOptionalTimestamp(existing.lastHitAt, incoming.lastHitAt),
    createdAt: Math.min(existing.createdAt ?? incoming.createdAt ?? now, incoming.createdAt ?? existing.createdAt ?? now),
    updatedAt: Math.max(existing.updatedAt ?? 0, incoming.updatedAt ?? 0, now),
  }
}

function mergeMemoryStatus(left: MemoryStatus, right: MemoryStatus): MemoryStatus {
  const statuses = new Set([normalizeMemoryStatus(left), normalizeMemoryStatus(right)])
  if (statuses.has('active')) return 'active'
  if (statuses.has('pending')) return 'pending'
  return 'disabled'
}

function memoryStatusMergeRank(status: MemoryStatus): number {
  switch (normalizeMemoryStatus(status)) {
    case 'active':
      return 0
    case 'pending':
      return 1
    case 'disabled':
    default:
      return 2
  }
}

function strongerMemorySourceKind(left: MemorySourceKind, right: MemorySourceKind): MemorySourceKind {
  return memorySourceKindRank(left) >= memorySourceKindRank(right) ? left : right
}

function memorySourceKindSortRank(sourceKind: MemorySourceKind): number {
  return 5 - memorySourceKindRank(sourceKind)
}

function memorySourceKindRank(sourceKind: MemorySourceKind): number {
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
    const detail = normalizeOptionalText(value)
    if (detail && !parts.includes(detail)) parts.push(detail)
  }
  return parts.length ? parts.join('; ') : undefined
}

function maxOptionalTimestamp(...values: Array<number | undefined>): number | undefined {
  const timestamps = values.filter((value): value is number => typeof value === 'number')
  return timestamps.length ? Math.max(...timestamps) : undefined
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

function normalizeOptionalText(value: string | undefined): string | undefined {
  const text = value?.replace(/\s+/g, ' ').trim()
  return text || undefined
}

function normalizeKnowledgeDocumentRecord(document: KnowledgeDocument): KnowledgeDocument {
  return {
    ...document,
    error: normalizeOptionalText(document.error),
    sourceUri: normalizeOptionalText(document.sourceUri),
    rawPath: normalizeOptionalText(document.rawPath),
    contentHash: normalizeOptionalText(document.contentHash),
  }
}

function normalizeKnowledgeSourceLabel(value: string | undefined): string | undefined {
  const text = normalizeOptionalText(value)
  if (!text) return undefined
  if (/^https?:\/\//i.test(text)) return text
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    return readKnowledgeSourceBasename(text) ?? text
  }
  return text
}

function readKnowledgeSourceBasename(value: string): string | undefined {
  try {
    const parsed = new URL(value)
    const normalizedPath = decodeURIComponent(parsed.pathname.replace(/\/+$/, ''))
    const segments = normalizedPath.split('/').filter(Boolean)
    return segments.at(-1) ?? parsed.hostname ?? undefined
  } catch {
    return undefined
  }
}

function normalizeMemorySourceKind(value: unknown): MemorySourceKind {
  if (value === 'manual' || value === 'deterministic' || value === 'model' || value === 'imported' || value === 'legacy') return value
  return 'legacy'
}

function normalizeMemoryStatus(value: unknown): MemoryStatus {
  if (value === 'pending' || value === 'active' || value === 'disabled') return value
  return 'pending'
}

function normalizeConfidence(value: number | null | undefined): number | undefined {
  if (value === null || value === undefined || Number.isNaN(value)) return undefined
  return Number(Math.max(0, Math.min(1, value)).toFixed(2))
}

function defaultMemoryConfidence(sourceKind: MemorySourceKind): number {
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

function formatMemorySourceReason(memory: MemoryItem): string {
  const sourceKind = normalizeMemorySourceKind(memory.sourceKind)
  const parts = [`source=${sourceKind}`]
  const confidence = normalizeConfidence(memory.confidence)
  if (confidence !== undefined) parts.push(`confidence=${confidence}`)
  if (memory.sourceDetail) parts.push(memory.sourceDetail)
  return parts.join(' · ')
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
