import { err, ok } from '@/core'
import {
  normalizeTavernWorkspaceScopeId,
  type ReplaceTavernWorkspaceRepositoryInput,
  type TavernWorkspaceRepository,
  type TavernWorkspaceRepositoryOptions,
  type TavernWorkspaceRepositoryResult,
  type TavernWorkspaceRepositorySnapshot,
  type TavernWorkspaceReplacementScope,
  type TavernWorkspaceScopeRecord,
} from './tavernWorkspaceRepository'

export interface TavernWorkspacePersistenceDependencies<Snapshot> {
  repository: TavernWorkspaceRepository<Snapshot>
  createEmptySnapshot(now: number): Snapshot
  cloneSnapshot(snapshot: Snapshot): Snapshot
  now?: () => number
  defaultScopeId?: string
  /** Retries after the initial CAS attempt. Limited to eight. */
  maxCasRetries?: number
}

export interface TavernWorkspacePersistenceOptions extends TavernWorkspaceRepositoryOptions {
  updatedAt?: number
}

export interface TavernWorkspaceLoadedScope<Snapshot> {
  scopeId: string
  snapshot: Snapshot
  revision: number
  persisted: boolean
  updatedAt: number
}

export interface TavernWorkspaceUpsertInput<Snapshot> {
  scopeId?: string
  snapshot: Snapshot
  updatedAt?: number
}

export type TavernWorkspaceScopeReducer<Snapshot> = (snapshot: Snapshot) => Snapshot

export interface TavernWorkspaceImportInput<Snapshot> {
  scopes: readonly TavernWorkspaceReplacementScope<Snapshot>[]
  activeScopeLinks: Readonly<Record<string, string>>
  updatedAt?: number
}

export interface TavernWorkspacePersistence<Snapshot> {
  loadOrEmpty(
    scopeId?: string,
    options?: TavernWorkspaceRepositoryOptions,
  ): Promise<TavernWorkspaceRepositoryResult<TavernWorkspaceLoadedScope<Snapshot>>>
  upsertScope(
    input: TavernWorkspaceUpsertInput<Snapshot>,
    options?: TavernWorkspaceRepositoryOptions,
  ): Promise<TavernWorkspaceRepositoryResult<TavernWorkspaceScopeRecord<Snapshot>>>
  /** The reducer must be pure because CAS recovery may invoke it again. */
  updateScope(
    scopeId: string | undefined,
    reducer: TavernWorkspaceScopeReducer<Snapshot>,
    options?: TavernWorkspacePersistenceOptions,
  ): Promise<TavernWorkspaceRepositoryResult<TavernWorkspaceScopeRecord<Snapshot>>>
  listScopes(
    options?: TavernWorkspaceRepositoryOptions,
  ): Promise<TavernWorkspaceRepositoryResult<readonly TavernWorkspaceScopeRecord<Snapshot>[]>>
  clearScope(
    scopeId: string,
    options?: TavernWorkspacePersistenceOptions,
  ): Promise<TavernWorkspaceRepositoryResult<{ cleared: boolean; repositoryRevision?: number }>>
  clearAll(
    options?: TavernWorkspacePersistenceOptions,
  ): Promise<TavernWorkspaceRepositoryResult<TavernWorkspaceRepositorySnapshot<Snapshot>>>
  resolveActiveScope(
    conversationScopeId: string | undefined,
    options?: TavernWorkspaceRepositoryOptions,
  ): Promise<TavernWorkspaceRepositoryResult<string | undefined>>
  setActiveScope(
    conversationScopeId: string | undefined,
    activeScopeId?: string | null,
    options?: TavernWorkspacePersistenceOptions,
  ): Promise<TavernWorkspaceRepositoryResult<string | undefined>>
  loadAll(
    options?: TavernWorkspaceRepositoryOptions,
  ): Promise<TavernWorkspaceRepositoryResult<TavernWorkspaceRepositorySnapshot<Snapshot>>>
  exportAll(
    options?: TavernWorkspaceRepositoryOptions,
  ): Promise<TavernWorkspaceRepositoryResult<TavernWorkspaceRepositorySnapshot<Snapshot>>>
  replaceImport(
    input: TavernWorkspaceImportInput<Snapshot>,
    options?: TavernWorkspaceRepositoryOptions,
  ): Promise<TavernWorkspaceRepositoryResult<TavernWorkspaceRepositorySnapshot<Snapshot>>>
}

/**
 * Behavior-compatible Tavern persistence operations over either SQLite or the
 * single-envelope key-value repository. It owns retries, not storage.
 */
