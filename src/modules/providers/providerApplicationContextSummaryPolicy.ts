/**
 * Application-layer conversation summarization for providers without native
 * server-side compaction. Uses the selected chat model via a dedicated turn.
 * Failures must fall back to client structured-v2 packing (caller responsibility).
 */

export interface ApplicationContextSummaryMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface BuildApplicationContextSummaryPromptInput {
  olderMessages: readonly ApplicationContextSummaryMessage[]
  recentMessages: readonly ApplicationContextSummaryMessage[]
  contextPrompt?: string
  /** Soft character budget for the summary text (not model max_tokens). */
  summaryCharBudget?: number
  maxTokens?: number
}

export interface ApplicationContextSummaryPrompt {
  systemPrompt: string
  userPrompt: string
  maxTokens: number
  estimatedInputChars: number
}

export interface SplitHistoryForApplicationSummaryInput {
  messages: readonly ApplicationContextSummaryMessage[]
  /** How many trailing turns to keep verbatim. */
  recentCount?: number
}

export interface SplitHistoryForApplicationSummaryResult {
  olderMessages: ApplicationContextSummaryMessage[]
  recentMessages: ApplicationContextSummaryMessage[]
}

export interface FitApplicationContextSummaryMessagesInput {
  olderMessages: readonly ApplicationContextSummaryMessage[]
  recentMessages: readonly ApplicationContextSummaryMessage[]
  contextPrompt?: string
  maxInputTokens: number
  estimateTextTokens: (text: string) => number
}

export interface FitApplicationContextSummaryMessagesResult {
  olderMessages: ApplicationContextSummaryMessage[]
  recentMessages: ApplicationContextSummaryMessage[]
  estimatedInputTokens: number
  truncatedMessageCount: number
}

export interface ApplicationContextSummaryBudget {
  /** Hard wall-clock budget for the summary provider call. */
  timeoutMs: number
  /** Max concurrent summary turns process-wide. */
  maxConcurrent: number
  /** Soft char budget for the produced summary. */
  summaryCharBudget: number
  /** max_tokens for the summary completion. */
  maxTokens: number
  /** Recent turns kept verbatim. */
  recentCount: number
}

export type ApplicationContextSummaryFailureCode =
  | 'empty_summary'
  | 'timeout'
  | 'aborted'
  | 'concurrency_saturated'
  | 'provider_error'
  | 'no_older_messages'

const DEFAULT_RECENT_COUNT = 6
const DEFAULT_SUMMARY_CHAR_BUDGET = 6_000
const DEFAULT_SUMMARY_MAX_TOKENS = 1_200
/** Keep summary turns short so the main reply is not starved. */
export const APPLICATION_CONTEXT_SUMMARY_DEFAULT_TIMEOUT_MS = 25_000
export const APPLICATION_CONTEXT_SUMMARY_MAX_CONCURRENT = 2
export const APPLICATION_CONTEXT_SUMMARY_MIN_TIMEOUT_MS = 8_000
export const APPLICATION_CONTEXT_SUMMARY_MAX_TIMEOUT_MS = 45_000

export function resolveApplicationContextSummaryBudget(input?: {
  upstreamTimeoutMs?: number
  recentCount?: number
  summaryCharBudget?: number
  maxTokens?: number
}): ApplicationContextSummaryBudget {
  const upstream = Number.isFinite(input?.upstreamTimeoutMs)
    ? Math.floor(input!.upstreamTimeoutMs!)
    : 60_000
  // Leave headroom for the main reply after summary.
  const derived = Math.floor(upstream * 0.45)
  const timeoutMs = clampNumber(
    derived || APPLICATION_CONTEXT_SUMMARY_DEFAULT_TIMEOUT_MS,
    APPLICATION_CONTEXT_SUMMARY_MIN_TIMEOUT_MS,
    APPLICATION_CONTEXT_SUMMARY_MAX_TIMEOUT_MS,
  )
  return {
    timeoutMs,
    maxConcurrent: APPLICATION_CONTEXT_SUMMARY_MAX_CONCURRENT,
    summaryCharBudget: Math.max(800, Math.floor(input?.summaryCharBudget ?? DEFAULT_SUMMARY_CHAR_BUDGET)),
    maxTokens: Math.max(256, Math.floor(input?.maxTokens ?? DEFAULT_SUMMARY_MAX_TOKENS)),
    recentCount: Math.max(2, Math.floor(input?.recentCount ?? DEFAULT_RECENT_COUNT)),
  }
}

export function splitHistoryForApplicationSummary(
  input: SplitHistoryForApplicationSummaryInput,
): SplitHistoryForApplicationSummaryResult {
  const recentCount = Math.max(2, Math.floor(input.recentCount ?? DEFAULT_RECENT_COUNT))
  const messages = input.messages.map((message) => ({
    role: message.role,
    content: String(message.content ?? '').trim(),
  })).filter((message) => message.content.length > 0)

  if (messages.length <= recentCount) {
    return { olderMessages: [], recentMessages: messages }
  }

  return {
    olderMessages: messages.slice(0, Math.max(0, messages.length - recentCount)),
    recentMessages: messages.slice(-recentCount),
  }
}

