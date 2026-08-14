import {
  applySqliteMigrations,
  type SqliteDatabase,
  type SqliteDatabaseProvider,
  type SqliteExecutor,
} from '@/platform/storage'

import {
  BUILT_IN_WORKSPACE_ABSENT_REVISION,
  type BuiltInWorkspaceFileEditResult,
  type BuiltInWorkspaceFileInfo,
  type BuiltInWorkspaceFilePort,
  type BuiltInWorkspaceFileReadResult,
} from '../builtInCapabilityContracts'
import {
  assertTextFileMimeType,
  BUILT_IN_FILE_EDIT_MAX_BYTES,
  BuiltInCapabilityPolicyError,
  normalizeRevision,
  normalizeWorkspaceRelativePath,
} from '../builtInCapabilityPolicy'

export const SQLITE_BUILT_IN_WORKSPACE_MAX_FILE_BYTES = BUILT_IN_FILE_EDIT_MAX_BYTES
export const SQLITE_BUILT_IN_WORKSPACE_MAX_FILE_COUNT = 128
export const SQLITE_BUILT_IN_WORKSPACE_MAX_TOTAL_BYTES = 16 * 1024 * 1024

const WORKSPACE_PATH_PREFIX = 'workspace/'
const WORKSPACE_SCOPE_LIMIT = 128
const IDEMPOTENCY_KEY_LIMIT = 512
const MAX_CONFIGURED_FILE_COUNT = 10_000
const SHA256_HEX = /^[a-f0-9]{64}$/
const SAFE_SCOPE_ID = /^[A-Za-z0-9._:-]+$/
const SAFE_IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]+$/
const FILE_TABLE = 'integrations_builtin_workspace_files'
const RECEIPT_TABLE = 'integrations_builtin_workspace_file_receipts'
const FILE_RECORD_SCHEMA = 'islemind.builtin-workspace-file.v1'
const RECEIPT_RECORD_SCHEMA = 'islemind.builtin-workspace-file-edit-receipt.v1'
const EDIT_REQUEST_SCHEMA = 'islemind.builtin-workspace-file-edit-request.v1'

export interface SqliteBuiltInWorkspaceFilePortOptions {
  readonly databaseProvider: SqliteDatabaseProvider
  readonly workspaceScopeId: string
  readonly digestText: (value: string) => Promise<string> | string
  readonly maxFileBytes?: number
  readonly maxFileCount?: number
  readonly maxTotalBytes?: number
}

interface WorkspaceLimits {
  maxFileBytes: number
  maxFileCount: number
  maxTotalBytes: number
}

interface PersistedFileRow {
  recordSchema: unknown
  workspaceScopeId: unknown
  relativePath: unknown
  revision: unknown
  byteLength: unknown
  mimeType: unknown
  textContent: unknown
}

interface PersistedReceiptRow {
  recordSchema: unknown
  workspaceScopeId: unknown
  idempotencyKey: unknown
  requestDigest: unknown
  relativePath: unknown
  previousRevision: unknown
  revision: unknown
  textDigest: unknown
  byteLength: unknown
  mimeType: unknown
}

interface WorkspaceFileRecord extends BuiltInWorkspaceFileReadResult {
  workspaceScopeId: string
  textDigest: string
}

interface WorkspaceEditReceipt {
  workspaceScopeId: string
  idempotencyKey: string
  requestDigest: string
  relativePath: string
  previousRevision: string
  revision: string
  textDigest: string
  byteLength: number
  mimeType: string
}

interface PreparedEdit {
  relativePath: string
  text: string
  mimeType: string
  expectedRevision: string
  idempotencyKey: string
  textDigest: string
  revision: string
  byteLength: number
  requestDigest: string
}

export class SqliteBuiltInWorkspaceFileDataError extends Error {
  constructor() {
    super('The persisted writable workspace record is invalid.')
    this.name = 'SqliteBuiltInWorkspaceFileDataError'
  }
}

/**
 * Stores the bounded writable `workspace/*` namespace in SQLite. File state
 * and its idempotency receipt are committed in one transaction so recovery
 * can never replay an edit whose durable outcome is unknown.
 */
