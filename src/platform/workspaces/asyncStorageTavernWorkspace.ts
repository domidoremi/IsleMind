import AsyncStorage from '@react-native-async-storage/async-storage'

const fallbackLockTails = new Map<string, Promise<void>>()

export interface AsyncStorageTavernWorkspaceAdapter {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
  getAllKeys?(): Promise<readonly string[]>
}

export interface AsyncStorageTavernWorkspacePort {
  readonly lockScope: 'cross-context' | 'runtime-only'
  get(key: string, signal?: AbortSignal): Promise<string | null | undefined>
  set(key: string, value: string, signal?: AbortSignal): Promise<void>
  remove(key: string, signal?: AbortSignal): Promise<void>
  runExclusive<Value>(key: string, work: () => Promise<Value>): Promise<Value>
  getAllKeys(signal?: AbortSignal): Promise<readonly string[]>
}

export function createAsyncStorageTavernWorkspacePort(
  storage: AsyncStorageTavernWorkspaceAdapter = AsyncStorage,
): AsyncStorageTavernWorkspacePort {
  const webLocks = resolveWebLockManager()
  return {
    lockScope: webLocks ? 'cross-context' : 'runtime-only',
    async get(key, signal) {
      throwIfAborted(signal)
      const value = await storage.getItem(key)
      throwIfAborted(signal)
      return value
    },
    async set(key, value, signal) {
      throwIfAborted(signal)
      await storage.setItem(key, value)
    },
    async remove(key, signal) {
      throwIfAborted(signal)
      await storage.removeItem(key)
    },
    async getAllKeys(signal) {
      throwIfAborted(signal)
      const keys = storage.getAllKeys ? await storage.getAllKeys() : []
      throwIfAborted(signal)
      return [...keys]
    },
    runExclusive(key, work) {
      return runWithWebOrRuntimeLock(key, work, webLocks)
    },
  }
}

interface TavernWorkspaceWebLockManager {
  request<Value>(name: string, options: { mode: 'exclusive' }, callback: () => Promise<Value>): Promise<Value>
}

function resolveWebLockManager(): TavernWorkspaceWebLockManager | undefined {
  return (globalThis as {
    navigator?: {
      locks?: TavernWorkspaceWebLockManager
    }
  }).navigator?.locks
}

function runWithWebOrRuntimeLock<Value>(
  key: string,
  work: () => Promise<Value>,
  webLocks: TavernWorkspaceWebLockManager | undefined,
): Promise<Value> {
  if (webLocks) {
    return webLocks.request(`islemind:tavern-workspace:${key}`, { mode: 'exclusive' }, work)
  }

  const previous = fallbackLockTails.get(key) ?? Promise.resolve()
  const scheduled = previous.then(work, work)
  const tail = scheduled.then(() => undefined, () => undefined)
  fallbackLockTails.set(key, tail)
  void tail.finally(() => {
    if (fallbackLockTails.get(key) === tail) fallbackLockTails.delete(key)
  })
  return scheduled
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  const error = new Error('The Tavern workspace persistence operation was aborted.')
  error.name = 'AbortError'
  throw error
}
