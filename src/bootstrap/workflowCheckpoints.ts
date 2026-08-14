import {
  createWorkflowCheckpointStore,
  createSqliteWorkflowCheckpointRepository,
  type WorkflowCheckpointDatabase,
  type WorkflowCheckpointDatabaseExecutor,
  type WorkflowCheckpointDatabaseProvider,
  type WorkflowCheckpointDatabaseRunResult,
  type WorkflowCheckpointDatabaseValue,
  type WorkflowCheckpointStore,
} from '@/modules/tasks'
import type { SqliteDatabase, SqliteDatabaseProvider, SqliteExecutor } from '@/platform/storage'

export function createWorkflowCheckpointRuntime(
  databaseProvider: SqliteDatabaseProvider,
): WorkflowCheckpointStore {
  const repository = createSqliteWorkflowCheckpointRepository(
    createCancellationAwareCheckpointDatabaseProvider(databaseProvider),
  )
  return createWorkflowCheckpointStore(repository)
}

/**
 * Narrow bootstrap bridge: it observes the exact workflow signal without
 * widening every SQLite consumer to a cancellation-aware database contract.
 */
function createCancellationAwareCheckpointDatabaseProvider(
  provider: SqliteDatabaseProvider,
): WorkflowCheckpointDatabaseProvider {
  return {
    async get(signal) {
      throwIfAborted(signal)
      const database = await provider.get()
      throwIfAborted(signal)
      return wrapDatabase(database)
    },
  }
}

function wrapDatabase(database: SqliteDatabase): WorkflowCheckpointDatabase {
  return {
    ...wrapExecutor(database),
    async transaction(signal, work) {
      throwIfAborted(signal)
      const value = await database.transaction(async (transaction) => {
        throwIfAborted(signal)
        return work(wrapExecutor(transaction))
      })
      // Once the transaction promise resolves, the commit is authoritative.
      // Do not report cancellation after a committed checkpoint/journal pair.
      return value
    },
  }
}

function wrapExecutor(executor: SqliteExecutor): WorkflowCheckpointDatabaseExecutor {
  return {
    async exec(source, signal) {
      throwIfAborted(signal)
      await executor.exec(source)
      throwIfAborted(signal)
    },
    async run(source, parameters, signal): Promise<WorkflowCheckpointDatabaseRunResult> {
      throwIfAborted(signal)
      const result = await executor.run(source, parameters)
      throwIfAborted(signal)
      return result
    },
    async getFirst<Row extends object>(source: string, parameters: readonly WorkflowCheckpointDatabaseValue[], signal: AbortSignal): Promise<Row | null> {
      throwIfAborted(signal)
      const row = await executor.getFirst<Row>(source, parameters)
      throwIfAborted(signal)
      return row
    },
    async getAll<Row extends object>(source: string, parameters: readonly WorkflowCheckpointDatabaseValue[], signal: AbortSignal): Promise<readonly Row[]> {
      throwIfAborted(signal)
      const rows = await executor.getAll<Row>(source, parameters)
      throwIfAborted(signal)
      return rows
    },
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  const error = new Error('Workflow checkpoint database operation was cancelled.')
  error.name = 'AbortError'
  throw error
}
