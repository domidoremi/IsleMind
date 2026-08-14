import type {
  ToolchainInstallActionKind,
} from './toolchainContracts'
import { stableIdentityHash } from './toolchainIdentity'
import { cleanTaskItemToken } from './toolchainPrimitives'
import type {
  ToolchainRegisteredLaunch,
  ToolchainRuntimeHandoff,
} from './toolchainRuntimeContracts'

export function createControlPlaneActionId(
  actionKind: ToolchainInstallActionKind,
  toolIds: string[],
  runtimeIds: string[],
  now: number
): string {
  return cleanTaskItemToken([
    'control',
    actionKind,
    ...toolIds.slice(0, 4),
    ...runtimeIds.slice(0, 2),
    now.toString(36),
  ].join('-'))
}

export function createControlPlaneActionApplicationId(actionId: string, now: number): string {
  return cleanTaskItemToken([
    'application',
    actionId,
    now.toString(36),
  ].join('-'))
}

export function createRegistrationId(toolId: string, runtimeId: string | undefined, now: number): string {
  return cleanTaskItemToken([
    'registration',
    toolId,
    runtimeId ?? 'app',
    now.toString(36),
  ].join('-'))
}

export function createRuntimePairingHandshakeId(runtimeId: string, now: number): string {
  return cleanTaskItemToken([
    'runtime-pairing-handshake',
    runtimeId,
    now.toString(36),
  ].join('-'))
}

export function createRuntimePairingAcceptanceId(handshakeId: string | undefined, now: number): string {
  return cleanTaskItemToken([
    'runtime-pairing-acceptance',
    handshakeId ?? 'unknown-runtime',
    now.toString(36),
  ].join('-'))
}

export function createRegisteredLaunchSummaryId(launch: ToolchainRegisteredLaunch): string {
  return createRegisteredLaunchSummaryIdFromParts(launch.registrationId, launch.taskId, launch.createdAt)
}

export function createRegisteredLaunchSummaryIdFromParts(registrationId: string, taskId: string, createdAt: number): string {
  return cleanTaskItemToken([
    'registered-launch',
    registrationId,
    taskId,
    createdAt.toString(36),
  ].join('-'))
}

export function createCliExecutionPlanId(input: {
  taskId: string
  runtimeId: string
  commandRef: string
  argv: readonly string[]
  createdAt: number
}): string {
  return cleanTaskItemToken([
    'cli-plan',
    stableIdentityHash({
      taskId: input.taskId,
      runtimeId: input.runtimeId,
      commandRef: input.commandRef,
      argv: input.argv,
      createdAt: input.createdAt,
    }),
  ].join('-'))
}
export function createMcpGatewaySessionId(handoff: ToolchainRuntimeHandoff): string {
  return createMcpGatewaySessionIdFromParts(handoff.toolId, handoff.runtimeId, handoff.taskId)
}

export function createMcpGatewaySessionIdFromParts(toolId: string, runtimeId: string, taskId: string): string {
  return cleanTaskItemToken([
    'mcp-session',
    toolId,
    runtimeId,
    taskId,
  ].join('-'))
}
