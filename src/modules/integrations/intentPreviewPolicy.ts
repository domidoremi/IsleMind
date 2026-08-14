import { isUnsafeRuntimePairingText } from './textSafety'
import {
  validateToolchainManifest,
  type AdmittedRuntimeKind,
  type AdmittedToolManifest,
  type AdmittedToolPermission,
} from './toolchainManifestAdmission'

const TEXT_LIMIT = 420

export type IntentPreviewStatus = 'waiting_for_user' | 'not_required' | 'not_available'
export type IntentImpactKind = 'file-write' | 'mcp-approval' | 'secret-use' | 'git-change' | 'release-change'

export interface IntentImpact {
  kind: IntentImpactKind
  permission: AdmittedToolPermission
  label: string
  detail: string
}

export interface IntentPreviewResolution {
  runtimeId?: string
  runtimeKind?: AdmittedRuntimeKind
}

export interface IntentPreviewExecutionResolution extends IntentPreviewResolution {
  status: 'ready' | 'needs_permission' | 'waiting_for_user' | 'unsupported' | 'invalid'
  blockedReasons: string[]
  requiresUserConfirmation: boolean
}

export interface IntentPreviewCreationInput {
  manifest: AdmittedToolManifest
  resolution: IntentPreviewExecutionResolution
  payload?: Record<string, unknown>
  now?: number
}

export interface IntentPreview<TSchema extends string = string> {
  schema: TSchema
  generatedAt: number
  toolId: string
  title: string
  status: IntentPreviewStatus
  taskStatus?: 'waiting_for_user'
  runtimeId?: string
  runtimeKind?: AdmittedRuntimeKind
  summary: string
  permissions: AdmittedToolPermission[]
  impacts: IntentImpact[]
  artifactLabels: string[]
  confirmationRequired: boolean
  confirmationToken?: string
  unavailableReasons: string[]
}

export interface IntentPreviewDependencies<TSchema extends string> {
  schema: TSchema
  itemLimit: number
  permissions: readonly AdmittedToolPermission[]
  confirmationPermissions: readonly AdmittedToolPermission[]
  sanitizeText(input: unknown): { message: string; redacted: boolean }
}

export interface IntentPreviewPolicy<TSchema extends string> {
  createToolchainIntentPreview(input: IntentPreviewCreationInput): IntentPreview<TSchema>
  createIntentPreview(input: {
    manifest: AdmittedToolManifest
    status: IntentPreviewStatus
    generatedAt: number
    resolution?: IntentPreviewResolution
    summary: string
    impacts: IntentImpact[]
    artifactLabels?: string[]
    confirmationRequired?: boolean
    confirmationToken?: string
    unavailableReasons: string[]
  }): IntentPreview<TSchema>
  sanitizeControlPlaneReasonList(input: readonly string[] | undefined): string[]
  sanitizeControlPlanePublicText(input: unknown, fallback?: string): string | undefined
  buildIntentImpacts(permissions: readonly AdmittedToolPermission[]): IntentImpact[]
  intentImpactKindForPermission(permission: AdmittedToolPermission): IntentImpactKind
  intentImpactLabel(permission: AdmittedToolPermission): string
  intentImpactDetail(permission: AdmittedToolPermission): string
  buildIntentPreviewSummary(manifest: AdmittedToolManifest, impacts: IntentImpact[]): string
  inferIntentArtifactLabels(manifest: AdmittedToolManifest, payload: Record<string, unknown> | undefined): string[]
  sanitizeIntentArtifactLabel(input: unknown): string | undefined
}