export function createSqliteBuiltInWorkspaceFilePort(
  options: SqliteBuiltInWorkspaceFilePortOptions,
): BuiltInWorkspaceFilePort {
  const workspaceScopeId = normalizeWorkspaceScopeId(options.workspaceScopeId)
  const limits = normalizeLimits(options)
  let initialization: Promise<void> | undefined

  async function database(signal: AbortSignal): Promise<SqliteDatabase> {
    throwIfAborted(signal)
    const value = await options.databaseProvider.get()
    throwIfAborted(signal)
    initialization ??= ensureSchema(value).catch((error) => {
      initialization = undefined
      throw error
    })
    await initialization
    throwIfAborted(signal)
    return value
  }

  async function inspect(
    relativePath: string,
    operation: { signal: AbortSignal },
  ): Promise<BuiltInWorkspaceFileInfo | undefined> {
    throwIfAborted(operation.signal)
    const canonicalPath = canonicalWorkspacePath(relativePath)
    const value = await database(operation.signal)
    const row = await selectFile(value, workspaceScopeId, canonicalPath)
    throwIfAborted(operation.signal)
    if (!row) return undefined
    const record = await decodeFileRow(row, workspaceScopeId, limits, options.digestText, operation.signal)
    if (record.relativePath !== canonicalPath) throw new SqliteBuiltInWorkspaceFileDataError()
    return omitFileText(record)
  }

  async function readText(
    relativePath: string,
    operation: { signal: AbortSignal; maxBytes: number },
  ): Promise<BuiltInWorkspaceFileReadResult> {
    throwIfAborted(operation.signal)
    const canonicalPath = canonicalWorkspacePath(relativePath)
    assertPositiveSafeInteger(operation.maxBytes, 'The requested workspace byte limit is invalid.')
    const value = await database(operation.signal)
    const row = await selectFile(value, workspaceScopeId, canonicalPath)
    throwIfAborted(operation.signal)
    if (!row) {
      throw new BuiltInCapabilityPolicyError('execution_failed', 'The requested writable workspace file does not exist.')
    }
    const record = await decodeFileRow(row, workspaceScopeId, limits, options.digestText, operation.signal)
    if (record.relativePath !== canonicalPath) throw new SqliteBuiltInWorkspaceFileDataError()
    if (record.byteLength > operation.maxBytes) {
      throw new BuiltInCapabilityPolicyError(
        'size_limit_exceeded',
        'The writable workspace file exceeds the requested byte limit.',
      )
    }
    return omitWorkspaceScope(record)
  }

  async function editTextAtomic(
    input: {
      relativePath: string
      text: string
      mimeType: string
      expectedRevision: string
      idempotencyKey: string
    },
    operation: { signal: AbortSignal },
  ): Promise<BuiltInWorkspaceFileEditResult> {
    const prepared = await prepareEdit(input, workspaceScopeId, limits, options.digestText, operation.signal)
    const value = await database(operation.signal)

    // The transaction callback performs every cancellation check before the
    // first file mutation. Once that boundary is crossed it must finish the
    // receipt and report the committed outcome truthfully.
    return value.transaction(async (transaction) => {
      throwIfAborted(operation.signal)
      const receiptRow = await selectReceipt(
        transaction,
        workspaceScopeId,
        prepared.idempotencyKey,
      )
      throwIfAborted(operation.signal)
      if (receiptRow) {
        const receipt = await decodeReceiptRow(
          receiptRow,
          workspaceScopeId,
          limits,
          options.digestText,
          operation.signal,
        )
        return replayReceipt(receipt, prepared)
      }

      const rows = await transaction.getAll<PersistedFileRow>(
        `SELECT recordSchema, workspaceScopeId, relativePath, revision, byteLength, mimeType, textContent
           FROM ${FILE_TABLE}
          WHERE workspaceScopeId = ?
          ORDER BY relativePath ASC
          LIMIT ?`,
        [workspaceScopeId, limits.maxFileCount + 1],
      )
      throwIfAborted(operation.signal)
      const records = rows.map((row) => decodeFileRowStructure(row, workspaceScopeId, limits))
      const current = records.find((record) => record.relativePath === prepared.relativePath)
      if (current) {
        await verifyFileDigest(current, options.digestText, operation.signal)
      }
      const conflict = compareExpectedRevision(prepared, current)
      if (conflict) return conflict
      if (current && current.mimeType !== prepared.mimeType) {
        throw new BuiltInCapabilityPolicyError(
          'mime_unsupported',
          'A writable workspace edit cannot change the existing MIME type.',
        )
      }
      assertWorkspaceCapacity(records, current, prepared.byteLength, limits)
      throwIfAborted(operation.signal)

      const write = current
        ? await transaction.run(
            `UPDATE ${FILE_TABLE}
                SET recordSchema = ?, revision = ?, byteLength = ?, mimeType = ?, textContent = ?
              WHERE workspaceScopeId = ? AND relativePath = ? AND revision = ?`,
            [
              FILE_RECORD_SCHEMA,
              prepared.revision,
              prepared.byteLength,
              prepared.mimeType,
              prepared.text,
              workspaceScopeId,
              prepared.relativePath,
              prepared.expectedRevision,
            ],
          )
        : await transaction.run(
            `INSERT OR IGNORE INTO ${FILE_TABLE}
               (recordSchema, workspaceScopeId, relativePath, revision, byteLength, mimeType, textContent)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              FILE_RECORD_SCHEMA,
              workspaceScopeId,
              prepared.relativePath,
              prepared.revision,
              prepared.byteLength,
              prepared.mimeType,
              prepared.text,
            ],
          )

      if (write.changes !== 0 && write.changes !== 1) {
        throw new SqliteBuiltInWorkspaceFileDataError()
      }
      if (write.changes === 0) {
        const actualRow = await selectFile(transaction, workspaceScopeId, prepared.relativePath)
        const actual = actualRow
          ? await decodeFileRow(actualRow, workspaceScopeId, limits, options.digestText)
          : undefined
        return conflictResult(prepared, actual?.revision)
      }

      const receiptWrite = await transaction.run(
        `INSERT INTO ${RECEIPT_TABLE}
           (recordSchema, workspaceScopeId, idempotencyKey, requestDigest, relativePath, previousRevision,
            revision, textDigest, byteLength, mimeType)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          RECEIPT_RECORD_SCHEMA,
          workspaceScopeId,
          prepared.idempotencyKey,
          prepared.requestDigest,
          prepared.relativePath,
          prepared.expectedRevision,
          prepared.revision,
          prepared.textDigest,
          prepared.byteLength,
          prepared.mimeType,
        ],
      )
      if (receiptWrite.changes !== 1) throw new SqliteBuiltInWorkspaceFileDataError()
      return successfulEditResult('applied', prepared)
    })
  }

  return {
    workspaceScopeId,
    inspect,
    readText,
    editTextAtomic,
  }
}

