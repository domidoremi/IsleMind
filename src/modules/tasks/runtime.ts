import {
  createTaskId,
  err,
  ok,
  type JsonRecord,
  type Result,
  type TaskId,
} from '@/core'
import type {
  ConfirmTaskInput,
  CreateTaskInput,
  ExecuteTaskInput,
  Task,
  TaskArtifact,
  TaskExecutionResult,
  TaskJournalEntry,
  TaskJournalEventType,
  TaskPolicyDecision,
  TaskRuntime,
  TaskRuntimeDependencies,
  TaskRuntimeErrorCode,
} from './contracts'

const TASK_TEXT_LIMIT = 2_000
const TASK_ARTIFACT_LIMIT = 32

interface ActiveTask {
  task: Task
  controller: AbortController
  cancellationRequested: boolean
  writeTail: Promise<void>
  detachExternalCancellation?: () => void
}

export function createTaskRuntime(dependencies: TaskRuntimeDependencies): TaskRuntime {
  const activeTasks = new Map<TaskId, ActiveTask>()

  return {
    async create(input) {
      const normalizedInput = normalizeCreateInput(input)
      if (!normalizedInput) {
        return err('invalid_request', 'The task request is invalid.', { retryable: false })
      }

      try {
        const existing = await dependencies.persistence.findByIdempotencyKey(normalizedInput.idempotencyKey)
        if (existing) return ok(existing)
      } catch {
        return err('persistence_failed', 'The task could not be loaded.', { retryable: true })
      }

      const policy = await evaluatePolicy(dependencies, normalizedInput)
      const task = createInitialTask(dependencies, normalizedInput, policy)
      const entry = createJournalEntry(task, dependencies.clock.now(), 'task.created', {
        status: task.status,
        policyOutcome: policy.outcome,
        policyReasonCode: policy.reasonCode,
        ...(task.runId ? { runId: task.runId } : {}),
      })
      try {
        await dependencies.persistence.appendAndSave(entry, task)
        return ok(task)
      } catch {
        try {
          const existing = await dependencies.persistence.findByIdempotencyKey(normalizedInput.idempotencyKey)
          if (existing) return ok(existing)
        } catch {
          // The original persistence failure remains the useful result.
        }
        return err('persistence_failed', 'The task could not be persisted.', { retryable: true })
      }
    },

    async confirm(taskId, input) {
      if (!isValidTaskId(taskId) || !isValidConfirmation(input)) {
        return err('invalid_request', 'The task confirmation is invalid.', { retryable: false })
      }
      let task: Task | undefined
      try {
        task = await dependencies.persistence.get(taskId)
      } catch {
        return err('persistence_failed', 'The task could not be loaded.', { retryable: true })
      }
      if (!task) return err('task_not_found', 'The task does not exist.', { retryable: false })
      if (task.status !== 'awaiting-confirmation') {
        return err('confirmation_not_required', 'The task is not awaiting confirmation.', { retryable: false })
      }

      const active = createPassiveTask(task)
      try {
        const confirmed = await record(active, dependencies, 'task.confirmed', {
          confirmationRecorded: true,
        }, {
          status: 'queued',
          confirmationConfirmedAt: dependencies.clock.now(),
        })
        return ok(confirmed)
      } catch {
        return err('persistence_failed', 'The task confirmation could not be recorded.', { retryable: true })
      }
    },

    async execute(taskId, executor, input = {}) {
      if (!isValidTaskId(taskId)) {
        return err('invalid_request', 'The task ID is invalid.', { retryable: false })
      }
      if (activeTasks.has(taskId)) {
        return err('task_already_active', 'The task is already active.', { retryable: false })
      }
      let task: Task | undefined
      try {
        task = await dependencies.persistence.get(taskId)
      } catch {
        return err('persistence_failed', 'The task could not be loaded.', { retryable: true })
      }
      if (!task) return err('task_not_found', 'The task does not exist.', { retryable: false })
      if (task.status === 'awaiting-confirmation') {
        return err('confirmation_required', 'The task requires confirmation before execution.', { retryable: false })
      }
      if (task.status === 'failed' && task.failure?.code === 'policy_denied') {
        return err('policy_denied', 'The task was denied by policy.', { retryable: false })
      }
      if (task.status !== 'queued') {
        return err('task_not_active', 'The task is not queued for execution.', { retryable: false })
      }
      if (input.cancellationSignal?.aborted) return this.cancel(taskId)

      const active: ActiveTask = createPassiveTask(task)
      activeTasks.set(taskId, active)
      try {
        await record(active, dependencies, 'task.started', {}, {
          status: 'running',
          startedAt: dependencies.clock.now(),
        })
        attachExternalCancellation(active, dependencies, input)
        if (active.cancellationRequested || active.controller.signal.aborted) {
          const cancelled = await finishCancelled(active, dependencies)
          return err('cancelled', 'The task was cancelled.', { retryable: true, details: { taskId: cancelled.id } })
        }

        let execution: TaskExecutionResult
        try {
          execution = await executor.execute(active.task, { signal: active.controller.signal })
        } catch {
          if (active.cancellationRequested || active.controller.signal.aborted) {
            const cancelled = await finishCancelled(active, dependencies)
            return err('cancelled', 'The task was cancelled.', { retryable: true, details: { taskId: cancelled.id } })
          }
          const failed = await finishFailed(active, dependencies, 'executor_failed', 'The task executor failed.')
          return err('executor_failed', failed.failure?.message ?? 'The task executor failed.', {
            retryable: true,
            details: { taskId: failed.id },
          })
        }

        if (active.cancellationRequested || active.controller.signal.aborted) {
          const cancelled = await finishCancelled(active, dependencies)
          return err('cancelled', 'The task was cancelled.', { retryable: true, details: { taskId: cancelled.id } })
        }

        const artifacts = normalizeArtifacts(execution.artifacts, active.task.artifacts, dependencies.clock.now())
        if (!artifacts) {
          const failed = await finishFailed(active, dependencies, 'executor_failed', 'The task executor returned invalid artifact metadata.')
          return err('executor_failed', failed.failure?.message ?? 'The task executor returned invalid artifact metadata.', {
            retryable: false,
            details: { taskId: failed.id },
          })
        }
        for (const artifact of artifacts) {
          await record(active, dependencies, 'task.artifact-recorded', {
            artifactId: artifact.id,
            label: artifact.label,
          }, {
            artifacts: [...active.task.artifacts, artifact],
          })
        }

        const succeeded = await record(active, dependencies, 'task.succeeded', {
          artifactCount: active.task.artifacts.length,
        }, {
          status: 'succeeded',
          completedAt: dependencies.clock.now(),
          result: {
            artifactIds: active.task.artifacts.map((artifact) => artifact.id),
            ...(normalizeSummary(execution.summary) ? { summary: normalizeSummary(execution.summary) } : {}),
          },
        })
        return ok(succeeded)
      } catch {
        if (active.cancellationRequested || active.controller.signal.aborted) {
          try {
            const cancelled = await finishCancelled(active, dependencies)
            return err('cancelled', 'The task was cancelled.', { retryable: true, details: { taskId: cancelled.id } })
          } catch {
            return err('persistence_failed', 'The cancelled task could not be recorded.', { retryable: true })
          }
        }
        return err('persistence_failed', 'The task state could not be recorded.', { retryable: true })
      } finally {
        active.detachExternalCancellation?.()
        activeTasks.delete(taskId)
      }
    },

    async cancel(taskId) {
      if (!isValidTaskId(taskId)) {
        return err('invalid_request', 'The task ID is invalid.', { retryable: false })
      }
      const active = activeTasks.get(taskId)
      if (active) {
        try {
          return ok(await requestCancellation(active, dependencies, 'caller_requested'))
        } catch {
          return err('persistence_failed', 'The task cancellation could not be recorded.', { retryable: true })
        }
      }

      let task: Task | undefined
      try {
        task = await dependencies.persistence.get(taskId)
      } catch {
        return err('persistence_failed', 'The task could not be loaded.', { retryable: true })
      }
      if (!task) return err('task_not_found', 'The task does not exist.', { retryable: false })
      if (task.status !== 'queued' && task.status !== 'awaiting-confirmation') {
        return err('task_not_active', 'The task cannot be cancelled in its current state.', { retryable: false })
      }
      try {
        const pending = createPassiveTask(task)
        await requestCancellation(pending, dependencies, 'caller_requested')
        return ok(await finishCancelled(pending, dependencies))
      } catch {
        return err('persistence_failed', 'The task cancellation could not be recorded.', { retryable: true })
      }
    },

    async expire(taskId, reason) {
      if (!isValidTaskId(taskId)) {
        return err('invalid_request', 'The task ID is invalid.', { retryable: false })
      }
      if (activeTasks.has(taskId)) {
        return err('task_not_active', 'An active task cannot be expired directly.', { retryable: false })
      }
      let task: Task | undefined
      try {
        task = await dependencies.persistence.get(taskId)
      } catch {
        return err('persistence_failed', 'The task could not be loaded.', { retryable: true })
      }
      if (!task) return err('task_not_found', 'The task does not exist.', { retryable: false })
      if (task.status !== 'queued' && task.status !== 'awaiting-confirmation') {
        return err('task_not_active', 'The task cannot be expired in its current state.', { retryable: false })
      }
      try {
        const expired = await record(createPassiveTask(task), dependencies, 'task.expired', {
          reason: truncate(reason?.trim() || 'task_expired', 256),
        }, {
          status: 'expired',
          completedAt: dependencies.clock.now(),
        })
        return ok(expired)
      } catch {
        return err('persistence_failed', 'The expired task could not be recorded.', { retryable: true })
      }
    },

    getTask(taskId) {
      return dependencies.persistence.get(taskId)
    },

    async recoverInterruptedTasks() {
      let tasks: readonly Task[]
      try {
        tasks = await dependencies.persistence.listRecoverable()
      } catch {
        return err('persistence_failed', 'Recoverable tasks could not be loaded.', { retryable: true })
      }
      const recovered: Task[] = []
      for (const task of tasks) {
        if (task.status === 'awaiting-confirmation' && !activeTasks.has(task.id)) {
          try {
            recovered.push(await record(createPassiveTask(task), dependencies, 'task.expired', {
              reason: 'confirmation_expired_after_restart',
            }, {
              status: 'expired',
              completedAt: dependencies.clock.now(),
            }))
          } catch {
            return err('persistence_failed', 'An unresolved confirmation task could not be safely expired.', { retryable: true })
          }
          continue
        }
        if (task.status !== 'running' || activeTasks.has(task.id)) continue
        try {
          recovered.push(await finishFailed(
            createPassiveTask(task),
            dependencies,
            'interrupted',
            'The task was interrupted before completion and was safely recovered.',
          ))
        } catch {
          return err('persistence_failed', 'An interrupted task could not be safely recovered.', { retryable: true })
        }
      }
      return ok(recovered)
    },
  }
}

