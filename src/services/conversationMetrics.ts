import type { Conversation, MessageUsage } from '@/types'

export interface ConversationMetrics {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens: number
  reasoningTokens: number
  estimated: boolean
  durationMs: number
  messageCount: number
  sourceCount: number
}

export function getConversationMetrics(conversation: Conversation | null | undefined): ConversationMetrics {
  const messages = conversation?.messages ?? []
  return messages.reduce<ConversationMetrics>(
    (metrics, message) => {
      const usage = message.usage
      metrics.inputTokens += usage?.inputTokens ?? 0
      metrics.outputTokens += usage?.outputTokens ?? 0
      metrics.totalTokens += usage?.totalTokens ?? (usage ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) : 0)
      metrics.cachedInputTokens += usage?.cachedInputTokens ?? 0
      metrics.reasoningTokens += usage?.reasoningTokens ?? 0
      metrics.estimated = metrics.estimated || usage?.source === 'estimated' || !!message.estimatedTokens
      metrics.durationMs += message.durationMs ?? 0
      metrics.messageCount += 1
      metrics.sourceCount += message.citations?.length ?? 0
      return metrics
    },
    { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, estimated: false, durationMs: 0, messageCount: 0, sourceCount: 0 }
  )
}

export function usageFromMetrics(metrics: ConversationMetrics): MessageUsage {
  return {
    inputTokens: metrics.inputTokens,
    outputTokens: metrics.outputTokens,
    ...(metrics.cachedInputTokens ? { cachedInputTokens: metrics.cachedInputTokens } : {}),
    ...(metrics.reasoningTokens ? { reasoningTokens: metrics.reasoningTokens } : {}),
    totalTokens: metrics.totalTokens,
    source: metrics.estimated ? 'estimated' : 'provider',
  }
}
