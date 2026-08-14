import {
  createAndroidControlPlaneSnapshotPolicy,
  TOOLCHAIN_RUNTIME_PAIRING_POLICY,
} from '@/modules/integrations'
import {
  TOOLCHAIN_ANDROID_CONTROL_PLANE_COUNT_POLICY,
  TOOLCHAIN_ANDROID_CONTROL_PLANE_PRESENTATION_POLICY,
  TOOLCHAIN_ANDROID_CONTROL_PLANE_TASK_CARD_POLICY,
  TOOLCHAIN_REGISTERED_CATALOG_POLICY,
  TOOLCHAIN_REGISTRY_POLICY,
  TOOLCHAIN_RUNTIME_SNAPSHOT_POLICY,
  createDefaultToolchainRuntimes,
} from '@/bootstrap/toolchainComposition'
import {
  TOOLCHAIN_ANDROID_CONTROL_PLANE_SCHEMA,
  TOOLCHAIN_CONTROL_PLANE_CARD_LIMIT,
  TOOLCHAIN_INSTALL_ACTION_KINDS,
  TOOLCHAIN_RUNTIME_EVENT_KEY_LIMIT,
  TOOLCHAIN_RUNTIME_PAIRING_ACCEPTANCE_SCHEMA,
  TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA,
  TOOLCHAIN_TASK_CANCEL_REQUEST_SCHEMA,
} from '@/modules/integrations'
import { createRegisteredLaunchSummaryId } from '@/modules/integrations'
import { TOOLCHAIN_LIFECYCLE_EVENT_POLICY } from '@/bootstrap/toolchainLifecycleEventPolicy'
import { sanitizeOptionalTimestamp } from '@/modules/integrations'
import type {
  ToolchainAndroidControlPlaneBuildInput,
  ToolchainAndroidControlPlaneSnapshot,
  ToolchainMcpGatewaySession,
  ToolchainRegisteredLaunch,
  ToolchainRuntimePairingAcceptance,
  ToolchainRuntimeSnapshot,
} from '@/modules/integrations'

const toolchainAndroidControlPlaneSnapshotPolicy = createAndroidControlPlaneSnapshotPolicy<
  ToolchainAndroidControlPlaneBuildInput,
  ToolchainAndroidControlPlaneSnapshot,
  ToolchainRuntimeSnapshot,
  ToolchainRegisteredLaunch,
  ToolchainMcpGatewaySession,
  ToolchainRuntimePairingAcceptance
>({
  schemas: {
    snapshot: TOOLCHAIN_ANDROID_CONTROL_PLANE_SCHEMA,
    taskCancelRequest: TOOLCHAIN_TASK_CANCEL_REQUEST_SCHEMA,
    pairingAcceptance: TOOLCHAIN_RUNTIME_PAIRING_ACCEPTANCE_SCHEMA,
    runtimeProtocol: TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA,
  },
  limits: {
    cards: TOOLCHAIN_CONTROL_PLANE_CARD_LIMIT,
    eventKeys: TOOLCHAIN_RUNTIME_EVENT_KEY_LIMIT,
  },
  installActionKinds: TOOLCHAIN_INSTALL_ACTION_KINDS,
  registryBuildInputKeys: TOOLCHAIN_REGISTRY_POLICY.registryBuildInputKeys,
  sanitizeTimestamp: sanitizeOptionalTimestamp,
  sanitizeMetadata: TOOLCHAIN_RUNTIME_PAIRING_POLICY.sanitizeToolchainMetadataToken,
  createDefaultRuntimes: createDefaultToolchainRuntimes,
  createTrustedRuntimes: TOOLCHAIN_RUNTIME_SNAPSHOT_POLICY.createTrustedRuntimeSnapshots,
  buildInstallPlan: TOOLCHAIN_REGISTRY_POLICY.buildInstallPlan,
  buildRegisteredCatalogSnapshot: TOOLCHAIN_REGISTERED_CATALOG_POLICY.buildRegisteredCatalogSnapshot,
  buildRegistrySnapshot: TOOLCHAIN_REGISTRY_POLICY.buildRegistrySnapshot,
  buildDoctorReport: TOOLCHAIN_REGISTRY_POLICY.buildDoctorReport,
  sanitizeTasks: TOOLCHAIN_ANDROID_CONTROL_PLANE_TASK_CARD_POLICY.sanitizeControlPlaneTasks,
  createTaskCancelCounts: TOOLCHAIN_ANDROID_CONTROL_PLANE_COUNT_POLICY.createControlPlaneTaskCancelCounts,
  createRegisteredLaunchCounts: TOOLCHAIN_ANDROID_CONTROL_PLANE_COUNT_POLICY.createControlPlaneRegisteredLaunchCounts,
  createPairingAcceptanceCounts: TOOLCHAIN_ANDROID_CONTROL_PLANE_COUNT_POLICY.createControlPlanePairingAcceptanceCounts,
  buildSummary: (input) => TOOLCHAIN_ANDROID_CONTROL_PLANE_PRESENTATION_POLICY.buildAndroidControlPlaneSummary(
    input as Parameters<typeof TOOLCHAIN_ANDROID_CONTROL_PLANE_PRESENTATION_POLICY.buildAndroidControlPlaneSummary>[0]
  ),
  buildActionBadges: TOOLCHAIN_ANDROID_CONTROL_PLANE_PRESENTATION_POLICY.buildControlPlaneActionBadges,
  buildRuntimeBadges: TOOLCHAIN_ANDROID_CONTROL_PLANE_PRESENTATION_POLICY.buildControlPlaneRuntimeBadges,
  isTrustedRegisteredLaunch: (input): input is ToolchainRegisteredLaunch =>
    TOOLCHAIN_LIFECYCLE_EVENT_POLICY.isTrustedRegisteredLaunch(input),
  buildRegisteredLaunchEvent: TOOLCHAIN_LIFECYCLE_EVENT_POLICY.buildRegisteredLaunch,
  createRegisteredLaunchId: createRegisteredLaunchSummaryId,
  isTrustedGatewaySession: (input): input is ToolchainMcpGatewaySession =>
    TOOLCHAIN_LIFECYCLE_EVENT_POLICY.isTrustedMcpGatewaySession(input),
  isTrustedPairingAcceptance: (input): input is ToolchainRuntimePairingAcceptance =>
    TOOLCHAIN_LIFECYCLE_EVENT_POLICY.isTrustedRuntimePairingAcceptance(input),
})

export const buildToolchainAndroidControlPlaneSnapshot = toolchainAndroidControlPlaneSnapshotPolicy.buildSnapshot
export const sanitizeControlPlaneGatewaySessions = toolchainAndroidControlPlaneSnapshotPolicy.sanitizeGatewaySessions
export const sanitizeControlPlanePairingAcceptances = toolchainAndroidControlPlaneSnapshotPolicy.sanitizePairingAcceptances