async function evaluatePolicy(
  dependencies: TaskRuntimeDependencies,
  input: CreateTaskInput,
): Promise<TaskPolicyDecision> {
  try {
    return normalizePolicy(await dependencies.policyEvaluator.evaluate({
      toolId: input.toolId,
      idempotencyKey: input.idempotencyKey,
      ...(input.runId ? { runId: input.runId } : {}),
    }))
  } catch {
    return { outcome: 'denied', reasonCode: 'policy_evaluation_failed' }
  }
}

function createInitialTask(
  dependencies: TaskRuntimeDependencies,
  input: CreateTaskInput,
  policy: TaskPolicyDecision,
): Task {
  const createdAt = dependencies.clock.now()
  const id = input.taskId ?? createTaskId(dependencies.ids)
  if (policy.outcome === 'denied') {
    return {
      schema: 'islemind.task.v1',
      id,
      ...(input.runId ? { runId: input.runId } : {}),
      toolId: input.toolId,
      idempotencyKey: input.idempotencyKey,
      status: 'failed',
      policy,
      createdAt,
      completedAt: createdAt,
      journalSequence: 1,
      artifacts: [],
      failure: { code: 'policy_denied', message: 'The task was denied by policy.' },
    }
  }
  return {
    schema: 'islemind.task.v1',
    id,
    ...(input.runId ? { runId: input.runId } : {}),
    toolId: input.toolId,
    idempotencyKey: input.idempotencyKey,
    status: policy.outcome === 'requires-confirmation' ? 'awaiting-confirmation' : 'queued',
    policy,
    createdAt,
    ...(policy.outcome === 'requires-confirmation' ? { confirmationRequestedAt: createdAt } : {}),
    journalSequence: 1,
    artifacts: [],
  }
}

