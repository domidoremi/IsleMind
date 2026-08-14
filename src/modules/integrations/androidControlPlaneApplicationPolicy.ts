import type {
  ControlPlaneActionApplicationResult,
  ControlPlaneActionApplicationStatus,
  ControlPlaneActionRequest,
  ControlPlaneApplicationErrorCode,
  ControlPlaneManifestReviewRequest,
  ControlPlanePermissionGrantProposal,
  ControlPlaneRuntimePairingRequest,
} from './androidControlPlaneActionPolicy'
import { resolveToolchainCliCommandSpecForManifest } from './cliCommandCatalog'
import type {
  ExecutionAndroidDisposition,
  ExecutionPermissionGrant,
  ExecutionResolution,
  ExecutionRuntimeSnapshot,
} from './executionResolutionPolicy'
import type { ToolScopeRequest } from './scopePolicy'
import {
  type AdmittedRuntimeKind,
  type AdmittedToolManifest,
  validateToolchainManifest,
} from './toolchainManifestAdmission'

export type AndroidControlPlaneRegistrationErrorCode =
  | 'invalid_manifest'
  | 'action_unavailable'
  | 'tool_mismatch'
  | 'runtime_required'
  | 'runtime_unavailable'
  | 'android_execution_blocked'
  | 'operation_mismatch'

export interface AndroidControlPlaneIntentPreview {
  status: 'waiting_for_user' | 'not_required' | 'not_available'
  unavailableReasons: string[]
}

export interface AndroidControlPlaneRegistrationCreation<TRecord extends object> {
  ok: boolean
  record?: TRecord
  errorCode?: AndroidControlPlaneRegistrationErrorCode
  message?: string
  blockedReasons: string[]
}

export interface AndroidControlPlaneApplicationInput<
  TAction extends ControlPlaneActionRequest,
  TSkill,
  TMcpServer,
  TRuntime extends ExecutionRuntimeSnapshot,
  TRecord extends object,
> {
  actionRequest: TAction
  manifests?: AdmittedToolManifest[]
  skills?: readonly TSkill[]
  mcpServers?: readonly TMcpServer[]
  runtimes?: TRuntime[]
  existingRegistrationRecords?: TRecord[]
  permissionGrants?: ExecutionPermissionGrant[]
  requestedScopesByToolId?: Record<string, ToolScopeRequest>
  payloadsByToolId?: Record<string, Record<string, unknown>>
  runtimePreference?: AdmittedRuntimeKind[]
  now?: number
}

export interface AndroidControlPlaneRegistrationInput<
  TAction extends ControlPlaneActionRequest,
  TRuntime extends ExecutionRuntimeSnapshot,
> {
  manifest: AdmittedToolManifest
  actionRequest: TAction
  runtime?: TRuntime
  now?: number
}

export interface AndroidControlPlaneApplicationPolicyDependencies<
  TAction extends ControlPlaneActionRequest,
  TSkill,
  TMcpServer,
  TRuntime extends ExecutionRuntimeSnapshot,
  TRecord extends object,
  TPersistenceEnvelope extends object,
  TPermissionProposal extends ControlPlanePermissionGrantProposal,
  TIntentPreview extends AndroidControlPlaneIntentPreview,
  TRuntimePairingRequest extends ControlPlaneRuntimePairingRequest,
  TManifestReviewRequest extends ControlPlaneManifestReviewRequest,
  TApplicationResult extends ControlPlaneActionApplicationResult,
