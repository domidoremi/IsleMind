import type { Message, ProviderType, ReasoningEffort } from '@/types'
import { estimateMessageTokens, estimateTextTokens } from '@/services/tokenUsage'

const INPUT_CONTEXT_RATIO = 0.7
const RECENT_MESSAGE_TARGET = 8

export type LocalCompressionStrategy = 'none' | 'structured-v2' | 'single-message-truncation'
export type SummarySectionId = 'constraints' | 'decisions' | 'failures' | 'actions' | 'references' | 'recent'

export interface PackChatMessagesInput {
  messages: Pick<Message, 'role' | 'content' | 'responseText' | 'attachments' | 'status'>[]
  contextPrompt?: string
  modelContextWindow: number
  maxOutputTokens: number
  systemPrompt?: string
  reasoningEffort?: ReasoningEffort
  providerType?: ProviderType
  model?: string
  localCompression?: boolean
}

export interface PackedCompressionMetadata {
  schemaVersion: 2
  strategy: LocalCompressionStrategy
  triggerReason: 'message_budget_exceeded' | 'single_message_budget_exceeded' | 'disabled_or_unneeded'
  sourceMessageCount: number
  keptMessageCount: number
  sourceRoleCounts: PackedCompressionRoleCounts
  keptRoleCounts: PackedCompressionRoleCounts
  sourceTokens: number
  compressedTokens: number
  estimatedSavedTokens: number
  compressionRatio: number
  summaryTokenBudget: number
  summaryTokens: number
  summarySectionCount: number
  summaryItemCount: number
  summarySections: PackedCompressionSectionMetadata[]
}

export interface PackedCompressionSectionMetadata {
  id: SummarySectionId
  title: string
  itemCount: number
}

export interface PackedCompressionRoleCounts {
  user: number
  assistant: number
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
  compressionMetadata: PackedCompressionMetadata
}

interface StructuredSummary {
  text: string
  sectionCount: number
  itemCount: number
  sections: PackedCompressionSectionMetadata[]
}

interface SummarySectionConfig {
  id: SummarySectionId
  title: string
  maxItems: number
  maxChars: number
}

const SUMMARY_SECTIONS: SummarySectionConfig[] = [
  { id: 'constraints', title: '用户约束', maxItems: 5, maxChars: 150 },
  { id: 'decisions', title: '已确认决策', maxItems: 5, maxChars: 150 },
  { id: 'failures', title: '失败与风险', maxItems: 4, maxChars: 150 },
  { id: 'actions', title: '待办与下一步', maxItems: 5, maxChars: 150 },
  { id: 'references', title: '重要引用', maxItems: 6, maxChars: 130 },
  { id: 'recent', title: '近期旧消息', maxItems: 6, maxChars: 140 },
]

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
  if (estimatedInputTokens <= budgetTokens || input.localCompression === false) {
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
      compressionMetadata: emptyCompressionMetadata(),
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
  const trimmedTokens = estimateMessageTokens(trimmed)
  const selectedTokens = estimateMessageTokens(selected)
  const summaryBudget = Math.max(80, budgetTokens - selectedTokens - estimateTextTokens(input.contextPrompt ?? '') - 24)
  const summary = summarizeMessages(trimmed, summaryBudget)
  const contextPrompt = [input.contextPrompt, summary.text ? `历史摘要\n${summary.text}` : ''].filter(Boolean).join('\n\n')
  estimatedInputTokens = estimateMessageTokens(selected) + estimateTextTokens(contextPrompt)

  while (estimatedInputTokens > budgetTokens && selected.length > 1) {
    selected = selected.slice(1)
    estimatedInputTokens = estimateMessageTokens(selected) + estimateTextTokens(contextPrompt)
  }

  let truncatedSourceTokens = 0
  let truncatedCompressedTokens = 0
  if (estimatedInputTokens > budgetTokens && selected.length === 1) {
    truncatedSourceTokens = estimateMessageTokens(selected)
    truncatedSingleMessage = true
    selected = [{
      ...selected[0],
      content: truncateToTokenBudget(selected[0].content, Math.max(128, budgetTokens - estimateTextTokens(contextPrompt) - 12)),
    }]
    truncatedCompressedTokens = estimateMessageTokens(selected)
    estimatedInputTokens = estimateMessageTokens(selected) + estimateTextTokens(contextPrompt)
  }
  const summaryTokens = estimateTextTokens(summary.text)
  const sourceTokens = trimmedTokens + truncatedSourceTokens
  const compressedTokens = summaryTokens + truncatedCompressedTokens
  const estimatedSavedTokens = Math.max(0, sourceTokens - compressedTokens)

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
    compressionMetadata: {
      strategy: summary.text ? 'structured-v2' : truncatedSingleMessage ? 'single-message-truncation' : 'structured-v2',
      schemaVersion: 2,
      triggerReason: truncatedSingleMessage ? 'single_message_budget_exceeded' : 'message_budget_exceeded',
      sourceMessageCount: trimmed.length,
      keptMessageCount: selected.length,
      sourceRoleCounts: countMessageRoles(trimmed),
      keptRoleCounts: countMessageRoles(selected),
      sourceTokens,
      compressedTokens,
      estimatedSavedTokens,
      compressionRatio: estimateCompressionRatio(sourceTokens, compressedTokens),
      summaryTokenBudget: summaryBudget,
      summaryTokens,
      summarySectionCount: summary.sectionCount,
      summaryItemCount: summary.itemCount,
      summarySections: summary.sections,
    },
  }
}

