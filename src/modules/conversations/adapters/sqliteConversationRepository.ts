import {
  applySqliteMigrations,
  type SqliteDatabaseProvider,
  type SqliteExecutor,
} from '@/platform/storage'
import type { Conversation } from '@/types/chatContracts'
import type { ConversationPageInput, ConversationRepository } from '../contracts'
import { parseConversationSnapshot, type ConversationSnapshot } from '../domain/conversationSnapshot'

interface ConversationRecordRow {
  id?: string
  payloadJson?: string | null
}

interface ConversationColumnRow {
  name: string
  notnull?: number
}

interface ConversationStateRow {
  conversationId: string
  stateJson: string
  messageCount: number
  updatedAt?: number
}

const DEFAULT_CONVERSATION_PAGE_SIZE = 40
const MAX_CONVERSATION_PAGE_SIZE = 100
const CONVERSATION_MIGRATION_SCOPE = 'conversations'

interface ConversationMessageRow {
  conversationId: string
  id: string
  ordinal: number
  messageJson: string
}

const ensureConversationRecords = async (database: Awaited<ReturnType<SqliteDatabaseProvider['get']>>) => {
  await applySqliteMigrations(database, [
    {
      scope: CONVERSATION_MIGRATION_SCOPE,
      version: 1,
      name: 'normalized-conversation-records',
      async up(transaction) {
        await ensureConversationTables(transaction)
        await migrateLegacyConversationRecords(transaction)
      },
    },
  ])
  try {
    await applySqliteMigrations(database, [
      {
        scope: CONVERSATION_MIGRATION_SCOPE,
        version: 2,
        name: 'remove-conversation-payload-mirror',
        async up(transaction) {
          if (!(await removePayloadMirrorIfSafe(transaction))) {
            throw new ConversationPayloadMirrorPendingError()
          }
        },
      },
    ])
  } catch (error) {
    if (!(error instanceof ConversationPayloadMirrorPendingError)) throw error
  }
  return hasRequiredConversationPayloadColumn(database)
}

export class ConversationRepositoryDataError extends Error {
  constructor() {
    super('The persisted conversation record is invalid.')
    this.name = 'ConversationRepositoryDataError'
  }
}

class ConversationPayloadMirrorPendingError extends Error {
  constructor() {
    super('Conversation payload mirror cannot be removed until every legacy record is normalized.')
    this.name = 'ConversationPayloadMirrorPendingError'
  }
}

