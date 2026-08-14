import {
  createKeyValueChatWorkspaceReviewScopePort,
  createKeyValueTavernChatWorkspaceWritebackReceiptLookup,
  createKeyValueTavernChatWorkspaceWritebackStore,
  createKeyValueTavernWorkspaceRepository,
  createSqliteTavernWorkspaceRepository,
  createTavernWorkspacePersistence,
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
import { createAsyncStorageTavernWorkspacePort } from '@/platform/workspaces'

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
  const keyValueStorage = createAsyncStorageTavernWorkspacePort()
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