function toRequestMessage(message: { role: 'user' | 'assistant'; content: string }) {
  return { role: message.role, content: message.content }
}

function summarizeMessages(messages: { role: 'user' | 'assistant'; content: string }[], tokenBudget: number): StructuredSummary {
  if (!messages.length) return { text: '', sectionCount: 0, itemCount: 0, sections: [] }
  const sections = collectStructuredSummarySections(messages)
  let text = renderStructuredSummary(sections, SUMMARY_SECTIONS)
  if (!text) {
    text = messages
      .slice(-8)
      .map((message) => `${roleLabel(message.role)}: ${normalizeSummaryText(message.content).slice(0, 180)}`)
      .join('\n')
  }
  text = clampSummaryToTokenBudget(text, tokenBudget)
  const summarySections = collectRenderedSummarySections(text)
  return {
    text,
    sectionCount: summarySections.length,
    itemCount: summarySections.reduce((sum, section) => sum + section.itemCount, 0),
    sections: summarySections,
  }
}

function emptyCompressionMetadata(): PackedCompressionMetadata {
  return {
    schemaVersion: 2,
    strategy: 'none',
    triggerReason: 'disabled_or_unneeded',
    sourceMessageCount: 0,
    keptMessageCount: 0,
    sourceRoleCounts: { user: 0, assistant: 0 },
    keptRoleCounts: { user: 0, assistant: 0 },
    sourceTokens: 0,
    compressedTokens: 0,
    estimatedSavedTokens: 0,
    compressionRatio: 0,
    summaryTokenBudget: 0,
    summaryTokens: 0,
    summarySectionCount: 0,
    summaryItemCount: 0,
    summarySections: [],
  }
}

function countMessageRoles(messages: { role: 'user' | 'assistant' }[]): PackedCompressionRoleCounts {
  return messages.reduce<PackedCompressionRoleCounts>((counts, message) => {
    counts[message.role] += 1
    return counts
  }, { user: 0, assistant: 0 })
}

function collectStructuredSummarySections(messages: { role: 'user' | 'assistant'; content: string }[]): Map<SummarySectionId, string[]> {
  const sections = new Map<SummarySectionId, string[]>()
  const seen = new Set<string>()

  messages.forEach((message) => {
    const text = normalizeSummaryText(message.content)
    if (!text) return
    const line = `${roleLabel(message.role)}: ${text}`
    if (/(必须|务必|不要|不能|禁止|保留|默认|要求|约束|must|should|never|require|constraint)/i.test(text)) {
      pushSummaryItem(sections, seen, 'constraints', line)
    }
    if (/(决定|已确认|结论|采用|选择|改为|移除|删除|完成|decided|decision|adopt|choose|confirmed)/i.test(text)) {
      pushSummaryItem(sections, seen, 'decisions', line)
    }
    if (/(失败|报错|错误|异常|阻断|风险|超时|unauthorized|timeout|failed|failure|error|blocked|risk|TS\d+)/i.test(text)) {
      pushSummaryItem(sections, seen, 'failures', line)
    }
    if (/(下一步|待办|需要|修复|验证|检查|运行|实现|todo|next|fix|verify|run|implement|inspect)/i.test(text)) {
      pushSummaryItem(sections, seen, 'actions', line)
    }
    for (const reference of extractReferences(text)) {
      pushSummaryItem(sections, seen, 'references', `${roleLabel(message.role)}: ${reference}`)
    }
  })

  messages.slice(-8).forEach((message) => {
    const text = normalizeSummaryText(message.content)
    if (!text) return
    pushSummaryItem(sections, seen, 'recent', `${roleLabel(message.role)}: ${text}`)
  })

  return sections
}

function pushSummaryItem(sections: Map<SummarySectionId, string[]>, seen: Set<string>, section: SummarySectionId, value: string): void {
  const normalized = value.toLowerCase()
  if (seen.has(`${section}:${normalized}`)) return
  seen.add(`${section}:${normalized}`)
  const items = sections.get(section) ?? []
  items.push(value)
  sections.set(section, items)
}

