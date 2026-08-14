import { err, ok } from '@/core'
import type {
  SqliteDatabase,
  SqliteDatabaseProvider,
  SqliteExecutor,
} from '@/platform/storage'
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
import {
  canonicalizeTavernChatWorkspaceWritebackChangeSet,
  TAVERN_CHAT_WORKSPACE_WRITEBACK_CHANGE_SET_SCHEMA,
  type TavernChatWorkspaceWritebackAtomicStore,
  type TavernChatWorkspaceWritebackAtomicStoreResult,
  type TavernChatWorkspaceWritebackChangeSet,
  type TavernChatWorkspaceWritebackDigestProvider,
  type TavernChatWorkspaceWritebackMutationResult,
} from '../application/tavernChatWorkspaceWritebackAdapter'
import {
  CHAT_WORKSPACE_WRITEBACK_FINAL_OUTPUT_MAX_CHARACTERS,
  CHAT_WORKSPACE_WRITEBACK_IDEMPOTENCY_KEY_MAX_CHARACTERS,
  CHAT_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS,
} from '../application/chatWorkspaceWritebackRuntime'
import type { ChatWorkspaceReviewScopePort } from '../application/chatWorkspaceReviewRuntime'
import type {
  TavernChatWorkspaceWritebackCommittedReceipt,
  TavernChatWorkspaceWritebackReceiptLookup,
  TavernChatWorkspaceWritebackReceiptLookupIdentity,
  TavernChatWorkspaceWritebackReceiptLookupOutcome,
} from '../application/tavernChatWorkspaceWritebackReceiptLookup'
export const TAVERN_WORKSPACE_SQLITE_SCHEMA_VERSION = 1
export const TAVERN_CHAT_WORKSPACE_WRITEBACK_RECEIPT_RECORD_SCHEMA =
  'islemind.tavern-chat-workspace-writeback-receipt-record.v1' as const

const DEFAULT_MAX_SNAPSHOT_CHARACTERS = 16 * 1024 * 1024
const MAX_SCOPE_COUNT = 512
const MAX_ACTIVE_SCOPE_LINK_COUNT = 2_048
const WRITEBACK_RECEIPT_TABLE = 'workspace_tavern_chat_writeback_receipts'
const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/

interface RepositoryStateRow {
  revision: number
  updatedAt: number
  schemaVersion: number
}

interface ScopeRow {
  scopeId: string
  recordSchema: string
  snapshotSchema: string
  revision: number
  updatedAt: number
  payloadJson: string
}

interface ActiveScopeLinkRow {
  conversationScopeId: string
  activeScopeId: string
  updatedAt: number
}

interface WritebackReceiptRow {
  recordSchema: unknown
  workspaceId: unknown
  idempotencyKey: unknown
  changeSetDigest: unknown
  assistantRunId: unknown
  conversationId: unknown
  assistantMessageId: unknown
  expectedAuthorityRevision: unknown
  activeScopeId: unknown
  outcomeStatus: unknown
  authorityRevision: unknown
  createdAt: unknown
}

interface WritebackReceipt {
  workspaceId: string
  idempotencyKey: string
  changeSetDigest: string
  assistantRunId: string
  conversationId: string
  assistantMessageId: string
  expectedAuthorityRevision: number
  activeScopeId: string
  outcomeStatus: 'applied' | 'no_changes'
  authorityRevision: number
  createdAt: number
}

interface PreparedSnapshot<Snapshot> {
  snapshot: Snapshot
  payloadJson: string
}

interface PreparedReplacementScope<Snapshot> extends PreparedSnapshot<Snapshot> {
  scopeId: string
  updatedAt: number
}

export interface SqliteTavernWorkspaceRepositoryDependencies<Snapshot> {
  databaseProvider: SqliteDatabaseProvider
  codec: TavernWorkspaceSnapshotCodec<Snapshot>
  now?: () => number
  maxSnapshotCharacters?: number
}

export interface SqliteTavernChatWorkspaceWritebackStoreDependencies<Snapshot> {
  readonly runtime: 'native'
  readonly databaseProvider: SqliteDatabaseProvider
  readonly codec: TavernWorkspaceSnapshotCodec<Snapshot>
  readonly digestProvider: TavernChatWorkspaceWritebackDigestProvider
  readonly maxSnapshotCharacters?: number
}

export interface SqliteTavernChatWorkspaceWritebackReceiptLookupDependencies {
  readonly runtime: 'native'
  readonly databaseProvider: SqliteDatabaseProvider
}

export interface SqliteChatWorkspaceReviewScopePortDependencies<Snapshot> {
  readonly runtime: 'native'
  readonly databaseProvider: SqliteDatabaseProvider
  readonly codec: TavernWorkspaceSnapshotCodec<Snapshot>
  readonly createEmptySnapshot: (updatedAt: number) => Snapshot
  readonly maxSnapshotCharacters?: number
}

class TavernWorkspaceCancellationError extends Error {}
class TavernWorkspaceCorruptionError extends Error {}
class ChatWorkspaceReviewConflictError extends Error {}

