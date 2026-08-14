import { applySqliteMigrations, type SqliteDatabaseProvider } from '@/platform/storage'
import {
  KNOWLEDGE_RAG_REPLAY_SNAPSHOT_SCHEMA,
  parseKnowledgeRagReplaySnapshot,
  type KnowledgeRagReplaySnapshot,
} from '../application/ragReplaySnapshot'

const MIGRATION_SCOPE = 'knowledge'
const MIGRATION_VERSION = 3

export interface KnowledgeRagReplaySnapshotRepository {
  save(taskId: string, snapshot: KnowledgeRagReplaySnapshot, options?: { signal?: AbortSignal }): Promise<void>
  get(taskId: string, options?: { signal?: AbortSignal }): Promise<KnowledgeRagReplaySnapshot | undefined>
  delete(taskId: string, options?: { signal?: AbortSignal }): Promise<void>
}

interface ReplaySnapshotRow {
  taskId: string
  schema: string
  createdAt: number
  payloadJson: string
}

export class KnowledgeRagReplayRepositoryDataError extends Error {
  constructor(message = 'A persisted knowledge RAG replay snapshot is invalid.') {
    super(message)
    this.name = 'KnowledgeRagReplayRepositoryDataError'
  }
}

export function createSqliteKnowledgeRagReplaySnapshotRepository(
  databaseProvider: SqliteDatabaseProvider,
): KnowledgeRagReplaySnapshotRepository {
  let initialized: Promise<void> | undefined

  async function database(signal?: AbortSignal) {
    throwIfAborted(signal)
    const value = await databaseProvider.get()
    throwIfAborted(signal)
    initialized ??= applySqliteMigrations(value, [{
      scope: MIGRATION_SCOPE,
      version: MIGRATION_VERSION,
      name: 'knowledge-rag-replay-snapshots',
      async up(transaction) {
        await transaction.exec(`
          CREATE TABLE IF NOT EXISTS knowledge_rag_replay_snapshots (
            taskId TEXT PRIMARY KEY NOT NULL,
            schema TEXT NOT NULL,
            createdAt INTEGER NOT NULL,
            payloadJson TEXT NOT NULL
          );
        `)
      },
    }])
    await initialized
    throwIfAborted(signal)
    return value
  }

  return {
    async save(taskId, snapshot, options = {}) {
      const normalizedTaskId = normalizeTaskId(taskId)
      const normalized = parseKnowledgeRagReplaySnapshot(snapshot)
      if (!normalizedTaskId || !normalized) throw new KnowledgeRagReplayRepositoryDataError()
      throwIfAborted(options.signal)
      await (await database(options.signal)).run(
        `INSERT OR REPLACE INTO knowledge_rag_replay_snapshots (taskId, schema, createdAt, payloadJson)
         VALUES (?, ?, ?, ?)`,
        [normalizedTaskId, normalized.schema, normalized.createdAt, JSON.stringify(normalized)],
      )
      throwIfAborted(options.signal)
    },

    async get(taskId, options = {}) {
      const normalizedTaskId = normalizeTaskId(taskId)
      if (!normalizedTaskId) throw new KnowledgeRagReplayRepositoryDataError()
      const row = await (await database(options.signal)).getFirst<ReplaySnapshotRow>(
        `SELECT taskId, schema, createdAt, payloadJson
         FROM knowledge_rag_replay_snapshots WHERE taskId = ?`,
        [normalizedTaskId],
      )
      throwIfAborted(options.signal)
      if (!row) return undefined
      try {
        const snapshot = parseKnowledgeRagReplaySnapshot(JSON.parse(row.payloadJson))
        if (!snapshot || row.taskId !== normalizedTaskId || row.schema !== KNOWLEDGE_RAG_REPLAY_SNAPSHOT_SCHEMA ||
          row.schema !== snapshot.schema || row.createdAt !== snapshot.createdAt) {
          throw new KnowledgeRagReplayRepositoryDataError()
        }
        return snapshot
      } catch (error) {
        if (error instanceof KnowledgeRagReplayRepositoryDataError) throw error
        throw new KnowledgeRagReplayRepositoryDataError()
      }
    },

    async delete(taskId, options = {}) {
      const normalizedTaskId = normalizeTaskId(taskId)
      if (!normalizedTaskId) throw new KnowledgeRagReplayRepositoryDataError()
      await (await database(options.signal)).run(
        'DELETE FROM knowledge_rag_replay_snapshots WHERE taskId = ?',
        [normalizedTaskId],
      )
      throwIfAborted(options.signal)
    },
  }
}

function normalizeTaskId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const taskId = value.trim()
  return taskId && taskId.length <= 256 ? taskId : undefined
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  const error = new Error('Knowledge RAG replay persistence was cancelled.')
  error.name = 'AbortError'
  throw error
}
