import { err, ok, type AssistantRunId, type Result } from '@/core'
import {
  WORKFLOW_CHECKPOINT_JOURNAL_SCHEMA,
  WORKFLOW_CHECKPOINT_LIMITS,
  WORKFLOW_CHECKPOINT_SCHEMA,
  parseWorkflowCheckpoint,
  parseWorkflowCheckpointJournalEntry,
  validateWorkflowCheckpointJournalSnapshot,
  validateWorkflowCheckpointTransition,
  type AppendWorkflowCheckpointInput,
  type RecoveredWorkflowCheckpointRecord,
  type WorkflowCheckpoint,
  type WorkflowCheckpointJournalEntry,
  type WorkflowCheckpointPersistenceErrorCode,
  type WorkflowCheckpointRepository,
} from '../application/workflowCheckpoint'

export type WorkflowCheckpointDatabaseValue = string | number | null | Uint8Array

export interface WorkflowCheckpointDatabaseRunResult {
  changes: number
  lastInsertRowId: number
}

/**
 * Cancellation-aware database boundary required by checkpoint persistence.
 * Implementations receive the exact signal supplied by the application caller.
 */
export interface WorkflowCheckpointDatabaseExecutor {
  exec(source: string, signal: AbortSignal): Promise<void>
  run(
    source: string,
    parameters: readonly WorkflowCheckpointDatabaseValue[],
    signal: AbortSignal,
  ): Promise<WorkflowCheckpointDatabaseRunResult>
  getFirst<Row extends object>(
    source: string,
    parameters: readonly WorkflowCheckpointDatabaseValue[],
    signal: AbortSignal,
  ): Promise<Row | null>
  getAll<Row extends object>(
    source: string,
    parameters: readonly WorkflowCheckpointDatabaseValue[],
    signal: AbortSignal,
  ): Promise<readonly Row[]>
}

export interface WorkflowCheckpointDatabase extends WorkflowCheckpointDatabaseExecutor {
  transaction<Value>(
    signal: AbortSignal,
    work: (transaction: WorkflowCheckpointDatabaseExecutor) => Promise<Value>,
  ): Promise<Value>
}

export interface WorkflowCheckpointDatabaseProvider {
  get(signal: AbortSignal): Promise<WorkflowCheckpointDatabase>
}

const CHECKPOINT_ROW_SCHEMA = 'islemind.workflow-checkpoint-row.v2'
const JOURNAL_ROW_SCHEMA = 'islemind.workflow-checkpoint-journal-row.v2'
const STORAGE_SCHEMA = 'islemind.workflow-checkpoint-storage.v2'
const STORAGE_VERSION = 2

const LEGACY_CHECKPOINT_SCHEMA = 'islemind.agent-workflow-checkpoint.v1'
const LEGACY_JOURNAL_SCHEMA = 'islemind.agent-workflow-checkpoint-journal.v1'
const LEGACY_CHECKPOINT_ROW_SCHEMA = 'islemind.agent-workflow-checkpoint-row.v1'
const LEGACY_JOURNAL_ROW_SCHEMA = 'islemind.agent-workflow-checkpoint-journal-row.v1'

const CHECKPOINT_TABLE = 'workflow_checkpoints'
const JOURNAL_TABLE = 'workflow_checkpoint_journal'
const STORAGE_TABLE = 'workflow_checkpoint_storage'
const LEGACY_CHECKPOINT_TABLE = 'agent_workflow_checkpoints'
const LEGACY_JOURNAL_TABLE = 'agent_workflow_checkpoint_journal'

interface CheckpointRow {
  runId: string
  revision: number
  journalSequence: number
  updatedAt: number
  checkpointJson: string
  schema: string
}

interface CheckpointJournalRow {
  runId: string
  sequence: number
  revision: number
  type: string
  occurredAt: number
  entryJson: string
  checkpointJson: string
  schema: string
}

interface StorageRow {
  id: number
  schema: string
  version: number
}

interface SqliteTableRow {
  name: string
  type: string
}

interface JournalSnapshot {
  entry: WorkflowCheckpointJournalEntry
  checkpoint: WorkflowCheckpoint
}

interface DurableRunRecords {
  checkpoint: WorkflowCheckpoint
  journal: readonly JournalSnapshot[]
}

type DurableDataset = ReadonlyMap<AssistantRunId, DurableRunRecords>
type PersistenceFormat = 'legacy-v1' | 'target-v2'

interface StorageInitialization {
  committedStateChange: boolean
  dataset?: DurableDataset
}

