import type {
  TOOLCHAIN_MANIFEST_SCHEMA,
  TOOLCHAIN_REGISTRY_SCHEMA,
  TOOLCHAIN_DOCTOR_SCHEMA,
  TOOLCHAIN_INTENT_PREVIEW_SCHEMA,
  TOOLCHAIN_TASK_RECORD_SCHEMA,
  TOOLCHAIN_RUNTIME_HANDOFF_SCHEMA,
  TOOLCHAIN_CLI_EXECUTION_PLAN_SCHEMA,
  TOOLCHAIN_INSTALL_PLAN_SCHEMA,
  TOOLCHAIN_ANDROID_CONTROL_PLANE_SCHEMA,
  TOOLCHAIN_CONTROL_PLANE_ACTION_SCHEMA,
  TOOLCHAIN_CONTROL_PLANE_ACTION_APPLICATION_SCHEMA,
  TOOLCHAIN_RUNTIME_PAIRING_HANDSHAKE_SCHEMA,
  TOOLCHAIN_RUNTIME_PAIRING_ACCEPTANCE_SCHEMA,
  TOOLCHAIN_REGISTRATION_RECORD_SCHEMA,
  TOOLCHAIN_REGISTERED_CATALOG_SCHEMA,
  TOOLCHAIN_REGISTERED_CATALOG_PERSISTENCE_SCHEMA,
  TOOLCHAIN_REGISTERED_EXECUTION_PLAN_SCHEMA,
  TOOLCHAIN_REGISTERED_LAUNCH_SCHEMA,
  TOOLCHAIN_RUNTIME_REPORT_SCHEMA,
  TOOLCHAIN_TASK_CANCEL_REQUEST_SCHEMA,
  TOOLCHAIN_TASK_LIFECYCLE_EVENT_SCHEMA,
  TOOLCHAIN_MCP_GATEWAY_SESSION_SCHEMA,
  ToolchainToolKind,
  ToolchainTaskStatus,
  ToolchainTaskLogLevel,
  ToolchainTaskArtifactKind,
  ToolchainRuntimeHandoffDeliveryKind,
  ToolchainInstallPlanStatus,
  ToolchainInstallActionKind,
  ToolchainControlPlaneActionRoute,
  ToolchainRegistrationKind,
  ToolchainRegisteredCatalogStatus,
  ToolchainRegisteredExecutionStatus,
  ToolchainMcpGatewaySessionStatus,
  ToolchainControlPlaneActionApplicationStatus,
  ToolchainRuntimePairingAcceptanceStatus,
  ToolchainPermission,
  ToolchainRuntimeSupportMap,
  ToolchainResolutionStatus,
  ToolchainAndroidDisposition,
  ToolchainDoctorStatus,
  ToolchainIntentPreviewStatus,
  ToolchainIntentImpactKind,
  ToolchainTaskTransitionErrorCode,
  ToolchainRuntimeHandoffErrorCode,
  ToolchainCliExecutionPlanErrorCode,
  ToolchainCliExecutionReportErrorCode,
  ToolchainMcpToolExecutionReportErrorCode,
  ToolchainControlPlaneActionErrorCode,
  ToolchainControlPlaneActionApplicationErrorCode,
  ToolchainRuntimePairingErrorCode,
  ToolchainRegistrationErrorCode,
  ToolchainRegisteredLaunchErrorCode,
  ToolchainRegisteredCatalogPersistenceErrorCode,
  ToolchainMcpGatewaySessionErrorCode,
  ToolchainRuntimeReportErrorCode,
  ToolchainTaskCancelErrorCode,
  ToolchainTaskRequestErrorCode,
} from './toolchainContracts'
import type { SkillDefinition } from '@/types/skillContracts'
import type { McpServerConfig } from '@/types/mcpContracts'
import type {
  ToolchainInstallPlan,
  ToolchainRegistrySnapshot,
} from './toolchainRegistryPolicy'
import type { ToolchainDoctorFinding } from './toolchainDoctorPolicy'
export type { ToolchainRuntimeSnapshot } from './toolchainRuntimeTrust'
import type {
  TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA,
  ToolchainRuntimeCapability,
  ToolchainRuntimeKind,
  ToolchainRuntimeSnapshot,
  ToolchainTransport,
} from './toolchainRuntimeTrust'