export function buildApplicationContextSummaryPrompt(
  input: BuildApplicationContextSummaryPromptInput,
): ApplicationContextSummaryPrompt {
  const charBudget = Math.max(800, Math.floor(input.summaryCharBudget ?? DEFAULT_SUMMARY_CHAR_BUDGET))
  const olderBlock = formatTranscript(input.olderMessages)
  const recentBlock = formatTranscript(input.recentMessages)
  const contextBlock = input.contextPrompt?.trim()
    ? `Existing retrieval/context block (keep facts that still matter):\n${clamp(input.contextPrompt.trim(), 4_000)}\n\n`
    : ''

  const systemPrompt = [
    'You compress conversation history for a coding/AI assistant.',
    'Output plain text only (no markdown fences, no tool calls).',
    'Preserve: user goals, constraints, decisions, file paths, errors, APIs, TODOs, and open questions.',
    'Drop: chit-chat, repeated tool noise, and obsolete failed attempts unless they still constrain work.',
    `Target length: under ~${charBudget} characters.`,
    'Write in the same primary language as the transcript.',
  ].join(' ')

  const userPrompt = [
    contextBlock,
    'Older transcript to compress:',
    olderBlock || '(empty)',
    '',
    'Recent turns that will be kept verbatim (do not repeat them unless needed for continuity):',
    recentBlock || '(empty)',
    '',
    'Return a dense history summary the assistant can continue from.',
  ].join('\n')

  return {
    systemPrompt,
    userPrompt,
    maxTokens: Math.max(256, Math.floor(input.maxTokens ?? DEFAULT_SUMMARY_MAX_TOKENS)),
    estimatedInputChars: systemPrompt.length + userPrompt.length,
  }
}

/**
 * Bounds the summary request itself. The application summary is a separate
 * model turn, so its transcript must fit the selected model before the main
 * request is considered. Older turns receive most of the budget while the
 * latest turns remain available for continuity.
 */
export function fitApplicationContextSummaryMessages(
  input: FitApplicationContextSummaryMessagesInput,
): FitApplicationContextSummaryMessagesResult {
  const maxInputTokens = Math.max(256, Math.floor(input.maxInputTokens))
  let olderMessages = normalizeSummaryMessages(input.olderMessages)
  let recentMessages = normalizeSummaryMessages(input.recentMessages)
  const originalLength = olderMessages.length + recentMessages.length
  const estimatePrompt = () => {
    const prompt = buildApplicationContextSummaryPrompt({
      olderMessages,
      recentMessages,
      contextPrompt: input.contextPrompt,
    })
    return input.estimateTextTokens(`${prompt.systemPrompt}\n${prompt.userPrompt}`)
  }

  const emptyPrompt = buildApplicationContextSummaryPrompt({
    olderMessages: [],
    recentMessages: [],
    contextPrompt: input.contextPrompt,
  })
  const emptyPromptTokens = input.estimateTextTokens(`${emptyPrompt.systemPrompt}\n${emptyPrompt.userPrompt}`)
  const transcriptBudget = Math.max(64, maxInputTokens - emptyPromptTokens)
  const recentBudget = Math.max(32, Math.floor(transcriptBudget * 0.4))
  const olderBudget = Math.max(32, transcriptBudget - recentBudget)
  olderMessages = fitSummaryMessageList(olderMessages, olderBudget, input.estimateTextTokens)
  recentMessages = fitSummaryMessageList(recentMessages, recentBudget, input.estimateTextTokens)

  let estimatedInputTokens = estimatePrompt()
  let guard = 0
  while (estimatedInputTokens > maxInputTokens && guard < 96) {
    guard += 1
    const olderIndex = longestSummaryMessageIndex(olderMessages)
    const recentIndex = longestSummaryMessageIndex(recentMessages)
    const olderLength = olderIndex >= 0 ? olderMessages[olderIndex].content.length : 0
    const recentLength = recentIndex >= 0 ? recentMessages[recentIndex].content.length : 0
    if (olderLength >= recentLength && olderIndex >= 0 && olderLength > 32) {
      olderMessages = shrinkSummaryMessageAt(olderMessages, olderIndex, input.estimateTextTokens)
    } else if (recentIndex >= 0 && recentLength > 32) {
      recentMessages = shrinkSummaryMessageAt(recentMessages, recentIndex, input.estimateTextTokens)
    } else if (olderMessages.length > 1) {
      olderMessages = olderMessages.slice(1)
    } else if (recentMessages.length > 2) {
      recentMessages = recentMessages.slice(1)
    } else {
      break
    }
    estimatedInputTokens = estimatePrompt()
  }

  const originalMessages = [...normalizeSummaryMessages(input.olderMessages), ...normalizeSummaryMessages(input.recentMessages)]
  const fittedMessages = [...olderMessages, ...recentMessages]
  const originalCounts = new Map<string, number>()
  originalMessages.forEach((message) => {
    const key = `${message.role}\u0000${message.content}`
    originalCounts.set(key, (originalCounts.get(key) ?? 0) + 1)
  })
  let unchangedCount = 0
  fittedMessages.forEach((message) => {
    const key = `${message.role}\u0000${message.content}`
    const count = originalCounts.get(key) ?? 0
    if (count > 0) {
      unchangedCount += 1
      originalCounts.set(key, count - 1)
    }
  })

  return {
    olderMessages,
    recentMessages,
    estimatedInputTokens,
    truncatedMessageCount: Math.max(0, originalLength - unchangedCount),
  }
}

