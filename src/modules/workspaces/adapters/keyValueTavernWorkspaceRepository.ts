import { err, ok } from '@/core'
import {
  normalizeTavernWorkspaceScopeId,
  TAVERN_WORKSPACE_REPOSITORY_SNAPSHOT_SCHEMA,
  TAVERN_WORKSPACE_SCOPE_RECORD_SCHEMA,
  type CreateTavernWorkspaceScopeInput,
  type ReplaceTavernWorkspaceRepositoryInput,
  type TavernWorkspaceRepository,
  type TavernWorkspaceRepositoryErrorCode,
  type TavernWorkspaceRepositoryOptions,
  type TavernWorkspaceRepositoryResult,
  type TavernWorkspaceRepositorySnapshot,
  type TavernWorkspaceReplacementScope,
  type TavernWorkspaceScopeRecord,
  type TavernWorkspaceSnapshotCodec,
} from '../application/tavernWorkspaceRepository'
import type { ChatWorkspaceReviewScopePort } from '../application/chatWorkspaceReviewRuntime'
import {
  CHAT_WORKSPACE_WRITEBACK_FINAL_OUTPUT_MAX_CHARACTERS,
  CHAT_WORKSPACE_WRITEBACK_IDEMPOTENCY_KEY_MAX_CHARACTERS,
  CHAT_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS,
} from '../application/chatWorkspaceWritebackRuntime'
import {
  canonicalizeTavernChatWorkspaceWritebackChangeSet,
  TAVERN_CHAT_WORKSPACE_WRITEBACK_CHANGE_SET_SCHEMA,
  type TavernChatWorkspaceWritebackAtomicStore,
  type TavernChatWorkspaceWritebackAtomicStoreResult,
  type TavernChatWorkspaceWritebackChangeSet,
  type TavernChatWorkspaceWritebackDigestProvider,
  type TavernChatWorkspaceWritebackMutationResult,
} from '../application/tavernChatWorkspaceWritebackAdapter'
import type {
  TavernChatWorkspaceWritebackCommittedReceipt,
  TavernChatWorkspaceWritebackReceiptLookup,
  TavernChatWorkspaceWritebackReceiptLookupIdentity,
  TavernChatWorkspaceWritebackReceiptLookupOutcome,
} from '../application/tavernChatWorkspaceWritebackReceiptLookup'
export const TAVERN_WORKSPACE_KEY_VALUE_ENVELOPE_SCHEMA = 'islemind.tavern-workspace-key-value.v2'
export const TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY = '@islemind/tavern-workspaces'
export const TAVERN_CHAT_WORKSPACE_KEY_VALUE_WRITEBACK_RECEIPT_RECORD_SCHEMA =
  'islemind.tavern-chat-workspace-key-value-writeback-receipt.v1' as const

const DEFAULT_MAX_ENVELOPE_CHARACTERS = 16 * 1024 * 1024
const MAX_SCOPE_COUNT = 512
const MAX_ACTIVE_SCOPE_LINK_COUNT = 2_048
const MAX_WRITEBACK_RECEIPT_COUNT = 4_096
const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/
const fallbackStorageLockTails = new Map<string, Promise<void>>()

export interface TavernWorkspaceKeyValuePort {
  get(key: string, signal?: AbortSignal): Promise<string | null | undefined>
  set(key: string, value: string, signal?: AbortSignal): Promise<void>
  remove(key: string, signal?: AbortSignal): Promise<void>
  runExclusive?<Value>(key: string, work: () => Promise<Value>): Promise<Value>
}

export interface KeyValueTavernWorkspaceRepositoryDependencies<Snapshot> {
  storage: TavernWorkspaceKeyValuePort
  codec: TavernWorkspaceSnapshotCodec<Snapshot>
  storageKey?: string
  now?: () => number
  maxEnvelopeCharacters?: number
}

export interface KeyValueChatWorkspaceReviewScopePortDependencies<Snapshot> {
  readonly storage: TavernWorkspaceKeyValuePort
  readonly codec: TavernWorkspaceSnapshotCodec<Snapshot>
  readonly createEmptySnapshot: (updatedAt: number) => Snapshot
  readonly storageKey?: string
  readonly maxEnvelopeCharacters?: number
}

export interface KeyValueTavernChatWorkspaceWritebackStoreDependencies<Snapshot> {
  readonly storage: TavernWorkspaceKeyValuePort
  readonly codec: TavernWorkspaceSnapshotCodec<Snapshot>
  readonly digestProvider: TavernChatWorkspaceWritebackDigestProvider
  readonly storageKey?: string
  readonly maxEnvelopeCharacters?: number
}

export interface KeyValueTavernChatWorkspaceWritebackReceiptLookupDependencies<Snapshot> {
  readonly storage: TavernWorkspaceKeyValuePort
  readonly codec: TavernWorkspaceSnapshotCodec<Snapshot>
  readonly storageKey?: string
  readonly maxEnvelopeCharacters?: number
}

interface KeyValueWritebackReceipt {
  readonly schema: typeof TAVERN_CHAT_WORKSPACE_KEY_VALUE_WRITEBACK_RECEIPT_RECORD_SCHEMA
  readonly workspaceId: string
  readonly idempotencyKey: string
  readonly changeSetDigest: string
  readonly assistantRunId: string
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly expectedAuthorityRevision: number
  readonly activeScopeId: string
  readonly outcomeStatus: 'applied' | 'no_changes'
  readonly authorityRevision: number
  readonly createdAt: number
}

interface TavernWorkspaceKeyValueEnvelope<Snapshot> {
  schema: typeof TAVERN_WORKSPACE_KEY_VALUE_ENVELOPE_SCHEMA
  snapshotSchema: string
  revision: number
  scopes: TavernWorkspaceScopeRecord<Snapshot>[]
  activeScopeLinks: Record<string, string>
  writebackReceipts: KeyValueWritebackReceipt[]
  updatedAt: number
}

interface PreparedScope<Snapshot> {
  scopeId: string
  snapshot: Snapshot
  updatedAt: number
}

class KeyValueTavernWorkspaceCancellationError extends Error {}
class KeyValueTavernWorkspaceCorruptionError extends Error {}

/**
 * Single-envelope Tavern persistence for web/key-value stores. Mutations are
 * serialized under the exact storage-key lock so read-check-write CAS remains coherent.
 */