async function ensureSchema(database: SqliteDatabase): Promise<void> {
  await applySqliteMigrations(database, [{
    scope: 'integrations.builtin-workspace-files',
    version: 1,
    name: 'create durable writable workspace files and receipts',
    async up(transaction) {
      await transaction.exec(`
        CREATE TABLE IF NOT EXISTS ${FILE_TABLE} (
          recordSchema TEXT NOT NULL,
          workspaceScopeId TEXT NOT NULL,
          relativePath TEXT NOT NULL,
          revision TEXT NOT NULL,
          byteLength INTEGER NOT NULL CHECK (byteLength >= 0),
          mimeType TEXT NOT NULL,
          textContent TEXT NOT NULL,
          PRIMARY KEY (workspaceScopeId, relativePath)
        );
        CREATE TABLE IF NOT EXISTS ${RECEIPT_TABLE} (
          recordSchema TEXT NOT NULL,
          workspaceScopeId TEXT NOT NULL,
          idempotencyKey TEXT NOT NULL,
          requestDigest TEXT NOT NULL,
          relativePath TEXT NOT NULL,
          previousRevision TEXT NOT NULL,
          revision TEXT NOT NULL,
          textDigest TEXT NOT NULL,
          byteLength INTEGER NOT NULL CHECK (byteLength >= 0),
          mimeType TEXT NOT NULL,
          PRIMARY KEY (workspaceScopeId, idempotencyKey)
        );
        CREATE INDEX IF NOT EXISTS integrations_builtin_workspace_receipt_path_idx
          ON ${RECEIPT_TABLE} (workspaceScopeId, relativePath);
      `)
    },
  }])
}

