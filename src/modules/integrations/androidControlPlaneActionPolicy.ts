import type { AdmittedToolManifest, AdmittedRuntimeCapability } from './toolchainManifestAdmission'

export type ControlPlaneInstallActionKind =
  | 'register-app-action'
  | 'register-runtime-tool'
  | 'pair-runtime'
  | 'grant-permission'
  | 'confirm-intent'
  | 'fix-manifest'
export type ControlPlanePermission =
  | 'context.read'
  | 'files.read'
  | 'files.write'
  | 'network.local'
  | 'network.remote'
  | 'task.run'
  | 'task.cancel'
  | 'mcp.approve'
  | 'secrets.use'
  | 'git.commit'
  | 'git.push'
  | 'release.publish'
export type ControlPlaneRuntimeCapability = AdmittedRuntimeCapability
export type ControlPlaneActionRoute =
  | 'registry-registration'
  | 'runtime-pairing'
  | 'permission-grant'
  | 'intent-preview'
  | 'manifest-review'
export type ControlPlaneTaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_permission'
  | 'waiting_for_user'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired'
export type ControlPlaneActionApplicationStatus = 'applied' | 'needs_user' | 'needs_runtime' | 'blocked'
export type ControlPlaneActionErrorCode = 'action_unavailable' | 'tool_unavailable' | 'runtime_unavailable' | 'unknown_action' | 'operation_mismatch'
export type ControlPlaneApplicationErrorCode = 'schema_mismatch' | 'action_unavailable' | 'tool_unavailable' | 'runtime_unavailable' | 'manifest_required' | 'operation_mismatch'
export type ControlPlanePermissionScopeKind = 'paths' | 'networkHosts'
export type ControlPlaneSuggestedTaskStatus = 'waiting_for_permission' | 'waiting_for_user'

export interface ControlPlaneToolCard {
  id: string
  actionKinds: readonly ControlPlaneInstallActionKind[]
  runtimeId?: string
  permissions: readonly ControlPlanePermission[]
  missingPermissions: readonly ControlPlanePermission[]
  missingDependencies: readonly string[]
}

export interface ControlPlaneSnapshot<TSchema extends string = string> {
  schema: TSchema
  projectId?: string
  toolCards: readonly ControlPlaneToolCard[]
  runtimeBadges: readonly { runtimeId: string }[]
}

export interface ControlPlaneRuntimeSnapshot {
  id: string
  capabilities: readonly ControlPlaneRuntimeCapability[]
}

export interface ControlPlaneActionRequest<
  TActionSchema extends string = string,
  TSnapshotSchema extends string = string,
> {
  schema: TActionSchema
  controlPlaneSchema: TSnapshotSchema
  generatedAt: number
  actionId: string
  actionKind: ControlPlaneInstallActionKind
  route: ControlPlaneActionRoute
  projectId?: string
  toolIds: string[]
  runtimeIds: string[]
  permissions: ControlPlanePermission[]
  dependencies: string[]
  requiresUserInteraction: boolean
  requiresRuntimePairing: boolean
  suggestedTaskStatus?: ControlPlaneSuggestedTaskStatus
  summary: string
}

export interface ControlPlaneActionRequestCreation<TRequest extends ControlPlaneActionRequest = ControlPlaneActionRequest> {
  ok: boolean
  request?: TRequest
  errorCode?: ControlPlaneActionErrorCode
  message?: string
}

export interface ControlPlanePermissionGrantProposal {
  permission: ControlPlanePermission
  runtimeId?: string
  projectId?: string
  toolIds: string[]
  requiresScope: boolean
  scopeKinds: ControlPlanePermissionScopeKind[]
}

export interface ControlPlaneRuntimePairingRequest {
  toolIds: string[]
  runtimeIds: string[]
  dependencyKeys: string[]
  capabilityKeys: ControlPlaneRuntimeCapability[]
  requiresRuntimePairing: true
}

export interface ControlPlaneManifestReviewRequest {
  toolIds: string[]
  issueCount: number
  blockedReasons: string[]
}