export function createSqliteWorkflowCheckpointRepository(
  databaseProvider: WorkflowCheckpointDatabaseProvider,
): WorkflowCheckpointRepository {
  return {
    async load(runId, signal) {
      if (signal.aborted) return cancelledResult()
      if (!isRunId(runId)) return invalidRecord('Assistant run ID is invalid.')
      try {
        const database = await databaseProvider.get(signal)
        if (signal.aborted) return cancelledResult()
        const initialization = await initializeStorage(database, signal)
        if (signal.aborted && initialization.committedStateChange) {
          return ok(initialization.dataset?.get(runId)?.checkpoint)
        }
        const currentRow = await database.getFirst<CheckpointRow>(checkpointSelectSql, [runId], signal)
        const latestJournalRow = await database.getFirst<CheckpointJournalRow>(journalLatestSelectSql, [runId], signal)
        const current = validateCurrentPair(runId, currentRow, latestJournalRow)
        return current.ok ? ok(current.value) : corruption(current.message)
      } catch (error) {
        return operationFailure(error, signal)
      }
    },

    async appendAndSave(input) {
      if (input.signal.aborted) return cancelledResult()
      const normalized = normalizeWrite(input)
      if (!normalized.ok) return normalized

      try {
        const database = await databaseProvider.get(input.signal)
        if (input.signal.aborted) return cancelledResult()
        await initializeStorage(database, input.signal)
        return await database.transaction(input.signal, async (transaction) => {
          if (input.signal.aborted) return cancelledResult()
          const runId = normalized.value.checkpoint.runId
          const currentRow = await transaction.getFirst<CheckpointRow>(checkpointSelectSql, [runId], input.signal)
          const latestJournalRow = await transaction.getFirst<CheckpointJournalRow>(
            journalLatestSelectSql,
            [runId],
            input.signal,
          )
          const current = validateCurrentPair(runId, currentRow, latestJournalRow)
          if (!current.ok) return corruption(current.message)
          const actualRevision = current.value?.revision ?? 0
          if (actualRevision !== normalized.value.expectedRevision) {
            return conflict(normalized.value.expectedRevision, actualRevision)
          }
          const transition = validateWorkflowCheckpointTransition(
            current.value,
            normalized.value.checkpoint,
            normalized.value.entry,
          )
          if (!transition.ok) return invalidRecord(transition.error.message)
          if (input.signal.aborted) return cancelledResult()

          const saved = current.value
            ? await updateCheckpoint(transaction, normalized.value, input.signal)
            : await insertCheckpoint(transaction, normalized.value.checkpoint, input.signal)
          if (saved.changes !== 1) return conflict(normalized.value.expectedRevision, actualRevision)
          const appended = await insertJournalEntry(
            transaction,
            normalized.value.checkpoint,
            normalized.value.entry,
            input.signal,
          )
          if (appended.changes !== 1) {
            throw new Error('Checkpoint journal append did not write exactly one record.')
          }
          await pruneCheckpointJournal(
            transaction,
            normalized.value.checkpoint.runId,
            normalized.value.checkpoint.journalSequence,
            input.signal,
          )
          return ok(normalized.value.checkpoint)
        })
      } catch (error) {
        return operationFailure(error, input.signal)
      }
    },

    async recover(runId, signal) {
      if (signal.aborted) return cancelledResult()
      if (!isRunId(runId)) return invalidRecord('Assistant run ID is invalid.')
      try {
        const database = await databaseProvider.get(signal)
        if (signal.aborted) return cancelledResult()
        const initialization = await initializeStorage(database, signal)
        if (signal.aborted && initialization.committedStateChange) {
          const checkpoint = initialization.dataset?.get(runId)?.checkpoint
          return ok(checkpoint ? { checkpoint, source: 'current' } : undefined)
        }
        const currentRow = await database.getFirst<CheckpointRow>(checkpointSelectSql, [runId], signal)
        if (signal.aborted) return cancelledResult()
        const journalRowsDescending = await database.getAll<CheckpointJournalRow>(
          journalTailSelectSql,
          [runId, WORKFLOW_CHECKPOINT_LIMITS.journalSnapshots],
          signal,
        )
        const journalRows = [...journalRowsDescending].reverse()
        return recoverLastSafeCheckpoint(runId, currentRow, journalRows)
      } catch (error) {
        return operationFailure(error, signal)
      }
    },
  }
}

