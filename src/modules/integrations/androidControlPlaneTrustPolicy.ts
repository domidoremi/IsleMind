import { sanitizeMcpGatewayEndpointPath } from './mcpGatewayPolicy'
import { sanitizeMcpToolReference } from './toolchainManifestAdmission'
import { isUnsafeRuntimeSnapshotName } from './runtimeSnapshotPolicy'
import { cleanPublicText } from './runtimeTaskTextPolicy'
import { isTaskStatus, isTerminalTaskStatus, isToolchainTaskStatusAttentionRequired } from './taskLifecyclePolicy'
import { isUnsafeRuntimePairingText } from './textSafety'

type DynamicRecord = Record<string, any>

export interface AndroidControlPlaneTrustPolicyDependencies {
  schemas: {
    snapshot: string
    installPlan: string
    taskCancelRequest: string
    pairingAcceptance: string
    registeredCatalog: string
    registry: string
    doctor: string
    runtimeProtocol: string
  }
  limits: { cards: number; eventEntries: number; eventKeys: number; reasons: number }
  installActions: readonly string[]
  installStatuses: readonly string[]
  permissions: readonly string[]
  runtimeCapabilities: readonly string[]
  registrationKinds: readonly string[]
  registeredStatuses: readonly string[]
  countPolicy: {
    buildAndroidControlPlaneEventSummary(snapshot: any): string
    controlPlaneInstallCountsCanRepresentCards(counts: any, cards: readonly any[]): boolean
    controlPlaneRegisteredCountsCanRepresentCards(counts: any, cards: readonly any[]): boolean
    controlPlaneRegistryCountsCanRepresentCards(counts: any, cards: readonly any[]): boolean
    controlPlaneRegisteredLaunchCountsEqual(left: any, right: any): boolean
    controlPlaneTaskCancelCountsEqual(left: any, right: any): boolean
    controlPlanePairingAcceptanceCountsEqual(left: any, right: any): boolean
    createControlPlaneRegisteredLaunchCounts(cards: readonly any[]): any
    createControlPlaneTaskCancelCounts(cards: readonly any[]): any
    createControlPlanePairingAcceptanceCounts(cards: readonly any[]): any
  }
  sanitizeStableId(input: unknown): string | undefined
  sanitizeDependencyKeys(input: unknown): string[]
  sanitizeDisplayText(input: unknown, fallback: string): string
  sanitizeOptionalToken(input: unknown): string | undefined
  stableIdentityString(input: unknown): string
  createGatewaySessionId(toolId: string, runtimeId: string, taskId: string): string
  createRegisteredLaunchId(registrationId: string, taskId: string, createdAt: number): string
  isAndroidDisposition(input: unknown): boolean
  isDoctorStatus(input: unknown): boolean
  isHandoffDelivery(input: unknown): boolean
  isInstallAction(input: unknown): boolean
  isInstallStatus(input: unknown): boolean
  isMcpGatewayStatus(input: unknown): boolean
  isPermission(input: unknown): boolean
  isResolutionStatus(input: unknown): boolean
  isRuntimeCapability(input: unknown): boolean
  isRuntimeKind(input: unknown): boolean
  isPairingStatus(input: unknown): boolean
  isPairingError(input: unknown): boolean
  isTaskCancelError(input: unknown): boolean
  isToolKind(input: unknown): boolean
  isHttpTransport(input: unknown): boolean
}

