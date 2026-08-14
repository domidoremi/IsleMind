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

const nonNegativeNumberSchema = v.pipe(v.number(), v.finite(), v.minValue(0))
const modelIdSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_MODEL_ID_LENGTH))
const filePathSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_FILE_PATH_LENGTH))
const sha256Schema = v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/i))
const stateRecordSchema = v.object({
  modelId: modelIdSchema,
  source: v.picklist(['bundled', 'downloaded']),
  downloadedAt: v.optional(nonNegativeNumberSchema),
  verifiedAt: v.optional(nonNegativeNumberSchema),
  bytes: v.optional(nonNegativeNumberSchema),
  sha256: v.optional(v.record(filePathSchema, sha256Schema)),
})

export function createLocalModelStateRepository(
  storage: LocalModelStateStoragePort,
): LocalModelStateRepository {
  let cachedState: LocalModelStateSnapshot | null = null

  async function loadCachedState(signal?: AbortSignal): Promise<LocalModelStateSnapshot> {
    throwIfAborted(signal)
    if (cachedState) return cachedState
    let raw: string | null | undefined
    try {
      raw = await storage.getItem(LOCAL_MODEL_STATE_STORAGE_KEY, signal)
      throwIfAborted(signal)
    } catch {
      throwIfAborted(signal)
      return emptyState()
    }
    try {
      cachedState = raw && raw.length <= LOCAL_MODEL_STATE_MAX_SERIALIZED_LENGTH
        ? parsePersistedState(JSON.parse(raw))
        : emptyState()
    } catch {
      cachedState = emptyState()
    }
    return cachedState
  }

  async function loadState(options: LocalModelStateOperationOptions = {}): Promise<LocalModelStateSnapshot> {
    const state = await loadCachedState(options.signal)
    throwIfAborted(options.signal)
    return cloneState(state)
  }

  async function recordInstalledModel(
    record: LocalModelStateRecord,
    options: LocalModelStateOperationOptions = {},
  ): Promise<LocalModelStateRecord> {
    const normalized = parseInputRecord(record)
    const next = cloneState(await loadCachedState(options.signal))
    makeRoom(next.records, normalized.modelId)
    next.records[normalized.modelId] = cloneRecord(normalized)
    delete next.failed[normalized.modelId]
    await persist(next, options.signal)
    return cloneRecord(normalized)
  }

  async function markModelFailure(
    modelId: string,
    message: string,
    options: LocalModelStateOperationOptions = {},
  ): Promise<void> {
    const normalizedModelId = v.parse(modelIdSchema, modelId)
    const normalizedMessage = v.parse(v.string(), message).slice(0, LOCAL_MODEL_STATE_MAX_FAILURE_LENGTH)
    const next = cloneState(await loadCachedState(options.signal))
    makeRoom(next.failed, normalizedModelId)
    next.failed[normalizedModelId] = normalizedMessage
    await persist(next, options.signal)
  }

  async function removeModel(
    modelId: string,
    options: LocalModelStateOperationOptions = {},
  ): Promise<void> {
    const normalizedModelId = v.parse(modelIdSchema, modelId)
    const next = cloneState(await loadCachedState(options.signal))
    delete next.records[normalizedModelId]
    delete next.failed[normalizedModelId]
    await persist(next, options.signal)
  }

  async function clear(options: LocalModelStateOperationOptions = {}): Promise<void> {
    throwIfAborted(options.signal)
    await storage.removeItem(LOCAL_MODEL_STATE_STORAGE_KEY, options.signal)
    cachedState = emptyState()
  }

  async function persist(state: LocalModelStateSnapshot, signal?: AbortSignal): Promise<void> {
    const normalized = parsePersistedState(state)
    const serialized = JSON.stringify(normalized)
    if (serialized.length > LOCAL_MODEL_STATE_MAX_SERIALIZED_LENGTH) {
      throw new Error('The local-model state exceeds the persistence size limit.')
    }
    throwIfAborted(signal)
    await storage.setItem(LOCAL_MODEL_STATE_STORAGE_KEY, serialized, signal)
    cachedState = normalized
  }

  return { loadState, recordInstalledModel, markModelFailure, removeModel, clear }
}

function parsePersistedState(value: unknown): LocalModelStateSnapshot {
  if (!isPlainObject(value) || !isPlainObject(value.records) || !isPlainObject(value.failed)) {
    throw new Error('The persisted local-model state is invalid.')
  }
  const records: Record<string, LocalModelStateRecord> = {}
  for (const [modelId, candidate] of Object.entries(value.records).slice(0, LOCAL_MODEL_STATE_MAX_ENTRIES)) {
    const parsed = safeParseRecord(candidate)
    if (parsed && parsed.modelId === modelId) records[modelId] = parsed
  }
  const failed: Record<string, string> = {}
  for (const [modelId, message] of Object.entries(value.failed).slice(0, LOCAL_MODEL_STATE_MAX_ENTRIES)) {
    if (!v.safeParse(modelIdSchema, modelId).success || typeof message !== 'string') continue
    failed[modelId] = message.slice(0, LOCAL_MODEL_STATE_MAX_FAILURE_LENGTH)
  }
  return { records, failed }
}

function parseInputRecord(value: unknown): LocalModelStateRecord {
  const parsed = safeParseRecord(value)
  if (!parsed) throw new Error('The local-model state record is invalid.')
  return parsed
}

function safeParseRecord(value: unknown): LocalModelStateRecord | undefined {
  if (!isPlainObject(value)) return undefined
  const candidate = { ...value }
  if (isPlainObject(candidate.sha256)) {
    candidate.sha256 = Object.fromEntries(Object.entries(candidate.sha256).slice(0, MAX_HASH_ENTRIES))
  }
  const parsed = v.safeParse(stateRecordSchema, candidate)
  return parsed.success ? cloneRecord(parsed.output) : undefined
}

function emptyState(): LocalModelStateSnapshot {
  return { records: {}, failed: {} }
}

function cloneState(state: LocalModelStateSnapshot): LocalModelStateSnapshot {
  return {
    records: Object.fromEntries(
      Object.entries(state.records).map(([modelId, record]) => [modelId, cloneRecord(record)]),
    ),
    failed: { ...state.failed },
  }
}

function cloneRecord(record: LocalModelStateRecord): LocalModelStateRecord {
  return {
    ...record,
    ...(record.sha256 ? { sha256: { ...record.sha256 } } : {}),
  }
}

function makeRoom<T>(entries: Record<string, T>, key: string): void {
  if (Object.hasOwn(entries, key) || Object.keys(entries).length < LOCAL_MODEL_STATE_MAX_ENTRIES) return
  const oldestKey = Object.keys(entries)[0]
  if (oldestKey) delete entries[oldestKey]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  throw error
}
