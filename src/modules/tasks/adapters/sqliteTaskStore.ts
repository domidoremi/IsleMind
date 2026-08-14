import { asAssistantRunId, asTaskId, type JsonRecord } from '@/core'
import {
  applySqliteMigrations,
  type SqliteDatabaseProvider,
  type SqliteExecutor,
} from '@/platform/storage'
import * as v from 'valibot'
import type {
  Task,
  TaskArtifact,
  TaskFailure,
  TaskJournalEntry,
  TaskJournalEventType,
  TaskPersistence,
  TaskPolicyDecision,
  TaskResult,
  TaskStatus,
} from '../contracts'

const MIGRATION_SCOPE = 'tasks'

interface TaskRow {
  id: string
  runId: string | null
  toolId: string
  idempotencyKey: string
  status: string
  createdAt: number
  startedAt: number | null
  confirmationRequestedAt: number | null
  confirmationConfirmedAt: number | null
  cancellationRequestedAt: number | null
  completedAt: number | null
  journalSequence: number
  policyJson: string
  artifactsJson: string
  resultJson: string | null
  failureJson: string | null
  schema: string
}

interface TaskJournalRow {
  taskId: string
  sequence: number
  type: string
  occurredAt: number
  dataJson: string | null
  schema: string
}

interface JournalSequenceRow {
  sequence: number
}

const policySchema = v.object({
  outcome: v.picklist(['allowed', 'requires-confirmation', 'denied']),
  reasonCode: v.string(),
})

const artifactSchema = v.object({
  id: v.string(),
  label: v.string(),
  createdAt: v.number(),
  uri: v.optional(v.string()),
  mediaType: v.optional(v.string()),
  sizeBytes: v.optional(v.number()),
  checksum: v.optional(v.string()),
})

const resultSchema = v.object({
  artifactIds: v.array(v.string()),
  summary: v.optional(v.string()),
})

const failureSchema = v.object({
  code: v.picklist(['policy_denied', 'executor_failed', 'interrupted']),
  message: v.string(),
})

export class TaskPersistenceDataError extends Error {
  constructor(message = 'A persisted task record is invalid.') {
    super(message)
    this.name = 'TaskPersistenceDataError'
  }
}

export function createSqliteTaskPersistence(databaseProvider: SqliteDatabaseProvider): TaskPersistence {
  let initialized: Promise<void> | undefined

  async function database() {
    const value = await databaseProvider.get()
    initialized ??= applySqliteMigrations(value, [
      {
        scope: MIGRATION_SCOPE,
        version: 1,
        name: 'tasks-and-journal',
        async up(transaction) {
          await transaction.exec(`
            CREATE TABLE IF NOT EXISTS assistant_tasks (
              id TEXT PRIMARY KEY NOT NULL,
              runId TEXT,
              toolId TEXT NOT NULL,
              idempotencyKey TEXT NOT NULL UNIQUE,
              status TEXT NOT NULL,
              createdAt INTEGER NOT NULL,
              startedAt INTEGER,
              confirmationRequestedAt INTEGER,
              confirmationConfirmedAt INTEGER,
              cancellationRequestedAt INTEGER,
              completedAt INTEGER,
              journalSequence INTEGER NOT NULL,
              policyJson TEXT NOT NULL,
              artifactsJson TEXT NOT NULL,
              resultJson TEXT,
              failureJson TEXT,
              schema TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS assistant_task_journal (
              taskId TEXT NOT NULL,
              sequence INTEGER NOT NULL,
              type TEXT NOT NULL,
              occurredAt INTEGER NOT NULL,
              dataJson TEXT,
              schema TEXT NOT NULL,
              PRIMARY KEY (taskId, sequence),
              FOREIGN KEY (taskId) REFERENCES assistant_tasks(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS assistant_tasks_recoverable_idx
              ON assistant_tasks (status, createdAt);
          `)
        },
      },
    ])
    await initialized
    return value
  }

  return {
    async get(taskId) {
      const row = await (await database()).getFirst<TaskRow>(taskSelectSql('WHERE id = ?'), [taskId])
      return row ? parseTask(row) : undefined
    },

    async findByIdempotencyKey(idempotencyKey) {
      const row = await (await database()).getFirst<TaskRow>(taskSelectSql('WHERE idempotencyKey = ?'), [idempotencyKey])
      return row ? parseTask(row) : undefined
    },

    async listRecoverable() {
      const rows = await (await database()).getAll<TaskRow>(
        `${taskSelectSql("WHERE status IN ('queued', 'running', 'awaiting-confirmation')")} ORDER BY createdAt ASC`,
      )
      return rows.map(parseTask)
    },

    async save(task) {
      await saveTask(await database(), task)
    },

    async append(entry) {
      await appendJournalEntry(await database(), entry)
    },

    async list(taskId) {
      const rows = await (await database()).getAll<TaskJournalRow>(
        `SELECT taskId, sequence, type, occurredAt, dataJson, schema
         FROM assistant_task_journal WHERE taskId = ? ORDER BY sequence ASC`,
        [taskId],
      )
      return rows.map(parseJournalEntry)
    },

    async appendAndSave(entry, task) {
      if (entry.taskId !== task.id || entry.sequence !== task.journalSequence) {
        throw new TaskPersistenceDataError('Task journal state is not contiguous.')
      }
      const value = await database()
      await value.transaction(async (transaction) => {
        await saveTask(transaction, task)
        const previous = await transaction.getFirst<JournalSequenceRow>(
          'SELECT sequence FROM assistant_task_journal WHERE taskId = ? ORDER BY sequence DESC LIMIT 1',
          [entry.taskId],
        )
        if (entry.sequence !== (previous?.sequence ?? 0) + 1) {
          throw new TaskPersistenceDataError('Task journal sequence is not contiguous.')
        }
        await appendJournalEntry(transaction, entry)
      })
    },
  }
}

