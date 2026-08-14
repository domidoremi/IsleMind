import { cleanPublicText } from './runtimeTaskTextPolicy'
import { isUnsafeRuntimePairingText } from './textSafety'

export interface RegisteredCatalogManifest<
  TToolKind extends string = string,
  TPermission extends string = string,
  TTransport extends string = string,
> {
  id: string
  title: string
  version: string
  kind: TToolKind
  permissions: TPermission[]
  entry: { type: string; transport?: TTransport }
}

export interface RegisteredCatalogActionRequest {
  actionId: string
  projectId?: string
  runtimeIds: string[]
}

export interface RegisteredCatalogRuntime<
  TProtocolSchema extends string = string,
  TRuntimeKind extends string = string,
  TTransport extends string = string,
> {
  id: string
  kind: TRuntimeKind
  protocolSchema: TProtocolSchema
  online: boolean
  transports: TTransport[]
}

export interface RegisteredCatalogRecord<
  TRegistrationSchema extends string = string,
  TManifestSchema extends string = string,
  TActionSchema extends string = string,
  TProtocolSchema extends string = string,
  TToolKind extends string = string,
  TRegistrationKind extends string = string,
  TRuntimeKind extends string = string,
  TDisposition extends string = string,
  TPermission extends string = string,
  TCapability extends string = string,
  TTransport extends string = string,
> {
  schema: TRegistrationSchema
  manifestSchema: TManifestSchema
  controlPlaneActionSchema: TActionSchema
  protocolSchema: TProtocolSchema
  registrationId: string
  actionId: string
  registeredAt: number
  projectId?: string
  toolId: string
  title: string
  version: string
  kind: TToolKind
  registrationKind: TRegistrationKind
  runtimeId?: string
  runtimeKind?: TRuntimeKind
  androidDisposition: TDisposition
  permissions: TPermission[]
  requiredCapabilities: TCapability[]
  transports: TTransport[]
}

export interface RegisteredCatalogPolicyDependencies<
  TRegistrationSchema extends string,
  TManifestSchema extends string,
  TActionSchema extends string,
  TProtocolSchema extends string,
  TCatalogSchema extends string,
  TToolKind extends string,
  TRegistrationKind extends string,
  TRuntimeKind extends string,
  TDisposition extends string,
  TPermission extends string,
  TCapability extends string,
  TTransport extends string,
  TRuntime extends RegisteredCatalogRuntime<TProtocolSchema, TRuntimeKind, TTransport>,
  TStatus extends string,
> {
  schemas: {
    registration: TRegistrationSchema
    manifest: TManifestSchema
    action: TActionSchema
    protocol: TProtocolSchema
    catalog: TCatalogSchema
  }
  recordLimit: number
  entryLimit: number
  toolKinds: readonly TToolKind[]
  registrationKinds: readonly TRegistrationKind[]
  runtimeKinds: readonly TRuntimeKind[]
  dispositions: readonly TDisposition[]
  permissions: readonly TPermission[]
  capabilities: readonly TCapability[]
  transports: readonly TTransport[]
  statuses: {
    ready: TStatus
    invalid: TStatus
    runtimeMissing: TStatus
    runtimeOffline: TStatus
    protocolMismatch: TStatus
  }
  appActionRegistrationKind: TRegistrationKind
  runtimeToolRegistrationKind: TRegistrationKind
  appActionEntryType: string
  appOnlyDisposition: TDisposition
  androidAppRuntimeId: string
  androidAppRuntimeKind: TRuntimeKind
  createRegistrationId(toolId: string, runtimeId: string | undefined, now: number): string
  stableIdentityString(input: unknown): string
  sanitizeMetadataToken(input: unknown): string | undefined
  sanitizeExactStableIdToken(input: unknown): string | undefined
  inferRequiredCapabilities(manifest: RegisteredCatalogManifest<TToolKind, TPermission, TTransport>): TCapability[]
  sanitizeControlPlanePublicText(input: unknown): string | undefined
  sanitizePermissionList(input: unknown): TPermission[]
  sanitizeCapabilityList(input: unknown): TCapability[]
  sanitizeTimestamp(input: unknown): number | undefined
  createDefaultRuntimes(now: number): TRuntime[]
  createTrustedRuntimes(runtimes: readonly TRuntime[]): TRuntime[]
  createEmptyCounts(): Record<TStatus, number> & {
    total: number
    appAction: number
    runtimeTool: number
  }
}