function createPassiveTask(task: Task): ActiveTask {
  return {
    task,
    controller: new AbortController(),
    cancellationRequested: false,
    writeTail: Promise.resolve(),
  }
}

async function record(
  active: ActiveTask,
  dependencies: TaskRuntimeDependencies,
  type: TaskJournalEventType,
  data: JsonRecord,
  patch: Partial<Task> = {},
): Promise<Task> {
  return enqueue(active, async () => {
    const next = {
      ...active.task,
      ...patch,
      journalSequence: active.task.journalSequence + 1,
    }
    const entry = createJournalEntry(next, dependencies.clock.now(), type, data)
    try {
      await dependencies.persistence.appendAndSave(entry, next)
      active.task = next
      return next
    } catch {
      throw new TaskPersistenceFailure()
    }
  })
}

function createJournalEntry(task: Task, occurredAt: number, type: TaskJournalEventType, data: JsonRecord): TaskJournalEntry {
  return {
    schema: 'islemind.task-journal-entry.v1',
    taskId: task.id,
    sequence: task.journalSequence,
    type,
    occurredAt,
    ...(Object.keys(data).length ? { data } : {}),
  }
}

async function finishFailed(
  active: ActiveTask,
  dependencies: TaskRuntimeDependencies,
  code: Extract<TaskRuntimeErrorCode, 'executor_failed' | 'interrupted'>,
  message: string,
): Promise<Task> {
  return record(active, dependencies, 'task.failed', { failureCode: code }, {
    status: 'failed',
    completedAt: dependencies.clock.now(),
    failure: { code, message },
  })
}