> {
  schemas: {
    action: string
    controlPlane: string
    runtimeProtocol: string
  }
  limits: {
    eventEntries: number
    eventKeys: number
  }
  actionPolicy: {
    buildControlPlaneActionSummary(actionKind: TAction['actionKind'], toolCount: number, runtimeCount: number): string
    controlPlaneActionRouteMatchesKind(action: TAction): boolean
    createControlPlaneActionApplication(input: {
      action: TAction
      now: number
      status: ControlPlaneActionApplicationStatus
      registrationRecords?: TRecord[]
      registrationEnvelope?: TPersistenceEnvelope
      permissionGrantProposals?: TPermissionProposal[]
      intentPreviews?: TIntentPreview[]
      runtimePairingRequest?: TRuntimePairingRequest
      manifestReviewRequest?: TManifestReviewRequest
      blockedReasons?: string[]
      summary: string
    }): TApplicationResult
    createControlPlaneActionApplicationFailure(
      errorCode: ControlPlaneApplicationErrorCode,
      message: string,
      blockedReasons: string[],
    ): TApplicationResult
    createManifestReviewRequest(action: TAction, manifests: readonly AdmittedToolManifest[]): TManifestReviewRequest
    createPermissionGrantProposals(action: TAction): TPermissionProposal[]
    createRuntimePairingRequest(
      action: TAction,
      manifests: readonly AdmittedToolManifest[],
      runtimes: readonly TRuntime[],
    ): TRuntimePairingRequest
    normalizeControlPlaneActionManifests(
      manifests: readonly AdmittedToolManifest[],
      toolIds: readonly string[],
    ): { targetManifests: AdmittedToolManifest[]; missingToolIds: string[] }
    routeForControlPlaneAction(actionKind: TAction['actionKind']): TAction['route']
    suggestedTaskStatusForControlPlaneAction(actionKind: TAction['actionKind']): TAction['suggestedTaskStatus']
  }
  createBuildManifests(input: {
    manifests?: AdmittedToolManifest[]
    skills?: readonly TSkill[]
    mcpServers?: readonly TMcpServer[]
  }): AdmittedToolManifest[]
  resolveExecution(input: {
    manifest: AdmittedToolManifest
    runtimes: TRuntime[]
    permissionGrants?: ExecutionPermissionGrant[]
    runtimePreference?: AdmittedRuntimeKind[]
    projectId?: string
    requestedScopes?: ToolScopeRequest
    now?: number
  }): ExecutionResolution
  resolveAndroidDisposition(manifest: AdmittedToolManifest, runtimes: TRuntime[]): ExecutionAndroidDisposition
  createIntentPreview(input: {
    manifest: AdmittedToolManifest
    resolution: ExecutionResolution
    payload?: Record<string, unknown>
    now?: number
  }): TIntentPreview
  createPersistenceEnvelope(input: {
    records?: TRecord[]
    source?: string
    projectId?: string
    now?: number
    recordLimit?: number
  }): TPersistenceEnvelope
  createRegistrationRecord(input: {
    manifest: AdmittedToolManifest
    actionRequest: TAction
    registrationKind: 'app-action' | 'runtime-tool'
    runtime?: TRuntime
    androidDisposition: ExecutionAndroidDisposition
    now: number
  }): TRecord
  createRegistrationFailure(
    errorCode: AndroidControlPlaneRegistrationErrorCode,
    message: string,
    blockedReasons: string[],
  ): AndroidControlPlaneRegistrationCreation<TRecord>
  createDefaultRuntimes(now: number): TRuntime[]
  createTrustedRuntimes(runtimes: readonly TRuntime[]): TRuntime[]
  isTrustedRuntime(runtime: unknown): runtime is TRuntime
  createActionId(actionKind: TAction['actionKind'], toolIds: string[], runtimeIds: string[], generatedAt: number): string
  isInstallActionKind(input: unknown): input is TAction['actionKind']
  isControlPlaneActionRoute(input: unknown): input is TAction['route']
  isTrustedStableIdList(input: unknown, limit: number): input is string[]
  isTrustedPermissionList(input: unknown): boolean
  isTrustedDependencyList(input: unknown, limit: number): input is string[]
  sanitizeStableId(input: unknown): string | undefined
  sanitizeMetadata(input: unknown): string | undefined
  runtimeAvailabilityReasons(runtime: TRuntime): string[]
  runtimeHandoffBlockedReasons(manifest: AdmittedToolManifest, runtime: TRuntime): string[]
  sanitizeTimestamp(input: unknown): number | undefined
}