async function initializeStorage(
  database: WorkflowCheckpointDatabase,
  signal: AbortSignal,
): Promise<StorageInitialization> {
  return database.transaction(signal, async (transaction) => {
    if (signal.aborted) throw abortError()
    const discoveredRows = await transaction.getAll<SqliteTableRow>(
      tableDiscoverySql,
      [STORAGE_TABLE, CHECKPOINT_TABLE, JOURNAL_TABLE, LEGACY_CHECKPOINT_TABLE, LEGACY_JOURNAL_TABLE],
      signal,
    )
    const discovered = parseDiscoveredTables(discoveredRows)
    if (!discovered.ok) throw corruptionError(discovered.message)

    await transaction.exec(createTargetSchemaSql, signal)
    const storageRows = await transaction.getAll<StorageRow>(storageSelectSql, [], signal)
    const storage = parseStorageRows(storageRows)
    if (!storage.ok) throw corruptionError(storage.message)

    const hadStorageTable = discovered.value.has(STORAGE_TABLE)
    const hadCheckpointTable = discovered.value.has(CHECKPOINT_TABLE)
    const hadJournalTable = discovered.value.has(JOURNAL_TABLE)
    const hadLegacyCheckpointTable = discovered.value.has(LEGACY_CHECKPOINT_TABLE)
    const hadLegacyJournalTable = discovered.value.has(LEGACY_JOURNAL_TABLE)

    if (storage.value === 'ready') {
      if (!hadStorageTable || !hadCheckpointTable || !hadJournalTable ||
        hadLegacyCheckpointTable || hadLegacyJournalTable) {
        throw corruptionError('Workflow checkpoint storage has a conflicting or partial table state.')
      }
      return { committedStateChange: false }
    }

    if (hadStorageTable || hadCheckpointTable !== hadJournalTable ||
      hadLegacyCheckpointTable !== hadLegacyJournalTable) {
      throw corruptionError('Workflow checkpoint storage initialization is partial or ambiguous.')
    }

    const hasTargetFamily = hadCheckpointTable && hadJournalTable
    const hasLegacyFamily = hadLegacyCheckpointTable && hadLegacyJournalTable
    if (hasTargetFamily && !hasLegacyFamily) {
      throw corruptionError('Unversioned target workflow checkpoint storage cannot be adopted.')
    }

    let expectedDataset: DurableDataset = new Map()
    if (hasLegacyFamily) {
      const legacy = await readDurableDataset(
        transaction,
        LEGACY_CHECKPOINT_TABLE,
        LEGACY_JOURNAL_TABLE,
        'legacy-v1',
        signal,
      )
      if (!legacy.ok) throw corruptionError(legacy.message)
      expectedDataset = legacy.value
    }

    if (hasTargetFamily) {
      const target = await readDurableDataset(
        transaction,
        CHECKPOINT_TABLE,
        JOURNAL_TABLE,
        'target-v2',
        signal,
      )
      if (!target.ok) throw corruptionError(target.message)
      if (!sameDataset(expectedDataset, target.value)) {
        throw corruptionError('Legacy and target workflow checkpoint records diverge.')
      }
    } else if (hasLegacyFamily) {
      await writeDataset(transaction, expectedDataset, signal)
    }

    const verified = await readDurableDataset(
      transaction,
      CHECKPOINT_TABLE,
      JOURNAL_TABLE,
      'target-v2',
      signal,
    )
    if (!verified.ok || !sameDataset(expectedDataset, verified.value)) {
      throw corruptionError(verified.ok
        ? 'Migrated workflow checkpoint records do not match their legacy source.'
        : verified.message)
    }

    if (hasLegacyFamily) {
      await transaction.exec(dropLegacySchemaSql, signal)
    }
    const marked = await transaction.run(
      `INSERT INTO ${STORAGE_TABLE} (id, schema, version) VALUES (?, ?, ?)`,
      [1, STORAGE_SCHEMA, STORAGE_VERSION],
      signal,
    )
    if (marked.changes !== 1) {
      throw corruptionError('Workflow checkpoint storage version marker was not written exactly once.')
    }
    return { committedStateChange: true, dataset: verified.value }
  })
}

function parseDiscoveredTables(rows: readonly SqliteTableRow[]): ParseResult<ReadonlySet<string>> {
  const allowed = new Set([
    STORAGE_TABLE,
    CHECKPOINT_TABLE,
    JOURNAL_TABLE,
    LEGACY_CHECKPOINT_TABLE,
    LEGACY_JOURNAL_TABLE,
  ])
  const discovered = new Set<string>()
  for (const row of rows) {
    if (row.type !== 'table' || !allowed.has(row.name) || discovered.has(row.name)) {
      return invalid('Workflow checkpoint table discovery returned invalid metadata.')
    }
    discovered.add(row.name)
  }
  return valid(discovered)
}

