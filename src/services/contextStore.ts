import * as SQLite from 'expo-sqlite'
import type { KnowledgeChunk, KnowledgeDocument, MemoryItem, MemoryStatus, RetrievalSource } from '@/types'
import { localDataStore } from '@/services/localDataStore'
import type { UpsertChunkOptions } from '@/services/localDataStore'

const DB_NAME = 'islemind-context.db'
const CHUNK_SIZE = 1200
const CHUNK_OVERLAP = 160

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
          createdAt INTEGER NOT NULL
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(id UNINDEXED, content);
        CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(id UNINDEXED, documentId UNINDEXED, title UNINDEXED, content);
      `)
      await migrateKnowledgeDocumentColumns(db)
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
    'INSERT INTO memories (id, content, status, conversationId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
    memory.id,
    memory.content,
    memory.status,
    memory.conversationId ?? null,
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
    `SELECT id, content, status, conversationId, createdAt, updatedAt FROM memories WHERE status IN (${placeholders}) ORDER BY updatedAt DESC`,
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
      SELECT m.id, m.content, m.status, m.conversationId, m.createdAt, m.updatedAt, bm25(memory_fts) AS score
      FROM memory_fts
      JOIN memories m ON m.id = memory_fts.id
      WHERE memory_fts MATCH ? AND m.status IN ('pending', 'active')
      ORDER BY score
      LIMIT ?
    `,
    ftsQuery,
    limit
  )
  return rows.map((item) => ({
    id: item.id,
    type: 'memory',
    title: item.status === 'pending' ? '待确认记忆' : '长期记忆',
    content: item.content,
    excerpt: item.content,
    score: item.score,
  }))
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
  for (const [index, content] of chunks.entries()) {
    const chunkId = generateId()
    const chunk: KnowledgeChunk = {
      id: chunkId,
      documentId: document.id,
      title: document.title,
      content,
      ordinal: index,
      createdAt: now,
    }
    await db.runAsync(
      'INSERT INTO knowledge_chunks (id, documentId, title, content, ordinal, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
      chunkId,
      document.id,
      document.title,
      content,
      index,
      now
    )
    await db.runAsync('INSERT INTO knowledge_fts (id, documentId, title, content) VALUES (?, ?, ?, ?)', chunkId, document.id, document.title, content)
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
  await db.runAsync('DELETE FROM knowledge_documents WHERE id = ?', id)
  await db.runAsync('DELETE FROM knowledge_chunks WHERE documentId = ?', id)
  await db.runAsync('DELETE FROM knowledge_fts WHERE documentId = ?', id)
}

export async function clearKnowledge(): Promise<void> {
  const db = await getDb()
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
  return rows.map((chunk) => ({
    id: chunk.id,
    type: 'knowledge',
    title: chunk.title,
    content: chunk.content,
    excerpt: chunk.content.slice(0, 180),
    documentId: chunk.documentId,
    chunkId: chunk.id,
    score: chunk.score,
  }))
}

export interface ContextSnapshot {
  memories: MemoryItem[]
  documents: KnowledgeDocument[]
  chunks: KnowledgeChunk[]
}

export async function exportContextSnapshot(): Promise<ContextSnapshot> {
  const db = await getDb()
  const [memories, documents, chunks] = await Promise.all([
    db.getAllAsync<MemoryItem>('SELECT id, content, status, conversationId, createdAt, updatedAt FROM memories ORDER BY updatedAt DESC'),
    db.getAllAsync<KnowledgeDocument>('SELECT id, title, mimeType, size, chunkCount, status, error, sourceUri, rawPath, contentHash, createdAt, updatedAt FROM knowledge_documents ORDER BY updatedAt DESC'),
    db.getAllAsync<KnowledgeChunk>('SELECT id, documentId, title, content, ordinal, createdAt FROM knowledge_chunks ORDER BY createdAt DESC, ordinal ASC'),
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
      'INSERT OR REPLACE INTO memories (id, content, status, conversationId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
      memory.id,
      memory.content,
      memory.status ?? 'pending',
      memory.conversationId ?? null,
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
    await db.runAsync(
      'INSERT OR REPLACE INTO knowledge_chunks (id, documentId, title, content, ordinal, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
      chunk.id,
      chunk.documentId,
      chunk.title ?? '知识片段',
      chunk.content,
      chunk.ordinal ?? 0,
      chunk.createdAt ?? Date.now()
    )
    await db.runAsync('INSERT INTO knowledge_fts (id, documentId, title, content) VALUES (?, ?, ?, ?)', chunk.id, chunk.documentId, chunk.title ?? '知识片段', chunk.content)
    importedChunks.push(chunk)
  }
  await localDataStore.upsertChunks(importedChunks)
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function splitText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []
  const chunks: string[] = []
  let cursor = 0
  while (cursor < normalized.length) {
    const end = Math.min(normalized.length, cursor + CHUNK_SIZE)
    chunks.push(normalized.slice(cursor, end).trim())
    if (end === normalized.length) break
    cursor = Math.max(0, end - CHUNK_OVERLAP)
  }
  return chunks.filter(Boolean)
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