function taskSelectSql(where: string): string {
  return `SELECT id, runId, toolId, idempotencyKey, status, createdAt, startedAt,
                 confirmationRequestedAt, confirmationConfirmedAt, cancellationRequestedAt, completedAt,
                 journalSequence, policyJson, artifactsJson, resultJson, failureJson, schema
          FROM assistant_tasks ${where}`
}

async function saveTask(database: SqliteExecutor, task: Task): Promise<void> {
  const normalized = parseTaskRecord(task)
  await database.run(
    `INSERT INTO assistant_tasks (
       id, runId, toolId, idempotencyKey, status, createdAt, startedAt,
       confirmationRequestedAt, confirmationConfirmedAt, cancellationRequestedAt, completedAt,
       journalSequence, policyJson, artifactsJson, resultJson, failureJson, schema
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       runId = excluded.runId,
       toolId = excluded.toolId,
       idempotencyKey = excluded.idempotencyKey,
       status = excluded.status,
       createdAt = excluded.createdAt,
       startedAt = excluded.startedAt,
       confirmationRequestedAt = excluded.confirmationRequestedAt,
       confirmationConfirmedAt = excluded.confirmationConfirmedAt,
       cancellationRequestedAt = excluded.cancellationRequestedAt,
       completedAt = excluded.completedAt,
       journalSequence = excluded.journalSequence,
       policyJson = excluded.policyJson,
       artifactsJson = excluded.artifactsJson,
       resultJson = excluded.resultJson,
       failureJson = excluded.failureJson,
       schema = excluded.schema`,
    [
      normalized.id,
      normalized.runId ?? null,
      normalized.toolId,
      normalized.idempotencyKey,
      normalized.status,
      normalized.createdAt,
      normalized.startedAt ?? null,
      normalized.confirmationRequestedAt ?? null,
      normalized.confirmationConfirmedAt ?? null,
      normalized.cancellationRequestedAt ?? null,
      normalized.completedAt ?? null,
      normalized.journalSequence,
      JSON.stringify(normalized.policy),
      JSON.stringify(normalized.artifacts),
      normalized.result ? JSON.stringify(normalized.result) : null,
      normalized.failure ? JSON.stringify(normalized.failure) : null,
      normalized.schema,
    ],
  )
}

