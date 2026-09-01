import type {
  MessageResponseLifecycle,
  MessageResponseLifecycleEntry,
  MessageStatus,
  ResponseLifecycleStage,
} from '@/types/chatContracts'
import type { ProcessTrace } from '@/core'
import { redactSensitiveText } from '@/core'

export const RESPONSE_LIFECYCLE_STAGES: readonly ResponseLifecycleStage[] = [
  'preparing',
  'sending',
  'waiting',
  'thinking',
  'working',
  'tool_calling',
  'tool_result',
  'generating',
  'completed',
  'error',
  'cancelled',
] as const

const RESPONSE_LIFECYCLE_HISTORY_LIMIT = 32
const RESPONSE_LIFECYCLE_SUMMARY_LIMIT = 180

const TERMINAL_STAGES = new Set<ResponseLifecycleStage>([
  'completed',
  'error',
  'cancelled',
])

export interface ResponseLifecycleTransitionOptions {
  summary?: string
  traceId?: string
}

export function createResponseLifecycle(
  startedAt: number,
  stage: ResponseLifecycleStage = 'preparing',
  options: ResponseLifecycleTransitionOptions = {},
): MessageResponseLifecycle {
  const start = finiteTimestamp(startedAt, Date.now())
  const safeStage = isResponseLifecycleStage(stage) ? stage : 'preparing'
  const entry: MessageResponseLifecycleEntry = {
    stage: safeStage,
    startedAt: start,
    ...(safeSummary(options.summary) ? { summary: safeSummary(options.summary) } : {}),
    ...(safeTraceId(options.traceId) ? { traceId: safeTraceId(options.traceId) } : {}),
    ...(isTerminalResponseLifecycleStage(safeStage) ? { completedAt: start } : {}),
  }
  return {
    stage: safeStage,
    startedAt: start,
    stageStartedAt: start,
    ...(isTerminalResponseLifecycleStage(safeStage) ? { completedAt: start } : {}),
    history: [entry],
  }
}

/**
 * Advances the persisted lifecycle from a real runtime event. Repeating the
 * current stage updates its safe metadata without resetting its time base.
 */
export function transitionResponseLifecycle(
  current: MessageResponseLifecycle | undefined,
  nextStage: ResponseLifecycleStage,
  at = Date.now(),
  options: ResponseLifecycleTransitionOptions = {},
): MessageResponseLifecycle {
  const stage = isResponseLifecycleStage(nextStage) ? nextStage : 'working'
  if (!current) return createResponseLifecycle(at, stage, options)

  const normalized = normalizeResponseLifecycle(current, current.startedAt, 'streaming')
    ?? createResponseLifecycle(current.startedAt, 'preparing')
  const timestamp = finiteTimestamp(at, normalized.stageStartedAt)
  // Provider callbacks can arrive with the trace's original start time (or a
  // skewed clock). A lifecycle transition must never move backward relative
  // to the currently active stage.
  const safeAt = Math.max(normalized.startedAt, normalized.stageStartedAt, timestamp)

  // A terminal projection is authoritative. A late provider callback must not
  // reopen a completed, failed, or cancelled message.
  if (isTerminalResponseLifecycleStage(normalized.stage) && stage !== normalized.stage) {
    return normalized
  }

  // Non-terminal trace callbacks can be delivered after a newer stage has
  // already started. Ignore those stale boundaries instead of visually
  // regressing generating/tool-loop progress. A later tool cycle still
  // advances normally because its event timestamp is newer.
  if (
    stage !== normalized.stage &&
    !isTerminalResponseLifecycleStage(stage) &&
    timestamp < normalized.stageStartedAt
  ) {
    return normalized
  }

  const summary = safeSummary(options.summary)
  const traceId = safeTraceId(options.traceId)
  if (stage === normalized.stage) {
    const nextHistory = updateLastEntry(normalized.history, {
      ...(summary ? { summary } : {}),
      ...(traceId ? { traceId } : {}),
      ...(isTerminalResponseLifecycleStage(stage)
        ? { completedAt: Math.max(normalized.completedAt ?? safeAt, safeAt) }
        : {}),
    })
    return {
      ...normalized,
      ...(isTerminalResponseLifecycleStage(stage)
        ? { completedAt: Math.max(normalized.completedAt ?? safeAt, safeAt) }
        : {}),
      history: trimHistory(nextHistory),
    }
  }

  const closedHistory = closeCurrentEntry(normalized.history, safeAt)
  const nextEntry: MessageResponseLifecycleEntry = {
    stage,
    startedAt: safeAt,
    ...(summary ? { summary } : {}),
    ...(traceId ? { traceId } : {}),
    ...(isTerminalResponseLifecycleStage(stage) ? { completedAt: safeAt } : {}),
  }
  return {
    stage,
    startedAt: normalized.startedAt,
    stageStartedAt: safeAt,
    ...(isTerminalResponseLifecycleStage(stage) ? { completedAt: safeAt } : {}),
    history: trimHistory([...closedHistory, nextEntry]),
  }
}

