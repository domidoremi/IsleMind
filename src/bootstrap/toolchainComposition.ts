// Concrete toolchain policy composition belongs at the application composition root.
import {
  TOOLCHAIN_CONFIRMATION_PERMISSIONS,
  TOOLCHAIN_ANDROID_CONTROL_PLANE_SCHEMA,
  TOOLCHAIN_CONTROL_PLANE_ACTION_APPLICATION_SCHEMA,
  TOOLCHAIN_CONTROL_PLANE_ACTION_SCHEMA,
  TOOLCHAIN_CONTROL_PLANE_CARD_LIMIT,
  TOOLCHAIN_INTENT_PREVIEW_ITEM_LIMIT,
  TOOLCHAIN_INTENT_PREVIEW_SCHEMA,
  TOOLCHAIN_DOCTOR_SCHEMA,
  TOOLCHAIN_INSTALL_PLAN_SCHEMA,
  TOOLCHAIN_INSTALL_PLAN_STATUSES,
  TOOLCHAIN_INSTALL_ACTION_KINDS,
  TOOLCHAIN_MCP_GATEWAY_SESSION_STATUSES,
  TOOLCHAIN_MANIFEST_SCHEMA,
  TOOLCHAIN_PERMISSIONS,
  TOOLCHAIN_REGISTRY_SCHEMA,
  TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA,
  TOOLCHAIN_RUNTIME_CAPABILITIES,
  TOOLCHAIN_RUNTIME_EVENT_ENTRY_LIMIT,
  TOOLCHAIN_RUNTIME_EVENT_KEY_LIMIT,
  TOOLCHAIN_RUNTIME_KINDS,
  TOOLCHAIN_RUNTIME_PAIRING_ACCEPTANCE_SCHEMA,
  TOOLCHAIN_REGISTERED_CATALOG_STATUSES,
  TOOLCHAIN_REGISTERED_CATALOG_SCHEMA,
  TOOLCHAIN_REGISTERED_CATALOG_RECORD_LIMIT,
  TOOLCHAIN_REGISTERED_CATALOG_PERSISTENCE_SCHEMA,
  TOOLCHAIN_REGISTRATION_KINDS,
  TOOLCHAIN_REGISTRATION_RECORD_SCHEMA,
  TOOLCHAIN_TASK_ARTIFACT_LIMIT,
  TOOLCHAIN_TASK_ARTIFACT_KINDS,
  TOOLCHAIN_TASK_LOG_LIMIT,
  TOOLCHAIN_TASK_LOG_LEVELS,
  TOOLCHAIN_TASK_CANCEL_REQUEST_SCHEMA,
  TOOLCHAIN_TASK_RECORD_SCHEMA,
  TOOLCHAIN_TASK_STATUSES,
  TOOLCHAIN_TOOL_KINDS,
  TOOLCHAIN_TRANSPORTS,
} from '@/modules/integrations'
import type { ToolchainTaskCancelErrorCode } from '@/modules/integrations'
import type {
  ToolchainAndroidControlPlaneSnapshot,
  ToolchainControlPlaneActionApplication,
  ToolchainControlPlaneActionApplicationResult,
  ToolchainControlPlaneActionRequest,
  ToolchainControlPlaneActionRequestCreation,
  ToolchainIntentPreview,
  ToolchainManifestReviewRequest,
  ToolchainPermissionGrantProposal,
  ToolchainRegisteredCatalogPersistenceEnvelope,
  ToolchainRegistrationRecord,
  ToolchainRegistrationRecordCreation,
  ToolchainRegistryBuildInput,
  ToolchainRuntimePairingRequest,
  ToolchainRuntimeSnapshot,
  ToolchainTaskRecord,
  ToolchainToolEntry,
  ToolchainToolManifest,
} from '@/modules/integrations'
import {
  createMcpToolchainManifestAssembly,
  createIntentPreviewPolicy,
  createInstallPlanPolicy,
  createExecutionResolutionPolicy,
  createPortableSkillToolchainManifestAssembly,
  createRuntimeReportTrustPolicy,
  createToolchainDoctorPolicy,
  createToolchainRegistryPolicy,
  createToolchainCountPolicy,
  createAndroidControlPlaneCountPolicy,
  createAndroidControlPlanePresentationPolicy,
  createAndroidControlPlaneTaskCardPolicy,
  createAndroidControlPlaneActionPolicy,
  createAndroidControlPlaneApplicationPolicy,
  createAndroidControlPlaneActionRequestPolicy,
  createAndroidControlPlaneTrustPolicy,
  createTaskCancelPolicy,
  createToolchainTaskPolicy,
  createOfficialToolchainCatalogPolicy,
  createRegisteredCatalogPolicy,
  createRegisteredCatalogPersistencePolicy,
  createRegistrationEventEvidencePolicy,
  validateToolchainManifest,
  createRuntimeHandoffPolicy,
  TOOLCHAIN_RUNTIME_PAIRING_POLICY,
  TOOLCHAIN_RUNTIME_SNAPSHOT_POLICY,
  isUnsafeRuntimePairingText,
  cleanPublicText,
  sanitizeTaskPayloadKey,
  sanitizeTaskPayloadKeyList,
  sanitizeToolchainEndpointReference,
  sanitizeCapabilityList,
  sanitizePermissionList,
} from '@/modules/integrations'
import {
  isAndroidDisposition,
  isControlPlaneActionRoute,
  isControlPlaneHttpTransport,
  isDoctorStatus,
  isHandoffDeliveryKind,
  isInstallActionKind,
  isIntentImpactKind,
  isPermission,
  isInstallPlanStatus,
  isMcpGatewaySessionStatus,
  isResolutionStatus,
  isRuntimeCapability,
  isRuntimeKind,
  isRuntimePairingAcceptanceStatus,
  isRuntimePairingErrorCode,
  isTaskCancelErrorCode,
  isToolKind,
} from '@/modules/integrations'
import { stableIdentityHash, stableIdentityString } from '@/modules/integrations'
import {
  createControlPlaneActionApplicationId,
  createControlPlaneActionId,
  createMcpGatewaySessionIdFromParts,
  createRegisteredLaunchSummaryIdFromParts,
  createRegistrationId,
} from '@/modules/integrations'
import {
  isTaskStatus,
  isTerminalTaskStatus,
  isToolchainTaskStatusAttentionRequired,
} from '@/modules/integrations'
import { sanitizeTaskLogMessage } from '@/modules/integrations'
import {
  sanitizeOptionalTimestamp,
  uniqueTypedList,
} from '@/modules/integrations'
export { TOOLCHAIN_RUNTIME_SNAPSHOT_POLICY } from '@/modules/integrations'

