import {
  buildApplicationContextSummaryPrompt,
  classifyApplicationContextSummaryFailure,
  mergeApplicationSummaryIntoContextPrompt,
  parseApplicationContextSummaryText,
  resolveApplicationContextSummaryBudget,
  fitApplicationContextSummaryMessages,
  splitHistoryForApplicationSummary,
  type ApplicationContextSummaryFailureCode,
  type ApplicationContextSummaryMessage,
  APPLICATION_CONTEXT_SUMMARY_MAX_CONCURRENT,
} from '@/modules/providers'
import { generateProviderText } from '@/bootstrap/providerRuntime'
import { estimateTextTokens } from '@/services/tokenUsage'
import type { ProviderRuntimeChatRequest } from '@/modules/providers'
import type { AIProvider } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'

export interface RunApplicationContextSummaryInput {
  provider: AIProvider
  model: string
  messages: readonly ApplicationContextSummaryMessage[]
  contextPrompt?: string
  settings?: Settings
  signal?: AbortSignal
  conversationId?: string
  sessionId?: string
  temperature?: number
  /** Override timeout (ms); otherwise derived from settings with a hard cap. */
  timeoutMs?: number
  /** Selected model context window used to bound this dedicated summary turn. */
  modelContextWindow?: number
  /** Explicit summary input budget; otherwise derived from modelContextWindow. */
  maxInputTokens?: number
  /** Main-turn system prompt, retained for composition-contract symmetry. */
  systemPrompt?: string
  /** Main-turn output budget, retained for composition-contract symmetry. */
  maxOutputTokens?: number
}

export interface RunApplicationContextSummaryResult {
  ok: boolean
  summary: string
  contextPrompt: string
  recentMessages: ApplicationContextSummaryMessage[]
  olderMessageCount: number
  failureReason?: string
  failureCode?: ApplicationContextSummaryFailureCode
  durationMs: number
  timeoutMs: number
  estimatedInputChars: number
  estimatedInputTokens: number
  summaryChars: number
  estimatedSavedChars: number
  truncatedMessageCount: number
}

let activeSummaryCount = 0
const summaryWaitQueue: Array<() => void> = []

/**
 * Runs a dedicated non-streaming chat turn with the selected provider/model to
 * summarize older history. Enforces timeout + process-wide concurrency.
 * On failure returns ok:false so callers keep local packing.
 */
export async function runApplicationContextSummary(
  input: RunApplicationContextSummaryInput,
): Promise<RunApplicationContextSummaryResult> {
  const startedAt = Date.now()
  const budget = resolveApplicationContextSummaryBudget({
    upstreamTimeoutMs: input.timeoutMs
      ?? input.settings?.upstreamRequestTimeoutMs
      ?? 60_000,
  })
  const timeoutMs = input.timeoutMs
    ? Math.min(budget.timeoutMs, Math.max(1_000, Math.floor(input.timeoutMs)))
    : budget.timeoutMs

  const split = splitHistoryForApplicationSummary({
    messages: input.messages,
    recentCount: budget.recentCount,
  })
  const maxInputTokens = input.maxInputTokens
    ?? Math.max(512, Math.floor((input.modelContextWindow ?? 8192) * 0.62) - budget.maxTokens)
  const fitted = fitApplicationContextSummaryMessages({
    olderMessages: split.olderMessages,
    recentMessages: split.recentMessages,
    contextPrompt: input.contextPrompt,
    maxInputTokens,
    estimateTextTokens,
  })
  const boundedSplit = {
    olderMessages: fitted.olderMessages,
    recentMessages: fitted.recentMessages,
  }
  if (!boundedSplit.olderMessages.length) {
    return emptySuccess(input, boundedSplit.recentMessages, startedAt, timeoutMs, 'no_older_messages', fitted.estimatedInputTokens, fitted.truncatedMessageCount)
  }

  if (input.signal?.aborted) {
    return fail(input, boundedSplit, startedAt, timeoutMs, 'aborted', 'summary_aborted', 0, fitted.estimatedInputTokens, fitted.truncatedMessageCount)
  }

  const lease = await acquireSummaryLease(input.signal)
  if (!lease.acquired) {
    return fail(
      input,
      boundedSplit,
      startedAt,
      timeoutMs,
      lease.reason === 'aborted' ? 'aborted' : 'concurrency_saturated',
      lease.reason === 'aborted' ? 'summary_aborted' : 'summary_concurrency_saturated',
    )
  }

  const timeoutController = new AbortController()
  const onParentAbort = () => timeoutController.abort()
  input.signal?.addEventListener('abort', onParentAbort, { once: true })
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs)

  const prompt = buildApplicationContextSummaryPrompt({
    olderMessages: boundedSplit.olderMessages,
    recentMessages: boundedSplit.recentMessages,
    contextPrompt: input.contextPrompt,
    summaryCharBudget: budget.summaryCharBudget,
    maxTokens: budget.maxTokens,
  })

  const request: ProviderRuntimeChatRequest = {
    provider: input.provider,
    model: input.model,
    systemPrompt: prompt.systemPrompt,
    messages: [{ role: 'user', content: prompt.userPrompt }],
    maxTokens: budget.maxTokens,
    temperature: input.temperature ?? 0.2,
    generationParameterSources: { temperature: 'internal-policy', maxTokens: 'internal-policy' },
    stream: false,
    signal: timeoutController.signal,
    conversationId: input.conversationId,
    sessionId: input.sessionId,
    usageContext: {
      source: 'context',
      ...(input.conversationId ? { correlationId: input.conversationId } : {}),
    },
    remoteCompactEligible: false,
    remoteCompactFallback: undefined,
    previousResponseId: undefined,
    settings: {
      remoteCompactMode: 'off',
      runtimeLogEnabled: input.settings?.runtimeLogEnabled,
      runtimeLogMaxBytes: input.settings?.runtimeLogMaxBytes,
      transportMode: input.settings?.transportMode,
      upstreamRequestTimeoutMs: timeoutMs,
      upstreamMaxRetries: 0,
    },
  }

  try {
    const raw = await generateProviderText(request)
    const summary = parseApplicationContextSummaryText(raw)
    if (!summary) {
      return fail(input, boundedSplit, startedAt, timeoutMs, 'empty_summary', 'empty_summary', prompt.estimatedInputChars, fitted.estimatedInputTokens, fitted.truncatedMessageCount)
    }
    const durationMs = Date.now() - startedAt
    const sourceChars = estimateTranscriptChars(boundedSplit.olderMessages) + estimateTranscriptChars(boundedSplit.recentMessages)
    return {
      ok: true,
      summary,
      contextPrompt: mergeApplicationSummaryIntoContextPrompt({
        baseContextPrompt: input.contextPrompt,
        summary,
      }),
      recentMessages: boundedSplit.recentMessages,
      olderMessageCount: boundedSplit.olderMessages.length,
      durationMs,
      timeoutMs,
      estimatedInputChars: prompt.estimatedInputChars,
      estimatedInputTokens: fitted.estimatedInputTokens,
      summaryChars: summary.length,
      estimatedSavedChars: Math.max(0, sourceChars - summary.length - estimateTranscriptChars(boundedSplit.recentMessages)),
      truncatedMessageCount: fitted.truncatedMessageCount,
    }
  } catch (error) {
    const classified = classifyApplicationContextSummaryFailure(error)
    // Timeout aborts surface as AbortError — map to timeout when our timer fired.
    const code = timeoutController.signal.aborted && !input.signal?.aborted
      ? 'timeout'
      : classified.code
    return fail(
      input,
      boundedSplit,
      startedAt,
      timeoutMs,
      code,
      code === 'timeout' ? `summary_timeout_${timeoutMs}ms` : classified.message,
      prompt.estimatedInputChars,
      fitted.estimatedInputTokens,
      fitted.truncatedMessageCount,
    )
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener('abort', onParentAbort)
    releaseSummaryLease()
  }
}