export function createSqliteTavernWorkspaceRepository<Snapshot>(
  dependencies: SqliteTavernWorkspaceRepositoryDependencies<Snapshot>,
): TavernWorkspaceRepository<Snapshot> {
  const now = dependencies.now ?? Date.now
  const maxSnapshotCharacters = dependencies.maxSnapshotCharacters ?? DEFAULT_MAX_SNAPSHOT_CHARACTERS
  if (!isBoundedSchema(dependencies.codec.schema) || !Number.isSafeInteger(maxSnapshotCharacters) || maxSnapshotCharacters < 1) {
    throw new TypeError('The Tavern workspace repository configuration is invalid.')
  }
  let initialization: Promise<void> | undefined

  async function database(signal?: AbortSignal): Promise<SqliteDatabase> {
    throwIfCancelled(signal)
    const value = await dependencies.databaseProvider.get()
    throwIfCancelled(signal)
    if (!initialization) {
      initialization = ensureSchema(value).catch((error) => {
        initialization = undefined
        throw error
      })
    }
    await initialization
    throwIfCancelled(signal)
    return value
  }

  async function execute<Value>(
    options: TavernWorkspaceRepositoryOptions | undefined,
    work: (value: SqliteDatabase, signal: AbortSignal | undefined) => Promise<TavernWorkspaceRepositoryResult<Value>>,
  ): Promise<TavernWorkspaceRepositoryResult<Value>> {
    const signal = options?.signal
    try {
      return await work(await database(signal), signal)
    } catch (error) {
      if (error instanceof TavernWorkspaceCancellationError || signal?.aborted) {
        return failure('cancelled', 'The Tavern workspace persistence operation was cancelled.')
      }
      if (error instanceof TavernWorkspaceCorruptionError) {
        return failure('corrupt_record', error.message || 'A persisted Tavern workspace record is corrupt.')
      }
      return failure('persistence_failed', 'Tavern workspace persistence failed.', true)
    }
  }

  return {
    load(options) {
      return execute(options, async (value, signal) => value.transaction(async (transaction) => {
        const state = await readRepositoryState(transaction, signal)
        const rows = await transaction.getAll<ScopeRow>(
          `${scopeSelectSql()} ORDER BY updatedAt DESC, scopeId ASC`,
        )
        throwIfCancelled(signal)
        if (rows.length > MAX_SCOPE_COUNT) throw new TavernWorkspaceCorruptionError('The Tavern workspace scope count is invalid.')
        const scopes = rows.map((row) => decodeScopeRow(row, dependencies.codec, maxSnapshotCharacters))
        const links = await readActiveScopeLinks(transaction, scopes, signal)
        return ok(buildRepositorySnapshot(state, scopes, links))
      }))
    },

    getScope(scopeId, options) {
      const cancelled = cancellationBeforeStart<TavernWorkspaceScopeRecord<Snapshot>>(options)
      if (cancelled) return Promise.resolve(cancelled)
      const normalizedScopeId = normalizeTavernWorkspaceScopeId(scopeId)
      if (!normalizedScopeId) return Promise.resolve(failure('invalid_scope', 'The Tavern workspace scope identifier is invalid.'))
      return execute(options, async (value, signal) => {
        const row = await value.getFirst<ScopeRow>(`${scopeSelectSql()} WHERE scopeId = ?`, [normalizedScopeId])
        throwIfCancelled(signal)
        return row
          ? ok(decodeScopeRow(row, dependencies.codec, maxSnapshotCharacters))
          : failure('not_found', 'The Tavern workspace scope was not found.', false, normalizedScopeId)
      })
    },

    createScope(input, options) {
      const cancelled = cancellationBeforeStart<TavernWorkspaceScopeRecord<Snapshot>>(options)
      if (cancelled) return Promise.resolve(cancelled)
      const prepared = prepareScopeInput(input, dependencies.codec, maxSnapshotCharacters, now)
      if (!prepared.ok) return Promise.resolve(prepared)
      return execute(options, async (value, signal) => value.transaction(async (transaction) => {
        const existing = await transaction.getFirst<ScopeRow>(`${scopeSelectSql()} WHERE scopeId = ?`, [prepared.value.scopeId])
        throwIfCancelled(signal)
        if (existing) {
          decodeScopeRow(existing, dependencies.codec, maxSnapshotCharacters)
          return failure('duplicate', 'The Tavern workspace scope already exists.', false, prepared.value.scopeId)
        }
        const record = buildScopeRecord(prepared.value, 1)
        await insertScope(transaction, record, prepared.value.payloadJson, dependencies.codec.schema)
        throwIfCancelled(signal)
        await incrementRepositoryRevision(transaction, prepared.value.updatedAt, signal)
        throwIfCancelled(signal)
        return ok(record)
      }))
    },

    saveScope(input, options) {
      const cancelled = cancellationBeforeStart<TavernWorkspaceScopeRecord<Snapshot>>(options)
      if (cancelled) return Promise.resolve(cancelled)
      if (!isPositiveRevision(input.expectedRevision)) {
        return Promise.resolve(failure('validation_failed', 'The expected Tavern workspace revision is invalid.'))
      }
      const prepared = prepareScopeInput(input, dependencies.codec, maxSnapshotCharacters, now)
      if (!prepared.ok) return Promise.resolve(prepared)
      return execute(options, async (value, signal) => value.transaction(async (transaction) => {
        const existing = await transaction.getFirst<ScopeRow>(`${scopeSelectSql()} WHERE scopeId = ?`, [prepared.value.scopeId])
        throwIfCancelled(signal)
        if (!existing) return failure('not_found', 'The Tavern workspace scope was not found.', false, prepared.value.scopeId)
        const current = decodeScopeRow(existing, dependencies.codec, maxSnapshotCharacters)
        if (current.revision !== input.expectedRevision) {
          return conflict(prepared.value.scopeId, current.revision)
        }
        const record = buildScopeRecord(prepared.value, current.revision + 1)
        const update = await transaction.run(
          `UPDATE workspace_tavern_scopes
             SET recordSchema = ?, snapshotSchema = ?, revision = ?, updatedAt = ?, payloadJson = ?
           WHERE scopeId = ? AND revision = ?`,
          [record.schema, dependencies.codec.schema, record.revision, record.updatedAt, prepared.value.payloadJson,
            record.scopeId, input.expectedRevision],
        )
        throwIfCancelled(signal)
        if (update.changes !== 1) return conflict(record.scopeId, current.revision)
        await incrementRepositoryRevision(transaction, record.updatedAt, signal)
        throwIfCancelled(signal)
        return ok(record)
      }))
    },

    deleteScope(input, options) {
      const cancelled = cancellationBeforeStart<{ repositoryRevision: number }>(options)
      if (cancelled) return Promise.resolve(cancelled)
      const normalizedScopeId = normalizeTavernWorkspaceScopeId(input.scopeId)
      if (!normalizedScopeId) return Promise.resolve(failure('invalid_scope', 'The Tavern workspace scope identifier is invalid.'))
      const updatedAt = input.updatedAt ?? now()
      if (!isPositiveRevision(input.expectedRevision) || !isTimestamp(updatedAt)) {
        return Promise.resolve(failure('validation_failed', 'The Tavern workspace deletion input is invalid.'))
      }
      return execute(options, async (value, signal) => value.transaction(async (transaction) => {
        const existing = await transaction.getFirst<ScopeRow>(`${scopeSelectSql()} WHERE scopeId = ?`, [normalizedScopeId])
        throwIfCancelled(signal)
        if (!existing) return failure('not_found', 'The Tavern workspace scope was not found.', false, normalizedScopeId)
        const current = decodeScopeRow(existing, dependencies.codec, maxSnapshotCharacters)
        if (current.revision !== input.expectedRevision) return conflict(normalizedScopeId, current.revision)
        await transaction.run(
          'DELETE FROM workspace_tavern_active_scope_links WHERE conversationScopeId = ? OR activeScopeId = ?',
          [normalizedScopeId, normalizedScopeId],
        )
        throwIfCancelled(signal)
        const deletion = await transaction.run(
          'DELETE FROM workspace_tavern_scopes WHERE scopeId = ? AND revision = ?',
          [normalizedScopeId, input.expectedRevision],
        )
        throwIfCancelled(signal)
        if (deletion.changes !== 1) return conflict(normalizedScopeId, current.revision)
        const repositoryRevision = await incrementRepositoryRevision(transaction, updatedAt, signal)
        throwIfCancelled(signal)
        return ok({ repositoryRevision })
      }))
    },

    duplicateScope(input, options) {
      const cancelled = cancellationBeforeStart<TavernWorkspaceScopeRecord<Snapshot>>(options)
      if (cancelled) return Promise.resolve(cancelled)
      const sourceScopeId = normalizeTavernWorkspaceScopeId(input.sourceScopeId)
      const targetScopeId = normalizeTavernWorkspaceScopeId(input.targetScopeId)
      if (!sourceScopeId || !targetScopeId) {
        return Promise.resolve(failure('invalid_scope', 'A Tavern workspace scope identifier is invalid.'))
      }
      if (sourceScopeId === targetScopeId) {
        return Promise.resolve(failure('duplicate', 'The Tavern workspace duplicate target matches its source.', false, targetScopeId))
      }
      const updatedAt = input.updatedAt ?? now()
      if (!isPositiveRevision(input.expectedSourceRevision) || !isTimestamp(updatedAt)) {
        return Promise.resolve(failure('validation_failed', 'The Tavern workspace duplicate input is invalid.'))
      }
      return execute(options, async (value, signal) => value.transaction(async (transaction) => {
        const sourceRow = await transaction.getFirst<ScopeRow>(`${scopeSelectSql()} WHERE scopeId = ?`, [sourceScopeId])
        throwIfCancelled(signal)
        if (!sourceRow) return failure('not_found', 'The Tavern workspace source scope was not found.', false, sourceScopeId)
        const source = decodeScopeRow(sourceRow, dependencies.codec, maxSnapshotCharacters)
        if (source.revision !== input.expectedSourceRevision) return conflict(sourceScopeId, source.revision)
        const targetRow = await transaction.getFirst<ScopeRow>(`${scopeSelectSql()} WHERE scopeId = ?`, [targetScopeId])
        throwIfCancelled(signal)
        if (targetRow) {
          decodeScopeRow(targetRow, dependencies.codec, maxSnapshotCharacters)
          return failure('duplicate', 'The Tavern workspace target scope already exists.', false, targetScopeId)
        }
        const record: TavernWorkspaceScopeRecord<Snapshot> = {
          ...source,
          scopeId: targetScopeId,
          revision: 1,
          updatedAt,
        }
        const payloadJson = encodeSnapshot(source.snapshot, dependencies.codec, maxSnapshotCharacters)
        if (!payloadJson.ok) return payloadJson
        await insertScope(transaction, record, payloadJson.value.payloadJson, dependencies.codec.schema)
        throwIfCancelled(signal)
        await incrementRepositoryRevision(transaction, updatedAt, signal)
        throwIfCancelled(signal)
        return ok(record)
      }))
    },

    setActiveScope(input, options) {
      const cancelled = cancellationBeforeStart<{ activeScopeId: string; repositoryRevision: number }>(options)
      if (cancelled) return Promise.resolve(cancelled)
      const conversationScopeId = normalizeTavernWorkspaceScopeId(input.conversationScopeId)
      const requestedActiveScopeId = input.activeScopeId == null
        ? conversationScopeId
        : normalizeTavernWorkspaceScopeId(input.activeScopeId)
      if (!conversationScopeId || !requestedActiveScopeId) {
        return Promise.resolve(failure('invalid_scope', 'A Tavern workspace active-scope identifier is invalid.'))
      }
      const updatedAt = input.updatedAt ?? now()
      if (!isNonNegativeRevision(input.expectedRepositoryRevision) || !isTimestamp(updatedAt)) {
        return Promise.resolve(failure('validation_failed', 'The Tavern workspace active-scope revision is invalid.'))
      }
      return execute(options, async (value, signal) => value.transaction(async (transaction) => {
        const state = await readRepositoryState(transaction, signal)
        if (state.revision !== input.expectedRepositoryRevision) {
          return repositoryConflict(state.revision)
        }
        if (requestedActiveScopeId !== conversationScopeId) {
          const target = await transaction.getFirst<ScopeRow>(`${scopeSelectSql()} WHERE scopeId = ?`, [requestedActiveScopeId])
          throwIfCancelled(signal)
          if (!target) return failure('not_found', 'The requested Tavern workspace active scope was not found.', false, requestedActiveScopeId)
          decodeScopeRow(target, dependencies.codec, maxSnapshotCharacters)
        }
        const existing = await transaction.getFirst<ActiveScopeLinkRow>(
          `SELECT conversationScopeId, activeScopeId, updatedAt
             FROM workspace_tavern_active_scope_links WHERE conversationScopeId = ?`,
          [conversationScopeId],
        )
        throwIfCancelled(signal)
        if (existing) validateLinkRow(existing)
        const nextStoredTarget = requestedActiveScopeId === conversationScopeId ? undefined : requestedActiveScopeId
        if (existing?.activeScopeId === nextStoredTarget || (!existing && !nextStoredTarget)) {
          return ok({ activeScopeId: requestedActiveScopeId, repositoryRevision: state.revision })
        }
        if (nextStoredTarget) {
          await transaction.run(
            `INSERT INTO workspace_tavern_active_scope_links (conversationScopeId, activeScopeId, updatedAt)
             VALUES (?, ?, ?)
             ON CONFLICT(conversationScopeId) DO UPDATE SET
               activeScopeId = excluded.activeScopeId,
               updatedAt = excluded.updatedAt`,
            [conversationScopeId, nextStoredTarget, updatedAt],
          )
        } else {
          await transaction.run('DELETE FROM workspace_tavern_active_scope_links WHERE conversationScopeId = ?', [conversationScopeId])
        }
        throwIfCancelled(signal)
        const repositoryRevision = await incrementRepositoryRevision(
          transaction,
          updatedAt,
          signal,
          input.expectedRepositoryRevision,
        )
        throwIfCancelled(signal)
        return ok({ activeScopeId: requestedActiveScopeId, repositoryRevision })
      }))
    },

    replaceAll(input, options) {
      const cancelled = cancellationBeforeStart<TavernWorkspaceRepositorySnapshot<Snapshot>>(options)
      if (cancelled) return Promise.resolve(cancelled)
      if (!isNonNegativeRevision(input.expectedRepositoryRevision)) {
        return Promise.resolve(failure('validation_failed', 'The expected Tavern repository revision is invalid.'))
      }
      const prepared = prepareReplacement(input, dependencies.codec, maxSnapshotCharacters, now)
      if (!prepared.ok) return Promise.resolve(prepared)
      return execute(options, async (value, signal) => value.transaction(async (transaction) => {
        const state = await readRepositoryState(transaction, signal)
        if (state.revision !== input.expectedRepositoryRevision) return repositoryConflict(state.revision)
        await transaction.run('DELETE FROM workspace_tavern_active_scope_links')
        throwIfCancelled(signal)
        await transaction.run('DELETE FROM workspace_tavern_scopes')
        throwIfCancelled(signal)
        const scopes: TavernWorkspaceScopeRecord<Snapshot>[] = []
        for (const scope of prepared.value.scopes) {
          throwIfCancelled(signal)
          const record = buildScopeRecord(scope, 1)
          await insertScope(transaction, record, scope.payloadJson, dependencies.codec.schema)
          scopes.push(record)
        }
        for (const [conversationScopeId, activeScopeId] of Object.entries(prepared.value.activeScopeLinks)) {
          throwIfCancelled(signal)
          await transaction.run(
            `INSERT INTO workspace_tavern_active_scope_links (conversationScopeId, activeScopeId, updatedAt)
             VALUES (?, ?, ?)`,
            [conversationScopeId, activeScopeId, prepared.value.updatedAt],
          )
        }
        throwIfCancelled(signal)
        const revision = await incrementRepositoryRevision(
          transaction,
          prepared.value.updatedAt,
          signal,
          input.expectedRepositoryRevision,
        )
        throwIfCancelled(signal)
        return ok({
          schema: TAVERN_WORKSPACE_REPOSITORY_SNAPSHOT_SCHEMA,
          revision,
          scopes,
          activeScopeLinks: prepared.value.activeScopeLinks,
          updatedAt: prepared.value.updatedAt,
        })
      }))
    },
  }
}