const {
  sanitizeExactStableIdToken,
  sanitizeExactStableIdList,
  sanitizeRuntimePairingDependencyKeyList,
  sanitizeTaskStatusReason,
  sanitizeToolchainMetadataToken,
  satisfiesDependency,
} = TOOLCHAIN_RUNTIME_PAIRING_POLICY

export const TOOLCHAIN_REGISTERED_CATALOG_POLICY = createRegisteredCatalogPolicy({
  schemas: {
    registration: TOOLCHAIN_REGISTRATION_RECORD_SCHEMA,
    manifest: TOOLCHAIN_MANIFEST_SCHEMA,
    action: TOOLCHAIN_CONTROL_PLANE_ACTION_SCHEMA,
    protocol: TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA,
    catalog: TOOLCHAIN_REGISTERED_CATALOG_SCHEMA,
  },
  recordLimit: TOOLCHAIN_REGISTERED_CATALOG_RECORD_LIMIT,
  entryLimit: TOOLCHAIN_CONTROL_PLANE_CARD_LIMIT,
  toolKinds: TOOLCHAIN_TOOL_KINDS,
  registrationKinds: TOOLCHAIN_REGISTRATION_KINDS,
  runtimeKinds: TOOLCHAIN_RUNTIME_KINDS,
  dispositions: ['app-only', 'companion-runtime', 'remote-runtime', 'unavailable'] as const,
  permissions: TOOLCHAIN_PERMISSIONS,
  capabilities: TOOLCHAIN_RUNTIME_CAPABILITIES,
  transports: TOOLCHAIN_TRANSPORTS,
  statuses: {
    ready: 'ready',
    invalid: 'invalid',
    runtimeMissing: 'runtime_missing',
    runtimeOffline: 'runtime_offline',
    protocolMismatch: 'protocol_mismatch',
  },
  appActionRegistrationKind: 'app-action',
  runtimeToolRegistrationKind: 'runtime-tool',
  appActionEntryType: 'app-action',
  appOnlyDisposition: 'app-only',
  androidAppRuntimeId: 'android-app',
  androidAppRuntimeKind: 'android-app',
  createRegistrationId,
  stableIdentityString,
  sanitizeMetadataToken: sanitizeToolchainMetadataToken,
  sanitizeExactStableIdToken,
  inferRequiredCapabilities: (manifest) => TOOLCHAIN_RUNTIME_HANDOFF_POLICY.inferRequiredCapabilities(manifest as ToolchainToolManifest),
  sanitizeControlPlanePublicText: (input) => TOOLCHAIN_INTENT_PREVIEW_POLICY.sanitizeControlPlanePublicText(input),
  sanitizePermissionList,
  sanitizeCapabilityList,
  sanitizeTimestamp: sanitizeOptionalTimestamp,
  createDefaultRuntimes: (now) => createDefaultToolchainRuntimes(now),
  createTrustedRuntimes: (runtimes) => TOOLCHAIN_RUNTIME_SNAPSHOT_POLICY.createTrustedRuntimeSnapshots(runtimes),
  createEmptyCounts: () => TOOLCHAIN_COUNT_POLICY.createEmptyRegisteredCatalogCounts(),
})

export const TOOLCHAIN_REGISTERED_CATALOG_PERSISTENCE_POLICY = createRegisteredCatalogPersistencePolicy<
  ToolchainRegistrationRecord,
  {
    persistence: typeof TOOLCHAIN_REGISTERED_CATALOG_PERSISTENCE_SCHEMA
    registrationRecord: typeof TOOLCHAIN_REGISTRATION_RECORD_SCHEMA
    registeredCatalog: typeof TOOLCHAIN_REGISTERED_CATALOG_SCHEMA
    runtimeProtocol: typeof TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA
  }
>({
  schemas: {
    persistence: TOOLCHAIN_REGISTERED_CATALOG_PERSISTENCE_SCHEMA,
    registrationRecord: TOOLCHAIN_REGISTRATION_RECORD_SCHEMA,
    registeredCatalog: TOOLCHAIN_REGISTERED_CATALOG_SCHEMA,
    runtimeProtocol: TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA,
  },
  recordLimit: TOOLCHAIN_REGISTERED_CATALOG_RECORD_LIMIT,
  sanitizeRecordLimit: TOOLCHAIN_REGISTERED_CATALOG_POLICY.sanitizeRegisteredCatalogRecordLimit,
  normalizeRecords: TOOLCHAIN_REGISTERED_CATALOG_POLICY.normalizeRegisteredCatalogPersistenceRecords,
  createCounts: TOOLCHAIN_REGISTERED_CATALOG_POLICY.createRegisteredCatalogPersistenceCounts,
  sanitizeMetadata: sanitizeToolchainMetadataToken,
  sanitizeTimestamp: sanitizeOptionalTimestamp,
})

