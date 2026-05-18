import type { Message } from '@/types'
import { estimateMessageTokens, estimateTextTokens } from '@/services/tokenUsage'

export interface PackChatMessagesInput {
  messages: Pick<Message, 'role' | 'content' | 'responseText' | 'attachments' | 'status'>[]
  contextPrompt?: string
  modelContextWindow: number
  maxOutputTokens: number
  systemPrompt?: string
}

export interface PackedChatMessages {
  messages: { role: 'user' | 'assistant'; content: string }[]
  contextPrompt: string
  estimatedInputTokens: number
  budgetTokens: number
  trimmedCount: number
}

export function packChatMessages(input: PackChatMessagesInput): PackedChatMessages {
  const modelBudget = Math.max(512, Math.floor(input.modelContextWindow * 0.82) - input.maxOutputTokens)
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
    }
  }

  selected = []
  for (let index = cleanMessages.length - 1; index >= 0; index -= 1) {
    const candidate = [cleanMessages[index], ...selected]
    if (estimateMessageTokens(candidate) > budgetTokens * 0.72 && selected.length >= 2) break
    selected = candidate
  }
  const trimmed = cleanMessages.slice(0, Math.max(0, cleanMessages.length - selected.length))
  const summary = summarizeMessages(trimmed)
  const contextPrompt = [input.contextPrompt, summary ? `历史摘要\n${summary}` : ''].filter(Boolean).join('\n\n')
  estimatedInputTokens = estimateMessageTokens(selected) + estimateTextTokens(contextPrompt)

  while (estimatedInputTokens > budgetTokens && selected.length > 1) {
    selected = selected.slice(1)
    estimatedInputTokens = estimateMessageTokens(selected) + estimateTextTokens(contextPrompt)
  }

  if (estimatedInputTokens > budgetTokens && selected.length === 1) {
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
  }
}

function toRequestMessage(message: { role: 'user' | 'assistant'; content: string }) {
  return { role: message.role, content: message.content }
}

function summarizeMessages(messages: { role: 'user' | 'assistant'; content: string }[]): string {
  if (!messages.length) return ''
  const recent = messages.slice(-8)
  return recent
    .map((message) => `${message.role === 'user' ? '用户' : '助手'}: ${message.content.replace(/\s+/g, ' ').slice(0, 180)}`)
    .join('\n')
}

function truncateToTokenBudget(text: string, tokenBudget: number): string {
  let next = text.trim()
  while (estimateTextTokens(next) > tokenBudget && next.length > 180) {
    next = next.slice(Math.floor(next.length * 0.72))
  }
  return next.length < text.trim().length ? `[前文过长，保留末尾]\n${next}` : next
}