async function prepareEdit(
  input: {
    relativePath: string
    text: string
    mimeType: string
    expectedRevision: string
    idempotencyKey: string
  },
  workspaceScopeId: string,
  limits: WorkspaceLimits,
  digestText: (value: string) => Promise<string> | string,
  signal: AbortSignal,
): Promise<PreparedEdit> {
  throwIfAborted(signal)
  const relativePath = canonicalWorkspacePath(input.relativePath)
  if (typeof input.text !== 'string' || !isWellFormedUnicode(input.text)) {
    throw new BuiltInCapabilityPolicyError('schema_invalid', 'Workspace file text must be well-formed UTF-8 text.')
  }
  const byteLength = utf8ByteLength(input.text)
  if (byteLength > limits.maxFileBytes) {
    throw new BuiltInCapabilityPolicyError('size_limit_exceeded', 'The writable workspace file exceeds its byte limit.')
  }
  const mimeType = assertTextFileMimeType(input.mimeType)
  const expectedRevision = normalizeRevision(input.expectedRevision)
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey)
  const textDigest = await sha256Digest(input.text, digestText)
  throwIfAborted(signal)
  const revision = `sha256:${textDigest}`
  const requestDigest = await editRequestDigest({
    workspaceScopeId,
    relativePath,
    expectedRevision,
    textDigest,
    byteLength,
    mimeType,
  }, digestText)
  throwIfAborted(signal)
  return {
    relativePath,
    text: input.text,
    mimeType,
    expectedRevision,
    idempotencyKey,
    textDigest,
    revision,
    byteLength,
    requestDigest,
  }
}

async function selectFile(
  database: SqliteExecutor,
  workspaceScopeId: string,
  relativePath: string,
): Promise<PersistedFileRow | null> {
  return database.getFirst<PersistedFileRow>(
    `SELECT recordSchema, workspaceScopeId, relativePath, revision, byteLength, mimeType, textContent
       FROM ${FILE_TABLE}
      WHERE workspaceScopeId = ? AND relativePath = ?`,
    [workspaceScopeId, relativePath],
  )
}

async function selectReceipt(
  database: SqliteExecutor,
  workspaceScopeId: string,
  idempotencyKey: string,
): Promise<PersistedReceiptRow | null> {
  return database.getFirst<PersistedReceiptRow>(
    `SELECT recordSchema, workspaceScopeId, idempotencyKey, requestDigest, relativePath, previousRevision,
            revision, textDigest, byteLength, mimeType
       FROM ${RECEIPT_TABLE}
      WHERE workspaceScopeId = ? AND idempotencyKey = ?`,
    [workspaceScopeId, idempotencyKey],
  )
}

