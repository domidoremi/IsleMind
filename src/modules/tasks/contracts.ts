import type {
  AssistantRunId,
  Clock,
  IdGenerator,
  JsonRecord,
  Result,
  TaskId,
} from '@/core'

export const TASK_SCHEMA = 'islemind.task.v1'
export const TASK_JOURNAL_ENTRY_SCHEMA = 'islemind.task-journal-entry.v1'

export const TASK_STATUSES = [
  'queued',
  'running',
  'awaiting-confirmation',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
] as const

export type TaskStatus = typeof TASK_STATUSES[number]
export type TerminalTaskStatus = Extract<TaskStatus, 'succeeded' | 'failed' | 'cancelled' | 'expired'>
export type TaskPolicyOutcome = 'allowed' | 'requires-confirmation' | 'denied'

export interface TaskPolicyDecision {
  outcome: TaskPolicyOutcome
  reasonCode: string
}

export interface TaskArtifact {
  id: string
  label: string
  createdAt: number
  uri?: string
  mediaType?: string
  sizeBytes?: number
  checksum?: string
}

export interface TaskResult {
  artifactIds: readonly string[]
  summary?: string
}

export interface TaskFailure {
  code: Extract<TaskRuntimeErrorCode, 'policy_denied' | 'executor_failed' | 'interrupted'>
  message: string
}

export interface Task {
  schema: typeof TASK_SCHEMA
  id: TaskId
  runId?: AssistantRunId
  toolId: string
  idempotencyKey: string
  status: TaskStatus
  policy: TaskPolicyDecision
  createdAt: number
  startedAt?: number
  confirmationRequestedAt?: number
  confirmationConfirmedAt?: number
  cancellationRequestedAt?: number
  completedAt?: number
  journalSequence: number
  artifacts: readonly TaskArtifact[]
  result?: TaskResult
  failure?: TaskFailure
}

export type TaskJournalEventType =
  | 'task.created'
  | 'task.confirmed'
  | 'task.started'
  | 'task.artifact-recorded'
  | 'task.cancellation-requested'
  | 'task.succeeded'
  | 'task.failed'
  | 'task.cancelled'
  | 'task.expired'

export interface TaskJournalEntry {
  schema: typeof TASK_JOURNAL_ENTRY_SCHEMA
  taskId: TaskId
  sequence: number
  type: TaskJournalEventType
  occurredAt: number
  data?: JsonRecord
}

export interface TaskRepository {
  get(taskId: TaskId): Promise<Task | undefined>
  findByIdempotencyKey(idempotencyKey: string): Promise<Task | undefined>
  listRecoverable(): Promise<readonly Task[]>
  save(task: Task): Promise<void>
}

export interface TaskJournal {
  append(entry: TaskJournalEntry): Promise<void>
  list(taskId: TaskId): Promise<readonly TaskJournalEntry[]>
}

export interface TaskPersistence extends TaskRepository, TaskJournal {
  appendAndSave(entry: TaskJournalEntry, task: Task): Promise<void>
}

export interface TaskPolicyInput {
  runId?: AssistantRunId
  toolId: string
  idempotencyKey: string
}

export interface TaskPolicyEvaluator {
  evaluate(input: TaskPolicyInput): Promise<TaskPolicyDecision>
}

export interface CreateTaskInput extends TaskPolicyInput {
  taskId?: TaskId
}

export interface ConfirmTaskInput {
  confirmationId: string
}

export interface TaskExecutionResult {
  artifacts?: readonly TaskArtifact[]
  summary?: string
}

export interface TaskExecutor {
  execute(task: Task, options: { signal: AbortSignal }): Promise<TaskExecutionResult>
}

export interface ExecuteTaskInput {
  cancellationSignal?: AbortSignal
}

export type TaskRuntimeErrorCode =
  | 'invalid_request'
  | 'task_not_found'
  | 'task_not_active'
  | 'task_already_active'
  | 'confirmation_required'
  | 'confirmation_not_required'
  | 'policy_denied'
  | 'cancelled'
  | 'executor_failed'
  | 'interrupted'
  | 'persistence_failed'

export interface TaskRuntimeDependencies {
  clock: Clock
  ids: IdGenerator
  persistence: TaskPersistence
  policyEvaluator: TaskPolicyEvaluator
}

export interface TaskRuntime {
  create(input: CreateTaskInput): Promise<Result<Task, TaskRuntimeErrorCode>>
  confirm(taskId: TaskId, input: ConfirmTaskInput): Promise<Result<Task, TaskRuntimeErrorCode>>
  execute(taskId: TaskId, executor: TaskExecutor, input?: ExecuteTaskInput): Promise<Result<Task, TaskRuntimeErrorCode>>
  cancel(taskId: TaskId): Promise<Result<Task, TaskRuntimeErrorCode>>
  expire(taskId: TaskId, reason?: string): Promise<Result<Task, TaskRuntimeErrorCode>>
  getTask(taskId: TaskId): Promise<Task | undefined>
  recoverInterruptedTasks(): Promise<Result<readonly Task[], 'persistence_failed'>>
}
