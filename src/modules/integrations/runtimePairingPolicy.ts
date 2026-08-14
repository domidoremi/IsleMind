import { sanitizeTaskLogMessage } from './runtimeTaskTextPolicy'
import { isUnsafeRuntimePairingText } from './textSafety'

export type RuntimePairingPolicyErrorCode =
  | 'runtime_unavailable'
  | 'android_execution_blocked'
  | 'capability_missing'
  | 'dependency_missing'

export interface RuntimePairingPolicyHandshake<
  TRuntimeKind extends string = string,
  TTransport extends string = string,
  TCapability extends string = string,
> {
  runtimeId: string
  runtimeName: string
  runtimeKind: TRuntimeKind
  online: boolean
  transports: TTransport[]
  capabilities: TCapability[]
  dependencies: Record<string, string>
}

export interface RuntimePairingPolicySnapshot<
  TProtocolSchema extends string = string,
  TRuntimeKind extends string = string,
  TTransport extends string = string,
  TCapability extends string = string,
> {
  id: string
  name: string
  kind: TRuntimeKind
  protocolSchema: TProtocolSchema
  online: boolean
  transports: TTransport[]
  capabilities: TCapability[]
  dependencies?: Record<string, string>
  pairedAt?: number
  lastSeenAt?: number
}

export interface RuntimePairingPolicyDependencies<TProtocolSchema extends string> {
  protocolSchema: TProtocolSchema
  eventEntryLimit: number
  eventKeyLimit: number
}

export function createRuntimePairingPolicy<const TProtocolSchema extends string>(
  dependencies: RuntimePairingPolicyDependencies<TProtocolSchema>,
) {
  function satisfiesDependency(version: string | undefined, range: string): boolean {
    if (!range) return true
    if (!version) return false
    const required = range.trim()
    if (!required.startsWith('>=')) return version === required
    const requiredMajor = parseMajor(required.slice(2))
    const actualMajor = parseMajor(version)
    return actualMajor !== undefined && requiredMajor !== undefined && actualMajor >= requiredMajor
  }

  function createRuntimeSnapshotFromPairingHandshake<
    TRuntimeKind extends string,
    TTransport extends string,
    TCapability extends string,
  >(
    handshake: RuntimePairingPolicyHandshake<TRuntimeKind, TTransport, TCapability>,
    now: number,
  ): RuntimePairingPolicySnapshot<TProtocolSchema, TRuntimeKind, TTransport, TCapability> {
    return {
      id: handshake.runtimeId,
      name: handshake.runtimeName,
      kind: handshake.runtimeKind,
      protocolSchema: dependencies.protocolSchema,
      online: handshake.online,
      transports: handshake.transports,
      capabilities: handshake.capabilities,
      dependencies: handshake.dependencies,
      pairedAt: now,
      lastSeenAt: now,
    }
  }

  function runtimePairingErrorCode(input: {
    requestedRuntimeMismatch: boolean
    online: boolean
    runtimeKind: string
    missingCapabilities: readonly string[]
    missingDependencies: readonly string[]
  }): RuntimePairingPolicyErrorCode | undefined {
    if (input.requestedRuntimeMismatch || !input.online) return 'runtime_unavailable'
    if (input.runtimeKind === 'android-app') return 'android_execution_blocked'
    if (input.missingCapabilities.length) return 'capability_missing'
    if (input.missingDependencies.length) return 'dependency_missing'
    return undefined
  }

  function runtimePairingDependencySatisfied(
    dependencyKey: string,
    dependencyVersions: Record<string, string>,
  ): boolean {
    const parsed = parseRuntimePairingDependencyKey(dependencyKey)
    if (!parsed) return false
    const version = dependencyVersions[parsed.name]
    if (!parsed.range) return Boolean(version)
    return satisfiesDependency(version, parsed.range)
  }

  function sanitizeRuntimePairingToolIdList(input: unknown): string[] {
    return sanitizeExactStableIdList(input, dependencies.eventEntryLimit)
  }

  function sanitizeRuntimePairingDependencyKeyList(input: unknown): string[] {
    return Array.from(new Set(sanitizeList(input).filter((value): value is string => (
      typeof value === 'string' &&
      value.trim() === value &&
      Boolean(value)
    ))))
      .filter((value) => !isUnsafeRuntimePairingText(value))
      .filter((value) => Boolean(parseRuntimePairingDependencyKey(value)))
      .slice(0, dependencies.eventKeyLimit)
  }

  function runtimeAvailabilityReasons(runtime: {
    id: string
    online: boolean
    protocolSchema: string
  }): string[] {
    return [
      runtime.online ? '' : `${runtime.id} is offline.`,
      runtime.protocolSchema === dependencies.protocolSchema ? '' : `${runtime.id} uses an incompatible runtime protocol.`,
    ].filter(Boolean)
  }

  return {
    satisfiesDependency,
    createRuntimeSnapshotFromPairingHandshake,
    runtimePairingErrorCode,
    runtimePairingDependencySatisfied,
    parseRuntimePairingDependencyKey,
    sanitizeRuntimePairingStableId,
    sanitizeRuntimePairingOptionalToken,
    sanitizeToolchainMetadataToken,
    sanitizeExactStableIdToken,
    sanitizeExactStableIdList,
    sanitizeTaskStatusReason,
    sanitizeMcpGatewayServerName,
    sanitizeRuntimePairingDisplayText,
    sanitizeRuntimePairingToolIdList,
    sanitizeRuntimePairingDependencyKeyList,
    sanitizeRuntimePairingDependencyMap,
    defaultRuntimePairingName,
    runtimeAvailabilityReasons,
  }
}