function parseStorageRows(rows: readonly StorageRow[]): ParseResult<'missing' | 'ready'> {
  if (rows.length === 0) return valid('missing')
  if (rows.length !== 1) return invalid('Workflow checkpoint storage contains multiple version markers.')
  const row = rows[0]
  if (row.id !== 1 || row.schema !== STORAGE_SCHEMA || row.version !== STORAGE_VERSION) {
    return invalid('Workflow checkpoint storage version is invalid or unknown.')
  }
  return valid('ready')
}

async function readDurableDataset(
  database: WorkflowCheckpointDatabaseExecutor,
  checkpointTable: string,
  journalTable: string,
  format: PersistenceFormat,
  signal: AbortSignal,
): Promise<ParseResult<DurableDataset>> {
  const checkpointRows = await database.getAll<CheckpointRow>(
    `SELECT runId, revision, journalSequence, updatedAt, checkpointJson, schema
     FROM ${checkpointTable} ORDER BY runId ASC`,
    [],
    signal,
  )
  const journalRows = await database.getAll<CheckpointJournalRow>(
    `SELECT runId, sequence, revision, type, occurredAt, entryJson, checkpointJson, schema
     FROM ${journalTable} ORDER BY runId ASC, sequence ASC`,
    [],
    signal,
  )
  return parseDurableDataset(checkpointRows, journalRows, format)
}

function parseDurableDataset(
  checkpointRows: readonly CheckpointRow[],
  journalRows: readonly CheckpointJournalRow[],
  format: PersistenceFormat,
): ParseResult<DurableDataset> {
  const versionCheck = validatePersistenceVersions(checkpointRows, journalRows, format)
  if (!versionCheck.ok) return versionCheck

  const checkpointRowsByRun = new Map<AssistantRunId, CheckpointRow>()
  for (const row of checkpointRows) {
    if (!isRunId(row.runId) || checkpointRowsByRun.has(row.runId)) {
      return invalid('Workflow checkpoint current rows contain invalid or duplicate run IDs.')
    }
    checkpointRowsByRun.set(row.runId, row)
  }

  const rowsByRun = new Map<AssistantRunId, CheckpointJournalRow[]>()
  for (const row of journalRows) {
    if (!isRunId(row.runId)) return invalid('Workflow checkpoint journal contains an invalid run ID.')
    const rows = rowsByRun.get(row.runId) ?? []
    rows.push(row)
    rowsByRun.set(row.runId, rows)
  }

  if (checkpointRowsByRun.size !== rowsByRun.size ||
    [...checkpointRowsByRun.keys()].some((runId) => !rowsByRun.has(runId))) {
    return invalid('Workflow checkpoint current and journal state is one-sided.')
  }

  const dataset = new Map<AssistantRunId, DurableRunRecords>()
  const runIds = new Set([...checkpointRowsByRun.keys(), ...rowsByRun.keys()])
  for (const runId of runIds) {
    const currentRow = checkpointRowsByRun.get(runId)
    const current = currentRow ? parseCheckpointRow(currentRow, runId, format) : undefined
    const rows = rowsByRun.get(runId)
    if (!rows || rows.length === 0) {
      return invalid('Workflow checkpoint journal is missing its current recovery anchor.')
    }
    const snapshots: JournalSnapshot[] = []
    let previous: WorkflowCheckpoint | undefined
    for (const row of rows) {
      const parsed = parseJournalSnapshotRow(row, runId, previous, format)
      if (!parsed.ok) {
        if (format === 'target-v2' || !previous) return parsed
        break
      }
      snapshots.push(parsed.value)
      previous = parsed.value.checkpoint
    }
    if (!previous) {
      return invalid('No complete, ordered workflow checkpoint journal record can be migrated.')
    }
    if (format === 'target-v2' && (!current?.ok || !sameCheckpoint(current.value, previous))) {
      return invalid('Workflow checkpoint current row does not match the latest journal snapshot.')
    }
    const checkpoint = current?.ok && sameCheckpoint(current.value, previous)
      ? current.value
      : previous
    dataset.set(runId, { checkpoint, journal: snapshots })
  }
  return valid(dataset)
}

