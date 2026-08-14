import { grantCoversRequestedScopes, type ToolScopeRequest } from './scopePolicy'
import type {
  AdmittedRuntimeCapability,
  AdmittedRuntimeKind,
  AdmittedToolManifest,
  AdmittedToolPermission,
  AdmittedToolTransport,
} from './toolchainManifestAdmission'

export type ExecutionResolutionStatus = 'ready' | 'needs_permission' | 'waiting_for_user' | 'unsupported' | 'invalid'
export type ExecutionAndroidDisposition = 'app-only' | 'companion-runtime' | 'remote-runtime' | 'unavailable'

export interface ExecutionRuntimeSnapshot {
  id: string
  kind: AdmittedRuntimeKind
  protocolSchema: string
  online: boolean
  transports: AdmittedToolTransport[]
  capabilities: AdmittedRuntimeCapability[]
  dependencies?: Record<string, string>
}

export interface ExecutionPermissionGrant {
  permission: AdmittedToolPermission
  runtimeId?: string
  projectId?: string
  paths?: string[]
  networkHosts?: string[]
  expiresAt?: number
}

export interface ExecutionResolutionInput {
  manifest: AdmittedToolManifest
  runtimes: ExecutionRuntimeSnapshot[]
  permissionGrants?: ExecutionPermissionGrant[]
  runtimePreference?: AdmittedRuntimeKind[]
  projectId?: string
  requestedScopes?: ToolScopeRequest
  now?: number
}

export interface ExecutionResolution {
  status: ExecutionResolutionStatus
  manifestId: string
  runtimeId?: string
  runtimeKind?: AdmittedRuntimeKind
  androidDisposition: ExecutionAndroidDisposition
  taskStatus?: 'queued' | 'waiting_for_permission' | 'waiting_for_user'
  missingPermissions: AdmittedToolPermission[]
  missingCapabilities: AdmittedRuntimeCapability[]
  missingDependencies: string[]
  blockedReasons: string[]
  requiresUserConfirmation: boolean
}

export interface ExecutionResolutionPolicyDependencies {
  protocolSchema: string
  confirmationPermissions: readonly AdmittedToolPermission[]
  inferRequiredCapabilities(manifest: AdmittedToolManifest): AdmittedRuntimeCapability[]
  missingRuntimeDependencies(manifest: AdmittedToolManifest, runtime: ExecutionRuntimeSnapshot): string[]
  sanitizeMetadataToken(input: unknown): string | undefined
  sanitizeTimestamp(input: unknown): number | undefined
}

