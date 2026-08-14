import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { AppIcon, appIconStroke, type AppIconName } from '@/components/ui/AppIcon'
import { IslePressable } from '@/components/ui/isle'
import type { ConversationTaskActivityRecord } from '@/modules/tasks'
import { getWorkflowEvidenceRepairActionFromMessage, getWorkflowPendingActionFromMessage } from '@/presentation/features/conversations/workflowMessageActionSelectors'
import { useAppTheme } from '@/hooks/useAppTheme'
import type { Message } from '@/types/chatContracts'

import { summarizeWorkflowTaskEvidence } from './workflowTaskEvidence'
import { collectVisibleProcessTraces, getActiveTraceStageLabel, getActiveTraceTitle } from './tracePresentation'

const QUICK_TOOL_HIT_SLOP = { top: 8, right: 6, bottom: 8, left: 6 }

export function ConversationTaskStatusCard(props: {
  task: ConversationTaskActivityRecord
  taskCount: number
  message?: Message
  topOffset: number
  compact: boolean
  onCancel: () => void
  onRepairAgentEvidence?: (message: Message) => void
  onConfirmAction?: (message: Message) => void
}) {
  const { colors } = useAppTheme()
  if (props.compact && colors.ui.family === 'lime-road') return <LimeRoadTaskStatusCard {...props} />
  if (props.compact && colors.ui.family === 'markdown') return <MarkdownTaskStatusCard {...props} />
  if (props.compact) return <MinimalTaskStatusCard {...props} />
  return <SharedTaskStatusCard {...props} />
}

