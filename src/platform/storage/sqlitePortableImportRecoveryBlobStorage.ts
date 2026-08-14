import type { SqliteDatabaseProvider } from './contracts'
import type { PortableImportRecoveryBlobStorageAdapter } from './portableImportRecoveryStore'

const TABLE = 'portable_import_recovery_blobs'

interface BlobRow {
  value: string
}

export function createSqlitePortableImportRecoveryBlobStorage(
  databaseProvider: SqliteDatabaseProvider,
): PortableImportRecoveryBlobStorageAdapter {
  let initialization: Promise<void> | undefined

  async function database() {
    const value = await databaseProvider.get()
    initialization ??= value.exec(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
    `).catch((error) => {
      initialization = undefined
      throw error
    })
    await initialization
    return value
  }

  return Object.freeze({
    async getItem(key: string) {
      const row = await (await database()).getFirst<BlobRow>(
        `SELECT value FROM ${TABLE} WHERE key = ?`,
        [key],
      )
      return row?.value ?? null
    },
    async setItem(key: string, value: string) {
      await (await database()).run(
        `INSERT OR REPLACE INTO ${TABLE} (key, value) VALUES (?, ?)`,
        [key, value],
      )
    },
    async removeItem(key: string) {
      await (await database()).run(`DELETE FROM ${TABLE} WHERE key = ?`, [key])
    },
  })
}