export interface ControlPlaneActionApplication<
  TActionApplicationSchema extends string = string,
  TActionSchema extends string = string,
  TRegistrationRecordSchema extends string = string,
  TPersistenceSchema extends string = string,
  TIntentPreviewSchema extends string = string,
  TRegistrationRecord extends object = object,
  TPersistenceEnvelope extends object = object,
  TPermissionGrantProposal extends object = object,
  TIntentPreview extends object = object,
  TRuntimePairingRequest extends object = object,
  TManifestReviewRequest extends object = object,
> {
  schema: TActionApplicationSchema
  actionSchema: TActionSchema
  registrationRecordSchema: TRegistrationRecordSchema
  registeredCatalogPersistenceSchema: TPersistenceSchema
  intentPreviewSchema: TIntentPreviewSchema
  protocolSchema: string
  appliedAt: number
  applicationId: string
  actionId: string
  actionKind: ControlPlaneInstallActionKind
  route: ControlPlaneActionRoute
  status: ControlPlaneActionApplicationStatus
  projectId?: string
  toolIds: string[]
  runtimeIds: string[]
  permissions: ControlPlanePermission[]
  dependencies: string[]
  nextActionKinds: ControlPlaneInstallActionKind[]
  suggestedTaskStatus?: ControlPlaneSuggestedTaskStatus
  requiresUserInteraction: boolean
  requiresRuntimePairing: boolean
  registrationRecords: TRegistrationRecord[]
  registrationEnvelope?: TPersistenceEnvelope
  permissionGrantProposals: TPermissionGrantProposal[]
  intentPreviews: TIntentPreview[]
  runtimePairingRequest?: TRuntimePairingRequest
  manifestReviewRequest?: TManifestReviewRequest
  blockedReasons: string[]
  summary: string
}

export interface ControlPlaneActionApplicationResult<
  TApplication extends ControlPlaneActionApplication = ControlPlaneActionApplication,
> {
  ok: boolean
  application?: TApplication
  errorCode?: ControlPlaneApplicationErrorCode
  message?: string
  blockedReasons: string[]
}

export interface AndroidControlPlaneActionPolicyConfiguration<
  TSnapshot extends ControlPlaneSnapshot,
  TManifest extends AdmittedToolManifest,
  TActionRequest extends ControlPlaneActionRequest,
  TRegistrationRecord extends object,
  TPersistenceEnvelope extends object,
  TPermissionGrantProposal extends ControlPlanePermissionGrantProposal,
  TIntentPreview extends object,
  TRuntimePairingRequest extends ControlPlaneRuntimePairingRequest,
  TManifestReviewRequest extends ControlPlaneManifestReviewRequest,
  TActionApplication extends ControlPlaneActionApplication,
  TApplicationResult extends ControlPlaneActionApplicationResult<TActionApplication>,
  TActionSchema extends string,
  TSnapshotSchema extends string,
  TActionApplicationSchema extends string,
  TRegistrationRecordSchema extends string,
  TPersistenceSchema extends string,
  TIntentPreviewSchema extends string,
> {
  actionKinds: readonly ControlPlaneInstallActionKind[]
  confirmationPermissions: readonly ControlPlanePermission[]
  limits: { entries: number; keys: number }
  schemas: {
    action: TActionSchema
    snapshot: TSnapshotSchema
    application: TActionApplicationSchema
    registrationRecord: TRegistrationRecordSchema
    persistence: TPersistenceSchema
    intentPreview: TIntentPreviewSchema
    protocol: string
  }
  createApplicationId(actionId: string, appliedAt: number): string
  stableIdentityString(input: unknown): string
  inferRequiredCapabilities(manifest: TManifest): readonly ControlPlaneRuntimeCapability[]
  validateManifest(input: unknown): { sanitized: TManifest; errors: string[] }
  sanitizeStableIdList(input: unknown, limit: number): string[]
  sanitizeDependencyKeyList(input: unknown): string[]
  sanitizePublicText(input: unknown, fallback?: string): string | undefined
  sanitizeReasonList(input: readonly string[] | undefined): string[]
  uniquePermissions(input: readonly ControlPlanePermission[]): ControlPlanePermission[]
}

