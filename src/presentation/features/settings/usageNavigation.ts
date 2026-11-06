import type { UsageDetailReference, UsageOperationSource, UsageRecordFilter, UsageRecordStatus } from '@/modules/diagnostics'
import type { UsageStatisticsFilters, UsageStatisticsTab } from '@/components/settings/UsageStatisticsContent'

export type UsageRouteParams = Record<string, string | string[] | undefined>
export type ProviderDetailTab = 'connection' | 'models' | 'usage' | 'advanced'

export const USAGE_STATUSES: UsageRecordStatus[] = ['success', 'failed', 'cancelled', 'limited', 'partial']
export const USAGE_SOURCES: UsageOperationSource[] = ['chat', 'agent', 'tavern', 'tool-continuation', 'memory', 'context', 'knowledge', 'embedding', 'transcription', 'speech', 'media', 'other']
export const DEFAULT_USAGE_FILTERS: UsageStatisticsFilters = {
  dateRange: '30d', provider: 'all', model: 'all', status: 'all', requestSource: 'all', includeEstimates: false,
}

export function routeValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.length === 1 ? value[0] : undefined : value
}

export function usageRouteIdentity(value: string | string[] | undefined): string | undefined {
  const id = routeValue(value)
  return id && id.length <= 256 && id.trim() === id && !/[\u0000-\u001f\u007f]/u.test(id) ? id : undefined
}

export function providerDetailTab(value: string | string[] | undefined): ProviderDetailTab | undefined {
  const tab = routeValue(value)
  return tab === 'connection' || tab === 'models' || tab === 'usage' || tab === 'advanced' ? tab : undefined
}

export function parseUsageDetailReference(params: UsageRouteParams): UsageDetailReference | undefined {
  const id = usageRouteIdentity(params.id)
  const kind = routeValue(params.kind) ?? 'request'
  return id && (kind === 'request' || kind === 'response' || kind === 'attempt') ? { kind, id } : undefined
}

export function parseUsageRoute(params: UsageRouteParams): { filters: UsageStatisticsFilters; view: UsageStatisticsTab; offset: number } {
  const dateRange = routeValue(params.range)
  const status = routeValue(params.status)
  const source = routeValue(params.source)
  const view = routeValue(params.view)
  const startAt = timestamp(params.startAt)
  const endAt = timestamp(params.endAt)
  const validWindow = startAt !== undefined && endAt !== undefined && startAt < endAt
  const offset = Number(routeValue(params.offset) ?? 0)
  return {
    filters: {
      ...DEFAULT_USAGE_FILTERS,
      dateRange: dateRange && ['24h', '7d', '30d', '90d', 'all'].includes(dateRange) ? dateRange : '30d',
      provider: usageRouteIdentity(params.providerId) ?? 'all',
      model: usageRouteIdentity(params.model) ?? 'all',
      status: status && USAGE_STATUSES.includes(status as UsageRecordStatus) ? status : 'all',
      requestSource: source && USAGE_SOURCES.includes(source as UsageOperationSource) ? source : 'all',
      includeEstimates: routeValue(params.estimates) === 'true',
      ...(usageRouteIdentity(params.conversationId) ? { conversation: usageRouteIdentity(params.conversationId) } : {}),
      ...(validWindow ? { startAt, endAt } : {}),
    },
    view: view === 'overview' || view === 'conversations' || view === 'requests' ? view : 'overview',
    offset: Number.isSafeInteger(offset) && offset >= 0 && offset <= 1_000_000 ? offset : 0,
  }
}

export function buildUsageRecordFilter(filters: UsageStatisticsFilters, now = Date.now()): UsageRecordFilter {
  const days = filters.dateRange === '24h' ? 1 : filters.dateRange === '7d' ? 7
    : filters.dateRange === '30d' ? 30 : filters.dateRange === '90d' ? 90 : undefined
  const startAt = filters.startAt ?? (days === undefined ? undefined : Math.max(0, now - days * 24 * 60 * 60 * 1000))
  const endAt = filters.endAt ?? now
  return {
    ...(startAt === undefined ? {} : { startAt }),
    endAt,
    ...(filters.provider === 'all' ? {} : { providerIds: [filters.provider] }),
    ...(filters.model === 'all' ? {} : { models: [filters.model] }),
    ...(filters.status === 'all' ? {} : { statuses: [filters.status as UsageRecordStatus] }),
    ...(filters.requestSource === 'all' ? {} : { operationSources: [filters.requestSource as UsageOperationSource] }),
    ...(filters.conversation ? { conversationIds: [filters.conversation] } : {}),
    includeEstimated: filters.includeEstimates,
  }
}

export function usageRouteSnapshot(filters: UsageStatisticsFilters, view: UsageStatisticsTab, offset: number, range: UsageRecordFilter) {
  return {
    range: filters.dateRange,
    view,
    providerId: filters.provider === 'all' ? undefined : filters.provider,
    model: filters.model === 'all' ? undefined : filters.model,
    conversationId: filters.conversation,
    status: filters.status === 'all' ? undefined : filters.status,
    source: filters.requestSource === 'all' ? undefined : filters.requestSource,
    estimates: filters.includeEstimates ? 'true' : undefined,
    startAt: range.startAt === undefined ? undefined : String(range.startAt),
    endAt: range.endAt === undefined ? undefined : String(range.endAt),
    offset: offset ? String(offset) : undefined,
  }
}

function timestamp(value: string | string[] | undefined): number | undefined {
  const text = routeValue(value)
  if (!text || !/^\d{1,16}$/u.test(text)) return undefined
  const number = Number(text)
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined
}
