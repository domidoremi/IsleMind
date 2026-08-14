// The live lifecycle event path is composed once at the application boundary.
import {
  createExecutionEventAdmissionPolicy,
  createLifecycleEventAdmissionPolicy,
  createLifecycleEventDataPolicy,
  createTaskPayloadKeys,
  hasUniqueStrings,
  isTrustedTaskLifecycleArtifact,
  isTrustedTaskLifecycleLogEntry,
  isUnsafeRuntimePairingText,
  resolveMcpGatewayTransport,
  sanitizeCapabilityList,
  sanitizeMcpGatewayEndpoint,
  sanitizeMcpToolReference,
  sanitizeRuntimeEventTrigger,
  sanitizeTaskPayloadKeyList,
  sanitizeToolCommandReference,
  TOOLCHAIN_RUNTIME_PAIRING_POLICY,
} from '@/modules/integrations'
import {
  TOOLCHAIN_CONFIRMATION_PERMISSIONS,
  TOOLCHAIN_INTENT_PREVIEW_ITEM_LIMIT,
  TOOLCHAIN_INTENT_PREVIEW_SCHEMA,
  TOOLCHAIN_MANIFEST_SCHEMA,
  TOOLCHAIN_MCP_GATEWAY_SESSION_SCHEMA,
  TOOLCHAIN_PERMISSIONS,
  TOOLCHAIN_REGISTERED_EXECUTION_PLAN_SCHEMA,
  TOOLCHAIN_REGISTERED_LAUNCH_SCHEMA,
  TOOLCHAIN_RUNTIME_CAPABILITIES,
  TOOLCHAIN_RUNTIME_EVENT_KEY_LIMIT,
  TOOLCHAIN_RUNTIME_HANDOFF_SCHEMA,
  TOOLCHAIN_RUNTIME_PAIRING_ACCEPTANCE_SCHEMA,
  TOOLCHAIN_RUNTIME_PAIRING_HANDSHAKE_SCHEMA,
  TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA,
  TOOLCHAIN_RUNTIME_REPORT_SCHEMA,
  TOOLCHAIN_TASK_RECORD_SCHEMA,
  TOOLCHAIN_TRANSPORTS,
} from '@/modules/integrations'
import type { ToolchainPermission } from '@/modules/integrations'
import {
  TOOLCHAIN_INTENT_PREVIEW_POLICY,
  TOOLCHAIN_OFFICIAL_TOOLS,
  TOOLCHAIN_REGISTRATION_EVENT_EVIDENCE_POLICY,
  TOOLCHAIN_RUNTIME_HANDOFF_POLICY,
  TOOLCHAIN_RUNTIME_REPORT_TRUST_POLICY,
  TOOLCHAIN_RUNTIME_SNAPSHOT_POLICY,
} from '@/bootstrap/toolchainComposition'
import {
  isHandoffDeliveryKind,
  isMcpGatewaySessionStatus,
  isRuntimeKind,
  isRuntimePairingAcceptanceStatus,
  isRuntimePairingErrorCode,
  isToolKind,
  isTransport,
} from '@/modules/integrations'
import { createRuntimePairingAcceptanceId } from '@/modules/integrations'
import { stableIdentityString } from '@/modules/integrations'
import { sanitizeOptionalNonNegativeNumber, uniqueTypedList } from '@/modules/integrations'
import type { ToolchainTaskRequest, ToolchainToolManifest } from '@/modules/integrations'

const {
  sanitizeExactStableIdToken,
  sanitizeMcpGatewayServerName,
  sanitizeRuntimePairingDependencyKeyList,
  sanitizeRuntimePairingDependencyMap,
  sanitizeRuntimePairingDisplayText,
  sanitizeRuntimePairingOptionalToken,
  sanitizeRuntimePairingToolIdList,
  sanitizeToolchainMetadataToken,
} = TOOLCHAIN_RUNTIME_PAIRING_POLICY

