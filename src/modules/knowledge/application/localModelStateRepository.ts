import * as v from 'valibot'

export const LOCAL_MODEL_STATE_STORAGE_KEY = '@islemind/local-embedding-models'
export const LOCAL_MODEL_STATE_MAX_ENTRIES = 128
export const LOCAL_MODEL_STATE_MAX_FAILURE_LENGTH = 2_048
export const LOCAL_MODEL_STATE_MAX_SERIALIZED_LENGTH = 512 * 1_024

const MAX_MODEL_ID_LENGTH = 256
const MAX_FILE_PATH_LENGTH = 1_024
const MAX_HASH_ENTRIES = 64

export type LocalModelStateSource = 'bundled' | 'downloaded'

export interface LocalModelStateRecord {
  modelId: string
  source: LocalModelStateSource
  downloadedAt?: number
  verifiedAt?: number
  bytes?: number
  sha256?: Record<string, string>
}

export interface LocalModelStateSnapshot {
  records: Record<string, LocalModelStateRecord>
  failed: Record<string, string>
}

export interface LocalModelStateStoragePort {
  getItem(key: string, signal?: AbortSignal): Promise<string | null | undefined>
  setItem(key: string, value: string, signal?: AbortSignal): Promise<void>
  removeItem(key: string, signal?: AbortSignal): Promise<void>
}

export interface LocalModelStateOperationOptions {
  signal?: AbortSignal
}

export interface LocalModelStateRepository {
  loadState(options?: LocalModelStateOperationOptions): Promise<LocalModelStateSnapshot>
  recordInstalledModel(
    record: LocalModelStateRecord,
    options?: LocalModelStateOperationOptions,
  ): Promise<LocalModelStateRecord>
  markModelFailure(modelId: string, message: string, options?: LocalModelStateOperationOptions): Promise<void>
  removeModel(modelId: string, options?: LocalModelStateOperationOptions): Promise<void>
  clear(options?: LocalModelStateOperationOptions): Promise<void>
}

export interface LocalModelStateRecoveryResetOptions extends LocalModelStateOperationOptions {
  isCurrent?: () => boolean
}

export interface LocalModelStateRecoveryReview {
  reset(options?: LocalModelStateRecoveryResetOptions): Promise<void>
}

export interface LocalModelStateRecoveryRepository extends LocalModelStateRepository {
  reviewInvalidState(options?: LocalModelStateOperationOptions): Promise<LocalModelStateRecoveryReview | null>
}

const nonNegativeNumberSchema = v.pipe(v.number(), v.finite(), v.minValue(0))
const modelIdSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_MODEL_ID_LENGTH))
const filePathSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_FILE_PATH_LENGTH))
const sha256Schema = v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/i))
const stateRecordMetadataSchema = v.object({
  modelId: modelIdSchema,
  source: v.picklist(['bundled', 'downloaded']),
  downloadedAt: v.optional(nonNegativeNumberSchema),
  verifiedAt: v.optional(nonNegativeNumberSchema),
  bytes: v.optional(nonNegativeNumberSchema),
})

export class LocalModelStatePersistenceError extends Error {
  constructor(readonly operation: 'load' | 'save' | 'remove') {
    super(`Local-model state ${operation} failed.`)
    this.name = 'LocalModelStatePersistenceError'
  }
}

export class LocalModelStateDataError extends Error {
  constructor() {
    super('The persisted local-model state is invalid.')
    this.name = 'LocalModelStateDataError'
  }
}

export class LocalModelStateRecoveryConflictError extends Error {
  constructor() {
    super('The reviewed local-model state changed. Review it again before resetting.')
    this.name = 'LocalModelStateRecoveryConflictError'
  }
}