export function createKeyValueTavernWorkspaceRepository<Snapshot>(
  dependencies: KeyValueTavernWorkspaceRepositoryDependencies<Snapshot>,
): TavernWorkspaceRepository<Snapshot> {
  const storageKey = dependencies.storageKey ?? TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY
  const now = dependencies.now ?? Date.now
  const maxEnvelopeCharacters = dependencies.maxEnvelopeCharacters ?? DEFAULT_MAX_ENVELOPE_CHARACTERS
  if (!isBoundedText(storageKey, 512) || !isBoundedText(dependencies.codec.schema, 160) ||
      !Number.isSafeInteger(maxEnvelopeCharacters) || maxEnvelopeCharacters < 1) {
    throw new TypeError('The Tavern workspace key-value repository configuration is invalid.')
  }

  let mutationTail: Promise<void> = Promise.resolve()

  function execute<Value>(
    options: TavernWorkspaceRepositoryOptions | undefined,
    work: (signal: AbortSignal | undefined) => Promise<TavernWorkspaceRepositoryResult<Value>>,
    committedSuccessWins = false,
  ): Promise<TavernWorkspaceRepositoryResult<Value>> {
    const signal = options?.signal
    if (signal?.aborted) return Promise.resolve(cancelled())
    return work(signal)
      .then((result) => signal?.aborted && !(committedSuccessWins && result.ok) ? cancelled<Value>() : result)
      .catch((error: unknown) => mapFailure(error, signal))
  }

  function mutate<Value>(
    options: TavernWorkspaceRepositoryOptions | undefined,
    work: (signal: AbortSignal | undefined) => Promise<TavernWorkspaceRepositoryResult<Value>>,
  ): Promise<TavernWorkspaceRepositoryResult<Value>> {
    const signal = options?.signal
    if (signal?.aborted) return Promise.resolve(cancelled())
    const executeMutation = () => runWithStorageKeyLock(
      dependencies.storage,
      storageKey,
      () => execute(options, work, true),
    )
    const scheduled = mutationTail.then(executeMutation, executeMutation)
    mutationTail = scheduled.then(() => undefined, () => undefined)
    return scheduled
  }

  async function readEnvelope(signal?: AbortSignal): Promise<TavernWorkspaceKeyValueEnvelope<Snapshot>> {
    throwIfCancelled(signal)
    const raw = await dependencies.storage.get(storageKey, signal)
    throwIfCancelled(signal)
    if (raw == null) return emptyEnvelope(dependencies.codec.schema)
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > maxEnvelopeCharacters) {
      throw new KeyValueTavernWorkspaceCorruptionError('The Tavern workspace key-value envelope is invalid or oversized.')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new KeyValueTavernWorkspaceCorruptionError('The Tavern workspace key-value envelope is not valid JSON.')
    }
    return parseEnvelope(parsed, dependencies.codec, maxEnvelopeCharacters)
  }

  async function persistEnvelope(
    envelope: TavernWorkspaceKeyValueEnvelope<Snapshot>,
    signal?: AbortSignal,
  ): Promise<TavernWorkspaceKeyValueEnvelope<Snapshot>> {
    const canonical = parseEnvelope(envelope, dependencies.codec, maxEnvelopeCharacters)
    const serialized = JSON.stringify(canonical)
    if (serialized.length > maxEnvelopeCharacters) {
      return Promise.reject(new KeyValueTavernWorkspaceCorruptionError('The Tavern workspace key-value envelope exceeds its persistence limit.'))
    }
    throwIfCancelled(signal)
    await dependencies.storage.set(storageKey, serialized, signal)
    return parseEnvelope(JSON.parse(serialized), dependencies.codec, maxEnvelopeCharacters)
  }

  return {
    load(options) {
      return execute(options, async (signal) => ok(toRepositorySnapshot(await readEnvelope(signal))))
    },

    getScope(scopeId, options) {
      const normalizedScopeId = normalizeTavernWorkspaceScopeId(scopeId)
      if (options?.signal?.aborted) return Promise.resolve(cancelled())
      if (!normalizedScopeId) return Promise.resolve(failure('invalid_scope', 'The Tavern workspace scope identifier is invalid.'))
      return execute(options, async (signal) => {
        const envelope = await readEnvelope(signal)
        const record = envelope.scopes.find((candidate) => candidate.scopeId === normalizedScopeId)
        return record
          ? ok(cloneScopeRecord(record, dependencies.codec, maxEnvelopeCharacters))
          : failure('not_found', 'The Tavern workspace scope was not found.', false, normalizedScopeId)
      })
    },

    createScope(input, options) {
      if (options?.signal?.aborted) return Promise.resolve(cancelled())
      const prepared = prepareScope(input, dependencies.codec, maxEnvelopeCharacters, now)
      if (!prepared.ok) return Promise.resolve(prepared)
      return mutate(options, async (signal) => {
        const envelope = await readEnvelope(signal)
        if (envelope.scopes.some((scope) => scope.scopeId === prepared.value.scopeId)) {
          return failure('duplicate', 'The Tavern workspace scope already exists.', false, prepared.value.scopeId)
        }
        if (envelope.scopes.length >= MAX_SCOPE_COUNT) {
          return failure('validation_failed', 'The Tavern workspace scope limit has been reached.')
        }
        const record = toScopeRecord(prepared.value, 1)
        envelope.scopes.unshift(record)
        advanceEnvelope(envelope, prepared.value.updatedAt)
        const persisted = await persistEnvelope(envelope, signal)
        return ok(cloneScopeRecord(findScope(persisted, record.scopeId), dependencies.codec, maxEnvelopeCharacters))
      })
    },

    saveScope(input, options) {
      if (options?.signal?.aborted) return Promise.resolve(cancelled())
      if (!isPositiveRevision(input.expectedRevision)) {
        return Promise.resolve(failure('validation_failed', 'The expected Tavern workspace revision is invalid.'))
      }
      const prepared = prepareScope(input, dependencies.codec, maxEnvelopeCharacters, now)
      if (!prepared.ok) return Promise.resolve(prepared)
      return mutate(options, async (signal) => {
        const envelope = await readEnvelope(signal)
        const index = envelope.scopes.findIndex((scope) => scope.scopeId === prepared.value.scopeId)
        if (index < 0) return failure('not_found', 'The Tavern workspace scope was not found.', false, prepared.value.scopeId)
        const current = envelope.scopes[index]!
        if (current.revision !== input.expectedRevision) return scopeConflict(current.scopeId, current.revision)
        const record = toScopeRecord(prepared.value, current.revision + 1)
        envelope.scopes.splice(index, 1)
        envelope.scopes.unshift(record)
        advanceEnvelope(envelope, record.updatedAt)
        const persisted = await persistEnvelope(envelope, signal)
        return ok(cloneScopeRecord(findScope(persisted, record.scopeId), dependencies.codec, maxEnvelopeCharacters))
      })
    },

    deleteScope(input, options) {
      if (options?.signal?.aborted) return Promise.resolve(cancelled())
      const scopeId = normalizeTavernWorkspaceScopeId(input.scopeId)
      const updatedAt = input.updatedAt ?? now()
      if (!scopeId) return Promise.resolve(failure('invalid_scope', 'The Tavern workspace scope identifier is invalid.'))
      if (!isPositiveRevision(input.expectedRevision) || !isTimestamp(updatedAt)) {
        return Promise.resolve(failure('validation_failed', 'The Tavern workspace deletion input is invalid.'))
      }
      return mutate(options, async (signal) => {
        const envelope = await readEnvelope(signal)
        const index = envelope.scopes.findIndex((scope) => scope.scopeId === scopeId)
        if (index < 0) return failure('not_found', 'The Tavern workspace scope was not found.', false, scopeId)
        const current = envelope.scopes[index]!
        if (current.revision !== input.expectedRevision) return scopeConflict(scopeId, current.revision)
        envelope.scopes.splice(index, 1)
        envelope.activeScopeLinks = Object.fromEntries(
          Object.entries(envelope.activeScopeLinks)
            .filter(([conversationScopeId, activeScopeId]) => conversationScopeId !== scopeId && activeScopeId !== scopeId),
        )
        advanceEnvelope(envelope, updatedAt)
        const persisted = await persistEnvelope(envelope, signal)
        return ok({ repositoryRevision: persisted.revision })
      })
    },

    duplicateScope(input, options) {
      if (options?.signal?.aborted) return Promise.resolve(cancelled())
      const sourceScopeId = normalizeTavernWorkspaceScopeId(input.sourceScopeId)
      const targetScopeId = normalizeTavernWorkspaceScopeId(input.targetScopeId)
      const updatedAt = input.updatedAt ?? now()
      if (!sourceScopeId || !targetScopeId) {
        return Promise.resolve(failure('invalid_scope', 'A Tavern workspace scope identifier is invalid.'))
      }
      if (sourceScopeId === targetScopeId) {
        return Promise.resolve(failure('duplicate', 'The Tavern workspace duplicate target matches its source.', false, targetScopeId))
      }
      if (!isPositiveRevision(input.expectedSourceRevision) || !isTimestamp(updatedAt)) {
        return Promise.resolve(failure('validation_failed', 'The Tavern workspace duplicate input is invalid.'))
      }
      return mutate(options, async (signal) => {
        const envelope = await readEnvelope(signal)
        const source = envelope.scopes.find((scope) => scope.scopeId === sourceScopeId)
        if (!source) return failure('not_found', 'The Tavern workspace source scope was not found.', false, sourceScopeId)
        if (source.revision !== input.expectedSourceRevision) return scopeConflict(sourceScopeId, source.revision)
        if (envelope.scopes.some((scope) => scope.scopeId === targetScopeId)) {
          return failure('duplicate', 'The Tavern workspace target scope already exists.', false, targetScopeId)
        }
        if (envelope.scopes.length >= MAX_SCOPE_COUNT) {
          return failure('validation_failed', 'The Tavern workspace scope limit has been reached.')
        }
        const record: TavernWorkspaceScopeRecord<Snapshot> = {
          schema: TAVERN_WORKSPACE_SCOPE_RECORD_SCHEMA,
          scopeId: targetScopeId,
          revision: 1,
          snapshot: cloneSnapshot(source.snapshot, dependencies.codec, maxEnvelopeCharacters),
          updatedAt,
        }
        envelope.scopes.unshift(record)
        advanceEnvelope(envelope, updatedAt)
        const persisted = await persistEnvelope(envelope, signal)
        return ok(cloneScopeRecord(findScope(persisted, targetScopeId), dependencies.codec, maxEnvelopeCharacters))
      })
    },

    setActiveScope(input, options) {
      if (options?.signal?.aborted) return Promise.resolve(cancelled())
      const conversationScopeId = normalizeTavernWorkspaceScopeId(input.conversationScopeId)
      const activeScopeId = input.activeScopeId == null
        ? conversationScopeId
        : normalizeTavernWorkspaceScopeId(input.activeScopeId)
      const updatedAt = input.updatedAt ?? now()
      if (!conversationScopeId || !activeScopeId) {
        return Promise.resolve(failure('invalid_scope', 'A Tavern workspace active-scope identifier is invalid.'))
      }
      if (!isNonNegativeRevision(input.expectedRepositoryRevision) || !isTimestamp(updatedAt)) {
        return Promise.resolve(failure('validation_failed', 'The Tavern workspace active-scope input is invalid.'))
      }
      return mutate(options, async (signal) => {
        const envelope = await readEnvelope(signal)
        if (envelope.revision !== input.expectedRepositoryRevision) return repositoryConflict(envelope.revision)
        if (activeScopeId !== conversationScopeId && !envelope.scopes.some((scope) => scope.scopeId === activeScopeId)) {
          return failure('not_found', 'The requested Tavern workspace active scope was not found.', false, activeScopeId)
        }
        const storedTarget = Object.hasOwn(envelope.activeScopeLinks, conversationScopeId)
          ? envelope.activeScopeLinks[conversationScopeId]
          : undefined
        const nextStoredTarget = activeScopeId === conversationScopeId ? undefined : activeScopeId
        if (storedTarget === nextStoredTarget || (!storedTarget && !nextStoredTarget)) {
          return ok({ activeScopeId, repositoryRevision: envelope.revision })
        }
        envelope.activeScopeLinks = Object.fromEntries(
          Object.entries(envelope.activeScopeLinks).filter(([candidate]) => candidate !== conversationScopeId),
        )
        if (nextStoredTarget) {
          envelope.activeScopeLinks = Object.fromEntries([
            ...Object.entries(envelope.activeScopeLinks),
            [conversationScopeId, nextStoredTarget],
          ])
        }
        advanceEnvelope(envelope, updatedAt)
        const persisted = await persistEnvelope(envelope, signal)
        return ok({ activeScopeId, repositoryRevision: persisted.revision })
      })
    },

    replaceAll(input, options) {
      if (options?.signal?.aborted) return Promise.resolve(cancelled())
      if (!isNonNegativeRevision(input.expectedRepositoryRevision)) {
        return Promise.resolve(failure('validation_failed', 'The expected Tavern repository revision is invalid.'))
      }
      const prepared = prepareReplacement(input, dependencies.codec, maxEnvelopeCharacters, now)
      if (!prepared.ok) return Promise.resolve(prepared)
      return mutate(options, async (signal) => {
        const current = await readEnvelope(signal)
        if (current.revision !== input.expectedRepositoryRevision) return repositoryConflict(current.revision)
        const envelope: TavernWorkspaceKeyValueEnvelope<Snapshot> = {
          schema: TAVERN_WORKSPACE_KEY_VALUE_ENVELOPE_SCHEMA,
          snapshotSchema: dependencies.codec.schema,
          revision: current.revision + 1,
          scopes: prepared.value.scopes.map((scope) => toScopeRecord(scope, 1)),
          activeScopeLinks: prepared.value.activeScopeLinks,
          writebackReceipts: current.writebackReceipts,
          updatedAt: prepared.value.updatedAt,
        }
        const persisted = await persistEnvelope(envelope, signal)
        return ok(toRepositorySnapshot(persisted))
      })
    },
  }
}

