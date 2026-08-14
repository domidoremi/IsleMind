import { asContextSnapshotId, type ContextSnapshotId } from '@/core'
import type { ContextSnapshot } from '@/modules/assistant-runtime'
import {
  applySqliteMigrations,
  type SqliteDatabaseProvider,
} from '@/platform/storage'
import * as v from 'valibot'
import {
  KNOWLEDGE_CONTEXT_SNAPSHOT_RECORD_SCHEMA,
  type ContextSnapshotRecord,
  type ContextSnapshotRepository,
  type ContextCitation,
  type ContextSourceReference,
} from '../contracts'

const MIGRATION_SCOPE = 'knowledge'

interface ContextSnapshotRow {
  id: string
  conversationId: string
  requestMessageId: string | null
  createdAt: number
  schema: string
  payloadJson: string
}

const sourceSchema = v.object({
  id: v.string(),
  kind: v.picklist(['memory', 'knowledge', 'web', 'attachment', 'tool']),
  title: v.optional(v.string()),
  sourceUri: v.optional(v.string()),
  score: v.optional(v.number()),
})

const citationSchema = v.object({
  id: v.string(),
  type: v.picklist(['memory', 'knowledge', 'web']),
  title: v.string(),
  excerpt: v.optional(v.string()),
  url: v.optional(v.string()),
  documentId: v.optional(v.string()),
  chunkId: v.optional(v.string()),
  score: v.optional(v.number()),
})

const snapshotSchema = v.object({
  schema: v.literal('islemind.context-snapshot.v1'),
  id: v.string(),
  createdAt: v.number(),
  conversationMessageIds: v.array(v.string()),
  memoryIds: v.array(v.string()),
  knowledgeSourceIds: v.array(v.string()),
  attachmentIds: v.array(v.string()),
  approvedToolContextIds: v.array(v.string()),
})

const recordSchema = v.object({
  schema: v.literal(KNOWLEDGE_CONTEXT_SNAPSHOT_RECORD_SCHEMA),
  snapshot: snapshotSchema,
  conversationId: v.string(),
  requestMessageId: v.optional(v.string()),
  providerContext: v.string(),
  sources: v.array(sourceSchema),
  citations: v.optional(v.array(citationSchema)),
})

export class ContextSnapshotRepositoryDataError extends Error {
  constructor(message = 'A persisted context snapshot record is invalid.') {
    super(message)
    this.name = 'ContextSnapshotRepositoryDataError'
  }
}