export function parseRuntimePairingDependencyKey(input: string): { name: string; range: string } | undefined {
  if (typeof input !== 'string' || input.trim() !== input) return undefined
  const operatorIndex = input.indexOf('>=')
  if (operatorIndex > 0) {
    const name = input.slice(0, operatorIndex)
    const range = input.slice(operatorIndex)
    return /^[A-Za-z0-9_.:-]{1,64}$/.test(name) && /^>=[A-Za-z0-9_.:+~-]{1,64}$/.test(range)
      ? { name, range }
      : undefined
  }
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(input) ? { name: input, range: '' } : undefined
}

export function sanitizeRuntimePairingStableId(input: unknown, fallback: string): string {
  const candidate = sanitizeExactStableIdToken(input)
  if (candidate) return candidate
  const sanitizedFallback = cleanTaskItemToken(fallback)
  return isStableId(sanitizedFallback) ? sanitizedFallback : 'runtime-pairing'
}

export function sanitizeRuntimePairingOptionalToken(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.trim() !== input) return undefined
  const sanitized = sanitizeTaskLogMessage(input)
  if (!sanitized.message || sanitized.redacted || isUnsafeRuntimePairingText(sanitized.message)) return undefined
  return sanitizeExactStableIdToken(sanitized.message)
}

export function sanitizeToolchainMetadataToken(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.trim() !== input) return undefined
  const sanitized = sanitizeTaskLogMessage(input)
  if (!sanitized.message || sanitized.redacted || isUnsafeRuntimePairingText(sanitized.message)) return undefined
  return sanitizeExactStableIdToken(sanitized.message)
}

export function sanitizeExactStableIdToken(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.trim() !== input) return undefined
  const token = input
  if (
    !token ||
    cleanTaskItemToken(token) !== token ||
    !isStableId(token) ||
    /(?:^|[._:-])sk-[A-Za-z0-9_-]{8,}/i.test(token) ||
    /(?:^|[._:-])(?:api[-_]?key|token|secret|password|authorization|credential)(?:[._:-]|$)/i.test(token)
  ) return undefined
  return token
}

export function sanitizeExactStableIdList(input: unknown, limit: number): string[] {
  const ids: string[] = []
  for (const value of sanitizeList(input)) {
    const id = sanitizeExactStableIdToken(value)
    if (id && !ids.includes(id)) ids.push(id)
    if (ids.length >= limit) break
  }
  return ids
}

export function sanitizeTaskStatusReason(input: unknown): string | undefined {
  const sanitized = sanitizeTaskLogMessage(input)
  if (!sanitized.message || sanitized.redacted || isUnsafeRuntimePairingText(sanitized.message)) return undefined
  return sanitized.message
}

export function sanitizeMcpGatewayServerName(input: unknown): string | undefined {
  const sanitized = sanitizeTaskLogMessage(input)
  if (!sanitized.message || sanitized.redacted || isUnsafeRuntimePairingText(sanitized.message)) return undefined
  return sanitized.message
}

export function sanitizeRuntimePairingDisplayText(input: unknown, fallback: string): string {
  const sanitized = sanitizeTaskLogMessage(input)
  if (!sanitized.message || sanitized.redacted || isUnsafeRuntimePairingText(sanitized.message)) return fallback
  return sanitized.message
}

export function sanitizeRuntimePairingDependencyMap(input: unknown): Record<string, string> {
  const record = asRecord(input)
  if (!record) return {}
  const dependencyVersions: Record<string, string> = {}
  for (const [key, value] of Object.entries(record).slice(0, 12)) {
    if (
      typeof value !== 'string' ||
      key.trim() !== key ||
      value.trim() !== value ||
      !/^[A-Za-z0-9_.:-]{1,64}$/.test(key) ||
      !/^[A-Za-z0-9_.:+~-]{1,64}$/.test(value) ||
      isUnsafeRuntimePairingText(key) ||
      isUnsafeRuntimePairingText(value)
    ) continue
    dependencyVersions[key] = value
  }
  return dependencyVersions
}

export function defaultRuntimePairingName(kind: string): string {
  if (kind === 'android-app') return 'IsleMind Android App'
  if (kind === 'termux') return 'Termux Runtime'
  if (kind === 'desktop') return 'Desktop Runtime'
  return 'Remote Runtime'
}

function parseMajor(version: string): number | undefined {
  const major = Number(version.trim().match(/^(\d+)/)?.[1])
  return Number.isFinite(major) ? major : undefined
}

function cleanTaskItemToken(input: string | undefined): string {
  return cleanText(input)
    .replace(/[^a-z0-9_.:-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128)
    .replace(/^-+|-+$/g, '')
}

function cleanText(input: unknown): string {
  return typeof input === 'string' ? input.trim().slice(0, 420) : ''
}

function isStableId(value: string | undefined): boolean {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._:-]{1,127}$/.test(value)
}

function sanitizeList(input: unknown): unknown[] {
  return Array.isArray(input) ? input.slice(0, 80) : []
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : undefined
}