function extractReferences(text: string): string[] {
  const matches = new Set<string>()
  const patterns = [
    /\b(?:src|app|scripts|docs|assets|test-evidence|output)\/[A-Za-z0-9_./-]+\b/g,
    /\b[A-Za-z]:\\[^\s"'<>|]+/g,
    /\b(?:bun run|node scripts\/|npx |git |adb |pwsh |powershell )[^\n。；;]{1,120}/gi,
    /\b[A-Za-z0-9_-]+\.(?:ts|tsx|js|jsx|json|md|yml|yaml|ps1|sql|db)\b/g,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      matches.add(match[0].trim())
    }
  }
  return Array.from(matches).slice(0, 10)
}

function renderStructuredSummary(sections: Map<SummarySectionId, string[]>, sectionConfigs: SummarySectionConfig[]): string {
  return sectionConfigs
    .map((section) => {
      const items = (sections.get(section.id) ?? []).slice(0, section.maxItems)
      if (!items.length) return ''
      return [
        section.title,
        ...items.map((item) => `- ${clampSummaryLine(item, section.maxChars)}`),
      ].join('\n')
    })
    .filter(Boolean)
    .join('\n')
}

function collectRenderedSummarySections(text: string): PackedCompressionSectionMetadata[] {
  const sectionByTitle = new Map(SUMMARY_SECTIONS.map((section) => [section.title, section]))
  const sections: PackedCompressionSectionMetadata[] = []
  let current: PackedCompressionSectionMetadata | undefined
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    const config = sectionByTitle.get(line)
    if (config) {
      current = { id: config.id, title: config.title, itemCount: 0 }
      sections.push(current)
      continue
    }
    if (current && line.startsWith('- ')) {
      current.itemCount += 1
    }
  }
  return sections
}

function estimateCompressionRatio(sourceTokens: number, compressedTokens: number): number {
  if (!Number.isFinite(sourceTokens) || sourceTokens <= 0) return 0
  if (!Number.isFinite(compressedTokens) || compressedTokens <= 0) return 0
  return Math.round((compressedTokens / sourceTokens) * 1000) / 1000
}

function normalizeSummaryText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function roleLabel(role: 'user' | 'assistant'): string {
  return role === 'user' ? '用户' : '助手'
}

function clampSummaryLine(text: string, maxChars: number): string {
  const trimmed = text.trim()
  return trimmed.length > maxChars ? `${trimmed.slice(0, Math.max(24, maxChars - 3))}...` : trimmed
}

function clampSummaryToTokenBudget(summary: string, tokenBudget: number): string {
  let next = summary.trim()
  let lineBudget = 140
  while (estimateTextTokens(next) > tokenBudget && next.length > 240 && lineBudget > 48) {
    lineBudget = Math.floor(lineBudget * 0.78)
    next = next
      .split('\n')
      .map((line) => line.startsWith('- ') ? clampSummaryLine(line, lineBudget) : line)
      .join('\n')
  }
  while (estimateTextTokens(next) > tokenBudget && next.includes('\n近期旧消息\n')) {
    next = next.replace(/\n近期旧消息\n[\s\S]*$/u, '')
  }
  if (estimateTextTokens(next) > tokenBudget) {
    next = truncateSummaryHeadToTokenBudget(next, tokenBudget)
  }
  return next.trim()
}

function truncateSummaryHeadToTokenBudget(text: string, tokenBudget: number): string {
  let next = text.trim()
  while (estimateTextTokens(next) > tokenBudget && next.length > 24) {
    next = next.slice(0, Math.floor(next.length * 0.78)).trim()
  }
  if (next.length >= text.trim().length) return next
  const truncated = `${next}\n[历史摘要已截断]`
  return estimateTextTokens(truncated) <= tokenBudget ? truncated : next
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
  const isDashScopeQwenReasoning = providerType === 'openai-compatible' && /^(qwen3|qwq|qvq)/.test(normalizedModel)
  const isReasoningModel = providerType === 'openai' && /^(o[1-9]|gpt-5)/.test(normalizedModel)
    || providerType === 'anthropic' && /claude-(3[.-]7|fable-5|opus-4|sonnet-4|haiku-4|mythos)/.test(normalizedModel)
    || providerType === 'google' && /^gemini-(2\.5|3)/.test(normalizedModel)
    || providerType === 'openai-compatible' && /^minimax-m3$/.test(normalizedModel)
    || isDashScopeQwenReasoning
    || /deepseek|reasoner|thinking/.test(normalizedModel)
  if (!isReasoningModel) return 0
  if (isDashScopeQwenReasoning) return estimateDashScopeQwenReasoningReserve(reasoningEffort, normalizedModel)
  switch (reasoningEffort) {
    case 'max':
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

function estimateDashScopeQwenReasoningReserve(reasoningEffort?: ReasoningEffort, model?: string): number {
  const maxBudget = /^qwen3\.(6|7)/.test(model ?? '') ? 262144 : 8192
  switch (reasoningEffort) {
    case 'high':
    case 'max':
    case 'xhigh':
      return maxBudget
    case 'medium':
      return Math.min(maxBudget, 65536)
    case 'low':
      return Math.min(maxBudget, 8192)
    case 'none':
    case 'minimal':
    default:
      return 0
  }
}
