import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { Modal } from '@/components/ui/AppModal'
import { Text } from '@/components/ui/AppText'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'

import { loadContextCapacity, type ContextCapacityLoadResult, type ContextReportedInput } from '@/bootstrap/contextCapacityRuntime'
import { previewDraftContextCapacity, type DraftContextCapacityResult } from '@/bootstrap/contextCapacityDraftRuntime'
import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import { ISLE_MIN_TOUCH_TARGET, IsleOverlayPressable, IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { ContextCapacitySources } from './ContextCapacitySources'
import { ToolDeclarationReport } from './ToolDeclarationReport'
import { useReadChatContextDraft, type ChatContextDraft } from './chatContextDraft'
import type {
  ContextCapacityNotice,
  ContextCapacitySegment,
  ContextCapacityView,
} from '@/modules/assistant-runtime'

const KNOWN_SEGMENT_TYPES = new Set([
  'system',
  'retrieved_context',
  'memory',
  'history_summary',
  'recent_messages',
  'attachments',
  'tool_outputs',
  'remote_compact_state',
])

const WARNING_RATIO = 0.7
const DANGER_RATIO = 0.9

type SheetState = { kind: 'loading' } | ContextCapacityLoadResult | Exclude<DraftContextCapacityResult, { kind: 'ready' }>

export function ContextCapacitySheet({
  visible,
  conversationId,
  onClose,
}: {
  visible: boolean
  conversationId: string
  onClose: () => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const motion = useMotionPreference(true)
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const [loaded, setLoaded] = useState<{ conversationId: string; state: SheetState }>()
  const [refresh, setRefresh] = useState(0)
  const [mode, setMode] = useState<'recorded' | 'draft'>('recorded')
  const [selectedType, setSelectedType] = useState<string>()
  const [draftSnapshot, setDraftSnapshot] = useState<{ conversationId: string; draft: ChatContextDraft | undefined; capturedAt: number }>()
  const readDraft = useReadChatContextDraft()
  const conversation = useChatStore(state => state.conversations.find(item => item.id === conversationId))
  const providers = useSettingsStore(state => state.providers)
  const settings = useSettingsStore(state => state.settings)
  const draftPreview = useMemo(() => {
    if (!visible || mode !== 'draft' || !conversation || draftSnapshot?.conversationId !== conversationId) return undefined
    return previewDraftContextCapacity({
      conversation, provider: providers.find(provider => provider.id === conversation.providerId),
      settings, draft: draftSnapshot.draft, capturedAt: draftSnapshot.capturedAt,
    })
  }, [visible, mode, conversationId, conversation, providers, settings, draftSnapshot])
  const state: SheetState = mode === 'draft'
    ? draftPreview ?? { kind: 'draft-unavailable' }
    : loaded?.conversationId === conversationId ? loaded.state : { kind: 'loading' }

  useEffect(() => {
    if (!visible) return undefined
    let cancelled = false
    setLoaded({ conversationId, state: { kind: 'loading' } })
    void loadContextCapacity(conversationId).then((result) => {
      if (!cancelled) setLoaded({ conversationId, state: result })
    }, () => {
      if (!cancelled) setLoaded({ conversationId, state: { kind: 'unreadable' } })
    })
    return () => {
      cancelled = true
    }
  }, [conversationId, visible, refresh])

  useEffect(() => {
    setMode('recorded')
    setSelectedType(undefined)
    setDraftSnapshot(undefined)
  }, [conversationId, visible])

  function closeCurrentView() {
    if (selectedType) setSelectedType(undefined)
    else onClose()
  }

  function showDraft() {
    setDraftSnapshot({ conversationId, draft: readDraft?.(), capturedAt: Date.now() })
    setSelectedType(undefined)
    setMode('draft')
  }

  if (!visible) return null

  const sheetMaterial = colors.material.sheet
  const borderWidth = colors.ui.monet ? 1 : StyleSheet.hairlineWidth

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={closeCurrentView}
    >
      <View style={styles.modalRoot}>
        <IsleOverlayPressable
          accessible={false}
          accessibilityRole="none"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.backdrop }]}
        />
        <MotiView
          from={motion === 'full' ? { opacity: 0, translateY: 18 } : { opacity: 1, translateY: 0 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: motion === 'full' ? 180 : 0 }}
          accessibilityViewIsModal
          testID="chat-context-capacity-sheet"
          style={{
            width: Math.min(640, width),
            maxHeight: Math.max(120, height - Math.max(insets.top, 16) - 16),
            alignSelf: 'center',
            borderTopLeftRadius: Math.min(colors.ui.radius.modal, 8),
            borderTopRightRadius: Math.min(colors.ui.radius.modal, 8),
            backgroundColor: sheetMaterial.surface,
            borderWidth,
            borderBottomWidth: 0,
            borderColor: sheetMaterial.border,
            overflow: 'hidden',
          }}
        >
          <View style={[styles.header, { backgroundColor: sheetMaterial.chrome, borderBottomColor: sheetMaterial.divider, borderBottomWidth: borderWidth }]}>
            <View style={styles.headerCopy}>
              <Text numberOfLines={1} style={[styles.title, { color: colors.text }]}>
                {t('chat.contextCapacity.title')}
              </Text>
              <Text numberOfLines={2} style={[styles.subtitle, { color: colors.textSecondary }]}>
                {t(mode === 'draft' ? 'chat.contextCapacity.draftPreviewHint' : 'chat.contextCapacity.lastRequest')}
              </Text>
            </View>
            <IslePressable
              haptic
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              onPress={onClose}
              style={styles.closeAction}
            >
              <AppIcon name="close" color={colors.textSecondary} size={18} strokeWidth={appIconStroke.regular} />
            </IslePressable>
          </View>
          <View style={[styles.tabs, { backgroundColor: sheetMaterial.chrome }]}>
            {(['recorded', 'draft'] as const).map(value => <IslePressable key={value}
              testID={`chat-context-tab-${value}`} accessibilityRole="button"
              accessibilityLabel={t(value === 'draft' ? 'chat.contextCapacity.draftPreview' : 'chat.contextCapacity.lastRequest')}
              accessibilityState={{ selected: mode === value }}
              {...(Platform.OS === 'web' ? { 'aria-pressed': mode === value } : {})}
              onPress={() => { if (value === 'draft') showDraft(); else { setMode('recorded'); setSelectedType(undefined) } }}
              style={[styles.tab, { borderBottomColor: mode === value ? colors.ui.icon.accentForeground : 'transparent' }]}>
              <Text style={{ color: mode === value ? colors.text : colors.textSecondary, fontSize: 13, fontWeight: '700' }}>
                {t(value === 'draft' ? 'chat.contextCapacity.draftPreview' : 'chat.contextCapacity.lastRequest')}
              </Text>
            </IslePressable>)}
          </View>
          <ScrollView
            style={{ backgroundColor: sheetMaterial.body, flexShrink: 1 }}
            contentContainerStyle={[styles.body, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}
            keyboardShouldPersistTaps="handled"
          >
            {mode === 'draft' ? <Text testID="chat-context-draft-scope" style={[styles.previewHint, { color: colors.textSecondary }]}>
              {t('chat.contextCapacity.draftScopeHint')}
            </Text> : null}
            {mode === 'draft' && draftPreview?.kind === 'ready' ? <Text style={[styles.previewHint, { color: colors.textTertiary }]}>
              {t('chat.contextCapacity.draftIdentity', { model: draftPreview.requestedModel, count: draftPreview.draftCharacters })}
            </Text> : null}
            <ContextCapacityContent state={state} preview={mode === 'draft'} selectedType={selectedType} onSelectSource={setSelectedType} />
            {mode === 'recorded' && state.kind !== 'loading' ? <IslePressable accessibilityRole="button"
              accessibilityLabel={t('chat.contextCapacity.refreshRecorded')} onPress={() => { setSelectedType(undefined); setRefresh(value => value + 1) }}
              style={styles.tab}>
              <Text style={{ color: colors.ui.icon.accentForeground, fontSize: 13 }}>{t('chat.contextCapacity.refreshRecorded')}</Text>
            </IslePressable> : null}
            {mode === 'draft' ? <IslePressable accessibilityRole="button" accessibilityLabel={t('chat.contextCapacity.refreshDraft')}
              onPress={showDraft} style={styles.tab}>
              <Text style={{ color: colors.ui.icon.accentForeground, fontSize: 13 }}>{t('chat.contextCapacity.refreshDraft')}</Text>
            </IslePressable> : null}
            <IslePressable accessibilityRole="button" accessibilityLabel={t('usage.contextSettings')}
              onPress={() => { onClose(); router.push({ pathname: '/settings/context', params: { conversationId, returnTo: 'chat' } }) }}
              style={{ minHeight: 44, paddingVertical: 12 }}>
              <Text style={{ color: colors.ui.icon.accentForeground, fontSize: 14, lineHeight: 22 }}>{t('usage.contextSettings')}</Text>
            </IslePressable>
          </ScrollView>
        </MotiView>
      </View>
    </Modal>
  )
}
export function ContextCapacityContent({ state, preview = false, selectedType, onSelectSource }: {
  state: SheetState
  preview?: boolean
  selectedType?: string
  onSelectSource?: (type: string | undefined) => void
}) {
  const identity = state.kind === 'ready'
    ? JSON.stringify([state.view.runId, state.view.capturedAt, state.view.providerId, state.view.model, state.view.manifestId])
    : state.kind
  const [selection, setSelection] = useState<{ identity: string; type?: string }>()
  const type = onSelectSource ? selectedType : selection?.identity === identity ? selection.type : undefined
  return <SheetBody state={state} preview={preview} selectedType={type}
    onSelectSource={onSelectSource ?? (type => setSelection({ identity, type }))} />
}
function SheetBody({ state, preview, selectedType, onSelectSource }: {
  state: SheetState
  preview: boolean
  selectedType?: string
  onSelectSource: (type: string | undefined) => void
}) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()

  if (state.kind === 'loading') {
    return (
      <View style={styles.placeholder}>
        <ActivityIndicator color={colors.textSecondary} />
        <Text style={[styles.placeholderMessage, { color: colors.textSecondary }]}>
          {t('chat.contextCapacity.loading')}
        </Text>
      </View>
    )
  }
  if (state.kind === 'empty') {
    return (
      <Notice
        tone="neutral"
        title={t('chat.contextCapacity.emptyTitle')}
        message={t('chat.contextCapacity.emptyMessage')}
      />
    )
  }
  if (state.kind === 'unreadable') {
    return (
      <Notice
        tone="danger"
        title={t('chat.contextCapacity.unreadableTitle')}
        message={t('chat.contextCapacity.unreadableMessage')}
      />
    )
  }
  if (state.kind !== 'ready') {
    return <Notice tone="neutral" title={t('chat.contextCapacity.draftUnavailableTitle')}
      message={t(state.kind === 'draft-busy' ? 'chat.contextCapacity.draftBusy'
        : state.kind === 'draft-unbound' ? 'chat.contextCapacity.draftUnbound' : 'chat.contextCapacity.draftUnavailable')} />
  }
  return <CapacityReport view={state.view} preview={preview} reportedInput={state.reportedInput} selectedType={selectedType} onSelectSource={onSelectSource} />
}

