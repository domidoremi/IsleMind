import {
  asAssistantRunId,
  asContextSnapshotId,
  freezeChatRequest,
  isChatRequest,
  type ChatRequest,
  type JsonRecord,
} from '@/core'
import {
  applySqliteMigrations,
  type SqliteDatabaseProvider,
  type SqliteExecutor,
} from '@/platform/storage'
import {
  ASSISTANT_ACTIVITY_REQUEST_EVIDENCE_SCHEMA,
  ASSISTANT_ACTIVITY_CONTINUATION_IDENTITY_SCHEMA,
  ASSISTANT_RUN_ACTIVITY_REQUEST_SNAPSHOT_SCHEMA,
  ASSISTANT_RUN_REQUEST_SNAPSHOT_SCHEMA,
  PENDING_MODEL_OPERATION_SCHEMA,
  cloneAssistantContextPlanReceipt,
  isAssistantContextPlanReceipt,
  type AssistantActivityRequestEvidence,
  type AssistantActivityContinuationIdentity,
  type AssistantContextPlanReceipt,
  type AssistantRunCapturedRequestSnapshot,
  type AssistantRun,
  type AssistantRunFailure,
  type AssistantRunPersistence,
  type AssistantRunStatus,
  type PendingModelOperation,
  type RunJournalEntry,
  type RunJournalEventType,
} from '../contracts'
import {
  buildAssistantCapabilityRevision,
  buildAssistantRequestHash,
  isAssistantCapabilityRevision,
  isAssistantRequestHash,
} from '../application/requestIdentity'
import {
  ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_HANDOFF_SCHEMA,
  ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_POLICY_SCHEMA,
  type AssistantConversationWorkspaceWritebackHandoff,
  type AssistantConversationWorkspaceWritebackPolicy,
} from '../workspaceWritebackContracts'

const MIGRATION_SCOPE = 'assistant-runtime'
const RUN_SCHEMA = 'islemind.assistant-run.v1'
const WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS = 256
const WORKSPACE_WRITEBACK_INPUT_MAX_CHARACTERS = 262_144
const WORKSPACE_WRITEBACK_MAX_SELECTED_CHARACTERS = 64
const WORKSPACE_WRITEBACK_IDEMPOTENCY_KEY_PATTERN =
  /^islemind\.chat-workspace-writeback\.v1:sha256:[0-9a-f]{64}$/

interface AssistantRunRow {
  id: string
  kind: string
  conversationId: string
  responseMessageId: string | null
  workspaceWritebackHandoffJson: string | null
  providerId: string
  model: string
  contextSnapshotId: string
  status: string
  createdAt: number
  startedAt: number | null
  cancellationRequestedAt: number | null
  completedAt: number | null
  journalSequence: number
  checkpointJson: string | null
  resultJson: string | null
  failureJson: string | null
  pendingModelOperationJson: string | null
  schema: string
}

interface RunJournalRow {
  runId: string
  sequence: number
  type: string
  occurredAt: number
  dataJson: string | null
  schema: string
}

interface AssistantRunRequestSnapshotRow {
  runId: string
  conversationId: string
  providerId: string
  model: string
  capturedAt: number
  requestJson: string
  contextReceiptJson: string | null
  capabilityRevision: string | null
  requestHash: string | null
  schema: string
}

interface AssistantConversationContextReceiptRow {
  runId: string
  capturedAt: number
  contextReceiptJson: string | null
}

interface JournalSequenceRow {
  sequence: number
}

export class AssistantRunPersistenceDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssistantRunPersistenceDataError'
  }
}

