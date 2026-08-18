import type * as SQLite from 'expo-sqlite'
import type {
  SqliteDatabase,
  SqliteDatabaseProvider,
  SqliteExecutor,
  SqliteMigration,
  SqliteRunResult,
  SqliteValue,
} from './contracts'

export const ISLEMIND_DATABASE_NAME = 'islemind-context.db'

export interface ExpoSqliteDatabaseProviderOptions {
  databaseName?: string
}

interface MigrationRow {
  version: number
}

const databaseOperationQueues = new Map<string, Promise<void>>()

function enqueueDatabaseOperation<Value>(
  databaseName: string,
  operation: () => Promise<Value>,
): Promise<Value> {
  const previous = databaseOperationQueues.get(databaseName) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  databaseOperationQueues.set(databaseName, current)

  return previous
    .catch(() => undefined)
    .then(operation)
    .finally(() => {
      release()
      if (databaseOperationQueues.get(databaseName) === current) {
        databaseOperationQueues.delete(databaseName)
      }
    })
}

export function createExpoSqliteDatabaseProvider(
  options: ExpoSqliteDatabaseProviderOptions = {},
): SqliteDatabaseProvider {
  let databasePromise: Promise<SqliteDatabase> | undefined
  const databaseName = options.databaseName ?? ISLEMIND_DATABASE_NAME

  return {
    get() {
      databasePromise ??= openDatabase(databaseName).catch((error) => {
        databasePromise = undefined
        throw error
      })
      return databasePromise
    },
  }
}

export async function applySqliteMigrations(
  database: SqliteDatabase,
  migrations: readonly SqliteMigration[],
): Promise<void> {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS platform_schema_migrations (
      scope TEXT NOT NULL,
      version INTEGER NOT NULL,
      name TEXT NOT NULL,
      appliedAt INTEGER NOT NULL,
      PRIMARY KEY (scope, version)
    );
  `)

  const ordered = [...migrations].sort((left, right) =>
    left.scope.localeCompare(right.scope) || left.version - right.version,
  )

  for (const migration of ordered) {
    const applied = await database.getFirst<MigrationRow>(
      'SELECT version FROM platform_schema_migrations WHERE scope = ? AND version = ?',
      [migration.scope, migration.version],
    )
    if (applied) continue

    await database.transaction(async (transaction) => {
      const alreadyApplied = await transaction.getFirst<MigrationRow>(
        'SELECT version FROM platform_schema_migrations WHERE scope = ? AND version = ?',
        [migration.scope, migration.version],
      )
      if (alreadyApplied) return
      await migration.up(transaction)
      await transaction.run(
        'INSERT INTO platform_schema_migrations (scope, version, name, appliedAt) VALUES (?, ?, ?, ?)',
        [migration.scope, migration.version, migration.name, Date.now()],
      )
    })
  }
}

async function openDatabase(name: string): Promise<SqliteDatabase> {
  const supportsExclusiveTransactions = typeof document === 'undefined'
  return enqueueDatabaseOperation(name, async () => {
    const SQLite = require('expo-sqlite') as typeof import('expo-sqlite')
    // Each provider owns its connection. The adapter exposes no raw prepared
    // statements, so Expo's close-time sweep is redundant and unsafe for FTS5.
    const database = await SQLite.openDatabaseAsync(name, {
      useNewConnection: true,
      finalizeUnusedStatementsBeforeClosing: false,
    })
    await database.execAsync(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA synchronous = NORMAL;
    `)
    return createSqliteDatabase(database, name, supportsExclusiveTransactions)
  })
}

/**
 * Shares the native-operation queue with bootstrap-owned adapters that keep
 * an independently-created Expo connection for the same database file.
 */
export function scheduleSqliteDatabaseOperation<Value>(
  databaseName: string,
  operation: () => Promise<Value>,
): Promise<Value> {
  return enqueueDatabaseOperation(databaseName, operation)
}

type TransactionCapableDatabase = SQLite.SQLiteDatabase & {
  withExclusiveTransactionAsync?: <Value>(
    work: (transaction: SQLite.SQLiteDatabase) => Promise<Value>,
  ) => Promise<Value>
  withTransactionAsync?: <Value>(work: () => Promise<Value>) => Promise<Value>
}

function createSqliteDatabase(
  database: SQLite.SQLiteDatabase,
  databaseName: string,
  supportsExclusiveTransactions: boolean,
): SqliteDatabase {
  const transactionCapable = database as TransactionCapableDatabase
  const executor = createExecutor(database)
  return {
    exec(source) {
      return enqueueDatabaseOperation(databaseName, () => executor.exec(source))
    },

    run(source, parameters = []) {
      return enqueueDatabaseOperation(databaseName, () => executor.run(source, parameters))
    },

    getFirst<Row extends object>(source: string, parameters: readonly SqliteValue[] = []) {
      return enqueueDatabaseOperation(databaseName, () => executor.getFirst<Row>(source, parameters))
    },

    getAll<Row extends object>(source: string, parameters: readonly SqliteValue[] = []) {
      return enqueueDatabaseOperation(databaseName, () => executor.getAll<Row>(source, parameters))
    },

    async transaction<Value>(work: (transaction: SqliteExecutor) => Promise<Value>): Promise<Value> {
      return enqueueDatabaseOperation(databaseName, async () => {
        let value: Value | undefined
        if (
          supportsExclusiveTransactions &&
          typeof transactionCapable.withExclusiveTransactionAsync === 'function'
        ) {
          await transactionCapable.withExclusiveTransactionAsync(async (transaction) => {
            value = await work(createExecutor(transaction))
          })
        } else if (typeof transactionCapable.withTransactionAsync === 'function') {
          await transactionCapable.withTransactionAsync(async () => {
            value = await work(executor)
          })
        } else {
          value = await work(executor)
        }
        return value as Value
      })
    },
  }
}

function createExecutor(database: SQLite.SQLiteDatabase): SqliteExecutor {
  return {
    exec(source) {
      return database.execAsync(source)
    },

    async run(source, parameters = []): Promise<SqliteRunResult> {
      const result = await database.runAsync(source, ...(parameters as SQLite.SQLiteVariadicBindParams))
      return {
        changes: result?.changes ?? 0,
        lastInsertRowId: result?.lastInsertRowId ?? 0,
      }
    },

    getFirst<Row extends object>(source: string, parameters: readonly SqliteValue[] = []): Promise<Row | null> {
      return database.getFirstAsync<Row>(source, ...(parameters as SQLite.SQLiteVariadicBindParams))
    },

    getAll<Row extends object>(source: string, parameters: readonly SqliteValue[] = []): Promise<readonly Row[]> {
      return database.getAllAsync<Row>(source, ...(parameters as SQLite.SQLiteVariadicBindParams))
    },
  }
}