function CapacityReport({ view, preview, reportedInput, selectedType, onSelectSource }: {
  view: ContextCapacityView
  preview: boolean
  reportedInput?: ContextReportedInput
  selectedType?: string
  onSelectSource: (type: string | undefined) => void
}) {
  const { colors } = useAppTheme()
  const { t, i18n } = useTranslation()
  const measured = view.status === 'measured'
  if (selectedType && view.segments.some(segment => segment.type === selectedType)) {
    return <View style={styles.report}>
      <IslePressable accessibilityRole="button" accessibilityLabel={t('chat.contextCapacity.backToComposition')}
        onPress={() => onSelectSource(undefined)} style={styles.tab}>
        <Text style={{ color: colors.ui.icon.accentForeground, fontSize: 13 }}>{t('chat.contextCapacity.backToComposition')}</Text>
      </IslePressable>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.text }]}>
        {KNOWN_SEGMENT_TYPES.has(selectedType) ? t(`chat.contextCapacity.segment.${selectedType}`) : t('chat.contextCapacity.segment.unknown')}
      </Text>
      <ContextCapacitySources key={JSON.stringify([view.runId, view.capturedAt, view.manifestId, view.providerId, view.model, selectedType])} view={view} type={selectedType} />
    </View>
  }

  return (
    <View style={styles.report} testID={preview ? 'chat-context-draft-report' : 'chat-context-recorded-report'}>
      <Text style={[styles.measurementHint, { color: colors.textTertiary }]}>
        {`${view.providerId} · ${view.model} · ${t('chat.contextCapacity.estimatedOnly')}`}
      </Text>
      {!preview ? <Text testID="chat-context-recorded-identity" style={[styles.measurementHint, { color: colors.textTertiary }]}>
        {t('chat.contextCapacity.recordedIdentity', { time: new Date(view.capturedAt).toLocaleString(i18n.language), id: view.runId })}
      </Text> : null}
      {!preview ? <View testID="chat-context-reported-input" style={styles.reported}>
        <Text style={[styles.previewHint, { color: colors.textSecondary }]}>{t('chat.contextCapacity.reportedInput', {
          count: reportedInput ? formatTokens(reportedInput.tokens, t) : '—',
        })}</Text>
        <Text style={[styles.measurementHint, { color: colors.textTertiary }]}>
          {t(reportedInput ? 'chat.contextCapacity.reportedInputHint' : 'chat.contextCapacity.reportedInputUnavailable')}
        </Text>
      </View> : null}
      {!preview && view.toolDeclarations ? <ToolDeclarationReport receipt={view.toolDeclarations} /> : null}

      {measured ? (
        <CapacityGauge view={view} />
      ) : (
        <Notice
          tone="warning"
          title={t('chat.contextCapacity.unmeasuredTitle')}
          message={t('chat.contextCapacity.unmeasuredMessage')}
        />
      )}

      <View style={styles.metricRow}>
        <Metric label={t('chat.contextCapacity.used')} value={formatTokens(view.usedTokens, t)} />
        <Metric label={t('chat.contextCapacity.remaining')} value={measured ? formatTokens(view.remainingTokens, t) : '—'} />
        <Metric label={t('chat.contextCapacity.untilCompaction')} value={measured && view.tokensUntilCompaction > 0 ? formatTokens(view.tokensUntilCompaction, t) : '—'} />
      </View>

      {view.compression.triggered && (!preview || measured) ? <CompressionRow view={view} /> : null}

      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        {t('chat.contextCapacity.composition')}
      </Text>
      {view.segments.map((segment) => (
        <SegmentRow key={segment.type} segment={segment} measured={measured} onPress={() => onSelectSource(segment.type)} />
      ))}

      {view.notices
        .filter((notice) => notice !== 'compression_active')
        .map((notice) => (
          <Notice key={notice} tone={noticeTone(notice)} message={t(noticeMessageKey(notice))} />
        ))}

      {view.failureCodes.length ? (
        <Text style={[styles.failureCodes, { color: colors.textTertiary }]}>
          {view.failureCodes.join(' · ')}
        </Text>
      ) : null}
    </View>
  )
}
function CapacityGauge({ view }: { view: ContextCapacityView }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const tone = view.usedRatio >= DANGER_RATIO
    ? colors.ui.tone.danger
    : view.usedRatio >= WARNING_RATIO
    ? colors.ui.tone.warning
    : colors.ui.tone.success
  const budgetShare = view.contextWindowTokens > 0
    ? Math.min(100, (view.inputBudgetTokens / view.contextWindowTokens) * 100)
    : 100

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: view.inputBudgetTokens, now: Math.min(view.usedTokens, view.inputBudgetTokens) }}
      accessibilityLabel={`${t('chat.contextCapacity.used')} ${view.usedTokens} / ${view.inputBudgetTokens}`}
      {...(Platform.OS === 'web' ? {
        'aria-valuemin': 0,
        'aria-valuemax': view.inputBudgetTokens,
        'aria-valuenow': Math.min(view.usedTokens, view.inputBudgetTokens),
      } : {})}
      style={styles.gauge}
    >
      <View style={[styles.gaugeTrack, { backgroundColor: colors.ui.semantic.surface.muted, borderColor: colors.material.stroke }]}>
        <View style={[styles.gaugeBudget, { width: `${budgetShare}%`, backgroundColor: colors.ui.semantic.surface.base, borderRightColor: colors.material.stroke }]}>
          <View style={[styles.gaugeFill, { width: `${Math.round(view.usedRatio * 100)}%`, backgroundColor: tone.foreground }]} />
        </View>
      </View>
      <View style={styles.gaugeLegend}>
        <Text style={[styles.gaugeUsed, { color: tone.foreground }]}>
          {`${formatTokens(view.usedTokens, t)} / ${formatTokens(view.inputBudgetTokens, t)}`}
        </Text>
        <Text style={[styles.gaugeWindow, { color: colors.textTertiary }]}>
          {`${t('chat.contextWindow')} ${formatCount(view.contextWindowTokens)} · ${t('chat.contextCapacity.reserved')} ${formatCount(view.reservedTokens)}`}
        </Text>
      </View>
      <Text style={[styles.gaugeHint, { color: colors.textTertiary }]}>
        {t('chat.contextCapacity.budgetHint')}
      </Text>
    </View>
  )
}

