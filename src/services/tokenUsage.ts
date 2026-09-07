import type { Message, MessageUsage } from '@/types/chatContracts'
import { filterSendableAttachments } from '@/modules/conversations/application/conversationAttachmentPolicy'
import { estimateTextTokens } from '@/core'

// Compatibility for existing presentation/bootstrap callers; new module code
// imports the pure estimator from core. Remove after those callers migrate.
export { estimateTextTokens, estimateJsonTokens, TOKEN_ESTIMATOR_VERSION } from '@/core'

export function estimateMessageTokens(messages: Pick<Message, 'role' | 'content' | 'attachments'>[]): number {
  return messages.reduce((sum, message) => {
    const attachmentTokens = filterSendableAttachments(message.attachments).reduce((total, attachment) => total + estimateAttachmentTokens(attachment.size), 0)
    return sum + 4 + estimateTextTokens(message.content) + attachmentTokens
  }, 0)
}

export function buildEstimatedUsage(inputMessages: Pick<Message, 'role' | 'content' | 'attachments'>[], outputText: string): MessageUsage {
  const inputTokens = estimateMessageTokens(inputMessages)
  const outputTokens = estimateTextTokens(outputText)
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    source: 'estimated',
  }
}

function estimateAttachmentTokens(size: number): number {
  if (!Number.isFinite(size) || size <= 0) return 0
  return Math.min(24000, Math.ceil(size / 1536))
}
