type DynamicRecord = Record<string, any>

export interface AndroidControlPlaneGatewaySessionInput {
  sessionId: string
  taskId: string
  toolId: string
  runtimeId: string
  runtimeKind: string
  status: string
  ready: boolean
  androidCanConnect: boolean
  transport: string
  usesStreamableHttp: boolean
  endpoint?: { origin?: string; path?: string; localNetwork?: boolean }
  updatedAt: number
  expiresAt?: number
  toolCount?: number
}

export interface AndroidControlPlanePairingAcceptanceInput {
  acceptanceId: string
  handshakeId?: string
  status: string
  runtimeId?: string
  runtimeKind?: string
  runtimeName?: string
  projectId?: string
  acceptedAt: number
  online: boolean
  transportCount: number
  capabilityCount: number
  dependencyKeys: string[]
  requestedToolIds: string[]
  requestedCapabilityKeys: string[]
  requestedDependencyKeys: string[]
  missingCapabilities: string[]
  missingDependencies: string[]
  blockedReasons: string[]
  errorCode?: string
  runtimeCanExecute: boolean
  usesStreamableHttp: boolean
}

export interface AndroidControlPlaneSnapshotPolicyDependencies<
  TBuildInput extends object,
  TSnapshot extends object,
  TRuntime extends object,
  TRegisteredLaunch extends { createdAt: number; taskId: string },
  TGatewaySession extends AndroidControlPlaneGatewaySessionInput,
  TPairingAcceptance extends AndroidControlPlanePairingAcceptanceInput,
> {
  schemas: {
    snapshot: string
    taskCancelRequest: string
    pairingAcceptance: string
    runtimeProtocol: string
  }
  limits: { cards: number; eventKeys: number }
  installActionKinds: readonly string[]
  registryBuildInputKeys: readonly string[]
  sanitizeTimestamp(input: unknown): number | undefined
  sanitizeMetadata(input: unknown): string | undefined
  createDefaultRuntimes(now: number): TRuntime[]
  createTrustedRuntimes(runtimes: readonly TRuntime[]): TRuntime[]
  buildInstallPlan(input: DynamicRecord): DynamicRecord
  buildRegisteredCatalogSnapshot(input: DynamicRecord): DynamicRecord
  buildRegistrySnapshot(input: DynamicRecord): DynamicRecord
  buildDoctorReport(input: DynamicRecord): DynamicRecord
  sanitizeTasks(input: unknown, now: number, runtimes: TRuntime[]): DynamicRecord[]
  createTaskCancelCounts(tasks: readonly DynamicRecord[]): DynamicRecord
  createRegisteredLaunchCounts(cards: readonly DynamicRecord[]): DynamicRecord
  createPairingAcceptanceCounts(cards: readonly DynamicRecord[]): DynamicRecord
  buildSummary(input: any): string
  buildActionBadges(actions: readonly DynamicRecord[]): DynamicRecord[]
  buildRuntimeBadges(runtimes: readonly TRuntime[]): DynamicRecord[]
  isTrustedRegisteredLaunch(input: unknown): boolean
  buildRegisteredLaunchEvent(launch: TRegisteredLaunch): DynamicRecord
  createRegisteredLaunchId(launch: TRegisteredLaunch): string
  isTrustedGatewaySession(input: unknown): boolean
  isTrustedPairingAcceptance(input: unknown): boolean
}

const OPERATIONAL_INPUT_KEYS = [
  'activeTasks',
  'registrationRecords',
  'registeredLaunches',
  'gatewaySessions',
  'pairingAcceptances',
] as const

export function createAndroidControlPlaneSnapshotPolicy<
  TBuildInput extends object,
  TSnapshot extends object,
  TRuntime extends object,
  TRegisteredLaunch extends { createdAt: number; taskId: string },
  TGatewaySession extends AndroidControlPlaneGatewaySessionInput,
  TPairingAcceptance extends AndroidControlPlanePairingAcceptanceInput,
