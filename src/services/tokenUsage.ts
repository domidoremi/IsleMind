import type { Message, MessageUsage } from '@/types'

const CJK_RE = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g
const WORD_RE = /[A-Za-z0-9_]+(?:[-'][A-Za-z0-9_]+)*/g

export function estimateTextTokens(text: string): number {
  const value = text.trim()
  if (!value) return 0
  const cjkCount = value.match(CJK_RE)?.length ?? 0
  const latinWords = value.match(WORD_RE)?.length ?? 0
  const nonCjkChars = Math.max(0, value.replace(CJK_RE, '').length)
  return Math.max(1, Math.ceil(cjkCount * 0.85 + latinWords * 1.25 + nonCjkChars / 12))
}

export function estimateMessageTokens(messages: Pick<Message, 'role' | 'content' | 'attachments'>[]): number {
  return messages.reduce((sum, message) => {
    const attachmentTokens = message.attachments?.reduce((total, attachment) => total + estimateAttachmentTokens(attachment.size), 0) ?? 0
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

export function mergeUsageWithEstimate(usage: MessageUsage | undefined, inputMessages: Pick<Message, 'role' | 'content' | 'attachments'>[], outputText: string): MessageUsage {
  if (usage?.source === 'provider') {
    return {
      ...usage,
      totalTokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
    }
  }
  return buildEstimatedUsage(inputMessages, outputText)
}

function estimateAttachmentTokens(size: number): number {
  if (!Number.isFinite(size) || size <= 0) return 0
  return Math.min(24000, Math.ceil(size / 1536))
}
