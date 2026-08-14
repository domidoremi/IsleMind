type UnknownRecord = Record<string, any>

export type LifecycleEventAdmissionPolicyDependencies = {
  schemas: {
    registeredLaunch: string
    registeredExecutionPlan: string
    runtimePairingAcceptance: string
    runtimePairingHandshake: string
    taskRecord: string
    runtimeHandoff: string
    runtimeProtocol: string
    runtimeReport: string
    mcpGatewaySession: string
  }
  eventKeyLimit: number
  taskPayloadKeyLimit: number
  hasOnlyAllowedKeys(input: unknown, keys: readonly string[]): boolean
  sanitizeStableId(input: unknown): string | undefined
  sanitizeMetadataToken(input: unknown): string | undefined
  sanitizeOptionalNonNegativeNumber(input: unknown): number | undefined
  sanitizeTaskPayloadKeys(input: unknown): string[]
  sanitizeRuntimeDisplayText(input: unknown, fallback: string): string
  sanitizeRuntimeOptionalToken(input: unknown): string | undefined
  sanitizeRuntimeToolIds(input: unknown): string[]
  sanitizeRuntimeDependencyKeys(input: unknown): string[]
  sanitizeRuntimeDependencyMap(input: unknown): Record<string, string>
  sanitizeRuntimeCapabilities(input: unknown): string[]
  sanitizeRuntimeTransports(input: unknown): string[]
  stableIdentityString(input: unknown): string
  isUnsafePublicText(input: unknown): boolean
  isRuntimeKind(input: unknown): boolean
  isPairingAcceptanceStatus(input: unknown): boolean
  isPairingErrorCode(input: unknown): boolean
  isMcpGatewaySessionStatus(input: unknown): boolean
  isTrustedBlockedReasons(input: unknown): boolean
  isTrustedTask(input: unknown): boolean
  isTrustedRuntimeHandoff(input: unknown): boolean
  isTrustedRuntimeSnapshot(input: unknown): boolean
  isTrustedTaskLifecycleLogEntry(input: unknown, task: unknown): boolean
  isTrustedTaskLifecycleArtifact(input: unknown, task: unknown): boolean
  hasUniqueStrings(input: readonly string[]): boolean
  createRuntimePairingAcceptanceId(handshakeId: string | undefined, acceptedAt: number): string
  resolveMcpGatewayTransport(input: unknown): 'streamable-http' | 'http' | undefined
  sanitizeMcpGatewayServerName(input: unknown): string | undefined
  sanitizeMcpGatewayEndpoint(input: unknown, transport: 'streamable-http' | 'http'): UnknownRecord | undefined
}

const asRecord = (input: unknown): UnknownRecord | undefined =>
  input && typeof input === 'object' && !Array.isArray(input) ? input as UnknownRecord : undefined

