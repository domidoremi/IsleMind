import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { UsageRequestDetail } from './UsageRequestDetail'
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { Modal } from '@/components/ui/AppModal'
import { Text, TextInput } from '@/components/ui/AppText'
import { FlashList } from '@shopify/flash-list'
import { MotiView } from 'moti'

import { AppIcon, type AppIconName } from '@/components/ui/AppIcon'
import { ISLE_MIN_TOUCH_TARGET, IsleButton, IsleChip, IslePressable, IsleToggle } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { IsleMotionFrame } from '@/components/ui/isle/ThemeMotion'
import { useThemeMotion } from '@/hooks/useThemeMotion'
import { WorkspaceTabs } from '@/presentation/layout/WorkspaceTabs'
import { useSettingsDraft } from './SettingsEditBoundary'
import { SettingsHelpButton } from './SettingsHelp'
import type { RedactedUsageRequestDetail, UsageRequestDetailState, UsageRequestStatus } from './usageRequestDetailTypes'

import { USAGE_PRICING_CONFLICT } from '@/modules/diagnostics'

export type { RedactedUsageDetailField, RedactedUsageRequestDetail, UsageRequestDetailState, UsageRequestStatus } from './usageRequestDetailTypes'
export type UsageStatisticsTab = 'overview' | 'conversations' | 'requests' | 'providers' | 'models'
export type UsageExportFormat = 'csv' | 'json'

export interface UsageFilterOption {
  value: string
  label: string
}

export interface UsageStatisticsFilters {
  dateRange: string
  provider: string
  model: string
  status: string
  requestSource: string
  includeEstimates: boolean
  conversation?: string
  startAt?: number
  endAt?: number
}

export interface UsageStatisticsFilterOptions {
  dateRanges: UsageFilterOption[]
  providers: UsageFilterOption[]
  models: UsageFilterOption[]
  statuses: UsageFilterOption[]
  requestSources: UsageFilterOption[]
}

export interface UsageStatisticsSummary {
  requests: string
  inputTokens: string
  outputTokens: string
  totalTokens?: string
  cacheTokens?: string
  reasoningTokens?: string
  firstTokenLatency?: string
  cacheHitRate?: string
  successfulRequests?: string
  failedRequests?: string
  estimatedRequests?: string
  retryCount?: string
  failoverCount?: string
  estimatedCost?: string
  averageLatency: string
  errorRate: string
  attempts?: string
  historicalAttempts?: string
  coverageLabel?: string
}

export interface UsageStatusSlice {
  id: string
  label: string
  value: string
  ratio: number
  tone: 'success' | 'danger' | 'neutral'
}

export interface UsageTrendSeries {
  id: string
  label: string
  value: string
  change?: string
  direction?: 'up' | 'down' | 'flat'
  points: (number | undefined)[]
  accessibilityLabel?: string
}

export interface UsageRequestRow {
  id: string
  timestampLabel: string
  providerLabel: string
  modelLabel: string
  status: UsageRequestStatus
  statusLabel: string
  sourceLabel: string
  tokensLabel: string
  inputTokensLabel?: string
  outputTokensLabel?: string
  cacheTokensLabel?: string
  firstTokenLabel?: string
  measurementLabel?: string
  latencyLabel: string
  estimatedCostLabel?: string
}

export interface UsageBreakdownRow {
  id: string
  label: string
  secondaryLabel?: string
  requestCountLabel: string
  tokensLabel: string
  estimatedCostLabel?: string
  successRateLabel?: string
  averageLatencyLabel?: string
  cacheHitRateLabel?: string
  share: number
  countLabel?: string
}

export interface UsagePricingOverride {
  id: string
  providerId: string
  providerLabel: string
  modelId: string
  modelLabel: string
  inputPricePerMillion: string
  outputPricePerMillion: string
  currencyLabel: string
  sourceRevision?: string
}

export interface UsagePricingModelOption extends UsageFilterOption {
  providerId: string
}

export interface UsagePricingOverrideDraft {
  id?: string
  providerId: string
  modelId: string
  inputPricePerMillion: string
  outputPricePerMillion: string
}

export interface UsageStatisticsCopy {
  summary: string
  requests: string
  inputTokens: string
  outputTokens: string
  estimatedCost: string
  averageLatency: string
  errorRate: string
  totalTokens: string
  cacheTokens: string
  reasoningTokens: string
  firstTokenLatency: string
  cacheHitRate: string
  successfulRequests: string
  failedRequests: string
  estimatedRequests: string
  retries: string
  failovers: string
  estimatesExcluded: string
  trends: string
  filters: string
  dateRange: string
  provider: string
  model: string
  status: string
  requestSource: string
  includeEstimates: string
  resetFilters: string
  requestsTab: string
  providersTab: string
  modelsTab: string
  usageList: string
  loading: string
  emptyTitle: string
  emptyDetail: string
  retry: string
  refresh: string
  refreshing: string
  exportCsv: string
  exportJson: string
  exporting: string
  clear: string
  clearTitle: string
  clearDetail: string
  cancel: string
  confirmClear: string
  clearing: string
  close: string
  redacted: string
  requestDetail: string
  detailUnavailable: string
  pricing: string
  addOverride: string
  editOverride: string
  deleteOverride: string
  noOverrides: string
  inputPrice: string
  outputPrice: string
  saveOverride: string
  saving: string
  selectProvider: string
  selectModel: string
  perMillionTokens: string
  optionsFor: (label: string) => string
  rowAccessibility: (row: UsageRequestRow) => string
}

export interface UsageStatisticsContentProps {
  summary: UsageStatisticsSummary
  statusDistribution?: UsageStatusSlice[]
  trends: UsageTrendSeries[]
  filters: UsageStatisticsFilters
  filterOptions: UsageStatisticsFilterOptions
  onFiltersChange: (filters: UsageStatisticsFilters) => void
  onResetFilters?: () => void
  activeTab: UsageStatisticsTab
  onTabChange: (tab: UsageStatisticsTab) => void
  requests: UsageRequestRow[]
  providers: UsageBreakdownRow[]
  models: UsageBreakdownRow[]
  conversations?: UsageBreakdownRow[]
  conversationLabel?: string
  onConversationPress?: (id: string) => void
  onConversationContext?: () => void
  onLoadMore?: () => void
  hasMore?: boolean
  pageLabel?: string
  onPreviousPage?: () => void
  requestDetail?: UsageRequestDetailState
  onRequestPress: (requestId: string) => void
  onCloseRequestDetail: () => void
  pricingOverrides: UsagePricingOverride[]
  pricingProviderOptions: UsageFilterOption[]
  pricingModelOptions: UsagePricingModelOption[]
  onSavePricingOverride: (draft: UsagePricingOverrideDraft, expectedRevision?: string) => void | Promise<void>
  onDeletePricingOverride: (overrideId: string) => void
  savingPricingOverrideId?: string | 'new' | null
  onExport: (format: UsageExportFormat) => void
  exportingFormat?: UsageExportFormat | null
  onClear: () => void
  clearing?: boolean
  onRefresh?: () => void
  refreshing?: boolean
  state?: 'ready' | 'loading' | 'error'
  errorMessage?: string
  onRetry?: () => void
  copy?: Partial<UsageStatisticsCopy>
}

