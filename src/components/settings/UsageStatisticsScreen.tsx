import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform, ScrollView, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import {
  clearUsageStatistics,
  deleteUsagePricingEntry,
  exportUsageStatistics,
  listUsagePricingEntries,
  loadUsageStatistics,
  saveUsagePricingEntry,
} from '@/bootstrap/usageStatisticsRuntime'
import { describeUserFacingError } from '@/core'
import { useIsleDialog } from '@/components/ui/isle'
import type {
  UsageOperationSource,
  UsagePricingEntry,
  UsageRecord,
  UsageRecordFilter,
  UsageRecordStatus,
  UsageStatisticsSnapshot,
} from '@/modules/diagnostics'
import { resolveProviderDisplayName } from '@/presentation/features/settings/providerPresentation'
import { useSettingsStore } from '@/store/settingsStore'
import { getProviderSelectableModels } from '@/utils/providerModels'

import { resolveChatModelDisplayName } from '../chat/chatIdentityPresentation'
import {
  UsageStatisticsContent,
  type RedactedUsageRequestDetail,
  type UsageBreakdownRow,
  type UsageExportFormat,
  type UsageFilterOption,
  type UsagePricingModelOption,
  type UsagePricingOverride,
  type UsagePricingOverrideDraft,
  type UsageRequestDetailState,
  type UsageRequestRow,
  type UsageStatisticsCopy,
  type UsageStatisticsFilters,
  type UsageStatisticsTab,
  type UsageStatusSlice,
  type UsageTrendSeries,
} from './UsageStatisticsContent'

const DEFAULT_FILTERS: UsageStatisticsFilters = {
  dateRange: '30d',
  provider: 'all',
  model: 'all',
  status: 'all',
  requestSource: 'all',
  includeEstimates: false,
}

const STATUS_VALUES: UsageRecordStatus[] = ['success', 'failed', 'cancelled', 'limited', 'partial']
const SOURCE_VALUES: UsageOperationSource[] = ['chat', 'agent', 'tavern', 'tool-continuation', 'memory', 'context', 'knowledge', 'embedding', 'transcription', 'speech', 'media', 'other']
const NANO_DOLLARS_PER_DOLLAR = 1_000_000_000