const TOOLCHAIN_OFFICIAL_CATALOG_POLICY = createOfficialToolchainCatalogPolicy({
  manifestSchema: TOOLCHAIN_MANIFEST_SCHEMA,
  runtimeProtocolSchema: TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA,
})

export const createToolchainRuntimeSupport = TOOLCHAIN_OFFICIAL_CATALOG_POLICY.createRuntimeSupport
export const TOOLCHAIN_OFFICIAL_TOOLS: ToolchainToolManifest[] = TOOLCHAIN_OFFICIAL_CATALOG_POLICY.officialTools
export const createDefaultToolchainRuntimes: (now?: number) => ToolchainRuntimeSnapshot[] =
  TOOLCHAIN_OFFICIAL_CATALOG_POLICY.createDefaultRuntimes

export const TOOLCHAIN_INTENT_PREVIEW_POLICY = createIntentPreviewPolicy({
  schema: TOOLCHAIN_INTENT_PREVIEW_SCHEMA,
  itemLimit: TOOLCHAIN_INTENT_PREVIEW_ITEM_LIMIT,
  permissions: TOOLCHAIN_PERMISSIONS,
  confirmationPermissions: TOOLCHAIN_CONFIRMATION_PERMISSIONS,
  sanitizeText: sanitizeTaskLogMessage,
})

export const TOOLCHAIN_RUNTIME_REPORT_TRUST_POLICY = createRuntimeReportTrustPolicy({
  schemas: {
    taskRecord: TOOLCHAIN_TASK_RECORD_SCHEMA,
    runtimeProtocol: TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA,
    intentPreview: TOOLCHAIN_INTENT_PREVIEW_SCHEMA,
  },
  limits: {
    logs: TOOLCHAIN_TASK_LOG_LIMIT,
    artifacts: TOOLCHAIN_TASK_ARTIFACT_LIMIT,
    intentItems: TOOLCHAIN_INTENT_PREVIEW_ITEM_LIMIT,
    payloadKeys: 40,
  },
  permissions: TOOLCHAIN_PERMISSIONS,
  confirmationPermissions: TOOLCHAIN_CONFIRMATION_PERMISSIONS,
  resolveOfficialTool: (toolId) => TOOLCHAIN_OFFICIAL_TOOLS.find((tool) => tool.id === toolId),
  isRuntimeKind,
  isTaskStatus,
  isIntentImpactKind,
  intentImpactKindForPermission: TOOLCHAIN_INTENT_PREVIEW_POLICY.intentImpactKindForPermission,
  sanitizePayloadKeyList: sanitizeTaskPayloadKeyList,
  sanitizeStableId: sanitizeExactStableIdToken,
  sanitizeStatusReason: sanitizeTaskStatusReason,
  sanitizeMetadataToken: sanitizeToolchainMetadataToken,
})

export const TOOLCHAIN_MCP_MANIFEST_ASSEMBLY = createMcpToolchainManifestAssembly({
  manifestSchema: TOOLCHAIN_MANIFEST_SCHEMA,
  createRuntimeSupport: createToolchainRuntimeSupport,
  stableIdentityHash,
  sanitizeEndpointReference: sanitizeToolchainEndpointReference,
  sanitizePayloadKey: sanitizeTaskPayloadKey,
  sanitizePublicText: sanitizeToolchainManifestPublicText,
})

export const TOOLCHAIN_PORTABLE_SKILL_MANIFEST_ASSEMBLY = createPortableSkillToolchainManifestAssembly({
  manifestSchema: TOOLCHAIN_MANIFEST_SCHEMA,
  createRuntimeSupport: createToolchainRuntimeSupport,
  stableIdentityHash,
  sanitizePayloadKey: sanitizeTaskPayloadKey,
  sanitizePublicText: sanitizeToolchainManifestPublicText,
})

export const TOOLCHAIN_RUNTIME_HANDOFF_POLICY = createRuntimeHandoffPolicy({
  runtimeCapabilities: TOOLCHAIN_RUNTIME_CAPABILITIES,
  satisfiesDependency,
})

export const TOOLCHAIN_EXECUTION_RESOLUTION_POLICY = createExecutionResolutionPolicy({
  protocolSchema: TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA,
  confirmationPermissions: TOOLCHAIN_CONFIRMATION_PERMISSIONS,
  inferRequiredCapabilities: TOOLCHAIN_RUNTIME_HANDOFF_POLICY.inferRequiredCapabilities,
  missingRuntimeDependencies: TOOLCHAIN_RUNTIME_HANDOFF_POLICY.missingRuntimeDependencies,
  sanitizeMetadataToken: sanitizeToolchainMetadataToken,
  sanitizeTimestamp: sanitizeOptionalTimestamp,
})

export const TOOLCHAIN_INSTALL_PLAN_POLICY = createInstallPlanPolicy({
  statuses: TOOLCHAIN_INSTALL_PLAN_STATUSES,
  permissions: TOOLCHAIN_PERMISSIONS,
  confirmationPermissions: TOOLCHAIN_CONFIRMATION_PERMISSIONS,
  runtimeCapabilities: TOOLCHAIN_RUNTIME_CAPABILITIES,
  limits: {
    entries: TOOLCHAIN_RUNTIME_EVENT_ENTRY_LIMIT,
    keys: TOOLCHAIN_RUNTIME_EVENT_KEY_LIMIT,
    reasons: TOOLCHAIN_INTENT_PREVIEW_ITEM_LIMIT,
  },
  sanitizeStableIdList: sanitizeExactStableIdList,
  sanitizeDependencyKeyList: sanitizeRuntimePairingDependencyKeyList,
})