export const DEFAULT_USAGE_STATISTICS_COPY: UsageStatisticsCopy = {
  summary: 'Summary',
  requests: 'Requests',
  inputTokens: 'Input tokens',
  outputTokens: 'Output tokens',
  estimatedCost: 'Estimated cost',
  averageLatency: 'Average latency',
  errorRate: 'Error rate',
  totalTokens: 'Total tokens',
  cacheTokens: 'Cached tokens',
  reasoningTokens: 'Reasoning tokens',
  firstTokenLatency: 'First token',
  cacheHitRate: 'Cache hit rate',
  successfulRequests: 'Successful',
  failedRequests: 'Failed',
  estimatedRequests: 'Estimated',
  retries: 'Retries',
  failovers: 'Failovers',
  estimatesExcluded: 'Excluded',
  trends: 'Trends',
  filters: 'Filters',
  dateRange: 'Date',
  provider: 'Provider',
  model: 'Model',
  status: 'Status',
  requestSource: 'Source',
  includeEstimates: 'Include estimates',
  resetFilters: 'Reset',
  requestsTab: 'Requests',
  providersTab: 'Providers',
  modelsTab: 'Models',
  usageList: 'Usage statistics',
  loading: 'Loading usage',
  emptyTitle: 'No usage found',
  emptyDetail: 'No records match the current filters.',
  retry: 'Retry',
  refresh: 'Refresh',
  refreshing: 'Refreshing',
  exportCsv: 'CSV',
  exportJson: 'JSON',
  exporting: 'Exporting',
  clear: 'Clear',
  clearTitle: 'Clear usage statistics?',
  clearDetail: 'This removes the stored usage history.',
  cancel: 'Cancel',
  confirmClear: 'Clear usage',
  clearing: 'Clearing',
  close: 'Close',
  redacted: 'Redacted',
  requestDetail: 'Request detail',
  detailUnavailable: 'Request detail is unavailable.',
  pricing: 'Pricing overrides',
  addOverride: 'Add override',
  editOverride: 'Edit override',
  deleteOverride: 'Delete override',
  noOverrides: 'No pricing overrides',
  inputPrice: 'Input price',
  outputPrice: 'Output price',
  saveOverride: 'Save override',
  saving: 'Saving',
  selectProvider: 'Select provider',
  selectModel: 'Select model',
  perMillionTokens: 'per 1M tokens',
  optionsFor: (label) => `${label} options`,
  rowAccessibility: (row) => [row.timestampLabel, row.providerLabel, row.modelLabel, row.statusLabel, row.tokensLabel, row.latencyLabel, row.estimatedCostLabel].filter(Boolean).join('. '),
}

type FilterKey = 'dateRange' | 'provider' | 'model' | 'status' | 'requestSource'

interface PricingDraftState extends UsagePricingOverrideDraft {
  key: string
  original: UsagePricingOverrideDraft
  sourceRevision?: string
}

function pricingFormValue(value: UsagePricingOverrideDraft): UsagePricingOverrideDraft {
  return { id: value.id, providerId: value.providerId, modelId: value.modelId, inputPricePerMillion: value.inputPricePerMillion, outputPricePerMillion: value.outputPricePerMillion }
}

