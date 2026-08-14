import { createTavernWorkspaceRuntime } from '@/bootstrap/tavernWorkspacePersistence'
import * as Crypto from 'expo-crypto'

import {
  createAssistantConversationWorkspaceWritebackHandoffRuntime,
  type AssistantConversationWorkspaceWritebackHandoff,
} from '@/modules/assistant-runtime'
import {
  createChatWorkspaceReviewRuntime,
  createChatWorkspaceWritebackRuntime,
  cloneCanonicalTavernSnapshot,
  createConversationWorkspaceSourceRuntime,
  createEmptyTavernSnapshot,
  createTavernChatWorkspaceWritebackAdapter,
  createSqliteTavernChatWorkspaceWritebackStore,
  createSqliteTavernChatWorkspaceWritebackReceiptLookup,
  createSqliteChatWorkspaceReviewScopePort,
  createTavernChatWorkspaceWritebackChangeSetResolver,
  createTavernPortableWorkspaceImportRuntime,
  createTavernWorkspaceApplication,
  isValidConversationWorkspaceContext,
  tavernSnapshotCodec,
  type ChatWorkspaceReviewRuntime,
  type ChatWorkspaceWritebackRuntime,
  type TavernChatWorkspaceWritebackChangeSetResolver,
  type TavernChatWorkspaceWritebackDigestProvider,
  type TavernChatWorkspaceWritebackReceiptLookup,
  type TavernPortableWorkspaceBackupStore,
  type TavernPortableWorkspaceImportResult,
  type TavernSnapshot,
} from '@/modules/workspaces'
import { createExpoSqliteDatabaseProvider } from '@/platform/storage'
import { createAsyncStorageTavernWorkspacePort } from '@/platform/workspaces'

const now = () => Date.now()
const TAVERN_PORTABLE_WORKSPACE_BACKUP_KEY_PREFIX =
  '@islemind/vnext/tavern-workspaces/portable-import/backup-v1/'
const PORTABLE_IMPORT_OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/
const tavernWorkspaceDatabaseProvider = createExpoSqliteDatabaseProvider()
const tavernChatWorkspaceWritebackDigestProvider: TavernChatWorkspaceWritebackDigestProvider = {
  async digestCanonicalPayload(canonicalPayload, options) {
    return digestTavernWorkspaceValue(canonicalPayload, options.signal)
  },
}

const tavernWorkspaceRuntime = createTavernWorkspaceRuntime<TavernSnapshot>({
  codec: tavernSnapshotCodec,
  createEmptySnapshot: createEmptyTavernSnapshot,
  cloneSnapshot: cloneCanonicalTavernSnapshot,
  databaseProvider: tavernWorkspaceDatabaseProvider,
  writebackDigestProvider: tavernChatWorkspaceWritebackDigestProvider,
  now,
})

const conversationWorkspaceSourceRuntime =
  createConversationWorkspaceSourceRuntime({
    repositorySnapshot: {
      load: (options) => tavernWorkspaceRuntime.persistence.loadAll(options),
    },
    now,
  })

export const conversationAssistantWorkspaceWritebackHandoffRuntime =
  createAssistantConversationWorkspaceWritebackHandoffRuntime({
    isValidWorkspaceContext: isValidConversationWorkspaceContext,
    idempotencyDigest: tavernChatWorkspaceWritebackDigestProvider,
  })

export const conversationAssistantWorkspaceSourceRuntime = Object.freeze({
  async resolve(
    input: Parameters<typeof conversationWorkspaceSourceRuntime.capture>[0],
    options: Parameters<typeof conversationWorkspaceSourceRuntime.capture>[1],
  ) {
    const outcome = await conversationWorkspaceSourceRuntime.capture(input, options)
    if (outcome.status !== 'ready') return outcome
    if (!isReactNativeRuntime() && !tavernWorkspaceRuntime.keyValueWritebackStore) {
      return Object.freeze({
        status: 'failed' as const,
        code: 'atomic_writeback_unavailable' as const,
      })
    }
    return outcome
  },
})