export function createTavernWorkspacePersistence<Snapshot>(
  dependencies: TavernWorkspacePersistenceDependencies<Snapshot>,
): TavernWorkspacePersistence<Snapshot> {
  const now = dependencies.now ?? Date.now
  const configuredDefaultScopeId = normalizeTavernWorkspaceScopeId(dependencies.defaultScopeId ?? 'default')
  const maxCasRetries = dependencies.maxCasRetries ?? 2
  if (!configuredDefaultScopeId || !Number.isSafeInteger(maxCasRetries) || maxCasRetries < 0 || maxCasRetries > 8) {
    throw new TypeError('The Tavern workspace persistence configuration is invalid.')
  }
  const defaultScopeId: string = configuredDefaultScopeId
  const maxAttempts = maxCasRetries + 1

  async function repositoryCall<Value>(
    signal: AbortSignal | undefined,
    call: () => Promise<TavernWorkspaceRepositoryResult<Value>>,
    committedSuccessWins = false,
  ): Promise<TavernWorkspaceRepositoryResult<Value>> {
    if (signal?.aborted) return cancelled()
    const result = await call()
    if (signal?.aborted && !(committedSuccessWins && result.ok)) return cancelled()
    return result
  }

  async function loadOrEmpty(
    scopeId = defaultScopeId,
    options: TavernWorkspaceRepositoryOptions = {},
  ): Promise<TavernWorkspaceRepositoryResult<TavernWorkspaceLoadedScope<Snapshot>>> {
    if (options.signal?.aborted) return cancelled()
    const normalizedScopeId = normalizeTavernWorkspaceScopeId(scopeId) ?? defaultScopeId
    const result = await repositoryCall(options.signal, () => dependencies.repository.getScope(normalizedScopeId, options))
    if (result.ok) {
      const snapshot = safeClone(result.value.snapshot)
      if (!snapshot.ok) return snapshot
      if (options.signal?.aborted) return cancelled()
      return ok({
        scopeId: result.value.scopeId,
        snapshot: snapshot.value,
        revision: result.value.revision,
        persisted: true,
        updatedAt: result.value.updatedAt,
      })
    }
    if (result.error.code !== 'not_found') return result
    const updatedAt = now()
    if (!isTimestamp(updatedAt)) return failure('validation_failed', 'The Tavern workspace clock returned an invalid timestamp.')
    let empty: Snapshot
    try {
      empty = dependencies.createEmptySnapshot(updatedAt)
    } catch {
      return failure('validation_failed', 'The empty Tavern workspace snapshot could not be created.')
    }
    const snapshot = safeClone(empty)
    if (!snapshot.ok) return snapshot
    if (options.signal?.aborted) return cancelled()
    return ok({ scopeId: normalizedScopeId, snapshot: snapshot.value, revision: 0, persisted: false, updatedAt })
  }

  async function updateScope(
    scopeId: string | undefined,
    reducer: TavernWorkspaceScopeReducer<Snapshot>,
    options: TavernWorkspacePersistenceOptions = {},
  ): Promise<TavernWorkspaceRepositoryResult<TavernWorkspaceScopeRecord<Snapshot>>> {
    if (options.signal?.aborted) return cancelled()
    if (typeof reducer !== 'function') return failure('validation_failed', 'The Tavern workspace reducer is invalid.')
    const normalizedScopeId = normalizeTavernWorkspaceScopeId(scopeId ?? defaultScopeId) ?? defaultScopeId
    const fixedUpdatedAt = options.updatedAt
    if (fixedUpdatedAt !== undefined && !isTimestamp(fixedUpdatedAt)) {
      return failure('validation_failed', 'The Tavern workspace update timestamp is invalid.')
    }

    let lastRace: TavernWorkspaceRepositoryResult<TavernWorkspaceScopeRecord<Snapshot>> | undefined
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (options.signal?.aborted) return cancelled()
      const current = await loadOrEmpty(normalizedScopeId, options)
      if (!current.ok) return current
      const reducerInput = safeClone(current.value.snapshot)
      if (!reducerInput.ok) return reducerInput
      let reduced: Snapshot
      try {
        reduced = reducer(reducerInput.value)
      } catch {
        return failure('validation_failed', 'The Tavern workspace reducer failed.')
      }
      if (options.signal?.aborted) return cancelled()
      const next = safeClone(reduced)
      if (!next.ok) return next
      const updatedAt = fixedUpdatedAt ?? now()
      if (!isTimestamp(updatedAt)) return failure('validation_failed', 'The Tavern workspace clock returned an invalid timestamp.')
      const repositoryOptions = { signal: options.signal }
      const result = current.value.persisted
        ? await repositoryCall(options.signal, () => dependencies.repository.saveScope({
            scopeId: normalizedScopeId,
            snapshot: next.value,
            expectedRevision: current.value.revision,
            updatedAt,
          }, repositoryOptions), true)
        : await repositoryCall(options.signal, () => dependencies.repository.createScope({
            scopeId: normalizedScopeId,
            snapshot: next.value,
            updatedAt,
          }, repositoryOptions), true)
      if (result.ok) return result
      const isRetryableRace = current.value.persisted
        ? result.error.code === 'revision_conflict' || result.error.code === 'not_found'
        : result.error.code === 'duplicate'
      if (!isRetryableRace) return result
      lastRace = result
    }
    return lastRace ?? failure('revision_conflict', 'The Tavern workspace update could not win its bounded CAS retry.', true)
  }

  async function loadAll(
    options: TavernWorkspaceRepositoryOptions = {},
  ): Promise<TavernWorkspaceRepositoryResult<TavernWorkspaceRepositorySnapshot<Snapshot>>> {
    return repositoryCall(options.signal, () => dependencies.repository.load(options))
  }

  return {
    loadOrEmpty,

    upsertScope(input, options = {}) {
      return updateScope(input.scopeId, () => input.snapshot, {
        signal: options.signal,
        updatedAt: input.updatedAt,
      })
    },

    updateScope,

    async listScopes(options = {}) {
      const result = await loadAll(options)
      return result.ok ? ok(result.value.scopes) : result
    },

    async clearScope(scopeId, options = {}) {
      if (options.signal?.aborted) return cancelled()
      const normalizedScopeId = normalizeTavernWorkspaceScopeId(scopeId) ?? defaultScopeId
      const fixedUpdatedAt = options.updatedAt
      if (fixedUpdatedAt !== undefined && !isTimestamp(fixedUpdatedAt)) {
        return failure('validation_failed', 'The Tavern workspace deletion timestamp is invalid.')
      }
      let lastRace: TavernWorkspaceRepositoryResult<{ cleared: boolean; repositoryRevision?: number }> | undefined
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const current = await repositoryCall(options.signal, () => dependencies.repository.getScope(normalizedScopeId, {
          signal: options.signal,
        }))
        if (!current.ok) {
          if (current.error.code === 'not_found') return ok({ cleared: false })
          return current
        }
        const updatedAt = fixedUpdatedAt ?? now()
        if (!isTimestamp(updatedAt)) return failure('validation_failed', 'The Tavern workspace clock returned an invalid timestamp.')
        const deletion = await repositoryCall(options.signal, () => dependencies.repository.deleteScope({
          scopeId: normalizedScopeId,
          expectedRevision: current.value.revision,
          updatedAt,
        }, { signal: options.signal }), true)
        if (deletion.ok) return ok({ cleared: true, repositoryRevision: deletion.value.repositoryRevision })
        if (deletion.error.code !== 'revision_conflict' && deletion.error.code !== 'not_found') return deletion
        lastRace = deletion
      }
      return lastRace ?? failure('revision_conflict', 'The Tavern workspace deletion could not win its bounded CAS retry.', true)
    },

    async clearAll(options = {}) {
      const fixedUpdatedAt = options.updatedAt
      if (options.signal?.aborted) return cancelled()
      if (fixedUpdatedAt !== undefined && !isTimestamp(fixedUpdatedAt)) {
        return failure('validation_failed', 'The Tavern workspace clear timestamp is invalid.')
      }
      let lastRace: TavernWorkspaceRepositoryResult<TavernWorkspaceRepositorySnapshot<Snapshot>> | undefined
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const current = await loadAll({ signal: options.signal })
        if (!current.ok) return current
        const updatedAt = fixedUpdatedAt ?? now()
        if (!isTimestamp(updatedAt)) return failure('validation_failed', 'The Tavern workspace clock returned an invalid timestamp.')
        const replacement = await repositoryCall(options.signal, () => dependencies.repository.replaceAll({
          scopes: [],
          activeScopeLinks: {},
          expectedRepositoryRevision: current.value.revision,
          updatedAt,
        }, { signal: options.signal }), true)
        if (replacement.ok) return replacement
        if (replacement.error.code !== 'revision_conflict') return replacement
        lastRace = replacement
      }
      return lastRace ?? failure('revision_conflict', 'The Tavern workspace clear could not win its bounded CAS retry.', true)
    },

    async resolveActiveScope(conversationScopeId, options = {}) {
      if (options.signal?.aborted) return cancelled()
      if (conversationScopeId === undefined) return ok(undefined)
      const normalizedConversationScopeId = normalizeTavernWorkspaceScopeId(conversationScopeId)
      if (!normalizedConversationScopeId) return ok(undefined)
      const state = await loadAll(options)
      if (!state.ok) return state
      return ok(Object.hasOwn(state.value.activeScopeLinks, normalizedConversationScopeId)
        ? state.value.activeScopeLinks[normalizedConversationScopeId]
        : normalizedConversationScopeId)
    },

    async setActiveScope(conversationScopeId, activeScopeId, options = {}) {
      if (options.signal?.aborted) return cancelled()
      if (conversationScopeId === undefined) return ok(undefined)
      const normalizedConversationScopeId = normalizeTavernWorkspaceScopeId(conversationScopeId)
      if (!normalizedConversationScopeId) return ok(undefined)
      const normalizedActiveScopeId = activeScopeId == null
        ? normalizedConversationScopeId
        : normalizeTavernWorkspaceScopeId(activeScopeId)
      if (!normalizedActiveScopeId) return failure('invalid_scope', 'The requested Tavern workspace active scope is invalid.')
      const fixedUpdatedAt = options.updatedAt
      if (fixedUpdatedAt !== undefined && !isTimestamp(fixedUpdatedAt)) {
        return failure('validation_failed', 'The Tavern workspace active-scope timestamp is invalid.')
      }
      let lastRace: TavernWorkspaceRepositoryResult<string | undefined> | undefined
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const current = await loadAll({ signal: options.signal })
        if (!current.ok) return current
        const resolvedActiveScopeId = normalizedActiveScopeId === normalizedConversationScopeId ||
          current.value.scopes.some((scope) => scope.scopeId === normalizedActiveScopeId)
          ? normalizedActiveScopeId
          : normalizedConversationScopeId
        const updatedAt = fixedUpdatedAt ?? now()
        if (!isTimestamp(updatedAt)) return failure('validation_failed', 'The Tavern workspace clock returned an invalid timestamp.')
        const result = await repositoryCall(options.signal, () => dependencies.repository.setActiveScope({
          conversationScopeId: normalizedConversationScopeId,
          activeScopeId: resolvedActiveScopeId,
          expectedRepositoryRevision: current.value.revision,
          updatedAt,
        }, { signal: options.signal }), true)
        if (result.ok) return ok(result.value.activeScopeId)
        if (result.error.code !== 'revision_conflict') return result
        lastRace = result
      }
      return lastRace ?? failure('revision_conflict', 'The Tavern active-scope update could not win its bounded CAS retry.', true)
    },

    loadAll,

    exportAll(options = {}) {
      return loadAll(options)
    },

    async replaceImport(input, options = {}) {
      if (options.signal?.aborted) return cancelled()
      let lastRace: TavernWorkspaceRepositoryResult<TavernWorkspaceRepositorySnapshot<Snapshot>> | undefined
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const current = await loadAll(options)
        if (!current.ok) return current
        const replacement: ReplaceTavernWorkspaceRepositoryInput<Snapshot> = {
          scopes: input.scopes,
          activeScopeLinks: input.activeScopeLinks,
          expectedRepositoryRevision: current.value.revision,
          ...(input.updatedAt === undefined ? {} : { updatedAt: input.updatedAt }),
        }
        const result = await repositoryCall(options.signal, () => dependencies.repository.replaceAll(replacement, options), true)
        if (result.ok) return result
        if (result.error.code !== 'revision_conflict') return result
        lastRace = result
      }
      return lastRace ?? failure('revision_conflict', 'The Tavern workspace import could not win its bounded CAS retry.', true)
    },
  }

  function safeClone(snapshot: Snapshot): TavernWorkspaceRepositoryResult<Snapshot> {
    try {
      return ok(dependencies.cloneSnapshot(snapshot))
    } catch {
      return failure('validation_failed', 'The Tavern workspace snapshot could not be cloned.')
    }
  }
}

function cancelled<Value>(): TavernWorkspaceRepositoryResult<Value> {
  return failure('cancelled', 'The Tavern workspace persistence operation was cancelled.')
}

function failure<Value>(
  code: 'cancelled' | 'invalid_scope' | 'validation_failed' | 'revision_conflict',
  message: string,
  retryable = false,
): TavernWorkspaceRepositoryResult<Value> {
  return err(code, message, { retryable })
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