/**
 * Provides one v2 key-value atomic authority boundary for Chat workspace review.
 */
export function createKeyValueChatWorkspaceReviewScopePort<Snapshot>(
  dependencies: KeyValueChatWorkspaceReviewScopePortDependencies<Snapshot>,
): ChatWorkspaceReviewScopePort {
  const storageKey = dependencies.storageKey ?? TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY
  const maxEnvelopeCharacters = dependencies.maxEnvelopeCharacters ?? DEFAULT_MAX_ENVELOPE_CHARACTERS
  if (
    !isBoundedText(storageKey, 512)
    || !isBoundedText(dependencies.codec?.schema, 160)
    || typeof dependencies.codec?.parse !== 'function'
    || typeof dependencies.createEmptySnapshot !== 'function'
    || typeof dependencies.storage?.get !== 'function'
    || typeof dependencies.storage?.set !== 'function'
    || (dependencies.storage.runExclusive !== undefined
      && typeof dependencies.storage.runExclusive !== 'function')
    || !Number.isSafeInteger(maxEnvelopeCharacters)
    || maxEnvelopeCharacters < 1
  ) {
    throw new TypeError('The key-value Chat workspace review scope port configuration is invalid.')
  }

  async function readEnvelope(signal?: AbortSignal): Promise<TavernWorkspaceKeyValueEnvelope<Snapshot>> {
    throwIfCancelled(signal)
    const raw = await dependencies.storage.get(storageKey, signal)
    throwIfCancelled(signal)
    return parseRawEnvelope(raw, dependencies.codec, maxEnvelopeCharacters)
  }

  async function verifyPersistedEnvelope(
    serialized: string,
  ): Promise<TavernWorkspaceKeyValueEnvelope<Snapshot> | undefined> {
    const raw = await dependencies.storage.get(storageKey)
    if (raw !== serialized) return undefined
    return parseRawEnvelope(raw, dependencies.codec, maxEnvelopeCharacters)
  }

  return {
    async loadLinkedScope(input, options) {
      const signal = readChatWorkspaceReviewSignal(options)
      if (!signal) return { status: 'failed' }
      if (signal.aborted) return { status: 'cancelled' }
      const identity = prepareChatWorkspaceReviewScopeIdentity(input)
      if (!identity) return { status: 'failed' }

      try {
        const envelope = await readEnvelope(signal)
        const activeScopeId = resolveEnvelopeActiveScopeId(envelope, identity.conversationId)
        if (activeScopeId !== identity.workspaceId) return { status: 'stale' }

        const record = envelope.scopes.find((scope) => scope.scopeId === activeScopeId)
        if (!record) {
          if (activeScopeId !== identity.conversationId || envelope.revision !== 0) {
            throw new KeyValueTavernWorkspaceCorruptionError('The linked Chat workspace scope is missing.')
          }
          const snapshot = cloneSnapshot(
            dependencies.createEmptySnapshot(envelope.updatedAt),
            dependencies.codec,
            maxEnvelopeCharacters,
          )
          throwIfCancelled(signal)
          return {
            status: 'ready',
            conversationId: identity.conversationId,
            workspaceId: identity.workspaceId,
            repositoryRevision: 0,
            snapshot,
          }
        }
        if (envelope.revision === 0) {
          throw new KeyValueTavernWorkspaceCorruptionError('The Chat workspace repository authority is incoherent.')
        }
        const snapshot = cloneSnapshot(record.snapshot, dependencies.codec, maxEnvelopeCharacters)
        throwIfCancelled(signal)
        return {
          status: 'ready',
          conversationId: identity.conversationId,
          workspaceId: identity.workspaceId,
          repositoryRevision: envelope.revision,
          snapshot,
        }
      } catch (error) {
        return error instanceof KeyValueTavernWorkspaceCancellationError || signal.aborted
          ? { status: 'cancelled' }
          : { status: 'failed' }
      }
    },

    async compareAndSwap(input, options) {
      const signal = readChatWorkspaceReviewSignal(options)
      if (!signal) return { status: 'failed' }
      if (signal.aborted) return { status: 'cancelled' }
      const command = prepareChatWorkspaceReviewCompareAndSwapInput(input)
      if (!command) return { status: 'failed' }

      let snapshot: Snapshot
      try {
        snapshot = cloneSnapshot(command.snapshot, dependencies.codec, maxEnvelopeCharacters)
      } catch {
        return { status: 'failed' }
      }

      try {
        return await runWithStorageKeyLock(dependencies.storage, storageKey, async () => {
          if (signal.aborted) return { status: 'cancelled' } as const
          const envelope = await readEnvelope(signal)
          const activeScopeId = resolveEnvelopeActiveScopeId(envelope, command.conversationId)
          if (
            activeScopeId !== command.workspaceId
            || envelope.revision !== command.expectedRepositoryRevision
          ) {
            return { status: 'conflict' } as const
          }

          const index = envelope.scopes.findIndex((scope) => scope.scopeId === activeScopeId)
          if (index < 0) return { status: 'not_found' } as const
          const current = envelope.scopes[index]!
          if (
            current.revision === Number.MAX_SAFE_INTEGER
            || envelope.revision === Number.MAX_SAFE_INTEGER
          ) {
            throw new KeyValueTavernWorkspaceCorruptionError('The Chat workspace revision cannot be advanced.')
          }

          throwIfCancelled(signal)
          const nextScope: TavernWorkspaceScopeRecord<Snapshot> = {
            schema: TAVERN_WORKSPACE_SCOPE_RECORD_SCHEMA,
            scopeId: activeScopeId,
            revision: current.revision + 1,
            snapshot,
            updatedAt: command.updatedAt,
          }
          const nextEnvelope: TavernWorkspaceKeyValueEnvelope<Snapshot> = {
            schema: TAVERN_WORKSPACE_KEY_VALUE_ENVELOPE_SCHEMA,
            snapshotSchema: dependencies.codec.schema,
            revision: envelope.revision + 1,
            scopes: [
              nextScope,
              ...envelope.scopes.filter((scope) => scope.scopeId !== activeScopeId),
            ],
            activeScopeLinks: Object.fromEntries(Object.entries(envelope.activeScopeLinks)),
            writebackReceipts: envelope.writebackReceipts,
            updatedAt: command.updatedAt,
          }
          const canonical = parseEnvelope(nextEnvelope, dependencies.codec, maxEnvelopeCharacters)
          const serialized = JSON.stringify(canonical)
          if (serialized.length > maxEnvelopeCharacters) {
            throw new KeyValueTavernWorkspaceCorruptionError('The Tavern workspace key-value envelope exceeds its persistence limit.')
          }

          let writeFailure: unknown
          try {
            throwIfCancelled(signal)
            await dependencies.storage.set(storageKey, serialized, signal)
          } catch (error) {
            writeFailure = error
          }

          let persisted: TavernWorkspaceKeyValueEnvelope<Snapshot> | undefined
          try {
            persisted = await verifyPersistedEnvelope(serialized)
          } catch {
            return { status: 'failed' } as const
          }
          if (!persisted) {
            if (writeFailure === undefined) return { status: 'conflict' } as const
            return signal.aborted || writeFailure instanceof KeyValueTavernWorkspaceCancellationError
              ? { status: 'cancelled' } as const
              : { status: 'failed' } as const
          }

          const persistedScope = persisted.scopes.find((scope) => scope.scopeId === activeScopeId)
          if (!persistedScope || persistedScope.revision !== nextScope.revision) {
            return { status: 'failed' } as const
          }
          return {
            status: 'applied',
            conversationId: command.conversationId,
            workspaceId: command.workspaceId,
            repositoryRevision: persisted.revision,
            snapshot: cloneSnapshot(
              persistedScope.snapshot,
              dependencies.codec,
              maxEnvelopeCharacters,
            ),
          } as const
        })
      } catch (error) {
        return error instanceof KeyValueTavernWorkspaceCancellationError || signal.aborted
          ? { status: 'cancelled' }
          : { status: 'failed' }
      }
    },
  }
}

