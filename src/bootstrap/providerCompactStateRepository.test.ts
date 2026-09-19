jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }))
jest.mock('@/platform/storage/sqliteFallback', () => ({ shouldUseSqliteWebFallback: true }))
jest.mock('@/platform/storage', () => ({ scheduleSqliteDatabaseOperation: jest.fn() }))
jest.mock('@/modules/providers', () => jest.requireActual('../modules/providers/providerCompactStateRepository'))

import * as SQLite from 'expo-sqlite'
import { providerCompactStateRepository } from './providerCompactStateRepository'
import type { CompactStateRecord } from '../modules/providers/providerCompactStateRepository'

const state: CompactStateRecord = {
  id: 'state', conversationId: 'conversation', providerId: 'provider', model: 'model',
  compactItemJson: '{}', sourceMessageStartIndex: 0, sourceMessageEndIndex: 1,
  status: 'active', createdAt: 1, updatedAt: 1,
}

test('Web compact storage explicitly rejects unavailable reads and writes instead of silently dropping them', async () => {
  expect(providerCompactStateRepository.persistenceAvailable).toBe(false)
  await expect(providerCompactStateRepository.saveCompactState(state)).rejects.toThrow('persistence is unavailable')
  await expect(providerCompactStateRepository.listActiveCompactStates('conversation', 'provider', 'model')).rejects.toThrow('persistence is unavailable')
  expect(SQLite.openDatabaseAsync).not.toHaveBeenCalled()
})

test('Web reset and invalidation remain safe when no compact state can be stored', async () => {
  await expect(providerCompactStateRepository.clearAllCompactStates()).resolves.toBeUndefined()
  await expect(providerCompactStateRepository.invalidateAllCompactStates()).resolves.toBeUndefined()
  await expect(providerCompactStateRepository.invalidateCompactStates('conversation')).resolves.toBeUndefined()
  await expect(providerCompactStateRepository.invalidateCompactStatesByProvider('provider')).resolves.toBeUndefined()
  expect(SQLite.openDatabaseAsync).not.toHaveBeenCalled()
})
