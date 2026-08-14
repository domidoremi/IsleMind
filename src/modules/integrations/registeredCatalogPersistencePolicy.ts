type UnknownRecord = Record<string, unknown>

export interface RegisteredCatalogPersistenceSchemas {
  persistence: string
  registrationRecord: string
  registeredCatalog: string
  runtimeProtocol: string
}

export interface RegisteredCatalogPersistenceEnvelope<
  TRecord,
  TSchemas extends RegisteredCatalogPersistenceSchemas,
> {
  schema: TSchemas['persistence']
  registrationRecordSchema: TSchemas['registrationRecord']
  registeredCatalogSchema: TSchemas['registeredCatalog']
  protocolSchema: TSchemas['runtimeProtocol']
  exportedAt: number
  source?: string
  projectId?: string
  recordLimit: number
  recordCount: number
  counts: { total: number; appAction: number; runtimeTool: number }
  records: TRecord[]
}

export interface RegisteredCatalogPersistenceImport<
  TRecord,
  TSchemas extends RegisteredCatalogPersistenceSchemas,
> {
  ok: boolean
  envelope?: RegisteredCatalogPersistenceEnvelope<TRecord, TSchemas>
  records: TRecord[]
  acceptedCount: number
  rejectedCount: number
  errorCode?: 'schema_mismatch' | 'operation_mismatch'
  message?: string
}

export interface RegisteredCatalogPersistencePolicyDependencies<
  TRecord,
  TSchemas extends RegisteredCatalogPersistenceSchemas,
> {
  schemas: TSchemas
  recordLimit: number
  sanitizeRecordLimit(input: unknown): number
  normalizeRecords(input: readonly unknown[], recordLimit: number): { records: TRecord[]; rejectedCount: number }
  createCounts(records: readonly TRecord[]): { total: number; appAction: number; runtimeTool: number }
  sanitizeMetadata(input: unknown): string | undefined
  sanitizeTimestamp(input: unknown): number | undefined
}

export function createRegisteredCatalogPersistencePolicy<
  TRecord,
  const TSchemas extends RegisteredCatalogPersistenceSchemas,
>(dependencies: RegisteredCatalogPersistencePolicyDependencies<TRecord, TSchemas>) {
  type Envelope = RegisteredCatalogPersistenceEnvelope<TRecord, TSchemas>
  type ImportResult = RegisteredCatalogPersistenceImport<TRecord, TSchemas>

  function createEnvelope(input: {
    records?: readonly unknown[]
    source?: string
    projectId?: string
    now?: number
    recordLimit?: number
  } = {}): Envelope {
    const inputRecord = asRecord(input)
    if (!inputRecord || !hasOnlyAllowedKeys(inputRecord, CREATE_INPUT_KEYS)) {
      return createEnvelopeFromRecords({
        records: [],
        now: dependencies.sanitizeTimestamp(inputRecord?.now),
      })
    }
    return createEnvelopeFromRecords(input)
  }

  function createEnvelopeFromRecords(input: {
    records?: readonly unknown[]
    source?: string
    projectId?: string
    now?: number
    recordLimit?: number
  }): Envelope {
    const recordLimit = dependencies.sanitizeRecordLimit(input.recordLimit)
    const { records } = dependencies.normalizeRecords(input.records ?? [], recordLimit)
    const counts = dependencies.createCounts(records)
    return {
      schema: dependencies.schemas.persistence,
      registrationRecordSchema: dependencies.schemas.registrationRecord,
      registeredCatalogSchema: dependencies.schemas.registeredCatalog,
      protocolSchema: dependencies.schemas.runtimeProtocol,
      exportedAt: dependencies.sanitizeTimestamp(input.now) ?? Date.now(),
      source: dependencies.sanitizeMetadata(input.source),
      projectId: dependencies.sanitizeMetadata(input.projectId),
      recordLimit,
      recordCount: records.length,
      counts,
      records,
    }
  }

  function importEnvelope(input: unknown): ImportResult {
    const record = asRecord(input)
    if (
      !record ||
      record.schema !== dependencies.schemas.persistence ||
      record.registrationRecordSchema !== dependencies.schemas.registrationRecord ||
      record.registeredCatalogSchema !== dependencies.schemas.registeredCatalog ||
      record.protocolSchema !== dependencies.schemas.runtimeProtocol
    ) {
      return {
        ok: false,
        records: [],
        acceptedCount: 0,
        rejectedCount: 0,
        errorCode: 'schema_mismatch',
        message: 'Registered catalog persistence envelope schema is incompatible.',
      }
    }
    if (
      !hasOnlyAllowedKeys(record, ENVELOPE_KEYS) ||
      (record.counts !== undefined && !hasOnlyAllowedKeys(record.counts, COUNT_KEYS))
    ) {
      return {
        ok: false,
        records: [],
        acceptedCount: 0,
        rejectedCount: 0,
        errorCode: 'operation_mismatch',
        message: 'Registered catalog persistence envelope contains unsupported metadata.',
      }
    }
    const recordLimit = dependencies.sanitizeRecordLimit(record.recordLimit)
    const sourceRecords = Array.isArray(record.records)
      ? record.records.slice(0, dependencies.recordLimit + 1)
      : []
    const normalized = dependencies.normalizeRecords(sourceRecords, recordLimit)
    const exportedAt = typeof record.exportedAt === 'number' && Number.isFinite(record.exportedAt)
      ? record.exportedAt
      : Date.now()
    const envelope = createEnvelope({
      records: normalized.records,
      source: dependencies.sanitizeMetadata(record.source),
      projectId: dependencies.sanitizeMetadata(record.projectId),
      now: exportedAt,
      recordLimit,
    })
    return {
      ok: true,
      envelope,
      records: envelope.records,
      acceptedCount: envelope.records.length,
      rejectedCount: normalized.rejectedCount,
    }
  }

  return { createEnvelope, importEnvelope }
}

function asRecord(input: unknown): UnknownRecord | undefined {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as UnknownRecord
    : undefined
}

function hasOnlyAllowedKeys(input: unknown, allowedKeys: readonly string[]): boolean {
  const record = asRecord(input)
  if (!record) return false
  const allowed = new Set(allowedKeys)
  return Object.keys(record).every((key) => allowed.has(key))
}

const CREATE_INPUT_KEYS = ['records', 'source', 'projectId', 'now', 'recordLimit'] as const
const ENVELOPE_KEYS = ['schema', 'registrationRecordSchema', 'registeredCatalogSchema', 'protocolSchema', 'exportedAt', 'source', 'projectId', 'recordLimit', 'recordCount', 'counts', 'records'] as const
const COUNT_KEYS = ['total', 'appAction', 'runtimeTool'] as const