/**
 * Commits one Chat workspace mutation and its replay receipt in the same
 * key-value envelope. Exact readback is the durable success authority.
 */
export function createKeyValueTavernChatWorkspaceWritebackStore<Snapshot>(
  dependencies: KeyValueTavernChatWorkspaceWritebackStoreDependencies<Snapshot>,
): TavernChatWorkspaceWritebackAtomicStore<Snapshot> {
  const storageKey = dependencies.storageKey ?? TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY
  const maxEnvelopeCharacters = dependencies.maxEnvelopeCharacters ?? DEFAULT_MAX_ENVELOPE_CHARACTERS
  if (
    !isValidKeyValueEnvelopeConfiguration(
      dependencies.storage,
      dependencies.codec,
      storageKey,
      maxEnvelopeCharacters,
    )
    || typeof dependencies.digestProvider?.digestCanonicalPayload !== 'function'
  ) {
    throw new TypeError('The key-value Tavern Chat workspace writeback store configuration is invalid.')
  }

  async function readEnvelope(signal?: AbortSignal): Promise<TavernWorkspaceKeyValueEnvelope<Snapshot>> {
    throwIfCancelled(signal)
    const raw = await dependencies.storage.get(storageKey, signal)
    throwIfCancelled(signal)
    return parseRawEnvelope(raw, dependencies.codec, maxEnvelopeCharacters)
  }

  async function verifyPersistedEnvelope(
    serialized: string,
  ): Promise<TavernWorkspaceKeyValueEnvelope<Snapshot> | undefined> {
    const raw = await dependencies.storage.get(storageKey)
    if (raw !== serialized) return undefined
    return parseRawEnvelope(raw, dependencies.codec, maxEnvelopeCharacters)
  }

  return {
    async writebackAtomic(changeSet, mutate, options) {
      const signal = options?.signal
      if (signal?.aborted) return { status: 'cancelled' }
      if (!isValidWritebackChangeSet(changeSet) || typeof mutate !== 'function') {
        return writebackFailure('The key-value Tavern Chat workspace writeback input is invalid.')
      }

      let actualDigest: unknown
      try {
        actualDigest = await dependencies.digestProvider.digestCanonicalPayload(
          canonicalizeTavernChatWorkspaceWritebackChangeSet(changeSet),
          { signal },
        )
      } catch {
        return signal.aborted
          ? { status: 'cancelled' }
          : writebackFailure('The key-value Tavern Chat workspace writeback digest could not be verified.')
      }
      if (signal.aborted) return { status: 'cancelled' }
      if (actualDigest !== changeSet.digest) {
        return writebackFailure('The key-value Tavern Chat workspace writeback digest is invalid.')
      }

      try {
        return await runWithStorageKeyLock(dependencies.storage, storageKey, async () => {
          if (signal.aborted) return { status: 'cancelled' } as const
          const envelope = await readEnvelope(signal)
          const existingReceipt = envelope.writebackReceipts.find((receipt) =>
            receipt.workspaceId === changeSet.workspaceId
            && receipt.idempotencyKey === changeSet.idempotencyKey
          )
          if (existingReceipt) return replayWritebackReceipt(existingReceipt, changeSet)

          if (envelope.revision !== changeSet.repositoryAuthorityRevision) {
            return {
              status: 'conflict',
              actualAuthorityRevision: envelope.revision,
            } as const
          }
          if (envelope.writebackReceipts.length >= MAX_WRITEBACK_RECEIPT_COUNT) {
            return writebackFailure('The key-value Tavern Chat workspace writeback receipt limit has been reached.')
          }

          const scopeIndex = envelope.scopes.findIndex((scope) => scope.scopeId === changeSet.activeScopeId)
          if (scopeIndex < 0) {
            return writebackFailure('The resolved key-value Tavern workspace scope was not found.')
          }
          const currentScope = envelope.scopes[scopeIndex]!
          let mutation: TavernChatWorkspaceWritebackMutationResult<Snapshot>
          try {
            mutation = mutate(currentScope.snapshot, changeSet)
          } catch {
            return writebackFailure('The key-value Tavern workspace mutation failed.')
          }
          if (!isValidWritebackMutationResult(mutation)) {
            return writebackFailure('The key-value Tavern workspace mutation returned an invalid result.')
          }

          const outcomeStatus = mutation.status
          let authorityRevision = envelope.revision
          let nextScopes = envelope.scopes
          if (outcomeStatus === 'applied') {
            if (
              envelope.revision === Number.MAX_SAFE_INTEGER
              || currentScope.revision === Number.MAX_SAFE_INTEGER
            ) {
              return writebackFailure('The key-value Tavern workspace revision cannot be advanced.')
            }
            let snapshot: Snapshot
            try {
              snapshot = cloneSnapshot(mutation.snapshot, dependencies.codec, maxEnvelopeCharacters)
            } catch {
              return writebackFailure('The key-value Tavern workspace mutation returned an invalid snapshot.')
            }
            authorityRevision = envelope.revision + 1
            const nextScope: TavernWorkspaceScopeRecord<Snapshot> = {
              schema: TAVERN_WORKSPACE_SCOPE_RECORD_SCHEMA,
              scopeId: currentScope.scopeId,
              revision: currentScope.revision + 1,
              snapshot,
              updatedAt: changeSet.occurredAt,
            }
            nextScopes = [
              nextScope,
              ...envelope.scopes.filter((scope) => scope.scopeId !== currentScope.scopeId),
            ]
          }

          const receipt = createWritebackReceipt(changeSet, outcomeStatus, authorityRevision)
          const nextEnvelope: TavernWorkspaceKeyValueEnvelope<Snapshot> = {
            schema: TAVERN_WORKSPACE_KEY_VALUE_ENVELOPE_SCHEMA,
            snapshotSchema: dependencies.codec.schema,
            revision: authorityRevision,
            scopes: nextScopes,
            activeScopeLinks: Object.fromEntries(Object.entries(envelope.activeScopeLinks)),
            writebackReceipts: [receipt, ...envelope.writebackReceipts],
            updatedAt: outcomeStatus === 'applied' ? changeSet.occurredAt : envelope.updatedAt,
          }

          const canonical = parseEnvelope(nextEnvelope, dependencies.codec, maxEnvelopeCharacters)
          const serialized = JSON.stringify(canonical)
          if (serialized.length > maxEnvelopeCharacters) {
            return writebackFailure('The key-value Tavern workspace envelope exceeds its persistence limit.')
          }

          let writeFailure: unknown
          try {
            throwIfCancelled(signal)
            await dependencies.storage.set(storageKey, serialized, signal)
          } catch (error) {
            writeFailure = error
          }

          let persisted: TavernWorkspaceKeyValueEnvelope<Snapshot> | undefined
          try {
            persisted = await verifyPersistedEnvelope(serialized)
          } catch {
            persisted = undefined
          }
          if (persisted) {
            const persistedReceipt = persisted.writebackReceipts.find((candidate) =>
              candidate.workspaceId === receipt.workspaceId
              && candidate.idempotencyKey === receipt.idempotencyKey
            )
            if (!persistedReceipt || !sameWritebackReceipt(persistedReceipt, receipt)) {
              return writebackFailure('The key-value Tavern Chat workspace writeback receipt was not persisted atomically.')
            }
            if (outcomeStatus === 'applied') {
              const persistedScope = persisted.scopes.find((scope) => scope.scopeId === currentScope.scopeId)
              if (
                persisted.revision !== authorityRevision
                || !persistedScope
                || persistedScope.revision !== currentScope.revision + 1
              ) {
                return writebackFailure('The key-value Tavern Chat workspace mutation was not persisted atomically.')
              }
            } else if (
              persisted.revision !== envelope.revision
              || persisted.updatedAt !== envelope.updatedAt
            ) {
              return writebackFailure('The key-value Tavern no-change receipt altered workspace authority.')
            }
            return { status: outcomeStatus, authorityRevision } as const
          }

          if (writeFailure === undefined) {
            return writebackFailure(
              'The key-value Tavern workspace envelope changed during exact writeback verification.',
            )
          }
          return signal.aborted || writeFailure instanceof KeyValueTavernWorkspaceCancellationError
            ? { status: 'cancelled' } as const
            : writebackFailure('Key-value Tavern Chat workspace writeback persistence failed.')
        })
      } catch (error) {
        if (error instanceof KeyValueTavernWorkspaceCancellationError || signal.aborted) {
          return { status: 'cancelled' }
        }
        return writebackFailure(
          error instanceof KeyValueTavernWorkspaceCorruptionError
            ? error.message || 'A key-value Tavern Chat workspace writeback record is corrupt.'
            : 'Key-value Tavern Chat workspace writeback persistence failed.',
        )
      }
    },
  }
}