function validatePersistenceVersions(
  checkpointRows: readonly CheckpointRow[],
  journalRows: readonly CheckpointJournalRow[],
  format: PersistenceFormat,
): ParseResult<void> {
  const checkpointRowSchema = format === 'legacy-v1' ? LEGACY_CHECKPOINT_ROW_SCHEMA : CHECKPOINT_ROW_SCHEMA
  const journalRowSchema = format === 'legacy-v1' ? LEGACY_JOURNAL_ROW_SCHEMA : JOURNAL_ROW_SCHEMA
  const checkpointSchema = format === 'legacy-v1' ? LEGACY_CHECKPOINT_SCHEMA : WORKFLOW_CHECKPOINT_SCHEMA
  const journalSchema = format === 'legacy-v1' ? LEGACY_JOURNAL_SCHEMA : WORKFLOW_CHECKPOINT_JOURNAL_SCHEMA

  for (const row of checkpointRows) {
    if (row.schema !== checkpointRowSchema || hasConflictingPayloadSchema(row.checkpointJson, checkpointSchema)) {
      return invalid('Persisted workflow checkpoint version is invalid or unknown.')
    }
  }
  for (const row of journalRows) {
    if (row.schema !== journalRowSchema ||
      hasConflictingPayloadSchema(row.entryJson, journalSchema) ||
      hasConflictingPayloadSchema(row.checkpointJson, checkpointSchema)) {
      return invalid('Persisted workflow checkpoint journal version is invalid or unknown.')
    }
  }
  return valid(undefined)
}

function hasConflictingPayloadSchema(serialized: unknown, expectedSchema: string): boolean {
  if (typeof serialized !== 'string') return false
  const parsed = parseJson(serialized)
  return parsed.ok && isRecord(parsed.value) &&
    typeof parsed.value.schema === 'string' && parsed.value.schema !== expectedSchema
}

async function writeDataset(
  database: WorkflowCheckpointDatabaseExecutor,
  dataset: DurableDataset,
  signal: AbortSignal,
): Promise<void> {
  for (const runId of [...dataset.keys()].sort()) {
    const records = dataset.get(runId)
    if (!records) throw corruptionError('Workflow checkpoint migration lost a source run.')
    const inserted = await insertCheckpoint(database, records.checkpoint, signal)
    if (inserted.changes !== 1) {
      throw corruptionError('Workflow checkpoint migration did not write one current row.')
    }
    for (const snapshot of records.journal) {
      const appended = await insertJournalEntry(database, snapshot.checkpoint, snapshot.entry, signal)
      if (appended.changes !== 1) {
        throw corruptionError('Workflow checkpoint migration did not write one journal row.')
      }
    }
  }
}

function sameDataset(left: DurableDataset, right: DurableDataset): boolean {
  if (left.size !== right.size) return false
  for (const [runId, leftRecords] of left) {
    const rightRecords = right.get(runId)
    if (!rightRecords || !sameCheckpoint(leftRecords.checkpoint, rightRecords.checkpoint) ||
      leftRecords.journal.length !== rightRecords.journal.length) return false
    for (let index = 0; index < leftRecords.journal.length; index += 1) {
      const leftSnapshot = leftRecords.journal[index]
      const rightSnapshot = rightRecords.journal[index]
      if (!rightSnapshot || !sameCheckpoint(leftSnapshot.checkpoint, rightSnapshot.checkpoint) ||
        !sameJournalEntry(leftSnapshot.entry, rightSnapshot.entry)) return false
    }
  }
  return true
}

function normalizeWrite(
  input: AppendWorkflowCheckpointInput,
): Result<AppendWorkflowCheckpointInput, 'invalid_record'> {
  if (!isNonNegativeInteger(input.expectedRevision)) return invalidRecord('Expected checkpoint revision is invalid.')
  const checkpoint = parseWorkflowCheckpoint(input.checkpoint)
  if (!checkpoint.ok) return checkpoint
  const entry = parseWorkflowCheckpointJournalEntry(input.entry)
  if (!entry.ok) return entry
  return ok({
    expectedRevision: input.expectedRevision,
    checkpoint: checkpoint.value,
    entry: entry.value,
    signal: input.signal,
  })
}

