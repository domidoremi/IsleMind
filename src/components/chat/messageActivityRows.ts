import type { ProcessTrace } from '@/core'
import { sanitizeTraceDisplayText as safeActivityText } from '@/core'
import { safeResponseLifecycleSummary } from '@/modules/conversations'
import type { Message, MessageResponseLifecycleEntry, ResponseLifecycleStage } from '@/types/chatContracts'
import type { TFunction } from 'i18next'
import { formatProcessTraceForDisplay, isAgentIntentTrace, isAgentPlanTrace, isAgentWorkflowEnvelopeTrace } from './tracePresentation'

export type MessageActivityState = ProcessTrace['status'] | 'waiting' | 'incomplete'
export type MessageActivityKind = ResponseLifecycleStage | 'command' | 'edit' | 'search' | 'retrieval' | 'tool' | 'tool_request'
export interface MessageActivityDetail {
  kind: 'summary' | 'input' | 'output'
  text: string
}
export interface MessageActivityRow {
  id: string
  kind: MessageActivityKind
  state: MessageActivityState
  subject?: string
  startedAt?: number
  completedAt?: number
  durationMs?: number
  details: MessageActivityDetail[]
}

/** Project recorded events, not a fabricated checklist. A trace keeps its identity
 * when its result arrives, so expanding one activity never opens another one. */
export function collectMessageActivityRows(message: Message, traces: ProcessTrace[]): MessageActivityRow[] {
  // Workflow bookkeeping uses the historical "reasoning" trace type too. It
  // is not model thinking and must not produce several meaningless "Completed"
  // rows (or leak its internal step/status text into a thinking disclosure).
  const internalTraceIds = new Set(traces.filter(trace => isAgentIntentTrace(trace) || isAgentPlanTrace(trace) ||
    isAgentWorkflowEnvelopeTrace(trace) || (trace.type === 'reasoning' && trace.id.endsWith('-start') &&
      Boolean(trace.metadata?.toolName || trace.metadata?.toolId))).map(trace => trace.id))
  const visibleTraces = [...new Map(traces.filter(trace => !trace.metadata?.hiddenSignature && trace.type !== 'system' && !internalTraceIds.has(trace.id))
    .map(trace => [trace.id, trace])).values()]
  const traceRows = new Map(visibleTraces.map(trace => [trace.id, activityForTrace(trace, message.status)]))
  const history = message.responseLifecycle?.history ?? []
  const rows: MessageActivityRow[] = []
  const linked = new Set<string>()
  for (const [index, entry] of history.entries()) {
    if (entry.traceId && internalTraceIds.has(entry.traceId)) continue
    if (entry.stage === 'completed' || entry.stage === 'error' || entry.stage === 'cancelled') continue
    // The response body itself displays generation once text has arrived.
    if (entry.stage === 'generating' && (message.responseText ?? message.content).trim()) continue
    const next = history[index + 1]
    const matches = visibleTraces.filter(trace => matchesLifecycleActivity(trace, entry, next))
    if (matches.length) {
      for (const trace of matches) {
        const row = traceRows.get(trace.id)!
        if (!linked.has(trace.id)) {
          row.startedAt ??= entry.startedAt
          rows.push(row)
          linked.add(trace.id)
        }
        if (entry.stage === 'thinking') {
          const summary = safeActivitySummary(entry.summary)
          if (summary) row.details = [{ kind: 'summary', text: summary }]
        }
      }
      continue
    }
    const summary = entry.stage === 'thinking' ? safeActivitySummary(entry.summary) : undefined
    rows.push({
      id: `lifecycle:${entry.stage}:${entry.startedAt}:${entry.traceId ?? ''}`,
      kind: entry.stage,
      state: next?.stage === 'error' || next?.stage === 'cancelled'
        ? next.stage
        : entry.completedAt !== undefined
          ? 'done'
          : unsettledState(message.status),
      startedAt: entry.startedAt,
      completedAt: entry.completedAt,
      details: summary ? [{ kind: 'summary', text: summary }] : [],
    })
  }
  for (const trace of visibleTraces) {
    if (!linked.has(trace.id)) rows.push(traceRows.get(trace.id)!)
  }
  // Sort by start, never completion: a slow parallel command must not jump down
  // the list (or exchange disclosure state with a faster command) on completion.
  rows.sort((a, b) => (a.startedAt ?? message.startedAt ?? message.timestamp) - (b.startedAt ?? message.startedAt ?? message.timestamp))
  if (!rows.length && (message.status === 'sending' || message.status === 'streaming')) {
    rows.push({ id: 'request', kind: message.status === 'sending' ? 'preparing' : 'waiting', state: 'running', details: [] })
  }
  if ((message.status === 'error' || message.status === 'cancelled') && !rows.some(row => row.state === message.status)) {
    rows.push({ id: 'terminal', kind: message.status, state: message.status, details: [] })
  }
  return rows
}

