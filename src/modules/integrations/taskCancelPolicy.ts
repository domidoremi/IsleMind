import { sanitizeRuntimeEventTrigger } from './runtimeTaskTextPolicy'
import { isUnsafeRuntimePairingText } from './textSafety'

export type TaskCancelPolicyErrorCode =
  | 'terminal_task'
  | 'runtime_mismatch'
  | 'runtime_unavailable'
  | 'capability_missing'
  | 'invalid_transition'
  | 'operation_mismatch'

export interface TaskCancelPolicySchemas {
  cancelRequest: string
  taskRecord: string
  runtimeProtocol: string
}

export interface TaskCancelPolicyTask<TStatus extends string, TRuntimeKind extends string> {
  taskId: string
  toolId: string
  runtimeId: string
  runtimeKind: TRuntimeKind
  status: TStatus
  createdAt: number
  projectId?: string
}

export interface TaskCancelPolicyRuntime<TRuntimeKind extends string, TProtocolSchema extends string> {
  id: string
  kind: TRuntimeKind
  protocolSchema: TProtocolSchema
  online: boolean
  capabilities: readonly string[]
}

export interface TaskCancelPolicyRequest<
  TSchemas extends TaskCancelPolicySchemas,
  TRuntimeKind extends string,
> {
  schema: TSchemas['cancelRequest']
  taskRecordSchema: TSchemas['taskRecord']
  protocolSchema: TSchemas['runtimeProtocol']
  requestedAt: number
  taskId: string
  toolId: string
  runtimeId: string
  runtimeKind: TRuntimeKind
  projectId?: string
  reason?: string
}

export interface TaskCancelPolicyRequestCreation<
  TSchemas extends TaskCancelPolicySchemas,
  TRuntimeKind extends string,
> {
  ok: boolean
  request?: TaskCancelPolicyRequest<TSchemas, TRuntimeKind>
  errorCode?: TaskCancelPolicyErrorCode
  message?: string
}

export interface TaskCancelPolicyApplication<TTask> {
  ok: boolean
  task: TTask
  changed: boolean
  errorCode?: TaskCancelPolicyErrorCode
  message?: string
}

export interface TaskCancelPolicyRuntimeEventData<
  TSchemas extends TaskCancelPolicySchemas,
  TRuntimeKind extends string,
> {
  trigger: string
  cancelRequestSchema: TSchemas['cancelRequest']
  taskRecordSchema: TSchemas['taskRecord']
  protocolSchema: TSchemas['runtimeProtocol']
  generatedAt: number
  requestedAt: number
  taskCancelRequestIdentityVerified: boolean
  taskId: string
  toolId: string
  runtimeId: string
  runtimeKind: TRuntimeKind
  projectId?: string
  status: 'requested'
  requiresRuntime: true
  androidCanCancelDirectly: false
  reasonProvided: boolean
  errorCode?: 'operation_mismatch'
}

export interface TaskCancelPolicyDependencies<
  TStatus extends string,
  TRuntimeKind extends string,
  TSchemas extends TaskCancelPolicySchemas,
  TTask extends TaskCancelPolicyTask<TStatus, TRuntimeKind>,
  TRuntime extends TaskCancelPolicyRuntime<TRuntimeKind, TSchemas['runtimeProtocol']>,
> {
  schemas: TSchemas
  cancelCapability: string
  cancelledStatus: TStatus
  untrustedRuntimeKind: TRuntimeKind
  isRuntimeKind(input: unknown): input is TRuntimeKind
  isTrustedTask(task: TTask): boolean
  isTerminalTaskStatus(status: TStatus): boolean
  isTrustedRuntime(runtime: TRuntime): boolean
  sanitizeStableId(input: unknown): string | undefined
  sanitizeMetadataToken(input: unknown): string | undefined
  sanitizeStatusReason(input: unknown): string | undefined
  transitionTask(
    task: TTask,
    nextStatus: TStatus,
    input: { now?: number; reason?: string },
  ): { ok: boolean; changed: boolean; task: TTask; message?: string }
}

export function createTaskCancelPolicy<
  TStatus extends string,
  TRuntimeKind extends string,
  const TSchemas extends TaskCancelPolicySchemas,
  TTask extends TaskCancelPolicyTask<TStatus, TRuntimeKind>,
  TRuntime extends TaskCancelPolicyRuntime<TRuntimeKind, TSchemas['runtimeProtocol']>,
