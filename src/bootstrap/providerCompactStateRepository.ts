import * as SQLite from 'expo-sqlite'
import {
  createProviderCompactStateRepository,
  type ProviderCompactStateDatabase,
} from '@/modules/providers'
import { scheduleSqliteDatabaseOperation } from '@/platform/storage'
import { shouldUseSqliteWebFallback } from '@/platform/storage/sqliteFallback'

export type { CompactStateRecord } from '@/modules/providers'

export const providerCompactStateRepository = createProviderCompactStateRepository({
  persistenceAvailable: !shouldUseSqliteWebFallback,
  openDatabase: async (databaseName) => {
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