export function UsageStatisticsScreen() {
  const { t, i18n } = useTranslation()
  const dialog = useIsleDialog()
  const insets = useSafeAreaInsets()
  const providers = useSettingsStore((state) => state.providers)
  const modelDisplayAliases = useSettingsStore((state) => state.settings.modelDisplayAliases)
  const [filters, setFilters] = useState<UsageStatisticsFilters>(DEFAULT_FILTERS)
  const [activeTab, setActiveTab] = useState<UsageStatisticsTab>('requests')
  const [snapshot, setSnapshot] = useState<UsageStatisticsSnapshot | null>(null)
  const [pricingEntries, setPricingEntries] = useState<readonly UsagePricingEntry[]>([])
  const [screenState, setScreenState] = useState<'ready' | 'loading' | 'error'>('loading')
  const [errorMessage, setErrorMessage] = useState<string>()
  const [refreshing, setRefreshing] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [exportingFormat, setExportingFormat] = useState<UsageExportFormat | null>(null)
  const [savingPricingOverrideId, setSavingPricingOverrideId] = useState<string | 'new' | null>(null)
  const [requestDetail, setRequestDetail] = useState<UsageRequestDetailState>(null)
  const loadSequence = useRef(0)
  const providerById = useMemo(() => new Map(providers.map((provider) => [provider.id, provider] as const)), [providers])
  const runtimeFilter = useMemo(() => buildUsageRecordFilter(filters), [filters])

  const refresh = useCallback(async (manual = false) => {
    const sequence = loadSequence.current + 1
    loadSequence.current = sequence
    if (manual || snapshot) setRefreshing(true)
    else setScreenState('loading')
    setErrorMessage(undefined)
    try {
      const [nextSnapshot, nextPricing] = await Promise.all([
        loadUsageStatistics({ filter: runtimeFilter, limit: 500 }),
        listUsagePricingEntries(),
      ])
      if (loadSequence.current !== sequence) return
      setSnapshot(nextSnapshot)
      setPricingEntries(nextPricing)
      setScreenState('ready')
    } catch (error) {
      if (loadSequence.current !== sequence) return
      setScreenState('error')
      setErrorMessage(describeUserFacingError(error, t, { headlineKey: 'usage.loadFailed' }))
    } finally {
      if (loadSequence.current === sequence) setRefreshing(false)
    }
  }, [runtimeFilter, snapshot, t])

  useEffect(() => {
    void refresh(false)
  }, [runtimeFilter])

  const filterOptions = useMemo(() => {
    const providerOptions: UsageFilterOption[] = [
      { value: 'all', label: t('usage.allProviders') },
      ...providers.map((provider) => ({ value: provider.id, label: resolveProviderDisplayName(provider, t('providerSettings.customProvider')) })),
    ]
    const modelOptionsById = new Map<string, string>()
    for (const provider of providers) {
      for (const model of getProviderSelectableModels(provider)) {
        modelOptionsById.set(model, resolveChatModelDisplayName(provider, model, modelDisplayAliases))
      }
    }
    for (const record of snapshot?.records.records ?? []) {
      const provider = providerById.get(record.providerId)
      if (!modelOptionsById.has(record.upstreamModel)) {
        modelOptionsById.set(record.upstreamModel, resolveChatModelDisplayName(provider, record.upstreamModel, modelDisplayAliases))
      }
    }
    return {
      dateRanges: [
        { value: '24h', label: t('usage.last24Hours') },
        { value: '7d', label: t('usage.last7Days') },
        { value: '30d', label: t('usage.last30Days') },
        { value: '90d', label: t('usage.last90Days') },
        { value: 'all', label: t('usage.allTime') },
      ],
      providers: providerOptions,
      models: [
        { value: 'all', label: t('usage.allModels') },
        ...[...modelOptionsById.entries()].sort((left, right) => left[1].localeCompare(right[1])).map(([value, label]) => ({ value, label })),
      ],
      statuses: [
        { value: 'all', label: t('usage.allStatuses') },
        ...STATUS_VALUES.map((value) => ({ value, label: usageStatusLabel(value, t) })),
      ],
      requestSources: [
        { value: 'all', label: t('usage.allSources') },
        ...SOURCE_VALUES.map((value) => ({ value, label: usageSourceLabel(value, t) })),
      ],
    }
  }, [modelDisplayAliases, providerById, providers, snapshot?.records.records, t])

  const requestRows = useMemo<UsageRequestRow[]>(() => (snapshot?.records.records ?? []).map((record) => ({
    id: record.id,
    timestampLabel: formatTimestamp(record.occurredAt, i18n.language),
    providerLabel: providerLabel(record, providerById, t),
    modelLabel: resolveChatModelDisplayName(providerById.get(record.providerId), record.upstreamModel, modelDisplayAliases),
    status: usagePresentationStatus(record.status),
    statusLabel: usageStatusLabel(record.status, t),
    sourceLabel: usageSourceLabel(record.operationSource, t),
    tokensLabel: usageRecordTokenLabel(record, t),
    inputTokensLabel: `${t('usage.inputTokens')}: ${formatCompactNumber(record.tokens.inputTokens ?? 0)}`,
    outputTokensLabel: `${t('usage.outputTokens')}: ${formatCompactNumber(record.tokens.outputTokens ?? 0)}`,
    cacheTokensLabel: `${t('usage.cacheTokens')}: ${formatCompactNumber(record.tokens.cachedInputTokens ?? ((record.tokens.cacheReadInputTokens ?? 0) + (record.tokens.cacheCreationInputTokens ?? 0)))}`,
    firstTokenLabel: record.firstTokenMs === undefined ? undefined : `${t('usage.firstToken')}: ${formatMilliseconds(record.firstTokenMs)}`,
    measurementLabel: measurementSourceLabel(record, t),
    latencyLabel: formatMilliseconds(record.durationMs),
    estimatedCostLabel: formatUsageCost(record.totalCostNanodollars),
  })), [i18n.language, modelDisplayAliases, providerById, snapshot?.records.records, t])

  const providerRows = useMemo(
    () => mapUsageBreakdown(snapshot?.providers ?? [], snapshot?.summary.totalTokens ?? 0),
    [snapshot?.providers, snapshot?.summary.totalTokens]
  )
  const modelRows = useMemo(
    () => mapUsageBreakdown(snapshot?.models ?? [], snapshot?.summary.totalTokens ?? 0),
    [snapshot?.models, snapshot?.summary.totalTokens]
  )
  const summary = useMemo(() => ({
    requests: formatInteger(snapshot?.summary.requestCount ?? 0),
    inputTokens: formatCompactNumber(snapshot?.summary.inputTokens ?? 0),
    outputTokens: formatCompactNumber(snapshot?.summary.outputTokens ?? 0),
    totalTokens: formatCompactNumber(snapshot?.summary.totalTokens ?? 0),
    cacheTokens: formatCompactNumber(snapshot?.summary.cachedInputTokens ?? ((snapshot?.summary.cacheReadInputTokens ?? 0) + (snapshot?.summary.cacheCreationInputTokens ?? 0))),
    reasoningTokens: formatCompactNumber(snapshot?.summary.reasoningTokens ?? 0),
    firstTokenLatency: formatMilliseconds(snapshot?.summary.averageFirstTokenMs),
    cacheHitRate: formatRatioPercent(snapshot?.summary.cacheHitRate),
    successfulRequests: formatInteger(snapshot?.summary.successCount ?? 0),
    failedRequests: formatInteger(snapshot?.summary.failedCount ?? 0),
    estimatedRequests: formatInteger(snapshot?.summary.estimatedCount ?? 0),
    estimatedCost: formatUsageCost(snapshot?.summary.totalCostNanodollars),
    averageLatency: formatMilliseconds(snapshot?.summary.averageDurationMs),
    errorRate: formatPercent(snapshot?.summary.failedCount ?? 0, snapshot?.summary.requestCount ?? 0),
  }), [snapshot?.summary])
  const statusDistribution = useMemo<UsageStatusSlice[]>(() => {
    if (!snapshot) return []
    const requestCount = Math.max(0, snapshot?.summary.requestCount ?? 0)
    const successCount = Math.max(0, snapshot?.summary.successCount ?? 0)
    const failedCount = Math.max(0, snapshot?.summary.failedCount ?? 0)
    const otherCount = Math.max(0, requestCount - successCount - failedCount)
    return [
      { id: 'success', label: t('usage.statusSuccess'), value: formatInteger(successCount), ratio: requestCount ? successCount / requestCount : 0, tone: 'success' },
      { id: 'failed', label: t('usage.statusFailed'), value: formatInteger(failedCount), ratio: requestCount ? failedCount / requestCount : 0, tone: 'danger' },
      { id: 'other', label: t('usage.statusOther'), value: formatInteger(otherCount), ratio: requestCount ? otherCount / requestCount : 0, tone: 'neutral' },
    ]
  }, [snapshot?.summary, t])
  const trends = useMemo<UsageTrendSeries[]>(() => buildUsageTrends(snapshot, t), [snapshot, t])
  const pricingOverrides = useMemo<UsagePricingOverride[]>(() => pricingEntries
    .filter((entry) => entry.source === 'manual' && entry.providerId)
    .map((entry) => ({
      id: entry.id,
      providerId: entry.providerId!,
      providerLabel: providerLabelFromId(entry.providerId!, providerById, t),
      modelId: entry.modelPattern,
      modelLabel: resolveChatModelDisplayName(providerById.get(entry.providerId!), entry.modelPattern, modelDisplayAliases),
      inputPricePerMillion: formatPricingRate(entry.rates.inputNanodollarsPerMillionTokens),
      outputPricePerMillion: formatPricingRate(entry.rates.outputNanodollarsPerMillionTokens),
      currencyLabel: 'USD',
    })), [modelDisplayAliases, pricingEntries, providerById, t])
  const pricingProviderOptions = useMemo<UsageFilterOption[]>(() => providers.map((provider) => ({
    value: provider.id,
    label: resolveProviderDisplayName(provider, t('providerSettings.customProvider')),
  })), [providers, t])
  const pricingModelOptions = useMemo<UsagePricingModelOption[]>(() => providers.flatMap((provider) => getProviderSelectableModels(provider).map((model) => ({
    providerId: provider.id,
    value: model,
    label: resolveChatModelDisplayName(provider, model, modelDisplayAliases),
  }))), [modelDisplayAliases, providers])
  const copy = useMemo<Partial<UsageStatisticsCopy>>(() => buildUsageCopy(t), [t])

  function openRequestDetail(requestId: string) {
    setRequestDetail({ status: 'loading', requestId })
    const record = snapshot?.records.records.find((item) => item.id === requestId)
    if (!record) {
      setRequestDetail({ status: 'error', requestId, message: t('usage.detailUnavailable') })
      return
    }
    setRequestDetail({ status: 'ready', detail: mapRequestDetail(record, providerById, modelDisplayAliases, i18n.language, t) })
  }

  async function savePricingOverride(draft: UsagePricingOverrideDraft) {
    const saveId = draft.id ?? 'new'
    setSavingPricingOverrideId(saveId)
    try {
      const inputRate = parsePricingRate(draft.inputPricePerMillion)
      const outputRate = parsePricingRate(draft.outputPricePerMillion)
      const provider = providerById.get(draft.providerId)
      const entry: UsagePricingEntry = {
        id: draft.id ?? `manual:${draft.providerId}:${draft.modelId}:${Date.now()}`,
        providerId: draft.providerId,
        modelPattern: draft.modelId,
        displayName: resolveChatModelDisplayName(provider, draft.modelId, modelDisplayAliases),
        version: `manual-${Date.now()}`,
        effectiveFrom: Date.now(),
        source: 'manual',
        rates: {
          inputNanodollarsPerMillionTokens: inputRate,
          outputNanodollarsPerMillionTokens: outputRate,
          reasoningBilling: 'included-in-output',
        },
      }
      await saveUsagePricingEntry(entry)
      await refresh(true)
    } finally {
      setSavingPricingOverrideId(null)
    }
  }

  async function deletePricingOverride(overrideId: string) {
    await deleteUsagePricingEntry(overrideId)
    await refresh(true)
  }

  async function exportUsage(format: UsageExportFormat) {
    setExportingFormat(format)
    try {
      const payload = await exportUsageStatistics(runtimeFilter, format)
      const directory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory
      if (Platform.OS === 'web' || !directory) {
        await Clipboard.setStringAsync(payload)
        dialog.toast({ title: t('usage.exportCopied'), tone: 'mint' })
        return
      }
      const uri = `${directory}islemind-usage-${Date.now()}.${format}`
      await FileSystem.writeAsStringAsync(uri, payload, { encoding: FileSystem.EncodingType.UTF8 })
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: format === 'json' ? 'application/json' : 'text/csv',
          dialogTitle: t('usage.exportTitle'),
        })
      } else {
        await Clipboard.setStringAsync(payload)
        dialog.toast({ title: t('usage.exportCopied'), tone: 'mint' })
      }
    } finally {
      setExportingFormat(null)
    }
  }

  async function clearStatistics() {
    setClearing(true)
    try {
      await clearUsageStatistics()
      setRequestDetail(null)
      await refresh(true)
    } finally {
      setClearing(false)
    }
  }

  return (
    <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 12, paddingTop: 12, paddingBottom: Math.max(insets.bottom, 18) + 28 }}>
      <View style={{ width: '100%', maxWidth: 1180 }}>
        <UsageStatisticsContent
          summary={summary}
          statusDistribution={statusDistribution}
          trends={trends}
          filters={filters}
          filterOptions={filterOptions}
          onFiltersChange={setFilters}
          onResetFilters={() => setFilters(DEFAULT_FILTERS)}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          requests={requestRows}
          providers={providerRows}
          models={modelRows}
          requestDetail={requestDetail}
          onRequestPress={openRequestDetail}
          onCloseRequestDetail={() => setRequestDetail(null)}
          pricingOverrides={pricingOverrides}
          pricingProviderOptions={pricingProviderOptions}
          pricingModelOptions={pricingModelOptions}
          onSavePricingOverride={savePricingOverride}
          onDeletePricingOverride={(id) => void deletePricingOverride(id)}
          savingPricingOverrideId={savingPricingOverrideId}
          onExport={(format) => void exportUsage(format)}
          exportingFormat={exportingFormat}
          onClear={() => void clearStatistics()}
          clearing={clearing}
          onRefresh={() => void refresh(true)}
          refreshing={refreshing}
          state={screenState}
          errorMessage={errorMessage}
          onRetry={() => void refresh(true)}
          copy={copy}
        />
      </View>
    </ScrollView>
  )
}

