import type { ConversationChatWorkflowRuntimeRequestedOutput } from '@/modules/tasks'
import type { Attachment, Conversation, Message, MessageUsage } from '@/types/chatContracts'

export interface ConversationMessageInput {
  conversation: Conversation
  content: string
  attachments?: Attachment[]
  workflowId?: string
  requestedOutput?: ConversationChatWorkflowRuntimeRequestedOutput
}

export interface ConversationMessageStore {
  setError(error: string | null): void
  addMessage(conversationId: string, message: Message): void | Promise<void>
  getConversation(conversationId: string): Conversation | undefined
}

export interface ConversationMessageControllerDependencies {
  buildEstimatedUsage(
    inputMessages: Pick<Message, 'role' | 'content' | 'attachments'>[],
    outputText: string,
  ): MessageUsage
  createMessageId(): string
  dispatchLegacyMessage(input: ConversationMessageInput): Promise<void>
  estimateTextTokens(text: string): number
  normalizeContent(content: string): string
  now(): number
  store: ConversationMessageStore
}

export interface ConversationMessageController {
  send(input: ConversationMessageInput): Promise<void>
}

/**
 * Presentation-owned message dispatch. Every accepted user turn is projected
 * once before it crosses the temporary legacy runtime boundary.
 */
export function createConversationMessageController(
  dependencies: ConversationMessageControllerDependencies,
): ConversationMessageController {
  return {
    async send(input) {
      const attachments = input.attachments ?? []
      const content = dependencies.normalizeContent(input.content)
      if (!content && attachments.length === 0) return

      const userMessage: Message = {
        id: dependencies.createMessageId(),
        role: 'user',
        content,
        attachments,
        timestamp: dependencies.now(),
        status: 'done',
      }

      dependencies.store.setError(null)
      const durability = dependencies.store.addMessage(
        input.conversation.id,
        userMessage,
      )

      const projectedConversation = dependencies.store.getConversation(input.conversation.id)
      if (!projectedConversation) throw new Error('conversation_user_projection_missing')
      const projectedUserMessages = projectedConversation.messages.filter((message) => message.id === userMessage.id)
      if (projectedUserMessages.length !== 1 || projectedUserMessages[0] !== userMessage) {
        throw new Error('conversation_user_projection_missing')
      }

      // The exact store mutation that accepted this user turn is the dispatch
      // barrier. Provider effects cannot begin while that SQLite write is
      // pending or after it has failed.
      await durability

      await dependencies.dispatchLegacyMessage({
        conversation: projectedConversation,
        content,
        attachments,
        ...(input.workflowId !== undefined ? { workflowId: input.workflowId } : {}),
        ...(input.requestedOutput !== undefined ? { requestedOutput: input.requestedOutput } : {}),
      })
    },
  }
}
