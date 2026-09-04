import { useEffect, useState } from 'react'
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { loadContextCapacity, type ContextCapacityLoadResult } from '@/bootstrap/contextCapacityRuntime'
import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import { ISLE_MIN_TOUCH_TARGET, IsleOverlayPressable, IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
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

type SheetState = { kind: 'loading' } | ContextCapacityLoadResult

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
  const motion = useMotionPreference()
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const [state, setState] = useState<SheetState>({ kind: 'loading' })

  useEffect(() => {
    if (!visible) return undefined
    let cancelled = false
    setState({ kind: 'loading' })
    void loadContextCapacity(conversationId).then((result) => {
      if (!cancelled) setState(result)
    })
    return () => {
      cancelled = true
    }
  }, [conversationId, visible])

  if (!visible) return null

  const sheetMaterial = colors.material.sheet
  const borderWidth = colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
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
            maxHeight: Math.max(360, height - Math.max(insets.top, 16) - 16),
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
                {t('chat.contextCapacity.lastRequest')}
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
          <ScrollView
            style={{ backgroundColor: sheetMaterial.body }}
            contentContainerStyle={[styles.body, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}
          >
            <SheetBody state={state} />
          </ScrollView>
        </MotiView>
      </View>
    </Modal>
  )
}
function SheetBody({ state }: { state: SheetState }) {
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
  return <CapacityReport view={state.view} />
}

function CapacityReport({ view }: { view: ContextCapacityView }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const measured = view.status === 'measured'

  return (
    <View style={styles.report}>
      <Text style={[styles.measurementHint, { color: colors.textTertiary }]}>
        {`${view.model} · ${t('chat.contextCapacity.estimatedOnly')}`}
      </Text>

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
        <Metric label={t('chat.contextCapacity.untilCompaction')} value={view.tokensUntilCompaction > 0 ? formatTokens(view.tokensUntilCompaction, t) : '—'} />
      </View>

      {view.compression.triggered ? <CompressionRow view={view} /> : null}

      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        {t('chat.contextCapacity.composition')}
      </Text>
      {view.segments.map((segment) => (
        <SegmentRow key={segment.type} segment={segment} measured={measured} />
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
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: view.inputBudgetTokens, now: view.usedTokens }}
      accessibilityLabel={`${t('chat.contextCapacity.used')} ${view.usedTokens} / ${view.inputBudgetTokens}`}
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

function SegmentRow({ segment, measured }: { segment: ContextCapacitySegment; measured: boolean }) {
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
    <View style={styles.segment} testID={`chat-context-capacity-segment-${segment.type}`}>
      <View style={styles.segmentHeader}>
        <Text numberOfLines={1} style={[styles.segmentLabel, { color: colors.text }]}>{label}</Text>
        <Text style={[styles.segmentTokens, { color: colors.textSecondary }]}>
          {formatTokens(segment.tokens, t)}
        </Text>
        <Text style={[styles.segmentShare, { color: colors.textTertiary }]}>
          {measured ? `${Math.round(segment.ratio * 100)}%` : '—'}
        </Text>
      </View>
      <View style={[styles.segmentTrack, { backgroundColor: colors.ui.semantic.surface.muted }]}>
        <View style={[styles.segmentFill, { width: `${Math.round(segment.ratio * 100)}%`, backgroundColor: colors.ui.tone.info.foreground }]} />
      </View>
      {badges.length ? (
        <Text style={[styles.segmentBadges, { color: colors.textTertiary }]}>{badges.join(' · ')}</Text>
      ) : null}
    </View>
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
  segment: { gap: 4 },
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