function SegmentRow({ segment, measured, onPress }: { segment: ContextCapacitySegment; measured: boolean; onPress: () => void }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const label = KNOWN_SEGMENT_TYPES.has(segment.type)
    ? t(`chat.contextCapacity.segment.${segment.type}`)
    : t('chat.contextCapacity.segment.unknown')
  const badges = [
    segment.unmeasuredSourceCount > 0
      ? t('chat.contextCapacity.unmeasuredSources', { count: segment.unmeasuredSourceCount })
      : '',
    segment.cappedCount > 0 ? t('chat.contextCapacity.cappedSources', { count: segment.cappedCount }) : '',
    segment.excludedCount > 0 ? t('chat.contextCapacity.excludedSources', { count: segment.excludedCount }) : '',
    segment.droppedTokens > 0 ? t('chat.contextCapacity.droppedTokens', { count: segment.droppedTokens }) : '',
  ].filter(Boolean)

  return (
    <IslePressable accessibilityRole="button" accessibilityLabel={t('chat.contextCapacity.openSources', { source: label })}
      accessibilityHint={t('chat.contextCapacity.sourceMetadataHint')} onPress={onPress}
      style={styles.segment} testID={`chat-context-capacity-segment-${segment.type}`}>
      <View style={styles.segmentHeader}>
        <Text numberOfLines={1} style={[styles.segmentLabel, { color: colors.text }]}>{label}</Text>
        <Text style={[styles.segmentTokens, { color: colors.textSecondary }]}>
          {formatTokens(segment.tokens, t)}
        </Text>
        <Text style={[styles.segmentShare, { color: colors.textTertiary }]}>
          {measured ? `${Math.round(segment.ratio * 100)}%` : '—'}
        </Text>
        <AppIcon name="back-next" color={colors.textTertiary} size={14} />
      </View>
      {measured ? <View testID={`chat-context-capacity-track-${segment.type}`} style={[styles.segmentTrack, { backgroundColor: colors.ui.semantic.surface.muted }]}>
        <View style={[styles.segmentFill, { width: `${Math.round(segment.ratio * 100)}%`, backgroundColor: colors.ui.tone.info.foreground }]} />
      </View> : null}
      {badges.length ? (
        <Text style={[styles.segmentBadges, { color: colors.textTertiary }]}>{badges.join(' · ')}</Text>
      ) : null}
    </IslePressable>
  )
}
function CompressionRow({ view }: { view: ContextCapacityView }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const tone = colors.ui.tone.info
  return (
    <View style={[styles.compression, { backgroundColor: tone.background, borderColor: tone.border }]}>
      <AppIcon name="memory-brain" color={tone.foreground} size={14} strokeWidth={appIconStroke.regular} />
      <View style={styles.compressionCopy}>
        <Text numberOfLines={1} style={[styles.compressionTitle, { color: colors.text }]}>
          {t('chat.contextCapacity.compressionTitle')}
        </Text>
        <Text numberOfLines={2} style={[styles.compressionDetail, { color: colors.textSecondary }]}>
          {`${t('chat.contextCapacity.compressionDetail', {
            strategy: view.compression.strategy,
            kept: view.compression.keptMessageCount,
            source: view.compression.sourceMessageCount,
          })} · ${t('chat.contextCapacity.compressionSaved', { count: view.compression.savedTokens })}`}
        </Text>
      </View>
    </View>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme()
  return (
    <View style={styles.metric}>
      <Text numberOfLines={1} style={[styles.metricValue, { color: colors.text }]}>{value}</Text>
      <Text numberOfLines={1} style={[styles.metricLabel, { color: colors.textTertiary }]}>{label}</Text>
    </View>
  )
}

function Notice({
  tone,
  title,
  message,
}: {
  tone: 'neutral' | 'warning' | 'danger'
  title?: string
  message: string
}) {
  const { colors } = useAppTheme()
  const toneToken = colors.ui.tone[tone]
  return (
    <View style={[styles.notice, { backgroundColor: toneToken.background, borderColor: toneToken.border }]}>
      {title ? (
        <Text style={[styles.noticeTitle, { color: colors.text }]}>{title}</Text>
      ) : null}
      <Text style={[styles.noticeMessage, { color: colors.textSecondary }]}>{message}</Text>
    </View>
  )
}

function noticeTone(notice: ContextCapacityNotice): 'neutral' | 'warning' | 'danger' {
  if (notice === 'budget_overrun' || notice === 'plan_failures') return 'danger'
  if (notice === 'compression_active') return 'neutral'
  return 'warning'
}

function noticeMessageKey(notice: ContextCapacityNotice): string {
  switch (notice) {
    case 'unmeasured_sources':
      return 'chat.contextCapacity.noticeUnmeasured'
    case 'budget_overrun':
      return 'chat.contextCapacity.noticeOverrun'
    case 'excluded_sources':
      return 'chat.contextCapacity.noticeExcluded'
    case 'plan_failures':
      return 'chat.contextCapacity.noticeFailures'
    case 'compression_active':
      return 'chat.contextCapacity.compressionTitle'
  }
}

function formatTokens(value: number, t: (key: string, options?: Record<string, unknown>) => string): string {
  return t('chat.contextCapacity.tokens', { count: value })
}

function formatCount(value: number): string {
  return value.toLocaleString()
}
const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 16, paddingRight: 6, paddingVertical: 10 },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, lineHeight: 20, fontWeight: '800', includeFontPadding: false },
  subtitle: { marginTop: 2, fontSize: 11, lineHeight: 15, fontWeight: '600', includeFontPadding: false },
  closeAction: {
    width: ISLE_MIN_TOUCH_TARGET,
    height: ISLE_MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 12 },
  tab: { minHeight: 44, justifyContent: 'center', paddingVertical: 8, borderBottomWidth: 2 },
  previewHint: { fontSize: 12, lineHeight: 18 },
  reported: { gap: 4 },
  placeholder: { paddingVertical: 36, alignItems: 'center', gap: 10 },
  placeholderMessage: { fontSize: 12, lineHeight: 17, fontWeight: '600', textAlign: 'center' },
  report: { gap: 12 },
  measurementHint: { fontSize: 10.5, lineHeight: 15, fontWeight: '600' },
  gauge: { gap: 6 },
  gaugeTrack: {
    height: 14,
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  gaugeBudget: { height: '100%', borderRightWidth: StyleSheet.hairlineWidth, justifyContent: 'center' },
  gaugeFill: { height: '100%' },
  gaugeLegend: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  gaugeUsed: { fontSize: 12.5, lineHeight: 17, fontWeight: '800' },
  gaugeWindow: { flexShrink: 1, fontSize: 10, lineHeight: 14, fontWeight: '600', textAlign: 'right' },
  gaugeHint: { fontSize: 10, lineHeight: 14, fontWeight: '500' },
  metricRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  metric: { flex: 1, minWidth: 0, gap: 1 },
  metricValue: { fontSize: 13, lineHeight: 18, fontWeight: '800', includeFontPadding: false },
  metricLabel: { fontSize: 9.5, lineHeight: 13, fontWeight: '600', includeFontPadding: false },
  sectionTitle: { marginTop: 2, fontSize: 12, lineHeight: 16, fontWeight: '800' },
  segment: { gap: 4, minHeight: 44, paddingVertical: 6 },
  segmentHeader: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  segmentLabel: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 16, fontWeight: '700' },
  segmentTokens: { fontSize: 11, lineHeight: 15, fontWeight: '700' },
  segmentShare: { minWidth: 34, fontSize: 10.5, lineHeight: 15, fontWeight: '700', textAlign: 'right' },
  segmentTrack: { height: 5, borderRadius: 3, overflow: 'hidden' },
  segmentFill: { height: '100%' },
  segmentBadges: { fontSize: 9.5, lineHeight: 13, fontWeight: '600' },
  compression: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 9,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  compressionCopy: { flex: 1, minWidth: 0 },
  compressionTitle: { fontSize: 11.5, lineHeight: 16, fontWeight: '800' },
  compressionDetail: { marginTop: 1, fontSize: 10, lineHeight: 14, fontWeight: '600' },
  notice: { padding: 9, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, gap: 2 },
  noticeTitle: { fontSize: 11.5, lineHeight: 16, fontWeight: '800' },
  noticeMessage: { fontSize: 10.5, lineHeight: 15, fontWeight: '600' },
  failureCodes: { marginTop: 2, fontSize: 9.5, lineHeight: 13, fontWeight: '600' },
})
