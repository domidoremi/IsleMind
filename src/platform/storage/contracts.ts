export type SqliteValue = string | number | boolean | null | Uint8Array

export interface SqliteRunResult {
  changes: number
  lastInsertRowId: number
}

export interface SqliteExecutor {
  exec(source: string): Promise<void>
  run(source: string, parameters?: readonly SqliteValue[]): Promise<SqliteRunResult>
  getFirst<Row extends object>(source: string, parameters?: readonly SqliteValue[]): Promise<Row | null>
  getAll<Row extends object>(source: string, parameters?: readonly SqliteValue[]): Promise<readonly Row[]>
}

export interface SqliteDatabase extends SqliteExecutor {
  transaction<Value>(work: (transaction: SqliteExecutor) => Promise<Value>): Promise<Value>
}

export interface SqliteDatabaseProvider {
  get(): Promise<SqliteDatabase>
}

export interface SqliteMigration {
  scope: string
  version: number
  name: string
  up(database: SqliteExecutor): Promise<void>
}
