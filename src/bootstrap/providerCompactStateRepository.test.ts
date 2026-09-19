jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }))
jest.mock('@/platform/storage', () => ({ scheduleSqliteDatabaseOperation: (_name: string, work: () => unknown) => work() }))
jest.mock('@/modules/providers', () => jest.requireActual('../modules/providers/providerCompactStateRepository'))

import * as SQLite from 'expo-sqlite'
test('compact persistence uses real SQLite on Web with the same durability and connection boundary as native', async () => {
  const db = { execAsync: jest.fn(async () => undefined), getAllAsync: jest.fn(async () => []), runAsync: jest.fn(async () => undefined) }
  jest.mocked(SQLite.openDatabaseAsync).mockResolvedValue(db as never)
  const { providerCompactStateRepository: repository } = require('./providerCompactStateRepository')
  expect(repository.persistenceAvailable).toBe(true)
  await repository.listActiveCompactStates('conversation', 'provider', 'model')
  expect(SQLite.openDatabaseAsync).toHaveBeenCalledWith('islemind-context.db', { useNewConnection: true, finalizeUnusedStatementsBeforeClosing: false })
  expect(db.execAsync).toHaveBeenCalledWith(expect.stringContaining('PRAGMA synchronous = FULL'))
  expect(db.execAsync).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS compact_states'))
})