export function createSqliteAssistantRunPersistence(
  databaseProvider: SqliteDatabaseProvider,
): AssistantRunPersistence {
  let initialized: Promise<void> | undefined

  async function database() {
    const value = await databaseProvider.get()
    initialized ??= applySqliteMigrations(value, [
      {
        scope: MIGRATION_SCOPE,
        version: 1,
        name: 'assistant-runs-and-journal',
        async up(transaction) {
          await transaction.exec(`
            CREATE TABLE IF NOT EXISTS assistant_runs (
              id TEXT PRIMARY KEY NOT NULL,
              conversationId TEXT NOT NULL,
              responseMessageId TEXT,
              providerId TEXT NOT NULL,
              model TEXT NOT NULL,
              contextSnapshotId TEXT NOT NULL,
              status TEXT NOT NULL,
              createdAt INTEGER NOT NULL,
              startedAt INTEGER,
              cancellationRequestedAt INTEGER,
              completedAt INTEGER,
              journalSequence INTEGER NOT NULL,
              checkpointJson TEXT,
              resultJson TEXT,
              failureJson TEXT,
              schema TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS assistant_run_journal (
              runId TEXT NOT NULL,
              sequence INTEGER NOT NULL,
              type TEXT NOT NULL,
              occurredAt INTEGER NOT NULL,
              dataJson TEXT,
              schema TEXT NOT NULL,
              PRIMARY KEY (runId, sequence),
              FOREIGN KEY (runId) REFERENCES assistant_runs(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS assistant_runs_recoverable_idx
              ON assistant_runs (status, createdAt);
          `)
        },
      },
      {
        scope: MIGRATION_SCOPE,
        version: 2,
        name: 'assistant-run-kind',
        async up(transaction) {
          await transaction.exec(`
            ALTER TABLE assistant_runs
            ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat';
          `)
        },
      },
      {
        scope: MIGRATION_SCOPE,
        version: 3,
        name: 'pending-model-operation',
        async up(transaction) {
          await transaction.exec(`
            ALTER TABLE assistant_runs
            ADD COLUMN pendingModelOperationJson TEXT;
          `)
        },
      },
      {
        scope: MIGRATION_SCOPE,
        version: 4,
        name: 'workspace-writeback-handoff',
        async up(transaction) {
          await transaction.exec(`
            ALTER TABLE assistant_runs
            ADD COLUMN workspaceWritebackHandoffJson TEXT;
          `)
        },
      },
      {
        scope: MIGRATION_SCOPE,
        version: 5,
        name: 'chat-owned-run-kind',
        async up() {
          // Preserve the deployed migration identity without rewriting unsupported run kinds.
        },
      },
      {
        scope: MIGRATION_SCOPE,
        version: 6,
        name: 'exact-provider-neutral-request',
        async up(transaction) {
          await transaction.exec(`
            CREATE TABLE IF NOT EXISTS assistant_run_request_snapshots (
              runId TEXT PRIMARY KEY NOT NULL,
              capturedAt INTEGER NOT NULL,
              requestJson TEXT NOT NULL,
              schema TEXT NOT NULL,
              FOREIGN KEY (runId) REFERENCES assistant_runs(id) ON DELETE CASCADE
            );
          `)
        },
      },
      {
        scope: MIGRATION_SCOPE,
        version: 7,
        name: 'context-plan-receipt',
        async up(transaction) {
          await transaction.exec(`
            ALTER TABLE assistant_run_request_snapshots
            ADD COLUMN contextReceiptJson TEXT;
          `)
        },
      },
      {
        scope: MIGRATION_SCOPE,
        version: 8,
        name: 'request-identity-evidence',
        async up(transaction) {
          await transaction.exec(`
            ALTER TABLE assistant_run_request_snapshots
            ADD COLUMN capabilityRevision TEXT;
            ALTER TABLE assistant_run_request_snapshots
            ADD COLUMN requestHash TEXT;
          `)
        },
      },
    ])
    await initialized
    return value
  }

  return {
    async get(runId) {
      const row = await (await database()).getFirst<AssistantRunRow>(
        `SELECT id, kind, conversationId, responseMessageId, workspaceWritebackHandoffJson,
                providerId, model, contextSnapshotId, status, createdAt,
                startedAt, cancellationRequestedAt, completedAt, journalSequence,
                checkpointJson, resultJson, failureJson, pendingModelOperationJson, schema
         FROM assistant_runs WHERE id = ?`,
        [runId],
      )
      return row ? parseRun(row) : undefined
    },

    async listRecoverable() {
      const rows = await (await database()).getAll<AssistantRunRow>(
        `SELECT id, kind, conversationId, responseMessageId, workspaceWritebackHandoffJson,
                providerId, model, contextSnapshotId, status, createdAt,
                startedAt, cancellationRequestedAt, completedAt, journalSequence,
                checkpointJson, resultJson, failureJson, pendingModelOperationJson, schema
         FROM assistant_runs
         WHERE status IN ('queued', 'running', 'awaiting-confirmation')
         ORDER BY createdAt ASC`,
      )
      return rows.map(parseRun)
    },

    async save(run) {
      assertChatRunKind(run)
      const value = await database()
      await saveRun(value, run)
    },

    async append(entry) {
      const value = await database()
      await appendJournalEntry(value, entry)
    },

    async list(runId) {
      const rows = await (await database()).getAll<RunJournalRow>(
        `SELECT runId, sequence, type, occurredAt, dataJson, schema
         FROM assistant_run_journal WHERE runId = ? ORDER BY sequence ASC`,
        [runId],
      )
      return rows.map(parseJournalEntry)
    },

    async getRequestSnapshot(runId) {
      const row = await (await database()).getFirst<AssistantRunRequestSnapshotRow>(
        `SELECT snapshot.runId, run.conversationId, run.providerId, run.model,
                snapshot.capturedAt,
                snapshot.requestJson, snapshot.contextReceiptJson,
                snapshot.capabilityRevision, snapshot.requestHash, snapshot.schema
         FROM assistant_run_request_snapshots AS snapshot
         INNER JOIN assistant_runs AS run ON run.id = snapshot.runId
         WHERE snapshot.runId = ?`,
        [runId],
      )
      return row ? parseRequestSnapshotRow(row) : undefined
    },

    async getLatestContextReceipt(conversationId) {
      if (!isNonEmptyString(conversationId)) return undefined
      const row = await (await database()).getFirst<AssistantConversationContextReceiptRow>(
        `SELECT snapshot.runId, snapshot.capturedAt, snapshot.contextReceiptJson
         FROM assistant_run_request_snapshots AS snapshot
         INNER JOIN assistant_runs AS run ON run.id = snapshot.runId
         WHERE run.conversationId = ? AND snapshot.contextReceiptJson IS NOT NULL
         ORDER BY snapshot.capturedAt DESC, snapshot.runId DESC
         LIMIT 1`,
        [conversationId],
      )
      if (!row) return undefined
      if (!isNonEmptyString(row.runId) || !isNonNegativeInteger(row.capturedAt)) {
        throw new AssistantRunPersistenceDataError('An assistant context plan receipt is invalid.')
      }
      const receipt = parseContextReceipt(parseJson(row.contextReceiptJson ?? null))
      if (!receipt) return undefined
      return Object.freeze({
        runId: asAssistantRunId(row.runId),
        capturedAt: row.capturedAt,
        receipt: freezeJson(receipt),
      })
    },

    async clear() {
      const value = await database()
      await value.run('DELETE FROM assistant_runs')
    },

    async appendAndSave(entry, run, requestSnapshot) {
      if (entry.runId !== run.id || entry.sequence !== run.journalSequence) {
        throw new AssistantRunPersistenceDataError('Assistant run journal state is not contiguous.')
      }
      assertChatRunKind(run)
      const normalizedRequestSnapshot = requestSnapshot
        ? parseRequestSnapshotInput(requestSnapshot, entry, run)
        : undefined
      const value = await database()
      await value.transaction(async (transaction) => {
        await saveRun(transaction, run)
        if (normalizedRequestSnapshot) {
          await insertRequestSnapshot(transaction, normalizedRequestSnapshot)
        }
        const previous = await transaction.getFirst<JournalSequenceRow>(
          'SELECT sequence FROM assistant_run_journal WHERE runId = ? ORDER BY sequence DESC LIMIT 1',
          [entry.runId],
        )
        if (entry.sequence !== (previous?.sequence ?? 0) + 1) {
          throw new AssistantRunPersistenceDataError('Assistant run journal sequence is not contiguous.')
        }
        await appendJournalEntry(transaction, entry)
      })
    },
  }
}

