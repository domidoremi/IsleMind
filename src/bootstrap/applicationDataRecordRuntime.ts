import type { ApplicationRecordStoragePort } from '@/platform/storage'

export const APPLICATION_DATA_STORAGE_KEYS = Object.freeze({
  SETTINGS: '@islemind/settings',
  PROVIDERS: '@islemind/providers',
  ACTIVE_CONVERSATION: '@islemind/active-conversation',
  SKILLS: '@islemind/skills',
  MCP_SERVERS: '@islemind/mcp-servers',
  TOOLCHAIN_REGISTERED_CATALOG: '@islemind/toolchain-registered-catalog',
})

export type ApplicationDataStorageKey = keyof typeof APPLICATION_DATA_STORAGE_KEYS

export type ApplicationDataRecordOperation = 'load' | 'save' | 'remove'

export class ApplicationDataRecordPersistenceError extends Error {
  constructor(
    readonly operation: ApplicationDataRecordOperation,
    readonly storageKey: ApplicationDataStorageKey,
  ) {
    super(`Application data record ${operation} failed.`)
    this.name = 'ApplicationDataRecordPersistenceError'
  }
}

export interface ApplicationDataRecordRuntimeDependencies {
  readonly storage: ApplicationRecordStoragePort
  reportFailure(input: {
    operation: ApplicationDataRecordOperation
    storageKey: ApplicationDataStorageKey
    error: unknown
  }): void | Promise<void>
}

export function createApplicationDataRecordRuntime(
  dependencies: ApplicationDataRecordRuntimeDependencies,
) {
  async function fail(
    operation: ApplicationDataRecordOperation,
    storageKey: ApplicationDataStorageKey,
    error: unknown,
  ): Promise<never> {
    try {
      await dependencies.reportFailure({ operation, storageKey, error })
    } catch {
      // Diagnostics cannot replace the stable persistence failure contract.
    }
    throw new ApplicationDataRecordPersistenceError(operation, storageKey)
  }

  async function read<T>(key: ApplicationDataStorageKey): Promise<T | null> {
    try {
      const raw = await dependencies.storage.read(APPLICATION_DATA_STORAGE_KEYS[key])
      return raw === null ? null : JSON.parse(raw)
    } catch (error) {
      return fail('load', key, error)
    }
  }

  async function write<T>(key: ApplicationDataStorageKey, data: T): Promise<void> {
    try {
      await dependencies.storage.write(
        APPLICATION_DATA_STORAGE_KEYS[key],
        JSON.stringify(data),
      )
    } catch (error) {
      return fail('save', key, error)
    }
  }

  async function remove(key: ApplicationDataStorageKey): Promise<void> {
    try {
      await dependencies.storage.remove(APPLICATION_DATA_STORAGE_KEYS[key])
    } catch (error) {
      return fail('remove', key, error)
    }
  }

  return Object.freeze({
    read,
    write,
    remove,
    removeRaw: (keys: readonly string[]) => dependencies.storage.removeMany(keys),
    async loadCompatibility<T>(key: ApplicationDataStorageKey): Promise<T | null> {
      try {
        return await read<T>(key)
      } catch (error) {
        if (error instanceof ApplicationDataRecordPersistenceError) return null
        throw error
      }
    },
    async saveCompatibility<T>(key: ApplicationDataStorageKey, data: T): Promise<void> {
      try {
        await write(key, data)
      } catch (error) {
        if (!(error instanceof ApplicationDataRecordPersistenceError)) throw error
      }
    },
    async removeCompatibility(key: ApplicationDataStorageKey): Promise<void> {
      try {
        await remove(key)
      } catch (error) {
        if (!(error instanceof ApplicationDataRecordPersistenceError)) throw error
      }
    },
  })
}