export function createLocalModelStateRepository(
  storage: LocalModelStateStoragePort,
): LocalModelStateRecoveryRepository {
  let operationTail: Promise<void> = Promise.resolve()
  let revision = 0
  let observed = false
  let observedRaw: string | null | undefined

  function run<T>(signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
    const result = operationTail.then(() => {
      throwIfAborted(signal)
      return operation()
    })
    operationTail = result.then(() => undefined, () => undefined)
    return result
  }

  async function readRaw(signal?: AbortSignal): Promise<string | null | undefined> {
    let raw: string | null | undefined
    try {
      raw = await storage.getItem(LOCAL_MODEL_STATE_STORAGE_KEY, signal)
      throwIfAborted(signal)
    } catch (error) {
      throwIfAborted(signal)
      if (error instanceof Error && error.name === 'AbortError') throw error
      throw new LocalModelStatePersistenceError('load')
    }
    // Observation invalidates consent, but never serves a later read from memory.
    if (observed && raw !== observedRaw) revision += 1
    observed = true
    observedRaw = raw
    return raw
  }

  async function readState(signal?: AbortSignal): Promise<LocalModelStateSnapshot> {
    return parseRawState(await readRaw(signal))
  }

  async function reviewInvalidState(
    options: LocalModelStateOperationOptions = {},
  ): Promise<LocalModelStateRecoveryReview | null> {
    const signal = options.signal
    return run(signal, async () => {
      const raw = await readRaw(signal)
      if (raw === null || raw === undefined) return null
      if (typeof raw !== 'string') throw new LocalModelStateDataError()
      try {
        parseRawState(raw)
        return null
      } catch (error) {
        if (!(error instanceof LocalModelStateDataError)) throw error
      }
      const reviewedRevision = revision
      let consumed = false
      return Object.freeze({
        async reset(resetOptions: LocalModelStateRecoveryResetOptions = {}): Promise<void> {
          const resetSignal = resetOptions.signal ?? signal
          const isCurrent = resetOptions.isCurrent
          const requireLifetime = () => {
            throwIfAborted(signal)
            throwIfAborted(resetSignal)
          }
          requireLifetime()
          return run(resetSignal, async () => {
            requireLifetime()
            if (consumed) throw new LocalModelStateRecoveryConflictError()
            let current: string | null | undefined
            try { current = await readRaw(resetSignal) }
            catch (error) { requireLifetime(); throw error }
            requireLifetime()
            if (current !== raw || revision !== reviewedRevision) {
              throw new LocalModelStateRecoveryConflictError()
            }
            // Caller ownership/consent can retire while the storage read is awaited.
            let currentConsent: boolean
            try {
              currentConsent = isCurrent === undefined || (typeof isCurrent === 'function' && isCurrent() === true)
            } catch (error) { requireLifetime(); throw error }
            requireLifetime()
            if (!currentConsent || revision !== reviewedRevision) throw new LocalModelStateRecoveryConflictError()
            // Admission consumes consent even when storage cannot acknowledge removal.
            consumed = true
            try { await removeState(resetSignal) }
            catch (error) { requireLifetime(); throw error }
          })
        },
      })
    })
  }

  async function loadState(options: LocalModelStateOperationOptions = {}): Promise<LocalModelStateSnapshot> {
    const signal = options.signal
    return run(signal, async () => cloneState(await readState(signal)))
  }

  async function recordInstalledModel(
    record: LocalModelStateRecord,
    options: LocalModelStateOperationOptions = {},
  ): Promise<LocalModelStateRecord> {
    const signal = options.signal
    throwIfAborted(signal)
    const normalized = parseInputRecord(record)
    return run(signal, async () => {
      revision += 1
      const next = await readState(signal)
      assertRoom(next.records, normalized.modelId)
      next.records = Object.fromEntries([
        ...Object.entries(next.records),
        [normalized.modelId, cloneRecord(normalized)],
      ])
      delete next.failed[normalized.modelId]
      await persist(next, signal)
      return cloneRecord(normalized)
    })
  }

  async function markModelFailure(
    modelId: string,
    message: string,
    options: LocalModelStateOperationOptions = {},
  ): Promise<void> {
    const signal = options.signal
    throwIfAborted(signal)
    const normalizedModelId = v.parse(modelIdSchema, modelId)
    const normalizedMessage = v.parse(v.string(), message).slice(0, LOCAL_MODEL_STATE_MAX_FAILURE_LENGTH)
    return run(signal, async () => {
      revision += 1
      const next = await readState(signal)
      assertRoom(next.failed, normalizedModelId)
      next.failed = Object.fromEntries([
        ...Object.entries(next.failed),
        [normalizedModelId, normalizedMessage],
      ])
      await persist(next, signal)
    })
  }

  async function removeModel(
    modelId: string,
    options: LocalModelStateOperationOptions = {},
  ): Promise<void> {
    const signal = options.signal
    throwIfAborted(signal)
    const normalizedModelId = v.parse(modelIdSchema, modelId)
    return run(signal, async () => {
      revision += 1
      const next = await readState(signal)
      delete next.records[normalizedModelId]
      delete next.failed[normalizedModelId]
      await persist(next, signal)
    })
  }

  async function clear(options: LocalModelStateOperationOptions = {}): Promise<void> {
    const signal = options.signal
    return run(signal, async () => removeState(signal))
  }

  async function removeState(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    revision += 1
    try {
      await storage.removeItem(LOCAL_MODEL_STATE_STORAGE_KEY, signal)
    } catch (error) {
      throwIfAborted(signal)
      if (error instanceof Error && error.name === 'AbortError') throw error
      throw new LocalModelStatePersistenceError('remove')
    }
  }

  async function persist(state: LocalModelStateSnapshot, signal?: AbortSignal): Promise<void> {
    const normalized = parsePersistedState(state)
    const serialized = JSON.stringify(normalized)
    if (serialized.length > LOCAL_MODEL_STATE_MAX_SERIALIZED_LENGTH) {
      throw new Error('The local-model state exceeds the persistence size limit.')
    }
    throwIfAborted(signal)
    try {
      await storage.setItem(LOCAL_MODEL_STATE_STORAGE_KEY, serialized, signal)
    } catch (error) {
      throwIfAborted(signal)
      if (error instanceof Error && error.name === 'AbortError') throw error
      throw new LocalModelStatePersistenceError('save')
    }
  }

  return { loadState, recordInstalledModel, markModelFailure, removeModel, clear, reviewInvalidState }
}

