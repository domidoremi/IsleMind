import type { UsageConversationSummary, UsageRecord, UsageRequestSummary } from '../contracts'
import { deduplicateUsageAttempts, summarizeUsageRecords } from './usageSummary'

/** Group only explicit request identities. Correlation IDs may identify a whole conversation. */
export function projectUsageRequests(input: readonly UsageRecord[]): UsageRequestSummary[] {
  const grouped = new Map<string, UsageRecord[]>()
  for (const record of deduplicateUsageAttempts(input)) {
    const key = record.execution ? `request:${record.execution.logicalRequestId}` : `attempt:${record.id}`
    const group = grouped.get(key) ?? []
    group.push(record)
    grouped.set(key, group)
  }
  return [...grouped.values()].map(projectRequest).sort((left, right) =>
    right.occurredAt - left.occurredAt || left.reference.id.localeCompare(right.reference.id))
}

export function projectUsageConversations(records: readonly UsageRecord[]): UsageConversationSummary[] {
  const grouped = new Map<string, UsageRecord[]>()
  for (const record of records) {
    if (!record.conversationId) continue
    const group = grouped.get(record.conversationId) ?? []
    group.push(record)
    grouped.set(record.conversationId, group)
  }
  return [...grouped.entries()].map(([conversationId, group]) => ({
    conversationId,
    lastOccurredAt: group.reduce((latest, record) => Math.max(latest, record.execution?.requestStartedAt ?? record.occurredAt), 0),
    ...summarizeUsageRecords(group),
  })).sort((left, right) => right.lastOccurredAt - left.lastOccurredAt)
}

function projectRequest(group: UsageRecord[]): UsageRequestSummary {
  const attempts = [...group].sort((left, right) => left.occurredAt - right.occurredAt
    || left.completedAt - right.completedAt || left.id.localeCompare(right.id))
  const first = attempts[0]!
  const last = attempts[attempts.length - 1]!
  const execution = first.execution
  const startedAt = execution?.requestStartedAt
  const completedAt = attempts.reduce((latest, record) => Math.max(latest, record.completedAt), 0)
  const firstVisibleAt = attempts.reduce<number | undefined>((earliest, record) => {
    if (record.firstTokenMs === undefined) return earliest
    const at = record.occurredAt + record.firstTokenMs
    return earliest === undefined ? at : Math.min(earliest, at)
  }, undefined)
  const summary = summarizeUsageRecords(attempts)
  return {
    reference: execution ? { kind: 'request', id: execution.logicalRequestId } : { kind: 'attempt', id: first.id },
    occurredAt: startedAt ?? first.occurredAt,
    completedAt,
    ...(first.conversationId ? { conversationId: first.conversationId } : {}),
    ...(execution?.messageId ? { messageId: execution.messageId } : {}),
    ...(execution?.responseExecutionId ? { responseExecutionId: execution.responseExecutionId } : {}),
    ...(execution?.parentRequestId ? { parentRequestId: execution.parentRequestId } : {}),
    originalProviderId: first.originalProviderId ?? first.providerId,
    originalModel: first.originalModel ?? first.requestedModel,
    providerId: last.providerId,
    providerName: last.providerName,
    requestedModel: last.upstreamModel,
    ...(last.reportedExecution ? { reportedExecution: last.reportedExecution } : {}),
    status: last.status,
    operationSource: first.operationSource,
    attemptCount: attempts.length,
    retryCount: attempts.filter(record => record.attemptReason === 'retry' || record.attemptReason === 'rectification').length,
    failoverCount: summary.failoverCount,
    ...(startedAt === undefined ? {} : { durationMs: Math.max(0, completedAt - startedAt) }),
    ...(startedAt === undefined || firstVisibleAt === undefined ? {} : { firstVisibleTextMs: Math.max(0, firstVisibleAt - startedAt) }),
    summary,
  }
}
