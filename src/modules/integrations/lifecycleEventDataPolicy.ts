type UnknownRecord = Record<string, unknown>

export type LifecycleEventDataPolicyDependencies = {
  schemas: {
    taskRecord: string
    runtimeProtocol: string
    runtimePairingAcceptance: string
    runtimeHandoff: string
    registeredLaunch: string
    registeredExecutionPlan: string
  }
  sanitizeTrigger(input: unknown, fallback: string): string
  isTrustedRegisteredLaunch(input: unknown): boolean
}

const record = (input: unknown): UnknownRecord => input && typeof input === 'object' && !Array.isArray(input) ? input as UnknownRecord : {}
const list = (input: unknown): unknown[] => Array.isArray(input) ? input : []
const text = (input: unknown): string | undefined => typeof input === 'string' ? input : undefined
const number = (input: unknown): number => typeof input === 'number' ? input : 0
const bool = (input: unknown): boolean => input === true

export function createLifecycleEventDataPolicy(dependencies: LifecycleEventDataPolicyDependencies) {
  function buildRegisteredLaunch(input: unknown, trigger = 'registered-launch'): UnknownRecord {
    const launch = record(input)
    const handoff = record(launch.handoff)
    const entryRef = record(handoff.entryRef)
    const dispatch = record(handoff.dispatch)
    const taskRecord = record(launch.taskRecord)
    const verified = dependencies.isTrustedRegisteredLaunch(input)
    return {
      trigger: dependencies.sanitizeTrigger(trigger, 'registered-launch'),
      registeredLaunchSchema: dependencies.schemas.registeredLaunch,
      registeredExecutionPlanSchema: dependencies.schemas.registeredExecutionPlan,
      runtimePairingAcceptanceSchema: dependencies.schemas.runtimePairingAcceptance,
      taskRecordSchema: dependencies.schemas.taskRecord,
      runtimeHandoffSchema: dependencies.schemas.runtimeHandoff,
      protocolSchema: dependencies.schemas.runtimeProtocol,
      generatedAt: verified ? number(launch.createdAt) : 0,
      registeredLaunchIdentityVerified: verified,
      registrationId: verified ? text(launch.registrationId) : 'registration-launch-unverified',
      toolId: verified ? text(launch.toolId) : 'tool-launch-unverified',
      taskId: verified ? text(launch.taskId) : 'task-launch-unverified',
      runtimeId: verified ? text(launch.runtimeId) : 'runtime-launch-unverified',
      runtimeKind: verified ? text(launch.runtimeKind) : 'remote',
      entryType: verified ? text(entryRef.type) : undefined,
      entryExecutor: verified ? text(entryRef.executor) : undefined,
      mcpToolName: verified ? text(entryRef.mcpToolName) : undefined,
      status: 'queued',
      handoffDelivery: verified ? text(handoff.delivery) : 'runtime-local',
      hasRuntimePairingAcceptance: verified ? Boolean(launch.runtimePairingAcceptanceId) : false,
      runtimePairingAcceptanceId: verified ? text(launch.runtimePairingAcceptanceId) : undefined,
      confirmedIntent: verified ? bool(launch.confirmedIntent) : false,
      payloadKeyCount: verified ? list(launch.payloadKeys).length : 0,
      permissionCount: verified ? list(taskRecord.permissions).length : 0,
      missingPermissionCount: 0,
      dispatchRequiresPairedRuntime: verified ? bool(dispatch.requiresPairedRuntime) : false,
      dispatchUsesNetworkTransport: verified ? bool(dispatch.usesNetworkTransport) : false,
      dispatchUsesStreamableHttp: verified ? bool(dispatch.usesStreamableHttp) : false,
      androidCanExecute: verified ? bool(dispatch.androidCanExecute) : false,
      errorCode: verified ? undefined : 'operation_mismatch',
    }
  }

  return { buildRegisteredLaunch }
}
