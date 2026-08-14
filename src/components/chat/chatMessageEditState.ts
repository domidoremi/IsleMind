import type { Attachment, Conversation, Message } from '@/types/chatContracts'

export interface ChatMessageEditPlan {
  messageId: string
  draft: {
    content: string
    attachments?: Attachment[]
  }
  retainedMessages: Message[]
  removedMessageIds: string[]
}

/**
 * Editing is a branch reset: the selected user message and every later turn
 * leave the persisted transcript, while the selected text becomes the draft.
 */
export function buildChatMessageEditPlan(
  conversation: Conversation,
  message: Message,
): ChatMessageEditPlan | null {
  if (message.role !== 'user') return null
  const messageIndex = conversation.messages.findIndex((item) => item.id === message.id)
  if (messageIndex < 0) return null

  return {
    messageId: message.id,
    draft: {
      content: message.content,
      attachments: message.attachments,
    },
    retainedMessages: conversation.messages.slice(0, messageIndex),
    removedMessageIds: conversation.messages.slice(messageIndex).map((item) => item.id),
  }
}
