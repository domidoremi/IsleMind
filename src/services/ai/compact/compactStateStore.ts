import * as SQLite from 'expo-sqlite'
import { shouldUseSqliteWebFallback, sqliteWebFallbackDb } from '@/services/sqliteFallback'

const DB_NAME = 'islemind-context.db'

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null

export interface CompactStateRecord {
  id: string
  conversationId: string
  providerId: string
  model: string
  responseId?: string
  sessionId?: string
  compactItemJson: string
  sourceMessageStartIndex: number
  sourceMessageEndIndex: number
  inputTokens?: number
  outputTokens?: number
  estimatedSavedTokens?: number
  status: 'active' | 'invalidated' | 'failed'
  failureCode?: string
  createdAt: number
  updatedAt: number
  expiresAt?: number
}

async function getDb() {
  if (shouldUseSqliteWebFallback) return sqliteWebFallbackDb as unknown as SQLite.SQLiteDatabase
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS compact_states (
          id TEXT PRIMARY KEY NOT NULL,
          conversationId TEXT NOT NULL,
          providerId TEXT NOT NULL,
          model TEXT NOT NULL,
          responseId TEXT,
          sessionId TEXT,
          compactItemJson TEXT NOT NULL,
          sourceMessageStartIndex INTEGER NOT NULL,
          sourceMessageEndIndex INTEGER NOT NULL,
          inputTokens INTEGER,
          outputTokens INTEGER,
          estimatedSavedTokens INTEGER,
          status TEXT NOT NULL,
          failureCode TEXT,
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL,
          expiresAt INTEGER
        );
      `)
      return db
    })
  }
  return dbPromise
}

export async function saveCompactState(record: CompactStateRecord): Promise<void> {
  const db = await getDb()
  await db.runAsync(
    `INSERT OR REPLACE INTO compact_states (
      id, conversationId, providerId, model, responseId, sessionId, compactItemJson,
      sourceMessageStartIndex, sourceMessageEndIndex, inputTokens, outputTokens,
      estimatedSavedTokens, status, failureCode, createdAt, updatedAt, expiresAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    record.id,
    record.conversationId,
    record.providerId,
    record.model,
    record.responseId ?? null,
    record.sessionId ?? null,
    record.compactItemJson,
    record.sourceMessageStartIndex,
    record.sourceMessageEndIndex,
    record.inputTokens ?? null,
    record.outputTokens ?? null,
    record.estimatedSavedTokens ?? null,
    record.status,
    record.failureCode ?? null,
    record.createdAt,
    record.updatedAt,
    record.expiresAt ?? null
  )
}

export async function listActiveCompactStates(conversationId: string, providerId: string, model: string): Promise<CompactStateRecord[]> {
  const db = await getDb()
  const now = Date.now()
  return db.getAllAsync<CompactStateRecord>(
    `SELECT * FROM compact_states
     WHERE conversationId = ? AND providerId = ? AND model = ? AND status = 'active' AND (expiresAt IS NULL OR expiresAt > ?)
     ORDER BY updatedAt DESC`,
    conversationId,
    providerId,
    model,
    now
  )
}

export async function invalidateCompactStates(conversationId: string, reason = 'invalidated'): Promise<void> {
  const db = await getDb()
  await db.runAsync(
    `UPDATE compact_states SET status = 'invalidated', failureCode = ?, updatedAt = ? WHERE conversationId = ? AND status = 'active'`,
    reason,
    Date.now(),
    conversationId
  )
}

export async function invalidateCompactStatesByProvider(providerId: string, reason = 'provider_changed'): Promise<void> {
  const db = await getDb()
  await db.runAsync(
    `UPDATE compact_states SET status = 'invalidated', failureCode = ?, updatedAt = ? WHERE providerId = ? AND status = 'active'`,
    reason,
    Date.now(),
    providerId
  )
}

export async function invalidateAllCompactStates(reason = 'all_invalidated'): Promise<void> {
  const db = await getDb()
  await db.runAsync(
    `UPDATE compact_states SET status = 'invalidated', failureCode = ?, updatedAt = ? WHERE status = 'active'`,
    reason,
    Date.now()
  )
}

export async function clearAllCompactStates(): Promise<void> {
  const db = await getDb()
  await db.runAsync('DELETE FROM compact_states')
}