async function insertRequestSnapshot(
  database: SqliteExecutor,
  snapshot: AssistantRunCapturedRequestSnapshot,
): Promise<void> {
  const contextReceipt = snapshot.schema === ASSISTANT_RUN_REQUEST_SNAPSHOT_SCHEMA
    ? snapshot.contextReceipt
    : undefined
  await database.run(
    `INSERT INTO assistant_run_request_snapshots (
       runId, capturedAt, requestJson, contextReceiptJson,
       capabilityRevision, requestHash, schema
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      snapshot.runId,
      snapshot.capturedAt,
      JSON.stringify(snapshot.request),
      contextReceipt ? JSON.stringify(contextReceipt) : null,
      snapshot.capabilityRevision ?? null,
      snapshot.requestHash ?? null,
      snapshot.schema,
    ],
  )
}

async function saveRun(database: SqliteExecutor, run: AssistantRun): Promise<void> {
  await database.run(
    `INSERT INTO assistant_runs (
       id, kind, conversationId, responseMessageId, workspaceWritebackHandoffJson,
       providerId, model, contextSnapshotId, status, createdAt,
       startedAt, cancellationRequestedAt, completedAt, journalSequence,
       checkpointJson, resultJson, failureJson, pendingModelOperationJson, schema
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       kind = excluded.kind,
       conversationId = excluded.conversationId,
       responseMessageId = excluded.responseMessageId,
       workspaceWritebackHandoffJson = excluded.workspaceWritebackHandoffJson,
       providerId = excluded.providerId,
       model = excluded.model,
       contextSnapshotId = excluded.contextSnapshotId,
       status = excluded.status,
       createdAt = excluded.createdAt,
       startedAt = excluded.startedAt,
       cancellationRequestedAt = excluded.cancellationRequestedAt,
       completedAt = excluded.completedAt,
       journalSequence = excluded.journalSequence,
       checkpointJson = excluded.checkpointJson,
       resultJson = excluded.resultJson,
       failureJson = excluded.failureJson,
       pendingModelOperationJson = excluded.pendingModelOperationJson,
       schema = excluded.schema`,
    [
      run.id,
      run.kind,
      run.conversationId,
      run.responseMessageId ?? null,
      run.workspaceWritebackHandoff
        ? JSON.stringify(run.workspaceWritebackHandoff)
        : null,
      run.providerId,
      run.model,
      run.contextSnapshotId,
      run.status,
      run.createdAt,
      run.startedAt ?? null,
      run.cancellationRequestedAt ?? null,
      run.completedAt ?? null,
      run.journalSequence,
      run.checkpoint ? JSON.stringify(run.checkpoint) : null,
      run.result ? JSON.stringify(run.result) : null,
      run.failure ? JSON.stringify(run.failure) : null,
      run.pendingModelOperation ? JSON.stringify(run.pendingModelOperation) : null,
      RUN_SCHEMA,
    ],
  )
}

function assertChatRunKind(run: AssistantRun): void {
  if (run.kind !== 'chat') {
    throw new AssistantRunPersistenceDataError('An assistant run kind is invalid.')
  }
}

async function appendJournalEntry(database: SqliteExecutor, entry: RunJournalEntry): Promise<void> {
  await database.run(
    `INSERT INTO assistant_run_journal (runId, sequence, type, occurredAt, dataJson, schema)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      entry.runId,
      entry.sequence,
      entry.type,
      entry.occurredAt,
      entry.data ? JSON.stringify(entry.data) : null,
      entry.schema,
    ],
  )
}