function buildUsageRecordFilter(filters: UsageStatisticsFilters, now = Date.now()): UsageRecordFilter {
  const startAt = filters.dateRange === '24h'
    ? now - 24 * 60 * 60 * 1000
    : filters.dateRange === '7d'
      ? now - 7 * 24 * 60 * 60 * 1000
      : filters.dateRange === '30d'
        ? now - 30 * 24 * 60 * 60 * 1000
        : filters.dateRange === '90d'
          ? now - 90 * 24 * 60 * 60 * 1000
          : undefined
  return {
    ...(startAt ? { startAt } : {}),
    ...(filters.provider === 'all' ? {} : { providerIds: [filters.provider] }),
    ...(filters.model === 'all' ? {} : { models: [filters.model] }),
    ...(filters.status === 'all' ? {} : { statuses: [filters.status as UsageRecordStatus] }),
    ...(filters.requestSource === 'all' ? {} : { operationSources: [filters.requestSource as UsageOperationSource] }),
    includeEstimated: filters.includeEstimates,
  }
}

function mapUsageBreakdown(groups: UsageStatisticsSnapshot['providers'], totalTokens: number): UsageBreakdownRow[] {
  return groups.map((group) => ({
    id: group.key,
    label: group.label,
    requestCountLabel: formatInteger(group.requestCount),
    tokensLabel: formatCompactNumber(group.totalTokens ?? 0),
    successRateLabel: `${Math.round((group.successCount / Math.max(1, group.requestCount)) * 100)}%`,
    averageLatencyLabel: group.averageDurationMs === undefined ? undefined : formatMilliseconds(group.averageDurationMs),
    cacheHitRateLabel: formatRatioPercent(group.cacheHitRate),
    estimatedCostLabel: formatUsageCost(group.totalCostNanodollars),
    share: totalTokens > 0 ? Math.min(1, (group.totalTokens ?? 0) / totalTokens) : 0,
  }))
}