/** Reads key-value writeback receipts without reconstructing their effects. */
export function createKeyValueTavernChatWorkspaceWritebackReceiptLookup<Snapshot>(
  dependencies: KeyValueTavernChatWorkspaceWritebackReceiptLookupDependencies<Snapshot>,
): TavernChatWorkspaceWritebackReceiptLookup {
  const storageKey = dependencies.storageKey ?? TAVERN_WORKSPACE_KEY_VALUE_STORAGE_KEY
  const maxEnvelopeCharacters = dependencies.maxEnvelopeCharacters ?? DEFAULT_MAX_ENVELOPE_CHARACTERS
  if (!isValidKeyValueEnvelopeConfiguration(
    dependencies.storage,
    dependencies.codec,
    storageKey,
    maxEnvelopeCharacters,
  )) {
    throw new TypeError('The key-value Tavern Chat workspace writeback receipt lookup configuration is invalid.')
  }

  return {
    async lookup(identity, options) {
      const signal = options?.signal
      if (signal?.aborted) return frozenLookupOutcome({ status: 'cancelled' })
      if (!isValidWritebackReceiptLookupIdentity(identity)) {
        return frozenLookupOutcome({ status: 'failed', code: 'invalid_identity' })
      }

      try {
        throwIfCancelled(signal)
        const raw = await dependencies.storage.get(storageKey, signal)
        throwIfCancelled(signal)
        const envelope = parseRawEnvelope(raw, dependencies.codec, maxEnvelopeCharacters)
        const receipts = envelope.writebackReceipts.filter((receipt) =>
          receipt.assistantRunId === identity.assistantRunId
          && receipt.conversationId === identity.conversationId
          && receipt.assistantMessageId === identity.assistantMessageId
        )
        throwIfCancelled(signal)
        if (receipts.length === 0) return frozenLookupOutcome({ status: 'none' })
        if (receipts.length !== 1) return frozenLookupOutcome({ status: 'ambiguous' })
        return frozenLookupOutcome({
          status: 'committed',
          receipt: committedWritebackReceipt(identity, receipts[0]!),
        })
      } catch (error) {
        if (error instanceof KeyValueTavernWorkspaceCancellationError || signal?.aborted) {
          return frozenLookupOutcome({ status: 'cancelled' })
        }
        return frozenLookupOutcome({
          status: 'failed',
          code: error instanceof KeyValueTavernWorkspaceCorruptionError
            ? 'invalid_receipt'
            : 'persistence_failed',
        })
      }
    },
  }
}

function parseRawEnvelope<Snapshot>(
  raw: string | null | undefined,
  codec: TavernWorkspaceSnapshotCodec<Snapshot>,
  maxEnvelopeCharacters: number,
): TavernWorkspaceKeyValueEnvelope<Snapshot> {
  if (raw == null) return emptyEnvelope(codec.schema)
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > maxEnvelopeCharacters) {
    throw new KeyValueTavernWorkspaceCorruptionError('The Tavern workspace key-value envelope is invalid or oversized.')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new KeyValueTavernWorkspaceCorruptionError('The Tavern workspace key-value envelope is not valid JSON.')
  }
  return parseEnvelope(parsed, codec, maxEnvelopeCharacters)
}

function parseEnvelope<Snapshot>(
  value: unknown,
  codec: TavernWorkspaceSnapshotCodec<Snapshot>,
  maxEnvelopeCharacters: number,
): TavernWorkspaceKeyValueEnvelope<Snapshot> {
  if (!isPlainRecord(value)) {
    throw new KeyValueTavernWorkspaceCorruptionError('The Tavern workspace key-value envelope is corrupt or incompatible.')
  }
  const expectedKeys = ['schema', 'snapshotSchema', 'revision', 'scopes', 'activeScopeLinks', 'writebackReceipts', 'updatedAt']
  if (value.schema !== TAVERN_WORKSPACE_KEY_VALUE_ENVELOPE_SCHEMA || !hasOnlyKeys(value, expectedKeys) ||
      value.snapshotSchema !== codec.schema || !isNonNegativeRevision(value.revision) ||
      !isTimestamp(value.updatedAt) || !Array.isArray(value.scopes) || value.scopes.length > MAX_SCOPE_COUNT ||
      !isPlainRecord(value.activeScopeLinks) || !Array.isArray(value.writebackReceipts)) {
    throw new KeyValueTavernWorkspaceCorruptionError('The Tavern workspace key-value envelope is corrupt or incompatible.')
  }
  const scopeIds = new Set<string>()
  const scopes = value.scopes.map((candidate) => parseScopeRecord(candidate, codec, maxEnvelopeCharacters, scopeIds))
  const linkEntries = Object.entries(value.activeScopeLinks)
  if (linkEntries.length > MAX_ACTIVE_SCOPE_LINK_COUNT) {
    throw new KeyValueTavernWorkspaceCorruptionError('The Tavern workspace active-scope link count is invalid.')
  }
  const normalizedLinks: Array<[string, string]> = []
  const conversationIds = new Set<string>()
  for (const [conversationScopeId, activeScopeId] of linkEntries) {
    if (typeof activeScopeId !== 'string' ||
        normalizeTavernWorkspaceScopeId(conversationScopeId) !== conversationScopeId ||
        normalizeTavernWorkspaceScopeId(activeScopeId) !== activeScopeId ||
        conversationScopeId === activeScopeId || !scopeIds.has(activeScopeId) || conversationIds.has(conversationScopeId)) {
      throw new KeyValueTavernWorkspaceCorruptionError('A Tavern workspace active-scope link is incoherent.')
    }
    conversationIds.add(conversationScopeId)
    normalizedLinks.push([conversationScopeId, activeScopeId])
  }
  const writebackReceipts = parseWritebackReceipts(value.writebackReceipts)
  return {
    schema: TAVERN_WORKSPACE_KEY_VALUE_ENVELOPE_SCHEMA,
    snapshotSchema: codec.schema,
    revision: value.revision,
    scopes,
    activeScopeLinks: Object.fromEntries(normalizedLinks),
    writebackReceipts,
    updatedAt: value.updatedAt,
  }
}

function parseWritebackReceipts(value: unknown): KeyValueWritebackReceipt[] {
  if (!Array.isArray(value) || value.length > MAX_WRITEBACK_RECEIPT_COUNT) {
    throw new KeyValueTavernWorkspaceCorruptionError(
      'The Tavern Chat workspace writeback receipt collection is invalid.',
    )
  }
  const primaryKeys = new Set<string>()
  return value.map((candidate) => {
    const receipt = parseWritebackReceipt(candidate)
    const primaryKey = JSON.stringify([receipt.workspaceId, receipt.idempotencyKey])
    if (primaryKeys.has(primaryKey)) {
      throw new KeyValueTavernWorkspaceCorruptionError(
        'The Tavern Chat workspace writeback receipt collection contains a duplicate key.',
      )
    }
    primaryKeys.add(primaryKey)
    return receipt
  })
}

