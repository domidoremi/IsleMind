import AsyncStorage from '@react-native-async-storage/async-storage'

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
  storage: AsyncStorageApplicationRecordAdapter = AsyncStorage,
): ApplicationRecordStoragePort {
  return Object.freeze({
    read: (key: string) => storage.getItem(key),
    write: (key: string, value: string) => storage.setItem(key, value),
    remove: (key: string) => storage.removeItem(key),
    removeMany: (keys: readonly string[]) => storage.multiRemove([...keys]),
  })
}