function buildUsageTrends(snapshot: UsageStatisticsSnapshot | null, t: ReturnType<typeof useTranslation>['t']): UsageTrendSeries[] {
  if (!snapshot?.trends.length) return []
  const points = snapshot.trends.slice(-14)
  return [
    {
      id: 'requests',
      label: t('usage.requests'),
      value: formatInteger(snapshot.summary.requestCount),
      points: points.map((point) => point.requestCount),
    },
    {
      id: 'tokens',
      label: t('usage.totalTokens'),
      value: formatCompactNumber(snapshot.summary.totalTokens ?? 0),
      points: points.map((point) => point.totalTokens ?? 0),
    },
    {
      id: 'cache',
      label: t('usage.cacheTokens'),
      value: formatCompactNumber(snapshot.summary.cachedInputTokens ?? ((snapshot.summary.cacheReadInputTokens ?? 0) + (snapshot.summary.cacheCreationInputTokens ?? 0))),
      points: points.map((point) => point.cachedInputTokens ?? ((point.cacheReadInputTokens ?? 0) + (point.cacheCreationInputTokens ?? 0))),
    },
    {
      id: 'reasoning',
      label: t('usage.reasoningTokens'),
      value: formatCompactNumber(snapshot.summary.reasoningTokens ?? 0),
      points: points.map((point) => point.reasoningTokens ?? 0),
    },
  ]
}