function parseWritebackReceipt(value: unknown): KeyValueWritebackReceipt {
  if (
    !isPlainRecord(value)
    || !hasOnlyKeys(value, [
      'schema',
      'workspaceId',
      'idempotencyKey',
      'changeSetDigest',
      'assistantRunId',
      'conversationId',
      'assistantMessageId',
      'expectedAuthorityRevision',
      'activeScopeId',
      'outcomeStatus',
      'authorityRevision',
      'createdAt',
    ])
    || value.schema !== TAVERN_CHAT_WORKSPACE_KEY_VALUE_WRITEBACK_RECEIPT_RECORD_SCHEMA
    || !isBoundedIdentity(value.workspaceId, CHAT_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS)
    || normalizeTavernWorkspaceScopeId(value.workspaceId) !== value.workspaceId
    || !isBoundedIdentity(
      value.idempotencyKey,
      CHAT_WORKSPACE_WRITEBACK_IDEMPOTENCY_KEY_MAX_CHARACTERS,
    )
    || typeof value.changeSetDigest !== 'string'
    || !SHA256_DIGEST_PATTERN.test(value.changeSetDigest)
    || !isBoundedIdentity(value.assistantRunId, CHAT_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS)
    || !isBoundedIdentity(value.conversationId, CHAT_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS)
    || !isBoundedIdentity(value.assistantMessageId, CHAT_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS)
    || !isNonNegativeRevision(value.expectedAuthorityRevision)
    || value.activeScopeId !== value.workspaceId
    || (value.outcomeStatus !== 'applied' && value.outcomeStatus !== 'no_changes')
    || !isNonNegativeRevision(value.authorityRevision)
    || !isTimestamp(value.createdAt)
    || (value.outcomeStatus === 'applied'
      && value.authorityRevision !== value.expectedAuthorityRevision + 1)
    || (value.outcomeStatus === 'no_changes'
      && value.authorityRevision !== value.expectedAuthorityRevision)
  ) {
    throw new KeyValueTavernWorkspaceCorruptionError(
      'A persisted Tavern Chat workspace writeback receipt is corrupt.',
    )
  }
  return {
    schema: TAVERN_CHAT_WORKSPACE_KEY_VALUE_WRITEBACK_RECEIPT_RECORD_SCHEMA,
    workspaceId: value.workspaceId,
    idempotencyKey: value.idempotencyKey,
    changeSetDigest: value.changeSetDigest,
    assistantRunId: value.assistantRunId,
    conversationId: value.conversationId,
    assistantMessageId: value.assistantMessageId,
    expectedAuthorityRevision: value.expectedAuthorityRevision,
    activeScopeId: value.activeScopeId,
    outcomeStatus: value.outcomeStatus,
    authorityRevision: value.authorityRevision,
    createdAt: value.createdAt,
  }
}

function parseScopeRecord<Snapshot>(
  value: unknown,
  codec: TavernWorkspaceSnapshotCodec<Snapshot>,
  maxEnvelopeCharacters: number,
  scopeIds: Set<string>,
): TavernWorkspaceScopeRecord<Snapshot> {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ['schema', 'scopeId', 'revision', 'snapshot', 'updatedAt']) ||
      value.schema !== TAVERN_WORKSPACE_SCOPE_RECORD_SCHEMA ||
      normalizeTavernWorkspaceScopeId(value.scopeId) !== value.scopeId || !isPositiveRevision(value.revision) ||
      !isTimestamp(value.updatedAt) || scopeIds.has(value.scopeId as string) || !Object.hasOwn(value, 'snapshot')) {
    throw new KeyValueTavernWorkspaceCorruptionError('A Tavern workspace scope record is corrupt.')
  }
  const scopeId = value.scopeId as string
  scopeIds.add(scopeId)
  return {
    schema: TAVERN_WORKSPACE_SCOPE_RECORD_SCHEMA,
    scopeId,
    revision: value.revision,
    snapshot: cloneSnapshot(value.snapshot, codec, maxEnvelopeCharacters),
    updatedAt: value.updatedAt,
  }
}

function prepareScope<Snapshot>(
  input: CreateTavernWorkspaceScopeInput<Snapshot>,
  codec: TavernWorkspaceSnapshotCodec<Snapshot>,
  maxEnvelopeCharacters: number,
  now: () => number,
): TavernWorkspaceRepositoryResult<PreparedScope<Snapshot>> {
  const scopeId = normalizeTavernWorkspaceScopeId(input.scopeId)
  if (!scopeId) return failure('invalid_scope', 'The Tavern workspace scope identifier is invalid.')
  const updatedAt = input.updatedAt ?? now()
  if (!isTimestamp(updatedAt)) return failure('validation_failed', 'The Tavern workspace update timestamp is invalid.')
  try {
    return ok({ scopeId, snapshot: cloneSnapshot(input.snapshot, codec, maxEnvelopeCharacters), updatedAt })
  } catch {
    return failure('validation_failed', 'The Tavern workspace snapshot is invalid, incompatible, or oversized.')
  }
}

function prepareReplacement<Snapshot>(
  input: ReplaceTavernWorkspaceRepositoryInput<Snapshot>,
  codec: TavernWorkspaceSnapshotCodec<Snapshot>,
  maxEnvelopeCharacters: number,
  now: () => number,
): TavernWorkspaceRepositoryResult<{
  scopes: PreparedScope<Snapshot>[]
  activeScopeLinks: Record<string, string>
  updatedAt: number
}> {
  if (!Array.isArray(input.scopes) || input.scopes.length > MAX_SCOPE_COUNT) {
    return failure('validation_failed', 'The Tavern workspace replacement scope count is invalid.')
  }
  const updatedAt = input.updatedAt ?? now()
  if (!isTimestamp(updatedAt)) return failure('validation_failed', 'The Tavern workspace replacement timestamp is invalid.')
  const scopes: PreparedScope<Snapshot>[] = []
  const scopeIds = new Set<string>()
  for (const scope of input.scopes) {
    const prepared = prepareReplacementScope(scope, codec, maxEnvelopeCharacters, updatedAt)
    if (!prepared.ok) return prepared
    if (scopeIds.has(prepared.value.scopeId)) {
      return failure('duplicate', 'The Tavern workspace replacement contains duplicate scopes.', false, prepared.value.scopeId)
    }
    scopeIds.add(prepared.value.scopeId)
    scopes.push(prepared.value)
  }
  if (!isPlainRecord(input.activeScopeLinks)) {
    return failure('validation_failed', 'The Tavern workspace replacement active-scope links are invalid.')
  }
  const entries = Object.entries(input.activeScopeLinks)
  if (entries.length > MAX_ACTIVE_SCOPE_LINK_COUNT) {
    return failure('validation_failed', 'The Tavern workspace replacement active-scope link count is invalid.')
  }
  const normalizedEntries: Array<[string, string]> = []
  const conversationIds = new Set<string>()
  for (const [rawConversationScopeId, rawActiveScopeId] of entries) {
    const conversationScopeId = normalizeTavernWorkspaceScopeId(rawConversationScopeId)
    const activeScopeId = normalizeTavernWorkspaceScopeId(rawActiveScopeId)
    if (!conversationScopeId || !activeScopeId) {
      return failure('invalid_scope', 'A Tavern workspace replacement active-scope identifier is invalid.')
    }
    if (conversationScopeId === activeScopeId) continue
    if (!scopeIds.has(activeScopeId)) {
      return failure('not_found', 'A Tavern workspace replacement active scope was not found.', false, activeScopeId)
    }
    if (conversationIds.has(conversationScopeId)) {
      return failure('duplicate', 'The Tavern workspace replacement contains duplicate active-scope links.', false, conversationScopeId)
    }
    conversationIds.add(conversationScopeId)
    normalizedEntries.push([conversationScopeId, activeScopeId])
  }
  return ok({ scopes, activeScopeLinks: Object.fromEntries(normalizedEntries), updatedAt })
}

function prepareReplacementScope<Snapshot>(
  scope: TavernWorkspaceReplacementScope<Snapshot>,
  codec: TavernWorkspaceSnapshotCodec<Snapshot>,
  maxEnvelopeCharacters: number,
  fallbackUpdatedAt: number,
): TavernWorkspaceRepositoryResult<PreparedScope<Snapshot>> {
  const scopeId = normalizeTavernWorkspaceScopeId(scope.scopeId)
  if (!scopeId) return failure('invalid_scope', 'A Tavern workspace replacement scope identifier is invalid.')
  const updatedAt = scope.updatedAt ?? fallbackUpdatedAt
  if (!isTimestamp(updatedAt)) return failure('validation_failed', 'A Tavern workspace replacement timestamp is invalid.')
  try {
    return ok({ scopeId, snapshot: cloneSnapshot(scope.snapshot, codec, maxEnvelopeCharacters), updatedAt })
  } catch {
    return failure('validation_failed', 'A Tavern workspace replacement snapshot is invalid, incompatible, or oversized.')
  }
}

function emptyEnvelope<Snapshot>(snapshotSchema: string): TavernWorkspaceKeyValueEnvelope<Snapshot> {
  return {
    schema: TAVERN_WORKSPACE_KEY_VALUE_ENVELOPE_SCHEMA,
    snapshotSchema,
    revision: 0,
    scopes: [],
    activeScopeLinks: {},
    writebackReceipts: [],
    updatedAt: 0,
  }
}

function toScopeRecord<Snapshot>(prepared: PreparedScope<Snapshot>, revision: number): TavernWorkspaceScopeRecord<Snapshot> {
  return {
    schema: TAVERN_WORKSPACE_SCOPE_RECORD_SCHEMA,
    scopeId: prepared.scopeId,
    revision,
    snapshot: prepared.snapshot,
    updatedAt: prepared.updatedAt,
  }
}

