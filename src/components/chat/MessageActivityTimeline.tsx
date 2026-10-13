import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { MotiView } from 'moti'
import { Easing } from 'react-native-reanimated'
import { useTranslation } from 'react-i18next'
import { AppIcon, appIconStroke, type AppIconName } from '@/components/ui/AppIcon'
import { ISLE_MIN_TOUCH_TARGET, IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { resolveThemeComponentExpression, type ThemeMotionGrammar } from '@/theme/themeExpression'
import type { MotionIntensity } from '@/theme/themeMotion'
import type { ResponseLifecycleStage } from '@/types/chatContracts'
import { formatDuration } from './tracePresentation'
import { messageActivityLabel, type MessageActivityRow } from './messageActivityRows'

export function MessageActivityTimeline({ rows, notice, maxHeight, motion, active = false, replyStarted = false, onLayoutChangeRequest }: {
  rows: MessageActivityRow[]
  notice?: string
  maxHeight: number
  motion: MotionIntensity
  active?: boolean
  replyStarted?: boolean
  onLayoutChangeRequest?: (options?: { force?: boolean }) => void
}) {
  const { colors, canonicalThemeId } = useAppTheme()
  const { t } = useTranslation()
  // Show real preparation/tool steps until the answer takes the screen. A
  // user's choice after that transition survives subsequent streaming updates.
  const autoExpanded = active && !replyStarted
  const [disclosure, setDisclosure] = useState<{ phase: boolean; expanded: boolean }>()
  const expanded = disclosure?.phase === autoExpanded ? disclosure.expanded : autoExpanded
  const current = [...rows].reverse().find(row => row.state === 'running')
  const hasDetails = rows.length > 1 || rows.some(row => row.details.length > 0)
  const attention = rows.filter(row => row.state === 'error' || row.state === 'waiting' || row.state === 'incomplete')
  const cancelled = rows.some(row => row.state === 'cancelled')
  const failed = rows.filter(row => row.state === 'error').length
  const done = rows.filter(row => row.state === 'done').length
  const unfinished = rows.some(row => ['pending', 'incomplete', 'skipped'].includes(row.state))
  const label = current ? messageActivityLabel(current, t)
    : failed ? t('messageBubble.activity.failed', { count: failed })
      : rows.some(row => row.state === 'waiting') ? t('messageBubble.activity.state.waiting')
        : cancelled ? t('messageBubble.activity.state.cancelled')
          : unfinished ? t('messageBubble.activity.state.incomplete')
            : active ? t(`messageBubble.activity.${replyStarted ? 'generating' : 'working'}.active`)
              : t('messageBubble.activity.completed', { count: done })
  const grammar = resolveThemeComponentExpression(canonicalThemeId, 'aiResponse').motion
  if (!rows.length && !notice) return null
  return (
    <View testID="message-activity-timeline" onLayout={() => onLayoutChangeRequest?.()} style={{ width: '100%', minWidth: 0, marginBottom: 8, gap: 2 }}>
      {hasDetails ? <IslePressable testID="message-activity-toggle" haptic accessibilityRole="button"
        accessibilityLabel={t('messageBubble.process', { summary: label })} accessibilityHint={t(expanded ? 'messageBubble.activity.collapseHistory' : 'messageBubble.activity.expandHistory')}
        accessibilityState={{ expanded, busy: active || Boolean(current) }}
        onPress={() => { setDisclosure({ phase: autoExpanded, expanded: !expanded }); onLayoutChangeRequest?.({ force: !expanded }) }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: ISLE_MIN_TOUCH_TARGET }}>
        <AnimatedProcessStatusText label={label} active={Boolean(current)} tone={colors.textSecondary}
          icon={current ? 'loader' : attention.length ? 'warning' : cancelled ? 'stop' : 'history'} motion={motion} grammar={grammar}
          statusMotionPhase={current?.kind === 'thinking' ? 'thinking' : 'active-stage'} stageStartedAt={current?.startedAt} />
        <AppIcon name={expanded ? 'collapse' : 'back-next'} color={colors.textTertiary} size={14} />
      </IslePressable> : null}
      {/* Once the reply starts, normal history is unmounted, not clipped.
          Authorization and unsafe outcomes remain visible in either phase. */}
      {(expanded || !hasDetails ? rows : attention).map(row => (
        <MessageActivityItem key={row.id} row={row} maxHeight={maxHeight} motion={motion} onLayoutChangeRequest={onLayoutChangeRequest} />
      ))}
      {notice ? (
        <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 }}>
          <AppIcon name="shield" color={colors.textSecondary} size={14} />
          <Text style={{ flex: 1, color: colors.textSecondary, fontSize: 12, lineHeight: 18, fontWeight: '700' }}>{notice}</Text>
        </View>
      ) : null}
    </View>
  )
}