function SharedTaskStatusCard({
  task,
  taskCount,
  message,
  topOffset,
  compact,
  onCancel,
  onRepairAgentEvidence,
  onConfirmAction,
}: {
  task: ConversationTaskActivityRecord
  taskCount: number
  message?: Message
  topOffset: number
  compact: boolean
  onCancel: () => void
  onRepairAgentEvidence?: (message: Message) => void
  onConfirmAction?: (message: Message) => void
}) {
  const { colors, isGlass } = useAppTheme()
  const { t } = useTranslation()
  const traces = message ? collectVisibleProcessTraces(message) : []
  const activeTraceTitle = message ? getActiveTraceTitle(traces, message.status) : ''
  const activeTraceStage = message ? getActiveTraceStageLabel(traces, message.status) : ''
  const evidenceSummary = summarizeWorkflowTaskEvidence(traces)
  const pendingWorkflowAction = message ? getWorkflowPendingActionFromMessage(message) : undefined
  const evidenceRepairAction = message ? getWorkflowEvidenceRepairActionFromMessage(message) : undefined
  const canRepairEvidence = !!message && !!evidenceRepairAction && !!onRepairAgentEvidence
  const canConfirmAction = !!message && !!pendingWorkflowAction?.confirmable && !!pendingWorkflowAction.resumeToolRequest && !!onConfirmAction
  const progressPercent = typeof task.progress === 'number' ? Math.round(task.progress * 100) : undefined
  const statusLabel = task.status === 'queued'
    ? t('chat.taskCardQueued')
    : t('chat.taskCardRunning')
  const title = task.kind === 'chat-workflow'
    ? t('chat.taskCardTitle')
    : task.title || t('chat.taskCardTitle')
  const detail = activeTraceTitle || activeTraceStage
  const statusDetail = progressPercent === undefined
    ? detail ? `${statusLabel} · ${detail}` : statusLabel
    : `${statusLabel} · ${t('chat.taskCardProgress', { percent: progressPercent })}`
  const hasEvidence = typeof evidenceSummary.evidenceCount === 'number' && evidenceSummary.evidenceCount > 0
  const hasAcceptanceChecks = typeof evidenceSummary.acceptanceCheckCount === 'number' && evidenceSummary.acceptanceCheckCount > 0
  const showEvidenceRow = hasEvidence
    || hasAcceptanceChecks
    || evidenceSummary.artifactReady
    || !!evidenceRepairAction
    || !!pendingWorkflowAction
  const backgroundColor = isGlass ? colors.ui.semantic.chrome.background : colors.ui.semantic.surface.base
  const borderColor = isGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  const tone = colors.ui.tone.warning
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: topOffset, left: 14, right: 14, zIndex: 44, elevation: 6 }}>
      <View
        style={{ width: '100%', maxWidth: 520, alignSelf: 'center' }}
      >
        <View
          accessibilityRole="summary"
          accessibilityLabel={t('chat.taskCardAccessibilityLabel')}
          style={{
            borderRadius: colors.ui.radius.panel,
            paddingHorizontal: compact ? 9 : 10,
            paddingVertical: compact ? 7 : 8,
            backgroundColor,
            borderWidth: colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth,
            borderColor,
            shadowColor: colors.shadowTint,
            shadowOpacity: colors.ui.limeRoad ? 0.06 : 0,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 4 },
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={{
                width: compact ? 27 : 29,
                height: compact ? 27 : 29,
                borderRadius: colors.ui.radius.controlMiddle,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: tone.background,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: tone.border,
              }}
            >
              <AppIcon name="workflow" color={tone.foreground} size={compact ? 13 : 14} strokeWidth={appIconStroke.strong} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.text, fontSize: compact ? 12 : 13, lineHeight: compact ? 15 : 17, fontWeight: '900', includeFontPadding: false }}>
                  {title}
                </Text>
                {taskCount > 1 ? (
                  <Text numberOfLines={1} style={{ color: tone.foreground, fontSize: 10, lineHeight: 12, fontWeight: '900', includeFontPadding: false }}>
                    {t('chat.taskCardCount', { count: taskCount })}
                  </Text>
                ) : null}
              </View>
              <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: compact ? 10 : 10.5, lineHeight: compact ? 13 : 14, fontWeight: '800', includeFontPadding: false, marginTop: 2 }}>
                {statusDetail}
              </Text>
              {showEvidenceRow ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 5 }}>
                  {hasEvidence ? (
                    <WorkflowTaskEvidenceChip
                      icon="search-check"
                      label={t('chat.taskCardEvidence', { count: evidenceSummary.evidenceCount })}
                      compact={compact}
                    />
                  ) : null}
                  {hasAcceptanceChecks ? (
                    <WorkflowTaskEvidenceChip
                      icon="list-check"
                      label={t('chat.taskCardChecks', { count: evidenceSummary.acceptanceCheckCount })}
                      compact={compact}
                    />
                  ) : null}
                  {evidenceSummary.artifactReady ? (
                    <WorkflowTaskEvidenceChip
                      icon="workflow"
                      label={t('chat.taskCardArtifactReady')}
                      compact={compact}
                    />
                  ) : null}
                  {evidenceRepairAction ? (
                    <WorkflowTaskEvidenceChip
                      icon="shield"
                      label={canRepairEvidence ? t('chat.taskCardRepairEvidence') : t('chat.taskCardEvidenceNeeded')}
                      compact={compact}
                      danger
                      accessibilityHint={canRepairEvidence ? t('chat.taskCardRepairEvidenceHint') : undefined}
                      onPress={canRepairEvidence && message ? () => onRepairAgentEvidence?.(message) : undefined}
                    />
                  ) : pendingWorkflowAction ? (
                    <WorkflowTaskEvidenceChip
                      icon="shield"
                      label={canConfirmAction ? t('chat.taskCardConfirmAction') : t('chat.taskCardActionPending')}
                      compact={compact}
                      danger
                      accessibilityHint={canConfirmAction ? t('chat.taskCardConfirmActionHint') : undefined}
                      onPress={canConfirmAction && message ? () => onConfirmAction?.(message) : undefined}
                    />
                  ) : null}
                </View>
              ) : null}
            </View>
            <IslePressable
              haptic
              accessibilityRole="button"
              accessibilityLabel={t('chat.taskCardCancel')}
              accessibilityHint={t('chat.taskCardCancelHint')}
              hitSlop={QUICK_TOOL_HIT_SLOP}
              onPress={onCancel}
              style={{
                width: compact ? 32 : 34,
                height: compact ? 32 : 34,
                borderRadius: colors.ui.radius.controlLarge,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.ui.tone.danger.background,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: colors.ui.tone.danger.border,
              }}
            >
              <AppIcon name="stop" color={colors.ui.tone.danger.foreground} size={compact ? 11 : 12} strokeWidth={appIconStroke.bold} fill={colors.ui.tone.danger.foreground} />
            </IslePressable>
          </View>
        </View>
      </View>
    </View>
  )
}

type TaskStatusCardProps = {
  task: ConversationTaskActivityRecord
  taskCount: number
  message?: Message
  topOffset: number
  compact: boolean
  onCancel: () => void
  onRepairAgentEvidence?: (message: Message) => void
  onConfirmAction?: (message: Message) => void
}

