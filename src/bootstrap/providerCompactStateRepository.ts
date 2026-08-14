import * as SQLite from 'expo-sqlite'
import {
  createProviderCompactStateRepository,
  type ProviderCompactStateDatabase,
} from '@/modules/providers'
import { scheduleSqliteDatabaseOperation } from '@/platform/storage'
import { shouldUseSqliteWebFallback, sqliteWebFallbackDb } from '@/services/sqliteFallback'

export type { CompactStateRecord } from '@/modules/providers'

export const providerCompactStateRepository = createProviderCompactStateRepository({
  openDatabase: async (databaseName) => {
    if (shouldUseSqliteWebFallback) {
      return sqliteWebFallbackDb as ProviderCompactStateDatabase
    }
    return scheduleSqliteDatabaseOperation(databaseName, () => SQLite.openDatabaseAsync(databaseName, {
      useNewConnection: true,
      finalizeUnusedStatementsBeforeClosing: false,
    }) as Promise<ProviderCompactStateDatabase>)
  },
  scheduleOperation: scheduleSqliteDatabaseOperation,
  initializeSchema: !shouldUseSqliteWebFallback,
})

export const {
  clearAllCompactStates,
  invalidateAllCompactStates,
  invalidateCompactStates,
  invalidateCompactStatesByProvider,
  listActiveCompactStates,
  saveCompactState,
} = providerCompactStateRepository
