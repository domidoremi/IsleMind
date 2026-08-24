export interface AssistantConversationPlainChatConversationLike {
  readonly providerId: string
  readonly model: string
  readonly systemPrompt: string
  readonly temperature: number
  readonly topP?: number
  readonly topK?: number
  readonly maxTokens: number
}

export interface AssistantConversationPlainChatProviderLike {
  readonly id: string
}

export interface AssistantConversationPlainChatRunHandle {
  readonly done: Promise<void>
}

export interface AssistantConversationPlainChatActiveStream {
  readonly controller: AbortController
  readonly messageId: string
  readonly done: Promise<void>
}

export interface AssistantConversationPlainChatHandoffInput<
  TConversation,
  TProvider,
  TSettings,
> {
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly runtimeConversation: TConversation
  readonly provider: TProvider
  readonly settings: TSettings
  readonly hasAttachments: boolean
  readonly requestController: AbortController
}

export interface AssistantConversationPlainChatHandoffRuntimeDependencies<
  TConversation extends AssistantConversationPlainChatConversationLike,
  TProvider extends AssistantConversationPlainChatProviderLike,
  TSettings,
  TErrorCode,
> {
  isEligible(input: {
    readonly conversation: TConversation
    readonly hasAttachments: boolean
    readonly settings: TSettings
  }): boolean
  getPersistedConversation(conversationId: string): TConversation | undefined
  isReplyCancelled(input: {
    readonly conversationId: string
    readonly assistantMessageId: string
    readonly controller: AbortController
  }): boolean
  startPlainChatRun(input: {
    readonly conversation: TConversation
    readonly assistantMessageId: string
    readonly provider: TProvider
    readonly settings: TSettings
    readonly hasAttachments: boolean
    readonly controller: AbortController
  }): Promise<AssistantConversationPlainChatRunHandle | undefined>
  setActiveStream(
    conversationId: string,
    handle: AssistantConversationPlainChatActiveStream,
  ): void
  getActiveStream(conversationId: string):
    | Pick<AssistantConversationPlainChatActiveStream, 'messageId'>
    | undefined
  clearActiveStream(conversationId: string): void
  projectFailure(input: {
    readonly conversationId: string
    readonly assistantMessageId: string
    readonly content: string
    readonly errorCode: TErrorCode
    readonly providerId: string
  }): void
  fallbackFailureMessage(): string
  unknownErrorCode: TErrorCode
}

export interface AssistantConversationPlainChatHandoffStarted<
  TConversation,
> {
  readonly kind: 'started'
  readonly conversation: TConversation
  readonly handle: AssistantConversationPlainChatRunHandle
}

export interface AssistantConversationPlainChatHandoffContinue {
  readonly kind: 'continue'
  readonly reason:
    | 'ineligible'
    | 'conversation_not_found'
    | 'runtime_not_started'
}

export interface AssistantConversationPlainChatHandoffCancelled {
  readonly kind: 'cancelled'
}

export interface AssistantConversationPlainChatHandoffFailed {
  readonly kind: 'failed'
  readonly error: unknown
}

export type AssistantConversationPlainChatHandoffOutcome<TConversation> =
  | AssistantConversationPlainChatHandoffStarted<TConversation>
  | AssistantConversationPlainChatHandoffContinue
  | AssistantConversationPlainChatHandoffCancelled
  | AssistantConversationPlainChatHandoffFailed

/**
 * Owns the bounded handoff from the compatibility reply path into the target
 * plain-Chat runtime. Concrete persistence, presentation projection, and
 * active-stream state remain injected by bootstrap.
 */
export function createAssistantConversationPlainChatHandoffRuntime<
  TConversation extends AssistantConversationPlainChatConversationLike,
  TProvider extends AssistantConversationPlainChatProviderLike,
  TSettings,
  TErrorCode,
>(
  dependencies: AssistantConversationPlainChatHandoffRuntimeDependencies<
    TConversation,
    TProvider,
    TSettings,
    TErrorCode
  >,
) {
  async function handoff(
    input: AssistantConversationPlainChatHandoffInput<
      TConversation,
      TProvider,
      TSettings
    >,
  ): Promise<AssistantConversationPlainChatHandoffOutcome<TConversation>> {
    if (!dependencies.isEligible({
      conversation: input.runtimeConversation,
      hasAttachments: input.hasAttachments,
      settings: input.settings,
    })) {
      return { kind: 'continue', reason: 'ineligible' }
    }

    if (!dependencies.getPersistedConversation(input.conversationId)) {
      return { kind: 'continue', reason: 'conversation_not_found' }
    }

    if (isCancelled(input)) return { kind: 'cancelled' }

    // Provider admission and the reply-start persistence barrier already
    // produced the exact normalized conversation, including the assistant
    // placeholder. Handoff only starts the native Plain capability now.
    const targetConversation = input.runtimeConversation
    // Keep a final fencing check immediately before the effectful provider
    // start; admission persistence may have yielded to the mutation queue.
    if (isCancelled(input)) return { kind: 'cancelled' }

    try {
      const handle = await dependencies.startPlainChatRun({
        conversation: targetConversation,
        assistantMessageId: input.assistantMessageId,
        provider: input.provider,
        settings: input.settings,
        hasAttachments: input.hasAttachments,
        controller: input.requestController,
      })
      if (!handle) {
        if (isCancelled(input)) return { kind: 'cancelled' }
        return { kind: 'continue', reason: 'runtime_not_started' }
      }

      dependencies.setActiveStream(input.conversationId, {
        controller: input.requestController,
        messageId: input.assistantMessageId,
        done: handle.done,
      })
      const settle = () => {
        if (
          dependencies.getActiveStream(input.conversationId)?.messageId ===
          input.assistantMessageId
        ) {
          dependencies.clearActiveStream(input.conversationId)
        }
      }
      void handle.done.then(settle, settle)
      return { kind: 'started', conversation: targetConversation, handle }
    } catch (error) {
      dependencies.projectFailure({
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        content: error instanceof Error
          ? error.message
          : dependencies.fallbackFailureMessage(),
        errorCode: dependencies.unknownErrorCode,
        providerId: input.provider.id,
      })
      return { kind: 'failed', error }
    }
  }

  function isCancelled(
    input: AssistantConversationPlainChatHandoffInput<
      TConversation,
      TProvider,
      TSettings
    >,
  ): boolean {
    return dependencies.isReplyCancelled({
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      controller: input.requestController,
    })
  }

  return { handoff }
}