function useTaskStatusProjection({ task, taskCount, message, onRepairAgentEvidence, onConfirmAction }: Pick<TaskStatusCardProps, 'task' | 'taskCount' | 'message' | 'onRepairAgentEvidence' | 'onConfirmAction'>) {
  const { t } = useTranslation()
  const traces = message ? collectVisibleProcessTraces(message) : []
  const activeTraceTitle = message ? getActiveTraceTitle(traces, message.status) : ''
  const activeTraceStage = message ? getActiveTraceStageLabel(traces, message.status) : ''
  const evidenceSummary = summarizeWorkflowTaskEvidence(traces)
  const pendingWorkflowAction = message ? getWorkflowPendingActionFromMessage(message) : undefined
  const evidenceRepairAction = message ? getWorkflowEvidenceRepairActionFromMessage(message) : undefined
  const canRepairEvidence = !!message && !!evidenceRepairAction && !!onRepairAgentEvidence
  const canConfirmAction = !!message && !!pendingWorkflowAction?.confirmable && !!pendingWorkflowAction.resumeToolRequest && !!onConfirmAction
  const progressPercent = typeof task.progress === 'number' ? Math.round(task.progress * 100) : undefined
  const statusLabel = task.status === 'queued' ? t('chat.taskCardQueued') : t('chat.taskCardRunning')
  const title = task.kind === 'chat-workflow' ? t('chat.taskCardTitle') : task.title || t('chat.taskCardTitle')
  const detail = activeTraceTitle || activeTraceStage
  const statusDetail = progressPercent === undefined
    ? detail ? `${statusLabel} · ${detail}` : statusLabel
    : `${statusLabel} · ${t('chat.taskCardProgress', { percent: progressPercent })}`
  const hasEvidence = typeof evidenceSummary.evidenceCount === 'number' && evidenceSummary.evidenceCount > 0
  const hasAcceptanceChecks = typeof evidenceSummary.acceptanceCheckCount === 'number' && evidenceSummary.acceptanceCheckCount > 0
  const showEvidenceRow = hasEvidence || hasAcceptanceChecks || evidenceSummary.artifactReady || !!evidenceRepairAction || !!pendingWorkflowAction
  return {
    t,
    title,
    taskCount,
    statusDetail,
    tone: undefined,
    evidenceSummary,
    hasEvidence,
    hasAcceptanceChecks,
    showEvidenceRow,
    evidenceRepairAction,
    pendingWorkflowAction,
    canRepairEvidence,
    canConfirmAction,
    message,
  }
}

function MinimalTaskStatusCard(props: TaskStatusCardProps) {
  const { colors, isGlass } = useAppTheme()
  const projection = useTaskStatusProjection(props)
  const tone = colors.ui.tone.warning
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: props.topOffset, left: 14, right: 14, zIndex: 44, elevation: 6 }}>
      <View
        testID="chat-task-experience-minimal"
        style={{ width: '100%', maxWidth: 520, alignSelf: 'center' }}
      >
        <View accessibilityRole="summary" accessibilityLabel={projection.t('chat.taskCardAccessibilityLabel')} style={{ minHeight: 57, paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 9, borderLeftWidth: 3, borderLeftColor: tone.foreground, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: tone.border, backgroundColor: isGlass ? colors.ui.semantic.surface.overlay : colors.ui.semantic.surface.base }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tone.foreground }} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.text, fontSize: 12, lineHeight: 15, fontWeight: '900' }}>{projection.title}</Text>
              {projection.taskCount > 1 ? <Text style={{ color: tone.foreground, fontSize: 9, lineHeight: 11, fontWeight: '900' }}>{projection.t('chat.taskCardCount', { count: projection.taskCount })}</Text> : null}
            </View>
            <Text numberOfLines={1} style={{ marginTop: 2, color: colors.textSecondary, fontSize: 9.5, lineHeight: 12, fontWeight: '700' }}>{projection.statusDetail}</Text>
            {projection.showEvidenceRow ? <TaskEvidenceRow projection={projection} compact onRepairAgentEvidence={props.onRepairAgentEvidence} onConfirmAction={props.onConfirmAction} /> : null}
          </View>
          <TaskCancelButton onCancel={props.onCancel} compact />
        </View>
      </View>
    </View>
  )
}