export function createIntentPreviewPolicy<TSchema extends string>(
  dependencies: IntentPreviewDependencies<TSchema>,
): IntentPreviewPolicy<TSchema> {
  const permissionSet = new Set(dependencies.permissions)
  const confirmationPermissionSet = new Set(dependencies.confirmationPermissions)

  function sanitizeControlPlanePublicText(input: unknown, fallback?: string): string | undefined {
    const sanitized = dependencies.sanitizeText(input)
    if (!sanitized.message || sanitized.redacted || isUnsafeRuntimePairingText(sanitized.message)) return fallback
    return sanitized.message
  }

  function sanitizeControlPlaneReasonList(input: readonly string[] | undefined): string[] {
    return uniqueCleanList(input)
      .map((reason) => sanitizeControlPlanePublicText(reason))
      .filter((reason): reason is string => Boolean(reason))
      .slice(0, dependencies.itemLimit)
  }

  function intentImpactKindForPermission(permission: AdmittedToolPermission): IntentImpactKind {
    if (permission === 'files.write') return 'file-write'
    if (permission === 'mcp.approve') return 'mcp-approval'
    if (permission === 'secrets.use') return 'secret-use'
    if (permission === 'release.publish') return 'release-change'
    return 'git-change'
  }

  function intentImpactLabel(permission: AdmittedToolPermission): string {
    switch (permission) {
      case 'files.write': return 'Writes files'
      case 'mcp.approve': return 'Approves MCP action'
      case 'secrets.use': return 'Uses secrets'
      case 'git.commit': return 'Creates Git commit'
      case 'git.push': return 'Pushes Git changes'
      case 'release.publish': return 'Publishes release'
      default: return 'Requires confirmation'
    }
  }

  function intentImpactDetail(permission: AdmittedToolPermission): string {
    switch (permission) {
      case 'files.write': return 'The runtime may create or update files in the authorized project scope.'
      case 'mcp.approve': return 'The runtime may call an MCP tool marked destructive after visible approval.'
      case 'secrets.use': return 'The runtime may use secret references without exposing secret values in logs or artifacts.'
      case 'git.commit': return 'The runtime may prepare a commit after showing the file-change preview.'
      case 'git.push': return 'The runtime may send committed changes to a configured remote.'
      case 'release.publish': return 'The runtime may publish a release or deployment artifact.'
      default: return 'The runtime must wait for visible user confirmation before execution.'
    }
  }

  function buildIntentImpacts(permissions: readonly AdmittedToolPermission[]): IntentImpact[] {
    return permissions
      .filter((permission) => confirmationPermissionSet.has(permission))
      .map((permission) => ({
        kind: intentImpactKindForPermission(permission),
        permission,
        label: intentImpactLabel(permission),
        detail: intentImpactDetail(permission),
      }))
  }

  function sanitizeIntentArtifactLabel(input: unknown): string | undefined {
    const sanitized = dependencies.sanitizeText(input)
    if (!sanitized.message || sanitized.redacted || isUnsafeRuntimePairingText(sanitized.message)) return undefined
    return cleanTaskItemToken(sanitized.message) || undefined
  }

  function createIntentPreview(input: {
    manifest: AdmittedToolManifest
    status: IntentPreviewStatus
    generatedAt: number
    resolution?: IntentPreviewResolution
    summary: string
    impacts: IntentImpact[]
    artifactLabels?: string[]
    confirmationRequired?: boolean
    confirmationToken?: string
    unavailableReasons: string[]
  }): IntentPreview<TSchema> {
    return {
      schema: dependencies.schema,
      generatedAt: input.generatedAt,
      toolId: input.manifest.id,
      title: input.manifest.title,
      status: input.status,
      taskStatus: input.status === 'waiting_for_user' ? 'waiting_for_user' : undefined,
      runtimeId: input.resolution?.runtimeId,
      runtimeKind: input.resolution?.runtimeKind,
      summary: sanitizeControlPlanePublicText(input.summary) ?? 'Intent preview summary is unavailable.',
      permissions: uniqueAllowedPermissions(input.manifest.permissions, permissionSet)
        .filter((permission) => confirmationPermissionSet.has(permission)),
      impacts: input.impacts.slice(0, dependencies.itemLimit),
      artifactLabels: uniqueCleanList(input.artifactLabels
        ?.map(sanitizeIntentArtifactLabel)
        .filter((label): label is string => Boolean(label)))
        .slice(0, dependencies.itemLimit),
      confirmationRequired: input.confirmationRequired ?? false,
      confirmationToken: input.confirmationToken,
      unavailableReasons: sanitizeControlPlaneReasonList(input.unavailableReasons),
    }
  }

  function createToolchainIntentPreview(input: IntentPreviewCreationInput): IntentPreview<TSchema> {
    const inputRecord = asRecord(input)
    const validation = validateToolchainManifest(inputRecord?.manifest)
    const manifest = validation.sanitized
    const now = sanitizeOptionalTimestamp(inputRecord?.now) ?? Date.now()
    if (!inputRecord || !hasOnlyAllowedKeys(inputRecord, [
      'manifest',
      'resolution',
      'payload',
      'now',
    ])) {
      return createIntentPreview({
        manifest,
        status: 'not_available',
        generatedAt: now,
        summary: 'Intent preview input contains unsupported metadata.',
        impacts: [],
        unavailableReasons: ['Intent preview input contains unsupported metadata.'],
      })
    }
    const impacts = validation.ok ? buildIntentImpacts(manifest.permissions) : []
    const unavailableReasons = validation.ok
      ? input.resolution.blockedReasons.slice(0, dependencies.itemLimit)
      : validation.errors
    if (!validation.ok || input.resolution.status === 'invalid') {
      return createIntentPreview({
        manifest,
        status: 'not_available',
        generatedAt: now,
        summary: 'Intent preview is unavailable until the tool manifest is valid.',
        impacts,
        unavailableReasons,
      })
    }
    if (!input.resolution.requiresUserConfirmation || input.resolution.status !== 'waiting_for_user') {
      return createIntentPreview({
        manifest,
        status: 'not_required',
        generatedAt: now,
        resolution: input.resolution,
        summary: 'This tool does not require an explicit intent preview before execution.',
        impacts,
        unavailableReasons: [],
      })
    }
    return createIntentPreview({
      manifest,
      status: 'waiting_for_user',
      generatedAt: now,
      resolution: input.resolution,
      summary: buildIntentPreviewSummary(manifest, impacts),
      impacts,
      artifactLabels: inferIntentArtifactLabels(manifest, input.payload),
      confirmationRequired: true,
      confirmationToken: createIntentConfirmationToken(manifest.id, input.resolution.runtimeId, now),
      unavailableReasons,
    })
  }

  function buildIntentPreviewSummary(manifest: AdmittedToolManifest, impacts: IntentImpact[]): string {
    const impactText = impacts.length ? impacts.map((impact) => impact.label).join(', ') : 'high-risk action'
    return `${manifest.title} is paused for confirmation because it can perform: ${impactText}.`
  }

  function inferIntentArtifactLabels(
    manifest: AdmittedToolManifest,
    payload: Record<string, unknown> | undefined,
  ): string[] {
    const labels = Object.entries(manifest.outputs ?? {})
      .filter(([, value]) => value.type === 'artifact' || value.type === 'json')
      .map(([key]) => sanitizeIntentArtifactLabel(key))
      .filter((label): label is string => Boolean(label))
    const requestedArtifacts = Array.isArray(payload?.artifacts)
      ? payload.artifacts.map(sanitizeIntentArtifactLabel).filter((item): item is string => Boolean(item))
      : []
    return uniqueCleanList([...labels, ...requestedArtifacts]).slice(0, dependencies.itemLimit)
  }

  return {
    createToolchainIntentPreview,
    createIntentPreview,
    sanitizeControlPlaneReasonList,
    sanitizeControlPlanePublicText,
    buildIntentImpacts,
    intentImpactKindForPermission,
    intentImpactLabel,
    intentImpactDetail,
    buildIntentPreviewSummary,
    inferIntentArtifactLabels,
    sanitizeIntentArtifactLabel,
  }
}