function parseRun(row: AssistantRunRow): AssistantRun {
  const kind = parseRunKind(row.kind)
  if (row.schema !== RUN_SCHEMA || !isNonEmptyString(row.id) || !isNonEmptyString(row.conversationId) ||
    !isNonEmptyString(row.providerId) || !isNonEmptyString(row.model) || !isNonEmptyString(row.contextSnapshotId) ||
    !isRunStatus(row.status) || !isNonNegativeInteger(row.createdAt) || !isNonNegativeInteger(row.journalSequence)) {
    throw new AssistantRunPersistenceDataError('An assistant run record is invalid.')
  }

  const checkpoint = parseCheckpoint(row.checkpointJson)
  const result = parseResult(row.resultJson)
  const failure = parseFailure(row.failureJson)
  const pendingModelOperation = parsePendingModelOperation(row.pendingModelOperationJson, row.id)
  const startedAt = parseOptionalTimestamp(row.startedAt)
  const cancellationRequestedAt = parseOptionalTimestamp(row.cancellationRequestedAt)
  const completedAt = parseOptionalTimestamp(row.completedAt)
  const responseMessageId = parseOptionalId(row.responseMessageId)
  const workspaceWritebackHandoff = parseWorkspaceWritebackHandoff(
    row.workspaceWritebackHandoffJson,
    row.id,
    row.conversationId,
    responseMessageId,
  )

  if (row.status === 'succeeded' && (!result || completedAt === undefined)) {
    throw new AssistantRunPersistenceDataError('A completed assistant run is missing its result.')
  }
  if (row.status === 'failed' && (!failure || completedAt === undefined)) {
    throw new AssistantRunPersistenceDataError('A failed assistant run is missing its failure record.')
  }
  if (row.status === 'cancelled' && completedAt === undefined) {
    throw new AssistantRunPersistenceDataError('A cancelled assistant run is missing its completion time.')
  }
  if ((row.status === 'awaiting-confirmation') !== Boolean(pendingModelOperation)) {
    throw new AssistantRunPersistenceDataError('An assistant run has inconsistent pending model-operation state.')
  }

  return {
    id: asAssistantRunId(row.id),
    kind,
    conversationId: row.conversationId,
    ...(responseMessageId ? { responseMessageId } : {}),
    ...(workspaceWritebackHandoff ? { workspaceWritebackHandoff } : {}),
    providerId: row.providerId,
    model: row.model,
    contextSnapshotId: asContextSnapshotId(row.contextSnapshotId),
    status: row.status,
    createdAt: row.createdAt,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(cancellationRequestedAt === undefined ? {} : { cancellationRequestedAt }),
    ...(completedAt === undefined ? {} : { completedAt }),
    journalSequence: row.journalSequence,
    ...(checkpoint ? { checkpoint } : {}),
    ...(pendingModelOperation ? { pendingModelOperation } : {}),
    ...(result ? { result } : {}),
    ...(failure ? { failure } : {}),
  }
}

function parseJournalEntry(row: RunJournalRow): RunJournalEntry {
  if (row.schema !== 'islemind.assistant-run-journal-entry.v1' || !isNonEmptyString(row.runId) ||
    !isNonNegativeInteger(row.sequence) || row.sequence < 1 || !isRunJournalEventType(row.type) ||
    !isNonNegativeInteger(row.occurredAt)) {
    throw new AssistantRunPersistenceDataError('An assistant run journal record is invalid.')
  }

  const data = parseJsonRecord(row.dataJson)
  return {
    schema: row.schema,
    runId: asAssistantRunId(row.runId),
    sequence: row.sequence,
    type: row.type,
    occurredAt: row.occurredAt,
    ...(data ? { data } : {}),
  }
}

