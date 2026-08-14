export interface AndroidControlPlaneTaskRecordBase<TStatus extends string, TRuntimeKind extends string> {
  taskId: string
  toolId: string
  runtimeId: string
  runtimeKind: TRuntimeKind
  status: TStatus
  updatedAt: number
  startedAt?: number
  completedAt?: number
  expiresAt?: number
  permissions: readonly unknown[]
  payloadKeys: readonly unknown[]
  logs: readonly unknown[]
  artifacts: readonly unknown[]
}

export interface AndroidControlPlaneRuntimeBase<TRuntimeKind extends string> {
  id: string
  kind: TRuntimeKind
  online: boolean
  protocolSchema: string
  capabilities: readonly string[]
}

export interface AndroidControlPlaneTaskCard<
  TStatus extends string,
  TRuntimeKind extends string,
  TCancelSchema extends string,
  TCancelErrorCode extends string,
> {
  taskId: string
  toolId: string
  runtimeId: string
  runtimeKind: TRuntimeKind
  status: TStatus
  updatedAt: number
  startedAt?: number
  completedAt?: number
  expiresAt?: number
  terminal: boolean
  logCount: number
  artifactCount: number
  requiresAttention: boolean
  cancelRequestSchema: TCancelSchema
  canRequestCancel: boolean
  cancelRequiresRuntime: true
  runtimeCancelReady: boolean
  cancelErrorCode?: TCancelErrorCode
}

export interface AndroidControlPlaneTaskCardPolicyDependencies<
  TTask extends AndroidControlPlaneTaskRecordBase<TStatus, TRuntimeKind>,
  TRuntime extends AndroidControlPlaneRuntimeBase<TRuntimeKind>,
  TStatus extends string,
  TRuntimeKind extends string,
  TCancelSchema extends string,
  TCancelErrorCode extends string,
> {
  cardLimit: number
  taskCancelSchema: TCancelSchema
  runtimeProtocolSchema: string
  cancelCapability: string
  expiredStatus: TStatus
  isTrustedTask(task: TTask): boolean
  isTerminalTaskStatus(status: TStatus): boolean
  isTaskStatusAttentionRequired(status: TStatus): boolean
  createTaskCancelRequest(input: {
    task: TTask
    runtime: TRuntime
    now: number
  }): { ok: boolean; errorCode?: TCancelErrorCode }
}

export function createAndroidControlPlaneTaskCardPolicy<
  TTask extends AndroidControlPlaneTaskRecordBase<TStatus, TRuntimeKind>,
  TRuntime extends AndroidControlPlaneRuntimeBase<TRuntimeKind>,
  TStatus extends string,
  TRuntimeKind extends string,
  TCancelSchema extends string,
  TCancelErrorCode extends string,
>(
  dependencies: AndroidControlPlaneTaskCardPolicyDependencies<
    TTask,
    TRuntime,
    TStatus,
    TRuntimeKind,
    TCancelSchema,
    TCancelErrorCode
  >,
) {
  function sanitizeControlPlaneTasks(
    tasks: readonly TTask[] | undefined,
    now: number,
    runtimes: readonly TRuntime[],
  ): AndroidControlPlaneTaskCard<TStatus, TRuntimeKind, TCancelSchema, TCancelErrorCode>[] {
    return (tasks ?? [])
      .filter((task) => dependencies.isTrustedTask(task))
      .slice(0, dependencies.cardLimit)
      .map((task) => createControlPlaneTaskCard(task, now, runtimes))
  }

  function createControlPlaneTaskCard(
    task: TTask,
    now: number,
    runtimes: readonly TRuntime[],
  ): AndroidControlPlaneTaskCard<TStatus, TRuntimeKind, TCancelSchema, TCancelErrorCode> {
    const expired = !dependencies.isTerminalTaskStatus(task.status) &&
      task.expiresAt !== undefined && task.expiresAt <= now
    const status = expired ? dependencies.expiredStatus : task.status
    const terminal = dependencies.isTerminalTaskStatus(status)
    const cancelState = resolveControlPlaneTaskCancelState(task, status, runtimes)
    return {
      taskId: task.taskId,
      toolId: task.toolId,
      runtimeId: task.runtimeId,
      runtimeKind: task.runtimeKind,
      status,
      updatedAt: task.updatedAt,
      startedAt: task.startedAt,
      completedAt: expired && !task.completedAt ? now : task.completedAt,
      expiresAt: task.expiresAt,
      terminal,
      logCount: task.logs.length,
      artifactCount: task.artifacts.length,
      requiresAttention: dependencies.isTaskStatusAttentionRequired(status),
      cancelRequestSchema: dependencies.taskCancelSchema,
      canRequestCancel: cancelState.canRequestCancel,
      cancelRequiresRuntime: true,
      runtimeCancelReady: cancelState.runtimeCancelReady,
      cancelErrorCode: cancelState.errorCode,
    }
  }

  function resolveControlPlaneTaskCancelState(
    task: TTask,
    status: TStatus,
    runtimes: readonly TRuntime[],
  ): {
    canRequestCancel: boolean
    runtimeCancelReady: boolean
    errorCode?: TCancelErrorCode
  } {
    if (dependencies.isTerminalTaskStatus(status)) {
      return {
        canRequestCancel: false,
        runtimeCancelReady: false,
        errorCode: 'terminal_task' as TCancelErrorCode,
      }
    }
    const runtime = runtimes.find((candidate) => candidate.id === task.runtimeId)
    if (!runtime) {
      return {
        canRequestCancel: false,
        runtimeCancelReady: false,
        errorCode: 'runtime_unavailable' as TCancelErrorCode,
      }
    }
    const creation = dependencies.createTaskCancelRequest({
      task,
      runtime,
      now: task.updatedAt,
    })
    const runtimeCancelReady = runtime.id === task.runtimeId &&
      runtime.kind === task.runtimeKind &&
      runtime.online &&
      runtime.protocolSchema === dependencies.runtimeProtocolSchema &&
      runtime.capabilities.includes(dependencies.cancelCapability)
    return {
      canRequestCancel: creation.ok,
      runtimeCancelReady,
      errorCode: creation.ok ? undefined : creation.errorCode,
    }
  }

  return {
    sanitizeControlPlaneTasks,
  }
}
