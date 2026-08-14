import {
  type ExecutionPermissionGrant,
  type ExecutionResolution,
  type ExecutionResolutionInput,
  type ExecutionRuntimeSnapshot,
  type createExecutionResolutionPolicy,
} from './executionResolutionPolicy'
import {
  type InstallPlanAction,
  type InstallPlanCounts,
  type InstallPlanTool,
  type createInstallPlanPolicy,
} from './installPlanPolicy'
import { resolveToolchainCliCommandSpecForManifest } from './cliCommandCatalog'
import { type ToolScopeRequest } from './scopePolicy'
import {
  type AdmittedRuntimeKind,
  type AdmittedToolManifest,
  validateToolchainManifest,
} from './toolchainManifestAdmission'
import {
  type ToolchainDoctorFinding,
  type ToolchainDoctorRuntimeCounts,
  type createToolchainDoctorPolicy,
} from './toolchainDoctorPolicy'
import type {
  TOOLCHAIN_DOCTOR_SCHEMA,
  TOOLCHAIN_INSTALL_PLAN_SCHEMA,
  TOOLCHAIN_MANIFEST_SCHEMA,
  TOOLCHAIN_REGISTRY_SCHEMA,
  ToolchainDoctorStatus,
} from './toolchainContracts'
import type { TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA } from './toolchainRuntimeTrust'

type ExecutionPolicy = ReturnType<typeof createExecutionResolutionPolicy>
type InstallPolicy = ReturnType<typeof createInstallPlanPolicy>
type DoctorPolicy = ReturnType<typeof createToolchainDoctorPolicy>

export interface ToolchainRegistryPolicyBuildInput<
  TSkill,
  TMcpServer,
  TRuntime extends ExecutionRuntimeSnapshot,
> {
  manifests?: AdmittedToolManifest[]
  skills?: readonly TSkill[]
  mcpServers?: readonly TMcpServer[]
  runtimes?: TRuntime[]
  permissionGrants?: ExecutionPermissionGrant[]
  requestedScopesByToolId?: Record<string, ToolScopeRequest>
  source?: string
  projectId?: string
  now?: number
  runtimePreference?: AdmittedRuntimeKind[]
}

export interface ToolchainRegistryPolicyExecutionInput<TRuntime extends ExecutionRuntimeSnapshot>
  extends Omit<ExecutionResolutionInput, 'runtimes'> {
  runtimes: TRuntime[]
}

export interface ToolchainRegistrySnapshot<
  TRegistrySchema extends string = typeof TOOLCHAIN_REGISTRY_SCHEMA,
  TManifestSchema extends string = typeof TOOLCHAIN_MANIFEST_SCHEMA,
  TProtocolSchema extends string = typeof TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA,
> {
  schema: TRegistrySchema
  manifestSchema: TManifestSchema
  protocolSchema: TProtocolSchema
  generatedAt: number
  counts: {
    total: number
    valid: number
    invalid: number
    ready: number
    needsPermission: number
    waitingForUser: number
    unsupported: number
  }
  entries: Array<{
    id: string
    title: string
    kind: AdmittedToolManifest['kind']
    status: ExecutionResolution['status']
    androidDisposition: ExecutionResolution['androidDisposition']
    runtimeId?: string
    runtimeKind?: AdmittedRuntimeKind
    missingPermissions: ExecutionResolution['missingPermissions']
    missingCapabilities: ExecutionResolution['missingCapabilities']
    missingDependencies: string[]
    requiresUserConfirmation: boolean
  }>
}

export interface ToolchainInstallPlan<
  TInstallPlanSchema extends string = typeof TOOLCHAIN_INSTALL_PLAN_SCHEMA,
  TManifestSchema extends string = typeof TOOLCHAIN_MANIFEST_SCHEMA,
  TRegistrySchema extends string = typeof TOOLCHAIN_REGISTRY_SCHEMA,
  TProtocolSchema extends string = typeof TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA,