function parseRequestSnapshotInput(
  value: AssistantRunCapturedRequestSnapshot,
  entry: RunJournalEntry,
  run: AssistantRun,
): AssistantRunCapturedRequestSnapshot {
  if (entry.type !== 'run.created' || entry.sequence !== 1 || value.runId !== entry.runId ||
    value.capturedAt !== entry.occurredAt || value.request.conversationId !== run.conversationId ||
    value.request.providerId !== run.providerId || value.request.model !== run.model) {
    throw new AssistantRunPersistenceDataError('An assistant run request snapshot is invalid.')
  }
  if (value.schema === ASSISTANT_RUN_REQUEST_SNAPSHOT_SCHEMA && isChatRequest(value.request)) {
    const contextReceipt = parseContextReceipt(value.contextReceipt)
    assertRequestIdentity(value.capabilityRevision, value.requestHash, value.request)
    return {
      schema: ASSISTANT_RUN_REQUEST_SNAPSHOT_SCHEMA,
      runId: value.runId,
      capturedAt: value.capturedAt,
      request: cloneRequest(value.request),
      ...(value.capabilityRevision ? { capabilityRevision: value.capabilityRevision } : {}),
      ...(value.requestHash ? { requestHash: value.requestHash } : {}),
      ...(contextReceipt ? { contextReceipt } : {}),
    }
  }
  if (value.schema === ASSISTANT_RUN_ACTIVITY_REQUEST_SNAPSHOT_SCHEMA &&
    isAssistantActivityRequestEvidence(value.request)) {
    assertRequestIdentity(
      value.capabilityRevision,
      value.requestHash,
      value.request,
      value.request.payload,
    )
    return {
      schema: ASSISTANT_RUN_ACTIVITY_REQUEST_SNAPSHOT_SCHEMA,
      runId: value.runId,
      capturedAt: value.capturedAt,
      request: cloneActivityRequestEvidence(value.request),
      ...(value.capabilityRevision ? { capabilityRevision: value.capabilityRevision } : {}),
      ...(value.requestHash ? { requestHash: value.requestHash } : {}),
    }
  }
  throw new AssistantRunPersistenceDataError('An assistant run request snapshot is invalid.')
}

function parseRequestSnapshotRow(
  row: AssistantRunRequestSnapshotRow,
): AssistantRunCapturedRequestSnapshot {
  if (!isNonEmptyString(row.runId) || !isNonEmptyString(row.conversationId) ||
    !isNonEmptyString(row.providerId) || !isNonEmptyString(row.model) ||
    !isNonNegativeInteger(row.capturedAt)) {
    throw new AssistantRunPersistenceDataError('An assistant run request snapshot is invalid.')
  }
  const request = parseJson(row.requestJson)
  const contextReceipt = parseContextReceipt(parseJson(row.contextReceiptJson ?? null))
  if (row.schema === ASSISTANT_RUN_REQUEST_SNAPSHOT_SCHEMA && isChatRequest(request) &&
    request.conversationId === row.conversationId && request.providerId === row.providerId &&
    request.model === row.model) {
    assertRequestIdentity(row.capabilityRevision ?? undefined, row.requestHash ?? undefined, request)
    return Object.freeze({
      schema: ASSISTANT_RUN_REQUEST_SNAPSHOT_SCHEMA,
      runId: asAssistantRunId(row.runId),
      capturedAt: row.capturedAt,
      request: cloneRequest(request),
      ...(row.capabilityRevision ? { capabilityRevision: row.capabilityRevision } : {}),
      ...(row.requestHash ? { requestHash: row.requestHash } : {}),
      ...(contextReceipt ? { contextReceipt: freezeJson(contextReceipt) } : {}),
    })
  }
  if (row.schema === ASSISTANT_RUN_ACTIVITY_REQUEST_SNAPSHOT_SCHEMA &&
    isAssistantActivityRequestEvidence(request) && request.conversationId === row.conversationId &&
    request.providerId === row.providerId && request.model === row.model) {
    if (contextReceipt !== undefined) {
      throw new AssistantRunPersistenceDataError('An assistant run request snapshot is invalid.')
    }
    assertRequestIdentity(
      row.capabilityRevision ?? undefined,
      row.requestHash ?? undefined,
      request,
      request.payload,
    )
    return Object.freeze({
      schema: ASSISTANT_RUN_ACTIVITY_REQUEST_SNAPSHOT_SCHEMA,
      runId: asAssistantRunId(row.runId),
      capturedAt: row.capturedAt,
      request: freezeJson(request),
      ...(row.capabilityRevision ? { capabilityRevision: row.capabilityRevision } : {}),
      ...(row.requestHash ? { requestHash: row.requestHash } : {}),
    })
  }
  throw new AssistantRunPersistenceDataError('An assistant run request snapshot is invalid.')
}

function isAssistantActivityRequestEvidence(
  value: unknown,
): value is AssistantActivityRequestEvidence {
  if (!isRecord(value) || !hasExactKeys(value, [
    'schema',
    'conversationId',
    'providerId',
    'model',
    'payload',
    'redactedFields',
  ], ['contextReceipt'])) return false
  if (value.schema !== ASSISTANT_ACTIVITY_REQUEST_EVIDENCE_SCHEMA ||
    !isBoundedString(value.conversationId, 320) || !isBoundedString(value.providerId, 320) ||
    !isBoundedString(value.model, 320) || !isJsonRecord(value.payload) ||
    !Array.isArray(value.redactedFields) || value.redactedFields.length > 512 ||
    !value.redactedFields.every((field) => isBoundedString(field, 512)) ||
    (value.contextReceipt !== undefined && !isAssistantContextPlanReceipt(value.contextReceipt))) {
    return false
  }
  try {
    return JSON.stringify(value).length <= 4 * 1024 * 1024
  } catch {
    return false
  }
}