export function createAndroidControlPlaneTrustPolicy<TSnapshot extends object>(dependencies: AndroidControlPlaneTrustPolicyDependencies) {
  const counts = dependencies.countPolicy

  function isTrustedSnapshot(input: unknown): input is TSnapshot {
    if (!asRecord(input) || !isTrustedSnapshotShape(input)) return false
    const snapshot = input as DynamicRecord
    if (snapshot.schema !== dependencies.schemas.snapshot ||
      snapshot.installPlanSchema !== dependencies.schemas.installPlan ||
      snapshot.taskCancelRequestSchema !== dependencies.schemas.taskCancelRequest ||
      snapshot.runtimePairingAcceptanceSchema !== dependencies.schemas.pairingAcceptance ||
      snapshot.registeredCatalogSchema !== dependencies.schemas.registeredCatalog ||
      snapshot.registrySchema !== dependencies.schemas.registry ||
      snapshot.doctorSchema !== dependencies.schemas.doctor ||
      snapshot.protocolSchema !== dependencies.schemas.runtimeProtocol ||
      !Number.isFinite(snapshot.generatedAt) ||
      (snapshot.projectId !== undefined && dependencies.sanitizeOptionalToken(snapshot.projectId) !== snapshot.projectId) ||
      cleanPublicText(snapshot.summary) !== snapshot.summary ||
      !dependencies.isDoctorStatus(snapshot.doctorStatus)) return false
    if (!trustedArray(snapshot.actionBadges, dependencies.limits.eventKeys, isTrustedActionBadge)) return false
    if (!trustedArray(snapshot.runtimeBadges, dependencies.limits.cards, isTrustedRuntimeBadge)) return false
    if (!trustedArray(snapshot.toolCards, dependencies.limits.cards, isTrustedToolCard)) return false
    if (!trustedArray(snapshot.registeredToolCards, dependencies.limits.cards, isTrustedRegisteredToolCard)) return false
    if (!trustedArray(snapshot.registeredLaunchCards, dependencies.limits.cards, isTrustedRegisteredLaunchCard)) return false
    if (!trustedArray(snapshot.taskCards, dependencies.limits.cards, isTrustedTaskCard)) return false
    if (!trustedArray(snapshot.gatewayCards, dependencies.limits.cards, isTrustedGatewayCard)) return false
    if (!trustedArray(snapshot.pairingAcceptanceCards, dependencies.limits.cards, isTrustedPairingAcceptanceCard)) return false
    if (snapshot.summary !== counts.buildAndroidControlPlaneEventSummary(snapshot)) return false
    if (!counts.controlPlaneInstallCountsCanRepresentCards(snapshot.installCounts, snapshot.toolCards)) return false
    if (!counts.controlPlaneRegisteredCountsCanRepresentCards(snapshot.registeredCounts, snapshot.registeredToolCards)) return false
    if (!counts.controlPlaneRegistryCountsCanRepresentCards(snapshot.registryCounts, snapshot.toolCards)) return false
    if (!counts.controlPlaneRegisteredLaunchCountsEqual(snapshot.registeredLaunchCounts, counts.createControlPlaneRegisteredLaunchCounts(snapshot.registeredLaunchCards))) return false
    if (!counts.controlPlaneTaskCancelCountsEqual(snapshot.taskCancelCounts, counts.createControlPlaneTaskCancelCounts(snapshot.taskCards))) return false
    if (!counts.controlPlanePairingAcceptanceCountsEqual(snapshot.pairingAcceptanceCounts, counts.createControlPlanePairingAcceptanceCounts(snapshot.pairingAcceptanceCards))) return false
    return true
  }

  function isTrustedSnapshotShape(input: unknown): boolean {
    const snapshot = asRecord(input)
    if (!snapshot) return false
    return onlyKeys(snapshot, ['schema', 'generatedAt', 'projectId', 'installPlanSchema', 'taskCancelRequestSchema',
      'runtimePairingAcceptanceSchema', 'registeredCatalogSchema', 'registrySchema', 'doctorSchema', 'protocolSchema',
      'summary', 'installCounts', 'registeredCounts', 'registryCounts', 'doctorStatus', 'actionBadges', 'runtimeBadges',
      'toolCards', 'registeredToolCards', 'registeredLaunchCards', 'taskCards', 'gatewayCards', 'pairingAcceptanceCards',
      'pairingAcceptanceCounts', 'taskCancelCounts', 'registeredLaunchCounts']) &&
      onlyKeys(snapshot.installCounts, ['total', ...dependencies.installStatuses]) &&
      onlyKeys(snapshot.registeredCounts, ['total', 'appAction', 'runtimeTool', ...dependencies.registeredStatuses]) &&
      onlyKeys(snapshot.registryCounts, ['total', 'valid', 'invalid', 'ready', 'needsPermission', 'waitingForUser', 'unsupported']) &&
      onlyKeys(snapshot.registeredLaunchCounts, ['total', 'queued', 'withPairingEvidence', 'androidExecutable']) &&
      onlyKeys(snapshot.taskCancelCounts, ['total', 'available', 'blocked', 'terminalTask', 'runtimeMismatch', 'runtimeUnavailable', 'capabilityMissing', 'invalidTransition']) &&
      onlyKeys(snapshot.pairingAcceptanceCounts, ['total', 'accepted', 'rejected'])
  }

  function isTrustedActionBadge(input: unknown): input is DynamicRecord {
    if (!onlyKeys(input, ['kind', 'count', 'toolIds'])) return false
    const badge = input as DynamicRecord
    return dependencies.isInstallAction(badge.kind) && nonNegativeInteger(badge.count) &&
      isTrustedStableIdList(badge.toolIds, dependencies.limits.eventEntries) && badge.count >= badge.toolIds.length
  }

  function isTrustedRuntimeBadge(input: unknown): input is DynamicRecord {
    if (!onlyKeys(input, ['runtimeId', 'name', 'kind', 'online', 'protocolReady', 'capabilityCount', 'dependencyKeys', 'lastSeenAt'])) return false
    const badge = input as DynamicRecord
    return dependencies.sanitizeStableId(badge.runtimeId) === badge.runtimeId && cleanPublicText(badge.name) === badge.name &&
      !isUnsafeRuntimeSnapshotName(badge.name) && dependencies.isRuntimeKind(badge.kind) && typeof badge.online === 'boolean' &&
      typeof badge.protocolReady === 'boolean' && nonNegativeInteger(badge.capabilityCount) &&
      isTrustedDependencyKeyList(badge.dependencyKeys, dependencies.limits.eventKeys) &&
      (badge.lastSeenAt === undefined || Number.isFinite(badge.lastSeenAt))
  }

  function expectedToolCardActionKinds(card: DynamicRecord): string[] {
    switch (card.status) {
      case 'installable': return card.androidDisposition === 'app-only' && card.runtimeKind === 'android-app'
        ? ['register-app-action'] : ['register-runtime-tool']
      case 'needs_permission': return ['grant-permission']
      case 'needs_runtime': return ['pair-runtime']
      case 'needs_confirmation': return ['confirm-intent']
      case 'blocked': return ['fix-manifest']
      default: return []
    }
  }

  function isTrustedToolCard(input: unknown): input is DynamicRecord {
    if (!onlyKeys(input, ['id', 'title', 'kind', 'status', 'registryStatus', 'androidDisposition', 'runtimeId', 'runtimeKind', 'actionKinds', 'permissions', 'missingPermissions', 'missingDependencies', 'requiresUserConfirmation'])) return false
    const card = input as DynamicRecord
    return dependencies.sanitizeStableId(card.id) === card.id && cleanPublicText(card.title) === card.title &&
      !isUnsafeRuntimePairingText(card.title) && dependencies.isToolKind(card.kind) && dependencies.isInstallStatus(card.status) &&
      dependencies.isResolutionStatus(card.registryStatus) && dependencies.isAndroidDisposition(card.androidDisposition) &&
      (card.runtimeId === undefined || dependencies.sanitizeStableId(card.runtimeId) === card.runtimeId) &&
      (card.runtimeKind === undefined || dependencies.isRuntimeKind(card.runtimeKind)) && isTrustedInstallActionList(card.actionKinds) &&
      dependencies.stableIdentityString(card.actionKinds) === dependencies.stableIdentityString(expectedToolCardActionKinds(card)) &&
      isTrustedPermissionList(card.permissions) && isTrustedPermissionList(card.missingPermissions) &&
      isTrustedDependencyKeyList(card.missingDependencies, dependencies.limits.eventKeys) &&
      typeof card.requiresUserConfirmation === 'boolean'
  }

  function isTrustedRegisteredToolCard(input: unknown): input is DynamicRecord {
    if (!onlyKeys(input, ['registrationId', 'toolId', 'title', 'kind', 'registrationKind', 'status', 'runtimeId', 'runtimeKind', 'androidDisposition', 'registeredAt', 'permissionCount', 'requiredCapabilityCount', 'transportCount', 'blockedReasons'])) return false
    const card = input as DynamicRecord
    return dependencies.sanitizeStableId(card.registrationId) === card.registrationId && dependencies.sanitizeStableId(card.toolId) === card.toolId &&
      cleanPublicText(card.title) === card.title && !isUnsafeRuntimePairingText(card.title) && dependencies.isToolKind(card.kind) &&
      dependencies.registrationKinds.includes(card.registrationKind) && dependencies.registeredStatuses.includes(card.status) &&
      (card.runtimeId === undefined || dependencies.sanitizeStableId(card.runtimeId) === card.runtimeId) &&
      (card.runtimeKind === undefined || dependencies.isRuntimeKind(card.runtimeKind)) && dependencies.isAndroidDisposition(card.androidDisposition) &&
      Number.isFinite(card.registeredAt) && nonNegativeInteger(card.permissionCount) && nonNegativeInteger(card.requiredCapabilityCount) &&
      nonNegativeInteger(card.transportCount) && isTrustedBlockedReasons(card.blockedReasons)
  }

  function isTrustedRegisteredLaunchCard(input: unknown): input is DynamicRecord {
    if (!onlyKeys(input, ['launchId', 'registrationId', 'toolId', 'taskId', 'runtimeId', 'runtimeKind', 'entryType', 'entryExecutor', 'mcpToolName', 'createdAt', 'status', 'handoffDelivery', 'hasRuntimePairingAcceptance', 'confirmedIntent', 'payloadKeyCount', 'permissionCount', 'dispatchRequiresPairedRuntime', 'dispatchUsesNetworkTransport', 'dispatchUsesStreamableHttp', 'androidCanExecute'])) return false
    const card = input as DynamicRecord
    if (dependencies.sanitizeStableId(card.launchId) !== card.launchId || dependencies.sanitizeStableId(card.registrationId) !== card.registrationId ||
      dependencies.sanitizeStableId(card.toolId) !== card.toolId || !isTrustedTaskId(card.taskId) ||
      dependencies.sanitizeStableId(card.runtimeId) !== card.runtimeId || !dependencies.isRuntimeKind(card.runtimeKind) ||
      (card.entryType !== undefined && !dependencies.isToolKind(card.entryType)) ||
      (card.entryExecutor !== undefined && !['app', 'cli', 'mcp', 'remote'].includes(card.entryExecutor)) ||
      (card.mcpToolName !== undefined && sanitizeMcpToolReference(card.mcpToolName) !== card.mcpToolName) ||
      !Number.isFinite(card.createdAt) || card.status !== 'queued' || !dependencies.isHandoffDelivery(card.handoffDelivery) ||
      typeof card.hasRuntimePairingAcceptance !== 'boolean' || typeof card.confirmedIntent !== 'boolean' ||
      !nonNegativeInteger(card.payloadKeyCount) || !nonNegativeInteger(card.permissionCount) ||
      typeof card.dispatchRequiresPairedRuntime !== 'boolean' || typeof card.dispatchUsesNetworkTransport !== 'boolean' ||
      typeof card.dispatchUsesStreamableHttp !== 'boolean' || typeof card.androidCanExecute !== 'boolean') return false
    if (card.mcpToolName !== undefined && (card.entryType !== 'mcp' || card.entryExecutor !== 'mcp')) return false
    if (card.entryExecutor === 'mcp' && (card.entryType !== 'mcp' || !card.mcpToolName)) return false
    if (card.launchId !== dependencies.createRegisteredLaunchId(card.registrationId, card.taskId, card.createdAt)) return false
    if (card.dispatchRequiresPairedRuntime !== card.hasRuntimePairingAcceptance) return false
    if (card.androidCanExecute) return card.runtimeKind === 'android-app' && card.handoffDelivery === 'android-app-action' &&
      !card.dispatchRequiresPairedRuntime && !card.hasRuntimePairingAcceptance
    return card.runtimeKind !== 'android-app' && card.handoffDelivery !== 'android-app-action'
  }

  function isTrustedTaskCard(input: unknown): input is DynamicRecord {
    if (!onlyKeys(input, ['taskId', 'toolId', 'runtimeId', 'runtimeKind', 'status', 'updatedAt', 'startedAt', 'completedAt', 'expiresAt', 'terminal', 'logCount', 'artifactCount', 'requiresAttention', 'cancelRequestSchema', 'canRequestCancel', 'cancelRequiresRuntime', 'runtimeCancelReady', 'cancelErrorCode'])) return false
    const card = input as DynamicRecord
    if (!isTrustedTaskId(card.taskId) || dependencies.sanitizeStableId(card.toolId) !== card.toolId ||
      dependencies.sanitizeStableId(card.runtimeId) !== card.runtimeId || !dependencies.isRuntimeKind(card.runtimeKind) || !isTaskStatus(card.status) ||
      !Number.isFinite(card.updatedAt) || (card.startedAt !== undefined && !Number.isFinite(card.startedAt)) ||
      (card.completedAt !== undefined && !Number.isFinite(card.completedAt)) || (card.expiresAt !== undefined && !Number.isFinite(card.expiresAt)) ||
      card.terminal !== isTerminalTaskStatus(card.status) || !nonNegativeInteger(card.logCount) || !nonNegativeInteger(card.artifactCount) ||
      typeof card.requiresAttention !== 'boolean' || card.cancelRequestSchema !== dependencies.schemas.taskCancelRequest ||
      typeof card.canRequestCancel !== 'boolean' || card.cancelRequiresRuntime !== true || typeof card.runtimeCancelReady !== 'boolean' ||
      (card.cancelErrorCode !== undefined && !dependencies.isTaskCancelError(card.cancelErrorCode))) return false
    return isTaskCancelSummaryCoherent(card)
  }

  function isTaskCancelSummaryCoherent(input: DynamicRecord): boolean {
    const terminal = isTerminalTaskStatus(input.status)
    if (input.terminal !== terminal || input.requiresAttention !== isToolchainTaskStatusAttentionRequired(input.status)) return false
    if (input.startedAt !== undefined && input.startedAt > input.updatedAt) return false
    if (input.completedAt !== undefined && input.completedAt < (input.startedAt ?? 0)) return false
    if (!terminal && input.completedAt !== undefined) return false
    if (terminal) return !input.canRequestCancel && !input.runtimeCancelReady && input.cancelErrorCode === 'terminal_task'
    if (input.canRequestCancel) return input.runtimeCancelReady && input.cancelErrorCode === undefined
    return !input.runtimeCancelReady && input.cancelErrorCode !== undefined && input.cancelErrorCode !== 'terminal_task'
  }

  function isTrustedGatewayCard(input: unknown): input is DynamicRecord {
    if (!onlyKeys(input, ['sessionId', 'taskId', 'toolId', 'runtimeId', 'runtimeKind', 'status', 'ready', 'androidCanConnect', 'androidCanHost', 'transport', 'usesStreamableHttp', 'endpointOrigin', 'endpointPath', 'endpointLocalNetwork', 'updatedAt', 'expiresAt', 'toolCount'])) return false
    const card = input as DynamicRecord
    if (dependencies.sanitizeStableId(card.sessionId) !== card.sessionId || dependencies.sanitizeStableId(card.taskId) !== card.taskId ||
      dependencies.sanitizeStableId(card.toolId) !== card.toolId || dependencies.sanitizeStableId(card.runtimeId) !== card.runtimeId ||
      !dependencies.isRuntimeKind(card.runtimeKind) || !dependencies.isMcpGatewayStatus(card.status) || typeof card.ready !== 'boolean' ||
      card.ready !== (card.status === 'ready') || typeof card.androidCanConnect !== 'boolean' || card.androidCanHost !== false ||
      !dependencies.isHttpTransport(card.transport) || card.usesStreamableHttp !== (card.transport === 'streamable-http') ||
      typeof card.endpointLocalNetwork !== 'boolean' || !Number.isFinite(card.updatedAt) ||
      (card.expiresAt !== undefined && !Number.isFinite(card.expiresAt)) || (card.toolCount !== undefined && !nonNegativeInteger(card.toolCount))) return false
    if (card.sessionId !== dependencies.createGatewaySessionId(card.toolId, card.runtimeId, card.taskId)) return false
    if (card.androidCanConnect !== (card.ready && Boolean(card.endpointOrigin))) return false
    if (card.endpointOrigin !== undefined && sanitizeEndpointOrigin(card.endpointOrigin) !== card.endpointOrigin) return false
    return card.endpointPath === undefined || sanitizeMcpGatewayEndpointPath(card.endpointPath) === card.endpointPath
  }

  function isTrustedPairingAcceptanceCard(input: unknown): input is DynamicRecord {
    if (!onlyKeys(input, ['acceptanceId', 'handshakeId', 'status', 'runtimeId', 'runtimeKind', 'runtimeName', 'projectId', 'acceptedAt', 'online', 'transportCount', 'capabilityCount', 'dependencyKeyCount', 'requestedToolCount', 'requestedCapabilityCount', 'requestedDependencyCount', 'missingCapabilities', 'missingDependencies', 'blockedReasonCount', 'errorCode', 'androidCanExecute', 'runtimeCanExecute', 'usesStreamableHttp'])) return false
    const card = input as DynamicRecord
    if (dependencies.sanitizeStableId(card.acceptanceId) !== card.acceptanceId ||
      (card.handshakeId !== undefined && dependencies.sanitizeStableId(card.handshakeId) !== card.handshakeId) ||
      !dependencies.isPairingStatus(card.status) || (card.runtimeId !== undefined && dependencies.sanitizeStableId(card.runtimeId) !== card.runtimeId) ||
      (card.runtimeKind !== undefined && !dependencies.isRuntimeKind(card.runtimeKind)) ||
      (card.runtimeName !== undefined && dependencies.sanitizeDisplayText(card.runtimeName, '') !== card.runtimeName) ||
      (card.projectId !== undefined && dependencies.sanitizeOptionalToken(card.projectId) !== card.projectId) || !Number.isFinite(card.acceptedAt) ||
      typeof card.online !== 'boolean' || !nonNegativeInteger(card.transportCount) || !nonNegativeInteger(card.capabilityCount) ||
      !nonNegativeInteger(card.dependencyKeyCount) || !nonNegativeInteger(card.requestedToolCount) ||
      !nonNegativeInteger(card.requestedCapabilityCount) || !nonNegativeInteger(card.requestedDependencyCount) ||
      !isTrustedCapabilityList(card.missingCapabilities) || !isTrustedDependencyKeyList(card.missingDependencies, dependencies.limits.eventKeys) ||
      !nonNegativeInteger(card.blockedReasonCount) || (card.errorCode !== undefined && !dependencies.isPairingError(card.errorCode)) ||
      card.androidCanExecute !== false || card.runtimeCanExecute !== (card.status === 'accepted') || typeof card.usesStreamableHttp !== 'boolean') return false
    return isPairingSummaryCoherent(card)
  }

  function isPairingSummaryCoherent(input: DynamicRecord): boolean {
    if (input.androidCanExecute !== false || input.usesStreamableHttp && input.transportCount === 0) return false
    if (input.missingCapabilities.length > input.requestedCapabilityCount || input.missingDependencies.length > input.requestedDependencyCount) return false
    if (input.status === 'accepted') return Boolean(input.runtimeId) && Boolean(input.runtimeKind) && input.runtimeKind !== 'android-app' &&
      input.online && input.runtimeCanExecute && input.errorCode === undefined && input.missingCapabilities.length === 0 &&
      input.missingDependencies.length === 0 && input.blockedReasonCount === 0 && input.capabilityCount >= input.requestedCapabilityCount &&
      input.dependencyKeyCount >= input.requestedDependencyCount
    if (input.runtimeCanExecute || input.errorCode === undefined || input.blockedReasonCount <= 0) return false
    if (input.errorCode === 'capability_missing' && input.missingCapabilities.length === 0) return false
    if (input.errorCode === 'dependency_missing' && input.missingDependencies.length === 0) return false
    if (input.errorCode === 'android_execution_blocked' && input.runtimeKind !== undefined && input.runtimeKind !== 'android-app') return false
    return true
  }

  function isTrustedStableIdList(input: unknown, limit: number): input is string[] {
    if (!Array.isArray(input) || input.length > limit) return false
    const cleaned = uniqueCleanList(input.map((item) => typeof item === 'string' ? item : ''))
    return cleaned.length === input.length && cleaned.every((item) => dependencies.sanitizeStableId(item) === item) &&
      dependencies.stableIdentityString(cleaned) === dependencies.stableIdentityString(input)
  }
  function isTrustedInstallActionList(input: unknown): input is string[] {
    return Array.isArray(input) && input.length <= dependencies.limits.eventKeys &&
      uniqueAllowed(input, dependencies.installActions, dependencies.isInstallAction).length === input.length
  }
  function isTrustedDependencyKeyList(input: unknown, limit: number): input is string[] {
    if (!Array.isArray(input) || input.length > limit) return false
    const sanitized = dependencies.sanitizeDependencyKeys(input)
    return sanitized.length === input.length && dependencies.stableIdentityString(sanitized) === dependencies.stableIdentityString(input)
  }
  function isTrustedPermissionList(input: unknown): input is string[] {
    return Array.isArray(input) && input.length <= dependencies.limits.eventKeys &&
      uniqueAllowed(input, dependencies.permissions, dependencies.isPermission).length === input.length
  }
  function isTrustedCapabilityList(input: unknown): input is string[] {
    return Array.isArray(input) && input.length <= dependencies.limits.eventKeys &&
      uniqueAllowed(input, dependencies.runtimeCapabilities, dependencies.isRuntimeCapability).length === input.length
  }
  function isTrustedBlockedReasons(input: unknown): input is string[] {
    if (!Array.isArray(input) || input.length > dependencies.limits.reasons) return false
    const cleaned = uniqueCleanList(input.map((item) => typeof item === 'string' ? item : ''))
    return cleaned.length === input.length && dependencies.stableIdentityString(cleaned) === dependencies.stableIdentityString(input) &&
      cleaned.every((reason) => cleanPublicText(reason) === reason && !isUnsafeRuntimePairingText(reason))
  }
  function isTrustedTaskId(input: unknown): input is string {
    if (typeof input !== 'string') return false
    return dependencies.sanitizeStableId(input) === input && !isUnsafeRuntimePairingText(input.replace(/^task-/i, ''))
  }

  return Object.freeze({ isTrustedSnapshot, isTrustedActionBadge, isTrustedRuntimeBadge, isTrustedToolCard,
    expectedToolCardActionKinds, isTrustedRegisteredToolCard, isTrustedRegisteredLaunchCard, isTrustedTaskCard,
    isTaskCancelSummaryCoherent, isTrustedGatewayCard, isTrustedPairingAcceptanceCard, isPairingSummaryCoherent })
}

function trustedArray(input: unknown, limit: number, validate: (item: unknown) => boolean): input is DynamicRecord[] {
  return Array.isArray(input) && input.length <= limit && input.every(validate)
}
function onlyKeys(input: unknown, keys: readonly string[]): boolean {
  const record = asRecord(input)
  return Boolean(record) && Object.keys(record!).every((key) => keys.includes(key))
}
function asRecord(input: unknown): DynamicRecord | undefined {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as DynamicRecord : undefined
}
function nonNegativeInteger(input: unknown): boolean { return typeof input === 'number' && Number.isInteger(input) && input >= 0 }
function uniqueCleanList(input: readonly string[]): string[] { return Array.from(new Set(input.map((item) => item.trim().slice(0, 420)).filter(Boolean))) }
function uniqueAllowed(input: unknown[], allowed: readonly string[], guard: (input: unknown) => boolean): string[] {
  return Array.from(new Set(input.filter((item): item is string => guard(item) && allowed.includes(item as string))))
}
function sanitizeEndpointOrigin(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined
  const raw = input.trim().slice(0, 420)
  try { const url = new URL(raw); return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : undefined } catch { return undefined }
}