async function finishCancelled(active: ActiveTask, dependencies: TaskRuntimeDependencies): Promise<Task> {
  return record(active, dependencies, 'task.cancelled', {}, {
    status: 'cancelled',
    completedAt: dependencies.clock.now(),
  })
}

function attachExternalCancellation(
  active: ActiveTask,
  dependencies: TaskRuntimeDependencies,
  input: ExecuteTaskInput,
): void {
  const signal = input.cancellationSignal
  if (!signal) return
  const cancel = () => {
    void requestCancellation(active, dependencies, 'external_signal').catch(() => undefined)
  }
  signal.addEventListener('abort', cancel, { once: true })
  active.detachExternalCancellation = () => signal.removeEventListener('abort', cancel)
  if (signal.aborted) cancel()
}

async function requestCancellation(
  active: ActiveTask,
  dependencies: TaskRuntimeDependencies,
  reason: 'caller_requested' | 'external_signal',
): Promise<Task> {
  if (active.cancellationRequested) return active.task
  active.cancellationRequested = true
  active.controller.abort()
  return record(active, dependencies, 'task.cancellation-requested', { reason }, {
    cancellationRequestedAt: dependencies.clock.now(),
  })
}

function normalizeCreateInput(input: CreateTaskInput): CreateTaskInput | undefined {
  const toolId = typeof input.toolId === 'string' ? input.toolId.trim() : ''
  const idempotencyKey = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : ''
  const taskId = input.taskId && isValidTaskId(input.taskId) ? input.taskId : undefined
  const runId = input.runId && typeof input.runId === 'string' && input.runId.trim() ? input.runId : undefined
  if (!toolId || toolId.length > 256 || !idempotencyKey || idempotencyKey.length > 512 || (input.taskId && !taskId)) return undefined
  return {
    toolId,
    idempotencyKey,
    ...(taskId ? { taskId } : {}),
    ...(runId ? { runId } : {}),
  }
}