function assertRequestIdentity(
  capabilityRevision: unknown,
  requestHash: unknown,
  request: unknown,
  capabilityInput = request,
): void {
  if (capabilityRevision !== undefined && !isAssistantCapabilityRevision(capabilityRevision)) {
    throw new AssistantRunPersistenceDataError('An assistant capability revision is invalid.')
  }
  if (requestHash !== undefined && !isAssistantRequestHash(requestHash)) {
    throw new AssistantRunPersistenceDataError('An assistant request hash is invalid.')
  }
  if ((capabilityRevision === undefined) !== (requestHash === undefined)) {
    throw new AssistantRunPersistenceDataError('Assistant request identity evidence is incomplete.')
  }
  if (capabilityRevision === undefined || requestHash === undefined) return
  if (requestHash !== buildAssistantRequestHash(request)) {
    throw new AssistantRunPersistenceDataError('An assistant request hash does not match its request evidence.')
  }
  if (capabilityRevision !== buildAssistantCapabilityRevision(capabilityInput)) {
    throw new AssistantRunPersistenceDataError('An assistant capability revision does not match its request evidence.')
  }
}

function cloneActivityRequestEvidence(
  value: AssistantActivityRequestEvidence,
): AssistantActivityRequestEvidence {
  try {
    const cloned = JSON.parse(JSON.stringify(value))
    if (!isAssistantActivityRequestEvidence(cloned)) throw new Error('invalid')
    return freezeJson(cloned)
  } catch {
    throw new AssistantRunPersistenceDataError('An assistant run request snapshot is invalid.')
  }
}

function parseContextReceipt(value: unknown): AssistantContextPlanReceipt | undefined {
  if (value === undefined || value === null) return undefined
  if (!isAssistantContextPlanReceipt(value)) {
    throw new AssistantRunPersistenceDataError('An assistant context plan receipt is invalid.')
  }
  try {
    return cloneAssistantContextPlanReceipt(value)
  } catch {
    throw new AssistantRunPersistenceDataError('An assistant context plan receipt is invalid.')
  }
}

function parseCheckpoint(value: string | null) {
  const parsed = parseJson(value)
  if (parsed === undefined) return undefined
  if (!isRecord(parsed) || !isNonNegativeInteger(parsed.streamEventCount) || typeof parsed.outputText !== 'string') {
    throw new AssistantRunPersistenceDataError('An assistant run checkpoint is invalid.')
  }
  return { outputText: parsed.outputText, streamEventCount: parsed.streamEventCount }
}

function parseResult(value: string | null) {
  const parsed = parseJson(value)
  if (parsed === undefined) return undefined
  if (!isRecord(parsed) || !isNonNegativeInteger(parsed.streamEventCount) || typeof parsed.outputText !== 'string') {
    throw new AssistantRunPersistenceDataError('An assistant run result is invalid.')
  }
  return { outputText: parsed.outputText, streamEventCount: parsed.streamEventCount }
}

function parseFailure(value: string | null): AssistantRunFailure | undefined {
  const parsed = parseJson(value)
  if (parsed === undefined) return undefined
  if (!isRecord(parsed) || typeof parsed.code !== 'string' || typeof parsed.message !== 'string' ||
    !isFailureCode(parsed.code)) {
    throw new AssistantRunPersistenceDataError('An assistant run failure is invalid.')
  }
  const continuation = parsed.continuation === undefined
    ? undefined
    : parseContinuationIdentity(parsed.continuation)
  return {
    code: parsed.code,
    message: parsed.message,
    ...(continuation ? { continuation } : {}),
  }
}

function parseContinuationIdentity(value: unknown): AssistantActivityContinuationIdentity {
  if (!isRecord(value) || !hasExactKeys(value, [
    'schema',
    'id',
    'phase',
    'providerId',
    'model',
    'requestHash',
    'stepIndex',
    'mode',
    'resume',
  ]) || value.schema !== ASSISTANT_ACTIVITY_CONTINUATION_IDENTITY_SCHEMA ||
    value.phase !== 'provider-turn' || value.resume !== 'new-turn-only' ||
    (value.mode !== 'native' && value.mode !== 'structured') ||
    !isBoundedString(value.id, 512) || !isBoundedString(value.providerId, 512) ||
    !isBoundedString(value.model, 512) || !isAssistantRequestHash(value.requestHash) ||
    !isNonNegativeInteger(value.stepIndex) || value.stepIndex > 1_000_000) {
    throw new AssistantRunPersistenceDataError('An assistant run continuation identity is invalid.')
  }
  return Object.freeze({
    schema: ASSISTANT_ACTIVITY_CONTINUATION_IDENTITY_SCHEMA,
    id: value.id,
    phase: 'provider-turn',
    providerId: value.providerId,
    model: value.model,
    requestHash: value.requestHash,
    stepIndex: value.stepIndex,
    mode: value.mode,
    resume: 'new-turn-only',
  })
}

