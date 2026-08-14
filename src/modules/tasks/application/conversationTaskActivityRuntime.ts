export const CONVERSATION_TASK_ACTIVITY_EVENT_SCHEMA =
  'islemind.conversation-task-activity-event.v1'
export const CONVERSATION_TASK_ACTIVITY_HISTORY_LIMIT = 120
export const CONVERSATION_TASK_ACTIVITY_ACTIVE_STALE_MS = 30 * 60 * 1000

export type ConversationTaskActivityStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled'

export type ConversationTaskActivityKind = 'chat-turn' | 'chat-workflow'

type ConversationTaskActivityTerminalStatus = Exclude<
  ConversationTaskActivityStatus,
  'queued' | 'running'
>

type ConversationTaskActivityFinishUpdates = Partial<
  Pick<ConversationTaskActivityRecord, 'error' | 'metadata'>
>

export interface ConversationTaskActivityRecord {
  id: string
  kind: ConversationTaskActivityKind
  status: ConversationTaskActivityStatus
  conversationId: string
  messageId: string
  title?: string
  progress?: number
  error?: string
  createdAt: number
  updatedAt: number
  completedAt?: number
  metadata?: Record<string, unknown>
}

export interface ConversationTaskActivityStartInput {
  kind?: ConversationTaskActivityKind
  status?: Extract<ConversationTaskActivityStatus, 'queued' | 'running'>
  conversationId: string
  messageId: string
  title?: string
  progress?: number
  metadata?: Record<string, unknown>
}

export interface ConversationTaskActivityEvent {
  schema: typeof CONVERSATION_TASK_ACTIVITY_EVENT_SCHEMA
  type: 'started' | 'finished'
  activity: ConversationTaskActivityRecord
  emittedAt: number
}

export type ConversationTaskActivitySubscriber = (
  event: ConversationTaskActivityEvent,
) => void

export type ConversationTaskCancellationAuthorityStatus =
  | 'cancelled'
  | 'unavailable'
  | 'failed'

export interface ConversationTaskCancellationBindingInput {
  readonly conversationId: string
  readonly messageId: string
  readonly assistantRunId: string
  requestCancellation(): Promise<ConversationTaskCancellationAuthorityStatus>
}

export interface ConversationTaskCancellationRequestInput {
  readonly activityId: string
  readonly conversationId: string
  readonly messageId: string
}

export interface ConversationTaskCancellationResult {
  readonly status: ConversationTaskCancellationAuthorityStatus
  readonly activityId: string
  readonly assistantRunId?: string
}

interface ConversationTaskCancellationBinding {
  readonly activityId: string
  readonly conversationId: string
  readonly messageId: string
  readonly assistantRunId: string
  readonly requestCancellation: ConversationTaskCancellationBindingInput['requestCancellation']
  pending?: Promise<ConversationTaskCancellationResult>
}

const activities = new Map<string, ConversationTaskActivityRecord>()
const activityIdByMessageKey = new Map<string, string>()
const cancellationBindings = new Map<string, ConversationTaskCancellationBinding>()
const subscribers = new Set<ConversationTaskActivitySubscriber>()

export function startConversationTaskActivity(
  input: ConversationTaskActivityStartInput,
  now = Date.now(),
): ConversationTaskActivityRecord {
  assertNonEmptyIdentity(input.conversationId, 'conversationId')
  assertNonEmptyIdentity(input.messageId, 'messageId')
  assertActivityKind(input.kind)
  const status = normalizeActiveActivityStatus(input.status)

  sweepStaleConversationTaskActivities(now)
  const activity: ConversationTaskActivityRecord = {
    id: createConversationTaskActivityId(now),
    kind: input.kind ?? 'chat-turn',
    status,
    conversationId: input.conversationId,
    messageId: input.messageId,
    title: input.title,
    progress: clampActivityProgress(input.progress),
    createdAt: now,
    updatedAt: now,
    metadata: sanitizeActivityMetadata(input.metadata),
  }
  activities.set(activity.id, activity)
  bindMessageActivity(activity)
  pruneConversationTaskActivities()
  publishConversationTaskActivityEvent('started', activity, now)
  return activity
}

export function finishConversationTaskActivity(
  id: string,
  status: ConversationTaskActivityTerminalStatus,
  updates: ConversationTaskActivityFinishUpdates = {},
  now = Date.now(),
): ConversationTaskActivityRecord | undefined {
  assertTerminalActivityStatus(status)
  const current = activities.get(id)
  if (!current) return undefined
  if (!isActiveConversationTaskActivity(current)) return current

  const next: ConversationTaskActivityRecord = {
    ...current,
    status,
    progress: status === 'done' ? 1 : current.progress,
    error: updates.error,
    metadata: updates.metadata === undefined
      ? current.metadata
      : sanitizeActivityMetadata(updates.metadata),
    updatedAt: now,
    completedAt: now,
  }
  activities.set(id, next)
  unbindMessageActivity(next)
  pruneConversationTaskActivities()
  publishConversationTaskActivityEvent('finished', next, now)
  return next
}