function createIntentConfirmationToken(toolId: string, runtimeId: string | undefined, now: number): string {
  const runtimePart = runtimeId ? runtimeId.replace(/[^a-z0-9_.:-]+/gi, '-') : 'runtime'
  return `intent-${toolId.replace(/[^a-z0-9_.:-]+/gi, '-')}-${runtimePart}-${now.toString(36)}`
}

function sanitizeOptionalTimestamp(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isFinite(input) ? input : undefined
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : undefined
}

function hasOnlyAllowedKeys(input: unknown, allowedKeys: readonly string[]): boolean {
  const record = asRecord(input)
  if (!record) return false
  const allowed = new Set(allowedKeys)
  return Object.keys(record).every((key) => allowed.has(key))
}

function uniqueAllowedPermissions(
  input: readonly AdmittedToolPermission[],
  allowed: ReadonlySet<AdmittedToolPermission>,
): AdmittedToolPermission[] {
  return Array.from(new Set(input.filter((permission) => allowed.has(permission))))
}

function uniqueCleanList(input: readonly string[] | undefined): string[] {
  return Array.from(new Set((input ?? []).map(cleanText).filter(Boolean)))
}

function cleanTaskItemToken(input: string | undefined): string {
  return cleanText(input).replace(/[^a-z0-9_.:-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 128).replace(/^-+|-+$/g, '')
}

function cleanText(input: unknown): string {
  return typeof input === 'string' ? input.trim().slice(0, TEXT_LIMIT) : ''
}