function parsePendingModelOperation(
  value: string | null,
  expectedRunId: string,
): PendingModelOperation | undefined {
  const parsed = parseJson(value)
  if (parsed === undefined) return undefined
  if (!isRecord(parsed) || parsed.schema !== 'islemind.pending-model-operation.v1' ||
    parsed.runId !== expectedRunId || !isBoundedString(parsed.callId, 320) ||
    !isBoundedString(parsed.operationId, 160) || !isBoundedString(parsed.catalogRevision, 320) ||
    !isBoundedString(parsed.argumentDigest, 256) || !isBoundedString(parsed.idempotencyKey, 512) ||
    !isBoundedString(parsed.continuationToken, 512) || !isNonNegativeInteger(parsed.stepIndex) ||
    !isNonNegativeInteger(parsed.maxSteps) || parsed.maxSteps < 1 ||
    !isNonNegativeInteger(parsed.requestedAt) || !isChatRequest(parsed.continuationRequest) ||
    (parsed.continuationMode !== 'native' && parsed.continuationMode !== 'structured') ||
    typeof parsed.continuationOutputText !== 'string' || parsed.continuationOutputText.length > 131_072 ||
    !isJsonRecord(parsed.continuationState) || !isBoundedString(parsed.continuationDigest, 256)) {
    throw new AssistantRunPersistenceDataError('A pending model-operation record is invalid.')
  }
  return {
    schema: PENDING_MODEL_OPERATION_SCHEMA,
    runId: asAssistantRunId(parsed.runId),
    callId: parsed.callId,
    operationId: parsed.operationId,
    catalogRevision: parsed.catalogRevision,
    argumentDigest: parsed.argumentDigest,
    idempotencyKey: parsed.idempotencyKey,
    continuationToken: parsed.continuationToken,
    stepIndex: parsed.stepIndex,
    maxSteps: parsed.maxSteps,
    requestedAt: parsed.requestedAt,
    continuationRequest: cloneRequest(parsed.continuationRequest),
    continuationMode: parsed.continuationMode,
    continuationOutputText: parsed.continuationOutputText,
    continuationState: freezeJson(parsed.continuationState),
    continuationDigest: parsed.continuationDigest,
  }
}

function parseWorkspaceWritebackHandoff(
  value: string | null,
  expectedRunId: string,
  expectedConversationId: string,
  expectedAssistantMessageId: string | undefined,
): AssistantConversationWorkspaceWritebackHandoff | undefined {
  const parsed = parseJson(value)
  if (parsed === undefined) return undefined
  if (
    !isRecord(parsed)
    || !hasExactKeys(parsed, [
      'schema',
      'assistantRunId',
      'conversationId',
      'assistantMessageId',
      'workspaceId',
      'repositoryAuthorityRevision',
      'latestUserInput',
      'orderedCharacterIds',
      'policy',
      'occurredAt',
      'idempotencyKey',
    ], ['selectedSceneId'])
    || parsed.schema !== ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_HANDOFF_SCHEMA
    || !isBoundedWorkspaceWritebackIdentity(parsed.assistantRunId)
    || !isBoundedWorkspaceWritebackIdentity(parsed.conversationId)
    || !isBoundedWorkspaceWritebackIdentity(parsed.assistantMessageId)
    || !isBoundedWorkspaceWritebackIdentity(parsed.workspaceId)
    || !isNonNegativeInteger(parsed.repositoryAuthorityRevision)
    || typeof parsed.latestUserInput !== 'string'
    || parsed.latestUserInput.length > WORKSPACE_WRITEBACK_INPUT_MAX_CHARACTERS
    || !isNonNegativeInteger(parsed.occurredAt)
    || typeof parsed.idempotencyKey !== 'string'
    || !WORKSPACE_WRITEBACK_IDEMPOTENCY_KEY_PATTERN.test(parsed.idempotencyKey)
  ) {
    throw new AssistantRunPersistenceDataError('An assistant run workspace writeback handoff is invalid.')
  }

  const selectedSceneId = parsed.selectedSceneId === undefined
    ? undefined
    : parseWorkspaceWritebackIdentity(parsed.selectedSceneId)
  const orderedCharacterIds = parseWorkspaceWritebackCharacterIds(parsed.orderedCharacterIds)
  const policy = parseWorkspaceWritebackPolicy(parsed.policy)
  if (
    (parsed.selectedSceneId !== undefined && selectedSceneId === undefined)
    || orderedCharacterIds === undefined
    || policy === undefined
    || parsed.assistantRunId !== expectedRunId
    || parsed.conversationId !== expectedConversationId
    || parsed.assistantMessageId !== expectedAssistantMessageId
  ) {
    throw new AssistantRunPersistenceDataError('An assistant run workspace writeback handoff is invalid.')
  }

  return Object.freeze({
    schema: ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_HANDOFF_SCHEMA,
    assistantRunId: asAssistantRunId(parsed.assistantRunId),
    conversationId: parsed.conversationId,
    assistantMessageId: parsed.assistantMessageId,
    workspaceId: parsed.workspaceId,
    repositoryAuthorityRevision: parsed.repositoryAuthorityRevision,
    latestUserInput: parsed.latestUserInput,
    ...(selectedSceneId ? { selectedSceneId } : {}),
    orderedCharacterIds,
    policy,
    occurredAt: parsed.occurredAt,
    idempotencyKey: parsed.idempotencyKey,
  })
}

