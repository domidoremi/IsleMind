import type { AdmittedRuntimeKind } from './toolchainManifestAdmission'

export type CountResolutionStatus = 'ready' | 'needs_permission' | 'waiting_for_user' | 'unsupported' | 'invalid'
export type CountAndroidDisposition = 'app-only' | 'companion-runtime' | 'remote-runtime' | 'unavailable'
export type CountInstallStatus = 'installable' | 'needs_permission' | 'needs_runtime' | 'needs_confirmation' | 'blocked'
export type CountInstallAction = 'register-app-action' | 'register-runtime-tool' | 'pair-runtime' | 'grant-permission' | 'confirm-intent' | 'fix-manifest'
export type CountDoctorSeverity = 'info' | 'warning' | 'error'
export type CountDoctorAction = 'grant-permission' | 'pair-runtime' | 'upgrade-dependency' | 'confirm-intent' | 'fix-manifest'
export type CountIntentImpact = 'file-write' | 'mcp-approval' | 'secret-use' | 'git-change' | 'release-change'
export type CountTaskStatus = 'queued' | 'running' | 'waiting_for_permission' | 'waiting_for_user' | 'succeeded' | 'failed' | 'cancelled' | 'expired'
export type CountTaskLogLevel = 'debug' | 'info' | 'warning' | 'error'
export type CountTaskArtifactKind = 'json' | 'text' | 'artifact' | 'log' | 'diff' | 'report'
export type CountGatewayStatus = 'starting' | 'ready' | 'unavailable' | 'closed' | 'expired'
export type CountBinaryStatus = 'accepted' | 'rejected'
export type CountRegisteredStatus = 'ready' | 'runtime_offline' | 'protocol_mismatch' | 'runtime_missing' | 'invalid'

export interface RegistrySnapshotCounts { total: number; valid: number; invalid: number; ready: number; needsPermission: number; waitingForUser: number; unsupported: number }
export type ToolchainCountInstallPlanCounts = Record<CountInstallStatus, number> & { total: number }
export type RegisteredCatalogCounts = Record<CountRegisteredStatus, number> & { total: number; appAction: number; runtimeTool: number }

export interface ToolchainCountPolicyConfiguration {
  resolutionStatuses: readonly CountResolutionStatus[]
  androidDispositions: readonly CountAndroidDisposition[]
  runtimeKinds: readonly AdmittedRuntimeKind[]
  installStatuses: readonly CountInstallStatus[]
  installActions: readonly CountInstallAction[]
  doctorSeverities: readonly CountDoctorSeverity[]
  doctorActions: readonly CountDoctorAction[]
  intentImpacts: readonly CountIntentImpact[]
  taskStatuses: readonly CountTaskStatus[]
  taskLogLevels: readonly CountTaskLogLevel[]
  taskArtifactKinds: readonly CountTaskArtifactKind[]
  gatewayStatuses: readonly CountGatewayStatus[]
  pairingStatuses: readonly CountBinaryStatus[]
  registeredStatuses: readonly CountRegisteredStatus[]
}

export function createToolchainCountPolicy(config: ToolchainCountPolicyConfiguration) {
  const zero = <T extends string>(keys: readonly T[]): Record<T, number> => Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>
  const createEmptyStatusCounts = () => zero(config.resolutionStatuses)
  const createEmptyAndroidDispositionCounts = () => zero(config.androidDispositions)
  const createEmptyRuntimeKindCounts = () => zero(config.runtimeKinds)
  const createEmptyInstallStatusCounts = () => zero(config.installStatuses)
  const createEmptyInstallActionCounts = () => zero(config.installActions)
  const createEmptyDoctorSeverityCounts = () => zero(config.doctorSeverities)
  const createEmptyDoctorActionCounts = () => zero(config.doctorActions)
  const createEmptyIntentImpactKindCounts = () => zero(config.intentImpacts)
  const createEmptyTaskStatusCounts = () => zero(config.taskStatuses)
  const createEmptyTaskLogLevelCounts = () => zero(config.taskLogLevels)
  const createEmptyTaskArtifactKindCounts = () => zero(config.taskArtifactKinds)
  const createEmptyMcpGatewaySessionStatusCounts = () => zero(config.gatewayStatuses)
  const createEmptyRuntimePairingAcceptanceStatusCounts = () => zero(config.pairingStatuses)
  const createEmptyRegisteredStatusCounts = () => zero(config.registeredStatuses)

  function createEmptyRegistrySnapshotCounts(total = 0): RegistrySnapshotCounts {
    return { total, valid: 0, invalid: 0, ready: 0, needsPermission: 0, waitingForUser: 0, unsupported: 0 }
  }
  function createEmptyInstallPlanCounts(): ToolchainCountInstallPlanCounts {
    return { total: 0, ...createEmptyInstallStatusCounts() }
  }
  function createEmptyRegisteredCatalogCounts(): RegisteredCatalogCounts {
    return { total: 0, appAction: 0, runtimeTool: 0, ...createEmptyRegisteredStatusCounts() }
  }
  function createEmptyDoctorRuntimeCounts(): Record<AdmittedRuntimeKind, { online: number; offline: number }> {
    return Object.fromEntries(config.runtimeKinds.map((kind) => [kind, { online: 0, offline: 0 }])) as Record<AdmittedRuntimeKind, { online: number; offline: number }>
  }
  function registrySnapshotCountsAreInternallyValid(counts: RegistrySnapshotCounts): boolean {
    return [counts.total, counts.valid, counts.invalid, counts.ready, counts.needsPermission, counts.waitingForUser, counts.unsupported].every(isNonNegativeInteger) &&
      counts.total === counts.valid + counts.invalid && counts.valid === counts.ready + counts.needsPermission + counts.waitingForUser + counts.unsupported
  }
  function registeredCatalogCountsAreInternallyValid(counts: RegisteredCatalogCounts): boolean {
    return isRecord(counts) && [counts.total, counts.appAction, counts.runtimeTool].every(isNonNegativeInteger) &&
      config.registeredStatuses.every((status) => isNonNegativeInteger(counts[status])) &&
      counts.total === counts.appAction + counts.runtimeTool &&
      counts.total === config.registeredStatuses.reduce((total, status) => total + counts[status], 0)
  }
  return { createEmptyStatusCounts, createEmptyRegistrySnapshotCounts, createEmptyAndroidDispositionCounts,
    createEmptyRuntimeKindCounts, createEmptyInstallPlanCounts, createEmptyInstallStatusCounts,
    createEmptyInstallActionCounts, createEmptyDoctorSeverityCounts, createEmptyDoctorActionCounts,
    createEmptyIntentImpactKindCounts, createEmptyTaskStatusCounts, createEmptyTaskLogLevelCounts,
    createEmptyTaskArtifactKindCounts, createEmptyMcpGatewaySessionStatusCounts,
    createEmptyRuntimePairingAcceptanceStatusCounts,
    createEmptyRegisteredCatalogCounts, createEmptyRegisteredStatusCounts, registrySnapshotCountsAreInternallyValid,
    registeredCatalogCountsAreInternallyValid, createEmptyDoctorRuntimeCounts }
}

function isNonNegativeInteger(input: unknown): input is number {
  return typeof input === 'number' && Number.isInteger(input) && input >= 0
}
function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === 'object' && !Array.isArray(input)
}
