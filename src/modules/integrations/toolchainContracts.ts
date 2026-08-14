export const TOOLCHAIN_MANIFEST_SCHEMA = 'islemind.toolchain-manifest.v0'
import type {
  ToolchainRuntimeCapability,
  ToolchainRuntimeKind,
  ToolchainTransport,
} from './toolchainRuntimeTrust'
export const TOOLCHAIN_REGISTRY_SCHEMA = 'islemind.toolchain-registry.v0'
export const TOOLCHAIN_DOCTOR_SCHEMA = 'islemind.toolchain-doctor.v0'
export const TOOLCHAIN_INTENT_PREVIEW_SCHEMA = 'islemind.toolchain-intent-preview.v0'
export const TOOLCHAIN_TASK_RECORD_SCHEMA = 'islemind.toolchain-task-record.v0'
export const TOOLCHAIN_RUNTIME_HANDOFF_SCHEMA = 'islemind.toolchain-runtime-handoff.v0'
export const TOOLCHAIN_CLI_EXECUTION_PLAN_SCHEMA = 'islemind.toolchain-cli-execution-plan.v0'
export const TOOLCHAIN_INSTALL_PLAN_SCHEMA = 'islemind.toolchain-install-plan.v0'
export const TOOLCHAIN_ANDROID_CONTROL_PLANE_SCHEMA = 'islemind.toolchain-android-control-plane.v0'
export const TOOLCHAIN_CONTROL_PLANE_ACTION_SCHEMA = 'islemind.toolchain-control-plane-action.v0'
export const TOOLCHAIN_CONTROL_PLANE_ACTION_APPLICATION_SCHEMA = 'islemind.toolchain-control-plane-action-application.v0'
export const TOOLCHAIN_RUNTIME_PAIRING_HANDSHAKE_SCHEMA = 'islemind.toolchain-runtime-pairing-handshake.v0'
export const TOOLCHAIN_RUNTIME_PAIRING_ACCEPTANCE_SCHEMA = 'islemind.toolchain-runtime-pairing-acceptance.v0'
export const TOOLCHAIN_REGISTRATION_RECORD_SCHEMA = 'islemind.toolchain-registration-record.v0'
export const TOOLCHAIN_REGISTERED_CATALOG_SCHEMA = 'islemind.toolchain-registered-catalog.v0'
export const TOOLCHAIN_REGISTERED_CATALOG_PERSISTENCE_SCHEMA = 'islemind.toolchain-registered-catalog-persistence.v0'
export const TOOLCHAIN_REGISTERED_EXECUTION_PLAN_SCHEMA = 'islemind.toolchain-registered-execution-plan.v0'
export const TOOLCHAIN_REGISTERED_LAUNCH_SCHEMA = 'islemind.toolchain-registered-launch.v0'
export const TOOLCHAIN_RUNTIME_REPORT_SCHEMA = 'islemind.toolchain-runtime-report.v0'
export const TOOLCHAIN_TASK_CANCEL_REQUEST_SCHEMA = 'islemind.toolchain-task-cancel-request.v0'
export const TOOLCHAIN_TASK_LIFECYCLE_EVENT_SCHEMA = 'islemind.toolchain-task-lifecycle-event.v0'
export const TOOLCHAIN_MCP_GATEWAY_SESSION_SCHEMA = 'islemind.toolchain-mcp-gateway-session.v0'
export const TOOLCHAIN_REGISTERED_CATALOG_RECORD_LIMIT = 96
export const TOOLCHAIN_INTENT_PREVIEW_ITEM_LIMIT = 12
export const TOOLCHAIN_TASK_LOG_LIMIT = 80
export const TOOLCHAIN_TASK_ARTIFACT_LIMIT = 24