async function insertCheckpoint(
  database: WorkflowCheckpointDatabaseExecutor,
  checkpoint: WorkflowCheckpoint,
  signal: AbortSignal,
): Promise<WorkflowCheckpointDatabaseRunResult> {
  return database.run(
    `INSERT INTO ${CHECKPOINT_TABLE} (
       runId, revision, journalSequence, updatedAt, checkpointJson, schema
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      checkpoint.runId,
      checkpoint.revision,
      checkpoint.journalSequence,
      checkpoint.updatedAt,
      JSON.stringify(checkpoint),
      CHECKPOINT_ROW_SCHEMA,
    ],
    signal,
  )
}

async function updateCheckpoint(
  database: WorkflowCheckpointDatabaseExecutor,
  input: AppendWorkflowCheckpointInput,
  signal: AbortSignal,
): Promise<WorkflowCheckpointDatabaseRunResult> {
  const checkpoint = input.checkpoint
  return database.run(
    `UPDATE ${CHECKPOINT_TABLE}
     SET revision = ?, journalSequence = ?, updatedAt = ?, checkpointJson = ?, schema = ?
     WHERE runId = ? AND revision = ?`,
    [
      checkpoint.revision,
      checkpoint.journalSequence,
      checkpoint.updatedAt,
      JSON.stringify(checkpoint),
      CHECKPOINT_ROW_SCHEMA,
      checkpoint.runId,
      input.expectedRevision,
    ],
    signal,
  )
}

async function insertJournalEntry(
  database: WorkflowCheckpointDatabaseExecutor,
  checkpoint: WorkflowCheckpoint,
  entry: WorkflowCheckpointJournalEntry,
  signal: AbortSignal,
): Promise<WorkflowCheckpointDatabaseRunResult> {
  return database.run(
    `INSERT INTO ${JOURNAL_TABLE} (
       runId, sequence, revision, type, occurredAt, entryJson, checkpointJson, schema
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.runId,
      entry.sequence,
      entry.revision,
      entry.type,
      entry.occurredAt,
      JSON.stringify(entry),
      JSON.stringify(checkpoint),
      JOURNAL_ROW_SCHEMA,
    ],
    signal,
  )
}

async function pruneCheckpointJournal(
  database: WorkflowCheckpointDatabaseExecutor,
  runId: AssistantRunId,
  journalSequence: number,
  signal: AbortSignal,
): Promise<void> {
  const pruneThrough = journalSequence - WORKFLOW_CHECKPOINT_LIMITS.journalSnapshots
  if (pruneThrough <= 0) return
  await database.run(
    `DELETE FROM ${JOURNAL_TABLE} WHERE runId = ? AND sequence <= ?`,
    [runId, pruneThrough],
    signal,
  )
}

function validateCurrentPair(
  runId: AssistantRunId,
  currentRow: CheckpointRow | null,
  latestJournalRow: CheckpointJournalRow | null,
): ParseResult<WorkflowCheckpoint | undefined> {
  if (!currentRow && !latestJournalRow) return valid(undefined)
  if (!currentRow || !latestJournalRow) {
    return invalid('Workflow checkpoint current and journal state is one-sided.')
  }
  const current = parseCheckpointRow(currentRow, runId, 'target-v2')
  if (!current.ok) return current
  const latest = parseJournalSnapshotRow(latestJournalRow, runId, undefined, 'target-v2')
  if (!latest.ok) return latest
  if (!sameCheckpoint(current.value, latest.value.checkpoint)) {
    return invalid('Workflow checkpoint current row does not match its journal authority.')
  }
  return valid(current.value)
}

function recoverLastSafeCheckpoint(
  runId: AssistantRunId,
  currentRow: CheckpointRow | null,
  journalRows: readonly CheckpointJournalRow[],
): Result<RecoveredWorkflowCheckpointRecord | undefined, WorkflowCheckpointPersistenceErrorCode> {
  if (!currentRow && journalRows.length === 0) return ok(undefined)
  const current = currentRow ? parseCheckpointRow(currentRow, runId, 'target-v2') : undefined

  let previous: WorkflowCheckpoint | undefined
  let journalCorrupt = false
  for (const row of journalRows) {
    const snapshot = parseJournalSnapshotRow(row, runId, previous, 'target-v2')
    if (!snapshot.ok) {
      journalCorrupt = true
      break
    }
    previous = snapshot.value.checkpoint
  }

  if (!previous) {
    return corruption('No complete, ordered workflow checkpoint journal record can be recovered.')
  }
  if (!journalCorrupt && current?.ok && sameCheckpoint(current.value, previous)) {
    return ok({ checkpoint: current.value, source: 'current' })
  }
  return ok({ checkpoint: previous, source: 'journal' })
}