const APPLICATION_INPUT_KEYS = [
  'actionRequest',
  'manifests',
  'skills',
  'mcpServers',
  'runtimes',
  'existingRegistrationRecords',
  'permissionGrants',
  'requestedScopesByToolId',
  'payloadsByToolId',
  'runtimePreference',
  'now',
] as const

const REGISTRATION_INPUT_KEYS = ['manifest', 'actionRequest', 'runtime', 'now'] as const

export function createAndroidControlPlaneApplicationPolicy<
  TAction extends ControlPlaneActionRequest,
  TSkill,
  TMcpServer,
  TRuntime extends ExecutionRuntimeSnapshot,
  TRecord extends object,
  TPersistenceEnvelope extends object,
  TPermissionProposal extends ControlPlanePermissionGrantProposal,
  TIntentPreview extends AndroidControlPlaneIntentPreview,
  TRuntimePairingRequest extends ControlPlaneRuntimePairingRequest,
  TManifestReviewRequest extends ControlPlaneManifestReviewRequest,
  TApplicationResult extends ControlPlaneActionApplicationResult,
>(dependencies: AndroidControlPlaneApplicationPolicyDependencies<
  TAction,
  TSkill,
  TMcpServer,
  TRuntime,
  TRecord,
  TPersistenceEnvelope,
  TPermissionProposal,
  TIntentPreview,
  TRuntimePairingRequest,
  TManifestReviewRequest,
  TApplicationResult
>) {
  type ApplicationInput = AndroidControlPlaneApplicationInput<TAction, TSkill, TMcpServer, TRuntime, TRecord>
  type RegistrationInput = AndroidControlPlaneRegistrationInput<TAction, TRuntime>
  type RegistrationCreation = AndroidControlPlaneRegistrationCreation<TRecord>

  function applyControlPlaneAction(input: ApplicationInput): TApplicationResult {
    const inputRecord = asRecord(input)
    if (!inputRecord || !hasOnlyAllowedKeys(inputRecord, APPLICATION_INPUT_KEYS)) {
      return dependencies.actionPolicy.createControlPlaneActionApplicationFailure(
        'operation_mismatch',
        'Control-plane action application input contains unsupported metadata.',
        []
      )
    }
    if (!asRecord(input.actionRequest)) {
      return dependencies.actionPolicy.createControlPlaneActionApplicationFailure(
        'schema_mismatch',
        'Control-plane action request schema is incompatible.',
        []
      )
    }
    const action = input.actionRequest
    const now = dependencies.sanitizeTimestamp(input.now) ?? Date.now()
    if (action.schema !== dependencies.schemas.action || action.controlPlaneSchema !== dependencies.schemas.controlPlane) {
      return dependencies.actionPolicy.createControlPlaneActionApplicationFailure(
        'schema_mismatch',
        'Control-plane action request schema is incompatible.',
        []
      )
    }
    if (!dependencies.actionPolicy.controlPlaneActionRouteMatchesKind(action)) {
      return dependencies.actionPolicy.createControlPlaneActionApplicationFailure(
        'action_unavailable',
        'Control-plane action request route does not match the action kind.',
        []
      )
    }
    if (!isTrustedActionRequest(action)) {
      return dependencies.actionPolicy.createControlPlaneActionApplicationFailure(
        'action_unavailable',
        'Control-plane action request identity is not trusted.',
        []
      )
    }
    const manifests = dependencies.createBuildManifests(input)
    const runtimes = dependencies.createTrustedRuntimes(
      input.runtimes ?? dependencies.createDefaultRuntimes(now)
    )
    const { targetManifests, missingToolIds } = dependencies.actionPolicy.normalizeControlPlaneActionManifests(
      manifests,
      action.toolIds
    )
    if (missingToolIds.length || targetManifests.length === 0) {
      return dependencies.actionPolicy.createControlPlaneActionApplicationFailure(
        'tool_unavailable',
        'Control-plane action targets unavailable tool manifests.',
        missingToolIds.map((toolId) => `${toolId} is unavailable.`)
      )
    }
    if (action.actionKind === 'register-app-action' || action.actionKind === 'register-runtime-tool') {
      const records: TRecord[] = []
      const blockedReasons: string[] = []
      for (const manifest of targetManifests) {
        const runtime = action.actionKind === 'register-app-action'
          ? runtimes.find((candidate) => candidate.id === 'android-app' || candidate.kind === 'android-app')
          : runtimes.find((candidate) => action.runtimeIds.includes(candidate.id))
        const result = createRegistrationRecord({ manifest, actionRequest: action, runtime, now })
        if (result.ok && result.record) records.push(result.record)
        else blockedReasons.push(...(
          result.blockedReasons.length
            ? result.blockedReasons
            : [result.message ?? 'Registration action could not be applied.']
        ))
      }
      const registrationEnvelope = records.length
        ? dependencies.createPersistenceEnvelope({
            records: [...(input.existingRegistrationRecords ?? []), ...records],
            projectId: action.projectId,
            source: 'control-plane-action-application',
            now,
          })
        : undefined
      return dependencies.actionPolicy.createControlPlaneActionApplication({
        action,
        now,
        status: blockedReasons.length ? 'blocked' : 'applied',
        registrationRecords: records,
        registrationEnvelope,
        blockedReasons,
        summary: blockedReasons.length
          ? `Registration action produced ${records.length} record(s) and ${blockedReasons.length} blocked reason(s).`
          : `Registered ${records.length} tool(s).`,
      })
    }
    if (action.actionKind === 'grant-permission') {
      const proposals = dependencies.actionPolicy.createPermissionGrantProposals(action)
      return dependencies.actionPolicy.createControlPlaneActionApplication({
        action,
        now,
        status: 'needs_user',
        permissionGrantProposals: proposals,
        summary: `Prepared ${proposals.length} permission grant proposal(s) for visible approval.`,
      })
    }
    if (action.actionKind === 'confirm-intent') {
      const intentPreviews = targetManifests.map((manifest) => {
        const resolution = dependencies.resolveExecution({
          manifest,
          runtimes,
          permissionGrants: input.permissionGrants,
          runtimePreference: input.runtimePreference,
          requestedScopes: input.requestedScopesByToolId?.[manifest.id],
          projectId: action.projectId,
          now,
        })
        return dependencies.createIntentPreview({
          manifest,
          resolution,
          payload: input.payloadsByToolId?.[manifest.id],
          now,
        })
      })
      const blockedReasons = uniqueCleanList(intentPreviews.flatMap((preview) => preview.unavailableReasons))
      return dependencies.actionPolicy.createControlPlaneActionApplication({
        action,
        now,
        status: intentPreviews.some((preview) => preview.status === 'waiting_for_user')
          ? 'needs_user'
          : blockedReasons.length
            ? 'blocked'
            : 'applied',
        intentPreviews,
        blockedReasons,
        summary: `Prepared ${intentPreviews.length} intent preview(s) for control-plane review.`,
      })
    }
    if (action.actionKind === 'pair-runtime') {
      return dependencies.actionPolicy.createControlPlaneActionApplication({
        action,
        now,
        status: 'needs_runtime',
        runtimePairingRequest: dependencies.actionPolicy.createRuntimePairingRequest(action, targetManifests, runtimes),
        summary: `Prepared runtime pairing guidance for ${targetManifests.length} tool(s).`,
      })
    }
    return dependencies.actionPolicy.createControlPlaneActionApplication({
      action,
      now,
      status: 'needs_user',
      manifestReviewRequest: dependencies.actionPolicy.createManifestReviewRequest(action, targetManifests),
      summary: `Prepared manifest review for ${targetManifests.length} tool(s).`,
    })
  }

  function createRegistrationRecord(input: RegistrationInput): RegistrationCreation {
    const inputRecord = asRecord(input)
    if (!inputRecord || !hasOnlyAllowedKeys(inputRecord, REGISTRATION_INPUT_KEYS)) {
      return dependencies.createRegistrationFailure(
        'operation_mismatch',
        'Registration record input contains unsupported metadata.',
        []
      )
    }
    const now = dependencies.sanitizeTimestamp(input.now) ?? Date.now()
    const validation = validateToolchainManifest(input.manifest)
    if (!validation.ok) {
      return dependencies.createRegistrationFailure(
        'invalid_manifest',
        'Tool manifest must be valid before registration.',
        validation.errors
      )
    }
    const manifest = validation.sanitized
    if (!asRecord(input.actionRequest)) {
      return dependencies.createRegistrationFailure(
        'action_unavailable',
        'Only registry-registration action requests can create registration records.',
        []
      )
    }
    const request = input.actionRequest
    if (request.schema !== dependencies.schemas.action || request.route !== 'registry-registration') {
      return dependencies.createRegistrationFailure(
        'action_unavailable',
        'Only registry-registration action requests can create registration records.',
        []
      )
    }
    if (request.actionKind !== 'register-app-action' && request.actionKind !== 'register-runtime-tool') {
      return dependencies.createRegistrationFailure(
        'action_unavailable',
        'Only registration action requests can create registration records.',
        []
      )
    }
    if (!isTrustedActionRequest(request)) {
      return dependencies.createRegistrationFailure(
        'action_unavailable',
        'Control-plane action request identity is not trusted for registration.',
        []
      )
    }
    if (!request.toolIds.includes(manifest.id)) {
      return dependencies.createRegistrationFailure(
        'tool_mismatch',
        'Registration action request does not target this tool manifest.',
        []
      )
    }
    if (input.runtime && !dependencies.isTrustedRuntime(input.runtime)) {
      return dependencies.createRegistrationFailure(
        'runtime_unavailable',
        'Runtime identity is not trusted for registration.',
        []
      )
    }
    if (request.actionKind === 'register-app-action') {
      if (manifest.entry.type !== 'app-action') {
        return dependencies.createRegistrationFailure(
          'android_execution_blocked',
          'Only app-action manifests can register as Android app actions.',
          []
        )
      }
      if (input.runtime && input.runtime.kind !== 'android-app') {
        return dependencies.createRegistrationFailure(
          'runtime_unavailable',
          'Android app-action registration must target the Android app runtime.',
          []
        )
      }
      const runtime = input.runtime
      if (runtime && (!runtime.online || runtime.protocolSchema !== dependencies.schemas.runtimeProtocol)) {
        return dependencies.createRegistrationFailure(
          'runtime_unavailable',
          'Android app runtime must be online and protocol-ready before registration.',
          dependencies.runtimeAvailabilityReasons(runtime)
        )
      }
      return {
        ok: true,
        record: dependencies.createRegistrationRecord({
          manifest,
          actionRequest: request,
          registrationKind: 'app-action',
          runtime,
          androidDisposition: 'app-only',
          now,
        }),
        blockedReasons: [],
      }
    }
    const runtime = input.runtime
    if (!runtime) {
      return dependencies.createRegistrationFailure(
        'runtime_required',
        'Runtime-backed tool registration requires a selected runtime.',
        []
      )
    }
    if (!request.runtimeIds.includes(runtime.id)) {
      return dependencies.createRegistrationFailure(
        'runtime_unavailable',
        'Registration action request does not target this runtime.',
        []
      )
    }
    if (runtime.kind === 'android-app' && manifest.entry.type !== 'app-action') {
      return dependencies.createRegistrationFailure(
        'android_execution_blocked',
        'Android App cannot register CLI, skill, workflow, or MCP gateway tools as direct app actions.',
        []
      )
    }
    if (!runtime.online || runtime.protocolSchema !== dependencies.schemas.runtimeProtocol) {
      return dependencies.createRegistrationFailure(
        'runtime_unavailable',
        'Runtime must be online and protocol-ready before registration.',
        dependencies.runtimeAvailabilityReasons(runtime)
      )
    }
    const blockedReasons = dependencies.runtimeHandoffBlockedReasons(manifest, runtime)
    if (blockedReasons.length) {
      return dependencies.createRegistrationFailure(
        'runtime_unavailable',
        'Selected runtime does not satisfy the tool manifest registration contract.',
        blockedReasons
      )
    }
    if ((manifest.entry.executor === 'cli' || manifest.entry.type === 'cli') && !resolveToolchainCliCommandSpecForManifest(manifest)) {
      return dependencies.createRegistrationFailure(
        'invalid_manifest',
        'CLI command reference is not available to the runtime adapter catalog.',
        ['Fix the manifest command reference before creating a registration record.']
      )
    }
    return {
      ok: true,
      record: dependencies.createRegistrationRecord({
        manifest,
        actionRequest: request,
        registrationKind: 'runtime-tool',
        runtime,
        androidDisposition: dependencies.resolveAndroidDisposition(manifest, [runtime]),
        now,
      }),
      blockedReasons: [],
    }
  }

  function isTrustedActionRequest(input: unknown): input is TAction {
    const request = asRecord(input)
    if (!request ||
      !hasOnlyAllowedKeys(request, [
        'schema', 'controlPlaneSchema', 'generatedAt', 'actionId', 'actionKind', 'route', 'projectId',
        'toolIds', 'runtimeIds', 'permissions', 'dependencies', 'requiresUserInteraction',
        'requiresRuntimePairing', 'suggestedTaskStatus', 'summary',
      ]) ||
      request.schema !== dependencies.schemas.action ||
      request.controlPlaneSchema !== dependencies.schemas.controlPlane ||
      typeof request.generatedAt !== 'number' || !Number.isFinite(request.generatedAt) ||
      dependencies.sanitizeStableId(request.actionId) !== request.actionId ||
      !dependencies.isInstallActionKind(request.actionKind) ||
      !dependencies.isControlPlaneActionRoute(request.route) ||
      !Array.isArray(request.toolIds) || !Array.isArray(request.runtimeIds) ||
      request.route !== dependencies.actionPolicy.routeForControlPlaneAction(request.actionKind) ||
      request.actionId !== dependencies.createActionId(
        request.actionKind,
        request.toolIds as string[],
        request.runtimeIds as string[],
        request.generatedAt,
      ) ||
      request.requiresUserInteraction !== true ||
      request.requiresRuntimePairing !== (
        request.actionKind === 'pair-runtime' || request.actionKind === 'register-runtime-tool'
      ) ||
      request.suggestedTaskStatus !== dependencies.actionPolicy.suggestedTaskStatusForControlPlaneAction(request.actionKind) ||
      request.summary !== dependencies.actionPolicy.buildControlPlaneActionSummary(
        request.actionKind,
        request.toolIds.length,
        request.runtimeIds.length,
      )) return false
    if (request.projectId !== undefined && dependencies.sanitizeMetadata(request.projectId) !== request.projectId) return false
    return dependencies.isTrustedStableIdList(request.toolIds, dependencies.limits.eventEntries) &&
      request.toolIds.length > 0 &&
      dependencies.isTrustedStableIdList(request.runtimeIds, dependencies.limits.eventEntries) &&
      dependencies.isTrustedPermissionList(request.permissions) &&
      dependencies.isTrustedDependencyList(request.dependencies, dependencies.limits.eventKeys)
  }

  return Object.freeze({ applyControlPlaneAction, createRegistrationRecord, isTrustedActionRequest })
}

function uniqueCleanList(input: readonly string[] | undefined): string[] {
  return Array.from(new Set((input ?? []).map(cleanText).filter(Boolean)))
}

function cleanText(input: unknown): string {
  return typeof input === 'string' ? input.trim().slice(0, 420) : ''
}

function hasOnlyAllowedKeys(input: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys)
  return Object.keys(input).every((key) => allowed.has(key))
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : undefined
}