/**
 * Provides one native atomic authority boundary for Chat workspace review.
 * Historical Tavern rows remain the storage format until portable migration.
 */
export function createSqliteChatWorkspaceReviewScopePort<Snapshot>(
  dependencies: SqliteChatWorkspaceReviewScopePortDependencies<Snapshot>,
): ChatWorkspaceReviewScopePort {
  if (dependencies.runtime !== 'native') {
    throw new TypeError('The SQLite Chat workspace review scope port is native-only.')
  }
  const maxSnapshotCharacters = dependencies.maxSnapshotCharacters ?? DEFAULT_MAX_SNAPSHOT_CHARACTERS
  if (
    typeof dependencies.databaseProvider?.get !== 'function'
    || !isBoundedSchema(dependencies.codec?.schema)
    || typeof dependencies.codec?.parse !== 'function'
    || typeof dependencies.createEmptySnapshot !== 'function'
    || !Number.isSafeInteger(maxSnapshotCharacters)
    || maxSnapshotCharacters < 1
  ) {
    throw new TypeError('The Chat workspace review scope port configuration is invalid.')
  }
  let initialization: Promise<void> | undefined

  async function database(signal: AbortSignal): Promise<SqliteDatabase> {
    throwIfCancelled(signal)
    const value = await raceWithCancellation(dependencies.databaseProvider.get(), signal)
    throwIfCancelled(signal)
    initialization ??= ensureSchema(value).catch((error) => {
      initialization = undefined
      throw error
    })
    await raceWithCancellation(initialization, signal)
    throwIfCancelled(signal)
    return value
  }

  return {
    async loadLinkedScope(input, options) {
      const signal = readChatWorkspaceReviewSignal(options)
      if (!signal) return { status: 'failed' }
      if (signal.aborted) return { status: 'cancelled' }
      const identity = prepareChatWorkspaceReviewScopeIdentity(input)
      if (!identity) return { status: 'failed' }

      try {
        const value = await database(signal)
        const result = await value.transaction(async (transaction) => {
          const state = await readRepositoryState(transaction, signal)
          const activeScopeId = await readLinkedActiveScopeId(
            transaction,
            identity.conversationId,
            signal,
          )
          if (activeScopeId !== identity.workspaceId) return { status: 'stale' } as const

          const row = await transaction.getFirst<ScopeRow>(
            `${scopeSelectSql()} WHERE scopeId = ?`,
            [activeScopeId],
          )
          throwIfCancelled(signal)
          if (!row) {
            if (activeScopeId !== identity.conversationId || state.revision !== 0) {
              throw new TavernWorkspaceCorruptionError('The linked Chat workspace scope is missing.')
            }
            const empty = encodeSnapshot(
              dependencies.createEmptySnapshot(state.updatedAt),
              dependencies.codec,
              maxSnapshotCharacters,
            )
            if (!empty.ok) {
              throw new TavernWorkspaceCorruptionError('The empty Chat workspace snapshot is invalid.')
            }
            return {
              status: 'ready',
              conversationId: identity.conversationId,
              workspaceId: identity.workspaceId,
              repositoryRevision: 0,
              snapshot: empty.value.snapshot,
            } as const
          }
          if (state.revision === 0) {
            throw new TavernWorkspaceCorruptionError('The Chat workspace repository authority is incoherent.')
          }
          const scope = decodeScopeRow(row, dependencies.codec, maxSnapshotCharacters)
          return {
            status: 'ready',
            conversationId: identity.conversationId,
            workspaceId: identity.workspaceId,
            repositoryRevision: state.revision,
            snapshot: scope.snapshot,
          } as const
        })
        return signal.aborted ? { status: 'cancelled' } : result
      } catch (error) {
        return error instanceof TavernWorkspaceCancellationError || signal.aborted
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
      const prepared = encodeSnapshot(command.snapshot, dependencies.codec, maxSnapshotCharacters)
      if (!prepared.ok) return { status: 'failed' }

      let scopeWriteApplied = false
      try {
        const value = await database(signal)
        const result = await value.transaction(async (transaction) => {
          const activeScopeId = await readLinkedActiveScopeId(
            transaction,
            command.conversationId,
            signal,
          )
          const state = await readRepositoryState(transaction, signal)
          if (
            activeScopeId !== command.workspaceId
            || state.revision !== command.expectedRepositoryRevision
          ) {
            return { status: 'conflict' } as const
          }

          const row = await transaction.getFirst<ScopeRow>(
            `${scopeSelectSql()} WHERE scopeId = ?`,
            [activeScopeId],
          )
          throwIfCancelled(signal)
          if (!row) return { status: 'not_found' } as const
          if (state.revision === 0) {
            throw new TavernWorkspaceCorruptionError('The Chat workspace repository authority is incoherent.')
          }
          const current = decodeScopeRow(row, dependencies.codec, maxSnapshotCharacters)
          if (
            current.revision === Number.MAX_SAFE_INTEGER
            || state.revision === Number.MAX_SAFE_INTEGER
          ) {
            throw new TavernWorkspaceCorruptionError('The Chat workspace revision cannot be advanced.')
          }

          throwIfCancelled(signal)
          const nextScopeRevision = current.revision + 1
          const update = await transaction.run(
            `UPDATE workspace_tavern_scopes
                SET recordSchema = ?, snapshotSchema = ?, revision = ?, updatedAt = ?, payloadJson = ?
              WHERE scopeId = ? AND revision = ?`,
            [
              TAVERN_WORKSPACE_SCOPE_RECORD_SCHEMA,
              dependencies.codec.schema,
              nextScopeRevision,
              command.updatedAt,
              prepared.value.payloadJson,
              activeScopeId,
              current.revision,
            ],
          )
          if (update.changes !== 1) throw new ChatWorkspaceReviewConflictError()
          scopeWriteApplied = true

          const repositoryRevision = state.revision + 1
          const authorityUpdate = await transaction.run(
            `UPDATE workspace_tavern_repository_state
                SET revision = ?, updatedAt = ?
              WHERE singletonId = 1 AND revision = ?`,
            [repositoryRevision, command.updatedAt, state.revision],
          )
          if (authorityUpdate.changes !== 1) throw new ChatWorkspaceReviewConflictError()
          return {
            status: 'applied',
            conversationId: command.conversationId,
            workspaceId: command.workspaceId,
            repositoryRevision,
            snapshot: prepared.value.snapshot,
          } as const
        })
        return !scopeWriteApplied && signal.aborted
          ? { status: 'cancelled' }
          : result
      } catch (error) {
        if (error instanceof ChatWorkspaceReviewConflictError) return { status: 'conflict' }
        if (!scopeWriteApplied && (error instanceof TavernWorkspaceCancellationError || signal.aborted)) {
          return { status: 'cancelled' }
        }
        return { status: 'failed' }
      }
    },
  }
}

/**
 * Commits one Tavern-backed Chat writeback and its replay receipt atomically.
 * This store is intentionally separate from TavernWorkspaceRepository so the
 * compatibility repository surface does not acquire generic Chat behavior.
 */
export function createSqliteTavernChatWorkspaceWritebackStore<Snapshot>(
  dependencies: SqliteTavernChatWorkspaceWritebackStoreDependencies<Snapshot>,
): TavernChatWorkspaceWritebackAtomicStore<Snapshot> {
  if (dependencies.runtime !== 'native') {
    throw new TypeError('The SQLite Tavern Chat workspace writeback store is native-only.')
  }
  const maxSnapshotCharacters = dependencies.maxSnapshotCharacters ?? DEFAULT_MAX_SNAPSHOT_CHARACTERS
  if (
    !isBoundedSchema(dependencies.codec.schema)
    || typeof dependencies.digestProvider?.digestCanonicalPayload !== 'function'
    || !Number.isSafeInteger(maxSnapshotCharacters)
    || maxSnapshotCharacters < 1
  ) {
    throw new TypeError('The Tavern Chat workspace writeback store configuration is invalid.')
  }
  let initialization: Promise<void> | undefined

  async function database(signal: AbortSignal): Promise<SqliteDatabase> {
    throwIfCancelled(signal)
    const value = await dependencies.databaseProvider.get()
    throwIfCancelled(signal)
    initialization ??= ensureSchema(value).catch((error) => {
      initialization = undefined
      throw error
    })
    await initialization
    throwIfCancelled(signal)
    return value
  }

  async function writebackAtomic(
    changeSet: TavernChatWorkspaceWritebackChangeSet,
    mutate: (
      snapshot: Snapshot,
      changeSet: TavernChatWorkspaceWritebackChangeSet,
    ) => TavernChatWorkspaceWritebackMutationResult<Snapshot>,
    options: { readonly signal: AbortSignal },
  ): Promise<TavernChatWorkspaceWritebackAtomicStoreResult> {
    if (options.signal.aborted) return { status: 'cancelled' }
    if (!isValidWritebackChangeSet(changeSet) || typeof mutate !== 'function') {
      return writebackFailure('The Tavern Chat workspace writeback input is invalid.')
    }

    let actualDigest: unknown
    try {
      actualDigest = await dependencies.digestProvider.digestCanonicalPayload(
        canonicalizeTavernChatWorkspaceWritebackChangeSet(changeSet),
        options,
      )
    } catch {
      return options.signal.aborted
        ? { status: 'cancelled' }
        : writebackFailure('The Tavern Chat workspace writeback digest could not be verified.')
    }
    if (options.signal.aborted) return { status: 'cancelled' }
    if (actualDigest !== changeSet.digest) {
      return writebackFailure('The Tavern Chat workspace writeback digest is invalid.')
    }

    try {
      const value = await database(options.signal)
      return await value.transaction(async (transaction) => {
        throwIfCancelled(options.signal)
        const receiptRow = await selectWritebackReceipt(
          transaction,
          changeSet.workspaceId,
          changeSet.idempotencyKey,
        )
        throwIfCancelled(options.signal)
        if (receiptRow) {
          return replayWritebackReceipt(decodeWritebackReceipt(receiptRow), changeSet)
        }

        const state = await readRepositoryState(transaction, options.signal)
        if (state.revision !== changeSet.repositoryAuthorityRevision) {
          return { status: 'conflict', actualAuthorityRevision: state.revision }
        }
        if (state.revision === Number.MAX_SAFE_INTEGER) {
          return writebackFailure('The Tavern workspace repository revision cannot be advanced.')
        }

        const scopeRow = await transaction.getFirst<ScopeRow>(
          `${scopeSelectSql()} WHERE scopeId = ?`,
          [changeSet.activeScopeId],
        )
        throwIfCancelled(options.signal)
        if (!scopeRow) {
          return writebackFailure('The resolved Tavern workspace scope was not found.')
        }
        const current = decodeScopeRow(scopeRow, dependencies.codec, maxSnapshotCharacters)
        if (current.revision === Number.MAX_SAFE_INTEGER) {
          return writebackFailure('The Tavern workspace scope revision cannot be advanced.')
        }

        const mutation = mutate(current.snapshot, changeSet) as unknown
        if (!isRecordValue(mutation) || (mutation.status !== 'applied' && mutation.status !== 'no_changes')) {
          return writebackFailure('The Tavern workspace mutation returned an invalid result.')
        }

        if (mutation.status === 'no_changes') {
          throwIfCancelled(options.signal)
          await insertWritebackReceipt(transaction, changeSet, 'no_changes', state.revision)
          return { status: 'no_changes', authorityRevision: state.revision }
        }

        const prepared = encodeSnapshot(mutation.snapshot, dependencies.codec, maxSnapshotCharacters)
        if (!prepared.ok) {
          return writebackFailure('The Tavern workspace mutation returned an invalid snapshot.')
        }
        throwIfCancelled(options.signal)

        // This scope update is the first effect. From this point through receipt
        // insertion, cancellation cannot replace the committed durable outcome.
        const nextScopeRevision = current.revision + 1
        const update = await transaction.run(
          `UPDATE workspace_tavern_scopes
              SET recordSchema = ?, snapshotSchema = ?, revision = ?, updatedAt = ?, payloadJson = ?
            WHERE scopeId = ? AND revision = ?`,
          [
            TAVERN_WORKSPACE_SCOPE_RECORD_SCHEMA,
            dependencies.codec.schema,
            nextScopeRevision,
            changeSet.occurredAt,
            prepared.value.payloadJson,
            current.scopeId,
            current.revision,
          ],
        )
        if (update.changes !== 1) {
          throw new TavernWorkspaceCorruptionError('The Tavern workspace scope changed inside an exclusive transaction.')
        }
        const authorityRevision = await incrementRepositoryRevision(
          transaction,
          changeSet.occurredAt,
          undefined,
          changeSet.repositoryAuthorityRevision,
        )
        await insertWritebackReceipt(transaction, changeSet, 'applied', authorityRevision)
        return { status: 'applied', authorityRevision }
      })
    } catch (error) {
      if (error instanceof TavernWorkspaceCancellationError || options.signal.aborted) {
        return { status: 'cancelled' }
      }
      if (error instanceof TavernWorkspaceCorruptionError) {
        return writebackFailure(error.message || 'A persisted Tavern workspace writeback record is corrupt.')
      }
      return writebackFailure('Tavern Chat workspace writeback persistence failed.')
    }
  }

  return { writebackAtomic }
}

/**
 * Reconciles a recovered Chat run from durable receipt facts without
 * reconstructing or repeating the writeback effect.
 */
export function createSqliteTavernChatWorkspaceWritebackReceiptLookup(
  dependencies: SqliteTavernChatWorkspaceWritebackReceiptLookupDependencies,
): TavernChatWorkspaceWritebackReceiptLookup {
  if (dependencies.runtime !== 'native') {
    throw new TypeError('The SQLite Tavern Chat workspace writeback receipt lookup is native-only.')
  }
  if (typeof dependencies.databaseProvider?.get !== 'function') {
    throw new TypeError('The Tavern Chat workspace writeback receipt lookup configuration is invalid.')
  }

  async function database(signal: AbortSignal): Promise<SqliteDatabase> {
    throwIfCancelled(signal)
    const value = await raceWithCancellation(dependencies.databaseProvider.get(), signal)
    throwIfCancelled(signal)
    return value
  }

  return {
    async lookup(identity, options) {
      if (options.signal.aborted) return frozenLookupOutcome({ status: 'cancelled' })
      if (!isValidWritebackReceiptLookupIdentity(identity)) {
        return frozenLookupOutcome({ status: 'failed', code: 'invalid_identity' })
      }

      try {
        const value = await database(options.signal)
        const rows = await raceWithCancellation(
          value.getAll<WritebackReceiptRow>(
            `SELECT recordSchema, workspaceId, idempotencyKey, changeSetDigest, assistantRunId,
                    conversationId, assistantMessageId, expectedAuthorityRevision, activeScopeId,
                    outcomeStatus, authorityRevision, createdAt
               FROM ${WRITEBACK_RECEIPT_TABLE}
              WHERE assistantRunId = ? AND conversationId = ? AND assistantMessageId = ?
              ORDER BY workspaceId ASC, idempotencyKey ASC
              LIMIT 2`,
            [identity.assistantRunId, identity.conversationId, identity.assistantMessageId],
          ),
          options.signal,
        )
        throwIfCancelled(options.signal)
        if (rows.length === 0) return frozenLookupOutcome({ status: 'none' })

        const receipts: WritebackReceipt[] = []
        for (const row of rows) {
          throwIfCancelled(options.signal)
          const receipt = decodeWritebackReceipt(row)
          if (
            receipt.assistantRunId !== identity.assistantRunId
            || receipt.conversationId !== identity.conversationId
            || receipt.assistantMessageId !== identity.assistantMessageId
          ) {
            throw new TavernWorkspaceCorruptionError(
              'A persisted Tavern Chat workspace writeback receipt has inconsistent lookup identity.',
            )
          }
          receipts.push(receipt)
        }
        throwIfCancelled(options.signal)
        if (receipts.length !== 1) return frozenLookupOutcome({ status: 'ambiguous' })

        return frozenLookupOutcome({
          status: 'committed',
          receipt: committedWritebackReceipt(identity, receipts[0]),
        })
      } catch (error) {
        if (error instanceof TavernWorkspaceCancellationError || options.signal.aborted) {
          return frozenLookupOutcome({ status: 'cancelled' })
        }
        return frozenLookupOutcome({
          status: 'failed',
          code: error instanceof TavernWorkspaceCorruptionError
            ? 'invalid_receipt'
            : 'persistence_failed',
        })
      }
    },
  }
}

async function ensureSchema(database: SqliteDatabase): Promise<void> {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS workspace_tavern_repository_state (
      singletonId INTEGER PRIMARY KEY NOT NULL CHECK (singletonId = 1),
      revision INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      schemaVersion INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspace_tavern_scopes (
      scopeId TEXT PRIMARY KEY NOT NULL,
      recordSchema TEXT NOT NULL,
      snapshotSchema TEXT NOT NULL,
      revision INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      payloadJson TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS workspace_tavern_scopes_updated_idx
      ON workspace_tavern_scopes (updatedAt DESC, scopeId ASC);
    CREATE TABLE IF NOT EXISTS workspace_tavern_active_scope_links (
      conversationScopeId TEXT PRIMARY KEY NOT NULL,
      activeScopeId TEXT NOT NULL,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY (activeScopeId) REFERENCES workspace_tavern_scopes(scopeId) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS workspace_tavern_active_scope_target_idx
      ON workspace_tavern_active_scope_links (activeScopeId);
    CREATE TABLE IF NOT EXISTS ${WRITEBACK_RECEIPT_TABLE} (
      recordSchema TEXT NOT NULL,
      workspaceId TEXT NOT NULL,
      idempotencyKey TEXT NOT NULL,
      changeSetDigest TEXT NOT NULL,
      assistantRunId TEXT NOT NULL,
      conversationId TEXT NOT NULL,
      assistantMessageId TEXT NOT NULL,
      expectedAuthorityRevision INTEGER NOT NULL CHECK (expectedAuthorityRevision >= 0),
      activeScopeId TEXT NOT NULL,
      outcomeStatus TEXT NOT NULL CHECK (outcomeStatus IN ('applied', 'no_changes')),
      authorityRevision INTEGER NOT NULL CHECK (authorityRevision >= 0),
      createdAt INTEGER NOT NULL CHECK (createdAt >= 0),
      PRIMARY KEY (workspaceId, idempotencyKey)
    );
    CREATE INDEX IF NOT EXISTS workspace_tavern_chat_writeback_run_idx
      ON ${WRITEBACK_RECEIPT_TABLE} (assistantRunId, conversationId, assistantMessageId);
    INSERT OR IGNORE INTO workspace_tavern_repository_state
      (singletonId, revision, updatedAt, schemaVersion)
      VALUES (1, 0, 0, ${TAVERN_WORKSPACE_SQLITE_SCHEMA_VERSION});
  `)
}

function scopeSelectSql(): string {
  return `SELECT scopeId, recordSchema, snapshotSchema, revision, updatedAt, payloadJson
            FROM workspace_tavern_scopes`
}

async function readRepositoryState(
  transaction: SqliteExecutor,
  signal?: AbortSignal,
): Promise<RepositoryStateRow> {
  const state = await transaction.getFirst<RepositoryStateRow>(
    `SELECT revision, updatedAt, schemaVersion
       FROM workspace_tavern_repository_state WHERE singletonId = 1`,
  )
  throwIfCancelled(signal)
  if (!state || state.schemaVersion !== TAVERN_WORKSPACE_SQLITE_SCHEMA_VERSION ||
      !isNonNegativeRevision(state.revision) || !isTimestamp(state.updatedAt)) {
    throw new TavernWorkspaceCorruptionError('The Tavern workspace repository state is corrupt.')
  }
  return state
}

async function readLinkedActiveScopeId(
  transaction: SqliteExecutor,
  conversationScopeId: string,
  signal?: AbortSignal,
): Promise<string> {
  const row = await transaction.getFirst<ActiveScopeLinkRow>(
    `SELECT conversationScopeId, activeScopeId, updatedAt
       FROM workspace_tavern_active_scope_links
      WHERE conversationScopeId = ?`,
    [conversationScopeId],
  )
  throwIfCancelled(signal)
  if (!row) return conversationScopeId
  validateLinkRow(row)
  if (row.conversationScopeId !== conversationScopeId) {
    throw new TavernWorkspaceCorruptionError('The Chat workspace active-scope link is incoherent.')
  }
  return row.activeScopeId
}

async function selectWritebackReceipt(
  transaction: SqliteExecutor,
  workspaceId: string,
  idempotencyKey: string,
): Promise<WritebackReceiptRow | null> {
  return transaction.getFirst<WritebackReceiptRow>(
    `SELECT recordSchema, workspaceId, idempotencyKey, changeSetDigest, assistantRunId,
            conversationId, assistantMessageId, expectedAuthorityRevision, activeScopeId,
            outcomeStatus, authorityRevision, createdAt
       FROM ${WRITEBACK_RECEIPT_TABLE}
      WHERE workspaceId = ? AND idempotencyKey = ?`,
    [workspaceId, idempotencyKey],
  )
}

function decodeWritebackReceipt(row: WritebackReceiptRow): WritebackReceipt {
  if (
    row.recordSchema !== TAVERN_CHAT_WORKSPACE_WRITEBACK_RECEIPT_RECORD_SCHEMA
    || !isBoundedIdentity(row.workspaceId, CHAT_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS)
    || normalizeTavernWorkspaceScopeId(row.workspaceId) !== row.workspaceId
    || !isBoundedIdentity(row.idempotencyKey, CHAT_WORKSPACE_WRITEBACK_IDEMPOTENCY_KEY_MAX_CHARACTERS)
    || typeof row.changeSetDigest !== 'string'
    || !SHA256_DIGEST_PATTERN.test(row.changeSetDigest)
    || !isBoundedIdentity(row.assistantRunId, CHAT_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS)
    || !isBoundedIdentity(row.conversationId, CHAT_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS)
    || !isBoundedIdentity(row.assistantMessageId, CHAT_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS)
    || !isNonNegativeRevision(row.expectedAuthorityRevision)
    || typeof row.activeScopeId !== 'string'
    || row.activeScopeId !== row.workspaceId
    || (row.outcomeStatus !== 'applied' && row.outcomeStatus !== 'no_changes')
    || !isNonNegativeRevision(row.authorityRevision)
    || !isTimestamp(row.createdAt)
    || (row.outcomeStatus === 'applied' && row.authorityRevision !== row.expectedAuthorityRevision + 1)
    || (row.outcomeStatus === 'no_changes' && row.authorityRevision !== row.expectedAuthorityRevision)
  ) {
    throw new TavernWorkspaceCorruptionError('A persisted Tavern Chat workspace writeback receipt is corrupt.')
  }
  return {
    workspaceId: row.workspaceId,
    idempotencyKey: row.idempotencyKey,
    changeSetDigest: row.changeSetDigest,
    assistantRunId: row.assistantRunId,
    conversationId: row.conversationId,
    assistantMessageId: row.assistantMessageId,
    expectedAuthorityRevision: row.expectedAuthorityRevision,
    activeScopeId: row.activeScopeId,
    outcomeStatus: row.outcomeStatus,
    authorityRevision: row.authorityRevision,
    createdAt: row.createdAt,
  }
}

function replayWritebackReceipt(
  receipt: WritebackReceipt,
  changeSet: TavernChatWorkspaceWritebackChangeSet,
): TavernChatWorkspaceWritebackAtomicStoreResult {
  if (receipt.changeSetDigest !== changeSet.digest) {
    return writebackFailure('The durable idempotency key belongs to a different Tavern workspace writeback.')
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
    throw new TavernWorkspaceCorruptionError('A Tavern Chat workspace writeback receipt has inconsistent identity.')
  }
  return receipt.outcomeStatus === 'applied'
    ? { status: 'replayed', authorityRevision: receipt.authorityRevision }
    : { status: 'no_changes', authorityRevision: receipt.authorityRevision }
}

async function insertWritebackReceipt(
  transaction: SqliteExecutor,
  changeSet: TavernChatWorkspaceWritebackChangeSet,
  outcomeStatus: WritebackReceipt['outcomeStatus'],
  authorityRevision: number,
): Promise<void> {
  const result = await transaction.run(
    `INSERT INTO ${WRITEBACK_RECEIPT_TABLE}
       (recordSchema, workspaceId, idempotencyKey, changeSetDigest, assistantRunId,
        conversationId, assistantMessageId, expectedAuthorityRevision, activeScopeId,
        outcomeStatus, authorityRevision, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      TAVERN_CHAT_WORKSPACE_WRITEBACK_RECEIPT_RECORD_SCHEMA,
      changeSet.workspaceId,
      changeSet.idempotencyKey,
      changeSet.digest,
      changeSet.assistantRunId,
      changeSet.conversationId,
      changeSet.assistantMessageId,
      changeSet.repositoryAuthorityRevision,
      changeSet.activeScopeId,
      outcomeStatus,
      authorityRevision,
      changeSet.occurredAt,
    ],
  )
  if (result.changes !== 1) {
    throw new TavernWorkspaceCorruptionError('The Tavern Chat workspace writeback receipt was not stored atomically.')
  }
}

async function readActiveScopeLinks<Snapshot>(
  transaction: SqliteExecutor,
  scopes: readonly TavernWorkspaceScopeRecord<Snapshot>[],
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  const rows = await transaction.getAll<ActiveScopeLinkRow>(
    `SELECT conversationScopeId, activeScopeId, updatedAt
       FROM workspace_tavern_active_scope_links ORDER BY conversationScopeId ASC`,
  )
  throwIfCancelled(signal)
  if (rows.length > MAX_ACTIVE_SCOPE_LINK_COUNT) {
    throw new TavernWorkspaceCorruptionError('The Tavern workspace active-scope link count is invalid.')
  }
  const scopeIds = new Set(scopes.map((scope) => scope.scopeId))
  const links: Record<string, string> = {}
  for (const row of rows) {
    validateLinkRow(row)
    if (!scopeIds.has(row.activeScopeId) || row.conversationScopeId === row.activeScopeId || links[row.conversationScopeId]) {
      throw new TavernWorkspaceCorruptionError('A Tavern workspace active-scope link is incoherent.')
    }
    links[row.conversationScopeId] = row.activeScopeId
  }
  return links
}

function validateLinkRow(row: ActiveScopeLinkRow): void {
  if (normalizeTavernWorkspaceScopeId(row.conversationScopeId) !== row.conversationScopeId ||
      normalizeTavernWorkspaceScopeId(row.activeScopeId) !== row.activeScopeId ||
      !isTimestamp(row.updatedAt)) {
    throw new TavernWorkspaceCorruptionError('A persisted Tavern workspace active-scope link is corrupt.')
  }
}

function decodeScopeRow<Snapshot>(
  row: ScopeRow,
  codec: TavernWorkspaceSnapshotCodec<Snapshot>,
  maxSnapshotCharacters: number,
): TavernWorkspaceScopeRecord<Snapshot> {
  if (row.recordSchema !== TAVERN_WORKSPACE_SCOPE_RECORD_SCHEMA || row.snapshotSchema !== codec.schema ||
      normalizeTavernWorkspaceScopeId(row.scopeId) !== row.scopeId || !isPositiveRevision(row.revision) ||
      !isTimestamp(row.updatedAt) || typeof row.payloadJson !== 'string' || row.payloadJson.length > maxSnapshotCharacters) {
    throw new TavernWorkspaceCorruptionError('A persisted Tavern workspace scope record is corrupt.')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(row.payloadJson)
  } catch {
    throw new TavernWorkspaceCorruptionError('A persisted Tavern workspace payload is not valid JSON.')
  }
  let snapshot: Snapshot | undefined
  try {
    snapshot = codec.parse(parsed)
  } catch {
    snapshot = undefined
  }
  if (snapshot === undefined) {
    throw new TavernWorkspaceCorruptionError('A persisted Tavern workspace payload is invalid or incompatible.')
  }
  return {
    schema: TAVERN_WORKSPACE_SCOPE_RECORD_SCHEMA,
    scopeId: row.scopeId,
    revision: row.revision,
    snapshot,
    updatedAt: row.updatedAt,
  }
}

function prepareScopeInput<Snapshot>(
  input: CreateTavernWorkspaceScopeInput<Snapshot>,
  codec: TavernWorkspaceSnapshotCodec<Snapshot>,
  maxSnapshotCharacters: number,
  now: () => number,
): TavernWorkspaceRepositoryResult<PreparedReplacementScope<Snapshot>> {
  const scopeId = normalizeTavernWorkspaceScopeId(input.scopeId)
  if (!scopeId) return failure('invalid_scope', 'The Tavern workspace scope identifier is invalid.')
  const updatedAt = input.updatedAt ?? now()
  if (!isTimestamp(updatedAt)) return failure('validation_failed', 'The Tavern workspace update timestamp is invalid.')
  const prepared = encodeSnapshot(input.snapshot, codec, maxSnapshotCharacters)
  if (!prepared.ok) return prepared
  return ok({ scopeId, updatedAt, ...prepared.value })
}

function encodeSnapshot<Snapshot>(
  snapshot: Snapshot,
  codec: TavernWorkspaceSnapshotCodec<Snapshot>,
  maxSnapshotCharacters: number,
): TavernWorkspaceRepositoryResult<PreparedSnapshot<Snapshot>> {
  let parsedJson: unknown
  try {
    const encoded = JSON.stringify(snapshot)
    if (typeof encoded !== 'string' || encoded.length > maxSnapshotCharacters) {
      return failure('validation_failed', 'The Tavern workspace snapshot exceeds the persistence limit.')
    }
    parsedJson = JSON.parse(encoded)
  } catch {
    return failure('validation_failed', 'The Tavern workspace snapshot is not serializable.')
  }
  let normalized: Snapshot | undefined
  try {
    normalized = codec.parse(parsedJson)
  } catch {
    normalized = undefined
  }
  if (normalized === undefined) return failure('validation_failed', 'The Tavern workspace snapshot is invalid or incompatible.')
  try {
    const payloadJson = JSON.stringify(normalized)
    if (typeof payloadJson !== 'string' || payloadJson.length > maxSnapshotCharacters) {
      return failure('validation_failed', 'The normalized Tavern workspace snapshot exceeds the persistence limit.')
    }
    return ok({ snapshot: normalized, payloadJson })
  } catch {
    return failure('validation_failed', 'The normalized Tavern workspace snapshot is not serializable.')
  }
}

function prepareReplacement<Snapshot>(
  input: ReplaceTavernWorkspaceRepositoryInput<Snapshot>,
  codec: TavernWorkspaceSnapshotCodec<Snapshot>,
  maxSnapshotCharacters: number,
  now: () => number,
): TavernWorkspaceRepositoryResult<{
  scopes: PreparedReplacementScope<Snapshot>[]
  activeScopeLinks: Record<string, string>
  updatedAt: number
}> {
  if (!Array.isArray(input.scopes) || input.scopes.length > MAX_SCOPE_COUNT) {
    return failure('validation_failed', 'The Tavern workspace replacement scope count is invalid.')
  }
  const updatedAt = input.updatedAt ?? now()
  if (!isTimestamp(updatedAt)) return failure('validation_failed', 'The Tavern workspace replacement timestamp is invalid.')
  const scopes: PreparedReplacementScope<Snapshot>[] = []
  const scopeIds = new Set<string>()
  for (const scope of input.scopes) {
    const prepared = prepareReplacementScope(scope, codec, maxSnapshotCharacters, updatedAt)
    if (!prepared.ok) return prepared
    if (scopeIds.has(prepared.value.scopeId)) {
      return failure('duplicate', 'The Tavern workspace replacement contains duplicate scopes.', false, prepared.value.scopeId)
    }
    scopeIds.add(prepared.value.scopeId)
    scopes.push(prepared.value)
  }
  const entries = Object.entries(input.activeScopeLinks ?? {})
  if (entries.length > MAX_ACTIVE_SCOPE_LINK_COUNT) {
    return failure('validation_failed', 'The Tavern workspace replacement active-scope link count is invalid.')
  }
  const activeScopeLinks: Record<string, string> = {}
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
    if (activeScopeLinks[conversationScopeId]) {
      return failure('duplicate', 'The Tavern workspace replacement contains duplicate active-scope links.', false, conversationScopeId)
    }
    activeScopeLinks[conversationScopeId] = activeScopeId
  }
  return ok({ scopes, activeScopeLinks, updatedAt })
}

function prepareReplacementScope<Snapshot>(
  scope: TavernWorkspaceReplacementScope<Snapshot>,
  codec: TavernWorkspaceSnapshotCodec<Snapshot>,
  maxSnapshotCharacters: number,
  fallbackUpdatedAt: number,
): TavernWorkspaceRepositoryResult<PreparedReplacementScope<Snapshot>> {
  const scopeId = normalizeTavernWorkspaceScopeId(scope.scopeId)
  if (!scopeId) return failure('invalid_scope', 'A Tavern workspace replacement scope identifier is invalid.')
  const updatedAt = scope.updatedAt ?? fallbackUpdatedAt
  if (!isTimestamp(updatedAt)) return failure('validation_failed', 'A Tavern workspace replacement timestamp is invalid.')
  const prepared = encodeSnapshot(scope.snapshot, codec, maxSnapshotCharacters)
  if (!prepared.ok) return prepared
  return ok({ scopeId, updatedAt, ...prepared.value })
}

function buildScopeRecord<Snapshot>(
  prepared: PreparedReplacementScope<Snapshot>,
  revision: number,
): TavernWorkspaceScopeRecord<Snapshot> {
  return {
    schema: TAVERN_WORKSPACE_SCOPE_RECORD_SCHEMA,
    scopeId: prepared.scopeId,
    revision,
    snapshot: prepared.snapshot,
    updatedAt: prepared.updatedAt,
  }
}

async function insertScope<Snapshot>(
  transaction: SqliteExecutor,
  record: TavernWorkspaceScopeRecord<Snapshot>,
  payloadJson: string,
  snapshotSchema: string,
): Promise<void> {
  await transaction.run(
    `INSERT INTO workspace_tavern_scopes
       (scopeId, recordSchema, snapshotSchema, revision, updatedAt, payloadJson)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [record.scopeId, record.schema, snapshotSchema, record.revision, record.updatedAt, payloadJson],
  )
}

async function incrementRepositoryRevision(
  transaction: SqliteExecutor,
  updatedAt: number,
  signal?: AbortSignal,
  expectedRevision?: number,
): Promise<number> {
  const state = await readRepositoryState(transaction, signal)
  if (expectedRevision !== undefined && state.revision !== expectedRevision) {
    throw new TavernWorkspaceCorruptionError('The Tavern repository revision changed inside an exclusive transaction.')
  }
  const nextRevision = state.revision + 1
  const update = await transaction.run(
    `UPDATE workspace_tavern_repository_state
        SET revision = ?, updatedAt = ?
      WHERE singletonId = 1 AND revision = ?`,
    [nextRevision, updatedAt, state.revision],
  )
  throwIfCancelled(signal)
  if (update.changes !== 1) {
    throw new TavernWorkspaceCorruptionError('The Tavern repository revision could not be advanced atomically.')
  }
  return nextRevision
}

function buildRepositorySnapshot<Snapshot>(
  state: RepositoryStateRow,
  scopes: readonly TavernWorkspaceScopeRecord<Snapshot>[],
  links: Readonly<Record<string, string>>,
): TavernWorkspaceRepositorySnapshot<Snapshot> {
  return {
    schema: TAVERN_WORKSPACE_REPOSITORY_SNAPSHOT_SCHEMA,
    revision: state.revision,
    scopes,
    activeScopeLinks: links,
    updatedAt: state.updatedAt,
  }
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new TavernWorkspaceCancellationError()
}

function raceWithCancellation<Value>(
  operation: Promise<Value>,
  signal: AbortSignal,
): Promise<Value> {
  if (signal.aborted) return Promise.reject(new TavernWorkspaceCancellationError())
  return new Promise<Value>((resolve, reject) => {
    const cancel = () => reject(new TavernWorkspaceCancellationError())
    signal.addEventListener('abort', cancel, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', cancel)
        if (signal.aborted) {
          reject(new TavernWorkspaceCancellationError())
          return
        }
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', cancel)
        reject(error)
      },
    )
  })
}

function isValidWritebackReceiptLookupIdentity(
  identity: TavernChatWorkspaceWritebackReceiptLookupIdentity,
): boolean {
  return isRecordValue(identity)
    && isBoundedIdentity(identity.assistantRunId, CHAT_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS)
    && isBoundedIdentity(identity.conversationId, CHAT_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS)
    && isBoundedIdentity(identity.assistantMessageId, CHAT_WORKSPACE_WRITEBACK_IDENTITY_MAX_CHARACTERS)
}

function prepareChatWorkspaceReviewScopeIdentity(
  value: unknown,
): { readonly conversationId: string; readonly workspaceId: string } | undefined {
  if (!isRecordValue(value)) return undefined
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
  if (!identity || !isRecordValue(value)) return undefined
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
  if (!isRecordValue(value)) return undefined
  try {
    const signal = value.signal
    return isRecordValue(signal)
      && typeof signal.aborted === 'boolean'
      && typeof signal.addEventListener === 'function'
      && typeof signal.removeEventListener === 'function'
      ? signal as unknown as AbortSignal
      : undefined
  } catch {
    return undefined
  }
}

function committedWritebackReceipt(
  identity: TavernChatWorkspaceWritebackReceiptLookupIdentity,
  receipt: WritebackReceipt,
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

function cancellationBeforeStart<Value>(
  options?: TavernWorkspaceRepositoryOptions,
): TavernWorkspaceRepositoryResult<Value> | undefined {
  return options?.signal?.aborted
    ? failure('cancelled', 'The Tavern workspace persistence operation was cancelled.')
    : undefined
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

function isBoundedSchema(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 160 && value.trim() === value
}

function isValidWritebackChangeSet(value: TavernChatWorkspaceWritebackChangeSet): boolean {
  if (!isRecordValue(value) || !isRecordValue(value.applicationOptions)) return false
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
    || !isBoundedIdentity(value.idempotencyKey, CHAT_WORKSPACE_WRITEBACK_IDEMPOTENCY_KEY_MAX_CHARACTERS)
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

function isBoundedIdentity(value: unknown, maximumCharacters: number): value is string {
  return typeof value === 'string'
    && value.length <= maximumCharacters
    && value.trim().length > 0
}

function isRecordValue(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key))
}

function writebackFailure(reason: string): TavernChatWorkspaceWritebackAtomicStoreResult {
  return { status: 'failed', reason }
}

function conflict<Value>(scopeId: string, actualRevision: number): TavernWorkspaceRepositoryResult<Value> {
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