const executionAdmission = createExecutionEventAdmissionPolicy({
  schemas: {
    runtimeProtocol: TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA,
    runtimeHandoff: TOOLCHAIN_RUNTIME_HANDOFF_SCHEMA,
    manifest: TOOLCHAIN_MANIFEST_SCHEMA,
    taskRecord: TOOLCHAIN_TASK_RECORD_SCHEMA,
  },
  permissions: TOOLCHAIN_PERMISSIONS,
  runtimeCapabilities: TOOLCHAIN_RUNTIME_CAPABILITIES,
  hasOnlyAllowedKeys,
  stableIdentityString,
  sanitizeStableId: sanitizeExactStableIdToken,
  sanitizeMetadata: sanitizeToolchainMetadataToken,
  sanitizeCommandRef: sanitizeToolCommandReference,
  sanitizeMcpToolRef: sanitizeMcpToolReference,
  sanitizeEndpointRef: TOOLCHAIN_RUNTIME_HANDOFF_POLICY.sanitizeRuntimeHandoffEndpointRef,
  isTrustedTaskId,
  isRuntimeKind,
  isToolKind,
  isTransport,
  isHandoffDeliveryKind,
  isTrustedConfirmedIntent,
  isTrustedTaskPayloadKeyList,
  sanitizeTaskPayloadKeyList,
  createTaskPayloadKeys,
  uniqueAllowedList: (input, allowed) => uniqueTypedList(input, allowed),
  findOfficialManifest: (toolId) => TOOLCHAIN_OFFICIAL_TOOLS.find((manifest) => manifest.id === toolId),
  inferRequiredCapabilities: (manifest) => TOOLCHAIN_RUNTIME_HANDOFF_POLICY.inferRequiredCapabilities(
    manifest as unknown as ToolchainToolManifest,
  ),
  createRuntimeHandoffEntryRef: (manifest) => TOOLCHAIN_RUNTIME_HANDOFF_POLICY.createRuntimeHandoffEntryRef(
    manifest as unknown as ToolchainToolManifest,
  ),
})

const admission = createLifecycleEventAdmissionPolicy({
  schemas: {
    registeredLaunch: TOOLCHAIN_REGISTERED_LAUNCH_SCHEMA,
    registeredExecutionPlan: TOOLCHAIN_REGISTERED_EXECUTION_PLAN_SCHEMA,
    runtimePairingAcceptance: TOOLCHAIN_RUNTIME_PAIRING_ACCEPTANCE_SCHEMA,
    runtimePairingHandshake: TOOLCHAIN_RUNTIME_PAIRING_HANDSHAKE_SCHEMA,
    taskRecord: TOOLCHAIN_TASK_RECORD_SCHEMA,
    runtimeHandoff: TOOLCHAIN_RUNTIME_HANDOFF_SCHEMA,
    runtimeProtocol: TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA,
    runtimeReport: TOOLCHAIN_RUNTIME_REPORT_SCHEMA,
    mcpGatewaySession: TOOLCHAIN_MCP_GATEWAY_SESSION_SCHEMA,
  },
  eventKeyLimit: TOOLCHAIN_RUNTIME_EVENT_KEY_LIMIT,
  taskPayloadKeyLimit: 40,
  hasOnlyAllowedKeys,
  sanitizeStableId: sanitizeExactStableIdToken,
  sanitizeMetadataToken: sanitizeToolchainMetadataToken,
  sanitizeOptionalNonNegativeNumber,
  sanitizeTaskPayloadKeys: sanitizeTaskPayloadKeyList,
  sanitizeRuntimeDisplayText: sanitizeRuntimePairingDisplayText,
  sanitizeRuntimeOptionalToken: sanitizeRuntimePairingOptionalToken,
  sanitizeRuntimeToolIds: sanitizeRuntimePairingToolIdList,
  sanitizeRuntimeDependencyKeys: sanitizeRuntimePairingDependencyKeyList,
  sanitizeRuntimeDependencyMap: sanitizeRuntimePairingDependencyMap,
  sanitizeRuntimeCapabilities: sanitizeCapabilityList,
  sanitizeRuntimeTransports: (input) => uniqueTypedList(Array.isArray(input) ? input : [], TOOLCHAIN_TRANSPORTS),
  stableIdentityString,
  isUnsafePublicText: (input) => typeof input === 'string' && isUnsafeRuntimePairingText(input),
  isRuntimeKind,
  isPairingAcceptanceStatus: isRuntimePairingAcceptanceStatus,
  isPairingErrorCode: isRuntimePairingErrorCode,
  isMcpGatewaySessionStatus,
  isTrustedBlockedReasons: TOOLCHAIN_REGISTRATION_EVENT_EVIDENCE_POLICY.isTrustedBlockedReasons,
  isTrustedTask: TOOLCHAIN_RUNTIME_REPORT_TRUST_POLICY.isTrustedRuntimeReportApplicationTask,
  isTrustedRuntimeHandoff: executionAdmission.isTrustedRuntimeHandoff,
  isTrustedRuntimeSnapshot: TOOLCHAIN_RUNTIME_SNAPSHOT_POLICY.isTrustedRuntimeSnapshot,
  isTrustedTaskLifecycleLogEntry,
  isTrustedTaskLifecycleArtifact,
  hasUniqueStrings,
  createRuntimePairingAcceptanceId,
  resolveMcpGatewayTransport: (input) => resolveMcpGatewayTransport(typeof input === 'string' ? input : undefined),
  sanitizeMcpGatewayServerName,
  sanitizeMcpGatewayEndpoint: (input, transport) => sanitizeMcpGatewayEndpoint(typeof input === 'string' ? input : '', transport),
})

