export interface AssistantConversationReplySessionConversationLike {
  readonly providerId: string
  readonly model: string
}

export interface AssistantConversationReplySessionMessage {
  readonly id: string
  readonly role: 'assistant'
  readonly content: ''
  readonly timestamp: number
  readonly status: 'streaming'
  readonly startedAt: number
}

export interface AssistantConversationReplySessionActivity {
  readonly kind: 'chat-turn'
  readonly conversationId: string
  readonly messageId: string
  readonly title: 'Chat reply'
  readonly metadata: {
    readonly providerId: string
    readonly model: string
  }
}

export interface AssistantConversationReplySessionRuntimeDependencies<
  TConversation extends AssistantConversationReplySessionConversationLike,
> {
  stopConversationMessage(conversationId: string): void
  getConversation(conversationId: string): TConversation | undefined
  now(): number
  generateId(): string
  appendMessage(
    conversationId: string,
    message: AssistantConversationReplySessionMessage,
  ): void
  startConversationTaskActivity(
    activity: AssistantConversationReplySessionActivity,
    startedAt: number,
  ): void
  setStreaming(conversationId: string, assistantMessageId: string): void
  createRequestController(): AbortController
  setActiveStream(
    conversationId: string,
    handle: {
      readonly controller: AbortController
      readonly messageId: string
    },
  ): void
}

export interface AssistantConversationReplySessionInput {
  readonly conversationId: string
}

export interface AssistantConversationReplySessionMissing {
  readonly kind: 'missing'
  readonly reason: 'conversation_not_found'
  readonly conversationId: string
}

export interface AssistantConversationReplySessionReady<
  TConversation,
> {
  readonly kind: 'ready'
  readonly conversation: TConversation
  readonly message: AssistantConversationReplySessionMessage
  readonly requestController: AbortController
}

export type AssistantConversationReplySessionOutcome<TConversation> =
  | AssistantConversationReplySessionMissing
  | AssistantConversationReplySessionReady<TConversation>

/**
 * Initializes one observable assistant reply session while concrete
 * conversation, activity, streaming, and active-handle projections remain
 * composition-root concerns.
 */
export function createAssistantConversationReplySessionRuntime<
  TConversation extends AssistantConversationReplySessionConversationLike,
>(
  dependencies: AssistantConversationReplySessionRuntimeDependencies<
    TConversation
  >,
) {
  function start(
    input: AssistantConversationReplySessionInput,
  ): AssistantConversationReplySessionOutcome<TConversation> {
    dependencies.stopConversationMessage(input.conversationId)

    const conversation = dependencies.getConversation(input.conversationId)
    if (!conversation) {
      return {
        kind: 'missing',
        reason: 'conversation_not_found',
        conversationId: input.conversationId,
      }
    }

    const startedAt = dependencies.now()
    const message: AssistantConversationReplySessionMessage = {
      id: dependencies.generateId(),
      role: 'assistant',
      content: '',
      timestamp: startedAt,
      status: 'streaming',
      startedAt,
    }

    dependencies.appendMessage(input.conversationId, message)
    dependencies.startConversationTaskActivity({
      kind: 'chat-turn',
      conversationId: input.conversationId,
      messageId: message.id,
      title: 'Chat reply',
      metadata: {
        providerId: conversation.providerId,
        model: conversation.model,
      },
    }, startedAt)
    dependencies.setStreaming(input.conversationId, message.id)
    const requestController = dependencies.createRequestController()
    dependencies.setActiveStream(input.conversationId, {
      controller: requestController,
      messageId: message.id,
    })

    return {
      kind: 'ready',
      conversation,
      message,
      requestController,
    }
  }

  return { start }
}