async function appendJournalEntry(database: SqliteExecutor, entry: TaskJournalEntry): Promise<void> {
  const normalized = parseJournalEntryRecord(entry)
  await database.run(
    `INSERT INTO assistant_task_journal (taskId, sequence, type, occurredAt, dataJson, schema)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      normalized.taskId,
      normalized.sequence,
      normalized.type,
      normalized.occurredAt,
      normalized.data ? JSON.stringify(normalized.data) : null,
      normalized.schema,
    ],
  )
}

function parseTask(row: TaskRow): Task {
  const policy = parseJson(row.policyJson, parsePolicy)
  const artifacts = parseJson(row.artifactsJson, parseArtifacts)
  const result = parseOptionalJson(row.resultJson, parseResult)
  const failure = parseOptionalJson(row.failureJson, parseFailure)
  if (row.schema !== 'islemind.task.v1' || !isBoundedText(row.id, 256) || !isValidOptionalId(row.runId) ||
    !isBoundedText(row.toolId, 256) || !isBoundedText(row.idempotencyKey, 512) || !isTaskStatus(row.status) ||
    !isTimestamp(row.createdAt) || !isNonNegativeInteger(row.journalSequence) || row.journalSequence < 1) {
    throw new TaskPersistenceDataError()
  }
  const startedAt = parseOptionalTimestamp(row.startedAt)
  const confirmationRequestedAt = parseOptionalTimestamp(row.confirmationRequestedAt)
  const confirmationConfirmedAt = parseOptionalTimestamp(row.confirmationConfirmedAt)
  const cancellationRequestedAt = parseOptionalTimestamp(row.cancellationRequestedAt)
  const completedAt = parseOptionalTimestamp(row.completedAt)
  if ((row.status === 'succeeded' && !result) ||
    (row.status === 'failed' && !failure) ||
    (isTerminalStatus(row.status) && completedAt === undefined) ||
    (result && !result.artifactIds.every((artifactId) => artifacts.some((artifact) => artifact.id === artifactId)))) {
    throw new TaskPersistenceDataError()
  }
  return {
    schema: 'islemind.task.v1',
    id: asTaskId(row.id),
    ...(row.runId ? { runId: asAssistantRunId(row.runId) } : {}),
    toolId: row.toolId,
    idempotencyKey: row.idempotencyKey,
    status: row.status,
    policy,
    createdAt: row.createdAt,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(confirmationRequestedAt === undefined ? {} : { confirmationRequestedAt }),
    ...(confirmationConfirmedAt === undefined ? {} : { confirmationConfirmedAt }),
    ...(cancellationRequestedAt === undefined ? {} : { cancellationRequestedAt }),
    ...(completedAt === undefined ? {} : { completedAt }),
    journalSequence: row.journalSequence,
    artifacts,
    ...(result ? { result } : {}),
    ...(failure ? { failure } : {}),
  }
}

function parseTaskRecord(value: Task): Task {
  const row: TaskRow = {
    id: value.id,
    runId: value.runId ?? null,
    toolId: value.toolId,
    idempotencyKey: value.idempotencyKey,
    status: value.status,
    createdAt: value.createdAt,
    startedAt: value.startedAt ?? null,
    confirmationRequestedAt: value.confirmationRequestedAt ?? null,
    confirmationConfirmedAt: value.confirmationConfirmedAt ?? null,
    cancellationRequestedAt: value.cancellationRequestedAt ?? null,
    completedAt: value.completedAt ?? null,
    journalSequence: value.journalSequence,
    policyJson: JSON.stringify(value.policy),
    artifactsJson: JSON.stringify(value.artifacts),
    resultJson: value.result ? JSON.stringify(value.result) : null,
    failureJson: value.failure ? JSON.stringify(value.failure) : null,
    schema: value.schema,
  }
  return parseTask(row)
}

function parseJournalEntry(row: TaskJournalRow): TaskJournalEntry {
  if (row.schema !== 'islemind.task-journal-entry.v1' || !isBoundedText(row.taskId, 256) ||
    !isNonNegativeInteger(row.sequence) || row.sequence < 1 || !isTaskJournalEventType(row.type) ||
    !isTimestamp(row.occurredAt)) {
    throw new TaskPersistenceDataError('A task journal record is invalid.')
  }
  const data = parseOptionalJson(row.dataJson, parseJsonRecord)
  return {
    schema: 'islemind.task-journal-entry.v1',
    taskId: asTaskId(row.taskId),
    sequence: row.sequence,
    type: row.type,
    occurredAt: row.occurredAt,
    ...(data ? { data } : {}),
  }
}

function parseJournalEntryRecord(value: TaskJournalEntry): TaskJournalEntry {
  const row: TaskJournalRow = {
    taskId: value.taskId,
    sequence: value.sequence,
    type: value.type,
    occurredAt: value.occurredAt,
    dataJson: value.data ? JSON.stringify(value.data) : null,
    schema: value.schema,
  }
  return parseJournalEntry(row)
}

function parsePolicy(value: unknown): TaskPolicyDecision {
  const parsed = v.safeParse(policySchema, value)
  if (!parsed.success || !isBoundedText(parsed.output.reasonCode, 128)) throw new TaskPersistenceDataError()
  return { outcome: parsed.output.outcome, reasonCode: parsed.output.reasonCode }
}

function parseArtifacts(value: unknown): readonly TaskArtifact[] {
  const parsed = v.safeParse(v.array(artifactSchema), value)
  if (!parsed.success || parsed.output.length > 32) throw new TaskPersistenceDataError()
  const ids = new Set<string>()
  return parsed.output.map((artifact) => {
    if (!isBoundedText(artifact.id, 256) || !isBoundedText(artifact.label, 512) || !isTimestamp(artifact.createdAt) ||
      (artifact.uri !== undefined && !isBoundedText(artifact.uri, 2_048)) ||
      (artifact.mediaType !== undefined && !isBoundedText(artifact.mediaType, 256)) ||
      (artifact.checksum !== undefined && !isBoundedText(artifact.checksum, 256)) ||
      (artifact.sizeBytes !== undefined && (!isNonNegativeInteger(artifact.sizeBytes)))) {
      throw new TaskPersistenceDataError()
    }
    if (ids.has(artifact.id)) throw new TaskPersistenceDataError()
    ids.add(artifact.id)
    return {
      id: artifact.id,
      label: artifact.label,
      createdAt: artifact.createdAt,
      ...(artifact.uri ? { uri: artifact.uri } : {}),
      ...(artifact.mediaType ? { mediaType: artifact.mediaType } : {}),
      ...(artifact.sizeBytes === undefined ? {} : { sizeBytes: artifact.sizeBytes }),
      ...(artifact.checksum ? { checksum: artifact.checksum } : {}),
    }
  })
}

function parseResult(value: unknown): TaskResult {
  const parsed = v.safeParse(resultSchema, value)
  if (!parsed.success || parsed.output.artifactIds.length > 32 || !parsed.output.artifactIds.every((id) => isBoundedText(id, 256)) ||
    (parsed.output.summary !== undefined && !isBoundedText(parsed.output.summary, 2_000))) {
    throw new TaskPersistenceDataError()
  }
  return {
    artifactIds: parsed.output.artifactIds,
    ...(parsed.output.summary ? { summary: parsed.output.summary } : {}),
  }
}

function parseFailure(value: unknown): TaskFailure {
  const parsed = v.safeParse(failureSchema, value)
  if (!parsed.success || !isBoundedText(parsed.output.message, 2_000)) throw new TaskPersistenceDataError()
  return { code: parsed.output.code, message: parsed.output.message }
}

function parseJsonRecord(value: unknown): JsonRecord {
  if (!isJsonRecord(value)) throw new TaskPersistenceDataError('Task journal data is invalid.')
  return value
}

function parseJson<Value>(value: string, parser: (parsed: unknown) => Value): Value {
  try {
    return parser(JSON.parse(value))
  } catch (error) {
    if (error instanceof TaskPersistenceDataError) throw error
    throw new TaskPersistenceDataError()
  }
}

function parseOptionalJson<Value>(value: string | null, parser: (parsed: unknown) => Value): Value | undefined {
  return value === null ? undefined : parseJson(value, parser)
}

function isTaskStatus(value: string): value is TaskStatus {
  return value === 'queued' || value === 'running' || value === 'awaiting-confirmation' ||
    value === 'succeeded' || value === 'failed' || value === 'cancelled' || value === 'expired'
}

function isTerminalStatus(value: TaskStatus): boolean {
  return value === 'succeeded' || value === 'failed' || value === 'cancelled' || value === 'expired'
}

function isTaskJournalEventType(value: string): value is TaskJournalEventType {
  return value === 'task.created' || value === 'task.confirmed' || value === 'task.started' ||
    value === 'task.artifact-recorded' || value === 'task.cancellation-requested' ||
    value === 'task.succeeded' || value === 'task.failed' || value === 'task.cancelled' || value === 'task.expired'
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isValidOptionalId(value: unknown): boolean {
  return value === null || isBoundedText(value, 256)
}

function isBoundedText(value: unknown, limit: number): value is string {
  return isNonEmptyString(value) && value.length <= limit
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function parseOptionalTimestamp(value: number | null): number | undefined {
  if (value === null) return undefined
  if (!isTimestamp(value)) throw new TaskPersistenceDataError()
  return value
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isJsonRecord(value: unknown): value is JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every(isJsonValue)
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isJsonRecord(value)
}