export function createSqliteConversationRepository(
  databaseProvider: SqliteDatabaseProvider,
): ConversationRepository {
  let initialization: Promise<void> | undefined
  let legacyPayloadRequiredOnInsert = false

  async function database(): Promise<Awaited<ReturnType<SqliteDatabaseProvider['get']>>> {
    const value = await databaseProvider.get()
    initialization ??= ensureConversationRecords(value).then((requiresLegacyPayloadOnInsert) => {
      legacyPayloadRequiredOnInsert = requiresLegacyPayloadOnInsert
    }).catch((error) => {
      initialization = undefined
      throw error
    })
    await initialization
    return value
  }

  return {
    async get(conversationId) {
      const value = await database()
      const record = await value.getFirst<{ id: string }>(
        'SELECT id FROM conversation_records WHERE id = ?',
        [conversationId],
      )
      const state = await value.getFirst<ConversationStateRow>(
        'SELECT conversationId, stateJson, messageCount FROM conversation_record_state WHERE conversationId = ?',
        [conversationId],
      )
      if (!record && !state) return undefined
      if (!record || !state) throw new ConversationRepositoryDataError()
      const normalized = await readNormalizedConversation(value, state)
      if (normalized) return normalized
      throw new ConversationRepositoryDataError()
    },
    async loadRecord(conversationId) {
      const value = await database()
      const record = await value.getFirst<{ id: string }>(
        'SELECT id FROM conversation_records WHERE id = ?',
        [conversationId],
      )
      const state = await value.getFirst<ConversationStateRow>(
        'SELECT conversationId, stateJson, messageCount FROM conversation_record_state WHERE conversationId = ?',
        [conversationId],
      )
      if (!record && !state) return undefined
      if (!record || !state) throw new ConversationRepositoryDataError()
      const normalized = await readNormalizedConversationRecord(value, state)
      if (normalized) return normalized
      throw new ConversationRepositoryDataError()
    },
    async loadAll() {
      const value = await database()
      const states = await value.getAll<ConversationStateRow>(
        `SELECT state.conversationId, state.stateJson, state.messageCount, record.updatedAt
         FROM conversation_record_state AS state
         JOIN conversation_records AS record ON record.id = state.conversationId
         ORDER BY record.updatedAt DESC, record.id ASC`,
      )
      const messageRows = await value.getAll<ConversationMessageRow>(
        'SELECT conversationId, id, ordinal, messageJson FROM conversation_message_records ORDER BY conversationId, ordinal',
      )
      const messagesByConversationId = groupMessageRows(messageRows)
      return states.flatMap((state) => {
        try {
          const normalized = composeNormalizedConversation(
            state,
            messagesByConversationId.get(state.conversationId) ?? [],
          )
          return normalized ? [normalized] : []
        } catch {
          return []
        }
      })
    },
    async loadPage(input = {}) {
      const value = await database()
      const limit = normalizeConversationPageLimit(input.limit)
      const cursor = decodeConversationPageCursor(input.cursor)
      const states = await value.getAll<ConversationStateRow>(
        `SELECT state.conversationId, state.stateJson, state.messageCount, record.updatedAt
         FROM conversation_record_state AS state
         JOIN conversation_records AS record ON record.id = state.conversationId
         ${cursor ? 'WHERE (record.updatedAt < ? OR (record.updatedAt = ? AND record.id > ?))' : ''}
         ORDER BY record.updatedAt DESC, record.id ASC
         LIMIT ?`,
        cursor
          ? [cursor.updatedAt, cursor.updatedAt, cursor.id, limit + 1]
          : [limit + 1],
      )
      const pageStates = states.slice(0, limit)
      const messageRows = pageStates.length
        ? await value.getAll<ConversationMessageRow>(
          `SELECT conversationId, id, ordinal, messageJson
           FROM conversation_message_records
           WHERE conversationId IN (${pageStates.map(() => '?').join(',')})
           ORDER BY conversationId, ordinal`,
          pageStates.map((state) => state.conversationId),
        )
        : []
      const messagesByConversationId = groupMessageRows(messageRows)
      const conversations = pageStates.flatMap((state) => {
        try {
          const normalized = composeNormalizedConversation(
            state,
            messagesByConversationId.get(state.conversationId) ?? [],
          )
          return normalized ? [normalized] : []
        } catch {
          return []
        }
      })
      const hasMore = states.length > limit
      const lastState = pageStates.at(-1)
      return {
        conversations,
        hasMore,
        ...(hasMore && lastState
          ? { nextCursor: encodeConversationPageCursor(lastState.updatedAt, lastState.conversationId) }
          : {}),
      }
    },
    async loadReplacementSnapshot() {
      const value = await database()
      return value.transaction(async (transaction) => {
        const recordIds = await transaction.getAll<{ id: string }>(
          'SELECT id FROM conversation_records ORDER BY updatedAt DESC, id ASC',
        )
        const stateIds = await transaction.getAll<{ conversationId: string }>(
          'SELECT conversationId FROM conversation_record_state ORDER BY conversationId ASC',
        )
        assertNormalizedRecoveryCoverage(recordIds, stateIds)
        const states = await transaction.getAll<ConversationStateRow>(
          `SELECT state.conversationId, state.stateJson, state.messageCount
           FROM conversation_record_state AS state
           JOIN conversation_records AS record ON record.id = state.conversationId
           ORDER BY record.updatedAt DESC, record.id ASC`,
        )
        const messageRows = await transaction.getAll<ConversationMessageRow>(
          'SELECT conversationId, id, ordinal, messageJson FROM conversation_message_records ORDER BY conversationId, ordinal',
        )
        const normalizedConversationIds = new Set(stateIds.map((row) => row.conversationId))
        if (messageRows.some((row) => !normalizedConversationIds.has(row.conversationId))) {
          throw new ConversationRepositoryDataError()
        }
        const messagesByConversationId = groupMessageRows(messageRows)
        return states.map((state) => {
          const normalized = composeNormalizedConversation(
            state,
            messagesByConversationId.get(state.conversationId) ?? [],
          )
          if (!normalized || normalized.id !== state.conversationId || !isFullConversationRecord(normalized)) {
            throw new ConversationRepositoryDataError()
          }
          return normalized
        })
      })
    },
    async save(conversation) {
      const value = await database()
      await value.transaction(async (transaction) => {
        await upsertConversation(transaction, conversation, legacyPayloadRequiredOnInsert)
      })
    },
    async replaceAll(conversations) {
      const value = await database()
      await value.transaction(async (transaction) => {
        await transaction.run('DELETE FROM conversation_message_records')
        await transaction.run('DELETE FROM conversation_record_state')
        await transaction.run('DELETE FROM conversation_records')
        for (const conversation of conversations) {
          await upsertConversation(transaction, conversation, legacyPayloadRequiredOnInsert)
        }
      })
    },
    async clear() {
      const value = await database()
      await value.transaction(async (transaction) => {
        await transaction.run('DELETE FROM conversation_message_records')
        await transaction.run('DELETE FROM conversation_record_state')
        await transaction.run('DELETE FROM conversation_records')
      })
    },
  }
}