> {
  schema: TInstallPlanSchema
  manifestSchema: TManifestSchema
  registrySchema: TRegistrySchema
  protocolSchema: TProtocolSchema
  generatedAt: number
  source: string
  summary: string
  counts: InstallPlanCounts
  tools: InstallPlanTool[]
  actions: InstallPlanAction[]
}

export interface ToolchainDoctorReport<
  TDoctorSchema extends string = typeof TOOLCHAIN_DOCTOR_SCHEMA,
  TRegistrySchema extends string = typeof TOOLCHAIN_REGISTRY_SCHEMA,
  TProtocolSchema extends string = typeof TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA,
> {
  schema: TDoctorSchema
  registrySchema: TRegistrySchema
  protocolSchema: TProtocolSchema
  generatedAt: number
  status: ToolchainDoctorStatus
  summary: string
  counts: ToolchainRegistrySnapshot<TRegistrySchema, string, TProtocolSchema>['counts']
  runtimeCounts: ToolchainDoctorRuntimeCounts
  findings: ToolchainDoctorFinding[]
  recommendedActions: Array<{
    id: string
    kind: ToolchainDoctorFinding['action']
    severity: ToolchainDoctorFinding['severity']
    label: string
    toolIds: string[]
  }>
}

export interface ToolchainRegistryPolicyDependencies<
  TSkill,
  TMcpServer,
  TRuntime extends ExecutionRuntimeSnapshot,
  TRegistrySchema extends string,
  TManifestSchema extends string,
  TProtocolSchema extends string,
  TInstallPlanSchema extends string,
  TDoctorSchema extends string,
> {
  schemas: {
    registry: TRegistrySchema
    manifest: TManifestSchema
    protocol: TProtocolSchema
    installPlan: TInstallPlanSchema
    doctor: TDoctorSchema
  }
  limits: {
    registryEntries: number
    eventEntries: number
    eventKeys: number
  }
  officialTools: AdmittedToolManifest[]
  executionPolicy: Pick<ExecutionPolicy,
    'createResolution' | 'evaluateRuntimeCandidate' | 'orderRuntimes' |
    'resolveAndroidDisposition' | 'selectBestUnsupportedCandidate'>
  installPolicy: Pick<InstallPolicy,
    'buildInstallPlanSummary' | 'createInstallPlanAction' | 'createInstallPlanTool' |
    'dedupeInstallPlanActions' | 'installActionsForResolution' | 'installStatusFromResolution'>
  doctorPolicy: Pick<DoctorPolicy,
    'buildDoctorSummary' | 'countRuntimesByKind' | 'createDoctorFinding' |
    'hasOnlineExecutionRuntime' | 'resolveDoctorStatus'>
  createEmptyInstallPlanCounts(): InstallPlanCounts
  createSkillManifests(skills: readonly TSkill[]): AdmittedToolManifest[]
  createMcpManifests(servers: readonly TMcpServer[]): AdmittedToolManifest[]
  createDefaultRuntimes(now: number): TRuntime[]
  createTrustedRuntimes(runtimes: readonly TRuntime[]): TRuntime[]
  sanitizeTimestamp(input: unknown): number | undefined
  sanitizeMetadataToken(input: unknown): string | undefined
  sanitizeDependencyKeys(input: unknown): string[]
}

const TOOLCHAIN_EXECUTION_INPUT_KEYS = [
  'manifest',
  'runtimes',
  'permissionGrants',
  'runtimePreference',
  'projectId',
  'requestedScopes',
  'now',
] as const

const TOOLCHAIN_REGISTRY_BUILD_INPUT_KEYS = [
  'manifests',
  'skills',
  'mcpServers',
  'runtimes',
  'permissionGrants',
  'requestedScopesByToolId',
  'source',
  'projectId',
  'now',
  'runtimePreference',
] as const

export function createToolchainRegistryPolicy<
  TSkill,
  TMcpServer,
  TRuntime extends ExecutionRuntimeSnapshot,
  const TRegistrySchema extends string,
  const TManifestSchema extends string,
  const TProtocolSchema extends string,
  const TInstallPlanSchema extends string,
  const TDoctorSchema extends string,