function toRepositorySnapshot<Snapshot>(
  envelope: TavernWorkspaceKeyValueEnvelope<Snapshot>,
): TavernWorkspaceRepositorySnapshot<Snapshot> {
  return {
    schema: TAVERN_WORKSPACE_REPOSITORY_SNAPSHOT_SCHEMA,
    revision: envelope.revision,
    scopes: envelope.scopes,
    activeScopeLinks: Object.fromEntries(Object.entries(envelope.activeScopeLinks)),
    updatedAt: envelope.updatedAt,
  }
}

function cloneScopeRecord<Snapshot>(
  record: TavernWorkspaceScopeRecord<Snapshot>,
  codec: TavernWorkspaceSnapshotCodec<Snapshot>,
  maxEnvelopeCharacters: number,
): TavernWorkspaceScopeRecord<Snapshot> {
  return {
    ...record,
    snapshot: cloneSnapshot(record.snapshot, codec, maxEnvelopeCharacters),
  }
}

function cloneSnapshot<Snapshot>(
  value: unknown,
  codec: TavernWorkspaceSnapshotCodec<Snapshot>,
  maxEnvelopeCharacters: number,
): Snapshot {
  let serialized: string
  let parsedJson: unknown
  try {
    serialized = JSON.stringify(value)
    if (typeof serialized !== 'string' || serialized.length > maxEnvelopeCharacters) throw new Error()
    parsedJson = JSON.parse(serialized)
  } catch {
    throw new KeyValueTavernWorkspaceCorruptionError('A Tavern workspace snapshot is not serializable or is oversized.')
  }
  let parsed: Snapshot | undefined
  try {
    parsed = codec.parse(parsedJson)
  } catch {
    parsed = undefined
  }
  if (parsed === undefined) {
    throw new KeyValueTavernWorkspaceCorruptionError('A Tavern workspace snapshot is invalid or incompatible.')
  }
  try {
    const canonical = JSON.stringify(parsed)
    if (typeof canonical !== 'string' || canonical.length > maxEnvelopeCharacters) throw new Error()
    const cloned = codec.parse(JSON.parse(canonical))
    if (cloned === undefined) throw new Error()
    return cloned
  } catch {
    throw new KeyValueTavernWorkspaceCorruptionError('A normalized Tavern workspace snapshot is invalid or oversized.')
  }
}

function findScope<Snapshot>(
  envelope: TavernWorkspaceKeyValueEnvelope<Snapshot>,
  scopeId: string,
): TavernWorkspaceScopeRecord<Snapshot> {
  const record = envelope.scopes.find((scope) => scope.scopeId === scopeId)
  if (!record) throw new KeyValueTavernWorkspaceCorruptionError('A persisted Tavern workspace mutation was not readable.')
  return record
}

function advanceEnvelope<Snapshot>(envelope: TavernWorkspaceKeyValueEnvelope<Snapshot>, updatedAt: number): void {
  envelope.revision += 1
  envelope.updatedAt = updatedAt
}

function runWithStorageKeyLock<Value>(
  storage: TavernWorkspaceKeyValuePort,
  storageKey: string,
  work: () => Promise<Value>,
): Promise<Value> {
  if (storage.runExclusive) return storage.runExclusive(storageKey, work)
  const previous = fallbackStorageLockTails.get(storageKey) ?? Promise.resolve()
  const scheduled = previous.then(work, work)
  const tail = scheduled.then(() => undefined, () => undefined)
  fallbackStorageLockTails.set(storageKey, tail)
  void tail.finally(() => {
    if (fallbackStorageLockTails.get(storageKey) === tail) {
      fallbackStorageLockTails.delete(storageKey)
    }
  })
  return scheduled
}

function resolveEnvelopeActiveScopeId<Snapshot>(
  envelope: TavernWorkspaceKeyValueEnvelope<Snapshot>,
  conversationId: string,
): string {
  return Object.hasOwn(envelope.activeScopeLinks, conversationId)
    ? envelope.activeScopeLinks[conversationId]!
    : conversationId
}

function prepareChatWorkspaceReviewScopeIdentity(
  value: unknown,
): { readonly conversationId: string; readonly workspaceId: string } | undefined {
  if (!isPlainRecord(value)) return undefined
  try {
    const conversationId = value.conversationId
    const workspaceId = value.workspaceId
    return typeof conversationId === 'string'
      && normalizeTavernWorkspaceScopeId(conversationId) === conversationId
      && typeof workspaceId === 'string'
      && normalizeTavernWorkspaceScopeId(workspaceId) === workspaceId
      ? { conversationId, workspaceId }
      : undefined
  } catch {
    return undefined
  }
}

function prepareChatWorkspaceReviewCompareAndSwapInput(
  value: unknown,
): {
  readonly conversationId: string
  readonly workspaceId: string
  readonly expectedRepositoryRevision: number
  readonly snapshot: unknown
  readonly updatedAt: number
} | undefined {
  const identity = prepareChatWorkspaceReviewScopeIdentity(value)
  if (!identity || !isPlainRecord(value)) return undefined
  try {
    const expectedRepositoryRevision = value.expectedRepositoryRevision
    const updatedAt = value.updatedAt
    if (!isNonNegativeRevision(expectedRepositoryRevision) || !isTimestamp(updatedAt)) return undefined
    return {
      ...identity,
      expectedRepositoryRevision,
      snapshot: value.snapshot,
      updatedAt,
    }
  } catch {
    return undefined
  }
}

function readChatWorkspaceReviewSignal(value: unknown): AbortSignal | undefined {
  if (!isPlainRecord(value)) return undefined
  try {
    const signal = value.signal
    return isPlainRecord(signal)
      && typeof signal.aborted === 'boolean'
      && typeof signal.addEventListener === 'function'
      && typeof signal.removeEventListener === 'function'
      ? signal as unknown as AbortSignal
      : undefined
  } catch {
    return undefined
  }
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new KeyValueTavernWorkspaceCancellationError()
}

function mapFailure<Value>(error: unknown, signal?: AbortSignal): TavernWorkspaceRepositoryResult<Value> {
  if (error instanceof KeyValueTavernWorkspaceCancellationError || signal?.aborted) return cancelled()
  if (error instanceof KeyValueTavernWorkspaceCorruptionError) {
    return failure('corrupt_record', error.message || 'A persisted Tavern workspace key-value record is corrupt.')
  }
  return failure('persistence_failed', 'Tavern workspace key-value persistence failed.', true)
}

function cancelled<Value>(): TavernWorkspaceRepositoryResult<Value> {
  return failure('cancelled', 'The Tavern workspace persistence operation was cancelled.')
}

function scopeConflict<Value>(scopeId: string, actualRevision: number): TavernWorkspaceRepositoryResult<Value> {
  return err('revision_conflict', 'The Tavern workspace scope revision has changed.', {
    retryable: true,
    details: { scopeId, actualRevision },
  })
}

function repositoryConflict<Value>(actualRevision: number): TavernWorkspaceRepositoryResult<Value> {
  return err('revision_conflict', 'The Tavern workspace repository revision has changed.', {
    retryable: true,
    details: { actualRevision },
  })
}

function failure<Value>(
  code: TavernWorkspaceRepositoryErrorCode,
  message: string,
  retryable = code === 'persistence_failed',
  scopeId?: string,
): TavernWorkspaceRepositoryResult<Value> {
  return err(code, message, {
    retryable,
    ...(scopeId ? { details: { scopeId } } : {}),
  })
}

function createWritebackReceipt(
  changeSet: TavernChatWorkspaceWritebackChangeSet,
  outcomeStatus: KeyValueWritebackReceipt['outcomeStatus'],
  authorityRevision: number,
): KeyValueWritebackReceipt {
  return {
    schema: TAVERN_CHAT_WORKSPACE_KEY_VALUE_WRITEBACK_RECEIPT_RECORD_SCHEMA,
    workspaceId: changeSet.workspaceId,
    idempotencyKey: changeSet.idempotencyKey,
    changeSetDigest: changeSet.digest,
    assistantRunId: changeSet.assistantRunId,
    conversationId: changeSet.conversationId,
    assistantMessageId: changeSet.assistantMessageId,
    expectedAuthorityRevision: changeSet.repositoryAuthorityRevision,
    activeScopeId: changeSet.activeScopeId,
    outcomeStatus,
    authorityRevision,
    createdAt: changeSet.occurredAt,
  }
}

