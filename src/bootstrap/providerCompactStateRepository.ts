import * as SQLite from 'expo-sqlite'
import {
  createProviderCompactStateRepository,
  type ProviderCompactStateDatabase,
} from '@/modules/providers'
import { scheduleSqliteDatabaseOperation } from '@/platform/storage'

export type { CompactStateRecord } from '@/modules/providers'

export const providerCompactStateRepository = createProviderCompactStateRepository({
  openDatabase: async (databaseName) => {
    return scheduleSqliteDatabaseOperation(databaseName, async () => {
      const database = await SQLite.openDatabaseAsync(databaseName, {
        useNewConnection: true,
        finalizeUnusedStatementsBeforeClosing: false,
      })
      try {
        await database.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL;')
        return database as ProviderCompactStateDatabase
      } catch (error) {
        await database.closeAsync().catch(() => undefined)
        throw error
      }
    })
  },
  scheduleOperation: scheduleSqliteDatabaseOperation,
})

export const {
  clearAllCompactStates,
  invalidateAllCompactStates,
  invalidateCompactStates,
  invalidateCompactStatesByProvider,
  listActiveCompactStates,
  saveCompactState,
} = providerCompactStateRepository