export function createLifecycleEventAdmissionPolicy(dependencies: LifecycleEventAdmissionPolicyDependencies) {
  const same = (left: unknown, right: unknown) =>
    dependencies.stableIdentityString(left) === dependencies.stableIdentityString(right)

  function isTrustedTaskId(input: unknown): input is string {
    if (typeof input !== 'string') return false
    return dependencies.sanitizeStableId(input) === input &&
      !dependencies.isUnsafePublicText(input.replace(/^task-/i, ''))
  }

  function isTrustedTaskPayloadKeys(input: unknown): input is string[] {
    return Array.isArray(input) && input.length <= dependencies.taskPayloadKeyLimit &&
      dependencies.sanitizeTaskPayloadKeys(input).length === input.length &&
      same(dependencies.sanitizeTaskPayloadKeys(input), input)
  }

  function isTrustedRegisteredLaunch(input: unknown): boolean {
    const launch = asRecord(input)
    if (!launch || !dependencies.hasOnlyAllowedKeys(launch, [
      'schema', 'registeredExecutionPlanSchema', 'runtimePairingAcceptanceSchema', 'taskRecordSchema',
      'runtimeHandoffSchema', 'createdAt', 'registrationId', 'toolId', 'taskId', 'runtimeId',
      'runtimeKind', 'runtimePairingAcceptanceId', 'status', 'payloadKeys', 'confirmedIntent',
      'taskRecord', 'handoff',
    ]) || launch.schema !== dependencies.schemas.registeredLaunch ||
      launch.registeredExecutionPlanSchema !== dependencies.schemas.registeredExecutionPlan ||
      launch.runtimePairingAcceptanceSchema !== dependencies.schemas.runtimePairingAcceptance ||
      launch.taskRecordSchema !== dependencies.schemas.taskRecord ||
      launch.runtimeHandoffSchema !== dependencies.schemas.runtimeHandoff ||
      !Number.isFinite(launch.createdAt) ||
      dependencies.sanitizeStableId(launch.registrationId) !== launch.registrationId ||
      dependencies.sanitizeStableId(launch.toolId) !== launch.toolId || !isTrustedTaskId(launch.taskId) ||
      dependencies.sanitizeStableId(launch.runtimeId) !== launch.runtimeId ||
      !dependencies.isRuntimeKind(launch.runtimeKind) || launch.status !== 'queued' ||
      (launch.runtimePairingAcceptanceId !== undefined && dependencies.sanitizeStableId(launch.runtimePairingAcceptanceId) !== launch.runtimePairingAcceptanceId) ||
      typeof launch.confirmedIntent !== 'boolean' || !isTrustedTaskPayloadKeys(launch.payloadKeys) ||
      !dependencies.isTrustedTask(launch.taskRecord) || !dependencies.isTrustedRuntimeHandoff(launch.handoff)) return false

    const task = asRecord(launch.taskRecord)!
    const handoff = asRecord(launch.handoff)!
    if (task.taskId !== launch.taskId || task.toolId !== launch.toolId || task.runtimeId !== launch.runtimeId ||
      task.runtimeKind !== launch.runtimeKind || task.status !== 'queued' || task.createdAt !== launch.createdAt ||
      handoff.taskId !== launch.taskId || handoff.toolId !== launch.toolId || handoff.runtimeId !== launch.runtimeId ||
      handoff.runtimeKind !== launch.runtimeKind || handoff.createdAt !== launch.createdAt ||
      !same(launch.payloadKeys, task.payloadKeys) || !same(launch.payloadKeys, handoff.payloadKeys) ||
      launch.confirmedIntent !== Boolean(task.confirmedIntent) || launch.confirmedIntent !== Boolean(handoff.confirmedIntent)) return false
    if (handoff.dispatch.requiresPairedRuntime !== Boolean(launch.runtimePairingAcceptanceId)) return false
    if (handoff.dispatch.androidCanExecute) {
      return launch.runtimeKind === 'android-app' && handoff.delivery === 'android-app-action' &&
        launch.runtimePairingAcceptanceId === undefined
    }
    return launch.runtimeKind !== 'android-app' && handoff.delivery !== 'android-app-action'
  }

  function pairingHandshakeMatches(acceptance: UnknownRecord): boolean {
    if (!acceptance.handshakeId) return acceptance.runtimeId === undefined
    if (dependencies.sanitizeStableId(acceptance.handshakeId) !== acceptance.handshakeId) return false
    if (acceptance.runtimeId === undefined) return true
    const prefix = `runtime-pairing-handshake-${acceptance.runtimeId}-`
    if (!acceptance.handshakeId.startsWith(prefix)) return false
    const token = acceptance.handshakeId.slice(prefix.length)
    if (!/^[0-9a-z]+$/.test(token)) return false
    const generatedAt = Number.parseInt(token, 36)
    return Number.isFinite(generatedAt) && generatedAt <= acceptance.acceptedAt
  }

  function isTrustedAcceptedRuntime(runtimeInput: unknown, acceptance: UnknownRecord): boolean {
    const runtime = asRecord(runtimeInput)
    if (!runtime || !dependencies.isTrustedRuntimeSnapshot(runtime)) return false
    const runtimeDependencies = dependencies.sanitizeRuntimeDependencyMap(runtime.dependencies)
    const dependencyKeys = Object.keys(runtimeDependencies).sort().slice(0, dependencies.eventKeyLimit)
    return runtime.id === acceptance.runtimeId && runtime.name === acceptance.runtimeName &&
      runtime.kind === acceptance.runtimeKind && runtime.kind !== 'android-app' &&
      runtime.protocolSchema === dependencies.schemas.runtimeProtocol && runtime.online === true &&
      acceptance.online === true && Array.isArray(runtime.transports) &&
      dependencies.sanitizeRuntimeTransports(runtime.transports).length === runtime.transports.length &&
      Array.isArray(runtime.capabilities) && dependencies.sanitizeRuntimeCapabilities(runtime.capabilities).length === runtime.capabilities.length &&
      acceptance.transportCount === runtime.transports.length && acceptance.capabilityCount === runtime.capabilities.length &&
      acceptance.usesStreamableHttp === runtime.transports.includes('streamable-http') &&
      same(runtimeDependencies, runtime.dependencies ?? {}) && same(dependencyKeys, acceptance.dependencyKeys) &&
      runtime.pairedAt === acceptance.acceptedAt && runtime.lastSeenAt === acceptance.acceptedAt
  }

  function isTrustedRuntimePairingAcceptance(input: unknown): boolean {
    const acceptance = asRecord(input)
    if (!acceptance || !dependencies.hasOnlyAllowedKeys(acceptance, [
      'schema', 'handshakeSchema', 'protocolSchema', 'acceptedAt', 'acceptanceId', 'handshakeId',
      'status', 'runtime', 'runtimeId', 'runtimeKind', 'runtimeName', 'source', 'projectId', 'online',
      'transportCount', 'capabilityCount', 'dependencyKeys', 'requestedToolIds', 'requestedCapabilityKeys',
      'requestedDependencyKeys', 'missingCapabilities', 'missingDependencies', 'blockedReasons', 'errorCode',
      'androidCanExecute', 'runtimeCanExecute', 'usesStreamableHttp',
    ]) || acceptance.schema !== dependencies.schemas.runtimePairingAcceptance ||
      acceptance.handshakeSchema !== dependencies.schemas.runtimePairingHandshake ||
      acceptance.protocolSchema !== dependencies.schemas.runtimeProtocol || !Number.isFinite(acceptance.acceptedAt) ||
      dependencies.sanitizeStableId(acceptance.acceptanceId) !== acceptance.acceptanceId ||
      acceptance.acceptanceId !== dependencies.createRuntimePairingAcceptanceId(acceptance.handshakeId, acceptance.acceptedAt) ||
      (acceptance.handshakeId !== undefined && dependencies.sanitizeStableId(acceptance.handshakeId) !== acceptance.handshakeId) ||
      !dependencies.isPairingAcceptanceStatus(acceptance.status) || acceptance.androidCanExecute !== false ||
      acceptance.runtimeCanExecute !== (acceptance.status === 'accepted') ||
      typeof acceptance.usesStreamableHttp !== 'boolean' || typeof acceptance.online !== 'boolean' ||
      !Number.isInteger(acceptance.transportCount) || acceptance.transportCount < 0 ||
      !Number.isInteger(acceptance.capabilityCount) || acceptance.capabilityCount < 0) return false
    if (acceptance.runtimeId !== undefined && dependencies.sanitizeStableId(acceptance.runtimeId) !== acceptance.runtimeId) return false
    if (acceptance.runtimeKind !== undefined && !dependencies.isRuntimeKind(acceptance.runtimeKind)) return false
    if (acceptance.runtimeName !== undefined && dependencies.sanitizeRuntimeDisplayText(acceptance.runtimeName, '') !== acceptance.runtimeName) return false
    if (acceptance.source !== undefined && dependencies.sanitizeRuntimeOptionalToken(acceptance.source) !== acceptance.source) return false
    if (acceptance.projectId !== undefined && dependencies.sanitizeRuntimeOptionalToken(acceptance.projectId) !== acceptance.projectId) return false
    if (!same(dependencies.sanitizeRuntimeToolIds(acceptance.requestedToolIds), acceptance.requestedToolIds) ||
      !same(dependencies.sanitizeRuntimeDependencyKeys(acceptance.dependencyKeys), acceptance.dependencyKeys) ||
      !same(dependencies.sanitizeRuntimeDependencyKeys(acceptance.requestedDependencyKeys), acceptance.requestedDependencyKeys) ||
      !same(dependencies.sanitizeRuntimeDependencyKeys(acceptance.missingDependencies), acceptance.missingDependencies)) return false
    if (!Array.isArray(acceptance.requestedCapabilityKeys) ||
      dependencies.sanitizeRuntimeCapabilities(acceptance.requestedCapabilityKeys).length !== acceptance.requestedCapabilityKeys.length ||
      !Array.isArray(acceptance.missingCapabilities) ||
      dependencies.sanitizeRuntimeCapabilities(acceptance.missingCapabilities).length !== acceptance.missingCapabilities.length ||
      !dependencies.isTrustedBlockedReasons(acceptance.blockedReasons)) return false
    if (acceptance.status === 'accepted') {
      if (acceptance.errorCode !== undefined || acceptance.blockedReasons.length !== 0 ||
        acceptance.missingCapabilities.length !== 0 || acceptance.missingDependencies.length !== 0 ||
        !isTrustedAcceptedRuntime(acceptance.runtime, acceptance)) return false
    } else if (acceptance.errorCode === undefined || !dependencies.isPairingErrorCode(acceptance.errorCode) || acceptance.runtime !== undefined) return false
    return pairingHandshakeMatches(acceptance)
  }

  function isTrustedTaskLifecycle(input: unknown, previousStatus: unknown, changed: boolean): boolean {
    const task = asRecord(input)
    if (!task || !dependencies.isTrustedTask(task)) return false
    if (previousStatus === undefined && changed) return false
    if (previousStatus !== undefined && changed !== (previousStatus !== task.status)) return false
    return dependencies.hasUniqueStrings(task.logs.map((log: UnknownRecord) => log.id)) &&
      dependencies.hasUniqueStrings(task.artifacts.map((artifact: UnknownRecord) => artifact.artifactId)) &&
      task.logs.every((log: unknown) => dependencies.isTrustedTaskLifecycleLogEntry(log, task)) &&
      task.artifacts.every((artifact: unknown) => dependencies.isTrustedTaskLifecycleArtifact(artifact, task))
  }

  function isTrustedMcpGatewayEndpoint(input: unknown, transport: 'streamable-http' | 'http'): boolean {
    const endpoint = asRecord(input)
    if (!endpoint || !dependencies.hasOnlyAllowedKeys(endpoint, ['transport', 'origin', 'host', 'port', 'path', 'url', 'localNetwork']) ||
      endpoint.transport !== transport) return false
    const sanitized = dependencies.sanitizeMcpGatewayEndpoint(endpoint.url, transport)
    return Boolean(sanitized) && sanitized!.origin === endpoint.origin && sanitized!.host === endpoint.host &&
      sanitized!.port === endpoint.port && sanitized!.path === endpoint.path && sanitized!.url === endpoint.url &&
      sanitized!.localNetwork === endpoint.localNetwork
  }

  function isTrustedMcpGatewaySession(input: unknown): boolean {
    const session = asRecord(input)
    const transport = dependencies.resolveMcpGatewayTransport(session?.transport)
    if (!session || !dependencies.hasOnlyAllowedKeys(session, [
      'schema', 'runtimeHandoffSchema', 'taskRecordSchema', 'runtimeReportSchema', 'protocolSchema',
      'sessionId', 'taskId', 'toolId', 'runtimeId', 'runtimeKind', 'projectId', 'createdAt', 'updatedAt',
      'expiresAt', 'status', 'ready', 'androidCanHost', 'androidCanConnect', 'requiresPairedRuntime',
      'usesStreamableHttp', 'transport', 'endpoint', 'serverName', 'toolCount',
    ]) || session.schema !== dependencies.schemas.mcpGatewaySession ||
      session.runtimeHandoffSchema !== dependencies.schemas.runtimeHandoff || session.taskRecordSchema !== dependencies.schemas.taskRecord ||
      session.runtimeReportSchema !== dependencies.schemas.runtimeReport || session.protocolSchema !== dependencies.schemas.runtimeProtocol ||
      dependencies.sanitizeStableId(session.sessionId) !== session.sessionId || dependencies.sanitizeStableId(session.taskId) !== session.taskId ||
      dependencies.sanitizeStableId(session.toolId) !== session.toolId || dependencies.sanitizeStableId(session.runtimeId) !== session.runtimeId ||
      !dependencies.isRuntimeKind(session.runtimeKind) || !Number.isFinite(session.createdAt) || !Number.isFinite(session.updatedAt) ||
      session.updatedAt < session.createdAt || !dependencies.isMcpGatewaySessionStatus(session.status) ||
      typeof session.ready !== 'boolean' || session.ready !== (session.status === 'ready') || session.androidCanHost !== false ||
      typeof session.androidCanConnect !== 'boolean' || session.requiresPairedRuntime !== true || !transport ||
      session.usesStreamableHttp !== (transport === 'streamable-http')) return false
    if (session.projectId !== undefined && dependencies.sanitizeMetadataToken(session.projectId) !== session.projectId) return false
    if (session.expiresAt !== undefined && (!Number.isFinite(session.expiresAt) || session.expiresAt < session.createdAt)) return false
    if (session.serverName !== undefined && dependencies.sanitizeMcpGatewayServerName(session.serverName) !== session.serverName) return false
    if (session.toolCount !== undefined && dependencies.sanitizeOptionalNonNegativeNumber(session.toolCount) !== session.toolCount) return false
    if (session.androidCanConnect !== (session.ready && Boolean(session.endpoint))) return false
    return session.endpoint === undefined || isTrustedMcpGatewayEndpoint(session.endpoint, transport)
  }

  return {
    isTrustedRegisteredLaunch,
    isTrustedRuntimePairingAcceptance,
    isTrustedTaskLifecycle,
    isTrustedMcpGatewaySession,
  }
}
