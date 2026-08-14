export const TOOLCHAIN_TASK_LIFECYCLE_STATUSES = [
  'queued',
  'running',
  'waiting_for_permission',
  'waiting_for_user',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
] as const

export const TOOLCHAIN_TERMINAL_TASK_LIFECYCLE_STATUSES = [
  'succeeded',
  'failed',
  'cancelled',
  'expired',
] as const

export type ToolchainTaskLifecycleStatus = typeof TOOLCHAIN_TASK_LIFECYCLE_STATUSES[number]
export type ToolchainTerminalTaskLifecycleStatus = typeof TOOLCHAIN_TERMINAL_TASK_LIFECYCLE_STATUSES[number]
export type ToolchainTaskLifecycleTransitionErrorCode = 'unknown_status' | 'terminal_task' | 'invalid_transition'
export type ToolchainTaskStatusReasonSanitizer = (input: unknown) => string | undefined

export interface ToolchainTaskLifecycleRecord {
  status: ToolchainTaskLifecycleStatus
  createdAt: number
  updatedAt: number
  startedAt?: number
  completedAt?: number
  expiresAt?: number
  statusReason?: string
}

export interface ToolchainTaskLifecycleTransitionResult<TRecord extends ToolchainTaskLifecycleRecord> {
  ok: boolean
  changed: boolean
  task: TRecord
  errorCode?: ToolchainTaskLifecycleTransitionErrorCode
  message?: string
}

const TOOLCHAIN_TASK_LIFECYCLE_TRANSITIONS: Record<
  ToolchainTaskLifecycleStatus,
  readonly ToolchainTaskLifecycleStatus[]
> = {
  queued: ['running', 'waiting_for_permission', 'waiting_for_user', 'succeeded', 'failed', 'cancelled', 'expired'],
  running: ['waiting_for_permission', 'waiting_for_user', 'succeeded', 'failed', 'cancelled', 'expired'],
  waiting_for_permission: ['queued', 'running', 'failed', 'cancelled', 'expired'],
  waiting_for_user: ['queued', 'running', 'failed', 'cancelled', 'expired'],
  succeeded: [],
  failed: [],
  cancelled: [],
  expired: [],
}

export function transitionToolchainTaskRecord<TRecord extends ToolchainTaskLifecycleRecord>(
  record: TRecord,
  nextStatus: ToolchainTaskLifecycleStatus,
  input: {
    now?: number
    reason?: string
  } = {},
  sanitizeStatusReason: ToolchainTaskStatusReasonSanitizer
): ToolchainTaskLifecycleTransitionResult<TRecord> {
  const now = input.now ?? Date.now()
  if (!isTaskStatus(record.status) || !isTaskStatus(nextStatus)) {
    return createTaskTransitionResult(false, false, record, 'unknown_status', 'Task status is not part of the runtime protocol.')
  }
  if (isTerminalTaskStatus(record.status)) {
    return createTaskTransitionResult(false, false, record, 'terminal_task', 'Terminal task records cannot transition again.')
  }
  if (record.status === nextStatus) {
    return createTaskTransitionResult(true, false, record)
  }
  if (!TOOLCHAIN_TASK_LIFECYCLE_TRANSITIONS[record.status].includes(nextStatus)) {
    return createTaskTransitionResult(false, false, record, 'invalid_transition', `${record.status} cannot transition to ${nextStatus}.`)
  }
  const task: TRecord = {
    ...record,
    status: nextStatus,
    updatedAt: now,
    statusReason: input.reason !== undefined
      ? sanitizeStatusReason(input.reason)
      : sanitizeStatusReason(record.statusReason),
    startedAt: nextStatus === 'running' && !record.startedAt ? now : record.startedAt,
    completedAt: isTerminalTaskStatus(nextStatus) ? now : record.completedAt,
  }
  return createTaskTransitionResult(true, true, task)
}

export function expireStaleToolchainTaskRecord<TRecord extends ToolchainTaskLifecycleRecord>(
  record: TRecord,
  input: {
    now?: number
    ttlMs?: number
    reason?: string
  } = {},
  sanitizeStatusReason: ToolchainTaskStatusReasonSanitizer
): ToolchainTaskLifecycleTransitionResult<TRecord> {
  if (isTerminalTaskStatus(record.status)) {
    return createTaskTransitionResult(true, false, record)
  }
  const now = input.now ?? Date.now()
  const ttlExpiresAt = typeof input.ttlMs === 'number' && Number.isFinite(input.ttlMs)
    ? record.createdAt + Math.max(0, input.ttlMs)
    : undefined
  const expiresAt = record.expiresAt ?? ttlExpiresAt
  if (expiresAt === undefined || now < expiresAt) {
    return createTaskTransitionResult(true, false, record)
  }
  return transitionToolchainTaskRecord(
    { ...record, expiresAt },
    'expired',
    { now, reason: input.reason ?? 'Task exceeded its runtime TTL.' },
    sanitizeStatusReason
  )
}

export function isTaskStatus(value: unknown): value is ToolchainTaskLifecycleStatus {
  return TOOLCHAIN_TASK_LIFECYCLE_STATUSES.includes(value as ToolchainTaskLifecycleStatus)
}

export function isTerminalTaskStatus(
  value: ToolchainTaskLifecycleStatus
): value is ToolchainTerminalTaskLifecycleStatus {
  return TOOLCHAIN_TERMINAL_TASK_LIFECYCLE_STATUSES.includes(value as ToolchainTerminalTaskLifecycleStatus)
}

export function isToolchainTaskStatusAttentionRequired(status: ToolchainTaskLifecycleStatus): boolean {
  return status === 'waiting_for_permission' || status === 'waiting_for_user' || status === 'failed' || status === 'expired'
}

function createTaskTransitionResult<TRecord extends ToolchainTaskLifecycleRecord>(
  ok: boolean,
  changed: boolean,
  task: TRecord,
  errorCode?: ToolchainTaskLifecycleTransitionErrorCode,
  message?: string
): ToolchainTaskLifecycleTransitionResult<TRecord> {
  return {
    ok,
    changed,
    task,
    errorCode,
    message,
  }
}