export function createRegisteredCatalogPolicy<
  const TRegistrationSchema extends string,
  const TManifestSchema extends string,
  const TActionSchema extends string,
  const TProtocolSchema extends string,
  const TCatalogSchema extends string,
  TToolKind extends string,
  TRegistrationKind extends string,
  TRuntimeKind extends string,
  TDisposition extends string,
  TPermission extends string,
  TCapability extends string,
  TTransport extends string,
  TRuntime extends RegisteredCatalogRuntime<TProtocolSchema, TRuntimeKind, TTransport>,
  TStatus extends string,
>(dependencies: RegisteredCatalogPolicyDependencies<
  TRegistrationSchema,
  TManifestSchema,
  TActionSchema,
  TProtocolSchema,
  TCatalogSchema,
  TToolKind,
  TRegistrationKind,
  TRuntimeKind,
  TDisposition,
  TPermission,
  TCapability,
  TTransport,
  TRuntime,
  TStatus
>) {
  type Manifest = RegisteredCatalogManifest<TToolKind, TPermission, TTransport>
  type Runtime = TRuntime
  type StatusCounts = { [TKey in TStatus]: number }
  type Record = RegisteredCatalogRecord<
    TRegistrationSchema, TManifestSchema, TActionSchema, TProtocolSchema,
    TToolKind, TRegistrationKind, TRuntimeKind, TDisposition,
    TPermission, TCapability, TTransport
  >

  const versionPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

  function createRegistrationRecord(input: {
    manifest: Manifest
    actionRequest: RegisteredCatalogActionRequest
    registrationKind: TRegistrationKind
    runtime?: Runtime
    androidDisposition: TDisposition
    now: number
  }): Record {
    return {
      schema: dependencies.schemas.registration,
      manifestSchema: dependencies.schemas.manifest,
      controlPlaneActionSchema: dependencies.schemas.action,
      protocolSchema: dependencies.schemas.protocol,
      registrationId: dependencies.createRegistrationId(input.manifest.id, input.runtime?.id, input.now),
      actionId: input.actionRequest.actionId,
      registeredAt: input.now,
      projectId: dependencies.sanitizeMetadataToken(input.actionRequest.projectId),
      toolId: input.manifest.id,
      title: input.manifest.title,
      version: input.manifest.version,
      kind: input.manifest.kind,
      registrationKind: input.registrationKind,
      runtimeId: input.runtime?.id ?? input.actionRequest.runtimeIds[0],
      runtimeKind: input.runtime?.kind,
      androidDisposition: input.androidDisposition,
      permissions: uniqueTypedList(input.manifest.permissions, dependencies.permissions),
      requiredCapabilities: dependencies.inferRequiredCapabilities(input.manifest),
      transports: uniqueTypedList([
        ...(input.runtime?.transports ?? []),
        ...(input.manifest.entry.transport ? [input.manifest.entry.transport] : []),
      ], dependencies.transports),
    }
  }

  function sanitizeRegistrationRecord(input: unknown): Record | undefined {
    const record = asRecord(input)
    if (!record ||
      record.schema !== dependencies.schemas.registration ||
      record.manifestSchema !== dependencies.schemas.manifest ||
      record.controlPlaneActionSchema !== dependencies.schemas.action ||
      record.protocolSchema !== dependencies.schemas.protocol) return undefined
    const registrationId = dependencies.sanitizeExactStableIdToken(record.registrationId)
    const actionId = dependencies.sanitizeExactStableIdToken(record.actionId)
    const toolId = dependencies.sanitizeExactStableIdToken(record.toolId)
    const title = cleanPublicText(record.title) || toolId
    const version = sanitizeRegistrationRecordVersion(record.version)
    const kind = includes(dependencies.toolKinds, record.kind)
    const registrationKind = includes(dependencies.registrationKinds, record.registrationKind)
    const androidDisposition = includes(dependencies.dispositions, record.androidDisposition)
    const runtimeId = record.runtimeId === undefined ? undefined : dependencies.sanitizeExactStableIdToken(record.runtimeId)
    const runtimeKind = includes(dependencies.runtimeKinds, record.runtimeKind)
    const registeredAt = typeof record.registeredAt === 'number' && Number.isFinite(record.registeredAt)
      ? record.registeredAt
      : undefined
    if (!registrationId || !actionId || !toolId || !title || !version || !kind ||
      !registrationKind || !androidDisposition || registeredAt === undefined) return undefined
    if (record.runtimeId !== undefined && !runtimeId) return undefined
    return {
      schema: dependencies.schemas.registration,
      manifestSchema: dependencies.schemas.manifest,
      controlPlaneActionSchema: dependencies.schemas.action,
      protocolSchema: dependencies.schemas.protocol,
      registrationId,
      actionId,
      registeredAt,
      projectId: dependencies.sanitizeMetadataToken(record.projectId),
      toolId,
      title,
      version,
      kind,
      registrationKind,
      runtimeId: runtimeId || undefined,
      runtimeKind,
      androidDisposition,
      permissions: uniqueTypedList(dependencies.sanitizePermissionList(record.permissions), dependencies.permissions),
      requiredCapabilities: uniqueTypedList(dependencies.sanitizeCapabilityList(record.requiredCapabilities), dependencies.capabilities),
      transports: uniqueTypedList(sanitizeList(record.transports).filter((value): value is TTransport => Boolean(includes(dependencies.transports, value))), dependencies.transports),
    }
  }

  function sanitizeRegistrationRecordVersion(input: unknown): string | undefined {
    if (typeof input !== 'string' || input.trim() !== input) return undefined
    if (!versionPattern.test(input) || isUnsafeRuntimePairingText(input)) return undefined
    return input
  }

  function isTrustedRegistrationRecord(input: unknown): input is Record {
    const raw = asRecord(input)
    if (!raw || !hasTrustedRegistrationRecordFields(raw)) return false
    const trustedRecord = raw as unknown as Record
    const sanitized = sanitizeRegistrationRecord(input)
    if (!sanitized || dependencies.stableIdentityString(sanitized) !== dependencies.stableIdentityString(trustedRecord)) return false
    if (isUnsafeRuntimePairingText(trustedRecord.title) || !versionPattern.test(trustedRecord.version)) return false
    if (trustedRecord.registrationId !== dependencies.createRegistrationId(trustedRecord.toolId, trustedRecord.runtimeId, trustedRecord.registeredAt)) return false
    if (trustedRecord.registrationKind === dependencies.appActionRegistrationKind) {
      return trustedRecord.actionId.startsWith('control-register-app-action-') &&
        trustedRecord.androidDisposition === dependencies.appOnlyDisposition &&
        (trustedRecord.runtimeId === undefined || trustedRecord.runtimeId === dependencies.androidAppRuntimeId) &&
        (trustedRecord.runtimeKind === undefined || trustedRecord.runtimeKind === dependencies.androidAppRuntimeKind)
    }
    return trustedRecord.actionId.startsWith('control-register-runtime-tool-') &&
      Boolean(trustedRecord.runtimeId) &&
      trustedRecord.runtimeId !== dependencies.androidAppRuntimeId &&
      trustedRecord.runtimeKind !== undefined &&
      trustedRecord.runtimeKind !== dependencies.androidAppRuntimeKind &&
      trustedRecord.androidDisposition !== dependencies.appOnlyDisposition
  }

  function createRegistrationFailure<TErrorCode extends string>(errorCode: TErrorCode, message: string, blockedReasons: string[]) {
    return { ok: false as const, errorCode, message, blockedReasons: uniqueCleanList(blockedReasons) }
  }

  function sanitizeRegisteredCatalogRecordLimit(input: unknown): number {
    if (typeof input !== 'number' || !Number.isFinite(input)) return dependencies.recordLimit
    return Math.max(1, Math.min(dependencies.recordLimit, Math.floor(input)))
  }

  function createRegisteredCatalogPersistenceCounts(records: readonly Record[]) {
    let appAction = 0
    let runtimeTool = 0
    for (const record of records) {
      if (record.registrationKind === dependencies.appActionRegistrationKind) appAction += 1
      else runtimeTool += 1
    }
    return { total: records.length, appAction, runtimeTool }
  }

  function registeredCatalogKey(record: Record): string {
    return [record.toolId, record.registrationKind, record.runtimeId ?? 'app'].join('|')
  }

  function normalizeRegisteredCatalogPersistenceRecords(input: readonly unknown[], recordLimit: number) {
    const latest = new Map<string, Record>()
    let rejectedCount = 0
    for (const item of input) {
      if (!isTrustedRegistrationRecord(item)) { rejectedCount += 1; continue }
      const key = registeredCatalogKey(item)
      const current = latest.get(key)
      if (!current || item.registeredAt >= current.registeredAt) latest.set(key, item)
    }
    const records = Array.from(latest.values())
      .sort((left, right) => right.registeredAt - left.registeredAt || left.toolId.localeCompare(right.toolId))
    const bounded = records.slice(0, recordLimit)
    return { records: bounded, rejectedCount: rejectedCount + Math.max(0, records.length - bounded.length) }
  }

  function registeredCatalogStatus(record: Record, runtime: Runtime | undefined): { status: TStatus; blockedReasons: string[] } {
    if (record.schema !== dependencies.schemas.registration || record.protocolSchema !== dependencies.schemas.protocol) {
      return { status: dependencies.statuses.invalid, blockedReasons: ['Registration record schema is incompatible.'] }
    }
    if (!record.runtimeId) return { status: dependencies.statuses.ready, blockedReasons: [] }
    if (!runtime) return { status: dependencies.statuses.runtimeMissing, blockedReasons: [`${record.runtimeId} is not paired.`] }
    if (!runtime.online) return { status: dependencies.statuses.runtimeOffline, blockedReasons: [`${runtime.id} is offline.`] }
    if (runtime.protocolSchema !== dependencies.schemas.protocol) {
      return { status: dependencies.statuses.protocolMismatch, blockedReasons: [`${runtime.id} uses an incompatible runtime protocol.`] }
    }
    return { status: dependencies.statuses.ready, blockedReasons: [] }
  }

  function createRegisteredCatalogEntry(record: Record, runtimes: Runtime[]) {
    const runtime = record.runtimeId ? runtimes.find((candidate) => candidate.id === record.runtimeId) : undefined
    const { status, blockedReasons } = registeredCatalogStatus(record, runtime)
    return {
      registrationId: record.registrationId,
      toolId: record.toolId,
      title: dependencies.sanitizeControlPlanePublicText(record.title) ?? record.toolId,
      version: record.version,
      kind: record.kind,
      registrationKind: record.registrationKind,
      status,
      runtimeId: record.runtimeId,
      runtimeKind: record.runtimeKind ?? runtime?.kind,
      androidDisposition: record.androidDisposition,
      registeredAt: record.registeredAt,
      permissions: uniqueTypedList(record.permissions, dependencies.permissions),
      requiredCapabilities: uniqueTypedList(record.requiredCapabilities, dependencies.capabilities),
      transports: uniqueTypedList(record.transports, dependencies.transports),
      blockedReasons,
    }
  }

  function registrationKindForManifest(manifest: Manifest, runtimeId: string | undefined): TRegistrationKind {
    return manifest.entry.type === dependencies.appActionEntryType && (!runtimeId || runtimeId === dependencies.androidAppRuntimeId)
      ? dependencies.appActionRegistrationKind
      : dependencies.runtimeToolRegistrationKind
  }

  function buildRegisteredCatalogSnapshot(input: {
    records?: Record[]
    runtimes?: Runtime[]
    now?: number
  } = {}) {
    const inputRecord = asRecord(input)
    if (!inputRecord || !hasOnlyAllowedKeys(inputRecord, ['records', 'runtimes', 'now'])) {
      return buildRegisteredCatalogSnapshot({
        records: [],
        runtimes: [],
        now: dependencies.sanitizeTimestamp(inputRecord?.now) ?? Date.now(),
      })
    }
    const generatedAt = dependencies.sanitizeTimestamp(input.now) ?? Date.now()
    const runtimes = dependencies.createTrustedRuntimes(
      input.runtimes ?? dependencies.createDefaultRuntimes(generatedAt)
    )
    const latest = new Map<string, Record>()
    for (const record of input.records ?? []) {
      if (!isTrustedRegistrationRecord(record)) continue
      const key = registeredCatalogKey(record)
      const current = latest.get(key)
      if (!current || record.registeredAt >= current.registeredAt) latest.set(key, record)
    }
    const entries = Array.from(latest.values())
      .sort((left, right) => right.registeredAt - left.registeredAt || left.toolId.localeCompare(right.toolId))
      .slice(0, dependencies.entryLimit)
      .map((record) => createRegisteredCatalogEntry(record, runtimes))
    const counts = dependencies.createEmptyCounts()
    const statusCounts: StatusCounts = counts
    counts.total = latest.size
    for (const entry of entries) {
      statusCounts[entry.status] += 1
      if (entry.registrationKind === dependencies.appActionRegistrationKind) counts.appAction += 1
      else counts.runtimeTool += 1
    }
    return {
      schema: dependencies.schemas.catalog,
      registrationRecordSchema: dependencies.schemas.registration,
      protocolSchema: dependencies.schemas.protocol,
      generatedAt,
      entryLimit: dependencies.entryLimit,
      counts,
      entries,
    }
  }

  return {
    createRegistrationRecord,
    sanitizeRegistrationRecord,
    isTrustedRegistrationRecord,
    createRegistrationFailure,
    sanitizeRegisteredCatalogRecordLimit,
    createRegisteredCatalogPersistenceCounts,
    normalizeRegisteredCatalogPersistenceRecords,
    registeredCatalogKey,
    createRegisteredCatalogEntry,
    registeredCatalogStatus,
    registrationKindForManifest,
    buildRegisteredCatalogSnapshot,
  }
}

