import type { SqliteDatabaseProvider, SqliteExecutor } from '@/platform/storage'
import type { Conversation } from '@/types/chatContracts'
import type { ConversationRepository } from '../contracts'
import { parseConversationSnapshot } from '../domain/conversationSnapshot'

interface ConversationRecordRow {
  id?: string
  payloadJson: string
}

const ensureConversationRecords = async (database: Awaited<ReturnType<SqliteDatabaseProvider['get']>>) => {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS conversation_records (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      providerId TEXT NOT NULL,
      model TEXT NOT NULL,
      updatedAt INTEGER NOT NULL,
      payloadJson TEXT NOT NULL
    );
  `)
}

export class ConversationRepositoryDataError extends Error {
  constructor() {
    super('The persisted conversation record is invalid.')
    this.name = 'ConversationRepositoryDataError'
  }
}

export function createSqliteConversationRepository(
  databaseProvider: SqliteDatabaseProvider,
): ConversationRepository {
  let initialization: Promise<void> | undefined

  async function database(): Promise<Awaited<ReturnType<SqliteDatabaseProvider['get']>>> {
    const value = await databaseProvider.get()
    initialization ??= ensureConversationRecords(value).catch((error) => {
      initialization = undefined
      throw error
    })
    await initialization
    return value
  }

  return {
    async get(conversationId) {
      const value = await database()
      const row = await value.getFirst<ConversationRecordRow>(
        'SELECT payloadJson FROM conversation_records WHERE id = ?',
        [conversationId],
      )
      if (!row) return undefined

      let parsedValue: unknown
      try {
        parsedValue = JSON.parse(row.payloadJson)
      } catch {
        throw new ConversationRepositoryDataError()
      }
      const conversation = parseConversationSnapshot(parsedValue)
      if (!conversation || conversation.id !== conversationId) throw new ConversationRepositoryDataError()
      return conversation
    },
    async loadAll() {
      const value = await database()
      const rows = await value.getAll<ConversationRecordRow>(
        'SELECT payloadJson FROM conversation_records ORDER BY updatedAt DESC',
      )
      return rows.flatMap((row) => {
        try {
          return [JSON.parse(row.payloadJson)]
        } catch {
          return []
        }
      })
    },
    async loadReplacementSnapshot() {
      const value = await database()
      const rows = await value.getAll<ConversationRecordRow>(
        'SELECT id, payloadJson FROM conversation_records ORDER BY updatedAt DESC, id ASC',
      )
      return rows.map((row) => {
        let parsedValue: unknown
        try {
          parsedValue = JSON.parse(row.payloadJson)
        } catch {
          throw new ConversationRepositoryDataError()
        }
        const conversation = parseConversationSnapshot(parsedValue)
        if (
          !conversation ||
          !row.id ||
          conversation.id !== row.id ||
          !isFullConversationRecord(parsedValue)
        ) {
          throw new ConversationRepositoryDataError()
        }
        return parsedValue
      })
    },
    async save(conversation) {
      const value = await database()
      await upsertConversation(value, conversation)
    },
    async replaceAll(conversations) {
      const value = await database()
      await value.transaction(async (transaction) => {
        await transaction.run('DELETE FROM conversation_records')
        for (const conversation of conversations) await upsertConversation(transaction, conversation)
      })
    },
    async clear() {
      const value = await database()
      await value.run('DELETE FROM conversation_records')
    },
  }
}

function isFullConversationRecord(value: unknown): value is Conversation {
  if (!value || typeof value !== 'object') return false
  const conversation = value as Partial<Conversation>
  return typeof conversation.title === 'string' &&
    Number.isFinite(conversation.createdAt) &&
    Number.isFinite(conversation.updatedAt)
}

async function upsertConversation(
  database: SqliteExecutor,
  conversation: Conversation,
): Promise<void> {
  await database.run(
    'INSERT OR REPLACE INTO conversation_records (id, title, providerId, model, updatedAt, payloadJson) VALUES (?, ?, ?, ?, ?, ?)',
    [conversation.id, conversation.title, conversation.providerId, conversation.model, conversation.updatedAt, JSON.stringify(conversation)],
  )
}
