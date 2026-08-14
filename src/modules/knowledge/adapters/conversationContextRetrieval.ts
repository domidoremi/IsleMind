import type { KnowledgeContextRetrievalPort } from '../contracts'

export interface ContextRetrievalMessage {
  id: string
  role: string
  content: string
}

export interface ContextRetrievalConversation<Message extends ContextRetrievalMessage> {
  id: string
  messages: readonly Message[]
}

export interface ConversationContextRetrievalDependencies<
  Message extends ContextRetrievalMessage,
  Conversation extends ContextRetrievalConversation<Message>,
> {
  conversation: Conversation
  retrieveContext(conversation: Conversation, message: Message, options: { signal: AbortSignal }): Promise<unknown>
}

export function createConversationContextRetrievalPort<
  Message extends ContextRetrievalMessage,
  Conversation extends ContextRetrievalConversation<Message>,
>(dependencies: ConversationContextRetrievalDependencies<Message, Conversation>): KnowledgeContextRetrievalPort {
  return {
    async retrieve(input, options) {
      if (input.conversationId !== dependencies.conversation.id) return { prompt: '', sources: [] }
      const message = findRequestMessage(dependencies.conversation.messages, input.requestMessageId)
      if (!message) return { prompt: '', sources: [] }
      return dependencies.retrieveContext(dependencies.conversation, message, options)
    },
  }
}

function findRequestMessage<Message extends ContextRetrievalMessage>(
  messages: readonly Message[],
  requestMessageId: string | undefined,
): Message | undefined {
  const requested = requestMessageId
    ? messages.find((message) => message.id === requestMessageId && message.role === 'user')
    : undefined
  if (requested?.content.trim()) return requested
  return [...messages].reverse().find((message) => message.role === 'user' && message.content.trim())
}