function decodeFileRowStructure(
  row: PersistedFileRow,
  workspaceScopeId: string,
  limits: WorkspaceLimits,
): WorkspaceFileRecord {
  if (
    row.recordSchema !== FILE_RECORD_SCHEMA ||
    row.workspaceScopeId !== workspaceScopeId ||
    typeof row.relativePath !== 'string' ||
    typeof row.revision !== 'string' ||
    typeof row.byteLength !== 'number' ||
    typeof row.mimeType !== 'string' ||
    typeof row.textContent !== 'string'
  ) throw new SqliteBuiltInWorkspaceFileDataError()

  let relativePath: string
  let mimeType: string
  try {
    relativePath = canonicalWorkspacePath(row.relativePath)
    mimeType = assertTextFileMimeType(row.mimeType)
  } catch {
    throw new SqliteBuiltInWorkspaceFileDataError()
  }
  if (
    relativePath !== row.relativePath ||
    mimeType !== row.mimeType ||
    !isDigestRevision(row.revision) ||
    !Number.isSafeInteger(row.byteLength) ||
    row.byteLength < 0 ||
    row.byteLength > limits.maxFileBytes ||
    !isWellFormedUnicode(row.textContent)
  ) throw new SqliteBuiltInWorkspaceFileDataError()

  const measuredBytes = utf8ByteLength(row.textContent)
  if (measuredBytes !== row.byteLength) throw new SqliteBuiltInWorkspaceFileDataError()
  return {
    workspaceScopeId,
    relativePath,
    revision: row.revision,
    textDigest: row.revision.slice('sha256:'.length),
    byteLength: row.byteLength,
    mimeType,
    text: row.textContent,
  }
}

async function decodeFileRow(
  row: PersistedFileRow,
  workspaceScopeId: string,
  limits: WorkspaceLimits,
  digestText: (value: string) => Promise<string> | string,
  signal?: AbortSignal,
): Promise<WorkspaceFileRecord> {
  const record = decodeFileRowStructure(row, workspaceScopeId, limits)
  await verifyFileDigest(record, digestText, signal)
  return record
}

async function verifyFileDigest(
  record: WorkspaceFileRecord,
  digestText: (value: string) => Promise<string> | string,
  signal?: AbortSignal,
): Promise<void> {
  const digest = await sha256Digest(record.text, digestText)
  if (signal) throwIfAborted(signal)
  if (digest !== record.textDigest) throw new SqliteBuiltInWorkspaceFileDataError()
}

async function decodeReceiptRow(
  row: PersistedReceiptRow,
  workspaceScopeId: string,
  limits: WorkspaceLimits,
  digestText: (value: string) => Promise<string> | string,
  signal: AbortSignal,
): Promise<WorkspaceEditReceipt> {
  if (
    row.recordSchema !== RECEIPT_RECORD_SCHEMA ||
    row.workspaceScopeId !== workspaceScopeId ||
    typeof row.idempotencyKey !== 'string' ||
    typeof row.requestDigest !== 'string' ||
    typeof row.relativePath !== 'string' ||
    typeof row.previousRevision !== 'string' ||
    typeof row.revision !== 'string' ||
    typeof row.textDigest !== 'string' ||
    typeof row.byteLength !== 'number' ||
    typeof row.mimeType !== 'string'
  ) throw new SqliteBuiltInWorkspaceFileDataError()

  let idempotencyKey: string
  let relativePath: string
  let previousRevision: string
  let mimeType: string
  try {
    idempotencyKey = normalizeIdempotencyKey(row.idempotencyKey)
    relativePath = canonicalWorkspacePath(row.relativePath)
    previousRevision = normalizeRevision(row.previousRevision)
    mimeType = assertTextFileMimeType(row.mimeType)
  } catch {
    throw new SqliteBuiltInWorkspaceFileDataError()
  }
  if (
    relativePath !== row.relativePath ||
    mimeType !== row.mimeType ||
    !SHA256_HEX.test(row.requestDigest) ||
    !SHA256_HEX.test(row.textDigest) ||
    row.revision !== `sha256:${row.textDigest}` ||
    !Number.isSafeInteger(row.byteLength) ||
    row.byteLength < 0 ||
    row.byteLength > limits.maxFileBytes
  ) throw new SqliteBuiltInWorkspaceFileDataError()

  const expectedRequestDigest = await editRequestDigest({
    workspaceScopeId,
    relativePath,
    expectedRevision: previousRevision,
    textDigest: row.textDigest,
    byteLength: row.byteLength,
    mimeType,
  }, digestText)
  throwIfAborted(signal)
  if (expectedRequestDigest !== row.requestDigest) throw new SqliteBuiltInWorkspaceFileDataError()
  return {
    workspaceScopeId,
    idempotencyKey,
    requestDigest: row.requestDigest,
    relativePath,
    previousRevision,
    revision: row.revision,
    textDigest: row.textDigest,
    byteLength: row.byteLength,
    mimeType,
  }
}

