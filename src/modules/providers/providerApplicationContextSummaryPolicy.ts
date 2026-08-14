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
    maxTokens: DEFAULT_SUMMARY_MAX_TOKENS,
    estimatedInputChars: systemPrompt.length + userPrompt.length,
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

function clamp(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1))}…`
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