>(dependencies: TaskCancelPolicyDependencies<
  TStatus,
  TRuntimeKind,
  TSchemas,
  TTask,
  TRuntime
>) {
  type CancelRequest = TaskCancelPolicyRequest<TSchemas, TRuntimeKind>
  type CancelRequestCreation = TaskCancelPolicyRequestCreation<TSchemas, TRuntimeKind>
  type CancelApplication = TaskCancelPolicyApplication<TTask>
  type CancelRuntimeEventData = TaskCancelPolicyRuntimeEventData<TSchemas, TRuntimeKind>

  function createToolchainTaskCancelRequest(input: {
    task: TTask
    runtime: TRuntime
    reason?: string
    now?: number
  }): CancelRequestCreation {
    const inputRecord = asRecord(input)
    if (!inputRecord || !hasOnlyAllowedKeys(inputRecord, ['task', 'runtime', 'reason', 'now'])) {
      return createTaskCancelFailure('operation_mismatch', 'Task cancel request input contains unsupported metadata.')
    }
    const now = sanitizeOptionalTimestamp(input.now) ?? Date.now()
    if (!dependencies.isTrustedTask(input.task)) {
      return createTaskCancelFailure('invalid_transition', 'Task record identity is not trusted for cancellation.')
    }
    if (dependencies.isTerminalTaskStatus(input.task.status)) {
      return createTaskCancelFailure('terminal_task', 'Terminal task records cannot be cancelled.')
    }
    if (!dependencies.isTrustedRuntime(input.runtime)) {
      return createTaskCancelFailure('runtime_unavailable', 'Runtime identity is not trusted for cancellation.')
    }
    if (input.task.runtimeId !== input.runtime.id || input.task.runtimeKind !== input.runtime.kind) {
      return createTaskCancelFailure('runtime_mismatch', 'Cancel request runtime must match the task record runtime.')
    }
    if (!input.runtime.online || input.runtime.protocolSchema !== dependencies.schemas.runtimeProtocol) {
      return createTaskCancelFailure('runtime_unavailable', 'Runtime must be online and protocol-ready before cancellation.')
    }
    if (!input.runtime.capabilities.includes(dependencies.cancelCapability)) {
      return createTaskCancelFailure('capability_missing', 'Runtime does not advertise task cancellation capability.')
    }
    return {
      ok: true,
      request: {
        schema: dependencies.schemas.cancelRequest,
        taskRecordSchema: dependencies.schemas.taskRecord,
        protocolSchema: dependencies.schemas.runtimeProtocol,
        requestedAt: now,
        taskId: input.task.taskId,
        toolId: input.task.toolId,
        runtimeId: input.runtime.id,
        runtimeKind: input.runtime.kind,
        projectId: dependencies.sanitizeMetadataToken(input.task.projectId),
        reason: dependencies.sanitizeStatusReason(input.reason),
      },
    }
  }

  function applyToolchainTaskCancelAccepted(
    task: TTask,
    cancelRequest: CancelRequest,
    now = Date.now(),
  ): CancelApplication {
    const acceptedAt = sanitizeOptionalTimestamp(now) ?? Date.now()
    if (cancelRequest.schema !== dependencies.schemas.cancelRequest) {
      return createTaskCancelApplication(false, task, false, 'invalid_transition', 'Cancel request schema is incompatible.')
    }
    if (!dependencies.isTrustedTask(task) || !isTrustedToolchainTaskCancelRequestEventInput(cancelRequest)) {
      return createTaskCancelApplication(false, task, false, 'invalid_transition', 'Cancel request identity is not trusted.')
    }
    if (cancelRequest.taskId !== task.taskId) {
      return createTaskCancelApplication(false, task, false, 'runtime_mismatch', 'Cancel request task id does not match task record.')
    }
    if (cancelRequest.toolId !== task.toolId) {
      return createTaskCancelApplication(false, task, false, 'runtime_mismatch', 'Cancel request tool id does not match task record.')
    }
    if (cancelRequest.runtimeId !== task.runtimeId) {
      return createTaskCancelApplication(false, task, false, 'runtime_mismatch', 'Cancel request runtime id does not match task record.')
    }
    if (cancelRequest.runtimeKind !== task.runtimeKind) {
      return createTaskCancelApplication(false, task, false, 'runtime_mismatch', 'Cancel request runtime kind does not match task record.')
    }
    if (cancelRequest.projectId !== task.projectId) {
      return createTaskCancelApplication(false, task, false, 'runtime_mismatch', 'Cancel request project id does not match task record.')
    }
    if (cancelRequest.requestedAt < task.createdAt) {
      return createTaskCancelApplication(false, task, false, 'invalid_transition', 'Cancel request was created before the task record.')
    }
    const transition = dependencies.transitionTask(task, dependencies.cancelledStatus, {
      now: acceptedAt,
      reason: cancelRequest.reason ?? 'Cancellation accepted by runtime.',
    })
    if (!transition.ok) {
      return createTaskCancelApplication(false, task, false, 'invalid_transition', transition.message ?? 'Task cancellation transition is invalid.')
    }
    return createTaskCancelApplication(true, transition.task, transition.changed)
  }

  function isTrustedToolchainTaskCancelRequestEventInput(cancelRequest: CancelRequest): boolean {
    if (
      !hasOnlyAllowedKeys(cancelRequest, [
        'schema',
        'taskRecordSchema',
        'protocolSchema',
        'requestedAt',
        'taskId',
        'toolId',
        'runtimeId',
        'runtimeKind',
        'projectId',
        'reason',
      ]) ||
      cancelRequest.schema !== dependencies.schemas.cancelRequest ||
      cancelRequest.taskRecordSchema !== dependencies.schemas.taskRecord ||
      cancelRequest.protocolSchema !== dependencies.schemas.runtimeProtocol ||
      !Number.isFinite(cancelRequest.requestedAt) ||
      !isTrustedTaskIdToken(cancelRequest.taskId) ||
      dependencies.sanitizeStableId(cancelRequest.toolId) !== cancelRequest.toolId ||
      dependencies.sanitizeStableId(cancelRequest.runtimeId) !== cancelRequest.runtimeId ||
      !dependencies.isRuntimeKind(cancelRequest.runtimeKind)
    ) return false
    if (
      cancelRequest.projectId !== undefined &&
      dependencies.sanitizeMetadataToken(cancelRequest.projectId) !== cancelRequest.projectId
    ) return false
    if (
      cancelRequest.reason !== undefined &&
      dependencies.sanitizeStatusReason(cancelRequest.reason) !== cancelRequest.reason
    ) return false
    return true
  }

  function buildToolchainTaskCancelRequestRuntimeEventData(
    cancelRequest: CancelRequest,
    trigger = 'task-cancel-request',
  ): CancelRuntimeEventData {
    const taskCancelRequestIdentityVerified = isTrustedToolchainTaskCancelRequestEventInput(cancelRequest)
    return {
      trigger: sanitizeRuntimeEventTrigger(trigger, 'task-cancel-request'),
      cancelRequestSchema: dependencies.schemas.cancelRequest,
      taskRecordSchema: dependencies.schemas.taskRecord,
      protocolSchema: dependencies.schemas.runtimeProtocol,
      generatedAt: taskCancelRequestIdentityVerified ? cancelRequest.requestedAt : 0,
      requestedAt: taskCancelRequestIdentityVerified ? cancelRequest.requestedAt : 0,
      taskCancelRequestIdentityVerified,
      taskId: taskCancelRequestIdentityVerified ? cancelRequest.taskId : 'task-cancel-unverified',
      toolId: taskCancelRequestIdentityVerified ? cancelRequest.toolId : 'tool-cancel-unverified',
      runtimeId: taskCancelRequestIdentityVerified ? cancelRequest.runtimeId : 'runtime-cancel-unverified',
      runtimeKind: taskCancelRequestIdentityVerified ? cancelRequest.runtimeKind : dependencies.untrustedRuntimeKind,
      projectId: taskCancelRequestIdentityVerified ? cancelRequest.projectId : undefined,
      status: 'requested',
      requiresRuntime: true,
      androidCanCancelDirectly: false,
      reasonProvided: taskCancelRequestIdentityVerified ? Boolean(optionalText(cancelRequest.reason)) : false,
      errorCode: taskCancelRequestIdentityVerified ? undefined : 'operation_mismatch',
    }
  }

  function isTrustedTaskIdToken(input: unknown): input is string {
    if (typeof input !== 'string') return false
    const withoutTaskPrefix = input.replace(/^task-/i, '')
    return dependencies.sanitizeStableId(input) === input && !isUnsafeRuntimePairingText(withoutTaskPrefix)
  }

  function createTaskCancelFailure(
    errorCode: TaskCancelPolicyErrorCode,
    message: string,
  ): CancelRequestCreation {
    return { ok: false, errorCode, message }
  }

  function createTaskCancelApplication(
    ok: boolean,
    task: TTask,
    changed: boolean,
    errorCode?: TaskCancelPolicyErrorCode,
    message?: string,
  ): CancelApplication {
    return { ok, task, changed, errorCode, message }
  }

  return {
    createToolchainTaskCancelRequest,
    applyToolchainTaskCancelAccepted,
    isTrustedToolchainTaskCancelRequestEventInput,
    buildToolchainTaskCancelRequestRuntimeEventData,
  }
}

function sanitizeOptionalTimestamp(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isFinite(input) ? input : undefined
}

function optionalText(input: unknown): string | undefined {
  const value = typeof input === 'string' ? input.trim().slice(0, 420) : ''
  return value || undefined
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