function matchesLifecycleActivity(trace: ProcessTrace, entry: MessageResponseLifecycleEntry, next?: MessageResponseLifecycleEntry): boolean {
  const sameKind = entry.stage === 'thinking' ? trace.type === 'reasoning'
    : entry.stage === 'tool_calling' || entry.stage === 'tool_result' ? trace.type === 'tool'
      : entry.stage === 'working' ? ['search', 'retrieval', 'memory', 'knowledge'].includes(trace.type)
        : false
  if (!sameKind) return false
  if (entry.traceId) return trace.id === entry.traceId
  // Legacy histories may lack a trace id. Only correlate a real event boundary;
  // do not attach an unrelated tool/summary simply because it is the latest one.
  if (entry.stage === 'tool_result') return trace.completedAt === entry.startedAt
  return trace.startedAt !== undefined && trace.startedAt >= entry.startedAt &&
    (next ? trace.startedAt < next.startedAt : entry.completedAt === undefined || trace.startedAt <= entry.completedAt)
}

function unsettledState(status: Message['status']): MessageActivityState {
  if (status === 'error' || status === 'cancelled') return status
  return status === 'done' ? 'incomplete' : 'running'
}

function activityForTrace(trace: ProcessTrace, messageStatus: Message['status']): MessageActivityRow {
  const metadata = trace.metadata ?? {}
  const permissionPending = metadata.errorCode === 'permission_required' || metadata.code === 'permission_required' ||
    metadata.decision === 'confirm' || metadata.decision === 'ask'
  const cancelled = trace.status === 'cancelled' || metadata.errorCode === 'cancelled' || metadata.code === 'confirmation_declined' ||
    messageStatus === 'cancelled' && permissionPending
  const state: MessageActivityState = cancelled ? 'cancelled' : permissionPending ? 'waiting'
    : trace.status === 'running' || trace.status === 'pending'
      ? messageStatus === 'streaming' || messageStatus === 'sending' ? trace.status : unsettledState(messageStatus)
      : trace.status
  const toolName = safeActivityText(metadata.toolName ?? metadata.toolId, 120)
  const kind = activityKind(trace, toolName)
  const display = formatProcessTraceForDisplay(trace, 2400)
  const subject = trace.type === 'tool'
    ? safeActivityText(kind === 'edit' ? metadata.filePath ?? metadata.path : undefined, 120) || toolName || safeActivityText(display.title, 120)
    : undefined
  const details: MessageActivityDetail[] = []
  if (kind === 'thinking') {
    // Only explicit provider display summaries are eligible. Never expose raw
    // reasoning, including private blocks inside an otherwise safe summary.
    const summary = safeActivitySummary(display.content)
    if (summary) details.push({ kind: 'summary', text: summary })
  } else {
    const input = safeActivityText(metadata.inputSummary, 1600)
    const output = safeActivityText(display.content || metadata.outputSummary || (state === 'error' ? metadata.errorMessage ?? metadata.errorCode : undefined), 2400)
    if (input) details.push({ kind: 'input', text: input })
    if (output && output !== input) details.push({ kind: 'output', text: output })
  }
  return { id: `trace:${trace.id}`, kind, state, subject, startedAt: trace.startedAt, completedAt: trace.completedAt, durationMs: trace.durationMs, details }
}

function activityKind(trace: ProcessTrace, toolName: string): MessageActivityKind {
  if (trace.type === 'reasoning') return 'thinking'
  if (trace.type === 'search') return 'search'
  if (trace.type !== 'tool') return 'retrieval'
  if (trace.metadata?.toolCallMode === 'native-provider' &&
    (trace.metadata.toolCallSource === 'provider' || trace.metadata.source === 'provider') &&
    typeof trace.metadata.permission !== 'string') return 'tool_request'
  // Classify only the recorded tool identity, not arbitrary output text.
  if (/(?:^|[.:/])(?:exec_command|execute_command|run_command|run_shell|shell|bash|powershell|terminal|run_code)$/i.test(toolName)) return 'command'
  if (/(?:^|[.:/])(?:apply_patch|edit_file|write_file|replace_in_file|apply_operations)$/i.test(toolName)) return 'edit'
  if (/(?:^|[.:/_])(?:search|web_search|search_web)$/i.test(toolName)) return 'search'
  return 'tool'
}

function safeActivitySummary(value: unknown): string | undefined {
  return safeResponseLifecycleSummary(safeActivityText(value, 720))
}

export function messageActivityLabel(row: MessageActivityRow, t: TFunction): string {
  const active = row.state === 'running'
  const phase = active ? 'active' : row.state === 'done' ? 'done' : 'idle'
  const label = t(`messageBubble.activity.${row.kind}.${phase}`, { subject: row.subject ?? '' }).trim()
  return ['pending', 'error', 'cancelled', 'skipped', 'waiting', 'incomplete'].includes(row.state) && row.kind !== 'error' && row.kind !== 'cancelled'
    ? `${label} · ${t(`messageBubble.activity.state.${row.state}`)}`
    : label
}