function mapRequestDetail(
  record: UsageRecord,
  providerById: Map<string, ReturnType<typeof useSettingsStore.getState>['providers'][number]>,
  aliases: ReturnType<typeof useSettingsStore.getState>['settings']['modelDisplayAliases'],
  language: string,
  t: ReturnType<typeof useTranslation>['t'],
): RedactedUsageRequestDetail {
  const tokens = record.tokens
  const fields: RedactedUsageRequestDetail['fields'] = [
    { id: 'provider', label: t('usage.provider'), value: providerLabel(record, providerById, t) },
    { id: 'model', label: t('usage.model'), value: resolveChatModelDisplayName(providerById.get(record.providerId), record.upstreamModel, aliases) },
    { id: 'source', label: t('usage.requestSource'), value: usageSourceLabel(record.operationSource, t) },
    { id: 'measurement', label: t('usage.measurementSource'), value: measurementSourceLabel(record, t) },
    { id: 'input', label: t('usage.inputTokens'), value: formatInteger(tokens.inputTokens ?? 0) },
    { id: 'output', label: t('usage.outputTokens'), value: formatInteger(tokens.outputTokens ?? 0) },
    { id: 'total', label: t('usage.totalTokens'), value: formatInteger(usageRecordTotalTokens(record)) },
    { id: 'cache', label: t('usage.cacheTokens'), value: formatInteger(tokens.cachedInputTokens ?? ((tokens.cacheReadInputTokens ?? 0) + (tokens.cacheCreationInputTokens ?? 0))) },
    { id: 'reasoning', label: t('usage.reasoningTokens'), value: formatInteger(tokens.reasoningTokens ?? 0) },
    { id: 'latency', label: t('usage.latency'), value: formatMilliseconds(record.durationMs) },
    ...(record.firstTokenMs === undefined ? [] : [{ id: 'first-token', label: t('usage.firstToken'), value: formatMilliseconds(record.firstTokenMs) }]),
    ...(record.totalCostNanodollars === undefined ? [] : [{ id: 'cost', label: t('usage.estimatedCost'), value: formatUsageCost(record.totalCostNanodollars) ?? '-' }]),
    ...(record.errorCode ? [{ id: 'error', label: t('usage.errorCode'), value: record.errorCode, tone: 'danger' as const }] : []),
  ]
  return {
    requestId: record.id,
    title: t('usage.requestDetail'),
    subtitle: formatTimestamp(record.occurredAt, language),
    status: usagePresentationStatus(record.status),
    statusLabel: usageStatusLabel(record.status, t),
    fields,
  }
}

