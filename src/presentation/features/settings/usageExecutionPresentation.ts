import type { TFunction } from 'i18next'
import { redactSensitiveText } from '@/core'
import { knownUsageTotal, type UsageExecutionDetail, type UsageRecord, type UsageRequestSummary, type UsageStatisticsSummary } from '@/modules/diagnostics'
import type { RedactedUsageRequestDetail } from '@/components/settings/usageRequestDetailTypes'

export function usageCount(value: number | undefined, locale?: string): string {
  return value === undefined ? '—' : value.toLocaleString(locale)
}

export function usageDuration(value: number | undefined): string {
  return value === undefined ? '—' : value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`
}

export function usageKnownCost(summary: Pick<UsageStatisticsSummary, 'totalCostNanodollars' | 'unknownCostCount' | 'costTotalOverflowed'>, t: TFunction): string {
  const known = summary.costTotalOverflowed ? t('usage.totalsOverflowed')
    : summary.totalCostNanodollars === undefined ? t('usage.costNotReported') : `$${(summary.totalCostNanodollars / 1_000_000_000).toFixed(5)}`
  return summary.unknownCostCount ? t('usage.knownCostWithUnknown', { known, count: summary.unknownCostCount }) : known
}

export function usageCostSources(summary: UsageStatisticsSummary, t: TFunction): string {
  const amount = (value: number | undefined) => value === undefined ? '—' : `$${(value / 1_000_000_000).toFixed(5)}`
  return t('usage.costSourcesSummary', {
    supplier: amount(summary.supplierCostNanodollars), estimate: amount(summary.estimatedCostNanodollars),
    history: amount(summary.unclassifiedCostNanodollars),
  })
}

export function usageResultLabel(status: UsageRecord['status'], t: TFunction): string {
  return t(`usage.status${status === 'success' ? 'Success' : status === 'failed' ? 'Failed' : status === 'cancelled' ? 'Cancelled' : status === 'limited' ? 'Limited' : 'Partial'}`)
}

export function usagePresentationStatus(status: UsageRecord['status']): RedactedUsageRequestDetail['status'] {
  return status === 'success' ? 'succeeded' : status === 'failed' || status === 'limited' ? 'failed'
    : status === 'cancelled' ? 'cancelled' : 'other'
}

export function mapUsageExecutionRequest(
  request: UsageRequestSummary,
  t: TFunction,
  locale: string,
  providerName: (id: string) => string,
): RedactedUsageRequestDetail {
  return {
    requestId: request.reference.id,
    title: t(request.reference.kind === 'attempt' ? 'usage.historicalAttempt' : 'usage.requestDetail'),
    subtitle: new Date(request.occurredAt).toLocaleString(locale),
    status: usagePresentationStatus(request.status),
    statusLabel: usageResultLabel(request.status, t),
    fields: [
      { id: 'model', label: t('usage.requestTarget'), value: safe(request.requestedModel) },
      { id: 'provider', label: t('usage.executionConnection'), value: safe(request.providerName) },
      { id: 'original-provider', label: t('usage.originalProvider'), value: safe(providerName(request.originalProviderId)) },
      { id: 'original-model', label: t('usage.originalModel'), value: safe(request.originalModel) },
      { id: 'reported-model', label: t('usage.reportedModel'), value: request.reportedExecution ? safe(request.reportedExecution.model) : t('usage.executionNotReported') },
      { id: 'reported-source', label: t('usage.reportedSource'), value: request.reportedExecution?.source ?? t('usage.executionNotReported') },
      { id: 'upstream', label: t('usage.reportedUpstream'), value: t('usage.executionNotReported') },
      { id: 'source', label: t('usage.requestSource'), value: t(`usage.source.${request.operationSource === 'tavern' ? 'workspace' : request.operationSource}`) },
      { id: 'total', label: t('usage.knownTokens'), value: usageCount(request.summary.totalTokens, locale) },
      { id: 'input', label: t('usage.inputTokens'), value: usageCount(request.summary.inputTokens, locale) },
      { id: 'output', label: t('usage.outputTokens'), value: usageCount(request.summary.outputTokens, locale) },
      { id: 'cache', label: t('usage.cacheTokens'), value: usageCount(request.summary.cachedInputTokens, locale) },
      { id: 'reasoning', label: t('usage.reasoningTokens'), value: usageCount(request.summary.reasoningTokens, locale) },
      { id: 'latency', label: t(request.reference.kind === 'attempt' ? 'usage.attemptDuration' : 'usage.requestDuration'), value: usageDuration(request.durationMs ?? (request.reference.kind === 'attempt' ? request.summary.averageDurationMs : undefined)) },
      { id: 'first-token', label: t('usage.requestToFirstText'), value: usageDuration(request.firstVisibleTextMs) },
      { id: 'queue', label: t('usage.providerQueue'), value: t('usage.executionNotReported') },
      { id: 'cost', label: t('usage.knownCost'), value: usageKnownCost(request.summary, t) },
      { id: 'attempts', label: t('usage.attempts'), value: usageCount(request.attemptCount, locale) },
      { id: 'retries', label: t('usage.retries'), value: usageCount(request.retryCount, locale) },
      { id: 'failovers', label: t('usage.failovers'), value: usageCount(request.failoverCount, locale), ...(request.failoverCount ? { tone: 'warning' as const } : {}) },
    ],
  }
}

export function usageAttemptFields(record: UsageRecord, t: TFunction, locale: string): RedactedUsageRequestDetail['fields'] {
  return [
    ...(record.execution?.routingPlan ? [{ id: 'routing-plan', label: t('routing.title'), value: safe(record.execution.routingPlan.name) }] : []),
    { id: 'model', label: t('usage.requestTarget'), value: safe(record.upstreamModel) },
    { id: 'provider', label: t('usage.executionConnection'), value: safe(record.providerName) },
    { id: 'start', label: t('usage.startedAt'), value: new Date(record.occurredAt).toLocaleString(locale) },
    { id: 'end', label: t('usage.completedAt'), value: new Date(record.completedAt).toLocaleString(locale) },
    { id: 'latency', label: t('usage.attemptDuration'), value: usageDuration(record.durationMs) },
    { id: 'first-token', label: t('usage.attemptFirstText'), value: usageDuration(record.firstTokenMs) },
    { id: 'measurement', label: t('usage.measurementSource'), value: t(`usage.measurement.${record.measurementSource}`) },
    { id: 'total', label: t('usage.knownTokens'), value: usageCount(knownUsageTotal(record.tokens), locale) },
    { id: 'cost', label: t('usage.knownCost'), value: record.totalCostNanodollars === undefined ? t('usage.costNotReported')
      : `$${(record.totalCostNanodollars / 1_000_000_000).toFixed(5)}` },
    { id: 'pricing', label: t('usage.costSource'), value: t(`usage.costSourceLabel.${record.costProvenance}`) },
    ...(record.pricing ? [{ id: 'price-version', label: t('usage.priceVersion'), value: safe(record.pricing.version) }] : []),
    { id: 'reported-model', label: t('usage.reportedModel'), value: record.reportedExecution ? safe(record.reportedExecution.model) : t('usage.executionNotReported') },
    ...(record.statusCode === undefined ? [] : [{ id: 'http', label: 'HTTP', value: String(record.statusCode) }]),
    ...(record.errorCode ? [{ id: 'error', label: t('usage.errorCode'), value: safe(record.errorCode), tone: 'danger' as const }] : []),
  ]
}

export function redactedUsageExecutionSummary(detail: UsageExecutionDetail, t: TFunction, locale: string): string {
  return [
    t(detail.reference.kind === 'response' ? 'usage.responseDetail' : 'usage.requestDetail'),
    `${t('usage.logicalRequests')}: ${detail.summary.logicalRequestCount} · ${t('usage.attempts')}: ${detail.summary.requestCount}`,
    `${t('usage.knownTokens')}: ${usageCount(detail.summary.totalTokens, locale)}`,
    `${t('usage.knownCost')}: ${usageKnownCost(detail.summary, t)}`,
    ...detail.requests.map(request => `${safe(request.originalModel)} → ${safe(request.providerName)} / ${safe(request.requestedModel)} · ${usageResultLabel(request.status, t)}`),
    ...(detail.truncated ? [t('usage.detailTruncated')] : []),
  ].join('\n')
}

function safe(value: string): string {
  return redactSensitiveText(value).slice(0, 512)
}