export function finishConversationTaskActivityForMessage(
  conversationId: string,
  messageId: string,
  status: ConversationTaskActivityTerminalStatus,
  updates: ConversationTaskActivityFinishUpdates = {},
  now = Date.now(),
): ConversationTaskActivityRecord | undefined {
  const activityId = activityIdByMessageKey.get(
    messageKey(conversationId, messageId),
  )
  if (!activityId) return undefined
  return finishConversationTaskActivity(activityId, status, updates, now)
}

export function listConversationTaskActivities(
  now = Date.now(),
): ConversationTaskActivityRecord[] {
  sweepStaleConversationTaskActivities(now)
  return Array.from(activities.values())
    .sort((left, right) => right.updatedAt - left.updatedAt)
}

export function subscribeConversationTaskActivities(
  subscriber: ConversationTaskActivitySubscriber,
): () => void {
  subscribers.add(subscriber)
  return () => {
    subscribers.delete(subscriber)
  }
}

/**
 * Binds one live Chat activity to its exact durable AssistantRun cancellation
 * authority. The binding is realm-local; the injected authority owns durable
 * journal persistence and terminal recovery.
 */
export function bindConversationTaskActivityCancellation(
  input: ConversationTaskCancellationBindingInput,
): () => void {
  assertBoundedIdentity(input.conversationId, 'conversationId')
  assertBoundedIdentity(input.messageId, 'messageId')
  assertBoundedIdentity(input.assistantRunId, 'assistantRunId')
  if (typeof input.requestCancellation !== 'function') {
    throw new TypeError('Conversation task cancellation authority must be callable.')
  }

  const activityId = activityIdByMessageKey.get(
    messageKey(input.conversationId, input.messageId),
  )
  const activity = activityId ? activities.get(activityId) : undefined
  if (!activity || !isActiveConversationTaskActivity(activity)) return () => undefined

  const binding: ConversationTaskCancellationBinding = {
    activityId: activity.id,
    conversationId: activity.conversationId,
    messageId: activity.messageId,
    assistantRunId: input.assistantRunId,
    requestCancellation: input.requestCancellation,
  }
  cancellationBindings.set(activity.id, binding)

  return () => {
    if (cancellationBindings.get(activity.id) === binding) {
      cancellationBindings.delete(activity.id)
    }
  }
}

/** Requests cancellation only through the exact authority bound at run start. */
export async function requestConversationTaskActivityCancellation(
  input: ConversationTaskCancellationRequestInput,
): Promise<ConversationTaskCancellationResult> {
  if (!hasExactCancellationRequest(input)) {
    return cancellationResult('unavailable', 'untrusted')
  }
  const binding = cancellationBindings.get(input.activityId)
  const activity = activities.get(input.activityId)
  if (
    !binding
    || !activity
    || !isActiveConversationTaskActivity(activity)
    || binding.conversationId !== input.conversationId
    || binding.messageId !== input.messageId
    || activity.conversationId !== input.conversationId
    || activity.messageId !== input.messageId
  ) {
    return cancellationResult('unavailable', input.activityId)
  }

  if (!binding.pending) {
    binding.pending = Promise.resolve()
      .then(() => binding.requestCancellation())
      .then((status) => cancellationResult(
        isCancellationAuthorityStatus(status) ? status : 'failed',
        binding.activityId,
        binding.assistantRunId,
      ))
      .catch(() => cancellationResult(
        'failed',
        binding.activityId,
        binding.assistantRunId,
      ))
  }
  const pending = binding.pending
  const result = await pending
  if (result.status === 'failed' && cancellationBindings.get(binding.activityId) === binding) {
    binding.pending = undefined
  }
  return result
}

export function sweepStaleConversationTaskActivities(
  now = Date.now(),
): number {
  const staleBefore = now - CONVERSATION_TASK_ACTIVITY_ACTIVE_STALE_MS
  let expired = 0

  for (const activity of activities.values()) {
    if (
      !isActiveConversationTaskActivity(activity)
      || activity.updatedAt >= staleBefore
    ) {
      continue
    }
    const next: ConversationTaskActivityRecord = {
      ...activity,
      status: 'failed',
      error: 'Task expired after inactivity.',
      metadata: addStaleActivityReason(activity.metadata),
      updatedAt: now,
      completedAt: now,
    }
    activities.set(activity.id, next)
    unbindMessageActivity(next)
    publishConversationTaskActivityEvent('finished', next, now)
    expired += 1
  }

  if (expired) pruneConversationTaskActivities()
  return expired
}

export function clearConversationTaskActivitiesForTest(): void {
  activities.clear()
  activityIdByMessageKey.clear()
  cancellationBindings.clear()
  subscribers.clear()
}

