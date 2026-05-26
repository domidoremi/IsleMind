import type { Message, ProviderType, ReasoningEffort } from '@/types'
import { estimateMessageTokens, estimateTextTokens } from '@/services/tokenUsage'

const INPUT_CONTEXT_RATIO = 0.7
const RECENT_MESSAGE_TARGET = 8

export interface PackChatMessagesInput {
  messages: Pick<Message, 'role' | 'content' | 'responseText' | 'attachments' | 'status'>[]
  contextPrompt?: string
  modelContextWindow: number
  maxOutputTokens: number
  systemPrompt?: string
  reasoningEffort?: ReasoningEffort
  providerType?: ProviderType
  model?: string
}

export interface PackedChatMessages {
  messages: { role: 'user' | 'assistant'; content: string }[]
  contextPrompt: string
  estimatedInputTokens: number
  budgetTokens: number
  trimmedCount: number
  fixedTokens: number
  messageTokens: number
  modelBudgetTokens: number
  reservedOutputTokens: number
  reasoningReserveTokens: number
  compressionTriggered: boolean
  truncatedSingleMessage: boolean
}

export function packChatMessages(input: PackChatMessagesInput): PackedChatMessages {
  const reasoningReserveTokens = estimateReasoningReserve(input.reasoningEffort, input.providerType, input.model)
  const reservedOutputTokens = input.maxOutputTokens + reasoningReserveTokens
  const modelBudget = Math.max(512, Math.floor(input.modelContextWindow * INPUT_CONTEXT_RATIO) - reservedOutputTokens)
  const fixedTokens = estimateTextTokens([input.systemPrompt, input.contextPrompt].filter(Boolean).join('\n\n'))
  const budgetTokens = Math.max(256, modelBudget - fixedTokens)
  const cleanMessages = input.messages
    .filter((message) => message.status !== 'error' && message.status !== 'cancelled')
    .map((message) => ({
      role: message.role,
      content: (message.responseText ?? message.content ?? '').trim(),
      attachments: message.attachments,
    }))
    .filter((message) => message.content || message.attachments?.length)

  let selected = cleanMessages
  let estimatedInputTokens = estimateMessageTokens(selected)
  if (estimatedInputTokens <= budgetTokens) {
    return {
      messages: selected.map(toRequestMessage),
      contextPrompt: input.contextPrompt ?? '',
      estimatedInputTokens,
      budgetTokens,
      trimmedCount: 0,
      fixedTokens,
      messageTokens: estimatedInputTokens,
      modelBudgetTokens: modelBudget,
      reservedOutputTokens,
      reasoningReserveTokens,
      compressionTriggered: false,
      truncatedSingleMessage: false,
    }
  }

  let truncatedSingleMessage = false
  selected = []
  for (let index = cleanMessages.length - 1; index >= 0; index -= 1) {
    const candidate = [cleanMessages[index], ...selected]
    const estimatedCandidateTokens = estimateMessageTokens(candidate)
    if (estimatedCandidateTokens > budgetTokens * 0.72 && selected.length >= RECENT_MESSAGE_TARGET) break
    if (estimatedCandidateTokens > budgetTokens && selected.length >= 2) break
    selected = candidate
  }
  const trimmed = cleanMessages.slice(0, Math.max(0, cleanMessages.length - selected.length))
  const selectedTokens = estimateMessageTokens(selected)
  const summaryBudget = Math.max(80, budgetTokens - selectedTokens - estimateTextTokens(input.contextPrompt ?? '') - 24)
  const summary = summarizeMessages(trimmed, summaryBudget)
  const contextPrompt = [input.contextPrompt, summary ? `历史摘要\n${summary}` : ''].filter(Boolean).join('\n\n')
  estimatedInputTokens = estimateMessageTokens(selected) + estimateTextTokens(contextPrompt)

  while (estimatedInputTokens > budgetTokens && selected.length > 1) {
    selected = selected.slice(1)
    estimatedInputTokens = estimateMessageTokens(selected) + estimateTextTokens(contextPrompt)
  }

  if (estimatedInputTokens > budgetTokens && selected.length === 1) {
    truncatedSingleMessage = true
    selected = [{
      ...selected[0],
      content: truncateToTokenBudget(selected[0].content, Math.max(128, budgetTokens - estimateTextTokens(contextPrompt) - 12)),
    }]
    estimatedInputTokens = estimateMessageTokens(selected) + estimateTextTokens(contextPrompt)
  }

  return {
    messages: selected.map(toRequestMessage),
    contextPrompt,
    estimatedInputTokens,
    budgetTokens,
    trimmedCount: trimmed.length,
    fixedTokens,
    messageTokens: estimateMessageTokens(selected),
    modelBudgetTokens: modelBudget,
    reservedOutputTokens,
    reasoningReserveTokens,
    compressionTriggered: true,
    truncatedSingleMessage,
  }
}

function toRequestMessage(message: { role: 'user' | 'assistant'; content: string }) {
  return { role: message.role, content: message.content }
}

function summarizeMessages(messages: { role: 'user' | 'assistant'; content: string }[], tokenBudget: number): string {
  if (!messages.length) return ''
  const recent = messages.slice(-8)
  let summary = recent
    .map((message) => `${message.role === 'user' ? '用户' : '助手'}: ${message.content.replace(/\s+/g, ' ').slice(0, 180)}`)
    .join('\n')
  while (estimateTextTokens(summary) > tokenBudget && summary.length > 240) {
    const next = summary
      .split('\n')
      .map((line) => line.slice(0, Math.max(60, Math.floor(line.length * 0.72))))
      .join('\n')
    if (next.length >= summary.length) break
    summary = next
  }
  if (estimateTextTokens(summary) > tokenBudget) {
    summary = truncateToTokenBudget(summary, tokenBudget)
  }
  return summary
}

function truncateToTokenBudget(text: string, tokenBudget: number): string {
  let next = text.trim()
  while (estimateTextTokens(next) > tokenBudget && next.length > 180) {
    next = next.slice(Math.floor(next.length * 0.72))
  }
  return next.length < text.trim().length ? `[前文过长，保留末尾]\n${next}` : next
}

function estimateReasoningReserve(reasoningEffort?: ReasoningEffort, providerType?: ProviderType, model?: string): number {
  const normalizedModel = model?.toLowerCase() ?? ''
  const isReasoningModel = providerType === 'openai' && /^(o[1-9]|gpt-5)/.test(normalizedModel)
    || providerType === 'google' && /^gemini-(2\.5|3)/.test(normalizedModel)
    || /deepseek|reasoner|thinking/.test(normalizedModel)
  if (!isReasoningModel) return 0
  switch (reasoningEffort) {
    case 'xhigh':
      return 8192
    case 'high':
      return 4096
    case 'medium':
      return 2048
    case 'low':
      return 1024
    case 'minimal':
      return 512
    case 'none':
    default:
      return 0
  }
}