function hasTrustedRegistrationRecordFields(record: Record<string, unknown>): boolean {
  const allowed = new Set([
    'schema', 'manifestSchema', 'controlPlaneActionSchema', 'protocolSchema', 'registrationId', 'actionId',
    'registeredAt', 'projectId', 'toolId', 'title', 'version', 'kind', 'registrationKind', 'runtimeId',
    'runtimeKind', 'androidDisposition', 'permissions', 'requiredCapabilities', 'transports',
  ])
  return Object.keys(record).every((key) => allowed.has(key))
}

function includes<T extends string>(allowed: readonly T[], input: unknown): T | undefined {
  return typeof input === 'string' && allowed.includes(input as T) ? input as T : undefined
}

function uniqueTypedList<T extends string>(input: readonly T[], allowed: readonly T[]): T[] {
  return Array.from(new Set(input.filter((value) => allowed.includes(value))))
}

function uniqueCleanList(input: readonly string[]): string[] {
  return Array.from(new Set(input.map((value) => value.trim()).filter(Boolean)))
}

function sanitizeList(input: unknown): unknown[] {
  return Array.isArray(input) ? input.slice(0, 80) : []
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : undefined
}

function hasOnlyAllowedKeys(input: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys)
  return Object.keys(input).every((key) => allowed.has(key))
}