function parseCheckpointRow(
  row: CheckpointRow,
  expectedRunId: AssistantRunId,
  format: PersistenceFormat,
): ParseResult<WorkflowCheckpoint> {
  const rowSchema = format === 'legacy-v1' ? LEGACY_CHECKPOINT_ROW_SCHEMA : CHECKPOINT_ROW_SCHEMA
  if (row.schema !== rowSchema || row.runId !== expectedRunId || !isPositiveInteger(row.revision) ||
    !isPositiveInteger(row.journalSequence) || row.revision !== row.journalSequence ||
    !isTimestamp(row.updatedAt) || !isSerializedRecord(row.checkpointJson)) {
    return invalid('Persisted workflow checkpoint row metadata is invalid or unknown.')
  }
  const json = parseJson(row.checkpointJson)
  if (!json.ok) return json
  const checkpoint = parseCheckpointPayload(json.value, format)
  if (!checkpoint.ok) return checkpoint
  if (checkpoint.value.runId !== row.runId || checkpoint.value.revision !== row.revision ||
    checkpoint.value.journalSequence !== row.journalSequence || checkpoint.value.updatedAt !== row.updatedAt) {
    return invalid('Persisted workflow checkpoint row does not match its payload.')
  }
  return valid(checkpoint.value)
}

function parseJournalSnapshotRow(
  row: CheckpointJournalRow,
  expectedRunId: AssistantRunId,
  previous: WorkflowCheckpoint | undefined,
  format: PersistenceFormat,
): ParseResult<JournalSnapshot> {
  const rowSchema = format === 'legacy-v1' ? LEGACY_JOURNAL_ROW_SCHEMA : JOURNAL_ROW_SCHEMA
  if (row.schema !== rowSchema || row.runId !== expectedRunId || !isPositiveInteger(row.sequence) ||
    !isPositiveInteger(row.revision) || row.sequence !== row.revision || !isTimestamp(row.occurredAt) ||
    typeof row.type !== 'string' || !isSerializedRecord(row.entryJson) || !isSerializedRecord(row.checkpointJson)) {
    return invalid('Persisted workflow checkpoint journal row metadata is invalid or unknown.')
  }
  const entryJson = parseJson(row.entryJson)
  if (!entryJson.ok) return entryJson
  const checkpointJson = parseJson(row.checkpointJson)
  if (!checkpointJson.ok) return checkpointJson
  const entry = parseJournalPayload(entryJson.value, format)
  if (!entry.ok) return entry
  const checkpoint = parseCheckpointPayload(checkpointJson.value, format)
  if (!checkpoint.ok) return checkpoint
  if (entry.value.runId !== row.runId || entry.value.sequence !== row.sequence ||
    entry.value.revision !== row.revision || entry.value.type !== row.type ||
    entry.value.occurredAt !== row.occurredAt || checkpoint.value.runId !== row.runId ||
    checkpoint.value.revision !== row.revision || checkpoint.value.journalSequence !== row.sequence ||
    checkpoint.value.updatedAt !== row.occurredAt) {
    return invalid('Persisted workflow checkpoint journal row does not match its payloads.')
  }
  const transition = previous || checkpoint.value.revision === 1
    ? validateWorkflowCheckpointTransition(previous, checkpoint.value, entry.value)
    : validateWorkflowCheckpointJournalSnapshot(checkpoint.value, entry.value)
  return transition.ok
    ? valid({ entry: entry.value, checkpoint: checkpoint.value })
    : invalid(transition.error.message)
}

function parseCheckpointPayload(value: unknown, format: PersistenceFormat): ParseResult<WorkflowCheckpoint> {
  const normalized = normalizePayloadSchema(
    value,
    format === 'legacy-v1' ? LEGACY_CHECKPOINT_SCHEMA : WORKFLOW_CHECKPOINT_SCHEMA,
    WORKFLOW_CHECKPOINT_SCHEMA,
  )
  if (!normalized.ok) return normalized
  const checkpoint = parseWorkflowCheckpoint(normalized.value)
  return checkpoint.ok ? valid(checkpoint.value) : invalid(checkpoint.error.message)
}

function parseJournalPayload(value: unknown, format: PersistenceFormat): ParseResult<WorkflowCheckpointJournalEntry> {
  const normalized = normalizePayloadSchema(
    value,
    format === 'legacy-v1' ? LEGACY_JOURNAL_SCHEMA : WORKFLOW_CHECKPOINT_JOURNAL_SCHEMA,
    WORKFLOW_CHECKPOINT_JOURNAL_SCHEMA,
  )
  if (!normalized.ok) return normalized
  const entry = parseWorkflowCheckpointJournalEntry(normalized.value)
  return entry.ok ? valid(entry.value) : invalid(entry.error.message)
}

function normalizePayloadSchema(
  value: unknown,
  expectedSchema: string,
  targetSchema: string,
): ParseResult<Record<string, unknown>> {
  if (!isRecord(value) || value.schema !== expectedSchema) {
    return invalid('Persisted workflow checkpoint payload schema is invalid or unknown.')
  }
  return valid({ ...value, schema: targetSchema })
}