function parseRawState(raw: string | null | undefined): LocalModelStateSnapshot {
  if (raw === null || raw === undefined) return emptyState()
  if (typeof raw !== 'string' || raw.length > LOCAL_MODEL_STATE_MAX_SERIALIZED_LENGTH) {
    throw new LocalModelStateDataError()
  }
  try {
    return parsePersistedState(JSON.parse(raw))
  } catch {
    throw new LocalModelStateDataError()
  }
}

function parsePersistedState(value: unknown): LocalModelStateSnapshot {
  if (!isPlainObject(value) || Object.keys(value).some(key => key !== 'records' && key !== 'failed') ||
    !isPlainObject(value.records) || !isPlainObject(value.failed)) {
    throw new LocalModelStateDataError()
  }
  const recordEntries = Object.entries(value.records)
  const failureEntries = Object.entries(value.failed)
  if (recordEntries.length > LOCAL_MODEL_STATE_MAX_ENTRIES || failureEntries.length > LOCAL_MODEL_STATE_MAX_ENTRIES) {
    throw new LocalModelStateDataError()
  }
  const records = Object.fromEntries(recordEntries.map(([modelId, candidate]) => {
    const parsed = safeParseRecord(candidate)
    if (!parsed || parsed.modelId !== modelId) throw new LocalModelStateDataError()
    return [modelId, parsed]
  }))
  const failed = Object.fromEntries(failureEntries.map(([modelId, message]) => {
    if (!v.safeParse(modelIdSchema, modelId).success || typeof message !== 'string' ||
      message.length > LOCAL_MODEL_STATE_MAX_FAILURE_LENGTH) throw new LocalModelStateDataError()
    return [modelId, message]
  }))
  return { records, failed }
}

function parseInputRecord(value: unknown): LocalModelStateRecord {
  const parsed = safeParseRecord(value)
  if (!parsed) throw new Error('The local-model state record is invalid.')
  return parsed
}

function safeParseRecord(value: unknown): LocalModelStateRecord | undefined {
  if (!isPlainObject(value)) return undefined
  const allowed = ['modelId', 'source', 'downloadedAt', 'verifiedAt', 'bytes', 'sha256']
  if (Object.keys(value).some(key => !allowed.includes(key))) return undefined
  const parsed = v.safeParse(stateRecordMetadataSchema, value)
  if (!parsed.success) return undefined
  if (value.sha256 === undefined) return cloneRecord(parsed.output)
  if (!isPlainObject(value.sha256)) return undefined
  const hashEntries = Object.entries(value.sha256)
  if (hashEntries.length > MAX_HASH_ENTRIES) return undefined
  const hashes: [string, string][] = []
  // Hash paths are literal data keys, including prototype-named paths.
  for (const [filePath, hash] of hashEntries) {
    const parsedPath = v.safeParse(filePathSchema, filePath)
    const parsedHash = v.safeParse(sha256Schema, hash)
    if (!parsedPath.success || !parsedHash.success) return undefined
    hashes.push([parsedPath.output, parsedHash.output])
  }
  return cloneRecord({ ...parsed.output, sha256: Object.fromEntries(hashes) })
}

function emptyState(): LocalModelStateSnapshot {
  return { records: {}, failed: {} }
}

function cloneState(state: LocalModelStateSnapshot): LocalModelStateSnapshot {
  return {
    records: Object.fromEntries(
      Object.entries(state.records).map(([modelId, record]) => [modelId, cloneRecord(record)]),
    ),
    failed: Object.fromEntries(Object.entries(state.failed)),
  }
}

function cloneRecord(record: LocalModelStateRecord): LocalModelStateRecord {
  return {
    ...record,
    ...(record.sha256 ? { sha256: Object.fromEntries(Object.entries(record.sha256)) } : {}),
  }
}

function assertRoom<T>(entries: Record<string, T>, key: string): void {
  if (Object.hasOwn(entries, key) || Object.keys(entries).length < LOCAL_MODEL_STATE_MAX_ENTRIES) return
  throw new Error('The local-model state entry limit was reached.')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  throw error
}