export function UsageStatisticsContent({
  summary,
  statusDistribution = [],
  trends,
  filters,
  filterOptions,
  onFiltersChange,
  onResetFilters,
  activeTab,
  onTabChange,
  requests,
  providers,
  models,
  conversations = [],
  conversationLabel,
  onConversationPress,
  onConversationContext,
  onLoadMore,
  hasMore = false,
  pageLabel,
  onPreviousPage,
  requestDetail = null,
  onRequestPress,
  onCloseRequestDetail,
  pricingOverrides,
  pricingProviderOptions,
  pricingModelOptions,
  onSavePricingOverride,
  onDeletePricingOverride,
  savingPricingOverrideId = null,
  onExport,
  exportingFormat = null,
  onClear,
  clearing = false,
  onRefresh,
  refreshing = false,
  state = 'ready',
  errorMessage,
  onRetry,
  copy: copyOverrides,
}: UsageStatisticsContentProps) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference(true)
  const { t } = useTranslation()
  const { width, height, fontScale } = useWindowDimensions()
  const [contentWidth, setContentWidth] = useState(0)
  const readingWidth = Math.min(width, contentWidth || width) / fontScale
  const compact = readingWidth < 430
  const narrow = readingWidth < 360
  const stackedRows = readingWidth < 640
  const copy = useMemo(() => ({ ...DEFAULT_USAGE_STATISTICS_COPY, ...copyOverrides }), [copyOverrides])
  const [filterSheet, setFilterSheet] = useState<FilterKey | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [overviewGroup, setOverviewGroup] = useState<'providers' | 'models'>('providers')
  const providerBreakdown = activeTab === 'providers' || (activeTab === 'overview' && overviewGroup === 'providers')
  const [clearConfirmationOpen, setClearConfirmationOpen] = useState(false)
  const [pricingDraft, setPricingDraft] = useState<PricingDraftState | null>(null)
  const [pricingSubmitting, setPricingSubmitting] = useState(false)
  const [pricingError, setPricingError] = useState<'conflict' | 'saveFailed'>()
  const pricingSaveLock = useRef(false)
  const pricingSaving = pricingSubmitting || (!!pricingDraft && (savingPricingOverrideId === pricingDraft.id || (!pricingDraft.id && savingPricingOverrideId === 'new')))
  function discardPricingDraft() { if (!pricingSaveLock.current) { setPricingDraft(null); setPricingError(undefined) } }
  const requestClosePricing = useSettingsDraft(Boolean(pricingDraft && JSON.stringify(pricingFormValue(pricingDraft)) !== JSON.stringify(pricingDraft.original)), pricingSaving, discardPricingDraft, JSON.stringify(pricingDraft && [pricingDraft.id, pricingFormValue(pricingDraft)]))
  const subtleBorderWidth = colors.ui.monet ? 1 : StyleSheet.hairlineWidth
  const borderColor = colors.ui.liquidGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  const mutedSurface = colors.ui.liquidGlass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted
  const listHeight = Math.max(340, Math.min(compact ? 470 : 540, height * (compact ? 0.56 : 0.62)))

  const filterDefinitions: Array<{ key: FilterKey; label: string; options: UsageFilterOption[]; icon: AppIconName }> = [
    { key: 'dateRange', label: copy.dateRange, options: filterOptions.dateRanges, icon: 'history' },
    { key: 'provider', label: copy.provider, options: filterOptions.providers, icon: 'provider-key' },
    { key: 'model', label: copy.model, options: filterOptions.models, icon: 'model' },
    { key: 'status', label: copy.status, options: filterOptions.statuses, icon: 'health' },
    { key: 'requestSource', label: copy.requestSource, options: filterOptions.requestSources, icon: 'source' },
  ]
  const activeFilterDefinition = filterDefinitions.find((definition) => definition.key === filterSheet)

  const summaryItems = [
    { id: 'requests', label: copy.requests, value: summary.requests, icon: 'list-check' as AppIconName },
    { id: 'input', label: copy.inputTokens, value: summary.inputTokens, icon: 'arrow-down' as AppIconName },
    { id: 'output', label: copy.outputTokens, value: summary.outputTokens, icon: 'arrow-up' as AppIconName },
    { id: 'total', label: copy.totalTokens, value: summary.totalTokens ?? '-', icon: 'sigma' as AppIconName },
    { id: 'cache', label: copy.cacheTokens, value: summary.cacheTokens ?? '-', icon: 'knowledge-database' as AppIconName },
    { id: 'reasoning', label: copy.reasoningTokens, value: summary.reasoningTokens ?? '-', icon: 'reasoning' as AppIconName },
    { id: 'cost', label: copy.estimatedCost, value: summary.estimatedCost ?? '—', icon: 'sigma' as AppIconName },
    { id: 'latency', label: copy.averageLatency, value: summary.averageLatency, icon: 'activity' as AppIconName },
    { id: 'first-token', label: copy.firstTokenLatency, value: summary.firstTokenLatency ?? '-', icon: 'zap' as AppIconName },
    { id: 'cache-rate', label: copy.cacheHitRate, value: summary.cacheHitRate ?? '-', icon: 'knowledge-database' as AppIconName },
    { id: 'retries', label: copy.retries, value: summary.retryCount ?? '0', icon: 'refresh' as AppIconName },
    { id: 'failovers', label: copy.failovers, value: summary.failoverCount ?? '0', icon: 'arrow-right' as AppIconName },
    { id: 'errors', label: copy.errorRate, value: summary.errorRate, icon: 'warning' as AppIconName },
  ]

  const pricingModels = pricingDraft
    ? pricingModelOptions.filter((option) => option.providerId === pricingDraft.providerId)
    : []
  const canSavePricing = !!pricingDraft?.providerId && !!pricingDraft.modelId && !!pricingDraft.inputPricePerMillion.trim() && !!pricingDraft.outputPricePerMillion.trim()
  function openNewPricingOverride() {
    if (pricingSaveLock.current) return
    const providerId = pricingProviderOptions[0]?.value ?? ''
    const modelId = pricingModelOptions.find((option) => option.providerId === providerId)?.value ?? ''
    const original = pricingFormValue({ providerId, modelId, inputPricePerMillion: '', outputPricePerMillion: '' })
    void requestClosePricing(() => { setPricingDraft({ key: `new:${providerId}:${modelId}`, ...original, original }); setPricingError(undefined) })
  }

  function openExistingPricingOverride(item: UsagePricingOverride) {
    if (pricingSaveLock.current) return
    void requestClosePricing(() => loadPricingOverride(item))
  }

  function loadPricingOverride(item: UsagePricingOverride) {
    setPricingDraft({
      key: item.id,
      id: item.id,
      providerId: item.providerId,
      modelId: item.modelId,
      inputPricePerMillion: item.inputPricePerMillion,
      outputPricePerMillion: item.outputPricePerMillion,
      original: pricingFormValue(item),
      sourceRevision: item.sourceRevision,
    })
    setPricingError(undefined)
  }

  function choosePricingProvider(providerId: string) {
    const currentModelMatches = pricingDraft && pricingModelOptions.some((option) => option.providerId === providerId && option.value === pricingDraft.modelId)
    const modelId = currentModelMatches ? pricingDraft.modelId : (pricingModelOptions.find((option) => option.providerId === providerId)?.value ?? '')
    setPricingDraft((current) => current ? { ...current, providerId, modelId } : current)
  }

  async function savePricingOverride() {
    if (!pricingDraft || !canSavePricing || pricingSaving || pricingSaveLock.current) return
    if (pricingDraft.id && pricingOverrides.find(item => item.id === pricingDraft.id)?.sourceRevision !== pricingDraft.sourceRevision) {
      setPricingError('conflict'); return
    }
    pricingSaveLock.current = true
    setPricingSubmitting(true)
    setPricingError(undefined)
    try {
      await onSavePricingOverride(pricingFormValue(pricingDraft), pricingDraft.sourceRevision)
      setPricingDraft(null)
    } catch (error) {
      setPricingError(error instanceof Error && error.message === USAGE_PRICING_CONFLICT ? 'conflict' : 'saveFailed')
    } finally {
      pricingSaveLock.current = false
      setPricingSubmitting(false)
    }
  }

  const sectionHeader = (title: string, action?: ReactNode) => (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
      {action}
    </View>
  )

  return (
    <View testID="usage-content" style={styles.root} onLayout={event => setContentWidth(event.nativeEvent.layout.width)}>
      <View accessibilityRole="summary" style={[styles.section, { borderColor }]}>
        {sectionHeader(copy.summary, onRefresh ? (
          <IsleButton
            compact
            label={copy.refresh}
            accessibilityLabel={refreshing ? copy.refreshing : copy.refresh}
            busy={refreshing}
            feedbackPhase={refreshing ? 'pending' : 'idle'}
            icon={<AppIcon name="refresh" color={colors.textSecondary} size={14} />}
            disabled={refreshing}
            onPress={onRefresh}
          />
        ) : undefined)}
        <View testID="usage-primary-metric" style={styles.primaryMetric}>
          <View style={styles.primaryMetricHeading}>
            <View style={styles.summaryLabelRow}>
              <AppIcon name="list-check" color={colors.ui.icon.accentForeground} size={16} />
              <Text style={[styles.primaryMetricLabel, { color: colors.textSecondary }]}>{copy.requests}</Text>
            </View>
            <IsleButton compact label={filterOptions.dateRanges.find(option => option.value === filters.dateRange)?.label ?? filters.dateRange}
              accessibilityLabel={`${copy.dateRange}: ${filterOptions.dateRanges.find(option => option.value === filters.dateRange)?.label ?? filters.dateRange}`}
              onPress={() => setFilterSheet('dateRange')} />
          </View>
          <Text accessibilityLabel={`${copy.requests}: ${summary.requests}`} style={[colors.design?.semantic.typography.display, styles.primaryMetricValue, { color: colors.text }]}>{summary.requests}</Text>
          {summary.attempts ? <Text testID="usage-attempt-count" style={[styles.rowMeta, { color: colors.textSecondary }]}>{t('usage.executionCounts', {
            requests: summary.requests, attempts: summary.attempts, historical: summary.historicalAttempts ?? '0',
          })}</Text> : null}
        </View>
        <View testID="usage-summary-context" style={[styles.summaryContext, narrow && { flexDirection: 'column' }]}>
          {summaryItems.filter(item => item.id === 'total' || item.id === 'cost').map((item, index) => (
            <View key={item.id} accessible accessibilityLabel={`${item.label}. ${item.value}`}
              style={[styles.contextMetric, index === 1 && !narrow ? { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: borderColor, paddingLeft: 18 } : null]}>
              <Text style={[styles.contextMetricLabel, { color: colors.textSecondary }]}>{item.label}</Text>
              <Text style={[styles.contextMetricValue, { color: colors.text }]}>{item.value}</Text>
            </View>
          ))}
        </View>
        {summary.coverageLabel ? <Text testID="usage-measurement-coverage" style={[styles.rowMeta, { color: colors.textSecondary }]}>{summary.coverageLabel}</Text> : null}
        {detailsOpen ? <View style={[styles.summaryGrid, narrow && styles.summaryGridNarrow]}>
          {summaryItems.filter(item => !['requests', 'total', 'cost'].includes(item.id)).map((item) => (
            <View
              key={item.id}
              accessible
              accessibilityLabel={`${item.label}. ${item.value}`}
              style={[
                styles.summaryCell,
                { borderColor, backgroundColor: mutedSurface, borderWidth: subtleBorderWidth },
                narrow ? { flexBasis: '48%' } : compact ? { flexBasis: '31%' } : { flexBasis: '23%' },
              ]}
            >
              <View style={styles.summaryLabelRow}>
                <AppIcon name={item.icon} color={colors.textTertiary} size={13} />
                <Text style={[styles.summaryLabel, { color: colors.textTertiary }]}>{item.label}</Text>
              </View>
              <Text adjustsFontSizeToFit minimumFontScale={0.78} style={[styles.summaryValue, { color: colors.text }]}>{item.value}</Text>
            </View>
          ))}
        </View> : null}
        {statusDistribution.length ? (
          <View style={styles.statusSummary} accessible accessibilityLabel={statusDistribution.map((item) => `${item.label} ${item.value}`).join('. ')}>
            <View style={[styles.statusTrack, { backgroundColor: colors.ui.semantic.surface.muted }]}>
              {statusDistribution.map((item) => (
                <View key={item.id} style={[styles.statusSegment, { width: `${Math.max(0, Math.min(1, item.ratio)) * 100}%`, backgroundColor: statusToneForSlice(item.tone, colors) }]} />
              ))}
            </View>
            <View style={styles.statusLegend}>
              {statusDistribution.map((item) => (
                <View key={item.id} style={styles.statusLegendItem}>
                  <View style={[styles.statusLegendDot, { backgroundColor: statusToneForSlice(item.tone, colors) }]} />
                  <Text style={[styles.statusLegendText, { color: colors.textTertiary }]}>{item.label} {item.value}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
        <UsageDisclosure testID="usage-details-toggle" label={t(detailsOpen ? 'settingsUx.hideDetails' : 'settingsUx.moreDetails')} expanded={detailsOpen} onPress={() => setDetailsOpen(value => !value)} />
      </View>

      {detailsOpen && trends.length ? (
        <View style={[styles.section, { borderColor }]}>
          {sectionHeader(copy.trends)}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trendStrip}>
            {trends.map((trend) => (
              <TrendItem key={trend.id} trend={trend} compact={compact} />
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View style={[styles.section, { borderColor }]}>
        {conversationLabel ? <View style={{ gap: 8, marginBottom: 12 }}>
          <Text style={[styles.rowMeta, { color: colors.textSecondary }]}>{t('usage.conversationFilter', { name: conversationLabel })}</Text>
          {onConversationContext ? <IsleButton label={t('usage.contextSettings')} onPress={onConversationContext} /> : null}
          <IsleButton compact label={t('usage.clearConversationFilter')} onPress={() => onFiltersChange({ ...filters, conversation: undefined })} />
        </View> : null}
        <UsageDisclosure testID="usage-filters-toggle" label={copy.filters} expanded={filtersOpen} onPress={() => setFiltersOpen(value => !value)} />
        {filtersOpen ? <>
        {sectionHeader(copy.filters, onResetFilters ? (
          <IsleButton compact label={copy.resetFilters} onPress={onResetFilters} />
        ) : undefined)}
        <View style={{ gap: 8 }}>
          {filterDefinitions.map((definition) => {
            const selected = definition.options.find((option) => option.value === filters[definition.key])
            return (
              <FilterButton
                key={definition.key}
                label={definition.label}
                value={selected?.label ?? filters[definition.key]}
                icon={definition.icon}
                onPress={() => setFilterSheet(definition.key)}
              />
            )
          })}
        </View>
        <View style={{ marginTop: 8 }}>
          <IsleToggle
            title={copy.includeEstimates}
            active={filters.includeEstimates}
            icon={<AppIcon name="sigma" color={colors.textSecondary} size={16} />}
            onPress={() => onFiltersChange({ ...filters, includeEstimates: !filters.includeEstimates })}
          />
        </View>
        </> : null}
      </View>

      <View style={[styles.section, { borderColor }]}>
        <WorkspaceTabs testID="usage-view-tabs" value={activeTab} onChange={onTabChange} tabs={[
          { value: 'overview', label: t('usage.overviewTab'), icon: 'activity' },
          { value: 'conversations', label: t('usage.conversationsTab'), icon: 'conversation' },
          { value: 'requests', label: copy.requestsTab, icon: 'list-check' },
        ]} />
        {activeTab === 'overview' ? <WorkspaceTabs testID="usage-overview-tabs" accessibilityLabel={t('usage.overviewTab')}
          value={overviewGroup} onChange={setOverviewGroup} tabs={[
            { value: 'providers', label: copy.providersTab, icon: 'provider-key' },
            { value: 'models', label: copy.modelsTab, icon: 'model' },
          ]} /> : null}

        <View
          style={[styles.listViewport, { height: listHeight, borderColor, borderWidth: subtleBorderWidth }]}
          accessibilityLabel={copy.usageList}
        >
          {state === 'loading' ? (
            <UsageStateView icon="loader" label={copy.loading} loading />
          ) : state === 'error' ? (
            <UsageStateView icon="warning" label={errorMessage ?? copy.detailUnavailable} actionLabel={onRetry ? copy.retry : undefined} onAction={onRetry} danger />
          ) : activeTab === 'requests' ? (
            <FlashList
              data={requests}
              keyExtractor={(item) => item.id}
              accessibilityRole="list"
              accessibilityLabel={copy.requestsTab}
              nestedScrollEnabled
              drawDistance={listHeight}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={<UsageEmptyState title={copy.emptyTitle} detail={copy.emptyDetail} />}
              ItemSeparatorComponent={RowSeparator}
              renderItem={({ item }) => (
                <RequestRow
                  item={item}
                  compact={stackedRows}
                  includeEstimates={filters.includeEstimates}
                  accessibilityLabel={copy.rowAccessibility(item)}
                  onPress={() => onRequestPress(item.id)}
                />
              )}
            />
          ) : activeTab === 'conversations' ? <FlashList
              data={conversations} keyExtractor={item => item.id} accessibilityRole="list"
              accessibilityLabel={t('usage.conversationsTab')} nestedScrollEnabled drawDistance={listHeight}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={<UsageEmptyState title={copy.emptyTitle} detail={copy.emptyDetail} />}
              ItemSeparatorComponent={RowSeparator}
              renderItem={({ item }) => <IslePressable accessibilityRole="button" accessibilityLabel={item.label}
                testID={`usage-conversation-${item.id}`} onPress={() => onConversationPress?.(item.id)} style={{ minHeight: 44 }}>
                <BreakdownRow item={item} compact={stackedRows} copy={copy} includeEstimates={filters.includeEstimates} />
              </IslePressable>}
            /> : (
            <FlashList
              data={providerBreakdown ? providers : models}
              keyExtractor={(item) => item.id}
              accessibilityRole="list"
              accessibilityLabel={providerBreakdown ? copy.providersTab : copy.modelsTab}
              nestedScrollEnabled
              drawDistance={listHeight}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={<UsageEmptyState title={copy.emptyTitle} detail={copy.emptyDetail} />}
              ItemSeparatorComponent={RowSeparator}
              renderItem={({ item }) => <BreakdownRow item={item} compact={stackedRows} copy={copy} includeEstimates={filters.includeEstimates} />}
            />
          )}
        </View>
        {activeTab === 'requests' && (hasMore || onPreviousPage || pageLabel) ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingTop: 12 }}>
          {pageLabel ? <Text style={[styles.rowMeta, { color: colors.textSecondary }]}>{pageLabel}</Text> : null}
          {onPreviousPage ? <IsleButton compact label={t('usage.previousPage')} disabled={refreshing} onPress={onPreviousPage} /> : null}
          {hasMore && onLoadMore ? <IsleButton compact testID="usage-next-page" label={t('usage.nextPage')} disabled={refreshing} onPress={onLoadMore} /> : null}
        </View> : null}
      </View>

      <View style={[styles.section, { borderColor }]}>
        {sectionHeader(copy.pricing, (
          <IsleButton
            compact
            label={copy.addOverride}
            icon={<AppIcon name="add" color={colors.textSecondary} size={14} />}
            disabled={!pricingProviderOptions.length || !pricingModelOptions.length}
            onPress={openNewPricingOverride}
          />
        ))}
        {!pricingProviderOptions.length || !pricingModelOptions.length ? (
          <Text style={[styles.rowMeta, { color: colors.textSecondary, marginBottom: 12 }]}>
            {t('usage.pricingRequiresModel')}
          </Text>
        ) : null}
        {pricingOverrides.length ? (
          <View>
            {pricingOverrides.map((item, index) => (
              <View key={item.id} style={[styles.pricingRow, compact && styles.pricingRowCompact, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor }]}>
                <View style={styles.pricingIdentity}>
                  <Text style={[styles.rowTitle, { color: colors.text }]}>{item.modelLabel}</Text>
                  <Text style={[styles.rowMeta, { color: colors.textSecondary }]}>{item.providerLabel}</Text>
                </View>
                <View style={[styles.pricingValues, compact && styles.pricingValuesCompact]}>
                  <Text style={[styles.pricingValue, { color: colors.text }]}>{item.inputPricePerMillion} / {item.outputPricePerMillion}</Text>
                  <Text style={[styles.rowMeta, { color: colors.textTertiary }]}>{item.currencyLabel} · {copy.perMillionTokens}</Text>
                </View>
                <View style={[styles.rowActions, compact && styles.rowActionsCompact]}>
                  <IsleButton compact label={copy.editOverride} icon={<AppIcon name="edit" color={colors.textSecondary} size={14} />} onPress={() => openExistingPricingOverride(item)} />
                  <IsleButton compact tone="danger" label={copy.deleteOverride} icon={<AppIcon name="delete" color={colors.ui.control.dangerForeground} size={14} />} onPress={() => onDeletePricingOverride(item.id)} />
                </View>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.inlineEmpty}>
            <AppIcon name="sigma" color={colors.textTertiary} size={16} />
            <Text style={[styles.rowMeta, { color: colors.textTertiary }]}>{copy.noOverrides}</Text>
          </View>
        )}
      </View>

      <View style={[styles.actionBar, { borderColor, backgroundColor: colors.ui.semantic.surface.base, borderWidth: subtleBorderWidth }]}>
        <View style={styles.exportActions}>
          <IsleButton
            compact
            label={copy.exportCsv}
            accessibilityLabel={exportingFormat === 'csv' ? copy.exporting : copy.exportCsv}
            feedbackPhase={exportingFormat === 'csv' ? 'pending' : 'idle'}
            busy={exportingFormat === 'csv'}
            icon={<AppIcon name="table" color={colors.textSecondary} size={14} />}
            disabled={!!exportingFormat}
            onPress={() => onExport('csv')}
          />
          <IsleButton
            compact
            label={copy.exportJson}
            accessibilityLabel={exportingFormat === 'json' ? copy.exporting : copy.exportJson}
            feedbackPhase={exportingFormat === 'json' ? 'pending' : 'idle'}
            busy={exportingFormat === 'json'}
            icon={<AppIcon name="json" color={colors.textSecondary} size={14} />}
            disabled={!!exportingFormat}
            onPress={() => onExport('json')}
          />
        </View>
        <IsleButton
          compact
          tone="danger"
          label={clearing ? copy.clearing : copy.clear}
          icon={<AppIcon name="delete" color={colors.ui.control.dangerForeground} size={14} />}
          disabled={clearing}
          onPress={() => setClearConfirmationOpen(true)}
        />
      </View>

      <UsageSheet
        visible={!!activeFilterDefinition}
        title={activeFilterDefinition ? copy.optionsFor(activeFilterDefinition.label) : copy.filters}
        closeLabel={copy.close}
        onClose={() => setFilterSheet(null)}
      >
        <View accessibilityRole="radiogroup">
          {activeFilterDefinition?.options.map((option, index) => {
            const selected = option.value === filters[activeFilterDefinition.key]
            return (
              <IslePressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                accessibilityState={{ selected, checked: selected }}
                onPress={() => {
                  onFiltersChange({ ...filters, [activeFilterDefinition.key]: option.value })
                  setFilterSheet(null)
                }}
                style={[styles.optionRow, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor }]}
              >
                <Text style={[styles.optionLabel, { color: selected ? colors.ui.control.link : colors.text }]}>{option.label}</Text>
                {selected ? <AppIcon name="check" color={colors.ui.tone.success.foreground} size={17} /> : null}
              </IslePressable>
            )
          })}
        </View>
      </UsageSheet>

      <UsageSheet visible={clearConfirmationOpen} title={copy.clearTitle} closeLabel={copy.close} onClose={() => setClearConfirmationOpen(false)}>
        <Text style={[styles.sheetBody, { color: colors.textSecondary }]}>{copy.clearDetail}</Text>
        <View style={styles.sheetActions}>
          <IsleButton label={copy.cancel} onPress={() => setClearConfirmationOpen(false)} />
          <IsleButton
            tone="danger"
            label={clearing ? copy.clearing : copy.confirmClear}
            icon={<AppIcon name="delete" color={colors.ui.control.dangerForeground} size={15} />}
            disabled={clearing}
            onPress={() => {
              onClear()
              setClearConfirmationOpen(false)
            }}
          />
        </View>
      </UsageSheet>

      <UsageSheet visible={requestDetail !== null} title={copy.requestDetail} closeLabel={copy.close} onClose={onCloseRequestDetail}>
        {requestDetail?.status === 'loading' ? (
          <UsageStateView icon="loader" label={copy.loading} loading compact />
        ) : requestDetail?.status === 'error' ? (
          <UsageStateView icon="warning" label={requestDetail.message} danger compact />
        ) : requestDetail?.status === 'ready' ? (
          <RequestDetail detail={requestDetail.detail} redactedLabel={copy.redacted} />
        ) : null}
      </UsageSheet>

      <UsageSheet
        visible={pricingDraft !== null}
        title={pricingDraft?.id ? copy.editOverride : copy.addOverride}
        closeLabel={copy.close}
        onClose={() => { void requestClosePricing(() => undefined) }}
        keyboardAware
      >
        {pricingDraft ? (
          <View key={pricingDraft.key} style={styles.pricingForm}>
            <SettingsHelpButton compact topic="usage" />
            <OptionChips
              disabled={pricingSaving}
              label={copy.provider}
              emptyLabel={copy.selectProvider}
              options={pricingProviderOptions}
              value={pricingDraft.providerId}
              onChange={choosePricingProvider}
            />
            <OptionChips
              disabled={pricingSaving}
              label={copy.model}
              emptyLabel={copy.selectModel}
              options={pricingModels}
              value={pricingDraft.modelId}
              onChange={(modelId) => setPricingDraft((current) => current ? { ...current, modelId } : current)}
            />
            <View style={[styles.priceFields, compact && styles.priceFieldsCompact]}>
              <PriceField
                disabled={pricingSaving}
                label={copy.inputPrice}
                suffix={copy.perMillionTokens}
                value={pricingDraft.inputPricePerMillion}
                onChangeText={(inputPricePerMillion) => setPricingDraft((current) => current ? { ...current, inputPricePerMillion } : current)}
              />
              <PriceField
                disabled={pricingSaving}
                label={copy.outputPrice}
                suffix={copy.perMillionTokens}
                value={pricingDraft.outputPricePerMillion}
                onChangeText={(outputPricePerMillion) => setPricingDraft((current) => current ? { ...current, outputPricePerMillion } : current)}
              />
            </View>
            {pricingError ? <Text accessibilityRole="alert" style={[styles.sheetBody, { color: colors.ui.tone.danger.foreground }]}>{t(`settingsWorkspace.${pricingError}`)}</Text> : null}
            <View style={styles.sheetActions}>
              <IsleButton label={copy.cancel} disabled={pricingSaving} onPress={discardPricingDraft} />
              {pricingError === 'conflict' ? <IsleButton label={t('settingsWorkspace.reload')} disabled={pricingSaving} onPress={() => {
                const latest = pricingOverrides.find(item => item.id === pricingDraft.id)
                if (latest) loadPricingOverride(latest)
                else discardPricingDraft()
              }} /> : null}
              <IsleButton
                tone="primary"
                label={pricingSaving ? copy.saving : copy.saveOverride}
                icon={<AppIcon name="check" color={colors.ui.control.primaryForeground} size={15} />}
                disabled={!canSavePricing || pricingSaving}
                onPress={savePricingOverride}
              />
            </View>
          </View>
        ) : null}
      </UsageSheet>
    </View>
  )
}

function TrendItem({ trend, compact }: { trend: UsageTrendSeries; compact: boolean }) {
  const { colors } = useAppTheme()
  const maximum = trend.points.reduce<number>((largest, value) => Math.max(largest, value ?? 0), 1)
  const directionTone = trend.direction === 'up'
    ? colors.ui.tone.success.foreground
    : trend.direction === 'down'
      ? colors.ui.tone.danger.foreground
      : colors.textTertiary
  return (
    <View
      accessible
      accessibilityLabel={trend.accessibilityLabel ?? [trend.label, trend.value, trend.change].filter(Boolean).join('. ')}
      style={[
        styles.trendItem,
        {
          width: compact ? 148 : 176,
          backgroundColor: colors.ui.semantic.surface.muted,
          borderColor: colors.ui.semantic.chrome.border,
          borderWidth: StyleSheet.hairlineWidth,
        },
      ]}
    >
      <View style={styles.trendHeading}>
        <Text style={[styles.trendLabel, { color: colors.textTertiary }]}>{trend.label}</Text>
        {trend.change ? <Text style={[styles.trendChange, { color: directionTone }]}>{trend.change}</Text> : null}
      </View>
      <Text adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.trendValue, { color: colors.text }]}>{trend.value}</Text>
      <View style={styles.trendBars} accessible={false}>
        {trend.points.slice(-14).map((point, index) => (
          <View key={`${trend.id}:${index}`} style={styles.trendBarTrack}>
            {point === undefined ? <Text style={{ color: colors.textSecondary }}>—</Text>
              : <View style={[styles.trendBar, { height: Math.max(2, (Math.max(0, point) / maximum) * 24), backgroundColor: colors.ui.control.primaryBackground }]} />}
          </View>
        ))}
      </View>
    </View>
  )
}

function FilterButton({ label, value, icon, onPress }: { label: string; value: string; icon: AppIconName; onPress: () => void }) {
  const { colors } = useAppTheme()
  const borderColor = colors.ui.liquidGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  return (
    <IslePressable
      accessibilityLabel={`${label}. ${value}`}
      onPress={onPress}
      style={[styles.filterButton, { backgroundColor: colors.ui.semantic.surface.muted, borderColor }]}
    >
      <AppIcon name={icon} color={colors.textTertiary} size={14} />
      <View style={styles.filterText}>
        <Text style={[styles.filterLabel, { color: colors.textTertiary }]}>{label}</Text>
        <Text style={[styles.filterValue, { color: colors.text }]}>{value}</Text>
      </View>
      <AppIcon name="collapse" color={colors.textTertiary} size={14} />
    </IslePressable>
  )
}

function UsageDisclosure({ label, expanded, onPress, testID }: { label: string; expanded: boolean; onPress: () => void; testID: string }) {
  const { colors } = useAppTheme()
  const motion = useThemeMotion('accent')
  return <IslePressable testID={testID} accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ expanded }} onPress={onPress} style={styles.disclosure}>
    <Text style={[styles.disclosureLabel, { color: colors.textSecondary }]}>{label}</Text>
    <MotiView animate={{ rotate: expanded ? '180deg' : '0deg' }} transition={motion.transition}
      accessible={false} importantForAccessibility="no-hide-descendants">
      <AppIcon name="collapse" size={16} color={colors.textSecondary} />
    </MotiView>
  </IslePressable>
}

function RequestRow({ item, compact, includeEstimates, accessibilityLabel, onPress }: { item: UsageRequestRow; compact: boolean; includeEstimates: boolean; accessibilityLabel: string; onPress: () => void }) {
  const { colors } = useAppTheme()
  const tone = statusTone(item.status, colors)
  return (
    <IslePressable testID={`usage-request-${item.id}`} accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress}
      style={[styles.requestRow, compact && styles.requestRowCompact]}>
      <View style={[styles.requestPrimary, compact && { flex: undefined, width: '100%' }]}>
        <Text numberOfLines={2} style={[styles.rowTitle, { color: colors.text }]}>{item.modelLabel}</Text>
        <View style={styles.requestStatusLine}>
          <View style={[styles.statusDot, { backgroundColor: tone }]} />
          <Text style={[styles.statusLabel, { color: tone }]}>{item.statusLabel}</Text>
        </View>
        <View testID={`usage-context-${item.id}`} style={styles.requestContext}>
          <Text style={[styles.rowMeta, styles.requestContextText, { color: colors.textSecondary }]}>{item.providerLabel}</Text>
          <Text style={[styles.rowMeta, styles.requestContextText, { color: colors.textSecondary }]}>· {item.sourceLabel}</Text>
        </View>
        {item.measurementLabel ? <Text style={[styles.rowMeta, { color: colors.textTertiary }]}>{item.measurementLabel}</Text> : null}
      </View>
      <View style={[styles.requestMetrics, compact && styles.requestMetricsCompact]}>
        <View style={[styles.requestMetricLead, compact && { justifyContent: 'flex-start' }]}>
          <Text style={[styles.metricText, { color: colors.text }]}>{item.tokensLabel}</Text>
          <Text style={[styles.metricText, { color: colors.textSecondary }]}>{item.latencyLabel}</Text>
        </View>
        {item.inputTokensLabel || item.outputTokensLabel ? (
          <Text style={[styles.metricCaption, { color: colors.textSecondary }]}>
            {[item.inputTokensLabel, item.outputTokensLabel].filter(Boolean).join(' / ')}
          </Text>
        ) : null}
        {item.cacheTokensLabel ? <Text style={[styles.metricCaption, { color: colors.textSecondary }]}>{item.cacheTokensLabel}</Text> : null}
        {item.firstTokenLabel ? <Text style={[styles.metricCaption, { color: colors.textSecondary }]}>{item.firstTokenLabel}</Text> : null}
        {item.estimatedCostLabel ? <Text style={[styles.metricCaption, { color: colors.textSecondary }]}>{item.estimatedCostLabel}</Text> : null}
      </View>
      <View style={[styles.requestTime, compact && { width: '100%' }]}>
        <Text style={[styles.timeLabel, { color: colors.textTertiary }]}>{item.timestampLabel}</Text>
        <AppIcon name="arrow-right" color={colors.textTertiary} size={15} />
      </View>
    </IslePressable>
  )
}

function BreakdownRow({ item, compact, copy, includeEstimates }: { item: UsageBreakdownRow; compact: boolean; copy: UsageStatisticsCopy; includeEstimates: boolean }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const share = Math.max(0, Math.min(1, item.share))
  const secondaryMetrics = [
    { label: t('usage.successRate'), value: item.successRateLabel },
    { label: copy.averageLatency, value: item.averageLatencyLabel },
    { label: copy.cacheHitRate, value: item.cacheHitRateLabel },
    { label: copy.estimatedCost, value: item.estimatedCostLabel },
  ].filter(metric => metric.value)
  return (
    <View testID={`usage-breakdown-${item.id}`} accessible
      accessibilityLabel={[item.label, item.secondaryLabel, `${item.countLabel ?? copy.requests} ${item.requestCountLabel}`, `${copy.totalTokens} ${item.tokensLabel}`, ...secondaryMetrics.map(metric => `${metric.label} ${metric.value}`)].filter(Boolean).join('. ')}
      style={styles.breakdownRow}>
      <View style={[styles.breakdownHeading, compact && { flexDirection: 'column', alignItems: 'stretch' }]}>
        <View style={[styles.pricingIdentity, compact && { flex: undefined, width: '100%' }]}>
          <Text style={[styles.rowTitle, { color: colors.text }]}>{item.label}</Text>
          {item.secondaryLabel ? <Text style={[styles.rowMeta, { color: colors.textSecondary }]}>{item.secondaryLabel}</Text> : null}
        </View>
        <View style={[styles.breakdownMetrics, compact && { width: '100%' }]}>
          {[{ label: item.countLabel ?? copy.requests, value: item.requestCountLabel }, { label: copy.totalTokens, value: item.tokensLabel }].map(metric => <View key={metric.label} style={styles.breakdownMetric}>
            <Text style={[styles.metricCaption, { color: colors.textSecondary }]}>{metric.label}</Text>
            <Text style={[styles.breakdownValue, { color: colors.text }]}>{metric.value}</Text>
          </View>)}
        </View>
      </View>
      <View style={styles.breakdownContext}>{secondaryMetrics.map(metric => <Text key={metric.label} style={[styles.metricCaption, { color: colors.textSecondary }]}>{metric.label} {metric.value}</Text>)}</View>
      <View style={[styles.shareTrack, { backgroundColor: colors.ui.semantic.surface.muted }]}>
        <View style={[styles.shareFill, { width: `${share * 100}%`, backgroundColor: colors.ui.control.primaryBackground }]} />
      </View>
    </View>
  )
}

function RequestDetail({ detail, redactedLabel }: { detail: RedactedUsageRequestDetail; redactedLabel: string }) {
  const { colors } = useAppTheme()
  // Fill the sheet inset with the reading plane without moving its fields.
  return (
    <View testID="usage-detail-reading-plane" style={[styles.modalContent, {
      backgroundColor: colors.material.sheet.body,
      marginHorizontal: -styles.modalContent.paddingHorizontal,
      marginTop: -styles.modalContent.paddingTop,
      marginBottom: -styles.modalContent.paddingBottom,
    }]}>
      <UsageRequestDetail detail={detail} redactedLabel={redactedLabel} statusColor={statusTone(detail.status, colors)} />
    </View>
  )
}

function UsageSheet({ visible, title, closeLabel, onClose, children, keyboardAware = false }: { visible: boolean; title: string; closeLabel: string; onClose: () => void; children: ReactNode; keyboardAware?: boolean }) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference(true)
  const content = (
    <View style={styles.modalFrame}>
      <Pressable accessible={false} accessibilityRole="none" style={StyleSheet.absoluteFill} onPress={onClose} />
      <MotiView
        from={motion === 'full' ? { opacity: 0, translateY: 16 } : { opacity: 1, translateY: 0 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'timing', duration: motion === 'full' ? 160 : 1 }}
        style={[styles.modalSheet, { backgroundColor: colors.ui.semantic.chrome.sheet, borderColor: colors.ui.semantic.chrome.border }]}
        accessibilityViewIsModal
      >
        <View style={styles.modalHeader}>
          <Text style={[styles.sheetTitle, { color: colors.text }]}>{title}</Text>
          <IsleButton compact label={closeLabel} icon={<AppIcon name="close" color={colors.textSecondary} size={15} />} onPress={onClose} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled contentContainerStyle={styles.modalContent}>
          {children}
        </ScrollView>
      </MotiView>
    </View>
  )
  return (
    <Modal transparent visible={visible} animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      {keyboardAware ? <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>{content}</KeyboardAvoidingView> : <View style={styles.modalRoot}>{content}</View>}
    </Modal>
  )
}