function buildUsageCopy(t: ReturnType<typeof useTranslation>['t']): Partial<UsageStatisticsCopy> {
  return {
    summary: t('usage.summary'),
    requests: t('usage.requests'),
    inputTokens: t('usage.inputTokens'),
    outputTokens: t('usage.outputTokens'),
    estimatedCost: t('usage.estimatedCost'),
    averageLatency: t('usage.averageLatency'),
    errorRate: t('usage.errorRate'),
    totalTokens: t('usage.totalTokens'),
    cacheTokens: t('usage.cacheTokens'),
    reasoningTokens: t('usage.reasoningTokens'),
    firstTokenLatency: t('usage.firstToken'),
    cacheHitRate: t('usage.cacheHitRate'),
    successfulRequests: t('usage.statusSuccess'),
    failedRequests: t('usage.statusFailed'),
    estimatedRequests: t('usage.estimatedRequests'),
    estimatesExcluded: t('usage.estimatesExcluded'),
    trends: t('usage.trends'),
    filters: t('usage.filters'),
    dateRange: t('usage.dateRange'),
    provider: t('usage.provider'),
    model: t('usage.model'),
    status: t('usage.status'),
    requestSource: t('usage.requestSource'),
    includeEstimates: t('usage.includeEstimates'),
    resetFilters: t('usage.resetFilters'),
    requestsTab: t('usage.requestLog'),
    providersTab: t('usage.providerStatistics'),
    modelsTab: t('usage.modelStatistics'),
    usageList: t('usage.title'),
    loading: t('usage.loading'),
    emptyTitle: t('usage.emptyTitle'),
    emptyDetail: t('usage.emptyDetail'),
    retry: t('common.retry'),
    refresh: t('common.refresh'),
    refreshing: t('usage.refreshing'),
    exportCsv: 'CSV',
    exportJson: 'JSON',
    exporting: t('usage.exporting'),
    clear: t('common.clear'),
    clearTitle: t('usage.clearTitle'),
    clearDetail: t('usage.clearDetail'),
    cancel: t('common.cancel'),
    confirmClear: t('usage.confirmClear'),
    clearing: t('usage.clearing'),
    close: t('dialog.close'),
    redacted: t('usage.redacted'),
    requestDetail: t('usage.requestDetail'),
    detailUnavailable: t('usage.detailUnavailable'),
    pricing: t('usage.pricing'),
    addOverride: t('usage.addOverride'),
    editOverride: t('usage.editOverride'),
    deleteOverride: t('usage.deleteOverride'),
    noOverrides: t('usage.noOverrides'),
    inputPrice: t('usage.inputPrice'),
    outputPrice: t('usage.outputPrice'),
    saveOverride: t('common.save'),
    saving: t('common.saving'),
    selectProvider: t('usage.selectProvider'),
    selectModel: t('usage.selectModel'),
    perMillionTokens: t('usage.perMillionTokens'),
    optionsFor: (label) => t('usage.optionsFor', { label }),
    rowAccessibility: (row) => [row.timestampLabel, row.providerLabel, row.modelLabel, row.statusLabel, row.tokensLabel, row.inputTokensLabel, row.outputTokensLabel, row.cacheTokensLabel, row.latencyLabel, row.firstTokenLabel].filter(Boolean).join('. '),
  }
}