function MessageActivityItem({ row, maxHeight, motion, onLayoutChangeRequest }: {
  row: MessageActivityRow
  maxHeight: number
  motion: MotionIntensity
  onLayoutChangeRequest?: (options?: { force?: boolean }) => void
}) {
  const { colors, canonicalThemeId } = useAppTheme()
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const grammar = resolveThemeComponentExpression(canonicalThemeId, 'aiResponse').motion
  const active = row.state === 'running'
  const canExpand = row.details.length > 0
  const label = messageActivityLabel(row, t)
  const tone = row.state === 'error' ? colors.error : active ? colors.textSecondary : colors.textTertiary
  const icon: AppIconName = row.state === 'error' ? 'warning'
    : row.state === 'cancelled' || row.state === 'skipped' || row.state === 'incomplete' ? 'stop'
      : row.state === 'waiting' ? 'shield'
        : row.kind === 'thinking' ? 'reasoning'
          : row.kind === 'command' ? 'command'
            : row.kind === 'edit' ? 'edit'
              : row.kind === 'search' ? 'search'
                : row.state === 'done' ? 'check' : 'loader'
  const phase = ['command', 'edit', 'search', 'retrieval', 'tool', 'tool_request'].includes(row.kind)
    ? 'active-stage' : row.kind as ResponseLifecycleStage
  const durationMs = row.durationMs ?? (row.completedAt !== undefined && row.startedAt !== undefined
    ? Math.max(0, row.completedAt - row.startedAt) : undefined)
  const header = (
    <>
      <AnimatedProcessStatusText active={active} label={label} tone={tone} icon={icon} motion={motion} grammar={grammar}
        statusMotionPhase={phase} stageStartedAt={active ? row.startedAt : undefined} />
      {!active && durationMs !== undefined && durationMs > 0 ? (
        <Text accessible={false} style={{ color: colors.textTertiary, fontSize: 10, fontVariant: ['tabular-nums'] }}>{formatDuration(durationMs)}</Text>
      ) : null}
      {canExpand ? <AppIcon name={expanded ? 'collapse' : 'back-next'} color={colors.textTertiary} size={14} /> : null}
    </>
  )
  const headerStyle = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, minWidth: 0, minHeight: canExpand ? ISLE_MIN_TOUCH_TARGET : 28, paddingVertical: 4 }
  return (
    <View testID={`message-activity-row-${row.id}`} style={{ minWidth: 0, width: '100%' }}>
      {canExpand ? (
        <IslePressable haptic accessibilityRole="button" accessibilityLabel={label}
          accessibilityHint={t(expanded ? 'messageBubble.activity.collapse' : 'messageBubble.activity.expand')}
          accessibilityState={{ expanded, busy: active }} accessibilityLiveRegion="polite" style={headerStyle}
          onPress={() => { setExpanded(value => !value); onLayoutChangeRequest?.({ force: !expanded }) }}>
          {header}
        </IslePressable>
      ) : (
        <View accessible accessibilityLabel={label} accessibilityState={{ busy: active }} accessibilityLiveRegion="polite" style={headerStyle}>{header}</View>
      )}
      {!expanded && row.state === 'error' && row.details.some(detail => detail.kind === 'output') ? (
        <Text selectable numberOfLines={3} style={{ color: colors.error, fontSize: 12, lineHeight: 18, marginLeft: 20, marginBottom: 6 }}>
          {row.details.find(detail => detail.kind === 'output')!.text}
        </Text>
      ) : null}
      {expanded && canExpand ? (
        <ScrollView testID={`message-activity-details-${row.id}`} nestedScrollEnabled style={{
          maxHeight, marginLeft: 20, marginBottom: 8, borderLeftWidth: grammar === 'material' ? 2 : StyleSheet.hairlineWidth,
          borderColor: colors.ui.semantic.chrome.border, paddingHorizontal: 10,
        }}>
          {row.details.map(detail => (
            <View key={detail.kind} style={{ gap: 4, paddingVertical: 6 }}>
              <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, fontWeight: '700' }}>{t(`messageBubble.activity.detail.${detail.kind}`)}</Text>
              <Text selectable style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 18 }}>{detail.text}</Text>
            </View>
          ))}
        </ScrollView>
      ) : null}
    </View>
  )
}

type StreamingStatusPhase = ResponseLifecycleStage | 'thinking-done' | 'active-stage'