export function parseApplicationContextSummaryText(raw: string): string {
  const text = String(raw ?? '').trim()
  if (!text) return ''
  return text
    .replace(/^```[\w-]*\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

export function mergeApplicationSummaryIntoContextPrompt(input: {
  baseContextPrompt?: string
  summary: string
}): string {
  const base = input.baseContextPrompt?.trim() ?? ''
  const summary = input.summary.trim()
  if (!summary) return base
  const block = `历史摘要（模型）\n${summary}`
  return [base, block].filter(Boolean).join('\n\n')
}

export function classifyApplicationContextSummaryFailure(error: unknown): {
  code: ApplicationContextSummaryFailureCode
  message: string
} {
  if (error && typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'AbortError') {
    return { code: 'aborted', message: 'summary_aborted' }
  }
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('deadline')) {
    return { code: 'timeout', message: message.slice(0, 240) }
  }
  if (lower.includes('abort')) {
    return { code: 'aborted', message: message.slice(0, 240) }
  }
  if (lower.includes('concurren') || lower.includes('saturated') || lower.includes('too many')) {
    return { code: 'concurrency_saturated', message: message.slice(0, 240) }
  }
  return { code: 'provider_error', message: message.slice(0, 240) }
}

function formatTranscript(messages: readonly ApplicationContextSummaryMessage[]): string {
  return messages
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${clamp(message.content, 2_000)}`)
    .join('\n\n')
}

function normalizeSummaryMessages(messages: readonly ApplicationContextSummaryMessage[]): ApplicationContextSummaryMessage[] {
  return messages
    .map((message) => ({
      role: message.role,
      content: String(message.content ?? '').trim(),
    }))
    .filter((message) => message.content.length > 0)
}

function fitSummaryMessageList(
  messages: ApplicationContextSummaryMessage[],
  tokenBudget: number,
  estimateTextTokens: (text: string) => number,
): ApplicationContextSummaryMessage[] {
  if (!messages.length) return []
  const perMessageBudget = Math.max(24, Math.floor(tokenBudget / messages.length))
  return messages.map((message) => ({
    ...message,
    content: truncateSummaryTextToTokens(message.content, perMessageBudget, estimateTextTokens),
  }))
}

function longestSummaryMessageIndex(messages: readonly ApplicationContextSummaryMessage[]): number {
  let index = -1
  let length = 0
  messages.forEach((message, candidateIndex) => {
    if (message.content.length > length) {
      length = message.content.length
      index = candidateIndex
    }
  })
  return index
}

function shrinkSummaryMessageAt(
  messages: ApplicationContextSummaryMessage[],
  index: number,
  estimateTextTokens: (text: string) => number,
): ApplicationContextSummaryMessage[] {
  const message = messages[index]
  const currentTokens = estimateTextTokens(message.content)
  const targetTokens = Math.max(16, Math.floor(currentTokens * 0.78))
  return messages.map((candidate, candidateIndex) => candidateIndex === index
    ? { ...candidate, content: truncateSummaryTextToTokens(candidate.content, targetTokens, estimateTextTokens) }
    : candidate)
}

function truncateSummaryTextToTokens(
  text: string,
  tokenBudget: number,
  estimateTextTokens: (text: string) => number,
): string {
  const source = text.trim()
  if (!source || estimateTextTokens(source) <= tokenBudget) return source
  let low = 1
  let high = source.length
  let best = source.slice(0, Math.max(1, Math.floor(source.length * 0.1)))
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = preserveSummaryHeadTail(source, mid)
    if (estimateTextTokens(candidate) <= tokenBudget) {
      best = candidate
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return best
}

function preserveSummaryHeadTail(text: string, keepChars: number): string {
  if (text.length <= keepChars) return text
  const marker = '\n...\n'
  const available = Math.max(8, keepChars - marker.length)
  const head = Math.max(4, Math.floor(available * 0.55))
  return `${text.slice(0, head).trimEnd()}${marker}${text.slice(Math.max(head, text.length - (available - head))).trimStart()}`
}

function clamp(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1))}…`
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