export interface ToolchainToolEntry {
  type: ToolchainToolKind
  command?: string
  action?: string
  mcpToolName?: string
  transport?: ToolchainTransport
  endpoint?: string
  executor?: 'app' | 'cli' | 'mcp' | 'remote'
}
export interface ToolchainToolManifest {
  schema: typeof TOOLCHAIN_MANIFEST_SCHEMA
  id: string
  title: string
  kind: ToolchainToolKind
  version: string
  description?: string
  runtimes: ToolchainRuntimeSupportMap
  permissions: ToolchainPermission[]
  entry: ToolchainToolEntry
  requires?: {
    capabilities?: ToolchainRuntimeCapability[]
    dependencies?: Record<string, string>
    memoryMb?: number
  }
  inputs?: Record<string, { type: 'string' | 'path' | 'boolean' | 'number' | 'json'; required?: boolean }>
  outputs?: Record<string, { type: 'json' | 'text' | 'artifact' | 'log' }>
  diagnosticHint?: string
}
export interface ToolchainManifestValidation {
  ok: boolean
  errors: string[]
  warnings: string[]
  sanitized: ToolchainToolManifest
}
export interface ToolchainPermissionGrant {
  permission: ToolchainPermission
  runtimeId?: string
  projectId?: string
  paths?: string[]
  networkHosts?: string[]
  expiresAt?: number
}
export interface ToolchainScopeRequest {
  paths?: string[]
  networkHosts?: string[]
}
export interface ToolchainExecutionInput {
  manifest: ToolchainToolManifest
  runtimes: ToolchainRuntimeSnapshot[]
  permissionGrants?: ToolchainPermissionGrant[]
  runtimePreference?: ToolchainRuntimeKind[]
  projectId?: string
  requestedScopes?: ToolchainScopeRequest
  now?: number
}
export interface ToolchainExecutionResolution {
  status: ToolchainResolutionStatus
  manifestId: string
  runtimeId?: string
  runtimeKind?: ToolchainRuntimeKind
  androidDisposition: ToolchainAndroidDisposition
  taskStatus?: ToolchainTaskStatus
  missingPermissions: ToolchainPermission[]
  missingCapabilities: ToolchainRuntimeCapability[]
  missingDependencies: string[]
  blockedReasons: string[]
  requiresUserConfirmation: boolean
}
export interface ToolchainRegistryEntrySummary {
  id: string
  title: string
  kind: ToolchainToolKind
  status: ToolchainResolutionStatus
  androidDisposition: ToolchainAndroidDisposition
  runtimeId?: string
  runtimeKind?: ToolchainRuntimeKind
  missingPermissions: ToolchainPermission[]
  missingCapabilities: ToolchainRuntimeCapability[]
  missingDependencies: string[]
  requiresUserConfirmation: boolean
}
export interface ToolchainRuntimeLogOptions {
  enabled?: boolean
  maxBytes?: number
}