export const TOOLCHAIN_LIFECYCLE_EVENT_POLICY = Object.freeze({
  ...admission,
  ...createLifecycleEventDataPolicy({
    schemas: {
      taskRecord: TOOLCHAIN_TASK_RECORD_SCHEMA,
      runtimeProtocol: TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA,
      runtimePairingAcceptance: TOOLCHAIN_RUNTIME_PAIRING_ACCEPTANCE_SCHEMA,
      runtimeHandoff: TOOLCHAIN_RUNTIME_HANDOFF_SCHEMA,
      registeredLaunch: TOOLCHAIN_REGISTERED_LAUNCH_SCHEMA,
      registeredExecutionPlan: TOOLCHAIN_REGISTERED_EXECUTION_PLAN_SCHEMA,
    },
    sanitizeTrigger: sanitizeRuntimeEventTrigger,
    isTrustedRegisteredLaunch: admission.isTrustedRegisteredLaunch,
  }),
})

function hasOnlyAllowedKeys(input: unknown, keys: readonly string[]): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const allowed = new Set(keys)
  return Object.keys(input).every((key) => allowed.has(key))
}

function isTrustedTaskId(input: unknown): boolean {
  if (typeof input !== 'string') return false
  const withoutTaskPrefix = input.replace(/^task-/i, '')
  return sanitizeExactStableIdToken(input) === input && !isUnsafeRuntimePairingText(withoutTaskPrefix)
}

function isTrustedConfirmedIntent(
  input: unknown,
  createdAt: number,
  permissions: readonly string[],
): boolean {
  if (input === undefined) return true
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const confirmedIntent = input as NonNullable<ToolchainTaskRequest['confirmedIntent']>
  if (!hasOnlyAllowedKeys(confirmedIntent, ['schema', 'confirmedAt', 'confirmationToken', 'permissions', 'impactKinds']) ||
    confirmedIntent.schema !== TOOLCHAIN_INTENT_PREVIEW_SCHEMA || !Number.isFinite(confirmedIntent.confirmedAt) ||
    confirmedIntent.confirmedAt < createdAt || sanitizeExactStableIdToken(confirmedIntent.confirmationToken) !== confirmedIntent.confirmationToken ||
    confirmedIntent.permissions.length > TOOLCHAIN_INTENT_PREVIEW_ITEM_LIMIT ||
    confirmedIntent.impactKinds.length > TOOLCHAIN_INTENT_PREVIEW_ITEM_LIMIT) return false
  const confirmationPermissions = uniqueTypedList(confirmedIntent.permissions, TOOLCHAIN_PERMISSIONS)
    .filter((permission) => TOOLCHAIN_CONFIRMATION_PERMISSIONS.includes(permission))
  if (confirmationPermissions.length !== confirmedIntent.permissions.length) return false
  const taskConfirmationPermissions = permissions.filter((permission): permission is ToolchainPermission =>
    TOOLCHAIN_CONFIRMATION_PERMISSIONS.includes(permission as ToolchainPermission))
  if (stableIdentityString([...confirmationPermissions].sort()) !== stableIdentityString([...taskConfirmationPermissions].sort())) return false
  const expectedImpactKinds = confirmationPermissions.map(
    TOOLCHAIN_INTENT_PREVIEW_POLICY.intentImpactKindForPermission,
  )
  return stableIdentityString([...confirmedIntent.impactKinds].sort()) === stableIdentityString([...expectedImpactKinds].sort())
}

function isTrustedTaskPayloadKeyList(input: unknown, limit: number): boolean {
  if (!Array.isArray(input) || input.length > limit) return false
  const sanitized = sanitizeTaskPayloadKeyList(input)
  return sanitized.length === input.length && stableIdentityString(sanitized) === stableIdentityString(input)
}
