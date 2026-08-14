import {
  TOOLCHAIN_CONTROL_PLANE_ACTION_APPLICATION_STATUSES,
  TOOLCHAIN_CONTROL_PLANE_ACTION_ROUTES,
  TOOLCHAIN_HANDOFF_DELIVERY_KINDS,
  TOOLCHAIN_INSTALL_ACTION_KINDS,
  TOOLCHAIN_INSTALL_PLAN_STATUSES,
  TOOLCHAIN_MCP_GATEWAY_SESSION_STATUSES,
  TOOLCHAIN_PERMISSIONS,
  TOOLCHAIN_REGISTERED_EXECUTION_STATUSES,
  TOOLCHAIN_TOOL_KINDS,
} from './toolchainContracts'
import {
  TOOLCHAIN_RUNTIME_CAPABILITIES,
  TOOLCHAIN_RUNTIME_KINDS,
  TOOLCHAIN_TRANSPORTS,
} from './toolchainRuntimeTrust'
import type {
  ToolchainAndroidDisposition,
  ToolchainControlPlaneActionApplicationStatus,
  ToolchainControlPlaneActionRoute,
  ToolchainDoctorStatus,
  ToolchainInstallActionKind,
  ToolchainInstallPlanStatus,
  ToolchainIntentImpactKind,
  ToolchainIntentPreviewStatus,
  ToolchainMcpGatewaySessionStatus,
  ToolchainPermission,
  ToolchainRegisteredExecutionStatus,
  ToolchainResolutionStatus,
  ToolchainRuntimeHandoffDeliveryKind,
  ToolchainRuntimePairingAcceptanceStatus,
  ToolchainRuntimePairingErrorCode,
  ToolchainTaskCancelErrorCode,
  ToolchainToolKind,
} from './toolchainContracts'
import type {
  ToolchainRuntimeCapability,
  ToolchainRuntimeKind,
  ToolchainTransport,
} from './toolchainRuntimeTrust'

export function isToolKind(value: unknown): value is ToolchainToolKind {
  return TOOLCHAIN_TOOL_KINDS.includes(value as ToolchainToolKind)
}

export function isRuntimeKind(value: unknown): value is ToolchainRuntimeKind {
  return TOOLCHAIN_RUNTIME_KINDS.includes(value as ToolchainRuntimeKind)
}

export function isRuntimeHandoffDeliveryKind(value: unknown): value is ToolchainRuntimeHandoffDeliveryKind {
  return TOOLCHAIN_HANDOFF_DELIVERY_KINDS.includes(value as ToolchainRuntimeHandoffDeliveryKind)
}

export function isInstallActionKind(value: unknown): value is ToolchainInstallActionKind {
  return TOOLCHAIN_INSTALL_ACTION_KINDS.includes(value as ToolchainInstallActionKind)
}

export function isControlPlaneActionRoute(value: unknown): value is ToolchainControlPlaneActionRoute {
  return TOOLCHAIN_CONTROL_PLANE_ACTION_ROUTES.includes(value as ToolchainControlPlaneActionRoute)
}

export function isControlPlaneActionApplicationStatus(value: unknown): value is ToolchainControlPlaneActionApplicationStatus {
  return TOOLCHAIN_CONTROL_PLANE_ACTION_APPLICATION_STATUSES.includes(value as ToolchainControlPlaneActionApplicationStatus)
}

export function isDoctorStatus(value: unknown): value is ToolchainDoctorStatus {
  return value === 'ready' || value === 'action-required' || value === 'blocked'
}

export function isInstallPlanStatus(value: unknown): value is ToolchainInstallPlanStatus {
  return TOOLCHAIN_INSTALL_PLAN_STATUSES.includes(value as ToolchainInstallPlanStatus)
}

export function isResolutionStatus(value: unknown): value is ToolchainResolutionStatus {
  return value === 'ready' || value === 'needs_permission' || value === 'waiting_for_user' || value === 'unsupported' || value === 'invalid'
}

export function isRegisteredExecutionStatus(value: unknown): value is ToolchainRegisteredExecutionStatus {
  return TOOLCHAIN_REGISTERED_EXECUTION_STATUSES.includes(value as ToolchainRegisteredExecutionStatus)
}

export function isRuntimePairingAcceptanceStatus(value: unknown): value is ToolchainRuntimePairingAcceptanceStatus {
  return value === 'accepted' || value === 'rejected'
}

export function isIntentPreviewStatus(value: unknown): value is ToolchainIntentPreviewStatus {
  return value === 'waiting_for_user' || value === 'not_required' || value === 'not_available'
}

export function isIntentImpactKind(value: unknown): value is ToolchainIntentImpactKind {
  return value === 'file-write' || value === 'mcp-approval' || value === 'secret-use' || value === 'git-change' || value === 'release-change'
}

export function isRuntimePairingErrorCode(value: unknown): value is ToolchainRuntimePairingErrorCode {
  return (
    value === 'schema_mismatch' ||
    value === 'runtime_unavailable' ||
    value === 'android_execution_blocked' ||
    value === 'protocol_mismatch' ||
    value === 'capability_missing' ||
    value === 'dependency_missing' ||
    value === 'operation_mismatch'
  )
}

export function isTaskCancelErrorCode(value: unknown): value is ToolchainTaskCancelErrorCode {
  return (
    value === 'terminal_task' ||
    value === 'runtime_mismatch' ||
    value === 'runtime_unavailable' ||
    value === 'capability_missing' ||
    value === 'invalid_transition' ||
    value === 'operation_mismatch'
  )
}

export function isControlPlaneHttpTransport(value: unknown): value is Extract<ToolchainTransport, 'streamable-http' | 'http'> {
  return value === 'streamable-http' || value === 'http'
}

export function isHandoffDeliveryKind(value: unknown): value is ToolchainRuntimeHandoffDeliveryKind {
  return TOOLCHAIN_HANDOFF_DELIVERY_KINDS.includes(value as ToolchainRuntimeHandoffDeliveryKind)
}

export function isPermission(value: unknown): value is ToolchainPermission {
  return TOOLCHAIN_PERMISSIONS.includes(value as ToolchainPermission)
}

export function isRuntimeCapability(value: unknown): value is ToolchainRuntimeCapability {
  return TOOLCHAIN_RUNTIME_CAPABILITIES.includes(value as ToolchainRuntimeCapability)
}

export function isTransport(value: unknown): value is ToolchainTransport {
  return TOOLCHAIN_TRANSPORTS.includes(value as ToolchainTransport)
}

export function isMcpGatewaySessionStatus(value: unknown): value is ToolchainMcpGatewaySessionStatus {
  return TOOLCHAIN_MCP_GATEWAY_SESSION_STATUSES.includes(value as ToolchainMcpGatewaySessionStatus)
}

export function isAndroidDisposition(value: unknown): value is ToolchainAndroidDisposition {
  return value === 'app-only' || value === 'companion-runtime' || value === 'remote-runtime' || value === 'unavailable'
}