export const TOOLCHAIN_DOCTOR_POLICY = createToolchainDoctorPolicy({
  permissions: TOOLCHAIN_PERMISSIONS,
  runtimeCapabilities: TOOLCHAIN_RUNTIME_CAPABILITIES,
  runtimeKinds: TOOLCHAIN_RUNTIME_KINDS,
  limits: {
    entries: TOOLCHAIN_RUNTIME_EVENT_ENTRY_LIMIT,
    keys: TOOLCHAIN_RUNTIME_EVENT_KEY_LIMIT,
  },
  sanitizeStableIdList: sanitizeExactStableIdList,
  sanitizeDependencyKeyList: sanitizeRuntimePairingDependencyKeyList,
  sanitizeText: sanitizeTaskLogMessage,
})

export const TOOLCHAIN_COUNT_POLICY = createToolchainCountPolicy({
  resolutionStatuses: ['ready', 'needs_permission', 'waiting_for_user', 'unsupported', 'invalid'],
  androidDispositions: ['app-only', 'companion-runtime', 'remote-runtime', 'unavailable'],
  runtimeKinds: TOOLCHAIN_RUNTIME_KINDS,
  installStatuses: TOOLCHAIN_INSTALL_PLAN_STATUSES,
  installActions: TOOLCHAIN_INSTALL_ACTION_KINDS,
  doctorSeverities: ['info', 'warning', 'error'],
  doctorActions: ['grant-permission', 'pair-runtime', 'upgrade-dependency', 'confirm-intent', 'fix-manifest'],
  intentImpacts: ['file-write', 'mcp-approval', 'secret-use', 'git-change', 'release-change'],
  taskStatuses: TOOLCHAIN_TASK_STATUSES,
  taskLogLevels: TOOLCHAIN_TASK_LOG_LEVELS,
  taskArtifactKinds: TOOLCHAIN_TASK_ARTIFACT_KINDS,
  gatewayStatuses: TOOLCHAIN_MCP_GATEWAY_SESSION_STATUSES,
  pairingStatuses: ['accepted', 'rejected'],
  registeredStatuses: TOOLCHAIN_REGISTERED_CATALOG_STATUSES,
})

export const TOOLCHAIN_ANDROID_CONTROL_PLANE_TRUST_POLICY = createAndroidControlPlaneTrustPolicy<ToolchainAndroidControlPlaneSnapshot>({
  schemas: {
    snapshot: TOOLCHAIN_ANDROID_CONTROL_PLANE_SCHEMA,
    installPlan: TOOLCHAIN_INSTALL_PLAN_SCHEMA,
    taskCancelRequest: TOOLCHAIN_TASK_CANCEL_REQUEST_SCHEMA,
    pairingAcceptance: TOOLCHAIN_RUNTIME_PAIRING_ACCEPTANCE_SCHEMA,
    registeredCatalog: TOOLCHAIN_REGISTERED_CATALOG_SCHEMA,
    registry: TOOLCHAIN_REGISTRY_SCHEMA,
    doctor: TOOLCHAIN_DOCTOR_SCHEMA,
    runtimeProtocol: TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA,
  },
  limits: {
    cards: TOOLCHAIN_CONTROL_PLANE_CARD_LIMIT,
    eventEntries: TOOLCHAIN_RUNTIME_EVENT_ENTRY_LIMIT,
    eventKeys: TOOLCHAIN_RUNTIME_EVENT_KEY_LIMIT,
    reasons: TOOLCHAIN_INTENT_PREVIEW_ITEM_LIMIT,
  },
  installActions: TOOLCHAIN_INSTALL_ACTION_KINDS,
  installStatuses: TOOLCHAIN_INSTALL_PLAN_STATUSES,
  permissions: TOOLCHAIN_PERMISSIONS,
  runtimeCapabilities: TOOLCHAIN_RUNTIME_CAPABILITIES,
  registrationKinds: TOOLCHAIN_REGISTRATION_KINDS,
  registeredStatuses: TOOLCHAIN_REGISTERED_CATALOG_STATUSES,
  countPolicy: {
    buildAndroidControlPlaneEventSummary: (snapshot) => TOOLCHAIN_ANDROID_CONTROL_PLANE_COUNT_POLICY.buildAndroidControlPlaneEventSummary(snapshot),
    controlPlaneInstallCountsCanRepresentCards: (counts, cards) => TOOLCHAIN_ANDROID_CONTROL_PLANE_COUNT_POLICY.controlPlaneInstallCountsCanRepresentCards(counts, cards),
    controlPlaneRegisteredCountsCanRepresentCards: (counts, cards) => TOOLCHAIN_ANDROID_CONTROL_PLANE_COUNT_POLICY.controlPlaneRegisteredCountsCanRepresentCards(counts, cards),
    controlPlaneRegistryCountsCanRepresentCards: (counts, cards) => TOOLCHAIN_ANDROID_CONTROL_PLANE_COUNT_POLICY.controlPlaneRegistryCountsCanRepresentCards(counts, cards),
    controlPlaneRegisteredLaunchCountsEqual: (left, right) => TOOLCHAIN_ANDROID_CONTROL_PLANE_COUNT_POLICY.controlPlaneRegisteredLaunchCountsEqual(left, right),
    controlPlaneTaskCancelCountsEqual: (left, right) => TOOLCHAIN_ANDROID_CONTROL_PLANE_COUNT_POLICY.controlPlaneTaskCancelCountsEqual(left, right),
    controlPlanePairingAcceptanceCountsEqual: (left, right) => TOOLCHAIN_ANDROID_CONTROL_PLANE_COUNT_POLICY.controlPlanePairingAcceptanceCountsEqual(left, right),
    createControlPlaneRegisteredLaunchCounts: (cards) => TOOLCHAIN_ANDROID_CONTROL_PLANE_COUNT_POLICY.createControlPlaneRegisteredLaunchCounts(cards),
    createControlPlaneTaskCancelCounts: (cards) => TOOLCHAIN_ANDROID_CONTROL_PLANE_COUNT_POLICY.createControlPlaneTaskCancelCounts(cards),
    createControlPlanePairingAcceptanceCounts: (cards) => TOOLCHAIN_ANDROID_CONTROL_PLANE_COUNT_POLICY.createControlPlanePairingAcceptanceCounts(cards),
  },
  sanitizeStableId: sanitizeExactStableIdToken,
  sanitizeDependencyKeys: sanitizeRuntimePairingDependencyKeyList,
  sanitizeDisplayText: TOOLCHAIN_RUNTIME_PAIRING_POLICY.sanitizeRuntimePairingDisplayText,
  sanitizeOptionalToken: TOOLCHAIN_RUNTIME_PAIRING_POLICY.sanitizeRuntimePairingOptionalToken,
  stableIdentityString,
  createGatewaySessionId: createMcpGatewaySessionIdFromParts,
  createRegisteredLaunchId: createRegisteredLaunchSummaryIdFromParts,
  isAndroidDisposition,
  isDoctorStatus,
  isHandoffDelivery: isHandoffDeliveryKind,
  isInstallAction: isInstallActionKind,
  isInstallStatus: isInstallPlanStatus,
  isMcpGatewayStatus: isMcpGatewaySessionStatus,
  isPermission,
  isResolutionStatus,
  isRuntimeCapability,
  isRuntimeKind,
  isPairingStatus: isRuntimePairingAcceptanceStatus,
  isPairingError: isRuntimePairingErrorCode,
  isTaskCancelError: isTaskCancelErrorCode,
  isToolKind,
  isHttpTransport: isControlPlaneHttpTransport,
})