function AnimatedProcessStatusText({ active, label, tone, icon, motion, grammar, statusMotionPhase, stageStartedAt, previewText }: { active: boolean; label: string; tone: string; icon: AppIconName; motion: MotionIntensity; grammar: ThemeMotionGrammar; statusMotionPhase?: StreamingStatusPhase; stageStartedAt?: number; previewText?: string }) {
  const { colors } = useAppTheme()
  const [dotCount, setDotCount] = useState(1)
  // Reasoning keeps the full existing status motion with a live elapsed counter;
  // generating drops the shimmer for a lighter dots-only cadence, and a settled
  // thinking stage goes fully static instead of looping.
  const phaseShimmerEnabled = !statusMotionPhase ||
    statusMotionPhase === 'thinking' ||
    statusMotionPhase === 'active-stage' ||
    statusMotionPhase === 'preparing' ||
    statusMotionPhase === 'sending' ||
    statusMotionPhase === 'waiting' ||
    statusMotionPhase === 'working' ||
    statusMotionPhase === 'tool_calling'
  const shimmer = active && motion === 'full' && grammar !== 'precision' && phaseShimmerEnabled
  const dotsEnabled = active && (
    !statusMotionPhase ||
    statusMotionPhase === 'generating' ||
    statusMotionPhase === 'active-stage' ||
    statusMotionPhase === 'preparing' ||
    statusMotionPhase === 'sending' ||
    statusMotionPhase === 'waiting' ||
    statusMotionPhase === 'working' ||
    statusMotionPhase === 'tool_calling' ||
    statusMotionPhase === 'tool_result' ||
    (statusMotionPhase === 'thinking' && stageStartedAt === undefined)
  )
  const baseLabel = label.replace(/[.\u2026]+$/u, '').trimEnd()
  const displayLabel = dotsEnabled
    ? `${baseLabel}${'.'.repeat(motion === 'full' ? dotCount : 3)}`
    : statusMotionPhase === 'thinking' ? baseLabel : label
  const cycleMs = grammar === 'organic' ? 520 : grammar === 'fluid' ? 420 : 360
  const shimmerDuration = grammar === 'organic' ? 1800 : grammar === 'fluid' ? 1380 : 980
  const shimmerWidth = grammar === 'organic' ? 42 : grammar === 'fluid' ? 30 : 24
  const shimmerOpacity = grammar === 'organic' ? 0.1 : grammar === 'fluid' ? 0.18 : 0.12

  useEffect(() => {
    if (!dotsEnabled || motion !== 'full') {
      setDotCount(3)
      return
    }
    setDotCount(1)
    const timer = setInterval(() => {
      setDotCount((current) => current >= 3 ? 1 : current + 1)
    }, cycleMs)
    return () => clearInterval(timer)
  }, [cycleMs, dotsEnabled, motion])

  return (
    <View testID={`message-thinking-status-${grammar}`} style={{ flex: 1, flexShrink: 1, minWidth: 0, minHeight: 16, justifyContent: 'center', overflow: 'hidden' }}>
      <View
        key={label}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}
      >
        <AppIcon name={icon} color={tone} size={14} strokeWidth={appIconStroke.strong} />
        <Text
          accessibilityLabel={label}
          style={{ flexShrink: 1, color: tone, fontSize: 12, lineHeight: 16, fontWeight: '800', includeFontPadding: false }}
        >
          {displayLabel}
        </Text>
        {stageStartedAt !== undefined ? <LifecycleElapsedText startedAt={stageStartedAt} /> : null}
        {previewText ? (
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            accessible={false}
            style={{ flexShrink: 2, minWidth: 0, color: colors.textTertiary, fontSize: 11, lineHeight: 15, fontWeight: '500', opacity: 0.86 }}
          >
            {previewText}
          </Text>
        ) : null}
      </View>
      {shimmer ? <MotiView
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        from={{ translateX: -shimmerWidth, opacity: 0 }}
        animate={shimmer ? { translateX: 320, opacity: shimmerOpacity } : { translateX: -shimmerWidth, opacity: 0 }}
        transition={{ loop: shimmer, type: 'timing', duration: shimmer ? shimmerDuration : 1, easing: grammar === 'organic' ? Easing.inOut(Easing.sin) : Easing.inOut(Easing.cubic) }}
        style={{ position: 'absolute', top: -6, bottom: -6, left: 0, width: shimmerWidth, borderRadius: grammar === 'material' ? 2 : 12, backgroundColor: tone, transform: [{ rotate: grammar === 'material' ? '0deg' : '12deg' }] }}
      /> : null}
    </View>
  )
}

function LifecycleElapsedText({ startedAt }: { startedAt: number }) {
  const { colors } = useAppTheme()
  // The lifecycle timestamp is durable. This interval only refreshes its
  // elapsed projection, so rerenders never invent or reset work time.
  const [elapsedMs, setElapsedMs] = useState(() => Math.max(0, Date.now() - startedAt))

  useEffect(() => {
    setElapsedMs(Math.max(0, Date.now() - startedAt))
    const timer = setInterval(() => {
      setElapsedMs(Math.max(0, Date.now() - startedAt))
    }, 1000)
    return () => clearInterval(timer)
  }, [startedAt])

  return (
    <Text
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, fontWeight: '600', fontVariant: ['tabular-nums'], minWidth: 44 }}
    >
      {`· ${formatThinkingElapsed(elapsedMs)}`}
    </Text>
  )
}

function formatThinkingElapsed(ms: number): string {
  if (ms < 60000) {
    return `${Math.floor(ms / 1000)}s`
  }
  return formatDuration(ms)
}
