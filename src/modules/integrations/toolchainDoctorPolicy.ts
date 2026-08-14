import { isUnsafeRuntimePairingText } from './textSafety'
import type {
  AdmittedRuntimeCapability,
  AdmittedRuntimeKind,
  AdmittedToolPermission,
} from './toolchainManifestAdmission'
import type {
  ToolchainDoctorActionKind,
  ToolchainDoctorSeverity,
  ToolchainDoctorStatus,
  ToolchainPermission,
} from './toolchainContracts'
import type { ToolchainRuntimeCapability } from './toolchainRuntimeTrust'

export interface ToolchainDoctorFinding {
  id: string
  severity: ToolchainDoctorSeverity
  title: string
  detail: string
  toolIds: string[]
  runtimeIds: string[]
  permissions: ToolchainPermission[]
  capabilities: ToolchainRuntimeCapability[]
  dependencies: string[]
  action: ToolchainDoctorActionKind
}

export interface ToolchainDoctorRegistryCounts {
  ready: number
  invalid: number
  unsupported: number
  needsPermission: number
  waitingForUser: number
}

export interface ToolchainDoctorRuntimeInput {
  kind: AdmittedRuntimeKind
  online: boolean
}

export type ToolchainDoctorRuntimeCounts = Record<AdmittedRuntimeKind, { online: number; offline: number }>

export interface ToolchainDoctorPolicyDependencies {
  permissions: readonly AdmittedToolPermission[]
  runtimeCapabilities: readonly AdmittedRuntimeCapability[]
  runtimeKinds: readonly AdmittedRuntimeKind[]
  limits: { entries: number; keys: number }
  sanitizeStableIdList(input: unknown, limit: number): string[]
  sanitizeDependencyKeyList(input: unknown): string[]
  sanitizeText(input: unknown): { message: string; redacted: boolean }
}

export function createToolchainDoctorPolicy(dependencies: ToolchainDoctorPolicyDependencies) {
  const permissionSet = new Set(dependencies.permissions)
  const capabilitySet = new Set(dependencies.runtimeCapabilities)

  function sanitizeDoctorPublicText(input: unknown, fallback: string): string {
    const sanitized = dependencies.sanitizeText(input)
    if (!sanitized.message || sanitized.redacted || isUnsafeRuntimePairingText(sanitized.message)) return fallback
    return sanitized.message
  }

  function createDoctorFinding(input: {
    id: string
    severity: ToolchainDoctorSeverity
    title: string
    detail: string
    action: ToolchainDoctorActionKind
    toolIds?: string[]
    runtimeIds?: string[]
    permissions?: AdmittedToolPermission[]
    capabilities?: AdmittedRuntimeCapability[]
    dependencies?: string[]
  }): ToolchainDoctorFinding {
    return {
      id: input.id,
      severity: input.severity,
      title: sanitizeDoctorPublicText(input.title, 'Toolchain doctor finding.'),
      detail: sanitizeDoctorPublicText(input.detail, 'Toolchain doctor detail is unavailable.'),
      action: input.action,
      toolIds: dependencies.sanitizeStableIdList(input.toolIds, dependencies.limits.entries),
      runtimeIds: dependencies.sanitizeStableIdList(input.runtimeIds, dependencies.limits.entries),
      permissions: uniqueAllowed(input.permissions ?? [], permissionSet).slice(0, dependencies.limits.keys),
      capabilities: uniqueAllowed(input.capabilities ?? [], capabilitySet).slice(0, dependencies.limits.keys),
      dependencies: dependencies.sanitizeDependencyKeyList(input.dependencies),
    }
  }

  function resolveDoctorStatus(findings: ToolchainDoctorFinding[]): ToolchainDoctorStatus {
    if (findings.some((finding) => finding.severity === 'error')) return 'blocked'
    if (findings.length) return 'action-required'
    return 'ready'
  }

  function buildDoctorSummaryFromCounts(status: ToolchainDoctorStatus, counts: ToolchainDoctorRegistryCounts): string {
    if (status === 'ready') return `${counts.ready} toolchain tool(s) are ready.`
    if (status === 'blocked') {
      return `${counts.invalid + counts.unsupported} toolchain tool(s) are blocked; ${counts.needsPermission + counts.waitingForUser} need user action.`
    }
    return `${counts.needsPermission + counts.waitingForUser} toolchain tool(s) need user action before execution.`
  }

  function buildDoctorSummary(status: ToolchainDoctorStatus, registry: { counts: ToolchainDoctorRegistryCounts }): string {
    return buildDoctorSummaryFromCounts(status, registry.counts)
  }

  function countRuntimesByKind(runtimes: ToolchainDoctorRuntimeInput[]): ToolchainDoctorRuntimeCounts {
    const counts = Object.fromEntries(dependencies.runtimeKinds.map((kind) => [kind, { online: 0, offline: 0 }])) as ToolchainDoctorRuntimeCounts
    for (const runtime of runtimes) counts[runtime.kind][runtime.online ? 'online' : 'offline'] += 1
    return counts
  }

  function hasOnlineExecutionRuntime(runtimes: ToolchainDoctorRuntimeInput[]): boolean {
    return runtimes.some((runtime) => runtime.online && runtime.kind !== 'android-app')
  }

  function isDoctorSeverity(value: unknown): value is ToolchainDoctorSeverity {
    return value === 'info' || value === 'warning' || value === 'error'
  }

  function isDoctorActionKind(value: unknown): value is ToolchainDoctorActionKind {
    return value === 'grant-permission' || value === 'pair-runtime' || value === 'upgrade-dependency' ||
      value === 'confirm-intent' || value === 'fix-manifest'
  }

  function doctorRuntimeCountsAreValid(counts: ToolchainDoctorRuntimeCounts): boolean {
    return dependencies.runtimeKinds.every((kind) => isNonNegativeInteger(counts[kind]?.online) && isNonNegativeInteger(counts[kind]?.offline))
  }

  return { createDoctorFinding, sanitizeDoctorPublicText, resolveDoctorStatus, buildDoctorSummary,
    buildDoctorSummaryFromCounts, countRuntimesByKind, hasOnlineExecutionRuntime, isDoctorSeverity,
    isDoctorActionKind, doctorRuntimeCountsAreValid }
}

function uniqueAllowed<T extends string>(input: readonly T[], allowed: ReadonlySet<T>): T[] {
  return Array.from(new Set(input.filter((value) => allowed.has(value))))
}

function isNonNegativeInteger(input: unknown): input is number {
  return typeof input === 'number' && Number.isInteger(input) && input >= 0
}
