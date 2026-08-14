import {
  hasUniqueStrings,
  isTrustedTaskLifecycleArtifact,
  isTrustedTaskLifecycleLogEntry,
  type PersistedTaskArtifact,
  type PersistedTaskLogEntry,
} from './runtimeReportAdmission'
import { isUnsafeRuntimePairingText } from './textSafety'

export interface RuntimeReportOfficialToolDescriptor {
  permissions: readonly string[]
  runtimes: Readonly<Record<string, string | undefined>>
}

export interface RuntimeReportTrustDependencies {
  schemas: {
    taskRecord: string
    runtimeProtocol: string
    intentPreview: string
  }
  limits: {
    logs: number
    artifacts: number
    intentItems: number
    payloadKeys: number
  }
  permissions: readonly string[]
  confirmationPermissions: readonly string[]
  resolveOfficialTool(toolId: string): RuntimeReportOfficialToolDescriptor | undefined
  isRuntimeKind(input: unknown): boolean
  isTaskStatus(input: unknown): boolean
  isIntentImpactKind(input: unknown): boolean
  intentImpactKindForPermission(permission: string): string
  sanitizePayloadKeyList(input: unknown): readonly string[]
  sanitizeStableId(input: unknown): string | undefined
  sanitizeStatusReason(input: unknown): string | undefined
  sanitizeMetadataToken(input: unknown): string | undefined
}

export interface RuntimeReportConfirmedIntentInput {
  schema: string
  confirmedAt: number
  confirmationToken: string
  permissions: string[]
  impactKinds: string[]
}

export interface RuntimeReportApplicationTaskInput {
  schema: string
  protocolSchema: string
  taskId: string
  toolId: string
  runtimeId: string
  runtimeKind: string
  status: string
  permissions: string[]
  payloadKeys: string[]
  createdAt: number
  updatedAt: number
  startedAt?: number
  completedAt?: number
  expiresAt?: number
  projectId?: string
  statusReason?: string
  confirmedIntent?: RuntimeReportConfirmedIntentInput
  logs: PersistedTaskLogEntry[]
  artifacts: PersistedTaskArtifact[]
}

export interface RuntimeReportTrustPolicy {
  isTrustedRuntimeReportApplicationTask(task: RuntimeReportApplicationTaskInput): boolean
}

