export interface AsyncStorageApplicationRecordAdapter {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
  multiRemove(keys: readonly string[]): Promise<void>
}

export interface ApplicationRecordStoragePort {
  read(key: string): Promise<string | null>
  write(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
  removeMany(keys: readonly string[]): Promise<void>
}

export function createAsyncStorageApplicationRecordStorage(
  storage?: AsyncStorageApplicationRecordAdapter,
): ApplicationRecordStoragePort {
  const resolveStorage = () => storage ??= loadDefaultAsyncStorage()

  return Object.freeze({
    read: (key: string) => resolveStorage().getItem(key),
    write: (key: string, value: string) => resolveStorage().setItem(key, value),
    remove: (key: string) => resolveStorage().removeItem(key),
    removeMany: (keys: readonly string[]) => resolveStorage().multiRemove([...keys]),
  })
}

function loadDefaultAsyncStorage(): AsyncStorageApplicationRecordAdapter {
  const loaded = require('@react-native-async-storage/async-storage') as {
    default?: AsyncStorageApplicationRecordAdapter
  } & Partial<AsyncStorageApplicationRecordAdapter>
  return loaded.default ?? loaded as AsyncStorageApplicationRecordAdapter
}
