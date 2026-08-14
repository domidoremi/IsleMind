import type {
  AdmittedRuntimeCapability,
  AdmittedRuntimeKind,
  AdmittedToolKind,
  AdmittedToolManifest,
  AdmittedToolPermission,
} from './toolchainManifestAdmission'

const TEXT_LIMIT = 420

export type InstallPlanStatus = 'installable' | 'needs_permission' | 'needs_runtime' | 'needs_confirmation' | 'blocked'
export type InstallActionKind = 'register-app-action' | 'register-runtime-tool' | 'pair-runtime' | 'grant-permission' | 'confirm-intent' | 'fix-manifest'
export type InstallAndroidDisposition = 'app-only' | 'companion-runtime' | 'remote-runtime' | 'unavailable'

export interface InstallPlanResolution {
  status: 'ready' | 'needs_permission' | 'waiting_for_user' | 'unsupported' | 'invalid'
  runtimeId?: string
  missingPermissions: AdmittedToolPermission[]
  missingCapabilities: AdmittedRuntimeCapability[]
  missingDependencies: string[]
}

export interface InstallPlanAction {
  id: string
  kind: InstallActionKind
  label: string
  required: boolean
  toolIds: string[]
  runtimeIds: string[]
  permissions: AdmittedToolPermission[]
  capabilities: AdmittedRuntimeCapability[]
  dependencies: string[]
}

export interface InstallPlanTool {
  id: string
  title: string
  version: string
  kind: AdmittedToolKind
  status: InstallPlanStatus
  androidDisposition: InstallAndroidDisposition
  runtimeId?: string
  runtimeKind?: AdmittedRuntimeKind
  permissions: AdmittedToolPermission[]
  missingPermissions: AdmittedToolPermission[]
  missingCapabilities: AdmittedRuntimeCapability[]
  missingDependencies: string[]
  requiresUserConfirmation: boolean
  actions: InstallPlanAction[]
  blockedReasons: string[]
}

export type InstallPlanCounts = Record<InstallPlanStatus, number> & { total: number }

export interface InstallPlanPolicyDependencies {
  statuses: readonly InstallPlanStatus[]
  permissions: readonly AdmittedToolPermission[]
  confirmationPermissions: readonly AdmittedToolPermission[]
  runtimeCapabilities: readonly AdmittedRuntimeCapability[]
  limits: { entries: number; keys: number; reasons: number }
  sanitizeStableIdList(input: unknown, limit: number): string[]
  sanitizeDependencyKeyList(input: unknown): string[]
}