export function createRuntimeReportTrustPolicy(
  dependencies: RuntimeReportTrustDependencies,
): RuntimeReportTrustPolicy {
  const permissionSet = new Set(dependencies.permissions)
  const confirmationPermissionSet = new Set(dependencies.confirmationPermissions)

  function isTrustedRuntimeReportApplicationTask(task: RuntimeReportApplicationTaskInput): boolean {
    const record = asRecord(task)
    if (
      !record ||
      !hasTrustedTaskRecordFields(record) ||
      !Array.isArray(task.permissions) ||
      !Array.isArray(task.payloadKeys) ||
      !Array.isArray(task.logs) ||
      !Array.isArray(task.artifacts)
    ) return false
    const permissions = uniqueAllowedStrings(task.permissions, permissionSet)
    const payloadKeys = dependencies.sanitizePayloadKeyList(task.payloadKeys)
    const officialTool = dependencies.resolveOfficialTool(task.toolId)
    if (officialTool) {
      const officialPermissions = uniqueAllowedStrings(officialTool.permissions, permissionSet)
      if (
        officialTool.runtimes[task.runtimeKind] !== 'supported' ||
        !sameStringSet(permissions, officialPermissions)
      ) return false
    }
    return (
      task.schema === dependencies.schemas.taskRecord &&
      task.protocolSchema === dependencies.schemas.runtimeProtocol &&
      isTrustedTaskIdToken(task.taskId) &&
      dependencies.sanitizeStableId(task.toolId) === task.toolId &&
      dependencies.sanitizeStableId(task.runtimeId) === task.runtimeId &&
      dependencies.isRuntimeKind(task.runtimeKind) &&
      dependencies.isTaskStatus(task.status) &&
      Number.isFinite(task.createdAt) &&
      Number.isFinite(task.updatedAt) &&
      task.updatedAt >= task.createdAt &&
      permissions.length === task.permissions.length &&
      payloadKeys.length === task.payloadKeys.length &&
      payloadKeys.length <= dependencies.limits.payloadKeys &&
      task.logs.length <= dependencies.limits.logs &&
      task.artifacts.length <= dependencies.limits.artifacts &&
      (task.expiresAt === undefined || (Number.isFinite(task.expiresAt) && task.expiresAt >= task.createdAt)) &&
      (task.startedAt === undefined || (Number.isFinite(task.startedAt) && task.startedAt >= task.createdAt && task.startedAt <= task.updatedAt)) &&
      (task.completedAt === undefined || (Number.isFinite(task.completedAt) && task.completedAt >= task.createdAt && task.completedAt <= task.updatedAt)) &&
      (task.projectId === undefined || dependencies.sanitizeMetadataToken(task.projectId) === task.projectId) &&
      (task.statusReason === undefined || dependencies.sanitizeStatusReason(task.statusReason) === task.statusReason) &&
      (task.confirmedIntent === undefined || isTrustedConfirmedIntent(task.confirmedIntent, task.createdAt, permissions)) &&
      hasUniqueStrings(task.logs.map((log) => log.id)) &&
      hasUniqueStrings(task.artifacts.map((artifact) => artifact.artifactId)) &&
      task.logs.every((log) => isTrustedTaskLifecycleLogEntry(log, task)) &&
      task.artifacts.every((artifact) => isTrustedTaskLifecycleArtifact(artifact, task))
    )
  }

  function isTrustedTaskIdToken(input: unknown): input is string {
    if (typeof input !== 'string') return false
    const withoutTaskPrefix = input.replace(/^task-/i, '')
    return dependencies.sanitizeStableId(input) === input && !isUnsafeRuntimePairingText(withoutTaskPrefix)
  }

  function isTrustedConfirmedIntent(
    confirmedIntent: RuntimeReportConfirmedIntentInput,
    createdAt: number,
    permissions: readonly string[],
  ): boolean {
    const record = asRecord(confirmedIntent)
    if (
      !record ||
      !hasTrustedConfirmedIntentFields(record) ||
      confirmedIntent.schema !== dependencies.schemas.intentPreview ||
      !Number.isFinite(confirmedIntent.confirmedAt) ||
      confirmedIntent.confirmedAt < createdAt ||
      dependencies.sanitizeStableId(confirmedIntent.confirmationToken) !== confirmedIntent.confirmationToken ||
      !Array.isArray(confirmedIntent.permissions) ||
      !Array.isArray(confirmedIntent.impactKinds) ||
      confirmedIntent.permissions.length > dependencies.limits.intentItems ||
      confirmedIntent.impactKinds.length > dependencies.limits.intentItems
    ) return false
    const confirmationPermissions = uniqueAllowedStrings(confirmedIntent.permissions, permissionSet)
      .filter((permission) => confirmationPermissionSet.has(permission))
    if (confirmationPermissions.length !== confirmedIntent.permissions.length) return false
    const taskConfirmationPermissions = permissions.filter((permission) => confirmationPermissionSet.has(permission))
    if (!sameStringSet(confirmationPermissions, taskConfirmationPermissions)) return false
    if (!confirmedIntent.impactKinds.every(dependencies.isIntentImpactKind)) return false
    const expectedImpactKinds = confirmationPermissions.map(dependencies.intentImpactKindForPermission)
    return sameStringSet(confirmedIntent.impactKinds, expectedImpactKinds)
  }

  return { isTrustedRuntimeReportApplicationTask }
}

function hasTrustedConfirmedIntentFields(record: Record<string, unknown>): boolean {
  return Object.keys(record).every((key) => (
    key === 'schema' || key === 'confirmedAt' || key === 'confirmationToken' ||
    key === 'permissions' || key === 'impactKinds'
  ))
}

function hasTrustedTaskRecordFields(record: Record<string, unknown>): boolean {
  return Object.keys(record).every((key) => (
    key === 'schema' || key === 'protocolSchema' || key === 'taskId' || key === 'toolId' ||
    key === 'runtimeId' || key === 'runtimeKind' || key === 'status' || key === 'permissions' ||
    key === 'payloadKeys' || key === 'createdAt' || key === 'updatedAt' || key === 'startedAt' ||
    key === 'completedAt' || key === 'expiresAt' || key === 'projectId' || key === 'statusReason' ||
    key === 'confirmedIntent' || key === 'logs' || key === 'artifacts'
  ))
}

function uniqueAllowedStrings(values: readonly string[], allowed: ReadonlySet<string>): string[] {
  return Array.from(new Set(values.filter((value) => typeof value === 'string' && allowed.has(value))))
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const sortedLeft = [...left].sort()
  const sortedRight = [...right].sort()
  return sortedLeft.every((value, index) => value === sortedRight[index])
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : undefined
}