export function normalizeResponseLifecycle(
  value: unknown,
  fallbackStartedAt: number,
  fallbackStatus: MessageStatus,
  fallbackCompletedAt?: number,
): MessageResponseLifecycle | undefined {
  const fallback = finiteTimestamp(fallbackStartedAt, Date.now())
  const fallbackCompleted = finiteOptionalTimestamp(fallbackCompletedAt)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const stage = lifecycleStageForMessageStatus(fallbackStatus)
    const lifecycle = createResponseLifecycle(fallback, stage)
    return isTerminalResponseLifecycleStage(stage) && fallbackCompleted !== undefined
      ? transitionResponseLifecycle(lifecycle, stage, Math.max(fallback, fallbackCompleted))
      : lifecycle
  }
  const candidate = value as Partial<MessageResponseLifecycle> & { history?: unknown }
  const stage = isResponseLifecycleStage(candidate.stage)
    ? candidate.stage
    : lifecycleStageForMessageStatus(fallbackStatus)
  const startedAt = finiteTimestamp(candidate.startedAt, fallback)
  const stageStartedAt = Math.max(startedAt, finiteTimestamp(candidate.stageStartedAt, startedAt))
  const completedAt = candidate.completedAt === undefined
    ? isTerminalResponseLifecycleStage(stage)
      ? Math.max(stageStartedAt, fallbackCompleted ?? stageStartedAt)
      : undefined
    : Math.max(stageStartedAt, finiteTimestamp(candidate.completedAt, stageStartedAt))
  const history = normalizeHistory(candidate.history, stage, startedAt, stageStartedAt, completedAt)
  return {
    stage,
    startedAt,
    stageStartedAt,
    ...(completedAt === undefined ? {} : { completedAt }),
    history,
  }
}

export function lifecycleStageForMessageStatus(status: MessageStatus): ResponseLifecycleStage {
  switch (status) {
    case 'sending':
      return 'sending'
    case 'streaming':
      return 'waiting'
    case 'done':
      return 'completed'
    case 'error':
      return 'error'
    case 'cancelled':
      return 'cancelled'
  }
}

export function lifecycleStageForTrace(
  trace: Pick<ProcessTrace, 'type' | 'status'>,
  hasOutput = false,
): ResponseLifecycleStage | undefined {
  if (trace.status === 'running' || trace.status === 'pending') {
    if (trace.type === 'reasoning') return 'thinking'
    if (trace.type === 'tool') return 'tool_calling'
    if (trace.type === 'retrieval' || trace.type === 'search' || trace.type === 'memory' || trace.type === 'knowledge') {
      return 'working'
    }
    if (trace.type === 'system') return 'working'
    return undefined
  }
  if (trace.status === 'done') {
    if (trace.type === 'tool') return 'tool_result'
    if (trace.type === 'reasoning') return hasOutput ? 'generating' : 'working'
    if (trace.type === 'retrieval' || trace.type === 'search' || trace.type === 'memory' || trace.type === 'knowledge') {
      return hasOutput ? 'generating' : 'working'
    }
  }
  return undefined
}

/**
 * Resolves the event boundary used for a trace-driven lifecycle transition.
 * Running traces begin at `startedAt`; terminal trace events end at their
 * provider-reported `completedAt` when available. Falling back to the current
 * clock keeps incomplete provider payloads observable without inventing a
 * duration from their original start time.
 */
export function responseLifecycleTraceTimestamp(
  trace: Pick<ProcessTrace, 'status' | 'startedAt' | 'completedAt'>,
  now = Date.now(),
): number {
  const terminal = trace.status === 'done' ||
    trace.status === 'error' ||
    trace.status === 'skipped' ||
    trace.status === 'cancelled'
  const candidate = terminal ? trace.completedAt : trace.startedAt
  return finiteTimestamp(candidate, finiteTimestamp(now, Date.now()))
}

export function isResponseLifecycleStage(value: unknown): value is ResponseLifecycleStage {
  return typeof value === 'string' && RESPONSE_LIFECYCLE_STAGES.includes(value as ResponseLifecycleStage)
}

export function isTerminalResponseLifecycleStage(stage: ResponseLifecycleStage): boolean {
  return TERMINAL_STAGES.has(stage)
}