function replayReceipt(
  receipt: WorkspaceEditReceipt,
  prepared: PreparedEdit,
): BuiltInWorkspaceFileEditResult {
  if (
    receipt.idempotencyKey !== prepared.idempotencyKey ||
    receipt.requestDigest !== prepared.requestDigest ||
    receipt.relativePath !== prepared.relativePath ||
    receipt.previousRevision !== prepared.expectedRevision ||
    receipt.revision !== prepared.revision ||
    receipt.textDigest !== prepared.textDigest ||
    receipt.byteLength !== prepared.byteLength ||
    receipt.mimeType !== prepared.mimeType
  ) {
    return {
      status: 'idempotency_conflict',
      relativePath: prepared.relativePath,
      reason: 'The durable idempotency key belongs to a different workspace edit.',
    }
  }
  return successfulEditResult('replayed', prepared)
}

function compareExpectedRevision(
  prepared: PreparedEdit,
  current: WorkspaceFileRecord | undefined,
): Extract<BuiltInWorkspaceFileEditResult, { status: 'conflict' }> | undefined {
  if (!current && prepared.expectedRevision !== BUILT_IN_WORKSPACE_ABSENT_REVISION) {
    return conflictResult(prepared)
  }
  if (current && prepared.expectedRevision !== current.revision) {
    return conflictResult(prepared, current.revision)
  }
  return undefined
}

function conflictResult(
  prepared: PreparedEdit,
  actualRevision?: string,
): Extract<BuiltInWorkspaceFileEditResult, { status: 'conflict' }> {
  return {
    status: 'conflict',
    relativePath: prepared.relativePath,
    expectedRevision: prepared.expectedRevision,
    ...(actualRevision ? { actualRevision } : {}),
  }
}

function successfulEditResult(
  status: 'applied' | 'replayed',
  prepared: PreparedEdit,
): Extract<BuiltInWorkspaceFileEditResult, { status: 'applied' | 'replayed' }> {
  return {
    status,
    relativePath: prepared.relativePath,
    previousRevision: prepared.expectedRevision,
    revision: prepared.revision,
    byteLength: prepared.byteLength,
    mimeType: prepared.mimeType,
  }
}

function assertWorkspaceCapacity(
  records: readonly WorkspaceFileRecord[],
  current: WorkspaceFileRecord | undefined,
  nextByteLength: number,
  limits: WorkspaceLimits,
): void {
  if (records.length > limits.maxFileCount) throw new SqliteBuiltInWorkspaceFileDataError()
  if (!current && records.length >= limits.maxFileCount) {
    throw new BuiltInCapabilityPolicyError('size_limit_exceeded', 'The writable workspace file-count limit was reached.')
  }
  let totalBytes = 0
  const paths = new Set<string>()
  for (const record of records) {
    if (paths.has(record.relativePath)) throw new SqliteBuiltInWorkspaceFileDataError()
    paths.add(record.relativePath)
    totalBytes += record.byteLength
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) {
      throw new SqliteBuiltInWorkspaceFileDataError()
    }
  }
  const nextTotalBytes = totalBytes - (current?.byteLength ?? 0) + nextByteLength
  if (!Number.isSafeInteger(nextTotalBytes) || nextTotalBytes > limits.maxTotalBytes) {
    throw new BuiltInCapabilityPolicyError('size_limit_exceeded', 'The writable workspace total-byte limit was reached.')
  }
}

async function editRequestDigest(
  input: {
    workspaceScopeId: string
    relativePath: string
    expectedRevision: string
    textDigest: string
    byteLength: number
    mimeType: string
  },
  digestText: (value: string) => Promise<string> | string,
): Promise<string> {
  return sha256Digest(JSON.stringify({
    schema: EDIT_REQUEST_SCHEMA,
    workspaceScopeId: input.workspaceScopeId,
    relativePath: input.relativePath,
    expectedRevision: input.expectedRevision,
    textDigest: input.textDigest,
    byteLength: input.byteLength,
    mimeType: input.mimeType,
  }), digestText)
}

