import * as Crypto from 'expo-crypto'
import { createSqliteDocumentRepository } from '@/modules/documents'
import { createExpoSqliteDatabaseProvider } from '@/platform/storage'

export const documentLibrary = createSqliteDocumentRepository({
  databaseProvider: createExpoSqliteDatabaseProvider(),
  createId: () => Crypto.randomUUID(),
  now: Date.now,
})
