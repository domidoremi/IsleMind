import {
  buildConversationChatWorkflowAssistantMessagePatch,
  type ConversationChatWorkflowAssistantMessagePatch,
  type ConversationChatWorkflowMessageProjectionInput,
} from './conversationChatWorkflowMessageProjection'

export interface ConversationChatWorkflowAssistantMessageResolution<
  TReply extends ConversationChatWorkflowMessageProjectionInput = ConversationChatWorkflowMessageProjectionInput,
> {
  handled: boolean
  reply: TReply
  patch?: ConversationChatWorkflowAssistantMessagePatch
}

export interface ConversationChatWorkflowAssistantMessageResolutionDependencies<
  TInput,
  TReply extends ConversationChatWorkflowMessageProjectionInput,
> {
  runWorkflow(input: TInput): Promise<TReply>
}

export function createConversationChatWorkflowAssistantMessageResolver<
  TInput extends { startedAt?: number },
  TReply extends ConversationChatWorkflowMessageProjectionInput,
>(
  dependencies: ConversationChatWorkflowAssistantMessageResolutionDependencies<TInput, TReply>,
): (input: TInput) => Promise<ConversationChatWorkflowAssistantMessageResolution<TReply>> {
  return async (input) => {
    const reply = await dependencies.runWorkflow(input)
    return {
      handled: reply.handled,
      reply,
      patch: reply.handled
        ? buildConversationChatWorkflowAssistantMessagePatch(reply, input.startedAt)
        : undefined,
    }
  }
}
