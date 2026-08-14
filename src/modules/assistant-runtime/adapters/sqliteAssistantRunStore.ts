import { asAssistantRunId, asContextSnapshotId, type JsonRecord } from '@/core'
import {
  applySqliteMigrations,
  type SqliteDatabaseProvider,
  type SqliteExecutor,
} from '@/platform/storage'
import type {
  AssistantRun,
  AssistantRunFailure,
  AssistantRunPersistence,
  AssistantRunStatus,
  PendingModelOperation,
  RunJournalEntry,
  RunJournalEventType,
} from '../contracts'
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

    async appendAndSave(entry, run) {
      if (entry.runId !== run.id || entry.sequence !== run.journalSequence) {
        throw new AssistantRunPersistenceDataError('Assistant run journal state is not contiguous.')
      }
      assertChatRunKind(run)
      const value = await database()
      await value.transaction(async (transaction) => {
        await saveRun(transaction, run)
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
  return { code: parsed.code, message: parsed.message }
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
  return parsed as unknown as PendingModelOperation
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
    value === 'provider.route-selected' || value === 'model-operation.selected' ||
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

function isChatRequest(value: unknown): boolean {
  if (!isRecord(value) || value.schema !== 'islemind.chat-request.v1' ||
    !isBoundedString(value.conversationId, 320) || !isBoundedString(value.providerId, 320) ||
    !isBoundedString(value.model, 320) || !Array.isArray(value.messages) || value.messages.length > 512 ||
    !value.messages.every(isChatMessageInput)) {
    return false
  }
  if (value.systemPrompt !== undefined && (typeof value.systemPrompt !== 'string' || value.systemPrompt.length > 262_144)) {
    return false
  }
  for (const key of ['temperature', 'topP', 'topK', 'maxTokens']) {
    const candidate = value[key]
    if (candidate !== undefined && (typeof candidate !== 'number' || !Number.isFinite(candidate))) return false
  }
  if (value.requestedCapabilities !== undefined &&
    (!Array.isArray(value.requestedCapabilities) || value.requestedCapabilities.length > 64 ||
      !value.requestedCapabilities.every((candidate) => isBoundedString(candidate, 128)))) {
    return false
  }
  return value.toolDefinitions === undefined || (
    Array.isArray(value.toolDefinitions) && value.toolDefinitions.length <= 64 &&
    value.toolDefinitions.every(isChatToolDefinition)
  )
}

function isChatMessageInput(value: unknown): boolean {
  if (!isRecord(value) || !isBoundedString(value.id, 320) || typeof value.text !== 'string' ||
    value.text.length > 262_144 ||
    (value.role !== 'system' && value.role !== 'user' && value.role !== 'assistant' && value.role !== 'tool')) {
    return false
  }
  if (value.toolCallId !== undefined && !isBoundedString(value.toolCallId, 320)) return false
  if (value.name !== undefined && !isBoundedString(value.name, 320)) return false
  return value.toolCalls === undefined || (
    Array.isArray(value.toolCalls) && value.toolCalls.length <= 64 && value.toolCalls.every((call) =>
      isRecord(call) && isBoundedString(call.callId, 320) && isBoundedString(call.name, 320) &&
      isJsonRecord(call.arguments) &&
      (call.providerMetadata === undefined || isJsonRecord(call.providerMetadata)))
  )
}

function isChatToolDefinition(value: unknown): boolean {
  return isRecord(value) && isBoundedString(value.operationId, 160) && isBoundedString(value.name, 160) &&
    typeof value.description === 'string' && value.description.length <= 2_048 && isJsonRecord(value.inputSchema) &&
    (value.permission === 'read-only' || value.permission === 'read-write' || value.permission === 'destructive')
}