const tavernWorkspaceApplication = createTavernWorkspaceApplication({
  persistence: tavernWorkspaceRuntime.persistence,
  now,
})

const tavernPortableWorkspaceBackupStorage = createAsyncStorageTavernWorkspacePort()
const tavernPortableWorkspaceBackupStore: TavernPortableWorkspaceBackupStore = {
  read(backupId, signal) {
    return tavernPortableWorkspaceBackupStorage.get(
      portableWorkspaceBackupStorageKey(backupId),
      signal,
    )
  },
  create(backupId, value, signal) {
    const key = portableWorkspaceBackupStorageKey(backupId)
    return tavernPortableWorkspaceBackupStorage.runExclusive(key, async () => {
      throwIfCancelled(signal)
      const existing = await tavernPortableWorkspaceBackupStorage.get(key, signal)
      if (existing != null) return 'exists' as const
      await tavernPortableWorkspaceBackupStorage.set(key, value, signal)
      const persisted = await tavernPortableWorkspaceBackupStorage.get(key)
      if (persisted !== value) {
        throw new Error('The Tavern portable workspace backup could not be verified exactly.')
      }
      return 'created' as const
    })
  },
}
const tavernPortableWorkspaceImportRuntime = createTavernPortableWorkspaceImportRuntime({
  repository: tavernWorkspaceRuntime.repository,
  backups: tavernPortableWorkspaceBackupStore,
  digest: { digest: digestTavernWorkspaceValue },
  now,
})

const tavernChatWorkspaceReviewScopePort = isReactNativeRuntime()
  ? createSqliteChatWorkspaceReviewScopePort({
      runtime: 'native',
      databaseProvider: tavernWorkspaceDatabaseProvider,
      codec: tavernSnapshotCodec,
      createEmptySnapshot: createEmptyTavernSnapshot,
    })
  : tavernWorkspaceRuntime.keyValueReviewScopePort

const tavernChatWorkspaceReviewRuntime = tavernChatWorkspaceReviewScopePort
  ? createChatWorkspaceReviewRuntime({
      application: tavernWorkspaceApplication,
      scopePort: tavernChatWorkspaceReviewScopePort,
      now,
    })
  : undefined

export const {
  loadTavernSnapshot,
  saveTavernSnapshot,
  clearTavernSnapshot,
  exportTavernSnapshot,
  listTavernScopeIds,
  resolveTavernActiveScopeId,
  setTavernActiveScopeId,
  exportTavernActiveScopeLinks,
  duplicateTavernScope,
  exportTavernSnapshots,
  importTavernWorkspaceState,
} = tavernWorkspaceApplication

export function resolveChatWorkspaceReviewRuntime(): ChatWorkspaceReviewRuntime | undefined {
  return tavernChatWorkspaceReviewRuntime
}

export async function importPortableTavernWorkspaceState(input: {
  readonly backupId: string
  readonly entries: readonly {
    scopeId?: string
    snapshot: Partial<TavernSnapshot> | undefined
  }[]
  readonly activeScopeLinks?: Record<string, string>
  readonly conversationIds?: readonly string[]
  readonly signal?: AbortSignal
}): Promise<TavernPortableWorkspaceImportResult> {
  throwIfCancelled(input.signal)
  return tavernPortableWorkspaceImportRuntime.importWorkspace({
    backupId: input.backupId,
    entries: input.entries,
    activeScopeLinks: input.activeScopeLinks,
    activeScopeOptions: { conversationIds: input.conversationIds },
  }, { signal: input.signal })
}

export async function resolvePortableTavernWorkspaceBackupId(input: {
  readonly operationId: string
  readonly portableSource: string
  readonly signal?: AbortSignal
}): Promise<string> {
  if (!PORTABLE_IMPORT_OPERATION_ID_PATTERN.test(input.operationId)) {
    throw new TypeError('The portable import operation identifier is invalid.')
  }
  const sourceDigest = await digestTavernWorkspaceValue(input.portableSource, input.signal)
  return `portable-import:${input.operationId}:${sourceDigest.slice('sha256:'.length)}`
}