export const TOOLCHAIN_RUNTIME_SUPPORT_VALUES = ['supported', 'unsupported', 'requires-companion'] as const
export const TOOLCHAIN_TOOL_KINDS = ['app-action', 'cli', 'mcp', 'skill', 'workflow'] as const
export const TOOLCHAIN_TASK_STATUSES = [
  'queued',
  'running',
  'waiting_for_permission',
  'waiting_for_user',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
] as const
export const TOOLCHAIN_TERMINAL_TASK_STATUSES = ['succeeded', 'failed', 'cancelled', 'expired'] as const
export const TOOLCHAIN_TASK_LOG_LEVELS = ['debug', 'info', 'warning', 'error'] as const
export const TOOLCHAIN_TASK_ARTIFACT_KINDS = ['json', 'text', 'artifact', 'log', 'diff', 'report'] as const
export const TOOLCHAIN_HANDOFF_DELIVERY_KINDS = ['android-app-action', 'companion-http', 'remote-http', 'runtime-local'] as const
export const TOOLCHAIN_INSTALL_PLAN_STATUSES = ['installable', 'needs_permission', 'needs_runtime', 'needs_confirmation', 'blocked'] as const
export const TOOLCHAIN_INSTALL_ACTION_KINDS = [
  'register-app-action',
  'register-runtime-tool',
  'pair-runtime',
  'grant-permission',
  'confirm-intent',
  'fix-manifest',
] as const
export const TOOLCHAIN_CONTROL_PLANE_ACTION_ROUTES = [
  'registry-registration',
  'runtime-pairing',
  'permission-grant',
  'intent-preview',
  'manifest-review',
] as const
export const TOOLCHAIN_REGISTRATION_KINDS = ['app-action', 'runtime-tool'] as const
export const TOOLCHAIN_REGISTERED_CATALOG_STATUSES = ['ready', 'runtime_offline', 'protocol_mismatch', 'runtime_missing', 'invalid'] as const
export const TOOLCHAIN_REGISTERED_EXECUTION_STATUSES = ['ready', 'needs_permission', 'needs_confirmation', 'runtime_unavailable', 'manifest_mismatch', 'blocked'] as const
export const TOOLCHAIN_MCP_GATEWAY_SESSION_STATUSES = ['starting', 'ready', 'unavailable', 'closed', 'expired'] as const
export const TOOLCHAIN_CONTROL_PLANE_ACTION_APPLICATION_STATUSES = ['applied', 'needs_user', 'needs_runtime', 'blocked'] as const
export const TOOLCHAIN_CONTROL_PLANE_CARD_LIMIT = 48
export const TOOLCHAIN_PERMISSIONS = [
  'context.read',
  'files.read',
  'files.write',
  'network.local',
  'network.remote',
  'task.run',
  'task.cancel',
  'mcp.approve',
  'secrets.use',
  'git.commit',
  'git.push',
  'release.publish',
] as const
export const TOOLCHAIN_CONFIRMATION_PERMISSIONS: readonly ToolchainPermission[] = [
  'files.write',
  'mcp.approve',
  'secrets.use',
  'git.commit',
  'git.push',
  'release.publish',
]

export type ToolchainRuntimeSupport = typeof TOOLCHAIN_RUNTIME_SUPPORT_VALUES[number]
export type ToolchainToolKind = typeof TOOLCHAIN_TOOL_KINDS[number]
export type ToolchainTaskStatus = typeof TOOLCHAIN_TASK_STATUSES[number]
export type ToolchainTerminalTaskStatus = typeof TOOLCHAIN_TERMINAL_TASK_STATUSES[number]
export type ToolchainTaskLogLevel = typeof TOOLCHAIN_TASK_LOG_LEVELS[number]
export type ToolchainTaskArtifactKind = typeof TOOLCHAIN_TASK_ARTIFACT_KINDS[number]
export type ToolchainRuntimeHandoffDeliveryKind = typeof TOOLCHAIN_HANDOFF_DELIVERY_KINDS[number]
export type ToolchainInstallPlanStatus = typeof TOOLCHAIN_INSTALL_PLAN_STATUSES[number]
export type ToolchainInstallActionKind = typeof TOOLCHAIN_INSTALL_ACTION_KINDS[number]
export type ToolchainControlPlaneActionRoute = typeof TOOLCHAIN_CONTROL_PLANE_ACTION_ROUTES[number]
export type ToolchainRegistrationKind = typeof TOOLCHAIN_REGISTRATION_KINDS[number]
export type ToolchainRegisteredCatalogStatus = typeof TOOLCHAIN_REGISTERED_CATALOG_STATUSES[number]
export type ToolchainRegisteredExecutionStatus = typeof TOOLCHAIN_REGISTERED_EXECUTION_STATUSES[number]
export type ToolchainMcpGatewaySessionStatus = typeof TOOLCHAIN_MCP_GATEWAY_SESSION_STATUSES[number]
export type ToolchainControlPlaneActionApplicationStatus = typeof TOOLCHAIN_CONTROL_PLANE_ACTION_APPLICATION_STATUSES[number]
export type ToolchainRuntimePairingAcceptanceStatus = 'accepted' | 'rejected'
export type ToolchainPermission = typeof TOOLCHAIN_PERMISSIONS[number]
export type ToolchainRuntimeSupportMap = Record<ToolchainRuntimeKind, ToolchainRuntimeSupport>
export type ToolchainResolutionStatus = 'ready' | 'needs_permission' | 'waiting_for_user' | 'unsupported' | 'invalid'
export type ToolchainAndroidDisposition = 'app-only' | 'companion-runtime' | 'remote-runtime' | 'unavailable'
export type ToolchainDoctorStatus = 'ready' | 'action-required' | 'blocked'
export type ToolchainDoctorSeverity = 'info' | 'warning' | 'error'
export type ToolchainDoctorActionKind = 'grant-permission' | 'pair-runtime' | 'upgrade-dependency' | 'confirm-intent' | 'fix-manifest'
export type ToolchainIntentPreviewStatus = 'waiting_for_user' | 'not_required' | 'not_available'
export type ToolchainIntentImpactKind = 'file-write' | 'mcp-approval' | 'secret-use' | 'git-change' | 'release-change'
export type ToolchainTaskTransitionErrorCode = 'unknown_status' | 'terminal_task' | 'invalid_transition'
export type ToolchainRuntimeHandoffErrorCode =
  | 'invalid_manifest'
  | 'task_not_dispatchable'
  | 'tool_mismatch'
  | 'runtime_mismatch'
  | 'runtime_unavailable'
  | 'android_execution_blocked'
  | 'confirmation_required'
  | 'operation_mismatch'