>(dependencies: ToolchainRegistryPolicyDependencies<
  TSkill,
  TMcpServer,
  TRuntime,
  TRegistrySchema,
  TManifestSchema,
  TProtocolSchema,
  TInstallPlanSchema,
  TDoctorSchema
>) {
  type BuildInput = ToolchainRegistryPolicyBuildInput<TSkill, TMcpServer, TRuntime>
  type ExecutionInput = ToolchainRegistryPolicyExecutionInput<TRuntime>
  type RegistrySnapshot = ToolchainRegistrySnapshot<TRegistrySchema, TManifestSchema, TProtocolSchema>
  type InstallPlan = ToolchainInstallPlan<TInstallPlanSchema, TManifestSchema, TRegistrySchema, TProtocolSchema>
  type DoctorReport = ToolchainDoctorReport<TDoctorSchema, TRegistrySchema, TProtocolSchema>

  function createBuildManifests(input: BuildInput): AdmittedToolManifest[] {
    const manifests = input.manifests ?? dependencies.officialTools
    const skillManifests = dependencies.createSkillManifests(input.skills ?? [])
    const mcpManifests = dependencies.createMcpManifests(input.mcpServers ?? [])
    return skillManifests.length || mcpManifests.length
      ? [...manifests, ...skillManifests, ...mcpManifests]
      : manifests
  }

  function resolveExecution(input: ExecutionInput): ExecutionResolution {
    const inputRecord = asRecord(input)
    if (!inputRecord || !hasOnlyAllowedKeys(inputRecord, TOOLCHAIN_EXECUTION_INPUT_KEYS)) {
      return dependencies.executionPolicy.createResolution({
        status: 'invalid',
        manifestId: 'tool-execution-unverified',
        androidDisposition: 'unavailable',
        blockedReasons: ['Toolchain execution input contains unsupported metadata.'],
      })
    }
    const validation = validateToolchainManifest(input.manifest)
    const runtimes = dependencies.createTrustedRuntimes(input.runtimes)
    const trustedInput: ExecutionResolutionInput = { ...input, runtimes }
    if (!validation.ok) {
      return dependencies.executionPolicy.createResolution({
        status: 'invalid',
        manifestId: validation.sanitized.id,
        androidDisposition: 'unavailable',
        blockedReasons: validation.errors,
      })
    }
    const manifest = validation.sanitized
    if ((manifest.entry.executor === 'cli' || manifest.entry.type === 'cli') && !resolveToolchainCliCommandSpecForManifest(manifest)) {
      return dependencies.executionPolicy.createResolution({
        status: 'invalid',
        manifestId: manifest.id,
        androidDisposition: dependencies.executionPolicy.resolveAndroidDisposition(manifest, runtimes),
        blockedReasons: ['CLI command reference is not available to this runtime adapter catalog.'],
      })
    }
    const candidates = dependencies.executionPolicy.orderRuntimes(runtimes, input.runtimePreference)
      .map((runtime) => dependencies.executionPolicy.evaluateRuntimeCandidate(manifest, runtime, trustedInput))
    const ready = candidates.find((candidate) => candidate.status === 'ready')
    if (ready) return ready
    const waitingForUser = candidates.find((candidate) => candidate.status === 'waiting_for_user')
    if (waitingForUser) return waitingForUser
    const needsPermission = candidates.find((candidate) => candidate.status === 'needs_permission')
    if (needsPermission) return needsPermission
    const unsupported = dependencies.executionPolicy.selectBestUnsupportedCandidate(candidates)
    return unsupported ?? dependencies.executionPolicy.createResolution({
      status: 'unsupported',
      manifestId: manifest.id,
      androidDisposition: dependencies.executionPolicy.resolveAndroidDisposition(manifest, runtimes),
      blockedReasons: ['No runtime is available.'],
    })
  }

  function buildInstallPlan(input: BuildInput = {}): InstallPlan {
    const inputRecord = asRecord(input)
    if (!inputRecord || !hasOnlyAllowedKeys(inputRecord, TOOLCHAIN_REGISTRY_BUILD_INPUT_KEYS)) {
      return buildInstallPlan({
        manifests: [],
        runtimes: [],
        now: dependencies.sanitizeTimestamp(inputRecord?.now) ?? Date.now(),
      })
    }
    const manifests = createBuildManifests(input)
    const generatedAt = dependencies.sanitizeTimestamp(input.now) ?? Date.now()
    const runtimes = dependencies.createTrustedRuntimes(
      input.runtimes ?? dependencies.createDefaultRuntimes(generatedAt)
    )
    const tools = manifests.slice(0, dependencies.limits.registryEntries).map((manifest) => {
      const validation = validateToolchainManifest(manifest)
      if (!validation.ok) {
        return dependencies.installPolicy.createInstallPlanTool({
          manifest: validation.sanitized,
          status: 'blocked',
          androidDisposition: 'unavailable',
          blockedReasons: validation.errors,
          actions: [dependencies.installPolicy.createInstallPlanAction({
            kind: 'fix-manifest',
            label: 'Fix manifest before registration',
            toolIds: [validation.sanitized.id],
            required: true,
          })],
        })
      }
      const resolution = resolveExecution({
        manifest: validation.sanitized,
        runtimes,
        permissionGrants: input.permissionGrants,
        now: generatedAt,
        runtimePreference: input.runtimePreference,
        requestedScopes: input.requestedScopesByToolId?.[validation.sanitized.id],
        projectId: input.projectId,
      })
      const status = dependencies.installPolicy.installStatusFromResolution(resolution)
      const appActionRegistration = validation.sanitized.entry.type === 'app-action' && resolution.runtimeKind === 'android-app'
      const registrationAction = dependencies.installPolicy.createInstallPlanAction({
        kind: appActionRegistration ? 'register-app-action' : 'register-runtime-tool',
        label: appActionRegistration ? 'Register Android app action' : 'Register runtime-backed tool',
        toolIds: [validation.sanitized.id],
        runtimeIds: resolution.runtimeId ? [resolution.runtimeId] : [],
        required: status === 'installable',
      })
      return dependencies.installPolicy.createInstallPlanTool({
        manifest: validation.sanitized,
        status,
        androidDisposition: resolution.androidDisposition,
        runtimeId: resolution.runtimeId,
        runtimeKind: resolution.runtimeKind,
        missingPermissions: resolution.missingPermissions,
        missingCapabilities: resolution.missingCapabilities,
        missingDependencies: resolution.missingDependencies,
        requiresUserConfirmation: resolution.requiresUserConfirmation,
        blockedReasons: resolution.blockedReasons,
        actions: [
          ...(status === 'installable' ? [registrationAction] : []),
          ...dependencies.installPolicy.installActionsForResolution(validation.sanitized, resolution),
        ],
      })
    })
    const counts = dependencies.createEmptyInstallPlanCounts()
    counts.total = tools.length
    for (const tool of tools) counts[tool.status] += 1
    const actions = dependencies.installPolicy.dedupeInstallPlanActions(tools.flatMap((tool) => tool.actions))
    return {
      schema: dependencies.schemas.installPlan,
      manifestSchema: dependencies.schemas.manifest,
      registrySchema: dependencies.schemas.registry,
      protocolSchema: dependencies.schemas.protocol,
      generatedAt,
      source: dependencies.sanitizeMetadataToken(input.source) ?? 'toolchain-registry',
      summary: dependencies.installPolicy.buildInstallPlanSummary(counts),
      counts,
      tools,
      actions,
    }
  }

  function buildRegistrySnapshot(input: BuildInput = {}): RegistrySnapshot {
    const inputRecord = asRecord(input)
    if (!inputRecord || !hasOnlyAllowedKeys(inputRecord, TOOLCHAIN_REGISTRY_BUILD_INPUT_KEYS)) {
      return buildRegistrySnapshot({
        manifests: [],
        runtimes: [],
        now: dependencies.sanitizeTimestamp(inputRecord?.now) ?? Date.now(),
      })
    }
    const manifests = createBuildManifests(input)
    const generatedAt = dependencies.sanitizeTimestamp(input.now) ?? Date.now()
    const runtimes = dependencies.createTrustedRuntimes(
      input.runtimes ?? dependencies.createDefaultRuntimes(generatedAt)
    )
    const entries = manifests.slice(0, dependencies.limits.registryEntries).map((manifest) => {
      const validation = validateToolchainManifest(manifest)
      const resolution = validation.ok
        ? resolveExecution({
            manifest: validation.sanitized,
            runtimes,
            permissionGrants: input.permissionGrants,
            now: generatedAt,
            runtimePreference: input.runtimePreference,
            requestedScopes: input.requestedScopesByToolId?.[validation.sanitized.id],
            projectId: input.projectId,
          })
        : dependencies.executionPolicy.createResolution({
            status: 'invalid',
            manifestId: validation.sanitized.id,
            androidDisposition: 'unavailable',
            blockedReasons: validation.errors,
          })
      return {
        id: validation.sanitized.id,
        title: validation.sanitized.title,
        kind: validation.sanitized.kind,
        status: resolution.status,
        androidDisposition: resolution.androidDisposition,
        runtimeId: resolution.runtimeId,
        runtimeKind: resolution.runtimeKind,
        missingPermissions: resolution.missingPermissions,
        missingCapabilities: resolution.missingCapabilities,
        missingDependencies: resolution.missingDependencies,
        requiresUserConfirmation: resolution.requiresUserConfirmation,
      }
    })
    const counts = {
      total: entries.length,
      valid: 0,
      invalid: 0,
      ready: 0,
      needsPermission: 0,
      waitingForUser: 0,
      unsupported: 0,
    }
    for (const entry of entries) {
      if (entry.status === 'invalid') counts.invalid += 1
      else counts.valid += 1
      if (entry.status === 'ready') counts.ready += 1
      else if (entry.status === 'needs_permission') counts.needsPermission += 1
      else if (entry.status === 'waiting_for_user') counts.waitingForUser += 1
      else if (entry.status === 'unsupported') counts.unsupported += 1
    }
    return {
      schema: dependencies.schemas.registry,
      manifestSchema: dependencies.schemas.manifest,
      protocolSchema: dependencies.schemas.protocol,
      generatedAt,
      counts,
      entries,
    }
  }

  function buildDoctorReport(input: BuildInput = {}): DoctorReport {
    const inputRecord = asRecord(input)
    if (!inputRecord || !hasOnlyAllowedKeys(inputRecord, TOOLCHAIN_REGISTRY_BUILD_INPUT_KEYS)) {
      return buildDoctorReport({
        manifests: [],
        runtimes: [],
        now: dependencies.sanitizeTimestamp(inputRecord?.now) ?? Date.now(),
      })
    }
    const now = dependencies.sanitizeTimestamp(input.now) ?? Date.now()
    const runtimes = dependencies.createTrustedRuntimes(
      input.runtimes ?? dependencies.createDefaultRuntimes(now)
    )
    const registry = buildRegistrySnapshot({ ...input, runtimes, now })
    const findings: ToolchainDoctorFinding[] = []
    const invalidEntries = registry.entries.filter((entry) => entry.status === 'invalid')
    if (invalidEntries.length) {
      findings.push(dependencies.doctorPolicy.createDoctorFinding({
        id: 'invalid-manifest',
        severity: 'error',
        title: 'Tool manifests need repair.',
        detail: `${invalidEntries.length} tool manifest(s) fail validation and cannot be shown as runnable tools.`,
        action: 'fix-manifest',
        toolIds: invalidEntries.map((entry) => entry.id),
      }))
    }
    const missingPermissionEntries = registry.entries.filter((entry) => entry.missingPermissions.length > 0)
    if (missingPermissionEntries.length) {
      findings.push(dependencies.doctorPolicy.createDoctorFinding({
        id: 'missing-permissions',
        severity: 'warning',
        title: 'Some tools need permission grants.',
        detail: `${missingPermissionEntries.length} tool(s) are waiting for user-scoped grants before runtime execution.`,
        action: 'grant-permission',
        toolIds: missingPermissionEntries.map((entry) => entry.id),
        permissions: topRegistryEntryKeys(
          registry.entries.map((entry) => entry.missingPermissions),
          dependencies.limits.eventKeys
        ),
      }))
    }
    const missingCapabilityEntries = registry.entries.filter((entry) => entry.missingCapabilities.length > 0)
    if (missingCapabilityEntries.length) {
      findings.push(dependencies.doctorPolicy.createDoctorFinding({
        id: 'missing-runtime-capabilities',
        severity: 'error',
        title: 'A runtime is missing required capabilities.',
        detail: `${missingCapabilityEntries.length} tool(s) require a different paired runtime or enabled runtime capability.`,
        action: 'pair-runtime',
        toolIds: missingCapabilityEntries.map((entry) => entry.id),
        capabilities: topRegistryEntryKeys(
          registry.entries.map((entry) => entry.missingCapabilities),
          dependencies.limits.eventKeys
        ),
      }))
    }
    const unsupportedEntries = registry.entries.filter((entry) => entry.status === 'unsupported' && entry.missingCapabilities.length === 0)
    if (unsupportedEntries.length) {
      const missingDependencies = dependencies.sanitizeDependencyKeys(
        unsupportedEntries.flatMap((entry) => entry.missingDependencies)
      )
      findings.push(dependencies.doctorPolicy.createDoctorFinding({
        id: 'unsupported-runtime',
        severity: 'error',
        title: 'Some tools have no usable runtime.',
        detail: missingDependencies.length
          ? `${unsupportedEntries.length} tool(s) need runtime dependency updates before they can run.`
          : `${unsupportedEntries.length} tool(s) need Termux, Desktop, or Remote Runtime capability before they can run.`,
        action: missingDependencies.length && dependencies.doctorPolicy.hasOnlineExecutionRuntime(runtimes)
          ? 'upgrade-dependency'
          : 'pair-runtime',
        toolIds: unsupportedEntries.map((entry) => entry.id),
        dependencies: missingDependencies,
      }))
    }
    const confirmationEntries = registry.entries.filter((entry) => entry.status === 'waiting_for_user')
    if (confirmationEntries.length) {
      findings.push(dependencies.doctorPolicy.createDoctorFinding({
        id: 'confirmation-required',
        severity: 'info',
        title: 'High-risk tools need visible confirmation.',
        detail: `${confirmationEntries.length} tool(s) are intentionally paused for an intent preview before writing files, using secrets, or changing Git/release state.`,
        action: 'confirm-intent',
        toolIds: confirmationEntries.map((entry) => entry.id),
      }))
    }
    const status = dependencies.doctorPolicy.resolveDoctorStatus(findings)
    return {
      schema: dependencies.schemas.doctor,
      registrySchema: registry.schema,
      protocolSchema: registry.protocolSchema,
      generatedAt: registry.generatedAt,
      status,
      summary: dependencies.doctorPolicy.buildDoctorSummary(status, registry),
      counts: registry.counts,
      runtimeCounts: dependencies.doctorPolicy.countRuntimesByKind(runtimes),
      findings,
      recommendedActions: findings.map((finding) => ({
        id: finding.id,
        kind: finding.action,
        severity: finding.severity,
        label: finding.title,
        toolIds: finding.toolIds.slice(0, dependencies.limits.eventEntries),
      })),
    }
  }

  return Object.freeze({
    registryBuildInputKeys: TOOLCHAIN_REGISTRY_BUILD_INPUT_KEYS,
    createBuildManifests,
    resolveExecution,
    buildInstallPlan,
    buildRegistrySnapshot,
    buildDoctorReport,
  })
}

function topRegistryEntryKeys<T extends string>(values: readonly (readonly T[])[], limit: number): T[] {
  const counts = new Map<T, number>()
  for (const items of values) {
    for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([key]) => key)
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