export const TOOLCHAIN_REGISTRY_POLICY = createToolchainRegistryPolicy({
  schemas: {
    registry: TOOLCHAIN_REGISTRY_SCHEMA,
    manifest: TOOLCHAIN_MANIFEST_SCHEMA,
    protocol: TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA,
    installPlan: TOOLCHAIN_INSTALL_PLAN_SCHEMA,
    doctor: TOOLCHAIN_DOCTOR_SCHEMA,
  },
  limits: {
    registryEntries: 80,
    eventEntries: TOOLCHAIN_RUNTIME_EVENT_ENTRY_LIMIT,
    eventKeys: TOOLCHAIN_RUNTIME_EVENT_KEY_LIMIT,
  },
  officialTools: TOOLCHAIN_OFFICIAL_TOOLS,
  executionPolicy: TOOLCHAIN_EXECUTION_RESOLUTION_POLICY,
  installPolicy: TOOLCHAIN_INSTALL_PLAN_POLICY,
  doctorPolicy: TOOLCHAIN_DOCTOR_POLICY,
  createEmptyInstallPlanCounts: TOOLCHAIN_COUNT_POLICY.createEmptyInstallPlanCounts,
  createSkillManifests: TOOLCHAIN_PORTABLE_SKILL_MANIFEST_ASSEMBLY.createToolchainManifestsFromPortableSkills,
  createMcpManifests: TOOLCHAIN_MCP_MANIFEST_ASSEMBLY.createToolchainManifestsFromMcpServers,
  createDefaultRuntimes: (now) => createDefaultToolchainRuntimes(now),
  createTrustedRuntimes: (runtimes) => TOOLCHAIN_RUNTIME_SNAPSHOT_POLICY.createTrustedRuntimeSnapshots(runtimes),
  sanitizeTimestamp: sanitizeOptionalTimestamp,
  sanitizeMetadataToken: sanitizeToolchainMetadataToken,
  sanitizeDependencyKeys: sanitizeRuntimePairingDependencyKeyList,
})

export const TOOLCHAIN_ANDROID_CONTROL_PLANE_COUNT_POLICY = createAndroidControlPlaneCountPolicy({
  cardLimit: TOOLCHAIN_CONTROL_PLANE_CARD_LIMIT,
  installStatuses: TOOLCHAIN_INSTALL_PLAN_STATUSES,
  registeredStatuses: TOOLCHAIN_REGISTERED_CATALOG_STATUSES,
  createEmptyInstallPlanCounts: TOOLCHAIN_COUNT_POLICY.createEmptyInstallPlanCounts,
  createEmptyRegisteredCatalogCounts: TOOLCHAIN_COUNT_POLICY.createEmptyRegisteredCatalogCounts,
  createEmptyRegistrySnapshotCounts: TOOLCHAIN_COUNT_POLICY.createEmptyRegistrySnapshotCounts,
  installPlanCountsAreInternallyValid: TOOLCHAIN_INSTALL_PLAN_POLICY.installPlanCountsAreInternallyValid,
  registeredCatalogCountsAreInternallyValid: TOOLCHAIN_COUNT_POLICY.registeredCatalogCountsAreInternallyValid,
  registrySnapshotCountsAreInternallyValid: TOOLCHAIN_COUNT_POLICY.registrySnapshotCountsAreInternallyValid,
})

const {
  createTrustedRuntimeSnapshots,
  isTrustedRuntimeSnapshot,
} = TOOLCHAIN_RUNTIME_SNAPSHOT_POLICY

