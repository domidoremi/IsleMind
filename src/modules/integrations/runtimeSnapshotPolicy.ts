import { cleanPublicText } from './runtimeTaskTextPolicy'
import { isUnsafeRuntimePairingText } from './textSafety'

export interface RuntimeSnapshotPolicyRuntime<
  TRuntimeKind extends string,
  TTransport extends string,
  TCapability extends string,
> {
  id: string
  name: string
  kind: TRuntimeKind
  protocolSchema: string
  online: boolean
  transports: TTransport[]
  capabilities: TCapability[]
  dependencies?: Record<string, string>
  pairedAt?: number
  lastSeenAt?: number
}

export interface RuntimeSnapshotPolicyDependencies<
  TRuntimeKind extends string,
  TTransport extends string,
  TCapability extends string,
> {
  runtimeKinds: readonly TRuntimeKind[]
  transports: readonly TTransport[]
  capabilities: readonly TCapability[]
  sanitizeStableId(input: unknown): string | undefined
  sanitizeDependencyMap(input: unknown): Record<string, string>
  stableIdentityString(input: unknown): string
}

export function createRuntimeSnapshotPolicy<
  TRuntimeKind extends string,
  TTransport extends string,
  TCapability extends string,
  TRuntime extends RuntimeSnapshotPolicyRuntime<TRuntimeKind, TTransport, TCapability>,
>(dependencies: RuntimeSnapshotPolicyDependencies<TRuntimeKind, TTransport, TCapability>) {
  function createTrustedRuntimeSnapshots(runtimes: readonly TRuntime[] | undefined): TRuntime[] {
    const seenRuntimeIds = new Set<string>()
    return (runtimes ?? []).filter((runtime): runtime is TRuntime => {
      if (!isTrustedRuntimeSnapshot(runtime) || seenRuntimeIds.has(runtime.id)) return false
      seenRuntimeIds.add(runtime.id)
      return true
    })
  }

  function isTrustedRuntimeSnapshot(input: unknown): input is TRuntime {
    const record = asRecord(input)
    if (!record || !hasTrustedRuntimeSnapshotFields(record)) return false
    const runtime = record as unknown as TRuntime
    const id = cleanStableToken(record.id)
    const name = cleanPublicText(record.name)
    const protocolSchema = cleanStableToken(record.protocolSchema)
    const dependenciesInput = record.dependencies ?? {}
    const trustedDependencies = dependencies.sanitizeDependencyMap(dependenciesInput)
    return dependencies.sanitizeStableId(id) === id &&
      record.id === id &&
      !isUnsafeRuntimeSnapshotId(id) &&
      Boolean(name) &&
      record.name === name &&
      !isUnsafeRuntimeSnapshotName(name) &&
      dependencies.runtimeKinds.includes(record.kind as TRuntimeKind) &&
      dependencies.sanitizeStableId(protocolSchema) === protocolSchema &&
      record.protocolSchema === protocolSchema &&
      !isUnsafeRuntimePairingText(protocolSchema) &&
      typeof record.online === 'boolean' &&
      isTrustedRuntimeTransportList(record.transports) &&
      isTrustedRuntimeCapabilityList(record.capabilities) &&
      (record.dependencies === undefined || Boolean(asRecord(record.dependencies))) &&
      dependencies.stableIdentityString(trustedDependencies) === dependencies.stableIdentityString(dependenciesInput) &&
      (runtime.pairedAt === undefined || Number.isFinite(runtime.pairedAt)) &&
      (runtime.lastSeenAt === undefined || Number.isFinite(runtime.lastSeenAt))
  }

  function isTrustedRuntimeTransportList(input: unknown): input is TTransport[] {
    return isTrustedRuntimeStringList(input, dependencies.transports)
  }

  function isTrustedRuntimeCapabilityList(input: unknown): input is TCapability[] {
    return isTrustedRuntimeStringList(input, dependencies.capabilities)
  }

  function isTrustedRuntimeStringList<TValue extends string>(
    input: unknown,
    allowed: readonly TValue[],
  ): input is TValue[] {
    if (!Array.isArray(input) || input.length > allowed.length) return false
    const trusted = Array.from(new Set(
      input.filter((item): item is TValue => allowed.includes(item as TValue)),
    ))
    return trusted.length === input.length &&
      dependencies.stableIdentityString(trusted) === dependencies.stableIdentityString(input)
  }

  return {
    createTrustedRuntimeSnapshots,
    isTrustedRuntimeSnapshot,
    isTrustedRuntimeTransportList,
    isTrustedRuntimeCapabilityList,
    isUnsafeRuntimeSnapshotName,
  }
}

export function isUnsafeRuntimeSnapshotName(input: string): boolean {
  return (
    /(?:^|[/?&\s])(api[-_]?key|token|secret|password|authorization|credential)(?:\s*[:=]|[/?&=]|$)/i.test(input) ||
    /sk-[A-Za-z0-9_-]{8,}/i.test(input) ||
    /[\\/]/.test(input) ||
    /:\/\//.test(input) ||
    /[;&|`$]/.test(input) ||
    /(?:^|\s)(?:node|npm|bun|pnpm|npx|git|python|python3|sh|bash|pwsh|cmd)\s+(?:-|\.{0,2}[\\/]|[A-Za-z]:[\\/]|[A-Za-z0-9_.:-]+(?:\s|$))/i.test(input) ||
    /(?:^|\s)islemind\s+(?:mcp|skill|git|agent|toolchain|runtime|serve|run|validate|commit-preview)\b/i.test(input)
  )
}

function hasTrustedRuntimeSnapshotFields(record: Record<string, unknown>): boolean {
  return Object.keys(record).every((key) => (
    key === 'id' ||
    key === 'name' ||
    key === 'kind' ||
    key === 'protocolSchema' ||
    key === 'online' ||
    key === 'transports' ||
    key === 'capabilities' ||
    key === 'dependencies' ||
    key === 'pairedAt' ||
    key === 'lastSeenAt'
  ))
}

function isUnsafeRuntimeSnapshotId(input: string): boolean {
  return (
    /(?:^|[._:-])sk-[A-Za-z0-9_-]{8,}/i.test(input) ||
    /(?:^|[._:-])(?:api[-_]?key|token|secret|password|authorization|credential)(?:[._:-]|$)/i.test(input)
  )
}

function cleanStableToken(input: unknown): string {
  return typeof input === 'string'
    ? input.trim()
      .slice(0, 420)
      .replace(/[^a-z0-9_.:-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 128)
      .replace(/^-+|-+$/g, '')
    : ''
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : undefined
}