const createTargetSchemaSql = `
  CREATE TABLE IF NOT EXISTS ${STORAGE_TABLE} (
    id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
    schema TEXT NOT NULL,
    version INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ${CHECKPOINT_TABLE} (
    runId TEXT PRIMARY KEY NOT NULL,
    revision INTEGER NOT NULL,
    journalSequence INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    checkpointJson TEXT NOT NULL,
    schema TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ${JOURNAL_TABLE} (
    runId TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    type TEXT NOT NULL,
    occurredAt INTEGER NOT NULL,
    entryJson TEXT NOT NULL,
    checkpointJson TEXT NOT NULL,
    schema TEXT NOT NULL,
    PRIMARY KEY (runId, sequence)
  );
  CREATE INDEX IF NOT EXISTS workflow_checkpoint_journal_recovery_idx
    ON ${JOURNAL_TABLE} (runId, sequence);
`

const dropLegacySchemaSql = `
  DROP INDEX IF EXISTS agent_workflow_checkpoint_journal_recovery_idx;
  DROP TABLE ${LEGACY_JOURNAL_TABLE};
  DROP TABLE ${LEGACY_CHECKPOINT_TABLE};
`

const tableDiscoverySql = `
  SELECT name, type FROM sqlite_master
  WHERE type = 'table' AND name IN (?, ?, ?, ?, ?)
`

const storageSelectSql = `SELECT id, schema, version FROM ${STORAGE_TABLE} ORDER BY id ASC`

const checkpointSelectSql = `
  SELECT runId, revision, journalSequence, updatedAt, checkpointJson, schema
  FROM ${CHECKPOINT_TABLE} WHERE runId = ?
`

const journalLatestSelectSql = `
  SELECT runId, sequence, revision, type, occurredAt, entryJson, checkpointJson, schema
  FROM ${JOURNAL_TABLE} WHERE runId = ? ORDER BY sequence DESC LIMIT 1
`

const journalTailSelectSql = `
  SELECT runId, sequence, revision, type, occurredAt, entryJson, checkpointJson, schema
  FROM ${JOURNAL_TABLE} WHERE runId = ? ORDER BY sequence DESC LIMIT ?
`

type ParseResult<Value> = { ok: true; value: Value } | { ok: false; message: string }

function valid<Value>(value: Value): ParseResult<Value> {
  return { ok: true, value }
}

function invalid<Value = never>(message: string): ParseResult<Value> {
  return { ok: false, message }
}

function parseJson(value: string): ParseResult<unknown> {
  try {
    return valid(JSON.parse(value))
  } catch {
    return invalid('Persisted workflow checkpoint JSON is invalid.')
  }
}

function sameCheckpoint(left: WorkflowCheckpoint, right: WorkflowCheckpoint): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sameJournalEntry(left: WorkflowCheckpointJournalEntry, right: WorkflowCheckpointJournalEntry): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSerializedRecord(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 &&
    value.length <= WORKFLOW_CHECKPOINT_LIMITS.serializedCharacters
}

function isRunId(value: unknown): value is AssistantRunId {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 256
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isTimestamp(value: unknown): value is number {
  return isNonNegativeInteger(value)
}

function cancelledResult(): Result<never, 'cancelled'> {
  return err('cancelled', 'Workflow checkpoint operation was cancelled.')
}

function invalidRecord(message: string): Result<never, 'invalid_record'> {
  return err('invalid_record', message)
}

function corruption(message: string): Result<never, 'corruption'> {
  return err('corruption', message)
}

function conflict(expectedRevision: number, actualRevision: number): Result<never, 'conflict'> {
  return err('conflict', 'Workflow checkpoint revision changed.', {
    retryable: true,
    details: { expectedRevision, actualRevision },
  })
}

function operationFailure(
  error: unknown,
  signal: AbortSignal,
): Result<never, 'cancelled' | 'corruption' | 'persistence_failed'> {
  if (error instanceof WorkflowCheckpointCorruptionError) return corruption(error.message)
  if (signal.aborted || isAbortError(error)) return cancelledResult()
  return err('persistence_failed', 'Workflow checkpoint persistence failed.', { retryable: true })
}

class WorkflowCheckpointCorruptionError extends Error {
  override readonly name = 'WorkflowCheckpointCorruptionError'
}

function corruptionError(message: string): WorkflowCheckpointCorruptionError {
  return new WorkflowCheckpointCorruptionError(message)
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function abortError(): Error {
  const error = new Error('Checkpoint database operation was aborted.')
  error.name = 'AbortError'
  return error
}
