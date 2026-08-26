export interface AssistantConversationReplySessionConversationLike {
  readonly providerId: string
  readonly model: string
}

export interface AssistantConversationReplySessionMessage {
  readonly id: string
  readonly role: 'assistant'
  readonly providerId: string
  readonly model: string
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
    options?: { readonly persist?: boolean },
  ): void | Promise<void>
  /**
   * Plain and Rich reply starts may defer the placeholder write until
   * provider admission has produced the normalized conversation. The
   * concrete store remains the owner of that write.
   */
  readonly deferPersistenceUntilAdmission?: boolean
  projectAppendFailure?(input: {
    readonly conversationId: string
    readonly assistantMessageId: string
    readonly error: unknown
  }): void
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
  async function start(
    input: AssistantConversationReplySessionInput,
  ): Promise<AssistantConversationReplySessionOutcome<TConversation>> {
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
      providerId: conversation.providerId,
      model: conversation.model,
      content: '',
      timestamp: startedAt,
      status: 'streaming',
      startedAt,
    }

    // The assistant placeholder is part of the durable turn boundary. The
    // runtime must not admit a provider or start an effect until its exact
    // store mutation has settled.
    try {
      await dependencies.appendMessage(
        input.conversationId,
        message,
        dependencies.deferPersistenceUntilAdmission
          ? { persist: false }
          : undefined,
      )
    } catch (error) {
      // The local assistant projection already exists when its durable write
      // fails. Give bootstrap one chance to terminalize that projection before
      // propagating the exact persistence error to the caller.
      dependencies.projectAppendFailure?.({
        conversationId: input.conversationId,
        assistantMessageId: message.id,
        error,
      })
      throw error
    }
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
      conversation: dependencies.deferPersistenceUntilAdmission
        ? dependencies.getConversation(input.conversationId) ?? conversation
        : conversation,
      message,
      requestController,
    }
  }

  return { start }
}