export function responseLifecycleElapsedMs(
  lifecycle: Pick<MessageResponseLifecycle, 'stage' | 'stageStartedAt' | 'startedAt' | 'completedAt'>,
  now = Date.now(),
): number {
  const end = lifecycle.completedAt ?? finiteTimestamp(now, lifecycle.stageStartedAt)
  const start = lifecycle.stage === 'completed' || lifecycle.stage === 'error' || lifecycle.stage === 'cancelled'
    ? lifecycle.startedAt
    : lifecycle.stageStartedAt
  return Math.max(0, end - start)
}

export function safeResponseLifecycleSummary(value: unknown): string | undefined {
  return safeSummary(value)
}

/**
 * Only explicitly marked provider summaries may enter the visible lifecycle.
 * Raw trace content is intentionally excluded because it can contain internal
 * reasoning or unbounded tool payloads.
 */
export function safeResponseLifecycleTraceSummary(
  trace: Pick<ProcessTrace, 'metadata'>,
): string | undefined {
  const metadata = trace.metadata
  return safeSummary(
    typeof metadata?.safeSummary === 'string'
      ? metadata.safeSummary
      : typeof metadata?.displaySummary === 'string'
        ? metadata.displaySummary
        : undefined,
  )
}

function normalizeHistory(
  value: unknown,
  currentStage: ResponseLifecycleStage,
  startedAt: number,
  stageStartedAt: number,
  completedAt: number | undefined,
): MessageResponseLifecycleEntry[] {
  const raw = Array.isArray(value) ? value : []
  const entries: MessageResponseLifecycleEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const candidate = item as Partial<MessageResponseLifecycleEntry>
    if (!isResponseLifecycleStage(candidate.stage)) continue
    const entryStartedAt = Math.max(startedAt, finiteTimestamp(candidate.startedAt, startedAt))
    const entryCompletedAt = candidate.completedAt === undefined
      ? undefined
      : Math.max(entryStartedAt, finiteTimestamp(candidate.completedAt, entryStartedAt))
    entries.push({
      stage: candidate.stage,
      startedAt: entryStartedAt,
      ...(entryCompletedAt === undefined ? {} : { completedAt: entryCompletedAt }),
      ...(safeSummary(candidate.summary) ? { summary: safeSummary(candidate.summary) } : {}),
      ...(safeTraceId(candidate.traceId) ? { traceId: safeTraceId(candidate.traceId) } : {}),
    })
  }
  const trimmed = trimHistory(entries)
  const last = trimmed.at(-1)
  if (!last || last.stage !== currentStage || last.startedAt !== stageStartedAt) {
    return trimHistory([
      ...trimmed,
      {
        stage: currentStage,
        startedAt: stageStartedAt,
        ...(completedAt === undefined ? {} : { completedAt }),
      },
    ])
  }
  if (completedAt !== undefined && last.completedAt === undefined) {
    return trimHistory([...trimmed.slice(0, -1), { ...last, completedAt }])
  }
  return trimmed
}

function closeCurrentEntry(
  history: MessageResponseLifecycleEntry[],
  completedAt: number,
): MessageResponseLifecycleEntry[] {
  const last = history.at(-1)
  if (!last || last.completedAt !== undefined) return history
  return [...history.slice(0, -1), { ...last, completedAt: Math.max(last.startedAt, completedAt) }]
}

function updateLastEntry(
  history: MessageResponseLifecycleEntry[],
  updates: Partial<MessageResponseLifecycleEntry>,
): MessageResponseLifecycleEntry[] {
  if (!history.length) return history
  const last = history.at(-1)
  if (!last) return history
  return [...history.slice(0, -1), { ...last, ...updates }]
}

function trimHistory(history: MessageResponseLifecycleEntry[]): MessageResponseLifecycleEntry[] {
  return history.length > RESPONSE_LIFECYCLE_HISTORY_LIMIT
    ? history.slice(-RESPONSE_LIFECYCLE_HISTORY_LIMIT)
    : history
}

function safeSummary(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = redactSensitiveText(value)
    // An explicitly supplied summary can still arrive wrapped in provider
    // protocol markup. Drop the entire private block, not only its tags.
    .replace(/<(think|thinking|thought|reasoning)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
    .replace(/<(?:tool_call|islemind_mcp_call)\b[^>]*>[\s\S]*?(?:<\/(?:tool_call|islemind_mcp_call)\s*>|$)/gi, '')
    .replace(/<\/?(?:think|thinking|thought|reasoning|tool_call|islemind_mcp_call)\b[^>]*>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return undefined
  return normalized.length <= RESPONSE_LIFECYCLE_SUMMARY_LIMIT
    ? normalized
    : `${normalized.slice(0, RESPONSE_LIFECYCLE_SUMMARY_LIMIT - 1).trimEnd()}...`
}

function safeTraceId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized ? normalized.slice(0, 160) : undefined
}

function finiteTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function finiteOptionalTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