function LimeRoadTaskStatusCard(props: TaskStatusCardProps) {
  const { colors } = useAppTheme()
  const projection = useTaskStatusProjection(props)
  const tone = colors.ui.tone.warning
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: props.topOffset, left: 14, right: 14, zIndex: 44, elevation: 6 }}>
      <View
        testID="chat-task-experience-lime-road"
        style={{ width: '100%', maxWidth: 520, alignSelf: 'center' }}
      >
        <View accessibilityRole="summary" accessibilityLabel={projection.t('chat.taskCardAccessibilityLabel')} style={{ minHeight: 60, paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 9, borderLeftWidth: 3, borderLeftColor: tone.foreground, borderBottomWidth: 1, borderBottomColor: colors.material.stroke, backgroundColor: colors.ui.semantic.surface.base }}>
          <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 3, borderColor: tone.foreground, backgroundColor: colors.paper }} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.text, fontSize: 13, lineHeight: 16, fontWeight: '900' }}>{projection.title}</Text>
              {projection.taskCount > 1 ? <Text style={{ color: tone.foreground, fontSize: 9, lineHeight: 11, fontWeight: '900' }}>{projection.t('chat.taskCardCount', { count: projection.taskCount })}</Text> : null}
            </View>
            <Text numberOfLines={1} style={{ marginTop: 2, color: colors.textSecondary, fontSize: 9.5, lineHeight: 12, fontWeight: '700' }}>{projection.statusDetail}</Text>
            {projection.showEvidenceRow ? <TaskEvidenceRow projection={projection} compact onRepairAgentEvidence={props.onRepairAgentEvidence} onConfirmAction={props.onConfirmAction} /> : null}
          </View>
          <TaskCancelButton onCancel={props.onCancel} compact tone={tone} />
        </View>
      </View>
    </View>
  )
}

function MarkdownTaskStatusCard(props: TaskStatusCardProps) {
  const { colors } = useAppTheme()
  const projection = useTaskStatusProjection(props)
  const tone = colors.ui.tone.warning
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: props.topOffset, left: 14, right: 14, zIndex: 44, elevation: 6 }}>
      <View
        testID="chat-task-experience-markdown"
        style={{ width: '100%', maxWidth: 520, alignSelf: 'center' }}
      >
        <View accessibilityRole="summary" accessibilityLabel={projection.t('chat.taskCardAccessibilityLabel')} style={{ minHeight: 60, paddingHorizontal: 11, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8, borderLeftWidth: 2, borderLeftColor: tone.foreground, borderBottomWidth: 1, borderBottomColor: colors.material.stroke, backgroundColor: colors.ui.semantic.surface.base }}>
          <AppIcon name="workflow" color={tone.foreground} size={13} strokeWidth={appIconStroke.strong} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.text, fontSize: 12, lineHeight: 15, fontWeight: '800' }}>{projection.title}</Text>
              {projection.taskCount > 1 ? <Text style={{ color: tone.foreground, fontSize: 9, lineHeight: 11, fontWeight: '900' }}>{projection.t('chat.taskCardCount', { count: projection.taskCount })}</Text> : null}
            </View>
            <Text numberOfLines={1} style={{ marginTop: 2, color: colors.textSecondary, fontSize: 9.5, lineHeight: 12, fontWeight: '600' }}>{projection.statusDetail}</Text>
            {projection.showEvidenceRow ? <TaskEvidenceRow projection={projection} compact onRepairAgentEvidence={props.onRepairAgentEvidence} onConfirmAction={props.onConfirmAction} /> : null}
          </View>
          <TaskCancelButton onCancel={props.onCancel} compact tone={tone} />
        </View>
      </View>
    </View>
  )
}