async function migrateLegacyConversationRecords(
  database: SqliteExecutor,
): Promise<void> {
  if (!(await hasConversationColumn(database, 'payloadJson'))) return
  const rows = await database.getAll<ConversationRecordRow>(
    `SELECT record.id, record.payloadJson
     FROM conversation_records AS record
     LEFT JOIN conversation_record_state AS state ON state.conversationId = record.id
     WHERE state.conversationId IS NULL
     ORDER BY record.updatedAt ASC, record.id ASC`,
  )
  if (!rows.length) return
  for (const row of rows) {
    if (!row.id || typeof row.payloadJson !== 'string') continue
    let parsedValue: unknown
    try {
      parsedValue = JSON.parse(row.payloadJson)
    } catch {
      continue
    }
    const conversation = parseMigratableConversationRecord(parsedValue, row.id)
    if (!conversation) continue
    await upsertNormalizedRows(database, conversation)
  }
}

async function ensureConversationTables(database: SqliteExecutor): Promise<void> {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS conversation_records (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      providerId TEXT NOT NULL,
      model TEXT NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversation_record_state (
      conversationId TEXT PRIMARY KEY NOT NULL,
      stateJson TEXT NOT NULL,
      messageCount INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversation_message_records (
      conversationId TEXT NOT NULL,
      id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      messageJson TEXT NOT NULL,
      PRIMARY KEY (conversationId, id),
      UNIQUE (conversationId, ordinal)
    );
    CREATE INDEX IF NOT EXISTS conversation_message_records_order
      ON conversation_message_records (conversationId, ordinal);
    CREATE INDEX IF NOT EXISTS conversation_records_history_order
      ON conversation_records (updatedAt DESC, id ASC);
  `)
}

async function hasConversationColumn(database: SqliteExecutor, column: string): Promise<boolean> {
  const rows = await database.getAll<ConversationColumnRow>('PRAGMA table_info(conversation_records)')
  return rows.some((row) => row.name === column)
}

async function hasRequiredConversationPayloadColumn(database: SqliteExecutor): Promise<boolean> {
  const rows = await database.getAll<ConversationColumnRow>('PRAGMA table_info(conversation_records)')
  return rows.some((row) => row.name === 'payloadJson' && row.notnull === 1)
}

async function removePayloadMirrorIfSafe(database: SqliteExecutor): Promise<boolean> {
  if (!(await hasConversationColumn(database, 'payloadJson'))) return true

  try {
    await migrateLegacyConversationRecords(database)
  } catch (error) {
    if (error instanceof ConversationRepositoryDataError) return false
    throw error
  }
  const records = await database.getAll<{ id: string }>(
    'SELECT id FROM conversation_records ORDER BY updatedAt DESC, id ASC',
  )
  const states = await database.getAll<{ conversationId: string }>(
    'SELECT conversationId FROM conversation_record_state ORDER BY conversationId ASC',
  )
  if (records.length !== states.length) return false
  const recordIds = new Set(records.map((row) => row.id))
  const stateIds = new Set(states.map((row) => row.conversationId))
  if (recordIds.size !== records.length || stateIds.size !== states.length) return false
  for (const id of recordIds) if (!stateIds.has(id)) return false

  const normalizedStates = await database.getAll<ConversationStateRow>(
    `SELECT state.conversationId, state.stateJson, state.messageCount
     FROM conversation_record_state AS state
     JOIN conversation_records AS record ON record.id = state.conversationId
     ORDER BY record.updatedAt DESC, record.id ASC`,
  )
  const messageRows = await database.getAll<ConversationMessageRow>(
    'SELECT conversationId, id, ordinal, messageJson FROM conversation_message_records ORDER BY conversationId, ordinal',
  )
  if (messageRows.some((row) => !stateIds.has(row.conversationId))) return false
  const messagesByConversationId = groupMessageRows(messageRows)
  try {
    for (const state of normalizedStates) {
      const normalized = composeNormalizedConversation(
        state,
        messagesByConversationId.get(state.conversationId) ?? [],
      )
      if (!normalized || normalized.id !== state.conversationId || !isFullConversationRecord(normalized)) return false
    }
  } catch {
    return false
  }

  await database.run('DROP INDEX IF EXISTS conversation_records_history_order')
  await database.run(`
    CREATE TABLE conversation_records_without_payload (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      providerId TEXT NOT NULL,
      model TEXT NOT NULL,
      updatedAt INTEGER NOT NULL
    )
  `)
  await database.run(`
    INSERT INTO conversation_records_without_payload (id, title, providerId, model, updatedAt)
    SELECT id, title, providerId, model, updatedAt FROM conversation_records
  `)
  await database.run('DROP TABLE conversation_records')
  await database.run('ALTER TABLE conversation_records_without_payload RENAME TO conversation_records')
  await database.run(`
    CREATE INDEX conversation_records_history_order
      ON conversation_records (updatedAt DESC, id ASC)
  `)
  return true
}

function parseMigratableConversationRecord(value: unknown, conversationId: string): Conversation | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const conversation = value as Partial<Conversation>
  if (!parseConversationSnapshot(value) || conversation.id !== conversationId) return undefined
  if (!Array.isArray(conversation.messages)) return undefined
  return value as Conversation
}

function isFullConversationRecord(value: unknown): value is Conversation {
  if (!value || typeof value !== 'object') return false
  const conversation = value as Partial<Conversation>
  return typeof conversation.title === 'string' &&
    Number.isFinite(conversation.createdAt) &&
    Number.isFinite(conversation.updatedAt)
}

function assertNormalizedRecoveryCoverage(
  records: readonly { id: string }[],
  states: readonly { conversationId: string }[],
): void {
  if (records.length !== states.length) throw new ConversationRepositoryDataError()
  const recordIds = new Set(records.map((row) => row.id))
  const stateIds = new Set(states.map((row) => row.conversationId))
  if (recordIds.size !== records.length || stateIds.size !== states.length) {
    throw new ConversationRepositoryDataError()
  }
  for (const id of recordIds) {
    if (!stateIds.has(id)) throw new ConversationRepositoryDataError()
  }
}

async function upsertConversation(
  database: SqliteExecutor,
  conversation: Conversation,
  requireLegacyPayloadOnInsert: boolean,
): Promise<void> {
  const previousRecord = await database.getFirst<{ id: string }>(
    'SELECT id FROM conversation_records WHERE id = ?',
    [conversation.id],
  )
  if (!previousRecord) {
    if (requireLegacyPayloadOnInsert) {
      await database.run(
        'INSERT OR REPLACE INTO conversation_records (id, title, providerId, model, updatedAt, payloadJson) VALUES (?, ?, ?, ?, ?, ?)',
        [conversation.id, conversation.title, conversation.providerId, conversation.model, conversation.updatedAt, JSON.stringify(conversation)],
      )
    } else {
      await database.run(
        'INSERT OR REPLACE INTO conversation_records (id, title, providerId, model, updatedAt) VALUES (?, ?, ?, ?, ?)',
        [conversation.id, conversation.title, conversation.providerId, conversation.model, conversation.updatedAt],
      )
    }
  } else {
    await database.run(
      'UPDATE conversation_records SET title = ?, providerId = ?, model = ?, updatedAt = ? WHERE id = ?',
      [conversation.title, conversation.providerId, conversation.model, conversation.updatedAt, conversation.id],
    )
  }

  await upsertNormalizedRows(database, conversation)
}

async function upsertNormalizedRows(
  database: SqliteExecutor,
  conversation: Conversation,
): Promise<void> {
  const existingRows = await database.getAll<{ id: string; ordinal: number; messageJson: string }>(
    'SELECT id, ordinal, messageJson FROM conversation_message_records WHERE conversationId = ?',
    [conversation.id],
  )
  const existingById = new Map(existingRows.map((row) => [row.id, row]))
  const nextIds = new Set(conversation.messages.map((message) => message.id))
  if (existingRows.length > 0) {
    // Free the ordinal uniqueness constraint before applying inserts/reorders.
    await database.run(
      'UPDATE conversation_message_records SET ordinal = ordinal + 1000000000 WHERE conversationId = ?',
      [conversation.id],
    )
  }
  for (const row of existingRows) {
    if (!nextIds.has(row.id)) {
      await database.run(
        'DELETE FROM conversation_message_records WHERE conversationId = ? AND id = ?',
        [conversation.id, row.id],
      )
    }
  }
  for (const [ordinal, message] of conversation.messages.entries()) {
    const messageJson = JSON.stringify(message)
    const existing = existingById.get(message.id)
    if (existing?.ordinal === ordinal && existing.messageJson === messageJson) {
      await database.run(
        'UPDATE conversation_message_records SET ordinal = ? WHERE conversationId = ? AND id = ?',
        [ordinal, conversation.id, message.id],
      )
      continue
    }
    await database.run(
      `INSERT OR REPLACE INTO conversation_message_records (
         conversationId, id, ordinal, messageJson
       ) VALUES (?, ?, ?, ?)`,
      [conversation.id, message.id, ordinal, messageJson],
    )
  }
  await database.run(
    'INSERT OR REPLACE INTO conversation_record_state (conversationId, stateJson, messageCount) VALUES (?, ?, ?)',
    [conversation.id, JSON.stringify({ ...conversation, messages: [] }), conversation.messages.length],
  )
}

async function readNormalizedConversation(
  database: SqliteExecutor,
  state: ConversationStateRow,
): Promise<ConversationSnapshot | undefined> {
  const conversation = await readNormalizedConversationRecord(database, state)
  return conversation ? parseConversationSnapshot(conversation) : undefined
}

async function readNormalizedConversationRecord(
  database: SqliteExecutor,
  state: ConversationStateRow,
): Promise<Conversation | undefined> {
  const rows = await database.getAll<ConversationMessageRow>(
    'SELECT conversationId, id, ordinal, messageJson FROM conversation_message_records WHERE conversationId = ? ORDER BY ordinal',
    [state.conversationId],
  )
  return composeNormalizedConversation(state, rows)
}

function composeNormalizedConversation(
  state: ConversationStateRow,
  rows: readonly ConversationMessageRow[],
): Conversation | undefined {
  if (!Number.isSafeInteger(state.messageCount) || state.messageCount < 0 || rows.length !== state.messageCount) {
    return undefined
  }
  let parsedState: unknown
  try {
    parsedState = JSON.parse(state.stateJson)
  } catch {
    return undefined
  }
  if (!isConversationMetadata(parsedState)) return undefined
  const base = parsedState as Conversation
  if (base.id !== state.conversationId) return undefined
  const messages = rows.map((row, index) => {
    if (row.conversationId !== state.conversationId || row.ordinal !== index) {
      throw new ConversationRepositoryDataError()
    }
    let parsedMessage: unknown
    try {
      parsedMessage = JSON.parse(row.messageJson)
    } catch {
      throw new ConversationRepositoryDataError()
    }
    if (!isPersistedMessage(parsedMessage) || parsedMessage.id !== row.id) {
      throw new ConversationRepositoryDataError()
    }
    return parsedMessage
  })
  return { ...base, messages }
}

function groupMessageRows(
  rows: readonly ConversationMessageRow[],
): Map<string, ConversationMessageRow[]> {
  const grouped = new Map<string, ConversationMessageRow[]>()
  for (const row of rows) {
    const current = grouped.get(row.conversationId)
    if (current) current.push(row)
    else grouped.set(row.conversationId, [row])
  }
  return grouped
}

function normalizeConversationPageLimit(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) return DEFAULT_CONVERSATION_PAGE_SIZE
  return Math.min(MAX_CONVERSATION_PAGE_SIZE, Math.max(1, Math.floor(value)))
}

function encodeConversationPageCursor(updatedAt: number | undefined, id: string): string {
  if (!Number.isSafeInteger(updatedAt)) throw new ConversationRepositoryDataError()
  return `${updatedAt}:${encodeURIComponent(id)}`
}

function decodeConversationPageCursor(value: string | undefined): { updatedAt: number; id: string } | undefined {
  if (value === undefined) return undefined
  const separator = value.indexOf(':')
  if (separator <= 0) throw new ConversationRepositoryDataError()
  const updatedAt = Number(value.slice(0, separator))
  let id: string
  try {
    id = decodeURIComponent(value.slice(separator + 1))
  } catch {
    throw new ConversationRepositoryDataError()
  }
  if (!Number.isSafeInteger(updatedAt) || !id) throw new ConversationRepositoryDataError()
  return { updatedAt, id }
}

function isPersistedMessage(value: unknown): value is Conversation['messages'][number] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const message = value as Partial<Conversation['messages'][number]> & {
    text?: unknown
    responseText?: unknown
  }
  return typeof message.id === 'string'
    && (message.role === 'user' || message.role === 'assistant')
    && (message.providerId === undefined || (typeof message.providerId === 'string' && message.providerId.trim().length > 0))
    && (message.model === undefined || (typeof message.model === 'string' && message.model.trim().length > 0))
    && (
      typeof message.content === 'string'
      || typeof message.text === 'string'
      || typeof message.responseText === 'string'
    )
    && (message.timestamp === undefined || Number.isFinite(message.timestamp))
    && (
      message.status === undefined
      || ['sending', 'streaming', 'done', 'error', 'cancelled'].includes(message.status)
    )
}

function isConversationMetadata(value: unknown): value is Pick<Conversation, 'id' | 'providerId' | 'model'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const conversation = value as Partial<Conversation>
  return typeof conversation.id === 'string' && conversation.id.trim().length > 0
    && typeof conversation.providerId === 'string' && conversation.providerId.trim().length > 0
    && typeof conversation.model === 'string' && conversation.model.trim().length > 0
}
