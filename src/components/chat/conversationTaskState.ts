import { useEffect, useMemo, useState } from 'react'
import {
  finishConversationTaskActivity,
  listConversationTaskActivities,
  projectConversationTaskStatus,
  requestConversationTaskActivityCancellation,
  subscribeConversationTaskActivities,
  type ConversationTaskActivityRecord,
} from '@/modules/tasks'
import type { Conversation, Message } from '@/types/chatContracts'

export interface ConversationTaskStatusState {
  conversationTasks: ConversationTaskActivityRecord[]
  activeConversationTasks: ConversationTaskActivityRecord[]
  primaryConversationTask?: ConversationTaskActivityRecord
  primaryConversationTaskMessage?: Message
}

export type ConversationTaskCancellationOutcome =
  | 'stream-stopped'
  | 'durable-cancelled'
  | 'observational-cancelled'
  | 'failed'

export function useConversationTaskStatus({
  conversation,
}: {
  conversation: Conversation
}): ConversationTaskStatusState {
  const [conversationTasks, setConversationTasks] = useState<ConversationTaskActivityRecord[]>(() => listConversationTaskActivities())

  useEffect(() => {
    setConversationTasks(listConversationTaskActivities())
    return subscribeConversationTaskActivities(() => {
      setConversationTasks(listConversationTaskActivities())
    })
  }, [])

  const { activeConversationTasks, primaryConversationTask } = useMemo(() => {
    const projection = projectConversationTaskStatus({
      conversationId: conversation.id,
      tasks: conversationTasks,
    })
    const activeConversationTasks = [...projection.activeTasks]
    return {
      activeConversationTasks,
      primaryConversationTask: activeConversationTasks.find((task) => task.kind === 'chat-workflow'),
    }
  }, [conversation.id, conversationTasks])
  const primaryConversationTaskMessage = primaryConversationTask?.messageId
    ? conversation.messages.find((message) => message.id === primaryConversationTask.messageId)
    : undefined

  return {
    conversationTasks,
    activeConversationTasks,
    primaryConversationTask,
    primaryConversationTaskMessage,
  }
}

export function cancelConversationTask({
  conversation,
  stopStreaming,
  task,
}: {
  conversation: Conversation
  stopStreaming: (conversationId: string) => void
  task: ConversationTaskActivityRecord
}): Promise<ConversationTaskCancellationOutcome> {
  return cancelConversationTaskActivity({ conversation, stopStreaming, task })
}

async function cancelConversationTaskActivity({
  conversation,
  stopStreaming,
  task,
}: {
  conversation: Conversation
  stopStreaming: (conversationId: string) => void
  task: ConversationTaskActivityRecord
}): Promise<ConversationTaskCancellationOutcome> {
  const taskMessage = task.messageId
    ? conversation.messages.find((message) => message.id === task.messageId)
    : undefined
  if (task.conversationId === conversation.id && taskMessage && (taskMessage.status === 'streaming' || taskMessage.status === 'sending')) {
    stopStreaming(conversation.id)
    return 'stream-stopped'
  }
  const cancellation = await requestConversationTaskActivityCancellation({
    activityId: task.id,
    conversationId: task.conversationId,
    messageId: task.messageId,
  })
  if (cancellation.status === 'failed') return 'failed'
  if (cancellation.status === 'cancelled') {
    finishConversationTaskActivity(task.id, 'cancelled', { metadata: { reason: 'user_stopped' } })
    return 'durable-cancelled'
  }
  finishConversationTaskActivity(task.id, 'cancelled', { metadata: { reason: 'user_stopped' } })
  return 'observational-cancelled'
}
