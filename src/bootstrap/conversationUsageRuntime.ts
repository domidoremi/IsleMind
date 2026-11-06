import { USAGE_EXECUTION_SCHEMA } from '@/core'
import { linkMessageUsageRequest, normalizeMessageUsageExecution } from '@/modules/conversations'
import type { ProviderRuntimeChatRequest, ProviderRuntimeUsageSource } from '@/modules/providers'
import { useChatStore } from '@/store/chatStore'
import { nextUsageExecutionId } from './usageExecutionIdentity'

/** Compose the conversation's durable reference with one admitted model call. */
export function attributeConversationUsageRequest(
  request: ProviderRuntimeChatRequest,
  conversationId: string,
  messageId: string,
  source: ProviderRuntimeUsageSource = 'chat',
): ProviderRuntimeChatRequest {
  const message = useChatStore.getState().conversations.find(item => item.id === conversationId)
    ?.messages.find(item => item.id === messageId)
  if (!message || message.role !== 'assistant') return request
  const previous = normalizeMessageUsageExecution(message.usageExecution)
  const responseExecutionId = previous?.responseExecutionId ?? nextUsageExecutionId('response')
  const logicalRequestId = nextUsageExecutionId('request')
  const usageExecution = linkMessageUsageRequest(previous, responseExecutionId, logicalRequestId)
  if (!usageExecution) return request
  useChatStore.getState().updateMessage(conversationId, messageId, { usageExecution })
  const parentRequestId = previous?.requestIds.at(-1)
  return {
    ...request,
    usageContext: {
      ...request.usageContext,
      source,
      execution: {
        schema: USAGE_EXECUTION_SCHEMA,
        logicalRequestId,
        requestStartedAt: Date.now(),
        responseExecutionId,
        messageId,
        ...(parentRequestId ? { parentRequestId } : {}),
      },
    },
  }
}
