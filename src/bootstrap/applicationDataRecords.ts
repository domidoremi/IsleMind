import { createAsyncStorageApplicationRecordStorage } from '@/platform/storage'
import { logStorageOperationFailure } from '@/services/runtimeHealthLog'
import {
  createApplicationDataRecordRuntime,
  type ApplicationDataStorageKey,
} from './applicationDataRecordRuntime'

export {
  APPLICATION_DATA_STORAGE_KEYS,
  ApplicationDataRecordPersistenceError,
  createApplicationDataRecordRuntime,
  type ApplicationDataRecordOperation,
  type ApplicationDataRecordRuntimeDependencies,
  type ApplicationDataStorageKey,
} from './applicationDataRecordRuntime'

const applicationDataRecordRuntime = createApplicationDataRecordRuntime({
  storage: createAsyncStorageApplicationRecordStorage(),
  reportFailure: logStorageOperationFailure,
})

export const readApplicationDataRecord = applicationDataRecordRuntime.read
export const writeApplicationDataRecord = applicationDataRecordRuntime.write
export const deleteApplicationDataRecord = applicationDataRecordRuntime.remove

export async function loadApplicationDataRecord<T>(
  key: ApplicationDataStorageKey,
): Promise<T | null> {
  return applicationDataRecordRuntime.loadCompatibility<T>(key)
}

export async function saveApplicationDataRecord<T>(
  key: ApplicationDataStorageKey,
  data: T,
): Promise<void> {
  return applicationDataRecordRuntime.saveCompatibility(key, data)
}

export async function removeApplicationDataRecord(
  key: ApplicationDataStorageKey,
): Promise<void> {
  return applicationDataRecordRuntime.removeCompatibility(key)
}

export function removeRawApplicationDataRecords(keys: readonly string[]): Promise<void> {
  return applicationDataRecordRuntime.removeRaw(keys)
}