export const TOOLCHAIN_TASK_POLICY = createToolchainTaskPolicy({
  schemas: {
    intentPreview: TOOLCHAIN_INTENT_PREVIEW_SCHEMA,
    runtimeProtocol: TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA,
    taskRecord: TOOLCHAIN_TASK_RECORD_SCHEMA,
  },
  permissions: TOOLCHAIN_PERMISSIONS,
  limits: {
    logs: TOOLCHAIN_TASK_LOG_LIMIT,
    artifacts: TOOLCHAIN_TASK_ARTIFACT_LIMIT,
  },
  untrustedRuntimeKind: 'remote',
  isTrustedRuntimeSnapshot,
})

export const {
  createToolchainTaskRequest,
  createToolchainConfirmedTaskRequest,
  createToolchainTaskRecord,
  appendToolchainTaskLog,
  attachToolchainTaskArtifact,
  transitionToolchainTask,
  expireStaleToolchainTask,
} = TOOLCHAIN_TASK_POLICY

export const TOOLCHAIN_TASK_CANCEL_POLICY = createTaskCancelPolicy<
  ToolchainTaskRecord['status'],
  ToolchainRuntimeSnapshot['kind'],
  {
    cancelRequest: typeof TOOLCHAIN_TASK_CANCEL_REQUEST_SCHEMA
    taskRecord: typeof TOOLCHAIN_TASK_RECORD_SCHEMA
    runtimeProtocol: typeof TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA
  },
  ToolchainTaskRecord,
  ToolchainRuntimeSnapshot
>({
  schemas: {
    cancelRequest: TOOLCHAIN_TASK_CANCEL_REQUEST_SCHEMA,
    taskRecord: TOOLCHAIN_TASK_RECORD_SCHEMA,
    runtimeProtocol: TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA,
  },
  cancelCapability: 'task.cancel',
  cancelledStatus: 'cancelled',
  untrustedRuntimeKind: 'remote',
  isRuntimeKind,
  isTrustedTask: TOOLCHAIN_RUNTIME_REPORT_TRUST_POLICY.isTrustedRuntimeReportApplicationTask,
  isTerminalTaskStatus,
  isTrustedRuntime: isTrustedRuntimeSnapshot,
  sanitizeStableId: sanitizeExactStableIdToken,
  sanitizeMetadataToken: sanitizeToolchainMetadataToken,
  sanitizeStatusReason: sanitizeTaskStatusReason,
  transitionTask: transitionToolchainTask,
})

export const TOOLCHAIN_ANDROID_CONTROL_PLANE_PRESENTATION_POLICY = createAndroidControlPlanePresentationPolicy<ToolchainRuntimeSnapshot>({
  cardLimit: TOOLCHAIN_CONTROL_PLANE_CARD_LIMIT,
  actionToolIdLimit: TOOLCHAIN_RUNTIME_EVENT_ENTRY_LIMIT,
  actionBadgeLimit: TOOLCHAIN_RUNTIME_EVENT_KEY_LIMIT,
  runtimeProtocolSchema: TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA,
  createTrustedRuntimeSnapshots: (runtimes) => createTrustedRuntimeSnapshots([...runtimes]),
  sanitizeStableIdList: sanitizeExactStableIdList,
  sanitizeDependencyKeyList: sanitizeRuntimePairingDependencyKeyList,
})

export const TOOLCHAIN_ANDROID_CONTROL_PLANE_TASK_CARD_POLICY = createAndroidControlPlaneTaskCardPolicy<
  ToolchainTaskRecord,
  ToolchainRuntimeSnapshot,
  ToolchainTaskRecord['status'],
  ToolchainRuntimeSnapshot['kind'],
  typeof TOOLCHAIN_TASK_CANCEL_REQUEST_SCHEMA,
  ToolchainTaskCancelErrorCode
>({
  cardLimit: TOOLCHAIN_CONTROL_PLANE_CARD_LIMIT,
  taskCancelSchema: TOOLCHAIN_TASK_CANCEL_REQUEST_SCHEMA,
  runtimeProtocolSchema: TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA,
  cancelCapability: 'task.cancel',
  expiredStatus: 'expired',
  isTrustedTask: TOOLCHAIN_RUNTIME_REPORT_TRUST_POLICY.isTrustedRuntimeReportApplicationTask,
  isTerminalTaskStatus,
  isTaskStatusAttentionRequired: isToolchainTaskStatusAttentionRequired,
  createTaskCancelRequest: ({ task, runtime, now }) => TOOLCHAIN_TASK_CANCEL_POLICY.createToolchainTaskCancelRequest({ task, runtime, now }),
})

export const TOOLCHAIN_ANDROID_CONTROL_PLANE_ACTION_POLICY = createAndroidControlPlaneActionPolicy<
  ToolchainAndroidControlPlaneSnapshot,
  ToolchainToolManifest,
  ToolchainControlPlaneActionRequest,
  ToolchainRegistrationRecord,
  ToolchainRegisteredCatalogPersistenceEnvelope,
  ToolchainPermissionGrantProposal,
  ToolchainIntentPreview,
  ToolchainRuntimePairingRequest,
  ToolchainManifestReviewRequest,
  ToolchainControlPlaneActionApplication,
  ToolchainControlPlaneActionApplicationResult,
  typeof TOOLCHAIN_CONTROL_PLANE_ACTION_SCHEMA,
  typeof TOOLCHAIN_ANDROID_CONTROL_PLANE_SCHEMA,
  typeof TOOLCHAIN_CONTROL_PLANE_ACTION_APPLICATION_SCHEMA,
  typeof TOOLCHAIN_REGISTRATION_RECORD_SCHEMA,
  typeof TOOLCHAIN_REGISTERED_CATALOG_PERSISTENCE_SCHEMA,
  typeof TOOLCHAIN_INTENT_PREVIEW_SCHEMA