function OptionChips({ label, emptyLabel, options, value, onChange, disabled = false }: { label: string; emptyLabel: string; options: UsageFilterOption[]; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const { colors } = useAppTheme()
  return (
    <View>
      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{label}</Text>
      {options.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionChips}>
          {options.map((option) => (
            <IslePressable key={option.value} disabled={disabled} accessibilityRole="radio" accessibilityLabel={option.label} accessibilityState={{ selected: value === option.value, checked: value === option.value, disabled }} onPress={() => onChange(option.value)} style={{ minHeight: ISLE_MIN_TOUCH_TARGET, justifyContent: 'center' }}>
              <IsleChip active={value === option.value}>{option.label}</IsleChip>
            </IslePressable>
          ))}
        </ScrollView>
      ) : (
        <Text style={[styles.rowMeta, { color: colors.textTertiary }]}>{emptyLabel}</Text>
      )}
    </View>
  )
}

function PriceField({ label, suffix, value, onChangeText, disabled = false }: { label: string; suffix: string; value: string; onChangeText: (value: string) => void; disabled?: boolean }) {
  const { colors } = useAppTheme()
  return (
    <View style={styles.priceField}>
      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{label}</Text>
      <TextInput
        editable={!disabled}
        value={value}
        onChangeText={onChangeText}
        keyboardType="decimal-pad"
        selectTextOnFocus
        accessibilityLabel={`${label}, ${suffix}`}
        placeholder="0.00"
        placeholderTextColor={colors.textTertiary}
        style={[styles.priceInput, { color: colors.text, backgroundColor: colors.ui.semantic.surface.muted, borderColor: colors.ui.semantic.chrome.border }]}
      />
      <Text style={[styles.fieldSuffix, { color: colors.textTertiary }]}>{suffix}</Text>
    </View>
  )
}