export function createInstallPlanPolicy(dependencies: InstallPlanPolicyDependencies) {
  const permissionSet = new Set(dependencies.permissions)
  const confirmationSet = new Set(dependencies.confirmationPermissions)
  const capabilitySet = new Set(dependencies.runtimeCapabilities)

  function installStatusFromResolution(resolution: InstallPlanResolution): InstallPlanStatus {
    if (resolution.status === 'ready') return 'installable'
    if (resolution.status === 'needs_permission') return 'needs_permission'
    if (resolution.status === 'waiting_for_user') return 'needs_confirmation'
    if (resolution.status === 'unsupported') return 'needs_runtime'
    return 'blocked'
  }

  function createInstallPlanAction(input: {
    kind: InstallActionKind
    label: string
    required?: boolean
    toolIds?: string[]
    runtimeIds?: string[]
    permissions?: AdmittedToolPermission[]
    capabilities?: AdmittedRuntimeCapability[]
    dependencies?: string[]
  }): InstallPlanAction {
    const toolIds = dependencies.sanitizeStableIdList(input.toolIds, dependencies.limits.entries)
    const runtimeIds = dependencies.sanitizeStableIdList(input.runtimeIds, dependencies.limits.entries)
    return {
      id: cleanTaskItemToken(['install', input.kind, ...toolIds, ...runtimeIds].join('-')),
      kind: input.kind,
      label: cleanText(input.label),
      required: input.required ?? false,
      toolIds,
      runtimeIds,
      permissions: uniqueAllowed(input.permissions ?? [], permissionSet).slice(0, dependencies.limits.keys),
      capabilities: uniqueAllowed(input.capabilities ?? [], capabilitySet).slice(0, dependencies.limits.keys),
      dependencies: dependencies.sanitizeDependencyKeyList(input.dependencies),
    }
  }

  function installActionsForResolution(
    manifest: AdmittedToolManifest,
    resolution: InstallPlanResolution,
  ): InstallPlanAction[] {
    const actions: InstallPlanAction[] = []
    if (resolution.status === 'needs_permission') {
      actions.push(createInstallPlanAction({
        kind: 'grant-permission', label: 'Grant scoped permissions', toolIds: [manifest.id],
        runtimeIds: resolution.runtimeId ? [resolution.runtimeId] : [], permissions: resolution.missingPermissions, required: true,
      }))
    }
    if (resolution.status === 'waiting_for_user') {
      actions.push(createInstallPlanAction({
        kind: 'confirm-intent', label: 'Review intent preview', toolIds: [manifest.id],
        runtimeIds: resolution.runtimeId ? [resolution.runtimeId] : [],
        permissions: uniqueAllowed(manifest.permissions, permissionSet).filter((permission) => confirmationSet.has(permission)),
        required: true,
      }))
    }
    if (resolution.status === 'unsupported') {
      actions.push(createInstallPlanAction({
        kind: 'pair-runtime', label: 'Pair or update a compatible runtime', toolIds: [manifest.id],
        runtimeIds: resolution.runtimeId ? [resolution.runtimeId] : [], capabilities: resolution.missingCapabilities,
        dependencies: resolution.missingDependencies, required: true,
      }))
    }
    if (resolution.status === 'invalid') {
      actions.push(createInstallPlanAction({
        kind: 'fix-manifest', label: 'Fix manifest before registration', toolIds: [manifest.id], required: true,
      }))
    }
    return actions
  }

  function createInstallPlanTool(input: {
    manifest: AdmittedToolManifest
    status: InstallPlanStatus
    androidDisposition: InstallAndroidDisposition
    runtimeId?: string
    runtimeKind?: AdmittedRuntimeKind
    missingPermissions?: AdmittedToolPermission[]
    missingCapabilities?: AdmittedRuntimeCapability[]
    missingDependencies?: string[]
    requiresUserConfirmation?: boolean
    actions?: InstallPlanAction[]
    blockedReasons?: string[]
  }): InstallPlanTool {
    return {
      id: input.manifest.id,
      title: input.manifest.title,
      version: input.manifest.version,
      kind: input.manifest.kind,
      status: input.status,
      androidDisposition: input.androidDisposition,
      runtimeId: input.runtimeId,
      runtimeKind: input.runtimeKind,
      permissions: uniqueAllowed(input.manifest.permissions, permissionSet),
      missingPermissions: uniqueAllowed(input.missingPermissions ?? [], permissionSet),
      missingCapabilities: uniqueAllowed(input.missingCapabilities ?? [], capabilitySet),
      missingDependencies: dependencies.sanitizeDependencyKeyList(input.missingDependencies),
      requiresUserConfirmation: input.requiresUserConfirmation ?? false,
      actions: (input.actions ?? []).slice(0, dependencies.limits.entries),
      blockedReasons: uniqueCleanList(input.blockedReasons).slice(0, dependencies.limits.reasons),
    }
  }

  function dedupeInstallPlanActions(actions: InstallPlanAction[]): InstallPlanAction[] {
    const seen = new Set<string>()
    const output: InstallPlanAction[] = []
    for (const action of actions) {
      const key = [action.kind, action.toolIds.join(','), action.runtimeIds.join(','), action.permissions.join(','),
        action.capabilities.join(','), action.dependencies.join(',')].join('|')
      if (seen.has(key)) continue
      seen.add(key)
      output.push(action)
      if (output.length >= dependencies.limits.entries) break
    }
    return output
  }

  function buildInstallPlanSummary(counts: InstallPlanCounts): string {
    return `${counts.installable} installable, ${counts.needs_permission + counts.needs_runtime + counts.needs_confirmation} need action, ${counts.blocked} blocked.`
  }

  function installPlanCountsAreInternallyValid(counts: InstallPlanCounts): boolean {
    return isRecord(counts) && Number.isInteger(counts.total) && counts.total >= 0 &&
      dependencies.statuses.every((status) => Number.isInteger(counts[status]) && counts[status] >= 0) &&
      counts.total === dependencies.statuses.reduce((total, status) => total + counts[status], 0)
  }

  return { installStatusFromResolution, installActionsForResolution, createInstallPlanTool, createInstallPlanAction,
    dedupeInstallPlanActions, buildInstallPlanSummary, installPlanCountsAreInternallyValid }
}

function uniqueAllowed<T extends string>(input: readonly T[], allowed: ReadonlySet<T>): T[] {
  return Array.from(new Set(input.filter((value) => allowed.has(value))))
}

function uniqueCleanList(input: readonly string[] | undefined): string[] {
  return Array.from(new Set((input ?? []).map(cleanText).filter(Boolean)))
}

function cleanTaskItemToken(input: string): string {
  return cleanText(input).replace(/[^a-z0-9_.:-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 128).replace(/^-+|-+$/g, '')
}

function cleanText(input: unknown): string {
  return typeof input === 'string' ? input.trim().slice(0, TEXT_LIMIT) : ''
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === 'object' && !Array.isArray(input)
}