function parseWorkspaceWritebackPolicy(
  value: unknown,
): AssistantConversationWorkspaceWritebackPolicy | undefined {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      'schema',
      'summary',
      'characterUpdates',
      'lorebookUpdates',
      'relationshipMemoryUpdates',
      'sceneUpdates',
    ])
    || value.schema !== ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_POLICY_SCHEMA
    || value.summary !== 'commit'
    || value.characterUpdates !== 'review'
    || value.lorebookUpdates !== 'review'
    || value.relationshipMemoryUpdates !== 'review'
    || value.sceneUpdates !== 'review'
  ) {
    return undefined
  }
  return Object.freeze({
    schema: ASSISTANT_CONVERSATION_WORKSPACE_WRITEBACK_POLICY_SCHEMA,
    summary: 'commit',
    characterUpdates: 'review',
    lorebookUpdates: 'review',
    relationshipMemoryUpdates: 'review',
    sceneUpdates: 'review',
  })
}

function parseWorkspaceWritebackCharacterIds(
  value: unknown,
): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > WORKSPACE_WRITEBACK_MAX_SELECTED_CHARACTERS) {
    return undefined
  }
  const result: string[] = []
  const seen = new Set<string>()
  for (const candidate of value) {
    const characterId = parseWorkspaceWritebackIdentity(candidate)
    if (!characterId || seen.has(characterId)) return undefined
    seen.add(characterId)
    result.push(characterId)
  }
  return Object.freeze(result)
}

function parseWorkspaceWritebackIdentity(value: unknown): string | undefined {
  return isBoundedWorkspaceWritebackIdentity(value) ? value : undefined
}

function isBoundedWorkspaceWritebackIdentity(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS
    && value.trim().length > 0
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value)
  if (keys.length < required.length || keys.length > required.length + optional.length) return false
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && keys.every((key) => allowed.has(key))
}

function parseJsonRecord(value: string | null): JsonRecord | undefined {
  const parsed = parseJson(value)
  if (parsed === undefined) return undefined
  if (!isJsonRecord(parsed)) throw new AssistantRunPersistenceDataError('Assistant run journal data is invalid.')
  return parsed
}

function parseJson(value: string | null): unknown {
  if (value === null) return undefined
  try {
    return JSON.parse(value)
  } catch {
    throw new AssistantRunPersistenceDataError('An assistant run JSON envelope is invalid.')
  }
}

function isRunStatus(value: string): value is AssistantRunStatus {
  return value === 'queued' || value === 'running' || value === 'awaiting-confirmation' ||
    value === 'succeeded' || value === 'failed' || value === 'cancelled'
}

function parseRunKind(value: string): AssistantRun['kind'] {
  if (value === 'chat') return 'chat'
  throw new AssistantRunPersistenceDataError('An assistant run kind is invalid.')
}

function isRunJournalEventType(value: string): value is RunJournalEventType {
  return value === 'run.created' || value === 'run.started' || value === 'stream.event' ||
    value === 'provider.route-selected' || value === 'provider-continuation.started' ||
    value === 'provider-continuation.completed' || value === 'model-operation.selected' ||
    value === 'run.awaiting-confirmation' || value === 'run.confirmation-resolved' ||
    value === 'run.cancellation-requested' || value === 'run.succeeded' || value === 'run.failed' ||
    value === 'run.cancelled'
}

function isFailureCode(value: string): value is AssistantRunFailure['code'] {
  return value === 'cancelled' || value === 'interrupted' || value === 'output_limit_exceeded' || value === 'provider_failed' ||
    value === 'activity_failed'
}

function parseOptionalTimestamp(value: number | null): number | undefined {
  if (value === null) return undefined
  if (!isNonNegativeInteger(value)) throw new AssistantRunPersistenceDataError('An assistant run timestamp is invalid.')
  return value
}

function parseOptionalId(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined
  if (!isNonEmptyString(value)) throw new AssistantRunPersistenceDataError('An assistant run message identifier is invalid.')
  return value
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isBoundedString(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isJsonRecord(value: unknown): value is JsonRecord {
  if (!isRecord(value)) return false
  return Object.values(value).every(isJsonValue)
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isJsonRecord(value)
}

function freezeJson<Value>(value: Value): Value {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) freezeJson(child)
  return Object.freeze(value)
}

function cloneRequest(value: ChatRequest): ChatRequest {
  try {
    return freezeChatRequest(value)
  } catch {
    throw new AssistantRunPersistenceDataError('An assistant run request snapshot is invalid.')
  }
}