function usagePresentationStatus(status: UsageRecordStatus): UsageRequestRow['status'] {
  if (status === 'success') return 'succeeded'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  return 'other'
}

function usageStatusLabel(status: UsageRecordStatus, t: ReturnType<typeof useTranslation>['t']): string {
  if (status === 'success') return t('usage.statusSuccess')
  if (status === 'failed') return t('usage.statusFailed')
  if (status === 'cancelled') return t('usage.statusCancelled')
  if (status === 'limited') return t('usage.statusLimited')
  return t('usage.statusPartial')
}

function usageSourceLabel(source: UsageOperationSource, t: ReturnType<typeof useTranslation>['t']): string {
  if (source === 'chat') return t('usage.sourceChat')
  if (source === 'agent') return t('usage.sourceAgent')
  if (source === 'tavern') return t('usage.sourceTavern')
  if (source === 'tool-continuation') return t('usage.sourceTool')
  if (source === 'memory') return t('settings.memory')
  if (source === 'context') return t('settings.context')
  if (source === 'knowledge') return t('settings.knowledge')
  if (source === 'embedding') return t('usage.sourceEmbedding')
  if (source === 'transcription') return t('usage.sourceTranscription')
  if (source === 'speech') return t('usage.sourceSpeech')
  if (source === 'media') return t('usage.sourceMedia')
  return t('usage.sourceOther')
}