>({
  actionKinds: TOOLCHAIN_INSTALL_ACTION_KINDS,
  confirmationPermissions: TOOLCHAIN_CONFIRMATION_PERMISSIONS,
  limits: {
    entries: TOOLCHAIN_RUNTIME_EVENT_ENTRY_LIMIT,
    keys: TOOLCHAIN_RUNTIME_EVENT_KEY_LIMIT,
  },
  schemas: {
    action: TOOLCHAIN_CONTROL_PLANE_ACTION_SCHEMA,
    snapshot: TOOLCHAIN_ANDROID_CONTROL_PLANE_SCHEMA,
    application: TOOLCHAIN_CONTROL_PLANE_ACTION_APPLICATION_SCHEMA,
    registrationRecord: TOOLCHAIN_REGISTRATION_RECORD_SCHEMA,
    persistence: TOOLCHAIN_REGISTERED_CATALOG_PERSISTENCE_SCHEMA,
    intentPreview: TOOLCHAIN_INTENT_PREVIEW_SCHEMA,
    protocol: TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA,
  },
  createApplicationId: createControlPlaneActionApplicationId,
  stableIdentityString,
  inferRequiredCapabilities: TOOLCHAIN_RUNTIME_HANDOFF_POLICY.inferRequiredCapabilities,
  validateManifest: (input) => validateToolchainManifest(input) as ReturnType<typeof validateToolchainManifest> & { sanitized: ToolchainToolManifest },
  sanitizeStableIdList: sanitizeExactStableIdList,
  sanitizeDependencyKeyList: sanitizeRuntimePairingDependencyKeyList,
  sanitizePublicText: TOOLCHAIN_INTENT_PREVIEW_POLICY.sanitizeControlPlanePublicText,
  sanitizeReasonList: TOOLCHAIN_INTENT_PREVIEW_POLICY.sanitizeControlPlaneReasonList,
  uniquePermissions: (input) => uniqueTypedList(input, TOOLCHAIN_PERMISSIONS),
})

export const TOOLCHAIN_ANDROID_CONTROL_PLANE_ACTION_REQUEST_POLICY = createAndroidControlPlaneActionRequestPolicy<
  ToolchainAndroidControlPlaneSnapshot,
  ToolchainControlPlaneActionRequest,
  ToolchainControlPlaneActionRequestCreation,
  typeof TOOLCHAIN_CONTROL_PLANE_ACTION_SCHEMA
>({
  actionSchema: TOOLCHAIN_CONTROL_PLANE_ACTION_SCHEMA,
  actionKinds: TOOLCHAIN_INSTALL_ACTION_KINDS,
  eventEntryLimit: TOOLCHAIN_RUNTIME_EVENT_ENTRY_LIMIT,
  selectToolCards: TOOLCHAIN_ANDROID_CONTROL_PLANE_ACTION_POLICY.selectControlPlaneActionToolCards,
  routeForAction: TOOLCHAIN_ANDROID_CONTROL_PLANE_ACTION_POLICY.routeForControlPlaneAction,
  permissionsForAction: TOOLCHAIN_ANDROID_CONTROL_PLANE_ACTION_POLICY.permissionsForControlPlaneAction,
  suggestedTaskStatus: TOOLCHAIN_ANDROID_CONTROL_PLANE_ACTION_POLICY.suggestedTaskStatusForControlPlaneAction,
  buildActionSummary: TOOLCHAIN_ANDROID_CONTROL_PLANE_ACTION_POLICY.buildControlPlaneActionSummary,
  createFailure: TOOLCHAIN_ANDROID_CONTROL_PLANE_ACTION_POLICY.createControlPlaneActionFailure,
  createActionId: createControlPlaneActionId,
  sanitizeStableIds: sanitizeExactStableIdList,
  sanitizeDependencyKeys: sanitizeRuntimePairingDependencyKeyList,
  sanitizeTimestamp: sanitizeOptionalTimestamp,
  isTrustedSnapshot: TOOLCHAIN_ANDROID_CONTROL_PLANE_TRUST_POLICY.isTrustedSnapshot,
})

export const TOOLCHAIN_REGISTRATION_EVENT_EVIDENCE_POLICY = createRegistrationEventEvidencePolicy({
  limits: {
    eventEntries: TOOLCHAIN_RUNTIME_EVENT_ENTRY_LIMIT,
    eventKeys: TOOLCHAIN_RUNTIME_EVENT_KEY_LIMIT,
    intentItems: TOOLCHAIN_INTENT_PREVIEW_ITEM_LIMIT,
  },
  permissions: TOOLCHAIN_PERMISSIONS,
  runtimeCapabilities: TOOLCHAIN_RUNTIME_CAPABILITIES,
  registrationKinds: TOOLCHAIN_REGISTRATION_KINDS,
  registeredCatalogStatuses: TOOLCHAIN_REGISTERED_CATALOG_STATUSES,
  installActionKinds: TOOLCHAIN_INSTALL_ACTION_KINDS,
  sanitizeStableId: sanitizeExactStableIdToken,
  sanitizeDependencyKeys: sanitizeRuntimePairingDependencyKeyList,
  sanitizePairingToolIds: TOOLCHAIN_RUNTIME_PAIRING_POLICY.sanitizeRuntimePairingToolIdList,
  sanitizeCapabilities: sanitizeCapabilityList,
  cleanPublicText,
  isUnsafePublicText: isUnsafeRuntimePairingText,
  stableIdentityString,
  isVersion: (input) => typeof input === 'string' && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(input),
  isPermission,
  isInstallActionKind,
  isToolKind,
  isRuntimeKind,
  isAndroidDisposition,
  isTrustedRuntimeCapabilityList: TOOLCHAIN_RUNTIME_SNAPSHOT_POLICY.isTrustedRuntimeCapabilityList,
  isTrustedRuntimeTransportList: TOOLCHAIN_RUNTIME_SNAPSHOT_POLICY.isTrustedRuntimeTransportList,
  permissionGrantScopeKinds: (permission) => TOOLCHAIN_ANDROID_CONTROL_PLANE_ACTION_POLICY.permissionGrantScopeKinds(permission as never),
})

