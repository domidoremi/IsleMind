export const CONVERSATION_ACTIVE_TASK_STATUSES = [
  'queued',
  'running',
  'awaiting-confirmation',
] as const

export type ConversationActiveTaskStatus = typeof CONVERSATION_ACTIVE_TASK_STATUSES[number]

export interface ConversationTaskStatusRecord {
  readonly conversationId?: string
  readonly status: string
}

export interface ProjectConversationTaskStatusInput<
  TRecord extends ConversationTaskStatusRecord,
> {
  readonly conversationId: string
  readonly tasks: readonly TRecord[]
}

export interface ConversationTaskStatusProjection<
  TRecord extends ConversationTaskStatusRecord,
> {
  readonly activeTasks: readonly TRecord[]
  readonly primaryTask?: TRecord
}

/**
 * Projects all active durable work for one Chat conversation while preserving
 * source order, record identity, task kind, and compatibility metadata.
 */
export function projectConversationTaskStatus<
  TRecord extends ConversationTaskStatusRecord,
>(
  input: ProjectConversationTaskStatusInput<TRecord>,
): ConversationTaskStatusProjection<TRecord> {
  const activeTasks = input.tasks.filter((task) =>
    task.conversationId === input.conversationId
    && isConversationActiveTaskStatus(task.status)
  )

  return {
    activeTasks,
    ...(activeTasks[0] ? { primaryTask: activeTasks[0] } : {}),
  }
}

function isConversationActiveTaskStatus(status: string): status is ConversationActiveTaskStatus {
  return status === 'queued'
    || status === 'running'
    || status === 'awaiting-confirmation'
}