/** Test/helper: current in-flight summary turns. */
export function getApplicationContextSummaryActiveCount(): number {
  return activeSummaryCount
}

/** Test helper: reset concurrency gate (do not use in production paths). */
export function resetApplicationContextSummaryConcurrencyForTests(): void {
  activeSummaryCount = 0
  summaryWaitQueue.length = 0
}

async function acquireSummaryLease(signal?: AbortSignal): Promise<
  { acquired: true } | { acquired: false; reason: 'aborted' | 'saturated' }
> {
  if (signal?.aborted) return { acquired: false, reason: 'aborted' }
  if (activeSummaryCount < APPLICATION_CONTEXT_SUMMARY_MAX_CONCURRENT) {
    activeSummaryCount += 1
    return { acquired: true }
  }
  // Fail closed under saturation — do not queue indefinitely ahead of the main reply.
  return { acquired: false, reason: 'saturated' }
}

function releaseSummaryLease(): void {
  activeSummaryCount = Math.max(0, activeSummaryCount - 1)
  const next = summaryWaitQueue.shift()
  if (next) next()
}

function emptySuccess(
  input: RunApplicationContextSummaryInput,
  recentMessages: ApplicationContextSummaryMessage[],
  startedAt: number,
  timeoutMs: number,
  _code: ApplicationContextSummaryFailureCode,
  estimatedInputTokens: number,
  truncatedMessageCount: number,
): RunApplicationContextSummaryResult {
  return {
    ok: true,
    summary: '',
    contextPrompt: input.contextPrompt?.trim() ?? '',
    recentMessages,
    olderMessageCount: 0,
    durationMs: Date.now() - startedAt,
    timeoutMs,
    estimatedInputChars: 0,
    estimatedInputTokens,
    summaryChars: 0,
    estimatedSavedChars: 0,
    truncatedMessageCount,
  }
}

function fail(
  input: RunApplicationContextSummaryInput,
  split: { olderMessages: ApplicationContextSummaryMessage[]; recentMessages: ApplicationContextSummaryMessage[] },
  startedAt: number,
  timeoutMs: number,
  code: ApplicationContextSummaryFailureCode,
  message: string,
  estimatedInputChars = 0,
  estimatedInputTokens = 0,
  truncatedMessageCount = 0,
): RunApplicationContextSummaryResult {
  return {
    ok: false,
    summary: '',
    contextPrompt: input.contextPrompt?.trim() ?? '',
    recentMessages: split.recentMessages,
    olderMessageCount: split.olderMessages.length,
    failureReason: message.slice(0, 240),
    failureCode: code,
    durationMs: Date.now() - startedAt,
    timeoutMs,
    estimatedInputChars,
    estimatedInputTokens,
    summaryChars: 0,
    estimatedSavedChars: 0,
    truncatedMessageCount,
  }
}

function estimateTranscriptChars(messages: readonly ApplicationContextSummaryMessage[]): number {
  return messages.reduce((sum, message) => sum + message.content.length, 0)
}
