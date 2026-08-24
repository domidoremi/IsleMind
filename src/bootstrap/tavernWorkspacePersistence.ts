import {
  createKeyValueChatWorkspaceReviewScopePort,
  createKeyValueTavernChatWorkspaceWritebackReceiptLookup,
  createKeyValueTavernChatWorkspaceWritebackStore,
  createKeyValueTavernWorkspaceRepository,
  createSqliteTavernWorkspaceRepository,
  createTavernWorkspacePersistence,
  TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY,
  type ChatWorkspaceReviewScopePort,
  type TavernChatWorkspaceWritebackAtomicStore,
  type TavernChatWorkspaceWritebackDigestProvider,
  type TavernChatWorkspaceWritebackReceiptLookup,
  type TavernWorkspacePersistence,
  type TavernWorkspaceRepository,
  type TavernWorkspaceSnapshotCodec,
} from '@/modules/workspaces'
import {
  createExpoSqliteDatabaseProvider,
  type SqliteDatabaseProvider,
} from '@/platform/storage'
import {
  createAsyncStorageTavernWorkspacePort,
  type AsyncStorageTavernWorkspacePort,
} from '@/platform/workspaces'

const LEGACY_TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY = '@islemind/vnext/tavern-workspaces'
const TAVERN_WORKSPACE_KEY_MIGRATION_LOCK = 'islemind:tavern-workspace:key-migration:v1'

export interface TavernWorkspaceRuntimeDependencies<Snapshot> {
  codec: TavernWorkspaceSnapshotCodec<Snapshot>
  createEmptySnapshot(now: number): Snapshot
  cloneSnapshot(snapshot: Snapshot): Snapshot
  writebackDigestProvider?: TavernChatWorkspaceWritebackDigestProvider
  databaseProvider?: SqliteDatabaseProvider
  now?: () => number
}

export interface TavernWorkspaceRuntime<Snapshot> {
  repository: TavernWorkspaceRepository<Snapshot>
  persistence: TavernWorkspacePersistence<Snapshot>
  keyValueReviewScopePort?: ChatWorkspaceReviewScopePort
  keyValueWritebackStore?: TavernChatWorkspaceWritebackAtomicStore<Snapshot>
  keyValueWritebackReceiptLookup?: TavernChatWorkspaceWritebackReceiptLookup
}

export function createTavernWorkspaceRuntime<Snapshot>(
  dependencies: TavernWorkspaceRuntimeDependencies<Snapshot>,
): TavernWorkspaceRuntime<Snapshot> {
  const now = dependencies.now ?? Date.now
  const keyValueStorage = createTavernWorkspaceStorageMigrationPort(
    createAsyncStorageTavernWorkspacePort(),
  )
  const keyValueRepository = createKeyValueTavernWorkspaceRepository({
    storage: keyValueStorage,
    codec: dependencies.codec,
    now,
  })
  const keyValueReviewScopePort = keyValueStorage.lockScope === 'cross-context'
    ? createKeyValueChatWorkspaceReviewScopePort({
        storage: keyValueStorage,
        codec: dependencies.codec,
        createEmptySnapshot: dependencies.createEmptySnapshot,
      })
    : undefined
  const keyValueWritebackStore = keyValueStorage.lockScope === 'cross-context'
    && dependencies.writebackDigestProvider
    ? createKeyValueTavernChatWorkspaceWritebackStore({
        storage: keyValueStorage,
        codec: dependencies.codec,
        digestProvider: dependencies.writebackDigestProvider,
      })
    : undefined
  const keyValueWritebackReceiptLookup = keyValueStorage.lockScope === 'cross-context'
    ? createKeyValueTavernChatWorkspaceWritebackReceiptLookup({
        storage: keyValueStorage,
        codec: dependencies.codec,
      })
    : undefined
  const nativeDatabaseProvider = isReactNativeRuntime()
    ? dependencies.databaseProvider ?? createExpoSqliteDatabaseProvider()
    : undefined
  const repository = nativeDatabaseProvider
    ? createSqliteTavernWorkspaceRepository({
        databaseProvider: nativeDatabaseProvider,
        codec: dependencies.codec,
        now,
      })
    : keyValueRepository
  const persistence = createTavernWorkspacePersistence({
    repository,
    createEmptySnapshot: dependencies.createEmptySnapshot,
    cloneSnapshot: dependencies.cloneSnapshot,
    now,
  })

  return Object.freeze({
    repository,
    persistence,
    keyValueReviewScopePort,
    keyValueWritebackStore,
    keyValueWritebackReceiptLookup,
  })
}

function isReactNativeRuntime(): boolean {
  return (globalThis as { navigator?: { product?: string } }).navigator?.product === 'ReactNative'
}

function createTavernWorkspaceStorageMigrationPort(
  storage: AsyncStorageTavernWorkspacePort,
): AsyncStorageTavernWorkspacePort {
  let migrationPromise: Promise<void> | undefined

  function ensureMigrated(signal?: AbortSignal): Promise<void> {
    if (migrationPromise) return migrationPromise
    const current = storage.runExclusive(TAVERN_WORKSPACE_KEY_MIGRATION_LOCK, async () => {
      const canonical = await storage.get(TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY, signal)
      const legacy = await storage.get(LEGACY_TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY, signal)
      if (legacy == null) return
      if (canonical != null && canonical !== legacy) {
        throw new Error('Tavern workspace storage-key migration found divergent durable records.')
      }
      if (canonical == null) {
        await storage.set(TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY, legacy, signal)
        if (await storage.get(TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY) !== legacy) {
          throw new Error('Tavern workspace storage-key migration could not verify the canonical record.')
        }
      }
      await storage.remove(LEGACY_TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY, signal)
      if (await storage.get(LEGACY_TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY) != null) {
        throw new Error('Tavern workspace storage-key migration could not remove the legacy record.')
      }
    })
    const guarded = current.catch((error: unknown) => {
      if (migrationPromise === guarded) migrationPromise = undefined
      throw error
    })
    migrationPromise = guarded
    return guarded
  }

  return Object.freeze({
    lockScope: storage.lockScope,
    async get(key: string, signal?: AbortSignal): Promise<string | null | undefined> {
      await ensureMigrated(signal)
      return storage.get(key, signal)
    },
    async set(key: string, value: string, signal?: AbortSignal): Promise<void> {
      await ensureMigrated(signal)
      return storage.set(key, value, signal)
    },
    async remove(key: string, signal?: AbortSignal): Promise<void> {
      await ensureMigrated(signal)
      return storage.remove(key, signal)
    },
    async runExclusive<Value>(key: string, work: () => Promise<Value>): Promise<Value> {
      await ensureMigrated()
      return storage.runExclusive(key, work)
    },
    async getAllKeys(signal?: AbortSignal): Promise<readonly string[]> {
      await ensureMigrated(signal)
      return storage.getAllKeys(signal)
    },
  } satisfies AsyncStorageTavernWorkspacePort)
}