function measurementSourceLabel(record: UsageRecord, t: ReturnType<typeof useTranslation>['t']): string {
  if (record.measurementSource === 'provider') return t('usage.providerReported')
  if (record.measurementSource === 'estimated') return t('usage.localEstimate')
  return t('usage.unavailable')
}

function providerLabel(record: UsageRecord, providerById: Map<string, ReturnType<typeof useSettingsStore.getState>['providers'][number]>, t: ReturnType<typeof useTranslation>['t']): string {
  return providerLabelFromId(record.providerId, providerById, t, record.providerName)
}

function providerLabelFromId(id: string, providerById: Map<string, ReturnType<typeof useSettingsStore.getState>['providers'][number]>, t: ReturnType<typeof useTranslation>['t'], fallback?: string): string {
  const provider = providerById.get(id)
  return provider ? resolveProviderDisplayName(provider, t('providerSettings.customProvider')) : fallback || id
}

function usageRecordTokenLabel(record: UsageRecord, t: ReturnType<typeof useTranslation>['t']): string {
  const total = usageRecordTotalTokens(record)
  const source = measurementSourceLabel(record, t)
  return `${formatCompactNumber(total)} · ${source}`
}

function usageRecordTotalTokens(record: UsageRecord): number {
  return record.tokens.totalTokens ?? (record.tokens.inputTokens ?? 0) + (record.tokens.outputTokens ?? 0) + (record.tokens.reasoningTokens ?? 0)
}

function parsePricingRate(value: string): number {
  const parsed = Number(value.trim())
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('Invalid pricing rate')
  const nanodollars = Math.round(parsed * NANO_DOLLARS_PER_DOLLAR)
  if (!Number.isSafeInteger(nanodollars)) throw new Error('Pricing rate is too large')
  return nanodollars
}

function formatPricingRate(value: number): string {
  return String(Math.round((value / NANO_DOLLARS_PER_DOLLAR) * 1_000_000) / 1_000_000)
}

function formatUsageCost(value: number | undefined): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  const dollars = value / NANO_DOLLARS_PER_DOLLAR
  return dollars > 0 && dollars < 0.01 ? `$${dollars.toFixed(4)}` : `$${dollars.toFixed(2)}`
}

function formatMilliseconds(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '-'
  if (value < 1000) return `${Math.round(value)} ms`
  if (value < 60_000) return `${Math.round(value / 100) / 10} s`
  return `${Math.floor(value / 60_000)}m ${Math.round((value % 60_000) / 1000)}s`
}

function formatInteger(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString()
}

function formatCompactNumber(value: number): string {
  const normalized = Math.max(0, value)
  if (normalized >= 1_000_000) return `${Math.round(normalized / 100_000) / 10}M`
  if (normalized >= 10_000) return `${Math.round(normalized / 1_000)}K`
  if (normalized >= 1_000) return `${Math.round(normalized / 100) / 10}K`
  return String(Math.round(normalized))
}

function formatPercent(part: number, total: number): string {
  if (total <= 0) return '0%'
  return `${Math.round((part / total) * 1000) / 10}%`
}

function formatRatioPercent(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '-'
  return `${Math.round(Math.min(1, value) * 1000) / 10}%`
}

function formatTimestamp(value: number, language: string): string {
  try {
    return new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  } catch {
    return new Date(value).toLocaleString()
  }
}