function normalizePolicy(value: TaskPolicyDecision): TaskPolicyDecision {
  if (!value || typeof value !== 'object' ||
    (value.outcome !== 'allowed' && value.outcome !== 'requires-confirmation' && value.outcome !== 'denied')) {
    return { outcome: 'denied', reasonCode: 'policy_evaluation_invalid' }
  }
  const reasonCode = typeof value.reasonCode === 'string' ? value.reasonCode.trim() : ''
  return {
    outcome: value.outcome,
    reasonCode: truncate(reasonCode || 'policy_reason_missing', 128),
  }
}

function normalizeArtifacts(
  value: readonly TaskArtifact[] | undefined,
  existing: readonly TaskArtifact[],
  createdAt: number,
): readonly TaskArtifact[] | undefined {
  if (!value) return []
  if (!Array.isArray(value) || value.length > TASK_ARTIFACT_LIMIT) return undefined
  const knownIds = new Set(existing.map((artifact) => artifact.id))
  const artifacts: TaskArtifact[] = []
  for (const artifact of value) {
    if (!artifact || typeof artifact !== 'object') return undefined
    const id = typeof artifact.id === 'string' ? artifact.id.trim() : ''
    const label = typeof artifact.label === 'string' ? artifact.label.trim() : ''
    if (!id || !label || id.length > 256 || label.length > 512 || knownIds.has(id)) return undefined
    const uri = typeof artifact.uri === 'string' ? truncate(artifact.uri.trim(), 2_048) : undefined
    const mediaType = typeof artifact.mediaType === 'string' ? truncate(artifact.mediaType.trim(), 256) : undefined
    const checksum = typeof artifact.checksum === 'string' ? truncate(artifact.checksum.trim(), 256) : undefined
    const sizeBytes = typeof artifact.sizeBytes === 'number' && Number.isSafeInteger(artifact.sizeBytes) && artifact.sizeBytes >= 0
      ? artifact.sizeBytes
      : undefined
    artifacts.push({
      id,
      label: truncate(label, 512),
      createdAt,
      ...(uri ? { uri } : {}),
      ...(mediaType ? { mediaType } : {}),
      ...(sizeBytes === undefined ? {} : { sizeBytes }),
      ...(checksum ? { checksum } : {}),
    })
    knownIds.add(id)
  }
  return artifacts
}

function normalizeSummary(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized ? truncate(normalized, TASK_TEXT_LIMIT) : undefined
}

function isValidTaskId(value: unknown): value is TaskId {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 256
}

function isValidConfirmation(input: ConfirmTaskInput): boolean {
  return typeof input?.confirmationId === 'string' && input.confirmationId.trim().length > 0 && input.confirmationId.length <= 512
}

function enqueue<Value>(active: ActiveTask, work: () => Promise<Value>): Promise<Value> {
  const next = active.writeTail.then(work, work)
  active.writeTail = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : value.slice(0, limit)
}

class TaskPersistenceFailure extends Error {
  constructor() {
    super('Task persistence failed.')
    this.name = 'TaskPersistenceFailure'
  }
}