export function createSqliteContextSnapshotRepository(
  databaseProvider: SqliteDatabaseProvider,
): ContextSnapshotRepository {
  let initialized: Promise<void> | undefined

  async function database() {
    const value = await databaseProvider.get()
    initialized ??= applySqliteMigrations(value, [
      {
        scope: MIGRATION_SCOPE,
        version: 1,
        name: 'immutable-context-snapshots',
        async up(transaction) {
          await transaction.exec(`
            CREATE TABLE IF NOT EXISTS knowledge_context_snapshots (
              id TEXT PRIMARY KEY NOT NULL,
              conversationId TEXT NOT NULL,
              requestMessageId TEXT,
              createdAt INTEGER NOT NULL,
              payloadJson TEXT NOT NULL,
              schema TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS knowledge_context_snapshots_conversation_idx
              ON knowledge_context_snapshots (conversationId, createdAt DESC);
          `)
        },
      },
    ])
    await initialized
    return value
  }

  return {
    async save(record) {
      const normalized = parseRecord(record)
      await (await database()).run(
        `INSERT INTO knowledge_context_snapshots (
           id, conversationId, requestMessageId, createdAt, payloadJson, schema
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          normalized.snapshot.id,
          normalized.conversationId,
          normalized.requestMessageId ?? null,
          normalized.snapshot.createdAt,
          JSON.stringify(normalized),
          normalized.schema,
        ],
      )
    },

    async get(id) {
      const row = await (await database()).getFirst<ContextSnapshotRow>(
        `SELECT id, conversationId, requestMessageId, createdAt, schema, payloadJson
         FROM knowledge_context_snapshots WHERE id = ?`,
        [id],
      )
      if (!row) return undefined
      try {
        const record = parseRecord(JSON.parse(row.payloadJson))
        if (!matchesStoredColumns(record, row)) throw new ContextSnapshotRepositoryDataError()
        return record
      } catch (error) {
        if (error instanceof ContextSnapshotRepositoryDataError) throw error
        throw new ContextSnapshotRepositoryDataError()
      }
    },
  }
}

function matchesStoredColumns(record: ContextSnapshotRecord, row: ContextSnapshotRow): boolean {
  return record.snapshot.id === row.id &&
    record.conversationId === row.conversationId &&
    (record.requestMessageId ?? null) === row.requestMessageId &&
    record.snapshot.createdAt === row.createdAt &&
    record.schema === row.schema
}

function parseRecord(value: unknown): ContextSnapshotRecord {
  const parsed = v.safeParse(recordSchema, value)
  if (!parsed.success) throw new ContextSnapshotRepositoryDataError()
  const output = parsed.output
  if (!isBoundedText(output.conversationId, 256) || !isBoundedText(output.snapshot.id, 256) ||
    !isSafeTimestamp(output.snapshot.createdAt) || !isValidStringArray(output.snapshot.conversationMessageIds) ||
    !isValidStringArray(output.snapshot.memoryIds) || !isValidStringArray(output.snapshot.knowledgeSourceIds) ||
    !isValidStringArray(output.snapshot.attachmentIds) || !isValidStringArray(output.snapshot.approvedToolContextIds) ||
    !isValidOptionalId(output.requestMessageId) || output.providerContext.length > 24_000 || !isValidSources(output.sources) ||
    !isValidCitations(output.citations ?? [])) {
    throw new ContextSnapshotRepositoryDataError()
  }
  const snapshot: ContextSnapshot = {
    schema: output.snapshot.schema,
    id: asContextSnapshotId(output.snapshot.id),
    createdAt: output.snapshot.createdAt,
    conversationMessageIds: output.snapshot.conversationMessageIds,
    memoryIds: output.snapshot.memoryIds,
    knowledgeSourceIds: output.snapshot.knowledgeSourceIds,
    attachmentIds: output.snapshot.attachmentIds,
    approvedToolContextIds: output.snapshot.approvedToolContextIds,
  }
  return {
    schema: output.schema,
    snapshot,
    conversationId: output.conversationId,
    ...(output.requestMessageId ? { requestMessageId: output.requestMessageId } : {}),
    providerContext: output.providerContext,
    sources: output.sources,
    citations: output.citations ?? [],
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isSafeTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isValidOptionalId(value: unknown): boolean {
  return value === undefined || isBoundedText(value, 256)
}

function isValidStringArray(value: readonly string[]): boolean {
  return value.length <= 4_096 && value.every((item) => isBoundedText(item, 256))
}

function isValidSources(value: readonly ContextSourceReference[]): boolean {
  return value.length <= 64 && value.every((source) => isBoundedText(source.id, 512) &&
    (source.kind === 'memory' || source.kind === 'knowledge' || source.kind === 'web' || source.kind === 'attachment' || source.kind === 'tool') &&
    (source.title === undefined || isBoundedText(source.title, 512)) &&
    (source.sourceUri === undefined || isBoundedText(source.sourceUri, 2_048)) &&
    (source.score === undefined || (typeof source.score === 'number' && Number.isFinite(source.score))))
}

function isValidCitations(value: readonly ContextCitation[]): boolean {
  return value.length <= 64 && value.every((citation) => isBoundedText(citation.id, 512) &&
    (citation.type === 'memory' || citation.type === 'knowledge' || citation.type === 'web') &&
    isBoundedText(citation.title, 512) &&
    (citation.excerpt === undefined || citation.excerpt.length <= 1_200) &&
    (citation.url === undefined || citation.url.length <= 2_048) &&
    (citation.documentId === undefined || citation.documentId.length <= 512) &&
    (citation.chunkId === undefined || citation.chunkId.length <= 512) &&
    (citation.score === undefined || (typeof citation.score === 'number' && Number.isFinite(citation.score))))
}

function isBoundedText(value: unknown, limit: number): value is string {
  return isNonEmptyString(value) && value.length <= limit
}