export function isActiveConversationTaskActivity(
  activity: ConversationTaskActivityRecord,
): boolean {
  return activity.status === 'queued' || activity.status === 'running'
}

function publishConversationTaskActivityEvent(
  type: ConversationTaskActivityEvent['type'],
  activity: ConversationTaskActivityRecord,
  emittedAt: number,
): void {
  const event: ConversationTaskActivityEvent = {
    schema: CONVERSATION_TASK_ACTIVITY_EVENT_SCHEMA,
    type,
    activity,
    emittedAt,
  }
  for (const subscriber of subscribers) {
    try {
      subscriber(event)
    } catch {
      // Activity subscribers are observational and cannot affect Chat execution.
    }
  }
}

function bindMessageActivity(activity: ConversationTaskActivityRecord): void {
  if (!isActiveConversationTaskActivity(activity)) return
  activityIdByMessageKey.set(
    messageKey(activity.conversationId, activity.messageId),
    activity.id,
  )
}

function unbindMessageActivity(activity: ConversationTaskActivityRecord): void {
  activityIdByMessageKey.delete(
    messageKey(activity.conversationId, activity.messageId),
  )
  cancellationBindings.delete(activity.id)
}

function pruneConversationTaskActivities(): void {
  while (activities.size > CONVERSATION_TASK_ACTIVITY_HISTORY_LIMIT) {
    const removable = Array.from(activities.values())
      .filter((activity) => !isActiveConversationTaskActivity(activity))
      .sort((left, right) => left.updatedAt - right.updatedAt)[0]
    if (!removable) return
    activities.delete(removable.id)
    unbindMessageActivity(removable)
  }
}

function assertActivityKind(
  kind: ConversationTaskActivityKind | undefined,
): void {
  if (kind === undefined || kind === 'chat-turn' || kind === 'chat-workflow') {
    return
  }
  throw new TypeError('Conversation task activity kind must be Chat-owned.')
}

function normalizeActiveActivityStatus(
  status: ConversationTaskActivityStartInput['status'],
): Extract<ConversationTaskActivityStatus, 'queued' | 'running'> {
  if (status === undefined) return 'running'
  if (status === 'queued' || status === 'running') return status
  throw new TypeError('Conversation task activity start status must be active.')
}

function assertTerminalActivityStatus(
  status: ConversationTaskActivityTerminalStatus,
): void {
  if (status === 'done' || status === 'failed' || status === 'cancelled') return
  throw new TypeError('Conversation task activity finish status must be terminal.')
}

function assertNonEmptyIdentity(value: string, field: string): void {
  if (typeof value === 'string' && value.trim().length > 0) return
  throw new TypeError(`Conversation task activity ${field} must be non-empty.`)
}

function assertBoundedIdentity(value: string, field: string): void {
  assertNonEmptyIdentity(value, field)
  if (value.length <= 512 && value === value.trim()) return
  throw new TypeError(`Conversation task activity ${field} must be a bounded exact identity.`)
}

function hasExactCancellationRequest(
  input: ConversationTaskCancellationRequestInput,
): boolean {
  if (!input || typeof input !== 'object') return false
  const record = input as unknown as Record<string, unknown>
  const keys = Object.keys(record).sort()
  if (keys.length !== 3 || keys.join('|') !== 'activityId|conversationId|messageId') return false
  return keys.every((key) => {
    const property = Object.getOwnPropertyDescriptor(record, key)
    return Boolean(property && 'value' in property)
  }) && [record.activityId, record.conversationId, record.messageId].every(
    (value) => typeof value === 'string'
      && value.length > 0
      && value.length <= 512
      && value === value.trim(),
  )
}

function isCancellationAuthorityStatus(
  value: unknown,
): value is ConversationTaskCancellationAuthorityStatus {
  return value === 'cancelled' || value === 'unavailable' || value === 'failed'
}

function cancellationResult(
  status: ConversationTaskCancellationAuthorityStatus,
  activityId: string,
  assistantRunId?: string,
): ConversationTaskCancellationResult {
  return Object.freeze({
    status,
    activityId,
    ...(assistantRunId ? { assistantRunId } : {}),
  })
}

function clampActivityProgress(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.max(0, Math.min(1, value))
}

function sanitizeActivityMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined
  const entries = Object.entries(metadata).slice(0, 24)
  return entries.length ? Object.fromEntries(entries) : undefined
}

function addStaleActivityReason(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const entries = Object.entries(metadata ?? {})
    .filter(([key]) => key !== 'reason')
    .slice(0, 23)
  return Object.fromEntries([
    ...entries,
    ['reason', 'stale_task_expired'],
  ])
}

function messageKey(conversationId: string, messageId: string): string {
  return `${conversationId}:${messageId}`
}

function createConversationTaskActivityId(now: number): string {
  return `conversation-task-activity-${now.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`
}