export const TOOLCHAIN_ANDROID_CONTROL_PLANE_APPLICATION_POLICY = createAndroidControlPlaneApplicationPolicy<
  ToolchainControlPlaneActionRequest,
  NonNullable<ToolchainRegistryBuildInput['skills']>[number],
  NonNullable<ToolchainRegistryBuildInput['mcpServers']>[number],
  ToolchainRuntimeSnapshot,
  ToolchainRegistrationRecord,
  ToolchainRegisteredCatalogPersistenceEnvelope,
  ToolchainPermissionGrantProposal,
  ToolchainIntentPreview,
  ToolchainRuntimePairingRequest,
  ToolchainManifestReviewRequest,
  ToolchainControlPlaneActionApplicationResult
>({
  schemas: {
    action: TOOLCHAIN_CONTROL_PLANE_ACTION_SCHEMA,
    controlPlane: TOOLCHAIN_ANDROID_CONTROL_PLANE_SCHEMA,
    runtimeProtocol: TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA,
  },
  limits: {
    eventEntries: TOOLCHAIN_RUNTIME_EVENT_ENTRY_LIMIT,
    eventKeys: TOOLCHAIN_RUNTIME_EVENT_KEY_LIMIT,
  },
  actionPolicy: TOOLCHAIN_ANDROID_CONTROL_PLANE_ACTION_POLICY,
  createBuildManifests: TOOLCHAIN_REGISTRY_POLICY.createBuildManifests,
  resolveExecution: TOOLCHAIN_REGISTRY_POLICY.resolveExecution,
  resolveAndroidDisposition: TOOLCHAIN_EXECUTION_RESOLUTION_POLICY.resolveAndroidDisposition,
  createIntentPreview: TOOLCHAIN_INTENT_PREVIEW_POLICY.createToolchainIntentPreview,
  createPersistenceEnvelope: TOOLCHAIN_REGISTERED_CATALOG_PERSISTENCE_POLICY.createEnvelope,
  createRegistrationRecord: TOOLCHAIN_REGISTERED_CATALOG_POLICY.createRegistrationRecord,
  createRegistrationFailure: (errorCode, message, blockedReasons) =>
    TOOLCHAIN_REGISTERED_CATALOG_POLICY.createRegistrationFailure(errorCode, message, blockedReasons) as ToolchainRegistrationRecordCreation,
  createDefaultRuntimes: (now) => createDefaultToolchainRuntimes(now),
  createTrustedRuntimes: TOOLCHAIN_RUNTIME_SNAPSHOT_POLICY.createTrustedRuntimeSnapshots,
  isTrustedRuntime: TOOLCHAIN_RUNTIME_SNAPSHOT_POLICY.isTrustedRuntimeSnapshot,
  createActionId: createControlPlaneActionId,
  isInstallActionKind,
  isControlPlaneActionRoute,
  isTrustedStableIdList: TOOLCHAIN_REGISTRATION_EVENT_EVIDENCE_POLICY.isTrustedStableIdList,
  isTrustedPermissionList: TOOLCHAIN_REGISTRATION_EVENT_EVIDENCE_POLICY.isTrustedPermissionList,
  isTrustedDependencyList: TOOLCHAIN_REGISTRATION_EVENT_EVIDENCE_POLICY.isTrustedDependencyKeyList,
  sanitizeStableId: sanitizeExactStableIdToken,
  sanitizeMetadata: sanitizeToolchainMetadataToken,
  runtimeAvailabilityReasons: TOOLCHAIN_RUNTIME_PAIRING_POLICY.runtimeAvailabilityReasons,
  runtimeHandoffBlockedReasons: TOOLCHAIN_RUNTIME_HANDOFF_POLICY.runtimeHandoffBlockedReasons,
  sanitizeTimestamp: sanitizeOptionalTimestamp,
})

function sanitizeToolchainManifestPublicText(input: unknown): string | undefined {
  const sanitized = sanitizeTaskLogMessage(input)
  if (!sanitized.message || sanitized.redacted || isUnsafeRuntimePairingText(sanitized.message)) return undefined
  return sanitized.message
}

function isToolchainToolEntryExecutor(input: unknown): input is NonNullable<ToolchainToolEntry['executor']> {
  return input === 'app' || input === 'cli' || input === 'mcp' || input === 'remote'
}

function isNonTerminalTaskCancelErrorCode(input: unknown): input is ToolchainTaskCancelErrorCode {
  return input === 'runtime_mismatch' ||
    input === 'runtime_unavailable' ||
    input === 'capability_missing' ||
    input === 'invalid_transition'
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : undefined
}

function hasOnlyAllowedKeys(input: unknown, allowedKeys: readonly string[]): boolean {
  const record = asRecord(input)
  if (!record) return false
  const allowed = new Set(allowedKeys)
  return Object.keys(record).every((key) => allowed.has(key))
}