function replayWritebackReceipt(
  receipt: KeyValueWritebackReceipt,
  changeSet: TavernChatWorkspaceWritebackChangeSet,
): TavernChatWorkspaceWritebackAtomicStoreResult {
  if (receipt.changeSetDigest !== changeSet.digest) {
    return writebackFailure(
      'The durable idempotency key belongs to a different key-value Tavern workspace writeback.',
    )
  }
  if (
    receipt.workspaceId !== changeSet.workspaceId
    || receipt.idempotencyKey !== changeSet.idempotencyKey
    || receipt.assistantRunId !== changeSet.assistantRunId
    || receipt.conversationId !== changeSet.conversationId
    || receipt.assistantMessageId !== changeSet.assistantMessageId
    || receipt.expectedAuthorityRevision !== changeSet.repositoryAuthorityRevision
    || receipt.activeScopeId !== changeSet.activeScopeId
    || receipt.createdAt !== changeSet.occurredAt
  ) {
    throw new KeyValueTavernWorkspaceCorruptionError(
      'A key-value Tavern Chat workspace writeback receipt has inconsistent identity.',
    )
  }
  return receipt.outcomeStatus === 'applied'
    ? { status: 'replayed', authorityRevision: receipt.authorityRevision }
    : { status: 'no_changes', authorityRevision: receipt.authorityRevision }
}

function sameWritebackReceipt(
  left: KeyValueWritebackReceipt,
  right: KeyValueWritebackReceipt,
): boolean {
  return left.schema === right.schema
    && left.workspaceId === right.workspaceId
    && left.idempotencyKey === right.idempotencyKey
    && left.changeSetDigest === right.changeSetDigest
    && left.assistantRunId === right.assistantRunId
    && left.conversationId === right.conversationId
    && left.assistantMessageId === right.assistantMessageId
    && left.expectedAuthorityRevision === right.expectedAuthorityRevision
    && left.activeScopeId === right.activeScopeId
    && left.outcomeStatus === right.outcomeStatus
    && left.authorityRevision === right.authorityRevision
    && left.createdAt === right.createdAt
}

function committedWritebackReceipt(
  identity: TavernChatWorkspaceWritebackReceiptLookupIdentity,
  receipt: KeyValueWritebackReceipt,
): TavernChatWorkspaceWritebackCommittedReceipt {
  return Object.freeze({
    assistantRunId: identity.assistantRunId,
    conversationId: identity.conversationId,
    assistantMessageId: identity.assistantMessageId,
    workspaceId: receipt.workspaceId,
    expectedAuthorityRevision: receipt.expectedAuthorityRevision,
    idempotencyKey: receipt.idempotencyKey,
    outcomeStatus: receipt.outcomeStatus,
    authorityRevision: receipt.authorityRevision,
    createdAt: receipt.createdAt,
  })
}

function frozenLookupOutcome(
  outcome: TavernChatWorkspaceWritebackReceiptLookupOutcome,
): TavernChatWorkspaceWritebackReceiptLookupOutcome {
  return Object.freeze(outcome)
}

function isValidWritebackReceiptLookupIdentity(
  identity: TavernChatWorkspaceWritebackReceiptLookupIdentity,
): boolean {
  return isPlainRecord(identity)
    && isBoundedIdentity(identity.assistantRunId, CHAT_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS)
    && isBoundedIdentity(identity.conversationId, CHAT_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS)
    && isBoundedIdentity(identity.assistantMessageId, CHAT_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS)
}

function isValidWritebackChangeSet(value: TavernChatWorkspaceWritebackChangeSet): boolean {
  if (!isPlainRecord(value) || !isPlainRecord(value.applicationOptions)) return false
  if (
    !Object.isFrozen(value)
    || !Object.isFrozen(value.orderedCharacterIds)
    || !Object.isFrozen(value.applicationOptions)
    || !Object.isFrozen(value.applicationOptions.commitRelationshipMemoryCandidateIds)
    || value.schema !== TAVERN_CHAT_WORKSPACE_WRITEBACK_CHANGE_SET_SCHEMA
    || !isBoundedIdentity(value.assistantRunId, CHAT_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS)
    || !isBoundedIdentity(value.conversationId, CHAT_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS)
    || !isBoundedIdentity(value.assistantMessageId, CHAT_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS)
    || !isBoundedIdentity(value.workspaceId, CHAT_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS)
    || normalizeTavernWorkspaceScopeId(value.activeScopeId) !== value.activeScopeId
    || value.activeScopeId !== value.workspaceId
    || !isNonNegativeRevision(value.repositoryAuthorityRevision)
    || !isBoundedIdentity(
      value.idempotencyKey,
      CHAT_WORKSPACE_WRITEBACK_IDEMPOTENCY_KEY_MAX_CHARACTERS,
    )
    || typeof value.latestUserInput !== 'string'
    || value.latestUserInput.length > CHAT_WORKSPACE_WRITEBACK_FINAL_OUTPUT_MAX_CHARACTERS
    || typeof value.finalOutput !== 'string'
    || value.finalOutput.length > CHAT_WORKSPACE_WRITEBACK_FINAL_OUTPUT_MAX_CHARACTERS
    || !isTimestamp(value.occurredAt)
    || typeof value.digest !== 'string'
    || !SHA256_DIGEST_PATTERN.test(value.digest)
  ) {
    return false
  }
  if (
    value.selectedSceneId !== undefined
    && !isBoundedIdentity(value.selectedSceneId, CHAT_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS)
  ) {
    return false
  }
  if (!Array.isArray(value.orderedCharacterIds) || value.orderedCharacterIds.length > 64) return false
  const characterIds = new Set<string>()
  for (const characterId of value.orderedCharacterIds) {
    if (
      !isBoundedIdentity(characterId, CHAT_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS)
      || characterIds.has(characterId)
    ) return false
    characterIds.add(characterId)
  }
  return value.applicationOptions.commitSummary === true
    && value.applicationOptions.commitCharacterDraft === false
    && value.applicationOptions.commitLorebookDraft === false
    && Array.isArray(value.applicationOptions.commitRelationshipMemoryCandidateIds)
    && value.applicationOptions.commitRelationshipMemoryCandidateIds.length === 0
    && value.applicationOptions.commitSceneChange === false
    && value.applicationOptions.storePendingProposals === true
}

function isValidWritebackMutationResult<Snapshot>(
  value: unknown,
): value is TavernChatWorkspaceWritebackMutationResult<Snapshot> {
  if (!isPlainRecord(value)) return false
  return value.status === 'no_changes'
    ? hasOnlyKeys(value, ['status'])
    : value.status === 'applied'
      && hasOnlyKeys(value, ['status', 'snapshot'])
      && Object.hasOwn(value, 'snapshot')
}

function isValidKeyValueEnvelopeConfiguration<Snapshot>(
  storage: TavernWorkspaceKeyValuePort,
  codec: TavernWorkspaceSnapshotCodec<Snapshot>,
  storageKey: string,
  maxEnvelopeCharacters: number,
): boolean {
  return isBoundedText(storageKey, 512)
    && isBoundedText(codec?.schema, 160)
    && typeof codec?.parse === 'function'
    && typeof storage?.get === 'function'
    && typeof storage?.set === 'function'
    && (storage.runExclusive === undefined || typeof storage.runExclusive === 'function')
    && Number.isSafeInteger(maxEnvelopeCharacters)
    && maxEnvelopeCharacters >= 1
}

function hasStructurallyValidEnvelopeFields(value: Record<string, unknown>): boolean {
  if (
    !isBoundedText(value.snapshotSchema, 160)
    || !isNonNegativeRevision(value.revision)
    || !isTimestamp(value.updatedAt)
    || !Array.isArray(value.scopes)
    || value.scopes.length > MAX_SCOPE_COUNT
    || !isPlainRecord(value.activeScopeLinks)
  ) return false

  const scopeIds = new Set<string>()
  for (const scope of value.scopes) {
    if (
      !isPlainRecord(scope)
      || !hasOnlyKeys(scope, ['schema', 'scopeId', 'revision', 'snapshot', 'updatedAt'])
      || scope.schema !== TAVERN_WORKSPACE_SCOPE_RECORD_SCHEMA
      || typeof scope.scopeId !== 'string'
      || normalizeTavernWorkspaceScopeId(scope.scopeId) !== scope.scopeId
      || scopeIds.has(scope.scopeId)
      || !isPositiveRevision(scope.revision)
      || !isTimestamp(scope.updatedAt)
      || !Object.hasOwn(scope, 'snapshot')
    ) return false
    scopeIds.add(scope.scopeId)
  }
  const linkEntries = Object.entries(value.activeScopeLinks)
  if (linkEntries.length > MAX_ACTIVE_SCOPE_LINK_COUNT) return false
  for (const [conversationScopeId, activeScopeId] of linkEntries) {
    if (
      typeof activeScopeId !== 'string'
      || normalizeTavernWorkspaceScopeId(conversationScopeId) !== conversationScopeId
      || normalizeTavernWorkspaceScopeId(activeScopeId) !== activeScopeId
      || conversationScopeId === activeScopeId
      || !scopeIds.has(activeScopeId)
    ) return false
  }
  return true
}

function writebackFailure(reason: string): TavernChatWorkspaceWritebackAtomicStoreResult {
  return { status: 'failed', reason }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key))
}

function isBoundedText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit && value.trim() === value
}

function isBoundedIdentity(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length <= limit && value.trim().length > 0
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isPositiveRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isNonNegativeRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
