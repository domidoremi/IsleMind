import AsyncStorage from '@react-native-async-storage/async-storage'

/** Minimal storage contract consumed by the knowledge state repository. */
export interface LocalModelStateStoragePort {
  getItem(key: string, signal?: AbortSignal): Promise<string | null | undefined>
  setItem(key: string, value: string, signal?: AbortSignal): Promise<void>
  removeItem(key: string, signal?: AbortSignal): Promise<void>
}

export interface AsyncStorageLocalModelStateAdapter {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

export function createAsyncStorageLocalModelStateStoragePort(
  storage: AsyncStorageLocalModelStateAdapter = AsyncStorage,
): LocalModelStateStoragePort {
  return {
    async getItem(key, signal) {
      throwIfAborted(signal)
      const value = await storage.getItem(key)
      throwIfAborted(signal)
      return value
    },
    async setItem(key, value, signal) {
      throwIfAborted(signal)
      await storage.setItem(key, value)
    },
    async removeItem(key, signal) {
      throwIfAborted(signal)
      await storage.removeItem(key)
    },
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  throw error
}