function TaskEvidenceRow({ projection, compact, onRepairAgentEvidence, onConfirmAction }: { projection: ReturnType<typeof useTaskStatusProjection>; compact: boolean; onRepairAgentEvidence?: (message: Message) => void; onConfirmAction?: (message: Message) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 5 }}>
      {projection.hasEvidence ? <WorkflowTaskEvidenceChip icon="search-check" label={projection.t('chat.taskCardEvidence', { count: projection.evidenceSummary.evidenceCount })} compact={compact} /> : null}
      {projection.hasAcceptanceChecks ? <WorkflowTaskEvidenceChip icon="list-check" label={projection.t('chat.taskCardChecks', { count: projection.evidenceSummary.acceptanceCheckCount })} compact={compact} /> : null}
      {projection.evidenceSummary.artifactReady ? <WorkflowTaskEvidenceChip icon="workflow" label={projection.t('chat.taskCardArtifactReady')} compact={compact} /> : null}
      {projection.evidenceRepairAction ? <WorkflowTaskEvidenceChip icon="shield" label={projection.canRepairEvidence ? projection.t('chat.taskCardRepairEvidence') : projection.t('chat.taskCardEvidenceNeeded')} compact={compact} danger accessibilityHint={projection.canRepairEvidence ? projection.t('chat.taskCardRepairEvidenceHint') : undefined} onPress={projection.canRepairEvidence && projection.message ? () => onRepairAgentEvidence?.(projection.message!) : undefined} /> : projection.pendingWorkflowAction ? <WorkflowTaskEvidenceChip icon="shield" label={projection.canConfirmAction ? projection.t('chat.taskCardConfirmAction') : projection.t('chat.taskCardActionPending')} compact={compact} danger accessibilityHint={projection.canConfirmAction ? projection.t('chat.taskCardConfirmActionHint') : undefined} onPress={projection.canConfirmAction && projection.message ? () => onConfirmAction?.(projection.message!) : undefined} /> : null}
    </View>
  )
}

function TaskCancelButton({ onCancel, compact, route = false, document = false, tone }: { onCancel: () => void; compact: boolean; route?: boolean; document?: boolean; tone?: ReturnType<typeof useAppTheme>['colors']['ui']['tone']['warning'] }) {
  const { colors } = useAppTheme()
  const resolvedTone = tone ?? colors.ui.tone.danger
  return (
    <IslePressable
      haptic
      accessibilityRole="button"
      accessibilityLabel={useTranslation().t('chat.taskCardCancel')}
      accessibilityHint={useTranslation().t('chat.taskCardCancelHint')}
      onPress={onCancel}
      style={{ width: compact ? 34 : 36, height: compact ? 34 : 36, alignSelf: route ? 'stretch' : document ? 'center' : 'center', borderRadius: document ? 0 : route ? 0 : colors.ui.radius.controlLarge, alignItems: 'center', justifyContent: 'center', backgroundColor: route ? resolvedTone.foreground : colors.ui.tone.danger.background, borderWidth: StyleSheet.hairlineWidth, borderColor: route ? resolvedTone.foreground : colors.ui.tone.danger.border }}
    >
      <AppIcon name="stop" color={route ? colors.ui.control.dangerForeground : colors.ui.tone.danger.foreground} size={compact ? 11 : 12} strokeWidth={appIconStroke.bold} fill={route ? colors.ui.control.dangerForeground : colors.ui.tone.danger.foreground} />
    </IslePressable>
  )
}

function WorkflowTaskEvidenceChip({
  icon,
  label,
  compact,
  danger = false,
  accessibilityHint,
  onPress,
}: {
  icon: AppIconName
  label: string
  compact: boolean
  danger?: boolean
  accessibilityHint?: string
  onPress?: () => void
}) {
  const { colors, isGlass } = useAppTheme()
  const foreground = danger ? colors.ui.tone.warning.foreground : colors.textSecondary
  const background = danger ? colors.ui.tone.warning.background : isGlass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted
  const border = danger ? colors.ui.tone.warning.border : isGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
  const chipStyle = {
    maxWidth: compact ? 96 : 124,
    minHeight: compact ? 22 : 24,
    borderRadius: 999,
    paddingHorizontal: compact ? 6 : 7,
    paddingVertical: compact ? 4 : 5,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    backgroundColor: background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: border,
  }
  const content = (
    <>
      <AppIcon name={icon} color={foreground} size={compact ? 9.5 : 10.5} strokeWidth={appIconStroke.strong} />
      <Text numberOfLines={1} style={{ flexShrink: 1, color: foreground, fontSize: compact ? 9 : 9.5, lineHeight: compact ? 11 : 12, fontWeight: '900', includeFontPadding: false }}>
        {label}
      </Text>
    </>
  )
  if (onPress) {
    return (
      <IslePressable
        haptic
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        hitSlop={QUICK_TOOL_HIT_SLOP}
        onPress={onPress}
        style={chipStyle}
      >
        {content}
      </IslePressable>
    )
  }
  return (
    <View style={chipStyle}>
      {content}
    </View>
  )
}