>(dependencies: AndroidControlPlaneSnapshotPolicyDependencies<
  TBuildInput,
  TSnapshot,
  TRuntime,
  TRegisteredLaunch,
  TGatewaySession,
  TPairingAcceptance
>) {
  const buildInputKeys = [...dependencies.registryBuildInputKeys, ...OPERATIONAL_INPUT_KEYS] as const

  function buildSnapshot(input: TBuildInput = {} as TBuildInput): TSnapshot {
    const inputRecord = asRecord(input)
    if (!inputRecord || !hasOnlyAllowedKeys(inputRecord, buildInputKeys)) {
      return buildSnapshot({
        manifests: [],
        runtimes: [],
        now: dependencies.sanitizeTimestamp(inputRecord?.now) ?? Date.now(),
      } as TBuildInput)
    }
    const now = dependencies.sanitizeTimestamp(inputRecord.now) ?? Date.now()
    const runtimes = dependencies.createTrustedRuntimes(
      (inputRecord.runtimes as TRuntime[] | undefined) ?? dependencies.createDefaultRuntimes(now)
    )
    const trustedRuntimes = dependencies.createTrustedRuntimes(runtimes)
    const sharedInput = {
      manifests: inputRecord.manifests,
      skills: inputRecord.skills,
      mcpServers: inputRecord.mcpServers,
      runtimes: trustedRuntimes,
      permissionGrants: inputRecord.permissionGrants,
      requestedScopesByToolId: inputRecord.requestedScopesByToolId,
      source: inputRecord.source,
      projectId: inputRecord.projectId,
      now,
      runtimePreference: inputRecord.runtimePreference,
    }
    const installPlan = dependencies.buildInstallPlan(sharedInput)
    const registeredCatalog = dependencies.buildRegisteredCatalogSnapshot({
      records: inputRecord.registrationRecords,
      runtimes: trustedRuntimes,
      now,
    })
    const registry = dependencies.buildRegistrySnapshot(sharedInput)
    const doctor = dependencies.buildDoctorReport(sharedInput)
    const registryById = new Map(
      asArray(registry.entries).map((entry) => [entry.id as string, entry])
    )
    const activeTasks = dependencies.sanitizeTasks(inputRecord.activeTasks, now, trustedRuntimes)
    const taskCancelCounts = dependencies.createTaskCancelCounts(activeTasks)
    const registeredLaunchCards = sanitizeRegisteredLaunches(inputRecord.registeredLaunches as TRegisteredLaunch[] | undefined)
    const registeredLaunchCounts = dependencies.createRegisteredLaunchCounts(registeredLaunchCards)
    const gatewayCards = sanitizeGatewaySessions(inputRecord.gatewaySessions as TGatewaySession[] | undefined, now)
    const pairingAcceptanceCards = sanitizePairingAcceptances(inputRecord.pairingAcceptances as TPairingAcceptance[] | undefined)
    const pairingAcceptanceCounts = dependencies.createPairingAcceptanceCounts(pairingAcceptanceCards)
    const installCounts = asRecord(installPlan.counts) ?? {}
    const registeredCounts = asRecord(registeredCatalog.counts) ?? {}
    const registryCounts = asRecord(registry.counts) ?? {}
    const doctorStatus = typeof doctor.status === 'string' ? doctor.status : 'blocked'
    return {
      schema: dependencies.schemas.snapshot,
      generatedAt: now,
      projectId: dependencies.sanitizeMetadata(inputRecord.projectId),
      installPlanSchema: installPlan.schema,
      taskCancelRequestSchema: dependencies.schemas.taskCancelRequest,
      runtimePairingAcceptanceSchema: dependencies.schemas.pairingAcceptance,
      registeredCatalogSchema: registeredCatalog.schema,
      registrySchema: registry.schema,
      doctorSchema: doctor.schema,
      protocolSchema: dependencies.schemas.runtimeProtocol,
      summary: dependencies.buildSummary({
        installCounts,
        registeredReadyCount: typeof registeredCounts.ready === 'number' ? registeredCounts.ready : 0,
        doctorStatus,
        activeTasks,
        registeredLaunchCards,
        gatewayCards,
        pairingAcceptanceCards,
        runtimes: trustedRuntimes,
      }),
      installCounts,
      registeredCounts,
      registryCounts,
      doctorStatus,
      actionBadges: dependencies.buildActionBadges(asArray(installPlan.actions)),
      runtimeBadges: dependencies.buildRuntimeBadges(trustedRuntimes),
      toolCards: asArray(installPlan.tools).slice(0, dependencies.limits.cards).map((tool) => {
        const registryEntry = registryById.get(tool.id as string)
        return {
          id: tool.id,
          title: tool.title,
          kind: tool.kind,
          status: tool.status,
          registryStatus: registryEntry?.status ?? 'invalid',
          androidDisposition: tool.androidDisposition,
          runtimeId: tool.runtimeId,
          runtimeKind: tool.runtimeKind,
          actionKinds: uniqueAllowed(
            asArray(tool.actions).map((action) => action.kind),
            dependencies.installActionKinds
          ),
          permissions: tool.permissions,
          missingPermissions: tool.missingPermissions,
          missingDependencies: tool.missingDependencies,
          requiresUserConfirmation: tool.requiresUserConfirmation,
        }
      }),
      registeredToolCards: asArray(registeredCatalog.entries).slice(0, dependencies.limits.cards).map((entry) => ({
        registrationId: entry.registrationId,
        toolId: entry.toolId,
        title: entry.title,
        kind: entry.kind,
        registrationKind: entry.registrationKind,
        status: entry.status,
        runtimeId: entry.runtimeId,
        runtimeKind: entry.runtimeKind,
        androidDisposition: entry.androidDisposition,
        registeredAt: entry.registeredAt,
        permissionCount: asArray(entry.permissions).length,
        requiredCapabilityCount: asArray(entry.requiredCapabilities).length,
        transportCount: asArray(entry.transports).length,
        blockedReasons: entry.blockedReasons,
      })),
      registeredLaunchCards,
      taskCards: activeTasks,
      gatewayCards,
      pairingAcceptanceCards,
      pairingAcceptanceCounts,
      taskCancelCounts,
      registeredLaunchCounts,
    } as unknown as TSnapshot
  }

  function sanitizeRegisteredLaunches(launches: TRegisteredLaunch[] | undefined): DynamicRecord[] {
    return (launches ?? [])
      .filter((launch) => dependencies.isTrustedRegisteredLaunch(launch))
      .sort((left, right) => right.createdAt - left.createdAt || left.taskId.localeCompare(right.taskId))
      .slice(0, dependencies.limits.cards)
      .map((launch) => {
        const eventData = dependencies.buildRegisteredLaunchEvent(launch)
        return {
          launchId: dependencies.createRegisteredLaunchId(launch),
          registrationId: eventData.registrationId,
          toolId: eventData.toolId,
          taskId: eventData.taskId,
          runtimeId: eventData.runtimeId,
          runtimeKind: eventData.runtimeKind,
          entryType: eventData.entryType,
          entryExecutor: eventData.entryExecutor,
          mcpToolName: eventData.mcpToolName,
          createdAt: eventData.generatedAt,
          status: eventData.status,
          handoffDelivery: eventData.handoffDelivery,
          hasRuntimePairingAcceptance: eventData.hasRuntimePairingAcceptance,
          confirmedIntent: eventData.confirmedIntent,
          payloadKeyCount: eventData.payloadKeyCount,
          permissionCount: eventData.permissionCount,
          dispatchRequiresPairedRuntime: eventData.dispatchRequiresPairedRuntime,
          dispatchUsesNetworkTransport: eventData.dispatchUsesNetworkTransport,
          dispatchUsesStreamableHttp: eventData.dispatchUsesStreamableHttp,
          androidCanExecute: eventData.androidCanExecute,
        }
      })
  }

  function sanitizeGatewaySessions(sessions: TGatewaySession[] | undefined, now: number): DynamicRecord[] {
    return (sessions ?? [])
      .filter((session) => dependencies.isTrustedGatewaySession(session))
      .slice(0, dependencies.limits.cards)
      .map((session) => {
        const expired = session.expiresAt !== undefined && session.expiresAt <= now && session.status !== 'closed'
        const status = expired ? 'expired' : session.status
        const ready = status === 'ready' && session.ready
        const endpoint = asRecord(session.endpoint)
        return {
          sessionId: session.sessionId,
          taskId: session.taskId,
          toolId: session.toolId,
          runtimeId: session.runtimeId,
          runtimeKind: session.runtimeKind,
          status,
          ready,
          androidCanConnect: ready && session.androidCanConnect,
          androidCanHost: false,
          transport: session.transport,
          usesStreamableHttp: session.usesStreamableHttp,
          endpointOrigin: endpoint?.origin,
          endpointPath: endpoint?.path,
          endpointLocalNetwork: endpoint?.localNetwork ?? false,
          updatedAt: session.updatedAt,
          expiresAt: session.expiresAt,
          toolCount: session.toolCount,
        }
      })
  }

  function sanitizePairingAcceptances(acceptances: TPairingAcceptance[] | undefined): DynamicRecord[] {
    return (acceptances ?? [])
      .filter((acceptance) => dependencies.isTrustedPairingAcceptance(acceptance))
      .slice(0, dependencies.limits.cards)
      .map((acceptance) => ({
        acceptanceId: acceptance.acceptanceId,
        handshakeId: acceptance.handshakeId,
        status: acceptance.status,
        runtimeId: acceptance.runtimeId,
        runtimeKind: acceptance.runtimeKind,
        runtimeName: acceptance.runtimeName,
        projectId: acceptance.projectId,
        acceptedAt: acceptance.acceptedAt,
        online: acceptance.online,
        transportCount: acceptance.transportCount,
        capabilityCount: acceptance.capabilityCount,
        dependencyKeyCount: asArray(acceptance.dependencyKeys).length,
        requestedToolCount: asArray(acceptance.requestedToolIds).length,
        requestedCapabilityCount: asArray(acceptance.requestedCapabilityKeys).length,
        requestedDependencyCount: asArray(acceptance.requestedDependencyKeys).length,
        missingCapabilities: asArray(acceptance.missingCapabilities).slice(0, dependencies.limits.eventKeys),
        missingDependencies: asArray(acceptance.missingDependencies).slice(0, dependencies.limits.eventKeys),
        blockedReasonCount: asArray(acceptance.blockedReasons).length,
        errorCode: acceptance.errorCode,
        androidCanExecute: false,
        runtimeCanExecute: acceptance.runtimeCanExecute,
        usesStreamableHttp: acceptance.usesStreamableHttp,
      }))
  }

  return Object.freeze({ buildInputKeys, buildSnapshot, sanitizeRegisteredLaunches, sanitizeGatewaySessions, sanitizePairingAcceptances })
}

function hasOnlyAllowedKeys(input: DynamicRecord, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys)
  return Object.keys(input).every((key) => allowed.has(key))
}
function asRecord(input: unknown): DynamicRecord | undefined {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as DynamicRecord : undefined
}
function asArray(input: unknown): DynamicRecord[] { return Array.isArray(input) ? input as DynamicRecord[] : [] }
function uniqueAllowed(input: unknown[], allowed: readonly string[]): string[] {
  return Array.from(new Set(input.filter((item): item is string => typeof item === 'string' && allowed.includes(item))))
}