export function createAndroidControlPlaneActionPolicy<
  TSnapshot extends ControlPlaneSnapshot,
  TManifest extends AdmittedToolManifest,
  TActionRequest extends ControlPlaneActionRequest,
  TRegistrationRecord extends object,
  TPersistenceEnvelope extends object,
  TPermissionGrantProposal extends ControlPlanePermissionGrantProposal,
  TIntentPreview extends object,
  TRuntimePairingRequest extends ControlPlaneRuntimePairingRequest,
  TManifestReviewRequest extends ControlPlaneManifestReviewRequest,
  TActionApplication extends ControlPlaneActionApplication,
  TApplicationResult extends ControlPlaneActionApplicationResult<TActionApplication>,
  TActionSchema extends string,
  TSnapshotSchema extends string,
  TActionApplicationSchema extends string,
  TRegistrationRecordSchema extends string,
  TPersistenceSchema extends string,
  TIntentPreviewSchema extends string,
>(
  config: AndroidControlPlaneActionPolicyConfiguration<
    TSnapshot,
    TManifest,
    TActionRequest,
    TRegistrationRecord,
    TPersistenceEnvelope,
    TPermissionGrantProposal,
    TIntentPreview,
    TRuntimePairingRequest,
    TManifestReviewRequest,
    TActionApplication,
    TApplicationResult,
    TActionSchema,
    TSnapshotSchema,
    TActionApplicationSchema,
    TRegistrationRecordSchema,
    TPersistenceSchema,
    TIntentPreviewSchema
  >,
) {
  function selectControlPlaneActionToolCards(
    snapshot: TSnapshot,
    actionKind: ControlPlaneInstallActionKind,
    toolId: string | undefined,
    runtimeId: string | undefined,
  ): ControlPlaneToolCard[] {
    return snapshot.toolCards.filter((card) => {
      if (!card.actionKinds.includes(actionKind)) return false
      if (toolId && card.id !== toolId) return false
      if (runtimeId && card.runtimeId !== runtimeId) return false
      return true
    }).slice(0, config.limits.entries)
  }

  function routeForControlPlaneAction(actionKind: ControlPlaneInstallActionKind): ControlPlaneActionRoute {
    switch (actionKind) {
      case 'register-app-action':
      case 'register-runtime-tool': return 'registry-registration'
      case 'pair-runtime': return 'runtime-pairing'
      case 'grant-permission': return 'permission-grant'
      case 'confirm-intent': return 'intent-preview'
      case 'fix-manifest': return 'manifest-review'
    }
  }

  function permissionsForControlPlaneAction(
    actionKind: ControlPlaneInstallActionKind,
    cards: readonly ControlPlaneToolCard[],
  ): ControlPlanePermission[] {
    const permissions = actionKind === 'grant-permission'
      ? cards.flatMap((card) => card.missingPermissions)
      : actionKind === 'confirm-intent'
        ? cards.flatMap((card) => card.permissions.filter((permission) => config.confirmationPermissions.includes(permission)))
        : []
    return config.uniquePermissions(permissions).slice(0, config.limits.keys)
  }

  function suggestedTaskStatusForControlPlaneAction(actionKind: ControlPlaneInstallActionKind): ControlPlaneSuggestedTaskStatus | undefined {
    if (actionKind === 'grant-permission') return 'waiting_for_permission'
    if (actionKind === 'confirm-intent') return 'waiting_for_user'
    return undefined
  }

  function buildControlPlaneActionSummary(actionKind: ControlPlaneInstallActionKind, toolCount: number, runtimeCount: number): string {
    switch (actionKind) {
      case 'register-app-action': return `Register ${toolCount} Android app-action tool(s).`
      case 'register-runtime-tool': return `Register ${toolCount} runtime-backed tool(s) across ${runtimeCount} runtime target(s).`
      case 'pair-runtime': return `Pair or update runtime support for ${toolCount} tool(s).`
      case 'grant-permission': return `Grant scoped permissions for ${toolCount} tool(s).`
      case 'confirm-intent': return `Review intent preview for ${toolCount} high-risk tool(s).`
      case 'fix-manifest': return `Fix manifest issues for ${toolCount} blocked tool(s).`
    }
  }

  function createControlPlaneActionFailure(
    errorCode: ControlPlaneActionErrorCode,
    message: string,
  ): ControlPlaneActionRequestCreation<TActionRequest> {
    return { ok: false, errorCode, message }
  }

  function createControlPlaneActionApplication(input: {
    action: TActionRequest
    now: number
    status: ControlPlaneActionApplicationStatus
    registrationRecords?: TRegistrationRecord[]
    registrationEnvelope?: TPersistenceEnvelope
    permissionGrantProposals?: TPermissionGrantProposal[]
    intentPreviews?: TIntentPreview[]
    runtimePairingRequest?: TRuntimePairingRequest
    manifestReviewRequest?: TManifestReviewRequest
    blockedReasons?: string[]
    summary: string
  }): TApplicationResult {
    const action = input.action
    const blockedReasons = config.sanitizeReasonList(input.blockedReasons)
    const application = {
      schema: config.schemas.application,
      actionSchema: config.schemas.action,
      registrationRecordSchema: config.schemas.registrationRecord,
      registeredCatalogPersistenceSchema: config.schemas.persistence,
      intentPreviewSchema: config.schemas.intentPreview,
      protocolSchema: config.schemas.protocol,
      appliedAt: input.now,
      applicationId: config.createApplicationId(action.actionId, input.now),
      actionId: action.actionId,
      actionKind: action.actionKind,
      route: action.route,
      status: input.status,
      projectId: action.projectId,
      toolIds: config.sanitizeStableIdList(action.toolIds, config.limits.entries),
      runtimeIds: config.sanitizeStableIdList(action.runtimeIds, config.limits.entries),
      permissions: config.uniquePermissions(action.permissions).slice(0, config.limits.keys),
      dependencies: config.sanitizeDependencyKeyList(action.dependencies),
      nextActionKinds: nextActionKindsForControlPlaneApplication(input.status, action.actionKind),
      suggestedTaskStatus: action.suggestedTaskStatus,
      requiresUserInteraction: action.requiresUserInteraction || input.status === 'needs_user',
      requiresRuntimePairing: action.requiresRuntimePairing || input.status === 'needs_runtime',
      registrationRecords: (input.registrationRecords ?? []).slice(0, config.limits.entries),
      registrationEnvelope: input.registrationEnvelope,
      permissionGrantProposals: (input.permissionGrantProposals ?? []).slice(0, config.limits.keys),
      intentPreviews: (input.intentPreviews ?? []).slice(0, config.limits.entries),
      runtimePairingRequest: input.runtimePairingRequest,
      manifestReviewRequest: input.manifestReviewRequest,
      blockedReasons,
      summary: config.sanitizePublicText(input.summary, 'Control-plane action summary is unavailable.') ?? 'Control-plane action summary is unavailable.',
    } as unknown as TActionApplication
    return { ok: true, application, blockedReasons } as TApplicationResult
  }

  function createControlPlaneActionApplicationFailure(
    errorCode: ControlPlaneApplicationErrorCode,
    message: string,
    blockedReasons: string[],
  ): TApplicationResult {
    return {
      ok: false,
      errorCode,
      message,
      blockedReasons: config.sanitizeReasonList(blockedReasons),
    } as TApplicationResult
  }

  function nextActionKindsForControlPlaneApplication(
    status: ControlPlaneActionApplicationStatus,
    actionKind: ControlPlaneInstallActionKind,
  ): ControlPlaneInstallActionKind[] {
    if (status === 'applied') return []
    if (status === 'needs_user') return [actionKind]
    if (status === 'needs_runtime') return ['pair-runtime']
    return actionKind === 'fix-manifest' ? ['fix-manifest'] : []
  }

  function createPermissionGrantProposals(action: TActionRequest): TPermissionGrantProposal[] {
    return config.uniquePermissions(action.permissions)
      .slice(0, config.limits.keys)
      .map((permission) => {
        const scopeKinds = permissionGrantScopeKinds(permission)
        return {
          permission,
          runtimeId: action.runtimeIds[0],
          projectId: action.projectId,
          toolIds: config.sanitizeStableIdList(action.toolIds, config.limits.entries),
          requiresScope: scopeKinds.length > 0,
          scopeKinds,
        } as TPermissionGrantProposal
      })
  }

  function permissionGrantScopeKinds(permission: ControlPlanePermission): ControlPlanePermissionScopeKind[] {
    if (permission === 'files.read' || permission === 'files.write') return ['paths']
    if (permission === 'network.local' || permission === 'network.remote') return ['networkHosts']
    return []
  }

  function createRuntimePairingRequest(
    action: TActionRequest,
    manifests: readonly TManifest[],
    runtimes: readonly ControlPlaneRuntimeSnapshot[],
  ): TRuntimePairingRequest {
    const selectedRuntimes = action.runtimeIds
      .map((runtimeId) => runtimes.find((runtime) => runtime.id === runtimeId))
      .filter((runtime): runtime is ControlPlaneRuntimeSnapshot => Boolean(runtime))
    const capabilityKeys = new Set<ControlPlaneRuntimeCapability>()
    for (const manifest of manifests) {
      for (const capability of config.inferRequiredCapabilities(manifest)) {
        if (!selectedRuntimes.length || selectedRuntimes.some((runtime) => !runtime.capabilities.includes(capability))) {
          capabilityKeys.add(capability)
        }
      }
    }
    return {
      toolIds: config.sanitizeStableIdList(action.toolIds, config.limits.entries),
      runtimeIds: config.sanitizeStableIdList(action.runtimeIds, config.limits.entries),
      dependencyKeys: config.sanitizeDependencyKeyList(action.dependencies),
      capabilityKeys: Array.from(capabilityKeys).slice(0, config.limits.keys),
      requiresRuntimePairing: true,
    } as TRuntimePairingRequest
  }

  function createManifestReviewRequest(action: TActionRequest, manifests: readonly TManifest[]): TManifestReviewRequest {
    const blockedReasons = config.sanitizeReasonList(manifests.flatMap((manifest) => config.validateManifest(manifest).errors))
    return {
      toolIds: config.sanitizeStableIdList(action.toolIds, config.limits.entries),
      issueCount: blockedReasons.length,
      blockedReasons,
    } as TManifestReviewRequest
  }

  function normalizeControlPlaneActionManifests(
    manifests: readonly TManifest[],
    toolIds: readonly string[],
  ): { targetManifests: TManifest[]; missingToolIds: string[] } {
    const targetManifests: TManifest[] = []
    const missingToolIds: string[] = []
    for (const toolId of toolIds.slice(0, config.limits.entries)) {
      const manifest = manifests.find((candidate) => config.validateManifest(candidate).sanitized.id === toolId)
      if (manifest) targetManifests.push(config.validateManifest(manifest).sanitized)
      else missingToolIds.push(toolId)
    }
    return { targetManifests, missingToolIds }
  }

  function controlPlaneActionRouteMatchesKind(action: {
    actionKind: ControlPlaneInstallActionKind
    route: ControlPlaneActionRoute
  }): boolean {
    return config.actionKinds.includes(action.actionKind) && action.route === routeForControlPlaneAction(action.actionKind)
  }

  function controlPlaneActionNextKindsMatch(
    status: ControlPlaneActionApplicationStatus,
    actionKind: ControlPlaneInstallActionKind,
    nextActionKinds: readonly ControlPlaneInstallActionKind[],
  ): boolean {
    return config.stableIdentityString(nextActionKindsForControlPlaneApplication(status, actionKind)) === config.stableIdentityString(nextActionKinds)
  }

  return {
    selectControlPlaneActionToolCards,
    routeForControlPlaneAction,
    permissionsForControlPlaneAction,
    suggestedTaskStatusForControlPlaneAction,
    buildControlPlaneActionSummary,
    createControlPlaneActionFailure,
    createControlPlaneActionApplication,
    createControlPlaneActionApplicationFailure,
    nextActionKindsForControlPlaneApplication,
    createPermissionGrantProposals,
    permissionGrantScopeKinds,
    createRuntimePairingRequest,
    createManifestReviewRequest,
    normalizeControlPlaneActionManifests,
    controlPlaneActionRouteMatchesKind,
    controlPlaneActionNextKindsMatch,
  }
}