async function sha256Digest(
  value: string,
  digestText: (value: string) => Promise<string> | string,
): Promise<string> {
  const digest = await digestText(value)
  if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/i.test(digest)) {
    throw new SqliteBuiltInWorkspaceFileDataError()
  }
  return digest.toLowerCase()
}

function canonicalWorkspacePath(input: string): string {
  const normalized = normalizeWorkspaceRelativePath(input)
  if (normalized !== input || !normalized.startsWith(WORKSPACE_PATH_PREFIX) || normalized.length === WORKSPACE_PATH_PREFIX.length) {
    throw new BuiltInCapabilityPolicyError(
      'path_outside_workspace',
      'The file path is outside the canonical writable workspace namespace.',
    )
  }
  return normalized
}

function normalizeWorkspaceScopeId(input: string): string {
  if (
    typeof input !== 'string' ||
    input.trim() !== input ||
    input.length < 1 ||
    input.length > WORKSPACE_SCOPE_LIMIT ||
    !SAFE_SCOPE_ID.test(input)
  ) {
    throw new BuiltInCapabilityPolicyError('schema_invalid', 'A bounded writable workspace scope is required.')
  }
  return input
}

function normalizeIdempotencyKey(input: string): string {
  if (
    typeof input !== 'string' ||
    input.trim() !== input ||
    input.length < 1 ||
    input.length > IDEMPOTENCY_KEY_LIMIT ||
    !SAFE_IDEMPOTENCY_KEY.test(input)
  ) {
    throw new BuiltInCapabilityPolicyError('idempotency_required', 'A valid durable idempotency key is required.', true)
  }
  return input
}

function normalizeLimits(options: SqliteBuiltInWorkspaceFilePortOptions): WorkspaceLimits {
  const maxFileBytes = options.maxFileBytes ?? SQLITE_BUILT_IN_WORKSPACE_MAX_FILE_BYTES
  const maxFileCount = options.maxFileCount ?? SQLITE_BUILT_IN_WORKSPACE_MAX_FILE_COUNT
  const maxTotalBytes = options.maxTotalBytes ?? SQLITE_BUILT_IN_WORKSPACE_MAX_TOTAL_BYTES
  if (
    !Number.isSafeInteger(maxFileBytes) ||
    maxFileBytes < 1 ||
    maxFileBytes > SQLITE_BUILT_IN_WORKSPACE_MAX_FILE_BYTES ||
    !Number.isSafeInteger(maxFileCount) ||
    maxFileCount < 1 ||
    maxFileCount > MAX_CONFIGURED_FILE_COUNT ||
    !Number.isSafeInteger(maxTotalBytes) ||
    maxTotalBytes < 1
  ) {
    throw new BuiltInCapabilityPolicyError('schema_invalid', 'Writable workspace limits are invalid.')
  }
  return { maxFileBytes, maxFileCount, maxTotalBytes }
}

function omitFileText(record: WorkspaceFileRecord): BuiltInWorkspaceFileInfo {
  return {
    relativePath: record.relativePath,
    revision: record.revision,
    byteLength: record.byteLength,
    mimeType: record.mimeType,
  }
}

function omitWorkspaceScope(record: WorkspaceFileRecord): BuiltInWorkspaceFileReadResult {
  return {
    ...omitFileText(record),
    text: record.text,
  }
}

function isDigestRevision(value: string): boolean {
  return value.startsWith('sha256:') && SHA256_HEX.test(value.slice('sha256:'.length))
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return false
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false
    }
  }
  return true
}

function assertPositiveSafeInteger(value: number, message: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new BuiltInCapabilityPolicyError('size_limit_exceeded', message)
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  if (signal.reason !== undefined) throw signal.reason
  const error = new Error('Writable workspace file operation was cancelled.')
  error.name = 'AbortError'
  throw error
}