export function createExecutionResolutionPolicy(dependencies: ExecutionResolutionPolicyDependencies) {
  const confirmationSet = new Set(dependencies.confirmationPermissions)

  function resolveAndroidDisposition(
    manifest: AdmittedToolManifest,
    runtimes: ExecutionRuntimeSnapshot[],
  ): ExecutionAndroidDisposition {
    if (manifest.runtimes['android-app'] === 'supported' && runtimes.some((runtime) => runtime.kind === 'android-app' && runtime.online)) return 'app-only'
    if (manifest.runtimes.termux === 'supported' && runtimes.some((runtime) => runtime.kind === 'termux' && runtime.online)) return 'companion-runtime'
    if ((manifest.runtimes.desktop === 'supported' && runtimes.some((runtime) => runtime.kind === 'desktop' && runtime.online)) ||
      (manifest.runtimes.remote === 'supported' && runtimes.some((runtime) => runtime.kind === 'remote' && runtime.online))) return 'remote-runtime'
    return 'unavailable'
  }

  function missingGrantedPermissions(
    manifest: AdmittedToolManifest,
    grants: ExecutionPermissionGrant[],
    runtime: ExecutionRuntimeSnapshot,
    input: ExecutionResolutionInput,
  ): AdmittedToolPermission[] {
    const now = dependencies.sanitizeTimestamp(input.now) ?? Date.now()
    const projectId = dependencies.sanitizeMetadataToken(input.projectId)
    return manifest.permissions.filter((permission) => !grants.some((grant) => {
      if (grant.permission !== permission || grant.runtimeId && grant.runtimeId !== runtime.id) return false
      if (grant.projectId !== undefined) {
        const grantProjectId = dependencies.sanitizeMetadataToken(grant.projectId)
        if (!grantProjectId || !projectId || grantProjectId !== projectId) return false
      }
      if (grant.expiresAt !== undefined) {
        const expiresAt = dependencies.sanitizeTimestamp(grant.expiresAt)
        if (expiresAt === undefined || expiresAt <= now) return false
      }
      return grantCoversRequestedScopes(permission, grant, input.requestedScopes)
    }))
  }

  function evaluateRuntimeCandidate(
    manifest: AdmittedToolManifest,
    runtime: ExecutionRuntimeSnapshot,
    input: ExecutionResolutionInput,
  ): ExecutionResolution {
    const blockedReasons: string[] = []
    const support = manifest.runtimes[runtime.kind]
    if (!runtime.online) blockedReasons.push(`${runtime.id} is offline.`)
    if (runtime.protocolSchema !== dependencies.protocolSchema) blockedReasons.push(`${runtime.id} uses an incompatible runtime protocol.`)
    if (support !== 'supported') blockedReasons.push(`${runtime.kind} is ${support}.`)
    const requiredCapabilities = dependencies.inferRequiredCapabilities(manifest)
    const missingCapabilities = requiredCapabilities.filter((capability) => !runtime.capabilities.includes(capability))
    const missingDependencies = dependencies.missingRuntimeDependencies(manifest, runtime)
    if (manifest.entry.transport && !runtime.transports.includes(manifest.entry.transport)) blockedReasons.push(`${runtime.id} does not support ${manifest.entry.transport}.`)
    if (missingCapabilities.length) blockedReasons.push(`${runtime.id} is missing required capabilities.`)
    if (missingDependencies.length) blockedReasons.push(`${runtime.id} is missing required dependencies.`)
    const missingPermissions = missingGrantedPermissions(manifest, input.permissionGrants ?? [], runtime, input)
    const requiresUserConfirmation = manifest.permissions.some((permission) => confirmationSet.has(permission))
    const base = { manifestId: manifest.id, runtimeId: runtime.id, runtimeKind: runtime.kind,
      androidDisposition: resolveAndroidDisposition(manifest, input.runtimes), requiresUserConfirmation }
    if (blockedReasons.length) return createResolution({ ...base, status: 'unsupported', missingCapabilities, missingDependencies, missingPermissions, blockedReasons })
    if (missingPermissions.length) return createResolution({ ...base, status: 'needs_permission', missingPermissions, taskStatus: 'waiting_for_permission' })
    if (requiresUserConfirmation) return createResolution({ ...base, status: 'waiting_for_user', taskStatus: 'waiting_for_user', blockedReasons: ['High-risk action requires an intent preview before execution.'] })
    return createResolution({ ...base, status: 'ready', taskStatus: 'queued' })
  }

  function orderRuntimes(runtimes: ExecutionRuntimeSnapshot[], preference: AdmittedRuntimeKind[] | undefined): ExecutionRuntimeSnapshot[] {
    const order = preference?.length ? preference : ['android-app', 'termux', 'desktop', 'remote']
    return [...runtimes].sort((left, right) => {
      const leftIndex = order.indexOf(left.kind)
      const rightIndex = order.indexOf(right.kind)
      return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex)
    })
  }

  function selectBestUnsupportedCandidate(candidates: ExecutionResolution[]): ExecutionResolution | undefined {
    return candidates.filter((candidate) => candidate.status === 'unsupported')
      .sort((left, right) => unsupportedCandidateScore(left) - unsupportedCandidateScore(right))[0]
  }

  function createResolution(input: Partial<ExecutionResolution> & {
    status: ExecutionResolutionStatus
    manifestId: string
    androidDisposition: ExecutionAndroidDisposition
  }): ExecutionResolution {
    return { status: input.status, manifestId: input.manifestId, runtimeId: input.runtimeId, runtimeKind: input.runtimeKind,
      androidDisposition: input.androidDisposition, taskStatus: input.taskStatus, missingPermissions: input.missingPermissions ?? [],
      missingCapabilities: input.missingCapabilities ?? [], missingDependencies: input.missingDependencies ?? [],
      blockedReasons: input.blockedReasons ?? [], requiresUserConfirmation: input.requiresUserConfirmation ?? false }
  }

  return { evaluateRuntimeCandidate, missingGrantedPermissions, resolveAndroidDisposition, orderRuntimes,
    selectBestUnsupportedCandidate, createResolution }
}

function unsupportedCandidateScore(candidate: ExecutionResolution): number {
  const unsupportedRuntimePenalty = candidate.blockedReasons.some((reason) => / is unsupported\.$/.test(reason)) ? 20 : 0
  const offlinePenalty = candidate.blockedReasons.some((reason) => / is offline\.$/.test(reason)) ? 12 : 0
  const protocolPenalty = candidate.blockedReasons.some((reason) => /incompatible runtime protocol/.test(reason)) ? 10 : 0
  return unsupportedRuntimePenalty + offlinePenalty + protocolPenalty + candidate.missingCapabilities.length * 4 + candidate.missingDependencies.length
}