export async function restorePortableTavernWorkspaceBackup(
  backupId: string,
  options: { signal?: AbortSignal } = {},
): Promise<TavernPortableWorkspaceImportResult> {
  throwIfCancelled(options.signal)
  return tavernPortableWorkspaceImportRuntime.restore(backupId, options)
}

export async function cleanupPortableTavernWorkspaceBackup(backupId: string): Promise<void> {
  const key = portableWorkspaceBackupStorageKey(backupId)
  await tavernPortableWorkspaceBackupStorage.runExclusive(key, async () => {
    if (await tavernPortableWorkspaceBackupStorage.get(key) == null) return
    await tavernPortableWorkspaceBackupStorage.remove(key)
    if (await tavernPortableWorkspaceBackupStorage.get(key) != null) {
      throw new Error('The Tavern portable workspace backup could not be removed exactly.')
    }
  })
}

export function createTavernChatWorkspaceWritebackRuntime(
  resolver: TavernChatWorkspaceWritebackChangeSetResolver,
): ChatWorkspaceWritebackRuntime | undefined {
  const store = isReactNativeRuntime()
    ? createSqliteTavernChatWorkspaceWritebackStore<TavernSnapshot>({
        runtime: 'native',
        databaseProvider: tavernWorkspaceDatabaseProvider,
        codec: tavernSnapshotCodec,
        digestProvider: tavernChatWorkspaceWritebackDigestProvider,
      })
    : tavernWorkspaceRuntime.keyValueWritebackStore
  if (!store) return undefined
  return createChatWorkspaceWritebackRuntime({
    port: createTavernChatWorkspaceWritebackAdapter({
      resolver,
      store,
      digestProvider: tavernChatWorkspaceWritebackDigestProvider,
    }),
  })
}

export function createTavernChatWorkspaceWritebackReceiptLookup():
  TavernChatWorkspaceWritebackReceiptLookup | undefined {
  return isReactNativeRuntime()
    ? createSqliteTavernChatWorkspaceWritebackReceiptLookup({
        runtime: 'native',
        databaseProvider: tavernWorkspaceDatabaseProvider,
      })
    : tavernWorkspaceRuntime.keyValueWritebackReceiptLookup
}

export async function finalizeTavernChatWorkspaceWriteback(input: {
  readonly handoff: AssistantConversationWorkspaceWritebackHandoff
  readonly finalOutput: string
  readonly signal: AbortSignal
}) {
  const resolver = createTavernChatWorkspaceWritebackChangeSetResolver({
    handoff: input.handoff,
    digestProvider: tavernChatWorkspaceWritebackDigestProvider,
  })
  const runtime = createTavernChatWorkspaceWritebackRuntime(resolver)
  if (!runtime) return Object.freeze({ status: 'unavailable' as const })

  return runtime.writeback({
    assistantRunId: input.handoff.assistantRunId,
    conversationId: input.handoff.conversationId,
    assistantMessageId: input.handoff.assistantMessageId,
    workspaceId: input.handoff.workspaceId,
    expectedAuthorityRevision: input.handoff.repositoryAuthorityRevision,
    idempotencyKey: input.handoff.idempotencyKey,
    finalOutput: input.finalOutput,
  }, { signal: input.signal })
}

async function digestTavernWorkspaceValue(
  value: string,
  signal?: AbortSignal,
): Promise<string> {
  throwIfCancelled(signal)
  throwIfCancelled(signal)
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    value,
    { encoding: Crypto.CryptoEncoding.HEX },
  )
  throwIfCancelled(signal)
  return `sha256:${digest.toLowerCase()}`
}

function portableWorkspaceBackupStorageKey(backupId: string): string {
  return `${TAVERN_PORTABLE_WORKSPACE_BACKUP_KEY_PREFIX}${backupId}`
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new Error('The Tavern Chat workspace writeback was cancelled.')
  }
}

function isReactNativeRuntime(): boolean {
  return (globalThis as { navigator?: { product?: string } }).navigator?.product === 'ReactNative'
}