function UsageStateView({ icon, label, actionLabel, onAction, danger = false, loading = false, compact = false }: { icon: AppIconName; label: string; actionLabel?: string; onAction?: () => void; danger?: boolean; loading?: boolean; compact?: boolean }) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference(true)
  const color = danger ? colors.ui.tone.danger.foreground : colors.textSecondary
  return (
    <View style={[styles.stateView, compact && styles.stateViewCompact]}>
      {loading && motion === 'full' ? <ActivityIndicator color={color} size="small" /> : <AppIcon name={icon} color={color} size={18} />}
      <Text style={[styles.stateLabel, { color }]}>{label}</Text>
      {actionLabel && onAction ? <IsleButton compact label={actionLabel} icon={<AppIcon name="retry" color={colors.textSecondary} size={14} />} onPress={onAction} /> : null}
    </View>
  )
}

function UsageEmptyState({ title, detail }: { title: string; detail: string }) {
  const { colors } = useAppTheme()
  return (
    <IsleMotionFrame role="section" style={styles.emptyState}>
      <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: 56, height: 56, borderRadius: 18, marginBottom: 8, backgroundColor: colors.ui.icon.accentBackground, alignItems: 'center', justifyContent: 'center' }}>
        <AppIcon name="chart" color={colors.ui.icon.accentForeground} size={27} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.emptyDetail, { color: colors.textSecondary }]}>{detail}</Text>
    </IsleMotionFrame>
  )
}