export type { ToolchainDoctorFinding } from './toolchainDoctorPolicy'
export interface ToolchainIntentImpact {
  kind: ToolchainIntentImpactKind
  permission: ToolchainPermission
  label: string
  detail: string
}
export interface ToolchainIntentPreview {
  schema: typeof TOOLCHAIN_INTENT_PREVIEW_SCHEMA
  generatedAt: number
  toolId: string
  title: string
  status: ToolchainIntentPreviewStatus
  taskStatus?: Extract<ToolchainTaskStatus, 'waiting_for_user'>
  runtimeId?: string
  runtimeKind?: ToolchainRuntimeKind
  summary: string
  permissions: ToolchainPermission[]
  impacts: ToolchainIntentImpact[]
  artifactLabels: string[]
  confirmationRequired: boolean
  confirmationToken?: string
  unavailableReasons: string[]
}
export interface ToolchainTaskRequest {
  schema: typeof TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA
  taskId: string
  toolId: string
  runtimeId: string
  runtimeKind: ToolchainRuntimeKind
  status: Extract<ToolchainTaskStatus, 'queued'>
  permissions: ToolchainPermission[]
  payload: Record<string, unknown>
  createdAt: number
  projectId?: string
  confirmedIntent?: {
    schema: typeof TOOLCHAIN_INTENT_PREVIEW_SCHEMA
    confirmedAt: number
    confirmationToken: string
    permissions: ToolchainPermission[]
    impactKinds: ToolchainIntentImpactKind[]
  }
}
export interface ToolchainTaskRequestCreation {
  ok: boolean
  task?: ToolchainTaskRequest
  errorCode?: ToolchainTaskRequestErrorCode
  message?: string
  requiredPreview?: boolean
}
export interface ToolchainTaskLogEntry {
  id: string
  ts: number
  level: ToolchainTaskLogLevel
  source: string
  message: string
  redacted: boolean
}
export interface ToolchainTaskArtifact {
  artifactId: string
  label: string
  kind: ToolchainTaskArtifactKind
  createdAt: number
  sizeBytes?: number
  mediaType?: string
  checksum?: string
}
export interface ToolchainTaskRecord {
  schema: typeof TOOLCHAIN_TASK_RECORD_SCHEMA
  protocolSchema: typeof TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA
  taskId: string
  toolId: string
  runtimeId: string
  runtimeKind: ToolchainRuntimeKind
  status: ToolchainTaskStatus
  permissions: ToolchainPermission[]
  payloadKeys: string[]
  createdAt: number
  updatedAt: number
  startedAt?: number
  completedAt?: number
  expiresAt?: number
  projectId?: string
  statusReason?: string
  confirmedIntent?: ToolchainTaskRequest['confirmedIntent']
  logs: ToolchainTaskLogEntry[]
  artifacts: ToolchainTaskArtifact[]
}
export interface ToolchainTaskTransitionResult {
  ok: boolean
  changed: boolean
  task: ToolchainTaskRecord
  errorCode?: ToolchainTaskTransitionErrorCode
  message?: string
}
export interface ToolchainRuntimeHandoffEntryRef {
  type: ToolchainToolKind
  executor?: ToolchainToolEntry['executor']
  commandRef?: string
  action?: string
  mcpToolName?: string
  transport?: ToolchainTransport
  endpoint?: string
}
export interface ToolchainRuntimeHandoff {
  schema: typeof TOOLCHAIN_RUNTIME_HANDOFF_SCHEMA
  manifestSchema: typeof TOOLCHAIN_MANIFEST_SCHEMA
  protocolSchema: typeof TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA
  taskRecordSchema: typeof TOOLCHAIN_TASK_RECORD_SCHEMA
  createdAt: number
  taskId: string
  toolId: string
  toolVersion: string
  toolKind: ToolchainToolKind
  runtimeId: string
  runtimeKind: ToolchainRuntimeKind
  projectId?: string
  delivery: ToolchainRuntimeHandoffDeliveryKind
  entryRef: ToolchainRuntimeHandoffEntryRef
  permissions: ToolchainPermission[]
  requiredCapabilities: ToolchainRuntimeCapability[]
  payload: Record<string, unknown>
  payloadKeys: string[]
  confirmedIntent?: ToolchainTaskRequest['confirmedIntent']
  expiresAt?: number
  dispatch: {
    androidCanExecute: boolean
    requiresPairedRuntime: boolean
    usesNetworkTransport: boolean
    usesStreamableHttp: boolean
  }
}
export interface ToolchainRuntimeHandoffCreation {
  ok: boolean
  handoff?: ToolchainRuntimeHandoff
  errorCode?: ToolchainRuntimeHandoffErrorCode
  message?: string
  blockedReasons: string[]
}
export interface ToolchainCliExecutionPlan {
  schema: typeof TOOLCHAIN_CLI_EXECUTION_PLAN_SCHEMA
  handoffSchema: typeof TOOLCHAIN_RUNTIME_HANDOFF_SCHEMA
  protocolSchema: typeof TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA
  planId: string
  createdAt: number
  handoffCreatedAt: number
  taskId: string
  toolId: string
  toolKind: ToolchainToolKind
  runtimeId: string
  runtimeKind: ToolchainRuntimeKind
  commandRef: string
  argv: string[]
  transport?: ToolchainTransport
  requiredInputKeys: string[]
  outputKeys: string[]
  payloadKeys: string[]
  permissionCount: number
  requiredCapabilityCount: number
  requiresPairedRuntime: boolean
  usesStreamableHttp: boolean
  expiresAt?: number
}
export interface ToolchainCliExecutionPlanCreation {
  ok: boolean
  plan?: ToolchainCliExecutionPlan
  errorCode?: ToolchainCliExecutionPlanErrorCode
  message?: string
  blockedReasons: string[]
}
export interface ToolchainCliExecutionReportCreation {
  ok: boolean
  report?: ToolchainRuntimeReport
  errorCode?: ToolchainCliExecutionReportErrorCode
  message?: string
  blockedReasons: string[]
}
export interface ToolchainMcpToolExecutionResultContentBlock {
  type: 'text' | 'image' | 'resource'
  text?: string
  data?: string
  uri?: string
  name?: string
  mimeType?: string
}
export interface ToolchainMcpToolExecutionResult {
  ok: boolean
  content?: ToolchainMcpToolExecutionResultContentBlock[]
  error?: string
}
export interface ToolchainMcpToolExecutionReportCreation {
  ok: boolean
  report?: ToolchainRuntimeReport
  errorCode?: ToolchainMcpToolExecutionReportErrorCode
  message?: string
  blockedReasons: string[]
}
export interface ToolchainMcpGatewayEndpoint {
  transport: Extract<ToolchainTransport, 'streamable-http' | 'http'>
  origin: string
  host: string
  port?: number
  path: string
  url: string
  localNetwork: boolean
}
export interface ToolchainMcpGatewayRuntimeReport {
  sessionId?: string
  status?: ToolchainMcpGatewaySessionStatus
  ready?: boolean
  endpoint?: string
  transport?: ToolchainTransport
  serverName?: string
  toolCount?: number
}
export interface ToolchainMcpGatewaySession {
  schema: typeof TOOLCHAIN_MCP_GATEWAY_SESSION_SCHEMA
  runtimeHandoffSchema: typeof TOOLCHAIN_RUNTIME_HANDOFF_SCHEMA
  taskRecordSchema: typeof TOOLCHAIN_TASK_RECORD_SCHEMA
  runtimeReportSchema: typeof TOOLCHAIN_RUNTIME_REPORT_SCHEMA
  protocolSchema: typeof TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA
  sessionId: string
  taskId: string
  toolId: string
  runtimeId: string
  runtimeKind: ToolchainRuntimeKind
  projectId?: string
  createdAt: number
  updatedAt: number
  expiresAt?: number
  status: ToolchainMcpGatewaySessionStatus
  ready: boolean
  androidCanHost: false
  androidCanConnect: boolean
  requiresPairedRuntime: true
  usesStreamableHttp: boolean
  transport: Extract<ToolchainTransport, 'streamable-http' | 'http'>
  endpoint?: ToolchainMcpGatewayEndpoint
  serverName?: string
  toolCount?: number
}
export interface ToolchainMcpGatewaySessionCreation {
  ok: boolean
  session?: ToolchainMcpGatewaySession
  errorCode?: ToolchainMcpGatewaySessionErrorCode
  message?: string
  blockedReasons: string[]
}
export interface ToolchainInstallPlanAction {
  id: string
  kind: ToolchainInstallActionKind
  label: string
  required: boolean
  toolIds: string[]
  runtimeIds: string[]
  permissions: ToolchainPermission[]
  capabilities: ToolchainRuntimeCapability[]
  dependencies: string[]
}
export interface ToolchainInstallPlanTool {
  id: string
  title: string
  version: string
  kind: ToolchainToolKind
  status: ToolchainInstallPlanStatus
  androidDisposition: ToolchainAndroidDisposition
  runtimeId?: string
  runtimeKind?: ToolchainRuntimeKind
  permissions: ToolchainPermission[]
  missingPermissions: ToolchainPermission[]
  missingCapabilities: ToolchainRuntimeCapability[]
  missingDependencies: string[]
  requiresUserConfirmation: boolean
  actions: ToolchainInstallPlanAction[]
  blockedReasons: string[]
}
export interface ToolchainAndroidControlPlaneActionBadge {
  kind: ToolchainInstallActionKind
  count: number
  toolIds: string[]
}
export interface ToolchainAndroidControlPlaneRuntimeBadge {
  runtimeId: string
  name: string
  kind: ToolchainRuntimeKind
  online: boolean
  protocolReady: boolean
  capabilityCount: number
  dependencyKeys: string[]
  lastSeenAt?: number
}
export interface ToolchainAndroidControlPlaneToolCard {
  id: string
  title: string
  kind: ToolchainToolKind
  status: ToolchainInstallPlanStatus
  registryStatus: ToolchainResolutionStatus
  androidDisposition: ToolchainAndroidDisposition
  runtimeId?: string
  runtimeKind?: ToolchainRuntimeKind
  actionKinds: ToolchainInstallActionKind[]
  permissions: ToolchainPermission[]
  missingPermissions: ToolchainPermission[]
  missingDependencies: string[]
  requiresUserConfirmation: boolean
}
export interface ToolchainAndroidControlPlaneTaskCard {
  taskId: string
  toolId: string
  runtimeId: string
  runtimeKind: ToolchainRuntimeKind
  status: ToolchainTaskStatus
  updatedAt: number
  startedAt?: number
  completedAt?: number
  expiresAt?: number
  terminal: boolean
  logCount: number
  artifactCount: number
  requiresAttention: boolean
  cancelRequestSchema: typeof TOOLCHAIN_TASK_CANCEL_REQUEST_SCHEMA
  canRequestCancel: boolean
  cancelRequiresRuntime: true
  runtimeCancelReady: boolean
  cancelErrorCode?: ToolchainTaskCancelErrorCode
}
export interface ToolchainAndroidControlPlaneGatewayCard {
  sessionId: string
  taskId: string
  toolId: string
  runtimeId: string
  runtimeKind: ToolchainRuntimeKind
  status: ToolchainMcpGatewaySessionStatus
  ready: boolean
  androidCanConnect: boolean
  androidCanHost: false
  transport: Extract<ToolchainTransport, 'streamable-http' | 'http'>
  usesStreamableHttp: boolean
  endpointOrigin?: string
  endpointPath?: string
  endpointLocalNetwork: boolean
  updatedAt: number
  expiresAt?: number
  toolCount?: number
}
export interface ToolchainAndroidControlPlanePairingAcceptanceCard {
  acceptanceId: string
  handshakeId?: string
  status: ToolchainRuntimePairingAcceptanceStatus
  runtimeId?: string
  runtimeKind?: ToolchainRuntimeKind
  runtimeName?: string
  projectId?: string
  acceptedAt: number
  online: boolean
  transportCount: number
  capabilityCount: number
  dependencyKeyCount: number
  requestedToolCount: number
  requestedCapabilityCount: number
  requestedDependencyCount: number
  missingCapabilities: ToolchainRuntimeCapability[]
  missingDependencies: string[]
  blockedReasonCount: number
  errorCode?: ToolchainRuntimePairingErrorCode
  androidCanExecute: false
  runtimeCanExecute: boolean
  usesStreamableHttp: boolean
}
export interface ToolchainAndroidControlPlaneRegisteredToolCard {
  registrationId: string
  toolId: string
  title: string
  kind: ToolchainToolKind
  registrationKind: ToolchainRegistrationKind
  status: ToolchainRegisteredCatalogStatus
  runtimeId?: string
  runtimeKind?: ToolchainRuntimeKind
  androidDisposition: ToolchainAndroidDisposition
  registeredAt: number
  permissionCount: number
  requiredCapabilityCount: number
  transportCount: number
  blockedReasons: string[]
}
export interface ToolchainAndroidControlPlaneRegisteredLaunchCard {
  launchId: string
  registrationId: string
  toolId: string
  taskId: string
  runtimeId: string
  runtimeKind: ToolchainRuntimeKind
  entryType?: ToolchainToolKind
  entryExecutor?: ToolchainToolEntry['executor']
  mcpToolName?: string
  createdAt: number
  status: Extract<ToolchainTaskStatus, 'queued'>
  handoffDelivery: ToolchainRuntimeHandoffDeliveryKind
  hasRuntimePairingAcceptance: boolean
  confirmedIntent: boolean
  payloadKeyCount: number
  permissionCount: number
  dispatchRequiresPairedRuntime: boolean
  dispatchUsesNetworkTransport: boolean
  dispatchUsesStreamableHttp: boolean
  androidCanExecute: boolean
}
export interface ToolchainAndroidControlPlaneSnapshot {
  schema: typeof TOOLCHAIN_ANDROID_CONTROL_PLANE_SCHEMA
  generatedAt: number
  projectId?: string
  installPlanSchema: typeof TOOLCHAIN_INSTALL_PLAN_SCHEMA
  taskCancelRequestSchema: typeof TOOLCHAIN_TASK_CANCEL_REQUEST_SCHEMA
  runtimePairingAcceptanceSchema: typeof TOOLCHAIN_RUNTIME_PAIRING_ACCEPTANCE_SCHEMA
  registeredCatalogSchema: typeof TOOLCHAIN_REGISTERED_CATALOG_SCHEMA
  registrySchema: typeof TOOLCHAIN_REGISTRY_SCHEMA
  doctorSchema: typeof TOOLCHAIN_DOCTOR_SCHEMA
  protocolSchema: typeof TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA
  summary: string
  installCounts: ToolchainInstallPlan['counts']
  registeredCounts: ToolchainRegisteredCatalogSnapshot['counts']
  registryCounts: ToolchainRegistrySnapshot['counts']
  doctorStatus: ToolchainDoctorStatus
  actionBadges: ToolchainAndroidControlPlaneActionBadge[]
  runtimeBadges: ToolchainAndroidControlPlaneRuntimeBadge[]
  toolCards: ToolchainAndroidControlPlaneToolCard[]
  registeredToolCards: ToolchainAndroidControlPlaneRegisteredToolCard[]
  registeredLaunchCards: ToolchainAndroidControlPlaneRegisteredLaunchCard[]
  taskCards: ToolchainAndroidControlPlaneTaskCard[]
  gatewayCards: ToolchainAndroidControlPlaneGatewayCard[]
  pairingAcceptanceCards: ToolchainAndroidControlPlanePairingAcceptanceCard[]
  pairingAcceptanceCounts: {
    total: number
    accepted: number
    rejected: number
  }
  taskCancelCounts: {
    total: number
    available: number
    blocked: number
    terminalTask: number
    runtimeMismatch: number
    runtimeUnavailable: number
    capabilityMissing: number
    invalidTransition: number
  }
  registeredLaunchCounts: {
    total: number
    queued: number
    withPairingEvidence: number
    androidExecutable: number
  }
}
export interface ToolchainAndroidControlPlaneBuildInput extends ToolchainRegistryBuildInput {
  activeTasks?: ToolchainTaskRecord[]
  registrationRecords?: ToolchainRegistrationRecord[]
  registeredLaunches?: ToolchainRegisteredLaunch[]
  gatewaySessions?: ToolchainMcpGatewaySession[]
  pairingAcceptances?: ToolchainRuntimePairingAcceptance[]
}
export interface ToolchainControlPlaneActionRequest {
  schema: typeof TOOLCHAIN_CONTROL_PLANE_ACTION_SCHEMA
  controlPlaneSchema: typeof TOOLCHAIN_ANDROID_CONTROL_PLANE_SCHEMA
  generatedAt: number
  actionId: string
  actionKind: ToolchainInstallActionKind
  route: ToolchainControlPlaneActionRoute
  projectId?: string
  toolIds: string[]
  runtimeIds: string[]
  permissions: ToolchainPermission[]
  dependencies: string[]
  requiresUserInteraction: boolean
  requiresRuntimePairing: boolean
  suggestedTaskStatus?: Extract<ToolchainTaskStatus, 'waiting_for_permission' | 'waiting_for_user'>
  summary: string
}
export interface ToolchainControlPlaneActionRequestCreation {
  ok: boolean
  request?: ToolchainControlPlaneActionRequest
  errorCode?: ToolchainControlPlaneActionErrorCode
  message?: string
}
export type ToolchainPermissionGrantScopeKind = 'paths' | 'networkHosts'
export interface ToolchainPermissionGrantProposal {
  permission: ToolchainPermission
  runtimeId?: string
  projectId?: string
  toolIds: string[]
  requiresScope: boolean
  scopeKinds: ToolchainPermissionGrantScopeKind[]
}
export interface ToolchainRuntimePairingRequest {
  toolIds: string[]
  runtimeIds: string[]
  dependencyKeys: string[]
  capabilityKeys: ToolchainRuntimeCapability[]
  requiresRuntimePairing: true
}
export interface ToolchainRuntimePairingHandshakeInput {
  runtime?: ToolchainRuntimeSnapshot
  runtimeId?: string
  name?: string
  kind?: ToolchainRuntimeKind
  protocolSchema?: string
  online?: boolean
  transports?: ToolchainTransport[]
  capabilities?: ToolchainRuntimeCapability[]
  dependencies?: Record<string, string>
  source?: string
  projectId?: string
  requestedToolIds?: string[]
  requestedCapabilityKeys?: ToolchainRuntimeCapability[]
  requestedDependencyKeys?: string[]
  now?: number
}
export interface ToolchainRuntimePairingHandshake {
  schema: typeof TOOLCHAIN_RUNTIME_PAIRING_HANDSHAKE_SCHEMA
  protocolSchema: string
  generatedAt: number
  handshakeId: string
  runtimeId: string
  runtimeName: string
  runtimeKind: ToolchainRuntimeKind
  online: boolean
  transports: ToolchainTransport[]
  transportCount: number
  capabilities: ToolchainRuntimeCapability[]
  capabilityCount: number
  dependencies: Record<string, string>
  dependencyKeys: string[]
  source?: string
  projectId?: string
  requestedToolIds: string[]
  requestedCapabilityKeys: ToolchainRuntimeCapability[]
  requestedDependencyKeys: string[]
}
export interface ToolchainRuntimePairingAcceptance {
  schema: typeof TOOLCHAIN_RUNTIME_PAIRING_ACCEPTANCE_SCHEMA
  handshakeSchema: typeof TOOLCHAIN_RUNTIME_PAIRING_HANDSHAKE_SCHEMA
  protocolSchema: typeof TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA
  acceptedAt: number
  acceptanceId: string
  handshakeId?: string
  status: ToolchainRuntimePairingAcceptanceStatus
  runtime?: ToolchainRuntimeSnapshot
  runtimeId?: string
  runtimeKind?: ToolchainRuntimeKind
  runtimeName?: string
  source?: string
  projectId?: string
  online: boolean
  transportCount: number
  capabilityCount: number
  dependencyKeys: string[]
  requestedToolIds: string[]
  requestedCapabilityKeys: ToolchainRuntimeCapability[]
  requestedDependencyKeys: string[]
  missingCapabilities: ToolchainRuntimeCapability[]
  missingDependencies: string[]
  blockedReasons: string[]
  errorCode?: ToolchainRuntimePairingErrorCode
  androidCanExecute: false
  runtimeCanExecute: boolean
  usesStreamableHttp: boolean
}
export interface ToolchainRuntimePairingAcceptanceResult {
  ok: boolean
  acceptance: ToolchainRuntimePairingAcceptance
  errorCode?: ToolchainRuntimePairingErrorCode
  message?: string
  blockedReasons: string[]
}
export interface ToolchainManifestReviewRequest {
  toolIds: string[]
  issueCount: number
  blockedReasons: string[]
}
export interface ToolchainControlPlaneActionApplication {
  schema: typeof TOOLCHAIN_CONTROL_PLANE_ACTION_APPLICATION_SCHEMA
  actionSchema: typeof TOOLCHAIN_CONTROL_PLANE_ACTION_SCHEMA
  registrationRecordSchema: typeof TOOLCHAIN_REGISTRATION_RECORD_SCHEMA
  registeredCatalogPersistenceSchema: typeof TOOLCHAIN_REGISTERED_CATALOG_PERSISTENCE_SCHEMA
  intentPreviewSchema: typeof TOOLCHAIN_INTENT_PREVIEW_SCHEMA
  protocolSchema: typeof TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA
  appliedAt: number
  applicationId: string
  actionId: string
  actionKind: ToolchainInstallActionKind
  route: ToolchainControlPlaneActionRoute
  status: ToolchainControlPlaneActionApplicationStatus
  projectId?: string
  toolIds: string[]
  runtimeIds: string[]
  permissions: ToolchainPermission[]
  dependencies: string[]
  nextActionKinds: ToolchainInstallActionKind[]
  suggestedTaskStatus?: Extract<ToolchainTaskStatus, 'waiting_for_permission' | 'waiting_for_user'>
  requiresUserInteraction: boolean
  requiresRuntimePairing: boolean
  registrationRecords: ToolchainRegistrationRecord[]
  registrationEnvelope?: ToolchainRegisteredCatalogPersistenceEnvelope
  permissionGrantProposals: ToolchainPermissionGrantProposal[]
  intentPreviews: ToolchainIntentPreview[]
  runtimePairingRequest?: ToolchainRuntimePairingRequest
  manifestReviewRequest?: ToolchainManifestReviewRequest
  blockedReasons: string[]
  summary: string
}
export interface ToolchainControlPlaneActionApplicationResult {
  ok: boolean
  application?: ToolchainControlPlaneActionApplication
  errorCode?: ToolchainControlPlaneActionApplicationErrorCode
  message?: string
  blockedReasons: string[]
}
export interface ToolchainRegistrationRecord {
  schema: typeof TOOLCHAIN_REGISTRATION_RECORD_SCHEMA
  manifestSchema: typeof TOOLCHAIN_MANIFEST_SCHEMA
  controlPlaneActionSchema: typeof TOOLCHAIN_CONTROL_PLANE_ACTION_SCHEMA
  protocolSchema: typeof TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA
  registrationId: string
  actionId: string
  registeredAt: number
  projectId?: string
  toolId: string
  title: string
  version: string
  kind: ToolchainToolKind
  registrationKind: ToolchainRegistrationKind
  runtimeId?: string
  runtimeKind?: ToolchainRuntimeKind
  androidDisposition: ToolchainAndroidDisposition
  permissions: ToolchainPermission[]
  requiredCapabilities: ToolchainRuntimeCapability[]
  transports: ToolchainTransport[]
}
export interface ToolchainRegistrationRecordCreation {
  ok: boolean
  record?: ToolchainRegistrationRecord
  errorCode?: ToolchainRegistrationErrorCode
  message?: string
  blockedReasons: string[]
}
export interface ToolchainRegisteredCatalogEntry {
  registrationId: string
  toolId: string
  title: string
  version: string
  kind: ToolchainToolKind
  registrationKind: ToolchainRegistrationKind
  status: ToolchainRegisteredCatalogStatus
  runtimeId?: string
  runtimeKind?: ToolchainRuntimeKind
  androidDisposition: ToolchainAndroidDisposition
  registeredAt: number
  permissions: ToolchainPermission[]
  requiredCapabilities: ToolchainRuntimeCapability[]
  transports: ToolchainTransport[]
  blockedReasons: string[]
}
export interface ToolchainRegisteredCatalogSnapshot {
  schema: typeof TOOLCHAIN_REGISTERED_CATALOG_SCHEMA
  registrationRecordSchema: typeof TOOLCHAIN_REGISTRATION_RECORD_SCHEMA
  protocolSchema: typeof TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA
  generatedAt: number
  entryLimit: number
  counts: Record<ToolchainRegisteredCatalogStatus, number> & {
    total: number
    appAction: number
    runtimeTool: number
  }
  entries: ToolchainRegisteredCatalogEntry[]
}
export interface ToolchainRegisteredCatalogPersistenceEnvelope {
  schema: typeof TOOLCHAIN_REGISTERED_CATALOG_PERSISTENCE_SCHEMA
  registrationRecordSchema: typeof TOOLCHAIN_REGISTRATION_RECORD_SCHEMA
  registeredCatalogSchema: typeof TOOLCHAIN_REGISTERED_CATALOG_SCHEMA
  protocolSchema: typeof TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA
  exportedAt: number
  source?: string
  projectId?: string
  recordLimit: number
  recordCount: number
  counts: {
    total: number
    appAction: number
    runtimeTool: number
  }
  records: ToolchainRegistrationRecord[]
}
export interface ToolchainRegisteredCatalogPersistenceImport {
  ok: boolean
  envelope?: ToolchainRegisteredCatalogPersistenceEnvelope
  records: ToolchainRegistrationRecord[]
  acceptedCount: number
  rejectedCount: number
  errorCode?: ToolchainRegisteredCatalogPersistenceErrorCode
  message?: string
}
export interface ToolchainRegisteredExecutionPlan {
  schema: typeof TOOLCHAIN_REGISTERED_EXECUTION_PLAN_SCHEMA
  registrationRecordSchema: typeof TOOLCHAIN_REGISTRATION_RECORD_SCHEMA
  runtimePairingAcceptanceSchema: typeof TOOLCHAIN_RUNTIME_PAIRING_ACCEPTANCE_SCHEMA
  manifestSchema: typeof TOOLCHAIN_MANIFEST_SCHEMA
  protocolSchema: typeof TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA
  generatedAt: number
  registrationId: string
  toolId: string
  title: string
  version: string
  registrationKind: ToolchainRegistrationKind
  status: ToolchainRegisteredExecutionStatus
  runtimeId?: string
  runtimeKind?: ToolchainRuntimeKind
  runtimePairingAcceptanceId?: string
  runtimePairingStatus?: ToolchainRuntimePairingAcceptanceStatus
  androidDisposition: ToolchainAndroidDisposition
  taskStatus?: ToolchainTaskStatus
  handoffDelivery?: ToolchainRuntimeHandoffDeliveryKind
  permissions: ToolchainPermission[]
  missingPermissions: ToolchainPermission[]
  missingDependencies: string[]
  nextActionKinds: ToolchainInstallActionKind[]
  requiresUserConfirmation: boolean
  payloadKeys: string[]
  blockedReasons: string[]
}
export interface ToolchainRegisteredLaunch {
  schema: typeof TOOLCHAIN_REGISTERED_LAUNCH_SCHEMA
  registeredExecutionPlanSchema: typeof TOOLCHAIN_REGISTERED_EXECUTION_PLAN_SCHEMA
  runtimePairingAcceptanceSchema: typeof TOOLCHAIN_RUNTIME_PAIRING_ACCEPTANCE_SCHEMA
  taskRecordSchema: typeof TOOLCHAIN_TASK_RECORD_SCHEMA
  runtimeHandoffSchema: typeof TOOLCHAIN_RUNTIME_HANDOFF_SCHEMA
  createdAt: number
  registrationId: string
  toolId: string
  taskId: string
  runtimeId: string
  runtimeKind: ToolchainRuntimeKind
  runtimePairingAcceptanceId?: string
  status: Extract<ToolchainTaskStatus, 'queued'>
  payloadKeys: string[]
  confirmedIntent: boolean
  taskRecord: ToolchainTaskRecord
  handoff: ToolchainRuntimeHandoff
}
export interface ToolchainRegisteredLaunchCreation {
  ok: boolean
  launch?: ToolchainRegisteredLaunch
  errorCode?: ToolchainRegisteredLaunchErrorCode
  message?: string
  blockedReasons: string[]
}
export interface ToolchainRuntimeReportLog {
  level?: ToolchainTaskLogLevel
  source?: string
  message: unknown
}
export interface ToolchainRuntimeReportArtifact {
  artifactId?: string
  label: string
  kind?: ToolchainTaskArtifactKind
  sizeBytes?: number
  mediaType?: string
  checksum?: string
}
export interface ToolchainRuntimeReport {
  schema: typeof TOOLCHAIN_RUNTIME_REPORT_SCHEMA
  taskId: string
  runtimeId: string
  reportedAt: number
  status?: ToolchainTaskStatus
  statusReason?: string
  gateway?: ToolchainMcpGatewayRuntimeReport
  logs?: ToolchainRuntimeReportLog[]
  artifacts?: ToolchainRuntimeReportArtifact[]
}
export interface ToolchainRuntimeReportApplication {
  ok: boolean
  task: ToolchainTaskRecord
  changed: boolean
  errorCode?: ToolchainRuntimeReportErrorCode
  message?: string
}
export interface ToolchainTaskCancelRequest {
  schema: typeof TOOLCHAIN_TASK_CANCEL_REQUEST_SCHEMA
  taskRecordSchema: typeof TOOLCHAIN_TASK_RECORD_SCHEMA
  protocolSchema: typeof TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA
  requestedAt: number
  taskId: string
  toolId: string
  runtimeId: string
  runtimeKind: ToolchainRuntimeKind
  projectId?: string
  reason?: string
}
export interface ToolchainTaskCancelRequestCreation {
  ok: boolean
  request?: ToolchainTaskCancelRequest
  errorCode?: ToolchainTaskCancelErrorCode
  message?: string
}
export interface ToolchainTaskCancelApplication {
  ok: boolean
  task: ToolchainTaskRecord
  changed: boolean
  errorCode?: ToolchainTaskCancelErrorCode
  message?: string
}
export interface ToolchainRegistryBuildInput {
  manifests?: ToolchainToolManifest[]
  skills?: readonly SkillDefinition[]
  mcpServers?: readonly McpServerConfig[]
  runtimes?: ToolchainRuntimeSnapshot[]
  permissionGrants?: ToolchainPermissionGrant[]
  requestedScopesByToolId?: Record<string, ToolchainScopeRequest>
  source?: string
  projectId?: string
  now?: number
  runtimePreference?: ToolchainRuntimeKind[]
}