export type ToolchainCliExecutionPlanErrorCode =
  | 'handoff_mismatch'
  | 'command_unavailable'
  | 'input_unavailable'
  | 'android_execution_blocked'
export type ToolchainCliExecutionReportErrorCode =
  | 'plan_mismatch'
  | 'output_mismatch'
  | 'result_mismatch'
  | 'android_execution_blocked'
export type ToolchainMcpToolExecutionReportErrorCode =
  | 'launch_mismatch'
  | 'tool_mismatch'
  | 'result_mismatch'
  | 'android_execution_blocked'
export type ToolchainControlPlaneActionErrorCode =
  | 'action_unavailable'
  | 'tool_unavailable'
  | 'runtime_unavailable'
  | 'unknown_action'
  | 'operation_mismatch'
export type ToolchainControlPlaneActionApplicationErrorCode =
  | 'schema_mismatch'
  | 'action_unavailable'
  | 'tool_unavailable'
  | 'runtime_unavailable'
  | 'manifest_required'
  | 'operation_mismatch'
export type ToolchainRuntimePairingErrorCode =
  | 'schema_mismatch'
  | 'runtime_unavailable'
  | 'android_execution_blocked'
  | 'protocol_mismatch'
  | 'capability_missing'
  | 'dependency_missing'
  | 'operation_mismatch'
export type ToolchainRegistrationErrorCode =
  | 'invalid_manifest'
  | 'action_unavailable'
  | 'tool_mismatch'
  | 'runtime_required'
  | 'runtime_unavailable'
  | 'android_execution_blocked'
  | 'operation_mismatch'
export type ToolchainRegisteredLaunchErrorCode =
  | 'execution_not_ready'
  | 'confirmation_required'
  | 'manifest_mismatch'
  | 'runtime_unavailable'
  | 'task_creation_failed'
  | 'handoff_failed'
  | 'operation_mismatch'
export type ToolchainRegisteredCatalogPersistenceErrorCode =
  | 'schema_mismatch'
  | 'operation_mismatch'
export type ToolchainMcpGatewaySessionErrorCode =
  | 'handoff_mismatch'
  | 'not_mcp_gateway'
  | 'report_mismatch'
  | 'transport_unavailable'
export type ToolchainRuntimeReportErrorCode =
  | 'schema_mismatch'
  | 'task_mismatch'
  | 'runtime_mismatch'
  | 'invalid_transition'
export type ToolchainTaskCancelErrorCode =
  | 'terminal_task'
  | 'runtime_mismatch'
  | 'runtime_unavailable'
  | 'capability_missing'
  | 'invalid_transition'
  | 'operation_mismatch'
export type ToolchainTaskRequestErrorCode =
  | 'invalid_manifest'
  | 'runtime_unavailable'
  | 'permission_required'
  | 'intent_preview_required'
  | 'confirmation_mismatch'
  | 'operation_mismatch'