function RowSeparator() {
  const { colors } = useAppTheme()
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.ui.semantic.chrome.border, marginHorizontal: 12 }} />
}

function statusTone(status: UsageRequestStatus, colors: ReturnType<typeof useAppTheme>['colors']) {
  if (status === 'succeeded') return colors.ui.tone.success.foreground
  if (status === 'failed') return colors.ui.tone.danger.foreground
  if (status === 'cancelled') return colors.ui.tone.warning.foreground
  return colors.textTertiary
}

function statusToneForSlice(tone: UsageStatusSlice['tone'], colors: ReturnType<typeof useAppTheme>['colors']) {
  if (tone === 'success') return colors.ui.tone.success.foreground
  if (tone === 'danger') return colors.ui.tone.danger.foreground
  return colors.textTertiary
}

const styles = StyleSheet.create({
  root: {
    width: '100%',
    gap: 20,
  },
  section: {
    width: '100%',
    paddingBottom: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionHeader: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 7,
  },
  sectionTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
    letterSpacing: 0,
    includeFontPadding: false,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    gap: 6,
  },
  primaryMetric: { gap: 4, paddingTop: 8, paddingBottom: 18 },
  primaryMetricHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  primaryMetricLabel: { fontSize: 13, lineHeight: 20, fontWeight: '600' },
  primaryMetricValue: { fontSize: 42, lineHeight: 52, fontWeight: '700', includeFontPadding: false },
  summaryContext: { flexDirection: 'row', gap: 16, paddingBottom: 14 },
  contextMetric: { flex: 1, minWidth: 0, gap: 6 },
  contextMetricLabel: { fontSize: 12, lineHeight: 18, fontWeight: '500' },
  contextMetricValue: { fontSize: 20, lineHeight: 28, fontWeight: '700', includeFontPadding: false },
  summaryGridNarrow: {
    rowGap: 2,
  },
  summaryCell: {
    flexGrow: 1,
    minWidth: 0,
    minHeight: 62,
    paddingHorizontal: 9,
    paddingVertical: 8,
    justifyContent: 'center',
    borderRadius: 6,
  },
  summaryLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minWidth: 0,
  },
  summaryLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
    letterSpacing: 0,
    includeFontPadding: false,
  },
  summaryValue: {
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '700',
    letterSpacing: 0,
    includeFontPadding: false,
    marginTop: 3,
  },
  trendStrip: {
    minHeight: 80,
    paddingRight: 2,
    gap: 7,
  },
  trendItem: {
    minHeight: 80,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  trendHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  trendLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
    includeFontPadding: false,
  },
  trendChange: {
    maxWidth: 64,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
    includeFontPadding: false,
  },
  trendValue: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
    marginTop: 2,
    includeFontPadding: false,
  },
  trendBars: {
    height: 26,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    marginTop: 4,
  },
  statusSummary: {
    gap: 7,
    paddingHorizontal: 9,
    paddingTop: 8,
  },
  statusTrack: {
    width: '100%',
    height: 7,
    flexDirection: 'row',
    overflow: 'hidden',
    borderRadius: 4,
  },
  statusSegment: {
    height: '100%',
    minWidth: 1,
  },
  statusLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusLegendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusLegendText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    includeFontPadding: false,
  },
  trendBarTrack: {
    flex: 1,
    minWidth: 2,
    height: 24,
    justifyContent: 'flex-end',
  },
  trendBar: {
    width: '100%',
    minHeight: 2,
    borderRadius: 1,
    opacity: 0.82,
  },
  filterStrip: {
    gap: 7,
    paddingRight: 2,
  },
  filterButton: {
    width: 148,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 7,
  },
  filterText: {
    flex: 1,
    minWidth: 0,
  },
  filterLabel: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
    includeFontPadding: false,
  },
  filterValue: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
    includeFontPadding: false,
    marginTop: 1,
  },
  listViewport: {
    width: '100%',
    minHeight: 340,
    overflow: 'hidden',
    borderRadius: 8,
  },
  listContent: {
    paddingVertical: 3,
  },
  requestRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 16,
  },
  requestRowCompact: { flexDirection: 'column', alignItems: 'stretch', gap: 8 },
  requestPrimary: {
    flex: 1,
    minWidth: 0,
  },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minWidth: 0,
  },
  rowTitle: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '700',
    includeFontPadding: false,
  },
  rowMeta: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '500',
    includeFontPadding: false,
    marginTop: 2,
  },
  requestContext: {
    minWidth: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 6,
    rowGap: 2,
  },
  requestContextText: {
    maxWidth: '100%',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0,
  },
  statusLabel: {
    flexShrink: 0,
    maxWidth: 88,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
    includeFontPadding: false,
  },
  requestMetrics: {
    width: 192,
    alignItems: 'flex-end',
    gap: 3,
  },
  requestMetricsCompact: {
    width: '100%',
    alignItems: 'stretch',
  },
  requestMetricLead: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', columnGap: 14, rowGap: 3 },
  requestStatusLine: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  metricCaption: { maxWidth: '100%', fontSize: 13, lineHeight: 20, fontWeight: '500', includeFontPadding: false },
  disclosure: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  disclosureLabel: { flex: 1, minWidth: 0, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  metricText: {
    maxWidth: '100%',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    includeFontPadding: false,
  },
  requestTime: {
    width: 80,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
  },
  timeLabel: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
    includeFontPadding: false,
  },
  breakdownRow: {
    width: '100%',
    minHeight: 68,
    paddingHorizontal: 12,
    paddingVertical: 9,
    justifyContent: 'center',
  },
  breakdownHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  breakdownMetrics: {
    width: 216,
    flexDirection: 'row',
    gap: 16,
  },
  breakdownMetric: { flex: 1, minWidth: 0, gap: 2 },
  breakdownValue: { fontSize: 20, lineHeight: 28, fontWeight: '700', includeFontPadding: false },
  breakdownContext: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4, marginTop: 10 },
  shareTrack: {
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 8,
  },
  shareFill: {
    height: 3,
    borderRadius: 2,
  },
  pricingRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  pricingRowCompact: {
    flexWrap: 'wrap',
  },
  pricingIdentity: {
    flex: 1,
    minWidth: 0,
  },
  pricingValues: {
    width: 176,
    alignItems: 'flex-end',
  },
  pricingValuesCompact: {
    width: 136,
  },
  pricingValue: {
    maxWidth: '100%',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
    includeFontPadding: false,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  rowActionsCompact: {
    width: '100%',
    justifyContent: 'flex-end',
  },
  inlineEmpty: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 2,
  },
  actionBar: {
    width: '100%',
    minHeight: 54,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: 7,
    borderRadius: 8,
  },
  exportActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  modalRoot: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.38)',
  },
  modalFrame: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  modalSheet: {
    width: '100%',
    maxWidth: 720,
    maxHeight: '86%',
    minHeight: 180,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  modalHeader: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(127, 127, 127, 0.22)',
  },
  modalContent: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 24,
  },
  sheetTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
    letterSpacing: 0,
    includeFontPadding: false,
  },
  sheetBody: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    includeFontPadding: false,
  },
  sheetActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 7,
    marginTop: 16,
  },
  optionRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  optionLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    includeFontPadding: false,
  },
  detailHeading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
  },
  detailTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  detailStatus: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    borderLeftWidth: 2,
    marginBottom: 7,
  },
  detailField: {
    minHeight: 48,
    paddingVertical: 8,
  },
  detailLabel: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
    includeFontPadding: false,
  },
  detailValue: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    includeFontPadding: false,
    marginTop: 3,
  },
  pricingForm: {
    gap: 14,
  },
  fieldLabel: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
    includeFontPadding: false,
    marginBottom: 6,
  },
  optionChips: {
    gap: 6,
    paddingRight: 2,
  },
  priceFields: {
    flexDirection: 'row',
    gap: 10,
  },
  priceFieldsCompact: {
    flexDirection: 'column',
  },
  priceField: {
    flex: 1,
    minWidth: 0,
  },
  priceInput: {
    width: '100%',
    minHeight: 44,
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    letterSpacing: 0,
  },
  fieldSuffix: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    includeFontPadding: false,
    marginTop: 4,
  },
  stateView: {
    flex: 1,
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    padding: 20,
  },
  stateViewCompact: {
    minHeight: 100,
  },
  stateLabel: {
    maxWidth: 360,
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    includeFontPadding: false,
  },
  emptyState: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  emptyTitle: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '700',
    includeFontPadding: false,
    marginTop: 8,
  },
  emptyDetail: {
    maxWidth: 300,
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '500',
    includeFontPadding: false,
    marginTop: 3,
  },
})
